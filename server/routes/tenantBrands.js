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

// Merge duplicate brands into one: re-point every property + tenant contact from
// the merged brands onto the keeper, then delete the duplicates. Optionally
// rename the keeper (e.g. consolidate "Sherwin Williams" → "Sherwin-Williams").
router.post('/merge', (req, res) => {
  const keepId  = Number(req.body?.keep_id)
  const newName = typeof req.body?.name === 'string' && req.body.name.trim() ? req.body.name.trim() : null
  const mergeIds = Array.isArray(req.body?.merge_ids)
    ? [...new Set(req.body.merge_ids.map(Number).filter(Number.isInteger))].filter(id => id !== keepId)
    : []

  if (!Number.isInteger(keepId)) return res.status(400).json({ error: 'keep_id is required' })
  const keep = db.prepare('SELECT id, name FROM tenant_brands WHERE id = ?').get(keepId)
  if (!keep) return res.status(404).json({ error: 'Keeper brand not found' })
  if (!mergeIds.length) return res.status(400).json({ error: 'Provide merge_ids to fold into the keeper' })
  const ph = mergeIds.map(() => '?').join(',')
  const found = db.prepare(`SELECT id FROM tenant_brands WHERE id IN (${ph})`).all(...mergeIds)
  if (found.length !== mergeIds.length) return res.status(404).json({ error: 'One or more merge_ids not found' })

  const run = db.transaction(() => {
    db.prepare(`UPDATE properties SET tenant_brand_id = ? WHERE tenant_brand_id IN (${ph})`).run(keepId, ...mergeIds)
    db.prepare(`UPDATE people     SET tenant_brand_id = ? WHERE tenant_brand_id IN (${ph})`).run(keepId, ...mergeIds)
    db.prepare(`DELETE FROM tenant_brands WHERE id IN (${ph})`).run(...mergeIds)
    if (newName) db.prepare('UPDATE tenant_brands SET name = ? WHERE id = ?').run(newName, keepId)
  })
  run()

  res.json({ ok: true, keeper: db.prepare('SELECT id, name FROM tenant_brands WHERE id = ?').get(keepId), merged_count: mergeIds.length })
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
