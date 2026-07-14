// In-app AI copilot — answers questions AND performs actions (confirm-first).
// Read tools run automatically server-side; write tools are proposed to the
// user as actions they must confirm before anything is changed.
import { Router } from 'express'
import * as XLSX from 'xlsx'
import db from '../db.js'
import { searchDriveForProperty } from '../services/driveSearch.js'

const router = Router()

// Full schema (tables + columns) so the copilot can query anything via run_sql.
const DB_SCHEMA = (() => {
  try {
    const tables = db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name`).all()
    return tables.map(t => {
      const cols = db.prepare(`PRAGMA table_info("${t.name}")`).all().map(c => c.name).join(', ')
      return `${t.name}(${cols})`
    }).join('\n')
  } catch { return '' }
})()

// Run a strictly read-only SELECT. Everything the user has recorded is queryable.
function runReadOnlySql(sql) {
  let q = String(sql || '').trim().replace(/;+\s*$/, '')
  if (!/^\s*(select|with)\b/i.test(q)) throw new Error('Only SELECT / WITH queries are allowed')
  if (/;/.test(q)) throw new Error('Only a single statement is allowed')
  if (/\b(insert|update|delete|drop|alter|create|replace|attach|detach|pragma|vacuum|reindex)\b/i.test(q)) throw new Error('Read-only queries only')
  if (!/\blimit\b/i.test(q)) q += ' LIMIT 200'
  return db.prepare(q).all()
}

// Sonnet for real reasoning over documents + the books. Thinking is disabled in
// the request (Sonnet defaults it on, which would blow the token budget).
const MODEL = process.env.ASSISTANT_MODEL || 'claude-sonnet-5'

// Turn an uploaded attachment { name, mime, data(base64) } into an Anthropic
// content block. PDFs/images go in natively; spreadsheets/CSV/text are extracted.
function attachmentToBlock(att) {
  const name = att?.name || 'file'
  const mime = (att?.mime || '').toLowerCase()
  const data = att?.data || ''
  if (!data) return null
  try {
    if (mime === 'application/pdf' || name.toLowerCase().endsWith('.pdf')) {
      return { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data } }
    }
    if (/^image\/(png|jpe?g|gif|webp)$/.test(mime)) {
      return { type: 'image', source: { type: 'base64', media_type: mime, data } }
    }
    const buf = Buffer.from(data, 'base64')
    if (/\.(xlsx|xls|csv)$/i.test(name) || mime.includes('spreadsheet') || mime.includes('excel') || mime === 'text/csv') {
      const wb = XLSX.read(buf, { type: 'buffer' })
      const csv = wb.SheetNames.map(n => `# Sheet: ${n}\n${XLSX.utils.sheet_to_csv(wb.Sheets[n])}`).join('\n\n')
      return { type: 'text', text: `Attached spreadsheet "${name}":\n${csv.slice(0, 20000)}` }
    }
    // Plain text / anything decodable
    return { type: 'text', text: `Attached file "${name}":\n${buf.toString('utf8').slice(0, 20000)}` }
  } catch {
    return { type: 'text', text: `(Could not read attachment "${name}".)` }
  }
}

const BUILTIN_CATEGORIES = [
  'Equity Contribution', 'Purchase', 'Loan', 'Rent', 'Mortgage', 'Mortgage Interest',
  'Mortgage Principal', 'Repair', 'Sale', 'Insurance', 'Property Tax', 'Utilities',
  'Management Fees', 'Legal & Professional', 'Advertising', 'Supplies', 'Travel',
  'Commissions', 'Cleaning & Maintenance', 'HOA / CAM', 'Bank Charges', 'Other',
]
function isValidCategory(name) {
  if (BUILTIN_CATEGORIES.includes(name)) return true
  return !!db.prepare('SELECT 1 FROM custom_categories WHERE name = ?').get(name)
}

