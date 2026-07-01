export function normalizeName(s) {
  if (!s) return ''
  return s
    .toLowerCase()
    .replace(/\bl\.?l\.?c\.?\b/g, 'llc')
    .replace(/\bincorporated\b/g, 'inc')
    .replace(/\bcorporation\b/g, 'corp')
    .replace(/\blimited\b/g, 'ltd')
    .replace(/[.,;#']/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

// Token-aware search clause: every whitespace-separated word must match at least
// one of the given columns (LIKE %word%). Word order and gaps don't matter, so
// "Sara McGregor" finds "Sara Kenny McGregor" and "Wabash Lakeland" finds a
// Lakeland property on Wabash Ave. Returns { clause, params } — clause is ''
// when the search is empty. Callers AND this into their WHERE conditions.
export function tokenSearch(columns, search) {
  const toks = String(search || '').trim().split(/\s+/).filter(Boolean).slice(0, 8)
  if (!toks.length) return { clause: '', params: [] }
  const perTok = `(${columns.map(c => `${c} LIKE ?`).join(' OR ')})`
  const clause = `(${toks.map(() => perTok).join(' AND ')})`
  const params = []
  for (const _t of toks) { const like = `%${_t}%`; for (const _c of columns) params.push(like) }
  return { clause, params }
}

export function normalizeAddr(street, city, state, zip) {
  const s = (street || '')
    .toLowerCase()
    .replace(/\b(ste|suite|unit|apt|#)\s*\.?\s*[\w-]*/gi, '')
    .replace(/\bstreet\b/g, 'st')
    .replace(/\bavenue\b/g, 'ave')
    .replace(/\bboulevard\b/g, 'blvd')
    .replace(/\broad\b/g, 'rd')
    .replace(/\bdrive\b/g, 'dr')
    .replace(/\blane\b/g, 'ln')
    .replace(/\bnorth\b/g, 'n')
    .replace(/\bsouth\b/g, 's')
    .replace(/\beast\b/g, 'e')
    .replace(/\bwest\b/g, 'w')
    .replace(/[.,;#]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
  const c  = (city  || '').toLowerCase().trim()
  const st = (state || '').toLowerCase().trim()
  const z  = (zip   || '').toString().slice(0, 5).trim()
  return [s, c, st, z].filter(Boolean).join('|')
}

// Returns { confidence: 'confident'|'review'|'none', matched }
// candidates = array of { id, name, city, state, address }
export function matchPerson(nameKey, city, state, street, candidates) {
  if (!candidates.length) return { confidence: 'none' }
  const cityLow   = (city   || '').toLowerCase().trim()
  const stateLow  = (state  || '').toLowerCase().trim()
  const streetKey = normalizeAddr(street, '', '', '')

  const scored = candidates.map(c => {
    const cCityLow  = (c.city  || '').toLowerCase().trim()
    const cStateLow = (c.state || '').toLowerCase().trim()
    const cStreetKey = normalizeAddr(c.address, '', '', '')
    const cityStateMatch  = cityLow && stateLow && cCityLow === cityLow && cStateLow === stateLow
    const streetMatch     = streetKey && cStreetKey && streetKey === cStreetKey
    return { ...c, cityStateMatch, streetMatch }
  })

  const confident = scored.find(c => c.cityStateMatch || c.streetMatch)
  if (confident) return { confidence: 'confident', matched: confident }
  return { confidence: 'review', matched: scored[0], candidates: scored }
}
