import { Router } from 'express'
import db from '../db.js'
import { requireRole } from '../middleware/auth.js'
import { seedDefaultTasks } from './management.js'

const router = Router()

// Resolve a free-text owner name to a people.id.
// If the name matches an existing person, returns their id.
// If not, inserts a minimal new person record and returns the new id.
// Returns null when name is blank.
function resolveOwner(f) {
  const name = (f.owner_name || '').toString().trim()
  if (!name) return f.owner_id ? parseInt(f.owner_id, 10) : null
  const existing = db.prepare('SELECT id FROM people WHERE name = ?').get(name)
  if (existing) return existing.id
  const r = db.prepare("INSERT INTO people (name, role) VALUES (?, 'owner')").run(name)
  return Number(r.lastInsertRowid)
}

const BASE_SELECT = `
  SELECT p.*,
    t.name AS tenant_brand_name,
    o.name       AS owner_name,
    o.first_name AS owner_first_name,
    o.phone      AS owner_phone,
    o.email      AS owner_email,
    o.do_not_contact AS owner_do_not_contact,
    o.owner_type AS owner_type,
    o.address    AS owner_address,
    o.city       AS owner_city,
    o.state      AS owner_state,
    o.zip        AS owner_zip
  FROM properties p
  LEFT JOIN tenant_brands t ON t.id = p.tenant_brand_id
  LEFT JOIN people o ON o.id = p.owner_id
`

