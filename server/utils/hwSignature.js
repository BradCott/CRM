// Resolve which Handwrytten signature to stamp on a letter. Signatures live in
// the handwrytten_signatures registry (Handwrytten has no list API, so we track
// the IDs ourselves). Callers pass either a registry row id or a raw sig_id.

export function resolveSigId(db, sig) {
  const raw = (sig ?? '').toString().trim()
  if (raw) {
    // A registry row id?
    if (/^\d+$/.test(raw)) {
      const row = db.prepare(`SELECT sig_id FROM handwrytten_signatures WHERE id = ?`).get(Number(raw))
      if (row?.sig_id) return row.sig_id
    }
    // Otherwise treat it as a literal Handwrytten sig_id.
    return raw
  }
  const def = db.prepare(`SELECT sig_id FROM handwrytten_signatures WHERE is_default = 1 ORDER BY id LIMIT 1`).get()
           || db.prepare(`SELECT sig_id FROM handwrytten_signatures ORDER BY id LIMIT 1`).get()
  return def?.sig_id || '1427BC'
}

// The inline tag appended to a message body.
export function sigSuffix(db, sig) {
  return ` <sig:${resolveSigId(db, sig)} offset=1>`
}
