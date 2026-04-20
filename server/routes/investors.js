import { Router } from 'express'
import multer from 'multer'
import * as XLSX from 'xlsx'
import db from '../db.js'
import { normalizeName, nameSimilarity, autoLinkInvestors } from '../services/investorMatch.js'

const router  = Router()
const upload  = multer({ storage: multer.memoryStorage(), limits: { fileSize: 30 * 1024 * 1024 } })

// ── Bulk-import constants ─────────────────────────────────────────────────────

/** Hardcoded contact addresses from the investor spreadsheet. */
const KNOWN_CONTACTS = [
  { name: 'Brad Cottam',                             address: '7500 W 160th St Ste 101', city: 'Stilwell',      state: 'KS', zip: '66085', entity_type: 'Individual' },
  { name: 'Morgan Cox',                              address: '148 Hillwood Lane',        city: 'Collierville',  state: 'TN', zip: '38017', entity_type: 'Individual' },
  { name: 'CCC RE Investments LLC',                  address: '631 Melody Lane',          city: 'Jonesboro',     state: 'AR', zip: null,     entity_type: 'LLC' },
  { name: 'Kyle & Jennifer Farrell',                 address: '8414 W 144th Place',       city: 'Overland Park', state: 'KS', zip: '66223', entity_type: 'Trust' },
  { name: 'Camelback Consolidated Investments LLC',  address: '1400 Bethany Home Rd Unit 14', city: 'Phoenix',   state: 'AZ', zip: '85014', entity_type: 'LLC' },
  { name: 'Lauren Woods',                            address: '9809 Church Circle',       city: 'Dallas',        state: 'TX', zip: '75238', entity_type: 'Individual' },
  { name: 'James A. Cottam',                         address: '2 Covewood Court',         city: 'Asheville',     state: 'NC', zip: '28704', entity_type: 'Individual' },
  { name: 'James Robert Cooter',                     address: '1212 Laurel St Apt 1107',  city: 'Nashville',     state: 'TN', zip: '37203', entity_type: 'Individual' },
  { name: 'KASH Investments',                        address: '5500 W 69th St',           city: 'Overland Park', state: 'KS', zip: '66207', entity_type: 'LLC' },
  { name: 'Courtney Bauer',                          address: '6422 Maple Drive',         city: 'Mission',       state: 'KS', zip: '66202', entity_type: 'Individual' },
  { name: 'Julie Snider',                            address: '7236 Dalewood Lane',       city: 'Dallas',        state: 'TX', zip: '75214', entity_type: 'Individual' },
  { name: 'Perspective Design',                      address: '3500 Vintage Trail',       city: 'Woodstock',     state: 'GA', zip: '30189', entity_type: 'LLC' },
  { name: 'Eric Snider',                             address: '9 Veneto',                 city: 'Newport Beach', state: 'CA', zip: '92657', entity_type: 'Trust' },
  { name: 'Flanery Chiropractic',                    address: '12704 W 142nd St',         city: 'Overland Park', state: 'KS', zip: '66221', entity_type: 'LLC' },
]

/** Preferred return rate per property sheet (keyed by lowercase keyword in sheet name). */
const PREF_RETURN_BY_KEYWORD = [
  { keyword: 'columbus',    rate: 17 },
  { keyword: 'springfield', rate: 16 },
  { keyword: 'round rock',  rate: 15 },
  { keyword: 'ormond',      rate: 15 },
  { keyword: 'cudahy',      rate: 15 },
]
const DEFAULT_PREF_RETURN = 15

/** City keyword → CRM property city search string. */
const SHEET_CITY_KEYWORDS = [
  { keyword: 'round rock',   city: 'Round Rock' },
  { keyword: 'reynoldsburg', city: 'Reynoldsburg' },
  { keyword: 'west chicago', city: 'West Chicago' },
  { keyword: 'ormond',       city: 'Ormond Beach' },
  { keyword: 'peoria',       city: 'Peoria' },
  { keyword: 'columbus',     city: 'Columbus' },
  { keyword: 'cudahy',       city: 'Cudahy' },
  { keyword: 'springfield',  city: 'Springfield' },
]

