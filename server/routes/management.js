import { Router }   from 'express'
import multer        from 'multer'
import { join }      from 'node:path'
import { mkdirSync, writeFileSync, readFileSync, createReadStream, existsSync, unlink } from 'node:fs'
import db, { DATA_DIR } from '../db.js'
import { PDFDocument } from 'pdf-lib'
import { sendMail } from '../services/mailer.js'
import { FIELD_META, WHITELIST, mapExtracted } from '../utils/extractedFields.js'

const router  = Router()
const upload  = multer({ storage: multer.memoryStorage(), limits: { fileSize: 30 * 1024 * 1024 } })
const LEASE_DIR = join(DATA_DIR, 'leases')
const PHOTO_DIR = join(DATA_DIR, 'property-photos')

// A portfolio property drops out of the active Property Management section once
// it's sold (listing_status = 'sold', set by the accounting Sale Close-Out or by
// the "Mark as sold" action). The full record is preserved — this only hides it
// from the management dashboard, task/insurance lists and reimbursement widgets.
// NOT_SOLD assumes the properties table is aliased `p`; NOT_SOLD_NOALIAS is for
// queries that select straight from `properties`.
const NOT_SOLD         = `(p.listing_status IS NULL OR p.listing_status <> 'sold')`
const NOT_SOLD_NOALIAS = `(listing_status IS NULL OR listing_status <> 'sold')`

