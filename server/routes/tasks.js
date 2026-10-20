// Tasks — the single source of truth for every to-do (replaces Today's Plays).
// An open task stays open until someone closes it; carry-over is automatic.
//
// These endpoints currently authenticate with the browser session cookie
// (mounted under requireAuth in index.js). A later phase adds a bearer-token
// path (CLAUDE_API_KEY) + an MCP server on top of the SAME handlers so Claude
// can read/write tasks headlessly. To keep that path clean, every write records
// `updated_by` (and `created_by`) from `taskActor(req)`, which will return
// 'claude' for token requests.
import { Router } from 'express'
import db from '../db.js'

const router = Router()

const STATUSES   = ['open', 'waiting', 'done', 'dismissed']
const PRIORITIES = ['high', 'normal', 'low']
const SOURCES    = ['manual', 'claude', 'critical_date', 'email', 'meeting_notes']

// Who is acting. For a cookie session this is the signed-in user's short handle
// (first name, lowercased); the token/MCP path will override this to 'claude'.
function taskActor(req) {
  if (req.apiClient) return req.apiClient            // set by the token middleware (phase 2)
  const name = (req.user?.name || '').trim()
  if (name) return name.split(/\s+/)[0].toLowerCase()
  const email = req.user?.email || ''
  return email ? email.split('@')[0].toLowerCase() : 'user'
}

function initials(name) {
  if (!name) return '?'
  const parts = name.trim().split(/\s+/)
  return ((parts[0]?.[0] || '') + (parts[1]?.[0] || '')).toUpperCase() || name[0].toUpperCase()
}

const SELECT = `
  SELECT t.*,
         ou.name  AS owner_name,
         d.address AS deal_address, d.title AS deal_title,
         p.address AS property_address,
         pe.name   AS person_name
  FROM tasks t
  LEFT JOIN users      ou ON ou.id = t.owner_id
  LEFT JOIN deals      d  ON d.id  = t.deal_id
  LEFT JOIN properties p  ON p.id  = t.property_id
  LEFT JOIN people     pe ON pe.id = t.person_id
`

// Shape a raw joined row into the API object: add display labels, drop the raw
// join columns, and keep every stored field (incl. id + updated_at).
function shape(row) {
  if (!row) return null
  const deal_label = row.deal_id ? (row.deal_address || row.deal_title || `Deal #${row.deal_id}`) : null
  const { deal_address, deal_title, property_address, person_name, owner_name, ...rest } = row
  return {
    ...rest,
    owner_name: owner_name || null,
    owner_initials: owner_name ? initials(owner_name) : null,
    deal_label,
    property_label: row.property_id ? (property_address || `Property #${row.property_id}`) : null,
    person_name: row.person_id ? (person_name || null) : null,
  }
}

const getTask = (id) => shape(db.prepare(`${SELECT} WHERE t.id = ?`).get(id))

// ── GET /api/tasks — list ─────────────────────────────────────────────────────
// Query: status, owner ('me' | 'all' | user id), due_before (YYYY-MM-DD),
// deal_id, property_id, priority, source, include_done.
router.get('/', (req, res) => {
  const { status, owner, due_before, deal_id, property_id, priority, source, include_done } = req.query
  const where = []
  const args  = []

  if (status && STATUSES.includes(status)) {
    where.push('t.status = ?'); args.push(status)
  } else if (include_done === '1' || include_done === 'true') {
    // all statuses
  } else {
    where.push(`t.status IN ('open','waiting')`)
    // Hide tasks snoozed into the future from the default views.
    where.push(`(t.snoozed_until IS NULL OR t.snoozed_until <= date('now'))`)
  }

  if (owner && owner !== 'all') {
    const id = owner === 'me' ? Number(req.user?.sub) : Number(owner)
    if (Number.isFinite(id)) { where.push('t.owner_id = ?'); args.push(id) }
  }
  if (due_before)  { where.push('t.due_date IS NOT NULL AND t.due_date <= ?'); args.push(due_before) }
  if (deal_id)     { where.push('t.deal_id = ?');     args.push(Number(deal_id)) }
  if (property_id) { where.push('t.property_id = ?'); args.push(Number(property_id)) }
  if (priority && PRIORITIES.includes(priority)) { where.push('t.priority = ?'); args.push(priority) }
  if (source && SOURCES.includes(source))        { where.push('t.source = ?');   args.push(source) }

  const rows = db.prepare(`
    ${SELECT}
    ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
    ORDER BY
      CASE WHEN t.due_date IS NULL THEN 1 ELSE 0 END,
      t.due_date ASC,
      CASE t.priority WHEN 'high' THEN 0 WHEN 'normal' THEN 1 ELSE 2 END,
      t.created_at DESC
  `).all(...args)

  res.json(rows.map(shape))
})