/** Entity type detection from investor name. */
function detectEntityType(name) {
  const n = (name || '').toLowerCase()
  if (n.includes('trust'))                                              return 'Trust'
  if (n.includes('llc') || n.includes(' inc') || n.includes(' corp')
   || n.includes(' pa') || n.includes(' p.a.'))                        return 'LLC'
  if (n.includes('lp') || n.includes('l.p.') || n.includes('partnership')) return 'Partnership'
  return 'Individual'
}

/** Preferred return rate for a given sheet name. */
function getPrefReturn(sheetName) {
  const s = sheetName.toLowerCase()
  const match = PREF_RETURN_BY_KEYWORD.find(({ keyword }) => s.includes(keyword))
  return match ? match.rate : DEFAULT_PREF_RETURN
}

/** CRM city to search for a given sheet name. */
function getCityForSheet(sheetName) {
  const s = sheetName.toLowerCase()
  const match = SHEET_CITY_KEYWORDS.find(({ keyword }) => s.includes(keyword))
  return match ? match.city : null
}

/** Look up a portfolio property by city, returning its id or null. */
function findPropertyByCity(city) {
  if (!city) return null
  return db.prepare(
    `SELECT id, address, city FROM properties WHERE is_portfolio = 1 AND city LIKE ? LIMIT 1`
  ).get(`%${city}%`)
}

/** Normalize a cell value to a trimmed string or null. */
function cellStr(v) {
  if (v == null || v === '') return null
  return String(v).trim() || null
}

/** Coerce a cell to a positive number or null. */
function cellNum(v) {
  if (v == null || v === '') return null
  const n = parseFloat(String(v).replace(/[$,%\s,]/g, ''))
  return isFinite(n) && n > 0 ? n : null
}

/**
 * Find or create an investor profile from the running canonical list.
 * Uses fuzzy matching within the batch first, then the DB.
 * Returns { investor_id, created, updated }.
 */
function upsertInvestorProfile(canonicalList, nameRaw, extra = {}) {
  const name = nameRaw.trim()
  if (!name) return null

  // 1. Check batch-level canonical list (dedup within the file)
  let best = null, bestScore = 0
  for (const c of canonicalList) {
    const score = nameSimilarity(name, c.name)
    if (score > bestScore) { bestScore = score; best = c }
  }
  if (bestScore >= 0.75 && best) {
    // Same investor — merge any new fields
    if (extra.address && !best.address) best.address = extra.address
    if (extra.city    && !best.city)    best.city    = extra.city
    if (extra.state   && !best.state)   best.state   = extra.state
    if (extra.zip     && !best.zip)     best.zip     = extra.zip
    return best
  }

  // 2. Check existing DB investors
  const allDB = db.prepare(`SELECT id, name FROM investors`).all()
  let dbBest = null, dbScore = 0
  for (const row of allDB) {
    const score = nameSimilarity(name, row.name)
    if (score > dbScore) { dbScore = score; dbBest = row }
  }

  const contact = KNOWN_CONTACTS.find(c => nameSimilarity(name, c.name) >= 0.75)
  const entity  = extra.entity_type || (contact ? contact.entity_type : detectEntityType(name))
  const addr    = extra.address || contact?.address || null
  const city    = extra.city    || contact?.city    || null
  const state   = extra.state   || contact?.state   || null
  const zip     = extra.zip     || contact?.zip     || null

  if (dbScore >= 0.75 && dbBest) {
    // Update existing DB row with any new contact info
    db.prepare(`
      UPDATE investors SET
        entity_type  = COALESCE(NULLIF(entity_type,'Individual'), ?),
        address      = COALESCE(address, ?),
        city         = COALESCE(city, ?),
        state        = COALESCE(state, ?),
        zip          = COALESCE(zip, ?),
        is_incomplete = 0
      WHERE id = ?
    `).run(entity, addr, city, state, zip, dbBest.id)
    const entry = { investor_id: dbBest.id, name: dbBest.name, created: false, updated: true, address: addr, city, state, zip }
    canonicalList.push(entry)
    return entry
  }

  // 3. Create new investor profile
  const r = db.prepare(`
    INSERT INTO investors (name, entity_type, address, city, state, zip, is_incomplete)
    VALUES (?, ?, ?, ?, ?, ?, 0)
  `).run(name, entity, addr, city, state, zip)
  const entry = { investor_id: r.lastInsertRowid, name, created: true, updated: false, address: addr, city, state, zip }
  canonicalList.push(entry)
  return entry
}

