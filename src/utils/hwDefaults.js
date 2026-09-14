// Default a Handwrytten signature / return address to the logged-in user, so mail
// goes out as whoever is actually sending (Cole → Cole's signature), instead of a
// single global default. Matching is by first name against the row's label
// ("Cole Howard" → the signature labeled "Cole"), falling back to the marked
// default, then the first row.
function firstNameOf(user) {
  return String(user?.name || user?.email || '').trim().split(/[\s@]+/)[0].toLowerCase()
}
function matchUser(rows, user) {
  const list = Array.isArray(rows) ? rows : []
  const fn = firstNameOf(user)
  if (fn) {
    const mine = list.find(r => String(r.label || '').trim().split(/\s+/)[0].toLowerCase() === fn)
    if (mine) return mine
  }
  return list.find(r => r.is_default) || list[0] || null
}
export function defaultSigForUser(signatures, user) { return matchUser(signatures, user)?.id ?? null }
export function defaultReturnForUser(returnAddrs, user) { return matchUser(returnAddrs, user)?.id ?? null }
