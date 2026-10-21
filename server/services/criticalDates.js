// Critical dates — the single source of truth for the CRM's deadlines.
//
// Critical dates are DERIVED (computed from deal/property date fields), not a
// stored table. Each one is identified by the composite key
//   `${entity_type}:${entity_id}:${kind}:${date}`
// which is stable as long as the underlying date doesn't move (if it moves, the
// old key stops matching and the item re-surfaces — same contract the dashboard
// completion table already relies on). That key is what we store on a task as
// `critical_date_id` to link the two and keep them in sync both ways.
import db from '../db.js'

// ── Small shared helpers ──────────────────────────────────────────────────────
function getSetting(key, fallback = null) {
  const row = db.prepare('SELECT value FROM app_settings WHERE key = ?').get(key)
  return row ? row.value : fallback
}
function setSetting(key, value) {
  db.prepare(`INSERT INTO app_settings (key, value) VALUES (?, ?)
              ON CONFLICT(key) DO UPDATE SET value = excluded.value`).run(key, String(value))
}

export function keyOf(it) {
  return `${it.entity_type}:${it.entity_id}:${it.kind}:${it.date}`
}
export function parseCriticalDateKey(id) {
  const parts = String(id).split(':')
  if (parts.length !== 4) return null
  const [entity_type, eid, kind, date] = parts
  const entity_id = Number(eid)
  if (!entity_type || !Number.isFinite(entity_id) || !kind || !date) return null
  return { entity_type, entity_id, kind, date }
}