/**
 * Parse a property sheet into an array of investor rows.
 * Strategy: scan all rows looking for a header row, then extract data rows.
 */
function parsePropertySheet(ws) {
  const raw = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null })
  if (!raw.length) return []

  // Find header row: a row where ≥3 cells are non-empty strings
  let headerIdx = -1
  let nameCol = -1, addrCol = -1, cityCol = -1, stateCol = -1, zipCol = -1
  let contribCol = -1, pctCol = -1

  for (let i = 0; i < Math.min(raw.length, 20); i++) {
    const row = raw[i]
    const nonEmpty = row.filter(c => c != null && String(c).trim())
    if (nonEmpty.length < 2) continue

    // Check if this looks like a header row
    const lowered = row.map(c => (c == null ? '' : String(c).toLowerCase().trim()))
    const hasName  = lowered.findIndex(c => c.includes('name') || c.includes('investor') || c === 'investor name')
    const hasAmt   = lowered.findIndex(c => c.includes('contribution') || c.includes('amount') || c.includes('invest'))
    const hasPct   = lowered.findIndex(c => c.includes('%') || c.includes('percent') || c.includes('ownership') || c.includes('share'))

    if (hasName >= 0 && (hasAmt >= 0 || hasPct >= 0)) {
      headerIdx  = i
      nameCol    = hasName
      contribCol = hasAmt
      pctCol     = hasPct
      addrCol    = lowered.findIndex(c => c.includes('address') || c === 'addr' || c.includes('street'))
      cityCol    = lowered.findIndex(c => c === 'city' || c.includes('city'))
      stateCol   = lowered.findIndex(c => c === 'state' || c === 'st')
      zipCol     = lowered.findIndex(c => c === 'zip' || c === 'postal' || c.includes('zip'))
      break
    }
  }

  // If no clear header row found, try heuristic: first column with text, another with dollars
  if (headerIdx < 0) {
    for (let i = 0; i < Math.min(raw.length, 30); i++) {
      const row = raw[i]
      const firstText = row.findIndex(c => c != null && typeof c === 'string' && c.trim().length > 2)
      const firstNum  = row.findIndex(c => typeof c === 'number' && c > 100)
      if (firstText >= 0 && firstNum > firstText) {
        headerIdx  = i - 1  // treat previous row as header
        nameCol    = firstText
        contribCol = firstNum
        break
      }
    }
    if (headerIdx < 0) return []
  }

  const investors = []
  for (let i = headerIdx + 1; i < raw.length; i++) {
    const row  = raw[i]
    const name = cellStr(nameCol >= 0 ? row[nameCol] : row[0])
    if (!name) continue
    // Skip obvious totals / subtotals / headers
    const nl = name.toLowerCase()
    if (nl.startsWith('total') || nl.startsWith('subtotal') || nl.startsWith('note')
     || nl === 'investor' || nl === 'name' || nl.length < 2) continue

    const contribution = cellNum(contribCol >= 0 ? row[contribCol] : null)
    const percentage   = cellNum(pctCol      >= 0 ? row[pctCol]     : null)
    const address      = cellStr(addrCol     >= 0 ? row[addrCol]    : null)
    const city         = cellStr(cityCol     >= 0 ? row[cityCol]    : null)
    const state        = cellStr(stateCol    >= 0 ? row[stateCol]   : null)
    const zip          = cellStr(zipCol      >= 0 ? row[zipCol]     : null)

    if (!contribution && !percentage && !address) continue  // likely empty row

    investors.push({ name, contribution, percentage, address, city, state, zip })
  }
  return investors
}

/**
 * Parse the "Investor Allocataions" sheet.
 * Expects: investor names in column A, property columns across the top.
 */
