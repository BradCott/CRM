import { Router } from 'express'
import multer from 'multer'
import { parse } from 'csv-parse/sync'
import { createRequire } from 'node:module'
import db from '../db.js'

const require = createRequire(import.meta.url)

function parseXlsx(buffer) {
  const XLSX = require('xlsx')
  const wb   = XLSX.read(buffer, { type: 'buffer' })
  const ws   = wb.Sheets[wb.SheetNames[0]]
  return XLSX.utils.sheet_to_json(ws, { defval: '' })
}

// ── Address normalization helpers ─────────────────────────────────────────────

/** Strip noise and lowercase — first pass normalization */
function normalizeAddr(s) {
  if (!s) return ''
  return s
    .toLowerCase()
    .replace(/\s*\(.*?\)/g, '')                          // strip "(Part of a 7 Property Sale)"
    .replace(/\b(ste|suite|unit|apt|#)\s*\.?\s*[\w-]*/gi, '') // strip unit numbers
    .replace(/[.,;#]/g, '')                              // strip punctuation
    .replace(/\s+/g, ' ')
    .trim()
}

/** Expand common abbreviations to full words for fuzzy comparison */
function expandAbbrevs(s) {
  return s
    // Street types
    .replace(/\bst\b/g,   'street')
    .replace(/\bave\b/g,  'avenue')
    .replace(/\bblvd\b/g, 'boulevard')
    .replace(/\brd\b/g,   'road')
    .replace(/\bdr\b/g,   'drive')
    .replace(/\bln\b/g,   'lane')
    .replace(/\bct\b/g,   'court')
    .replace(/\bpl\b/g,   'place')
    .replace(/\bpkwy\b/g, 'parkway')
    .replace(/\bhwy\b/g,  'highway')
    .replace(/\bcir\b/g,  'circle')
    .replace(/\bter\b/g,  'terrace')
    .replace(/\btrl\b/g,  'trail')
    .replace(/\bfwy\b/g,  'freeway')
    .replace(/\bexpy\b/g, 'expressway')
    // Compound directionals first (before single letters)
    .replace(/\bne\b/g, 'northeast')
    .replace(/\bnw\b/g, 'northwest')
    .replace(/\bse\b/g, 'southeast')
    .replace(/\bsw\b/g, 'southwest')
    // Single-letter directionals
    .replace(/\bn\b/g, 'north')
    .replace(/\bs\b/g, 'south')
    .replace(/\be\b/g, 'east')
    .replace(/\bw\b/g, 'west')
    .replace(/\s+/g, ' ')
    .trim()
}

const router = Router()
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 100 * 1024 * 1024 } })

// Column indices in the Salesforce report
const COL = {
  TENANT_FULL:  0,  // "CVS - 3506 N Lecanto Hwy"
  TENANT_BRAND: 1,  // "CVS"
  PROP_ADDR:    2,
  PROP_CITY:    3,
  PROP_STATE:   4,
  PROP_ZIP:     5,
  FIRST_NAME:   6,
  LAST_NAME:    7,
  ACCT_NAME:    8,
  PRIM_STREET:  9,
  PRIM_CITY:    10,
  PRIM_STATE:   11,
  PRIM_ZIP:     12,
  EMAIL:        13,
  EMAIL2:       14,
  SEC_STREET:   15,
  SEC_CITY:     16,
  SEC_STATE:    17,
  SEC_ZIP:      18,
  MOBILE:       19,
  PHONE2:       20,
  PHONE:        21,
  ACCT_SF_ID:   22,
  TENANT_SF_ID: 23,
  DO_NOT_MAIL:  24,
  RECORD_TYPE:  25, // "Person Account" or "Business Account"
  PROP_NOTES:   26,
  ACCT_NOTES:   27,
  ACCT_TYPE:    28, // Principal, Franchisee, Broker, Buyer, Seller
}

function mapRole(recordType, acctType) {
  if (recordType === 'Person Account') return 'owner'
  // Business account — check type
  const t = (acctType || '').toLowerCase()
  if (t === 'broker') return 'broker'
  return 'owner_company'
}

function mapSubLabel(acctType) {
  const t = (acctType || '').toLowerCase()
  if (t === 'buyer') return 'buyer'
  if (t === 'seller') return 'seller'
  return null
}

// POST /api/import/salesforce — main full import
router.post('/salesforce', upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' })

  let records
  try {
    records = parse(req.file.buffer.toString('utf8'), {
      columns: false,
      skip_empty_lines: true,
      trim: true,
      bom: true,
      from_line: 2, // skip header row
      relax_column_count: true,
    })
  } catch (e) {
    return res.status(400).json({ error: `CSV parse error: ${e.message}` })
  }

  // Prepared statements
  const upsertBrand = db.prepare(`
    INSERT INTO tenant_brands (name) VALUES (?)
    ON CONFLICT(name) DO NOTHING
  `)
  const getBrand = db.prepare(`SELECT id FROM tenant_brands WHERE name = ?`)

  const upsertPerson = db.prepare(`
    INSERT INTO people
      (name,first_name,last_name,role,sub_label,phone,phone2,mobile,
       email,email2,address,city,state,zip,address2,city2,state2,zip2,
       do_not_contact,notes,sf_id)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(sf_id) DO UPDATE SET
      name=excluded.name, first_name=excluded.first_name, last_name=excluded.last_name,
      role=excluded.role, sub_label=excluded.sub_label,
      phone=excluded.phone, phone2=excluded.phone2, mobile=excluded.mobile,
      email=excluded.email, email2=excluded.email2,
      address=excluded.address, city=excluded.city, state=excluded.state, zip=excluded.zip,
      address2=excluded.address2, city2=excluded.city2, state2=excluded.state2, zip2=excluded.zip2,
      do_not_contact=excluded.do_not_contact, notes=excluded.notes
  `)
  const getPerson = db.prepare(`SELECT id FROM people WHERE sf_id = ?`)

  const upsertProp = db.prepare(`
    INSERT INTO properties (address,city,state,zip,tenant_brand_id,owner_id,notes,sf_id)
    VALUES (?,?,?,?,?,?,?,?)
    ON CONFLICT(sf_id) DO UPDATE SET
      address=excluded.address, city=excluded.city, state=excluded.state, zip=excluded.zip,
      tenant_brand_id=excluded.tenant_brand_id, owner_id=excluded.owner_id,
      notes=CASE WHEN excluded.notes IS NOT NULL AND excluded.notes != '' THEN excluded.notes ELSE properties.notes END
  `)

  let imported = 0, skipped = 0, errors = []

  // Wrap everything in a single transaction — critical for 28k rows
  db.exec('BEGIN')
  try {
    for (const r of records) {
      if (!r[COL.TENANT_SF_ID]) { skipped++; continue }

      const tenantBrand = (r[COL.TENANT_BRAND] || '').trim()
      const acctSfId    = (r[COL.ACCT_SF_ID] || '').trim()
      const propSfId    = (r[COL.TENANT_SF_ID] || '').trim()
      const recordType  = (r[COL.RECORD_TYPE] || '').trim()
      const acctType    = (r[COL.ACCT_TYPE] || '').trim()
      const firstName   = (r[COL.FIRST_NAME] || '').trim()
      const lastName    = (r[COL.LAST_NAME] || '').trim()
      const acctName    = (r[COL.ACCT_NAME] || '').trim()

      // Derive name
      const isPerson = recordType === 'Person Account'
      const name = isPerson
        ? [firstName, lastName].filter(Boolean).join(' ') || acctName
        : acctName

      if (!name) { skipped++; continue }

      // 1. Upsert tenant brand
      let brandId = null
      if (tenantBrand) {
        upsertBrand.run(tenantBrand)
        brandId = getBrand.get(tenantBrand)?.id || null
      }

      // 2. Upsert person/company
      let ownerId = null
      if (acctSfId) {
        upsertPerson.run(
          name, firstName || null, lastName || null,
          mapRole(recordType, acctType),
          mapSubLabel(acctType),
          r[COL.PHONE]  || null,
          r[COL.PHONE2] || null,
          r[COL.MOBILE] || null,
          r[COL.EMAIL]  || null,
          r[COL.EMAIL2] || null,
          r[COL.PRIM_STREET] || null,
          r[COL.PRIM_CITY]   || null,
          r[COL.PRIM_STATE]  || null,
          r[COL.PRIM_ZIP]    || null,
          r[COL.SEC_STREET]  || null,
          r[COL.SEC_CITY]    || null,
          r[COL.SEC_STATE]   || null,
          r[COL.SEC_ZIP]     || null,
          r[COL.DO_NOT_MAIL] === '1' ? 1 : 0,
          r[COL.ACCT_NOTES]  || null,
          acctSfId
        )
        ownerId = getPerson.get(acctSfId)?.id || null
      }

      // 3. Upsert property
      const addr  = (r[COL.PROP_ADDR]  || '').trim()
      const city  = (r[COL.PROP_CITY]  || '').trim()
      const state = (r[COL.PROP_STATE] || '').trim()
      const zip   = (r[COL.PROP_ZIP]   || '').trim()
      const notes = (r[COL.PROP_NOTES] || '').trim()

      if (addr) {
        upsertProp.run(addr, city || null, state || null, zip || null, brandId, ownerId, notes || null, propSfId)
        imported++
      } else {
        skipped++
      }
    }
    db.exec('COMMIT')
  } catch (e) {
    db.exec('ROLLBACK')
    return res.status(500).json({ error: e.message })
  }

  res.json({
    imported,
    skipped,
    total: records.length,
    errors,
    stats: {
      tenant_brands: db.prepare('SELECT COUNT(*) AS n FROM tenant_brands').get().n,
      people:        db.prepare('SELECT COUNT(*) AS n FROM people').get().n,
      properties:    db.prepare('SELECT COUNT(*) AS n FROM properties').get().n,
    }
  })
})

