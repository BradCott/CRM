// MCP server — exposes the CRM's tasks, critical dates, and deals to Claude as a
// custom connector (Streamable HTTP at /mcp). Auth is the CLAUDE_API_KEY bearer
// token (see middleware/auth.js requireClaudeToken), applied before this handler.
// All writes run as actor 'claude' so they're tagged created_by/updated_by.
//
// Session-managed transport: the first request (initialize) creates a transport
// keyed by a generated mcp-session-id; later requests reuse it. State is in-memory
// (fine for Knox's single Railway instance).
import { randomUUID } from 'node:crypto'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js'
import { z } from 'zod'
import db from './db.js'
import { hasClaudeToken } from './middleware/auth.js'
import { listTasks, getTask, createTask, updateTask, completeTask } from './services/taskStore.js'
import { allCriticalDates, completeCriticalDate } from './services/criticalDates.js'
import {
  logActivity, linkEmailThread, getThreadLink, addUnmatched, listUnmatched, getDealContext,
} from './services/correspondence.js'

const ACTOR = 'claude'

function coleId() {
  const u = db.prepare(`SELECT id FROM users WHERE lower(email) = 'cole@knoxcre.com'`).get()
    || db.prepare(`SELECT id FROM users WHERE role = 'admin' ORDER BY id LIMIT 1`).get()
  return u ? u.id : null
}

const ok   = (data) => ({ content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] })
const fail = (msg)  => ({ content: [{ type: 'text', text: `Error: ${msg}` }], isError: true })

const DEAL_SELECT = `
  SELECT d.id, COALESCE(d.address, p.address) AS address, COALESCE(d.city, p.city) AS city,
         COALESCE(d.state, p.state) AS state, COALESCE(d.tenant, t.name) AS tenant,
         d.stage, d.direction, COALESCE(d.purchase_price, d.offer_price) AS purchase_price,
         d.close_date, d.dd_deadline, d.earnest_due_date, d.title_objection_date
  FROM deals d
  LEFT JOIN properties p ON p.id = d.property_id
  LEFT JOIN tenant_brands t ON t.id = p.tenant_brand_id
`

function filterCriticalDates(a = {}) {
  let items = allCriticalDates()
  if (a.type)        items = items.filter(i => i.kind === a.type)
  if (a.deal_id)     items = items.filter(i => i.entity_type === 'deal' && i.entity_id === Number(a.deal_id))
  if (a.property_id) items = items.filter(i => i.entity_type === 'property' && i.entity_id === Number(a.property_id))
  if (a.window != null) items = items.filter(i => i.daysUntil <= Number(a.window))
  const showAll = a.status === 'all' || a.include_done
  if (a.status === 'done') items = items.filter(i => i.done)
  else if (!showAll)       items = items.filter(i => !i.done)
  return items
}