function parseAllocationsSheet(ws) {
  const raw = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null })
  if (!raw.length) return { investors: [], properties: [] }

  // Find the header row with property names
  let headerIdx = -1
  for (let i = 0; i < Math.min(raw.length, 15); i++) {
    const nonEmpty = raw[i].filter(c => c != null && String(c).trim()).length
    if (nonEmpty >= 4) { headerIdx = i; break }
  }
  if (headerIdx < 0) return { investors: [], properties: [] }

  const headerRow = raw[headerIdx]
  const properties = headerRow.slice(1).map(cellStr).filter(Boolean)

  const investors = []
  for (let i = headerIdx + 1; i < raw.length; i++) {
    const row  = raw[i]
    const name = cellStr(row[0])
    if (!name) continue
    const nl = name.toLowerCase()
    if (nl.startsWith('total') || nl.startsWith('subtotal') || nl.length < 2) continue
    const contributions = {}
    properties.forEach((prop, j) => {
      const v = cellNum(row[j + 1])
      if (v) contributions[prop] = v
    })
    investors.push({ name, contributions })
  }
  return { investors, properties }
}

/** Main bulk-import orchestration. */
function runBulkImport(workbook) {
  const summary = {
    sheets_found: [],
    investors_created: [],
    investors_updated: [],
    links_created: [],
    links_skipped: [],
    unmatched_properties: [],
    errors: [],
  }

  // Batch-level canonical investor list (deduplicates within file)
  const canonical = []

  // 1. Find the allocations sheet
  const allocSheetName = workbook.SheetNames.find(n => n.toLowerCase().includes('allocat'))
  if (allocSheetName) {
    try {
      summary.sheets_found.push(`[master] ${allocSheetName}`)
      parseAllocationsSheet(workbook.Sheets[allocSheetName])  // populate canonical
    } catch (e) {
      summary.errors.push(`Allocations sheet parse error: ${e.message}`)
    }
  }

  // 2. Process each known property sheet
  const PROPERTY_KEYWORDS = ['round rock','reynoldsburg','west chicago','ormond','peoria','columbus','cudahy','springfield']

  for (const sheetName of workbook.SheetNames) {
    const sLow = sheetName.toLowerCase()
    if (!PROPERTY_KEYWORDS.some(kw => sLow.includes(kw))) continue

    summary.sheets_found.push(sheetName)

    const prefReturn = getPrefReturn(sheetName)
    const cityHint   = getCityForSheet(sheetName)
    const property   = findPropertyByCity(cityHint)

    if (!property) {
      summary.unmatched_properties.push({ sheet: sheetName, city_hint: cityHint })
    }

    let rows
    try {
      rows = parsePropertySheet(workbook.Sheets[sheetName])
    } catch (e) {
      summary.errors.push(`Sheet "${sheetName}" parse error: ${e.message}`)
      continue
    }

    for (const row of rows) {
      let entry
      try {
        entry = upsertInvestorProfile(canonical, row.name, {
          address: row.address, city: row.city, state: row.state, zip: row.zip,
        })
        if (!entry) continue

        if (entry.created) summary.investors_created.push(entry.name)
        else if (entry.updated) summary.investors_updated.push(entry.name)

      } catch (e) {
        summary.errors.push(`Investor "${row.name}": ${e.message}`)
        continue
      }

      // Create investor_property_link
      if (property) {
        try {
          const existing = db.prepare(
            `SELECT id FROM investor_property_links WHERE investor_id = ? AND property_id = ?`
          ).get(entry.investor_id, property.id)

          if (existing) {
            db.prepare(`
              UPDATE investor_property_links
              SET contribution = ?, ownership_percentage = ?, preferred_return_rate = ?
              WHERE id = ?
            `).run(row.contribution ?? 0, row.percentage ?? null, prefReturn, existing.id)
            summary.links_skipped.push(`${entry.name} → ${property.address} (updated)`)
          } else {
            db.prepare(`
              INSERT INTO investor_property_links
                (investor_id, property_id, contribution, ownership_percentage, preferred_return_rate)
              VALUES (?, ?, ?, ?, ?)
            `).run(entry.investor_id, property.id, row.contribution ?? 0, row.percentage ?? null, prefReturn)
            summary.links_created.push(`${entry.name} → ${property.address}`)
          }
        } catch (e) {
          summary.errors.push(`Link "${row.name}" → "${property.address}": ${e.message}`)
        }
      }
    }
  }

  // 3. Apply hardcoded contact data to any investor already in DB whose address is missing
  for (const contact of KNOWN_CONTACTS) {
    const allDB = db.prepare(`SELECT id, name FROM investors`).all()
    let bestId = null, bestScore = 0
    for (const row of allDB) {
      const score = nameSimilarity(contact.name, row.name)
      if (score > bestScore) { bestScore = score; bestId = row.id }
    }
    if (bestScore >= 0.70 && bestId) {
      db.prepare(`
        UPDATE investors SET
          entity_type  = COALESCE(NULLIF(entity_type,'Individual'), ?),
          address      = COALESCE(address, ?),
          city         = COALESCE(city, ?),
          state        = COALESCE(state, ?),
          zip          = COALESCE(zip, ?)
        WHERE id = ?
      `).run(contact.entity_type, contact.address, contact.city, contact.state, contact.zip ?? null, bestId)
    }
  }

  return summary
}