// ── Derivation ────────────────────────────────────────────────────────────────
// Ported from the dashboard route so there is ONE definition. Returns
// { deal, portfolio } arrays; each item carries a composite `id` and `done`.
export function computeCriticalDates() {
  const today = new Date(); today.setHours(0, 0, 0, 0)
  const MS = 86400000
  const parseDate = v => {
    if (!v) return null
    const m = String(v).match(/^(\d{4})-(\d{2})-(\d{2})/)
    let d = m ? new Date(+m[1], +m[2] - 1, +m[3]) : new Date(v)
    if (Number.isNaN(d.getTime())) return null
    d.setHours(0, 0, 0, 0)
    return d
  }
  const toISO = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  const mk = o => {
    const d = parseDate(o.date); if (!d) return null
    const daysUntil = Math.round((d - today) / MS)
    if (daysUntil < -60) return null
    const item = { ...o, date: toISO(d), daysUntil }
    item.id = keyOf(item)
    return item
  }

  // ── Deal bucket — deals actively under contract ──
  const deal = []
  const dealRows = db.prepare(`
    SELECT d.id, COALESCE(NULLIF(d.tenant,''), t.name, d.address, p.address, 'Deal') AS name,
           t.name AS brand, COALESCE(d.city, p.city) AS city,
           COALESCE(d.address, p.address) AS address, d.stage,
           d.effective_date, d.earnest_due_date, d.dd_deadline, d.title_objection_date, d.close_date
    FROM deals d
    LEFT JOIN properties p ON p.id = d.property_id
    LEFT JOIN tenant_brands t ON t.id = p.tenant_brand_id
    WHERE (d.status IS NULL OR d.status = 'active')
      AND d.stage IN ('psa_negotiation', 'under_contract', 'money_hard')
  `).all()
  for (const r of dealRows) {
    const base = { entity_type: 'deal', entity_id: r.id, entity_name: r.name, brand: r.brand || null, city: r.city || null, sub: r.address || null, stage: r.stage }
    const named = [
      ['effective_date',  'Effective date',             r.effective_date],
      ['earnest_due',     'Earnest money due',          r.earnest_due_date],
      ['dd_deadline',     'DD deadline — earnest hard',  r.dd_deadline],
      ['title_objection', 'Title objection deadline',   r.title_objection_date],
      ['closing',         'Closing',                    r.close_date],
    ]
    for (const [kind, label, date] of named) {
      const it = mk({ ...base, kind, label, date }); if (it) deal.push(it)
    }
  }
  const kindLabel = { survey: 'Survey', environmental: 'Environmental', pcr: 'PCR', other: 'Report' }
  const proposals = db.prepare(`
    SELECT dp.kind, dp.turnaround_days, d.id AS deal_id, d.dd_deadline,
           COALESCE(NULLIF(d.tenant,''), t.name, d.address, p.address, 'Deal') AS name,
           t.name AS brand, COALESCE(d.city, p.city) AS city, COALESCE(d.address, p.address) AS address
    FROM deal_proposals dp JOIN deals d ON d.id = dp.deal_id
    LEFT JOIN properties p ON p.id = d.property_id
    LEFT JOIN tenant_brands t ON t.id = p.tenant_brand_id
    WHERE (d.status IS NULL OR d.status = 'active') AND d.stage IN ('psa_negotiation', 'under_contract', 'money_hard')
      AND dp.turnaround_days IS NOT NULL AND d.dd_deadline IS NOT NULL
  `).all()
  for (const r of proposals) {
    const m = String(r.dd_deadline).match(/^(\d{4})-(\d{2})-(\d{2})/); if (!m) continue
    const od = new Date(+m[1], +m[2] - 1, +m[3]); od.setDate(od.getDate() - r.turnaround_days)
    const iso = `${od.getFullYear()}-${String(od.getMonth() + 1).padStart(2, '0')}-${String(od.getDate()).padStart(2, '0')}`
    const it = mk({ entity_type: 'deal', entity_id: r.deal_id, entity_name: r.name, brand: r.brand || null, city: r.city || null, sub: r.address || null,
      kind: 'order_by', label: `Order ${kindLabel[r.kind] || 'report'} by`, date: iso })
    if (it) deal.push(it)
  }

  // ── Portfolio bucket ──
  const portfolio = []
  const props = db.prepare(`
    SELECT p.id, COALESCE(NULLIF(p.display_name,''), p.address) AS name, p.address, p.city,
           p.lease_end, p.maturity_date, t.name AS tenant
    FROM properties p LEFT JOIN tenant_brands t ON t.id = p.tenant_brand_id
    WHERE p.is_portfolio = 1
  `).all()
  for (const r of props) {
    const base = { entity_type: 'property', entity_id: r.id, entity_name: r.name, brand: r.tenant || null, city: r.city || null, sub: r.tenant || r.address || null }
    const le = mk({ ...base, kind: 'lease_expiration', label: 'Lease expiration', date: r.lease_end }); if (le) portfolio.push(le)
    const lm = mk({ ...base, kind: 'loan_maturity', label: 'Loan maturity', date: r.maturity_date }); if (lm) portfolio.push(lm)
  }
  const taxes = db.prepare(`
    SELECT pt.property_id AS id, pt.due_date, pt.tax_year, COALESCE(NULLIF(p.display_name,''), p.address) AS name, p.address, p.city, t.name AS tenant
    FROM property_taxes pt JOIN properties p ON p.id = pt.property_id LEFT JOIN tenant_brands t ON t.id = p.tenant_brand_id
    WHERE p.is_portfolio = 1 AND pt.due_date IS NOT NULL AND pt.paid_date IS NULL
  `).all()
  for (const r of taxes) {
    const it = mk({ entity_type: 'property', entity_id: r.id, entity_name: r.name, brand: r.tenant || null, city: r.city || null, sub: r.tenant || r.address || null,
      kind: 'tax_due', label: `Property tax due${r.tax_year ? ` (${r.tax_year})` : ''}`, date: r.due_date })
    if (it) portfolio.push(it)
  }
  const ins = db.prepare(`
    SELECT pi.property_id AS id, pi.expiry_date, pi.carrier, COALESCE(NULLIF(p.display_name,''), p.address) AS name, p.address, p.city, t.name AS tenant
    FROM property_insurance pi JOIN properties p ON p.id = pi.property_id LEFT JOIN tenant_brands t ON t.id = p.tenant_brand_id
    WHERE p.is_portfolio = 1 AND pi.expiry_date IS NOT NULL AND pi.expiry_date >= date('now', '-30 days')
  `).all()
  for (const r of ins) {
    const it = mk({ entity_type: 'property', entity_id: r.id, entity_name: r.name, brand: r.tenant || null, city: r.city || null, sub: r.carrier || r.tenant || null,
      kind: 'insurance_exp', label: 'Insurance expiration', date: r.expiry_date })
    if (it) portfolio.push(it)
  }
  const leases = db.prepare(`
    SELECT pl.property_id AS id, pl.abstract, COALESCE(NULLIF(p.display_name,''), p.address) AS name, p.city, t.name AS tenant
    FROM property_leases pl JOIN properties p ON p.id = pl.property_id LEFT JOIN tenant_brands t ON t.id = p.tenant_brand_id
    WHERE p.is_portfolio = 1 AND pl.abstract IS NOT NULL
  `).all()
  for (const r of leases) {
    let a; try { a = JSON.parse(r.abstract) } catch { continue }
    for (const kd of (a?.key_dates || [])) {
      const it = mk({ entity_type: 'property', entity_id: r.id, entity_name: r.name, brand: r.tenant || null, city: r.city || null, sub: r.tenant || null,
        kind: 'lease_key_date', label: kd.label || 'Lease key date', date: kd.date })
      if (it) portfolio.push(it)
    }
  }

  // Flag items the user has cleared. Keyed by the exact (type, id, kind, date).
  const doneRows = db.prepare(`SELECT entity_type, entity_id, kind, date FROM critical_date_completions`).all()
  const doneSet = new Set(doneRows.map(r => `${r.entity_type}:${r.entity_id}:${r.kind}:${r.date}`))
  const annotate = it => { it.done = doneSet.has(it.id); return it }
  deal.forEach(annotate); portfolio.forEach(annotate)

  const byDate = (a, b) => a.date < b.date ? -1 : a.date > b.date ? 1 : 0
  deal.sort(byDate); portfolio.sort(byDate)
  return { deal, portfolio }
}

