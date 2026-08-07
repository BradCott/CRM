import { Router } from 'express'
import db from '../db.js'

const router = Router()

router.get('/', (req, res) => {
  // Portfolio totals
  const totals = db.prepare(`
    SELECT
      SUM(purchase_price) AS portfolio_purchase_value,
      SUM(COALESCE(
        fee_amount,
        CASE WHEN purchase_price > 0 THEN purchase_price * 1.1 * 0.015 ELSE 0 END
      )) AS fees_to_collect
    FROM properties
    WHERE is_portfolio = 1
  `).get()

  // Active investors
  const { n: active_investors_count } = db.prepare(`SELECT COUNT(*) AS n FROM investors`).get()

  // Properties under contract (portfolio listing_status flag)
  const portfolio_under_contract = db.prepare(`
    SELECT p.id, p.address, p.city, p.state, p.purchase_price,
           p.dd_end_date, p.close_date,
           t.name AS tenant_brand_name,
           'property' AS _type
    FROM properties p
    LEFT JOIN tenant_brands t ON t.id = p.tenant_brand_id
    WHERE p.is_portfolio = 1 AND p.listing_status = 'under_contract'
  `).all()

  // Pipeline deals under contract (stage = 'Under Contract' or 'under_contract')
  const deal_under_contract = db.prepare(`
    SELECT
      d.id,
      COALESCE(d.address, p.address)                   AS address,
      COALESCE(d.city,    p.city)                      AS city,
      COALESCE(d.state,   p.state)                     AS state,
      COALESCE(d.purchase_price, d.offer_price, p.purchase_price) AS purchase_price,
      d.dd_deadline                                    AS dd_end_date,
      d.close_date,
      COALESCE(t.name, d.tenant)                       AS tenant_brand_name,
      'deal'     AS _type
    FROM deals d
    LEFT JOIN properties    p ON p.id = d.property_id
    LEFT JOIN tenant_brands t ON t.id = p.tenant_brand_id
    WHERE d.stage IN ('Under Contract', 'under_contract')
      AND (d.status IS NULL OR d.status = 'active')
  `).all()

  // Merge and de-duplicate (a property flagged AND in pipeline shouldn't appear twice)
  const portfolioIds = new Set(portfolio_under_contract.map(r => r.id))
  const deduped_deals = deal_under_contract.filter(d => !portfolioIds.has(d.id))
  const under_contract = [...portfolio_under_contract, ...deduped_deals]
    .sort((a, b) => {
      if (!a.close_date && !b.close_date) return 0
      if (!a.close_date) return 1
      if (!b.close_date) return -1
      return a.close_date < b.close_date ? -1 : 1
    })
  const under_contract_count = under_contract.length

  // Leases expiring within 7.5 years (90 months), only future leases
  const expiring_leases = db.prepare(`
    SELECT p.id, p.address, p.city, p.state, p.lease_end, p.annual_rent,
           t.name AS tenant_brand_name
    FROM properties p
    LEFT JOIN tenant_brands t ON t.id = p.tenant_brand_id
    WHERE p.is_portfolio = 1
      AND p.lease_end IS NOT NULL
      AND p.lease_end > date('now')
      AND p.lease_end <= date('now', '+90 months')
    ORDER BY p.lease_end ASC
  `).all()

  // All property locations for the map (use all properties, not just portfolio)
  const property_locations = db.prepare(`
    SELECT p.id, p.address, p.city, p.state,
           t.name AS tenant_brand_name
    FROM properties p
    LEFT JOIN tenant_brands t ON t.id = p.tenant_brand_id
    WHERE p.state IS NOT NULL
  `).all()

  res.json({
    portfolio_purchase_value: totals.portfolio_purchase_value || 0,
    fees_to_collect:          totals.fees_to_collect          || 0,
    under_contract_count,
    active_investors_count,
    under_contract,
    expiring_leases,
    property_locations,
  })
})

// ── GET /treasury — 10-year treasury yield, last 6 months (FRED DGS10) ────────
// Cached for 6 hours in app_settings so we don't hammer FRED on every load.

