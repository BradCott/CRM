import { Router } from 'express'
import nodemailer from 'nodemailer'
import db from '../db.js'
import { requireRole } from '../middleware/auth.js'
import { seedDefaultTasks } from './management.js'
import { normalizeAddr, tokenSearch } from '../utils/normalize.js'
import { searchDriveForProperty, searchDriveDocs, fetchDriveFile } from '../services/driveSearch.js'
import { sendMail } from '../services/mailer.js'

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

// Displayed cap rate = the actual going-in cap on our basis: NOI ÷ what we
// actually paid (purchase price), rounded to 2 decimals. Falls back to the
// stored (OM / asking) cap rate until we have BOTH a purchase price and an NOI.
// The original stored value stays available as `stated_cap_rate`.
const CAP_RATE_EXPR = `CASE
    WHEN CAST(p.noi AS REAL) > 0 AND CAST(p.purchase_price AS REAL) > 0
    THEN ROUND(CAST(p.noi AS REAL) * 100.0 / CAST(p.purchase_price AS REAL), 2)
    ELSE p.cap_rate END`
// Emitted right after p.* so the derived `cap_rate` alias overrides the raw column.
const CAP_RATE_COLS = `p.cap_rate AS stated_cap_rate, ${CAP_RATE_EXPR} AS cap_rate`