const SYSTEM_PROMPT = `You are the Knox Capital CRM copilot — an embedded assistant inside a commercial real estate investment firm's app. You help the team understand accounting/deal situations, use the app, AND take actions on their behalf.

You CAN see the user's screen: each message includes the visible page text (and any open dialog) as context. Use it directly; never ask the user to paste what they're looking at.

The user can ATTACH DOCUMENTS (PDFs, spreadsheets, images, closing statements, leases, rent rolls). When they do, read the document carefully and use it: extract the relevant figures, compare them to what's in the CRM, and PROPOSE the concrete changes that make sense (create/edit transactions, fix categories, update property or cap-table fields). Don't just describe the document — turn it into proposed actions.

You have TOOLS — you are NOT limited to what's on screen. You can read EVERYTHING the user has recorded:
- run_sql is your most powerful tool: a read-only SELECT against the whole database (all tables — see the DATABASE SCHEMA below). Use it to answer anything the narrower tools don't cover, to cross-reference, or to double-check. Write correct SQLite using the schema.
- Convenience read tools (find_properties, find_people, get_property_summary, find_transactions, get_cap_table, list_bills, get_settlement, list_property_documents) run immediately too. get_settlement returns the recorded settlement line items + totals + whether it balances; get_cap_table returns the investors (with their master investor_id); list_property_documents lists the files uploaded to a property's Drive folder.
- Use these to VERIFY before answering or acting — never speculate about the data when you can query it.
- Action tools (recategorize_transactions, update_transaction, split_transaction, record_transactions, delete_transactions, create_transaction, create_bill, pay_bill, record_earnest_as_equity, update_investor_contribution, delete_investor, update_property_fields, delete_properties, delete_people) DO NOT run immediately. When you call one it is shown to the user as a proposed action with a Confirm button — they approve it. Look up exact record ids first, then propose the action(s). Briefly tell the user what you're proposing.

Rules:
- Always resolve real record ids with read tools before proposing an action. Never guess ids or speculate about the data model — use get_settlement / find_transactions / get_cap_table to CHECK.
- Be proactive and specific: when intent is clear, propose the exact edits rather than asking a series of questions.
- EARNEST MONEY → EQUITY: to credit earnest money as an investor's equity, use record_earnest_as_equity (transaction_id = the earnest-money line from find_transactions; investor_id = the master investor_id from get_cap_table). It ADDS an offsetting Equity Contribution and leaves the earnest line and the settlement untouched, so the statement stays balanced. Do NOT recategorize the earnest-money line to do this — that would distort the settlement. You can call get_settlement before and after to confirm it still balances.
- For destructive actions (delete), be explicit about how many records and which ones.
- Amounts: POSITIVE = money in, NEGATIVE = money out. Mortgage Interest is a P&L expense; Mortgage Principal is a loan paydown (not P&L).
- Be concise and practical. You are not a substitute for a CPA on filing decisions, but give your best practical recommendation.`

// ── Tool definitions ──────────────────────────────────────────────────────────

const READ_TOOLS = [
  {
    name: 'find_properties',
    description: 'Search properties by address, city, state, or tenant brand. Returns matching properties with ids.',
    input_schema: { type: 'object', properties: { query: { type: 'string', description: 'Search text (address, city, tenant brand)' } }, required: ['query'] },
  },
  {
    name: 'find_people',
    description: 'Search people (owners, brokers, tenant contacts) by name. Returns matching people with ids.',
    input_schema: { type: 'object', properties: { query: { type: 'string' }, role: { type: 'string', description: 'Optional role filter: owner, owner_company, broker, tenant_contact' } }, required: ['query'] },
  },
  {
    name: 'get_property_summary',
    description: 'Financial summary (rent, expenses, NOI, cash balance) and recent transactions for one property.',
    input_schema: { type: 'object', properties: { property_id: { type: 'number' } }, required: ['property_id'] },
  },
  {
    name: 'find_transactions',
    description: 'List transactions for a property, optionally filtered by category, description text, or review status (recorded / needs_review).',
    input_schema: { type: 'object', properties: { property_id: { type: 'number' }, category: { type: 'string' }, description: { type: 'string' }, status: { type: 'string' } }, required: ['property_id'] },
  },
  {
    name: 'get_cap_table',
    description: "A property's investors / cap table — each row's id, name, class (Investor/Sponsor), committed contribution, and recorded equity. Use the row id for update_investor_contribution / delete_investor.",
    input_schema: { type: 'object', properties: { property_id: { type: 'number' } }, required: ['property_id'] },
  },
  {
    name: 'list_bills',
    description: 'Bills (accounts payable) for a property — id, payee, amount, category, due date, paid status. Use the id for pay_bill.',
    input_schema: { type: 'object', properties: { property_id: { type: 'number' }, unpaid_only: { type: 'boolean' } }, required: ['property_id'] },
  },
  {
    name: 'get_settlement',
    description: "The property's recorded settlement statement — every line item with its treatment, the rolled-up totals, and whether it balances (cash-to-close). Use this to reason about acquisition entries before proposing changes.",
    input_schema: { type: 'object', properties: { property_id: { type: 'number' } }, required: ['property_id'] },
  },
  {
    name: 'run_sql',
    description: "Run a READ-ONLY SQL SELECT against the CRM database to answer anything about what the user has recorded — across ALL tables (properties, people, accounting_transactions, property_investors, property_bills, property_settlements, loan_schedules, investor_distributions, operators, deals, journal entries, etc.). Use the provided schema. Single SELECT/WITH statement only; auto-limited. Prefer this for anything the narrower tools don't cover.",
    input_schema: { type: 'object', properties: { sql: { type: 'string', description: 'A single read-only SELECT (or WITH) statement.' } }, required: ['sql'] },
  },
  {
    name: 'list_property_documents',
    description: "List the files in a property's Google Drive folder (the documents that have been uploaded/filed for it) — names + ids. The user can attach any of these to the chat for you to read in full.",
    input_schema: { type: 'object', properties: { property_id: { type: 'number' } }, required: ['property_id'] },
  },
]

