import { Router } from 'express'
import multer from 'multer'
import * as XLSX from 'xlsx'
import db from '../db.js'

const router = Router()
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 30 * 1024 * 1024 } })

const CATEGORIES = ['Equity Contribution', 'Purchase', 'Loan', 'Rent', 'Mortgage', 'Repair', 'Sale', 'Other']
const SOURCES    = ['Manual', 'Settlement Statement', 'Bank Statement', 'Excel Upload']

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
    LEFT JOIN accounting_transactions tx ON tx.property_id = p.id
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
    SELECT id, property_id, date, description, category, amount, source, created_at
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
    INSERT INTO accounting_transactions (property_id, date, description, category, amount, source)
    VALUES (?, ?, ?, ?, ?, ?)
  `)

  const created = []
  for (const t of payload) {
    const { date, description, category, amount, source = 'Manual' } = t
    if (!date || !description || !category || amount === undefined) {
      return res.status(400).json({ error: `Missing required fields on transaction: ${JSON.stringify(t)}` })
    }
    if (!CATEGORIES.includes(category)) return res.status(400).json({ error: `Invalid category: ${category}` })
    if (!SOURCES.includes(source))      return res.status(400).json({ error: `Invalid source: ${source}` })
    const r = stmt.run(propertyId, date, description, category, parseFloat(amount), source)
    created.push({ id: r.lastInsertRowid, property_id: Number(propertyId), date, description, category, amount: parseFloat(amount), source })
  }

  res.status(201).json(created)
})

// ── Delete a transaction ──────────────────────────────────────────────────────

router.delete('/transactions/:id', (req, res) => {
  db.prepare('DELETE FROM accounting_transactions WHERE id = ?').run(req.params.id)
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

  res.status(201).json(saved)
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
  "property_address": "street address or null",
  "purchase_price": number or null,
  "loan_amount": number or null,
  "earnest_money": number or null,
  "cash_to_close": number or null,
  "loan_origination_fee": number or null,
  "appraisal_fee": number or null,
  "title_and_closing_fees": number or null,
  "recording_fees": number or null,
  "survey_fee": number or null,
  "environmental_fees": number or null,
  "acquisition_fee": number or null,
  "prorated_rent": number or null,
  "tax_credits": number or null,
  "buyer_taxes_paid": number or null,
  "total_closing_costs": number or null
}

Field extraction rules:
- All amounts as POSITIVE numbers (the sign/direction is handled by the journal entry logic)
- "purchase_price": Contract sales price / purchase price line item
- "loan_amount": Principal amount of new mortgage/loan
- "earnest_money": Earnest money deposit already paid
- "cash_to_close": Net cash from borrower / cash to close / amount due from borrower
- "loan_origination_fee": Loan origination fee, points, or lender fee
- "appraisal_fee": Appraisal or property valuation fee
- "title_and_closing_fees": Sum ALL title company charges — title insurance, escrow fee, settlement fee, closing fee, owner's policy, lender's policy, title search, title exam, notary fee, wire fee, document prep
- "recording_fees": County recording or filing fees
- "survey_fee": Survey fee
- "environmental_fees": Phase I ESA, Phase II ESA, PCA (Property Condition Assessment), environmental report fees — sum all
- "acquisition_fee": Any fee paid to Knox Capital, acquisition fee, or advisory/consulting fee at closing
- "prorated_rent": Prorated rent credited to buyer (positive = credit to buyer)
- "tax_credits": Tax proration CREDITED to the buyer by the seller — i.e. seller's share of unpaid taxes given to buyer as a credit (HUD-1 lines 210-219, First American Buyer Credit column for taxes). Do NOT include taxes paid BY the buyer here.
- "buyer_taxes_paid": Property taxes or back taxes PAID BY the buyer at closing — a cost to the buyer, not a credit (HUD-1 lines 1300-1399, e.g. line 1301 back taxes, delinquent taxes). If none, null.
- "total_closing_costs": The single total of ALL settlement charges paid by the buyer — use HUD-1 line 103 "Settlement charges to borrower" exactly; for First American Title use the total of all Buyer Charge column entries (excluding purchase price and loan payoff). This is the authoritative total used for the journal entry — do not sum individual items yourself, find the printed total line.

For HUD-1: line 101 = purchase price, lines 800s = loan charges, lines 1100s = title charges, lines 1200s = recording, line 201 = earnest money, line 120/303 = cash to close
For First American: look for Buyer Charge column (costs) and Buyer Credit column (credits/loans)

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

  return {
    settlement_date:      cleanDate(raw.settlement_date),
    property_address:     typeof raw.property_address === 'string' ? raw.property_address.trim() : null,
    purchase_price:       cn(raw.purchase_price),
    loan_amount:          cn(raw.loan_amount),
    earnest_money:        cn(raw.earnest_money),
    cash_to_close:        cn(raw.cash_to_close),
    loan_origination_fee: cn(raw.loan_origination_fee),
    appraisal_fee:        cn(raw.appraisal_fee),
    title_and_closing_fees: cn(raw.title_and_closing_fees),
    recording_fees:       cn(raw.recording_fees),
    survey_fee:           cn(raw.survey_fee),
    environmental_fees:   cn(raw.environmental_fees),
    acquisition_fee:      cn(raw.acquisition_fee),
    prorated_rent:        cn(raw.prorated_rent),
    tax_credits:          cn(raw.tax_credits),
    buyer_taxes_paid:     cn(raw.buyer_taxes_paid),
    total_closing_costs:  cn(raw.total_closing_costs),
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
