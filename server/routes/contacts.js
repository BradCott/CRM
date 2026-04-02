import { Router } from 'express'
import db from '../db.js'

const router = Router()

const SELECT = `
  SELECT c.*, o.name AS owner_name
  FROM contacts c
  LEFT JOIN owners o ON o.id = c.owner_id
`

router.get('/', (req, res) => {
  res.json(db.prepare(SELECT + ' ORDER BY c.last_name, c.first_name').all())
})

router.get('/:id', (req, res) => {
  const row = db.prepare(SELECT + ' WHERE c.id = ?').get(req.params.id)
  if (!row) return res.status(404).json({ error: 'Not found' })
  res.json(row)
})

router.post('/', (req, res) => {
  const { first_name, last_name, email, phone, owner_id, title, notes } = req.body
  if (!first_name) return res.status(400).json({ error: 'first_name is required' })
  const r = db.prepare(
    'INSERT INTO contacts (first_name,last_name,email,phone,owner_id,title,notes) VALUES (?,?,?,?,?,?,?)'
  ).run(first_name, last_name||null, email||null, phone||null, owner_id||null, title||null, notes||null)
  res.status(201).json(db.prepare(SELECT + ' WHERE c.id = ?').get(r.lastInsertRowid))
})

router.put('/:id', (req, res) => {
  const { first_name, last_name, email, phone, owner_id, title, notes } = req.body
  if (!first_name) return res.status(400).json({ error: 'first_name is required' })
  db.prepare(
    'UPDATE contacts SET first_name=?,last_name=?,email=?,phone=?,owner_id=?,title=?,notes=? WHERE id=?'
  ).run(first_name, last_name||null, email||null, phone||null, owner_id||null, title||null, notes||null, req.params.id)
  res.json(db.prepare(SELECT + ' WHERE c.id = ?').get(req.params.id))
})

router.delete('/:id', (req, res) => {
  db.prepare('DELETE FROM contacts WHERE id = ?').run(req.params.id)
  res.status(204).end()
})

export default router