const WRITE_TOOLS = [
  {
    name: 'recategorize_transactions',
    description: 'Change the category of one or more transactions.',
    input_schema: { type: 'object', properties: { transaction_ids: { type: 'array', items: { type: 'number' } }, category: { type: 'string' } }, required: ['transaction_ids', 'category'] },
  },
  {
    name: 'split_transaction',
    description: 'Split one transaction into multiple category lines that sum to its amount (e.g. principal + interest).',
    input_schema: { type: 'object', properties: { transaction_id: { type: 'number' }, lines: { type: 'array', items: { type: 'object', properties: { category: { type: 'string' }, amount: { type: 'number' } } } } }, required: ['transaction_id', 'lines'] },
  },
  {
    name: 'record_transactions',
    description: 'Record (approve) needs-review transactions into the books.',
    input_schema: { type: 'object', properties: { transaction_ids: { type: 'array', items: { type: 'number' } } }, required: ['transaction_ids'] },
  },
  {
    name: 'create_bill',
    description: 'Create an upcoming bill (accounts payable) for a property.',
    input_schema: { type: 'object', properties: { property_id: { type: 'number' }, payee: { type: 'string' }, amount: { type: 'number' }, category: { type: 'string' }, due_date: { type: 'string', description: 'YYYY-MM-DD' } }, required: ['property_id', 'payee', 'amount', 'due_date'] },
  },
  {
    name: 'create_transaction',
    description: 'Add a transaction to a property ledger. amount POSITIVE = money in, NEGATIVE = money out.',
    input_schema: { type: 'object', properties: { property_id: { type: 'number' }, date: { type: 'string' }, description: { type: 'string' }, category: { type: 'string' }, amount: { type: 'number' } }, required: ['property_id', 'date', 'description', 'category', 'amount'] },
  },
  {
    name: 'update_transaction',
    description: 'Edit fields of an existing transaction. Only include the fields you want to change.',
    input_schema: { type: 'object', properties: { transaction_id: { type: 'number' }, date: { type: 'string' }, description: { type: 'string' }, category: { type: 'string' }, amount: { type: 'number' }, vendor: { type: 'string' } }, required: ['transaction_id'] },
  },
  {
    name: 'delete_transactions',
    description: 'Delete one or more transactions by id.',
    input_schema: { type: 'object', properties: { transaction_ids: { type: 'array', items: { type: 'number' } } }, required: ['transaction_ids'] },
  },
  {
    name: 'pay_bill',
    description: 'Mark a bill paid — posts the payment to the ledger.',
    input_schema: { type: 'object', properties: { bill_id: { type: 'number' }, paid_date: { type: 'string', description: 'YYYY-MM-DD, defaults to today' } }, required: ['bill_id'] },
  },
  {
    name: 'update_investor_contribution',
    description: "Change an investor row's committed contribution amount. Use the cap-table row id from get_cap_table.",
    input_schema: { type: 'object', properties: { investor_row_id: { type: 'number' }, amount: { type: 'number' } }, required: ['investor_row_id', 'amount'] },
  },
  {
    name: 'delete_investor',
    description: "Remove an investor row from a property's cap table (e.g. a duplicate Sponsor entry). Use the cap-table row id from get_cap_table.",
    input_schema: { type: 'object', properties: { investor_row_id: { type: 'number' } }, required: ['investor_row_id'] },
  },
  {
    name: 'update_property_fields',
    description: 'Update fields on a property. Allowed: address, city, state, zip, notes, listing_status, annual_rent, cap_rate, list_price, purchase_price, lease_start, lease_end. Only include fields to change.',
    input_schema: { type: 'object', properties: { property_id: { type: 'number' }, fields: { type: 'object' } }, required: ['property_id', 'fields'] },
  },
  {
    name: 'record_earnest_as_equity',
    description: "Book a settlement Earnest Money line as an investor's equity contribution — the SAFE way. It ADDS an offsetting Equity Contribution (+amount) attributed to the investor, keeping the original earnest-money line so cash nets to zero and the settlement stays balanced. Use this instead of recategorizing the earnest-money line. transaction_id = the earnest-money ledger line; investor_id = the master investor id (from get_cap_table's investor_id field).",
    input_schema: { type: 'object', properties: { transaction_id: { type: 'number' }, investor_id: { type: 'number' } }, required: ['transaction_id', 'investor_id'] },
  },
  {
    name: 'delete_properties',
    description: 'Permanently delete properties by id.',
    input_schema: { type: 'object', properties: { property_ids: { type: 'array', items: { type: 'number' } } }, required: ['property_ids'] },
  },
  {
    name: 'delete_people',
    description: 'Permanently delete people by id.',
    input_schema: { type: 'object', properties: { person_ids: { type: 'array', items: { type: 'number' } } }, required: ['person_ids'] },
  },
]

