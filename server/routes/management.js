import { Router } from 'express'
import multer      from 'multer'
import db          from '../db.js'

const router  = Router()
const upload  = multer({ storage: multer.memoryStorage(), limits: { fileSize: 30 * 1024 * 1024 } })

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

// Generate default recurring tasks for a newly added portfolio property
export function seedDefaultTasks(propertyId) {
  const t = today()
  const defaults = [
    {
      title:     'Annual insurance renewal review',
      task_type: 'insurance',
      due_date:  addDays(t, 30),
      recurs:    'annually',
      notes:     'Confirm policy is up to date and premium is competitive.',
    },
    {
      title:     'Annual property tax review',
      task_type: 'tax',
      due_date:  addDays(t, 60),
      recurs:    'annually',
      notes:     'Verify tax bill received and paid on time.',
    },
    {
      title:     'Annual lease review',
      task_type: 'lease',
      due_date:  addDays(t, 90),
      recurs:    'annually',
      notes:     'Review lease terms, rent bumps, and upcoming expirations.',
    },
    {
      title:     'Quarterly property inspection',
      task_type: 'inspection',
      due_date:  addDays(t, 90),
      recurs:    'quarterly',
      notes:     'Walk property, check exterior/roof/parking lot condition.',
    },
  ]
  const stmt = db.prepare(`
    INSERT INTO property_tasks (property_id, title, task_type, due_date, recurs, notes)
    VALUES (?, ?, ?, ?, ?, ?)
  `)
  for (const task of defaults) {
    stmt.run(propertyId, task.title, task.task_type, task.due_date, task.recurs, task.notes)
  }
}

// ── Dashboard ─────────────────────────────────────────────────────────────────

router.get('/dashboard', (req, res) => {
  const todayStr = today()
  const in30     = addDays(todayStr, 30)
  const in90     = addDays(todayStr, 90)

  const portfolioProps = db.prepare(`
    SELECT p.id, p.address, p.city, p.state, t.name AS tenant_brand_name,
           p.lease_end, p.annual_rent, p.purchase_price
    FROM properties p
    LEFT JOIN tenant_brands t ON t.id = p.tenant_brand_id
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

  res.json({
    properties:        portfolioProps,
    tasks_due:         tasksDue,
    overdue_tasks:     overdueTasks,
    insurance_expiring: insuranceExpiring,
    taxes_due:         taxesDue,
    maintenance_spend_ytd: maintenanceSpend?.total || 0,
  })
})

// ── Tasks ─────────────────────────────────────────────────────────────────────

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

router.get('/:propertyId/insurance', (req, res) => {
  res.json(db.prepare('SELECT * FROM property_insurance WHERE property_id = ? ORDER BY effective_date DESC').all(req.params.propertyId))
})

router.post('/:propertyId/insurance', (req, res) => {
  const f = req.body
  const r = db.prepare(`
    INSERT INTO property_insurance
      (property_id, carrier, policy_number, premium, coverage_amount, deductible,
       effective_date, expiry_date, auto_renewal, agent_name, agent_phone, agent_email, notes)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)
  `).run(
    req.params.propertyId,
    f.carrier || null, f.policy_number || null,
    f.premium != null ? parseFloat(f.premium) : null,
    f.coverage_amount != null ? parseFloat(f.coverage_amount) : null,
    f.deductible != null ? parseFloat(f.deductible) : null,
    f.effective_date || null, f.expiry_date || null,
    f.auto_renewal ? 1 : 0,
    f.agent_name || null, f.agent_phone || null, f.agent_email || null, f.notes || null
  )
  // Auto-create a renewal task if expiry_date provided
  if (f.expiry_date) {
    const reminderDate = addDays(f.expiry_date, -60)
    db.prepare(`
      INSERT INTO property_tasks (property_id, title, task_type, due_date, recurs, notes)
      VALUES (?, ?, 'insurance', ?, 'annually', ?)
    `).run(
      req.params.propertyId,
      `Insurance renewal — ${f.carrier || 'policy'} expires ${f.expiry_date}`,
      reminderDate,
      `Policy: ${f.policy_number || 'N/A'} | Carrier: ${f.carrier || 'N/A'}`
    )
  }
  res.status(201).json(db.prepare('SELECT * FROM property_insurance WHERE id = ?').get(r.lastInsertRowid))
})

router.put('/insurance/:id', (req, res) => {
  const f = req.body
  db.prepare(`
    UPDATE property_insurance SET
      carrier=?, policy_number=?, premium=?, coverage_amount=?, deductible=?,
      effective_date=?, expiry_date=?, auto_renewal=?, agent_name=?, agent_phone=?, agent_email=?, notes=?
    WHERE id=?
  `).run(
    f.carrier || null, f.policy_number || null,
    f.premium != null ? parseFloat(f.premium) : null,
    f.coverage_amount != null ? parseFloat(f.coverage_amount) : null,
    f.deductible != null ? parseFloat(f.deductible) : null,
    f.effective_date || null, f.expiry_date || null,
    f.auto_renewal ? 1 : 0,
    f.agent_name || null, f.agent_phone || null, f.agent_email || null, f.notes || null,
    req.params.id
  )
  res.json(db.prepare('SELECT * FROM property_insurance WHERE id = ?').get(req.params.id))
})

router.delete('/insurance/:id', (req, res) => {
  db.prepare('DELETE FROM property_insurance WHERE id = ?').run(req.params.id)
  res.status(204).end()
})

// POST /:propertyId/insurance/upload — parse insurance PDF with AI
router.post('/:propertyId/insurance/upload', upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' })

  const mediaType = req.file.mimetype || 'application/pdf'
  const prompt = `Extract insurance policy information from this document. Return ONLY valid JSON with these fields (use null for any field not found):
{
  "carrier": "insurance company name",
  "policy_number": "policy number",
  "premium": numeric annual premium amount (number, no $ or commas),
  "coverage_amount": numeric total coverage/limit (number),
  "deductible": numeric deductible amount (number),
  "effective_date": "YYYY-MM-DD",
  "expiry_date": "YYYY-MM-DD",
  "agent_name": "agent name",
  "agent_phone": "agent phone",
  "agent_email": "agent email"
}
Return ONLY the JSON object, no markdown, no explanation.`

  try {
    const result = await callClaude(req.file.buffer, mediaType, prompt)
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

export default router
