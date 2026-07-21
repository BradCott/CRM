import { Router }   from 'express'
import multer        from 'multer'
import { join }      from 'node:path'
import { mkdirSync, writeFileSync, readFileSync, createReadStream, existsSync, unlink } from 'node:fs'
import db, { DATA_DIR } from '../db.js'
import { PDFDocument } from 'pdf-lib'
import { sendMail } from '../services/mailer.js'

const router  = Router()
const upload  = multer({ storage: multer.memoryStorage(), limits: { fileSize: 30 * 1024 * 1024 } })
const LEASE_DIR = join(DATA_DIR, 'leases')
const PHOTO_DIR = join(DATA_DIR, 'property-photos')

// Title of the auto-created follow-up task that tracks whether a tenant has
// reimbursed us for an insurance premium. Kept in one place so the send,
// mark-reimbursed, and dashboard code all match on it.
const REIMB_CHECK_TITLE = 'Check insurance reimbursement status'

async function callClaude(buffer, mediaType, prompt) {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY is not set')
  const b64 = buffer.toString('base64')
  const isDoc = mediaType === 'application/pdf'
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method:  'POST',
    headers: {
      'content-type':      'application/json',
      'x-api-key':         apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model:      'claude-haiku-4-5-20251001',
      max_tokens: 1024,
      messages: [{
        role:    'user',
        content: [
          isDoc
            ? { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: b64 } }
            : { type: 'image',    source: { type: 'base64', media_type: mediaType,          data: b64 } },
          { type: 'text', text: prompt },
        ],
      }],
    }),
  })
  if (!response.ok) {
    const text = await response.text()
    throw new Error(`Anthropic API error ${response.status}: ${text}`)
  }
  return response.json()
}

// Like callClaude but sends several documents together so the model can
// cross-reference them (e.g. reconcile an invoice's fees against a binder's
// coverage split). `docs` is [{ buffer, mediaType, label }].
async function callClaudeMulti(docs, prompt, maxTokens = 1500) {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY is not set')
  const content = []
  for (const d of docs) {
    const b64 = d.buffer.toString('base64')
    content.push({ type: 'text', text: `--- ${d.label || 'Document'} ---` })
    content.push(d.mediaType === 'application/pdf'
      ? { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: b64 } }
      : { type: 'image',    source: { type: 'base64', media_type: d.mediaType,        data: b64 } })
  }
  content.push({ type: 'text', text: prompt })
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method:  'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({ model: 'claude-haiku-4-5-20251001', max_tokens: maxTokens, messages: [{ role: 'user', content }] }),
  })
  if (!response.ok) {
    const text = await response.text()
    throw new Error(`Anthropic API error ${response.status}: ${text}`)
  }
  return response.json()
}

const LEASE_MODEL = process.env.LEASE_MODEL || process.env.ASSISTANT_MODEL || 'claude-sonnet-5'

// Standard commercial-lease responsibility categories we want the matrix to cover.
const LEASE_CATEGORIES = [
  'Roof', 'Structure / Foundation', 'Exterior Walls', 'HVAC', 'Parking Lot / Paving',
  'Landscaping', 'Utilities', 'Real Estate Taxes', 'Building Insurance', 'Liability Insurance',
  'Common Area Maintenance (CAM)', 'Interior Maintenance', 'Plumbing', 'Electrical', 'Signage',
  'Snow / Trash Removal', 'General Repairs', 'ADA / Code Compliance',
]

// Read a lease and any amendments/exhibits and return a structured abstract
// (summary + a tenant/landlord responsibility matrix) that reflects ALL of them
// together. `docs` is [{ buffer, mediaType, name, doc_type }]. Uses a stronger
// model + larger budget than the quick insurance extractor. Returns a parsed
// object.
async function abstractLease(docs) {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY is not set')
  if (!docs.length) throw new Error('No lease documents to abstract')

  const multi = docs.length > 1
  const prompt = `You are a commercial real estate lease analyst. ${multi ? `You have been given ${docs.length} documents for ONE property — the base lease plus its amendments/exhibits (each is labeled above with its name and type). Read ALL of them and produce ONE combined abstract. Where a later amendment modifies the base lease, the amendment CONTROLS; reflect the current, in-effect terms. In "notes", call out anything an amendment changed.` : 'Read the attached lease and produce a faithful abstract.'} Return ONLY valid JSON (no markdown, no commentary) with exactly this shape:
{
  "summary": {
    "tenant": string, "landlord": string, "guarantor": string|null,
    "premises": string, "permitted_use": string,
    "lease_type": string,            // e.g. "NNN", "Modified Gross", "Gross"
    "commencement_date": string|null,"expiration_date": string|null,
    "term": string,                  // e.g. "10 years"
    "base_rent": string,             // include $ and period
    "rent_escalations": string,
    "security_deposit": string|null,
    "renewal_options": string|null
  },
  "responsibilities": [
    { "category": string, "party": "Tenant"|"Landlord"|"Shared"|"Unclear", "detail": string }
  ],
  "key_dates": [ { "label": string, "date": string } ],  // renewal-notice deadlines, option windows, etc.
  "notes": string                    // anything important that doesn't fit above
}

For "responsibilities", cover at least these categories where the lease addresses them: ${LEASE_CATEGORIES.join(', ')}. Add any other notable responsibilities the lease assigns. Set "party" to who bears the cost/obligation; use "Shared" for split items and "Unclear" if the lease is silent or ambiguous. Keep "detail" to a short quote or paraphrase of the governing clause. Do not invent terms that aren't in the document.`

  // If everything fits in one request, send it together — best quality, since the
  // AI sees the base lease and any amendments at once. Otherwise split oversized
  // PDFs into page-range chunks, abstract each, and merge — so no content is
  // dropped and the request never exceeds Anthropic's 32MB / 100-page limits.
  const totalRaw = docs.reduce((s, d) => s + (d.buffer?.length || 0), 0)
  if (totalRaw <= MAX_REQ_RAW) {
    return await callLeaseAI(docs, prompt)
  }

  console.log(`[lease] ${(totalRaw / 1048576).toFixed(1)}MB across ${docs.length} doc(s) — chunking`)
  const parts = []
  for (const d of docs) {
    if (d.mediaType === 'application/pdf') {
      const { chunks, total } = await splitPdfForApi(d.buffer, MAX_REQ_RAW)
      for (const c of chunks) {
        const label = `${d.name || 'Lease'} — pages ${c.start}-${c.end} of ${total}`
        console.log(`[lease] chunk ${label} (${(c.buffer.length / 1048576).toFixed(1)}MB)`)
        parts.push(await callLeaseAI([{ ...d, buffer: c.buffer, name: label }], prompt))
      }
    } else {
      parts.push(await callLeaseAI([d], prompt))
    }
  }
  return mergeAbstracts(parts)
}

// Stay comfortably under Anthropic's 32MB request cap (base64 inflates ~33%).
const MAX_REQ_RAW = 18 * 1024 * 1024

// Split a PDF into page-range chunks that each stay under the byte budget and
// under the 100-page-per-request cap. Returns { chunks:[{buffer,start,end}], total }.
async function splitPdfForApi(buffer, maxRaw) {
  const src = await PDFDocument.load(buffer)
  const total = src.getPageCount()
  const avgPerPage = Math.max(1, buffer.length / total)
  const per = Math.max(1, Math.min(100, Math.floor(maxRaw / avgPerPage)))
  const chunks = []
  for (let start = 0; start < total; start += per) {
    const end = Math.min(start + per, total)
    const t = await PDFDocument.create()
    const idxs = []
    for (let i = start; i < end; i++) idxs.push(i)
    const pgs = await t.copyPages(src, idxs)
    pgs.forEach(p => t.addPage(p))
    chunks.push({ buffer: Buffer.from(await t.save()), start: start + 1, end })
  }
  return { chunks, total }
}