// Title of the auto-created follow-up task that tracks whether a tenant has
// reimbursed us for an insurance premium. Kept in one place so the send,
// mark-reimbursed, and dashboard code all match on it.
const REIMB_CHECK_TITLE = 'Check insurance reimbursement status'
const TAX_REIMB_CHECK_TITLE = 'Check tax reimbursement status'

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
export async function abstractLease(docs) {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY is not set')
  if (!docs.length) throw new Error('No lease documents to abstract')

  const multi = docs.length > 1
  const prompt = `You are a commercial real estate lease analyst. ${multi ? `You have been given ${docs.length} documents for ONE property — the base lease plus its amendments/exhibits (each is labeled above with its name and type). Read ALL of them and produce ONE combined abstract. Where a later amendment modifies the base lease, the amendment CONTROLS; reflect the current, in-effect terms. In "notes", call out anything an amendment changed.` : 'Read the attached lease and produce a faithful abstract.'} Return ONLY valid JSON (no markdown, no commentary) with exactly this shape:
{
  "summary": {
    "tenant": string, "landlord": string, "guarantor": string|null,
    "premises": string, "permitted_use": string,
    "lease_type": string,            // classify as ONE of: "Ground Lease", "NNN", "NN", "Modified Gross", "Gross"
    "commencement_date": string|null,"expiration_date": string|null,
    "term": string,                  // e.g. "10 years"
    "base_rent": string,             // include $ and period
    "rent_escalations": string,
    "escalations_in_term": "Yes"|"No", // whether the CURRENT / base term (NOT the option periods) contains any rent escalations
    "security_deposit": string|null,
    "renewal_options": string|null,  // e.g. "Two 5-year options at market rent"
    "renewal_option_count": number|null,   // how many renewal options REMAIN unexercised
    "renewal_option_length": string|null,  // length of each option, e.g. "5 years"
    "renewal_option_increase": string|null,// rent increase during the options, as a percentage if stated (e.g. "10%"), or "Market" / "FMV" if market-rate
    "renewal_notice": string|null    // the WINDOW the tenant must give notice to exercise an option, e.g. "No less than 6 months and no more than 12 months prior to expiration of the then-current term"
  },
  "responsibilities": [
    { "category": string, "party": "Tenant"|"Landlord"|"Shared"|"Unclear", "detail": string }
  ],
  "key_dates": [ { "label": string, "date": string } ],  // renewal-notice deadlines, option windows, etc.
  "notes": string                    // anything important that doesn't fit above
}

RENEWAL NOTICE — this is critical and often missed. Lease renewal/extension clauses almost always specify a NOTICE WINDOW: how far before the current term expires the tenant must deliver written notice to exercise its option (commonly "no later than 6 months prior to expiration", sometimes a range like "not less than 9 nor more than 12 months prior"). Search the "Option to Renew / Extend", "Extension", and "Term" sections carefully. Put the exact window in "renewal_notice" (quote or closely paraphrase the clause, including whether it's before expiration of the initial term or the then-current term). If the lease grants an option but you cannot find any notice window, set "renewal_notice" to "Option granted; no notice window stated". If there are no options at all, set it to null. Additionally, when the expiration date is known, compute the actual deadline and add it to "key_dates" (e.g. label "Renewal notice deadline (option 1)", date = expiration minus the notice period).

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
    SELECT p.id, p.address, p.display_name, p.display_subtitle, p.city, p.state, t.name AS tenant_brand_name,
           p.lease_end, p.annual_rent, p.purchase_price,
           o.name AS owner_name,
           (SELECT GROUP_CONCAT(pi.policy_number, ' ')
            FROM property_insurance pi
            WHERE pi.property_id = p.id
              AND pi.policy_number IS NOT NULL) AS policy_numbers
    FROM properties p
    LEFT JOIN tenant_brands t ON t.id = p.tenant_brand_id
    LEFT JOIN people         o ON o.id = p.owner_id
    WHERE p.is_portfolio = 1 AND ${NOT_SOLD}
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
    WHERE p.is_portfolio = 1 AND ${NOT_SOLD}
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
    WHERE p.is_portfolio = 1 AND ${NOT_SOLD}
      AND pt.completed_at IS NULL
      AND pt.task_type = 'tax'
      AND LOWER(pt.title) LIKE '%reimburs%'
  `).get().n

  // Awaiting Insurance Reimbursement: same but for insurance tasks
  const insReimbursePending = db.prepare(`
    SELECT COUNT(DISTINCT pt.property_id) AS n
    FROM property_tasks pt
    JOIN properties p ON p.id = pt.property_id
    WHERE p.is_portfolio = 1 AND ${NOT_SOLD}
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
    WHERE property_id IN (SELECT id FROM properties WHERE is_portfolio = 1 AND ${NOT_SOLD_NOALIAS})
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

// ── Dashboard widget drill-down ───────────────────────────────────────────────
// GET /dashboard/breakdown?metric=<metric>
// Returns the per-property rows behind a dashboard stat card, computed with the
// SAME logic as the card itself so the rows always reconcile with the headline
// number. `column` describes how to render the per-row value.
router.get('/dashboard/breakdown', (req, res) => {
  const metric = String(req.query.metric || '')
  const todayStr = today()
  const in90  = addDays(todayStr, 90)
  const in180 = addDays(todayStr, 180)

  // Shared property-identity columns for the drill-down rows.
  const PROP_COLS = `
    p.id AS property_id, p.address, p.display_name, p.display_subtitle,
    p.city, p.state, t.name AS tenant_brand_name
  `

  const respond = (label, column, rows) => res.json({ metric, label, column, rows })

  switch (metric) {
    case 'properties': {
      const rows = db.prepare(`
        SELECT ${PROP_COLS}, p.annual_rent AS value
        FROM properties p
        LEFT JOIN tenant_brands t ON t.id = p.tenant_brand_id
        WHERE p.is_portfolio = 1 AND ${NOT_SOLD}
        ORDER BY p.annual_rent DESC NULLS LAST, p.address
      `).all()
      return respond('Portfolio Properties', { label: 'Annual Rent', type: 'currency' }, rows)
    }

    case 'overdue_tasks': {
      // One row per property, value = number of overdue tasks (sums to the card).
      const rows = db.prepare(`
        SELECT ${PROP_COLS},
               COUNT(*) AS value,
               MIN(pt.due_date) AS sub
        FROM property_tasks pt
        JOIN properties p ON p.id = pt.property_id
        LEFT JOIN tenant_brands t ON t.id = p.tenant_brand_id
        WHERE p.is_portfolio = 1 AND ${NOT_SOLD}
          AND pt.completed_at IS NULL
          AND pt.due_date IS NOT NULL
          AND pt.due_date < ?
        GROUP BY p.id
        ORDER BY value DESC, sub
      `).all(todayStr)
      return respond('Overdue Tasks', { label: 'Overdue', type: 'count', subLabel: 'Oldest due', subType: 'date' }, rows)
    }

    case 'insurance_expiring': {
      // One row per expiring policy (card counts policies, not properties).
      const rows = db.prepare(`
        SELECT ${PROP_COLS},
               pi.expiry_date AS value,
               pi.carrier AS sub
        FROM property_insurance pi
        JOIN properties p ON p.id = pi.property_id
        LEFT JOIN tenant_brands t ON t.id = p.tenant_brand_id
        WHERE p.is_portfolio = 1 AND ${NOT_SOLD}
          AND pi.expiry_date IS NOT NULL
          AND pi.expiry_date >= ? AND pi.expiry_date <= ?
        ORDER BY pi.expiry_date
      `).all(todayStr, in90)
      return respond('Insurance Expiring', { label: 'Expires', type: 'date', subLabel: 'Carrier', subType: 'text' }, rows)
    }

    case 'maintenance_ytd': {
      const rows = db.prepare(`
        SELECT ${PROP_COLS}, SUM(pm.cost) AS value
        FROM property_maintenance pm
        JOIN properties p ON p.id = pm.property_id
        LEFT JOIN tenant_brands t ON t.id = p.tenant_brand_id
        WHERE p.is_portfolio = 1 AND ${NOT_SOLD}
          AND pm.date >= date('now', '-365 days')
        GROUP BY p.id
        HAVING SUM(pm.cost) > 0
        ORDER BY value DESC
      `).all()
      return respond('Maintenance (last 365 days)', { label: 'Spend', type: 'currency' }, rows)
    }

    case 'tax_due_6mo': {
      // One row per property with an unpaid tax bill due within 6 months;
      // value = total unpaid due (rows count reconciles with the card count).
      const rows = db.prepare(`
        SELECT ${PROP_COLS},
               SUM(pt.amount) AS value,
               MIN(pt.due_date) AS sub
        FROM property_taxes pt
        JOIN properties p ON p.id = pt.property_id
        LEFT JOIN tenant_brands t ON t.id = p.tenant_brand_id
        WHERE p.is_portfolio = 1 AND ${NOT_SOLD}
          AND pt.paid_date IS NULL
          AND pt.due_date IS NOT NULL
          AND pt.due_date <= ?
        GROUP BY p.id
        ORDER BY sub
      `).all(in180)
      return respond('Tax Due (6 months)', { label: 'Amount Due', type: 'currency', subLabel: 'Earliest due', subType: 'date' }, rows)
    }

    case 'tax':
    case 'insurance':
    case 'cam': {
      // Net outstanding per property, mirroring /reimbursements/summary.
      const now = new Date()
      const curYear = now.getFullYear()
      const throughMonth = now.getMonth() + 1
      const props = db.prepare(`
        SELECT ${PROP_COLS}
        FROM properties p
        LEFT JOIN tenant_brands t ON t.id = p.tenant_brand_id
        WHERE p.is_portfolio = 1 AND ${NOT_SOLD}
      `).all()
      const rows = []
      for (const p of props) {
        const setting = db.prepare('SELECT method FROM property_expense_settings WHERE property_id = ? AND expense_type = ?').get(p.property_id, metric)
        const reimb = db.prepare('SELECT status FROM property_expense_reimbursements WHERE property_id = ? AND expense_type = ? AND year = ?').get(p.property_id, metric, curYear)
        if (reimb?.status === 'reimbursed') continue
        const method = setting?.method === 'installments' ? 'installments' : 'direct'
        const actual = actualToDate(p.property_id, metric, curYear, throughMonth)
        const collected = method === 'installments' ? collectedToDate(p.property_id, metric, curYear, throughMonth) : 0
        const net = actual - collected
        if (net > 0) rows.push({ ...p, value: net })
      }
      rows.sort((a, b) => b.value - a.value)
      const label = metric === 'tax' ? 'Awaiting Tax Reimbursement'
        : metric === 'insurance' ? 'Awaiting Insurance Reimbursement'
        : 'Awaiting CAM Reimbursement'
      return respond(label, { label: 'Outstanding', type: 'currency' }, rows)
    }

    default:
      return res.status(400).json({ error: `Unknown metric: ${metric}` })
  }
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
    WHERE p.is_portfolio = 1 AND ${NOT_SOLD}
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
    WHERE p.is_portfolio = 1 AND ${NOT_SOLD}
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

  // Keep the dollar-based reimbursement tracker in sync with paid status.
  if (paid) {
    const year = (policy.effective_date && /^\d{4}/.test(policy.effective_date))
      ? parseInt(policy.effective_date.slice(0, 4), 10)
      : new Date().getFullYear()
    ensureReimbursementForSource({
      propertyId:    policy.property_id,
      sourceType:    'insurance',
      sourceId:      policy.id,
      year,
      expenseAmount: policy.premium,
    })
  } else {
    removeUntouchedReimbursement('insurance', policy.id)
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

// POST /:propertyId/marketing/parse — parse a marketing package / offering
// memorandum / flyer (usually uploaded while the property is still in the
// pipeline stage) to seed the basic property details. Returns extracted JSON for
// the review-and-confirm auto-fill flow; does NOT save anything on its own.
// Parse a marketing package / OM buffer into the basic property-detail JSON.
// Shared by the property auto-fill route and the pipeline deal parser.
export async function parseMarketingBuffer(buffer, mediaType = 'application/pdf') {
  const prompt = `You are extracting the basic property details from a commercial real estate marketing package / offering memorandum / property flyer. Return ONLY a valid JSON object with these exact fields — no explanation, no markdown:

{
  "address": "",
  "city": "",
  "state": "",
  "zip": "",
  "tenant": "",
  "building_size": "",
  "land_area": "",
  "year_built": "",
  "property_type": "",
  "construction_type": "",
  "lease_type": "",
  "lease_start": "",
  "lease_end": "",
  "annual_rent": "",
  "rent_bumps": "",
  "renewal_options": "",
  "noi": "",
  "cap_rate": "",
  "list_price": ""
}

For tenant: the operating tenant/brand at the property (e.g. "Sherwin-Williams").
For building_size: rentable square feet as a bare number (no "SF" or commas).
For land_area: the lot/land size as it appears (e.g. "1.25 acres" or "54,450 SF").
For year_built: the 4-digit year the building was constructed.
For property_type: e.g. "Retail", "Industrial", "Office", "Medical".
For lease_type: e.g. "NNN", "NN", "Absolute Net", "Modified Gross".
For lease_start / lease_end: format YYYY-MM-DD. Use the lease commencement and expiration dates.
For annual_rent: the current annual base rent as a bare number (no $ or commas). If only a monthly figure is given, convert to annual.
For rent_bumps: a short description of the rent escalations (e.g. "10% every 5 years").
For renewal_options: e.g. "Four 5-year options".
For noi: net operating income as a bare number.
For cap_rate: the capitalization rate as a bare number (e.g. 6.25 for 6.25%).
For list_price: the asking / offering price as a bare number.
Extract exact values as they appear. Use "" for anything not found in the document.`

  let pdfBuffer = buffer
  if (mediaType === 'application/pdf') {
    // Trim to the first 20 pages to stay under Anthropic's limits. Marketing
    // PDFs are often "encrypted" with permission flags (no password); pdf-lib
    // can't copy pages out of those, so if trimming fails we fall back to
    // sending the original PDF straight to Claude (its processor handles them).
    try {
      const srcDoc = await PDFDocument.load(pdfBuffer, { ignoreEncryption: true })
      const total  = srcDoc.getPageCount()
      if (total > 20) {
        const trimDoc = await PDFDocument.create()
        const pages   = await trimDoc.copyPages(srcDoc, [...Array(20).keys()])
        pages.forEach(p => trimDoc.addPage(p))
        pdfBuffer = Buffer.from(await trimDoc.save())
        console.log(`[management] marketing PDF truncated from ${total} to 20 pages`)
      }
    } catch (trimErr) {
      console.warn('[management] marketing PDF trim skipped (sending original):', trimErr.message)
    }
  }

  const result = await callClaude(pdfBuffer, mediaType, prompt)
  const raw  = result.content[0].text.trim()
  const json = raw.replace(/^```json\s*/i, '').replace(/\s*```$/, '')
  return JSON.parse(json)
}

// Parse a PSA / purchase-and-sale contract buffer into its critical escrow dates
// and key business terms. Shared by the pipeline deal parser.
export async function parsePsaBuffer(buffer, mediaType = 'application/pdf') {
  const prompt = `You are a commercial real estate transaction analyst extracting the TIMING RULES from a Purchase and Sale Agreement (PSA) / purchase contract (or a PSA amendment). Escrow deadlines are usually defined RELATIVE to the Effective Date or the end of the Due Diligence period (e.g. "the Inspection Period expires 30 days after the Effective Date", "Closing shall occur 15 days after expiration of the Due Diligence Period", "earnest money due within 3 business days after the Effective Date"). Do NOT compute the calendar dates yourself — capture each rule so the app can compute them. Return ONLY valid JSON (no markdown, no commentary) with exactly this shape:
{
  "buyer": "",
  "seller": "",
  "purchase_price": "",
  "earnest_money": "",
  "effective_date": "",
  "triggers": {
    "earnest_due":     { "anchor": "effective|dd_deadline|fixed", "days": number|null, "unit": "calendar|business", "date": "YYYY-MM-DD|null" },
    "dd_deadline":     { "anchor": "effective|dd_deadline|fixed", "days": number|null, "unit": "calendar|business", "date": "YYYY-MM-DD|null" },
    "title_objection": { "anchor": "effective|dd_deadline|fixed", "days": number|null, "unit": "calendar|business", "date": "YYYY-MM-DD|null" },
    "close":           { "anchor": "effective|dd_deadline|fixed", "days": number|null, "unit": "calendar|business", "date": "YYYY-MM-DD|null" }
  },
  "notes": ""
}

For each trigger:
- If it is defined relative to the Effective Date → anchor="effective", days=N, unit="calendar" or "business", date=null.
- If relative to the end of the Due Diligence / Inspection period → anchor="dd_deadline", days=N, unit=..., date=null. (Closing is most often anchored on dd_deadline.)
- If stated as a specific calendar date → anchor="fixed", date="YYYY-MM-DD", days=null.
- If a trigger isn't addressed in this document, set all its fields to null (important for AMENDMENTS, which often change only ONE deadline — leave the others null so we don't overwrite them).
earnest_due = deadline to deposit earnest money. dd_deadline = end of the due-diligence / inspection period (earnest goes hard). title_objection = deadline to object to title/survey. close = closing date.
effective_date = the actual execution/effective date (YYYY-MM-DD) if stated, else "".
purchase_price / earnest_money = bare numbers. Use "" / null for anything not found. Do not invent values.`

  let pdfBuffer = buffer
  if (mediaType === 'application/pdf') {
    // Critical dates cluster in the first ~30 pages (business terms, deposit,
    // inspection, closing sections); trim to stay under Anthropic's limits, with
    // the same encrypted-PDF fallback as the marketing parser.
    try {
      const srcDoc = await PDFDocument.load(pdfBuffer, { ignoreEncryption: true })
      const total  = srcDoc.getPageCount()
      if (total > 30) {
        const trimDoc = await PDFDocument.create()
        const pages   = await trimDoc.copyPages(srcDoc, [...Array(30).keys()])
        pages.forEach(p => trimDoc.addPage(p))
        pdfBuffer = Buffer.from(await trimDoc.save())
        console.log(`[management] PSA PDF truncated from ${total} to 30 pages`)
      }
    } catch (trimErr) {
      console.warn('[management] PSA PDF trim skipped (sending original):', trimErr.message)
    }
  }

  const result = await callClaude(pdfBuffer, mediaType, prompt)
  const raw  = result.content[0].text.trim()
  const json = raw.replace(/^```json\s*/i, '').replace(/\s*```$/, '')
  return JSON.parse(json)
}

// Trim a PDF to its first N pages (encrypted-safe); returns the original on failure.
async function trimPdf(buffer, mediaType, maxPages) {
  if (mediaType !== 'application/pdf') return buffer
  try {
    const src = await PDFDocument.load(buffer, { ignoreEncryption: true })
    if (src.getPageCount() <= maxPages) return buffer
    const out = await PDFDocument.create()
    const pages = await out.copyPages(src, [...Array(maxPages).keys()])
    pages.forEach(p => out.addPage(p))
    return Buffer.from(await out.save())
  } catch { return buffer }
}

// Classify a dropped deal document so a single upload box can route to the right
// parser. Returns one of: 'om' | 'lease' | 'psa' | 'proposal' | 'unknown'.
export async function classifyDealDocument(buffer, mediaType = 'application/pdf') {
  const trimmed = await trimPdf(buffer, mediaType, 6)
  const prompt = `Classify this commercial real estate document into exactly ONE category. Return ONLY the lowercase category word, nothing else.
Categories:
- om        → offering memorandum, marketing package, property flyer, broker "OM"
- lease     → a lease or lease amendment/exhibit
- psa       → purchase & sale agreement, purchase contract, contract of sale
- proposal  → a due-diligence VENDOR PROPOSAL / engagement for a survey (ALTA/boundary), Phase I/II environmental site assessment, or property condition report (PCR/PCA). These quote a scope, fee, and turnaround time.
- settlement → a closing / SETTLEMENT STATEMENT (ALTA Settlement Statement, HUD-1, Closing Disclosure, Buyer's/Seller's statement). Itemizes the purchase price, closing costs, prorations, earnest money, and cash to close for a completed or pending closing.
- unknown   → none of the above
Answer with just one word: om, lease, psa, proposal, settlement, or unknown.`
  const result = await callClaude(trimmed, mediaType, prompt)
  const word = (result.content[0].text || '').trim().toLowerCase().replace(/[^a-z]/g, '')
  return ['om', 'lease', 'psa', 'proposal', 'settlement'].includes(word) ? word : 'unknown'
}

// Parse a due-diligence vendor proposal (survey / environmental / PCR) for its
// scope and TURNAROUND time. Returns { kind, vendor, turnaround_days, turnaround_text, cost, notes }.
export async function parseProposalBuffer(buffer, mediaType = 'application/pdf') {
  const trimmed = await trimPdf(buffer, mediaType, 15)
  const prompt = `You are extracting the timeline from a commercial real estate due-diligence VENDOR PROPOSAL (a survey, environmental Phase I/II, or property condition report). Return ONLY valid JSON (no markdown) with exactly this shape:
{
  "kind": "",             // one of: survey, environmental, pcr, other
  "vendor": "",           // the firm providing the report
  "turnaround_text": "",  // the delivery timeline exactly as stated, e.g. "3 weeks from authorization" or "15 business days"
  "turnaround_days": "",  // the turnaround as a bare number of CALENDAR days. Convert: weeks×7; "business days"×1.4 (round up). If a range, use the LONGER end.
  "cost": "",             // the fee as a bare number (no $ or commas), if stated
  "notes": ""             // anything important about timing (rush options, dependencies, assumptions)
}
Use "" for anything not found. Do not invent values.`
  const result = await callClaude(trimmed, mediaType, prompt)
  const raw  = result.content[0].text.trim()
  const json = raw.replace(/^```json\s*/i, '').replace(/\s*```$/, '')
  return JSON.parse(json)
}

router.post('/:propertyId/marketing/parse', upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' })
  try {
    const data = await parseMarketingBuffer(req.file.buffer, req.file.mimetype || 'application/pdf')
    res.json(data)
  } catch (err) {
    console.error('[management] marketing parse error:', err.message)
    res.status(422).json({ error: 'Could not parse marketing package: ' + err.message })
  }
})

// ── Taxes ─────────────────────────────────────────────────────────────────────

router.get('/:propertyId/taxes', (req, res) => {
  res.json(db.prepare('SELECT * FROM property_taxes WHERE property_id = ? ORDER BY tax_year DESC, due_date DESC').all(req.params.propertyId))
})

// POST /:propertyId/taxes/upload — parse a property tax bill with AI (no save).
// Mirrors the insurance upload route: returns extracted fields for review.
router.post('/:propertyId/taxes/upload', upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' })

  const mediaType = req.file.mimetype || 'application/pdf'
  const prompt = `You are extracting key information from a commercial property tax bill / statement. Return ONLY a valid JSON object with these exact fields — no explanation, no markdown:

{
  "tax_year": "",
  "due_date": "",
  "amount": "",
  "paid_date": "",
  "paid_amount": "",
  "parcel_number": "",
  "taxing_authority": ""
}

For tax_year: the tax year the bill is for (a 4-digit year like 2025).
For due_date: the payment due date, formatted YYYY-MM-DD. If several installments, use the earliest due date.
For amount: the total tax amount owed for the year, as a bare number with no $ or commas.
For paid_date: only if the bill clearly shows it was already paid, formatted YYYY-MM-DD; otherwise "".
For paid_amount: only if already paid, the amount paid as a bare number; otherwise "".
For parcel_number: the parcel / account / property ID number as shown.
For taxing_authority: the county, city, or district issuing the bill (e.g. "Dallas County Tax Office").
Extract exact values as they appear in the document. Use "" for anything not found.`

  try {
    let pdfBuffer = req.file.buffer
    if (mediaType === 'application/pdf') {
      const srcDoc = await PDFDocument.load(pdfBuffer)
      const total  = srcDoc.getPageCount()
      if (total > 20) {
        const trimDoc = await PDFDocument.create()
        const pages   = await trimDoc.copyPages(srcDoc, [...Array(20).keys()])
        pages.forEach(p => trimDoc.addPage(p))
        pdfBuffer = Buffer.from(await trimDoc.save())
        console.log(`[management] tax PDF truncated from ${total} to 20 pages`)
      }
    }

    const result = await callClaude(pdfBuffer, mediaType, prompt)
    const raw  = result.content[0].text.trim()
    const json = raw.replace(/^```json\s*/i, '').replace(/\s*```$/, '')
    const data = JSON.parse(json)
    res.json(data)
  } catch (err) {
    console.error('[management] tax upload parse error:', err.message)
    res.status(422).json({ error: 'Could not parse tax document: ' + err.message })
  }
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
  // If the tax was recorded as already paid, open a reimbursement to recover it.
  if (f.paid_date) {
    ensureReimbursementForSource({
      propertyId:    req.params.propertyId,
      sourceType:    'tax',
      sourceId:      r.lastInsertRowid,
      year:          f.tax_year != null ? parseInt(f.tax_year, 10) : new Date().getFullYear(),
      expenseAmount: f.paid_amount != null ? f.paid_amount : f.amount,
    })
  }
  res.status(201).json(db.prepare('SELECT * FROM property_taxes WHERE id = ?').get(r.lastInsertRowid))
})

router.put('/taxes/:id', (req, res) => {
  const f = req.body
  const before = db.prepare('SELECT * FROM property_taxes WHERE id = ?').get(req.params.id)
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
  // Newly marked paid → open a reimbursement; un-paid → drop an untouched one.
  const nowPaid = !!f.paid_date
  const wasPaid = !!(before && before.paid_date)
  if (nowPaid && !wasPaid) {
    ensureReimbursementForSource({
      propertyId:    before ? before.property_id : null,
      sourceType:    'tax',
      sourceId:      parseInt(req.params.id, 10),
      year:          f.tax_year != null ? parseInt(f.tax_year, 10) : (before?.tax_year || new Date().getFullYear()),
      expenseAmount: f.paid_amount != null ? f.paid_amount : f.amount,
    })
  } else if (!nowPaid && wasPaid) {
    removeUntouchedReimbursement('tax', parseInt(req.params.id, 10))
  }
  res.json(db.prepare('SELECT * FROM property_taxes WHERE id = ?').get(req.params.id))
})

router.delete('/taxes/:id', (req, res) => {
  db.prepare('DELETE FROM property_taxes WHERE id = ?').run(req.params.id)
  res.status(204).end()
})

// PATCH /taxes/:id/paid — mark the tax bill paid (or undo), mirroring insurance.
// Marking paid stamps paid_date (and paid_amount from the bill amount if blank)
// and opens a reimbursement so it flows onto the dashboard "Awaiting
// Reimbursement" card. Undo clears the paid stamp and drops an untouched one.
router.patch('/taxes/:id/paid', (req, res) => {
  const { paid } = req.body  // true = mark paid, false = undo
  const t = db.prepare('SELECT * FROM property_taxes WHERE id = ?').get(req.params.id)
  if (!t) return res.status(404).json({ error: 'Tax record not found' })

  if (paid) {
    const paidAmount = t.paid_amount != null ? t.paid_amount : t.amount
    db.prepare(`UPDATE property_taxes SET paid_date = ?, paid_amount = ? WHERE id = ?`)
      .run(today(), paidAmount, req.params.id)
    ensureReimbursementForSource({
      propertyId:    t.property_id,
      sourceType:    'tax',
      sourceId:      t.id,
      year:          t.tax_year != null ? t.tax_year : new Date().getFullYear(),
      expenseAmount: paidAmount,
    })
  } else {
    db.prepare(`UPDATE property_taxes SET paid_date = NULL WHERE id = ?`).run(req.params.id)
    removeUntouchedReimbursement('tax', t.id)
  }

  res.json(db.prepare('SELECT * FROM property_taxes WHERE id = ?').get(req.params.id))
})

// ── Tax installments (1st half / 2nd half payments) ───────────────────────────
// Keep the parent tax row's paid_amount/paid_date in sync from its installments,
// and keep the reimbursement dollar-tracker in step.
function syncTaxFromInstallments(taxId) {
  const t = db.prepare('SELECT * FROM property_taxes WHERE id = ?').get(taxId)
  if (!t) return
  const rows = db.prepare('SELECT amount, paid_date FROM tax_installments WHERE tax_id = ?').all(taxId)
  if (rows.length) {
    const sum = rows.reduce((s, r) => s + (Number(r.amount) || 0), 0)
    const dates = rows.map(r => r.paid_date).filter(Boolean).sort()
    const latest = dates.length ? dates[dates.length - 1] : null
    db.prepare('UPDATE property_taxes SET paid_amount = ?, paid_date = ? WHERE id = ?').run(sum, latest, taxId)
    if (latest) {
      ensureReimbursementForSource({
        propertyId: t.property_id, sourceType: 'tax', sourceId: t.id,
        year: t.tax_year != null ? t.tax_year : new Date().getFullYear(), expenseAmount: sum,
      })
    }
  } else {
    // No installments left — clear the derived paid state.
    db.prepare('UPDATE property_taxes SET paid_amount = NULL, paid_date = NULL WHERE id = ?').run(taxId)
    removeUntouchedReimbursement('tax', t.id)
  }
}

router.get('/taxes/:id/installments', (req, res) => {
  res.json(db.prepare('SELECT id, label, amount, paid_date FROM tax_installments WHERE tax_id = ? ORDER BY paid_date, id').all(req.params.id))
})
router.post('/taxes/:id/installments', (req, res) => {
  const tax = db.prepare('SELECT id FROM property_taxes WHERE id = ?').get(req.params.id)
  if (!tax) return res.status(404).json({ error: 'Tax record not found' })
  const { label, amount, paid_date } = req.body || {}
  const r = db.prepare('INSERT INTO tax_installments (tax_id, label, amount, paid_date) VALUES (?, ?, ?, ?)')
    .run(tax.id, String(label || '').slice(0, 60) || null, amount != null && amount !== '' ? Number(amount) : null, paid_date || null)
  syncTaxFromInstallments(tax.id)
  res.status(201).json(db.prepare('SELECT id, label, amount, paid_date FROM tax_installments WHERE id = ?').get(r.lastInsertRowid))
})
router.put('/taxes/installments/:iid', (req, res) => {
  const inst = db.prepare('SELECT tax_id FROM tax_installments WHERE id = ?').get(req.params.iid)
  if (!inst) return res.status(404).json({ error: 'Installment not found' })
  const { label, amount, paid_date } = req.body || {}
  db.prepare('UPDATE tax_installments SET label = ?, amount = ?, paid_date = ? WHERE id = ?')
    .run(String(label || '').slice(0, 60) || null, amount != null && amount !== '' ? Number(amount) : null, paid_date || null, req.params.iid)
  syncTaxFromInstallments(inst.tax_id)
  res.json(db.prepare('SELECT id, label, amount, paid_date FROM tax_installments WHERE id = ?').get(req.params.iid))
})
router.delete('/taxes/installments/:iid', (req, res) => {
  const inst = db.prepare('SELECT tax_id FROM tax_installments WHERE id = ?').get(req.params.iid)
  if (!inst) return res.status(404).json({ error: 'Installment not found' })
  db.prepare('DELETE FROM tax_installments WHERE id = ?').run(req.params.iid)
  syncTaxFromInstallments(inst.tax_id)
  res.json({ ok: true })
})

// ── Tax documents (the uploaded tax bill) ─────────────────────────────────────
const TAX_DOCS_DIR = join(DATA_DIR, 'tax-docs')

router.get('/taxes/:id/documents', (req, res) => {
  res.json(db.prepare(`SELECT id, doc_type, file_name, mime, created_at FROM tax_documents WHERE tax_id = ? ORDER BY created_at DESC`).all(req.params.id))
})

router.post('/taxes/:id/documents', upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' })
  const tax = db.prepare('SELECT id FROM property_taxes WHERE id = ?').get(req.params.id)
  if (!tax) return res.status(404).json({ error: 'Tax record not found' })
  const dir = join(TAX_DOCS_DIR, String(tax.id))
  try { mkdirSync(dir, { recursive: true }) } catch (_) {}
  const safe  = (req.file.originalname || 'document').replace(/[^\w.\-]+/g, '_')
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
  const filePath = join(dir, `${stamp}-${safe}`)
  try { writeFileSync(filePath, req.file.buffer) } catch (e) { return res.status(500).json({ error: e.message }) }
  db.prepare(`INSERT INTO tax_documents (tax_id, doc_type, file_name, file_path, mime) VALUES (?, ?, ?, ?, ?)`)
    .run(tax.id, String(req.body?.doc_type || 'Tax Bill').slice(0, 40), req.file.originalname || safe, filePath, req.file.mimetype || null)
  res.json({ ok: true })
})

router.get('/taxes/:id/documents/:docId/file', (req, res) => {
  const d = db.prepare(`SELECT file_name, file_path, mime FROM tax_documents WHERE id = ? AND tax_id = ?`).get(req.params.docId, req.params.id)
  if (!d || !d.file_path || !existsSync(d.file_path)) return res.status(404).json({ error: 'Document not found' })
  res.setHeader('Content-Type', d.mime || 'application/octet-stream')
  res.setHeader('X-Content-Type-Options', 'nosniff')
  res.setHeader('Content-Disposition', `inline; filename="${(d.file_name || 'document').replace(/"/g, '')}"`)
  createReadStream(d.file_path).pipe(res)
})

