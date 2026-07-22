// Normalized mailing-address key for de-duplicating physical mail. Two records
// map to the same key when they'd land in the same mailbox: same street line
// (abbreviations canonicalized, suite/unit numbers preserved) + same 5-digit ZIP.
// Returns null when there's no usable street address.

const SUFFIX = {
  street: 'st', st: 'st', avenue: 'ave', ave: 'ave', av: 'ave', road: 'rd', rd: 'rd',
  drive: 'dr', dr: 'dr', lane: 'ln', ln: 'ln', boulevard: 'blvd', blvd: 'blvd',
  court: 'ct', ct: 'ct', place: 'pl', pl: 'pl', circle: 'cir', cir: 'cir',
  highway: 'hwy', hwy: 'hwy', parkway: 'pkwy', pkwy: 'pkwy', trail: 'trl', trl: 'trl',
  terrace: 'ter', ter: 'ter', suite: 'ste', ste: 'ste', apartment: 'apt', apt: 'apt',
  unit: 'unit', building: 'bldg', bldg: 'bldg', floor: 'fl', fl: 'fl',
  north: 'n', south: 's', east: 'e', west: 'w',
  northeast: 'ne', northwest: 'nw', southeast: 'se', southwest: 'sw',
}

// Accepts either a { address, zip } object or (address, zip) strings.
export function addressKey(personOrAddress, zipArg) {
  const address = typeof personOrAddress === 'object' && personOrAddress
    ? personOrAddress.address
    : personOrAddress
  const zipRaw = typeof personOrAddress === 'object' && personOrAddress
    ? personOrAddress.zip
    : zipArg

  const raw = String(address || '').toLowerCase()
  if (!raw.trim()) return null
  const tokens = raw
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(/\s+/)
    .map(t => SUFFIX[t] || t)
  if (!tokens.length) return null
  const zip = String(zipRaw || '').replace(/\D/g, '').slice(0, 5)
  return `${tokens.join(' ')}|${zip}`
}

// Months of history to guard against re-mailing the same address.
export const REMAIL_BLACKOUT_MONTHS = 4
