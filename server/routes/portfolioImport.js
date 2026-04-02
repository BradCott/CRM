import { Router } from 'express'
import multer from 'multer'
import { parse } from 'csv-parse/sync'
import db from '../db.js'

const router = Router()
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } })

// ── Flexible column aliases (lowercase) ──────────────────────
const ALIASES = {
  tenant:          ['property', 'tenant', 'tenant brand', 'brand', 'tenant name'],
  owner:           ['ownership name', 'owner', 'owner name', 'ownership', 'entity', 'llc'],
  city_state:      ['city, state', 'city/state', 'city state', 'location'],
  city:            ['city'],
  state:           ['state', 'st'],
  address:         ['address', 'street', 'property address', 'street address'],
  zip:             ['zip', 'zip code', 'postal'],
  store_number:    ['store #', 'store number', 'store no', 'store no.', '#'],
  annual_rent:     ['rent', 'annual rent', 'base rent', 'gross rent'],
  expense:         ['expense', 'expenses', 'operating expense'],
  noi:             ['noi', 'net operating income'],
  interest_rate:   ['interest rate', 'rate', 'int rate'],
  maturity_date:   ['maturity date', 'maturity', 'loan maturity', 'due date'],
  total_debt_pmt:  ['total debt payment', 'debt payment', 'annual debt', 'debt service'],
  interest_pmt:    ['interest', 'interest payment', 'int payment'],
  principal_pmt:   ['prinicple', 'principle', 'principal', 'principal payment'],
  rtd_ratio:       ['rtd ratio', 'rtd', 'dscr', 'coverage ratio', 'debt coverage'],
  outstanding_debt:['current outstanding debt', 'outstanding debt', 'loan balance', 'balance'],
  bank:            ['bank', 'lender', 'lender name'],
  purchase_price:  ['purchase price', 'acquisition price', 'cost', 'bought for'],
  estimated_value: ['estimated value', 'current value', 'value', 'market value', 'appraised value'],
  store_manager:   ['store manager', 'manager'],
  district_manager:['district manager', 'dm'],
  qb_account:      ['qb account', 'quickbooks', 'qb', 'account'],
  misc:            ['misc', 'miscellaneous'],
  parking:         ['parking', 'parking lot'],
  roof:            ['roof', 'roof year', 'roof replaced'],
  hvac:            ['hvac', 'hvac year', 'hvac replaced'],
  ins_broker:      ['ins broker', 'insurance broker', 'broker'],
  policy_number:   ['policy number', 'policy no', 'policy #', 'policy'],
  account_number:  ['account number', 'acct number', 'acct #'],
  insurance_exp:   ['insurance exp', 'ins exp', 'policy exp', 'expiration', 'insurance expiration'],
  lease_type:      ['lease type', 'lease', 'lease structure'],
  lease_start:     ['lease start', 'commencement'],
  lease_end:       ['lease end', 'lease expiration', 'expiration date'],
  year_built:      ['year built', 'built'],
  year_purchased:  ['year purchased', 'year acquired'],
  building_size:   ['building size', 'sq ft', 'sqft', 'sf', 'square feet'],
  rent_bumps:      ['rent bumps', 'escalations', 'bumps'],
  renewal_options: ['renewal options', 'renewals', 'options'],
  taxes:           ['taxes', 'property tax'],
  insurance:       ['insurance', 'ins cost'],
  notes:           ['notes', 'comments', 'remarks'],
}

function buildColumnMap(headers) {
  const map = {}
  headers.forEach((h, i) => {
    const norm = (h || '').trim().toLowerCase()
    if (!norm) return
    for (const [field, aliases] of Object.entries(ALIASES)) {
      if (aliases.includes(norm) && map[field] === undefined) {
        map[field] = i
        break
      }
    }
  })
  return map
}

function get(row, map, field) {
  const i = map[field]
  return (i !== undefined && row[i] !== undefined) ? String(row[i]).trim() : null
}

