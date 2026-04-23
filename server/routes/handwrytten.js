import express from 'express'
import db from '../db.js'

const router  = express.Router()
const HW_BASE = 'https://api.handwrytten.com/v1'

// ── Handwrytten session cache ─────────────────────────────────────────────────
// The API uses a two-step flow: POST /user/login → session token, then pass
// that token on every subsequent call.  We cache it in memory and re-login
// whenever we receive a 440 (session timeout) or 401/403.

let _sessionToken  = null   // cached token string
let _sessionExpiry = 0      // unix ms — 0 means "unknown / treat as expired"

function creds() {
  return {
    email:    process.env.HANDWRYTTEN_EMAIL    || '',
    password: process.env.HANDWRYTTEN_PASSWORD || process.env.HANDWRYTTEN_API_KEY || '',
  }
}

/**
 * Login and cache the session token.
 * Logs the FULL response body so we can see the token format.
 */
async function hwLogin() {
  const { email, password } = creds()
  const body = new URLSearchParams({ login: email, password }).toString()

  console.log(`[Handwrytten] logging in as ${email}…`)

  const res  = await fetch('https://api.handwrytten.com/v1/user/login', {
    method:  'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Accept': 'application/json' },
    body,
  })
  const text = await res.text()

  // ── Log the full login response ──────────────────────────────────────────
  console.log(`[Handwrytten] /user/login → HTTP ${res.status}`)
  console.log(`[Handwrytten] /user/login response body:\n${text}`)

  if (!res.ok) {
    throw new Error(`Handwrytten login failed (${res.status}): ${text}`)
  }

  let data
  try { data = JSON.parse(text) } catch (_) {
    throw new Error(`Handwrytten login returned non-JSON: ${text}`)
  }

  // Extract token — try every common field name
  const token =
    data?.token        ||
    data?.access_token ||
    data?.session_token||
    data?.sessionToken ||
    data?.api_token    ||
    data?.data?.token  ||
    data?.data?.session_token ||
    null

  if (!token) {
    throw new Error(`Handwrytten login succeeded but no token found in response: ${JSON.stringify(data)}`)
  }

  console.log(`[Handwrytten] session token acquired (${String(token).slice(0, 12)}…)`)

  _sessionToken  = String(token)
  // Default TTL: 55 minutes (conservative — most APIs use 60 min)
  _sessionExpiry = Date.now() + 55 * 60 * 1000

  return _sessionToken
}

/**
 * Return a valid session token, logging in first if the cache is empty/expired.
 */
async function getToken() {
  if (_sessionToken && Date.now() < _sessionExpiry) return _sessionToken
  return hwLogin()
}

/** Invalidate the cached session (force re-login on next request). */
function invalidateSession() {
  _sessionToken  = null
  _sessionExpiry = 0
}

// ── Authenticated request helpers ─────────────────────────────────────────────

/**
 * GET from Handwrytten using the session token.
 * Automatically re-logs in and retries once on 440/401/403.
 */
async function hwGet(path) {
  const token = await getToken()
  const url   = `${HW_BASE}${path}`

  const res  = await fetch(url, {
    headers: {
      'Authorization': `Bearer ${token}`,
      'X-API-Token':   token,
      'Accept':        'application/json',
    },
  })
  const text = await res.text()
  console.log(`[Handwrytten] GET ${path} → ${res.status} | ${text.slice(0, 400)}`)

  // Session expired — invalidate, re-login, retry once
  if (res.status === 440 || res.status === 401 || res.status === 403) {
    console.log('[Handwrytten] session expired or unauthorised — re-logging in…')
    invalidateSession()
    const fresh = await getToken()
    const r2    = await fetch(url, {
      headers: {
        'Authorization': `Bearer ${fresh}`,
        'X-API-Token':   fresh,
        'Accept':        'application/json',
      },
    })
    const t2 = await r2.text()
    console.log(`[Handwrytten] GET ${path} (retry) → ${r2.status} | ${t2.slice(0, 400)}`)
    if (!r2.ok) throw new Error(`Handwrytten API ${r2.status}: ${t2}`)
    return JSON.parse(t2)
  }

  if (!res.ok) throw new Error(`Handwrytten API ${res.status}: ${text}`)
  return JSON.parse(text)
}

