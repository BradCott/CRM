import { Router } from 'express'
import db from '../db.js'

const router = Router()

const SELECT_ALL = `
  SELECT * FROM owners ORDER BY name
`

router.get('/', (req, res) => {
  res.json(db.prepare(SELECT_ALL).all())
})

router.get('/:id', (req, res) => {
  const row = db.prepare('SELECT * FROM owners WHERE id = ?').get(req.params.id)
  if (!row) return res.status(404).json({ error: 'Not found' })
  res.json(row)
})

router.post('/', (req, res) => {
  const { name, type = 'company', address, city, state, zip, phone, email, sf_id = null } = req.body
  if (!name) return res.status(400).json({ error: 'name is required' })
  const r = db.prepare(
    'INSERT INTO owners (name,type,address,city,state,zip,phone,email,sf_id) VALUES (?,?,?,?,?,?,?,?,?)'
  ).run(name, type, address || null, city || null, state || null, zip || null, phone || null, email || null, sf_id)
  res.status(201).json(db.prepare('SELECT * FROM owners WHERE id = ?').get(r.lastInsertRowid))
})

router.put('/:id', (req, res) => {
  const { name, type = 'company', address, city, state, zip, phone, email, sf_id = null } = req.body
  if (!name) return res.status(400).json({ error: 'name is required' })
  db.prepare(
    'UPDATE owners SET name=?,type=?,address=?,city=?,state=?,zip=?,phone=?,email=?,sf_id=? WHERE id=?'
  ).run(name, type, address || null, city || null, state || null, zip || null, phone || null, email || null, sf_id, req.params.id)
  res.json(db.prepare('SELECT * FROM owners WHERE id = ?').get(req.params.id))
})

router.delete('/:id', (req, res) => {
  db.prepare('DELETE FROM owners WHERE id = ?').run(req.params.id)
  res.status(204).end()
})

export default router
