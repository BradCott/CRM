// Shared accounting logic — categories, P&L, Schedule E, depreciation, cash flow.
// Single source of truth used by the ledger, reports, and statement components.

// ── Categories ────────────────────────────────────────────────────────────────

export const EXPENSE_CATEGORIES = [
  'Mortgage', 'Repair', 'Insurance', 'Property Tax', 'Utilities',
  'Management Fees', 'Legal & Professional', 'Advertising', 'Supplies',
  'Travel', 'Commissions', 'Cleaning & Maintenance', 'HOA / CAM', 'Other',
]

export const ALL_CATEGORIES = [
  'Rent', ...EXPENSE_CATEGORIES.filter(c => c !== 'Other'),
  'Equity Contribution', 'Purchase', 'Loan', 'Sale', 'Other',
]

// P&L includes rent + every operating expense category (not balance-sheet items)
export const PL_CATS = new Set(['Rent', ...EXPENSE_CATEGORIES])

export const CATEGORY_COLORS = {
  'Equity Contribution':    'bg-blue-100 text-blue-700',
  'Purchase':               'bg-red-100 text-red-700',
  'Loan':                   'bg-teal-100 text-teal-700',
  'Rent':                   'bg-emerald-100 text-emerald-700',
  'Mortgage':               'bg-amber-100 text-amber-700',
  'Repair':                 'bg-orange-100 text-orange-700',
  'Sale':                   'bg-violet-100 text-violet-700',
  'Insurance':              'bg-sky-100 text-sky-700',
  'Property Tax':           'bg-rose-100 text-rose-700',
  'Utilities':              'bg-cyan-100 text-cyan-700',
  'Management Fees':        'bg-indigo-100 text-indigo-700',
  'Legal & Professional':   'bg-purple-100 text-purple-700',
  'Advertising':            'bg-pink-100 text-pink-700',
  'Supplies':               'bg-lime-100 text-lime-700',
  'Travel':                 'bg-yellow-100 text-yellow-700',
  'Commissions':            'bg-fuchsia-100 text-fuchsia-700',
  'Cleaning & Maintenance': 'bg-teal-100 text-teal-700',
  'HOA / CAM':              'bg-stone-100 text-stone-700',
  'Other':                  'bg-slate-100 text-slate-600',
}

// Friendly P&L display labels per category
export const EXPENSE_LABELS = {
  'Mortgage':               'Mortgage / Debt Service',
  'Repair':                 'Repairs',
  'Other':                  'Other Expenses',
}
export function expenseLabel(cat) { return EXPENSE_LABELS[cat] || cat }

// ── Category guesser for bank imports ─────────────────────────────────────────

export function guessCategory(description, amount = -1) {
  const d = (description || '').toLowerCase()
  if (Number(amount) > 0) {
    if (/rent|lease|tenant/.test(d)) return 'Rent'
    return 'Other'
  }
  if (/mortgage|\bmtg\b|home loan|loan pmt|escrow/.test(d))                       return 'Mortgage'
  if (/insurance|policy|premium|geico|allstate|state farm|travelers/.test(d))     return 'Insurance'
  if (/property tax|county tax|tax collector|treasurer|assessor/.test(d))         return 'Property Tax'
  if (/electric|water|gas|sewer|utility|utilities|power|energy|internet|comcast|xfinity/.test(d)) return 'Utilities'
  if (/management|prop mgmt|property mgmt/.test(d))                               return 'Management Fees'
  if (/attorney|legal|cpa|accounting|bookkeep|law firm/.test(d))                  return 'Legal & Professional'
  if (/repair|maintenance|plumb|electric service|hvac|roof|contractor|hardware|home depot|lowes|ace hardware/.test(d)) return 'Repair'
  if (/landscap|lawn|cleaning|janitorial|pest|snow/.test(d))                      return 'Cleaning & Maintenance'
  if (/hoa|cam charge|association/.test(d))                                       return 'HOA / CAM'
  return 'Other'
}

// ── P&L computation ───────────────────────────────────────────────────────────

/**
 * Compute a full P&L from raw transactions.
 * Returns revenue lines, one expense line per category (with the backing
 * transactions for drilldown), totals, and NOI.
 */