/** Flat list of every current critical date (deal + portfolio). */
export function allCriticalDates() {
  const { deal, portfolio } = computeCriticalDates()
  return [...deal, ...portfolio]
}

// ── Lead windows: create a task this many days before the date ────────────────
export const LEAD_DAYS = {
  dd_deadline: 7, title_objection: 7,
  closing: 10,
  earnest_due: 3,
  tax_due: 30, insurance_exp: 30,
  lease_key_date: 60,            // renewal notice / option deadline
  lease_expiration: 90, loan_maturity: 90,
}

function defaultOwnerId() {
  const u = db.prepare(`SELECT id FROM users WHERE lower(email) = 'cole@knoxcre.com'`).get()
    || db.prepare(`SELECT id FROM users WHERE role = 'admin' ORDER BY id LIMIT 1`).get()
  return u ? u.id : null
}

function taskTitle(it) {
  if (it.kind === 'closing') return `Prep for ${it.entity_name} closing — insurance, wiring, closing docs`
  return `${it.label}${it.entity_name ? ` — ${it.entity_name}` : ''}`
}

// ── Generate tasks for critical dates inside their lead window ────────────────
// One open task per critical_date_id (deduped on critical_date_id). Throttled to
// 10 min on reads; pass force:true on writes / server start for immediate effect.
export function generateCriticalDateTasks({ force = false, actor = 'cole' } = {}) {
  if (!force) {
    const last = getSetting('cdt_last_generated')
    if (last && Date.now() - new Date(last).getTime() < 10 * 60 * 1000) return 0
  }
  setSetting('cdt_last_generated', new Date().toISOString())

  const owner = defaultOwnerId()
  const current = allCriticalDates()

  // Reconcile first: if a critical date's underlying date MOVED, its id changes.
  // Migrate the existing open task to the new id/date instead of leaving an
  // orphan and creating a duplicate (so editing a date never spawns a second).
  const currentIds = new Set(current.map(it => it.id))
  const byTriple = new Map()   // `${type}:${id}:${kind}` → soonest current item
  for (const it of current) {
    const triple = `${it.entity_type}:${it.entity_id}:${it.kind}`
    if (!byTriple.has(triple)) byTriple.set(triple, it)
  }
  const migrate = db.prepare(`UPDATE tasks SET critical_date_id = ?, source_ref = ?, due_date = ?,
                              updated_by = ?, updated_at = datetime('now') WHERE id = ?`)
  // Only migrate kinds that are unambiguously one-per-entity. tax_due / insurance_exp
  // / lease_key_date can have several per property (different bills/dates sharing the
  // same triple), so a moved one can't be matched safely — leave the old task as a
  // harmless orphan and let a fresh one be created.
  const SINGLE = new Set(['dd_deadline', 'title_objection', 'closing', 'earnest_due', 'effective_date', 'lease_expiration', 'loan_maturity'])
  const openCd = db.prepare(`SELECT id, critical_date_id FROM tasks WHERE source = 'critical_date' AND status IN ('open','waiting')`).all()
  for (const t of openCd) {
    if (currentIds.has(t.critical_date_id)) continue
    const k = parseCriticalDateKey(t.critical_date_id); if (!k || !SINGLE.has(k.kind)) continue
    const moved = byTriple.get(`${k.entity_type}:${k.entity_id}:${k.kind}`)
    if (moved) migrate.run(moved.id, moved.id, moved.date, actor, t.id)
  }

  const exists = db.prepare(`SELECT id FROM tasks WHERE critical_date_id = ? LIMIT 1`)
  const ins = db.prepare(`
    INSERT INTO tasks (title, status, priority, due_date, owner_id, deal_id, property_id,
                       source, source_ref, critical_date_id, created_by, updated_by)
    VALUES (?, 'open', ?, ?, ?, ?, ?, 'critical_date', ?, ?, ?, ?)
  `)

  let created = 0
  for (const it of current) {
    const lead = LEAD_DAYS[it.kind]
    if (lead == null) continue            // not a kind we auto-task
    if (it.done) continue                 // already cleared
    if (it.daysUntil > lead) continue     // not yet inside its window
    if (exists.get(it.id)) continue       // one task per critical_date_id (never duplicate)
    const priority = it.daysUntil < 0 ? 'high' : 'normal'
    const deal_id = it.entity_type === 'deal' ? it.entity_id : null
    const property_id = it.entity_type === 'property' ? it.entity_id : null
    ins.run(taskTitle(it), priority, it.date, owner, deal_id, property_id, it.id, it.id, actor, actor)
    created++
  }
  if (created) console.log(`[criticalDates] generated ${created} task(s) from critical dates`)
  return created
}

