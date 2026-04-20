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

export default router