const BASE_SELECT = `
  SELECT p.*,
    ${CAP_RATE_COLS},
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

// Full single-property shape: BASE_SELECT (incl. operator + tenant + derived cap
// rate) plus the extra owner columns the detail panel's Owner section needs. Used
// for every single-row response (GET /:id and the inline PATCH endpoints) so the
// panel's `data` always has a complete, stable shape after any edit.
const FULL_PROPERTY_SELECT = BASE_SELECT.replace(
  'FROM properties p',
  `, o.role      AS owner_role,
    o.last_name  AS owner_last_name,
    o.phone2     AS owner_phone2,
    o.mobile     AS owner_mobile,
    o.email2     AS owner_email2,
    o.address2   AS owner_address2,
    o.city2      AS owner_city2,
    o.state2     AS owner_state2,
    o.zip2       AS owner_zip2,
    o.notes      AS owner_notes,
    o.sub_label  AS owner_sub_label
  FROM properties p`)

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
  cap_rate:       CAP_RATE_EXPR,
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

  if (query.remailReady === '1') conditions.push(`p.remail_ready = 1`)

  if (query.portfolio !== undefined) {
    conditions.push(`p.is_portfolio = ?`)
    params.push(query.portfolio === '1' ? 1 : 0)
  }

  // Sold/historical filter. '1' = only sold; '0' = exclude sold (active only).
  if (query.sold === '1') {
    conditions.push(`p.listing_status = 'sold'`)
  } else if (query.sold === '0') {
    conditions.push(`(p.listing_status IS NULL OR p.listing_status <> 'sold')`)
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

// Whole completed months between two YYYY-MM-DD dates.
function monthsBetween(a, b) {
  if (!a || !b) return null
  const d1 = new Date(String(a).slice(0, 10) + 'T00:00:00Z')
  const d2 = new Date(String(b).slice(0, 10) + 'T00:00:00Z')
  if (isNaN(d1) || isNaN(d2)) return null
  let m = (d2.getUTCFullYear() - d1.getUTCFullYear()) * 12 + (d2.getUTCMonth() - d1.getUTCMonth())
  if (d2.getUTCDate() < d1.getUTCDate()) m--
  return Math.max(0, m)
}

// XIRR via Newton's method. flows: [{ date, amount }] (negatives = money out).
// Returns an annualized rate, or null if it can't be computed.
function xirr(flows) {
  const cf = (flows || [])
    .filter(f => f.date && isFinite(f.amount) && f.amount !== 0)
    .map(f => ({ t: new Date(String(f.date).slice(0, 10) + 'T00:00:00Z').getTime(), a: f.amount }))
    .filter(f => isFinite(f.t))
    .sort((x, y) => x.t - y.t)
  if (cf.length < 2 || !cf.some(f => f.a < 0) || !cf.some(f => f.a > 0)) return null
  const t0 = cf[0].t
  const yrs = f => (f.t - t0) / (365 * 24 * 3600 * 1000)
  const npv = r => cf.reduce((s, f) => s + f.a / Math.pow(1 + r, yrs(f)), 0)
  let r = 0.1
  for (let i = 0; i < 100; i++) {
    const f0 = npv(r), d = (npv(r + 1e-6) - f0) / 1e-6
    if (!isFinite(d) || Math.abs(d) < 1e-12) break
    let rn = r - f0 / d
    if (!isFinite(rn)) break
    if (rn <= -0.9999) rn = -0.9999
    if (Math.abs(rn - r) < 1e-7) { r = rn; break }
    r = rn
  }
  return (isFinite(r) && Math.abs(npv(r)) < 1) ? r : null
}

// GET /api/properties/historical — sold deals with computed returns.
router.get('/historical', (_req, res) => {
  const props = db.prepare(`${BASE_SELECT} WHERE p.listing_status = 'sold' ORDER BY (p.sold_date IS NULL), p.sold_date DESC, p.id DESC`).all()
  const saleTx    = db.prepare(`SELECT amount FROM accounting_transactions WHERE property_id = ? AND source = 'Sale' AND description = 'Sale Proceeds' ORDER BY id DESC LIMIT 1`)
  const distStmt  = db.prepare(`SELECT amount, distribution_type AS type, distribution_date AS date FROM investor_distributions WHERE property_id = ?`)
  const investedStmt = db.prepare(`SELECT COALESCE(SUM(contribution), 0) AS s FROM property_investors WHERE property_id = ?`)

  const out = props.map(p => {
    const buy  = p.purchase_price != null ? Number(p.purchase_price) : null
    const sell = p.sale_price != null ? Number(p.sale_price) : (saleTx.get(p.id)?.amount ?? null)
    const dists = distStmt.all(p.id)
    const sumType = (t) => dists.filter(d => !t || d.type === t).reduce((s, d) => s + (Number(d.amount) || 0), 0)
    const roc = sumType('Principal'), profit = sumType('Profit')
    const derivedPref = sumType('Preferred Return')
    const derivedDist = sumType()
    const derivedInvested = Number(investedStmt.get(p.id).s) || 0
    const knox_fee = p.fee_amount != null ? Number(p.fee_amount) : null
    const derivedSponsor = (dists.length || knox_fee != null) ? (knox_fee || 0) + profit : null
    const derivedIrr = derivedInvested > 0
      ? xirr([{ date: p.close_date, amount: -derivedInvested }, ...dists.map(d => ({ date: d.date, amount: Number(d.amount) || 0 }))])
      : null

    // Manual entry (hist_*) wins over derived, so pre-CRM / non-closed-out deals
    // still show complete numbers.
    const numOr = (m, d) => (m != null ? Number(m) : d)
    const invested        = numOr(p.hist_invested, derivedInvested)
    const total_distributed = numOr(p.hist_returned, derivedDist)
    const pref            = numOr(p.hist_pref, derivedPref)
    const sponsor_gain    = p.hist_sponsor_gain != null ? Number(p.hist_sponsor_gain) : derivedSponsor
    const irr             = p.hist_irr != null ? Number(p.hist_irr) : derivedIrr

    const hold_months = monthsBetween(p.close_date, p.sold_date)
    const emx = invested > 0 ? total_distributed / invested : null
    const gain = (sell != null && buy != null) ? sell - buy : null
    const investor_gain = invested > 0 ? total_distributed - invested : null
    return {
      id: p.id, address: p.address, city: p.city, state: p.state,
      tenant_brand_name: p.tenant_brand_name, operator_name: p.operator_name,
      close_date: p.close_date, sold_date: p.sold_date, hold_months,
      buy, sell, gain, split: p.hist_split || null,
      invested, total_distributed, roc, pref, profit,
      investor_gain, emx, irr, knox_fee, sponsor_gain,
      // has_returns: does it have any returns figures to show (derived or manual)?
      has_returns: invested > 0 || dists.length > 0 || p.hist_returned != null,
      manual: p.hist_invested != null || p.hist_returned != null || p.hist_irr != null,
    }
  })
  res.json(out)
})

router.get('/:id', (req, res) => {
  const row = db.prepare(`${FULL_PROPERTY_SELECT} WHERE p.id = ?`).get(req.params.id)
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
        purchase_price=?,dd_end_date=?,close_date=?,is_portfolio=?,
        display_name=COALESCE(?, display_name)
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
      f.display_name !== undefined ? (String(f.display_name).trim() || null) : null,
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

// Columns editable one-at-a-time via inline click-to-edit in the detail panel,
// mapped to a coercion type. Deliberately excludes derived/relational/auto
// columns (cap_rate is derived from NOI÷purchase price; fee is auto; tenant/
// operator/owner are relational; timestamps/geo/drive are system-managed).
const EDITABLE_FIELDS = {
  address:'text', city:'text', state:'text', zip:'text',
  property_type:'text', construction_type:'text',
  building_size:'real', land_area:'real', year_built:'int', year_purchased:'int',
  lease_type:'text', lease_start:'date', lease_end:'date',
  annual_rent:'real', rent_bumps:'text', renewal_options:'text',
  noi:'real', list_price:'real', purchase_price:'real', estimated_value:'real',
  expense:'real', taxes:'real', insurance:'real',
  roof_year:'int', hvac_year:'int', parking_lot:'text',
  bank:'text', interest_rate:'real', maturity_date:'date', outstanding_debt:'real',
  total_debt_pmt:'real', interest_pmt:'real', principal_pmt:'real', rtd_ratio:'real',
  ins_broker:'text', policy_number:'text', account_number:'text', insurance_exp:'date',
  store_number:'text', qb_account:'text', store_manager:'text', district_manager:'text',
  notes:'text',
}

function coerceField(type, raw) {
  if (raw == null) return null
  if (type === 'text' || type === 'date') { const s = String(raw).trim(); return s || null }
  if (type === 'int')  { const n = parseInt(String(raw).replace(/[^0-9.\-]/g, ''), 10); return Number.isFinite(n) ? n : null }
  const n = parseFloat(String(raw).replace(/[^0-9.\-]/g, '')) // 'real'
  return Number.isFinite(n) ? n : null
}

// PATCH /api/properties/:id/field  body: { column, value } — update a single
// whitelisted column. Only touches the one column, so it never clobbers other
// fields (e.g. values just auto-filled from an OM / settlement statement).
router.patch('/:id/field', (req, res) => {
  const propId = parseInt(req.params.id, 10)
  const { column, value } = req.body || {}
  const type = EDITABLE_FIELDS[column]
  if (!type) return res.status(400).json({ error: `Field "${column}" is not editable` })
  try {
    const coerced = coerceField(type, value)
    const result = db.prepare(`UPDATE properties SET ${column} = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`).run(coerced, propId)
    if (result.changes === 0) return res.status(404).json({ error: `Property ${propId} not found` })
    const row = db.prepare(`${FULL_PROPERTY_SELECT} WHERE p.id = ?`).get(propId)
    res.json(row)
  } catch (err) {
    console.error('[PATCH /api/properties/:id/field] SQL error:', err.message)
    res.status(500).json({ error: err.message || 'Failed to update field' })
  }
})

// Relational inline edits: link the property to a tenant brand, operator, or
// owner (people) record. Pass `id` to select an existing record, `name` to
// find-or-create by name, or neither/blank to clear the link.
const RELATION_MAP = {
  tenant:   { column: 'tenant_brand_id', table: 'tenant_brands', insert: name => db.prepare('INSERT INTO tenant_brands (name) VALUES (?)').run(name) },
  operator: { column: 'operator_id',     table: 'operators',     insert: name => db.prepare('INSERT INTO operators (name) VALUES (?)').run(name) },
  owner:    { column: 'owner_id',        table: 'people',        insert: name => db.prepare("INSERT INTO people (name, role) VALUES (?, 'owner')").run(name) },
}

// PATCH /api/properties/:id/relation  body: { relation, id?, name? }
router.patch('/:id/relation', (req, res) => {
  const propId = parseInt(req.params.id, 10)
  const { relation, id, name } = req.body || {}
  const cfg = RELATION_MAP[relation]
  if (!cfg) return res.status(400).json({ error: `Unknown relation "${relation}"` })
  try {
    let fkId = null
    if (id != null && id !== '') {
      fkId = parseInt(id, 10)
      if (!Number.isFinite(fkId)) return res.status(400).json({ error: 'Invalid id' })
    } else {
      const nm = String(name ?? '').trim()
      if (nm) {
        const existing = db.prepare(`SELECT id FROM ${cfg.table} WHERE name = ? COLLATE NOCASE`).get(nm)
        fkId = existing ? existing.id : Number(cfg.insert(nm).lastInsertRowid)
      }
    }
    const result = db.prepare(`UPDATE properties SET ${cfg.column} = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`).run(fkId, propId)
    if (result.changes === 0) return res.status(404).json({ error: `Property ${propId} not found` })
    const row = db.prepare(`${FULL_PROPERTY_SELECT} WHERE p.id = ?`).get(propId)
    res.json(row)
  } catch (err) {
    console.error('[PATCH /api/properties/:id/relation] SQL error:', err.message)
    res.status(500).json({ error: err.message || 'Failed to update relation' })
  }
})

// PATCH /api/properties/:id/portfolio — toggle portfolio flag
router.patch('/:id/portfolio', (req, res) => {
  const { is_portfolio } = req.body
  db.prepare(`UPDATE properties SET is_portfolio = ? WHERE id = ?`).run(is_portfolio ? 1 : 0, req.params.id)
  const row = db.prepare(`${BASE_SELECT} WHERE p.id = ?`).get(req.params.id)
  res.json(row)
})

// Map the historical returns form fields → property columns (+ value coercion).
// irr comes in as a percent (18) and is stored as a decimal (0.18).
function applyHistoricalFields(b) {
  const num = v => (v === '' || v == null) ? null : (isFinite(Number(v)) ? Number(v) : null)
  const MAP = {
    purchase_price: ['purchase_price', num], sale_price: ['sale_price', num],
    close_date: ['close_date', v => v || null], sold_date: ['sold_date', v => v || null],
    invested: ['hist_invested', num], returned: ['hist_returned', num],
    pref: ['hist_pref', num], sponsor_gain: ['hist_sponsor_gain', num],
    irr: ['hist_irr', v => { const n = num(v); return n == null ? null : n / 100 }],
    split: ['hist_split', v => (v == null || v === '') ? null : String(v).slice(0, 60)],
  }
  const cols = {}
  for (const [key, [col, coerce]] of Object.entries(MAP)) {
    if (key in b) cols[col] = coerce(b[key])
  }
  return cols
}

// PATCH /api/properties/:id/historical — edit a sold deal's returns (buy/sell/
// dates + manual invested/returned/pref/sponsor/irr/split).
router.patch('/:id/historical', (req, res) => {
  if (!db.prepare('SELECT id FROM properties WHERE id = ?').get(req.params.id)) return res.status(404).json({ error: 'Property not found' })
  const cols = applyHistoricalFields(req.body || {})
  const keys = Object.keys(cols)
  if (keys.length) {
    db.prepare(`UPDATE properties SET ${keys.map(k => `${k} = ?`).join(', ')} WHERE id = ?`).run(...keys.map(k => cols[k]), req.params.id)
  }
  res.json(db.prepare(`${BASE_SELECT} WHERE p.id = ?`).get(req.params.id))
})

// POST /api/properties/historical — create a historical-only (sold) record for a
// pre-CRM deal. Minimal: address required; tenant name find-or-creates the brand.
router.post('/historical', (req, res) => {
  const b = req.body || {}
  const address = String(b.address || '').trim()
  if (!address) return res.status(400).json({ error: 'address is required' })

  let tenant_brand_id = null
  const tName = String(b.tenant || '').trim()
  if (tName) {
    const found = db.prepare('SELECT id FROM tenant_brands WHERE name = ?').get(tName)
    tenant_brand_id = found ? found.id : db.prepare('INSERT INTO tenant_brands (name) VALUES (?)').run(tName).lastInsertRowid
  }

  const r = db.prepare(`
    INSERT INTO properties (address, city, state, tenant_brand_id, listing_status, is_portfolio, addr_key)
    VALUES (?, ?, ?, ?, 'sold', 0, ?)
  `).run(address, b.city || null, b.state || null, tenant_brand_id,
         normalizeAddr(address, b.city || '', b.state || '', b.zip || '') || null)
  const id = r.lastInsertRowid

  const cols = applyHistoricalFields(b)
  const keys = Object.keys(cols)
  if (keys.length) {
    db.prepare(`UPDATE properties SET ${keys.map(k => `${k} = ?`).join(', ')} WHERE id = ?`).run(...keys.map(k => cols[k]), id)
  }
  res.status(201).json(db.prepare(`${BASE_SELECT} WHERE p.id = ?`).get(id))
})

// PATCH /api/properties/:id/sold — quick "mark as sold" without the full close-out
// waterfall. Moves the property to Historical Transactions. Pass sold: false to undo.
router.patch('/:id/sold', (req, res) => {
  const { sold = true, sold_date, sale_price } = req.body || {}
  if (sold) {
    db.prepare(`UPDATE properties SET listing_status = 'sold', sold_date = ?, sale_price = ? WHERE id = ?`)
      .run(sold_date || new Date().toISOString().slice(0, 10), sale_price != null && sale_price !== '' ? Number(sale_price) : null, req.params.id)
  } else {
    db.prepare(`UPDATE properties SET listing_status = NULL, sold_date = NULL, sale_price = NULL WHERE id = ?`).run(req.params.id)
  }
  res.json(db.prepare(`${BASE_SELECT} WHERE p.id = ?`).get(req.params.id))
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

// ── Tenant new-ownership notification ─────────────────────────────────────────
// A property-page button: notify the current tenant that Knox is the new
// landlord, with the Deed / notice letter / Assignment of Lease / W-9 attached
// straight from the property's Google Drive folder. Draft is AI-written; the
// user reviews and confirms before anything is sent (never auto-fires).

const DOC_PATTERNS = [
  { type: 'Deed',                 re: /\bdeed\b/i },
  { type: 'Tenant Notice Letter', re: /notif|notice|welcome|landlord|estoppel/i },
  { type: 'Assignment of Lease',  re: /assign/i },
  { type: 'W-9',                  re: /\bw-?9\b/i },
]
function classifyDoc(name) {
  for (const d of DOC_PATTERNS) if (d.re.test(name || '')) return d.type
  return null
}

async function draftTenantEmail({ brand, address, city, state }) {
  const loc = [address, city, state].filter(Boolean).join(', ')
  const fallback = {
    subject: `New ownership — ${brand ? brand + ' at ' : ''}${address}${city ? ', ' + city : ''}`,
    body:
`Hello,

