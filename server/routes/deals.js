import { Router } from 'express'
import multer from 'multer'
import db from '../db.js'
import { parseMarketingBuffer, abstractLease, parsePsaBuffer, parseProposalBuffer, classifyDealDocument } from './management.js'
import { normalizeAddr } from '../utils/normalize.js'

const router = Router()
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 30 * 1024 * 1024 } })

const SELECT = `
  SELECT
    d.id, d.property_id, d.stage, d.close_date, d.notes, d.title, d.source,
    d.due_diligence_days, d.dd_deadline, d.earnest_money, d.created_at,
    COALESCE(d.purchase_price, d.offer_price)  AS purchase_price,
    COALESCE(d.tenant, t.name)                 AS tenant,
    COALESCE(d.address, p.address)             AS address,
    COALESCE(d.city,    p.city)                AS city,
    COALESCE(d.state,   p.state)               AS state,
    COALESCE(d.cap_rate, p.cap_rate)           AS cap_rate,
    COALESCE(d.lease_type, p.lease_type)       AS lease_type,
    d.noi, d.list_price, d.building_size, d.year_built, d.property_type,
    d.guarantor, d.permitted_use, d.lease_commencement, d.lease_expiration,
    d.lease_term, d.base_rent, d.annual_rent, d.rent_escalations,
    d.renewal_options, d.renewal_notice, d.security_deposit, d.lease_notes, d.lease_abstract,
    d.renewal_option_count, d.renewal_option_length, d.renewal_option_increase,
    d.psa_abstract, d.effective_date, d.earnest_due_date, d.title_objection_date,
    d.is_multi_tenant,
    p.address    AS property_address,
    p.list_price AS property_list_price,
    p.lease_end,
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

// ── Auto-link: match deal address to a market property ────────────────────────
function tryAutoLink(dealId, address) {
  if (!address || !address.trim()) return null
  const match = db.prepare(
    `SELECT id FROM properties WHERE LOWER(TRIM(address)) = LOWER(TRIM(?))`
  ).get(address)
  if (match) {
    db.prepare('UPDATE deals SET property_id = ? WHERE id = ?').run(match.id, dealId)
    console.log(`[deals] auto-linked deal ${dealId} → property ${match.id} (address: "${address}")`)
    return match.id
  }
  return null
}

router.get('/', (req, res) => {
  res.json(db.prepare(SELECT + " WHERE (d.status IS NULL OR d.status = 'active') ORDER BY d.id DESC").all())
})

router.get('/dropped', (req, res) => {
  res.json(db.prepare(SELECT + " WHERE d.status = 'dropped' ORDER BY d.id DESC").all())
})

router.post('/:id/close', (req, res) => {
  console.log('[deals] POST /:id/close — id:', req.params.id)
  const deal = dealResponse(req.params.id)   // includes tenants + rolled-up fields
  if (!deal) return res.status(404).json({ error: 'Not found' })

  // Resolve (or create) the portfolio property, then carry the deal's details over.
  let propertyId = deal.property_id
  if (propertyId) {
    console.log('[deals] closing — marking linked property', propertyId, 'as portfolio')
    db.prepare('UPDATE properties SET is_portfolio = 1 WHERE id = ?').run(propertyId)
  } else if (deal.address) {
    console.log('[deals] closing — creating portfolio property from deal address:', deal.address)
    const r = db.prepare(`INSERT INTO properties (address, city, state, is_portfolio) VALUES (?, ?, ?, 1)`)
      .run(deal.address, deal.city || null, deal.state || null)
    propertyId = Number(r.lastInsertRowid)
  }
  if (propertyId) {
    try { migrateDealToProperty(deal, propertyId) }
    catch (e) { console.error('[deals] close migration failed:', e.message) }
  }

  db.prepare("UPDATE deals SET status = 'closed' WHERE id = ?").run(req.params.id)
  console.log('[deals] deal', req.params.id, 'marked closed → property', propertyId)
  res.json({ ok: true, property_id: propertyId || null })
})

// Rent-weighted WALT (years remaining) across a rent roll.
function computeWalt(tenants) {
  let num = 0, den = 0
  for (const t of tenants || []) {
    const rent = Number(t.annual_rent) || 0
    const end = parseISO(t.lease_end)
    if (!rent || !end) continue
    const now = new Date(); now.setHours(0, 0, 0, 0)
    num += rent * Math.max(0, (end - now) / (365.25 * 86400000)); den += rent
  }
  return den > 0 ? num / den : null
}

// Carry a closed deal's details onto its portfolio property. Fills only BLANK
// property fields (never clobbers existing data), lands the single-tenant lease
// abstract in the property's Lease section (property_leases), and for a
// multi-tenant deal rolls the rent roll up to NOI + a summary in the notes.
function migrateDealToProperty(deal, propertyId) {
  const multi = !!deal.is_multi_tenant

  const patch = {
    building_size: deal.building_size, year_built: deal.year_built, property_type: deal.property_type,
    noi: deal.noi, cap_rate: deal.cap_rate, list_price: deal.list_price, purchase_price: deal.purchase_price,
    annual_rent: deal.annual_rent, close_date: deal.close_date,
    year_purchased: deal.close_date ? parseInt(String(deal.close_date).slice(0, 4), 10) : null,
  }
  if (multi) {
    patch.lease_type = 'Multi-tenant'
  } else {
    patch.lease_type = deal.lease_type
    patch.lease_start = deal.lease_commencement
    patch.lease_end = deal.lease_expiration
    patch.rent_bumps = deal.rent_escalations
    patch.renewal_options = deal.renewal_options ||
      [deal.renewal_option_count && `${deal.renewal_option_count} option(s)`, deal.renewal_option_length, deal.renewal_option_increase].filter(Boolean).join(' · ') || null
  }
  const cols = Object.keys(patch).filter(k => patch[k] != null && patch[k] !== '')
  if (cols.length) {
    const sets = cols.map(c => `${c} = COALESCE(${c}, ?)`).join(', ')
    db.prepare(`UPDATE properties SET ${sets}, updated_at = CURRENT_TIMESTAMP WHERE id = ?`).run(...cols.map(c => patch[c]), propertyId)
  }

  // Tenant → tenant_brand_id (find-or-create), only if the property has none.
  const tenantName = String(deal.tenant || '').trim()
  if (tenantName && !db.prepare('SELECT tenant_brand_id FROM properties WHERE id = ?').get(propertyId)?.tenant_brand_id) {
    const existing = db.prepare('SELECT id FROM tenant_brands WHERE name = ? COLLATE NOCASE').get(tenantName)
    const brandId = existing ? existing.id : Number(db.prepare('INSERT INTO tenant_brands (name) VALUES (?)').run(tenantName).lastInsertRowid)
    db.prepare('UPDATE properties SET tenant_brand_id = ? WHERE id = ?').run(brandId, propertyId)
  }

  if (multi) {
    const roster = (deal.tenants || []).map(t => {
      const bits = [t.tenant_name || 'Tenant', t.suite && `Ste ${t.suite}`,
        t.square_feet && `${Math.round(t.square_feet).toLocaleString()} SF`,
        t.annual_rent && `$${Math.round(t.annual_rent).toLocaleString()}/yr`,
        t.lease_end && `exp ${t.lease_end}`].filter(Boolean)
      return `  • ${bits.join(' · ')}`
    }).join('\n')
    const walt = computeWalt(deal.tenants)
    const summary = `Multi-tenant rent roll (migrated from pipeline on close):\n${roster || '  (no tenants)'}\nTotal NOI: $${Math.round(deal.noi || 0).toLocaleString()}${walt != null ? ` · WALT ${walt.toFixed(1)} yrs` : ''}`
    const prop = db.prepare('SELECT notes FROM properties WHERE id = ?').get(propertyId)
    if (!String(prop?.notes || '').includes('Multi-tenant rent roll (migrated from pipeline')) {
      db.prepare('UPDATE properties SET notes = ? WHERE id = ?').run(prop?.notes ? `${prop.notes}\n\n${summary}` : summary, propertyId)
    }
  } else if (deal.lease_abstract && !db.prepare('SELECT property_id FROM property_leases WHERE property_id = ?').get(propertyId)) {
    db.prepare(`INSERT INTO property_leases (property_id, abstract, model, status, updated_at)
                VALUES (?, ?, 'migrated-from-deal', 'done', datetime('now'))`)
      .run(propertyId, deal.lease_abstract)
  }
}

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

const toISO = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
function parseISO(iso) {
  const m = String(iso || '').match(/^(\d{4})-(\d{2})-(\d{2})/); if (!m) return null
  return new Date(+m[1], +m[2] - 1, +m[3])
}
// Subtract N calendar days from an ISO date → ISO (or null).
function minusDays(iso, days) {
  const d = parseISO(iso); if (!d || days == null) return null
  d.setDate(d.getDate() - days); return toISO(d)
}
function addCalendarDays(iso, days) {
  const d = parseISO(iso); if (!d) return null
  d.setDate(d.getDate() + days); return toISO(d)
}
function addBusinessDays(iso, days) {
  const d = parseISO(iso); if (!d) return null
  let added = 0
  while (added < days) { d.setDate(d.getDate() + 1); const dow = d.getDay(); if (dow !== 0 && dow !== 6) added++ }
  return toISO(d)
}
// Resolve one timing trigger to an ISO date. `anchorDate` is the date the offset
// is measured from (the effective or dd date). Fixed triggers ignore the anchor.
function computeTrigger(anchorDate, t) {
  if (!t) return null
  if (t.anchor === 'fixed' || (t.date && t.days == null)) return s_date(t.date)
  if (t.days == null || !anchorDate) return null
  return t.unit === 'business' ? addBusinessDays(anchorDate, t.days) : addCalendarDays(anchorDate, t.days)
}

// Recompute the derived PSA dates from the effective date + stored timing triggers,
// and write them back. Runs after a PSA/amendment parse or when the effective date
// (or a derived date) is edited. Writes only computed (non-null) values so it never
// wipes a date that has no rule.
function recomputePsaDates(dealId) {
  const row = db.prepare('SELECT effective_date, psa_abstract FROM deals WHERE id = ?').get(dealId)
  if (!row) return
  let terms; try { terms = JSON.parse(row.psa_abstract || '{}') } catch { terms = {} }
  const trig = terms.triggers || {}
  const resolved = { effective: row.effective_date || null, dd_deadline: null }
  const anchorFor = (t, def) => {
    const a = t?.anchor && t.anchor !== 'fixed' ? t.anchor : def
    return a === 'dd_deadline' ? resolved.dd_deadline : resolved.effective
  }
  // dd first (close may depend on it)
  resolved.dd_deadline   = computeTrigger(anchorFor(trig.dd_deadline, 'effective'), trig.dd_deadline)
  const earnest          = computeTrigger(anchorFor(trig.earnest_due, 'effective'), trig.earnest_due)
  const title            = computeTrigger(anchorFor(trig.title_objection, 'effective'), trig.title_objection)
  const close            = computeTrigger(anchorFor(trig.close, 'dd_deadline'), trig.close)

  const out = { earnest_due_date: earnest, dd_deadline: resolved.dd_deadline, title_objection_date: title, close_date: close }
  const cols = Object.keys(out).filter(k => out[k] != null)
  if (cols.length) db.prepare(`UPDATE deals SET ${cols.map(c => `${c} = ?`).join(', ')} WHERE id = ?`).run(...cols.map(c => out[c]), dealId)
}

// Pin a derived date as a FIXED trigger (used when it's edited by hand) so later
// recomputes preserve it while still updating anything downstream of it.
function setTriggerFixed(dealId, key, isoDate) {
  const row = db.prepare('SELECT psa_abstract FROM deals WHERE id = ?').get(dealId)
  let terms; try { terms = JSON.parse(row?.psa_abstract || '{}') } catch { terms = {} }
  terms.triggers = terms.triggers || {}
  terms.triggers[key] = { anchor: 'fixed', date: isoDate || null, days: null, unit: 'calendar' }
  db.prepare('UPDATE deals SET psa_abstract = ? WHERE id = ?').run(JSON.stringify(terms), dealId)
}

// A deal row + its DD vendor proposals, each with a drop-dead ORDER-BY date
// (dd_deadline − turnaround) so the report is back before due diligence expires.
function dealResponse(id) {
  const row = db.prepare(SELECT + ' WHERE d.id = ?').get(id)
  if (!row) return null
  const proposals = db.prepare('SELECT * FROM deal_proposals WHERE deal_id = ? ORDER BY id').all(id)
    .map(p => ({ ...p, order_by_date: minusDays(row.dd_deadline, p.turnaround_days) }))
  const tenants = db.prepare('SELECT * FROM deal_tenants WHERE deal_id = ? ORDER BY id').all(id)
  return { ...row, proposals, tenants }
}

// For a multi-tenant deal, roll the rent roll up onto the deal: NOI + annual rent
// = sum of tenant rents, and cap rate = NOI ÷ purchase price. Keeps the pipeline
// table, deal header, and returns calculator in sync with the tenant rows.
function recomputeRentRoll(dealId) {
  const deal = db.prepare('SELECT is_multi_tenant, purchase_price, offer_price FROM deals WHERE id = ?').get(dealId)
  if (!deal || !deal.is_multi_tenant) return
  const { total } = db.prepare('SELECT COALESCE(SUM(annual_rent), 0) AS total FROM deal_tenants WHERE deal_id = ?').get(dealId)
  const price = deal.purchase_price || deal.offer_price || null
  const cap = price ? Math.round((total / price) * 10000) / 100 : null
  db.prepare('UPDATE deals SET noi = ?, annual_rent = ?, cap_rate = COALESCE(?, cap_rate), updated_at = CURRENT_TIMESTAMP WHERE id = ?')
    .run(total || null, total || null, cap, dealId)
}

router.get('/:id', (req, res) => {
  const row = dealResponse(req.params.id)
  if (!row) return res.status(404).json({ error: 'Not found' })
  res.json(row)
})

router.post('/', (req, res) => {
  const { property_id, stage = 'loi', purchase_price, close_date, notes,
          address, city, state, tenant, cap_rate, due_diligence_days, dd_deadline, earnest_money } = req.body
  const r = db.prepare(`
    INSERT INTO deals (property_id, stage, purchase_price, close_date, notes,
                       address, city, state, tenant, cap_rate, due_diligence_days, dd_deadline, earnest_money,
                       created_at, updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?, datetime('now'), datetime('now'))
  `).run(toStr(property_id), stage, toFloat(purchase_price), toStr(close_date), toStr(notes),
         toStr(address), toStr(city), toStr(state), toStr(tenant),
         toFloat(cap_rate), toInt(due_diligence_days), toStr(dd_deadline), toFloat(earnest_money))
  // Auto-link to market property if no explicit property_id was provided
  if (!property_id && address) {
    tryAutoLink(r.lastInsertRowid, address)
  }
  res.status(201).json(db.prepare(SELECT + ' WHERE d.id = ?').get(r.lastInsertRowid))
})

router.put('/:id', (req, res) => {
  const { property_id, stage = 'loi', purchase_price, close_date, notes,
          address, city, state, tenant, cap_rate, due_diligence_days, dd_deadline, earnest_money } = req.body
  db.prepare(`
    UPDATE deals SET property_id=?, stage=?, purchase_price=?, close_date=?, notes=?,
                     address=?, city=?, state=?, tenant=?, cap_rate=?, due_diligence_days=?, dd_deadline=?, earnest_money=?,
                     updated_at=datetime('now')
    WHERE id=?
  `).run(toStr(property_id), stage, toFloat(purchase_price), toStr(close_date), toStr(notes),
         toStr(address), toStr(city), toStr(state), toStr(tenant),
         toFloat(cap_rate), toInt(due_diligence_days), toStr(dd_deadline), toFloat(earnest_money), req.params.id)
  res.json(db.prepare(SELECT + ' WHERE d.id = ?').get(req.params.id))
})

router.patch('/:id/link-property', (req, res) => {
  const { property_id } = req.body
  db.prepare('UPDATE deals SET property_id = ? WHERE id = ?').run(property_id ?? null, req.params.id)
  res.json(db.prepare(SELECT + ' WHERE d.id = ?').get(req.params.id))
})

// POST /:id/create-property — create a NEW market property from this deal's own
// details (address/city/state/tenant, with optional body overrides) and link it
// to the deal in one step. For deals whose property isn't in the CRM yet, so you
// don't have to go create it in the Properties section first.
router.post('/:id/create-property', (req, res) => {
  const deal = db.prepare('SELECT * FROM deals WHERE id = ?').get(req.params.id)
  if (!deal) return res.status(404).json({ error: 'Deal not found' })

  const address = toStr(req.body?.address ?? deal.address)?.trim()
  const city    = toStr(req.body?.city    ?? deal.city)
  const state   = toStr(req.body?.state   ?? deal.state)
  const tenant  = toStr(req.body?.tenant  ?? deal.tenant)
  if (!address) return res.status(400).json({ error: 'An address is required to create a property.' })

  // Resolve tenant name → tenant_brand_id (find existing or create), mirroring
  // how the rest of the app links tenant brands.
  let tenantBrandId = null
  if (tenant && tenant.trim()) {
    const name = tenant.trim()
    const brand = db.prepare('SELECT id FROM tenant_brands WHERE LOWER(name) = LOWER(?)').get(name)
    tenantBrandId = brand ? brand.id
      : Number(db.prepare('INSERT INTO tenant_brands (name) VALUES (?)').run(name).lastInsertRowid)
  }

  const r = db.prepare(`
    INSERT INTO properties (address, city, state, tenant_brand_id, is_portfolio, addr_key)
    VALUES (?, ?, ?, ?, 0, ?)
  `).run(address, city, state, tenantBrandId, normalizeAddr(address, city || '', state || '', '') || null)

  const propertyId = Number(r.lastInsertRowid)
  db.prepare('UPDATE deals SET property_id = ? WHERE id = ?').run(propertyId, deal.id)
  res.status(201).json(db.prepare(SELECT + ' WHERE d.id = ?').get(deal.id))
})

router.patch('/:id/stage', (req, res) => {
  const { stage } = req.body
  if (!stage) return res.status(400).json({ error: 'stage is required' })
  db.prepare(`UPDATE deals SET stage = ?, updated_at = datetime('now') WHERE id = ?`).run(stage, req.params.id)
  res.json(db.prepare(SELECT + ' WHERE d.id = ?').get(req.params.id))
})

router.delete('/:id', (req, res) => {
  db.prepare('DELETE FROM deals WHERE id = ?').run(req.params.id)
  res.status(204).end()
})

// ── Inline single-field edit + document parser (deal detail page) ─────────────

// value coercion helpers (mirror the property parser's normalization)
const s_str = v => { if (v == null) return null; const s = String(v).trim(); return s || null }
const s_num = v => { if (v == null || v === '') return null; const n = parseFloat(String(v).replace(/[^0-9.\-]/g, '')); return Number.isFinite(n) ? n : null }
const s_int = v => { const n = s_num(v); return n == null ? null : Math.round(n) }
const s_date = v => {
  const str = s_str(v); if (!str) return null
  const iso = str.match(/^(\d{4})-(\d{2})-(\d{2})/); if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`
  const d = new Date(str); return Number.isNaN(d.getTime()) ? str : d.toISOString().slice(0, 10)
}
// base_rent free-text → annual number ("$10,000/month" → 120000)
const s_annual = v => { const n = s_num(v); if (n == null) return null; return /month|\/mo|per mo|monthly/i.test(String(v)) ? Math.round(n * 12) : Math.round(n) }

