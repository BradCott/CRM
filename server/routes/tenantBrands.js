import { Router } from 'express'
import db from '../db.js'

const router = Router()

router.get('/', (req, res) => {
  res.json(db.prepare('SELECT * FROM tenant_brands ORDER BY name').all())
})

router.get('/:id', (req, res) => {
  const row = db.prepare('SELECT * FROM tenant_brands WHERE id = ?').get(req.params.id)
  if (!row) return res.status(404).json({ error: 'Not found' })
  res.json(row)
})

router.post('/', (req, res) => {
  const { name, sf_id = null } = req.body
  if (!name) return res.status(400).json({ error: 'name is required' })
  const r = db.prepare('INSERT INTO tenant_brands (name, sf_id) VALUES (?, ?)').run(name, sf_id)
  res.status(201).json({ id: r.lastInsertRowid, name, sf_id })
})

router.put('/:id', (req, res) => {
  const { name, sf_id = null } = req.body
  if (!name) return res.status(400).json({ error: 'name is required' })
  db.prepare('UPDATE tenant_brands SET name = ?, sf_id = ? WHERE id = ?').run(name, sf_id, req.params.id)
  res.json(db.prepare('SELECT * FROM tenant_brands WHERE id = ?').get(req.params.id))
})

router.delete('/:id', (req, res) => {
  db.prepare('DELETE FROM tenant_brands WHERE id = ?').run(req.params.id)
  res.status(204).end()
})

export default router