We're writing to let you know that Knox Capital has acquired the property at ${loc}, where your ${brand || 'business'} operates. Effective as of closing, Knox Capital is your new landlord.

Attached you'll find the recorded Deed, the tenant notification letter, the Assignment of Lease, and our W-9 for your records. Please update your files with our information and direct future rent payments and correspondence to us going forward — remittance details are in the notification letter.

We'd also appreciate an updated certificate of insurance naming Knox Capital as an additional insured at your earliest convenience.

We're glad to have you and look forward to a great relationship. Please don't hesitate to reach out with any questions.

Best regards,
Brad Cottam
Knox Capital`,
  }

  const key = process.env.ANTHROPIC_API_KEY
  if (!key) return fallback
  try {
    const prompt = `Write a short, warm, professional email from Knox Capital to the current tenant of a commercial property we just acquired, telling them we're the new landlord. Property: ${brand || ''} at ${loc}. Note that the recorded Deed, the tenant notification letter, the Assignment of Lease, and our W-9 are attached. Ask them to update their records, direct future rent/correspondence to us (details are in the notification letter), and send an updated certificate of insurance naming Knox Capital. Sign as Brad Cottam, Knox Capital. Return ONLY JSON: {"subject":"...","body":"..."} — plain-text body using \\n for line breaks, no markdown.`
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({
        model: process.env.ASSISTANT_MODEL || 'claude-sonnet-5',
        max_tokens: 1200, thinking: { type: 'disabled' },
        messages: [{ role: 'user', content: prompt }],
      }),
    })
    const data = await r.json()
    const text = data?.content?.find(b => b.type === 'text')?.text || ''
    const m = text.match(/\{[\s\S]*\}/)
    if (m) { const j = JSON.parse(m[0]); if (j.subject && j.body) return j }
  } catch (e) {
    console.warn('[tenant-notify] draft failed, using template:', e.message)
  }
  return fallback
}