// Merge per-chunk abstracts into one: first non-empty value wins for each summary
// field; responsibilities and key dates are concatenated then de-duplicated.
function mergeAbstracts(parts) {
  const clean = parts.filter(Boolean)
  if (clean.length <= 1) return clean[0] || null
  const isVal = v => v != null && v !== '' && String(v).toLowerCase() !== 'null'
  const summary = {}
  const keys = new Set()
  clean.forEach(p => Object.keys(p?.summary || {}).forEach(k => keys.add(k)))
  for (const k of keys) {
    summary[k] = null
    for (const p of clean) { if (isVal(p?.summary?.[k])) { summary[k] = p.summary[k]; break } }
  }
  const dedupe = (rows, keyFn) => {
    const seen = new Set(), out = []
    for (const r of rows) { const k = keyFn(r); if (k && !seen.has(k)) { seen.add(k); out.push(r) } }
    return out
  }
  const responsibilities = dedupe(
    clean.flatMap(p => p?.responsibilities || []),
    r => `${r?.category}|${r?.detail}`.toLowerCase().slice(0, 140),
  )
  const key_dates = dedupe(
    clean.flatMap(p => p?.key_dates || []),
    d => `${d?.label}|${d?.date}`.toLowerCase(),
  )
  const notes = clean.map(p => p?.notes).filter(isVal).join('\n\n')
  return { summary, responsibilities, key_dates, notes }
}

// One Anthropic call for a set of docs → parsed abstract JSON. Trims any PDF to
// 100 pages and enforces a hard timeout so the call can't hang.
async function callLeaseAI(docs, prompt) {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY is not set')

  const prepared = []
  for (const d of docs) {
    let buffer = d.buffer
    if (d.mediaType === 'application/pdf') {
      try {
        const src = await PDFDocument.load(buffer)
        if (src.getPageCount() > 100) {
          const t = await PDFDocument.create()
          const pgs = await t.copyPages(src, [...Array(100).keys()])
          pgs.forEach(p => t.addPage(p))
          buffer = Buffer.from(await t.save())
        }
      } catch (e) { console.warn('[lease] page-trim failed:', e.message) }
    }
    prepared.push({ ...d, buffer })
  }

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 180000)
  let response
  try {
    response = await fetch('https://api.anthropic.com/v1/messages', {
      method:  'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
      signal:  controller.signal,
      body: JSON.stringify({
        model:      LEASE_MODEL,
        max_tokens: 8000,
        thinking:   { type: 'disabled' },
        messages: [{
          role: 'user',
          content: [
            ...prepared.flatMap(d => [
              { type: 'text', text: `--- Document: ${d.name || 'Lease'} (${d.doc_type || 'Lease'}) ---` },
              d.mediaType === 'application/pdf'
                ? { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: d.buffer.toString('base64') } }
                : { type: 'image',    source: { type: 'base64', media_type: d.mediaType,        data: d.buffer.toString('base64') } },
            ]),
            { type: 'text', text: prompt },
          ],
        }],
      }),
    })
  } catch (e) {
    throw new Error(e.name === 'AbortError' ? 'The lease was too large/slow to process — try a smaller PDF or split it.' : e.message)
  } finally {
    clearTimeout(timer)
  }
  if (!response.ok) {
    const text = await response.text()
    throw new Error(`Anthropic API error ${response.status}: ${text}`)
  }
  const data = await response.json()
  const text = (data?.content || []).filter(b => b.type === 'text').map(b => b.text).join('')
  const m = text.match(/\{[\s\S]*\}/)
  if (!m) throw new Error('The AI did not return a readable lease abstract. Try re-uploading.')
  return JSON.parse(m[0])
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function addDays(dateStr, days) {
  const d = new Date(dateStr)
  d.setDate(d.getDate() + days)
  return d.toISOString().slice(0, 10)
}

function today() {
  return new Date().toISOString().slice(0, 10)
}

function thisYearDate(mmdd) {
  return `${new Date().getFullYear()}-${mmdd}`
}

// Generate default tasks for a newly added portfolio property.
// Kept in sync with the db.js one-time migration for existing properties.
export function seedDefaultTasks(propertyId) {
  const base  = new Date()
  const off   = (n) => { const d = new Date(base); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10) }
  const dec31 = `${base.getFullYear()}-12-31`

  const defaults = [
    { title: 'Set up entity as new owner in tenant system', task_type: 'other',     due_date: off(7),   recurs: 'none'      },
    { title: 'Upload insurance policy',                     task_type: 'insurance', due_date: off(7),   recurs: 'none'      },
    { title: 'Set up tax account',                          task_type: 'tax',       due_date: off(7),   recurs: 'none'      },
    { title: 'Quarterly manager check-in',                  task_type: 'other',     due_date: off(90),  recurs: 'quarterly' },
    { title: 'COI from tenant',                             task_type: 'other',     due_date: off(365), recurs: 'annually'  },
    { title: 'Rent escalation review',                      task_type: 'lease',     due_date: off(365), recurs: 'annually'  },
    { title: 'Year-end CAM reconciliation',                 task_type: 'other',     due_date: dec31,    recurs: 'annually'  },
  ]
  const stmt = db.prepare(
    `INSERT INTO property_tasks (property_id, title, task_type, due_date, recurs, notes) VALUES (?,?,?,?,?,?)`
  )
  for (const t of defaults) {
    stmt.run(propertyId, t.title, t.task_type, t.due_date, t.recurs, null)
  }
}

// ── Dashboard ─────────────────────────────────────────────────────────────────

router.get('/dashboard', (req, res) => {
  const todayStr = today()
  const in30     = addDays(todayStr, 30)
  const in90     = addDays(todayStr, 90)

  const portfolioProps = db.prepare(`
    SELECT p.id, p.address, p.city, p.state, t.name AS tenant_brand_name,
           p.lease_end, p.annual_rent, p.purchase_price,
           o.name AS owner_name,
           (SELECT GROUP_CONCAT(pi.policy_number, ' ')
            FROM property_insurance pi
            WHERE pi.property_id = p.id
              AND pi.policy_number IS NOT NULL) AS policy_numbers
    FROM properties p
    LEFT JOIN tenant_brands t ON t.id = p.tenant_brand_id
    LEFT JOIN people         o ON o.id = p.owner_id
    WHERE p.is_portfolio = 1
    ORDER BY p.address
  `).all()

  const tasksDue = db.prepare(`
    SELECT pt.*, p.address, p.city, p.state
    FROM property_tasks pt
    JOIN properties p ON p.id = pt.property_id
    WHERE pt.completed_at IS NULL
      AND pt.due_date <= ?
    ORDER BY pt.due_date
  `).all(in30)

  const overdueTasks = db.prepare(`
    SELECT pt.*, p.address, p.city, p.state
    FROM property_tasks pt
    JOIN properties p ON p.id = pt.property_id
    WHERE pt.completed_at IS NULL
      AND pt.due_date < ?
    ORDER BY pt.due_date
  `).all(todayStr)

  const insuranceExpiring = db.prepare(`
    SELECT pi.*, p.address, p.city, p.state
    FROM property_insurance pi
    JOIN properties p ON p.id = pi.property_id
    WHERE pi.expiry_date IS NOT NULL
      AND pi.expiry_date <= ?
      AND pi.expiry_date >= ?
    ORDER BY pi.expiry_date
  `).all(in90, todayStr)

  const taxesDue = db.prepare(`
    SELECT pt.*, p.address, p.city, p.state
    FROM property_taxes pt
    JOIN properties p ON p.id = pt.property_id
    WHERE pt.paid_date IS NULL
      AND pt.due_date IS NOT NULL
      AND pt.due_date <= ?
    ORDER BY pt.due_date
  `).all(in90)

  const maintenanceSpend = db.prepare(`
    SELECT SUM(cost) AS total
    FROM property_maintenance
    WHERE date >= date('now', '-365 days')
  `).get()

  // ── New stat counts ───────────────────────────────────────────────────────
  const in180 = addDays(todayStr, 180)

  // Tax Due (6 months): distinct portfolio properties with an unpaid tax bill due within 6 months
  const taxDue6mo = db.prepare(`
    SELECT COUNT(DISTINCT pt.property_id) AS n
    FROM property_taxes pt
    JOIN properties p ON p.id = pt.property_id
    WHERE p.is_portfolio = 1
      AND pt.paid_date IS NULL
      AND pt.due_date IS NOT NULL
      AND pt.due_date <= ?
  `).get(in180).n

  // Awaiting Tax Reimbursement: distinct portfolio properties with a pending/overdue
  // task of type 'tax' whose title contains "reimburs" (case-insensitive)
  const taxReimbursePending = db.prepare(`
    SELECT COUNT(DISTINCT pt.property_id) AS n
    FROM property_tasks pt
    JOIN properties p ON p.id = pt.property_id
    WHERE p.is_portfolio = 1
      AND pt.completed_at IS NULL
      AND pt.task_type = 'tax'
      AND LOWER(pt.title) LIKE '%reimburs%'
  `).get().n

  // Awaiting Insurance Reimbursement: same but for insurance tasks
  const insReimbursePending = db.prepare(`
    SELECT COUNT(DISTINCT pt.property_id) AS n
    FROM property_tasks pt
    JOIN properties p ON p.id = pt.property_id
    WHERE p.is_portfolio = 1
      AND pt.completed_at IS NULL
      AND pt.task_type = 'insurance'
      AND LOWER(pt.title) LIKE '%reimburs%'
  `).get().n

  // Per-property task counts for the list view
  const taskCountRows = db.prepare(`
    SELECT
      property_id,
      COUNT(CASE WHEN completed_at IS NULL AND due_date IS NOT NULL AND due_date < date('now') THEN 1 END) AS overdue,
      COUNT(CASE WHEN completed_at IS NULL AND due_date IS NOT NULL AND due_date >= date('now') AND due_date <= date('now','+30 days') THEN 1 END) AS due_soon,
      COUNT(CASE WHEN completed_at IS NOT NULL THEN 1 END) AS completed,
      COUNT(CASE WHEN completed_at IS NULL THEN 1 END) AS pending
    FROM property_tasks
    WHERE property_id IN (SELECT id FROM properties WHERE is_portfolio = 1)
    GROUP BY property_id
  `).all()
  const taskCounts = {}
  for (const row of taskCountRows) {
    taskCounts[row.property_id] = { overdue: row.overdue, due_soon: row.due_soon, completed: row.completed, pending: row.pending }
  }

  res.json({
    properties:                  portfolioProps,
    tasks_due:                   tasksDue,
    overdue_tasks:               overdueTasks,
    insurance_expiring:          insuranceExpiring,
    taxes_due:                   taxesDue,
    maintenance_spend_ytd:       maintenanceSpend?.total || 0,
    task_counts:                 taskCounts,
    tax_due_6mo:                 taxDue6mo        || 0,
    tax_reimburse_pending:       taxReimbursePending || 0,
    ins_reimburse_pending:       insReimbursePending || 0,
  })
})

