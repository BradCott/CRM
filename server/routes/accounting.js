import { Router } from 'express'
import multer from 'multer'
import * as XLSX from 'xlsx'
import db from '../db.js'
import { autoLinkInvestors } from '../services/investorMatch.js'
import { categorizeBatch, learnRules } from '../utils/categorize.js'

const router = Router()
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 30 * 1024 * 1024 } })

const BUILTIN_CATEGORIES = [
  'Equity Contribution', 'Purchase', 'Loan', 'Rent', 'Mortgage', 'Mortgage Interest',
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
    transactions: txStmt.all(p.id),
    investors:    invStmt.all(p.id),
  }))

  res.json(result)
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
      COALESCE(SUM(tx.amount), 0) AS cash_balance,
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
    SELECT id, property_id, date, description, category, amount, source, vendor, reconciled,
           review_status, external_id, created_at
    FROM accounting_transactions
    WHERE property_id = ?
    ORDER BY date ASC, id ASC
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
    INSERT INTO accounting_transactions (property_id, date, description, category, amount, source, vendor)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `)

  const created = []
  for (const t of payload) {
    const { date, description, category, amount, source = 'Manual', vendor = null } = t
    if (!date || !description || !category || amount === undefined) {
      return res.status(400).json({ error: `Missing required fields on transaction: ${JSON.stringify(t)}` })
    }
    if (!CATEGORIES.includes(category)) return res.status(400).json({ error: `Invalid category: ${category}` })
    if (!SOURCES.includes(source))      return res.status(400).json({ error: `Invalid source: ${source}` })
    const r = stmt.run(propertyId, date, description, category, parseFloat(amount), source, vendor || null)
    created.push({ id: r.lastInsertRowid, property_id: Number(propertyId), date, description, category, amount: parseFloat(amount), source, vendor: vendor || null })
  }

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

// ── Delete a transaction ──────────────────────────────────────────────────────

router.delete('/transactions/:id', (req, res) => {
  db.prepare('DELETE FROM accounting_transactions WHERE id = ?').run(req.params.id)
  res.status(204).end()
})

// ── Charge-type registry (custom categories) ──────────────────────────────────

router.get('/categories', (_req, res) => {
  const custom = db.prepare('SELECT id, name, kind FROM custom_categories ORDER BY name').all()
  res.json({ builtin: BUILTIN_CATEGORIES, custom })
})

router.post('/categories', (req, res) => {
  const name = (req.body?.name || '').trim()
  const kind = req.body?.kind === 'income' ? 'income' : 'expense'
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
    SELECT id, property_id, name, address, contribution, percentage, class, preferred_return, created_at
    FROM property_investors
    WHERE property_id = ?
    ORDER BY contribution DESC
  `).all(propertyId)
  res.json(rows)
})

router.post('/:propertyId/investors', (req, res) => {
  const { propertyId } = req.params
  const prop = db.prepare('SELECT id FROM properties WHERE id = ?').get(propertyId)
  if (!prop) return res.status(404).json({ error: 'Property not found' })

  const investors = Array.isArray(req.body) ? req.body : [req.body]
  if (!investors.length) return res.status(400).json({ error: 'No investors provided' })

  const today = new Date().toISOString().slice(0, 10)

  const insertInvestor = db.prepare(`
    INSERT INTO property_investors (property_id, name, address, contribution, percentage, class, preferred_return)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `)
  const insertTx = db.prepare(`
    INSERT INTO accounting_transactions (property_id, date, description, category, amount, source)
    VALUES (?, ?, ?, 'Equity Contribution', ?, 'Excel Upload')
  `)

  const saved = []
  for (const inv of investors) {
    const { name, address, contribution, percentage, class: cls, preferred_return } = inv
    if (!name || contribution === undefined) {
      return res.status(400).json({ error: `Missing name or contribution for investor: ${JSON.stringify(inv)}` })
    }
    const amount = Math.abs(parseFloat(contribution))
    const r = insertInvestor.run(propertyId, name.trim(), address || null, amount, percentage ?? null, cls || null, preferred_return ?? null)
    insertTx.run(propertyId, today, name.trim(), amount)
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
  "uncertain_items": []
}

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
- "broker_commission": Total real estate commission paid at closing as a positive number. Sum buyer-side and seller-side if both shown on this statement. If none, null.
- "total_closing_costs": Settlement/closing charges only — the actual fees paid at closing, NOT including the purchase price or earnest money reimbursements.
  - For HUD-1: use line 103 "Settlement charges to borrower" exactly.
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
      max_tokens: 4096,
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

async function callClaudeWithPrompt(apiKey, buffer, prompt) {
  const b64 = buffer.toString('base64')
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 4096,
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
  const text = data.content?.[0]?.text || ''
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

async function parseSettlementStatement(buffer, apiKey) {
  const raw = await callClaudeWithPrompt(apiKey, buffer, SETTLEMENT_PROMPT)

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
      max_tokens: 4096,
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
