// Resolve which Handwrytten signature to stamp on a letter. Signatures live in
// the handwrytten_signatures registry (Handwrytten has no list API, so we track
// the IDs ourselves). Callers pass either a registry row id or a raw sig_id.

// A real Handwrytten signature id is an alphanumeric code (e.g. "1427BC"), never
// a bare integer. So a pure-integer value is a registry ROW id (or junk), and
// must never be stamped onto a letter as the signature itself.
const looksLikeSigId = (s) => typeof s === 'string' && s.trim() !== '' && !/^\d+$/.test(s.trim())

export function resolveSigId(db, sig) {
  const raw = (sig ?? '').toString().trim()

  if (raw && /^\d+$/.test(raw)) {
    // Numeric = a registry row id. Use its stored sig_id only if that's valid.
    const row = db.prepare(`SELECT sig_id FROM handwrytten_signatures WHERE id = ?`).get(Number(raw))
    if (looksLikeSigId(row?.sig_id)) return row.sig_id.trim()
    // Stale/missing row — fall through to the default. NEVER return the raw
    // number (that's what produced the invalid "<sig:1>").
  } else if (looksLikeSigId(raw)) {
    // Non-numeric string = a literal Handwrytten sig_id.
    return raw
  }

  // Fall back to the first valid registry signature (default first), skipping
  // any junk rows whose sig_id isn't a real signature code.
  const rows = db.prepare(`SELECT sig_id FROM handwrytten_signatures ORDER BY is_default DESC, id`).all()
  for (const r of rows) if (looksLikeSigId(r.sig_id)) return r.sig_id.trim()
  return '1427BC'
}

// The inline tag appended to a message body.
export function sigSuffix(db, sig) {
  return ` <sig:${resolveSigId(db, sig)} offset=1>`
}
