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
// a leading-space signature tag ready to append to a message.
//
// CRITICAL: an EXPLICIT choice is honored exactly, or the send fails — we never
// silently substitute a different person's signature. That silent fallback is
// exactly how Cole's whole 50-letter campaign came out stamped with Brad's
// signature: Cole's registry row was selected, but its code didn't resolve to a
// valid tag, so the old code quietly fell through to the default (Brad). One
// wrong signature you can catch; fifty in the mail you can't. Better to hard-fail
// a bad signature up front than to mail the wrong name.
//
// A missing/empty selection (automated or legacy paths) still falls back to the
// default registry signature, then a last-resort known-good code.
export function sigSuffix(db, sig) {
  const raw = (sig ?? '').toString().trim()

  if (raw) {
    // A registry row id. NOTE: node:sqlite stores a JS integer bound into a TEXT
    // column as "2.0", so a sig_id round-tripped through a TEXT column (e.g. the
    // drip table) comes back as "2.0", not "2" — accept both. Real Handwrytten
    // codes always contain letters, so a purely-numeric value is always a row id.
    const idMatch = /^(\d+)(?:\.0+)?$/.exec(raw)
    if (idMatch) {
      // A registry row id — resolve THAT row, and only that row.
      const row = db.prepare(`SELECT label, sig_id FROM handwrytten_signatures WHERE id = ?`).get(Number(idMatch[1]))
      const tag = toSigTag(row?.sig_id)
      if (tag) return ` ${tag}`
      const err = new Error(
        `The "${row?.label || 'selected'}" signature has no valid Handwrytten code. ` +
        `Fix it under Settings → Signatures before sending.`
      )
      err.code = 'INVALID_SIGNATURE'
      throw err
    }
    // A literal code or a pasted tag.
    const tag = toSigTag(raw)
    if (tag) return ` ${tag}`
    const err = new Error(`"${raw}" is not a valid Handwrytten signature code.`)
    err.code = 'INVALID_SIGNATURE'
    throw err
  }

  // No explicit choice: default registry signature, then everything else.
  for (const r of db.prepare(`SELECT sig_id FROM handwrytten_signatures ORDER BY is_default DESC, id`).all()) {
    const tag = toSigTag(r.sig_id)
    if (tag) return ` ${tag}`
  }
  return ' <sig:1427BC offset=1>'
}

// The bare signature code a value resolves to (used where only the code matters).
export function resolveSigId(db, sig) {
  let tag
  try { tag = sigSuffix(db, sig).trim() } catch { return '1427BC' }
  const m = tag.match(/<sig:([A-Za-z0-9]+)/i)
  return m ? m[1] : '1427BC'
}