// GET prepare — tenant contacts, the property's Drive docs (with suggestions
// for the 4 target docs), and an AI-drafted email to review.
router.get('/:id/tenant-notify/prepare', async (req, res) => {
  const prop = db.prepare(`
    SELECT p.id, p.address, p.city, p.state, p.tenant_brand_id, tb.name AS brand
    FROM properties p LEFT JOIN tenant_brands tb ON tb.id = p.tenant_brand_id
    WHERE p.id = ?
  `).get(req.params.id)
  if (!prop) return res.status(404).json({ error: 'Property not found' })

  // Tenant contacts for this brand, preferring ones whose territory covers the state.
  let contacts = []
  if (prop.tenant_brand_id) {
    contacts = db.prepare(`
      SELECT id, name, email, title, tenant_roles, territory_states, territory_regions
      FROM people
      WHERE role = 'tenant_contact' AND email IS NOT NULL AND email <> ''
        AND tenant_brand_id IN (SELECT id FROM tenant_brands WHERE name = (SELECT name FROM tenant_brands WHERE id = ?))
      ORDER BY name
    `).all(prop.tenant_brand_id)
    const st = (prop.state || '').toUpperCase()
    contacts.sort((a, b) =>
      ((a.territory_states || '').includes(`"${st}"`) ? 0 : 1) -
      ((b.territory_states || '').includes(`"${st}"`) ? 0 : 1))
  }

  // The property's own Drive folder (incl. subfolders like "Escrow") — Deed,
  // notice letter, and Assignment of Lease live here.
  let drive = { connected: false, folder: null, files: [] }
  try { drive = await searchDriveForProperty(req.params.id) } catch (e) { console.warn('[tenant-notify] drive:', e.message) }
  const files = (drive.files || []).map(f => ({ id: f.id, name: f.name, mimeType: f.mimeType, path: f.path, docType: classifyDoc(f.name), source: 'property' }))

  // The W-9 lives in the owning LLC's folder, NOT the property folder, and the
  // property record doesn't say which LLC — so pull W-9 candidates by name from
  // across Drive for the user to pick the right entity's.
  if (drive.connected) {
    try {
      const seen = new Set(files.map(f => f.id))
      const w9 = await searchDriveDocs(['W-9', 'W9'])
      for (const f of (w9.files || [])) {
        if (seen.has(f.id)) continue
        files.push({ id: f.id, name: f.name, mimeType: f.mimeType, path: 'LLC folder', docType: 'W-9', source: 'llc', webViewLink: f.webViewLink })
        seen.add(f.id)
      }
    } catch (e) { console.warn('[tenant-notify] w9 search:', e.message) }
  }

  // Auto-select the escrow docs from the property folder. Only auto-select the
  // W-9 when there's a single candidate — otherwise the user picks the entity.
  const suggested = new Set()
  for (const type of ['Deed', 'Tenant Notice Letter', 'Assignment of Lease']) {
    const hit = files.find(f => f.docType === type)
    if (hit) suggested.add(hit.id)
  }
  const w9s = files.filter(f => f.docType === 'W-9')
  if (w9s.length === 1) suggested.add(w9s[0].id)
  files.forEach(f => { f.suggested = suggested.has(f.id) })

  const draft = await draftTenantEmail(prop)
  res.json({ property: prop, contacts, drive: { connected: drive.connected, folder: drive.folder || null }, files, draft })
})

