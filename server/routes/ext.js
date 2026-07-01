import { Router } from 'express'
import db from '../db.js'
import { normalizeName, nameSimilarity } from '../services/investorMatch.js'

// Endpoints for the Knox CRM Gmail browser extension.
// Auth is the shared x-crm-key header (requireExtKey), NOT the login cookie —
// the extension runs on mail.google.com and can't send our httpOnly cookie.
const router = Router()

// Pull a bare lowercase email out of "Jane Doe <jane@x.com>" or "jane@x.com".
function bareEmail(str = '') {
  const m = String(str).match(/<([^>]+)>/)
  return (m ? m[1] : String(str)).toLowerCase().trim()
}

const PERSON_COLS = 'id, name, email, email2, phone, mobile, role, city, state, company_id, do_not_contact'

// Token-aware name score: 1.0 when every word of the query appears in the
// candidate (so "Sara McGregor" fully matches "Sara Kenny McGregor"), otherwise
// falls back to fuzzy whole-string similarity. Handles middle names + word order.
function nameMatchScore(query, candidate) {
  const q = normalizeName(query).split(' ').filter(Boolean)
  const c = normalizeName(candidate).split(' ').filter(Boolean)
  if (!q.length || !c.length) return 0
  const cset = new Set(c)
  const overlap = q.filter(t => cset.has(t)).length
  return Math.max(overlap / q.length, nameSimilarity(query, candidate))
}

// GET /api/ext/lookup?email=&name=
// Is this sender already a known contact (matched by email)? If not, return
// fuzzy name-matched candidates so the user can attach the address to one.
router.get('/lookup', (req, res) => {
  const email = bareEmail(req.query.email || '')
  const name  = String(req.query.name || '').trim()

  let matched = null
  if (email) {
    matched = db.prepare(
      `SELECT ${PERSON_COLS} FROM people
       WHERE LOWER(TRIM(email)) = ? OR LOWER(TRIM(email2)) = ? LIMIT 1`
    ).get(email, email)
  }

  let candidates = []
  if (!matched && name) {
    const all = db.prepare(`SELECT ${PERSON_COLS} FROM people`).all()
    for (const p of all) {
      const score = nameMatchScore(name, p.name)
      if (score >= 0.6) candidates.push({ ...p, score: +score.toFixed(2) })
    }
    candidates.sort((a, b) => b.score - a.score)
    candidates = candidates.slice(0, 8)
  }

  res.json({ matched: matched || null, candidates, email, name })
})

// GET /api/ext/search?q= — manual contact search fallback for the panel.
router.get('/search', (req, res) => {
  const q = String(req.query.q || '').trim()
  if (!q) return res.json([])
  // Each word must match somewhere (name/email), so word order and middle names
  // don't matter: "Sara McGregor" finds "Sara Kenny McGregor".
  const toks = q.split(/\s+/).filter(Boolean).slice(0, 6)
  const conds = [], params = []
  for (const t of toks) {
    conds.push('(name LIKE ? OR email LIKE ? OR email2 LIKE ?)')
    const like = `%${t}%`
    params.push(like, like, like)
  }
  const rows = db.prepare(
    `SELECT ${PERSON_COLS} FROM people WHERE ${conds.join(' AND ')} ORDER BY name LIMIT 15`
  ).all(...params)
  res.json(rows)
})

// POST /api/ext/attach-email { person_id, email }
// Save a newly-discovered address onto a contact: fills `email`, then `email2`.
router.post('/attach-email', (req, res) => {
  const personId = Number(req.body?.person_id)
  const email    = bareEmail(req.body?.email || '')
  if (!personId || !email) {
    return res.status(400).json({ ok: false, error: 'person_id and email are required' })
  }

  const p = db.prepare('SELECT id, name, email, email2 FROM people WHERE id = ?').get(personId)
  if (!p) return res.status(404).json({ ok: false, error: 'Contact not found' })

  const existing = [p.email, p.email2].map(e => (e || '').toLowerCase().trim()).filter(Boolean)
  if (existing.includes(email)) {
    return res.json({ ok: true, personId: p.id, personName: p.name, slot: 'existing', already: true })
  }

  let slot
  if (!p.email || !p.email.trim()) {
    db.prepare('UPDATE people SET email = ? WHERE id = ?').run(email, personId)
    slot = 'email'
  } else if (!p.email2 || !p.email2.trim()) {
    db.prepare('UPDATE people SET email2 = ? WHERE id = ?').run(email, personId)
    slot = 'email2'
  } else {
    return res.json({ ok: false, error: `${p.name} already has two email addresses on file`, personName: p.name })
  }

  res.json({ ok: true, personId: p.id, personName: p.name, slot })
})