// Columns editable one-at-a-time via inline click-to-edit, mapped to a type.
const DEAL_EDITABLE = {
  address:'text', city:'text', state:'text', tenant:'text', notes:'text', source:'text',
  purchase_price:'real', cap_rate:'real', noi:'real', list_price:'real',
  building_size:'real', year_built:'int', property_type:'text', earnest_money:'real',
  due_diligence_days:'int', close_date:'date', dd_deadline:'date',
  effective_date:'date', earnest_due_date:'date', title_objection_date:'date',
  lease_type:'text', guarantor:'text', permitted_use:'text',
  lease_commencement:'date', lease_expiration:'date', lease_term:'text',
  base_rent:'text', annual_rent:'real', rent_escalations:'text',
  renewal_option_count:'int', renewal_option_length:'text', renewal_option_increase:'text',
  renewal_options:'text', renewal_notice:'text', security_deposit:'text', lease_notes:'text',
}
// Everything the parser may write (includes the read-only abstract JSON blobs).
const DEAL_WRITABLE = new Set([...Object.keys(DEAL_EDITABLE), 'lease_abstract', 'psa_abstract'])

function coerce(type, raw) {
  if (raw == null) return null
  if (type === 'text' || type === 'date') return type === 'date' ? s_date(raw) : s_str(raw)
  if (type === 'int') return s_int(raw)
  return s_num(raw)
}