const WRITE_NAMES = new Set(WRITE_TOOLS.map(t => t.name))

// ── Read tool execution ───────────────────────────────────────────────────────

async function execReadTool(name, input) {
  if (name === 'find_properties') {
    const q = `%${(input.query || '').toLowerCase()}%`
    return db.prepare(`
      SELECT p.id, p.address, p.city, p.state, p.is_portfolio, tb.name AS tenant
      FROM properties p LEFT JOIN tenant_brands tb ON tb.id = p.tenant_brand_id
      WHERE LOWER(p.address) LIKE ? OR LOWER(p.city) LIKE ? OR LOWER(tb.name) LIKE ?
      LIMIT 40
    `).all(q, q, q)
  }
  if (name === 'find_people') {
    const q = `%${(input.query || '').toLowerCase()}%`
    if (input.role) {
      return db.prepare(`SELECT id, name, role, city, state FROM people WHERE LOWER(name) LIKE ? AND role = ? LIMIT 40`).all(q, input.role)
    }
    return db.prepare(`SELECT id, name, role, city, state FROM people WHERE LOWER(name) LIKE ? LIMIT 40`).all(q)
  }
  if (name === 'get_property_summary') {
    const prop = db.prepare('SELECT id, address, city, state FROM properties WHERE id = ?').get(input.property_id)
    if (!prop) return { error: 'Property not found' }
    const txs = db.prepare(`SELECT category, amount FROM accounting_transactions WHERE property_id = ? AND review_status = 'recorded'`).all(input.property_id)
    const rent = txs.filter(t => t.category === 'Rent' && t.amount > 0).reduce((s, t) => s + t.amount, 0)
    const expenses = txs.filter(t => t.amount < 0).reduce((s, t) => s + Math.abs(t.amount), 0)
    const cash = txs.reduce((s, t) => s + Number(t.amount), 0)
    const recent = db.prepare(`SELECT id, date, description, category, amount, review_status FROM accounting_transactions WHERE property_id = ? ORDER BY date DESC LIMIT 10`).all(input.property_id)
    const needsReview = db.prepare(`SELECT COUNT(*) AS n FROM accounting_transactions WHERE property_id = ? AND review_status = 'needs_review'`).get(input.property_id).n
    return { property: prop, rent_collected: rent, total_expenses: expenses, noi: rent - expenses, cash_balance: cash, needs_review_count: needsReview, recent_transactions: recent }
  }
  if (name === 'find_transactions') {
    let sql = `SELECT id, date, description, category, amount, review_status, vendor FROM accounting_transactions WHERE property_id = ?`
    const args = [input.property_id]
    if (input.category)    { sql += ' AND category = ?';            args.push(input.category) }
    if (input.status)      { sql += ' AND review_status = ?';       args.push(input.status) }
    if (input.description)  { sql += ' AND LOWER(description) LIKE ?'; args.push(`%${input.description.toLowerCase()}%`) }
    sql += ' ORDER BY date DESC LIMIT 60'
    return db.prepare(sql).all(...args)
  }
  if (name === 'get_cap_table') {
    return db.prepare(`
      SELECT id, name, class, contribution AS committed, percentage, preferred_return, investor_id
      FROM property_investors WHERE property_id = ? ORDER BY contribution DESC
    `).all(input.property_id)
  }
  if (name === 'list_bills') {
    let sql = `SELECT id, payee, description, category, amount, due_date, paid_at FROM property_bills WHERE property_id = ?`
    if (input.unpaid_only) sql += ' AND paid_at IS NULL'
    sql += ' ORDER BY (paid_at IS NOT NULL) ASC, due_date ASC'
    return db.prepare(sql).all(input.property_id)
  }
  if (name === 'get_settlement') {
    const row = db.prepare('SELECT data FROM property_settlements WHERE property_id = ?').get(input.property_id)
    if (!row) return { error: 'No settlement statement is recorded for this property.' }
    let d; try { d = JSON.parse(row.data) } catch { return { error: 'Settlement data is unreadable.' } }
    const items = Array.isArray(d.lineItems) ? d.lineItems : []
    const sum = t => items.filter(x => x.treatment === t).reduce((s, x) => s + (Number(x.amount) || 0), 0)
    const purchase = sum('Purchase Price'), sellerCredit = sum('Seller Credit')
    const closing = sum('Buyer Closing Cost'), buyerTaxes = sum('Buyer Taxes Paid')
    const loan = sum('Loan'), exch = sum('1031 Exchange'), earnest = sum('Earnest Money')
    const credits = sum('Tax Proration Credit') + sum('Rent Proration Credit') + sum('Insurance Credit') + sum('CAM Credit')
    const cashStated = sum('Cash to Close')
    const cashExpected = (purchase - sellerCredit + closing + buyerTaxes) - (loan + exch + earnest + credits)
    return {
      line_items: items,
      totals: {
        purchase_price: purchase, seller_credit: sellerCredit, buyer_closing_costs: closing, buyer_taxes_paid: buyerTaxes,
        loan, exchange_1031: exch, earnest_money: earnest, proration_credits: credits,
        cash_to_close_stated: cashStated, cash_to_close_expected: cashExpected,
        balance_gap: Math.round((cashStated - cashExpected) * 100) / 100,
        balanced: Math.abs(cashStated - cashExpected) < 2,
      },
    }
  }
  if (name === 'run_sql') {
    try { return { rows: runReadOnlySql(input.sql) } }
    catch (e) { return { error: e.message } }
  }
  if (name === 'list_property_documents') {
    try {
      const out = await searchDriveForProperty(input.property_id)
      if (out.connected === false) return { error: 'No Google Drive account is connected.' }
      return { folder: out.folder?.name || null, files: (out.files || []).map(f => ({ id: f.id, name: f.name, path: f.folderPath || '' })) }
    } catch (e) { return { error: e.message } }
  }
  return { error: 'Unknown tool' }
}

