// Global quick-search — one query across people, properties, and active deals,
// powering the dashboard search bar. Read-only; available to any signed-in user.
import { Router } from 'express'
import db from '../db.js'
import { tokenSearch } from '../utils/normalize.js'

const router = Router()
const LIMIT = 6

router.get('/', (req, res) => {
  const q = String(req.query.q || '').trim()
  if (q.length < 2) return res.json({ people: [], properties: [], deals: [] })

  const ppl = tokenSearch(['p.name', 'p.email', 'p.phone', 'p.city'], q)
  const people = db.prepare(`
    SELECT p.id, p.name, p.email, p.city, p.state, p.role
    FROM people p
    WHERE ${ppl.clause || '1=1'}
    ORDER BY (p.name LIKE ?) DESC, p.name
    LIMIT ${LIMIT}
  `).all(...ppl.params, `${q}%`)

  const prop = tokenSearch(['p.address', 'p.city', 'o.name', 't.name'], q)
  const properties = db.prepare(`
    SELECT p.id, p.address, p.city, p.state, p.is_portfolio, t.name AS tenant_brand_name
    FROM properties p
    LEFT JOIN people o        ON o.id = p.owner_id
    LEFT JOIN tenant_brands t ON t.id = p.tenant_brand_id
    WHERE ${prop.clause || '1=1'}
    ORDER BY (p.address LIKE ?) DESC, p.address
    LIMIT ${LIMIT}
  `).all(...prop.params, `${q}%`)

  const dl = tokenSearch(['d.address', 'd.title', 'd.tenant', 'p.address', 't.name'], q)
  const deals = db.prepare(`
    SELECT d.id, d.stage,
           COALESCE(d.address, p.address) AS address,
           COALESCE(d.tenant, t.name)     AS tenant,
           d.title
    FROM deals d
    LEFT JOIN properties p    ON p.id = d.property_id
    LEFT JOIN tenant_brands t ON t.id = p.tenant_brand_id
    WHERE (d.status IS NULL OR d.status = 'active') AND ${dl.clause || '1=1'}
    ORDER BY d.id DESC
    LIMIT ${LIMIT}
  `).all(...dl.params)

  res.json({ people, properties, deals })
})

export default router
