import express from 'express'
import * as XLSX from 'xlsx'
import db from '../db.js'

const router  = express.Router()
const HW_BASE = 'https://api.handwrytten.com/v2'
const HW_KEY  = process.env.HANDWRYTTEN_API_KEY   // Authorization header value — no Bearer prefix

// ── Authenticated request helpers ─────────────────────────────────────────────

/** GET from Handwrytten API v2 using the API key directly. */
async function hwGet(path) {
  const url  = `${HW_BASE}${path}`
  const res  = await fetch(url, {
    headers: {
      'Authorization': HW_KEY,
      'Accept':        'application/json',
    },
  })
  const text = await res.text()
  console.log(`[Handwrytten] GET ${path} → ${res.status} | ${text.slice(0, 400)}`)
  if (!res.ok) throw new Error(`Handwrytten API ${res.status}: ${text}`)
  return JSON.parse(text)
}

/** POST to Handwrytten API v2 using the API key directly (JSON body). */
async function hwPost(path, params = {}) {
  const url  = `${HW_BASE}${path}`
  const res  = await fetch(url, {
    method:  'POST',
    headers: {
      'Content-Type':  'application/json',
      'Authorization': HW_KEY,
    },
    body: JSON.stringify(params),
  })
  const text = await res.text()
  console.log(`[Handwrytten] POST ${path} → ${res.status} | ${text.slice(0, 400)}`)
  if (!res.ok) throw new Error(`Handwrytten API ${res.status}: ${text}`)
  try { return JSON.parse(text) } catch (_) {
    throw new Error(`Handwrytten API returned non-JSON: ${text}`)
  }
}

// ── Merge field helpers ───────────────────────────────────────────────────────

// Detect a company/entity (vs an individual) so we don't greet "ABC Holdings
// LLC" as "ABC,". Entities get a "Hey" intro instead of a first name.
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

// ── Routes ────────────────────────────────────────────────────────────────────

/** GET /api/handwrytten/cards — returns the hardcoded Knox 1 custom card */
router.get('/cards', (_req, res) => {
  res.json([{ id: 192789, name: 'Knox 1', cover: null, isCustom: true }])
})

/** GET /api/handwrytten/fonts — fetches available handwriting fonts */
router.get('/fonts', async (_req, res) => {
  const attempts = ['/fonts/list', '/fonts/listFonts', '/handwriting/listFonts', '/handwriting/list']

  for (const path of attempts) {
    try {
      const data = await hwGet(path)
      console.log(`[Handwrytten] ${path} FULL raw response:`, JSON.stringify(data))
      const fonts = Array.isArray(data) ? data : data?.fonts || data?.data || []
      if (fonts.length > 0) {
        console.log(`[Handwrytten] fonts: using ${path} — ${fonts.length} fonts. First item keys: ${Object.keys(fonts[0]).join(', ')}`)
        return res.json(data)
      }
      console.log(`[Handwrytten] ${path} returned 0 fonts — trying next`)
    } catch (e) {
      console.log(`[Handwrytten] ${path} failed: ${e.message}`)
    }
  }

  console.error('[Handwrytten] fonts: all endpoints failed')
  res.status(502).json({ error: 'Could not load fonts — all endpoints failed' })
})