// POST /api/ext/attach-phone { person_id, phone }
// Save a phone number (pulled from the email) onto a contact: fills `phone`,
// then `mobile`. Stores the pretty-formatted string the extension sends.
router.post('/attach-phone', (req, res) => {
  const personId = Number(req.body?.person_id)
  const raw      = String(req.body?.phone || '').trim()
  const digits   = raw.replace(/\D/g, '')
  if (!personId || digits.length < 10) {
    return res.status(400).json({ ok: false, error: 'person_id and a valid phone are required' })
  }

  const p = db.prepare('SELECT id, name, phone, mobile FROM people WHERE id = ?').get(personId)
  if (!p) return res.status(404).json({ ok: false, error: 'Contact not found' })

  const norm = (s) => { let d = (s || '').replace(/\D/g, ''); if (d.length === 11 && d[0] === '1') d = d.slice(1); return d }
  const want = norm(raw)
  if ([p.phone, p.mobile].some(x => norm(x) === want && want)) {
    return res.json({ ok: true, personId: p.id, personName: p.name, slot: 'existing', already: true })
  }

  let slot
  if (!p.phone || !p.phone.trim()) {
    db.prepare('UPDATE people SET phone = ? WHERE id = ?').run(raw, personId)
    slot = 'phone'
  } else if (!p.mobile || !p.mobile.trim()) {
    db.prepare('UPDATE people SET mobile = ? WHERE id = ?').run(raw, personId)
    slot = 'mobile'
  } else {
    return res.json({ ok: false, error: `${p.name} already has a phone and mobile on file`, personName: p.name })
  }

  res.json({ ok: true, personId: p.id, personName: p.name, slot })
})

// POST /api/ext/log — log the email onto a contact.
// Accepts person_id (preferred) or contact_email. Deduped by Gmail message id
// (data-legacy-message-id matches the Gmail API id the background sync stores).
router.post('/log', (req, res) => {
  const b = req.body || {}

  let person = null
  if (b.person_id) person = db.prepare('SELECT id, name FROM people WHERE id = ?').get(Number(b.person_id))
  if (!person && b.contact_email) {
    const addr = bareEmail(b.contact_email)
    person = db.prepare(
      `SELECT id, name FROM people WHERE LOWER(TRIM(email)) = ? OR LOWER(TRIM(email2)) = ? LIMIT 1`
    ).get(addr, addr)
  }
  if (!person) return res.json({ ok: false, error: 'No matching contact — attach the email address first' })

  if (b.gmail_message_id) {
    const dup = db.prepare('SELECT id, person_id FROM emails WHERE gmail_message_id = ?').get(b.gmail_message_id)
    if (dup) return res.json({ ok: true, personId: person.id, personName: person.name, duplicate: true })
  }

  const direction = ['inbound', 'outbound', 'manual'].includes(b.direction) ? b.direction : 'inbound'

  try {
    db.prepare(`
      INSERT INTO emails
        (person_id, gmail_message_id, thread_id, direction, subject, body_preview, from_address, to_address, date, is_manual)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
    `).run(
      person.id,
      b.gmail_message_id || null,
      b.thread_id        || null,
      direction,
      b.subject          || '',
      b.body_preview     || '',
      b.from_address     || '',
      b.to_address       || '',
      b.date             || new Date().toISOString(),
    )
  } catch (err) {
    // UNIQUE(gmail_message_id) collision from a race — treat as already logged.
    if (String(err.message).includes('UNIQUE')) {
      return res.json({ ok: true, personId: person.id, personName: person.name, duplicate: true })
    }
    return res.status(500).json({ ok: false, error: err.message })
  }

  res.json({ ok: true, personId: person.id, personName: person.name })
})

export default router