// PATCH /api/deals/:id/field  body: { column, value } — single-column update.
router.patch('/:id/field', (req, res) => {
  const dealId = parseInt(req.params.id, 10)
  const { column, value } = req.body || {}
  const type = DEAL_EDITABLE[column]
  if (!type) return res.status(400).json({ error: `Field "${column}" is not editable` })
  try {
    const result = db.prepare(`UPDATE deals SET ${column} = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`)
      .run(coerce(type, value), dealId)
    if (result.changes === 0) return res.status(404).json({ error: `Deal ${dealId} not found` })
    // Keep the PSA timeline consistent: editing the effective date re-derives every
    // dependent date; editing a derived date pins it (fixed) and updates downstream.
    const TRIGGER_FOR = { earnest_due_date: 'earnest_due', dd_deadline: 'dd_deadline', title_objection_date: 'title_objection', close_date: 'close' }
    if (column === 'effective_date') {
      recomputePsaDates(dealId)
    } else if (TRIGGER_FOR[column]) {
      setTriggerFixed(dealId, TRIGGER_FOR[column], s_date(value))
      recomputePsaDates(dealId)
    }
    res.json(dealResponse(dealId))
  } catch (err) {
    console.error('[deals] field update error:', err.message)
    res.status(500).json({ error: err.message || 'Failed to update field' })
  }
})

