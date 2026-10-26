// MCP server — exposes the CRM's tasks, critical dates, and deals to Claude as a
// custom connector (Streamable HTTP at /mcp). Stateless transport; auth is the
// CLAUDE_API_KEY, sent as `X-Api-Key: <key>` or `Authorization: Bearer <key>`,
// required on tool calls (handshake + discovery are open). All writes run as
// actor 'claude' so they're tagged created_by/updated_by.
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { z } from 'zod'
import db from './db.js'
import { hasClaudeToken } from './middleware/auth.js'
import { listTasks, getTask, createTask, updateTask, completeTask } from './services/taskStore.js'
import { allCriticalDates, completeCriticalDate, generateCriticalDateTasks } from './services/criticalDates.js'
import {
  logActivity, linkEmailThread, getThreadLink, addUnmatched, listUnmatched, getDealContext,
} from './services/correspondence.js'
import { normalizeAddr } from './utils/normalize.js'
import { planMerge } from './services/propertyMerge.js'

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

  // Properties ────────────────────────────────────────────────────────────────
  server.registerTool('list_properties', {
    description: 'List owned portfolio properties (id, address, city, state, tenant, lease_end). Excludes sold ones.',
    inputSchema: {},
  }, async () => ok(db.prepare(`
    SELECT p.id, p.address, p.city, p.state, t.name AS tenant, p.lease_end
    FROM properties p LEFT JOIN tenant_brands t ON t.id = p.tenant_brand_id
    WHERE p.is_portfolio = 1 AND (p.listing_status IS NULL OR p.listing_status <> 'sold')
    ORDER BY p.address LIMIT 200
  `).all()))

  server.registerTool('log_property_activity', {
    description: "Add an entry to a property's timeline. Dedupes on gmail_message_id (same as log_deal_activity).",
    inputSchema: {
      property_id: z.number(), summary: z.string(),
      gmail_message_id: z.string().optional(), gmail_thread_id: z.string().optional(), date: z.string().optional(),
    },
  }, async ({ property_id, summary, gmail_message_id, gmail_thread_id, date }) => {
    const r = logActivity({
      property_id, type: (gmail_message_id || gmail_thread_id) ? 'email' : 'note',
      summary, gmail_message_id, gmail_thread_id, occurred_at: date,
    }, ACTOR)
    return r.error ? fail(r.error) : ok(r.deduped ? { ...r.entry, deduped: true } : r.entry)
  })

  server.registerTool('link_property_thread', {
    description: 'Link a Gmail thread to a property so future replies auto-attach to its timeline.',
    inputSchema: { property_id: z.number(), gmail_thread_id: z.string() },
  }, async ({ property_id, gmail_thread_id }) => {
    const r = linkEmailThread({ property_id, gmail_thread_id }, ACTOR)
    return r.error ? fail(r.error) : ok(r.link)
  })

  // Deal update (whitelisted fields; no deletes) ───────────────────────────────
  server.registerTool('update_deal', {
    description: 'Update whitelisted fields of a deal: direction (purchase/sale), stage, close_date, dd_deadline, earnest_due_date, title_objection_date, purchase_price, notes. No deletes.',
    inputSchema: {
      id: z.number(),
      direction: z.enum(['purchase', 'sale']).optional(),
      stage: z.string().optional(), close_date: z.string().optional(),
      dd_deadline: z.string().optional(), earnest_due_date: z.string().optional(),
      title_objection_date: z.string().optional(),
      purchase_price: z.number().optional(), notes: z.string().optional(),
    },
  }, async ({ id, ...fields }) => {
    const existing = db.prepare('SELECT id, stage FROM deals WHERE id = ?').get(id)
    if (!existing) return fail('Deal not found')
    const WL = ['direction', 'stage', 'close_date', 'dd_deadline', 'earnest_due_date', 'title_objection_date', 'purchase_price', 'notes']
    const sets = [], args = []
    for (const f of WL) if (fields[f] !== undefined) { sets.push(`${f} = ?`); args.push(fields[f]) }
    if (!sets.length) return fail('No updatable fields provided')
    args.push(id)
    db.prepare(`UPDATE deals SET ${sets.join(', ')}, updated_at = datetime('now') WHERE id = ?`).run(...args)
    if (fields.stage && fields.stage !== existing.stage) {
      try { logActivity({ deal_id: id, type: 'status_change', summary: `Stage changed: ${existing.stage} → ${fields.stage}` }, ACTOR) } catch { /* noop */ }
    }
    try { generateCriticalDateTasks({ force: true, actor: ACTOR }) } catch { /* noop */ }
    return ok(db.prepare(`${DEAL_SELECT} WHERE d.id = ?`).get(id))
  })

  // Link (or unlink) a deal to its canonical property ──────────────────────────
  server.registerTool('link_deal_property', {
    description: 'Link a deal to an existing property so they share one page, or unlink it. Pass property_id to link, or property_id: null to unlink. Keeps all deal + property data on a single record.',
    inputSchema: { deal_id: z.number(), property_id: z.number().nullable() },
  }, async ({ deal_id, property_id }) => {
    const deal = db.prepare('SELECT id FROM deals WHERE id = ?').get(deal_id)
    if (!deal) return fail('Deal not found')
    if (property_id != null) {
      const prop = db.prepare('SELECT id FROM properties WHERE id = ?').get(property_id)
      if (!prop) return fail('Property not found')
    }
    db.prepare('UPDATE deals SET property_id = ?, updated_at = datetime(\'now\') WHERE id = ?').run(property_id ?? null, deal_id)
    return ok(db.prepare(`${DEAL_SELECT} WHERE d.id = ?`).get(deal_id))
  })

  // Property-data integrity audit (read-only) ──────────────────────────────────
  server.registerTool('audit_property_data', {
    description: 'Audit whether property data is consolidated on one record. Returns (a) duplicate_properties — groups of property rows sharing a normalized address, and (b) unlinked_deals — active deals with no property_id and whether an existing property matches their address. Read-only.',
    inputSchema: {},
  }, async () => {
    // (a) Duplicate property rows: group by normalized street|city|state (ignore zip).
    const props = db.prepare('SELECT id, address, city, state, zip, is_portfolio, listing_status FROM properties').all()
    const groups = new Map()
    for (const p of props) {
      const key = normalizeAddr(p.address || '', p.city || '', p.state || '', '')
      if (!key) continue
      if (!groups.has(key)) groups.set(key, [])
      groups.get(key).push(p)
    }
    const duplicate_properties = [...groups.values()]
      .filter(g => g.length > 1)
      .map(g => ({ address: `${g[0].address}, ${g[0].city || ''} ${g[0].state || ''}`.trim(), count: g.length, ids: g.map(x => x.id) }))

    // (b) Unlinked active deals, with any address match.
    const deals = db.prepare(`
      SELECT id, address, city, state, tenant, direction, stage FROM deals
      WHERE property_id IS NULL AND address IS NOT NULL AND TRIM(address) <> ''
        AND (status IS NULL OR status = 'active')
    `).all()
    const unlinked_deals = deals.map(d => {
      const key = normalizeAddr(d.address, d.city || '', d.state || '', '')
      const matches = key ? db.prepare('SELECT id FROM properties WHERE addr_key = ? OR addr_key LIKE ? LIMIT 5').all(key, key + '|%') : []
      return {
        deal_id: d.id, address: `${d.address}, ${d.city || ''} ${d.state || ''}`.trim(),
        tenant: d.tenant, direction: d.direction, stage: d.stage,
        matching_property_ids: matches.map(m => m.id),
        resolution: matches.length === 1 ? 'auto-linkable' : matches.length > 1 ? 'ambiguous — pick one' : 'no property exists — create one',
      }
    })

    return ok({
      summary: {
        duplicate_property_groups: duplicate_properties.length,
        unlinked_active_deals: unlinked_deals.length,
        auto_linkable: unlinked_deals.filter(d => d.resolution === 'auto-linkable').length,
      },
      duplicate_properties,
      unlinked_deals,
    })
  })

  // Dry-run merge plan (READ-ONLY) ─────────────────────────────────────────────
  server.registerTool('merge_duplicates_dry_run', {
    description: "Plan how duplicate property rows would be merged onto one canonical record — READ-ONLY, writes nothing. Returns the keeper per address group, the duplicate ids, how many child rows (deals/leases/taxes/insurance/investors/docs/timeline) would move, and review flags (test_seed, suite_or_unit, multiple_portfolio, mixed_sold_status, child_collision) that make a group unsafe to auto-merge. Optional 'only': 'all' (default), 'clean' (auto-mergeable), or 'review'.",
    inputSchema: { only: z.enum(['all', 'clean', 'review']).optional() },
  }, async ({ only = 'all' }) => {
    const plan = planMerge()
    let groups = plan.groups
    if (only === 'clean')  groups = groups.filter(g => !g.needs_review)
    if (only === 'review') groups = groups.filter(g => g.needs_review)
    return ok({ summary: plan.summary, shown: groups.length, groups })
  })

  return server
}