router.get('/treasury', async (req, res) => {
  const readCache = () => {
    const row = db.prepare(`SELECT value FROM app_settings WHERE key = 'treasury_10y'`).get()
    if (!row) return null
    try { return JSON.parse(row.value) } catch { return null }
  }

  const cached = readCache()
  if (cached && Date.now() - new Date(cached.fetched_at).getTime() < 6 * 60 * 60 * 1000) {
    return res.json(cached)
  }

  try {
    const start = new Date(Date.now() - 185 * 86_400_000).toISOString().slice(0, 10)
    const url = `https://fred.stlouisfed.org/graph/fredgraph.csv?id=DGS10&cosd=${start}`
    const r = await fetch(url, { headers: { 'User-Agent': 'KnoxCRM/1.0' } })
    if (!r.ok) throw new Error(`FRED responded ${r.status}`)
    const csv = await r.text()

    const series = csv.trim().split('\n').slice(1).map(line => {
      const [date, v] = line.split(',')
      return { date: date?.trim(), rate: parseFloat(v) }
    }).filter(p => p.date && isFinite(p.rate))

    if (!series.length) throw new Error('FRED returned no data')

    const payload = {
      fetched_at: new Date().toISOString(),
      series,
      latest: series[series.length - 1],
    }
    db.prepare(`
      INSERT INTO app_settings (key, value) VALUES ('treasury_10y', ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value
    `).run(JSON.stringify(payload))
    res.json(payload)
  } catch (err) {
    console.error('[treasury]', err.message)
    if (cached) return res.json(cached)   // stale beats nothing
    res.status(502).json({ error: 'Could not load treasury data' })
  }
})