// ── Bulk import route — must be before /:id ───────────────────────────────────

router.post('/bulk-import', upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' })
  try {
    const workbook = XLSX.read(req.file.buffer, { type: 'buffer' })
    const summary  = runBulkImport(workbook)
    res.json({ ok: true, ...summary })
  } catch (err) {
    console.error('[investors] Bulk import error:', err)
    res.status(500).json({ error: err.message })
  }
})

// ── Preferred return helpers ──────────────────────────────────────────────────

/** Compute accrued preferred return for a link row (days since created_at). */
function calcPrefReturn(link) {
  const rate         = Number(link.preferred_return_rate) || 0
  const contribution = Number(link.contribution) || 0
  const createdAt    = link.created_at
  if (!rate || !createdAt) return 0
  const days = (Date.now() - new Date(createdAt.replace(' ', 'T') + 'Z').getTime()) / 86_400_000
  return contribution * (rate / 100) * (days / 365)
}

// ── List investors with computed stats ────────────────────────────────────────

router.get('/', (req, res) => {
  const { search = '', entity_type = '', incomplete = '', limit = 100, offset = 0 } = req.query
  const conds  = []
  const params = []

  if (search) {
    conds.push(`(i.name LIKE ? OR i.email LIKE ? OR i.city LIKE ? OR i.phone LIKE ?)`)
    const like = `%${search}%`
    params.push(like, like, like, like)
  }
  if (entity_type) { conds.push(`i.entity_type = ?`); params.push(entity_type) }
  if (incomplete === '1') { conds.push(`i.is_incomplete = 1`) }

  const where = conds.length ? `WHERE ${conds.join(' AND ')}` : ''

  const total = db.prepare(`SELECT COUNT(*) AS n FROM investors i ${where}`).get(...params).n

  const rows = db.prepare(`
    SELECT
      i.id, i.name, i.email, i.phone, i.entity_type, i.accreditation_status,
      i.address, i.city, i.state, i.zip, i.notes, i.is_incomplete, i.created_at,
      COALESCE(SUM(ipl.contribution), 0)           AS total_invested,
      COUNT(DISTINCT ipl.property_id)              AS num_properties,
      AVG(ipl.preferred_return_rate)               AS avg_preferred_return_rate
    FROM investors i
    LEFT JOIN investor_property_links ipl ON ipl.investor_id = i.id
    ${where}
    GROUP BY i.id
    ORDER BY i.name ASC
    LIMIT ? OFFSET ?
  `).all(...params, Number(limit), Number(offset))

  res.json({ total, rows })
})

// ── Name matching endpoint — must be before /:id ──────────────────────────────

router.post('/match', (req, res) => {
  const { names } = req.body   // [{ name, contribution, preferred_return }]
  if (!Array.isArray(names) || names.length === 0) {
    return res.status(400).json({ error: 'names array is required' })
  }

  const allProfiles = db.prepare(`SELECT id, name FROM investors`).all()

  const results = names.map(item => {
    const name = String(item.name || '').trim()
    if (!name) return { name, status: 'skip' }

    let bestScore = 0
    let bestMatch = null

    for (const p of allProfiles) {
      const score = nameSimilarity(name, p.name)
      if (score > bestScore) { bestScore = score; bestMatch = p }
    }

    if (bestScore >= 0.90 && bestMatch) {
      return { name, status: 'auto', investor_id: bestMatch.id, matched_name: bestMatch.name, score: bestScore }
    } else if (bestScore >= 0.60 && bestMatch) {
      return { name, status: 'review', investor_id: bestMatch.id, matched_name: bestMatch.name, score: bestScore }
    } else {
      return { name, status: 'new', investor_id: null, score: bestScore }
    }
  })

  res.json(results)
})

