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

const PERSON_COLS = 'id, name, email, email2, role, city, state, company_id, do_not_contact'

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
    const norm = normalizeName(name)
    const all  = db.prepare(`SELECT ${PERSON_COLS} FROM people`).all()
    for (const p of all) {
      const score = norm && normalizeName(p.name) === norm ? 1 : nameSimilarity(name, p.name)
      if (score >= 0.55) candidates.push({ ...p, score: +score.toFixed(2) })
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
  const like = `%${q}%`
  const rows = db.prepare(
    `SELECT ${PERSON_COLS} FROM people
     WHERE name LIKE ? OR email LIKE ? OR email2 LIKE ?
     ORDER BY name LIMIT 15`
  ).all(like, like, like)
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
