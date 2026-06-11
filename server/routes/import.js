import { Router } from 'express'
import multer from 'multer'
import { parse } from 'csv-parse/sync'
import { createRequire } from 'node:module'
import db from '../db.js'
import { normalizeName, normalizeAddr as normalizeAddrKey, matchPerson } from '../utils/normalize.js'

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

// Shared logic: classify one parsed row against the DB.
// Returns { personResult, propResult } where each has a `bucket` field:
//   'create' | 'update' | 'review'
// In preview mode this is all that happens; in commit mode we also write.
function classifyRow(r, decisions, rowIdx, preview) {
  const tenantBrand = (r[COL.TENANT_BRAND] || '').trim()
  const acctSfId    = (r[COL.ACCT_SF_ID]   || '').trim()
  const propSfId    = (r[COL.TENANT_SF_ID]  || '').trim()
  const recordType  = (r[COL.RECORD_TYPE]   || '').trim()
  const acctType    = (r[COL.ACCT_TYPE]     || '').trim()
  const firstName   = (r[COL.FIRST_NAME]    || '').trim()
  const lastName    = (r[COL.LAST_NAME]     || '').trim()
  const acctName    = (r[COL.ACCT_NAME]     || '').trim()
  const isPerson    = recordType === 'Person Account'
  const name        = isPerson ? ([firstName, lastName].filter(Boolean).join(' ') || acctName) : acctName

  const addr  = (r[COL.PROP_ADDR]  || '').trim()
  const city  = (r[COL.PROP_CITY]  || '').trim()
  const state = (r[COL.PROP_STATE] || '').trim()
  const zip   = (r[COL.PROP_ZIP]   || '').trim()
  const notes = (r[COL.PROP_NOTES] || '').trim()

  // ── Tenant brand ──────────────────────────────────────────────────────────
  let brandId = null
  if (tenantBrand && !preview) {
    db.prepare(`INSERT INTO tenant_brands (name) VALUES (?) ON CONFLICT(name) DO NOTHING`).run(tenantBrand)
    brandId = db.prepare(`SELECT id FROM tenant_brands WHERE name = ?`).get(tenantBrand)?.id || null
  } else if (tenantBrand && preview) {
    brandId = db.prepare(`SELECT id FROM tenant_brands WHERE name = ?`).get(tenantBrand)?.id || null
  }

  // ── Person ────────────────────────────────────────────────────────────────
  let personResult = null
  let ownerId = null

  if (name) {
    const nameKey   = normalizeName(name)
    const primCity  = (r[COL.PRIM_CITY]  || '').trim()
    const primState = (r[COL.PRIM_STATE] || '').trim()
    const primStreet = (r[COL.PRIM_STREET] || '').trim()

    // Check by sf_id first, then by name_key
    let existingPerson = acctSfId
      ? db.prepare(`SELECT id FROM people WHERE sf_id = ?`).get(acctSfId)
      : null

    if (!existingPerson && nameKey) {
      const candidates = db.prepare(`SELECT id, name, city, state, address FROM people WHERE name_key = ?`).all(nameKey)
      if (candidates.length) {
        const match = matchPerson(nameKey, primCity, primState, primStreet, candidates)
        if (match.confidence === 'confident') {
          existingPerson = match.matched
          personResult = { bucket: 'update', existing: match.matched, name }
        } else {
          personResult = { bucket: 'review', candidates: match.candidates || candidates, name, primCity, primState }
        }
      }
    }

    if (!personResult) {
      personResult = existingPerson
        ? { bucket: 'update', existing: existingPerson, name }
        : { bucket: 'create', name }
    }

    // Apply decision for needs-review rows
    const decision = decisions?.[rowIdx]
    if (personResult.bucket === 'review' && decision) {
      if (decision.person_action === 'merge' && decision.person_id) {
        existingPerson = { id: decision.person_id }
        personResult = { bucket: 'update', existing: existingPerson, name, decided: true }
      } else if (decision.person_action === 'create') {
        existingPerson = null
        personResult = { bucket: 'create', name, decided: true }
      }
    }

    if (!preview) {
      if (existingPerson && personResult.bucket !== 'review') {
        // Update — only fill empty fields; always sync sf_id and name_key
        db.prepare(`
          UPDATE people SET
            sf_id    = COALESCE(sf_id, ?),
            name_key = COALESCE(name_key, ?),
            phone    = CASE WHEN phone    IS NULL OR phone    = '' THEN ? ELSE phone    END,
            email    = CASE WHEN email    IS NULL OR email    = '' THEN ? ELSE email    END,
            mobile   = CASE WHEN mobile   IS NULL OR mobile   = '' THEN ? ELSE mobile   END,
            address  = CASE WHEN address  IS NULL OR address  = '' THEN ? ELSE address  END,
            city     = CASE WHEN city     IS NULL OR city     = '' THEN ? ELSE city     END,
            state    = CASE WHEN state    IS NULL OR state    = '' THEN ? ELSE state    END,
            zip      = CASE WHEN zip      IS NULL OR zip      = '' THEN ? ELSE zip      END
          WHERE id = ?
        `).run(
          acctSfId || null, nameKey,
          r[COL.PHONE]  || null,
          r[COL.EMAIL]  || null,
          r[COL.MOBILE] || null,
          primStreet || null, primCity || null, primState || null,
          r[COL.PRIM_ZIP] || null,
          existingPerson.id
        )
        ownerId = existingPerson.id
      } else if (personResult.bucket === 'create') {
        const ins = db.prepare(`
          INSERT INTO people
            (name,first_name,last_name,role,sub_label,phone,phone2,mobile,
             email,email2,address,city,state,zip,address2,city2,state2,zip2,
             do_not_contact,notes,sf_id,name_key)
          VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
        `).run(
          name, firstName || null, lastName || null,
          mapRole(recordType, acctType), mapSubLabel(acctType),
          r[COL.PHONE]  || null, r[COL.PHONE2] || null, r[COL.MOBILE] || null,
          r[COL.EMAIL]  || null, r[COL.EMAIL2] || null,
          primStreet || null, primCity || null, primState || null, r[COL.PRIM_ZIP] || null,
          r[COL.SEC_STREET] || null, r[COL.SEC_CITY] || null,
          r[COL.SEC_STATE]  || null, r[COL.SEC_ZIP]  || null,
          r[COL.DO_NOT_MAIL] === '1' ? 1 : 0,
          r[COL.ACCT_NOTES] || null,
          acctSfId || null,
          nameKey
        )
        ownerId = Number(ins.lastInsertRowid)
      }
      // If still 'review' (no decision), leave ownerId null — property will be ownerless
    }
  }

  // ── Property ──────────────────────────────────────────────────────────────
  let propResult = null

  if (addr) {
    const addrKey = normalizeAddrKey(addr, city, state, zip)
    const existingByAddr  = addrKey ? db.prepare(`SELECT id, sf_id, owner_id FROM properties WHERE addr_key = ?`).get(addrKey) : null
    const existingBySfId  = propSfId ? db.prepare(`SELECT id FROM properties WHERE sf_id = ?`).get(propSfId) : null
    const existingProp    = existingByAddr || existingBySfId

    propResult = existingProp
      ? { bucket: 'update', existing: existingProp, address: addr, city, state }
      : { bucket: 'create', address: addr, city, state }

    if (!preview) {
      if (existingProp) {
        db.prepare(`
          UPDATE properties SET
            sf_id           = COALESCE(sf_id, ?),
            addr_key        = COALESCE(addr_key, ?),
            tenant_brand_id = COALESCE(tenant_brand_id, ?),
            owner_id        = COALESCE(owner_id, ?),
            notes           = CASE WHEN notes IS NULL OR notes = '' THEN ? ELSE notes END
          WHERE id = ?
        `).run(propSfId || null, addrKey || null, brandId, ownerId, notes || null, existingProp.id)
      } else {
        db.prepare(`
          INSERT INTO properties (address,city,state,zip,tenant_brand_id,owner_id,notes,sf_id,addr_key)
          VALUES (?,?,?,?,?,?,?,?,?)
        `).run(addr, city || null, state || null, zip || null, brandId, ownerId, notes || null, propSfId || null, addrKey || null)
      }
    }
  }

  return { personResult, propResult, name, address: addr, tenantBrand }
}