// ── Confirm a pending match (user approved it) ────────────────────────────────

router.post('/match/confirm', (req, res) => {
  const { investor_id, property_id, contribution, preferred_return_rate } = req.body
  if (!investor_id || !property_id) {
    return res.status(400).json({ error: 'investor_id and property_id are required' })
  }

  const existing = db.prepare(
    `SELECT id FROM investor_property_links WHERE investor_id = ? AND property_id = ?`
  ).get(investor_id, property_id)

  if (existing) {
    db.prepare(`UPDATE investor_property_links SET contribution = ?, preferred_return_rate = ? WHERE id = ?`)
      .run(contribution ?? 0, preferred_return_rate ?? null, existing.id)
  } else {
    db.prepare(`INSERT INTO investor_property_links (investor_id, property_id, contribution, preferred_return_rate) VALUES (?, ?, ?, ?)`)
      .run(investor_id, property_id, contribution ?? 0, preferred_return_rate ?? null)
  }

  res.json({ ok: true })
})

// ── Sub-resource DELETE routes — must be before /:id ─────────────────────────

router.delete('/links/:linkId', (req, res) => {
  db.prepare(`DELETE FROM investor_property_links WHERE id = ?`).run(req.params.linkId)
  res.status(204).end()
})

router.patch('/links/:linkId', (req, res) => {
  const { contribution, ownership_percentage, preferred_return_rate } = req.body
  const link = db.prepare(`SELECT * FROM investor_property_links WHERE id = ?`).get(req.params.linkId)
  if (!link) return res.status(404).json({ error: 'Link not found' })
  db.prepare(`
    UPDATE investor_property_links
    SET contribution = ?, ownership_percentage = ?, preferred_return_rate = ?
    WHERE id = ?
  `).run(
    contribution         ?? link.contribution,
    ownership_percentage ?? link.ownership_percentage,
    preferred_return_rate ?? link.preferred_return_rate,
    req.params.linkId,
  )
  res.json(db.prepare(`SELECT * FROM investor_property_links WHERE id = ?`).get(req.params.linkId))
})

router.delete('/distributions/:distId', (req, res) => {
  db.prepare(`DELETE FROM investor_distributions WHERE id = ?`).run(req.params.distId)
  res.status(204).end()
})

// ── Single investor — full detail ─────────────────────────────────────────────

router.get('/:id', (req, res) => {
  const inv = db.prepare(`SELECT * FROM investors WHERE id = ?`).get(req.params.id)
  if (!inv) return res.status(404).json({ error: 'Not found' })

  // Property links with pref return calculations
  const links = db.prepare(`
    SELECT
      ipl.id, ipl.investor_id, ipl.property_id,
      ipl.contribution, ipl.ownership_percentage, ipl.preferred_return_rate,
      ipl.created_at,
      p.address AS property_address, p.city AS property_city, p.state AS property_state,
      p.listing_status,
      COALESCE((
        SELECT SUM(d.amount) FROM investor_distributions d
        WHERE d.investor_id = ipl.investor_id AND d.property_id = ipl.property_id
      ), 0) AS total_distributions_received
    FROM investor_property_links ipl
    JOIN properties p ON p.id = ipl.property_id
    WHERE ipl.investor_id = ?
    ORDER BY ipl.created_at DESC
  `).all(req.params.id).map(link => {
    const accrued = calcPrefReturn(link)
    const net_owed = Math.max(0, accrued - (link.total_distributions_received || 0))
    return { ...link, accrued_preferred_return: accrued, net_preferred_return_owed: net_owed }
  })

  // Distributions
  const distributions = db.prepare(`
    SELECT d.*, p.address AS property_address
    FROM investor_distributions d
    LEFT JOIN properties p ON p.id = d.property_id
    WHERE d.investor_id = ?
    ORDER BY d.distribution_date DESC, d.id DESC
  `).all(req.params.id)

  // Portfolio summary
  const total_invested      = links.reduce((s, l) => s + (l.contribution || 0), 0)
  const total_distributions = distributions.reduce((s, d) => s + (d.amount || 0), 0)
  const total_accrued       = links.reduce((s, l) => s + l.accrued_preferred_return, 0)
  const net_preferred_owed  = links.reduce((s, l) => s + l.net_preferred_return_owed, 0)

  res.json({
    ...inv,
    portfolio_summary: {
      total_invested,
      num_properties:   links.length,
      total_distributions,
      total_accrued_preferred_return: total_accrued,
      net_preferred_return_owed: net_preferred_owed,
    },
    links,
    distributions,
  })
})