// ── All tasks across all portfolio properties ─────────────────────────────────
// GET /tasks?status=pending|completed|all
// NOTE: must be defined before /:propertyId/tasks to avoid param capture
router.get('/tasks', (req, res) => {
  const { status = 'pending' } = req.query
  const statusClause =
    status === 'pending'   ? 'AND pt.completed_at IS NULL' :
    status === 'completed' ? 'AND pt.completed_at IS NOT NULL' : ''

  const rows = db.prepare(`
    SELECT pt.*,
           p.address, p.city, p.state,
           t.name AS tenant_brand_name
    FROM property_tasks pt
    JOIN  properties p ON p.id = pt.property_id
    LEFT JOIN tenant_brands t ON t.id = p.tenant_brand_id
    WHERE p.is_portfolio = 1
      ${statusClause}
    ORDER BY
      CASE WHEN pt.due_date IS NULL THEN 1 ELSE 0 END,
      pt.due_date ASC
  `).all()
  res.json(rows)
})

// ── Per-property tasks ────────────────────────────────────────────────────────

router.get('/:propertyId/tasks', (req, res) => {
  const rows = db.prepare(`
    SELECT * FROM property_tasks WHERE property_id = ? ORDER BY due_date
  `).all(req.params.propertyId)
  res.json(rows)
})

router.post('/:propertyId/tasks', (req, res) => {
  const { title, task_type = 'other', due_date, recurs = 'none', notes } = req.body
  if (!title) return res.status(400).json({ error: 'title is required' })
  const r = db.prepare(`
    INSERT INTO property_tasks (property_id, title, task_type, due_date, recurs, notes)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(req.params.propertyId, title, task_type, due_date || null, recurs, notes || null)
  res.status(201).json(db.prepare('SELECT * FROM property_tasks WHERE id = ?').get(r.lastInsertRowid))
})

router.put('/tasks/:id', (req, res) => {
  const { title, task_type, due_date, completed_at, recurs, notes } = req.body
  db.prepare(`
    UPDATE property_tasks SET title=?, task_type=?, due_date=?, completed_at=?, recurs=?, notes=?
    WHERE id=?
  `).run(title, task_type, due_date || null, completed_at || null, recurs, notes || null, req.params.id)
  res.json(db.prepare('SELECT * FROM property_tasks WHERE id = ?').get(req.params.id))
})

// Complete a task — and if recurring, clone a new future task
router.post('/tasks/:id/complete', (req, res) => {
  const task = db.prepare('SELECT * FROM property_tasks WHERE id = ?').get(req.params.id)
  if (!task) return res.status(404).json({ error: 'Task not found' })

  const now = new Date().toISOString().slice(0, 19).replace('T', ' ')
  db.prepare('UPDATE property_tasks SET completed_at = ? WHERE id = ?').run(now, task.id)

  let nextTask = null
  if (task.recurs && task.recurs !== 'none' && task.due_date) {
    const OFFSETS = { monthly: 30, quarterly: 91, annually: 365 }
    const offset  = OFFSETS[task.recurs] || 365
    const nextDue = addDays(task.due_date, offset)
    const r = db.prepare(`
      INSERT INTO property_tasks (property_id, title, task_type, due_date, recurs, notes)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(task.property_id, task.title, task.task_type, nextDue, task.recurs, task.notes)
    nextTask = db.prepare('SELECT * FROM property_tasks WHERE id = ?').get(r.lastInsertRowid)
  }

  res.json({
    completed: db.prepare('SELECT * FROM property_tasks WHERE id = ?').get(task.id),
    next_task: nextTask,
  })
})

router.delete('/tasks/:id', (req, res) => {
  db.prepare('DELETE FROM property_tasks WHERE id = ?').run(req.params.id)
  res.status(204).end()
})

// ── Insurance ─────────────────────────────────────────────────────────────────

// GET /insurance/all — all policies across all portfolio properties
router.get('/insurance/all', (req, res) => {
  const rows = db.prepare(`
    SELECT pi.*,
      p.id         AS property_id,
      p.address    AS property_address,
      p.city       AS property_city,
      p.state      AS property_state,
      t.name       AS tenant_name
    FROM property_insurance pi
    JOIN  properties   p ON p.id  = pi.property_id
    LEFT JOIN tenant_brands t ON t.id = p.tenant_brand_id
    WHERE p.is_portfolio = 1
    ORDER BY p.address ASC, pi.effective_date DESC
  `).all()
  res.json(rows)
})

router.get('/:propertyId/insurance', (req, res) => {
  res.json(db.prepare('SELECT * FROM property_insurance WHERE property_id = ? ORDER BY effective_date DESC').all(req.params.propertyId))
})

router.post('/:propertyId/insurance', (req, res) => {
  const f   = req.body
  const pid = req.params.propertyId
  const r = db.prepare(`
    INSERT INTO property_insurance
      (property_id, carrier, policy_number, premium, coverage_amount, deductible,
       effective_date, expiry_date, auto_renewal, agent_name, agent_phone, agent_email,
       notes, paid_status, paid_date, premium_breakdown)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
  `).run(
    pid,
    f.carrier || null, f.policy_number || null,
    f.premium        != null ? parseFloat(f.premium)         : null,
    f.coverage_amount != null ? parseFloat(f.coverage_amount) : null,
    f.deductible     != null ? parseFloat(f.deductible)      : null,
    f.effective_date || null, f.expiry_date || null,
    f.auto_renewal ? 1 : 0,
    f.agent_name || null, f.agent_phone || null, f.agent_email || null,
    f.notes || null,
    f.paid_status || 'unpaid',
    f.paid_date   || null,
    f.premium_breakdown || null
  )

  // Auto-create renewal reminder task if expiry_date provided
  if (f.expiry_date) {
    const reminderDate = addDays(f.expiry_date, -60)
    db.prepare(`
      INSERT INTO property_tasks (property_id, title, task_type, due_date, recurs, notes)
      VALUES (?, ?, 'insurance', ?, 'annually', ?)
    `).run(
      pid,
      `Insurance renewal — ${f.carrier || 'policy'} expires ${f.expiry_date}`,
      reminderDate,
      `Policy: ${f.policy_number || 'N/A'} | Carrier: ${f.carrier || 'N/A'}`
    )
  }

  // Auto-create premium payment task
  const premiumDue = f.premium_due_date || null
  db.prepare(`
    INSERT INTO property_tasks (property_id, title, task_type, due_date, recurs, notes, priority)
    VALUES (?, 'Pay Insurance Premium', 'insurance', ?, 'none', ?, 'high')
  `).run(pid, premiumDue, `Carrier: ${f.carrier || 'N/A'} | Policy: ${f.policy_number || 'N/A'}`)

  // Auto-create reimbursement task (due_date set when premium is paid)
  db.prepare(`
    INSERT INTO property_tasks (property_id, title, task_type, due_date, recurs, notes, priority)
    VALUES (?, 'Request Tenant Insurance Reimbursement', 'insurance', NULL, 'none', 'Complete after insurance premium is paid', 'high')
  `).run(pid)

  res.status(201).json(db.prepare('SELECT * FROM property_insurance WHERE id = ?').get(r.lastInsertRowid))
})