// ── Build a fresh MCP server with all tools registered ────────────────────────
function buildServer() {
  const server = new McpServer({ name: 'knox-crm', version: '1.0.0' })

  // Tasks ─────────────────────────────────────────────────────────────────────
  server.registerTool('list_tasks', {
    description: 'List CRM tasks. Filters: status (open/waiting/done/dismissed), owner_id, due_before (YYYY-MM-DD), deal_id, property_id, priority, source, include_done. Default excludes done/dismissed.',
    inputSchema: {
      status: z.enum(['open', 'waiting', 'done', 'dismissed']).optional(),
      owner_id: z.number().optional(),
      due_before: z.string().optional(),
      deal_id: z.number().optional(),
      property_id: z.number().optional(),
      priority: z.enum(['high', 'normal', 'low']).optional(),
      source: z.string().optional(),
      include_done: z.boolean().optional(),
    },
  }, async (a) => ok(listTasks(a)))

  server.registerTool('get_task', {
    description: 'Get one task by id.',
    inputSchema: { id: z.number() },
  }, async ({ id }) => { const t = getTask(id); return t ? ok(t) : fail('Task not found') })

  server.registerTool('create_task', {
    description: 'Create a task. Dedupes on source_ref: a create with a source_ref matching an existing open/waiting task returns that task instead of a duplicate. Defaults: owner = Cole, source = claude.',
    inputSchema: {
      title: z.string(),
      notes: z.string().optional(),
      status: z.enum(['open', 'waiting', 'done', 'dismissed']).optional(),
      priority: z.enum(['high', 'normal', 'low']).optional(),
      due_date: z.string().optional(),
      owner_id: z.number().optional(),
      deal_id: z.number().optional(),
      property_id: z.number().optional(),
      person_id: z.number().optional(),
      waiting_on: z.string().optional(),
      follow_up_date: z.string().optional(),
      source: z.enum(['manual', 'claude', 'critical_date', 'email', 'meeting_notes']).optional(),
      source_ref: z.string().optional(),
    },
  }, async (a) => {
    const r = createTask({ source: 'claude', ...a }, ACTOR, coleId())
    return r.error ? fail(r.error) : ok(r.task)
  })

  server.registerTool('update_task', {
    description: 'Update any field of a task (status, due_date, priority, notes, owner_id, waiting_on, etc.). Completing a critical_date-linked task also completes the critical date.',
    inputSchema: {
      id: z.number(),
      title: z.string().optional(),
      notes: z.string().optional(),
      status: z.enum(['open', 'waiting', 'done', 'dismissed']).optional(),
      priority: z.enum(['high', 'normal', 'low']).optional(),
      due_date: z.string().optional(),
      snoozed_until: z.string().optional(),
      owner_id: z.number().optional(),
      deal_id: z.number().optional(),
      property_id: z.number().optional(),
      waiting_on: z.string().optional(),
      follow_up_date: z.string().optional(),
    },
  }, async ({ id, ...fields }) => {
    const r = updateTask(id, fields, ACTOR, null)
    if (r.notFound) return fail('Task not found')
    return r.error ? fail(r.error) : ok(r.task)
  })

  server.registerTool('complete_task', {
    description: 'Mark a task done (sets completed_at). Also completes a linked critical date.',
    inputSchema: { id: z.number() },
  }, async ({ id }) => {
    const r = completeTask(id, ACTOR, null)
    return r.notFound ? fail('Task not found') : ok(r.task)
  })

  // Critical dates ──────────────────────────────────────────────────────────────
  server.registerTool('list_critical_dates', {
    description: 'List critical dates (deal escrow + portfolio deadlines). Filters: status (open/done/all), type (kind), deal_id, property_id, window (days), include_done. Each has a composite id used by complete_critical_date.',
    inputSchema: {
      status: z.enum(['open', 'done', 'all']).optional(),
      type: z.string().optional(),
      deal_id: z.number().optional(),
      property_id: z.number().optional(),
      window: z.number().optional(),
      include_done: z.boolean().optional(),
    },
  }, async (a) => ok(filterCriticalDates(a)))

  server.registerTool('complete_critical_date', {
    description: 'Mark a critical date complete by its composite id (entity_type:entity_id:kind:date). Also completes the linked task.',
    inputSchema: { id: z.string() },
  }, async ({ id }) => {
    return completeCriticalDate(id, ACTOR) ? ok({ id, done: true }) : fail('Invalid critical date id')
  })

  // Deals ───────────────────────────────────────────────────────────────────────
  server.registerTool('list_deals', {
    description: 'List active pipeline deals (id, address, tenant, stage, price, key dates).',
    inputSchema: {},
  }, async () => ok(db.prepare(`${DEAL_SELECT} WHERE COALESCE(d.status,'active') = 'active' ORDER BY d.created_at DESC LIMIT 100`).all()))

  server.registerTool('get_deal', {
    description: 'Get one deal by id, with its address, tenant, stage, price, and escrow dates.',
    inputSchema: { id: z.number() },
  }, async ({ id }) => {
    const d = db.prepare(`${DEAL_SELECT} WHERE d.id = ?`).get(id)
    return d ? ok(d) : fail('Deal not found')
  })

  // Correspondence ──────────────────────────────────────────────────────────────
  server.registerTool('get_deal_context', {
    description: 'Everything about a deal/property in ONE call: deal + property fields (incl. PSA/lease abstract summaries), parties with roles + emails, open critical dates, open tasks, last 30 days of timeline, and linked Gmail threads. Accepts deal_id, property_id, or a free-text name (e.g. "Plano").',
    inputSchema: { deal_id: z.number().optional(), property_id: z.number().optional(), name: z.string().optional() },
  }, async (a) => { const r = getDealContext(a); return r.error ? fail(r.error) : ok(r) })

  server.registerTool('log_deal_activity', {
    description: 'Add a timeline entry to a deal/property (at least one of deal_id/property_id). type: email|note|status_change|document|call|task_completed|system. Email entries dedupe on gmail_message_id.',
    inputSchema: {
      deal_id: z.number().optional(), property_id: z.number().optional(),
      type: z.enum(['email', 'note', 'status_change', 'document', 'call', 'task_completed', 'system']),
      summary: z.string().optional(), detail: z.string().optional(),
      gmail_thread_id: z.string().optional(), gmail_message_id: z.string().optional(),
      participants: z.string().optional(), occurred_at: z.string().optional(),
    },
  }, async (a) => { const r = logActivity(a, ACTOR); return r.error ? fail(r.error) : ok(r.deduped ? { ...r.entry, deduped: true } : r.entry) })

  server.registerTool('link_email_thread', {
    description: 'Link a Gmail thread to a deal/property. Future messages in the thread belong to it. Idempotent per thread id.',
    inputSchema: { gmail_thread_id: z.string(), deal_id: z.number().optional(), property_id: z.number().optional(), confidence: z.number().optional() },
  }, async (a) => { const r = linkEmailThread(a, ACTOR); return r.error ? fail(r.error) : ok(r.link) })

  server.registerTool('get_thread_link', {
    description: 'Check whether a Gmail thread is already linked to a deal/property (returns the link or null).',
    inputSchema: { gmail_thread_id: z.string() },
  }, async ({ gmail_thread_id }) => ok(getThreadLink(gmail_thread_id)))

  server.registerTool('add_unmatched_email', {
    description: 'Add an email Claude could not confidently match to the /unmatched review queue. Dedupes on gmail_message_id.',
    inputSchema: {
      gmail_thread_id: z.string().optional(), gmail_message_id: z.string().optional(),
      summary: z.string().optional(), from_address: z.string().optional(),
      subject: z.string().optional(), occurred_at: z.string().optional(),
    },
  }, async (a) => { const r = addUnmatched(a, ACTOR); return ok(r.deduped ? { ...r.entry, deduped: true } : r.entry) })

  server.registerTool('list_unmatched', {
    description: 'List emails in the unmatched review queue (status: pending|assigned|ignored, default pending).',
    inputSchema: { status: z.enum(['pending', 'assigned', 'ignored']).optional() },
  }, async ({ status }) => ok(listUnmatched(status || 'pending')))

  return server
}

