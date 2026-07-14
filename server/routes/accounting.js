import { Router } from 'express'
import multer from 'multer'
import * as XLSX from 'xlsx'
import db from '../db.js'
import { autoLinkInvestors, investorRosterWithAliases, matchInvestorWire, normalizeName, nameSimilarity } from '../services/investorMatch.js'
import { categorizeBatch, learnRules, ruleConfidence } from '../utils/categorize.js'
import { generateSchedule, matchMortgageSplit, markRowConsumed } from '../utils/amortization.js'

const router = Router()
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 30 * 1024 * 1024 } })

const BUILTIN_CATEGORIES = [
  'Equity Contribution', 'Purchase', 'Loan', 'Loan Payment', 'Member Loan', 'Distribution', 'Rent', 'Mortgage', 'Mortgage Interest',
  'Mortgage Principal', 'Repair', 'Sale',
  // Schedule E-aligned expense categories
  'Insurance', 'Property Tax', 'Utilities', 'Management Fees', 'Legal & Professional',
  'Advertising', 'Supplies', 'Travel', 'Commissions', 'Cleaning & Maintenance', 'HOA / CAM',
  'Bank Charges', 'Other',
]
const SOURCES    = ['Manual', 'Settlement Statement', 'Bank Statement', 'Excel Upload']

/** Valid category = a built-in OR a user-defined custom category. */
function isValidCategory(name) {
  if (BUILTIN_CATEGORIES.includes(name)) return true
  return !!db.prepare('SELECT 1 FROM custom_categories WHERE name = ?').get(name)
}
// Back-compat alias for existing `CATEGORIES.includes(x)` call sites
const CATEGORIES = { includes: isValidCategory }

// ── Advanced-accounting beta flag (master reversibility switch) ───────────────
function getSetting(key, fallback = null) {
  const row = db.prepare('SELECT value FROM app_settings WHERE key = ?').get(key)
  return row ? row.value : fallback
}
function setSetting(key, value) {
  db.prepare(`INSERT INTO app_settings (key, value) VALUES (?, ?)
              ON CONFLICT(key) DO UPDATE SET value = excluded.value`).run(key, String(value))
}
const isAdvanced = () => getSetting('accounting_advanced', '0') === '1'

router.get('/settings', (_req, res) => {
  res.json({ advanced: isAdvanced() })
})
router.patch('/settings', (req, res) => {
  if (req.body?.advanced !== undefined) setSetting('accounting_advanced', req.body.advanced ? '1' : '0')
  res.json({ advanced: isAdvanced() })
})

// ── Opening balances (per property) ───────────────────────────────────────────
const ZERO_OPENING = {
  as_of_date: null, cash: 0, real_estate: 0, loan_balance: 0,
  invested_capital: 0, retained_earnings: 0, notes: null,
}
function getOpeningBalances(propertyId) {
  return db.prepare('SELECT * FROM property_opening_balances WHERE property_id = ?').get(propertyId)
    || { property_id: Number(propertyId), ...ZERO_OPENING }
}

router.get('/:propertyId/opening-balances', (req, res) => {
  res.json(getOpeningBalances(req.params.propertyId))
})

router.put('/:propertyId/opening-balances', (req, res) => {
  const b = req.body || {}
  const num = v => (v === '' || v === null || v === undefined ? 0 : parseFloat(v) || 0)
  db.prepare(`
    INSERT INTO property_opening_balances
      (property_id, as_of_date, cash, real_estate, loan_balance, invested_capital, retained_earnings, notes, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
    ON CONFLICT(property_id) DO UPDATE SET
      as_of_date = excluded.as_of_date, cash = excluded.cash, real_estate = excluded.real_estate,
      loan_balance = excluded.loan_balance, invested_capital = excluded.invested_capital,
      retained_earnings = excluded.retained_earnings, notes = excluded.notes, updated_at = datetime('now')
  `).run(
    req.params.propertyId, b.as_of_date || null,
    num(b.cash), num(b.real_estate), num(b.loan_balance),
    num(b.invested_capital), num(b.retained_earnings), b.notes || null,
  )
  res.json(getOpeningBalances(req.params.propertyId))
})

// ── Portfolio Reports — all properties with full transaction + investor data ──

router.get('/reports', (req, res) => {
  const properties = db.prepare(`
    SELECT p.id, p.address, COALESCE(p.city,'') AS city, COALESCE(p.state,'') AS state,
           tb.name AS tenant
    FROM properties p
    LEFT JOIN tenant_brands tb ON tb.id = p.tenant_brand_id
    WHERE p.is_portfolio = 1
    ORDER BY p.address ASC
  `).all()

  const txStmt  = db.prepare(`
    SELECT id, date, description, category, amount, source, vendor, reconciled
    FROM accounting_transactions
    WHERE property_id = ? AND review_status = 'recorded'
    ORDER BY date ASC
  `)
  const invStmt = db.prepare(`
    SELECT id, name, contribution
    FROM property_investors
    WHERE property_id = ?
  `)

  const result = properties.map(p => ({
    ...p,
    transactions:     txStmt.all(p.id),
    investors:        invStmt.all(p.id),
    opening_balances: getOpeningBalances(p.id),
  }))

  res.json({ advanced: isAdvanced(), properties: result })
})

// ── Summary — all portfolio properties with computed stats ────────────────────

router.get('/summary', (req, res) => {
  const rows = db.prepare(`
    SELECT
      p.id,
      p.address,
      COALESCE(p.city, '')  AS city,
      COALESCE(p.state, '') AS state,
      tb.name               AS tenant,
      COALESCE(SUM(CASE
        WHEN tx.category IN ('Equity Contribution','Mortgage Principal') THEN tx.amount
        WHEN tx.category IN ('Purchase','Loan','Loan Payment')          THEN 0
        WHEN COALESCE(tx.source,'') = 'Settlement Statement'            THEN 0
        ELSE tx.amount END), 0) AS cash_balance,
      COALESCE(SUM(CASE WHEN tx.category = 'Equity Contribution' AND tx.amount > 0 THEN tx.amount ELSE 0 END), 0) AS equity_contributed,
      COALESCE(SUM(CASE WHEN tx.category = 'Rent'               AND tx.amount > 0 THEN tx.amount ELSE 0 END), 0) AS rent_collected,
      COUNT(tx.id) AS tx_count
    FROM properties p
    LEFT JOIN tenant_brands tb ON tb.id = p.tenant_brand_id
    LEFT JOIN accounting_transactions tx ON tx.property_id = p.id AND tx.review_status = 'recorded'
    WHERE p.is_portfolio = 1
    GROUP BY p.id
    ORDER BY p.address ASC
  `).all()
  res.json(rows)
})

// ── Transactions for a property ───────────────────────────────────────────────

router.get('/:propertyId/transactions', (req, res) => {
  const { propertyId } = req.params
  const prop = db.prepare('SELECT id, address, city, state FROM properties WHERE id = ?').get(propertyId)
  if (!prop) return res.status(404).json({ error: 'Property not found' })

  const transactions = db.prepare(`
    SELECT tx.id, tx.property_id, tx.date, tx.description, tx.category, tx.amount, tx.source, tx.vendor,
           tx.reconciled, tx.review_status, tx.matched_note, tx.matched_to_id, tx.external_id, tx.created_at,
           tx.investor_id, i.name AS investor_name
    FROM accounting_transactions tx
    LEFT JOIN investors i ON i.id = tx.investor_id
    WHERE tx.property_id = ?
    ORDER BY tx.date ASC, tx.id ASC
  `).all(propertyId)

  res.json({ property: prop, transactions })
})

// ── Create transaction(s) ─────────────────────────────────────────────────────

router.post('/:propertyId/transactions', (req, res) => {
  const { propertyId } = req.params
  const prop = db.prepare('SELECT id FROM properties WHERE id = ?').get(propertyId)
  if (!prop) return res.status(404).json({ error: 'Property not found' })

  const payload = Array.isArray(req.body) ? req.body : [req.body]
  const stmt = db.prepare(`
    INSERT INTO accounting_transactions (property_id, date, description, category, amount, source, vendor, investor_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `)

  const created = []
  for (const t of payload) {
    const { date, description, category, amount, source = 'Manual', vendor = null, investor_id = null } = t
    if (!date || !description || !category || amount === undefined) {
      return res.status(400).json({ error: `Missing required fields on transaction: ${JSON.stringify(t)}` })
    }
    if (!CATEGORIES.includes(category)) return res.status(400).json({ error: `Invalid category: ${category}` })
    if (!SOURCES.includes(source))      return res.status(400).json({ error: `Invalid source: ${source}` })
    const r = stmt.run(propertyId, date, description, category, parseFloat(amount), source, vendor || null, investor_id || null)
    created.push({ id: r.lastInsertRowid, property_id: Number(propertyId), date, description, category, amount: parseFloat(amount), source, vendor: vendor || null, investor_id: investor_id || null })
  }

  // Study every categorization the user makes so the auto-pilot improves over time
  try { learnRules(created.map(t => ({ description: t.description, category: t.category }))) } catch (_) {}

  res.status(201).json(created)
})

// ── Update a transaction ──────────────────────────────────────────────────────

router.put('/transactions/:id', (req, res) => {
  const { date, description, category, amount, vendor } = req.body
  if (!date || !description || !category || amount === undefined)
    return res.status(400).json({ error: 'Missing required fields' })
  if (!CATEGORIES.includes(category))
    return res.status(400).json({ error: `Invalid category: ${category}` })
  db.prepare(`
    UPDATE accounting_transactions SET date=?, description=?, category=?, amount=?, vendor=? WHERE id=?
  `).run(date, description, category, parseFloat(amount), vendor || null, req.params.id)
  // A manual correction is a strong signal — teach the auto-pilot
  try { learnRules([{ description, category }]) } catch (_) {}
  const updated = db.prepare('SELECT * FROM accounting_transactions WHERE id=?').get(req.params.id)
  res.json(updated)
})

// ── Toggle reconciled flag ────────────────────────────────────────────────────

router.patch('/transactions/:id/reconcile', (req, res) => {
  const { reconciled } = req.body
  db.prepare('UPDATE accounting_transactions SET reconciled = ? WHERE id = ?')
    .run(reconciled ? 1 : 0, req.params.id)
  const updated = db.prepare('SELECT * FROM accounting_transactions WHERE id=?').get(req.params.id)
  if (!updated) return res.status(404).json({ error: 'Transaction not found' })
  res.json(updated)
})

// ── Budgets — annual amount per category ──────────────────────────────────────

router.get('/:propertyId/budget', (req, res) => {
  const year = Number(req.query.year) || new Date().getFullYear()
  const rows = db.prepare(`
    SELECT id, category, amount FROM property_budgets
    WHERE property_id = ? AND year = ?
  `).all(req.params.propertyId, year)
  res.json({ year, budgets: rows })
})

router.put('/:propertyId/budget', (req, res) => {
  const { year, budgets } = req.body
  if (!year || !Array.isArray(budgets)) return res.status(400).json({ error: 'year and budgets[] required' })
  const upsert = db.prepare(`
    INSERT INTO property_budgets (property_id, year, category, amount)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(property_id, year, category) DO UPDATE SET amount = excluded.amount
  `)
  for (const b of budgets) {
    if (!b.category || !CATEGORIES.includes(b.category)) continue
    upsert.run(req.params.propertyId, year, b.category, parseFloat(b.amount) || 0)
  }
  const rows = db.prepare('SELECT id, category, amount FROM property_budgets WHERE property_id = ? AND year = ?')
    .all(req.params.propertyId, year)
  res.json({ year: Number(year), budgets: rows })
})

// ── Bills (Accounts Payable) ──────────────────────────────────────────────────

router.get('/:propertyId/bills', (req, res) => {
  const rows = db.prepare(`
    SELECT id, property_id, payee, description, category, amount, due_date, paid_at, paid_tx_id, created_at
    FROM property_bills
    WHERE property_id = ?
    ORDER BY (paid_at IS NOT NULL) ASC, due_date ASC
  `).all(req.params.propertyId)
  res.json(rows)
})