router.put('/insurance/:id', (req, res) => {
  const f = req.body
  db.prepare(`
    UPDATE property_insurance SET
      carrier=?, policy_number=?, premium=?, coverage_amount=?, deductible=?,
      effective_date=?, expiry_date=?, auto_renewal=?, agent_name=?, agent_phone=?, agent_email=?,
      notes=?, paid_status=?, paid_date=?, premium_breakdown=?
    WHERE id=?
  `).run(
    f.carrier || null, f.policy_number || null,
    f.premium         != null ? parseFloat(f.premium)         : null,
    f.coverage_amount != null ? parseFloat(f.coverage_amount) : null,
    f.deductible      != null ? parseFloat(f.deductible)      : null,
    f.effective_date || null, f.expiry_date || null,
    f.auto_renewal ? 1 : 0,
    f.agent_name || null, f.agent_phone || null, f.agent_email || null,
    f.notes       || null,
    f.paid_status || 'unpaid',
    f.paid_date   || null,
    f.premium_breakdown !== undefined ? f.premium_breakdown : null,
    req.params.id
  )
  res.json(db.prepare('SELECT * FROM property_insurance WHERE id = ?').get(req.params.id))
})

// PATCH /insurance/:id/paid — toggle paid status and cascade to reimbursement task
router.patch('/insurance/:id/paid', (req, res) => {
  const { paid } = req.body  // true = mark paid, false = undo
  const policy = db.prepare('SELECT * FROM property_insurance WHERE id = ?').get(req.params.id)
  if (!policy) return res.status(404).json({ error: 'Policy not found' })

  const paidDate   = paid ? today() : null
  const paidStatus = paid ? 'paid' : 'unpaid'

  db.prepare(`UPDATE property_insurance SET paid_status=?, paid_date=? WHERE id=?`)
    .run(paidStatus, paidDate, req.params.id)

  // When marking paid: find the matching reimbursement task and set due 7 days out
  if (paid) {
    const dueDate = addDays(today(), 7)
    db.prepare(`
      UPDATE property_tasks
      SET due_date = ?, completed_at = NULL
      WHERE property_id = ?
        AND completed_at IS NULL
        AND title = 'Request Tenant Insurance Reimbursement'
    `).run(dueDate, policy.property_id)
  }

  // When undoing: clear the due date on the reimbursement task
  if (!paid) {
    db.prepare(`
      UPDATE property_tasks
      SET due_date = NULL
      WHERE property_id = ?
        AND completed_at IS NULL
        AND title = 'Request Tenant Insurance Reimbursement'
    `).run(policy.property_id)
  }

  res.json(db.prepare('SELECT * FROM property_insurance WHERE id = ?').get(req.params.id))
})

// PATCH /insurance/:id/reimbursed — resolve a reimbursement follow-up.
//   { status: 'reimbursed' }  → mark paid back, close the follow-up task
//   { status: 'limbo' }       → still waiting; re-check in 30 days (recurring)
router.patch('/insurance/:id/reimbursed', (req, res) => {
  const status = req.body?.status
  if (status !== 'reimbursed' && status !== 'limbo') {
    return res.status(400).json({ error: "status must be 'reimbursed' or 'limbo'" })
  }
  const policy = db.prepare('SELECT id, property_id, carrier FROM property_insurance WHERE id = ?').get(req.params.id)
  if (!policy) return res.status(404).json({ error: 'Policy not found' })
  const stamp = today()

  if (status === 'reimbursed') {
    db.prepare(`UPDATE property_insurance SET reimbursed_status = 'reimbursed', reimbursed_date = ? WHERE id = ?`).run(stamp, policy.id)
    // Close any open follow-up task for this policy.
    db.prepare(`UPDATE property_tasks SET completed_at = datetime('now') WHERE insurance_id = ? AND completed_at IS NULL AND title = ?`).run(policy.id, REIMB_CHECK_TITLE)
    db.prepare(`UPDATE properties SET notes = TRIM(COALESCE(notes,'') || CHAR(10) || ?) WHERE id = ?`)
      .run(`[${stamp}] Tenant reimbursed the ${policy.carrier || 'insurance'} premium.`, policy.property_id)
  } else {
    // Still in limbo: keep it unreimbursed and push the next check out 30 days.
    db.prepare(`UPDATE property_insurance SET reimbursed_status = 'unreimbursed', reimbursed_date = NULL WHERE id = ?`).run(policy.id)
    const next = addDays(stamp, 30)
    const note = `Still awaiting reimbursement as of ${stamp}. Next check ${next}.`
    const open = db.prepare(`SELECT id FROM property_tasks WHERE insurance_id = ? AND completed_at IS NULL AND title = ?`).get(policy.id, REIMB_CHECK_TITLE)
    if (open) {
      db.prepare(`UPDATE property_tasks SET due_date = ?, notes = ? WHERE id = ?`).run(next, note, open.id)
    } else {
      db.prepare(`INSERT INTO property_tasks (property_id, insurance_id, title, task_type, due_date, priority, notes) VALUES (?, ?, ?, 'insurance', ?, 'high', ?)`)
        .run(policy.property_id, policy.id, REIMB_CHECK_TITLE, next, note)
    }
  }
  res.json(db.prepare('SELECT * FROM property_insurance WHERE id = ?').get(policy.id))
})

router.delete('/insurance/:id', (req, res) => {
  db.prepare('DELETE FROM property_insurance WHERE id = ?').run(req.params.id)
  res.status(204).end()
})

// POST /:propertyId/insurance/upload — parse insurance PDF with AI
router.post('/:propertyId/insurance/upload', upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' })

  const mediaType = req.file.mimetype || 'application/pdf'
  const prompt = `You are extracting key information from a commercial property insurance policy. Return ONLY a valid JSON object with these exact fields — no explanation, no markdown:

{
  "insurance_company": "",
  "policy_number": "",
  "named_insured": "",
  "property_address": "",
  "effective_date": "",
  "expiration_date": "",
  "premium": "",
  "premium_due_date": "",
  "deductible": "",
  "building_coverage": "",
  "general_liability_coverage": "",
  "general_aggregate": "",
  "agent_name": "",
  "agent_phone": "",
  "mortgagee": "",
  "construction_type": "",
  "year_built": "",
  "valuation_method": "",
  "premium_items": [ { "label": "", "amount": "" } ]
}

For premium_due_date: look for a payment due date or bill due date. If not found, use the effective date.
For mortgagee: look for any lender or mortgagee listed on the policy. If none, return "".
For premium_items: itemize EVERYTHING that adds up to the total premium — each coverage's premium (e.g. Building/Property, General Liability, Wind/Hail, Equipment Breakdown, Terrorism/TRIA), plus any surcharges, inspection fees, policy fees, and taxes. Give each a short "label" and its "amount" (with the $ sign). The amounts should sum to the total premium. If the document only shows a single total premium with no breakdown, return an empty array [].
Extract exact values as they appear in the document. For dollar amounts include the $ sign.`

  try {
    // Truncate PDF to first 20 pages to stay within Anthropic's 100-page limit
    let pdfBuffer = req.file.buffer
    if (mediaType === 'application/pdf') {
      const srcDoc  = await PDFDocument.load(pdfBuffer)
      const total   = srcDoc.getPageCount()
      if (total > 20) {
        const trimDoc = await PDFDocument.create()
        const pages   = await trimDoc.copyPages(srcDoc, [...Array(20).keys()])
        pages.forEach(p => trimDoc.addPage(p))
        pdfBuffer = Buffer.from(await trimDoc.save())
        console.log(`[management] insurance PDF truncated from ${total} to 20 pages`)
      }
    }

    const result = await callClaude(pdfBuffer, mediaType, prompt)
    const raw  = result.content[0].text.trim()
    const json = raw.replace(/^```json\s*/i, '').replace(/\s*```$/, '')
    const data = JSON.parse(json)
    res.json(data)
  } catch (err) {
    console.error('[management] insurance upload parse error:', err.message)
    res.status(422).json({ error: 'Could not parse insurance document: ' + err.message })
  }
})