// POST /api/import/salesforce — main full import (add ?preview=1 to classify without committing)
router.post('/salesforce', upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' })

  const preview   = req.query.preview === '1'
  const decisions = req.body.decisions ? JSON.parse(req.body.decisions) : {}

  let records
  try {
    records = parse(req.file.buffer.toString('utf8'), {
      columns: false,
      skip_empty_lines: true,
      trim: true,
      bom: true,
      from_line: 2,
      relax_column_count: true,
    })
  } catch (e) {
    return res.status(400).json({ error: `CSV parse error: ${e.message}` })
  }

  const buckets = { will_create: [], will_update: [], needs_review: [] }
  let imported = 0, skipped = 0

  if (!preview) db.exec('BEGIN')
  try {
    for (let i = 0; i < records.length; i++) {
      const r = records[i]
      const addr = (r[COL.PROP_ADDR] || '').trim()
      // Skip rows with neither a property SF ID nor an address
      if (!r[COL.TENANT_SF_ID] && !addr) { skipped++; continue }

      const result = classifyRow(r, decisions, i, preview)

      if (result.propResult) {
        if (result.personResult?.bucket === 'review' && !decisions[i]) {
          buckets.needs_review.push({ index: i, name: result.name, address: result.address, tenantBrand: result.tenantBrand, candidates: result.personResult.candidates })
        } else if (result.propResult.bucket === 'create') {
          buckets.will_create.push({ index: i, name: result.name, address: result.address, tenantBrand: result.tenantBrand })
          if (!preview) imported++
        } else {
          buckets.will_update.push({ index: i, name: result.name, address: result.address, tenantBrand: result.tenantBrand, matched_property: result.propResult.existing })
          if (!preview) imported++
        }
      } else {
        skipped++
      }
    }
    if (!preview) db.exec('COMMIT')
  } catch (e) {
    if (!preview) db.exec('ROLLBACK')
    return res.status(500).json({ error: e.message })
  }

  if (preview) {
    return res.json({
      preview: true,
      total: records.length,
      buckets,
      counts: {
        will_create:  buckets.will_create.length,
        will_update:  buckets.will_update.length,
        needs_review: buckets.needs_review.length,
      },
    })
  }

  res.json({
    imported,
    skipped,
    total: records.length,
    needs_review: buckets.needs_review.length,
    stats: {
      tenant_brands: db.prepare('SELECT COUNT(*) AS n FROM tenant_brands').get().n,
      people:        db.prepare('SELECT COUNT(*) AS n FROM people').get().n,
      properties:    db.prepare('SELECT COUNT(*) AS n FROM properties').get().n,
    }
  })
})

