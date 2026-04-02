import { Router } from 'express'
import db from '../db.js'

const router = Router()

const SELECT = `
  SELECT d.*,
    p.address AS property_address, p.city, p.state, p.zip,
    p.cap_rate, p.list_price AS property_list_price,
    p.lease_type, p.lease_end,
    t.name AS tenant_brand_name,
    o.name AS owner_name
  FROM deals d
  LEFT JOIN properties p ON p.id = d.property_id
  LEFT JOIN tenant_brands t ON t.id = p.tenant_brand_id
  LEFT JOIN people o ON o.id = p.owner_id
`

router.get('/', (req, res) => {
  res.json(db.prepare(SELECT + ' ORDER BY d.id DESC').all())
})

router.get('/:id', (req, res) => {
  const row = db.prepare(SELECT + ' WHERE d.id = ?').get(req.params.id)
  if (!row) return res.status(404).json({ error: 'Not found' })
  res.json(row)
})

router.post('/', (req, res) => {
  const { property_id, stage = 'lead', offer_price, close_date, notes } = req.body
  const r = db.prepare(
    'INSERT INTO deals (property_id,stage,offer_price,close_date,notes) VALUES (?,?,?,?,?)'
  ).run(property_id||null, stage, offer_price||null, close_date||null, notes||null)
  res.status(201).json(db.prepare(SELECT + ' WHERE d.id = ?').get(r.lastInsertRowid))
})

router.put('/:id', (req, res) => {
  const { property_id, stage = 'lead', offer_price, close_date, notes } = req.body
  db.prepare(
    'UPDATE deals SET property_id=?,stage=?,offer_price=?,close_date=?,notes=? WHERE id=?'
  ).run(property_id||null, stage, offer_price||null, close_date||null, notes||null, req.params.id)
  res.json(db.prepare(SELECT + ' WHERE d.id = ?').get(req.params.id))
})

router.patch('/:id/stage', (req, res) => {
  const { stage } = req.body
  if (!stage) return res.status(400).json({ error: 'stage is required' })
  db.prepare('UPDATE deals SET stage = ? WHERE id = ?').run(stage, req.params.id)
  res.json(db.prepare(SELECT + ' WHERE d.id = ?').get(req.params.id))
})

router.delete('/:id', (req, res) => {
  db.prepare('DELETE FROM deals WHERE id = ?').run(req.params.id)
  res.status(204).end()
})

export default router
