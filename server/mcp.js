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
  listParties, addParty,
} from './services/correspondence.js'
import { normalizeAddr } from './utils/normalize.js'
import { planMerge } from './services/propertyMerge.js'
import { findPropertyIdByAddr, closeDeal } from './routes/deals.js'

const ACTOR = 'claude'

function coleId() {
  const u = db.prepare(`SELECT id FROM users WHERE lower(email) = 'cole@knoxcre.com'`).get()
    || db.prepare(`SELECT id FROM users WHERE role = 'admin' ORDER BY id LIMIT 1`).get()
  return u ? u.id : null
}

const ok   = (data) => ({ content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] })
const fail = (msg)  => ({ content: [{ type: 'text', text: `Error: ${msg}` }], isError: true })

// Find-or-create a tenant brand by name → id (mirrors how the deal/property paths link brands).
function findOrCreateTenantBrand(name) {
  const n = String(name || '').trim()
  if (!n) return null
  const b = db.prepare('SELECT id FROM tenant_brands WHERE name = ? COLLATE NOCASE').get(n)
  return b ? b.id : Number(db.prepare('INSERT INTO tenant_brands (name) VALUES (?)').run(n).lastInsertRowid)
}

// Find-or-create a company (a people row, role owner_company) → id, for a party's company.
function findOrCreateCompany(name) {
  const n = String(name || '').trim()
  if (!n) return null
  const c = db.prepare("SELECT id FROM people WHERE name = ? COLLATE NOCASE AND role = 'owner_company' LIMIT 1").get(n)
  return c ? c.id : Number(db.prepare("INSERT INTO people (name, role) VALUES (?, 'owner_company')").run(n).lastInsertRowid)
}

// Party role (free text on deal_parties.role) → the coarse people.role the CHECK allows.
function peopleRoleFor(partyRole) {
  const r = String(partyRole || '').toLowerCase()
  if (r.includes('broker')) return 'broker'
  if (r === 'tenant_contact') return 'tenant_contact'
  return 'owner'
}