// ── Taxes ─────────────────────────────────────────────────────────────────────

router.get('/:propertyId/taxes', (req, res) => {
  res.json(db.prepare('SELECT * FROM property_taxes WHERE property_id = ? ORDER BY tax_year DESC, due_date DESC').all(req.params.propertyId))
})

router.post('/:propertyId/taxes', (req, res) => {
  const f = req.body
  const r = db.prepare(`
    INSERT INTO property_taxes
      (property_id, tax_year, due_date, amount, paid_date, paid_amount, parcel_number, taxing_authority, notes)
    VALUES (?,?,?,?,?,?,?,?,?)
  `).run(
    req.params.propertyId,
    f.tax_year != null ? parseInt(f.tax_year, 10) : null,
    f.due_date || null,
    f.amount != null ? parseFloat(f.amount) : null,
    f.paid_date || null,
    f.paid_amount != null ? parseFloat(f.paid_amount) : null,
    f.parcel_number || null,
    f.taxing_authority || null,
    f.notes || null
  )
  // Auto-create a task if due_date and amount set but not paid
  if (f.due_date && f.amount && !f.paid_date) {
    const reminderDate = addDays(f.due_date, -30)
    db.prepare(`
      INSERT INTO property_tasks (property_id, title, task_type, due_date, recurs, notes)
      VALUES (?, ?, 'tax', ?, 'annually', ?)
    `).run(
      req.params.propertyId,
      `Property tax due ${f.due_date}${f.tax_year ? ' (' + f.tax_year + ')' : ''}`,
      reminderDate,
      `Amount: $${f.amount} | Authority: ${f.taxing_authority || 'N/A'}`
    )
  }
  res.status(201).json(db.prepare('SELECT * FROM property_taxes WHERE id = ?').get(r.lastInsertRowid))
})

router.put('/taxes/:id', (req, res) => {
  const f = req.body
  db.prepare(`
    UPDATE property_taxes SET
      tax_year=?, due_date=?, amount=?, paid_date=?, paid_amount=?,
      parcel_number=?, taxing_authority=?, notes=?
    WHERE id=?
  `).run(
    f.tax_year != null ? parseInt(f.tax_year, 10) : null,
    f.due_date || null,
    f.amount != null ? parseFloat(f.amount) : null,
    f.paid_date || null,
    f.paid_amount != null ? parseFloat(f.paid_amount) : null,
    f.parcel_number || null,
    f.taxing_authority || null,
    f.notes || null,
    req.params.id
  )
  res.json(db.prepare('SELECT * FROM property_taxes WHERE id = ?').get(req.params.id))
})

router.delete('/taxes/:id', (req, res) => {
  db.prepare('DELETE FROM property_taxes WHERE id = ?').run(req.params.id)
  res.status(204).end()
})

// ── Maintenance ───────────────────────────────────────────────────────────────

router.get('/:propertyId/maintenance', (req, res) => {
  res.json(db.prepare('SELECT * FROM property_maintenance WHERE property_id = ? ORDER BY date DESC').all(req.params.propertyId))
})

router.post('/:propertyId/maintenance', (req, res) => {
  const f = req.body
  if (!f.description) return res.status(400).json({ error: 'description is required' })
  if (!f.date)        return res.status(400).json({ error: 'date is required' })
  const r = db.prepare(`
    INSERT INTO property_maintenance (property_id, date, vendor, description, category, cost, invoice_number, notes)
    VALUES (?,?,?,?,?,?,?,?)
  `).run(
    req.params.propertyId,
    f.date, f.vendor || null, f.description,
    f.category || 'Other',
    f.cost != null ? parseFloat(f.cost) : null,
    f.invoice_number || null, f.notes || null
  )
  res.status(201).json(db.prepare('SELECT * FROM property_maintenance WHERE id = ?').get(r.lastInsertRowid))
})

router.put('/maintenance/:id', (req, res) => {
  const f = req.body
  db.prepare(`
    UPDATE property_maintenance SET
      date=?, vendor=?, description=?, category=?, cost=?, invoice_number=?, notes=?
    WHERE id=?
  `).run(
    f.date, f.vendor || null, f.description,
    f.category || 'Other',
    f.cost != null ? parseFloat(f.cost) : null,
    f.invoice_number || null, f.notes || null,
    req.params.id
  )
  res.json(db.prepare('SELECT * FROM property_maintenance WHERE id = ?').get(req.params.id))
})

router.delete('/maintenance/:id', (req, res) => {
  db.prepare('DELETE FROM property_maintenance WHERE id = ?').run(req.params.id)
  res.status(204).end()
})

// ── Contacts ──────────────────────────────────────────────────────────────────

router.get('/:propertyId/contacts', (req, res) => {
  res.json(db.prepare('SELECT * FROM property_contacts WHERE property_id = ? ORDER BY role, name').all(req.params.propertyId))
})

router.post('/:propertyId/contacts', (req, res) => {
  const f = req.body
  if (!f.name) return res.status(400).json({ error: 'name is required' })
  const r = db.prepare(`
    INSERT INTO property_contacts (property_id, name, role, company, phone, email, notes)
    VALUES (?,?,?,?,?,?,?)
  `).run(req.params.propertyId, f.name, f.role || 'Other', f.company || null, f.phone || null, f.email || null, f.notes || null)
  res.status(201).json(db.prepare('SELECT * FROM property_contacts WHERE id = ?').get(r.lastInsertRowid))
})

router.put('/contacts/:id', (req, res) => {
  const f = req.body
  db.prepare(`
    UPDATE property_contacts SET name=?, role=?, company=?, phone=?, email=?, notes=? WHERE id=?
  `).run(f.name, f.role || 'Other', f.company || null, f.phone || null, f.email || null, f.notes || null, req.params.id)
  res.json(db.prepare('SELECT * FROM property_contacts WHERE id = ?').get(req.params.id))
})

router.delete('/contacts/:id', (req, res) => {
  db.prepare('DELETE FROM property_contacts WHERE id = ?').run(req.params.id)
  res.status(204).end()
})

// ── Lease abstraction ─────────────────────────────────────────────────────────

function leaseDocuments(propertyId) {
  return db.prepare(`SELECT id, file_name, doc_type, uploaded_at, file_path FROM lease_documents WHERE property_id = ? ORDER BY id ASC`).all(propertyId)
    .map(d => ({ id: d.id, file_name: d.file_name, doc_type: d.doc_type, uploaded_at: d.uploaded_at, has_file: !!(d.file_path && existsSync(d.file_path)) }))
}

function leaseRow(propertyId) {
  const row = db.prepare(`SELECT abstract, model, status, error, created_at, updated_at FROM property_leases WHERE property_id = ?`).get(propertyId)
  const documents = leaseDocuments(propertyId)
  if (!row && documents.length === 0) return null
  let abstract = null
  try { abstract = row?.abstract ? JSON.parse(row.abstract) : null } catch (_) {}
  return {
    property_id: Number(propertyId), abstract,
    model: row?.model, status: row?.status || 'done', error: row?.error,
    created_at: row?.created_at, updated_at: row?.updated_at, documents,
  }
}

