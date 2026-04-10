import { Router } from 'express'
import multer from 'multer'
import db from '../db.js'

const router = Router()
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 30 * 1024 * 1024 } })

const CATEGORIES = ['Equity Contribution', 'Purchase', 'Rent', 'Mortgage', 'Repair', 'Sale', 'Other']
const SOURCES    = ['Manual', 'Settlement Statement', 'Bank Statement']

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
  const txn = db.transaction(() => {
    for (const t of payload) {
      const { date, description, category, amount, source = 'Manual' } = t
      if (!date || !description || !category || amount === undefined) {
        throw new Error(`Missing required fields on transaction: ${JSON.stringify(t)}`)
      }
      if (!CATEGORIES.includes(category)) throw new Error(`Invalid category: ${category}`)
      if (!SOURCES.includes(source))    throw new Error(`Invalid source: ${source}`)
      const r = stmt.run(propertyId, date, description, category, parseFloat(amount), source)
      created.push({ id: r.lastInsertRowid, property_id: Number(propertyId), date, description, category, amount: parseFloat(amount), source })
    }
  })
  txn()

  res.status(201).json(created)
})

// ── Delete a transaction ──────────────────────────────────────────────────────

router.delete('/transactions/:id', (req, res) => {
  db.prepare('DELETE FROM accounting_transactions WHERE id = ?').run(req.params.id)
  res.status(204).end()
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

const SETTLEMENT_PROMPT = `You are extracting financial data from a real estate settlement statement (HUD-1, ALTA Closing Disclosure, or similar).

Return ONLY a valid JSON object in exactly this format:
{
  "settlement_date": "YYYY-MM-DD or null",
  "property_address": "street address or null",
  "transactions": [
    { "description": "...", "category": "...", "amount": number }
  ]
}

Extract each of the following as separate transaction objects. Amount is NEGATIVE for money you pay out, POSITIVE for money you receive:

1. Purchase Price — category "Purchase", amount NEGATIVE (e.g. -1500000)
2. Loan Amount / Mortgage — category "Other", description "Loan Proceeds", amount POSITIVE (e.g. +1000000)
3. Loan Origination / Lender Fee — category "Other", description "Loan Origination Fee", amount NEGATIVE
4. Appraisal Fee — category "Other", description "Appraisal Fee", amount NEGATIVE
5. Title Insurance — category "Other", description "Title Insurance", amount NEGATIVE
6. Escrow / Settlement Fee — category "Other", description "Escrow/Settlement Fee", amount NEGATIVE
7. Broker Compensation / Commission (buyer side) — category "Other", description "Broker Compensation", amount NEGATIVE
8. Acquisition Fee — category "Other", description "Acquisition Fee", amount NEGATIVE
9. Environmental / Phase I / Survey Fees — category "Other", description "Environmental/Survey Fee", amount NEGATIVE
10. Cash to Close / Cash From Borrower — category "Equity Contribution", description "Cash to Close", amount NEGATIVE (this is your equity invested)

Only include items that are actually present in the document. Skip items not found. Do not invent numbers.
category must be exactly one of: "Equity Contribution", "Purchase", "Rent", "Mortgage", "Repair", "Sale", "Other"
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

  const settlement_date    = cleanDate(raw.settlement_date)
  const property_address   = typeof raw.property_address === 'string' ? raw.property_address.trim() : null

  const transactions = (raw.transactions || [])
    .map(t => ({
      description: String(t.description || '').trim(),
      category:    CATEGORIES.includes(t.category) ? t.category : 'Other',
      amount:      cleanNum(t.amount) ?? 0,
    }))
    .filter(t => t.description && t.amount !== 0)

  // Apply the settlement date to all transactions so the client can use it
  return { settlement_date, property_address, transactions }
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