// GET /api/import/prospect-template — download Excel template
router.get('/prospect-template', (req, res) => {
  const XLSX = require('xlsx')

  const COLUMNS = [
    // [header, mandatory, example1, example2]
    ['address',        true,  '1234 Main St',          '789 Oak Ave'],
    ['city',           true,  'Birmingham',             'Huntsville'],
    ['state',          true,  'AL',                     'AL'],
    ['zip',            false, '35203',                  '35801'],
    ['tenant_brand',   false, 'Joe Hudson Collision',   'Caliber Collision'],
    ['property_type',  false, 'Auto',                   'Auto'],
    ['lease_type',     false, 'NNN',                    'NN'],
    ['lease_start',    false, '2018-01-01',              '2020-06-01'],
    ['lease_end',      false, '2033-01-01',              '2035-06-01'],
    ['annual_rent',    false, '120000',                 '95000'],
    ['noi',            false, '118000',                 '93000'],
    ['cap_rate',       false, '5.75',                   '6.10'],
    ['list_price',     false, '2050000',                '1525000'],
    ['building_size',  false, '8500',                   '6200'],
    ['land_area',      false, '1.25',                   '0.95'],
    ['year_built',     false, '2018',                   '2020'],
    ['owner_name',     false, 'Smith Properties LLC',   'Oak Holdings Inc'],
    ['owner_phone',    false, '(205) 555-1234',         '(256) 555-9876'],
    ['owner_email',    false, 'john@smithprop.com',     'info@oakhold.com'],
    ['owner_address',  false, '100 Commerce St',        '200 Clinton Ave'],
    ['owner_city',     false, 'Birmingham',             'Huntsville'],
    ['owner_state',    false, 'AL',                     'AL'],
    ['owner_zip',      false, '35203',                  '35801'],
    ['notes',          false, 'Off-market, owner motivated', ''],
  ]

  const wb = XLSX.utils.book_new()

  // ── Main sheet ──────────────────────────────────────────────────────────────
  const wsData = [
    COLUMNS.map(([h]) => h),
    COLUMNS.map(([,, ex1]) => ex1),
    COLUMNS.map(([,,, ex2]) => ex2),
  ]
  const ws = XLSX.utils.aoa_to_sheet(wsData)

  // Column widths
  ws['!cols'] = COLUMNS.map(([h]) => ({ wch: Math.max(h.length + 2, 18) }))

  // Style header row: mandatory = yellow bold, optional = light grey bold
  COLUMNS.forEach(([, mandatory], ci) => {
    const cellAddr = XLSX.utils.encode_cell({ r: 0, c: ci })
    if (!ws[cellAddr]) return
    ws[cellAddr].s = {
      font:      { bold: true, color: { rgb: mandatory ? '7D4F00' : '4A4A4A' } },
      fill:      { fgColor: { rgb: mandatory ? 'FFF3CD' : 'F0F0F0' } },
      alignment: { horizontal: 'center' },
      border:    { bottom: { style: 'medium', color: { rgb: mandatory ? 'D4A017' : 'CCCCCC' } } },
    }
  })

  // Style example rows
  for (let r = 1; r <= 2; r++) {
    COLUMNS.forEach((_, ci) => {
      const cellAddr = XLSX.utils.encode_cell({ r, c: ci })
      if (!ws[cellAddr]) return
      ws[cellAddr].s = {
        font: { color: { rgb: '555555' }, italic: true },
        fill: { fgColor: { rgb: r === 1 ? 'FAFAFA' : 'F5F5F5' } },
      }
    })
  }

  XLSX.utils.book_append_sheet(wb, ws, 'Prospects')

  // ── Legend sheet ────────────────────────────────────────────────────────────
  const legendData = [
    ['Column', 'Required?', 'Description'],
    ...COLUMNS.map(([h, mandatory]) => [
      h,
      mandatory ? '✓ Required' : 'Optional',
      COLUMN_NOTES[h] || '',
    ]),
  ]
  const wsLegend = XLSX.utils.aoa_to_sheet(legendData)
  wsLegend['!cols'] = [{ wch: 20 }, { wch: 12 }, { wch: 55 }]
  // Header row styling
  ;['A1','B1','C1'].forEach(addr => {
    if (wsLegend[addr]) wsLegend[addr].s = { font: { bold: true }, fill: { fgColor: { rgb: 'E8EEF5' } } }
  })
  XLSX.utils.book_append_sheet(wb, wsLegend, 'Column Guide')

  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx', cellStyles: true })
  res.setHeader('Content-Disposition', 'attachment; filename="Knox Prospect Import Template.xlsx"')
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
  res.send(buf)
})