// ── Stateless Streamable HTTP handler ─────────────────────────────────────────
// A fresh server + transport per request (sessionIdGenerator: undefined), so
// there's no session state to lose on a restart and no "unknown session" to
// reject — each POST is self-contained. Auth is enforced here: the handshake and
// tool discovery (initialize, tools/list, ping) are open so claude.ai's URL
// validation sees a live server, but tools/call requires the key.
export async function handleMcp(req, res) {
  const msgs = Array.isArray(req.body) ? req.body : [req.body]
  const needsAuth = msgs.some(m => m && m.method === 'tools/call')
  if (needsAuth && !hasClaudeToken(req)) {
    const hdr = req.get('x-api-key') ? 'x-api-key' : req.get('authorization') ? 'authorization' : 'none'
    console.warn(`[mcp] 401 on tools/call — auth header: ${hdr}`)   // never logs the key value
    return res.status(401).json({
      jsonrpc: '2.0', id: (req.body && req.body.id) ?? null,
      error: { code: -32001, message: 'Unauthorized — set the X-Api-Key header to call tools.' },
    })
  }
  const server = buildServer()
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined })
  res.on('close', () => { transport.close().catch(() => {}); server.close().catch(() => {}) })
  try {
    await server.connect(transport)
    await transport.handleRequest(req, res, req.body)
  } catch (e) {
    console.error('[mcp] error:', e.message)
    if (!res.headersSent) res.status(500).json({ jsonrpc: '2.0', id: null, error: { code: -32603, message: 'Internal server error' } })
  }
}