function toNum(v) {
  if (!v || v === '') return null
  const n = parseFloat(String(v).replace(/[$,%\s]/g, '').replace(/,/g, ''))
  return isNaN(n) ? null : n
}

function toInt(v) {
  if (!v) return null
  const n = parseInt(String(v).replace(/\D/g, ''))
  return isNaN(n) ? null : n
}

// Split "City, ST" or "City" into {city, state}
function parseCityState(raw) {
  if (!raw) return { city: null, state: null }
  const parts = raw.split(',').map(s => s.trim())
  if (parts.length >= 2) {
    const possibleState = parts[parts.length - 1]
    if (/^[A-Z]{2}$/.test(possibleState)) {
      return { city: parts.slice(0, -1).join(', '), state: possibleState }
    }
  }
  return { city: parts[0], state: null }
}

// Find the actual header row — look for a row that has recognizable column names
function findHeaderRow(records) {
  for (let i = 0; i < Math.min(records.length, 5); i++) {
    const row = records[i]
    const norm = row.map(c => (c || '').trim().toLowerCase())
    const knownCols = Object.values(ALIASES).flat()
    const matches = norm.filter(n => n && knownCols.includes(n)).length
    if (matches >= 3) return i
  }
  return 0
}

// GET /api/portfolio-import/template
router.get('/template', (req, res) => {
  const headers = [
    'Property', 'Ownership Name', 'City, State', 'Address', 'Store #',
    'Rent', 'Expense', 'NOI', 'Interest Rate', 'Maturity Date',
    'Total Debt Payment', 'Interest', 'Prinicple', 'RTD Ratio',
    'Current Outstanding Debt', 'Bank', 'Purchase Price', 'Estimated Value',
    'Store Manager', 'District Manager', 'QB account',
    'MISC', 'PARKING', 'ROOF', 'HVAC',
    'Ins Broker', 'Policy Number', 'Account Number', 'Insurance Exp', 'Notes',
  ]
  res.setHeader('Content-Type', 'text/csv')
  res.setHeader('Content-Disposition', 'attachment; filename="knox-portfolio-template.csv"')
  res.send(headers.join(',') + '\n')
})