router.post('/:propertyId/bills', (req, res) => {
  const { payee, description, category = 'Other', amount, due_date } = req.body
  if (!payee || amount === undefined || !due_date)
    return res.status(400).json({ error: 'payee, amount, and due_date are required' })
  if (!CATEGORIES.includes(category)) return res.status(400).json({ error: `Invalid category: ${category}` })
  const r = db.prepare(`
    INSERT INTO property_bills (property_id, payee, description, category, amount, due_date)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(req.params.propertyId, payee.trim(), description || null, category, Math.abs(parseFloat(amount)), due_date)
  const row = db.prepare('SELECT * FROM property_bills WHERE id = ?').get(r.lastInsertRowid)
  res.status(201).json(row)
})

router.put('/bills/:id', (req, res) => {
  const bill = db.prepare('SELECT * FROM property_bills WHERE id = ?').get(req.params.id)
  if (!bill) return res.status(404).json({ error: 'Bill not found' })
  const { payee, description, category, amount, due_date } = req.body
  db.prepare(`
    UPDATE property_bills SET payee=?, description=?, category=?, amount=?, due_date=? WHERE id=?
  `).run(
    payee ?? bill.payee, description ?? bill.description, category ?? bill.category,
    amount !== undefined ? Math.abs(parseFloat(amount)) : bill.amount,
    due_date ?? bill.due_date, req.params.id
  )
  res.json(db.prepare('SELECT * FROM property_bills WHERE id = ?').get(req.params.id))
})

// Mark a bill paid — records the payment as a ledger transaction
router.post('/bills/:id/pay', (req, res) => {
  const bill = db.prepare('SELECT * FROM property_bills WHERE id = ?').get(req.params.id)
  if (!bill) return res.status(404).json({ error: 'Bill not found' })
  if (bill.paid_at) return res.status(400).json({ error: 'Bill is already paid' })

  const paidDate = req.body?.paid_date || new Date().toISOString().slice(0, 10)
  const tx = db.prepare(`
    INSERT INTO accounting_transactions (property_id, date, description, category, amount, source, vendor)
    VALUES (?, ?, ?, ?, ?, 'Manual', ?)
  `).run(bill.property_id, paidDate, bill.description || `Bill — ${bill.payee}`, bill.category, -Math.abs(bill.amount), bill.payee)

  db.prepare(`UPDATE property_bills SET paid_at = datetime('now'), paid_tx_id = ? WHERE id = ?`)
    .run(tx.lastInsertRowid, req.params.id)
  res.json(db.prepare('SELECT * FROM property_bills WHERE id = ?').get(req.params.id))
})

router.delete('/bills/:id', (req, res) => {
  db.prepare('DELETE FROM property_bills WHERE id = ?').run(req.params.id)
  res.status(204).end()
})

// ── Investor distributions ────────────────────────────────────────────────────

// Portfolio-wide distributions report (all properties)
router.get('/distributions', (req, res) => {
  const rows = db.prepare(`
    SELECT d.id, d.investor_id, d.property_id, d.amount, d.distribution_date, d.distribution_type, d.notes,
           i.name AS investor_name, p.address AS property_address
    FROM investor_distributions d
    JOIN investors i ON i.id = d.investor_id
    LEFT JOIN properties p ON p.id = d.property_id
    ORDER BY d.distribution_date DESC, d.id DESC
  `).all()
  res.json(rows)
})

// Distributions for one property + the investors linked to it (for the record form)
router.get('/:propertyId/distributions', (req, res) => {
  const distributions = db.prepare(`
    SELECT d.id, d.investor_id, d.property_id, d.amount, d.distribution_date, d.distribution_type, d.notes,
           i.name AS investor_name
    FROM investor_distributions d
    JOIN investors i ON i.id = d.investor_id
    WHERE d.property_id = ?
    ORDER BY d.distribution_date DESC, d.id DESC
  `).all(req.params.propertyId)

  const investors = db.prepare(`
    SELECT i.id, i.name, l.contribution, l.preferred_return_rate
    FROM investor_property_links l
    JOIN investors i ON i.id = l.investor_id
    WHERE l.property_id = ?
    ORDER BY l.contribution DESC, i.name ASC
  `).all(req.params.propertyId)

  res.json({ distributions, investors })
})

// ── Sale close-out ────────────────────────────────────────────────────────────
// Atomically record a property sale: post the sale proceeds + selling costs,
// pay off the mortgage and any member loans, distribute net proceeds to investors
// (ledger cash-out + per-tier investor_distributions), and mark the property sold.
// The client computes the waterfall (src/utils/accounting.js computeWaterfall) and
// sends the finalized numbers; this endpoint just records them, all-or-nothing.
router.post('/:propertyId/sale-closeout', (req, res) => {
  const { propertyId } = req.params
  const b = req.body || {}
  const num = v => { const n = cleanNum(v); return n && isFinite(n) ? n : 0 }
  const date = cleanDate(b.sale_date) || new Date().toISOString().slice(0, 10)

  const salePrice    = Math.abs(num(b.sale_price))
  const sellingCosts = Math.abs(num(b.selling_costs))
  const loanPayoff   = Math.abs(num(b.loan_payoff))
  const memberPayoff = Math.abs(num(b.member_loan_payoff))
  const reserves     = Array.isArray(b.reserves) ? b.reserves : []
  const dists        = Array.isArray(b.distributions) ? b.distributions : []

  const insTx = db.prepare(`
    INSERT INTO accounting_transactions (property_id, date, description, category, amount, source, review_status, vendor)
    VALUES (?, ?, ?, ?, ?, 'Sale', 'recorded', ?)
  `)
  const insDist = db.prepare(`
    INSERT INTO investor_distributions (investor_id, property_id, amount, distribution_date, distribution_type, notes)
    VALUES (?, ?, ?, ?, ?, ?)
  `)
  const money = n => (n < 0 ? `-$${Math.abs(Math.round(n)).toLocaleString()}` : `$${Math.round(n).toLocaleString()}`)

  try {
    let distributed = 0
    const run = db.transaction(() => {
      if (salePrice)    insTx.run(propertyId, date, 'Sale Proceeds', 'Sale', salePrice, null)
      if (sellingCosts) insTx.run(propertyId, date, 'Selling Costs (commission, title, transfer tax)', 'Sale', -sellingCosts, null)
      if (loanPayoff)   insTx.run(propertyId, date, 'Loan Payoff at Sale', 'Mortgage Principal', -loanPayoff, null)
      if (memberPayoff) insTx.run(propertyId, date, 'Member Loan Repayment at Sale', 'Member Loan', -memberPayoff, null)

      // Remove the real estate from the books — on a sale the asset is gone. The
      // balance-sheet plug captures the gain/loss automatically. Offset the existing
      // "Building Value"/"Land Value" lines to zero (same description so the sum nets out).
      const sumByDesc = (desc) => db.prepare(
        `SELECT COALESCE(SUM(amount), 0) AS v FROM accounting_transactions WHERE property_id = ? AND description = ? AND review_status = 'recorded'`
      ).get(propertyId, desc).v
      const bv = sumByDesc('Building Value')
      const lv = sumByDesc('Land Value')
      if (bv) insTx.run(propertyId, date, 'Building Value', 'Purchase', -bv, null)
      if (lv) insTx.run(propertyId, date, 'Land Value', 'Purchase', -lv, null)

      for (const d of dists) {
        const cap = Math.abs(num(d.capital)), pref = Math.abs(num(d.pref)), carry = Math.abs(num(d.carry))
        const total = cap + pref + carry
        if (total <= 0) continue
        insTx.run(propertyId, date, `Distribution — ${d.name || 'Investor'}`, 'Distribution', -total, d.name || null)
        distributed += total
        if (d.investor_id) {
          if (cap  > 0) insDist.run(d.investor_id, propertyId, cap,   date, 'Principal',        'Sale close-out — return of capital')
          if (pref > 0) insDist.run(d.investor_id, propertyId, pref,  date, 'Preferred Return', 'Sale close-out — preferred return')
          if (carry > 0) insDist.run(d.investor_id, propertyId, carry, date, 'Profit',           'Sale close-out — carry / profit')
        }
      }

      if (b.mark_sold) {
        db.prepare(`UPDATE properties SET listing_status = 'sold', close_date = ? WHERE id = ?`).run(date, propertyId)
      }

      const reserveLines = reserves.filter(r => num(r.amount) > 0).map(r => `  Reserve — ${r.label || 'Held'}: ${money(num(r.amount))}`)
      const content = [
        `SALE CLOSE-OUT — ${date}`,
        `Sale price: ${money(salePrice)}`,
        sellingCosts ? `Selling costs: ${money(-sellingCosts)}` : null,
        loanPayoff   ? `Loan payoff: ${money(-loanPayoff)}` : null,
        memberPayoff ? `Member loan repayment: ${money(-memberPayoff)}` : null,
        ...reserveLines,
        `Distributed to investors: ${money(-distributed)}`,
        '',
        ...dists.filter(d => (num(d.capital) + num(d.pref) + num(d.carry)) > 0).map(d =>
          `  ${d.name || 'Investor'}: ${money(num(d.capital) + num(d.pref) + num(d.carry))}` +
          ` (capital ${money(num(d.capital))}, pref ${money(num(d.pref))}, carry ${money(num(d.carry))})`),
      ].filter(l => l !== null).join('\n')
      db.prepare(`
        INSERT INTO property_journal_entries (property_id, entry_type, entry_date, label, content)
        VALUES (?, 'sale_closeout', ?, 'Sale Close-Out', ?)
      `).run(propertyId, date, content)
    })
    run()
    res.status(201).json({ ok: true, distributed })
  } catch (err) {
    console.error('[accounting] sale-closeout:', err.message)
    res.status(500).json({ error: err.message })
  }
})

// ── Delete a transaction ──────────────────────────────────────────────────────

router.delete('/transactions/:id', (req, res) => {
  db.prepare('DELETE FROM accounting_transactions WHERE id = ?').run(req.params.id)
  res.status(204).end()
})

// ── Loan amortization schedules ───────────────────────────────────────────────

const AMORT_PROMPT = `You are reading a mortgage AMORTIZATION SCHEDULE for a commercial property loan. Return ONLY a JSON object:
{
  "lender": "string or null",
  "original_principal": number or null,
  "annual_interest_rate": number or null,   // percent, e.g. 7.96; null if not printed
  "monthly_payment": number or null,         // the regular recurring TOTAL payment (principal+interest, exclude escrow)
  "first_payment_date": "YYYY-MM-DD or null",
  "term_months": number or null,
  "rows": [
    { "period": 1, "date": "YYYY-MM-DD", "interest": number, "principal": number, "payment": number, "balance": number }
  ]
}
CRITICAL — the "rows" array is the most important part:
- TRANSCRIBE EVERY payment row EXACTLY as printed. Do NOT compute, infer, amortize, or round — copy the Interest and Principal columns verbatim from each row.
- "interest" = that row's Interest column; "principal" = that row's Principal column; "payment" = the total payment; "balance" = the remaining balance after that payment.
- Keep the rows in order, one object per payment. Include interest-only rows (principal 0) exactly as shown. NEVER swap the interest and principal values.
- If the schedule is extremely long, include as many rows from the beginning as you can.
Also: monthly_payment = the regular recurring total payment. Leave annual_interest_rate null if it isn't printed as a number.
Return ONLY the JSON object, no markdown.`

// Convert AI-transcribed rows into schedule rows, or null if they don't look valid.
function scheduleRowsFromTerms(terms) {
  const num = v => Number(String(v ?? '').replace(/[^0-9.\-]/g, '')) || 0
  if (!Array.isArray(terms.rows) || terms.rows.length < 2) return null
  const rows = terms.rows.map((r, i) => {
    const interest = Math.abs(num(r.interest)), principal = Math.abs(num(r.principal))
    return {
      period:   Number(r.period) || i + 1,
      due_date: cleanDate(r.date),
      interest, principal,
      payment:  Math.abs(num(r.payment)) || (interest + principal),
      balance:  Math.abs(num(r.balance)),
    }
  }).filter(r => r.due_date && (r.interest > 0 || r.principal > 0))
  if (rows.length < 2) return null
  // Sanity guard against garbage/misread rows (NOT a swap guard — a swap still
  // sums to the payment): require MOST rows to have interest + principal ≈ payment.
  const good = rows.filter(r => Math.abs((r.interest + r.principal) - r.payment) <= Math.max(2, r.payment * 0.02)).length
  return good / rows.length >= 0.6 ? rows : null
}

// Solve for the monthly rate given principal, payment, term (fallback only).
function deriveMonthlyRate(P, pay, n) {
  if (!P || !pay || !n || pay * n <= P) return null
  let lo = 0.0000001, hi = 0.05
  for (let i = 0; i < 80; i++) {
    const r = (lo + hi) / 2
    const calcPay = (P * r) / (1 - Math.pow(1 + r, -n))
    if (calcPay > pay) hi = r; else lo = r
  }
  return (lo + hi) / 2
}

async function callClaudeTextJson(apiKey, text, prompt) {
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 8192,
      messages: [{ role: 'user', content: `${prompt}\n\nDocument:\n${text.slice(0, 16000)}` }],
    }),
  })
  if (!response.ok) {
    const err = await response.json().catch(() => ({}))
    throw new Error(err.error?.message || `Anthropic API error ${response.status}`)
  }
  const data = await response.json()
  const t = (data.content?.[0]?.text || '').replace(/```(?:json)?/g, '').trim()
  const m = t.match(/\{[\s\S]*\}/)
  if (!m) throw new Error('Could not read the loan terms from that file')
  return JSON.parse(m[0])
}

// Parse an amortization file (PDF/XLSX/CSV) into { name, terms, schedule } where
// schedule = { payment_amount, rows:[{period,due_date,payment,principal,interest,balance}] }.
async function parseAmortFile(buffer, originalname, apiKey) {
  const ext = (originalname.split('.').pop() || '').toLowerCase()
  let terms
  if (ext === 'pdf') {
    terms = await callClaudeWithPrompt(apiKey, buffer, AMORT_PROMPT)
  } else if (ext === 'xlsx' || ext === 'xls' || ext === 'csv') {
    const wb = XLSX.read(buffer, { type: 'buffer' })
    const csv = XLSX.utils.sheet_to_csv(wb.Sheets[wb.SheetNames[0]])
    terms = await callClaudeTextJson(apiKey, csv, AMORT_PROMPT)
  } else {
    throw new Error('Upload a PDF, XLSX, or CSV file')
  }

  // Prefer the file's ACTUAL transcribed rows (matches the lender exactly, incl.
  // interest-only periods and partial-first-period interest). Only regenerate a
  // theoretical schedule if rows are unreadable — never as a 0% schedule.
  let schedule
  const actualRows = scheduleRowsFromTerms(terms)
  if (actualRows) {
    const counts = {}
    for (const r of actualRows) { const k = Math.round(r.payment); counts[k] = (counts[k] || 0) + 1 }
    const modalPay = Number(Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0])
    schedule = {
      payment_amount: terms.monthly_payment ? Math.round(Number(terms.monthly_payment) * 100) / 100 : modalPay,
      rows: actualRows,
    }
  } else {
    let rate = terms.annual_interest_rate
    if (!rate || Number(rate) <= 0) {
      const mr = deriveMonthlyRate(Number(terms.original_principal), Number(terms.monthly_payment), Number(terms.term_months))
      rate = mr ? mr * 12 * 100 : null
    }
    if (!rate) throw new Error('Could not read the payment rows or the interest rate from that file — please check it or enter the rate.')
    schedule = generateSchedule({
      original_principal: terms.original_principal,
      annual_rate:        rate,
      monthly_payment:    terms.monthly_payment,
      first_payment:      terms.first_payment_date,
      term_months:        terms.term_months,
    })
  }
  const name = terms.lender || originalname.replace(/\.[^.]+$/, '')
  return { name, terms, schedule }
}

