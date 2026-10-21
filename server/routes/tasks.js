// Tasks REST API — thin HTTP layer over services/taskStore.js (shared with the
// MCP tools). Mounted under bearerOrSession in index.js, so it accepts either the
// browser session cookie OR a CLAUDE_API_KEY bearer token; token writes are tagged
// created_by/updated_by = 'claude' via taskActor().
import { Router } from 'express'
import { generateCriticalDateTasks } from '../services/criticalDates.js'
import { listTasks, getTask, createTask, updateTask, completeTask, taskUsers } from '../services/taskStore.js'

const router = Router()

// Who is acting: 'claude' for the token path, else the signed-in user's handle.
function taskActor(req) {
  if (req.apiClient) return req.apiClient
  const name = (req.user?.name || '').trim()
  if (name) return name.split(/\s+/)[0].toLowerCase()
  const email = req.user?.email || ''
  return email ? email.split('@')[0].toLowerCase() : 'user'
}

// ── GET /api/tasks — list ─────────────────────────────────────────────────────
router.get('/', (req, res) => {
  try { generateCriticalDateTasks({ force: false }) } catch (e) { console.error('[tasks] cdt gen:', e.message) }

  const { status, owner, due_before, deal_id, property_id, priority, source, include_done } = req.query
  let owner_id
  if (owner && owner !== 'all') owner_id = owner === 'me' ? Number(req.user?.sub) : Number(owner)
  res.json(listTasks({
    status, owner_id, due_before, deal_id, property_id, priority, source,
    include_done: include_done === '1' || include_done === 'true',
  }))
})

// ── GET /api/tasks/meta/users ─────────────────────────────────────────────────
router.get('/meta/users', (_req, res) => res.json(taskUsers()))

// ── GET /api/tasks/:id ────────────────────────────────────────────────────────
router.get('/:id', (req, res) => {
  const task = getTask(req.params.id)
  if (!task) return res.status(404).json({ error: 'Task not found' })
  res.json(task)
})

// ── POST /api/tasks — create (source_ref dedupe) ──────────────────────────────
router.post('/', (req, res) => {
  const r = createTask(req.body || {}, taskActor(req), Number(req.user?.sub) || null)
  if (r.error) return res.status(400).json({ error: r.error })
  res.status(r.deduped ? 200 : 201).json(r.deduped ? { ...r.task, deduped: true } : r.task)
})

// ── PATCH /api/tasks/:id ──────────────────────────────────────────────────────
router.patch('/:id', (req, res) => {
  const r = updateTask(req.params.id, req.body || {}, taskActor(req), Number(req.user?.sub) || null)
  if (r.notFound) return res.status(404).json({ error: 'Task not found' })
  if (r.error)    return res.status(400).json({ error: r.error })
  res.json(r.task)
})

// ── POST /api/tasks/:id/complete ──────────────────────────────────────────────
router.post('/:id/complete', (req, res) => {
  const r = completeTask(req.params.id, taskActor(req), Number(req.user?.sub) || null)
  if (r.notFound) return res.status(404).json({ error: 'Task not found' })
  res.json(r.task)
})

export default router