// Map a parsed OM / marketing package into deal columns.
function mapOmToDeal(d) {
  return {
    address: s_str(d.address), city: s_str(d.city), state: s_str(d.state), tenant: s_str(d.tenant),
    building_size: s_num(d.building_size), year_built: s_int(d.year_built), property_type: s_str(d.property_type),
    lease_type: s_str(d.lease_type), lease_commencement: s_date(d.lease_start), lease_expiration: s_date(d.lease_end),
    annual_rent: s_annual(d.annual_rent), rent_escalations: s_str(d.rent_bumps), renewal_options: s_str(d.renewal_options),
    noi: s_num(d.noi), cap_rate: s_num(d.cap_rate), list_price: s_num(d.list_price),
  }
}
// Constrain a free-text lease type to one of our five canonical values.
function normalizeLeaseType(v) {
  const s = String(v || '').toLowerCase().trim()
  if (!s) return null
  if (s.includes('ground')) return 'Ground Lease'
  if (s.includes('triple') || s.includes('absolute') || s.includes('nnn')) return 'NNN'
  if (s.includes('double') || s.includes('nn')) return 'NN'
  if (s.includes('modified')) return 'Modified Gross'
  if (s.includes('gross') || s.includes('full service')) return 'Gross'
  return null
}
function yesNo(v) {
  const s = String(v || '').toLowerCase().trim()
  if (!s) return null
  if (/^(y|yes|true)/.test(s)) return 'Yes'
  if (/^(n|no|false|none|flat)/.test(s)) return 'No'
  return null
}
// Map a parsed lease abstract into deal columns (+ store the full abstract JSON).
function mapLeaseToDeal(ab) {
  const sm = ab?.summary || {}
  return {
    tenant: s_str(sm.tenant), lease_type: normalizeLeaseType(sm.lease_type), guarantor: s_str(sm.guarantor),
    permitted_use: s_str(sm.permitted_use), lease_commencement: s_date(sm.commencement_date),
    lease_expiration: s_date(sm.expiration_date), lease_term: s_str(sm.term), base_rent: s_str(sm.base_rent),
    annual_rent: s_annual(sm.base_rent),
    rent_escalations: yesNo(sm.escalations_in_term) || (s_str(sm.rent_escalations) ? 'Yes' : null),
    renewal_option_count:    s_int(sm.renewal_option_count),
    renewal_option_length:   s_str(sm.renewal_option_length),
    renewal_option_increase: s_str(sm.renewal_option_increase),
    renewal_options: s_str(sm.renewal_options), renewal_notice: s_str(sm.renewal_notice),
    security_deposit: s_str(sm.security_deposit), lease_notes: s_str(ab?.notes),
    lease_abstract: JSON.stringify({ responsibilities: ab?.responsibilities || [], key_dates: ab?.key_dates || [], notes: ab?.notes || '', summary: sm }),
  }
}
// Apply a parsed PSA / amendment to a deal: merge its timing triggers into the
// stored ones (so an amendment overrides only what it changes), update effective
// date / price / earnest if present, then recompute all derived dates.
function applyPsa(dealId, parsed) {
  const existing = (() => {
    try { return JSON.parse(db.prepare('SELECT psa_abstract FROM deals WHERE id = ?').get(dealId)?.psa_abstract || '{}') } catch { return {} }
  })()
  const triggers = { ...(existing.triggers || {}) }
  for (const [k, v] of Object.entries(parsed?.triggers || {})) {
    if (v && (v.date || v.days != null)) triggers[k] = v   // only non-empty rules override
  }
  const terms = {
    buyer:  s_str(parsed?.buyer)  || existing.buyer  || null,
    seller: s_str(parsed?.seller) || existing.seller || null,
    notes:  s_str(parsed?.notes)  || existing.notes  || null,
    triggers,
  }
  const sets = { psa_abstract: JSON.stringify(terms) }
  if (s_date(parsed?.effective_date))     sets.effective_date  = s_date(parsed.effective_date)
  if (s_num(parsed?.purchase_price) != null) sets.purchase_price = s_num(parsed.purchase_price)
  if (s_num(parsed?.earnest_money) != null)  sets.earnest_money  = s_num(parsed.earnest_money)
  const cols = Object.keys(sets)
  db.prepare(`UPDATE deals SET ${cols.map(c => `${c} = ?`).join(', ')}, updated_at = CURRENT_TIMESTAMP WHERE id = ?`).run(...cols.map(c => sets[c]), dealId)
  recomputePsaDates(dealId)
  return cols
}
// Normalize a parsed DD proposal for insertion into deal_proposals.
function mapProposal(d) {
  const kind = String(d.kind || '').toLowerCase()
  return {
    kind: ['survey', 'environmental', 'pcr'].includes(kind) ? kind : 'other',
    vendor: s_str(d.vendor),
    turnaround_days: s_int(d.turnaround_days),
    turnaround_text: s_str(d.turnaround_text),
    cost: s_num(d.cost),
    notes: s_str(d.notes),
  }
}