// ── GET /api/tasks/meta/users — active users for owner pickers/filters ────────
router.get('/meta/users', (req, res) => {
  const rows = db.prepare(`SELECT id, name, email FROM users WHERE status = 'active' ORDER BY name`).all()
  res.json(rows.map(u => ({ id: u.id, name: u.name || u.email, initials: initials(u.name || u.email) })))
})

// ── GET /api/tasks/:id ────────────────────────────────────────────────────────
router.get('/:id', (req, res) => {
  const task = getTask(req.params.id)
  if (!task) return res.status(404).json({ error: 'Task not found' })
  res.json(task)
})

// ── POST /api/tasks — create (with source_ref dedupe) ─────────────────────────
router.post('/', (req, res) => {
  const b = req.body || {}
  const title = (b.title || '').trim()
  if (!title) return res.status(400).json({ error: 'title is required' })

  if (b.status   && !STATUSES.includes(b.status))     return res.status(400).json({ error: `status must be one of: ${STATUSES.join(', ')}` })
  if (b.priority && !PRIORITIES.includes(b.priority)) return res.status(400).json({ error: `priority must be one of: ${PRIORITIES.join(', ')}` })
  if (b.source   && !SOURCES.includes(b.source))      return res.status(400).json({ error: `source must be one of: ${SOURCES.join(', ')}` })

  // Dedupe: a create with a source_ref matching an existing OPEN/WAITING task
  // returns that task instead of making a duplicate (idempotent for Claude).
  if (b.source_ref) {
    const existing = db.prepare(
      `SELECT id FROM tasks WHERE source_ref = ? AND status IN ('open','waiting') LIMIT 1`
    ).get(b.source_ref)
    if (existing) return res.status(200).json({ ...getTask(existing.id), deduped: true })
  }

  const actor = taskActor(req)
  const ownerId = b.owner_id != null ? Number(b.owner_id) : Number(req.user?.sub) || null

  const r = db.prepare(`
    INSERT INTO tasks
      (title, notes, status, priority, due_date, snoozed_until, owner_id, waiting_on,
       follow_up_date, deal_id, property_id, person_id, critical_date_id, source,
       source_ref, created_by, updated_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    title,
    b.notes || null,
    b.status || 'open',
    b.priority || 'normal',
    b.due_date || null,
    b.snoozed_until || null,
    ownerId,
    b.waiting_on || null,
    b.follow_up_date || null,
    b.deal_id != null ? Number(b.deal_id) : null,
    b.property_id != null ? Number(b.property_id) : null,
    b.person_id != null ? Number(b.person_id) : null,
    b.critical_date_id != null ? Number(b.critical_date_id) : null,
    b.source || 'manual',
    b.source_ref || null,
    actor,
    actor,
  )
  res.status(201).json(getTask(r.lastInsertRowid))
})

const EDITABLE = [
  'title', 'notes', 'status', 'priority', 'due_date', 'snoozed_until', 'owner_id',
  'waiting_on', 'follow_up_date', 'deal_id', 'property_id', 'person_id', 'critical_date_id',
]

// ── PATCH /api/tasks/:id — update any field ───────────────────────────────────
router.patch('/:id', (req, res) => {
  const existing = db.prepare('SELECT * FROM tasks WHERE id = ?').get(req.params.id)
  if (!existing) return res.status(404).json({ error: 'Task not found' })

  const b = req.body || {}
  if (b.status   && !STATUSES.includes(b.status))     return res.status(400).json({ error: `status must be one of: ${STATUSES.join(', ')}` })
  if (b.priority && !PRIORITIES.includes(b.priority)) return res.status(400).json({ error: `priority must be one of: ${PRIORITIES.join(', ')}` })

  const sets = []
  const args = []
  for (const field of EDITABLE) {
    if (field in b) {
      sets.push(`${field} = ?`)
      args.push(b[field] === '' ? null : b[field])
    }
  }

  // completed_at tracks the done state both ways.
  if ('status' in b) {
    if (b.status === 'done')      sets.push(`completed_at = datetime('now')`)
    else if (existing.status === 'done') sets.push(`completed_at = NULL`)
  }

  if (!sets.length) return res.json(getTask(existing.id))

  sets.push(`updated_by = ?`); args.push(taskActor(req))
  sets.push(`updated_at = datetime('now')`)
  args.push(existing.id)

  db.prepare(`UPDATE tasks SET ${sets.join(', ')} WHERE id = ?`).run(...args)
  res.json(getTask(existing.id))
})

// ── POST /api/tasks/:id/complete — mark done ──────────────────────────────────
router.post('/:id/complete', (req, res) => {
  const existing = db.prepare('SELECT id FROM tasks WHERE id = ?').get(req.params.id)
  if (!existing) return res.status(404).json({ error: 'Task not found' })
  db.prepare(`
    UPDATE tasks SET status = 'done', completed_at = datetime('now'),
      updated_by = ?, updated_at = datetime('now')
    WHERE id = ?
  `).run(taskActor(req), existing.id)
  res.json(getTask(existing.id))
})

export default router