// Find-or-create a person. Dedupes on email first, then exact name. Fills only BLANK
// contact fields on an existing person (never clobbers). Returns the people.id.
function findOrCreatePerson({ name, email, phone, notes, company, role }) {
  const nm = String(name || '').trim()
  let person = null
  if (email) person = db.prepare('SELECT * FROM people WHERE email = ? COLLATE NOCASE LIMIT 1').get(email)
  if (!person && nm) person = db.prepare('SELECT * FROM people WHERE name = ? COLLATE NOCASE LIMIT 1').get(nm)
  const companyId = company ? findOrCreateCompany(company) : null
  if (person) {
    const sets = [], args = []
    if (email && !person.email)          { sets.push('email = ?');      args.push(email) }
    if (phone && !person.phone)          { sets.push('phone = ?');      args.push(phone) }
    if (notes && !person.notes)          { sets.push('notes = ?');      args.push(notes) }
    if (companyId && !person.company_id) { sets.push('company_id = ?'); args.push(companyId) }
    if (sets.length) { args.push(person.id); db.prepare(`UPDATE people SET ${sets.join(', ')} WHERE id = ?`).run(...args) }
    return person.id
  }
  const r = db.prepare('INSERT INTO people (name, role, email, phone, notes, company_id) VALUES (?, ?, ?, ?, ?, ?)')
    .run(nm, peopleRoleFor(role), email || null, phone || null, notes || null, companyId)
  return Number(r.lastInsertRowid)
}

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

  // ── Deal & property writes (create/close/sell/update) ─────────────────────────
  // All write as actor 'claude', log every write to the timeline, whitelist fields,
  // and never hard-delete. Address matching reuses findPropertyIdByAddr, so a deal,
  // its portfolio property, and its market record all resolve to ONE properties.id.

  server.registerTool('create_deal', {
    description: 'Create a pipeline deal. direction purchase|sale. SALE requires an owned portfolio property (pass property_id or an address that matches one). PURCHASE links to a matching property if one exists, else stays unlinked (the property is created at closing). Dedupes: an active deal for the same property/address + direction is returned instead of a second one. Logs "Deal created (claude)" to the timeline.',
    inputSchema: {
      direction: z.enum(['purchase', 'sale']),
      address: z.string().optional(), city: z.string().optional(), state: z.string().optional(),
      tenant: z.string().optional(), stage: z.string().optional(),
      purchase_price: z.number().optional(), property_id: z.number().optional(),
      close_date: z.string().optional(), dd_deadline: z.string().optional(),
      earnest_due_date: z.string().optional(), title_objection_date: z.string().optional(),
      earnest_money: z.number().optional(), notes: z.string().optional(),
    },
  }, async (a) => {
    const direction = a.direction
    let propertyId = a.property_id ?? null
    if (propertyId == null && a.address) propertyId = findPropertyIdByAddr(a.address, a.city, a.state, '')
    if (propertyId != null) {
      const prop = db.prepare('SELECT id, is_portfolio FROM properties WHERE id = ?').get(propertyId)
      if (!prop) return fail(`Property ${propertyId} not found`)
      if (direction === 'sale' && !prop.is_portfolio) return fail('A sale must be linked to an owned portfolio property.')
    }
    if (direction === 'sale' && propertyId == null)
      return fail('A sale needs an owned portfolio property — pass property_id, or an address that matches one.')
    if (propertyId == null && !a.address) return fail('address or property_id is required')

    // Dedupe: an existing active deal for the same property/address + direction.
    let dupe = null
    if (propertyId != null) {
      dupe = db.prepare(`SELECT id FROM deals WHERE direction = ? AND property_id = ? AND COALESCE(status,'active') = 'active' ORDER BY id LIMIT 1`).get(direction, propertyId)
    }
    if (!dupe && a.address) {
      dupe = db.prepare(`SELECT id FROM deals WHERE direction = ? AND COALESCE(status,'active') = 'active' AND address IS NOT NULL AND LOWER(TRIM(address)) = LOWER(TRIM(?)) ORDER BY id LIMIT 1`).get(direction, a.address)
    }
    if (dupe) return ok({ deduped: true, ...db.prepare(`${DEAL_SELECT} WHERE d.id = ?`).get(dupe.id) })

    const stage = a.stage || 'loi'
    const r = db.prepare(`
      INSERT INTO deals (property_id, direction, stage, address, city, state, tenant, purchase_price,
                         close_date, dd_deadline, earnest_due_date, title_objection_date, earnest_money, notes,
                         status, source, created_at, updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?, 'active', 'claude', datetime('now'), datetime('now'))
    `).run(propertyId, direction, stage, a.address || null, a.city || null, a.state || null, a.tenant || null,
           a.purchase_price ?? null, a.close_date || null, a.dd_deadline || null, a.earnest_due_date || null,
           a.title_objection_date || null, a.earnest_money ?? null, a.notes || null)
    const dealId = Number(r.lastInsertRowid)
    try { logActivity({ deal_id: dealId, type: 'note', summary: 'Deal created (claude)' }, ACTOR) } catch { /* noop */ }
    try { generateCriticalDateTasks({ force: true, actor: ACTOR }) } catch { /* noop */ }
    return ok(db.prepare(`${DEAL_SELECT} WHERE d.id = ?`).get(dealId))
  })

  server.registerTool('close_deal', {
    description: 'Close a deal, running the same logic as the UI close so dashboards + Historical stay consistent. PURCHASE: creates/activates the portfolio property (is_portfolio=1), carries the deal\'s tenant/address/lease fields onto it, and links the deal. SALE: marks the deal closed and the linked property sold (drops off list_properties, lands in Historical with sale price + date). Reversible from the UI (deal restore / property sold toggle). Refuses if already closed or dropped. Logs to the timeline.',
    inputSchema: {
      deal_id: z.number(), actual_close_date: z.string().optional(),
      final_price: z.number().optional(), notes: z.string().optional(),
    },
  }, async ({ deal_id, actual_close_date, final_price, notes }) => {
    const d = db.prepare('SELECT id, status, direction, property_id FROM deals WHERE id = ?').get(deal_id)
    if (!d) return fail('Deal not found')
    if (d.status === 'closed')  return fail('Deal is already closed.')
    if (d.status === 'dropped') return fail('Deal is dropped — restore it before closing.')
    const today = new Date().toISOString().slice(0, 10)

    // Record close date / final price / notes on the deal first (append notes, never overwrite).
    if (actual_close_date) db.prepare('UPDATE deals SET close_date = ? WHERE id = ?').run(actual_close_date, deal_id)
    if (final_price != null) db.prepare('UPDATE deals SET purchase_price = ? WHERE id = ?').run(final_price, deal_id)
    if (notes) {
      const cur = db.prepare('SELECT notes FROM deals WHERE id = ?').get(deal_id)?.notes
      db.prepare('UPDATE deals SET notes = ? WHERE id = ?').run(cur ? `${cur}\n${notes}` : notes, deal_id)
    }

    if (d.direction === 'sale') {
      const pid = d.property_id
      db.prepare("UPDATE deals SET status = 'closed' WHERE id = ?").run(deal_id)
      const changed = { deal_id, direction: 'sale', property_id: pid || null, marked_sold: false }
      if (pid) {
        db.prepare(`UPDATE properties SET listing_status = 'sold', sold_date = ?, sale_price = COALESCE(?, sale_price) WHERE id = ?`)
          .run(actual_close_date || today, final_price ?? null, pid)
        changed.marked_sold = true
        try { logActivity({ property_id: pid, type: 'system', summary: `Sold — closed sale deal #${deal_id}${final_price != null ? ` at $${Math.round(final_price).toLocaleString()}` : ''} (claude)` }, ACTOR) } catch { /* noop */ }
      }
      try { logActivity({ deal_id, type: 'status_change', summary: 'Deal closed (sale) (claude)' }, ACTOR) } catch { /* noop */ }
      try { generateCriticalDateTasks({ force: true, actor: ACTOR }) } catch { /* noop */ }
      return ok(changed)
    }

    // PURCHASE → portfolio migration via the shared UI close logic.
    const r = closeDeal(deal_id)
    if (r.notFound) return fail('Deal not found')
    try { logActivity({ deal_id, type: 'status_change', summary: 'Deal closed (purchase) → portfolio (claude)' }, ACTOR) } catch { /* noop */ }
    if (r.property_id) { try { logActivity({ property_id: r.property_id, type: 'system', summary: `Activated in portfolio from closed deal #${deal_id} (claude)` }, ACTOR) } catch { /* noop */ } }
    try { generateCriticalDateTasks({ force: true, actor: ACTOR }) } catch { /* noop */ }
    return ok({ deal_id, direction: 'purchase', property_id: r.property_id || null, migrated: true })
  })

  server.registerTool('mark_property_sold', {
    description: 'Mark an owned property sold outside the pipeline (no deal). Sets listing_status=sold + sold_date + sale_price, so it drops off list_properties/Property Management and lands in Historical. Reversible from the UI (sold toggle). Logs to the timeline.',
    inputSchema: {
      property_id: z.number(), sale_date: z.string(),
      sale_price: z.number().optional(), buyer: z.string().optional(), notes: z.string().optional(),
    },
  }, async (a) => {
    const p = db.prepare('SELECT id, listing_status FROM properties WHERE id = ?').get(a.property_id)
    if (!p) return fail('Property not found')
    if (p.listing_status === 'sold') return fail('Property is already marked sold.')
    db.prepare(`UPDATE properties SET listing_status = 'sold', sold_date = ?, sale_price = COALESCE(?, sale_price) WHERE id = ?`)
      .run(a.sale_date, a.sale_price ?? null, a.property_id)
    const bits = [a.buyer && `buyer ${a.buyer}`, a.sale_price != null && `$${Math.round(a.sale_price).toLocaleString()}`, a.notes].filter(Boolean)
    try { logActivity({ property_id: a.property_id, type: 'system', summary: `Marked sold ${a.sale_date}${bits.length ? ` — ${bits.join(' · ')}` : ''} (claude)` }, ACTOR) } catch { /* noop */ }
    return ok(db.prepare('SELECT id, address, city, state, listing_status, sold_date, sale_price FROM properties WHERE id = ?').get(a.property_id))
  })

  server.registerTool('create_property', {
    description: 'Create a property record. Normalizes the address and, if it duplicates an existing property, returns that existing one instead of a twin (deduped:true). is_portfolio defaults false. Logs "Property created (claude)" to the timeline.',
    inputSchema: {
      address: z.string(), city: z.string().optional(), state: z.string().optional(),
      tenant: z.string().optional(), is_portfolio: z.boolean().optional(),
      lease_end: z.string().optional(), notes: z.string().optional(),
    },
  }, async (a) => {
    const address = String(a.address || '').trim()
    if (!address) return fail('address is required')
    const existingId = findPropertyIdByAddr(address, a.city, a.state, '')
    if (existingId) return ok({ deduped: true, ...db.prepare('SELECT id, address, city, state, is_portfolio, listing_status FROM properties WHERE id = ?').get(existingId) })
    const tenantBrandId = a.tenant ? findOrCreateTenantBrand(a.tenant) : null
    const r = db.prepare(`
      INSERT INTO properties (address, city, state, tenant_brand_id, is_portfolio, lease_end, notes, addr_key)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(address, a.city || null, a.state || null, tenantBrandId, a.is_portfolio ? 1 : 0,
           a.lease_end || null, a.notes || null, normalizeAddr(address, a.city || '', a.state || '', '') || null)
    const id = Number(r.lastInsertRowid)
    try { logActivity({ property_id: id, type: 'system', summary: 'Property created (claude)' }, ACTOR) } catch { /* noop */ }
    return ok(db.prepare('SELECT id, address, city, state, is_portfolio, lease_end FROM properties WHERE id = ?').get(id))
  })

  server.registerTool('update_property', {
    description: 'Update whitelisted property fields: tenant, lease_end, maturity_date, notes, listing_status (e.g. listed, under_contract). No address changes, merges or deletes. To mark a property sold use mark_property_sold (not listing_status=sold). Logs to the timeline.',
    inputSchema: {
      property_id: z.number(),
      tenant: z.string().optional(), lease_end: z.string().optional(),
      maturity_date: z.string().optional(), notes: z.string().optional(),
      listing_status: z.string().optional(),
    },
  }, async (a) => {
    const p = db.prepare('SELECT id FROM properties WHERE id = ?').get(a.property_id)
    if (!p) return fail('Property not found')
    if (a.listing_status && a.listing_status.toLowerCase() === 'sold')
      return fail('Use mark_property_sold to record a sale (it sets the sold date + price and Historical).')
    const sets = [], args = [], changed = []
    if (a.tenant !== undefined) { sets.push('tenant_brand_id = ?'); args.push(a.tenant ? findOrCreateTenantBrand(a.tenant) : null); changed.push('tenant') }
    for (const f of ['lease_end', 'maturity_date', 'notes', 'listing_status']) {
      if (a[f] !== undefined) { sets.push(`${f} = ?`); args.push(a[f]); changed.push(f) }
    }
    if (!sets.length) return fail('No updatable fields provided')
    args.push(a.property_id)
    db.prepare(`UPDATE properties SET ${sets.join(', ')} WHERE id = ?`).run(...args)
    try { logActivity({ property_id: a.property_id, type: 'note', summary: `Updated ${changed.join(', ')} (claude)` }, ACTOR) } catch { /* noop */ }
    return ok(db.prepare('SELECT id, address, lease_end, maturity_date, listing_status FROM properties WHERE id = ?').get(a.property_id))
  })

  // Parties — contacts (People) with a role on a deal or property ────────────────
  server.registerTool('list_parties', {
    description: 'List the parties (contacts + roles) on a deal or property. Pass deal_id or property_id.',
    inputSchema: { deal_id: z.number().optional(), property_id: z.number().optional() },
  }, async (a) => {
    if (!a.deal_id && !a.property_id) return fail('deal_id or property_id is required')
    return ok(listParties(a))
  })

  server.registerTool('add_party', {
    description: 'Add a contact to a deal or property with a role (buyer, seller, buyer_broker, listing_broker, title, escrow, lender, attorney, tenant_contact, contractor, insurer, other). Dedupes on email + entity: if the person is already on that deal/property, updates their record instead of adding a duplicate. Logs to the timeline.',
    inputSchema: {
      deal_id: z.number().optional(), property_id: z.number().optional(),
      name: z.string(), company: z.string().optional(),
      role: z.enum(['buyer', 'seller', 'buyer_broker', 'listing_broker', 'title', 'escrow', 'lender', 'attorney', 'tenant_contact', 'contractor', 'insurer', 'other']).optional(),
      email: z.string().optional(), phone: z.string().optional(), notes: z.string().optional(),
    },
  }, async (a) => {
    if (!a.deal_id && !a.property_id) return fail('deal_id or property_id is required')
    if (!String(a.name || '').trim()) return fail('name is required')
    if (a.deal_id && !db.prepare('SELECT id FROM deals WHERE id = ?').get(a.deal_id)) return fail('Deal not found')
    if (a.property_id && !db.prepare('SELECT id FROM properties WHERE id = ?').get(a.property_id)) return fail('Property not found')
    const personId = findOrCreatePerson({ name: a.name, email: a.email, phone: a.phone, notes: a.notes, company: a.company, role: a.role })
    const col = a.deal_id ? 'deal_id' : 'property_id'
    const entId = a.deal_id ?? a.property_id
    const existing = db.prepare(`SELECT id FROM deal_parties WHERE ${col} = ? AND person_id = ?`).get(entId, personId)
    if (existing) {
      if (a.role) db.prepare('UPDATE deal_parties SET role = ? WHERE id = ?').run(a.role, existing.id)
      return ok({ updated: true, ...listParties({ deal_id: a.deal_id, property_id: a.property_id }).find(x => x.id === existing.id) })
    }
    const r = addParty({ deal_id: a.deal_id, property_id: a.property_id, person_id: personId, role: a.role })
    if (r.error) return fail(r.error)
    try { logActivity({ deal_id: a.deal_id, property_id: a.property_id, type: 'note', summary: `Added ${a.role || 'party'} ${a.name} (claude)` }, ACTOR) } catch { /* noop */ }
    return ok(listParties({ deal_id: a.deal_id, property_id: a.property_id }).find(x => x.id === r.party.id) || r.party)
  })

  server.registerTool('update_party', {
    description: "Update a party's role, or the person's phone, company or notes. Pass party_id (from list_parties).",
    inputSchema: {
      party_id: z.number(), role: z.string().optional(),
      phone: z.string().optional(), company: z.string().optional(), notes: z.string().optional(),
    },
  }, async (a) => {
    const party = db.prepare('SELECT * FROM deal_parties WHERE id = ?').get(a.party_id)
    if (!party) return fail('Party not found')
    if (a.role !== undefined) db.prepare('UPDATE deal_parties SET role = ? WHERE id = ?').run(a.role, a.party_id)
    const psets = [], pargs = []
    if (a.phone !== undefined)   { psets.push('phone = ?');      pargs.push(a.phone || null) }
    if (a.notes !== undefined)   { psets.push('notes = ?');      pargs.push(a.notes || null) }
    if (a.company !== undefined) { psets.push('company_id = ?'); pargs.push(a.company ? findOrCreateCompany(a.company) : null) }
    if (psets.length) { pargs.push(party.person_id); db.prepare(`UPDATE people SET ${psets.join(', ')} WHERE id = ?`).run(...pargs) }
    return ok(listParties({ deal_id: party.deal_id, property_id: party.property_id }).find(x => x.id === a.party_id))
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