// ── Create investor ───────────────────────────────────────────────────────────

router.post('/', (req, res) => {
  const {
    name, entity_type, email, phone,
    address, city, state, zip,
    tax_id, accreditation_status, notes,
    // legacy fields kept for backward compat
    type, total_investments, preferred_tenant_brands, preferred_states,
    min_deal_size, max_deal_size,
  } = req.body

  if (!name?.trim()) return res.status(400).json({ error: 'Name is required' })

  const r = db.prepare(`
    INSERT INTO investors
      (name, entity_type, type, email, phone, address, city, state, zip,
       tax_id, accreditation_status, notes,
       total_investments, preferred_tenant_brands, preferred_states,
       min_deal_size, max_deal_size, is_incomplete)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)
  `).run(
    name.trim(),
    entity_type || 'Individual',
    type || 'individual',
    email || null, phone || null,
    address || null, city || null, state || null, zip || null,
    tax_id || null,
    accreditation_status || 'Accredited',
    notes || null,
    total_investments || null,
    preferred_tenant_brands ? JSON.stringify(preferred_tenant_brands) : null,
    preferred_states        ? JSON.stringify(preferred_states)        : null,
    min_deal_size || null, max_deal_size || null,
  )

  res.status(201).json(db.prepare(`SELECT * FROM investors WHERE id = ?`).get(r.lastInsertRowid))
})

// ── Update investor ───────────────────────────────────────────────────────────

router.patch('/:id', (req, res) => {
  const inv = db.prepare(`SELECT * FROM investors WHERE id = ?`).get(req.params.id)
  if (!inv) return res.status(404).json({ error: 'Not found' })

  const {
    name, entity_type, email, phone,
    address, city, state, zip,
    tax_id, accreditation_status, notes, is_incomplete,
    type, total_investments, preferred_tenant_brands, preferred_states,
    min_deal_size, max_deal_size,
  } = req.body

  db.prepare(`
    UPDATE investors SET
      name = ?, entity_type = ?, type = ?,
      email = ?, phone = ?,
      address = ?, city = ?, state = ?, zip = ?,
      tax_id = ?, accreditation_status = ?, notes = ?,
      is_incomplete = ?,
      total_investments = ?, preferred_tenant_brands = ?, preferred_states = ?,
      min_deal_size = ?, max_deal_size = ?
    WHERE id = ?
  `).run(
    name        ?? inv.name,
    entity_type ?? inv.entity_type ?? 'Individual',
    type        ?? inv.type        ?? 'individual',
    email       !== undefined ? (email || null)   : inv.email,
    phone       !== undefined ? (phone || null)   : inv.phone,
    address     !== undefined ? (address || null) : inv.address,
    city        !== undefined ? (city    || null) : inv.city,
    state       !== undefined ? (state   || null) : inv.state,
    zip         !== undefined ? (zip     || null)  : inv.zip,
    tax_id      !== undefined ? (tax_id  || null)  : inv.tax_id,
    accreditation_status ?? inv.accreditation_status ?? 'Accredited',
    notes       !== undefined ? (notes   || null)  : inv.notes,
    is_incomplete !== undefined ? (is_incomplete ? 1 : 0) : inv.is_incomplete,
    total_investments !== undefined ? (total_investments || null)   : inv.total_investments,
    preferred_tenant_brands !== undefined
      ? (preferred_tenant_brands ? JSON.stringify(preferred_tenant_brands) : null)
      : inv.preferred_tenant_brands,
    preferred_states !== undefined
      ? (preferred_states ? JSON.stringify(preferred_states) : null)
      : inv.preferred_states,
    min_deal_size !== undefined ? (min_deal_size || null) : inv.min_deal_size,
    max_deal_size !== undefined ? (max_deal_size || null) : inv.max_deal_size,
    req.params.id,
  )

  res.json(db.prepare(`SELECT * FROM investors WHERE id = ?`).get(req.params.id))
})

// ── Delete investor ───────────────────────────────────────────────────────────

