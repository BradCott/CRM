import { Router } from 'express'
import db from '../db.js'

const router = Router()

// Allowed sort columns (whitelist to prevent injection)
const SORT_COLS = {
  address:          'p.address',
  city:             'p.city',
  state:            'p.state',
  tenant_brand:     't.name',
  owner_name:       'o.name',
  year_built:       'p.year_built',
  year_purchased:   'p.year_purchased',
  lease_type:       'p.lease_type',
  lease_end:        'p.lease_end',
  cap_rate:         'p.cap_rate',
  noi:              'p.noi',
  list_price:       'p.list_price',
  annual_rent:      'p.annual_rent',
}

function buildWhere(q) {
  const conditions = []
  const params = []

  // Multi-value: tenants (comma-separated)
  if (q.tenants) {
    const list = q.tenants.split(',').map(s => s.trim()).filter(Boolean)
    if (list.length) {
      conditions.push(`t.name IN (${list.map(() => '?').join(',')})`)
      params.push(...list)
    }
  }

  // Multi-value: states
  if (q.states) {
    const list = q.states.split(',').map(s => s.trim()).filter(Boolean)
    if (list.length) {
      conditions.push(`p.state IN (${list.map(() => '?').join(',')})`)
      params.push(...list)
    }
  }

  // Year built range
  if (q.year_built_min) { conditions.push(`p.year_built >= ?`); params.push(parseInt(q.year_built_min)) }
  if (q.year_built_max) { conditions.push(`p.year_built <= ?`); params.push(parseInt(q.year_built_max)) }

  // Year purchased range
  if (q.year_purchased_min) { conditions.push(`p.year_purchased >= ?`); params.push(parseInt(q.year_purchased_min)) }
  if (q.year_purchased_max) { conditions.push(`p.year_purchased <= ?`); params.push(parseInt(q.year_purchased_max)) }

  // Owner type: 'person' = individual, 'company' = business
  if (q.owner_type === 'person') {
    conditions.push(`o.role = 'owner'`)
  } else if (q.owner_type === 'company') {
    conditions.push(`o.role = 'owner_company'`)
  }

  // DNC filter
  if (q.dnc === 'exclude') { conditions.push(`(o.do_not_contact = 0 OR o.do_not_contact IS NULL)`) }
  if (q.dnc === 'only')    { conditions.push(`o.do_not_contact = 1`) }

  // Has email
  if (q.has_email === '1') { conditions.push(`(o.email IS NOT NULL AND o.email != '')`) }

  // Free text search
  if (q.search) {
    conditions.push(`(p.address LIKE ? OR p.city LIKE ? OR o.name LIKE ?)`)
    const like = `%${q.search}%`
    params.push(like, like, like)
  }

  return { where: conditions.length ? `WHERE ${conditions.join(' AND ')}` : '', params }
}

const BASE_SELECT = `
  SELECT
    p.id,
    p.address, p.city, p.state, p.zip,
    p.year_built, p.year_purchased,
    p.building_size, p.land_area,
    p.lease_type, p.lease_start, p.lease_end,
    p.annual_rent, p.rent_bumps, p.renewal_options,
    p.cap_rate, p.noi, p.list_price, p.purchase_price,
    p.taxes, p.insurance,
    p.roof_year, p.hvac_year, p.parking_lot,
    p.notes AS property_notes,
    t.name  AS tenant_brand,
    o.id    AS owner_id,
    o.name  AS owner_name,
    o.role  AS owner_role,
    o.phone AS owner_phone,
    o.mobile AS owner_mobile,
    o.email AS owner_email,
    o.address AS owner_address,
    o.city  AS owner_city,
    o.state AS owner_state,
    o.zip   AS owner_zip,
    o.do_not_contact
  FROM properties p
  LEFT JOIN tenant_brands t ON t.id = p.tenant_brand_id
  LEFT JOIN people o ON o.id = p.owner_id
`

