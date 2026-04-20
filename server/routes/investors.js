import { Router } from 'express'
import db from '../db.js'
import { nameSimilarity, autoLinkInvestors } from '../services/investorMatch.js'

const router = Router()

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
