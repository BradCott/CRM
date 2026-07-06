import { Router } from 'express'
import db from '../db.js'

// Extensible list of tenant-contact job roles (Lease Admin, Estoppel, …).
// Read by everyone; writes are admin-gated at the mount point.
const router = Router()

router.get('/', (_req, res) => {
  res.json(db.prepare('SELECT id, label, sort FROM tenant_role_types WHERE active = 1 ORDER BY sort, label').all())
})

router.post('/', (req, res) => {
  const label = String(req.body?.label || '').trim()
  if (!label) return res.status(400).json({ error: 'label is required' })
  try {
    const maxSort = db.prepare('SELECT COALESCE(MAX(sort), 0) AS m FROM tenant_role_types').get().m
    const r = db.prepare('INSERT INTO tenant_role_types (label, sort) VALUES (?, ?)').run(label, maxSort + 1)
    res.status(201).json({ id: r.lastInsertRowid, label, sort: maxSort + 1 })
  } catch (err) {
    if (String(err.message).includes('UNIQUE')) {
      return res.status(409).json({ error: 'That role already exists' })
    }
    res.status(500).json({ error: err.message })
  }
})

router.patch('/:id', (req, res) => {
  const { label, sort, active } = req.body || {}
  const existing = db.prepare('SELECT * FROM tenant_role_types WHERE id = ?').get(req.params.id)
  if (!existing) return res.status(404).json({ error: 'Not found' })
  db.prepare('UPDATE tenant_role_types SET label = ?, sort = ?, active = ? WHERE id = ?').run(
    label != null ? String(label).trim() : existing.label,
    sort  != null ? Number(sort)         : existing.sort,
    active != null ? (active ? 1 : 0)    : existing.active,
    req.params.id,
  )
  res.json(db.prepare('SELECT id, label, sort, active FROM tenant_role_types WHERE id = ?').get(req.params.id))
})

// Soft-delete (deactivate) so existing contacts keep their stored role label.
router.delete('/:id', (req, res) => {
  db.prepare('UPDATE tenant_role_types SET active = 0 WHERE id = ?').run(req.params.id)
  res.status(204).end()
})

export default router
