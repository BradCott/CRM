// In-app AI copilot — answers questions AND performs actions (confirm-first).
// Read tools run automatically server-side; write tools are proposed to the
// user as actions they must confirm before anything is changed.
import { Router } from 'express'
import db from '../db.js'

const router = Router()

const MODEL = process.env.ASSISTANT_MODEL || 'claude-haiku-4-5-20251001'

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

You have TOOLS:
- Read tools (find_properties, find_people, get_property_summary, find_transactions) run immediately and return data — use them to look things up before answering or acting.
- Action tools (recategorize_transactions, split_transaction, record_transactions, create_bill, create_transaction, delete_properties, delete_people) DO NOT run immediately. When you call one, it is shown to the user as a proposed action with a Confirm button — they must approve it. So: look up the exact records first (get their ids), then call the action tool with those ids. Briefly tell the user what you're proposing and that they need to confirm.

Rules:
- Always resolve real record ids with read tools before proposing an action. Never guess ids.
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

function execReadTool(name, input) {
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
  return { error: 'Unknown tool' }
}

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
    body: JSON.stringify({ model: MODEL, max_tokens: 1800, system, tools: [...READ_TOOLS, ...WRITE_TOOLS], messages }),
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
  if (context) system += `\n\n=== What the user is currently looking at ===\n${context.slice(0, 8000)}`

  // Seed conversation with prior turns (text only)
  const messages = incoming
    .filter(m => m.role === 'user' || m.role === 'assistant')
    .map(m => ({ role: m.role, content: String(m.content || '') }))

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
            try { data = execReadTool(block.name, block.input) } catch (e) { data = { error: e.message } }
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
