import { Router } from 'express'
import db from '../db.js'

const router = Router()

// GET /api/emails?person_id=X
router.get('/', (req, res) => {
  const { person_id } = req.query
  if (!person_id) return res.status(400).json({ error: 'person_id required' })

  const rows = db.prepare(`
    SELECT * FROM emails
    WHERE person_id = ?
    ORDER BY date DESC
    LIMIT 100
  `).all(Number(person_id))

  res.json(rows)
})

// POST /api/emails — manual log
router.post('/', (req, res) => {
  const { person_id, subject, body_preview, direction, date } = req.body
  if (!person_id) return res.status(400).json({ error: 'person_id required' })

  const result = db.prepare(`
    INSERT INTO emails (person_id, direction, subject, body_preview, date, is_manual)
    VALUES (?, ?, ?, ?, ?, 1)
  `).run(
    Number(person_id),
    direction || 'outbound',
    subject || '',
    body_preview || '',
    date || new Date().toISOString(),
  )

  res.status(201).json({ id: result.lastInsertRowid })
})

// POST /api/emails/log — Chrome extension endpoint: match contact by email address, then log
router.post('/log', (req, res) => {
  const { contact_email, subject, body_preview, direction, date, from_address, to_address } = req.body
  if (!contact_email) return res.status(400).json({ ok: false, error: 'contact_email required' })

  const addr = contact_email.toLowerCase().trim()
  const person = db.prepare(`
    SELECT id, name FROM people
    WHERE LOWER(TRIM(email)) = ? OR LOWER(TRIM(email2)) = ?
    LIMIT 1
  `).get(addr, addr)

  if (!person) {
    return res.json({ ok: false, error: `No contact found for ${contact_email}` })
  }

  db.prepare(`
    INSERT INTO emails (person_id, direction, subject, body_preview, from_address, to_address, date, is_manual)
    VALUES (?, ?, ?, ?, ?, ?, ?, 1)
  `).run(
    person.id,
    direction || 'inbound',
    subject || '',
    body_preview || '',
    from_address || '',
    to_address || '',
    date || new Date().toISOString(),
  )

  res.json({ ok: true, personId: person.id, personName: person.name })
})

// DELETE /api/emails/:id — only manual emails can be deleted
router.delete('/:id', (req, res) => {
  const result = db.prepare(`DELETE FROM emails WHERE id = ? AND is_manual = 1`).run(Number(req.params.id))
  if (result.changes === 0) return res.status(404).json({ error: 'Not found or not a manual email' })
  res.status(204).end()
})

export default router