// (Re)generate the combined abstract across ALL of a property's lease documents.
// Marks 'processing' and runs the AI in the background (client polls for result).
function startAbstraction(propertyId) {
  db.prepare(`
    INSERT INTO property_leases (property_id, model, status, error, updated_at)
    VALUES (?, ?, 'processing', NULL, datetime('now'))
    ON CONFLICT(property_id) DO UPDATE SET status = 'processing', error = NULL, model = excluded.model, updated_at = datetime('now')
  `).run(propertyId, LEASE_MODEL)

  const docs = db.prepare(`SELECT file_name, file_path, doc_type FROM lease_documents WHERE property_id = ? ORDER BY id ASC`).all(propertyId)
  const loaded = []
  for (const d of docs) {
    try { loaded.push({ buffer: readFileSync(d.file_path), mediaType: 'application/pdf', name: d.file_name, doc_type: d.doc_type }) }
    catch (e) { console.warn('[lease] could not read doc:', e.message) }
  }
  if (!loaded.length) {
    db.prepare(`UPDATE property_leases SET status = 'error', error = 'No readable documents', updated_at = datetime('now') WHERE property_id = ?`).run(propertyId)
    return
  }

  abstractLease(loaded)
    .then(abstract => {
      db.prepare(`UPDATE property_leases SET abstract = ?, status = 'done', error = NULL, updated_at = datetime('now') WHERE property_id = ?`)
        .run(JSON.stringify(abstract), propertyId)
      console.log(`[lease] abstracted property ${propertyId} from ${loaded.length} doc(s)`)
    })
    .catch(e => {
      console.error('[lease] abstract failed:', e.message)
      db.prepare(`UPDATE property_leases SET status = 'error', error = ?, updated_at = datetime('now') WHERE property_id = ?`)
        .run(String(e.message).slice(0, 500), propertyId)
    })
}

// GET the stored abstract + document list (null if none). While the AI runs,
// status is 'processing'; the client polls this until 'done'/'error'.
router.get('/:propertyId/lease', (req, res) => {
  res.json({ lease: leaseRow(req.params.propertyId) })
})

// Upload a lease document (base lease OR an amendment/exhibit). Appends it and
// re-abstracts across ALL of the property's documents. Responds immediately; the
// AI runs in the background so a long call never times out the request.
router.post('/:propertyId/lease/upload', upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' })
  const prop = db.prepare('SELECT id FROM properties WHERE id = ?').get(req.params.propertyId)
  if (!prop) return res.status(404).json({ error: 'Property not found' })

  const dir = join(LEASE_DIR, String(prop.id))
  try { mkdirSync(dir, { recursive: true }) } catch (_) {}

  // Migrate a pre-existing single-file lease into lease_documents so it stays
  // part of the combined abstract.
  const existing = db.prepare(`SELECT COUNT(*) AS n FROM lease_documents WHERE property_id = ?`).get(prop.id).n
  if (existing === 0) {
    const legacy = db.prepare(`SELECT file_name, file_path FROM property_leases WHERE property_id = ?`).get(prop.id)
    if (legacy?.file_path && existsSync(legacy.file_path)) {
      db.prepare(`INSERT INTO lease_documents (property_id, file_name, file_path, doc_type) VALUES (?, ?, ?, 'Lease')`)
        .run(prop.id, legacy.file_name || 'Lease.pdf', legacy.file_path)
    }
  }

  // Save with a timestamped name so amendments don't overwrite the base lease.
  const base  = (req.file.originalname || 'lease.pdf').replace(/[^\w.\-]+/g, '_')
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
  const filePath = join(dir, `${stamp}-${base}`)
  try { writeFileSync(filePath, req.file.buffer) } catch (e) { return res.status(500).json({ error: `Could not save file: ${e.message}` }) }

  const hadDocs = db.prepare(`SELECT COUNT(*) AS n FROM lease_documents WHERE property_id = ?`).get(prop.id).n
  const docType = String(req.body?.doc_type || (hadDocs > 0 ? 'Amendment' : 'Lease')).slice(0, 40)
  db.prepare(`INSERT INTO lease_documents (property_id, file_name, file_path, doc_type) VALUES (?, ?, ?, ?)`)
    .run(prop.id, req.file.originalname || base, filePath, docType)

  startAbstraction(prop.id)
  res.json({ lease: leaseRow(prop.id) })
})

// Stream a specific lease document.
router.get('/:propertyId/lease/documents/:docId/file', (req, res) => {
  const d = db.prepare(`SELECT file_name, file_path FROM lease_documents WHERE id = ? AND property_id = ?`).get(req.params.docId, req.params.propertyId)
  if (!d || !d.file_path || !existsSync(d.file_path)) return res.status(404).json({ error: 'Document not found' })
  res.setHeader('Content-Type', 'application/pdf')
  res.setHeader('Content-Disposition', `inline; filename="${(d.file_name || 'lease.pdf').replace(/"/g, '')}"`)
  createReadStream(d.file_path).pipe(res)
})

// Delete one lease document, then re-abstract across what remains.
router.delete('/:propertyId/lease/documents/:docId', (req, res) => {
  const d = db.prepare(`SELECT file_path FROM lease_documents WHERE id = ? AND property_id = ?`).get(req.params.docId, req.params.propertyId)
  if (!d) return res.status(404).json({ error: 'Document not found' })
  if (d.file_path) { try { unlink(d.file_path, () => {}) } catch (_) {} }
  db.prepare(`DELETE FROM lease_documents WHERE id = ?`).run(req.params.docId)

  const remaining = db.prepare(`SELECT COUNT(*) AS n FROM lease_documents WHERE property_id = ?`).get(req.params.propertyId).n
  if (remaining > 0) startAbstraction(req.params.propertyId)
  else db.prepare(`DELETE FROM property_leases WHERE property_id = ?`).run(req.params.propertyId)
  res.json({ lease: leaseRow(req.params.propertyId) })
})

// Remove the entire lease (all documents + abstract).
router.delete('/:propertyId/lease', (req, res) => {
  for (const d of db.prepare(`SELECT file_path FROM lease_documents WHERE property_id = ?`).all(req.params.propertyId)) {
    if (d.file_path) { try { unlink(d.file_path, () => {}) } catch (_) {} }
  }
  db.prepare(`DELETE FROM lease_documents WHERE property_id = ?`).run(req.params.propertyId)
  db.prepare(`DELETE FROM property_leases WHERE property_id = ?`).run(req.params.propertyId)
  res.json({ ok: true })
})

// ── Store-manager call notes ──────────────────────────────────────────────────
router.get('/:propertyId/call-notes', (req, res) => {
  res.json(db.prepare('SELECT id, note, author, created_at FROM property_call_notes WHERE property_id = ? ORDER BY created_at DESC, id DESC').all(req.params.propertyId))
})
router.post('/:propertyId/call-notes', (req, res) => {
  const note = String(req.body?.note || '').trim()
  if (!note) return res.status(400).json({ error: 'note is required' })
  const r = db.prepare('INSERT INTO property_call_notes (property_id, note, author) VALUES (?, ?, ?)')
    .run(req.params.propertyId, note, req.user?.name || null)
  res.status(201).json(db.prepare('SELECT id, note, author, created_at FROM property_call_notes WHERE id = ?').get(r.lastInsertRowid))
})
router.delete('/call-notes/:id', (req, res) => {
  db.prepare('DELETE FROM property_call_notes WHERE id = ?').run(req.params.id)
  res.json({ ok: true })
})

// ── Property dashboard ────────────────────────────────────────────────────────

function daysUntilDate(d) {
  if (!d) return null
  const t = new Date(String(d).length === 10 ? d + 'T12:00:00' : d)
  if (isNaN(t)) return null
  return Math.round((t - new Date()) / 86400000)
}

