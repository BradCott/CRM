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
      )) AS fees_to_collect,
      COUNT(CASE WHEN listing_status = 'under_contract' THEN 1 END) AS under_contract_count
    FROM properties
    WHERE is_portfolio = 1
  `).get()

  // Active investors
  const { n: active_investors_count } = db.prepare(`SELECT COUNT(*) AS n FROM investors`).get()

  // Properties under contract
  const under_contract = db.prepare(`
    SELECT p.id, p.address, p.city, p.state, p.purchase_price,
           p.dd_end_date, p.close_date,
           t.name AS tenant_brand_name
    FROM properties p
    LEFT JOIN tenant_brands t ON t.id = p.tenant_brand_id
    WHERE p.is_portfolio = 1 AND p.listing_status = 'under_contract'
    ORDER BY p.close_date ASC NULLS LAST
  `).all()

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
    under_contract_count:     totals.under_contract_count     || 0,
    active_investors_count,
    under_contract,
    expiring_leases,
    property_locations,
  })
})

export default router