// ── Session-managed Streamable HTTP handler ───────────────────────────────────
const transports = {}   // sessionId -> transport

export async function handleMcp(req, res) {
  // Require the X-Api-Key / bearer token for tool EXECUTION, but allow the MCP
  // handshake and tool discovery (initialize, tools/list, ping, notifications)
  // unauthenticated. claude.ai's connector validates the URL before the configured
  // header is applied — a hard 401 there reads as "server not found." Only
  // tools/call returns data, and that stays protected.
  const msgs = Array.isArray(req.body) ? req.body : [req.body]
  const needsAuth = msgs.some(m => m && m.method === 'tools/call')
  if (needsAuth && !hasClaudeToken(req)) {
    return res.status(401).json({
      jsonrpc: '2.0', id: (req.body && req.body.id) ?? null,
      error: { code: -32001, message: 'Unauthorized — set the X-Api-Key header to call tools.' },
    })
  }
  try {
    const sessionId = req.headers['mcp-session-id']
    let transport = sessionId ? transports[sessionId] : undefined

    if (!transport) {
      if (sessionId || !isInitializeRequest(req.body)) {
        return res.status(400).json({
          jsonrpc: '2.0', id: null,
          error: { code: -32000, message: 'Bad Request: no valid session (send an initialize request first)' },
        })
      }
      transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
        onsessioninitialized: (sid) => { transports[sid] = transport },
      })
      transport.onclose = () => { if (transport.sessionId) delete transports[transport.sessionId] }
      await buildServer().connect(transport)
    }

    await transport.handleRequest(req, res, req.body)
  } catch (e) {
    console.error('[mcp] error:', e.message)
    if (!res.headersSent) res.status(500).json({ jsonrpc: '2.0', id: null, error: { code: -32603, message: 'Internal server error' } })
  }
}