// Property fields the copilot is allowed to edit
const EDITABLE_PROPERTY_FIELDS = new Set([
  'address', 'city', 'state', 'zip', 'notes', 'listing_status',
  'annual_rent', 'cap_rate', 'list_price', 'purchase_price', 'lease_start', 'lease_end',
])

// ── Build a human-readable summary for a proposed action ──────────────────────

function summarizeAction(name, input) {
  const money = n => '$' + Math.abs(Math.round(Number(n))).toLocaleString()
  if (name === 'recategorize_transactions')
    return `Recategorize ${input.transaction_ids?.length || 0} transaction(s) to "${input.category}"`
  if (name === 'split_transaction')
    return `Split transaction #${input.transaction_id} into ${input.lines?.length || 0} lines (${(input.lines || []).map(l => `${l.category} ${money(l.amount)}`).join(', ')})`
  if (name === 'record_transactions')
    return `Record ${input.transaction_ids?.length || 0} transaction(s) into the books`
  if (name === 'create_bill')
    return `Create bill: ${money(input.amount)} to ${input.payee} (${input.category || 'Other'}) due ${input.due_date}`
  if (name === 'create_transaction')
    return `Add transaction: ${input.description} — ${money(input.amount)} (${input.category}) on ${input.date}`
  if (name === 'update_transaction') {
    const changes = ['date', 'description', 'category', 'amount', 'vendor'].filter(k => input[k] != null)
      .map(k => k === 'amount' ? `amount → ${money(input.amount)}` : `${k} → "${input[k]}"`).join(', ')
    return `Edit transaction #${input.transaction_id}: ${changes || '(no changes)'}`
  }
  if (name === 'delete_transactions')
    return `Delete ${input.transaction_ids?.length || 0} transaction(s)`
  if (name === 'pay_bill')
    return `Mark bill #${input.bill_id} paid${input.paid_date ? ` on ${input.paid_date}` : ''}`
  if (name === 'update_investor_contribution')
    return `Change investor row #${input.investor_row_id} committed amount to ${money(input.amount)}`
  if (name === 'delete_investor')
    return `Remove investor row #${input.investor_row_id} from the cap table`
  if (name === 'update_property_fields') {
    const fields = Object.entries(input.fields || {}).map(([k, v]) => `${k} → "${v}"`).join(', ')
    return `Update property #${input.property_id}: ${fields || '(no fields)'}`
  }
  if (name === 'record_earnest_as_equity') {
    const inv = db.prepare('SELECT name FROM investors WHERE id = ?').get(input.investor_id)
    return `Book earnest money (tx #${input.transaction_id}) as ${inv?.name || 'the investor'}'s equity — adds an offsetting Equity Contribution, keeps the settlement balanced`
  }
  if (name === 'delete_properties') {
    const rows = db.prepare(`SELECT address FROM properties WHERE id IN (${(input.property_ids || []).map(() => '?').join(',') || 'NULL'})`).all(...(input.property_ids || []))
    return `Delete ${input.property_ids?.length || 0} propert${input.property_ids?.length === 1 ? 'y' : 'ies'}: ${rows.map(r => r.address).slice(0, 8).join('; ')}${rows.length > 8 ? '…' : ''}`
  }
  if (name === 'delete_people') {
    const rows = db.prepare(`SELECT name FROM people WHERE id IN (${(input.person_ids || []).map(() => '?').join(',') || 'NULL'})`).all(...(input.person_ids || []))
    return `Delete ${input.person_ids?.length || 0} ${input.person_ids?.length === 1 ? 'person' : 'people'}: ${rows.map(r => r.name).slice(0, 8).join('; ')}${rows.length > 8 ? '…' : ''}`
  }
  return name
}