/**
 * POST to Handwrytten using the session token (form-encoded body).
 * Automatically re-logs in and retries once on 440/401/403.
 */
async function hwPost(path, params = {}) {
  async function attempt(token) {
    const body = new URLSearchParams({ token, ...params }).toString()
    const url  = `${HW_BASE}${path}`
    const res  = await fetch(url, {
      method:  'POST',
      headers: {
        'Content-Type':  'application/x-www-form-urlencoded',
        'Authorization': `Bearer ${token}`,
      },
      body,
    })
    const text = await res.text()
    console.log(`[Handwrytten] POST ${path} → ${res.status} | ${text.slice(0, 400)}`)
    return { res, text }
  }

  let token       = await getToken()
  let { res, text } = await attempt(token)

  // Session expired — invalidate, re-login, retry once
  if (res.status === 440 || res.status === 401 || res.status === 403) {
    console.log('[Handwrytten] session expired or unauthorised — re-logging in…')
    invalidateSession()
    token             = await getToken()
    ;({ res, text }   = await attempt(token))
  }

  if (!res.ok) throw new Error(`Handwrytten API ${res.status}: ${text}`)

  try { return JSON.parse(text) } catch (_) {
    throw new Error(`Handwrytten API returned non-JSON: ${text}`)
  }
}

// ── Merge field helpers ───────────────────────────────────────────────────────

function resolveMergeFields(template, person, property) {
  const first = person.first_name || (person.name || '').split(' ')[0] || ''
  const last  = person.last_name  || (person.name || '').split(' ').slice(1).join(' ') || ''
  return template
    .replace(/\{first_name\}/gi, first)
    .replace(/\{last_name\}/gi,  last)
    .replace(/\{full_name\}/gi,  person.name || '')
    .replace(/\{tenant\}/gi,     property?.tenant_brand_name || '')
    .replace(/\{city\}/gi,       property?.city  || '')
    .replace(/\{state\}/gi,      property?.state || '')
}

// ── Routes ────────────────────────────────────────────────────────────────────

/** GET /api/handwrytten/cards */
router.get('/cards', async (_req, res) => {
  try {
    const data = await hwGet('/cards')
    res.json(data)
  } catch (err) {
    console.error('[Handwrytten] /cards error:', err.message)
    res.status(502).json({ error: err.message })
  }
})

/** GET /api/handwrytten/fonts */
router.get('/fonts', async (_req, res) => {
  try {
    const data = await hwGet('/fonts')
    res.json(data)
  } catch (err) {
    console.error('[Handwrytten] /fonts error:', err.message)
    res.status(502).json({ error: err.message })
  }
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

/** GET /api/handwrytten/campaigns — campaign list */
router.get('/campaigns', (req, res) => {
  const { limit = 50, offset = 0 } = req.query

  const rows = db.prepare(`
    SELECT c.*,
      u.name AS sent_by_name
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
  const toFirstName = person.first_name || person.name.split(' ')[0] || ''
  const toLastName  = person.last_name  || person.name.split(' ').slice(1).join(' ') || ''

  try {
    const orderParams = {
      card_id:        card_id || '',
      font:           font    || '',
      message:        resolvedMessage,
      tofirstname:    toFirstName,
      tolastname:     toLastName,
      toaddress1:     person.address  || '',
      tocity:         person.city     || '',
      tostate:        person.state    || '',
      tozip:          person.zip      || '',
      tocountry:      'US',
      fromfirstname:  senderFirst,
      fromlastname:   senderLast,
    }

    const hwResult = await hwPost('/orders/create', orderParams)
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

    const resolvedMessage = resolveMergeFields(message, person, property)

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
        card_id:        card_id || '',
        font:           font    || '',
        message:        resolvedMessage,
        tofirstname:    toFirstName,
        tolastname:     toLastName,
        toaddress1:     person.address  || '',
        tocity:         person.city     || '',
        tostate:        person.state    || '',
        tozip:          person.zip      || '',
        tocountry:      'US',
        fromfirstname:  senderFirst,
        fromlastname:   senderLast,
      }

      const hwResult = await hwPost('/orders/create', orderParams)
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

export default router
