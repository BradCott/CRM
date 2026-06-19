// Drip campaign engine — sends throttled batches of Handwrytten letters
// ("X letters every N days until complete"). Driven by an hourly cron tick
// that processes any drip whose next_run_at is due. Mirrors the send logic in
// routes/handwrytten.js so behavior (card, font, signature, sender) matches.

import db from '../db.js'

const HW_BASE = 'https://api.handwrytten.com/v2'
const HW_KEY  = process.env.HANDWRYTTEN_API_KEY
const SIG_SUFFIX = ' <sig:1427BC offset=1>'

async function hwPost(path, params = {}) {
  const res = await fetch(`${HW_BASE}${path}`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': HW_KEY },
    body:    JSON.stringify(params),
  })
  const text = await res.text()
  console.log(`[drip] POST ${path} → ${res.status} | ${text.slice(0, 200)}`)
  if (!res.ok) throw new Error(`Handwrytten API ${res.status}: ${text}`)
  try { return JSON.parse(text) } catch (_) {
    throw new Error(`Handwrytten API returned non-JSON: ${text}`)
  }
}

// Companies/entities get a "Hey" intro instead of "ABC," (the first token).
const ENTITY_RE = /\b(llc|inc|incorporated|corp|corporation|company|trust|holdings?|partners(hip)?|group|capital|investments?|properties|property|ventures?|associates|enterprises?|realty|management|fund|reit)\b/i
function isEntity(person) {
  if (person.owner_type && person.owner_type !== 'Individual') return true
  return ENTITY_RE.test(person.name || '')
}

function resolveMergeFields(template, person, property) {
  const nameParts = (person.name || '').trim().split(/\s+/)
  const first = isEntity(person) ? 'Hey' : (nameParts[0] || 'Friend')
  const last  = nameParts.slice(1).join(' ') || ''
  return template
    .replace(/\{first_name\}/gi, first)
    .replace(/\{last_name\}/gi,  last)
    .replace(/\{full_name\}/gi,  person.name || '')
    .replace(/\{tenant\}/gi,     property?.tenant_brand_name || '')
    .replace(/\{city\}/gi,       property?.city  || '')
    .replace(/\{state\}/gi,      property?.state || '')
}

/** Add `intervalDays` to now, return ISO string. */
function nextRunIso(intervalDays) {
  const d = new Date()
  d.setDate(d.getDate() + Math.max(1, Number(intervalDays) || 1))
  return d.toISOString().replace('T', ' ').slice(0, 19)
}

/**
 * Send one queued recipient. Inserts a handwrytten_sends record (so it shows up
 * in contact timelines and overall history) and updates the queue row.
 * Returns 'sent' | 'failed' | 'skipped'.
 */
async function sendQueued(drip, qrow) {
  const person = db.prepare(`SELECT * FROM people WHERE id = ?`).get(qrow.contact_id)

  // Safety net: never mail a DNC contact, even if one slipped into the queue.
  if (!person || person.do_not_contact) {
    db.prepare(`UPDATE handwrytten_drip_queue SET status='skipped', error_message=?, processed_at=datetime('now') WHERE id=?`)
      .run(person ? 'On do-not-contact list' : 'Contact deleted', qrow.id)
    return 'skipped'
  }
  if (!person.address) {
    db.prepare(`UPDATE handwrytten_drip_queue SET status='skipped', error_message='No mailing address', processed_at=datetime('now') WHERE id=?`)
      .run(qrow.id)
    return 'skipped'
  }

  let property = null
  if (qrow.property_id) {
    property = db.prepare(`
      SELECT p.*, t.name AS tenant_brand_name
      FROM properties p LEFT JOIN tenant_brands t ON t.id = p.tenant_brand_id
      WHERE p.id = ?`).get(qrow.property_id)
  }

  const resolvedMessage = resolveMergeFields(drip.message_template, person, property) + SIG_SUFFIX

  const insertRes = db.prepare(`
    INSERT INTO handwrytten_sends
      (contact_id, property_id, message, card_id, font, sent_by_user_id, status)
    VALUES (?, ?, ?, ?, ?, ?, 'pending')
  `).run(qrow.contact_id, qrow.property_id || null, resolvedMessage,
         drip.card_id || null, drip.font || null, drip.created_by_user_id || null)
  const sendId = insertRes.lastInsertRowid

  const toFirstName = person.first_name || (person.name || '').split(' ')[0] || ''
  const toLastName  = person.last_name  || (person.name || '').split(' ').slice(1).join(' ') || ''

  try {
    const hwResult = await hwPost('/orders/singleStepOrder', {
      card_id:              drip.card_id || '',
      font_label:           drip.font    || '',
      message:              resolvedMessage,
      wishes:               '',
      recipient_first_name: toFirstName,
      recipient_last_name:  toLastName,
      recipient_address1:   person.address || '',
      recipient_city:       person.city    || '',
      recipient_state:      person.state   || '',
      recipient_zip:        person.zip     || '',
      tocountry:            'US',
      sender_first_name:    'Knox',
      sender_last_name:     'Capital',
      sender_address1:      '7500 W 160th St Ste 101',
      sender_city:          'Stilwell',
      sender_state:         'KS',
      sender_zip:           '66085',
      sender_country_id:    1,
    })
    const orderId = hwResult?.order?.id || hwResult?.id || hwResult?.order_id || null

    db.prepare(`UPDATE handwrytten_sends SET status='sent', handwrytten_order_id=?, sent_at=datetime('now') WHERE id=?`)
      .run(String(orderId || ''), sendId)
    db.prepare(`UPDATE handwrytten_drip_queue SET status='sent', send_id=?, processed_at=datetime('now') WHERE id=?`)
      .run(sendId, qrow.id)
    return 'sent'
  } catch (err) {
    db.prepare(`UPDATE handwrytten_sends SET status='failed', error_message=? WHERE id=?`).run(err.message, sendId)
    db.prepare(`UPDATE handwrytten_drip_queue SET status='failed', send_id=?, error_message=?, processed_at=datetime('now') WHERE id=?`)
      .run(sendId, err.message, qrow.id)
    return 'failed'
  }
}