/** GET /api/handwrytten/sends — all history (most-recent first) */
router.get('/sends', (req, res) => {
  const { campaign_id, limit = 100, offset = 0 } = req.query

  const conditions = []
  const params     = []

  if (campaign_id) {
    conditions.push('s.campaign_id = ?')
    params.push(campaign_id)
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''

  const rows = db.prepare(`
    SELECT s.*,
      p.name       AS contact_name,
      p.address    AS contact_address,
      p.city       AS contact_city,
      p.state      AS contact_state,
      p.mail_pause_until AS contact_pause_until,
      pr.address   AS property_address,
      pr.city      AS property_city,
      pr.state     AS property_state,
      t.name       AS tenant_brand_name,
      u.name       AS sent_by_name
    FROM handwrytten_sends s
    LEFT JOIN people     p  ON p.id  = s.contact_id
    LEFT JOIN properties pr ON pr.id = s.property_id
    LEFT JOIN tenant_brands t ON t.id = pr.tenant_brand_id
    LEFT JOIN users      u  ON u.id  = s.sent_by_user_id
    ${where}
    ORDER BY s.sent_at DESC
    LIMIT ? OFFSET ?
  `).all(...params, Number(limit), Number(offset))

  const total = db.prepare(`
    SELECT COUNT(*) AS n FROM handwrytten_sends s ${where}
  `).get(...params).n

  res.json({ total, rows })
})

/** GET /api/handwrytten/sends/contact/:contactId — history for a person */
router.get('/sends/contact/:contactId', (req, res) => {
  const rows = db.prepare(`
    SELECT s.*,
      pr.address AS property_address,
      pr.city    AS property_city,
      pr.state   AS property_state,
      t.name     AS tenant_brand_name,
      u.name     AS sent_by_name
    FROM handwrytten_sends s
    LEFT JOIN properties    pr ON pr.id = s.property_id
    LEFT JOIN tenant_brands t  ON t.id  = pr.tenant_brand_id
    LEFT JOIN users         u  ON u.id  = s.sent_by_user_id
    WHERE s.contact_id = ?
    ORDER BY s.sent_at DESC
  `).all(req.params.contactId)

  res.json(rows)
})

/** PATCH /api/handwrytten/sends/:id/responded — mark/unmark a letter as responded */
router.patch('/sends/:id/responded', (req, res) => {
  const responded = req.body?.responded !== false   // default true
  const channel   = req.body?.channel || 'manual'
  db.prepare(`UPDATE handwrytten_sends SET responded_at = ?, response_channel = ? WHERE id = ?`)
    .run(responded ? new Date().toISOString() : null, responded ? channel : null, req.params.id)
  const row = db.prepare(`SELECT id, contact_id, campaign_id, responded_at, response_channel FROM handwrytten_sends WHERE id = ?`).get(req.params.id)
  if (!row) return res.status(404).json({ error: 'Send not found' })
  res.json(row)
})

/** GET /api/handwrytten/response-summary — overall + per-user mail success rates */
router.get('/response-summary', (_req, res) => {
  const overall = db.prepare(`
    SELECT COUNT(*) AS sent,
           SUM(CASE WHEN responded_at IS NOT NULL THEN 1 ELSE 0 END) AS responses
    FROM handwrytten_sends WHERE status = 'sent'
  `).get()
  const sent = overall.sent || 0
  const responses = overall.responses || 0
  res.json({ sent, responses, rate: sent ? +(responses / sent * 100).toFixed(1) : 0 })
})

/** GET /api/handwrytten/campaigns — campaign list */
router.get('/campaigns', (req, res) => {
  const { limit = 50, offset = 0 } = req.query

  const rows = db.prepare(`
    SELECT c.*,
      u.name AS sent_by_name,
      (SELECT COUNT(*) FROM handwrytten_sends s WHERE s.campaign_id = c.id AND s.responded_at IS NOT NULL) AS responded_count
    FROM handwrytten_campaigns c
    LEFT JOIN users u ON u.id = c.sent_by_user_id
    ORDER BY c.sent_at DESC
    LIMIT ? OFFSET ?
  `).all(Number(limit), Number(offset))

  const total = db.prepare(`SELECT COUNT(*) AS n FROM handwrytten_campaigns`).get().n

  res.json({ total, rows })
})

/** POST /api/handwrytten/send — send a single letter */
router.post('/send', async (req, res) => {
  const { contact_id, property_id, message, card_id, font } = req.body
  const userId = req.user?.id

  if (!contact_id || !message) {
    return res.status(400).json({ error: 'contact_id and message are required' })
  }

  // Look up the person
  const person = db.prepare(`SELECT * FROM people WHERE id = ?`).get(contact_id)
  if (!person) return res.status(404).json({ error: 'Contact not found' })

  if (!person.address) {
    return res.status(400).json({ error: 'Contact has no mailing address on file' })
  }

  // Look up property (provided or first owned property)
  let property = null
  if (property_id) {
    property = db.prepare(`
      SELECT p.*, t.name AS tenant_brand_name
      FROM properties p
      LEFT JOIN tenant_brands t ON t.id = p.tenant_brand_id
      WHERE p.id = ?
    `).get(property_id)
  } else {
    property = db.prepare(`
      SELECT p.*, t.name AS tenant_brand_name
      FROM properties p
      LEFT JOIN tenant_brands t ON t.id = p.tenant_brand_id
      WHERE p.owner_id = ?
      ORDER BY p.id ASC LIMIT 1
    `).get(contact_id)
  }

  // Look up sending user name for signature
  const senderUser = userId
    ? db.prepare(`SELECT name FROM users WHERE id = ?`).get(userId)
    : null
  const senderName = senderUser?.name || 'Knox Capital'

  // Resolve merge fields in message
  const resolvedMessage = resolveMergeFields(message, person, property)

  // Create record (pending) before sending so we always have a record
  const insertResult = db.prepare(`
    INSERT INTO handwrytten_sends
      (contact_id, property_id, message, card_id, font, sent_by_user_id, status)
    VALUES (?, ?, ?, ?, ?, ?, 'pending')
  `).run(contact_id, property_id || property?.id || null, resolvedMessage, card_id || null, font || null, userId || null)

  const sendId = insertResult.lastInsertRowid

  // Parse sender name
  const senderParts = (senderName || '').trim().split(' ')
  const senderFirst = senderParts[0] || ''
  const senderLast  = senderParts.slice(1).join(' ') || ''

  // Parse recipient name
  const nameParts = (person.name || '').trim().split(/\s+/)
  const firstName = nameParts[0] || 'Friend'
  const lastName  = nameParts.slice(1).join(' ') || ''

  const finalMessage = resolvedMessage + ' <sig:1427BC offset=1>'

  console.log(`[Handwrytten] send — firstName: "${firstName}" lastName: "${lastName}" | message: ${finalMessage}`)

  try {
    const orderParams = {
      card_id:              card_id || '',
      font_label:           font    || '',
      message:              finalMessage,
      wishes:               '',
      recipient_first_name: firstName,
      recipient_last_name:  lastName,
      recipient_address1:   person.address  || '',
      recipient_city:       person.city     || '',
      recipient_state:      person.state    || '',
      recipient_zip:        person.zip      || '',
      tocountry:            'US',
      sender_first_name:    'Brad',
      sender_last_name:     'Cottam',
      sender_address1:      '7500 W 160th St Ste 101',
      sender_city:          'Stilwell',
      sender_state:         'KS',
      sender_zip:           '66085',
      sender_country_id:    1,
    }

    const hwResult = await hwPost('/orders/singleStepOrder', orderParams)
    const orderId  = hwResult?.order?.id || hwResult?.id || hwResult?.order_id || null

    db.prepare(`
      UPDATE handwrytten_sends
      SET status = 'sent', handwrytten_order_id = ?, sent_at = datetime('now')
      WHERE id = ?
    `).run(String(orderId || ''), sendId)

    res.json({
      success:  true,
      send_id:  sendId,
      order_id: orderId,
      message:  resolvedMessage,
    })
  } catch (err) {
    db.prepare(`
      UPDATE handwrytten_sends SET status = 'failed', error_message = ? WHERE id = ?
    `).run(err.message, sendId)

    res.status(502).json({ error: err.message, send_id: sendId })
  }
})

/** POST /api/handwrytten/send-bulk — send letters to many contacts */
router.post('/send-bulk', async (req, res) => {
  const { recipients, message, card_id, font, campaign_name } = req.body
  const userId = req.user?.id

  // recipients: [{ contact_id, property_id? }, ...]
  if (!Array.isArray(recipients) || recipients.length === 0) {
    return res.status(400).json({ error: 'recipients array is required' })
  }
  if (!message) {
    return res.status(400).json({ error: 'message is required' })
  }

  // Look up sender name
  const senderUser = userId
    ? db.prepare(`SELECT name FROM users WHERE id = ?`).get(userId)
    : null
  const senderName  = senderUser?.name || 'Knox Capital'
  const senderParts = (senderName || '').trim().split(' ')
  const senderFirst = senderParts[0] || ''
  const senderLast  = senderParts.slice(1).join(' ') || ''

  // Create campaign record
  const campaignResult = db.prepare(`
    INSERT INTO handwrytten_campaigns
      (message_template, card_id, font, sent_by_user_id, total_count, status)
    VALUES (?, ?, ?, ?, ?, 'sending')
  `).run(message, card_id || null, font || null, userId || null, recipients.length)

  const campaignId = campaignResult.lastInsertRowid

  let sentCount   = 0
  let failedCount = 0
  const results   = []

  for (const { contact_id, property_id } of recipients) {
    const person = db.prepare(`SELECT * FROM people WHERE id = ?`).get(contact_id)

    if (!person) {
      results.push({ contact_id, status: 'failed', error: 'Contact not found' })
      failedCount++
      continue
    }
    if (!person.address) {
      results.push({ contact_id, status: 'failed', error: 'No mailing address' })
      failedCount++
      continue
    }
    const today = new Date().toISOString().slice(0, 10)
    if (person.do_not_contact || (person.mail_pause_until && person.mail_pause_until >= today)) {
      results.push({ contact_id, status: 'failed', error: person.do_not_contact ? 'Do Not Contact' : 'Mailing paused' })
      failedCount++
      continue
    }

    // Resolve property
    let property = null
    if (property_id) {
      property = db.prepare(`
        SELECT p.*, t.name AS tenant_brand_name
        FROM properties p
        LEFT JOIN tenant_brands t ON t.id = p.tenant_brand_id
        WHERE p.id = ?
      `).get(property_id)
    } else {
      property = db.prepare(`
        SELECT p.*, t.name AS tenant_brand_name
        FROM properties p
        LEFT JOIN tenant_brands t ON t.id = p.tenant_brand_id
        WHERE p.owner_id = ?
        ORDER BY p.id ASC LIMIT 1
      `).get(contact_id)
    }

    const resolvedMessage = resolveMergeFields(message, person, property) + ' <sig:1427BC offset=1>'

    // Insert pending record
    const insertRes = db.prepare(`
      INSERT INTO handwrytten_sends
        (contact_id, property_id, campaign_id, message, card_id, font, sent_by_user_id, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'pending')
    `).run(
      contact_id,
      property_id || property?.id || null,
      campaignId,
      resolvedMessage,
      card_id || null,
      font || null,
      userId || null,
    )
    const sendId = insertRes.lastInsertRowid

    const toFirstName = person.first_name || person.name.split(' ')[0] || ''
    const toLastName  = person.last_name  || person.name.split(' ').slice(1).join(' ') || ''

    try {
      const orderParams = {
        card_id:              card_id || '',
        font_label:           font    || '',
        message:              resolvedMessage,
        wishes:               '',
        recipient_first_name: toFirstName,
        recipient_last_name:  toLastName,
        recipient_address1:   person.address  || '',
        recipient_city:       person.city     || '',
        recipient_state:      person.state    || '',
        recipient_zip:        person.zip      || '',
        tocountry:            'US',
        sender_first_name:    'Knox',
        sender_last_name:     'Capital',
        sender_address1:      '7500 W 160th St Ste 101',
        sender_city:          'Stilwell',
        sender_state:         'KS',
        sender_zip:           '66085',
        sender_country_id:    1,
      }

      const hwResult = await hwPost('/orders/singleStepOrder', orderParams)
      const orderId  = hwResult?.order?.id || hwResult?.id || hwResult?.order_id || null

      db.prepare(`
        UPDATE handwrytten_sends
        SET status = 'sent', handwrytten_order_id = ?, sent_at = datetime('now')
        WHERE id = ?
      `).run(String(orderId || ''), sendId)

      sentCount++
      results.push({ contact_id, send_id: sendId, status: 'sent', order_id: orderId })
    } catch (err) {
      db.prepare(`
        UPDATE handwrytten_sends SET status = 'failed', error_message = ? WHERE id = ?
      `).run(err.message, sendId)

      failedCount++
      results.push({ contact_id, send_id: sendId, status: 'failed', error: err.message })
    }
  }

  // Update campaign totals
  const finalStatus = failedCount === 0 ? 'complete'
    : sentCount === 0 ? 'failed'
    : 'partial'

  db.prepare(`
    UPDATE handwrytten_campaigns
    SET sent_count = ?, failed_count = ?, status = ?
    WHERE id = ?
  `).run(sentCount, failedCount, finalStatus, campaignId)

  res.json({
    campaign_id:  campaignId,
    total:        recipients.length,
    sent:         sentCount,
    failed:       failedCount,
    status:       finalStatus,
    results,
  })
})

// ── TEST: batched basket order (placeBasket → basket/send) ────────────────────
// Sends many recipients as ONE Handwrytten order instead of one order each.
// Returns the raw API responses so we can confirm the format/payment before
// replacing the per-letter sender. Records nothing unless the batch succeeds.
router.post('/send-basket', async (req, res) => {
  const { recipients, message, card_id, font } = req.body
  const userId = req.user?.id
  if (!Array.isArray(recipients) || recipients.length === 0) return res.status(400).json({ error: 'recipients array is required' })
  if (!message) return res.status(400).json({ error: 'message is required' })

  // Build one address entry (with its merged message) per recipient
  const SIG = ' <sig:1427BC offset=1>'
  const addresses = []
  const sendMeta  = []
  const skipped   = []
  for (const { contact_id, property_id } of recipients) {
    const person = db.prepare(`SELECT * FROM people WHERE id = ?`).get(contact_id)
    if (!person || !person.address) { skipped.push({ contact_id, reason: person ? 'no address' : 'not found' }); continue }

    let property = null
    if (property_id) {
      property = db.prepare(`SELECT p.*, t.name AS tenant_brand_name FROM properties p LEFT JOIN tenant_brands t ON t.id = p.tenant_brand_id WHERE p.id = ?`).get(property_id)
    } else {
      property = db.prepare(`SELECT p.*, t.name AS tenant_brand_name FROM properties p LEFT JOIN tenant_brands t ON t.id = p.tenant_brand_id WHERE p.owner_id = ? ORDER BY p.id ASC LIMIT 1`).get(contact_id)
    }

    const resolvedMessage = resolveMergeFields(message, person, property) + SIG
    addresses.push({
      recipient_first_name: person.first_name || person.name.split(' ')[0] || '',
      recipient_last_name:  person.last_name  || person.name.split(' ').slice(1).join(' ') || '',
      recipient_address1:   person.address || '',
      recipient_city:       person.city    || '',
      recipient_state:      person.state   || '',
      recipient_zip:        person.zip     || '',
      tocountry:            'US',
      message:              resolvedMessage,
      wishes:               '',
    })
    sendMeta.push({ contact_id, property_id: property_id || property?.id || null, message: resolvedMessage })
  }

  if (addresses.length === 0) return res.status(400).json({ error: 'No mailable recipients (all missing addresses).', skipped })

  const basketParams = {
    card_id:           card_id || '',
    font_label:        font    || '',
    sender_first_name: 'Knox',
    sender_last_name:  'Capital',
    sender_address1:   '7500 W 160th St Ste 101',
    sender_city:       'Stilwell',
    sender_state:      'KS',
    sender_zip:        '66085',
    sender_country_id: 1,
    addresses,
  }

  // Raw POST that reports status + flags HTML (a webpage = the path 404'd) so the
  // test error is readable instead of dumping a marketing page.
  async function hwTry(path, params) {
    const r = await fetch(`${HW_BASE}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': HW_KEY, 'Accept': 'application/json' },
      body: JSON.stringify(params),
    })
    const text = await r.text()
    const isHtml = /^\s*<(!doctype|html)/i.test(text)
    console.log(`[hw-test] POST ${path} → ${r.status}${isHtml ? ' (HTML)' : ' | ' + text.slice(0, 300)}`)
    if (!r.ok || isHtml) {
      const why = isHtml ? `HTTP ${r.status} — returned a web page, so this endpoint path does not exist on the API`
                         : `HTTP ${r.status}: ${text.slice(0, 400)}`
      throw new Error(`${path} → ${why}`)
    }
    try { return JSON.parse(text) } catch { throw new Error(`${path} → non-JSON response: ${text.slice(0, 200)}`) }
  }

  try {
    const placeResp = await hwTry('/orders/placeBasket', basketParams)
    const sendResp  = await hwTry('/basket/send', {})
    const orderId   = sendResp?.order?.id || sendResp?.id || sendResp?.order_id ||
                      placeResp?.order?.id || placeResp?.id || null

    // Record the successful batch in our history (one shared order id)
    const ins = db.prepare(`
      INSERT INTO handwrytten_sends (contact_id, property_id, message, card_id, font, sent_by_user_id, status, handwrytten_order_id, sent_at)
      VALUES (?, ?, ?, ?, ?, ?, 'sent', ?, datetime('now'))
    `)
    for (const m of sendMeta) ins.run(m.contact_id, m.property_id, m.message, card_id || null, font || null, userId || null, String(orderId || ''))

    res.json({ ok: true, count: addresses.length, skipped, order_id: orderId, placeResp, sendResp })
  } catch (err) {
    // Surface the raw API error so we can adjust the format/payment params
    res.status(502).json({ ok: false, error: err.message, sentAs: 'basket', count: addresses.length, skipped })
  }
})

// ── Generate a Handwrytten bulk-upload spreadsheet (Basic template) ───────────
// Builds the exact .xlsx their website bulk tool accepts — one row per recipient
// with the fully-merged message — so a whole campaign uploads as a single order.
const HW_BULK_HEADERS = [
  'Return Address First Name', 'Return Address Last Name (opt)', 'Return Address Business (opt)',
  'Return Address Line 1', 'Return Address Line 2 (opt)', 'Return Address City',
  'Return Address State', 'Return Address Zip', 'Return Address Country',
  'To Address First Name', 'To Address Last Name (opt)', 'To Address Business (opt)',
  'To Address Line 1', 'To Address Line 2 (opt)', 'To Address City',
  'To Address State', 'To Address Zip', 'To Address Country',
  'Message', 'Sign Off (opt)', 'Send Date (opt)', 'Message Length',
]

router.post('/bulk-file', (req, res) => {
  const { recipients, message, sign_off, return_address } = req.body
  if (!Array.isArray(recipients) || recipients.length === 0) return res.status(400).json({ error: 'recipients array is required' })
  if (!message) return res.status(400).json({ error: 'message is required' })

  const ret = return_address || {}
  const RET = {
    first:   ret.first   ?? 'Brad',
    last:    ret.last    ?? 'Cottam',
    business:ret.business?? 'Knox Capital',
    line1:   ret.line1   ?? '7500 W 160th St Ste 101',
    line2:   ret.line2   ?? '',
    city:    ret.city    ?? 'Stilwell',
    state:   ret.state   ?? 'KS',
    zip:     ret.zip     ?? '66085',
    country: ret.country ?? 'United States',
  }
  const signOff = sign_off ?? 'Sincerely,\r\n<sig:1427BC>'

  const rows = [HW_BULK_HEADERS]
  for (const { contact_id, property_id } of recipients) {
    const person = db.prepare(`SELECT * FROM people WHERE id = ?`).get(contact_id)
    if (!person || !person.address) continue

    let property = null
    if (property_id) {
      property = db.prepare(`SELECT p.*, t.name AS tenant_brand_name FROM properties p LEFT JOIN tenant_brands t ON t.id = p.tenant_brand_id WHERE p.id = ?`).get(property_id)
    } else {
      property = db.prepare(`SELECT p.*, t.name AS tenant_brand_name FROM properties p LEFT JOIN tenant_brands t ON t.id = p.tenant_brand_id WHERE p.owner_id = ? ORDER BY p.id ASC LIMIT 1`).get(contact_id)
    }

    // Normalize line breaks to CRLF so they render as real lines (matches their template)
    const msg = resolveMergeFields(message, person, property).replace(/\r\n|\r|\n/g, '\r\n')
    const entity = isEntity(person)
    const toFirst = entity ? '' : (person.first_name || (person.name || '').split(' ')[0] || '')
    const toLast  = entity ? '' : (person.last_name  || (person.name || '').split(' ').slice(1).join(' ') || '')
    const toBusiness = entity ? person.name : ''

    rows.push([
      RET.first, RET.last, RET.business, RET.line1, RET.line2, RET.city, RET.state, RET.zip, RET.country,
      toFirst, toLast, toBusiness,
      person.address || '', '', person.city || '', person.state || '', person.zip || '', 'United States',
      msg, signOff, '', msg.length,
    ])
  }

  if (rows.length === 1) return res.status(400).json({ error: 'No mailable recipients (all missing addresses).' })

  const ws = XLSX.utils.aoa_to_sheet(rows)
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'Basic')
  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' })

  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
  res.setHeader('Content-Disposition', `attachment; filename="handwrytten-bulk-${new Date().toISOString().slice(0,10)}.xlsx"`)
  res.send(buf)
})

// ── Drip campaigns (throttled "X letters every N days") ──────────────────────

import { processDueDrips, nextRunIso } from '../services/dripEngine.js'

/** GET /api/handwrytten/drips — list with progress */
router.get('/drips', (_req, res) => {
  const rows = db.prepare(`
    SELECT d.*, u.name AS created_by_name,
      (SELECT COUNT(*) FROM handwrytten_drip_queue q WHERE q.drip_id = d.id AND q.status = 'queued') AS remaining
    FROM handwrytten_drips d
    LEFT JOIN users u ON u.id = d.created_by_user_id
    ORDER BY d.created_at DESC
  `).all()
  res.json(rows)
})

/** GET /api/handwrytten/drips/:id — single drip detail */
router.get('/drips/:id', (req, res) => {
  const drip = db.prepare(`SELECT * FROM handwrytten_drips WHERE id = ?`).get(req.params.id)
  if (!drip) return res.status(404).json({ error: 'Drip not found' })
  const remaining = db.prepare(`SELECT COUNT(*) AS n FROM handwrytten_drip_queue WHERE drip_id=? AND status='queued'`).get(drip.id).n
  res.json({ ...drip, remaining })
})

/**
 * POST /api/handwrytten/drips — create a drip and queue recipients.
 * Body: { name?, recipients:[{contact_id, property_id?}], message, card_id?, font?,
 *         batch_size, interval_days, filters? }
 * The first batch fires immediately; the rest are spaced by interval_days.
 * DNC contacts are filtered out server-side as a safety net.
 */
router.post('/drips', (req, res) => {
  const { name, recipients, message, card_id, font, batch_size, interval_days, filters } = req.body
  const userId = req.user?.id

  if (!Array.isArray(recipients) || recipients.length === 0) {
    return res.status(400).json({ error: 'recipients array is required' })
  }
  if (!message) return res.status(400).json({ error: 'message is required' })

  const batchN = Math.max(1, parseInt(batch_size, 10) || 50)
  const intervalN = Math.max(1, parseInt(interval_days, 10) || 1)

  // Filter out DNC contacts and de-dupe by contact_id (one letter per person).
  const seen = new Set()
  const clean = []
  for (const r of recipients) {
    const cid = Number(r.contact_id)
    if (!cid || seen.has(cid)) continue
    const person = db.prepare(`SELECT do_not_contact, mail_pause_until FROM people WHERE id = ?`).get(cid)
    const today = new Date().toISOString().slice(0, 10)
    if (!person || person.do_not_contact || (person.mail_pause_until && person.mail_pause_until >= today)) continue
    seen.add(cid)
    clean.push({ contact_id: cid, property_id: r.property_id || null })
  }

  if (clean.length === 0) {
    return res.status(400).json({ error: 'No eligible recipients after removing DNC and duplicates.' })
  }

  const create = db.transaction(() => {
    const dripRes = db.prepare(`
      INSERT INTO handwrytten_drips
        (name, message_template, card_id, font, filters, batch_size, interval_days,
         status, total_count, next_run_at, created_by_user_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'active', ?, datetime('now'), ?)
    `).run(
      name || null, message, card_id || null, font || null,
      filters ? JSON.stringify(filters) : null,
      batchN, intervalN, clean.length, userId || null,
    )
    const dripId = dripRes.lastInsertRowid
    const insQ = db.prepare(`
      INSERT INTO handwrytten_drip_queue (drip_id, contact_id, property_id, position, status)
      VALUES (?, ?, ?, ?, 'queued')
    `)
    clean.forEach((r, i) => insQ.run(dripId, r.contact_id, r.property_id, i))
    return dripId
  })

  const dripId = create()

  // Kick the first batch right away (async — don't block the response).
  processDueDrips().catch(err => console.error('[drip] initial tick error:', err.message))

  res.json({
    drip_id:       dripId,
    total:         clean.length,
    removed_dnc:   recipients.length - clean.length,
    batch_size:    batchN,
    interval_days: intervalN,
  })
})

/**
 * PATCH /api/handwrytten/drips/:id — pause / resume / edit batch+interval.
 * Body: { status?: 'active'|'paused', batch_size?, interval_days? }
 */
router.patch('/drips/:id', (req, res) => {
  const drip = db.prepare(`SELECT * FROM handwrytten_drips WHERE id = ?`).get(req.params.id)
  if (!drip) return res.status(404).json({ error: 'Drip not found' })
  if (drip.status === 'complete' || drip.status === 'cancelled') {
    return res.status(400).json({ error: `Drip is ${drip.status} and can't be modified.` })
  }

  const { status, batch_size, interval_days } = req.body
  const fields = []
  const params = []

  if (status === 'paused') { fields.push('status = ?'); params.push('paused') }
  if (status === 'active') {
    fields.push('status = ?'); params.push('active')
    // Resuming: make it due now so the next tick picks it up.
    fields.push('next_run_at = datetime(\'now\')')
  }
  if (batch_size != null)    { fields.push('batch_size = ?');    params.push(Math.max(1, parseInt(batch_size, 10) || drip.batch_size)) }
  if (interval_days != null) { fields.push('interval_days = ?'); params.push(Math.max(1, parseInt(interval_days, 10) || drip.interval_days)) }

  if (fields.length === 0) return res.status(400).json({ error: 'Nothing to update' })

  params.push(drip.id)
  db.prepare(`UPDATE handwrytten_drips SET ${fields.join(', ')} WHERE id = ?`).run(...params)

  if (status === 'active') processDueDrips().catch(() => {})

  res.json(db.prepare(`SELECT * FROM handwrytten_drips WHERE id = ?`).get(drip.id))
})

/** POST /api/handwrytten/drips/:id/cancel — stop and discard remaining queue */
router.post('/drips/:id/cancel', (req, res) => {
  const drip = db.prepare(`SELECT * FROM handwrytten_drips WHERE id = ?`).get(req.params.id)
  if (!drip) return res.status(404).json({ error: 'Drip not found' })
  db.prepare(`UPDATE handwrytten_drip_queue SET status='skipped', error_message='Campaign cancelled', processed_at=datetime('now') WHERE drip_id=? AND status='queued'`).run(drip.id)
  db.prepare(`UPDATE handwrytten_drips SET status='cancelled', next_run_at=NULL WHERE id=?`).run(drip.id)
  res.json({ cancelled: true })
})

export default router
