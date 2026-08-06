import { Router } from 'express'
import multer from 'multer'
import db from '../db.js'
import { parseMarketingBuffer, abstractLease } from './management.js'

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
  const deal = db.prepare(SELECT + ' WHERE d.id = ?').get(req.params.id)
  if (!deal) return res.status(404).json({ error: 'Not found' })

  if (deal.property_id) {
    console.log('[deals] closing — marking linked property', deal.property_id, 'as portfolio')
    db.prepare('UPDATE properties SET is_portfolio = 1 WHERE id = ?').run(deal.property_id)
  } else if (deal.address) {
    console.log('[deals] closing — creating portfolio property from deal address:', deal.address)
    db.prepare(`
      INSERT INTO properties (address, city, state, cap_rate, list_price, is_portfolio)
      VALUES (?, ?, ?, ?, ?, 1)
    `).run(deal.address, deal.city || null, deal.state || null, deal.cap_rate || null, deal.purchase_price || null)
  }

  db.prepare("UPDATE deals SET status = 'closed' WHERE id = ?").run(req.params.id)
  console.log('[deals] deal', req.params.id, 'marked closed')
  res.json({ ok: true })
})

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

router.get('/:id', (req, res) => {
  const row = db.prepare(SELECT + ' WHERE d.id = ?').get(req.params.id)
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
  lease_type:'text', guarantor:'text', permitted_use:'text',
  lease_commencement:'date', lease_expiration:'date', lease_term:'text',
  base_rent:'text', annual_rent:'real', rent_escalations:'text',
  renewal_options:'text', renewal_notice:'text', security_deposit:'text', lease_notes:'text',
}
// Everything the parser may write (includes the read-only lease_abstract JSON).
const DEAL_WRITABLE = new Set([...Object.keys(DEAL_EDITABLE), 'lease_abstract'])

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
    res.json(db.prepare(SELECT + ' WHERE d.id = ?').get(dealId))
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
// Map a parsed lease abstract into deal columns (+ store the full abstract JSON).
function mapLeaseToDeal(ab) {
  const sm = ab?.summary || {}
  return {
    tenant: s_str(sm.tenant), lease_type: s_str(sm.lease_type), guarantor: s_str(sm.guarantor),
    permitted_use: s_str(sm.permitted_use), lease_commencement: s_date(sm.commencement_date),
    lease_expiration: s_date(sm.expiration_date), lease_term: s_str(sm.term), base_rent: s_str(sm.base_rent),
    annual_rent: s_annual(sm.base_rent), rent_escalations: s_str(sm.rent_escalations),
    renewal_options: s_str(sm.renewal_options), renewal_notice: s_str(sm.renewal_notice),
    security_deposit: s_str(sm.security_deposit), lease_notes: s_str(ab?.notes),
    lease_abstract: JSON.stringify({ responsibilities: ab?.responsibilities || [], key_dates: ab?.key_dates || [], notes: ab?.notes || '', summary: sm }),
  }
}

// POST /api/deals/:id/parse — drop an OM (docType 'om') or a lease + amendments
// (docType 'lease', multiple files) to auto-fill the deal's detail + lease
// abstract fields. Writes non-empty parsed values straight in (overwrites).
router.post('/:id/parse', upload.array('files', 12), async (req, res) => {
  const dealId = parseInt(req.params.id, 10)
  const docType = req.body?.docType
  const files = req.files || []
  if (!files.length) return res.status(400).json({ error: 'No file uploaded' })
  const deal = db.prepare('SELECT id FROM deals WHERE id = ?').get(dealId)
  if (!deal) return res.status(404).json({ error: 'Deal not found' })
  try {
    let patch
    if (docType === 'om') {
      patch = mapOmToDeal(await parseMarketingBuffer(files[0].buffer, files[0].mimetype || 'application/pdf'))
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
    res.json({ deal: db.prepare(SELECT + ' WHERE d.id = ?').get(dealId), applied: cols })
  } catch (err) {
    console.error('[deals] parse error:', err.message)
    res.status(422).json({ error: 'Could not parse document: ' + err.message })
  }
})

export default router
