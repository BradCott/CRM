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

// ── GET /map-properties ───────────────────────────────────────────────────────
router.get('/map-properties', (req, res) => {
  const rows = db.prepare(`
    SELECT p.id, p.address, p.city, p.state, p.lat, p.lng,
           t.name AS tenant_brand_name
    FROM properties p
    LEFT JOIN tenant_brands t ON t.id = p.tenant_brand_id
    WHERE p.is_portfolio = 1
    ORDER BY p.address
  `).all()
  res.json(rows)
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

  const dealRows = db.prepare(`
    SELECT
      'deal'                                                            AS type,
      d.id,
      'Deal: ' || COALESCE(d.address, p.address, 'Unknown')
        || ' — ' || d.stage                                            AS description,
      d.created_at                                                      AS timestamp,
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
