// ── Duplicate-property merge (plan + execute) ─────────────────────────────────
// Consolidates property rows that share a normalized address onto ONE canonical
// record, re-pointing every child row (deals, leases, taxes, insurance, investors,
// documents, timeline, …) to the keeper before the duplicate is removed.
//
// planMerge()  — READ-ONLY. Returns exactly what WOULD happen: the keeper for each
//                group, the duplicates, per-child-table row counts to move, and any
//                conflicts/flags that make a group unsafe to auto-merge.
// executeMerge() — WRITES. Only touches the group keys you pass, skips anything the
//                plan flagged needs_review, and runs in a single transaction.
//
// Grouping matches the audit: normalizeAddr(street|city|state), zip-agnostic.

import db from '../db.js'
import { normalizeAddr } from '../utils/normalize.js'

// Every table (besides `properties`) that carries a property_id — discovered from
// the live schema so new child tables are covered automatically.
function childTables() {
  const tables = db.prepare(
    `SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name <> 'properties'`
  ).all()
  const out = []
  for (const { name } of tables) {
    const cols = db.prepare(`PRAGMA table_info("${name}")`).all()
    if (cols.some(c => c.name === 'property_id')) out.push(name)
  }
  return out
}

// Build the duplicate groups keyed by normalized street|city|state.
function duplicateGroups() {
  const rows = db.prepare(
    `SELECT id, address, city, state, zip, is_portfolio, listing_status, sf_id, tenant_brand_id, notes
       FROM properties`
  ).all()
  const groups = new Map()
  for (const r of rows) {
    const key = normalizeAddr(r.address || '', r.city || '', r.state || '', '')
    if (!key) continue
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key).push(r)
  }
  return [...groups.entries()].filter(([, rs]) => rs.length > 1)
}

// Count the child rows pointing at a given property, per table.
function childCounts(tables, propertyId) {
  const counts = {}
  let total = 0
  for (const t of tables) {
    const n = db.prepare(`SELECT COUNT(*) AS n FROM "${t}" WHERE property_id = ?`).get(propertyId).n
    if (n) { counts[t] = n; total += n }
  }
  return { counts, total }
}