// ── Anthropic call ────────────────────────────────────────────────────────────

async function callClaude(apiKey, system, messages) {
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({ model: MODEL, max_tokens: 4000, thinking: { type: 'disabled' }, system, tools: [...READ_TOOLS, ...WRITE_TOOLS], messages }),
  })
  if (!response.ok) {
    const err = await response.json().catch(() => ({}))
    throw new Error(err.error?.message || `Anthropic API error ${response.status}`)
  }
  return response.json()
}

// ── POST /assistant/chat ──────────────────────────────────────────────────────

router.post('/chat', async (req, res) => {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) return res.status(500).json({ error: 'ANTHROPIC_API_KEY is not set' })

  const incoming = Array.isArray(req.body?.messages) ? req.body.messages : []
  const context  = typeof req.body?.context === 'string' ? req.body.context : ''
  if (!incoming.length) return res.status(400).json({ error: 'messages required' })

  let system = SYSTEM_PROMPT
  if (DB_SCHEMA) system += `\n\n=== DATABASE SCHEMA (query read-only via run_sql) ===\n${DB_SCHEMA}`
  if (context) system += `\n\n=== What the user is currently looking at ===\n${context.slice(0, 8000)}`

  // Seed conversation with prior turns (text only)
  const messages = incoming
    .filter(m => m.role === 'user' || m.role === 'assistant')
    .map(m => ({ role: m.role, content: String(m.content || '') }))

  // Attach uploaded documents to the final user turn as native content blocks
  const attachments = Array.isArray(req.body?.attachments) ? req.body.attachments : []
  if (attachments.length) {
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role !== 'user') continue
      const blocks = attachments.map(attachmentToBlock).filter(Boolean)
      messages[i] = { role: 'user', content: [...blocks, { type: 'text', text: messages[i].content || 'Please review the attached document(s) and propose the changes that make sense.' }] }
      break
    }
  }

  const actions = []
  try {
    for (let i = 0; i < 5; i++) {
      const resp = await callClaude(apiKey, system, messages)

      if (resp.stop_reason === 'tool_use') {
        messages.push({ role: 'assistant', content: resp.content })
        const results = []
        for (const block of resp.content) {
          if (block.type !== 'tool_use') continue
          if (WRITE_NAMES.has(block.name)) {
            actions.push({ id: block.id, type: block.name, params: block.input, summary: summarizeAction(block.name, block.input) })
            results.push({ type: 'tool_result', tool_use_id: block.id, content: 'Shown to the user as a proposed action awaiting their confirmation. Do not call this tool again; briefly summarize the proposal in text.' })
          } else {
            let data
            try { data = await execReadTool(block.name, block.input) } catch (e) { data = { error: e.message } }
            results.push({ type: 'tool_result', tool_use_id: block.id, content: JSON.stringify(data).slice(0, 8000) })
          }
        }
        messages.push({ role: 'user', content: results })
        continue
      }

      const reply = (resp.content || []).filter(c => c.type === 'text').map(c => c.text).join('\n').trim()
      return res.json({ reply: reply || 'Done.', actions })
    }
    res.json({ reply: 'I gathered what I could — let me know how to proceed.', actions })
  } catch (err) {
    console.error('[assistant]', err.message)
    res.status(500).json({ error: err.message })
  }
})