const COLUMN_NOTES = {
  address:       'Street address of the property (e.g. 1234 Main St). No unit/suite needed.',
  city:          'City where the property is located.',
  state:         'Two-letter state abbreviation (e.g. AL, GA, TN).',
  zip:           '5-digit ZIP code.',
  tenant_brand:  'Tenant name (e.g. Joe Hudson Collision). Will be created if new.',
  property_type: 'Retail / Net Lease / Industrial / Office / Medical / Restaurant / Auto / Other',
  lease_type:    'NNN / NN / N / Gross / Modified Gross / Ground Lease',
  lease_start:   'Lease start date in YYYY-MM-DD format.',
  lease_end:     'Lease expiration date in YYYY-MM-DD format.',
  annual_rent:   'Annual rent in dollars (numbers only, no $ or commas).',
  noi:           'Net operating income in dollars.',
  cap_rate:      'Cap rate as a percentage (e.g. 5.75 for 5.75%).',
  list_price:    'Asking price in dollars.',
  building_size: 'Building square footage (number only).',
  land_area:     'Land area in acres (e.g. 1.25).',
  year_built:    '4-digit year the building was constructed.',
  owner_name:    'Owner or company name. Used for duplicate matching by name + city.',
  owner_phone:   'Owner phone number.',
  owner_email:   'Owner email address.',
  owner_address: 'Owner mailing street address.',
  owner_city:    'Owner mailing city.',
  owner_state:   'Owner mailing state (2-letter abbreviation).',
  owner_zip:     'Owner mailing ZIP code.',
  notes:         'Any free-form notes about the property or deal.',
}

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
