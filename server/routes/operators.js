import { Router } from 'express'
import db from '../db.js'

const router = Router()

// Operators / franchisees (Flynn, Sun Holdings, Corporate, …). Brand-agnostic —
// an operator can hold many brands. Sorted with Corporate first, then A–Z.
router.get('/', (req, res) => {
  res.json(db.prepare(`
    SELECT o.*, (SELECT COUNT(*) FROM properties p WHERE p.operator_id = o.id) AS property_count
    FROM operators o
    ORDER BY o.is_corporate DESC, o.name
  `).all())
})

router.post('/', (req, res) => {
  const name = (req.body?.name || '').trim()
  const is_corporate = req.body?.is_corporate ? 1 : 0
  if (!name) return res.status(400).json({ error: 'name is required' })
  const existing = db.prepare('SELECT * FROM operators WHERE LOWER(name) = LOWER(?)').get(name)
  if (existing) return res.json(existing)   // idempotent — reuse instead of erroring
  const r = db.prepare('INSERT INTO operators (name, is_corporate) VALUES (?, ?)').run(name, is_corporate)
  res.status(201).json(db.prepare('SELECT * FROM operators WHERE id = ?').get(r.lastInsertRowid))
})

router.put('/:id', (req, res) => {
  const name = (req.body?.name || '').trim()
  if (!name) return res.status(400).json({ error: 'name is required' })
  const is_corporate = req.body?.is_corporate ? 1 : 0
  db.prepare('UPDATE operators SET name = ?, is_corporate = ? WHERE id = ?').run(name, is_corporate, req.params.id)
  res.json(db.prepare('SELECT * FROM operators WHERE id = ?').get(req.params.id))
})

// Merge one or more operators INTO a target — reassigns their properties to the
// target, then deletes the merged operators. Used to clean up duplicates.
router.post('/merge', (req, res) => {
  const into = Number(req.body?.into)
  const from = (Array.isArray(req.body?.from) ? req.body.from : [])
    .map(Number).filter(id => id && id !== into)
  if (!into || !from.length) return res.status(400).json({ error: 'Pick operators to merge and a different target' })
  const target = db.prepare('SELECT * FROM operators WHERE id = ?').get(into)
  if (!target) return res.status(404).json({ error: 'Target operator not found' })

  const ph = from.map(() => '?').join(',')
  let reassigned = 0
  db.transaction(() => {
    const r = db.prepare(`UPDATE properties SET operator_id = ? WHERE operator_id IN (${ph})`).run(into, ...from)
    reassigned = r.changes
    db.prepare(`DELETE FROM operators WHERE id IN (${ph})`).run(...from)
  })()
  res.json({ ok: true, into: target, merged: from.length, reassigned })
})

router.delete('/:id', (req, res) => {
  db.prepare('DELETE FROM operators WHERE id = ?').run(req.params.id)   // properties.operator_id → SET NULL
  res.status(204).end()
})

export default router