// ── POST /assistant/execute — run a confirmed action ──────────────────────────

router.post('/execute', (req, res) => {
  const { type, params } = req.body || {}
  if (!type || !params) return res.status(400).json({ error: 'type and params required' })
  try {
    let result
    if (type === 'recategorize_transactions') {
      if (!isValidCategory(params.category)) throw new Error(`Invalid category: ${params.category}`)
      const upd = db.prepare('UPDATE accounting_transactions SET category = ? WHERE id = ?')
      const run = db.transaction(ids => ids.forEach(id => upd.run(params.category, id)))
      run(params.transaction_ids || [])
      result = `Recategorized ${params.transaction_ids.length} transaction(s) to ${params.category}`
    } else if (type === 'record_transactions') {
      const upd = db.prepare(`UPDATE accounting_transactions SET review_status = 'recorded' WHERE id = ?`)
      const run = db.transaction(ids => ids.forEach(id => upd.run(id)))
      run(params.transaction_ids || [])
      result = `Recorded ${params.transaction_ids.length} transaction(s)`
    } else if (type === 'split_transaction') {
      const tx = db.prepare('SELECT * FROM accounting_transactions WHERE id = ?').get(params.transaction_id)
      if (!tx) throw new Error('Transaction not found')
      const total = (params.lines || []).reduce((s, l) => s + Number(l.amount), 0)
      if (Math.abs(total - Number(tx.amount)) > 0.01) throw new Error('Split lines must equal the transaction amount')
      for (const l of params.lines) if (!isValidCategory(l.category)) throw new Error(`Invalid category: ${l.category}`)
      const group = `split-${tx.id}-${Date.now()}`
      const ins = db.prepare(`INSERT INTO accounting_transactions (property_id, date, description, category, amount, source, vendor, review_status, split_group) VALUES (?,?,?,?,?,?,?,?,?)`)
      const run = db.transaction(() => {
        params.lines.forEach(l => ins.run(tx.property_id, tx.date, `${tx.description} — ${l.category}`, l.category, Number(l.amount), tx.source, tx.vendor, tx.review_status, group))
        db.prepare('DELETE FROM accounting_transactions WHERE id = ?').run(tx.id)
      })
      run()
      result = `Split into ${params.lines.length} lines`
    } else if (type === 'create_bill') {
      if (params.category && !isValidCategory(params.category)) throw new Error(`Invalid category: ${params.category}`)
      db.prepare(`INSERT INTO property_bills (property_id, payee, description, category, amount, due_date) VALUES (?,?,?,?,?,?)`)
        .run(params.property_id, params.payee, params.description || null, params.category || 'Other', Math.abs(Number(params.amount)), params.due_date)
      result = `Bill created for ${params.payee}`
    } else if (type === 'create_transaction') {
      if (!isValidCategory(params.category)) throw new Error(`Invalid category: ${params.category}`)
      db.prepare(`INSERT INTO accounting_transactions (property_id, date, description, category, amount, source) VALUES (?,?,?,?,?,'Manual')`)
        .run(params.property_id, params.date, params.description, params.category, Number(params.amount))
      result = `Transaction added`
    } else if (type === 'update_transaction') {
      const tx = db.prepare('SELECT * FROM accounting_transactions WHERE id = ?').get(params.transaction_id)
      if (!tx) throw new Error('Transaction not found')
      if (params.category && !isValidCategory(params.category)) throw new Error(`Invalid category: ${params.category}`)
      db.prepare(`UPDATE accounting_transactions SET date=?, description=?, category=?, amount=?, vendor=? WHERE id=?`).run(
        params.date ?? tx.date, params.description ?? tx.description, params.category ?? tx.category,
        params.amount != null ? Number(params.amount) : tx.amount, params.vendor ?? tx.vendor, tx.id,
      )
      result = `Transaction #${tx.id} updated`
    } else if (type === 'delete_transactions') {
      const del = db.prepare('DELETE FROM accounting_transactions WHERE id = ?')
      db.transaction(ids => ids.forEach(id => del.run(id)))(params.transaction_ids || [])
      result = `Deleted ${params.transaction_ids.length} transaction(s)`
    } else if (type === 'pay_bill') {
      const bill = db.prepare('SELECT * FROM property_bills WHERE id = ?').get(params.bill_id)
      if (!bill) throw new Error('Bill not found')
      if (bill.paid_at) throw new Error('Bill is already paid')
      const paidDate = params.paid_date || new Date().toISOString().slice(0, 10)
      const r = db.prepare(`INSERT INTO accounting_transactions (property_id, date, description, category, amount, source, vendor) VALUES (?,?,?,?,?, 'Manual', ?)`)
        .run(bill.property_id, paidDate, bill.description || `Bill — ${bill.payee}`, bill.category, -Math.abs(bill.amount), bill.payee)
      db.prepare(`UPDATE property_bills SET paid_at = ?, paid_tx_id = ? WHERE id = ?`).run(paidDate, r.lastInsertRowid, bill.id)
      result = `Bill to ${bill.payee} marked paid`
    } else if (type === 'update_investor_contribution') {
      db.prepare('UPDATE property_investors SET contribution = ? WHERE id = ?').run(Math.abs(Number(params.amount)), params.investor_row_id)
      result = `Committed amount updated`
    } else if (type === 'delete_investor') {
      db.prepare('DELETE FROM property_investors WHERE id = ?').run(params.investor_row_id)
      result = `Investor row removed from cap table`
    } else if (type === 'record_earnest_as_equity') {
      const tx = db.prepare('SELECT * FROM accounting_transactions WHERE id = ?').get(params.transaction_id)
      if (!tx) throw new Error('Transaction not found')
      const inv = db.prepare('SELECT id, name FROM investors WHERE id = ?').get(params.investor_id)
      if (!inv) throw new Error('Investor not found')
      const existing = db.prepare(`SELECT id FROM accounting_transactions WHERE matched_to_id = ? AND category = 'Equity Contribution'`).get(tx.id)
      if (existing) { result = 'Already booked as equity'; }
      else {
        db.prepare(`INSERT INTO accounting_transactions (property_id, date, description, category, amount, source, investor_id, review_status, matched_to_id) VALUES (?, ?, ?, 'Equity Contribution', ?, 'Manual', ?, 'recorded', ?)`)
          .run(tx.property_id, tx.date, `Earnest money — ${inv.name} equity`, Math.abs(Number(tx.amount) || 0), inv.id, tx.id)
        result = `Booked ${'$' + Math.abs(Math.round(Number(tx.amount))).toLocaleString()} earnest money as ${inv.name}'s equity`
      }
    } else if (type === 'update_property_fields') {
      const entries = Object.entries(params.fields || {}).filter(([k]) => EDITABLE_PROPERTY_FIELDS.has(k))
      if (!entries.length) throw new Error('No editable fields provided')
      const sets = entries.map(([k]) => `${k} = ?`).join(', ')
      db.prepare(`UPDATE properties SET ${sets} WHERE id = ?`).run(...entries.map(([, v]) => v), params.property_id)
      result = `Updated ${entries.map(([k]) => k).join(', ')}`
    } else if (type === 'delete_properties') {
      const del = db.prepare('DELETE FROM properties WHERE id = ?')
      const run = db.transaction(ids => ids.forEach(id => del.run(id)))
      run(params.property_ids || [])
      result = `Deleted ${params.property_ids.length} propert${params.property_ids.length === 1 ? 'y' : 'ies'}`
    } else if (type === 'delete_people') {
      const del = db.prepare('DELETE FROM people WHERE id = ?')
      const run = db.transaction(ids => ids.forEach(id => del.run(id)))
      run(params.person_ids || [])
      result = `Deleted ${params.person_ids.length} ${params.person_ids.length === 1 ? 'person' : 'people'}`
    } else {
      throw new Error(`Unknown action: ${type}`)
    }
    res.json({ ok: true, result })
  } catch (err) {
    console.error('[assistant/execute]', err.message)
    res.status(400).json({ error: err.message })
  }
})

export default router