router.delete('/taxes/:id/documents/:docId', (req, res) => {
  const d = db.prepare(`SELECT file_path FROM tax_documents WHERE id = ? AND tax_id = ?`).get(req.params.docId, req.params.id)
  if (!d) return res.status(404).json({ error: 'Document not found' })
  if (d.file_path) { try { unlink(d.file_path, () => {}) } catch (_) {} }
  db.prepare(`DELETE FROM tax_documents WHERE id = ?`).run(req.params.docId)
  res.json({ ok: true })
})

// ── Tax reimbursement email (mirrors the insurance flow) ──────────────────────
router.get('/taxes/:id/reimbursement/prepare', (req, res) => {
  const tax = db.prepare(`
    SELECT t.*, p.id AS property_id, p.address, p.city, p.state, p.tenant_brand_id, tb.name AS tenant_brand
    FROM property_taxes t
    JOIN properties p ON p.id = t.property_id
    LEFT JOIN tenant_brands tb ON tb.id = p.tenant_brand_id
    WHERE t.id = ?
  `).get(req.params.id)
  if (!tax) return res.status(404).json({ error: 'Tax record not found' })

  let contacts = []
  if (tax.tenant_brand_id) {
    contacts = db.prepare(`
      SELECT id, name, email, title, tenant_roles, territory_states, territory_regions
      FROM people
      WHERE role='tenant_contact' AND email IS NOT NULL AND email<>''
        AND tenant_brand_id IN (SELECT id FROM tenant_brands WHERE name = (SELECT name FROM tenant_brands WHERE id = ?))
      ORDER BY name
    `).all(tax.tenant_brand_id)
    const st = (tax.state || '').toUpperCase()
    contacts.sort((a, b) => ((a.territory_states || '').includes(`"${st}"`) ? 0 : 1) - ((b.territory_states || '').includes(`"${st}"`) ? 0 : 1))
  }
  const documents = db.prepare(`SELECT id, doc_type, file_name FROM tax_documents WHERE tax_id=? ORDER BY created_at DESC`).all(tax.id)
  const installments = db.prepare(`SELECT id, label, amount, paid_date FROM tax_installments WHERE tax_id=? ORDER BY paid_date, id`).all(tax.id)

  const loc = [tax.address, tax.city, tax.state].filter(Boolean).join(', ')
  res.json({
    property: { id: tax.property_id, address: tax.address }, loc,
    tenant_brand: tax.tenant_brand,
    tax_year: tax.tax_year,
    amount: tax.paid_amount ?? tax.amount,
    installments,
    contacts, documents,
    subject: `Property tax reimbursement request — ${tax.tenant_brand ? tax.tenant_brand + ' at ' : ''}${tax.address}`,
  })
})