// One call that assembles everything the property command-center needs.
router.get('/:propertyId/dash', (req, res) => {
  const p = db.prepare(`
    SELECT p.id, p.address, p.city, p.state, p.zip, p.store_manager, p.store_phone,
           p.estimated_sales, p.estimated_sales_date, p.photo_path, tb.name AS tenant_brand_name
    FROM properties p LEFT JOIN tenant_brands tb ON tb.id = p.tenant_brand_id
    WHERE p.id = ?
  `).get(req.params.propertyId)
  if (!p) return res.status(404).json({ error: 'Property not found' })

  const tasks = db.prepare(`
    SELECT id, title, task_type, due_date, recurs
    FROM property_tasks WHERE property_id = ? AND completed_at IS NULL
    ORDER BY (due_date IS NULL), due_date ASC
  `).all(p.id).map(t => ({ ...t, days_until: daysUntilDate(t.due_date) }))

  const insurance = db.prepare(`
    SELECT id, carrier, premium, expiry_date, paid_status, paid_date, reimbursed_status, reimbursed_date
    FROM property_insurance WHERE property_id = ?
    ORDER BY (expiry_date IS NULL), expiry_date DESC LIMIT 1
  `).get(p.id)
  if (insurance) insurance.days_until = daysUntilDate(insurance.expiry_date)

  const taxes = db.prepare(`
    SELECT id, tax_year, due_date, amount, paid_date, paid_amount, reimbursed_status, reimbursed_date
    FROM property_taxes WHERE property_id = ?
    ORDER BY (due_date IS NULL), due_date DESC
  `).all(p.id).map(t => ({ ...t, days_until: daysUntilDate(t.due_date), paid: !!t.paid_date }))

  const contacts = db.prepare(`
    SELECT id, name, role, company, phone, email FROM property_contacts
    WHERE property_id = ? ORDER BY role, name
  `).all(p.id)
  const maintenanceVendors = db.prepare(`
    SELECT vendor AS name, MAX(date) AS last_date, COUNT(*) AS jobs
    FROM property_maintenance WHERE property_id = ? AND vendor IS NOT NULL AND vendor <> ''
    GROUP BY vendor ORDER BY last_date DESC
  `).all(p.id)

  // Landlord responsibilities from the lease abstract, if abstracted.
  let landlord = []
  const lease = db.prepare(`SELECT abstract FROM property_leases WHERE property_id = ? AND status = 'done'`).get(p.id)
  if (lease?.abstract) {
    try { landlord = (JSON.parse(lease.abstract).responsibilities || []).filter(r => r.party === 'Landlord').map(r => ({ category: r.category, detail: r.detail })) }
    catch (_) {}
  }

  // Awaiting-reimbursement: things we've paid that the tenant still owes us back.
  const awaiting = []
  if (insurance && insurance.reimbursed_status !== 'reimbursed') {
    const chk = db.prepare(`SELECT due_date FROM property_tasks WHERE insurance_id = ? AND completed_at IS NULL AND title = ? ORDER BY due_date DESC LIMIT 1`).get(insurance.id, REIMB_CHECK_TITLE)
    // Show it once we've either marked the premium paid or actually emailed a
    // reimbursement request (which leaves an open follow-up task).
    if (insurance.paid_status === 'paid' || chk) {
      awaiting.push({ type: 'Insurance', insurance_id: insurance.id, label: `${insurance.carrier || 'Insurance'} premium`, amount: insurance.premium, next_check: chk?.due_date || null })
    }
  }
  for (const t of taxes) {
    if (t.paid && t.reimbursed_status !== 'reimbursed') {
      awaiting.push({ type: 'Tax', label: `${t.tax_year || ''} property tax`.trim(), amount: t.paid_amount ?? t.amount })
    }
  }

  res.json({
    property: {
      id: p.id, address: p.address, city: p.city, state: p.state, zip: p.zip,
      tenant_brand_name: p.tenant_brand_name,
      store_manager: p.store_manager, store_phone: p.store_phone,
      estimated_sales: p.estimated_sales, estimated_sales_date: p.estimated_sales_date,
      has_photo: !!(p.photo_path && existsSync(p.photo_path)),
    },
    tasks, insurance, taxes, contacts,
    maintenance_vendors: maintenanceVendors,
    landlord_responsibilities: landlord,
    awaiting_reimbursement: awaiting,
  })
})

// Update the dashboard-owned fields (store manager, phone, estimated sales).
router.patch('/:propertyId/dash', (req, res) => {
  const prop = db.prepare('SELECT id FROM properties WHERE id = ?').get(req.params.propertyId)
  if (!prop) return res.status(404).json({ error: 'Property not found' })
  const { store_manager, store_phone, estimated_sales, estimated_sales_date } = req.body || {}
  db.prepare(`
    UPDATE properties SET
      store_manager        = ?,
      store_phone          = ?,
      estimated_sales      = ?,
      estimated_sales_date = ?
    WHERE id = ?
  `).run(
    store_manager?.trim() || null,
    store_phone?.trim() || null,
    estimated_sales === '' || estimated_sales == null ? null : Number(estimated_sales),
    estimated_sales_date || null,
    prop.id,
  )
  res.json({ ok: true })
})