const SUITE_RE = /\b(ste|suite|unit|apt|lot|bldg|#)\b/i

// Choose the keeper: prefer portfolio-owned, then the row holding the most child
// data, then the most-complete record, then the lowest id. Returns the chosen row.
function chooseCanonical(rows, childByIdTotal) {
  const score = r => [
    r.is_portfolio ? 1 : 0,
    childByIdTotal[r.id] || 0,
    Object.values(r).filter(v => v !== null && v !== '').length,
    -r.id, // lower id wins the final tie
  ]
  return [...rows].sort((a, b) => {
    const sa = score(a), sb = score(b)
    for (let i = 0; i < sa.length; i++) if (sb[i] !== sa[i]) return sb[i] - sa[i]
    return 0
  })[0]
}

/**
 * READ-ONLY merge plan. Returns:
 *  { summary, groups: [{ key, address, canonical, duplicates:[{id, child_counts, total}],
 *                        child_collisions, flags, needs_review }] }
 */
export function planMerge({ includeReviewable = true } = {}) {
  const tables = childTables()
  const groups = duplicateGroups()
  const out = []

  for (const [key, rows] of groups) {
    // Per-row child totals (used for canonical choice + reporting).
    const childByIdTotal = {}
    const childByIdCounts = {}
    for (const r of rows) {
      const { counts, total } = childCounts(tables, r.id)
      childByIdTotal[r.id] = total
      childByIdCounts[r.id] = counts
    }

    const canonical = chooseCanonical(rows, childByIdTotal)
    const duplicates = rows.filter(r => r.id !== canonical.id)

    // Flags that make a group unsafe to auto-merge:
    const flags = []
    // (1) Test seed — the deliberate Knox office dummies.
    if (rows.some(r => /KNOX_TEST/i.test(r.notes || '')) || key.startsWith('7500 w 160th st')) flags.push('test_seed')
    // (2) Suite/unit markers → the address grouping stripped a suite; could be
    //     genuinely different units in one building.
    if (rows.some(r => SUITE_RE.test(r.address || ''))) flags.push('suite_or_unit')
    // (3) More than one portfolio-owned row → two "real" records; a human should
    //     decide which financials/leases win.
    if (rows.filter(r => r.is_portfolio).length > 1) flags.push('multiple_portfolio')
    // (4) A duplicate marked sold while another isn't — disposition history at risk.
    if (rows.some(r => r.listing_status === 'sold') && rows.some(r => r.listing_status !== 'sold')) flags.push('mixed_sold_status')

    // (5) Child-table collisions: canonical AND a duplicate both have rows in a
    //     table that is likely one-per-property (lease/tax/insurance/etc.). These
    //     can't be blindly re-pointed without review.
    const child_collisions = []
    for (const t of tables) {
      const canon = childByIdCounts[canonical.id]?.[t] || 0
      for (const d of duplicates) {
        const dn = childByIdCounts[d.id]?.[t] || 0
        if (canon > 0 && dn > 0) child_collisions.push({ table: t, canonical_rows: canon, duplicate_id: d.id, duplicate_rows: dn })
      }
    }
    if (child_collisions.length) flags.push('child_collision')

    const needs_review = flags.length > 0
    if (!includeReviewable && needs_review) continue

    out.push({
      key,
      address: `${canonical.address}, ${canonical.city || ''} ${canonical.state || ''}`.trim(),
      canonical: {
        id: canonical.id, is_portfolio: !!canonical.is_portfolio,
        listing_status: canonical.listing_status, child_total: childByIdTotal[canonical.id] || 0,
      },
      duplicates: duplicates.map(d => ({
        id: d.id, is_portfolio: !!d.is_portfolio, listing_status: d.listing_status,
        child_counts: childByIdCounts[d.id], child_total: childByIdTotal[d.id] || 0,
      })),
      child_collisions,
      flags,
      needs_review,
    })
  }

  const clean = out.filter(g => !g.needs_review)
  const review = out.filter(g => g.needs_review)
  const dupRows = g => g.duplicates.length
  const childRows = g => g.duplicates.reduce((s, d) => s + d.child_total, 0)

  return {
    summary: {
      child_tables_scanned: tables.length,
      duplicate_groups: out.length,
      auto_mergeable_groups: clean.length,
      needs_review_groups: review.length,
      duplicate_rows_total: out.reduce((s, g) => s + dupRows(g), 0),
      duplicate_rows_auto: clean.reduce((s, g) => s + dupRows(g), 0),
      child_rows_to_reassign_auto: clean.reduce((s, g) => s + childRows(g), 0),
      review_reasons: review.reduce((m, g) => { for (const f of g.flags) m[f] = (m[f] || 0) + 1; return m }, {}),
    },
    groups: out,
  }
}

/**
 * WRITE. Merge only the given group keys (from a plan). Skips any group the plan
 * flags needs_review unless force=true. Re-points every child row to the keeper,
 * then deletes the duplicate property rows. Single transaction; returns a report.
 * Pass dryRun=true to get the same report with no writes.
 */
export function executeMerge({ keys = [], force = false, dryRun = false } = {}) {
  if (!Array.isArray(keys) || !keys.length) return { error: 'No group keys provided' }
  const tables = childTables()
  const plan = planMerge()
  const byKey = new Map(plan.groups.map(g => [g.key, g]))

  const done = []
  const skipped = []
  const run = () => {
    for (const key of keys) {
      const g = byKey.get(key)
      if (!g) { skipped.push({ key, reason: 'not a current duplicate group' }); continue }
      if (g.needs_review && !force) { skipped.push({ key, reason: `needs_review: ${g.flags.join(', ')}` }); continue }
      let reassigned = 0
      for (const d of g.duplicates) {
        for (const t of tables) {
          const r = db.prepare(`UPDATE "${t}" SET property_id = ? WHERE property_id = ?`).run(g.canonical.id, d.id)
          reassigned += r.changes || 0
        }
        db.prepare('DELETE FROM properties WHERE id = ?').run(d.id)
      }
      done.push({ key, canonical_id: g.canonical.id, removed_ids: g.duplicates.map(d => d.id), child_rows_reassigned: reassigned })
    }
  }

  if (dryRun) { run(); return { dryRun: true, done, skipped } }

  db.exec('BEGIN')
  try { run(); db.exec('COMMIT') }
  catch (e) { db.exec('ROLLBACK'); return { error: e.message, done: [], skipped } }
  return { done, skipped }
}
