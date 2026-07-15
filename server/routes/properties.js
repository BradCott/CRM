import { Router } from 'express'
import db from '../db.js'
import { requireRole } from '../middleware/auth.js'
import { seedDefaultTasks } from './management.js'
import { normalizeAddr, tokenSearch } from '../utils/normalize.js'
import { searchDriveForProperty, fetchDriveFile } from '../services/driveSearch.js'

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
    op.name         AS operator_name,
    op.is_corporate AS operator_is_corporate,
    o.name       AS owner_name,
    o.first_name AS owner_first_name,
    o.phone      AS owner_phone,
    o.email      AS owner_email,
    o.do_not_contact AS owner_do_not_contact,
    o.mail_pause_until AS owner_mail_pause_until,
    o.owner_type AS owner_type,
    o.address    AS owner_address,
    o.city       AS owner_city,
    o.state      AS owner_state,
    o.zip        AS owner_zip
  FROM properties p
  LEFT JOIN tenant_brands t ON t.id = p.tenant_brand_id
  LEFT JOIN operators op ON op.id = p.operator_id
  LEFT JOIN people o ON o.id = p.owner_id
`

// Safe whitelist: column key → SQL expression for ORDER BY
const SORT_MAP = {
  address:        'p.address',
  tenant:         't.name',
  owner:          'o.name',
  owner_address:  'o.address',
  state:          'p.state',
  city:           'p.city',
  property_type:  'p.property_type',
  lease_type:     'p.lease_type',
  lease_start:    'p.lease_start',
  lease_end:      'p.lease_end',
  days_remaining: 'p.lease_end',
  cap_rate:       'CAST(p.cap_rate AS REAL)',
  noi:            'CAST(p.noi AS REAL)',
  annual_rent:    'CAST(p.annual_rent AS REAL)',
  list_price:     'CAST(p.list_price AS REAL)',
  building_size:  'CAST(p.building_size AS REAL)',
  year_built:     'CAST(p.year_built AS INTEGER)',
  date_added:     'p.created_at',
  last_updated:   'p.updated_at',
}

// Apply created_at / updated_at range filters from query params.
// Accepts addedAfter / addedBefore / updatedAfter / updatedBefore (YYYY-MM-DD).
// "Before" is treated as inclusive of the whole day.
function applyDateFilters(query, conditions, params) {
  const ranges = [
    ['addedAfter',    'p.created_at', '>='],
    ['addedBefore',   'p.created_at', '<'],
    ['updatedAfter',  'p.updated_at', '>='],
    ['updatedBefore', 'p.updated_at', '<'],
  ]
  for (const [key, col, op] of ranges) {
    const v = query[key]
    if (!v) continue
    if (op === '<') { conditions.push(`${col} < date(?, '+1 day')`); params.push(v) }
    else            { conditions.push(`${col} >= date(?)`);          params.push(v) }
  }
}

// Build the WHERE clause + params shared by the list and export endpoints.
function buildPropertyWhere(query) {
  const { search = '', tenant = '', state = '' } = query
  const conditions = []
  const params = []

  if (search) {
    const { clause, params: sp } = tokenSearch(['p.address', 'p.city', 'o.name', 't.name', 'p.notes'], search)
    if (clause) { conditions.push(clause); params.push(...sp) }
  }

  // Multi-value tenant filter (comma-separated) — falls back to legacy single param
  const tenantsRaw = query.tenants || tenant
  if (tenantsRaw) {
    const list = tenantsRaw.split(',').map(s => s.trim()).filter(Boolean)
    if (list.length === 1) {
      conditions.push(`t.name = ?`); params.push(list[0])
    } else if (list.length > 1) {
      conditions.push(`t.name IN (${list.map(() => '?').join(',')})`)
      params.push(...list)
    }
  }

  // Multi-value state filter (comma-separated) — falls back to legacy single param
  const statesRaw = query.states || state
  if (statesRaw) {
    const list = statesRaw.split(',').map(s => s.trim()).filter(Boolean)
    if (list.length === 1) {
      conditions.push(`p.state = ?`); params.push(list[0])
    } else if (list.length > 1) {
      conditions.push(`p.state IN (${list.map(() => '?').join(',')})`)
      params.push(...list)
    }
  }

  // Operator / franchisee filter (comma-separated names). Subquery keeps it join-free.
  if (query.operators) {
    const list = query.operators.split(',').map(s => s.trim()).filter(Boolean)
    if (list.length) {
      conditions.push(`p.operator_id IN (SELECT id FROM operators WHERE name IN (${list.map(() => '?').join(',')}))`)
      params.push(...list)
    }
  }

  if (query.needsReview === '1') conditions.push(`p.needs_ownership_review = 1`)

  if (query.portfolio !== undefined) {
    conditions.push(`p.is_portfolio = ?`)
    params.push(query.portfolio === '1' ? 1 : 0)
  }

  applyDateFilters(query, conditions, params)

  return { where: conditions.length ? `WHERE ${conditions.join(' AND ')}` : '', params }
}

// GET /api/properties?search=&tenants=CVS,Walgreens&states=TN,GA&needsReview=1&limit=50&offset=0&sortCol=address&sortDir=asc
router.get('/', (req, res) => {
  const { limit = 50, offset = 0, sortCol = 'address', sortDir = 'asc' } = req.query

  const { where, params } = buildPropertyWhere(req.query)

  const total = db.prepare(`
    SELECT COUNT(*) AS n FROM properties p
    LEFT JOIN tenant_brands t ON t.id = p.tenant_brand_id
    LEFT JOIN people o ON o.id = p.owner_id
    ${where}
  `).get(...params).n

  const sortExpr  = SORT_MAP[sortCol] || 'p.address'
  const direction = sortDir === 'desc' ? 'DESC' : 'ASC'
  // Put NULLs last for ascending, first for descending — keeps blank rows at the bottom
  const nullFirst = direction === 'ASC' ? 1 : 0
  const orderBy   = `ORDER BY CASE WHEN ${sortExpr} IS NULL THEN ${nullFirst} ELSE 0 END, ${sortExpr} ${direction}`

  const rows = db.prepare(`${BASE_SELECT} ${where} ${orderBy} LIMIT ? OFFSET ?`).all(...params, parseInt(limit), parseInt(offset))

  res.json({ total, rows })
})

// GET /api/properties/export — CSV of all rows matching the current filters (no limit)
router.get('/export', (req, res) => {
  const { sortCol = 'address', sortDir = 'asc' } = req.query
  const { where, params } = buildPropertyWhere(req.query)

  const sortExpr  = SORT_MAP[sortCol] || 'p.address'
  const direction = sortDir === 'desc' ? 'DESC' : 'ASC'
  const nullFirst = direction === 'ASC' ? 1 : 0
  const orderBy   = `ORDER BY CASE WHEN ${sortExpr} IS NULL THEN ${nullFirst} ELSE 0 END, ${sortExpr} ${direction}`

  const rows = db.prepare(`${BASE_SELECT} ${where} ${orderBy}`).all(...params)

  const esc = v => {
    if (v == null || v === '') return ''
    const s = String(v)
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }
  const d10 = v => (v ? String(v).slice(0, 10) : '')

  const headers = [
    'Tenant','Address','City','State','ZIP',
    'Owner Name','Owner Phone','Owner Email',
    'Owner Address','Owner City','Owner State','Owner ZIP','Do Not Contact',
    'Property Type','Lease Type','Lease Start','Lease End',
    'Annual Rent','Cap Rate (%)','NOI','List Price','Building Size (sf)','Year Built',
    'Date Added','Last Updated','Notes',
  ]
  const csvRows = rows.map(r => [
    r.tenant_brand_name, r.address, r.city, r.state, r.zip,
    r.owner_name, r.owner_phone, r.owner_email,
    r.owner_address, r.owner_city, r.owner_state, r.owner_zip, r.owner_do_not_contact ? 'Yes' : 'No',
    r.property_type, r.lease_type, r.lease_start, r.lease_end,
    r.annual_rent, r.cap_rate, r.noi, r.list_price, r.building_size, r.year_built,
    d10(r.created_at), d10(r.updated_at), r.notes,
  ].map(esc).join(','))

  const csv = [headers.join(','), ...csvRows].join('\n')
  const scope = req.query.portfolio === '1' ? 'portfolio' : 'properties'
  res.setHeader('Content-Type', 'text/csv')
  res.setHeader('Content-Disposition', `attachment; filename="${scope}-${new Date().toISOString().slice(0,10)}.csv"`)
  res.send(csv)
})

// Operator / franchisee breakdown for the current filter (tenant, state, search…).
// Returns per-operator property counts incl. an "Unspecified" bucket.
router.get('/operator-breakdown', (req, res) => {
  const { where, params } = buildPropertyWhere(req.query)
  const rows = db.prepare(`
    SELECT op.name AS operator_name, op.is_corporate AS is_corporate, COUNT(*) AS count
    FROM properties p
    LEFT JOIN tenant_brands t ON t.id = p.tenant_brand_id
    LEFT JOIN operators op ON op.id = p.operator_id
    LEFT JOIN people o ON o.id = p.owner_id
    ${where}
    GROUP BY p.operator_id
    ORDER BY (op.is_corporate = 1) DESC, count DESC
  `).all(...params)
  res.json(rows)
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

// GET /api/properties/check-duplicate?address=&city=&state=&zip=
router.get('/check-duplicate', (req, res) => {
  const { address = '', city = '', state = '', zip = '' } = req.query
  const addrKey = normalizeAddr(address, city, state, zip)
  if (!addrKey) return res.json({ exists: false })
  const row = db.prepare(
    `SELECT id, address, city, state FROM properties WHERE addr_key = ? LIMIT 1`
  ).get(addrKey)
  res.json(row ? { exists: true, property: row } : { exists: false })
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
        (address,city,state,zip,tenant_brand_id,operator_id,owner_id,building_size,land_area,
         year_built,property_type,construction_type,lease_type,lease_start,lease_end,
         annual_rent,rent_bumps,renewal_options,noi,cap_rate,list_price,taxes,insurance,
         roof_year,hvac_year,parking_lot,notes,sf_id,fee_pct,listing_status,fee_amount,
         purchase_price,dd_end_date,close_date,is_portfolio,needs_ownership_review,addr_key)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    `).run(
      f.address, f.city||null, f.state||null, f.zip||null,
      f.tenant_brand_id||null, f.operator_id||null, resolveOwner(f),
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
      f.needs_ownership_review ? 1 : 0,
      normalizeAddr(f.address, f.city, f.state, f.zip) || null
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
        address=?,city=?,state=?,zip=?,tenant_brand_id=?,operator_id=?,owner_id=?,
        building_size=?,land_area=?,year_built=?,property_type=?,construction_type=?,
        lease_type=?,lease_start=?,lease_end=?,annual_rent=?,rent_bumps=?,renewal_options=?,
        noi=?,cap_rate=?,list_price=?,taxes=?,insurance=?,
        roof_year=?,hvac_year=?,parking_lot=?,notes=?,sf_id=?,fee_pct=?,listing_status=?,fee_amount=?,
        purchase_price=?,dd_end_date=?,close_date=?,is_portfolio=?
      WHERE id=?
    `).run(
      f.address, f.city||null, f.state||null, f.zip||null,
      f.tenant_brand_id||null, f.operator_id||null, ownerId,
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

// PATCH /api/properties/:id/ownership-review — set or clear needs_ownership_review flag
router.patch('/:id/ownership-review', (req, res) => {
  const { needs_ownership_review } = req.body
  db.prepare(`UPDATE properties SET needs_ownership_review = ? WHERE id = ?`)
    .run(needs_ownership_review ? 1 : 0, req.params.id)
  const row = db.prepare(`${BASE_SELECT} WHERE p.id = ?`).get(req.params.id)
  res.json(row)
})

router.delete('/:id', (req, res) => {
  db.prepare('DELETE FROM properties WHERE id = ?').run(req.params.id)
  res.status(204).end()
})

// POST /api/properties/bulk-delete — { ids: [] }
router.post('/bulk-delete', (req, res) => {
  const ids = Array.isArray(req.body?.ids) ? req.body.ids.map(Number).filter(Boolean) : []
  if (!ids.length) return res.status(400).json({ error: 'ids array required' })
  const del = db.prepare('DELETE FROM properties WHERE id = ?')
  const run = db.transaction((arr) => { for (const id of arr) del.run(id) })
  run(ids)
  res.json({ deleted: ids.length })
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

// Search Google Drive for documents relevant to this property (address, tenant
// brand, store number). Used by the Find Docs button on the accounting +
// management pages.
router.get('/:id/drive-docs', async (req, res) => {
  try {
    const out = await searchDriveForProperty(req.params.id, { rematch: req.query.rematch === '1' })
    res.json(out)
  } catch (err) {
    console.error('[GET /api/properties/:id/drive-docs] error:', err.message)
    res.status(500).json({ error: err.message })
  }
})

// Stream a Drive file's bytes so the browser can feed it to the accounting
// importers (settlement / amortization / investor upload).
router.get('/drive-file/:fileId', async (req, res) => {
  try {
    const { buffer, name, mimeType } = await fetchDriveFile(req.params.fileId)
    res.setHeader('Content-Type', mimeType || 'application/octet-stream')
    res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(name)}"`)
    res.setHeader('X-Filename', encodeURIComponent(name))
    res.setHeader('Access-Control-Expose-Headers', 'X-Filename')
    res.send(buffer)
  } catch (err) {
    console.error('[GET /api/properties/drive-file/:fileId] error:', err.message)
    res.status(500).json({ error: err.message })
  }
})

export default router