// GET /api/reports?tenants=CVS,AutoZone&states=FL,TX&...&sort=cap_rate&dir=desc&limit=75&offset=0
router.get('/', (req, res) => {
  const { where, params } = buildWhere(req.query)
  const sortCol = SORT_COLS[req.query.sort] || 'p.state'
  const sortDir = req.query.dir === 'asc' ? 'ASC' : 'DESC'
  const limit   = Math.min(parseInt(req.query.limit) || 75, 500)
  const offset  = parseInt(req.query.offset) || 0

  const total = db.prepare(`
    SELECT COUNT(*) AS n FROM properties p
    LEFT JOIN tenant_brands t ON t.id = p.tenant_brand_id
    LEFT JOIN people o ON o.id = p.owner_id
    ${where}
  `).get(...params).n

  const rows = db.prepare(
    `${BASE_SELECT} ${where} ORDER BY ${sortCol} ${sortDir} LIMIT ? OFFSET ?`
  ).all(...params, limit, offset)

  res.json({ total, rows })
})

// GET /api/reports/export — returns full CSV, no limit
router.get('/export', (req, res) => {
  const { where, params } = buildWhere(req.query)
  const sortCol = SORT_COLS[req.query.sort] || 'p.state'
  const sortDir = req.query.dir === 'asc' ? 'ASC' : 'DESC'

  const rows = db.prepare(
    `${BASE_SELECT} ${where} ORDER BY ${sortCol} ${sortDir}`
  ).all(...params)

  // Build CSV
  const headers = [
    'Tenant','Address','City','State','ZIP',
    'Owner Name','Owner Type','Owner Phone','Owner Mobile','Owner Email',
    'Owner Address','Owner City','Owner State','Owner ZIP',
    'Do Not Contact',
    'Year Built','Year Purchased','Building Size (sf)','Land (acres)',
    'Lease Type','Lease Start','Lease End','Annual Rent','Rent Bumps','Renewal Options',
    'Cap Rate (%)','NOI','List Price','Purchase Price','Taxes','Insurance',
    'Roof Year','HVAC Year','Parking Lot',
    'Property Notes',
  ]

  const ROLE_LABEL = { owner: 'Individual', owner_company: 'Company', broker: 'Broker', tenant_contact: 'Tenant Contact' }

  const esc = v => {
    if (v == null || v === '') return ''
    const s = String(v)
    return s.includes(',') || s.includes('"') || s.includes('\n')
      ? `"${s.replace(/"/g, '""')}"`
      : s
  }

  const csvRows = rows.map(r => [
    r.tenant_brand, r.address, r.city, r.state, r.zip,
    r.owner_name, ROLE_LABEL[r.owner_role] || r.owner_role,
    r.owner_phone, r.owner_mobile, r.owner_email,
    r.owner_address, r.owner_city, r.owner_state, r.owner_zip,
    r.do_not_contact ? 'Yes' : 'No',
    r.year_built, r.year_purchased, r.building_size, r.land_area,
    r.lease_type, r.lease_start, r.lease_end, r.annual_rent, r.rent_bumps, r.renewal_options,
    r.cap_rate, r.noi, r.list_price, r.purchase_price, r.taxes, r.insurance,
    r.roof_year, r.hvac_year, r.parking_lot,
    r.property_notes,
  ].map(esc).join(','))

  const csv = [headers.join(','), ...csvRows].join('\n')

  const filename = `crm-export-${new Date().toISOString().slice(0,10)}.csv`
  res.setHeader('Content-Type', 'text/csv')
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`)
  res.send(csv)
})

// GET /api/reports/filter-options — available tenants + states for dropdowns
router.get('/filter-options', (req, res) => {
  const tenants = db.prepare(`SELECT DISTINCT name FROM tenant_brands WHERE name IS NOT NULL ORDER BY name`).all().map(r => r.name)
  const states  = db.prepare(`SELECT DISTINCT state FROM properties WHERE state IS NOT NULL ORDER BY state`).all().map(r => r.state)
  const yearBuiltRange     = db.prepare(`SELECT MIN(year_built) as min, MAX(year_built) as max FROM properties WHERE year_built IS NOT NULL`).get()
  const yearPurchasedRange = db.prepare(`SELECT MIN(year_purchased) as min, MAX(year_purchased) as max FROM properties WHERE year_purchased IS NOT NULL`).get()
  res.json({ tenants, states, yearBuiltRange, yearPurchasedRange })
})

export default router