/** Process a single drip's next batch. */
async function processDrip(drip) {
  const batch = db.prepare(`
    SELECT * FROM handwrytten_drip_queue
    WHERE drip_id = ? AND status = 'queued'
    ORDER BY position ASC, id ASC
    LIMIT ?
  `).all(drip.id, drip.batch_size)

  if (batch.length === 0) {
    db.prepare(`UPDATE handwrytten_drips SET status='complete', next_run_at=NULL, last_run_at=datetime('now') WHERE id=?`).run(drip.id)
    return { drip_id: drip.id, sent: 0, failed: 0, complete: true }
  }

  let sent = 0, failed = 0
  for (const qrow of batch) {
    const r = await sendQueued(drip, qrow)
    if (r === 'sent') sent++
    else if (r === 'failed') failed++
  }

  // Any 'queued' rows left? If not, we're done after this batch.
  const remaining = db.prepare(`SELECT COUNT(*) AS n FROM handwrytten_drip_queue WHERE drip_id=? AND status='queued'`).get(drip.id).n

  db.prepare(`
    UPDATE handwrytten_drips
    SET sent_count   = sent_count + ?,
        failed_count = failed_count + ?,
        last_run_at  = datetime('now'),
        next_run_at  = CASE WHEN ? > 0 THEN ? ELSE NULL END,
        status       = CASE WHEN ? > 0 THEN status ELSE 'complete' END
    WHERE id = ?
  `).run(sent, failed, remaining, nextRunIso(drip.interval_days), remaining, drip.id)

  console.log(`[drip] #${drip.id} batch done — sent ${sent}, failed ${failed}, ${remaining} remaining`)
  return { drip_id: drip.id, sent, failed, complete: remaining === 0 }
}

/** Cron entry point: process every active drip whose next_run_at is due. */
export async function processDueDrips() {
  if (!HW_KEY) { console.warn('[drip] no HANDWRYTTEN_API_KEY — skipping tick'); return }
  const due = db.prepare(`
    SELECT * FROM handwrytten_drips
    WHERE status = 'active'
      AND next_run_at IS NOT NULL
      AND next_run_at <= datetime('now')
  `).all()

  if (due.length === 0) return
  console.log(`[drip] tick — ${due.length} drip(s) due`)
  for (const drip of due) {
    try { await processDrip(drip) }
    catch (err) { console.error(`[drip] #${drip.id} error:`, err.message) }
  }
}

/** Schedule the hourly tick. */
export function startDripEngine() {
  import('node-cron').then(({ default: cron }) => {
    cron.schedule('5 * * * *', () => {
      processDueDrips().catch(err => console.error('[drip] tick error:', err.message))
    })
    console.log('[drip] engine scheduled — hourly')
    // Also run shortly after boot so a drip due during downtime fires promptly.
    setTimeout(() => processDueDrips().catch(() => {}), 30_000)
  }).catch(err => console.warn('[drip] could not start:', err.message))
}

export { nextRunIso }