// ── Two-way sync ──────────────────────────────────────────────────────────────
/** Mark a critical date complete AND complete its linked open task. */
export function completeCriticalDate(id, actor = 'cole', userId = null) {
  const k = parseCriticalDateKey(id); if (!k) return false
  db.prepare(`INSERT OR IGNORE INTO critical_date_completions (entity_type, entity_id, kind, date, completed_by)
              VALUES (?, ?, ?, ?, ?)`).run(k.entity_type, k.entity_id, k.kind, k.date, userId)
  db.prepare(`UPDATE tasks SET status = 'done', completed_at = datetime('now'),
              updated_by = ?, updated_at = datetime('now')
              WHERE critical_date_id = ? AND status NOT IN ('done', 'dismissed')`).run(actor, id)
  return true
}

/** Un-complete a critical date AND reopen its linked task. */
export function uncompleteCriticalDate(id, actor = 'cole') {
  const k = parseCriticalDateKey(id); if (!k) return false
  db.prepare(`DELETE FROM critical_date_completions WHERE entity_type = ? AND entity_id = ? AND kind = ? AND date = ?`)
    .run(k.entity_type, k.entity_id, k.kind, k.date)
  db.prepare(`UPDATE tasks SET status = 'open', completed_at = NULL,
              updated_by = ?, updated_at = datetime('now')
              WHERE critical_date_id = ? AND status = 'done'`).run(actor, id)
  return true
}

/**
 * Called from the task side: when a critical_date-sourced task is completed or
 * reopened, mirror it onto the critical date's completion row. Direct writes (no
 * route call) so the two directions never loop.
 */
export function syncCriticalDateFromTask(task, userId = null) {
  if (!task || task.source !== 'critical_date' || !task.critical_date_id) return
  const k = parseCriticalDateKey(task.critical_date_id); if (!k) return
  if (task.status === 'done') {
    db.prepare(`INSERT OR IGNORE INTO critical_date_completions (entity_type, entity_id, kind, date, completed_by)
                VALUES (?, ?, ?, ?, ?)`).run(k.entity_type, k.entity_id, k.kind, k.date, userId)
  } else if (task.status === 'open' || task.status === 'waiting') {
    db.prepare(`DELETE FROM critical_date_completions WHERE entity_type = ? AND entity_id = ? AND kind = ? AND date = ?`)
      .run(k.entity_type, k.entity_id, k.kind, k.date)
  }
}
