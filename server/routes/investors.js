import { Router } from 'express'
import db from '../db.js'

const router = Router()

// ── helpers ──────────────────────────────────────────────────────────────────
function parseJson(val) {
  if (!val) return []
  try { return JSON.parse(val) } catch { return [] }
}

function toJson(val) {
  if (!val || (Array.isArray(val) && val.length === 0)) return null
  return JSON.stringify(val)
}

function hydrate(row) {
  if (!row) return row
  return {
    ...row,
    preferred_tenant_brands: parseJson(row.preferred_tenant_brands),
    preferred_states:        parseJson(row.preferred_states),
  }
}

// ── List ─────────────────────────────────────────────────────────────────────
router.get('/', (req, res) => {
  const { search = '', type = '', limit = 75, offset = 0 } = req.query
  const conditions = []
  const params = []

  if (search) {
    conditions.push(`(i.name LIKE ? OR i.email LIKE ? OR i.city LIKE ?)`)
    const like = `%${search}%`
    params.push(like, like, like)
  }
  if (type) {
    conditions.push(`i.type = ?`)
    params.push(type)
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''

  const total = db.prepare(`SELECT COUNT(*) as n FROM investors i ${where}`).get(...params).n

  const rows = db.prepare(`
    SELECT i.*
    FROM investors i
    ${where}
    ORDER BY i.name ASC
    LIMIT ? OFFSET ?
  `).all(...params, Number(limit), Number(offset))

  res.json({ total, rows: rows.map(hydrate) })
})

// ── Single ───────────────────────────────────────────────────────────────────
router.get('/:id', (req, res) => {
  const row = db.prepare(`SELECT * FROM investors WHERE id = ?`).get(req.params.id)
  if (!row) return res.status(404).json({ error: 'Not found' })
  res.json(hydrate(row))
})

// ── Create ───────────────────────────────────────────────────────────────────
router.post('/', (req, res) => {
  const {
    name, type, email, phone,
    address, city, state, zip,
    total_investments, preferred_tenant_brands, preferred_states,
    min_deal_size, max_deal_size, notes,
  } = req.body

  if (!name?.trim()) return res.status(400).json({ error: 'Name is required' })

  const result = db.prepare(`
    INSERT INTO investors
      (name, type, email, phone, address, city, state, zip,
       total_investments, preferred_tenant_brands, preferred_states,
       min_deal_size, max_deal_size, notes)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    name.trim(),
    type || 'individual',
    email || null, phone || null,
    address || null, city || null, state || null, zip || null,
    total_investments || null,
    toJson(preferred_tenant_brands),
    toJson(preferred_states),
    min_deal_size || null, max_deal_size || null,
    notes || null,
  )

  const row = db.prepare(`SELECT * FROM investors WHERE id = ?`).get(result.lastInsertRowid)
  res.status(201).json(hydrate(row))
})

// ── Update ───────────────────────────────────────────────────────────────────
router.put('/:id', (req, res) => {
  const {
    name, type, email, phone,
    address, city, state, zip,
    total_investments, preferred_tenant_brands, preferred_states,
    min_deal_size, max_deal_size, notes,
  } = req.body

  if (!name?.trim()) return res.status(400).json({ error: 'Name is required' })

  db.prepare(`
    UPDATE investors SET
      name = ?, type = ?, email = ?, phone = ?,
      address = ?, city = ?, state = ?, zip = ?,
      total_investments = ?, preferred_tenant_brands = ?, preferred_states = ?,
      min_deal_size = ?, max_deal_size = ?, notes = ?
    WHERE id = ?
  `).run(
    name.trim(),
    type || 'individual',
    email || null, phone || null,
    address || null, city || null, state || null, zip || null,
    total_investments || null,
    toJson(preferred_tenant_brands),
    toJson(preferred_states),
    min_deal_size || null, max_deal_size || null,
    notes || null,
    req.params.id,
  )

  const row = db.prepare(`SELECT * FROM investors WHERE id = ?`).get(req.params.id)
  if (!row) return res.status(404).json({ error: 'Not found' })
  res.json(hydrate(row))
})

// ── Delete ───────────────────────────────────────────────────────────────────
router.delete('/:id', (req, res) => {
  db.prepare(`DELETE FROM investors WHERE id = ?`).run(req.params.id)
  res.status(204).end()
})

export default router