// GET /api/properties?search=&tenant=&state=&limit=50&offset=0
router.get('/', (req, res) => {
  const {
    search = '',
    tenant = '',
    state = '',
    limit = 50,
    offset = 0,
  } = req.query

  const conditions = []
  const params = []

  if (search) {
    conditions.push(`(p.address LIKE ? OR p.city LIKE ? OR o.name LIKE ? OR t.name LIKE ?)`)
    const q = `%${search}%`
    params.push(q, q, q, q)
  }
  if (tenant)    { conditions.push(`t.name = ?`);          params.push(tenant) }
  if (state)     { conditions.push(`p.state = ?`);         params.push(state) }
  if (req.query.portfolio !== undefined) {
    conditions.push(`p.is_portfolio = ?`)
    params.push(req.query.portfolio === '1' ? 1 : 0)
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''

  const total = db.prepare(`
    SELECT COUNT(*) AS n FROM properties p
    LEFT JOIN tenant_brands t ON t.id = p.tenant_brand_id
    LEFT JOIN people o ON o.id = p.owner_id
    ${where}
  `).get(...params).n

  const rows = db.prepare(`${BASE_SELECT} ${where} ORDER BY p.address LIMIT ? OFFSET ?`).all(...params, parseInt(limit), parseInt(offset))

  res.json({ total, rows })
})

// Fee summary — total fees for listed/under_contract portfolio properties
router.get('/fee-summary', (req, res) => {
  const row = db.prepare(`
    SELECT
      COUNT(*) AS count_total,
      COUNT(CASE WHEN listing_status IN ('listed','under_contract') THEN 1 END) AS count_active,
      SUM(COALESCE(
        fee_amount,
        CASE WHEN purchase_price > 0 THEN purchase_price * 1.1 * 0.015 ELSE 0 END
      )) AS total_fees,
      SUM(CASE WHEN listing_status IN ('listed','under_contract')
               THEN COALESCE(fee_amount, CASE WHEN purchase_price > 0 THEN purchase_price * 1.1 * 0.015 ELSE 0 END)
               ELSE 0 END) AS active_fees
    FROM properties
    WHERE is_portfolio = 1
      AND (purchase_price > 0 OR fee_amount IS NOT NULL)
  `).get()
  res.json({
    total_fees:   row.total_fees   || 0,
    active_fees:  row.active_fees  || 0,
    count_active: row.count_active || 0,
    count_total:  row.count_total  || 0,
  })
})

// Lightweight list for deal dropdowns
router.get('/all', (req, res) => {
  res.json(db.prepare(`
    SELECT p.id, p.address, p.city, p.state, t.name AS tenant_brand_name
    FROM properties p
    LEFT JOIN tenant_brands t ON t.id = p.tenant_brand_id
    ORDER BY p.address
  `).all())
})

// Distinct states for filter dropdown
router.get('/states', (req, res) => {
  res.json(db.prepare(`SELECT DISTINCT state FROM properties WHERE state IS NOT NULL ORDER BY state`).all().map(r => r.state))
})

router.get('/:id', (req, res) => {
  const row = db.prepare(`
    SELECT p.*,
      t.name AS tenant_brand_name,
      o.name         AS owner_name,
      o.role         AS owner_role,
      o.first_name   AS owner_first_name,
      o.last_name    AS owner_last_name,
      o.phone        AS owner_phone,
      o.phone2       AS owner_phone2,
      o.mobile       AS owner_mobile,
      o.email        AS owner_email,
      o.email2       AS owner_email2,
      o.address      AS owner_address,
      o.city         AS owner_city,
      o.state        AS owner_state,
      o.zip          AS owner_zip,
      o.address2     AS owner_address2,
      o.city2        AS owner_city2,
      o.state2       AS owner_state2,
      o.zip2         AS owner_zip2,
      o.do_not_contact AS owner_do_not_contact,
      o.notes        AS owner_notes,
      o.sub_label    AS owner_sub_label
    FROM properties p
    LEFT JOIN tenant_brands t ON t.id = p.tenant_brand_id
    LEFT JOIN people o ON o.id = p.owner_id
    WHERE p.id = ?
  `).get(req.params.id)
  if (!row) return res.status(404).json({ error: 'Not found' })

  const deals = db.prepare(`SELECT * FROM deals WHERE property_id = ? ORDER BY id DESC`).all(req.params.id)
  res.json({ ...row, deals })
})

router.post('/', (req, res) => {
  const f = req.body
  console.log('[POST /api/properties] incoming body keys:', Object.keys(f))
  if (!f.address) return res.status(400).json({ error: 'address is required' })
  try {
    const r = db.prepare(`
      INSERT INTO properties
        (address,city,state,zip,tenant_brand_id,owner_id,building_size,land_area,
         year_built,property_type,construction_type,lease_type,lease_start,lease_end,
         annual_rent,rent_bumps,renewal_options,noi,cap_rate,list_price,taxes,insurance,
         roof_year,hvac_year,parking_lot,notes,sf_id,fee_pct,listing_status,fee_amount,
         purchase_price,dd_end_date,close_date,is_portfolio)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    `).run(
      f.address, f.city||null, f.state||null, f.zip||null,
      f.tenant_brand_id||null, resolveOwner(f),
      f.building_size||null, f.land_area||null, f.year_built||null,
      f.property_type||null, f.construction_type||null,
      f.lease_type||null, f.lease_start||null, f.lease_end||null,
      f.annual_rent||null, f.rent_bumps||null, f.renewal_options||null,
      f.noi||null, f.cap_rate||null, f.list_price||null,
      f.taxes||null, f.insurance||null,
      f.roof_year||null, f.hvac_year||null, f.parking_lot||null,
      f.notes||null, f.sf_id||null,
      f.fee_pct != null ? f.fee_pct : 2.0,
      f.listing_status||null,
      f.fee_amount != null ? f.fee_amount : null,
      f.purchase_price||null, f.dd_end_date||null, f.close_date||null,
      f.is_portfolio ? 1 : 0
    )
    console.log('[POST /api/properties] inserted rowid:', r.lastInsertRowid)
    // Seed default management tasks for portfolio properties
    if (f.is_portfolio) {
      try { seedDefaultTasks(r.lastInsertRowid) } catch (e) { console.warn('[POST /api/properties] seedDefaultTasks error:', e.message) }
    }
    const row = db.prepare(`${BASE_SELECT} WHERE p.id = ?`).get(r.lastInsertRowid)
    if (!row) {
      console.error('[POST /api/properties] row not found after insert, rowid:', r.lastInsertRowid)
      return res.status(500).json({ error: 'Property was saved but could not be retrieved' })
    }
    console.log('[POST /api/properties] returning property id:', row.id)
    res.status(201).json(row)
  } catch (err) {
    console.error('[POST /api/properties] SQL error:', err.message)
    res.status(500).json({ error: err.message || 'Failed to save property' })
  }
})

router.put('/:id', (req, res) => {
  const f = req.body
  const propId = parseInt(req.params.id, 10)
  console.log('[PUT /api/properties/:id] id:', propId, '| address:', f.address, '| owner_name:', f.owner_name)
  try {
    const ownerId = resolveOwner(f)
    console.log('[PUT /api/properties/:id] resolvedOwnerId:', ownerId)
    const result = db.prepare(`
      UPDATE properties SET
        address=?,city=?,state=?,zip=?,tenant_brand_id=?,owner_id=?,
        building_size=?,land_area=?,year_built=?,property_type=?,construction_type=?,
        lease_type=?,lease_start=?,lease_end=?,annual_rent=?,rent_bumps=?,renewal_options=?,
        noi=?,cap_rate=?,list_price=?,taxes=?,insurance=?,
        roof_year=?,hvac_year=?,parking_lot=?,notes=?,sf_id=?,fee_pct=?,listing_status=?,fee_amount=?,
        purchase_price=?,dd_end_date=?,close_date=?,is_portfolio=?
      WHERE id=?
    `).run(
      f.address, f.city||null, f.state||null, f.zip||null,
      f.tenant_brand_id||null, ownerId,
      f.building_size||null, f.land_area||null, f.year_built||null,
      f.property_type||null, f.construction_type||null,
      f.lease_type||null, f.lease_start||null, f.lease_end||null,
      f.annual_rent||null, f.rent_bumps||null, f.renewal_options||null,
      f.noi||null, f.cap_rate||null, f.list_price||null,
      f.taxes||null, f.insurance||null,
      f.roof_year||null, f.hvac_year||null, f.parking_lot||null,
      f.notes||null, f.sf_id||null,
      f.fee_pct != null ? f.fee_pct : 2.0,
      f.listing_status||null,
      f.fee_amount != null ? f.fee_amount : null,
      f.purchase_price||null, f.dd_end_date||null, f.close_date||null,
      f.is_portfolio ? 1 : 0,
      propId
    )
    console.log('[PUT /api/properties/:id] changes:', result.changes, '| lastInsertRowid:', result.lastInsertRowid)
    if (result.changes === 0) {
      console.warn('[PUT /api/properties/:id] WARNING: 0 rows updated — id not found?', propId)
      return res.status(404).json({ error: `Property ${propId} not found` })
    }
    const row = db.prepare(`${BASE_SELECT} WHERE p.id = ?`).get(propId)
    console.log('[PUT /api/properties/:id] returning row id:', row?.id, 'address:', row?.address)
    res.json(row)
  } catch (err) {
    console.error('[PUT /api/properties/:id] SQL error:', err.message)
    res.status(500).json({ error: err.message || 'Failed to update property' })
  }
})

// PATCH /api/properties/:id/portfolio — toggle portfolio flag
router.patch('/:id/portfolio', (req, res) => {
  const { is_portfolio } = req.body
  db.prepare(`UPDATE properties SET is_portfolio = ? WHERE id = ?`).run(is_portfolio ? 1 : 0, req.params.id)
  const row = db.prepare(`${BASE_SELECT} WHERE p.id = ?`).get(req.params.id)
  res.json(row)
})

router.delete('/:id', (req, res) => {
  db.prepare('DELETE FROM properties WHERE id = ?').run(req.params.id)
  res.status(204).end()
})

// POST /api/properties/:id/lease-data
// Cowork automation endpoint — admin only.
// Accepts a subset of lease fields and does a targeted UPDATE so that
// callers only need to send the fields they know about.
// Note: rent_per_sf is informational — it is not stored as a dedicated
// column but can be derived from annual_rent / building_size.
router.post('/:id/lease-data', requireRole('admin'), (req, res) => {
  const propId = parseInt(req.params.id, 10)
  const { tenant, lease_expiration, annual_rent, building_sf, cap_rate, lease_type, notes } = req.body

  const VALID_LEASE_TYPES = ['NNN', 'Gross', 'Modified Gross']
  if (lease_type != null && !VALID_LEASE_TYPES.includes(lease_type)) {
    return res.status(400).json({ error: `Invalid lease_type — must be one of: ${VALID_LEASE_TYPES.join(', ')}` })
  }

  try {
    if (!db.prepare('SELECT id FROM properties WHERE id = ?').get(propId)) {
      return res.status(404).json({ error: `Property ${propId} not found` })
    }

    const sets = []
    const vals = []

    // Resolve tenant name → tenant_brand_id (look up existing brand or create one)
    if (tenant != null) {
      const name = String(tenant).trim()
      let brandId = null
      if (name) {
        const brand = db.prepare('SELECT id FROM tenant_brands WHERE name = ?').get(name)
        brandId = brand
          ? brand.id
          : Number(db.prepare('INSERT INTO tenant_brands (name) VALUES (?)').run(name).lastInsertRowid)
      }
      sets.push('tenant_brand_id = ?'); vals.push(brandId)
    }

    // Direct column mappings — only include fields that were actually sent
    if (lease_expiration != null) { sets.push('lease_end = ?');     vals.push(lease_expiration) }
    if (annual_rent      != null) { sets.push('annual_rent = ?');   vals.push(Number(annual_rent)) }
    if (building_sf      != null) { sets.push('building_size = ?'); vals.push(Number(building_sf)) }
    if (cap_rate         != null) { sets.push('cap_rate = ?');      vals.push(Number(cap_rate)) }
    if (lease_type       != null) { sets.push('lease_type = ?');    vals.push(lease_type) }
    if (notes            != null) { sets.push('notes = ?');         vals.push(notes) }

    if (sets.length === 0) {
      return res.status(400).json({ error: 'No recognised fields provided' })
    }

    vals.push(propId)
    db.prepare(`UPDATE properties SET ${sets.join(', ')} WHERE id = ?`).run(...vals)

    res.json(db.prepare(`${BASE_SELECT} WHERE p.id = ?`).get(propId))
  } catch (err) {
    console.error('[POST /api/properties/:id/lease-data] error:', err.message)
    res.status(500).json({ error: err.message })
  }
})

export default router
