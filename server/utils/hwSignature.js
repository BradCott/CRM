// Resolve which Handwrytten signature to stamp on a letter. Signatures live in
// the handwrytten_signatures registry (Handwrytten has no list API, so we track
// the IDs ourselves). A stored value may be a bare code ("1427BC") OR the whole
// inline tag a user copied from Handwrytten ("<sig:1837CH offset=-20>"). We
// normalize either form into ONE valid tag — never a bare number, never a
// double-wrapped tag — so a bad/missing entry can't 400 a whole mail batch.

// Turn a stored signature value into a clean inline tag, or null if it isn't a
// usable signature. Extracts the code (and any offset) from a pasted tag; wraps
// a bare code with the default offset. Bare integers ("1") are NOT valid codes.
export function toSigTag(value) {
  const s = String(value ?? '').trim()
  if (!s) return null
  // A pasted full tag: <sig:CODE offset=-20>  → keep the code + its offset.
  const tag = s.match(/<\s*sig\s*:\s*([A-Za-z0-9]+)\s*(offset\s*=\s*-?\d+)?[^>]*>/i)
  if (tag) return `<sig:${tag[1]}${tag[2] ? ' ' + tag[2].replace(/\s+/g, '') : ' offset=1'}>`
  // A bare code — must be alphanumeric and at least 2 chars (a lone "1" is junk).
  if (/^[A-Za-z0-9]{2,}$/.test(s)) return `<sig:${s} offset=1>`
  return null
}

// The value a caller stored (a registry row id, a bare code, or a full tag) →
// the first VALID signature tag, preferring: the requested one, then the default,
// then any other registry signature, then Brad's known-good id.
export function sigSuffix(db, sig) {
  const raw = (sig ?? '').toString().trim()
  const candidates = []

  if (raw && /^\d+$/.test(raw)) {
    // A registry row id.
    const row = db.prepare(`SELECT sig_id FROM handwrytten_signatures WHERE id = ?`).get(Number(raw))
    if (row?.sig_id != null) candidates.push(row.sig_id)
  } else if (raw) {
    // A literal code or a pasted tag.
    candidates.push(raw)
  }
  // Fallbacks: the default signature, then everything else in the registry.
  for (const r of db.prepare(`SELECT sig_id FROM handwrytten_signatures ORDER BY is_default DESC, id`).all()) {
    candidates.push(r.sig_id)
  }
  candidates.push('1427BC')   // last-resort known-good

  for (const c of candidates) {
    const tag = toSigTag(c)
    if (tag) return ` ${tag}`
  }
  return ' <sig:1427BC offset=1>'
}

// The bare signature code a value resolves to (used where only the code matters).
export function resolveSigId(db, sig) {
  const tag = sigSuffix(db, sig).trim()
  const m = tag.match(/<sig:([A-Za-z0-9]+)/i)
  return m ? m[1] : '1427BC'
}
