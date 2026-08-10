// Local-only dev seed — creates a login + sample Critical Dates so the dashboard
// widgets have something to show. Safe to re-run (idempotent). Never used in prod;
// it writes to the local data/crm.db that db.js opens.
import bcrypt from 'bcryptjs'
import db from '../server/db.js'

const DEV_EMAIL = 'dev@knoxcre.com'
const DEV_PASSWORD = 'test1234'

const isoIn = days => {
  const d = new Date(); d.setDate(d.getDate() + days)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

// 1) Login (local admin)
const existing = db.prepare(`SELECT id FROM users WHERE LOWER(email) = LOWER(?)`).get(DEV_EMAIL)
if (!existing) {
  const hash = bcrypt.hashSync(DEV_PASSWORD, 10)
  db.prepare(`INSERT INTO users (email, name, role, auth_provider, password_hash, status)
              VALUES (?, ?, 'admin', 'local', ?, 'active')`).run(DEV_EMAIL, 'Dev Admin', hash)
  console.log(`[seed] created login ${DEV_EMAIL} / ${DEV_PASSWORD}`)
} else {
  console.log(`[seed] login ${DEV_EMAIL} already exists`)
}

// 2) Tenant brand (simple name that should appear in the subtext)
db.prepare(`INSERT OR IGNORE INTO tenant_brands (name) VALUES ('Sherwin-Williams')`).run()
const brandId = db.prepare(`SELECT id FROM tenant_brands WHERE name = 'Sherwin-Williams'`).get().id

// 3) Portfolio property → feeds "Portfolio Deadlines" (tax due + lease expiration)
let prop = db.prepare(`SELECT id FROM properties WHERE address = '1212 W Olive Ave'`).get()
if (!prop) {
  const r = db.prepare(`INSERT INTO properties (address, city, state, tenant_brand_id, is_portfolio, lease_end)
                        VALUES ('1212 W Olive Ave', 'Porterville', 'CA', ?, 1, ?)`).run(brandId, isoIn(40))
  prop = { id: Number(r.lastInsertRowid) }
  db.prepare(`INSERT INTO property_taxes (property_id, tax_year, due_date, amount)
              VALUES (?, 2026, ?, 8500)`).run(prop.id, isoIn(21))
  console.log(`[seed] created portfolio property #${prop.id} + tax due`)
} else {
  console.log(`[seed] portfolio property already exists (#${prop.id})`)
}

// 4) Deal under contract → feeds "Escrow Critical Dates". tenant holds the FULL
//    legal name on purpose, to prove the widget now shows the simple brand instead.
let deal = db.prepare(`SELECT id FROM deals WHERE address = '2321 Eugene Boulevard'`).get()
if (!deal) {
  const r = db.prepare(`INSERT INTO deals (stage, status, address, city, state, tenant, property_id,
                          purchase_price, earnest_money, dd_deadline, close_date)
                        VALUES ('money_hard', 'active', '2321 Eugene Boulevard', 'Poplar Bluff', 'MO',
                          'The Sherwin-Williams Company, an Ohio corporation', ?, 935000, 15000, ?, ?)`)
    .run(prop.id, isoIn(5), isoIn(8))
  deal = { id: Number(r.lastInsertRowid) }
  console.log(`[seed] created deal #${deal.id} (money_hard, closes in 8d)`)
} else {
  console.log(`[seed] deal already exists (#${deal.id})`)
}

console.log('[seed] done.')
process.exit(0)