// POST /api/portfolio-import
router.post('/', upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' })

  let records
  try {
    records = parse(req.file.buffer.toString('utf8'), {
      columns: false,
      skip_empty_lines: false,
      trim: true,
      bom: true,
      relax_column_count: true,
    })
  } catch (e) {
    return res.status(400).json({ error: `CSV parse error: ${e.message}` })
  }

  // Find header row
  const headerIdx = findHeaderRow(records)
  const headerRow = records[headerIdx]
  const colMap    = buildColumnMap(headerRow)
  const dataRows  = records.slice(headerIdx + 1)

  // Skip rows with no meaningful data (all empty or just blanks)
  const meaningful = dataRows.filter(row => {
    const nonEmpty = row.filter(c => c && c.trim()).length
    return nonEmpty >= 2
  })

  if (meaningful.length === 0) {
    return res.status(400).json({ error: 'No data rows found after header.' })
  }

  const upsertBrand = db.prepare(`INSERT INTO tenant_brands (name) VALUES (?) ON CONFLICT(name) DO NOTHING`)
  const getBrand    = db.prepare(`SELECT id FROM tenant_brands WHERE name = ?`)
  const findOwner   = db.prepare(`SELECT id FROM people WHERE name = ? LIMIT 1`)
  const insertOwner = db.prepare(`INSERT OR IGNORE INTO people (name, role) VALUES (?, 'owner_company')`)

  const insertProp = db.prepare(`
    INSERT INTO properties (
      address, city, state, zip,
      tenant_brand_id, owner_id,
      store_number, lease_type, lease_start, lease_end,
      annual_rent, expense, noi, interest_rate,
      maturity_date, total_debt_pmt, interest_pmt, principal_pmt,
      rtd_ratio, outstanding_debt, bank,
      purchase_price, estimated_value,
      store_manager, district_manager, qb_account,
      parking_lot, roof_year, hvac_year,
      ins_broker, policy_number, account_number, insurance_exp,
      taxes, insurance, rent_bumps, renewal_options,
      year_built, year_purchased, building_size,
      notes, is_portfolio
    ) VALUES (
      ?,?,?,?,
      ?,?,
      ?,?,?,?,
      ?,?,?,?,
      ?,?,?,?,
      ?,?,?,
      ?,?,
      ?,?,?,
      ?,?,?,
      ?,?,?,?,
      ?,?,?,?,
      ?,?,?,
      ?,1
    )
  `)

  let imported = 0, skipped = 0

  db.exec('BEGIN')
  try {
    for (const row of meaningful) {
      // Resolve city/state — prefer dedicated columns, fall back to combined
      let city  = get(row, colMap, 'city')
      let state = get(row, colMap, 'state')
      if (!city && !state) {
        const cs = parseCityState(get(row, colMap, 'city_state'))
        city  = cs.city
        state = cs.state
      }

      const tenantRaw = get(row, colMap, 'tenant')
      // Strip parenthetical alternates like "Tire-Choice (Monro)" → use full name
      const tenantName = tenantRaw || null

      // Tenant brand
      let brandId = null
      if (tenantName) {
        upsertBrand.run(tenantName)
        brandId = getBrand.get(tenantName)?.id || null
      }

      // Owner entity
      let ownerId = null
      const ownerName = get(row, colMap, 'owner')
      if (ownerName) {
        insertOwner.run(ownerName)
        ownerId = findOwner.get(ownerName)?.id || null
      }

      // Address — may be blank in this file; use city+state as fallback identifier
      const address = get(row, colMap, 'address') || [tenantName, city].filter(Boolean).join(' – ')
      if (!address) { skipped++; continue }

      // Build combined notes
      const miscNote = get(row, colMap, 'misc')
      const baseNote = get(row, colMap, 'notes')
      const notes = [miscNote, baseNote].filter(Boolean).join('\n') || null

      insertProp.run(
        address,
        city,
        state,
        get(row, colMap, 'zip'),
        brandId,
        ownerId,
        get(row, colMap, 'store_number'),
        get(row, colMap, 'lease_type'),
        get(row, colMap, 'lease_start'),
        get(row, colMap, 'lease_end'),
        toNum(get(row, colMap, 'annual_rent')),
        toNum(get(row, colMap, 'expense')),
        toNum(get(row, colMap, 'noi')),
        toNum(get(row, colMap, 'interest_rate')),
        get(row, colMap, 'maturity_date'),
        toNum(get(row, colMap, 'total_debt_pmt')),
        toNum(get(row, colMap, 'interest_pmt')),
        toNum(get(row, colMap, 'principal_pmt')),
        toNum(get(row, colMap, 'rtd_ratio')),
        toNum(get(row, colMap, 'outstanding_debt')),
        get(row, colMap, 'bank'),
        toNum(get(row, colMap, 'purchase_price')),
        toNum(get(row, colMap, 'estimated_value')),
        get(row, colMap, 'store_manager'),
        get(row, colMap, 'district_manager'),
        get(row, colMap, 'qb_account'),
        get(row, colMap, 'parking'),
        toInt(get(row, colMap, 'roof')),
        toInt(get(row, colMap, 'hvac')),
        get(row, colMap, 'ins_broker'),
        get(row, colMap, 'policy_number'),
        get(row, colMap, 'account_number'),
        get(row, colMap, 'insurance_exp'),
        toNum(get(row, colMap, 'taxes')),
        toNum(get(row, colMap, 'insurance')),
        get(row, colMap, 'rent_bumps'),
        get(row, colMap, 'renewal_options'),
        toInt(get(row, colMap, 'year_built')),
        toInt(get(row, colMap, 'year_purchased')),
        toNum(get(row, colMap, 'building_size')),
        notes,
      )
      imported++
    }
    db.exec('COMMIT')
  } catch (e) {
    db.exec('ROLLBACK')
    return res.status(500).json({ error: e.message })
  }

  res.json({ imported, skipped, total: meaningful.length })
})

export default router