// Stats endpoint
router.get('/stats', (req, res) => {
  res.json({
    tenant_brands: db.prepare('SELECT COUNT(*) AS n FROM tenant_brands').get().n,
    people:        db.prepare('SELECT COUNT(*) AS n FROM people').get().n,
    properties:    db.prepare('SELECT COUNT(*) AS n FROM properties').get().n,
    deals:         db.prepare('SELECT COUNT(*) AS n FROM deals').get().n,
  })
})

// POST /api/import/recent-sales
// Accepts a CoStar-style XLSX (or CSV) export of recent sales.
// Matches on address (case-insensitive, parenthetical notes stripped),
// then flags matched properties as needs_ownership_review = 1.
router.post('/recent-sales', upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' })

  let rows
  const isXlsx = req.file.originalname?.toLowerCase().endsWith('.xlsx') ||
                 req.file.originalname?.toLowerCase().endsWith('.xls')
  try {
    if (isXlsx) {
      rows = parseXlsx(req.file.buffer)
    } else {
      rows = parse(req.file.buffer.toString('utf8'), {
        columns: true, skip_empty_lines: true, trim: true, bom: true,
      })
    }
  } catch (e) {
    return res.status(400).json({ error: `File parse error: ${e.message}` })
  }

  if (!rows || rows.length === 0) {
    return res.status(400).json({ error: 'No rows found in file' })
  }

  // Detect address column — CoStar uses "Address", also handle "Property Address"
  const sample = rows[0]
  const addrKey = Object.keys(sample).find(k =>
    k.toLowerCase() === 'address' || k.toLowerCase() === 'property address'
  )
  if (!addrKey) {
    return res.status(400).json({ error: 'Could not find an Address column in the file' })
  }

  // Build in-memory lookup maps from all properties
  // (two maps: normalized-only, and normalized+expanded)
  const allProps = db.prepare('SELECT id, address, city, state FROM properties').all()

  const exactMap    = new Map()   // normalizeAddr(address) → [{id,city,state}]
  const expandedMap = new Map()   // expandAbbrevs(normalize(address)) → [{id,city,state}]

  for (const p of allProps) {
    const norm = normalizeAddr(p.address || '')
    const exp  = expandAbbrevs(norm)
    if (norm) {
      if (!exactMap.has(norm)) exactMap.set(norm, [])
      exactMap.get(norm).push(p)
    }
    if (exp && exp !== norm) {
      if (!expandedMap.has(exp)) expandedMap.set(exp, [])
      expandedMap.get(exp).push(p)
    }
  }

  const flagStmt = db.prepare(
    `UPDATE properties SET needs_ownership_review = 1 WHERE id = ?`
  )

  function bestMatch(candidates, city, state) {
    if (!candidates || candidates.length === 0) return null
    if (candidates.length === 1) return candidates[0]
    // Use city+state to narrow down when multiple candidates share an address
    const cityLow  = (city  || '').toLowerCase().trim()
    const stateLow = (state || '').toLowerCase().trim()
    const refined  = candidates.filter(c =>
      (!cityLow  || (c.city  || '').toLowerCase() === cityLow) &&
      (!stateLow || (c.state || '').toLowerCase() === stateLow)
    )
    return refined[0] || candidates[0]
  }

  let matched = 0, unmatched = 0
  const unmatchedAddresses = []

  db.exec('BEGIN')
  try {
    for (const row of rows) {
      const rawAddr = String(row[addrKey] || '').trim()
      if (!rawAddr) continue

      const city  = String(row['City']  || row['city']  || '').trim()
      const state = String(row['State'] || row['state'] || '').trim()

      const norm = normalizeAddr(rawAddr)
      const exp  = expandAbbrevs(norm)

      // Pass 1: exact normalized match
      let match = bestMatch(exactMap.get(norm), city, state)

      // Pass 2: abbreviation-expanded match
      if (!match) {
        match = bestMatch(expandedMap.get(exp), city, state)
      }

      // Pass 3: try expanding the DB side — look up expanded form of both
      if (!match) {
        match = bestMatch(exactMap.get(exp), city, state)
      }

      if (match) {
        flagStmt.run(match.id)
        matched++
      } else {
        unmatched++
        if (unmatchedAddresses.length < 50) unmatchedAddresses.push(rawAddr)
      }
    }
    db.exec('COMMIT')
  } catch (e) {
    db.exec('ROLLBACK')
    return res.status(500).json({ error: e.message })
  }

  res.json({
    total:    rows.length,
    matched,
    unmatched,
    unmatched_sample: unmatchedAddresses,
  })
})

export default router
