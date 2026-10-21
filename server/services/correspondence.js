// Correspondence — deal/property activity timeline, email↔deal linking, parties,
// the unmatched queue, and the get_deal_context aggregator. Framework-agnostic so
// the REST routes and the MCP tools share one implementation.
import db from '../db.js'
import { allCriticalDates } from './criticalDates.js'
import { listTasks } from './taskStore.js'

const ACTIVITY_TYPES = ['email', 'note', 'status_change', 'document', 'call', 'task_completed', 'system']

// ── Activity timeline ─────────────────────────────────────────────────────────
export function logActivity(a = {}, actor = 'system') {
  if (!a.deal_id && !a.property_id) return { error: 'deal_id or property_id is required' }
  if (!a.type || !ACTIVITY_TYPES.includes(a.type)) return { error: `type must be one of: ${ACTIVITY_TYPES.join(', ')}` }

  // Dedupe: one timeline entry per Gmail message.
  if (a.gmail_message_id) {
    const existing = db.prepare('SELECT * FROM deal_activity WHERE gmail_message_id = ?').get(a.gmail_message_id)
    if (existing) return { entry: existing, deduped: true }
  }
  const r = db.prepare(`
    INSERT INTO deal_activity
      (deal_id, property_id, type, summary, detail, gmail_thread_id, gmail_message_id,
       participants, occurred_at, created_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    a.deal_id != null ? Number(a.deal_id) : null,
    a.property_id != null ? Number(a.property_id) : null,
    a.type, a.summary || null, a.detail || null,
    a.gmail_thread_id || null, a.gmail_message_id || null,
    a.participants || null, a.occurred_at || new Date().toISOString(), actor,
  )
  return { entry: db.prepare('SELECT * FROM deal_activity WHERE id = ?').get(r.lastInsertRowid) }
}

export function listActivity(f = {}) {
  const where = [], args = []
  if (f.deal_id)     { where.push('deal_id = ?');     args.push(Number(f.deal_id)) }
  if (f.property_id) { where.push('property_id = ?'); args.push(Number(f.property_id)) }
  if (f.type && ACTIVITY_TYPES.includes(f.type)) { where.push('type = ?'); args.push(f.type) }
  if (f.since)       { where.push('occurred_at >= ?'); args.push(f.since) }
  return db.prepare(`
    SELECT * FROM deal_activity
    ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
    ORDER BY occurred_at DESC, id DESC
    LIMIT ${Number(f.limit) > 0 ? Number(f.limit) : 200}
  `).all(...args)
}

// ── Email thread links ────────────────────────────────────────────────────────
export function getThreadLink(gmail_thread_id) {
  return db.prepare('SELECT * FROM email_thread_links WHERE gmail_thread_id = ?').get(gmail_thread_id) || null
}

export function linkEmailThread(l = {}, actor = 'claude') {
  if (!l.gmail_thread_id) return { error: 'gmail_thread_id is required' }
  if (!l.deal_id && !l.property_id) return { error: 'deal_id or property_id is required' }
  const deal_id = l.deal_id != null ? Number(l.deal_id) : null
  const property_id = l.property_id != null ? Number(l.property_id) : null
  db.prepare(`
    INSERT INTO email_thread_links (gmail_thread_id, deal_id, property_id, linked_by, confidence)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(gmail_thread_id) DO UPDATE SET
      deal_id = excluded.deal_id, property_id = excluded.property_id,
      linked_by = excluded.linked_by, confidence = excluded.confidence
  `).run(l.gmail_thread_id, deal_id, property_id, l.linked_by || actor, l.confidence ?? null)
  const link = getThreadLink(l.gmail_thread_id)
  // Record the link on the timeline.
  logActivity({
    deal_id, property_id, type: 'system',
    summary: `Email thread linked (${l.linked_by || actor})`,
    gmail_thread_id: l.gmail_thread_id,
  }, actor)
  return { link }
}

/**
 * Attribute an incoming Gmail message to whatever deal/property its thread is
 * linked to, as a timeline entry (deduped by message id). Returns the entry or
 * null if the thread isn't linked. Called by gmailSync for future messages.
 */
export function attributeEmail(msg = {}, actor = 'auto') {
  if (!msg.gmail_thread_id) return null
  const link = getThreadLink(msg.gmail_thread_id)
  if (!link) return null
  const r = logActivity({
    deal_id: link.deal_id, property_id: link.property_id, type: 'email',
    summary: msg.summary || msg.subject || '(email)',
    detail: msg.body_preview || null,
    gmail_thread_id: msg.gmail_thread_id, gmail_message_id: msg.gmail_message_id || null,
    participants: [msg.from_address, msg.to_address].filter(Boolean).join(' → ') || null,
    occurred_at: msg.date || null,
  }, actor)
  return r.entry || null
}

// ── Parties ───────────────────────────────────────────────────────────────────
export function listParties(f = {}) {
  const where = [], args = []
  if (f.deal_id)     { where.push('dp.deal_id = ?');     args.push(Number(f.deal_id)) }
  if (f.property_id) { where.push('dp.property_id = ?'); args.push(Number(f.property_id)) }
  if (!where.length) return []
  return db.prepare(`
    SELECT dp.id, dp.deal_id, dp.property_id, dp.role, dp.person_id,
           pe.name AS person_name, pe.email AS person_email, pe.phone AS person_phone
    FROM deal_parties dp JOIN people pe ON pe.id = dp.person_id
    WHERE ${where.join(' OR ')}
    ORDER BY dp.role, pe.name
  `).all(...args)
}

export function addParty(p = {}) {
  if (!p.person_id) return { error: 'person_id is required' }
  if (!p.deal_id && !p.property_id) return { error: 'deal_id or property_id is required' }
  const r = db.prepare(`
    INSERT INTO deal_parties (deal_id, property_id, person_id, role) VALUES (?, ?, ?, ?)
  `).run(p.deal_id != null ? Number(p.deal_id) : null, p.property_id != null ? Number(p.property_id) : null,
    Number(p.person_id), p.role || null)
  return { party: db.prepare('SELECT * FROM deal_parties WHERE id = ?').get(r.lastInsertRowid) }
}

export function removeParty(id) {
  const r = db.prepare('DELETE FROM deal_parties WHERE id = ?').run(id)
  return { removed: r.changes > 0 }
}

// ── Unmatched queue ───────────────────────────────────────────────────────────
export function addUnmatched(u = {}, actor = 'claude') {
  if (u.gmail_message_id) {
    const existing = db.prepare('SELECT * FROM unmatched_emails WHERE gmail_message_id = ?').get(u.gmail_message_id)
    if (existing) return { entry: existing, deduped: true }
  }
  const r = db.prepare(`
    INSERT INTO unmatched_emails (gmail_thread_id, gmail_message_id, summary, from_address, subject, occurred_at, created_by)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(u.gmail_thread_id || null, u.gmail_message_id || null, u.summary || null,
    u.from_address || null, u.subject || null, u.occurred_at || new Date().toISOString(), actor)
  return { entry: db.prepare('SELECT * FROM unmatched_emails WHERE id = ?').get(r.lastInsertRowid) }
}

export function listUnmatched(status = 'pending') {
  return db.prepare(`SELECT * FROM unmatched_emails WHERE status = ? ORDER BY occurred_at DESC LIMIT 200`).all(status)
}

export function assignUnmatched(id, target = {}, actor = 'cole') {
  const u = db.prepare('SELECT * FROM unmatched_emails WHERE id = ?').get(id)
  if (!u) return { notFound: true }
  if (target.ignore) {
    db.prepare(`UPDATE unmatched_emails SET status = 'ignored' WHERE id = ?`).run(id)
    return { ignored: true }
  }
  if (!target.deal_id && !target.property_id) return { error: 'deal_id or property_id (or ignore) is required' }
  if (u.gmail_thread_id) linkEmailThread({ gmail_thread_id: u.gmail_thread_id, deal_id: target.deal_id, property_id: target.property_id, linked_by: actor, confidence: 1 }, actor)
  logActivity({
    deal_id: target.deal_id, property_id: target.property_id, type: 'email',
    summary: u.summary || u.subject || '(email)', gmail_thread_id: u.gmail_thread_id,
    gmail_message_id: u.gmail_message_id, participants: u.from_address, occurred_at: u.occurred_at,
  }, actor)
  db.prepare(`UPDATE unmatched_emails SET status = 'assigned' WHERE id = ?`).run(id)
  return { assigned: true }
}

// ── get_deal_context — everything about a deal/property in one call ────────────
export function resolveTarget({ deal_id, property_id, name } = {}) {
  if (deal_id) {
    const d = db.prepare('SELECT * FROM deals WHERE id = ?').get(Number(deal_id))
    if (d) return { deal: d, property_id: d.property_id || null }
  }
  if (property_id) {
    const p = db.prepare('SELECT * FROM properties WHERE id = ?').get(Number(property_id))
    if (p) {
      const d = db.prepare('SELECT * FROM deals WHERE property_id = ? ORDER BY created_at DESC LIMIT 1').get(p.id)
      return { deal: d || null, property: p, property_id: p.id }
    }
  }
  if (name) {
    const like = `%${String(name).trim()}%`
    const d = db.prepare(`
      SELECT d.* FROM deals d LEFT JOIN properties p ON p.id = d.property_id
      WHERE d.address LIKE ? OR d.city LIKE ? OR d.tenant LIKE ? OR d.title LIKE ? OR p.address LIKE ? OR p.city LIKE ?
      ORDER BY d.created_at DESC LIMIT 1
    `).get(like, like, like, like, like, like)
    if (d) return { deal: d, property_id: d.property_id || null }
    const p = db.prepare(`SELECT * FROM properties WHERE address LIKE ? OR city LIKE ? OR display_name LIKE ? LIMIT 1`).get(like, like, like)
    if (p) return { property: p, property_id: p.id }
  }
  return null
}

function summarize(txt, max = 600) {
  if (!txt) return null
  const s = String(txt)
  return s.length > max ? s.slice(0, max) + '…' : s
}

export function getDealContext(sel = {}) {
  const t = resolveTarget(sel)
  if (!t) return { error: 'No matching deal or property' }
  const deal = t.deal || null
  const property_id = t.property_id || (t.property && t.property.id) || null
  const property = t.property || (property_id ? db.prepare('SELECT * FROM properties WHERE id = ?').get(property_id) : null)
  const deal_id = deal ? deal.id : null

  // Critical dates for this deal/property (open only)
  const critical_dates = allCriticalDates().filter(c => !c.done &&
    ((deal_id && c.entity_type === 'deal' && c.entity_id === deal_id) ||
     (property_id && c.entity_type === 'property' && c.entity_id === property_id)))

  // Open tasks
  const tasks = [
    ...(deal_id ? listTasks({ deal_id }) : []),
    ...(property_id ? listTasks({ property_id }) : []),
  ]

  const parties = listParties({ deal_id, property_id })
  const timeline = listActivity({ deal_id, property_id, since: new Date(Date.now() - 30 * 86400000).toISOString() })

  // Linked threads + latest summary per thread
  let threads = []
  if (deal_id || property_id) {
    const conds = [], args = []
    if (deal_id)     { conds.push('deal_id = ?');     args.push(deal_id) }
    if (property_id) { conds.push('property_id = ?'); args.push(property_id) }
    const linkRows = db.prepare(`SELECT gmail_thread_id, linked_by FROM email_thread_links WHERE ${conds.join(' OR ')}`).all(...args)
    threads = linkRows.map(l => {
      const latest = db.prepare(`SELECT summary, occurred_at FROM deal_activity WHERE gmail_thread_id = ? ORDER BY occurred_at DESC LIMIT 1`).get(l.gmail_thread_id)
      return { gmail_thread_id: l.gmail_thread_id, linked_by: l.linked_by, latest_summary: latest?.summary || null, latest_at: latest?.occurred_at || null }
    })
  }

  return {
    deal: deal && {
      id: deal.id, address: deal.address, city: deal.city, state: deal.state, tenant: deal.tenant,
      stage: deal.stage, direction: deal.direction,
      purchase_price: deal.purchase_price || deal.offer_price, close_date: deal.close_date,
      dd_deadline: deal.dd_deadline, earnest_due_date: deal.earnest_due_date,
      psa_abstract: summarize(deal.psa_abstract), lease_abstract: summarize(deal.lease_abstract),
    },
    property: property && {
      id: property.id, address: property.address, city: property.city, state: property.state,
      lease_end: property.lease_end, maturity_date: property.maturity_date,
    },
    parties, critical_dates, open_tasks: tasks, timeline, linked_threads: threads,
  }
}
