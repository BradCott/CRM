// Preferred-return accrual for an investor's stake in a property.
//
// Knox rules:
//   • Accrual starts on the property's CLOSE DATE (from the buy settlement
//     statement), falling back to the link's created_at only if no close date
//     is recorded.
//   • We always return a MINIMUM of 12 months of preferred return, even if the
//     property is held less than a year. After 12 months it accrues by whole
//     months.
//
// `link` must carry: preferred_return_rate, contribution, close_date, created_at.

function parseDate(s) {
  if (!s) return null
  const str = String(s)
  const iso = str.includes('T')
    ? str
    : (str.length <= 10 ? `${str}T00:00:00Z` : `${str.replace(' ', 'T')}Z`)
  const d = new Date(iso)
  return isNaN(d.getTime()) ? null : d
}

// Whole completed months between two dates (UTC).
function wholeMonthsBetween(start, end) {
  let m = (end.getUTCFullYear() - start.getUTCFullYear()) * 12 + (end.getUTCMonth() - start.getUTCMonth())
  if (end.getUTCDate() < start.getUTCDate()) m -= 1   // current month not yet completed
  return Math.max(0, m)
}

export function calcPrefReturn(link, now = new Date()) {
  const rate         = Number(link?.preferred_return_rate) || 0
  const contribution = Number(link?.contribution) || 0
  if (!rate || !contribution) return 0

  const start = parseDate(link?.close_date) || parseDate(link?.created_at)
  if (!start) return 0

  const heldMonths      = wholeMonthsBetween(start, now)
  const effectiveMonths = Math.max(12, heldMonths)   // 1-year minimum, then monthly
  return contribution * (rate / 100) * (effectiveMonths / 12)
}