router.post('/taxes/:id/reimbursement/send', async (req, res) => {
  const { to, cc, subject, body, documentIds, installments } = req.body || {}
  const recipients = Array.isArray(to) ? to.filter(Boolean) : (to ? [to] : [])
  if (!recipients.length) return res.status(400).json({ error: 'At least one recipient is required' })
  if (!subject || !body)  return res.status(400).json({ error: 'subject and body are required' })
  const tax = db.prepare('SELECT id, property_id, tax_year FROM property_taxes WHERE id = ?').get(req.params.id)
  if (!tax) return res.status(404).json({ error: 'Tax record not found' })

  const attachments = []
  for (const docId of (Array.isArray(documentIds) ? documentIds : [])) {
    const d = db.prepare(`SELECT file_name, file_path, mime FROM tax_documents WHERE id = ? AND tax_id = ?`).get(docId, tax.id)
    if (d?.file_path && existsSync(d.file_path)) attachments.push({ filename: d.file_name, content: readFileSync(d.file_path), contentType: d.mime })
  }

  try {
    await sendMail({
      to: recipients.join(', '), cc: cc || undefined,
      from: process.env.TAX_FROM || undefined,
      replyTo: process.env.TAX_REPLY_TO || undefined,
      subject, text: body, attachments,
    })
  } catch (e) {
    console.error('[tax-reimbursement] send failed:', e.message)
    return res.status(502).json({ error: `Send failed: ${e.message}` })
  }

  // Which installments this request covered (labels), if any.
  const labels = Array.isArray(installments) ? installments.map(s => String(s).trim()).filter(Boolean) : []
  const yr = tax.tax_year != null ? `${tax.tax_year} ` : ''
  const forWhat = labels.length ? `${yr}${labels.join(' & ')}` : (yr ? yr.trim() : '').trim()

  const stamp = new Date().toISOString().slice(0, 10)
  db.prepare(`UPDATE properties SET notes = TRIM(COALESCE(notes,'') || CHAR(10) || ?) WHERE id = ?`)
    .run(`[${stamp}] Property tax reimbursement${forWhat ? ` (${forWhat})` : ''} request emailed to ${recipients.join(', ')} (${attachments.length} attachment${attachments.length === 1 ? '' : 's'}).`, tax.property_id)

  // 45-day follow-up, one per installment requested (so 1st half and 2nd half
  // track separately). property_tasks has no tax_id column, so dedupe by
  // property + a title that carries the year + installment. Every title contains
  // "reimburs" so it stays in the dashboard's tax-reimbursement rollup.
  const due = addDays(today(), 45)
  const targets = labels.length ? labels.map(l => `${yr}${l}`) : [yr.trim()].filter(Boolean)
  const openTask = (title, note) => {
    const open = db.prepare(`SELECT id FROM property_tasks WHERE property_id = ? AND completed_at IS NULL AND title = ?`).get(tax.property_id, title)
    if (!open) {
      db.prepare(`INSERT INTO property_tasks (property_id, title, task_type, due_date, priority, notes) VALUES (?, ?, 'tax', ?, 'high', ?)`)
        .run(tax.property_id, title, due, note)
    }
  }
  if (targets.length) {
    for (const t of targets) {
      openTask(`${TAX_REIMB_CHECK_TITLE} — ${t}`,
        `${t} tax reimbursement request emailed ${stamp} to ${recipients.join(', ')}. Confirm the tenant has paid us back, then mark it reimbursed or still in limbo.`)
    }
  } else {
    openTask(TAX_REIMB_CHECK_TITLE,
      `Tax reimbursement request emailed ${stamp} to ${recipients.join(', ')}. Confirm the tenant has paid us back, then mark it reimbursed or still in limbo.`)
  }

  res.json({ ok: true, sent_to: recipients, attachments: attachments.length, follow_up_on: due })
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

  // Awaiting-reimbursement: one net row per expense type for the current year.
  // For installment properties the amount owed is netted against what the tenant
  // has already paid in through the current month; for direct properties it's the
  // full actual-to-date. A negative net means the tenant has overpaid (credit).
  const now = new Date()
  const curYear = now.getFullYear()
  const throughMonth = now.getMonth() + 1
  const TYPE_LABEL = { tax: 'Real Estate Taxes', insurance: 'Insurance', cam: 'CAM' }

  const settingsRows = db.prepare(`SELECT expense_type, method FROM property_expense_settings WHERE property_id = ?`).all(p.id)
  const methodOf = Object.fromEntries(settingsRows.map(s => [s.expense_type, s.method]))
  const reimbRows = db.prepare(`SELECT expense_type, status, next_check FROM property_expense_reimbursements WHERE property_id = ? AND year = ?`).all(p.id, curYear)
  const reimbOf = Object.fromEntries(reimbRows.map(r => [r.expense_type, r]))

  const awaiting = []
  for (const type of EXPENSE_TYPES) {
    const rstat = reimbOf[type]
    if (rstat?.status === 'reimbursed') continue          // already settled for the year
    const method = methodOf[type] === 'installments' ? 'installments' : 'direct'
    const actual = actualToDate(p.id, type, curYear, throughMonth)
    const collected = method === 'installments' ? collectedToDate(p.id, type, curYear, throughMonth) : 0
    const net = actual - collected
    const show = method === 'installments' ? (actual > 0 || collected > 0) : (actual > 0)
    if (!show) continue
    // Insurance follow-up task due date is a secondary source for next_check.
    let next_check = rstat?.next_check || null
    if (!next_check && type === 'insurance') {
      const chk = db.prepare(`SELECT due_date FROM property_tasks WHERE property_id = ? AND completed_at IS NULL AND title = ? ORDER BY due_date DESC LIMIT 1`).get(p.id, REIMB_CHECK_TITLE)
      next_check = chk?.due_date || null
    }
    awaiting.push({
      expense_type: type, label: TYPE_LABEL[type], method, year: curYear,
      actual, collected, net,
      status: rstat?.status || 'unreimbursed', next_check,
    })
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

// Rename the property's display label (shown on the dashboard widgets). Blank
// clears it, so the widgets fall back to the street address.
router.patch('/:propertyId/display-name', (req, res) => {
  const prop = db.prepare('SELECT id FROM properties WHERE id = ?').get(req.params.propertyId)
  if (!prop) return res.status(404).json({ error: 'Property not found' })
  const display_name = String(req.body?.display_name ?? '').trim() || null
  db.prepare('UPDATE properties SET display_name = ? WHERE id = ?').run(display_name, prop.id)
  res.json({ ok: true, display_name })
})

// Edit the property's display subtitle (shown under the name on the widgets).
// Blank clears it, so the widgets fall back to the auto address/city/state line.
router.patch('/:propertyId/display-subtitle', (req, res) => {
  const prop = db.prepare('SELECT id FROM properties WHERE id = ?').get(req.params.propertyId)
  if (!prop) return res.status(404).json({ error: 'Property not found' })
  const display_subtitle = String(req.body?.display_subtitle ?? '').trim() || null
  db.prepare('UPDATE properties SET display_subtitle = ? WHERE id = ?').run(display_subtitle, prop.id)
  res.json({ ok: true, display_subtitle })
})

// ── Auto-fill from documents ────────────────────────────────────────────────
// The parse endpoints (insurance/tax/lease/settlement/marketing) each return raw
// extracted JSON. These two routes turn that into a review-and-confirm auto-fill:
//   1) extract-diff   → normalize + map to property columns, return current vs
//                       proposed for every field the doc supplied.
//   2) apply-extracted → write only the fields the user approved (overwrite),
//                       auto-creating the tenant brand when a new name is given.

// POST /:propertyId/extract-diff  body: { docType, data }
// Returns { fields: [{ key, label, type, current, proposed }], tenant }.
router.post('/:propertyId/extract-diff', (req, res) => {
  const prop = db.prepare('SELECT * FROM properties WHERE id = ?').get(req.params.propertyId)
  if (!prop) return res.status(404).json({ error: 'Property not found' })

  const { docType, data } = req.body || {}
  let mapped
  try {
    mapped = mapExtracted(docType, data)
  } catch (err) {
    return res.status(400).json({ error: err.message })
  }

  const fields = Object.entries(mapped.fields)
    .filter(([key]) => key !== 'tenant_brand_id')
    .map(([key, proposed]) => ({
      key,
      label: FIELD_META[key]?.label || key,
      type:  FIELD_META[key]?.type  || 'text',
      current: prop[key] ?? null,
      proposed,
    }))

  // Tenant is handled specially: resolve the extracted name to an existing brand
  // (case-insensitive) or flag it as new so the client can show "will create".
  let tenant = null
  if (mapped.tenantName) {
    const existing = db.prepare('SELECT id, name FROM tenant_brands WHERE name = ? COLLATE NOCASE')
      .get(mapped.tenantName)
    const currentName = prop.tenant_brand_id
      ? (db.prepare('SELECT name FROM tenant_brands WHERE id = ?').get(prop.tenant_brand_id)?.name || null)
      : null
    tenant = {
      name: mapped.tenantName,
      existingId: existing?.id || null,
      isNew: !existing,
      current: currentName,
    }
  }

  res.json({ docType, fields, tenant })
})

// PATCH /:propertyId/apply-extracted  body: { fields: {col: value}, tenantName? }
// Writes only whitelisted columns. If tenantName is provided, finds or creates
// the matching tenant brand and links it via tenant_brand_id.
router.patch('/:propertyId/apply-extracted', (req, res) => {
  const prop = db.prepare('SELECT id FROM properties WHERE id = ?').get(req.params.propertyId)
  if (!prop) return res.status(404).json({ error: 'Property not found' })

  const incoming = req.body?.fields || {}
  const tenantName = String(req.body?.tenantName ?? '').trim()

  const sets = []
  const vals = []
  for (const [col, value] of Object.entries(incoming)) {
    if (!WHITELIST.has(col)) continue
    sets.push(`${col} = ?`)
    vals.push(value === '' ? null : value)
  }

  let tenant_brand_id = null
  if (tenantName) {
    const existing = db.prepare('SELECT id FROM tenant_brands WHERE name = ? COLLATE NOCASE').get(tenantName)
    tenant_brand_id = existing
      ? existing.id
      : db.prepare('INSERT INTO tenant_brands (name) VALUES (?)').run(tenantName).lastInsertRowid
    sets.push('tenant_brand_id = ?')
    vals.push(tenant_brand_id)
  }

  if (!sets.length) return res.status(400).json({ error: 'No fields to apply' })

  vals.push(prop.id)
  db.prepare(`UPDATE properties SET ${sets.join(', ')} WHERE id = ?`).run(...vals)
  res.json({ ok: true, applied: sets.length, tenant_brand_id })
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
      // Sender comes from the app-wide setting (Settings → Outbound Email),
      // unless a per-purpose override is set via env.
      from: process.env.INSURANCE_FROM || undefined,
      replyTo: process.env.INSURANCE_REPLY_TO || undefined,
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

// ── Reimbursements (tenant expense recovery — dollar-based tracker) ────────────
// Derive the workflow status from the dollar amounts so the UI and dashboard
// never disagree with the data. An explicit 'waived' is preserved; everything
// else is computed from recovery_method + billed/received amounts.
function computeReimbursementStatus(r) {
  if (r.status === 'waived') return 'waived'
  if (r.recovery_method === 'tenant_direct') return 'tenant_direct'
  const recoverable = r.recoverable_amount != null ? Number(r.recoverable_amount) : null
  const received    = r.received_amount    != null ? Number(r.received_amount)    : 0
  const billed      = r.billed_amount      != null ? Number(r.billed_amount)      : 0
  if (received > 0 && recoverable != null && received >= recoverable - 0.005) return 'received'
  if (received > 0) return 'partial'
  if (billed > 0 || r.billed_date) return 'billed'
  return 'not_billed'
}

function reimbNum(v) { return v != null && v !== '' ? parseFloat(v) : null }

// Auto-create a reimbursement row for a just-paid tax/insurance expense.
// The unique partial index on (source_type, source_id) makes this idempotent, so
// re-marking a paid expense won't create duplicates. Returns silently on any error
// so it can never block the underlying tax/insurance save.
function ensureReimbursementForSource({ propertyId, sourceType, sourceId, year, expenseAmount }) {
  try {
    const existing = db.prepare(
      'SELECT id FROM property_reimbursements WHERE source_type = ? AND source_id = ?'
    ).get(sourceType, sourceId)
    if (existing) return
    const amount = expenseAmount != null ? Number(expenseAmount) : null
    db.prepare(`
      INSERT INTO property_reimbursements
        (property_id, expense_type, year, source_type, source_id,
         expense_amount, recoverable_amount, recovery_method, status)
      VALUES (?,?,?,?,?,?,?, 'landlord_bills', 'not_billed')
    `).run(propertyId, sourceType, year, sourceType, sourceId, amount, amount)
  } catch (e) {
    console.warn('[management] ensureReimbursementForSource skipped:', e.message)
  }
}

// Remove a source-linked reimbursement when the expense is un-paid — but only if
// it's still untouched (not_billed), so we never wipe billing/receipt history.
function removeUntouchedReimbursement(sourceType, sourceId) {
  try {
    db.prepare(`
      DELETE FROM property_reimbursements
      WHERE source_type = ? AND source_id = ? AND status = 'not_billed'
    `).run(sourceType, sourceId)
  } catch (e) {
    console.warn('[management] removeUntouchedReimbursement skipped:', e.message)
  }
}

// GET /reimbursements — all reimbursements across portfolio, with optional
// ?year= / ?status= / ?type= filters. Defined before /:propertyId/* routes.
router.get('/reimbursements', (req, res) => {
  const { year, status, type } = req.query
  const where = ['p.is_portfolio = 1', NOT_SOLD]
  const args  = []
  if (year)   { where.push('r.year = ?');         args.push(parseInt(year, 10)) }
  if (status) { where.push('r.status = ?');        args.push(status) }
  if (type)   { where.push('r.expense_type = ?');  args.push(type) }
  const rows = db.prepare(`
    SELECT r.*,
           p.address    AS property_address,
           p.city       AS property_city,
           p.state      AS property_state,
           t.name       AS tenant_brand_name
    FROM property_reimbursements r
    JOIN properties p ON p.id = r.property_id
    LEFT JOIN tenant_brands t ON t.id = p.tenant_brand_id
    WHERE ${where.join(' AND ')}
    ORDER BY r.year DESC, p.address ASC, r.expense_type ASC
  `).all(...args)
  res.json(rows)
})

// GET /reimbursements/summary — outstanding dollar totals for the dashboard cards.
// Portfolio-wide "awaiting reimbursement" totals per expense type. Computed with
// the same net logic as the per-property dashboard (actual-to-date minus what
// the tenant has paid in via installments), aggregated across all portfolio
// properties. This covers CAM — which never writes to property_reimbursements —
// and keeps all three widgets consistent, truly-net numbers.
router.get('/reimbursements/summary', (req, res) => {
  const now = new Date()
  const curYear = now.getFullYear()
  const throughMonth = now.getMonth() + 1
  const acc = { tax: { count: 0, outstanding: 0 }, insurance: { count: 0, outstanding: 0 }, cam: { count: 0, outstanding: 0 } }

  const properties = db.prepare(`SELECT id FROM properties WHERE is_portfolio = 1 AND ${NOT_SOLD_NOALIAS}`).all()
  for (const p of properties) {
    const settingsRows = db.prepare('SELECT expense_type, method FROM property_expense_settings WHERE property_id = ?').all(p.id)
    const methodOf = Object.fromEntries(settingsRows.map(s => [s.expense_type, s.method]))
    const reimbRows = db.prepare('SELECT expense_type, status FROM property_expense_reimbursements WHERE property_id = ? AND year = ?').all(p.id, curYear)
    const reimbOf = Object.fromEntries(reimbRows.map(r => [r.expense_type, r]))

    for (const type of EXPENSE_TYPES) {
      if (reimbOf[type]?.status === 'reimbursed') continue   // already settled for the year
      const method = methodOf[type] === 'installments' ? 'installments' : 'direct'
      const actual = actualToDate(p.id, type, curYear, throughMonth)
      const collected = method === 'installments' ? collectedToDate(p.id, type, curYear, throughMonth) : 0
      const net = actual - collected
      if (net > 0) { acc[type].count += 1; acc[type].outstanding += net }
    }
  }
  res.json(acc)
})

router.get('/:propertyId/reimbursements', (req, res) => {
  res.json(db.prepare(
    'SELECT * FROM property_reimbursements WHERE property_id = ? ORDER BY year DESC, expense_type'
  ).all(req.params.propertyId))
})

router.post('/:propertyId/reimbursements', (req, res) => {
  const f = req.body
  if (!f.expense_type) return res.status(400).json({ error: 'expense_type is required' })
  if (!f.year)         return res.status(400).json({ error: 'year is required' })

  const draft = {
    recovery_method:    f.recovery_method === 'tenant_direct' ? 'tenant_direct' : 'landlord_bills',
    recoverable_amount: reimbNum(f.recoverable_amount ?? f.expense_amount),
    billed_amount:      reimbNum(f.billed_amount),
    billed_date:        f.billed_date || null,
    received_amount:    reimbNum(f.received_amount),
    status:             f.status === 'waived' ? 'waived' : null,
  }
  const status = computeReimbursementStatus(draft)

  const r = db.prepare(`
    INSERT INTO property_reimbursements
      (property_id, expense_type, year, source_type, source_id,
       expense_amount, recoverable_amount, recovery_method,
       billed_amount, billed_date, received_amount, received_date, status, notes)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)
  `).run(
    req.params.propertyId,
    f.expense_type,
    parseInt(f.year, 10),
    f.source_type || null,
    f.source_id != null ? parseInt(f.source_id, 10) : null,
    reimbNum(f.expense_amount),
    draft.recoverable_amount,
    draft.recovery_method,
    draft.billed_amount,
    draft.billed_date,
    draft.received_amount,
    f.received_date || null,
    status,
    f.notes || null
  )
  res.status(201).json(db.prepare('SELECT * FROM property_reimbursements WHERE id = ?').get(r.lastInsertRowid))
})

router.put('/reimbursements/:id', (req, res) => {
  const existing = db.prepare('SELECT * FROM property_reimbursements WHERE id = ?').get(req.params.id)
  if (!existing) return res.status(404).json({ error: 'Reimbursement not found' })
  const f = req.body

  const merged = {
    expense_type:       f.expense_type       ?? existing.expense_type,
    year:               f.year != null ? parseInt(f.year, 10) : existing.year,
    expense_amount:     f.expense_amount     !== undefined ? reimbNum(f.expense_amount)     : existing.expense_amount,
    recoverable_amount: f.recoverable_amount !== undefined ? reimbNum(f.recoverable_amount) : existing.recoverable_amount,
    recovery_method:    f.recovery_method    ?? existing.recovery_method,
    billed_amount:      f.billed_amount      !== undefined ? reimbNum(f.billed_amount)      : existing.billed_amount,
    billed_date:        f.billed_date        !== undefined ? (f.billed_date || null)        : existing.billed_date,
    received_amount:    f.received_amount    !== undefined ? reimbNum(f.received_amount)    : existing.received_amount,
    received_date:      f.received_date      !== undefined ? (f.received_date || null)      : existing.received_date,
    notes:              f.notes              !== undefined ? (f.notes || null)              : existing.notes,
  }
  // Preserve a prior 'waived' unless the client sends an explicit non-waived status.
  let waived = existing.status === 'waived'
  if (f.status === 'waived') waived = true
  else if (f.status !== undefined) waived = false
  merged.status = waived ? 'waived' : null
  merged.status = computeReimbursementStatus(merged)

  db.prepare(`
    UPDATE property_reimbursements SET
      expense_type=?, year=?, expense_amount=?, recoverable_amount=?, recovery_method=?,
      billed_amount=?, billed_date=?, received_amount=?, received_date=?, status=?, notes=?,
      updated_at=datetime('now')
    WHERE id=?
  `).run(
    merged.expense_type, merged.year, merged.expense_amount, merged.recoverable_amount,
    merged.recovery_method, merged.billed_amount, merged.billed_date,
    merged.received_amount, merged.received_date, merged.status, merged.notes,
    req.params.id
  )
  res.json(db.prepare('SELECT * FROM property_reimbursements WHERE id = ?').get(req.params.id))
})

// PATCH /reimbursements/:id/bill — record that the tenant was invoiced.
router.patch('/reimbursements/:id/bill', (req, res) => {
  const existing = db.prepare('SELECT * FROM property_reimbursements WHERE id = ?').get(req.params.id)
  if (!existing) return res.status(404).json({ error: 'Reimbursement not found' })
  const billedAmount = req.body.billed_amount !== undefined
    ? reimbNum(req.body.billed_amount)
    : (existing.recoverable_amount ?? existing.expense_amount)
  const billedDate = req.body.billed_date || today()
  const merged = { ...existing, billed_amount: billedAmount, billed_date: billedDate, status: null }
  const status = computeReimbursementStatus(merged)
  db.prepare(`UPDATE property_reimbursements SET billed_amount=?, billed_date=?, status=?, updated_at=datetime('now') WHERE id=?`)
    .run(billedAmount, billedDate, status, req.params.id)
  res.json(db.prepare('SELECT * FROM property_reimbursements WHERE id = ?').get(req.params.id))
})

// PATCH /reimbursements/:id/receive — record tenant payment received.
router.patch('/reimbursements/:id/receive', (req, res) => {
  const existing = db.prepare('SELECT * FROM property_reimbursements WHERE id = ?').get(req.params.id)
  if (!existing) return res.status(404).json({ error: 'Reimbursement not found' })
  const receivedAmount = req.body.received_amount !== undefined
    ? reimbNum(req.body.received_amount)
    : (existing.recoverable_amount ?? existing.billed_amount)
  const receivedDate = req.body.received_date || today()
  const merged = { ...existing, received_amount: receivedAmount, received_date: receivedDate, status: null }
  const status = computeReimbursementStatus(merged)
  db.prepare(`UPDATE property_reimbursements SET received_amount=?, received_date=?, status=?, updated_at=datetime('now') WHERE id=?`)
    .run(receivedAmount, receivedDate, status, req.params.id)
  res.json(db.prepare('SELECT * FROM property_reimbursements WHERE id = ?').get(req.params.id))
})

router.delete('/reimbursements/:id', (req, res) => {
  db.prepare('DELETE FROM property_reimbursements WHERE id = ?').run(req.params.id)
  res.status(204).end()
})

// ── Reimbursement methods, installments ledger & year-end reconciliation ───────
// Installment tenants remit a monthly estimate all year; at year-end we compare
// the actual recoverable cost against what was collected and post a true-up into
// the reimbursement tracker. 'direct' tenants skip all of this (they just get the
// paid bill invoiced via the existing reimbursement flow).
const EXPENSE_TYPES = ['tax', 'insurance', 'cam']

// Sum of installments collected for a property · expense_type · year.
function collectedTotal(propertyId, expenseType, year) {
  const row = db.prepare(`
    SELECT COALESCE(SUM(amount), 0) AS total
    FROM property_installments
    WHERE property_id = ? AND expense_type = ? AND year = ?
  `).get(propertyId, expenseType, year)
  return row ? Number(row.total) : 0
}

// Suggested "actual recoverable" for a reconciliation, pulled from the paid
// expense records already on file — the starting number the user confirms or
// caps down. Returns null when there's nothing paid to base it on.
//   insurance → sum of paid policy premiums whose coverage year matches
//   tax       → sum of paid tax bills for that tax_year (paid_amount, else amount)
//   cam       → null (CAM has no expense source yet)
// True when a property's taxes are paid in arrears (the bill labeled tax_year
// Y-1 is the one paid/recovered during year Y).
function taxIsArrears(propertyId) {
  const row = db.prepare(
    `SELECT tax_arrears FROM property_expense_settings WHERE property_id = ? AND expense_type = 'tax'`
  ).get(propertyId)
  return !!(row && row.tax_arrears)
}

// The tax_year whose bill applies when reconciling/viewing `year` for a property.
function taxYearFor(propertyId, year) {
  return taxIsArrears(propertyId) ? year - 1 : year
}

function suggestedRecoverable(propertyId, expenseType, year) {
  if (expenseType === 'insurance') {
    const rows = db.prepare(
      `SELECT premium, effective_date, paid_date FROM property_insurance
       WHERE property_id = ? AND paid_status = 'paid'`
    ).all(propertyId)
    let sum = 0, found = false
    for (const r of rows) {
      const src = /^\d{4}/.test(r.effective_date || '') ? r.effective_date
                : /^\d{4}/.test(r.paid_date || '')      ? r.paid_date : null
      const y = src ? parseInt(src.slice(0, 4), 10) : null
      if (y === year && r.premium != null) { sum += Number(r.premium); found = true }
    }
    return found ? sum : null
  }
  if (expenseType === 'tax') {
    const rows = db.prepare(
      `SELECT paid_amount, amount FROM property_taxes
       WHERE property_id = ? AND tax_year = ? AND paid_date IS NOT NULL`
    ).all(propertyId, taxYearFor(propertyId, year))
    let sum = 0, found = false
    for (const r of rows) {
      const amt = r.paid_amount != null ? Number(r.paid_amount)
                : r.amount != null ? Number(r.amount) : null
      if (amt != null) { sum += amt; found = true }
    }
    return found ? sum : null
  }
  if (expenseType === 'cam') {
    // CAM's actual is the sum of vendor invoices dated in the year.
    const total = camActualToDate(propertyId, year, 12)
    return total > 0 ? total : null
  }
  return null
}

// The calendar month (1-12) an actual expense record belongs to, from its most
// relevant date. Returns null if no parseable date.
function monthOf(dateStr) {
  if (!/^\d{4}-\d{2}/.test(dateStr || '')) return null
  return parseInt(dateStr.slice(5, 7), 10)
}

// Sum of CAM invoices for a property·year, counting only those dated on or
// before `throughMonth` (1-12). invoice_date drives the year/month; paid_date is
// the fallback. Pass throughMonth=12 for the full-year total.
function camActualToDate(propertyId, year, throughMonth) {
  const rows = db.prepare(
    `SELECT amount, invoice_date, paid_date FROM property_cam_invoices WHERE property_id = ?`
  ).all(propertyId)
  let sum = 0
  for (const r of rows) {
    const src = /^\d{4}/.test(r.invoice_date || '') ? r.invoice_date
              : /^\d{4}/.test(r.paid_date || '')    ? r.paid_date : null
    if (!src) continue
    if (parseInt(src.slice(0, 4), 10) !== year) continue
    const m = monthOf(src)
    if (m != null && m > throughMonth) continue
    sum += Number(r.amount) || 0
  }
  return sum
}

// "Actual recoverable to date" for a property·expense_type·year, counting only
// records dated on or before `throughMonth`. This is the real cost incurred so
// far — it jumps when a bill/premium/invoice is actually recorded, rather than
// accruing smoothly. Returns 0 when nothing is on file yet.
function actualToDate(propertyId, expenseType, year, throughMonth) {
  if (expenseType === 'insurance') {
    const rows = db.prepare(
      `SELECT premium, effective_date, paid_date FROM property_insurance
       WHERE property_id = ? AND paid_status = 'paid'`
    ).all(propertyId)
    let sum = 0
    for (const r of rows) {
      const src = /^\d{4}/.test(r.paid_date || '')      ? r.paid_date
                : /^\d{4}/.test(r.effective_date || '') ? r.effective_date : null
      if (!src) continue
      if (parseInt(src.slice(0, 4), 10) !== year) continue
      const m = monthOf(src)
      if (m != null && m > throughMonth) continue
      if (r.premium != null) sum += Number(r.premium)
    }
    return sum
  }
  if (expenseType === 'tax') {
    // Count a single payment, gated by month only within the viewing year; a
    // payment made in an earlier calendar year has already happened (counts in
    // full); one dated to a future year hasn't.
    const countPayment = (amt, paidDate) => {
      if (!/^\d{4}/.test(paidDate || '')) return 0
      const py = parseInt(paidDate.slice(0, 4), 10)
      if (py === year) { const m = monthOf(paidDate); if (m != null && m > throughMonth) return 0 }
      else if (py > year) return 0
      return Number(amt) || 0
    }
    const recs = db.prepare(
      `SELECT id, paid_amount, amount, paid_date FROM property_taxes WHERE property_id = ? AND tax_year = ?`
    ).all(propertyId, taxYearFor(propertyId, year))
    let sum = 0
    for (const r of recs) {
      // Prefer per-installment dates (1st half / 2nd half) so each payment is
      // gated by when it was actually made; fall back to the record's paid_date.
      const insts = db.prepare(`SELECT amount, paid_date FROM tax_installments WHERE tax_id = ?`).all(r.id)
      if (insts.length) {
        for (const it of insts) sum += countPayment(it.amount, it.paid_date)
      } else if (r.paid_date) {
        const amt = r.paid_amount != null ? r.paid_amount : (r.amount != null ? r.amount : 0)
        sum += countPayment(amt, r.paid_date)
      }
    }
    return sum
  }
  if (expenseType === 'cam') return camActualToDate(propertyId, year, throughMonth)
  return 0
}

// Sum of installments collected for a property·expense_type·year, counting only
// months 1..throughMonth (so future flat-filled months don't inflate the
// running "collected so far" figure the dashboard nets against).
function collectedToDate(propertyId, expenseType, year, throughMonth) {
  const row = db.prepare(`
    SELECT COALESCE(SUM(amount), 0) AS total
    FROM property_installments
    WHERE property_id = ? AND expense_type = ? AND year = ? AND month <= ?
  `).get(propertyId, expenseType, year, throughMonth)
  return row ? Number(row.total) : 0
}

// GET /:propertyId/expense-settings — all three expense types, defaulted to
// 'direct' when no row exists yet so the UI always has a full set to render.
router.get('/:propertyId/expense-settings', (req, res) => {
  const saved = db.prepare(
    'SELECT * FROM property_expense_settings WHERE property_id = ?'
  ).all(req.params.propertyId)
  const byType = Object.fromEntries(saved.map(s => [s.expense_type, s]))
  res.json(EXPENSE_TYPES.map(t => byType[t] || {
    property_id: parseInt(req.params.propertyId, 10),
    expense_type: t, method: 'direct', monthly_estimate: null,
    annual_budget: null, notes: null, tax_arrears: 0,
  }))
})

// PUT /:propertyId/expense-settings/:type — upsert one expense type's method.
router.put('/:propertyId/expense-settings/:type', (req, res) => {
  const { propertyId, type } = req.params
  if (!EXPENSE_TYPES.includes(type)) return res.status(400).json({ error: 'invalid expense type' })
  const f = req.body
  const method = f.method === 'installments' ? 'installments' : 'direct'
  const taxArrears = f.tax_arrears ? 1 : 0
  db.prepare(`
    INSERT INTO property_expense_settings
      (property_id, expense_type, method, monthly_estimate, annual_budget, notes, tax_arrears)
    VALUES (?,?,?,?,?,?,?)
    ON CONFLICT(property_id, expense_type) DO UPDATE SET
      method=excluded.method, monthly_estimate=excluded.monthly_estimate,
      annual_budget=excluded.annual_budget, notes=excluded.notes,
      tax_arrears=excluded.tax_arrears, updated_at=datetime('now')
  `).run(propertyId, type, method, reimbNum(f.monthly_estimate), reimbNum(f.annual_budget), f.notes || null, taxArrears)
  res.json(db.prepare(
    'SELECT * FROM property_expense_settings WHERE property_id = ? AND expense_type = ?'
  ).get(propertyId, type))
})

// GET /:propertyId/installments?year=&type= — monthly ledger rows.
router.get('/:propertyId/installments', (req, res) => {
  const where = ['property_id = ?']
  const args  = [req.params.propertyId]
  if (req.query.year) { where.push('year = ?');         args.push(parseInt(req.query.year, 10)) }
  if (req.query.type) { where.push('expense_type = ?'); args.push(req.query.type) }
  res.json(db.prepare(
    `SELECT * FROM property_installments WHERE ${where.join(' AND ')} ORDER BY year DESC, expense_type, month`
  ).all(...args))
})

// PUT /:propertyId/installments — upsert one month's cell. Amount 0 keeps the row
// (an explicit "nothing collected"); use DELETE to clear a cell entirely.
router.put('/:propertyId/installments', (req, res) => {
  const f = req.body
  if (!EXPENSE_TYPES.includes(f.expense_type)) return res.status(400).json({ error: 'invalid expense type' })
  const year  = parseInt(f.year, 10)
  const month = parseInt(f.month, 10)
  if (!year)                 return res.status(400).json({ error: 'year is required' })
  if (!(month >= 1 && month <= 12)) return res.status(400).json({ error: 'month must be 1-12' })
  const source = ['manual', 'email', 'plaid'].includes(f.source) ? f.source : 'manual'
  db.prepare(`
    INSERT INTO property_installments
      (property_id, expense_type, year, month, amount, paid_date, source, remittance_ref, notes)
    VALUES (?,?,?,?,?,?,?,?,?)
    ON CONFLICT(property_id, expense_type, year, month) DO UPDATE SET
      amount=excluded.amount, paid_date=excluded.paid_date, source=excluded.source,
      remittance_ref=excluded.remittance_ref, notes=excluded.notes, updated_at=datetime('now')
  `).run(
    req.params.propertyId, f.expense_type, year, month,
    reimbNum(f.amount) ?? 0, f.paid_date || null, source,
    f.remittance_ref || null, f.notes || null
  )
  res.json(db.prepare(
    'SELECT * FROM property_installments WHERE property_id = ? AND expense_type = ? AND year = ? AND month = ?'
  ).get(req.params.propertyId, f.expense_type, year, month))
})

router.delete('/installments/:id', (req, res) => {
  db.prepare('DELETE FROM property_installments WHERE id = ?').run(req.params.id)
  res.status(204).end()
})

// PUT /:propertyId/installments/fill — bulk-fill the 12 monthly cells from a flat
// rate (tenants pay the same amount all year). mode='empty' only fills months with
// no row yet (safe auto-fill on rate entry); mode='all' overwrites every manual
// cell. Rows the email/plaid importer created are never touched.
router.put('/:propertyId/installments/fill', (req, res) => {
  const f = req.body
  if (!EXPENSE_TYPES.includes(f.expense_type)) return res.status(400).json({ error: 'invalid expense type' })
  const year   = parseInt(f.year, 10)
  const amount = reimbNum(f.amount)
  const mode   = f.mode === 'all' ? 'all' : 'empty'
  if (!year)          return res.status(400).json({ error: 'year is required' })
  if (amount == null) return res.status(400).json({ error: 'amount is required' })

  const fill = db.transaction(() => {
    const existing = db.prepare(
      'SELECT month, source FROM property_installments WHERE property_id = ? AND expense_type = ? AND year = ?'
    ).all(req.params.propertyId, f.expense_type, year)
    const byMonth = Object.fromEntries(existing.map(r => [r.month, r.source]))
    for (let m = 1; m <= 12; m++) {
      const src = byMonth[m]
      if (src === 'email' || src === 'plaid') continue   // never clobber imported rows
      if (mode === 'empty' && src !== undefined) continue // only fill blanks
      db.prepare(`
        INSERT INTO property_installments (property_id, expense_type, year, month, amount, source)
        VALUES (?,?,?,?,?, 'manual')
        ON CONFLICT(property_id, expense_type, year, month) DO UPDATE SET
          amount=excluded.amount, source='manual', updated_at=datetime('now')
      `).run(req.params.propertyId, f.expense_type, year, m, amount)
    }
  })
  fill()

  res.json(db.prepare(
    'SELECT * FROM property_installments WHERE property_id = ? AND expense_type = ? AND year = ? ORDER BY month'
  ).all(req.params.propertyId, f.expense_type, year))
})

// GET /:propertyId/reconciliation-suggestions?year= — suggested actual-recoverable
// per expense type from paid records, so the UI can prefill (still editable for caps).
router.get('/:propertyId/reconciliation-suggestions', (req, res) => {
  const year = parseInt(req.query.year, 10) || new Date().getFullYear()
  res.json({
    tax:       suggestedRecoverable(req.params.propertyId, 'tax', year),
    insurance: suggestedRecoverable(req.params.propertyId, 'insurance', year),
    cam:       suggestedRecoverable(req.params.propertyId, 'cam', year),
  })
})

// GET /:propertyId/reconciliations?year= — saved reconciliations, each refreshed
// with the live collected total so drafts stay accurate as installments change.
router.get('/:propertyId/reconciliations', (req, res) => {
  const where = ['property_id = ?']
  const args  = [req.params.propertyId]
  if (req.query.year) { where.push('year = ?'); args.push(parseInt(req.query.year, 10)) }
  const rows = db.prepare(
    `SELECT * FROM property_reconciliations WHERE ${where.join(' AND ')} ORDER BY year DESC, expense_type`
  ).all(...args)
  for (const r of rows) {
    if (r.status !== 'posted') {
      r.total_collected = collectedTotal(r.property_id, r.expense_type, r.year)
      r.true_up_amount  = r.actual_recoverable != null ? Number(r.actual_recoverable) - r.total_collected : null
    }
  }
  res.json(rows)
})

// PUT /:propertyId/reconciliations — upsert a DRAFT (property·type·year). Snapshots
// the live collected total and recomputes the true-up. Posting is a separate step.
router.put('/:propertyId/reconciliations', (req, res) => {
  const f = req.body
  if (!EXPENSE_TYPES.includes(f.expense_type)) return res.status(400).json({ error: 'invalid expense type' })
  const year = parseInt(f.year, 10)
  if (!year) return res.status(400).json({ error: 'year is required' })

  const existing = db.prepare(
    'SELECT * FROM property_reconciliations WHERE property_id = ? AND expense_type = ? AND year = ?'
  ).get(req.params.propertyId, f.expense_type, year)
  if (existing && existing.status === 'posted') {
    return res.status(409).json({ error: 'Reconciliation already posted — unpost to edit' })
  }

  const actual    = reimbNum(f.actual_recoverable)
  const collected = collectedTotal(req.params.propertyId, f.expense_type, year)
  const trueUp    = actual != null ? actual - collected : null

  db.prepare(`
    INSERT INTO property_reconciliations
      (property_id, expense_type, year, actual_recoverable, total_collected, true_up_amount, status, notes)
    VALUES (?,?,?,?,?,?, 'draft', ?)
    ON CONFLICT(property_id, expense_type, year) DO UPDATE SET
      actual_recoverable=excluded.actual_recoverable, total_collected=excluded.total_collected,
      true_up_amount=excluded.true_up_amount, notes=excluded.notes, updated_at=datetime('now')
  `).run(req.params.propertyId, f.expense_type, year, actual, collected, trueUp, f.notes || null)

  res.json(db.prepare(
    'SELECT * FROM property_reconciliations WHERE property_id = ? AND expense_type = ? AND year = ?'
  ).get(req.params.propertyId, f.expense_type, year))
})

// POST /reconciliations/:id/post — freeze the true-up and push it into the
// reimbursement tracker. A positive true-up (tenant owes) creates a landlord_bills
// reimbursement linked back via reconciliation_id; a credit is recorded only.
router.post('/reconciliations/:id/post', (req, res) => {
  const recon = db.prepare('SELECT * FROM property_reconciliations WHERE id = ?').get(req.params.id)
  if (!recon) return res.status(404).json({ error: 'Reconciliation not found' })
  if (recon.status === 'posted') return res.status(409).json({ error: 'Already posted' })
  if (recon.actual_recoverable == null) return res.status(400).json({ error: 'Enter the actual recoverable amount before posting' })

  const collected = collectedTotal(recon.property_id, recon.expense_type, recon.year)
  const trueUp    = Number(recon.actual_recoverable) - collected

  const post = db.transaction(() => {
    let reimbursementId = null
    if (trueUp > 0.005) {
      const draft = {
        recovery_method: 'landlord_bills',
        recoverable_amount: trueUp,
        billed_amount: null, received_amount: null, status: null,
      }
      const status = computeReimbursementStatus(draft)
      const r = db.prepare(`
        INSERT INTO property_reimbursements
          (property_id, expense_type, year, source_type, source_id,
           expense_amount, recoverable_amount, recovery_method, status, notes, reconciliation_id)
        VALUES (?,?,?, NULL, NULL, ?, ?, 'landlord_bills', ?, ?, ?)
      `).run(
        recon.property_id, recon.expense_type, recon.year,
        recon.actual_recoverable, trueUp, status,
        `Year-end ${recon.year} ${recon.expense_type} reconciliation true-up`,
        recon.id
      )
      reimbursementId = r.lastInsertRowid
    }
    db.prepare(`
      UPDATE property_reconciliations SET
        total_collected=?, true_up_amount=?, status='posted',
        reimbursement_id=?, posted_at=datetime('now'), updated_at=datetime('now')
      WHERE id=?
    `).run(collected, trueUp, reimbursementId, recon.id)
    return reimbursementId
  })
  const reimbursementId = post()

  res.json({
    reconciliation: db.prepare('SELECT * FROM property_reconciliations WHERE id = ?').get(recon.id),
    reimbursement: reimbursementId
      ? db.prepare('SELECT * FROM property_reimbursements WHERE id = ?').get(reimbursementId)
      : null,
  })
})

// POST /reconciliations/:id/unpost — revert to draft. Removes the linked
// reimbursement only if it's still untouched (not_billed), mirroring un-pay.
router.post('/reconciliations/:id/unpost', (req, res) => {
  const recon = db.prepare('SELECT * FROM property_reconciliations WHERE id = ?').get(req.params.id)
  if (!recon) return res.status(404).json({ error: 'Reconciliation not found' })
  if (recon.status !== 'posted') return res.status(409).json({ error: 'Not posted' })

  const unpost = db.transaction(() => {
    if (recon.reimbursement_id) {
      db.prepare(
        `DELETE FROM property_reimbursements WHERE id = ? AND status = 'not_billed'`
      ).run(recon.reimbursement_id)
    }
    db.prepare(`
      UPDATE property_reconciliations SET status='draft', reimbursement_id=NULL,
        posted_at=NULL, updated_at=datetime('now') WHERE id=?
    `).run(recon.id)
  })
  unpost()
  res.json(db.prepare('SELECT * FROM property_reconciliations WHERE id = ?').get(recon.id))
})

router.delete('/reconciliations/:id', (req, res) => {
  const recon = db.prepare('SELECT * FROM property_reconciliations WHERE id = ?').get(req.params.id)
  if (recon && recon.status === 'posted' && recon.reimbursement_id) {
    db.prepare(`DELETE FROM property_reimbursements WHERE id = ? AND status = 'not_billed'`)
      .run(recon.reimbursement_id)
  }
  db.prepare('DELETE FROM property_reconciliations WHERE id = ?').run(req.params.id)
  res.status(204).end()
})

// ── CAM invoices (property-work costs that roll up into CAM actuals) ───────────
const CAM_DOCS_DIR = join(DATA_DIR, 'cam-invoices')

// List invoices for a property, newest first. Optional ?year= filters by the
// invoice_date (falling back to paid_date) calendar year.
router.get('/:propertyId/cam-invoices', (req, res) => {
  const rows = db.prepare(
    `SELECT id, vendor, description, amount, invoice_date, paid_date, file_name, mime, notes, created_at
     FROM property_cam_invoices WHERE property_id = ?
     ORDER BY (invoice_date IS NULL), invoice_date DESC, id DESC`
  ).all(req.params.propertyId)
  const year = req.query.year ? parseInt(req.query.year, 10) : null
  const filtered = year
    ? rows.filter(r => {
        const src = /^\d{4}/.test(r.invoice_date || '') ? r.invoice_date
                  : /^\d{4}/.test(r.paid_date || '')    ? r.paid_date : null
        return src && parseInt(src.slice(0, 4), 10) === year
      })
    : rows
  const total = filtered.reduce((a, r) => a + (Number(r.amount) || 0), 0)
  res.json({ invoices: filtered, total })
})

router.post('/:propertyId/cam-invoices', (req, res) => {
  const prop = db.prepare('SELECT id FROM properties WHERE id = ?').get(req.params.propertyId)
  if (!prop) return res.status(404).json({ error: 'Property not found' })
  const b = req.body || {}
  const amount = reimbNum(b.amount)
  if (amount == null) return res.status(400).json({ error: 'amount is required' })
  const info = db.prepare(
    `INSERT INTO property_cam_invoices (property_id, vendor, description, amount, invoice_date, paid_date, notes)
     VALUES (?,?,?,?,?,?,?)`
  ).run(prop.id, b.vendor || null, b.description || null, amount, b.invoice_date || null, b.paid_date || null, b.notes || null)
  res.json(db.prepare('SELECT * FROM property_cam_invoices WHERE id = ?').get(info.lastInsertRowid))
})

// Upload an invoice file and create the row in one step. Amount/vendor/date come
// as multipart form fields alongside the file.
router.post('/:propertyId/cam-invoices/upload', upload.single('file'), (req, res) => {
  const prop = db.prepare('SELECT id FROM properties WHERE id = ?').get(req.params.propertyId)
  if (!prop) return res.status(404).json({ error: 'Property not found' })
  const b = req.body || {}
  const amount = reimbNum(b.amount)
  if (amount == null) return res.status(400).json({ error: 'amount is required' })
  let file_name = null, file_path = null, mime = null
  if (req.file) {
    const dir = join(CAM_DOCS_DIR, String(prop.id))
    try { mkdirSync(dir, { recursive: true }) } catch (_) {}
    const safe  = (req.file.originalname || 'invoice').replace(/[^\w.\-]+/g, '_')
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
    file_path = join(dir, `${stamp}-${safe}`)
    try { writeFileSync(file_path, req.file.buffer) } catch (e) { return res.status(500).json({ error: e.message }) }
    file_name = req.file.originalname || safe
    mime = req.file.mimetype || null
  }
  const info = db.prepare(
    `INSERT INTO property_cam_invoices (property_id, vendor, description, amount, invoice_date, paid_date, file_name, file_path, mime, notes)
     VALUES (?,?,?,?,?,?,?,?,?,?)`
  ).run(prop.id, b.vendor || null, b.description || null, amount, b.invoice_date || null, b.paid_date || null, file_name, file_path, mime, b.notes || null)
  res.json(db.prepare('SELECT * FROM property_cam_invoices WHERE id = ?').get(info.lastInsertRowid))
})

// POST /:propertyId/cam-invoices/parse — read a CAM/vendor invoice with AI and
// return the fields to prefill the add form. Does NOT save anything; the client
// reviews the values then submits the upload as usual.
router.post('/:propertyId/cam-invoices/parse', upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' })
  const mediaType = req.file.mimetype || 'application/pdf'
  const prompt = `You are extracting key fields from a vendor invoice for property work (Common Area Maintenance — e.g. landscaping, snow removal, parking-lot repair, janitorial, roofing). Return ONLY a valid JSON object with these exact fields — no explanation, no markdown:

{
  "vendor": "",
  "description": "",
  "amount": "",
  "invoice_date": "",
  "paid_date": ""
}

- vendor: the company that issued the invoice (the biller/payee), not the property owner.
- description: a short summary of the work performed (a few words).
- amount: the TOTAL amount due on the invoice, as a plain number with no $ sign or commas (e.g. 1250.00).
- invoice_date: the invoice date in YYYY-MM-DD format. If only a service/period date is present, use that.
- paid_date: the date paid in YYYY-MM-DD format if the invoice is marked paid; otherwise "".
Extract exact values as they appear. Leave a field as "" if it is not present.`

  try {
    let pdfBuffer = req.file.buffer
    if (mediaType === 'application/pdf') {
      const srcDoc = await PDFDocument.load(pdfBuffer)
      const total  = srcDoc.getPageCount()
      if (total > 20) {
        const trimDoc = await PDFDocument.create()
        const pages   = await trimDoc.copyPages(srcDoc, [...Array(20).keys()])
        pages.forEach(p => trimDoc.addPage(p))
        pdfBuffer = Buffer.from(await trimDoc.save())
      }
    }
    const result = await callClaude(pdfBuffer, mediaType, prompt)
    const raw  = result.content[0].text.trim()
    const json = raw.replace(/^```json\s*/i, '').replace(/\s*```$/, '')
    const data = JSON.parse(json)
    // Normalize the amount to a bare number if the model included symbols.
    if (data.amount != null) {
      const n = String(data.amount).replace(/[^0-9.\-]/g, '')
      data.amount = n === '' ? '' : n
    }
    res.json(data)
  } catch (err) {
    console.error('[management] CAM invoice parse error:', err.message)
    res.status(422).json({ error: 'Could not parse invoice: ' + err.message })
  }
})

router.put('/cam-invoices/:id', (req, res) => {
  const inv = db.prepare('SELECT * FROM property_cam_invoices WHERE id = ?').get(req.params.id)
  if (!inv) return res.status(404).json({ error: 'Invoice not found' })
  const b = req.body || {}
  const amount = b.amount !== undefined ? reimbNum(b.amount) : inv.amount
  db.prepare(
    `UPDATE property_cam_invoices SET vendor = ?, description = ?, amount = ?, invoice_date = ?, paid_date = ?, notes = ?, updated_at = datetime('now') WHERE id = ?`
  ).run(
    b.vendor !== undefined ? b.vendor : inv.vendor,
    b.description !== undefined ? b.description : inv.description,
    amount == null ? inv.amount : amount,
    b.invoice_date !== undefined ? b.invoice_date : inv.invoice_date,
    b.paid_date !== undefined ? b.paid_date : inv.paid_date,
    b.notes !== undefined ? b.notes : inv.notes,
    inv.id
  )
  res.json(db.prepare('SELECT * FROM property_cam_invoices WHERE id = ?').get(inv.id))
})

router.get('/cam-invoices/:id/file', (req, res) => {
  const d = db.prepare('SELECT file_name, file_path, mime FROM property_cam_invoices WHERE id = ?').get(req.params.id)
  if (!d || !d.file_path || !existsSync(d.file_path)) return res.status(404).json({ error: 'File not found' })
  res.setHeader('Content-Type', d.mime || 'application/octet-stream')
  res.setHeader('X-Content-Type-Options', 'nosniff')
  res.setHeader('Content-Disposition', `inline; filename="${(d.file_name || 'invoice').replace(/"/g, '')}"`)
  createReadStream(d.file_path).pipe(res)
})

router.delete('/cam-invoices/:id', (req, res) => {
  const d = db.prepare('SELECT file_path FROM property_cam_invoices WHERE id = ?').get(req.params.id)
  if (!d) return res.status(404).json({ error: 'Invoice not found' })
  if (d.file_path) { try { unlink(d.file_path, () => {}) } catch (_) {} }
  db.prepare('DELETE FROM property_cam_invoices WHERE id = ?').run(req.params.id)
  res.status(204).end()
})

// ── Per-type reimbursement status (dashboard net card) ────────────────────────
// PATCH /:propertyId/expense-reimbursement/:type  { year, status }
//   status 'reimbursed' → mark paid back for that type·year
//   status 'limbo'      → still waiting; keep unreimbursed, set next check +30d
// Insurance additionally back-syncs the policy flag + closes its follow-up task
// so Brad's Insurance-tab UI stays consistent with the dashboard.
router.patch('/:propertyId/expense-reimbursement/:type', (req, res) => {
  const type = req.params.type
  if (!EXPENSE_TYPES.includes(type)) return res.status(400).json({ error: 'invalid expense type' })
  const status = req.body?.status
  if (status !== 'reimbursed' && status !== 'limbo') {
    return res.status(400).json({ error: "status must be 'reimbursed' or 'limbo'" })
  }
  const year = parseInt(req.body?.year, 10)
  if (!year) return res.status(400).json({ error: 'year is required' })
  const propId = req.params.propertyId
  const stamp = today()

  const apply = db.transaction(() => {
    if (status === 'reimbursed') {
      db.prepare(
        `INSERT INTO property_expense_reimbursements (property_id, expense_type, year, status, reimbursed_date, next_check)
         VALUES (?,?,?, 'reimbursed', ?, NULL)
         ON CONFLICT(property_id, expense_type, year)
         DO UPDATE SET status='reimbursed', reimbursed_date=excluded.reimbursed_date, next_check=NULL, updated_at=datetime('now')`
      ).run(propId, type, year, stamp)
      if (type === 'insurance') {
        db.prepare(`UPDATE property_insurance SET reimbursed_status = 'reimbursed', reimbursed_date = ? WHERE property_id = ? AND paid_status = 'paid'`).run(stamp, propId)
        db.prepare(`UPDATE property_tasks SET completed_at = datetime('now') WHERE property_id = ? AND completed_at IS NULL AND title = ?`).run(propId, REIMB_CHECK_TITLE)
      } else if (type === 'tax') {
        db.prepare(`UPDATE property_taxes SET reimbursed_status = 'reimbursed', reimbursed_date = ? WHERE property_id = ? AND tax_year = ?`).run(stamp, propId, year)
      }
    } else {
      const next = addDays(stamp, 30)
      db.prepare(
        `INSERT INTO property_expense_reimbursements (property_id, expense_type, year, status, reimbursed_date, next_check)
         VALUES (?,?,?, 'unreimbursed', NULL, ?)
         ON CONFLICT(property_id, expense_type, year)
         DO UPDATE SET status='unreimbursed', reimbursed_date=NULL, next_check=excluded.next_check, updated_at=datetime('now')`
      ).run(propId, type, year, next)
      if (type === 'insurance') {
        db.prepare(`UPDATE property_insurance SET reimbursed_status = 'unreimbursed', reimbursed_date = NULL WHERE property_id = ?`).run(propId)
      } else if (type === 'tax') {
        db.prepare(`UPDATE property_taxes SET reimbursed_status = 'unreimbursed', reimbursed_date = NULL WHERE property_id = ? AND tax_year = ?`).run(propId, year)
      }
    }
  })
  apply()
  res.json(db.prepare('SELECT * FROM property_expense_reimbursements WHERE property_id = ? AND expense_type = ? AND year = ?').get(propId, type, year))
})

export default router
