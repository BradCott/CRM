import { Router } from 'express'
import db from '../db.js'

const router = Router()

const SELECT = `
  SELECT
    d.id, d.property_id, d.stage, d.close_date, d.notes, d.title, d.source,
    d.due_diligence_days, d.dd_deadline, d.earnest_money,
    COALESCE(d.purchase_price, d.offer_price)  AS purchase_price,
    COALESCE(d.tenant, t.name)                 AS tenant,
    COALESCE(d.address, p.address)             AS address,
    COALESCE(d.city,    p.city)                AS city,
    COALESCE(d.state,   p.state)               AS state,
    COALESCE(d.cap_rate, p.cap_rate)           AS cap_rate,
    p.address    AS property_address,
    p.list_price AS property_list_price,
    p.lease_type, p.lease_end,
    t.name AS tenant_brand_name,
    o.name AS owner_name
  FROM deals d
  LEFT JOIN properties p ON p.id = d.property_id
  LEFT JOIN tenant_brands t ON t.id = p.tenant_brand_id
  LEFT JOIN people o ON o.id = p.owner_id
`

const toFloat = v => (v !== undefined && v !== null && v !== '') ? parseFloat(v) : null
const toInt   = v => (v !== undefined && v !== null && v !== '') ? parseInt(v, 10) : null
const toStr   = v => v || null

router.get('/', (req, res) => {
  res.json(db.prepare(SELECT + " WHERE (d.status IS NULL OR d.status = 'active') ORDER BY d.id DESC").all())
})

router.get('/dropped', (req, res) => {
  res.json(db.prepare(SELECT + " WHERE d.status = 'dropped' ORDER BY d.id DESC").all())
})

router.post('/:id/close', (req, res) => {
  console.log('[deals] POST /:id/close — id:', req.params.id)
  const deal = db.prepare(SELECT + ' WHERE d.id = ?').get(req.params.id)
  if (!deal) return res.status(404).json({ error: 'Not found' })

  if (deal.property_id) {
    console.log('[deals] closing — marking linked property', deal.property_id, 'as portfolio')
    db.prepare('UPDATE properties SET is_portfolio = 1 WHERE id = ?').run(deal.property_id)
  } else if (deal.address) {
    console.log('[deals] closing — creating portfolio property from deal address:', deal.address)
    db.prepare(`
      INSERT INTO properties (address, city, state, cap_rate, list_price, is_portfolio)
      VALUES (?, ?, ?, ?, ?, 1)
    `).run(deal.address, deal.city || null, deal.state || null, deal.cap_rate || null, deal.purchase_price || null)
  }

  db.prepare("UPDATE deals SET status = 'closed' WHERE id = ?").run(req.params.id)
  console.log('[deals] deal', req.params.id, 'marked closed')
  res.json({ ok: true })
})

router.post('/:id/drop', (req, res) => {
  console.log('[deals] POST /:id/drop — id:', req.params.id)
  db.prepare("UPDATE deals SET status = 'dropped' WHERE id = ?").run(req.params.id)
  console.log('[deals] deal', req.params.id, 'marked dropped')
  res.json({ ok: true })
})

router.post('/:id/restore', (req, res) => {
  db.prepare("UPDATE deals SET status = 'active' WHERE id = ?").run(req.params.id)
  res.json(db.prepare(SELECT + ' WHERE d.id = ?').get(req.params.id))
})

router.get('/:id', (req, res) => {
  const row = db.prepare(SELECT + ' WHERE d.id = ?').get(req.params.id)
  if (!row) return res.status(404).json({ error: 'Not found' })
  res.json(row)
})

router.post('/', (req, res) => {
  const { property_id, stage = 'loi', purchase_price, close_date, notes,
          address, city, state, tenant, cap_rate, due_diligence_days, dd_deadline, earnest_money } = req.body
  const r = db.prepare(`
    INSERT INTO deals (property_id, stage, purchase_price, close_date, notes,
                       address, city, state, tenant, cap_rate, due_diligence_days, dd_deadline, earnest_money)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)
  `).run(toStr(property_id), stage, toFloat(purchase_price), toStr(close_date), toStr(notes),
         toStr(address), toStr(city), toStr(state), toStr(tenant),
         toFloat(cap_rate), toInt(due_diligence_days), toStr(dd_deadline), toFloat(earnest_money))
  res.status(201).json(db.prepare(SELECT + ' WHERE d.id = ?').get(r.lastInsertRowid))
})

router.put('/:id', (req, res) => {
  const { property_id, stage = 'loi', purchase_price, close_date, notes,
          address, city, state, tenant, cap_rate, due_diligence_days, dd_deadline, earnest_money } = req.body
  db.prepare(`
    UPDATE deals SET property_id=?, stage=?, purchase_price=?, close_date=?, notes=?,
                     address=?, city=?, state=?, tenant=?, cap_rate=?, due_diligence_days=?, dd_deadline=?, earnest_money=?
    WHERE id=?
  `).run(toStr(property_id), stage, toFloat(purchase_price), toStr(close_date), toStr(notes),
         toStr(address), toStr(city), toStr(state), toStr(tenant),
         toFloat(cap_rate), toInt(due_diligence_days), toStr(dd_deadline), toFloat(earnest_money), req.params.id)
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