router.delete('/:id', (req, res) => {
  db.prepare(`DELETE FROM investors WHERE id = ?`).run(req.params.id)
  res.status(204).end()
})

// ── Property links ────────────────────────────────────────────────────────────

router.get('/:id/links', (req, res) => {
  const links = db.prepare(`
    SELECT
      ipl.*, p.address AS property_address, p.city AS property_city,
      p.state AS property_state, p.listing_status
    FROM investor_property_links ipl
    JOIN properties p ON p.id = ipl.property_id
    WHERE ipl.investor_id = ?
    ORDER BY ipl.created_at DESC
  `).all(req.params.id)

  res.json(links.map(link => {
    const accrued = calcPrefReturn(link)
    const total_dist = db.prepare(`
      SELECT COALESCE(SUM(amount), 0) AS s
      FROM investor_distributions
      WHERE investor_id = ? AND property_id = ?
    `).get(req.params.id, link.property_id).s
    return { ...link, accrued_preferred_return: accrued, net_preferred_return_owed: Math.max(0, accrued - total_dist) }
  }))
})

router.post('/:id/links', (req, res) => {
  const { property_id, contribution, ownership_percentage, preferred_return_rate } = req.body
  if (!property_id) return res.status(400).json({ error: 'property_id is required' })

  const inv = db.prepare(`SELECT id FROM investors WHERE id = ?`).get(req.params.id)
  if (!inv) return res.status(404).json({ error: 'Investor not found' })

  const existing = db.prepare(
    `SELECT id FROM investor_property_links WHERE investor_id = ? AND property_id = ?`
  ).get(req.params.id, property_id)

  if (existing) {
    db.prepare(`
      UPDATE investor_property_links
      SET contribution = ?, ownership_percentage = ?, preferred_return_rate = ?
      WHERE id = ?
    `).run(contribution ?? 0, ownership_percentage ?? null, preferred_return_rate ?? null, existing.id)
    // Mark investor as no longer incomplete if they have a real link
    db.prepare(`UPDATE investors SET is_incomplete = 0 WHERE id = ? AND is_incomplete = 1`).run(req.params.id)
    return res.json(db.prepare(`SELECT * FROM investor_property_links WHERE id = ?`).get(existing.id))
  }

  const r = db.prepare(`
    INSERT INTO investor_property_links (investor_id, property_id, contribution, ownership_percentage, preferred_return_rate)
    VALUES (?, ?, ?, ?, ?)
  `).run(req.params.id, property_id, contribution ?? 0, ownership_percentage ?? null, preferred_return_rate ?? null)

  // Mark investor as no longer incomplete
  db.prepare(`UPDATE investors SET is_incomplete = 0 WHERE id = ? AND is_incomplete = 1`).run(req.params.id)

  res.status(201).json(db.prepare(`SELECT * FROM investor_property_links WHERE id = ?`).get(r.lastInsertRowid))
})

// ── Distributions ─────────────────────────────────────────────────────────────

router.get('/:id/distributions', (req, res) => {
  const rows = db.prepare(`
    SELECT d.*, p.address AS property_address
    FROM investor_distributions d
    LEFT JOIN properties p ON p.id = d.property_id
    WHERE d.investor_id = ?
    ORDER BY d.distribution_date DESC, d.id DESC
  `).all(req.params.id)
  res.json(rows)
})

router.post('/:id/distributions', (req, res) => {
  const { property_id, amount, distribution_date, distribution_type = 'Preferred Return', notes } = req.body
  if (!amount || !distribution_date) {
    return res.status(400).json({ error: 'amount and distribution_date are required' })
  }
  const valid = ['Preferred Return', 'Principal', 'Profit']
  if (!valid.includes(distribution_type)) {
    return res.status(400).json({ error: `distribution_type must be one of: ${valid.join(', ')}` })
  }

  const r = db.prepare(`
    INSERT INTO investor_distributions (investor_id, property_id, amount, distribution_date, distribution_type, notes)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(req.params.id, property_id || null, Number(amount), distribution_date, distribution_type, notes || null)

  res.status(201).json(db.prepare(`
    SELECT d.*, p.address AS property_address
    FROM investor_distributions d
    LEFT JOIN properties p ON p.id = d.property_id
    WHERE d.id = ?
  `).get(r.lastInsertRowid))
})

export default router
