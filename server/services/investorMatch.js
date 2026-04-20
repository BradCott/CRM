/**
 * Fuzzy investor name matching + auto-link service.
 * Imported by both server/routes/investors.js and server/routes/accounting.js.
 */
import db from '../db.js'

// ── Name normalization ────────────────────────────────────────────────────────

const STRIP_SUFFIXES = /\b(llc|ltd|inc|corp|co|lp|l\.p\.|trust|partnership|group|holdings|enterprises|associates|properties|revocable|irrevocable|family|the|and|&)\b/gi

export function normalizeName(name) {
  return String(name || '')
    .toLowerCase()
    .replace(STRIP_SUFFIXES, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

// ── Levenshtein distance ──────────────────────────────────────────────────────

function levenshtein(a, b) {
  const m = a.length, n = b.length
  if (m === 0) return n
  if (n === 0) return m
  const dp = Array.from({ length: m + 1 }, (_, i) =>
    Array.from({ length: n + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0))
  )
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = a[i - 1] === b[j - 1]
        ? dp[i - 1][j - 1]
        : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1])
    }
  }
  return dp[m][n]
}

export function nameSimilarity(a, b) {
  const na = normalizeName(a)
  const nb = normalizeName(b)
  if (!na || !nb) return 0
  if (na === nb) return 1.0
  const maxLen = Math.max(na.length, nb.length)
  if (maxLen === 0) return 1.0
  return 1 - levenshtein(na, nb) / maxLen
}

// ── Thresholds ────────────────────────────────────────────────────────────────

const AUTO_MATCH_THRESHOLD  = 0.90  // auto-link
const FUZZY_MATCH_THRESHOLD = 0.60  // flag for review

// ── Upsert a link record ──────────────────────────────────────────────────────

function upsertLink(investorId, propertyId, contribution, preferredReturnRate) {
  const existing = db.prepare(
    `SELECT id FROM investor_property_links WHERE investor_id = ? AND property_id = ?`
  ).get(investorId, propertyId)

  if (existing) {
    db.prepare(`
      UPDATE investor_property_links
      SET contribution = ?, preferred_return_rate = ?
      WHERE id = ?
    `).run(contribution ?? 0, preferredReturnRate ?? null, existing.id)
  } else {
    db.prepare(`
      INSERT INTO investor_property_links (investor_id, property_id, contribution, preferred_return_rate)
      VALUES (?, ?, ?, ?)
    `).run(investorId, propertyId, contribution ?? 0, preferredReturnRate ?? null)
  }
}

// ── Main export: match + auto-link ────────────────────────────────────────────

/**
 * Match an array of investor objects (with name, contribution, preferred_return)
 * against the master investors table and create investor_property_links records.
 *
 * Returns { linked, needs_review, new_profiles }
 *   linked:       array of auto-matched items (link created)
 *   needs_review: array of uncertain matches (link NOT created — user must confirm)
 *   new_profiles: array of new stub profiles created (link created)
 */
export function autoLinkInvestors(propertyId, investors) {
  const allProfiles = db.prepare(`SELECT id, name FROM investors`).all()

  const linked       = []
  const needs_review = []
  const new_profiles = []

  for (const inv of investors) {
    const { name, contribution, preferred_return } = inv
    if (!name?.trim()) continue

    let bestScore = 0
    let bestMatch = null

    for (const profile of allProfiles) {
      const score = nameSimilarity(name, profile.name)
      if (score > bestScore) {
        bestScore = score
        bestMatch = profile
      }
    }

    if (bestScore >= AUTO_MATCH_THRESHOLD && bestMatch) {
      // High confidence → auto-link
      try {
        upsertLink(bestMatch.id, propertyId, contribution, preferred_return)
        linked.push({ name, investor_id: bestMatch.id, matched_name: bestMatch.name, score: bestScore })
      } catch (e) {
        console.error('[investorMatch] Auto-link failed:', e.message)
      }

    } else if (bestScore >= FUZZY_MATCH_THRESHOLD && bestMatch) {
      // Uncertain → flag for review, do NOT create link yet
      needs_review.push({
        name,
        investor_id:  bestMatch.id,
        matched_name: bestMatch.name,
        score:        bestScore,
        contribution,
        preferred_return,
      })

    } else {
      // No match → create stub profile + link
      try {
        const r = db.prepare(
          `INSERT INTO investors (name, is_incomplete) VALUES (?, 1)`
        ).run(name.trim())
        const newId = r.lastInsertRowid
        upsertLink(newId, propertyId, contribution, preferred_return)
        new_profiles.push({ name, investor_id: newId })
        // Add to in-memory list so later names in the same batch can match this stub
        allProfiles.push({ id: newId, name: name.trim() })
      } catch (e) {
        console.error('[investorMatch] New-profile creation failed:', e.message)
      }
    }
  }

  return { linked, needs_review, new_profiles }
}

/**
 * Confirm a pending "needs_review" match.
 * Called when the user explicitly approves a suggested match.
 */
export function confirmMatch(investorId, propertyId, contribution, preferredReturnRate) {
  upsertLink(investorId, propertyId, contribution, preferredReturnRate)
}