export function computePL(transactions) {
  const base = transactions.filter(t => PL_CATS.has(t.category))

  const rentTxs     = base.filter(t => t.category === 'Rent' && Number(t.amount) > 0)
  const otherRevTxs = base.filter(t => t.category === 'Other' && Number(t.amount) > 0)
  const sumAbs = arr => arr.reduce((s, t) => s + Math.abs(Number(t.amount)), 0)

  const rentRevenue  = sumAbs(rentTxs)
  const otherRevenue = sumAbs(otherRevTxs)
  const totalRevenue = rentRevenue + otherRevenue

  // One expense line per category that has activity
  const expenses = EXPENSE_CATEGORIES.map(cat => {
    const txs = base.filter(t => t.category === cat && Number(t.amount) < 0)
    return { category: cat, label: expenseLabel(cat), amount: sumAbs(txs), txs }
  }).filter(e => e.amount > 0)

  const totalExpenses = expenses.reduce((s, e) => s + e.amount, 0)
  const noi = totalRevenue - totalExpenses

  return {
    rentRevenue, otherRevenue, totalRevenue,
    expenses, totalExpenses, noi,
    margin: totalRevenue > 0 ? (noi / totalRevenue) * 100 : null,
    txs: { rentTxs, otherRevTxs, allExpenseTxs: expenses.flatMap(e => e.txs) },
  }
}

export function filterByPeriod(transactions, period, fromDate, toDate) {
  if (period === 'all') return transactions
  const now = new Date()
  let from = null, to = null
  if (period === 'ytd')    { from = new Date(now.getFullYear(), 0, 1); to = now }
  if (period === 'ly')     { from = new Date(now); from.setFullYear(from.getFullYear() - 1); to = now }
  if (period === 'custom') {
    from = fromDate ? new Date(fromDate + 'T00:00:00') : null
    to   = toDate   ? new Date(toDate   + 'T23:59:59') : null
  }
  return transactions.filter(t => {
    const d = new Date(t.date + 'T00:00:00')
    if (from && d < from) return false
    if (to   && d > to)   return false
    return true
  })
}

// ── Depreciation — 27.5-year straight line, mid-month convention ─────────────

export const DEPRECIATION_YEARS = 27.5

/**
 * Build a depreciation schedule from the Building Value settlement entry.
 * In-service date = date of the Building Value transaction.
 * Mid-month convention: first year gets (12.5 − in-service month)/12 of a full year.
 */
export function computeDepreciation(transactions) {
  const buildingTxs = transactions.filter(t => t.description === 'Building Value')
  if (!buildingTxs.length) return null

  const basis = buildingTxs.reduce((s, t) => s + Math.abs(Number(t.amount)), 0)
  const inService = buildingTxs[0].date            // YYYY-MM-DD
  const startYear  = Number(inService.slice(0, 4))
  const startMonth = Number(inService.slice(5, 7)) // 1-12

  const annual    = basis / DEPRECIATION_YEARS
  const firstYear = annual * ((12.5 - startMonth) / 12)

  const currentYear = new Date().getFullYear()
  const rows = []
  let accumulated = 0
  for (let y = startYear; y <= startYear + Math.ceil(DEPRECIATION_YEARS) && y <= currentYear + 28; y++) {
    let amount
    if (y === startYear) amount = firstYear
    else                 amount = Math.min(annual, basis - accumulated)
    if (amount <= 0) break
    accumulated += amount
    rows.push({ year: y, amount, accumulated, remaining: Math.max(0, basis - accumulated) })
  }

  const currentRow = rows.find(r => r.year === currentYear)
  const accumulatedToDate = rows.filter(r => r.year <= currentYear).reduce((s, r) => s + r.amount, 0)

  return {
    basis, inService, annual,
    rows,
    currentYearAmount: currentRow?.amount ?? 0,
    accumulatedToDate,
  }
}

/** Depreciation expense for one specific calendar year. */
export function depreciationForYear(dep, year) {
  if (!dep) return 0
  const row = dep.rows.find(r => r.year === year)
  return row?.amount ?? 0
}

// ── Schedule E mapping ────────────────────────────────────────────────────────