// POST /api/deals/:id/parse — single upload box. Drop any deal document; it's
// auto-classified (OM / lease / PSA / DD proposal) and routed to the right
// parser. OM/lease/PSA auto-fill deal fields; a DD proposal (survey /
// environmental / PCR) is stored with its turnaround for a drop-dead order date.
// docType defaults to 'auto'; an explicit type skips classification.
router.post('/:id/parse', upload.array('files', 12), async (req, res) => {
  const dealId = parseInt(req.params.id, 10)
  const files = req.files || []
  if (!files.length) return res.status(400).json({ error: 'No file uploaded' })
  const deal = db.prepare('SELECT id FROM deals WHERE id = ?').get(dealId)
  if (!deal) return res.status(404).json({ error: 'Deal not found' })

  const first = files[0]
  const media = first.mimetype || 'application/pdf'

  // Spreadsheets (the deal calculator / cap table) can't be read as a PDF/image
  // by the classifier — they have a dedicated importer. Point the user there
  // instead of failing with a cryptic media-type error from the AI.
  const isSpreadsheet = /spreadsheet|excel|ms-excel|officedocument\.spreadsheet/i.test(media)
    || /\.(xlsx|xls|csv)$/i.test(first.originalname || '')
  if (isSpreadsheet) {
    return res.status(422).json({
      error: 'That looks like a spreadsheet (e.g. your deal calculator). To import the investors from it, open the property (the "Open" button) and use the Investors → "Upload calculator" button — it reads the cap table and the investors carry over to the portfolio when you close.',
    })
  }

  try {
    let docType = req.body?.docType
    if (!docType || docType === 'auto') {
      docType = await classifyDealDocument(first.buffer, media)
      if (docType === 'unknown') {
        return res.status(422).json({ error: "Couldn't tell what kind of document this is. Try an OM, lease, PSA, or a survey/environmental/PCR proposal." })
      }
    }

    // DD vendor proposal → its own row (a deal can have several).
    if (docType === 'proposal') {
      const p = mapProposal(await parseProposalBuffer(first.buffer, media))
      db.prepare(`INSERT INTO deal_proposals (deal_id, kind, vendor, turnaround_days, turnaround_text, cost, notes)
                  VALUES (?, ?, ?, ?, ?, ?, ?)`)
        .run(dealId, p.kind, p.vendor, p.turnaround_days, p.turnaround_text, p.cost, p.notes)
      return res.json({ deal: dealResponse(dealId), docType, proposal: p })
    }

    // PSA / amendment → merge timing triggers + recompute derived dates.
    if (docType === 'psa') {
      const cols = applyPsa(dealId, await parsePsaBuffer(first.buffer, media))
      return res.json({ deal: dealResponse(dealId), docType, applied: cols })
    }

    // On a multi-tenant deal, a lease becomes a rent-roll row instead of
    // overwriting the deal's single-tenant lease fields.
    if (docType === 'lease' && db.prepare('SELECT is_multi_tenant FROM deals WHERE id = ?').get(dealId)?.is_multi_tenant) {
      const docs = files.map(f => ({ buffer: f.buffer, mediaType: f.mimetype || 'application/pdf', name: f.originalname, doc_type: 'lease' }))
      const sm = (await abstractLease(docs))?.summary || {}
      const t = {
        tenant_name: s_str(sm.tenant), lease_type: normalizeLeaseType(sm.lease_type),
        annual_rent: s_annual(sm.base_rent), lease_start: s_date(sm.commencement_date),
        lease_end: s_date(sm.expiration_date), rent_escalations: yesNo(sm.escalations_in_term) || s_str(sm.rent_escalations),
        renewal_options: s_str(sm.renewal_options),
        renewal_option_count: s_int(sm.renewal_option_count),
        renewal_option_length: s_str(sm.renewal_option_length),
        renewal_option_increase: s_str(sm.renewal_option_increase),
      }
      const cols = Object.keys(t).filter(k => t[k] != null && t[k] !== '')
      db.prepare(`INSERT INTO deal_tenants (deal_id${cols.length ? ', ' + cols.join(', ') : ''}) VALUES (?${cols.map(() => ', ?').join('')})`)
        .run(dealId, ...cols.map(k => t[k]))
      recomputeRentRoll(dealId)
      return res.json({ deal: dealResponse(dealId), docType, tenantAdded: t.tenant_name || 'tenant' })
    }

    // OM / lease → auto-fill deal fields.
    let patch
    if (docType === 'om') {
      patch = mapOmToDeal(await parseMarketingBuffer(first.buffer, media))
    } else if (docType === 'lease') {
      const docs = files.map(f => ({ buffer: f.buffer, mediaType: f.mimetype || 'application/pdf', name: f.originalname, doc_type: 'lease' }))
      patch = mapLeaseToDeal(await abstractLease(docs))
    } else {
      return res.status(400).json({ error: 'Unknown docType' })
    }
    const cols = Object.keys(patch).filter(k => DEAL_WRITABLE.has(k) && patch[k] != null && patch[k] !== '')
    if (cols.length) {
      const sets = cols.map(c => `${c} = ?`).join(', ')
      db.prepare(`UPDATE deals SET ${sets}, updated_at = CURRENT_TIMESTAMP WHERE id = ?`).run(...cols.map(c => patch[c]), dealId)
    }
    res.json({ deal: dealResponse(dealId), docType, applied: cols })
  } catch (err) {
    console.error('[deals] parse error:', err.message)
    res.status(422).json({ error: 'Could not parse document: ' + err.message })
  }
})

