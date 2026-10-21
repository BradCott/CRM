// Critical dates REST API — same auth as /api/tasks (mounted under requireAuth).
// Critical dates are derived; :id is the composite key entity_type:entity_id:kind:date.
import { Router } from 'express'
import db from '../db.js'
import {
  allCriticalDates, generateCriticalDateTasks, completeCriticalDate,
  uncompleteCriticalDate, parseCriticalDateKey,
} from '../services/criticalDates.js'

const router = Router()

function actorOf(req) {
  if (req.apiClient) return req.apiClient
  const name = (req.user?.name || '').trim()
  if (name) return name.split(/\s+/)[0].toLowerCase()
  const email = req.user?.email || ''
  return email ? email.split('@')[0].toLowerCase() : 'user'
}

// ── GET /api/critical-dates ───────────────────────────────────────────────────
// Filters: status (open|done|all), type (kind), deal_id, property_id,
// window (days — only items due within N days), include_done.
router.get('/', (req, res) => {
  try { generateCriticalDateTasks({ force: false }) } catch (e) { console.error('[critical-dates] cdt gen:', e.message) }

  const { status, type, deal_id, property_id, window, include_done } = req.query
  let items = allCriticalDates()

  if (type)        items = items.filter(i => i.kind === type)
  if (deal_id)     items = items.filter(i => i.entity_type === 'deal' && i.entity_id === Number(deal_id))
  if (property_id) items = items.filter(i => i.entity_type === 'property' && i.entity_id === Number(property_id))
  if (window)      items = items.filter(i => i.daysUntil <= Number(window))

  const wantDone = status === 'done'
  const showAll  = status === 'all' || include_done === '1' || include_done === 'true'
  if (wantDone)      items = items.filter(i => i.done)
  else if (!showAll) items = items.filter(i => !i.done)

  res.json(items)
})

// ── PATCH /api/critical-dates/:id ─────────────────────────────────────────────
// Body: { status: 'done' | 'open' }  → complete / un-complete (syncs the task)
//       { date: 'YYYY-MM-DD' }        → move the underlying date field
const DATE_FIELD = {
  deal:     { effective_date: 'effective_date', earnest_due: 'earnest_due_date', dd_deadline: 'dd_deadline', title_objection: 'title_objection_date', closing: 'close_date' },
  property: { lease_expiration: 'lease_end', loan_maturity: 'maturity_date' },
}

router.patch('/:id', (req, res) => {
  const id = decodeURIComponent(req.params.id)
  const k = parseCriticalDateKey(id)
  if (!k) return res.status(400).json({ error: 'Invalid critical date id' })
  const actor = actorOf(req)
  const b = req.body || {}
  let changed = false

  if ('status' in b) {
    if (b.status === 'done')      { completeCriticalDate(id, actor, Number(req.user?.sub) || null); changed = true }
    else if (b.status === 'open') { uncompleteCriticalDate(id, actor); changed = true }
    else return res.status(400).json({ error: "status must be 'done' or 'open'" })
  }

  if ('date' in b && b.date) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(b.date)) return res.status(400).json({ error: 'date must be YYYY-MM-DD' })
    const col = DATE_FIELD[k.entity_type]?.[k.kind]
    if (!col) return res.status(422).json({ error: `Editing the date for '${k.kind}' isn't supported via the API — edit the ${k.entity_type} record.` })
    const table = k.entity_type === 'deal' ? 'deals' : 'properties'
    db.prepare(`UPDATE ${table} SET ${col} = ? WHERE id = ?`).run(b.date, k.entity_id)
    // Reconcile the linked task to the new date (migrate, don't duplicate).
    try { generateCriticalDateTasks({ force: true, actor }) } catch (e) { console.error('[critical-dates] cdt gen:', e.message) }
    changed = true
  }

  if (!changed) return res.status(400).json({ error: 'Provide status and/or date to update' })

  const fresh = allCriticalDates().find(i => i.id === id)
    || allCriticalDates().find(i => i.entity_type === k.entity_type && i.entity_id === k.entity_id && i.kind === k.kind)
  res.json(fresh || { id, ...k, updated_by: actor })
})

export default router