// IRS Schedule E (Form 1040) Part I expense lines
export const SCHEDULE_E_LINES = [
  { line: 5,  label: 'Advertising',                       categories: ['Advertising'] },
  { line: 6,  label: 'Auto and travel',                   categories: ['Travel'] },
  { line: 7,  label: 'Cleaning and maintenance',          categories: ['Cleaning & Maintenance'] },
  { line: 8,  label: 'Commissions',                       categories: ['Commissions'] },
  { line: 9,  label: 'Insurance',                         categories: ['Insurance'] },
  { line: 10, label: 'Legal and other professional fees', categories: ['Legal & Professional'] },
  { line: 11, label: 'Management fees',                   categories: ['Management Fees'] },
  { line: 12, label: 'Mortgage interest paid to banks',   categories: ['Mortgage'], note: 'Includes principal — give your lender\'s 1098 to your CPA for the interest split' },
  { line: 14, label: 'Repairs',                           categories: ['Repair'] },
  { line: 15, label: 'Supplies',                          categories: ['Supplies'] },
  { line: 16, label: 'Taxes',                             categories: ['Property Tax'] },
  { line: 17, label: 'Utilities',                         categories: ['Utilities'] },
  { line: 19, label: 'Other',                             categories: ['HOA / CAM', 'Other'] },
]

/**
 * Compute Schedule E for one calendar year.
 * Returns rents received (line 3), expense lines 5-19, depreciation (line 18),
 * total expenses (line 20), and income/loss (line 21).
 */
export function computeScheduleE(transactions, year) {
  const inYear = transactions.filter(t => t.date.startsWith(String(year)))

  const rentsReceived = inYear
    .filter(t => t.category === 'Rent' && Number(t.amount) > 0)
    .reduce((s, t) => s + Number(t.amount), 0)

  const lines = SCHEDULE_E_LINES.map(def => {
    const txs = inYear.filter(t =>
      def.categories.includes(t.category) && Number(t.amount) < 0 &&
      t.source !== 'Settlement Statement'   // acquisition costs are capitalized, not Schedule E expenses
    )
    return { ...def, amount: txs.reduce((s, t) => s + Math.abs(Number(t.amount)), 0), txs }
  })

  const dep = computeDepreciation(transactions)
  const depreciation = depreciationForYear(dep, year)

  const totalExpenses = lines.reduce((s, l) => s + l.amount, 0) + depreciation
  const incomeOrLoss  = rentsReceived - totalExpenses

  return { year, rentsReceived, lines, depreciation, dep, totalExpenses, incomeOrLoss }
}

// ── Cash Flow Statement ───────────────────────────────────────────────────────

const NON_CASH_DESCRIPTIONS = new Set(['Building Value', 'Land Value'])

/**
 * Classify cash transactions into operating / investing / financing.
 * Operating: rent + operating expenses. Investing: purchase costs & sale proceeds.
 * Financing: loan proceeds, mortgage payments, equity contributions.
 */
export function computeCashFlow(transactions) {
  const cash = transactions.filter(t => !NON_CASH_DESCRIPTIONS.has(t.description))
  const sum = arr => arr.reduce((s, t) => s + Number(t.amount), 0)

  const OPERATING = new Set(['Rent', ...EXPENSE_CATEGORIES.filter(c => c !== 'Mortgage')])

  const operatingTxs = cash.filter(t => OPERATING.has(t.category) && t.source !== 'Settlement Statement')
  const investingTxs = cash.filter(t =>
    t.category === 'Purchase' || t.category === 'Sale' ||
    (t.source === 'Settlement Statement' && !['Loan', 'Equity Contribution'].includes(t.category))
  )
  const financingTxs = cash.filter(t =>
    t.category === 'Loan' || t.category === 'Equity Contribution' || t.category === 'Mortgage'
  )

  const operating = sum(operatingTxs)
  const investing = sum(investingTxs)
  const financing = sum(financingTxs)

  return {
    operating, investing, financing,
    netChange: operating + investing + financing,
    operatingTxs, investingTxs, financingTxs,
  }
}

// ── Vendor summary (1099 prep) ────────────────────────────────────────────────

/** Group outflows by vendor for a given year (or all time if year is null). */
export function computeVendorSummary(transactions, year = null) {
  const outflows = transactions.filter(t =>
    t.vendor && Number(t.amount) < 0 &&
    (year === null || t.date.startsWith(String(year)))
  )
  const byVendor = new Map()
  for (const t of outflows) {
    const key = t.vendor.trim()
    if (!byVendor.has(key)) byVendor.set(key, { vendor: key, total: 0, count: 0, txs: [] })
    const v = byVendor.get(key)
    v.total += Math.abs(Number(t.amount))
    v.count += 1
    v.txs.push(t)
  }
  return [...byVendor.values()].sort((a, b) => b.total - a.total)
}