// ── GET /map-properties ───────────────────────────────────────────────────────
// Geocodes any portfolio property that doesn't yet have lat/lng stored,
// caches results back to the DB, then returns the full list.
router.get('/map-properties', async (req, res) => {
  try {
    const rows = db.prepare(`
      SELECT p.id, p.address, p.city, p.state, p.lat, p.lng,
             t.name AS tenant_brand_name
      FROM properties p
      LEFT JOIN tenant_brands t ON t.id = p.tenant_brand_id
      WHERE p.is_portfolio = 1
      ORDER BY p.address
    `).all()

    const updateCoords = db.prepare(`UPDATE properties SET lat = ?, lng = ? WHERE id = ?`)
    const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))

    // Clear out any zero-coordinate entries so they get re-geocoded properly
    for (const prop of rows) {
      if (prop.lat === 0 && prop.lng === 0) {
        updateCoords.run(null, null, prop.id)
        prop.lat = null
        prop.lng = null
      }
    }

    const nominatim = async (q) => {
      const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(q)}&format=json&limit=1`
      const r = await fetch(url, { headers: { 'User-Agent': 'KnoxCRM/1.0 (bradcottam@gmail.com)' } })
      const data = await r.json()
      return Array.isArray(data) ? data : []
    }

    for (const prop of rows) {
      if (prop.lat != null && prop.lng != null) continue  // already cached

      const fullAddress = [prop.address, prop.city, prop.state].filter(Boolean).join(', ')
      let result = []

      try {
        // Primary attempt: full address
        result = await nominatim(fullAddress)
        await sleep(1100)

        // Fallback: city + state only
        if (result.length === 0 && (prop.city || prop.state)) {
          const fallback = [prop.city, prop.state].filter(Boolean).join(', ')
          console.warn(`[map] no result for "${fullAddress}" — retrying with "${fallback}"`)
          result = await nominatim(fallback)
          await sleep(1100)
        }

        if (result.length > 0) {
          const lat = parseFloat(result[0].lat)
          const lng = parseFloat(result[0].lon)
          updateCoords.run(lat, lng, prop.id)
          prop.lat = lat
          prop.lng = lng
          console.log(`[map] geocoded "${fullAddress}" → ${lat}, ${lng}`)
        } else {
          console.warn(`[map] geocoding failed for all attempts — skipping property ${prop.id}: "${fullAddress}"`)
        }
      } catch (geoErr) {
        console.error(`[map] fetch error for property ${prop.id} "${fullAddress}":`, geoErr.message)
        await sleep(1100)
      }
    }

    res.json(rows)
  } catch (err) {
    console.error('[map-properties]', err)
    res.status(500).json({ error: err.message })
  }
})

// ── GET /lease-expirations ────────────────────────────────────────────────────
router.get('/lease-expirations', (req, res) => {
  const rows = db.prepare(`
    SELECT p.id, p.address, p.city, p.state, p.lease_end,
           t.name AS tenant_brand_name
    FROM properties p
    LEFT JOIN tenant_brands t ON t.id = p.tenant_brand_id
    WHERE p.is_portfolio = 1
    ORDER BY
      CASE WHEN p.lease_end IS NULL THEN 1 ELSE 0 END,
      p.lease_end ASC
  `).all()
  res.json(rows)
})

// ── GET /financials ───────────────────────────────────────────────────────────
router.get('/financials', (req, res) => {
  const portfolio = db.prepare(`
    SELECT
      COALESCE(SUM(purchase_price), 0) AS total_portfolio_value,
      COALESCE(SUM(annual_rent),    0) AS total_annual_rent
    FROM properties WHERE is_portfolio = 1
  `).get()

  const { total_equity } = db.prepare(`
    SELECT COALESCE(SUM(contribution), 0) AS total_equity FROM investor_property_links
  `).get()

  const { total_investors } = db.prepare(`
    SELECT COUNT(*) AS total_investors FROM investors
  `).get()

  res.json({
    total_portfolio_value: portfolio.total_portfolio_value,
    total_annual_rent:     portfolio.total_annual_rent,
    total_equity_deployed: total_equity,
    total_investors,
  })
})

// ── GET /deadlines ────────────────────────────────────────────────────────────
// Next 10 upcoming items across tasks, insurance, and pipeline deals
router.get('/deadlines', (req, res) => {
  const tasks = db.prepare(`
    SELECT
      'task'        AS type,
      pt.id,
      pt.title,
      pt.due_date,
      p.id          AS property_id,
      p.address     AS property_address,
      p.city        AS property_city
    FROM property_tasks pt
    JOIN properties p ON p.id = pt.property_id
    WHERE pt.completed_at IS NULL
      AND pt.due_date IS NOT NULL
    ORDER BY pt.due_date ASC
    LIMIT 30
  `).all()

  const insurance = db.prepare(`
    SELECT
      'insurance'                                                    AS type,
      pi.id,
      'Insurance expiring: ' || COALESCE(pi.carrier, 'Policy')      AS title,
      pi.expiry_date                                                 AS due_date,
      p.id                                                           AS property_id,
      p.address                                                      AS property_address,
      p.city                                                         AS property_city
    FROM property_insurance pi
    JOIN properties p ON p.id = pi.property_id
    WHERE pi.paid_status = 'unpaid'
      AND pi.expiry_date IS NOT NULL
      AND pi.expiry_date <= date('now', '+90 days')
    ORDER BY pi.expiry_date ASC
    LIMIT 30
  `).all()

  const deals = db.prepare(`
    SELECT
      'deal'                                                          AS type,
      d.id,
      'DD Deadline: ' || COALESCE(d.address, p.address, 'Deal')      AS title,
      d.dd_deadline                                                   AS due_date,
      d.property_id,
      COALESCE(d.address, p.address)                                  AS property_address,
      COALESCE(d.city,    p.city)                                     AS property_city
    FROM deals d
    LEFT JOIN properties p ON p.id = d.property_id
    WHERE d.dd_deadline IS NOT NULL
      AND d.stage NOT IN ('Closed', 'Dropped')
      AND (d.status IS NULL OR d.status = 'active')
    ORDER BY d.dd_deadline ASC
    LIMIT 30
  `).all()

  const all = [...tasks, ...insurance, ...deals]
    .sort((a, b) => (a.due_date < b.due_date ? -1 : a.due_date > b.due_date ? 1 : 0))
    .slice(0, 10)

  res.json(all)
})

// ── GET /critical-dates ───────────────────────────────────────────────────────
// Aggregated upcoming dates in two buckets:
//   deal      — escrow/transactional dates for deals under contract (DD, closing)
//   portfolio — ongoing asset dates (lease expirations, renewal-notice deadlines
//               from parsed lease abstracts, loan maturities, insurance & tax dues)
// Each item: { kind, label, date (ISO), daysUntil, entity_type, entity_id, entity_name, sub }
router.get('/critical-dates', (req, res) => {
  const today = new Date(); today.setHours(0, 0, 0, 0)
  const MS = 86400000
  const parseDate = v => {
    if (!v) return null
    const m = String(v).match(/^(\d{4})-(\d{2})-(\d{2})/)
    let d = m ? new Date(+m[1], +m[2] - 1, +m[3]) : new Date(v)
    if (Number.isNaN(d.getTime())) return null
    d.setHours(0, 0, 0, 0)
    return d
  }
  const toISO = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  // Build a normalized item; drop anything unparseable or more than 60 days past.
  const mk = o => {
    const d = parseDate(o.date); if (!d) return null
    const daysUntil = Math.round((d - today) / MS)
    if (daysUntil < -60) return null
    return { ...o, date: toISO(d), daysUntil }
  }

  // ── Deal bucket — deals actively under contract ──
  const deal = []
  const dealRows = db.prepare(`
    SELECT d.id, COALESCE(NULLIF(d.tenant,''), t.name, d.address, p.address, 'Deal') AS name,
           COALESCE(d.address, p.address) AS address, d.stage,
           d.effective_date, d.earnest_due_date, d.dd_deadline, d.title_objection_date, d.close_date
    FROM deals d
    LEFT JOIN properties p ON p.id = d.property_id
    LEFT JOIN tenant_brands t ON t.id = p.tenant_brand_id
    WHERE (d.status IS NULL OR d.status = 'active')
      AND d.stage IN ('psa_negotiation', 'under_contract', 'money_hard')
  `).all()
  for (const r of dealRows) {
    const base = { entity_type: 'deal', entity_id: r.id, entity_name: r.name, sub: r.address || null, stage: r.stage }
    const named = [
      ['effective_date',  'Effective date',            r.effective_date],
      ['earnest_due',     'Earnest money due',         r.earnest_due_date],
      ['dd_deadline',     'DD deadline — earnest hard', r.dd_deadline],
      ['title_objection', 'Title objection deadline',  r.title_objection_date],
      ['closing',         'Closing',                   r.close_date],
    ]
    for (const [kind, label, date] of named) {
      const it = mk({ ...base, kind, label, date }); if (it) deal.push(it)
    }
  }
  // DD proposal drop-dead ORDER-BY dates (dd_deadline − turnaround) for deals in escrow.
  const kindLabel = { survey: 'Survey', environmental: 'Environmental', pcr: 'PCR', other: 'Report' }
  const proposals = db.prepare(`
    SELECT dp.kind, dp.turnaround_days, d.id AS deal_id, d.dd_deadline,
           COALESCE(NULLIF(d.tenant,''), t.name, d.address, p.address, 'Deal') AS name, COALESCE(d.address, p.address) AS address
    FROM deal_proposals dp JOIN deals d ON d.id = dp.deal_id
    LEFT JOIN properties p ON p.id = d.property_id
    LEFT JOIN tenant_brands t ON t.id = p.tenant_brand_id
    WHERE (d.status IS NULL OR d.status = 'active') AND d.stage IN ('psa_negotiation', 'under_contract', 'money_hard')
      AND dp.turnaround_days IS NOT NULL AND d.dd_deadline IS NOT NULL
  `).all()
  for (const r of proposals) {
    const m = String(r.dd_deadline).match(/^(\d{4})-(\d{2})-(\d{2})/); if (!m) continue
    const od = new Date(+m[1], +m[2] - 1, +m[3]); od.setDate(od.getDate() - r.turnaround_days)
    const iso = `${od.getFullYear()}-${String(od.getMonth() + 1).padStart(2, '0')}-${String(od.getDate()).padStart(2, '0')}`
    const it = mk({ entity_type: 'deal', entity_id: r.deal_id, entity_name: r.name, sub: r.address || null,
      kind: 'order_by', label: `Order ${kindLabel[r.kind] || 'report'} by`, date: iso })
    if (it) deal.push(it)
  }

  // ── Portfolio bucket ──
  const portfolio = []
  const props = db.prepare(`
    SELECT p.id, COALESCE(NULLIF(p.display_name,''), p.address) AS name, p.address,
           p.lease_end, p.maturity_date, t.name AS tenant
    FROM properties p LEFT JOIN tenant_brands t ON t.id = p.tenant_brand_id
    WHERE p.is_portfolio = 1
  `).all()
  for (const r of props) {
    const base = { entity_type: 'property', entity_id: r.id, entity_name: r.name, sub: r.tenant || r.address || null }
    const le = mk({ ...base, kind: 'lease_expiration', label: 'Lease expiration', date: r.lease_end }); if (le) portfolio.push(le)
    const lm = mk({ ...base, kind: 'loan_maturity', label: 'Loan maturity', date: r.maturity_date }); if (lm) portfolio.push(lm)
  }
  const taxes = db.prepare(`
    SELECT pt.property_id AS id, pt.due_date, pt.tax_year, COALESCE(NULLIF(p.display_name,''), p.address) AS name, p.address, t.name AS tenant
    FROM property_taxes pt JOIN properties p ON p.id = pt.property_id LEFT JOIN tenant_brands t ON t.id = p.tenant_brand_id
    WHERE p.is_portfolio = 1 AND pt.due_date IS NOT NULL AND pt.paid_date IS NULL
  `).all()
  for (const r of taxes) {
    const it = mk({ entity_type: 'property', entity_id: r.id, entity_name: r.name, sub: r.tenant || r.address || null,
      kind: 'tax_due', label: `Property tax due${r.tax_year ? ` (${r.tax_year})` : ''}`, date: r.due_date })
    if (it) portfolio.push(it)
  }
  const ins = db.prepare(`
    SELECT pi.property_id AS id, pi.expiry_date, pi.carrier, COALESCE(NULLIF(p.display_name,''), p.address) AS name, p.address, t.name AS tenant
    FROM property_insurance pi JOIN properties p ON p.id = pi.property_id LEFT JOIN tenant_brands t ON t.id = p.tenant_brand_id
    WHERE p.is_portfolio = 1 AND pi.expiry_date IS NOT NULL AND pi.expiry_date >= date('now', '-30 days')
  `).all()
  for (const r of ins) {
    const it = mk({ entity_type: 'property', entity_id: r.id, entity_name: r.name, sub: r.carrier || r.tenant || null,
      kind: 'insurance_exp', label: 'Insurance expiration', date: r.expiry_date })
    if (it) portfolio.push(it)
  }
  // Renewal-notice deadlines etc. from parsed lease abstracts (key_dates array).
  const leases = db.prepare(`
    SELECT pl.property_id AS id, pl.abstract, COALESCE(NULLIF(p.display_name,''), p.address) AS name, t.name AS tenant
    FROM property_leases pl JOIN properties p ON p.id = pl.property_id LEFT JOIN tenant_brands t ON t.id = p.tenant_brand_id
    WHERE p.is_portfolio = 1 AND pl.abstract IS NOT NULL
  `).all()
  for (const r of leases) {
    let a; try { a = JSON.parse(r.abstract) } catch { continue }
    for (const kd of (a?.key_dates || [])) {
      const it = mk({ entity_type: 'property', entity_id: r.id, entity_name: r.name, sub: r.tenant || null,
        kind: 'lease_key_date', label: kd.label || 'Lease key date', date: kd.date })
      if (it) portfolio.push(it)
    }
  }

  const byDate = (a, b) => a.date < b.date ? -1 : a.date > b.date ? 1 : 0
  deal.sort(byDate); portfolio.sort(byDate)
  res.json({ deal, portfolio })
})

// ── GET /activity ─────────────────────────────────────────────────────────────
// Last 10 actions across the CRM
router.get('/activity', (req, res) => {
  const letters = db.prepare(`
    SELECT
      'letter'                                             AS type,
      s.id,
      'Letter sent to ' || COALESCE(pe.name, 'contact')   AS description,
      s.sent_at                                            AS timestamp,
      COALESCE(u.name, u.email, 'System')                  AS actor,
      NULL                                                 AS property_id,
      NULL                                                 AS property_address
    FROM handwrytten_sends s
    LEFT JOIN people pe ON pe.id = s.contact_id
    LEFT JOIN users  u  ON u.id  = s.sent_by_user_id
    WHERE s.status = 'sent'
    ORDER BY s.sent_at DESC LIMIT 20
  `).all()

  const ins = db.prepare(`
    SELECT
      'insurance'                                          AS type,
      pi.id,
      'Insurance uploaded for ' || p.address               AS description,
      pi.created_at                                        AS timestamp,
      NULL                                                 AS actor,
      p.id                                                 AS property_id,
      p.address                                            AS property_address
    FROM property_insurance pi
    JOIN properties p ON p.id = pi.property_id
    ORDER BY pi.created_at DESC LIMIT 20
  `).all()

  const done = db.prepare(`
    SELECT
      'task_done'                                                       AS type,
      pt.id,
      'Task completed: ' || pt.title || ' at ' || p.address            AS description,
      pt.completed_at                                                   AS timestamp,
      NULL                                                              AS actor,
      p.id                                                              AS property_id,
      p.address                                                         AS property_address
    FROM property_tasks pt
    JOIN properties p ON p.id = pt.property_id
    WHERE pt.completed_at IS NOT NULL
    ORDER BY pt.completed_at DESC LIMIT 20
  `).all()

  // deals table has no reliable created_at (migration for it uses an expression
  // default that SQLite rejects in ALTER TABLE, so the column may not exist).
  // Use NULL for timestamp — rows with no timestamp are filtered out below.
  const dealRows = db.prepare(`
    SELECT
      'deal'                                                            AS type,
      d.id,
      'Deal: ' || COALESCE(d.address, p.address, 'Unknown')
        || ' — ' || d.stage                                            AS description,
      NULL                                                              AS timestamp,
      NULL                                                              AS actor,
      d.property_id,
      COALESCE(d.address, p.address)                                    AS property_address
    FROM deals d
    LEFT JOIN properties p ON p.id = d.property_id
    WHERE (d.status IS NULL OR d.status = 'active')
    ORDER BY d.id DESC LIMIT 20
  `).all()

  const all = [...letters, ...ins, ...done, ...dealRows]
    .filter(r => r.timestamp)
    .sort((a, b) => (b.timestamp > a.timestamp ? 1 : b.timestamp < a.timestamp ? -1 : 0))
    .slice(0, 10)

  res.json(all)
})

export default router