// Upload / replace the property photo.
router.post('/:propertyId/photo', upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' })
  const prop = db.prepare('SELECT id FROM properties WHERE id = ?').get(req.params.propertyId)
  if (!prop) return res.status(404).json({ error: 'Property not found' })
  try {
    const dir = join(PHOTO_DIR, String(prop.id))
    mkdirSync(dir, { recursive: true })
    const ext  = (req.file.originalname.split('.').pop() || 'jpg').replace(/[^\w]/g, '').toLowerCase()
    const path = join(dir, `photo.${ext || 'jpg'}`)
    writeFileSync(path, req.file.buffer)
    db.prepare('UPDATE properties SET photo_path = ? WHERE id = ?').run(path, prop.id)
    res.json({ ok: true })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

// Serve the property photo.
router.get('/:propertyId/photo', (req, res) => {
  const row = db.prepare('SELECT photo_path FROM properties WHERE id = ?').get(req.params.propertyId)
  if (!row?.photo_path || !existsSync(row.photo_path)) return res.status(404).end()
  res.setHeader('Cache-Control', 'no-cache')
  createReadStream(row.photo_path).pipe(res)
})

// ── Insurance documents + tenant reimbursement ────────────────────────────────
const INS_DOCS_DIR = join(DATA_DIR, 'insurance-docs')

router.get('/insurance/:id/documents', (req, res) => {
  res.json(db.prepare(`SELECT id, doc_type, file_name, mime, created_at FROM insurance_documents WHERE insurance_id = ? ORDER BY created_at DESC`).all(req.params.id))
})

router.post('/insurance/:id/documents', upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' })
  const ins = db.prepare('SELECT id FROM property_insurance WHERE id = ?').get(req.params.id)
  if (!ins) return res.status(404).json({ error: 'Insurance record not found' })
  const dir = join(INS_DOCS_DIR, String(ins.id))
  try { mkdirSync(dir, { recursive: true }) } catch (_) {}
  const safe  = (req.file.originalname || 'document').replace(/[^\w.\-]+/g, '_')
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
  const filePath = join(dir, `${stamp}-${safe}`)
  try { writeFileSync(filePath, req.file.buffer) } catch (e) { return res.status(500).json({ error: e.message }) }
  db.prepare(`INSERT INTO insurance_documents (insurance_id, doc_type, file_name, file_path, mime) VALUES (?, ?, ?, ?, ?)`)
    .run(ins.id, String(req.body?.doc_type || 'Other').slice(0, 40), req.file.originalname || safe, filePath, req.file.mimetype || null)
  res.json({ ok: true })
})

router.get('/insurance/:id/documents/:docId/file', (req, res) => {
  const d = db.prepare(`SELECT file_name, file_path, mime FROM insurance_documents WHERE id = ? AND insurance_id = ?`).get(req.params.docId, req.params.id)
  if (!d || !d.file_path || !existsSync(d.file_path)) return res.status(404).json({ error: 'Document not found' })
  res.setHeader('Content-Type', d.mime || 'application/octet-stream')
  res.setHeader('X-Content-Type-Options', 'nosniff')
  res.setHeader('Content-Disposition', `inline; filename="${(d.file_name || 'document').replace(/"/g, '')}"`)
  createReadStream(d.file_path).pipe(res)
})

router.delete('/insurance/:id/documents/:docId', (req, res) => {
  const d = db.prepare(`SELECT file_path FROM insurance_documents WHERE id = ? AND insurance_id = ?`).get(req.params.docId, req.params.id)
  if (!d) return res.status(404).json({ error: 'Document not found' })
  if (d.file_path) { try { unlink(d.file_path, () => {}) } catch (_) {} }
  db.prepare(`DELETE FROM insurance_documents WHERE id = ?`).run(req.params.docId)
  res.json({ ok: true })
})

// Extract the premium line-item breakdown from an attached document — preferring
// the INVOICE (where the property/liability split usually lives), then policy.
router.post('/insurance/:id/extract-breakdown', async (req, res) => {
  const ins = db.prepare('SELECT id FROM property_insurance WHERE id = ?').get(req.params.id)
  if (!ins) return res.status(404).json({ error: 'Insurance record not found' })
  // Read BOTH the invoice (grand total + fees/taxes) and the policy/binder
  // (coverage-level split), since neither alone has the full picture: the
  // invoice usually lumps coverages into one "PROP/GL" line, and the binder
  // typically shows $0 fees. Send them together so the model can reconcile.
  const allDocs = db.prepare(`
    SELECT file_path, mime, doc_type FROM insurance_documents
    WHERE insurance_id = ? AND file_path IS NOT NULL
    ORDER BY CASE doc_type WHEN 'Invoice' THEN 0 WHEN 'Binder' THEN 1 WHEN 'Policy' THEN 2 ELSE 3 END, created_at DESC
  `).all(ins.id).filter(d => existsSync(d.file_path))
  if (!allDocs.length) return res.status(400).json({ error: 'No insurance document to read — upload the invoice or policy first.' })

  // De-dupe by file, then pick a diverse set: the best invoice + the best
  // non-invoice (binder/policy), then fill up to 3 total.
  const seen = new Set(), uniq = []
  for (const d of allDocs) { if (!seen.has(d.file_path)) { seen.add(d.file_path); uniq.push(d) } }
  const invoices = uniq.filter(d => d.doc_type === 'Invoice')
  const others   = uniq.filter(d => d.doc_type !== 'Invoice')
  const selected = []
  if (invoices[0]) selected.push(invoices[0])
  if (others[0])   selected.push(others[0])
  for (const d of uniq) { if (selected.length >= 3) break; if (!selected.includes(d)) selected.push(d) }

  const prompt = `You are reconciling insurance documents for ONE policy to itemize the FULL amount the insured owes. You may be given an INVOICE and a POLICY/BINDER.
Rules:
- The INVOICE carries the grand total and the fees & taxes (policy fee, surplus lines tax, stamping fee, inspection fee, surcharges). It often LUMPS several coverages into a single premium line (e.g. "PROP/GL", "Package").
- The POLICY or BINDER breaks the premium into individual coverages (e.g. Commercial Property, Commercial General Liability, Wind/Hail, Equipment Breakdown, Terrorism/TRIA). When the invoice lumps coverages together, SPLIT that lumped amount using the individual coverage premiums shown in the policy/binder.
- Output EACH individual coverage premium as its own line, PLUS EACH fee and tax from the invoice as its own line.
- Only include Terrorism/TRIA if it was actually purchased (not declined).
- The line amounts MUST sum to the invoice grand total (total amount due). If a policy/binder is not provided, itemize from the invoice as-is.
Return ONLY a JSON array (no markdown): [ { "label": "", "amount": "" } ] — a short label and dollar amount (with $) for each. List coverages first (largest first), then fees and taxes.`

  let items = []
  try {
    const prepared = []
    for (const d of selected) {
      let buffer = readFileSync(d.file_path)
      const mediaType = d.mime || 'application/pdf'
      if (mediaType === 'application/pdf') {
        const srcDoc = await PDFDocument.load(buffer)
        if (srcDoc.getPageCount() > 20) {
          const t = await PDFDocument.create()
          const pgs = await t.copyPages(srcDoc, [...Array(20).keys()])
          pgs.forEach(p => t.addPage(p)); buffer = Buffer.from(await t.save())
        }
      }
      prepared.push({ buffer, mediaType, label: d.doc_type || 'Document' })
    }
    const result = await callClaudeMulti(prepared, prompt)
    const text = (result.content?.[0]?.text || '').trim().replace(/^```json\s*/i, '').replace(/\s*```$/, '')
    const m = text.match(/\[[\s\S]*\]/)
    items = JSON.parse(m ? m[0] : text)
  } catch (e) {
    return res.status(502).json({ error: `Couldn't read the breakdown: ${e.message}` })
  }
  items = (Array.isArray(items) ? items : []).filter(i => i && (i.label || i.amount))
  db.prepare('UPDATE property_insurance SET premium_breakdown = ? WHERE id = ?').run(JSON.stringify(items), ins.id)
  res.json({ premium_items: items })
})

// Prepare the tenant reimbursement email: recipient(s), attachable docs, draft.
router.get('/insurance/:id/reimbursement/prepare', (req, res) => {
  const ins = db.prepare(`
    SELECT i.*, p.id AS property_id, p.address, p.city, p.state, p.tenant_brand_id, tb.name AS tenant_brand
    FROM property_insurance i
    JOIN properties p ON p.id = i.property_id
    LEFT JOIN tenant_brands tb ON tb.id = p.tenant_brand_id
    WHERE i.id = ?
  `).get(req.params.id)
  if (!ins) return res.status(404).json({ error: 'Insurance record not found' })

  let contacts = []
  if (ins.tenant_brand_id) {
    // Match tenant contacts under ANY brand record sharing this brand's name
    // (handles duplicate/renamed brand rows), then any with an email.
    contacts = db.prepare(`
      SELECT id, name, email, title, tenant_roles, territory_states, territory_regions
      FROM people
      WHERE role='tenant_contact' AND email IS NOT NULL AND email<>''
        AND tenant_brand_id IN (SELECT id FROM tenant_brands WHERE name = (SELECT name FROM tenant_brands WHERE id = ?))
      ORDER BY name
    `).all(ins.tenant_brand_id)
    const st = (ins.state || '').toUpperCase()
    contacts.sort((a, b) => ((a.territory_states || '').includes(`"${st}"`) ? 0 : 1) - ((b.territory_states || '').includes(`"${st}"`) ? 0 : 1))
  }
  const documents = db.prepare(`SELECT id, doc_type, file_name FROM insurance_documents WHERE insurance_id=? ORDER BY created_at DESC`).all(ins.id)

  const loc = [ins.address, ins.city, ins.state].filter(Boolean).join(', ')
  let premium_items = []
  try { premium_items = ins.premium_breakdown ? JSON.parse(ins.premium_breakdown) : [] } catch { premium_items = [] }

  res.json({
    property: { id: ins.property_id, address: ins.address }, loc,
    tenant_brand: ins.tenant_brand, premium: ins.premium, premium_items,
    contacts, documents,
    subject: `Insurance reimbursement request — ${ins.tenant_brand ? ins.tenant_brand + ' at ' : ''}${ins.address}`,
  })
})

router.post('/insurance/:id/reimbursement/send', async (req, res) => {
  const { to, cc, subject, body, documentIds } = req.body || {}
  const recipients = Array.isArray(to) ? to.filter(Boolean) : (to ? [to] : [])
  if (!recipients.length) return res.status(400).json({ error: 'At least one recipient is required' })
  if (!subject || !body)  return res.status(400).json({ error: 'subject and body are required' })
  const ins = db.prepare('SELECT id, property_id FROM property_insurance WHERE id = ?').get(req.params.id)
  if (!ins) return res.status(404).json({ error: 'Insurance record not found' })

  const attachments = []
  for (const docId of (Array.isArray(documentIds) ? documentIds : [])) {
    const d = db.prepare(`SELECT file_name, file_path, mime FROM insurance_documents WHERE id = ? AND insurance_id = ?`).get(docId, ins.id)
    if (d?.file_path && existsSync(d.file_path)) attachments.push({ filename: d.file_name, content: readFileSync(d.file_path), contentType: d.mime })
  }

  try {
    await sendMail({
      to: recipients.join(', '), cc: cc || undefined,
      from: process.env.INSURANCE_FROM || process.env.EMAIL_FROM,
      subject, text: body, attachments,
    })
  } catch (e) {
    console.error('[insurance-reimbursement] send failed:', e.message)
    return res.status(502).json({ error: `Send failed: ${e.message}` })
  }

  // Log a note on the property.
  const stamp = new Date().toISOString().slice(0, 10)
  db.prepare(`UPDATE properties SET notes = TRIM(COALESCE(notes,'') || CHAR(10) || ?) WHERE id = ?`)
    .run(`[${stamp}] Insurance reimbursement request emailed to ${recipients.join(', ')} (${attachments.length} attachment${attachments.length === 1 ? '' : 's'}).`, ins.property_id)

  // Auto-create a follow-up: check back in 45 days on whether the tenant paid us
  // back. Surfaces as a task/play on the property. Skip if one is already open.
  const openCheck = db.prepare(`SELECT id FROM property_tasks WHERE insurance_id = ? AND completed_at IS NULL AND title = ?`).get(ins.id, REIMB_CHECK_TITLE)
  if (!openCheck) {
    const due = addDays(today(), 45)
    db.prepare(`INSERT INTO property_tasks (property_id, insurance_id, title, task_type, due_date, priority, notes) VALUES (?, ?, ?, 'insurance', ?, 'high', ?)`)
      .run(ins.property_id, ins.id, REIMB_CHECK_TITLE, due, `Reimbursement request emailed ${stamp} to ${recipients.join(', ')}. Confirm the tenant has paid us back, then mark it reimbursed or still in limbo.`)
  }

  res.json({ ok: true, sent_to: recipients, attachments: attachments.length, follow_up_on: addDays(today(), 45) })
})

export default router