// POST send — review-then-send the notification with the chosen Drive attachments.
router.post('/:id/tenant-notify/send', async (req, res) => {
  const { to, cc, subject, body, driveFileIds } = req.body || {}
  const recipients = Array.isArray(to) ? to.filter(Boolean) : (to ? [to] : [])
  if (!recipients.length)   return res.status(400).json({ error: 'At least one recipient is required' })
  if (!subject || !body)    return res.status(400).json({ error: 'subject and body are required' })

  const prop = db.prepare('SELECT id, notes FROM properties WHERE id = ?').get(req.params.id)
  if (!prop) return res.status(404).json({ error: 'Property not found' })

  // Download the selected Drive files as attachments.
  const attachments = []
  for (const fileId of (Array.isArray(driveFileIds) ? driveFileIds : [])) {
    try {
      const f = await fetchDriveFile(fileId)
      attachments.push({ filename: f.name, content: f.buffer, contentType: f.mimeType })
    } catch (e) {
      return res.status(502).json({ error: `Couldn't fetch an attachment from Drive: ${e.message}` })
    }
  }

  try {
    await sendMail({
      from:    process.env.TENANT_NOTIFY_FROM || process.env.EMAIL_FROM,
      replyTo: process.env.TENANT_NOTIFY_REPLY_TO,
      to:      recipients.join(', '),
      cc:      cc || undefined,
      subject,
      text:    body,
      attachments,
    })
  } catch (e) {
    console.error('[tenant-notify] send failed:', e.message)
    return res.status(502).json({ error: `Send failed: ${e.message}` })
  }

  // Durable audit trail on the property.
  const stamp = new Date().toISOString().slice(0, 10)
  const note = `[${stamp}] Tenant ownership-change notice emailed to ${recipients.join(', ')}${attachments.length ? ` (${attachments.length} attachment${attachments.length === 1 ? '' : 's'})` : ''}.`
  db.prepare(`UPDATE properties SET notes = TRIM(COALESCE(notes, '') || CHAR(10) || ?) WHERE id = ?`).run(note, prop.id)

  res.json({ ok: true, sent_to: recipients, attachments: attachments.length })
})

export default router