// Insert a schedule + rows, replacing any existing loan with the same name on the
// property (so re-uploading a corrected file doesn't pile up duplicates). No own
// transaction — callers wrap. Returns the new schedule id.
function storeSchedule(propertyId, name, terms, schedule) {
  const dupe = db.prepare(
    'SELECT id FROM loan_schedules WHERE property_id = ? AND LOWER(TRIM(name)) = LOWER(TRIM(?))'
  ).all(propertyId, name)
  for (const e of dupe) db.prepare('DELETE FROM loan_schedules WHERE id = ?').run(e.id)

  const r = db.prepare(`
    INSERT INTO loan_schedules (property_id, name, original_principal, annual_rate, payment_amount, first_payment, term_months)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(propertyId, name,
         terms.original_principal || null, terms.annual_interest_rate || null,
         schedule.payment_amount, terms.first_payment_date || null, terms.term_months || schedule.rows.length)

  const insertRow = db.prepare(`
    INSERT INTO loan_schedule_rows (schedule_id, period, due_date, payment, principal, interest, balance)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `)
  for (const row of schedule.rows) {
    insertRow.run(r.lastInsertRowid, row.period, row.due_date, row.payment, row.principal, row.interest, row.balance)
  }
  return r.lastInsertRowid
}

// Split already-imported outgoing payments against the schedule rows. No own
// transaction — callers wrap. Returns count split.
function applyScheduleSplits(propertyId) {
  const candidates = db.prepare(`
    SELECT * FROM accounting_transactions
    WHERE property_id = ? AND amount < 0
      AND (split_group IS NULL OR split_group = '')
      AND category NOT IN ('Mortgage Interest', 'Mortgage Principal')
      AND COALESCE(source, '') != 'Settlement Statement'
    ORDER BY date ASC, id ASC
  `).all(propertyId)

  const insertSplit = db.prepare(`
    INSERT INTO accounting_transactions
      (property_id, date, description, category, amount, source, review_status, external_id, split_group, investor_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `)
  const delStmt = db.prepare('DELETE FROM accounting_transactions WHERE id = ?')

  let split = 0
  for (const tx of candidates) {
    const m = matchMortgageSplit(propertyId, { amount: tx.amount, date: tx.date })
    if (!m) continue
    const group = `amort-${tx.external_id || `tx${tx.id}`}`
    m.lines.forEach((line, j) => {
      insertSplit.run(
        propertyId, tx.date, `${tx.description} — ${line.description}`,
        line.category, line.amount, tx.source || 'Bank Statement',
        tx.review_status || 'needs_review',
        j === 0 ? tx.external_id : null, group, tx.investor_id || null,
      )
    })
    markRowConsumed(m.rowId)
    delStmt.run(tx.id)
    split++
  }
  return split
}

// Merge auto-split mortgage payments back into single 'Loan Payment' lines so they
// can be re-split against a corrected schedule. Only merges groups whose lines are
// ALL mortgage principal/interest. No own transaction — callers wrap. Returns count.
function unsplitMortgagePayments(propertyId) {
  const lines = db.prepare(`
    SELECT * FROM accounting_transactions
    WHERE property_id = ? AND split_group IS NOT NULL AND split_group != ''
      AND split_group IN (
        SELECT DISTINCT split_group FROM accounting_transactions
        WHERE property_id = ? AND category IN ('Mortgage Interest', 'Mortgage Principal') AND split_group IS NOT NULL
      )
    ORDER BY split_group, id
  `).all(propertyId, propertyId)

  const groups = new Map()
  for (const l of lines) {
    if (!groups.has(l.split_group)) groups.set(l.split_group, [])
    groups.get(l.split_group).push(l)
  }

  const insertMerged = db.prepare(`
    INSERT INTO accounting_transactions
      (property_id, date, description, category, amount, source, review_status, external_id, investor_id)
    VALUES (?, ?, ?, 'Loan Payment', ?, ?, ?, ?, ?)
  `)
  const del = db.prepare('DELETE FROM accounting_transactions WHERE id = ?')

  let merged = 0
  for (const ls of groups.values()) {
    if (ls.length < 2) continue
    if (!ls.every(l => l.category === 'Mortgage Interest' || l.category === 'Mortgage Principal')) continue
    const amount = ls.reduce((s, l) => s + Number(l.amount), 0)
    const withExt = ls.find(l => l.external_id) || ls[0]
    const baseDesc = (ls[0].description || '').replace(/\s+[—-]\s+Mortgage (interest|principal)$/i, '').trim()
    insertMerged.run(
      propertyId, ls[0].date, baseDesc || 'Mortgage payment', Math.round(amount * 100) / 100,
      withExt.source || 'Bank Statement', withExt.review_status || 'needs_review',
      withExt.external_id || null, withExt.investor_id || null,
    )
    for (const l of ls) del.run(l.id)
    merged++
  }
  return merged
}

// Upload an amortization schedule (PDF, xlsx, or csv) → store generated schedule
router.post('/:propertyId/amortization', upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' })
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) return res.status(500).json({ error: 'ANTHROPIC_API_KEY is not set' })

  const { propertyId } = req.params
  const { originalname, buffer } = req.file

  try {
    const { name, terms, schedule } = await parseAmortFile(buffer, originalname, apiKey)
    let id
    db.transaction(() => { id = storeSchedule(propertyId, name, terms, schedule) })()
    res.status(201).json({
      ok: true,
      schedule: {
        id, name,
        original_principal: terms.original_principal, annual_rate: terms.annual_interest_rate,
        payment_amount: schedule.payment_amount, first_payment: terms.first_payment_date,
        term_months: terms.term_months || schedule.rows.length, row_count: schedule.rows.length,
      },
    })
  } catch (err) {
    console.error('[amortization]', err.message)
    res.status(500).json({ error: err.message })
  }
})

router.get('/:propertyId/amortization', (req, res) => {
  const schedules = db.prepare('SELECT * FROM loan_schedules WHERE property_id = ? ORDER BY id ASC').all(req.params.propertyId)
  const nextRow = db.prepare(`SELECT * FROM loan_schedule_rows WHERE schedule_id = ? AND consumed = 0 ORDER BY due_date ASC LIMIT 1`)
  const usedRow = db.prepare(`SELECT COUNT(*) AS used FROM loan_schedule_rows WHERE schedule_id = ? AND consumed = 1`)
  const loans = schedules.map(s => ({ ...s, next: nextRow.get(s.id) || null, used: usedRow.get(s.id).used }))
  // Back-compat: keep the single-schedule shape too, so older clients don't break.
  const first = loans[0] || null
  res.json({ loans, schedule: first, next: first?.next || null, used: first?.used || 0 })
})

router.delete('/amortization/:id', (req, res) => {
  db.prepare('DELETE FROM loan_schedules WHERE id = ?').run(req.params.id)
  res.status(204).end()
})

// Retroactively split already-imported mortgage payments against the schedule(s).
// For when the amortization schedule was uploaded AFTER the bank was synced, so
// those payments came in as single lines. Same amount-match logic as live sync.
router.post('/:propertyId/amortization/apply', (req, res) => {
  const { propertyId } = req.params
  const schedules = db.prepare('SELECT id FROM loan_schedules WHERE property_id = ?').all(propertyId)
  if (!schedules.length) return res.status(400).json({ error: 'No amortization schedule on this property yet' })

  let split = 0
  db.transaction(() => { split = applyScheduleSplits(propertyId) })()
  res.json({ ok: true, split })
})

// Year-end reconcile — upload the lender's ACTUAL payment history (real dates +
// principal/interest per payment) to replace the theoretical schedule, then
// re-split every mortgage payment against those actuals. Fixes the divergence a
// theoretical schedule can't capture — interim/partial first-period interest from
// closing mid-month — and corrects payments that were already split from the
// theoretical numbers.
router.post('/:propertyId/amortization/reconcile', upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' })
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) return res.status(500).json({ error: 'ANTHROPIC_API_KEY is not set' })

  const { propertyId } = req.params
  const { originalname, buffer } = req.file

  try {
    const { name, terms, schedule } = await parseAmortFile(buffer, originalname, apiKey)
    let merged = 0, split = 0
    db.transaction(() => {
      // Single-loan property: replace whatever schedule is there (the actuals'
      // parsed lender name may not match the theoretical one). Multi-loan: fall
      // back to storeSchedule's replace-by-name.
      const existing = db.prepare('SELECT id FROM loan_schedules WHERE property_id = ?').all(propertyId)
      if (existing.length === 1) db.prepare('DELETE FROM loan_schedules WHERE id = ?').run(existing[0].id)
      storeSchedule(propertyId, name, terms, schedule)          // replace theoretical with actuals
      merged = unsplitMortgagePayments(propertyId)              // un-split old (wrong) splits
      db.prepare(`UPDATE loan_schedule_rows SET consumed = 0
                  WHERE schedule_id IN (SELECT id FROM loan_schedules WHERE property_id = ?)`).run(propertyId)
      split = applyScheduleSplits(propertyId)                   // re-split all against actuals
    })()
    res.json({ ok: true, merged, split, rows: schedule.rows.length })
  } catch (err) {
    console.error('[amortization reconcile]', err.message)
    res.status(500).json({ error: err.message })
  }
})

// ── Charge-type registry (custom categories) ──────────────────────────────────

router.get('/categories', (_req, res) => {
  const custom = db.prepare('SELECT id, name, kind FROM custom_categories ORDER BY name').all()
  res.json({ builtin: BUILTIN_CATEGORIES, custom })
})

const CATEGORY_KINDS = ['income', 'expense', 'liability', 'asset', 'equity']
router.post('/categories', (req, res) => {
  const name = (req.body?.name || '').trim()
  const kind = CATEGORY_KINDS.includes(req.body?.kind) ? req.body.kind : 'expense'
  if (!name) return res.status(400).json({ error: 'name is required' })
  if (isValidCategory(name)) return res.status(409).json({ error: 'That category already exists' })
  const r = db.prepare('INSERT INTO custom_categories (name, kind) VALUES (?, ?)').run(name, kind)
  res.status(201).json({ id: r.lastInsertRowid, name, kind })
})

router.delete('/categories/:id', (req, res) => {
  const cat = db.prepare('SELECT name FROM custom_categories WHERE id = ?').get(req.params.id)
  if (!cat) return res.status(404).json({ error: 'Not found' })
  const { n } = db.prepare('SELECT COUNT(*) AS n FROM accounting_transactions WHERE category = ?').get(cat.name)
  if (n > 0) return res.status(409).json({ error: `In use by ${n} transaction${n !== 1 ? 's' : ''} — recategorize them first` })
  db.prepare('DELETE FROM custom_categories WHERE id = ?').run(req.params.id)
  res.status(204).end()
})

// ── Split a transaction into multiple category lines ──────────────────────────
// Replaces one transaction with N child lines (e.g. principal + interest) that
// sum to the original amount and share a split_group id.

router.post('/transactions/:id/split', (req, res) => {
  const tx = db.prepare('SELECT * FROM accounting_transactions WHERE id = ?').get(req.params.id)
  if (!tx) return res.status(404).json({ error: 'Transaction not found' })

  const splits = Array.isArray(req.body?.splits) ? req.body.splits : []
  if (splits.length < 2) return res.status(400).json({ error: 'Provide at least two split lines' })

  for (const s of splits) {
    if (s.amount === undefined || !s.category) return res.status(400).json({ error: 'Each split needs an amount and category' })
    if (!isValidCategory(s.category)) return res.status(400).json({ error: `Invalid category: ${s.category}` })
  }
  const total = splits.reduce((sum, s) => sum + parseFloat(s.amount), 0)
  if (Math.abs(total - Number(tx.amount)) > 0.01) {
    return res.status(400).json({ error: `Splits total ${total.toFixed(2)} but the transaction is ${Number(tx.amount).toFixed(2)}` })
  }

  const groupId = `split-${tx.id}-${Date.now()}`
  const insert = db.prepare(`
    INSERT INTO accounting_transactions
      (property_id, date, description, category, amount, source, vendor, review_status, external_id, split_group)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `)
  const run = db.transaction(() => {
    splits.forEach((s, i) => {
      insert.run(
        tx.property_id, tx.date,
        s.description?.trim() || `${tx.description} — ${s.category}`,
        s.category, parseFloat(s.amount), tx.source, s.vendor ?? tx.vendor ?? null,
        tx.review_status, i === 0 ? tx.external_id : null, groupId
      )
    })
    db.prepare('DELETE FROM accounting_transactions WHERE id = ?').run(tx.id)
  })
  run()

  const created = db.prepare('SELECT * FROM accounting_transactions WHERE split_group = ?').all(groupId)
  res.status(201).json({ split_group: groupId, transactions: created })
})

// ── Record a reviewed transaction (needs_review → recorded) ───────────────────

router.patch('/transactions/:id/record', (req, res) => {
  const tx = db.prepare('SELECT * FROM accounting_transactions WHERE id = ?').get(req.params.id)
  if (!tx) return res.status(404).json({ error: 'Transaction not found' })

  // Allow recording with a corrected category/vendor in one step
  const category = req.body?.category ?? tx.category
  const vendor   = req.body?.vendor !== undefined ? req.body.vendor : tx.vendor
  if (!CATEGORIES.includes(category)) return res.status(400).json({ error: `Invalid category: ${category}` })

  db.prepare(`
    UPDATE accounting_transactions
    SET review_status = 'recorded', category = ?, vendor = ?
    WHERE id = ?
  `).run(category, vendor || null, req.params.id)

  // Learn the approved categorization
  try { learnRules([{ description: tx.description, category }]) } catch (_) {}

  res.json(db.prepare('SELECT * FROM accounting_transactions WHERE id = ?').get(req.params.id))
})

// ── Send a recorded transaction back to needs-review (recorded → needs_review) ─
router.patch('/transactions/:id/unrecord', (req, res) => {
  const tx = db.prepare('SELECT * FROM accounting_transactions WHERE id = ?').get(req.params.id)
  if (!tx) return res.status(404).json({ error: 'Transaction not found' })

  db.prepare(`
    UPDATE accounting_transactions
    SET review_status = 'needs_review'
    WHERE id = ?
  `).run(req.params.id)

  res.json(db.prepare('SELECT * FROM accounting_transactions WHERE id = ?').get(req.params.id))
})

// ── Match: reconcile a bank transaction against something already in the books ─
// (e.g. the settlement statement) without double-counting. review_status='matched'
// is excluded from all financials (which require 'recorded').
router.patch('/transactions/:id/match', (req, res) => {
  const tx = db.prepare('SELECT id FROM accounting_transactions WHERE id = ?').get(req.params.id)
  if (!tx) return res.status(404).json({ error: 'Transaction not found' })
  const note = (req.body?.note || 'Matched — already in the books').toString().slice(0, 200)
  const matchedToId = req.body?.matched_to_id ? Number(req.body.matched_to_id) : null
  db.prepare(`UPDATE accounting_transactions SET review_status = 'matched', matched_note = ?, matched_to_id = ? WHERE id = ?`)
    .run(note, matchedToId, req.params.id)
  res.json(db.prepare('SELECT * FROM accounting_transactions WHERE id = ?').get(req.params.id))
})

// Candidate entries already in the books that a bank line might reconcile against.
// Closest-amount first, then the settlement statement's own entries, then recent.
router.get('/:propertyId/match-candidates', (req, res) => {
  const { propertyId } = req.params
  const amount = Math.abs(Number(req.query.amount) || 0)
  const exclude = Number(req.query.exclude) || 0
  const rows = db.prepare(`
    SELECT id, date, description, category, amount, source
    FROM accounting_transactions
    WHERE property_id = ? AND id != ? AND review_status = 'recorded'
    ORDER BY ABS(ABS(amount) - ?) ASC, date DESC
    LIMIT 12
  `).all(propertyId, exclude, amount)
  res.json(rows)
})

// Undo a match (matched → needs_review)
router.patch('/transactions/:id/unmatch', (req, res) => {
  const tx = db.prepare('SELECT id FROM accounting_transactions WHERE id = ?').get(req.params.id)
  if (!tx) return res.status(404).json({ error: 'Transaction not found' })
  db.prepare(`UPDATE accounting_transactions SET review_status = 'needs_review', matched_note = NULL WHERE id = ?`)
    .run(req.params.id)
  res.json(db.prepare('SELECT * FROM accounting_transactions WHERE id = ?').get(req.params.id))
})

// Mark a batch of transactions reconciled (used by statement-upload reconciliation).
router.post('/transactions/reconcile-batch', (req, res) => {
  const ids = (Array.isArray(req.body?.ids) ? req.body.ids : []).map(Number).filter(Boolean)
  if (!ids.length) return res.json({ reconciled: 0 })
  const stmt = db.prepare('UPDATE accounting_transactions SET reconciled = 1 WHERE id = ?')
  const run = db.transaction(list => { for (const id of list) stmt.run(id) })
  run(ids)
  res.json({ reconciled: ids.length })
})

// One-click: book a settlement earnest-money line as an investor's equity.
// Earnest money is paid before closing (not in the bank feed), so it's added as a
// recorded Equity Contribution (+amount) attributed to the chosen investor. The
// original earnest-money deposit line stays, so the two net to zero cash.
router.post('/transactions/:id/record-as-equity', (req, res) => {
  const tx = db.prepare('SELECT * FROM accounting_transactions WHERE id = ?').get(req.params.id)
  if (!tx) return res.status(404).json({ error: 'Transaction not found' })
  const investorId = Number(req.body?.investor_id)
  if (!investorId) return res.status(400).json({ error: 'investor_id is required' })
  const inv = db.prepare('SELECT id, name FROM investors WHERE id = ?').get(investorId)
  if (!inv) return res.status(404).json({ error: 'Investor not found' })

  // Idempotent — don't create a second equity line for the same source transaction.
  const existing = db.prepare(
    `SELECT * FROM accounting_transactions WHERE matched_to_id = ? AND category = 'Equity Contribution'`
  ).get(tx.id)
  if (existing) return res.json({ ok: true, created: existing, duplicate: true })

  const amount = Math.abs(Number(tx.amount) || 0)
  const r = db.prepare(`
    INSERT INTO accounting_transactions
      (property_id, date, description, category, amount, source, investor_id, review_status, matched_to_id)
    VALUES (?, ?, ?, 'Equity Contribution', ?, 'Manual', ?, 'recorded', ?)
  `).run(tx.property_id, tx.date, `Earnest money — ${inv.name} equity`, amount, investorId, tx.id)

  res.json({ ok: true, created: db.prepare('SELECT * FROM accounting_transactions WHERE id = ?').get(r.lastInsertRowid) })
})

// Record all pending transactions for a property at once
router.post('/:propertyId/transactions/record-all', (req, res) => {
  const pending = db.prepare(
    `SELECT id, description, category FROM accounting_transactions
     WHERE property_id = ? AND review_status = 'needs_review'`
  ).all(req.params.propertyId)

  db.prepare(
    `UPDATE accounting_transactions SET review_status = 'recorded'
     WHERE property_id = ? AND review_status = 'needs_review'`
  ).run(req.params.propertyId)

  try { learnRules(pending.map(p => ({ description: p.description, category: p.category }))) } catch (_) {}
  res.json({ recorded: pending.length })
})

// ── AI auto-pilot ─────────────────────────────────────────────────────────────
// Confidence per needs-review item, based on what the user has done before.
router.get('/:propertyId/review-suggestions', (req, res) => {
  const pending = db.prepare(
    `SELECT id, description, category FROM accounting_transactions
     WHERE property_id = ? AND review_status = 'needs_review'`
  ).all(req.params.propertyId)

  res.json(pending.map(tx => {
    const r = ruleConfidence(tx.description)
    return {
      id:         tx.id,
      suggested:  r.category && isValidCategory(r.category) ? r.category : null,
      confidence: r.category ? r.confidence : 'low',
      hit_count:  r.hitCount,
    }
  }))
})

// Auto-record every needs-review item the auto-pilot is confident about
// (a learned merchant rule the user has confirmed enough times). Questionable
// items are left in Needs Review. Fully reversible via Unrecord.
router.post('/:propertyId/auto-record', (req, res) => {
  const pending = db.prepare(
    `SELECT id, description, category FROM accounting_transactions
     WHERE property_id = ? AND review_status = 'needs_review'`
  ).all(req.params.propertyId)

  const upd = db.prepare(
    `UPDATE accounting_transactions SET review_status = 'recorded', category = ? WHERE id = ?`
  )
  const learned = []
  const run = db.transaction(() => {
    let recorded = 0
    for (const tx of pending) {
      const r = ruleConfidence(tx.description)
      if (r.confidence === 'high' && r.category && isValidCategory(r.category)) {
        upd.run(r.category, tx.id)
        learned.push({ description: tx.description, category: r.category })
        recorded++
      }
    }
    return recorded
  })
  const recorded = run()
  try { learnRules(learned) } catch (_) {}
  res.json({ recorded, left: pending.length - recorded })
})

// ── Equity contributions ↔ investors ──────────────────────────────────────────

/** GET roster for the investor dropdown on a property's ledger. */
router.get('/:propertyId/investors-list', (req, res) => {
  res.json(db.prepare('SELECT id, name, entity_type FROM investors ORDER BY name').all())
})

/**
 * GET capital accounts for a property — per investor: committed (from the cap
 * table), contributed (recorded equity contributions attributed to them),
 * distributions received, and the resulting capital balance.
 */
router.get('/:propertyId/capital-accounts', (req, res) => {
  const pid = req.params.propertyId
  const committed = db.prepare(`
    SELECT l.investor_id, i.name, i.entity_type, l.contribution AS committed
    FROM investor_property_links l JOIN investors i ON i.id = l.investor_id
    WHERE l.property_id = ?
  `).all(pid)
  const contributed = db.prepare(`
    SELECT investor_id, COALESCE(SUM(amount), 0) AS total
    FROM accounting_transactions
    WHERE property_id = ? AND category = 'Equity Contribution'
      AND review_status = 'recorded' AND investor_id IS NOT NULL
    GROUP BY investor_id
  `).all(pid)
  const dist = db.prepare(`
    SELECT investor_id, COALESCE(SUM(amount), 0) AS total
    FROM investor_distributions WHERE property_id = ? GROUP BY investor_id
  `).all(pid)

  const contribMap = new Map(contributed.map(r => [r.investor_id, r.total]))
  const distMap    = new Map(dist.map(r => [r.investor_id, r.total]))
  const byId       = new Map()
  for (const c of committed) byId.set(c.investor_id, { investor_id: c.investor_id, name: c.name, entity_type: c.entity_type, committed: c.committed || 0 })
  // Include anyone who contributed but isn't in the cap table
  for (const c of contributed) {
    if (byId.has(c.investor_id)) continue
    const inv = db.prepare('SELECT name, entity_type FROM investors WHERE id = ?').get(c.investor_id)
    byId.set(c.investor_id, { investor_id: c.investor_id, name: inv?.name || 'Unknown', entity_type: inv?.entity_type, committed: 0 })
  }

  const rows = [...byId.values()].map(r => {
    const contributed_amt = contribMap.get(r.investor_id) || 0
    const distributions   = distMap.get(r.investor_id) || 0
    return {
      ...r,
      contributed:  contributed_amt,
      distributions,
      capital_balance: contributed_amt - distributions,
      unfunded:        Math.max(0, (r.committed || 0) - contributed_amt),
    }
  }).sort((a, b) => b.committed - a.committed || a.name.localeCompare(b.name))

  res.json(rows)
})

/** PATCH set/clear the investor attributed to a transaction. */
router.patch('/transactions/:id/investor', (req, res) => {
  const tx = db.prepare('SELECT * FROM accounting_transactions WHERE id = ?').get(req.params.id)
  if (!tx) return res.status(404).json({ error: 'Transaction not found' })
  const investorId = req.body?.investor_id || null
  db.prepare('UPDATE accounting_transactions SET investor_id = ? WHERE id = ?').run(investorId, req.params.id)
  const updated = db.prepare(`
    SELECT tx.*, i.name AS investor_name FROM accounting_transactions tx
    LEFT JOIN investors i ON i.id = tx.investor_id WHERE tx.id = ?
  `).get(req.params.id)
  res.json(updated)
})

/**
 * GET AI investor suggestions. Covers (a) Equity Contribution rows missing an
 * investor, and (b) any unattributed money-in transaction (a deposit/wire) whose
 * description matches an investor — even if it was auto-categorized as Other —
 * so incoming investor wires surface as equity even before recategorizing.
 */
router.get('/:propertyId/investor-suggestions', (req, res) => {
  const roster = investorRosterWithAliases()
  const txs = db.prepare(`
    SELECT id, description, category, amount FROM accounting_transactions
    WHERE property_id = ? AND investor_id IS NULL
      AND (category = 'Equity Contribution' OR amount > 0)
  `).all(req.params.propertyId)
  const out = {}
  for (const tx of txs) {
    const m = matchInvestorWire(tx.description, roster)
    if (!m) continue
    out[tx.id] = {
      investor_id: m.investor_id,
      name:        m.name,
      confidence:  m.score >= 0.9 ? 'high' : 'medium',
      // Suggest recategorizing a money-in row that isn't equity yet
      suggest_equity: tx.category !== 'Equity Contribution' && Number(tx.amount) > 0,
    }
  }
  res.json(out)
})

/**
 * POST auto-attribute high-confidence investor matches. For a money-in row that
 * matches an investor but isn't categorized as equity yet, also set the category
 * to 'Equity Contribution'. Stays in needs_review so the user still confirms.
 */
router.post('/:propertyId/auto-attribute-investors', (req, res) => {
  const roster = investorRosterWithAliases()
  const txs = db.prepare(`
    SELECT id, description, category, amount FROM accounting_transactions
    WHERE property_id = ? AND investor_id IS NULL
      AND (category = 'Equity Contribution' OR amount > 0)
  `).all(req.params.propertyId)
  const setBoth = db.prepare(`UPDATE accounting_transactions SET investor_id = ?, category = 'Equity Contribution' WHERE id = ?`)
  const setInv  = db.prepare(`UPDATE accounting_transactions SET investor_id = ? WHERE id = ?`)
  let attributed = 0
  const run = db.transaction(() => {
    for (const tx of txs) {
      const m = matchInvestorWire(tx.description, roster)
      if (!m || m.score < 0.9) continue
      if (tx.category !== 'Equity Contribution' && Number(tx.amount) > 0) setBoth.run(m.investor_id, tx.id)
      else setInv.run(m.investor_id, tx.id)
      attributed++
    }
  })
  run()
  res.json({ attributed, left: txs.length - attributed })
})

// ── AI + rules categorization for bank/Plaid imports ──────────────────────────

// Suggest a category per transaction: learned rules → AI → regex fallback
router.post('/categorize', async (req, res) => {
  const txs = Array.isArray(req.body?.transactions) ? req.body.transactions : []
  if (!txs.length) return res.json({ suggestions: [] })
  try {
    const suggestions = await categorizeBatch(txs, process.env.ANTHROPIC_API_KEY)
    res.json({ suggestions })
  } catch (err) {
    console.error('[categorize]', err.message)
    res.status(500).json({ error: err.message })
  }
})

// Learn rules from approved categorizations (called after a bank import / edit)
router.post('/learn-categories', (req, res) => {
  const items = Array.isArray(req.body?.items) ? req.body.items : []
  const learned = learnRules(items)
  res.json({ learned })
})

// List learned rules (for a management screen)
router.get('/rules', (_req, res) => {
  const rows = db.prepare(`
    SELECT id, merchant_key, category, hit_count, last_used
    FROM transaction_rules ORDER BY hit_count DESC, last_used DESC
  `).all()
  res.json(rows)
})

router.delete('/rules/:id', (req, res) => {
  db.prepare('DELETE FROM transaction_rules WHERE id = ?').run(req.params.id)
  res.status(204).end()
})

// ── Investors for a property ──────────────────────────────────────────────────

router.get('/:propertyId/investors', (req, res) => {
  const { propertyId } = req.params
  const rows = db.prepare(`
    SELECT id, property_id, name, address, contribution, percentage, class, preferred_return, created_at, investor_id
    FROM property_investors
    WHERE property_id = ?
    ORDER BY contribution DESC
  `).all(propertyId)

  // A manual investor_id (set via /link) wins. Otherwise resolve the name to a
  // global investor profile: normalized match (ignores LLC/Inc), then a
  // high-confidence fuzzy pass. `linked` flags a manual (user-confirmed) link.
  const investors = db.prepare('SELECT id, name FROM investors').all()
  const normd = investors.map(iv => ({ id: iv.id, name: iv.name, key: normalizeName(iv.name) }))
  for (const r of rows) {
    r.linked = r.investor_id != null
    if (r.investor_id != null) continue
    const rk = normalizeName(r.name)
    let inv = rk && normd.find(x => x.key === rk)
    if (!inv) {
      let best = null, score = 0
      for (const x of normd) { const s = nameSimilarity(r.name, x.name); if (s > score) { score = s; best = x } }
      if (best && score >= 0.85) inv = best
    }
    r.investor_id = inv ? inv.id : null
  }

  // Reconciliation: how much equity has actually been booked from the bank for
  // each investor (attributed Equity Contributions), split by recorded vs pending.
  const equity = db.prepare(`
    SELECT investor_id,
      SUM(CASE WHEN review_status = 'recorded'     THEN amount ELSE 0 END) AS recorded,
      SUM(CASE WHEN review_status = 'needs_review' THEN amount ELSE 0 END) AS pending
    FROM accounting_transactions
    WHERE property_id = ? AND category = 'Equity Contribution' AND amount > 0 AND investor_id IS NOT NULL
    GROUP BY investor_id
  `).all(propertyId)
  const eqMap = new Map(equity.map(e => [e.investor_id, e]))
  for (const r of rows) {
    const e = r.investor_id ? eqMap.get(r.investor_id) : null
    r.recorded = e ? Number(e.recorded) : 0
    r.pending  = e ? Number(e.pending)  : 0
  }

  res.json(rows)
})

router.post('/:propertyId/investors', (req, res) => {
  const { propertyId } = req.params
  const prop = db.prepare('SELECT id FROM properties WHERE id = ?').get(propertyId)
  if (!prop) return res.status(404).json({ error: 'Property not found' })

  const investors = Array.isArray(req.body) ? req.body : [req.body]
  if (!investors.length) return res.status(400).json({ error: 'No investors provided' })

  const insertInvestor = db.prepare(`
    INSERT INTO property_investors (property_id, name, address, contribution, percentage, class, preferred_return)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `)

  // NOTE: the cap table only. We intentionally do NOT create ledger
  // "Equity Contribution" transactions here — those come from the bank feed
  // (the spreadsheet just seeds the cap table + teaches the AI who to attribute
  // incoming wires to). Otherwise every contribution would be double-counted.
  const saved = []
  for (const inv of investors) {
    const { name, address, contribution, percentage, class: cls, preferred_return } = inv
    if (!name || contribution === undefined) {
      return res.status(400).json({ error: `Missing name or contribution for investor: ${JSON.stringify(inv)}` })
    }
    const amount = Math.abs(parseFloat(contribution))
    const r = insertInvestor.run(propertyId, name.trim(), address || null, amount, percentage ?? null, cls || null, preferred_return ?? null)
    saved.push({ id: r.lastInsertRowid, property_id: Number(propertyId), name: name.trim(), address, contribution: amount, percentage, class: cls, preferred_return })
  }

  // Auto-match each name against the master investors table and create links
  let match_results = null
  try {
    match_results = autoLinkInvestors(
      Number(propertyId),
      investors.map(inv => ({
        name:             String(inv.name || '').trim(),
        contribution:     Math.abs(parseFloat(inv.contribution) || 0),
        preferred_return: inv.preferred_return != null ? parseFloat(inv.preferred_return) : null,
      }))
    )
    console.log(`[accounting] Investor auto-match: ${match_results.linked.length} linked, ${match_results.needs_review.length} need review, ${match_results.new_profiles.length} new profiles`)
  } catch (e) {
    console.error('[accounting] Auto-match failed (non-fatal):', e.message)
  }

  res.status(201).json({ saved, match_results })
})

// Remove the legacy "Excel Upload" equity-contribution transactions for a
// property (these duplicated the bank wires). Cap table + bank feed are kept.
router.delete('/:propertyId/investor-excel-entries', (req, res) => {
  const r = db.prepare(`
    DELETE FROM accounting_transactions
    WHERE property_id = ? AND source = 'Excel Upload' AND category = 'Equity Contribution'
  `).run(req.params.propertyId)
  res.json({ deleted: r.changes })
})

router.patch('/investors/:id', (req, res) => {
  const { contribution } = req.body
  if (contribution === undefined) return res.status(400).json({ error: 'contribution is required' })
  const amount = Math.abs(parseFloat(contribution))
  if (!isFinite(amount)) return res.status(400).json({ error: 'Invalid contribution amount' })
  db.prepare('UPDATE property_investors SET contribution = ? WHERE id = ?').run(amount, req.params.id)
  const row = db.prepare('SELECT id, property_id, name, address, contribution, percentage, class, preferred_return FROM property_investors WHERE id = ?').get(req.params.id)
  if (!row) return res.status(404).json({ error: 'Investor not found' })
  res.json(row)
})

// Manually link (or unlink) a cap-table row to a global investor profile.
router.patch('/investors/:id/link', (req, res) => {
  const investorId = req.body?.investor_id ? Number(req.body.investor_id) : null
  if (investorId && !db.prepare('SELECT 1 FROM investors WHERE id = ?').get(investorId)) {
    return res.status(404).json({ error: 'Investor not found' })
  }
  db.prepare('UPDATE property_investors SET investor_id = ? WHERE id = ?').run(investorId, req.params.id)
  const row = db.prepare('SELECT id, property_id, name, investor_id FROM property_investors WHERE id = ?').get(req.params.id)
  if (!row) return res.status(404).json({ error: 'Cap-table row not found' })
  res.json(row)
})

router.delete('/investors/:id', (req, res) => {
  db.prepare('DELETE FROM property_investors WHERE id = ?').run(req.params.id)
  res.status(204).end()
})

// ── Investor Contributions Excel AI parse ─────────────────────────────────────

router.post('/:propertyId/investors/upload', upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' })

  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) return res.status(500).json({ error: 'ANTHROPIC_API_KEY is not set' })

  const { originalname, buffer } = req.file
  console.log(`[accounting] Investor upload: ${originalname} (${buffer.length} bytes)`)

  try {
    // Convert Excel to CSV text so Claude can read it — only the investor sheet
    const workbook = XLSX.read(buffer, { type: 'buffer' })
    const names = workbook.SheetNames
    const sheetName =
      names.find(n => n === 'Investors & Distributions') ||
      names.find(n => n.toLowerCase().includes('investor')) ||
      names[0]
    console.log(`[accounting] Using sheet: "${sheetName}" (available: ${names.join(', ')})`)
    const csv = XLSX.utils.sheet_to_csv(workbook.Sheets[sheetName], { skipHidden: true })
    const excelText = `=== Sheet: ${sheetName} ===\n${csv}`
    console.log(`[accounting] Excel text (first 500 chars):`, excelText.slice(0, 500))

    const result = await parseInvestorContributions(apiKey, excelText)
    console.log(`[accounting] Investor parse: ${result.investors?.length ?? 0} investors`)
    res.json({ ok: true, ...result })
  } catch (err) {
    console.error('[accounting] Investor parse error:', err)
    res.status(500).json({ error: err.message })
  }
})

// ── Settlement record (persisted snapshot for the Settlement tab) ─────────────

router.get('/:propertyId/settlement-record', (req, res) => {
  const row = db.prepare('SELECT data, updated_at FROM property_settlements WHERE property_id = ?').get(req.params.propertyId)
  if (!row) return res.json({ record: null })
  let record = null
  try { record = JSON.parse(row.data) } catch { /* corrupt — treat as none */ }
  res.json({ record, updated_at: row.updated_at })
})

// Save/replace the settlement: atomically clears the prior settlement-sourced
// ledger entries + acquisition journal + snapshot, then re-posts everything.
// Makes editing a settlement idempotent (no double-posting).
router.post('/:propertyId/settlement-record', (req, res) => {
  const { propertyId } = req.params
  const b = req.body || {}
  const txs = Array.isArray(b.transactions) ? b.transactions : []
  const date = cleanDate(b.date) || new Date().toISOString().slice(0, 10)

  const insTx = db.prepare(`
    INSERT INTO accounting_transactions (property_id, date, description, category, amount, source, review_status)
    VALUES (?, ?, ?, ?, ?, 'Settlement Statement', 'recorded')
  `)
  try {
    db.transaction(() => {
      db.prepare(`DELETE FROM accounting_transactions WHERE property_id = ? AND source = 'Settlement Statement'`).run(propertyId)
      db.prepare(`DELETE FROM property_journal_entries WHERE property_id = ? AND entry_type = 'acquisition'`).run(propertyId)
      db.prepare(`DELETE FROM property_settlements WHERE property_id = ?`).run(propertyId)

      for (const t of txs) {
        if (!t || !t.category || !isValidCategory(t.category)) continue
        insTx.run(propertyId, cleanDate(t.date) || date, t.description || '', t.category, Number(t.amount) || 0)
      }
      if (b.journal_content) {
        db.prepare(`INSERT INTO property_journal_entries (property_id, entry_type, entry_date, label, content) VALUES (?, 'acquisition', ?, ?, ?)`)
          .run(propertyId, date, b.label || 'Acquisition', String(b.journal_content))
      }
      if (b.snapshot) {
        db.prepare(`INSERT INTO property_settlements (property_id, data, updated_at) VALUES (?, ?, datetime('now'))`)
          .run(propertyId, JSON.stringify(b.snapshot))
      }
    })()
    res.status(201).json({ ok: true })
  } catch (err) {
    console.error('[accounting] settlement-record:', err.message)
    res.status(500).json({ error: err.message })
  }
})

// ── Journal entries ───────────────────────────────────────────────────────────

router.get('/:propertyId/journal-entries', (req, res) => {
  const rows = db.prepare(`
    SELECT id, property_id, entry_type, entry_date, label, content, created_at
    FROM property_journal_entries
    WHERE property_id = ?
    ORDER BY created_at DESC
  `).all(req.params.propertyId)
  res.json(rows)
})

router.post('/:propertyId/journal-entries', (req, res) => {
  const { propertyId } = req.params
  const { entry_type = 'acquisition', entry_date, label, content } = req.body
  if (!content) return res.status(400).json({ error: 'content is required' })
  const r = db.prepare(`
    INSERT INTO property_journal_entries (property_id, entry_type, entry_date, label, content)
    VALUES (?, ?, ?, ?, ?)
  `).run(propertyId, entry_type, entry_date || null, label || null, content)
  res.status(201).json({ id: r.lastInsertRowid, property_id: Number(propertyId), entry_type, entry_date, label, content })
})

// ── Parse-only settlement — no property ID needed (used when creating a new portfolio property) ──

router.post('/parse-settlement', upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' })
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) return res.status(500).json({ error: 'ANTHROPIC_API_KEY is not set' })
  const { originalname, buffer } = req.file
  console.log(`[accounting] Parse-only settlement: ${originalname} (${buffer.length} bytes)`)
  try {
    const result = await parseSettlementStatement(buffer, apiKey)
    res.json({ ok: true, ...result })
  } catch (err) {
    console.error('[accounting] Parse error:', err)
    res.status(500).json({ error: err.message })
  }
})

// ── Settlement Statement AI parse ─────────────────────────────────────────────

router.post('/:propertyId/settlement', upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' })

  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) return res.status(500).json({ error: 'ANTHROPIC_API_KEY is not set' })

  const { originalname, buffer } = req.file
  console.log(`[accounting] Settlement upload: ${originalname} (${buffer.length} bytes)`)

  try {
    const result = await parseSettlementStatement(buffer, apiKey)
    console.log('[accounting] Settlement parse result:', JSON.stringify(result, null, 2))
    res.json({ ok: true, ...result })
  } catch (err) {
    console.error('[accounting] Settlement parse error:', err)
    res.status(500).json({ error: err.message })
  }
})

// ── Seller-side settlement (for the "We Sold It" close-out) ───────────────────
// Parses the SELLER's closing statement into the numbers the close-out needs:
// gross sale price, total selling costs, existing-loan payoff, and net proceeds.
router.post('/:propertyId/sale-settlement', upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' })
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) return res.status(500).json({ error: 'ANTHROPIC_API_KEY is not set' })
  try {
    const result = await parseSaleSettlement(req.file.buffer, req.file.originalname, apiKey)
    res.json({ ok: true, ...result })
  } catch (err) {
    console.error('[accounting] Sale settlement parse error:', err.message)
    res.status(500).json({ error: err.message })
  }
})

// ── Settlement re-balance ─────────────────────────────────────────────────────
// Re-reads the whole PDF from scratch (a fresh parse is far more reliable than
// asking the model to minimally edit an already-wrong extraction), then the
// SERVER decides whether it actually reconciles — the model's own claim is never
// trusted. A deterministic per-category diff shows the user what changed.
const $money = n => (n < 0 ? `-$${Math.abs(Math.round(n)).toLocaleString()}` : `$${Math.round(n).toLocaleString()}`)

function reconcileLines(lineItems) {
  const sum = t => lineItems.filter(x => x.treatment === t).reduce((s, x) => s + (Number(x.amount) || 0), 0)
  const expected = (sum('Purchase Price') - sum('Seller Credit') + sum('Buyer Closing Cost') + sum('Buyer Taxes Paid'))
    - (sum('Loan') + sum('1031 Exchange') + sum('Earnest Money') + sum('Tax Proration Credit')
       + sum('Rent Proration Credit') + sum('Insurance Credit') + sum('CAM Credit'))
  const stated = sum('Cash to Close')
  const gap = stated - expected
  return { expected, stated, gap, balanced: Math.abs(gap) < 2 || stated === 0 }
}

// Category-level diff between the old and re-parsed line items (deterministic).
function bucketDiff(oldLines, newLines) {
  const sumBy = (lines, t) => lines.filter(x => x.treatment === t).reduce((s, x) => s + (Number(x.amount) || 0), 0)
  const buckets = [...SETTLEMENT_TREATMENTS].filter(t => t !== 'Seller Closing Cost' && t !== 'Ignore')
  const out = []
  for (const t of buckets) {
    const o = sumBy(oldLines, t), n = sumBy(newLines, t)
    if (Math.abs(o - n) > 0.5) {
      out.push({ description: t, action: 'reclassified', from: $money(o), to: $money(n), reason: '' })
    }
  }
  return out
}

router.post('/:propertyId/settlement/rebalance', upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' })
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) return res.status(500).json({ error: 'ANTHROPIC_API_KEY is not set' })

  let payload = {}
  try { payload = JSON.parse(req.body.payload || '{}') } catch { /* ignore */ }
  const currentLines = Array.isArray(payload.line_items) ? payload.line_items : []

  try {
    // Fresh, from-scratch parse (Sonnet + column-based rules) — the reliable path.
    const fresh = await parseSettlementStatement(req.file.buffer, apiKey)
    const line_items = fresh.line_items || []
    const rec = reconcileLines(line_items)          // server-computed truth
    const changes = bucketDiff(currentLines, line_items)

    const explanation = rec.balanced
      ? `Re-read the statement from scratch — the buyer side now reconciles to a cash to close of ${$money(rec.stated)}.`
      : `Re-read the statement, but the buyer side is still off by ${$money(Math.abs(rec.gap))} (lines imply ${$money(rec.expected)}, statement says ${$money(rec.stated)}). A line is likely on the wrong side or an amount was misread — check the reconstructed statement, or a line may be missing.`

    res.json({ ok: true, reconciles: rec.balanced, gap: rec.gap, explanation, changes, line_items })
  } catch (err) {
    console.error('[accounting] Settlement rebalance error:', err)
    res.status(500).json({ error: err.message })
  }
})

// ── Bank Statement AI parse ───────────────────────────────────────────────────

router.post('/:propertyId/bank-statement', upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' })

  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) return res.status(500).json({ error: 'ANTHROPIC_API_KEY is not set' })

  const { originalname, buffer } = req.file
  console.log(`[accounting] Bank statement upload: ${originalname} (${buffer.length} bytes)`)

  try {
    const result = await parseBankStatement(buffer, apiKey)
    console.log(`[accounting] Bank statement parse: ${result.transactions?.length ?? 0} transactions`)
    res.json({ ok: true, ...result })
  } catch (err) {
    console.error('[accounting] Bank statement parse error:', err)
    res.status(500).json({ error: err.message })
  }
})

// ── AI helpers ────────────────────────────────────────────────────────────────

const SETTLEMENT_TREATMENTS = new Set(['Purchase Price','Seller Credit','Buyer Closing Cost','Seller Closing Cost','Loan','1031 Exchange','Earnest Money','Cash to Close','Tax Proration Credit','Rent Proration Credit','Insurance Credit','CAM Credit','Buyer Taxes Paid','Ignore'])

const SETTLEMENT_PROMPT = `You are extracting financial data from a real estate settlement statement. This may be a First American Title format (with Buyer Charge / Buyer Credit columns) or a HUD-1 format (with numbered sections 100-1400 and Borrower/Seller columns).

Return ONLY a valid JSON object in exactly this format — every field is required (use null if not found):
{
  "settlement_date": "YYYY-MM-DD or null",
  "property_address": "street address only (no city/state/zip) or null",
  "property_city": "city name or null",
  "property_state": "2-letter state abbreviation or null",
  "property_zip": "zip code as a string or null",
  "lender_name": "string or null",
  "purchase_price": number or null,
  "seller_closing_credit": number or null,
  "loan_amount": number or null,
  "earnest_money": number or null,
  "cash_to_close": number or null,
  "loan_origination_fee": number or null,
  "appraisal_fee": number or null,
  "title_and_closing_fees": number or null,
  "endorsements_fee": number or null,
  "recording_fees": number or null,
  "survey_fee": number or null,
  "environmental_fees": number or null,
  "flood_determination_fee": number or null,
  "acquisition_fee": number or null,
  "prorated_rent": number or null,
  "tax_credits": number or null,
  "insurance_credit": number or null,
  "cam_credit": number or null,
  "buyer_taxes_paid": number or null,
  "exchange_proceeds": number or null,
  "total_closing_costs": number or null,
  "broker_name": "string or null",
  "broker_commission": number or null,
  "uncertain_items": [],
  "line_items": [
    { "description": "exact label from the statement", "amount": number, "treatment": "one of the allowed treatments" }
  ]
}

LINE ITEMS — this is the most important part. "line_items" must contain EVERY individual money line on the settlement statement (the purchase price, every fee, every credit, every proration, the loan, earnest money, cash to close — all of it), each with:
- "description": the exact label text from the statement (e.g. "Consulting Fee to Knox Capital", "Phase II Environmental", "Lender's Title Policy", "County Recording")
- "amount": the dollar amount as a POSITIVE number
- "treatment": chosen from EXACTLY this list:
  "Purchase Price", "Seller Credit", "Buyer Closing Cost", "Seller Closing Cost", "Loan", "1031 Exchange", "Earnest Money", "Cash to Close", "Tax Proration Credit", "Rent Proration Credit", "Insurance Credit", "CAM Credit", "Buyer Taxes Paid", "Ignore"

BUYER SIDE ONLY — READ THE COLUMNS, this is critical. Our user is the BUYER, and this is the buyer's purchase. Only the buyer/borrower side belongs on our books. Extract ONLY buyer-relevant lines and SKIP the seller's own charges entirely:
- HUD-1 / ALTA: the LEFT money column is the Borrower/Buyer ("Paid From Borrower's Funds", "Borrower" column); the RIGHT column is the Seller ("Paid From Seller's Funds", "Seller" column). Extract from the Borrower column only.
- First American Title / four-column layout: the columns left to right are "Buyer Charge", "Buyer Credit", Description, "Seller Charge", "Seller Credit". Amounts to the LEFT of the description belong to the buyer; amounts to the RIGHT of the description belong to the seller. Use ONLY the Buyer Charge and Buyer Credit amounts. Completely ignore any figure printed in the Seller Charge or Seller Credit columns.
- SKIP ANY ROW whose amount(s) sit ONLY in a seller column (Seller Charge or Seller Credit) with nothing in the buyer columns — do not output it at all. Typical seller-only rows to drop entirely: real estate / broker commission, the seller's attorney fee, deed preparation fee, documentary/transfer/conveyance tax, recordation tax, the seller's loan payoff, any "… to <a third party>" disbursement shown in the Seller Charge column (e.g. a lease "Termination to <tenant>"), and the seller's net cash line ("Cash (To)(From) Seller").
- For a row that has amounts in BOTH a buyer column AND a seller column (e.g. "Total Consideration", a tax/CAM proration, an environmental-remediation or lease-termination credit), take ONLY the buyer-column figure as a single line item. NEVER add the seller-column figure and NEVER output the same row twice.
- INCLUDE every BUYER-CHARGE line: purchase price / total consideration → "Purchase Price"; title, escrow, recording, survey, appraisal, environmental, loan/origination fee, flood fee, tax-monitoring fee, review fee, consulting/acquisition fee, any funds-held-back / holdback the buyer funds, and any lease-termination or tenant buyout the BUYER pays for → "Buyer Closing Cost" (or the specific treatment). Also any back/current property taxes the buyer pays → "Buyer Taxes Paid".
- INCLUDE every BUYER-CREDIT line: the new loan → "Loan"; earnest money / "Deposits in Escrow" → "Earnest Money"; 1031/QI proceeds → "1031 Exchange"; tax/rent/insurance/CAM prorations credited to the buyer → the matching "… Credit"; a seller concession or seller-paid credit to the buyer (e.g. an environmental-remediation credit shown in the Buyer Credit column) → "Seller Credit"; the buyer's cash brought to closing ("Cash (X From) Buyer", "Cash From Borrower", "Net cash from borrower") → "Cash to Close".
- The buyer columns are self-contained and always foot to the same total. Do not reference, sum, or reconstruct the seller side at all. Never invent lines.

CLASSIFY BY COLUMN, NOT BY THE WORDS in the label — this is the #1 source of errors. The description may contain "Credit", "Termination", "Adjustment", or "Tax"; IGNORE the wording and decide the treatment purely from WHICH buyer column the dollar amount is printed in:
- Amount in the Buyer CHARGE column = a cost the buyer pays → "Buyer Closing Cost" (or "Purchase Price" / "Buyer Taxes Paid" where it clearly applies). This holds EVEN IF the label contains the word "Credit". Example: a lease termination or tenant buyout the buyer funds, shown in the Buyer Charge column and labeled e.g. "AAMCO Termination Credit", is a BUYER COST → "Buyer Closing Cost" (never "Seller Credit").
- Amount in the Buyer CREDIT column = something that REDUCES the buyer's cash (loan, earnest money, or a credit TO the buyer). Sub-rules:
  • A property-tax / rent / CAM / insurance PRORATION in the Buyer Credit column → the matching "Tax Proration Credit" / "Rent Proration Credit" / "CAM Credit" / "Insurance Credit". NEVER tag a proration in the credit column as "Buyer Taxes Paid". IMPORTANT: a real-estate-tax proration line — typically labeled "County Taxes", "Real Estate Taxes", "Property Tax", or "Taxes" and covering a date RANGE that ends on/near the closing date (e.g. "County Taxes 01/01/25 through 12/18/25 @ $17,815.86/yr") — is the seller's accrued unpaid taxes for the time they owned the property, credited to the buyer. In a purchase this is ALMOST ALWAYS a "Tax Proration Credit" (buyer credit), NOT "Buyer Taxes Paid". Only use "Buyer Taxes Paid" when the tax amount is unmistakably in the Buyer CHARGE column.
  • An adjustment or concession in the Buyer Credit column (e.g. "Environmental Remediation", a repair credit, a seller concession) is money the seller gives the buyer → "Seller Credit".
- "Buyer Taxes Paid" is ONLY for property taxes printed in the Buyer CHARGE column that the buyer actually pays as a cost — never for a tax amount in the credit column.
- SELF-CHECK before you answer: compute (Purchase Price − Seller Credit + all Buyer Closing Costs + Buyer Taxes Paid) − (Loan + 1031 Exchange + Earnest Money + every proration/… Credit). This MUST equal the buyer's Cash to Close figure. If it does not, you mis-read a column, an amount, or included a seller row — re-examine the buyer columns and correct it before returning.

Treatment guidance (within the correct side): purchase price → "Purchase Price"; the new mortgage → "Loan"; 1031/QI deposit → "1031 Exchange"; earnest money already paid → "Earnest Money"; cash due at closing → "Cash to Close"; buyer-side fees (title, escrow, recording, survey, appraisal, environmental/Phase I/II, flood, origination, consulting/acquisition fee, inspection, etc.) → "Buyer Closing Cost"; rent/tax/insurance/CAM prorations credited to the buyer → the matching "... Credit"; back/current property taxes the buyer pays → "Buyer Taxes Paid"; a seller credit/concession given to the buyer → "Seller Credit". When a BUYER-column item is unclear, prefer "Buyer Closing Cost". Ignore seller-column items entirely (do not emit them). Do not invent amounts; only include buyer-side lines that actually appear.

The other named fields above should still be filled as before (they are a roll-up summary), but the per-line "line_items" list is what the user edits.

Field extraction rules:
- All amounts as POSITIVE numbers (the sign/direction is handled by the journal entry logic)
- "property_address": street address only — do NOT include city, state, or zip here
- "property_city": city name from the property address section
- "property_state": 2-letter state abbreviation (e.g. "TN", "GA", "FL")
- "property_zip": zip or postal code as a string
- "lender_name": Full name of the lending institution / bank providing the mortgage. Look for "Lender:", "Bank:", or the institution name near the loan amount section. E.g. "Wells Fargo Bank", "Kendall Bank", "PNC Bank". Return just the name, no address.
- "purchase_price": Contract sales price / total consideration / purchase price line item
- "seller_closing_credit": Any credit or concession given BY the seller TO the buyer (e.g. "Seller Closing Credit", "Seller Concession", "Seller Repair Credit"). Do NOT include prorated rent or tax prorations here — those go in their own fields.
- "loan_amount": Principal amount of new mortgage/loan
- "earnest_money": Earnest money deposit already paid by the buyer prior to closing
- "cash_to_close": Net cash from borrower / cash to close / amount due from borrower / balance due at closing
- "loan_origination_fee": Loan origination fee, points, or lender fee
- "appraisal_fee": Appraisal or property valuation fee
- "title_and_closing_fees": Sum of title company charges — title insurance, escrow fee, settlement fee, closing fee, owner's policy, lender's policy, title search, title exam, notary fee, wire fee, document prep. Do NOT include endorsements (extract those separately).
- "endorsements_fee": Title endorsement fees (e.g. "Endorsement", "ALTA Endorsement", "Zoning Endorsement") — sum all endorsement line items
- "recording_fees": County recording or filing fees
- "survey_fee": Survey fee or boundary survey
- "environmental_fees": Phase I ESA, Phase II ESA, PCA (Property Condition Assessment), environmental report fees — sum all
- "flood_determination_fee": Flood determination fee, flood certification fee, or flood zone determination
- "acquisition_fee": Any fee paid to Knox Capital, acquisition fee, or advisory/consulting fee at closing
- "prorated_rent": Prorated rent credited to buyer (positive = credit to buyer)
- "tax_credits": Tax proration CREDITED to the buyer by the seller — i.e. seller's share of unpaid taxes given to buyer as a credit (HUD-1 lines 210-219, First American Buyer Credit column for taxes). Combine ALL real estate tax credit lines. Do NOT include taxes paid BY the buyer here.
- "insurance_credit": Insurance proration or escrow credit given to the buyer at closing (e.g. "Insurance Proration", "Hazard Insurance Credit", "Insurance Escrow Credit")
- "cam_credit": CAM, maintenance, or property management escrow credit given to the buyer (e.g. "CAM Credit", "Maintenance Credit", "Reserve Credit")
- "buyer_taxes_paid": Property taxes or back taxes PAID BY the buyer at closing — a cost to the buyer, not a credit (HUD-1 lines 1300-1399, e.g. line 1301 back taxes, delinquent taxes). If none, null.
- "exchange_proceeds": 1031 exchange proceeds deposited to escrow by a Qualified Intermediary (QI). Look for entries from "Investment Property Exchange", "Qualified Intermediary", "QI", "1031 Exchange", or similar in the Buyer Credit column. Return the amount as a positive number. If none, null.
- "broker_name": Name of the real estate broker or brokerage receiving a commission at closing (e.g. "Marcus & Millichap", "CBRE", or an individual broker's name). Look for "Commission", "Broker Fee", "Real Estate Commission" line items. If multiple brokers, the buyer-side broker. If none visible, null.
- "broker_commission": Real estate commission the BUYER pays at closing (buyer's column only) as a positive number. Ignore any seller-paid commission. If the buyer pays none, null.
- "total_closing_costs": BUYER-side settlement/closing charges only — the actual fees the buyer pays at closing. NEVER include any seller-column charge here, and exclude the purchase price and earnest money reimbursements.
  - For HUD-1: use line 103 "Settlement charges to borrower" exactly (borrower = buyer; ignore the seller column).
  - For First American Title: sum ONLY the fee/charge line items in the Buyer Charge column. EXCLUDE: (1) the "Total Consideration" / purchase price line, (2) any earnest money reimbursement disbursements paid back to the buyer or their principals at closing (lines labeled "EM Reimbursement", "Earnest Money Reimbursement", or similar). Include: loan fees, appraisal, title/escrow fees, endorsements, recording, environmental, survey, inspection, acquisition fees, and any other third-party closing charges.
  - Do NOT use the printed "Totals" row — that includes the purchase price. Sum the individual fee lines instead.

For HUD-1: line 101 = purchase price, lines 800s = loan charges, lines 1100s = title charges, lines 1200s = recording, line 201 = earnest money, line 120/303 = cash to close
For First American: look for Buyer Charge column (costs) and Buyer Credit column (credits/loans)

UNCERTAIN ITEMS — populate "uncertain_items" with any line items that appear on the statement but are ambiguous, unusual, or do not clearly belong to one of the fields above. Do NOT include items you placed confidently into a main field. Only flag line items where you genuinely do not know how to categorize them.

Watch for and flag:
- Fees marked "POC" (Paid Outside of Closing) — may or may not affect buyer's cost basis
- 1031 exchange proceeds, qualified intermediary deposits, or exchange funds
- Holdback amounts or post-closing escrow holdbacks
- A second mortgage, subordinate loan, or seller-carried note (beyond the primary loan_amount)
- Seller concessions credited directly to the buyer (if you cannot confidently put it in seller_closing_credit)
- Credits or adjustments where buyer vs. seller attribution is unclear
- Unusual advisory, consulting, or management fees with no clear category
- Any line item with a significant dollar amount you could not categorize with confidence

Each uncertain item must have:
- "description": exact label text from the settlement statement
- "amount": dollar amount as a positive number
- "suggestion": plain-English best guess, e.g. "Closing Costs", "Cash to Close", "Loan Amount", "Tax Proration", "Prorated Rent", "Seller Credit", or "Ignore"
- "reason": one sentence explaining the ambiguity

If no uncertain items exist, return: "uncertain_items": []

Return ONLY the JSON object, no markdown, no explanation.`

const BANK_STATEMENT_PROMPT = `You are extracting all transactions from a bank statement PDF.

Return ONLY a valid JSON object in exactly this format:
{
  "account_info": "account number or bank name if visible, else null",
  "statement_period": "e.g. January 2024 or null",
  "transactions": [
    { "date": "YYYY-MM-DD", "description": "...", "amount": number }
  ]
}

Amount is POSITIVE for deposits/credits, NEGATIVE for withdrawals/debits.
Include every transaction visible on the statement.
Return ONLY the JSON object, no markdown, no explanation.`

async function callClaude(apiKey, pdfBuffer) {
  const b64 = pdfBuffer.toString('base64')
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 8192,
      messages: [{
        role: 'user',
        content: [
          { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: b64 } },
          { type: 'text', text: '' }, // placeholder — replaced per call
        ],
      }],
    }),
  })
  return response
}

async function callClaudeWithPrompt(apiKey, buffer, prompt, model = 'claude-haiku-4-5-20251001') {
  const b64 = buffer.toString('base64')
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model,
      max_tokens: 8192,
      // Sonnet-class models default extended thinking ON, which would burn the
      // whole token budget on thinking and return no JSON. Force it off — the
      // prompts already carry the reasoning we need.
      thinking: { type: 'disabled' },
      messages: [{
        role: 'user',
        content: [
          { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: b64 } },
          { type: 'text', text: prompt },
        ],
      }],
    }),
  })

  if (!response.ok) {
    const err = await response.json().catch(() => ({}))
    throw new Error(err.error?.message || `Anthropic API error ${response.status}`)
  }

  const data = await response.json()
  const text = (data.content || []).filter(c => c.type === 'text').map(c => c.text).join('') || ''
  console.log('[accounting] Claude raw response (first 500):', text.slice(0, 500))

  const clean = text.replace(/```(?:json)?/g, '').trim()
  const match = clean.match(/\{[\s\S]*\}/)
  if (!match) throw new Error('Claude did not return a valid JSON object')
  return JSON.parse(match[0])
}

function cleanNum(v) {
  if (v === null || v === undefined) return null
  if (typeof v === 'string') {
    const s = v.replace(/[$,\s]/g, '')
    const n = parseFloat(s)
    return isFinite(n) ? n : null
  }
  return isFinite(v) ? v : null
}

function cleanDate(v) {
  if (!v || typeof v !== 'string') return null
  const d = new Date(v)
  if (isNaN(d) || d.getFullYear() < 1990) return null
  return d.toISOString().slice(0, 10)
}

// Settlement statements are dense multi-column tables with cross-column
// reconciling rows — use a stronger model than the default for column fidelity.
const SETTLEMENT_MODEL = 'claude-sonnet-5'

const SELLER_SETTLEMENT_PROMPT = `You are extracting the SELLER's numbers from a real estate settlement / closing statement for a property SALE. Our user is the SELLER. Read the columns carefully — HUD-1/ALTA has Borrower(Buyer) vs Seller columns; First American-style has "Seller Charge" / "Seller Credit" columns. Use ONLY the seller's side.

Return ONLY a valid JSON object in exactly this shape (use 0 if not present):
{
  "settlement_date": "YYYY-MM-DD or null",
  "sale_price": number,        // gross sale price / total consideration / contract sales price (the seller CREDIT for the price)
  "selling_costs": number,     // SUM of ALL seller-side closing COSTS: real estate/broker commission, seller's title/escrow/settlement/closing fees, owner's title policy paid by seller, documentary/transfer/conveyance/excise tax, deed prep, seller attorney, recording of releases, HOA/estoppel/tax certs, home warranty, seller-paid buyer credits/concessions, and any tax/rent/CAM proration CHARGED to the seller (credited to the buyer). EXCLUDE the sale price, the loan payoff, and the seller's net cash.
  "loan_payoff": number,       // payoff of the seller's existing mortgage(s)/loans/liens being released at closing
  "net_proceeds": number,      // net cash / proceeds to the seller ("Cash to Seller", "Balance due to Seller", "Proceeds to Seller")
  "broker_commission": number, // the real estate commission portion (already included in selling_costs)
  "line_items": [ { "description": "exact label", "amount": positive number, "kind": "sale_price|selling_cost|loan_payoff|proration|net_proceeds|other" } ]
}

Rules:
- All amounts POSITIVE numbers.
- selling_costs must NOT include the sale price, the loan payoff, or the net proceeds — only actual closing costs the seller pays.
- If the statement shows a seller commission of e.g. 6%, that dollar amount is part of selling_costs AND reported in broker_commission.
- A property-tax proration the SELLER owes the buyer (seller charge / buyer credit) is a selling cost. A proration the buyer owes the seller (seller credit) reduces selling costs — net it out.
- Sanity: sale_price - selling_costs - loan_payoff should ≈ net_proceeds. If your numbers don't foot to the stated net proceeds, re-check the columns before answering.
- Include a per-line "line_items" breakdown for transparency.
Return ONLY the JSON object, no markdown.`

async function parseSaleSettlement(buffer, originalname, apiKey) {
  const ext = (originalname.split('.').pop() || '').toLowerCase()
  let raw
  if (ext === 'pdf') {
    raw = await callClaudeWithPrompt(apiKey, buffer, SELLER_SETTLEMENT_PROMPT, SETTLEMENT_MODEL)
  } else if (['xlsx', 'xls', 'csv'].includes(ext)) {
    const wb = XLSX.read(buffer, { type: 'buffer' })
    const csv = XLSX.utils.sheet_to_csv(wb.Sheets[wb.SheetNames[0]])
    raw = await callClaudeTextJson(apiKey, csv, SELLER_SETTLEMENT_PROMPT)
  } else {
    throw new Error('Upload a PDF, XLSX, or CSV settlement statement')
  }
  const cn = v => { const n = cleanNum(v); return (n !== null && isFinite(n) && n > 0) ? n : 0 }
  return {
    settlement_date:   cleanDate(raw.settlement_date),
    sale_price:        cn(raw.sale_price),
    selling_costs:     cn(raw.selling_costs),
    loan_payoff:       cn(raw.loan_payoff),
    net_proceeds:      cn(raw.net_proceeds),
    broker_commission: cn(raw.broker_commission),
    line_items: (Array.isArray(raw.line_items) ? raw.line_items : [])
      .filter(it => it && typeof it.description === 'string' && it.description.trim())
      .map(it => ({ description: String(it.description).trim(), amount: cn(it.amount), kind: it.kind || 'other' }))
      .filter(it => it.amount > 0),
  }
}

async function parseSettlementStatement(buffer, apiKey) {
  const raw = await callClaudeWithPrompt(apiKey, buffer, SETTLEMENT_PROMPT, SETTLEMENT_MODEL)

  const cn = v => {
    const n = cleanNum(v)
    return (n !== null && isFinite(n) && n > 0) ? n : null
  }

  const cleanStr = v => (typeof v === 'string' && v.trim()) ? v.trim() : null

  return {
    settlement_date:        cleanDate(raw.settlement_date),
    property_address:       cleanStr(raw.property_address),
    property_city:          cleanStr(raw.property_city),
    property_state:         cleanStr(raw.property_state),
    property_zip:           cleanStr(raw.property_zip),
    lender_name:            cleanStr(raw.lender_name),
    purchase_price:         cn(raw.purchase_price),
    seller_closing_credit:  cn(raw.seller_closing_credit),
    loan_amount:            cn(raw.loan_amount),
    earnest_money:          cn(raw.earnest_money),
    cash_to_close:          cn(raw.cash_to_close),
    loan_origination_fee:   cn(raw.loan_origination_fee),
    appraisal_fee:          cn(raw.appraisal_fee),
    title_and_closing_fees: cn(raw.title_and_closing_fees),
    endorsements_fee:       cn(raw.endorsements_fee),
    recording_fees:         cn(raw.recording_fees),
    survey_fee:             cn(raw.survey_fee),
    environmental_fees:     cn(raw.environmental_fees),
    flood_determination_fee: cn(raw.flood_determination_fee),
    acquisition_fee:        cn(raw.acquisition_fee),
    prorated_rent:          cn(raw.prorated_rent),
    tax_credits:            cn(raw.tax_credits),
    insurance_credit:       cn(raw.insurance_credit),
    cam_credit:             cn(raw.cam_credit),
    buyer_taxes_paid:       cn(raw.buyer_taxes_paid),
    exchange_proceeds:      cn(raw.exchange_proceeds),
    total_closing_costs:    cn(raw.total_closing_costs),
    broker_name:            cleanStr(raw.broker_name),
    broker_commission:      cn(raw.broker_commission),
    uncertain_items: (() => {
      if (!Array.isArray(raw.uncertain_items)) return []
      return raw.uncertain_items
        .filter(item => item && typeof item.description === 'string' && item.description.trim())
        .map(item => ({
          description: String(item.description).trim(),
          amount:      cleanNum(item.amount),
          suggestion:  typeof item.suggestion === 'string' ? item.suggestion.trim() : null,
          reason:      typeof item.reason    === 'string' ? item.reason.trim()    : null,
        }))
        .filter(item => item.amount !== null && item.amount > 0)
    })(),
    line_items: (() => {
      const VALID = SETTLEMENT_TREATMENTS
      if (!Array.isArray(raw.line_items)) return []
      return raw.line_items
        .filter(it => it && typeof it.description === 'string' && it.description.trim())
        .map(it => ({
          description: String(it.description).trim(),
          amount:      cleanNum(it.amount),
          treatment:   VALID.has(it.treatment) ? it.treatment : 'Buyer Closing Cost',
        }))
        .filter(it => it.amount !== null && it.amount > 0)
    })(),
  }
}

const INVESTOR_PROMPT = `You are extracting investor contribution data from a real estate investment spreadsheet.

Return ONLY a valid JSON object in exactly this format:
{
  "investors": [
    {
      "name": "Full Name",
      "address": "full mailing address or null",
      "contribution": 250000,
      "percentage": 12.5,
      "class": "Investor",
      "preferred_return": 8.0
    }
  ]
}

Rules:
- "name": the investor's full name (string, required)
- "address": their mailing address if shown, otherwise null
- "contribution": capital contribution amount as a positive number (no $ signs or commas)
- "percentage": ownership percentage as a number 0-100 (e.g. 12.5 for 12.5%), or null if not shown
- "class": "Sponsor" or "Investor" based on the column/label in the spreadsheet; if unclear use "Investor"
- "preferred_return": preferred return as a percentage number (e.g. 8 for 8%), or null if not shown
- Extract ALL rows that represent investor contributions
- Skip header rows, totals rows, or blank rows
- Return ONLY the JSON object, no markdown, no explanation`

async function parseInvestorContributions(apiKey, excelText) {
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 8192,
      messages: [{
        role: 'user',
        content: `${INVESTOR_PROMPT}\n\nHere is the spreadsheet data:\n\n${excelText}`,
      }],
    }),
  })

  if (!response.ok) {
    const err = await response.json().catch(() => ({}))
    throw new Error(err.error?.message || `Anthropic API error ${response.status}`)
  }

  const data = await response.json()
  const text = data.content?.[0]?.text || ''
  console.log('[accounting] Investor Claude raw (first 500):', text.slice(0, 500))

  const clean = text.replace(/```(?:json)?/g, '').trim()
  const match = clean.match(/\{[\s\S]*\}/)
  if (!match) throw new Error('Claude did not return a valid JSON object')

  const raw = JSON.parse(match[0])
  const investors = (raw.investors || []).map(inv => ({
    name:             String(inv.name || '').trim(),
    address:          inv.address ? String(inv.address).trim() : null,
    contribution:     Math.abs(cleanNum(inv.contribution) ?? 0),
    percentage:       cleanNum(inv.percentage),
    class:            ['Sponsor', 'Investor'].includes(inv.class) ? inv.class : 'Investor',
    preferred_return: cleanNum(inv.preferred_return),
  })).filter(inv => inv.name && inv.contribution > 0)

  return { investors }
}

async function parseBankStatement(buffer, apiKey) {
  const raw = await callClaudeWithPrompt(apiKey, buffer, BANK_STATEMENT_PROMPT)

  const account_info     = raw.account_info     || null
  const statement_period = raw.statement_period || null

  const transactions = (raw.transactions || [])
    .map(t => ({
      date:        cleanDate(t.date) || new Date().toISOString().slice(0, 10),
      description: String(t.description || '').trim(),
      amount:      cleanNum(t.amount) ?? 0,
    }))
    .filter(t => t.description && t.amount !== 0)

  return { account_info, statement_period, transactions }
}

export default router
