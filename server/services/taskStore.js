// taskStore — the one implementation of task CRUD, shared by the REST routes
// (server/routes/tasks.js) and the MCP tools (server/mcp.js) so dedupe, shaping,
// and critical-date sync never drift between the two surfaces. Framework-agnostic:
// functions take plain data and return { task } / { error } / { notFound }.
import db from '../db.js'
import { syncCriticalDateFromTask } from './criticalDates.js'

// Fire-and-forget: log a completed task onto its deal/property timeline. Dynamic
// import avoids a static cycle (correspondence imports taskStore).
function logTaskCompletion(task) {
  if (!task || (!task.deal_id && !task.property_id)) return
  import('./correspondence.js')
    .then(({ logActivity }) => logActivity({
      deal_id: task.deal_id, property_id: task.property_id, type: 'task_completed',
      summary: `Task completed: ${task.title}`,
    }, task.updated_by || 'system'))
    .catch(() => {})
}

export const STATUSES   = ['open', 'waiting', 'done', 'dismissed']
export const PRIORITIES = ['high', 'normal', 'low']
export const SOURCES    = ['manual', 'claude', 'critical_date', 'email', 'meeting_notes']

export function initials(name) {
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

export function shape(row) {
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

export const getTask = (id) => shape(db.prepare(`${SELECT} WHERE t.id = ?`).get(id))

// filters: status, owner_id, due_before, deal_id, property_id, priority, source, include_done
export function listTasks(f = {}) {
  const where = [], args = []
  if (f.status && STATUSES.includes(f.status)) { where.push('t.status = ?'); args.push(f.status) }
  else if (f.include_done) { /* all statuses */ }
  else {
    where.push(`t.status IN ('open','waiting')`)
    where.push(`(t.snoozed_until IS NULL OR t.snoozed_until <= date('now'))`)
  }
  if (f.owner_id != null && Number.isFinite(Number(f.owner_id))) { where.push('t.owner_id = ?'); args.push(Number(f.owner_id)) }
  if (f.due_before)  { where.push('t.due_date IS NOT NULL AND t.due_date <= ?'); args.push(f.due_before) }
  if (f.deal_id)     { where.push('t.deal_id = ?');     args.push(Number(f.deal_id)) }
  if (f.property_id) { where.push('t.property_id = ?'); args.push(Number(f.property_id)) }
  if (f.priority && PRIORITIES.includes(f.priority)) { where.push('t.priority = ?'); args.push(f.priority) }
  if (f.source && SOURCES.includes(f.source))        { where.push('t.source = ?');   args.push(f.source) }

  const rows = db.prepare(`
    ${SELECT}
    ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
    ORDER BY
      CASE WHEN t.due_date IS NULL THEN 1 ELSE 0 END,
      t.due_date ASC,
      CASE t.priority WHEN 'high' THEN 0 WHEN 'normal' THEN 1 ELSE 2 END,
      t.created_at DESC
  `).all(...args)
  return rows.map(shape)
}

const EDITABLE = [
  'title', 'notes', 'status', 'priority', 'due_date', 'snoozed_until', 'owner_id',
  'waiting_on', 'follow_up_date', 'deal_id', 'property_id', 'person_id', 'critical_date_id',
]

// Create (with source_ref dedupe). Returns { task, deduped } or { error }.
export function createTask(b = {}, actor = 'user', defaultOwnerId = null) {
  const title = (b.title || '').trim()
  if (!title) return { error: 'title is required' }
  if (b.status   && !STATUSES.includes(b.status))     return { error: `status must be one of: ${STATUSES.join(', ')}` }
  if (b.priority && !PRIORITIES.includes(b.priority)) return { error: `priority must be one of: ${PRIORITIES.join(', ')}` }
  if (b.source   && !SOURCES.includes(b.source))      return { error: `source must be one of: ${SOURCES.join(', ')}` }

  if (b.source_ref) {
    const existing = db.prepare(`SELECT id FROM tasks WHERE source_ref = ? AND status IN ('open','waiting') LIMIT 1`).get(b.source_ref)
    if (existing) return { task: getTask(existing.id), deduped: true }
  }

  const ownerId = b.owner_id != null ? Number(b.owner_id)
    : (defaultOwnerId != null ? Number(defaultOwnerId) : null)

  const r = db.prepare(`
    INSERT INTO tasks
      (title, notes, status, priority, due_date, snoozed_until, owner_id, waiting_on,
       follow_up_date, deal_id, property_id, person_id, critical_date_id, source,
       source_ref, created_by, updated_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    title, b.notes || null, b.status || 'open', b.priority || 'normal',
    b.due_date || null, b.snoozed_until || null, ownerId, b.waiting_on || null,
    b.follow_up_date || null,
    b.deal_id != null ? Number(b.deal_id) : null,
    b.property_id != null ? Number(b.property_id) : null,
    b.person_id != null ? Number(b.person_id) : null,
    b.critical_date_id != null ? b.critical_date_id : null,
    b.source || 'manual', b.source_ref || null, actor, actor,
  )
  return { task: getTask(r.lastInsertRowid), deduped: false }
}

// Update any editable field. Returns { task } / { error } / { notFound }.
export function updateTask(id, b = {}, actor = 'user', userId = null) {
  const existing = db.prepare('SELECT * FROM tasks WHERE id = ?').get(id)
  if (!existing) return { notFound: true }
  if (b.status   && !STATUSES.includes(b.status))     return { error: `status must be one of: ${STATUSES.join(', ')}` }
  if (b.priority && !PRIORITIES.includes(b.priority)) return { error: `priority must be one of: ${PRIORITIES.join(', ')}` }

  const sets = [], args = []
  for (const field of EDITABLE) {
    if (field in b) { sets.push(`${field} = ?`); args.push(b[field] === '' ? null : b[field]) }
  }
  if ('status' in b) {
    if (b.status === 'done')      sets.push(`completed_at = datetime('now')`)
    else if (existing.status === 'done') sets.push(`completed_at = NULL`)
  }
  if (!sets.length) return { task: getTask(id) }

  sets.push(`updated_by = ?`); args.push(actor)
  sets.push(`updated_at = datetime('now')`)
  args.push(id)
  db.prepare(`UPDATE tasks SET ${sets.join(', ')} WHERE id = ?`).run(...args)

  const updated = getTask(id)
  if ('status' in b) {
    try { syncCriticalDateFromTask(updated, userId) } catch (e) { console.error('[taskStore] cd sync:', e.message) }
    if (b.status === 'done' && existing.status !== 'done') logTaskCompletion(updated)
  }
  return { task: updated }
}

export function completeTask(id, actor = 'user', userId = null) {
  const existing = db.prepare('SELECT id, status FROM tasks WHERE id = ?').get(id)
  if (!existing) return { notFound: true }
  db.prepare(`
    UPDATE tasks SET status = 'done', completed_at = datetime('now'),
      updated_by = ?, updated_at = datetime('now')
    WHERE id = ?
  `).run(actor, id)
  const updated = getTask(id)
  try { syncCriticalDateFromTask(updated, userId) } catch (e) { console.error('[taskStore] cd sync:', e.message) }
  if (existing.status !== 'done') logTaskCompletion(updated)
  return { task: updated }
}

export function taskUsers() {
  const rows = db.prepare(`SELECT id, name, email FROM users WHERE status = 'active' ORDER BY name`).all()
  return rows.map(u => ({ id: u.id, name: u.name || u.email, initials: initials(u.name || u.email) }))
}