// DELETE /api/deals/:id/proposals/:pid — remove a DD proposal.
router.delete('/:id/proposals/:pid', (req, res) => {
  db.prepare('DELETE FROM deal_proposals WHERE id = ? AND deal_id = ?').run(req.params.pid, req.params.id)
  res.json(dealResponse(req.params.id))
})

// ── Multi-tenant rent roll ────────────────────────────────────────────────────

// Editable rent-roll columns per tenant, with coercion types.
const TENANT_FIELDS = {
  tenant_name:'text', suite:'text', square_feet:'real', lease_type:'text', annual_rent:'real',
  lease_start:'date', lease_end:'date', rent_escalations:'text', renewal_options:'text',
  renewal_option_count:'int', renewal_option_length:'text', renewal_option_increase:'text',
}

// PATCH /api/deals/:id/multi-tenant  body: { on } — flip the deal to multi-tenant.
router.patch('/:id/multi-tenant', (req, res) => {
  const on = req.body?.on ? 1 : 0
  const r = db.prepare('UPDATE deals SET is_multi_tenant = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(on, req.params.id)
  if (r.changes === 0) return res.status(404).json({ error: 'Deal not found' })
  if (on) recomputeRentRoll(req.params.id)
  res.json(dealResponse(req.params.id))
})

// POST /api/deals/:id/tenants — add a rent-roll row (optionally with fields).
router.post('/:id/tenants', (req, res) => {
  const dealId = parseInt(req.params.id, 10)
  if (!db.prepare('SELECT id FROM deals WHERE id = ?').get(dealId)) return res.status(404).json({ error: 'Deal not found' })
  const body = req.body || {}
  const cols = Object.keys(TENANT_FIELDS).filter(k => body[k] != null && body[k] !== '')
  const vals = cols.map(k => coerce(TENANT_FIELDS[k], body[k]))
  db.prepare(`INSERT INTO deal_tenants (deal_id${cols.length ? ', ' + cols.join(', ') : ''}) VALUES (?${cols.map(() => ', ?').join('')})`)
    .run(dealId, ...vals)
  // Adding a tenant implies multi-tenant.
  db.prepare('UPDATE deals SET is_multi_tenant = 1 WHERE id = ?').run(dealId)
  recomputeRentRoll(dealId)
  res.json(dealResponse(dealId))
})

// PATCH /api/deals/:id/tenants/:tid  body: { column, value } — edit one cell.
router.patch('/:id/tenants/:tid', (req, res) => {
  const { column, value } = req.body || {}
  const type = TENANT_FIELDS[column]
  if (!type) return res.status(400).json({ error: `Field "${column}" is not editable` })
  const r = db.prepare(`UPDATE deal_tenants SET ${column} = ? WHERE id = ? AND deal_id = ?`)
    .run(coerce(type, value), req.params.tid, req.params.id)
  if (r.changes === 0) return res.status(404).json({ error: 'Tenant not found' })
  recomputeRentRoll(req.params.id)
  res.json(dealResponse(req.params.id))
})

// DELETE /api/deals/:id/tenants/:tid — remove a rent-roll row.
router.delete('/:id/tenants/:tid', (req, res) => {
  db.prepare('DELETE FROM deal_tenants WHERE id = ? AND deal_id = ?').run(req.params.tid, req.params.id)
  recomputeRentRoll(req.params.id)
  res.json(dealResponse(req.params.id))
})

export default router
