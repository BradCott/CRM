// Shared accounting logic — categories, P&L, Schedule E, depreciation, cash flow.
// Single source of truth used by the ledger, reports, and statement components.

// ── Categories ────────────────────────────────────────────────────────────────
// Built-in expense categories. 'Mortgage Interest' is a P&L expense (Schedule E
// line 12); 'Mortgage Principal' is NOT a P&L expense (it pays down the loan
// liability) so it lives in ALL_CATEGORIES but is excluded from PL_CATS.

const BUILTIN_EXPENSE = [
  'Mortgage', 'Mortgage Interest', 'Repair', 'Insurance', 'Property Tax', 'Utilities',
  'Management Fees', 'Legal & Professional', 'Advertising', 'Supplies',
  'Travel', 'Commissions', 'Cleaning & Maintenance', 'HOA / CAM', 'Bank Charges', 'Other',
]
// Non-P&L categories (balance-sheet movements) — selectable but excluded from P&L.
// "Loan Payment" = paying down a note (a liability), not a P&L expense.
// "Member Loan" = an owner/related-party loan to the entity (a liability the
// company owes back); a cash injection, never income or expense.
// "Distribution" = cash paid out to investors (return of capital / pref / profit);
// reduces cash and equity, never a P&L expense.
const NON_PL = ['Equity Contribution', 'Purchase', 'Loan', 'Loan Payment', 'Sale', 'Mortgage Principal', 'Member Loan', 'Distribution']

// These are `let` + live ES-module bindings so hydrateCustomCategories() can
// merge user-defined charge types in at runtime and every importer sees them.
export let EXPENSE_CATEGORIES = [...BUILTIN_EXPENSE]
export let ALL_CATEGORIES = [
  'Rent', ...BUILTIN_EXPENSE.filter(c => c !== 'Other'),
  ...NON_PL, 'Other',
]
export let PL_CATS = new Set(['Rent', ...BUILTIN_EXPENSE])

export const CATEGORY_COLORS = {
  'Equity Contribution':    'bg-blue-100 text-blue-700',
  'Purchase':               'bg-red-100 text-red-700',
  'Loan':                   'bg-teal-100 text-teal-700',
  'Loan Payment':           'bg-teal-100 text-teal-700',
  'Member Loan':            'bg-teal-100 text-teal-700',
  'Distribution':           'bg-violet-100 text-violet-700',
  'Rent':                   'bg-emerald-100 text-emerald-700',
  'Mortgage':               'bg-amber-100 text-amber-700',
  'Mortgage Interest':      'bg-amber-100 text-amber-700',
  'Mortgage Principal':     'bg-teal-100 text-teal-700',
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
  'Bank Charges':           'bg-red-100 text-red-700',
  'Other':                  'bg-slate-100 text-slate-600',
}

const CUSTOM_COLOR = 'bg-slate-100 text-slate-600'

// ── Chart of Accounts classification ──────────────────────────────────────────
// The accounting "kind" of each built-in category. Everything in BUILTIN_EXPENSE
// is an expense; these are the non-expense built-ins.
const BUILTIN_CATEGORY_KIND = {
  'Rent':                'income',
  'Sale':                'income',
  'Equity Contribution': 'equity',
  'Purchase':            'asset',
  'Loan':                'liability',
  'Loan Payment':        'liability',
  'Mortgage Principal':  'liability',
  'Member Loan':         'liability',
  'Distribution':        'equity',
}

/** Account type for a category: 'income' | 'expense' | 'asset' | 'liability' | 'equity'. */
export function categoryKind(name, custom = []) {
  if (BUILTIN_CATEGORY_KIND[name]) return BUILTIN_CATEGORY_KIND[name]
  if (BUILTIN_EXPENSE.includes(name)) return 'expense'
  const c = custom.find(c => c.name === name)
  return c?.kind || 'expense'
}

/** Human metadata for each account type — order, label, where it lives on the books. */
export const ACCOUNT_TYPES = [
  { kind: 'income',    label: 'Income',      statement: 'Profit & Loss',  hint: 'Money earned — rent and other revenue.' },
  { kind: 'expense',   label: 'Expenses',    statement: 'Profit & Loss',  hint: 'Operating costs deducted from income.' },
  { kind: 'asset',     label: 'Assets',      statement: 'Balance Sheet',  hint: 'What the property owns — real estate, acquisition costs.' },
  { kind: 'liability', label: 'Liabilities', statement: 'Balance Sheet',  hint: 'What is owed — loans and notes payable.' },
  { kind: 'equity',    label: 'Equity',      statement: 'Balance Sheet',  hint: 'Owner / investor capital.' },
]

/** Build the full chart of accounts grouped by type. `custom` = [{id,name,kind}]. */
export function buildChartOfAccounts(builtin = [], custom = []) {
  const rows = [
    ...builtin.map(name => ({ name, kind: categoryKind(name, custom), builtin: true })),
    ...custom.map(c => ({ name: c.name, kind: c.kind, builtin: false, id: c.id })),
  ]
  return ACCOUNT_TYPES.map(t => ({
    ...t,
    categories: rows
      .filter(r => r.kind === t.kind)
      .sort((a, b) => a.name.localeCompare(b.name)),
  }))
}

// Friendly P&L display labels per category
export const EXPENSE_LABELS = {
  'Mortgage':               'Mortgage / Debt Service',
  'Mortgage Interest':      'Mortgage Interest',
  'Repair':                 'Repairs',
  'Other':                  'Other Expenses',
}
export function expenseLabel(cat) { return EXPENSE_LABELS[cat] || cat }

/**
 * Merge user-defined charge types (from the registry) into the live category
 * lists. Call once at app startup. `custom` = [{ name, kind }].
 */
export function hydrateCustomCategories(custom = []) {
  // kind: 'income' / 'expense' → P&L; 'liability' / 'asset' / 'equity' → balance sheet (non-P&L)
  const incomeNames  = custom.filter(c => c.kind === 'income').map(c => c.name)
  const expenseNames = custom.filter(c => c.kind === 'expense').map(c => c.name)
  const otherNames   = custom.filter(c => !['income', 'expense'].includes(c.kind)).map(c => c.name)

  EXPENSE_CATEGORIES = [...BUILTIN_EXPENSE.filter(c => c !== 'Other'), ...expenseNames, 'Other']
  ALL_CATEGORIES = [
    'Rent', ...incomeNames,
    ...BUILTIN_EXPENSE.filter(c => c !== 'Other'), ...expenseNames,
    ...NON_PL, ...otherNames, 'Other',
  ]
  PL_CATS = new Set(['Rent', ...incomeNames, ...EXPENSE_CATEGORIES])   // otherNames excluded → not in P&L
  for (const c of custom) {
    if (!CATEGORY_COLORS[c.name]) CATEGORY_COLORS[c.name] = CUSTOM_COLOR
  }
}

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
  if (/wire.*fee|fee.*wire|bank fee|service charge|service fee|\bnsf\b|overdraft|returned item|analysis charge/.test(d)) return 'Bank Charges'
  return 'Other'
}

// ── P&L computation ───────────────────────────────────────────────────────────

/**
 * Compute a full P&L from raw transactions.
 * Returns revenue lines, one expense line per category (with the backing
 * transactions for drilldown), totals, and NOI.
 */
export function computePL(transactions) {
  // Exclude settlement-statement items — closing prorations/credits (e.g. a
  // property-tax proration credited to the buyer) are acquisition adjustments,
  // not operating income/expense. (Schedule E + the Balance Sheet already do this.)
  const base = transactions.filter(t => PL_CATS.has(t.category) && t.source !== 'Settlement Statement')

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

  // Mortgage PRINCIPAL isn't a P&L expense (it pays down the loan), so it's not
  // in NOI — but it's real cash out. "Cash available" = NOI minus principal paid.
  const principalTxs = transactions.filter(t => t.category === 'Mortgage Principal' && t.source !== 'Settlement Statement')
  const principalPaid = principalTxs.reduce((s, t) => s + Math.abs(Number(t.amount)), 0)
  const cashAvailable = noi - principalPaid

  return {
    rentRevenue, otherRevenue, totalRevenue,
    expenses, totalExpenses, noi,
    principalPaid, cashAvailable, principalTxs,
    margin: totalRevenue > 0 ? (noi / totalRevenue) * 100 : null,
    txs: { rentTxs, otherRevTxs, allExpenseTxs: expenses.flatMap(e => e.txs) },
  }
}

// Balance Sheet figures (mirrors BalanceSheet.jsx so exports match the screen).
export function computeBalanceSheet(transactions, investors = [], opening = null) {
  const sum = txs => txs.reduce((s, t) => s + Number(t.amount), 0)
  const ob = opening || {}
  const obCash = Number(ob.cash) || 0, obRealEstate = Number(ob.real_estate) || 0
  const obLoan = Number(ob.loan_balance) || 0, obInvested = Number(ob.invested_capital) || 0

  const building = Math.abs(sum(transactions.filter(t => t.description === 'Building Value')))
  const land     = Math.abs(sum(transactions.filter(t => t.description === 'Land Value')))
  const totalRealEstate = building + land + obRealEstate

  const opCash  = sum(transactions.filter(t => (PL_CATS.has(t.category) || t.category === 'Sale') && t.category !== 'Other' && t.source !== 'Settlement Statement'))
  const otherOp = sum(transactions.filter(t => t.category === 'Other' && t.source !== 'Settlement Statement'))
  const equityContribCash = sum(transactions.filter(t => t.category === 'Equity Contribution'))
  const principalPaid = sum(transactions.filter(t => t.category === 'Mortgage Principal'))
  // Owner/related-party loans: a real cash injection (in) that draws down as it's
  // repaid (out). The net is both cash on hand and a liability the company owes.
  const memberLoan = sum(transactions.filter(t => t.category === 'Member Loan'))
  // Distributions to investors are cash out (negative), reducing cash and equity.
  const distributions = sum(transactions.filter(t => t.category === 'Distribution'))
  const totalCash = opCash + otherOp + equityContribCash + principalPaid + memberLoan + distributions + obCash
  const totalAssets = totalRealEstate + totalCash

  const loanBalance = sum(transactions.filter(t => t.category === 'Loan' && t.description !== '1031 Exchange Proceeds')) + principalPaid + obLoan
  const totalLiabilities = loanBalance + memberLoan

  const exchange1031 = sum(transactions.filter(t => t.description === '1031 Exchange Proceeds'))
  const acquisitionCredits = sum(transactions.filter(t => ['Rent', 'Other'].includes(t.category) && t.source === 'Settlement Statement' && Number(t.amount) > 0))
  const investedFromTable = investors.reduce((s, i) => s + Number(i.contribution || 0), 0)
  const investedCapital = (equityContribCash !== 0 ? equityContribCash : investedFromTable) + obInvested
  const totalEquity = totalAssets - totalLiabilities
  const retainedEarnings = totalEquity - (exchange1031 + acquisitionCredits + investedCapital)

  return {
    building, land, totalRealEstate, totalCash, totalAssets,
    loanBalance, memberLoan, totalLiabilities,
    exchange1031, acquisitionCredits, investedCapital, retainedEarnings, totalEquity,
  }
}

// ── Distribution waterfall ────────────────────────────────────────────────────
// American-style 3-tier waterfall matching Knox's deal calculator:
//   Tier 1  Return of Capital        — pari passu (pro-rata if cash is short)
//   Tier 2  Preferred Return         — simple, time-weighted: capital × rate × months/12
//   Tier 3  Carry (profit above pref) — split lpCarryPct to LPs / gpCarryPct to the GP
// LPs split their carry pro-rata by contribution; the GP (Sponsor) takes the GP carry
// even on zero co-invest. Every tier fills only as far as cash allows.
//
// investors: [{ id, name, contribution, isSponsor?, prefRate?, holdMonths? }]
// opts: { distributable, prefRate=0.15, lpCarryPct=0.40, gpCarryPct=1-lp, holdMonths=12 }
export function computeWaterfall(investors, opts = {}) {
  const prefRate   = opts.prefRate   ?? 0.15
  const lpCarryPct = opts.lpCarryPct ?? 0.40
  const gpCarryPct = opts.gpCarryPct ?? (1 - lpCarryPct)
  const holdMonths = opts.holdMonths ?? 12
  const distributable = Math.max(0, Number(opts.distributable) || 0)

  const inv = (investors || []).map(i => ({
    id: i.id, name: i.name,
    contribution: Number(i.contribution) || 0,
    isSponsor: !!i.isSponsor,
    rate:   i.prefRate   != null ? Number(i.prefRate)   : prefRate,
    months: i.holdMonths != null ? Number(i.holdMonths) : holdMonths,
    capital: 0, prefEarned: 0, pref: 0, carry: 0, total: 0,
  }))
  const totalCapital = inv.reduce((s, i) => s + i.contribution, 0)

  // Tier 1 — Return of Capital (pari passu; pro-rata if cash short)
  let cash = distributable
  const t1Ratio = totalCapital > 0 ? Math.min(1, cash / totalCapital) : 0
  inv.forEach(i => { i.capital = i.contribution * t1Ratio })
  const capitalReturned = inv.reduce((s, i) => s + i.capital, 0)
  cash -= capitalReturned

  // Tier 2 — Preferred Return (simple, time-weighted; pari passu)
  inv.forEach(i => { i.prefEarned = i.contribution * i.rate * (i.months / 12) })
  const totalPref = inv.reduce((s, i) => s + i.prefEarned, 0)
  const t2Ratio = totalPref > 0 ? Math.min(1, cash / totalPref) : 0
  inv.forEach(i => { i.pref = i.prefEarned * t2Ratio })
  const prefPaid = inv.reduce((s, i) => s + i.pref, 0)
  cash -= prefPaid

  // Tier 3 — Carry (profit above pref). No sponsor marked → whole pool to LPs.
  const carryPool = Math.max(0, cash)
  const sponsors = inv.filter(i => i.isSponsor)
  const lps      = inv.filter(i => !i.isSponsor)
  const lpCarry  = sponsors.length ? carryPool * lpCarryPct : carryPool
  const gpCarry  = sponsors.length ? carryPool * gpCarryPct : 0
  const lpBase = lps.reduce((s, i) => s + i.contribution, 0)
  const gpBase = sponsors.reduce((s, i) => s + i.contribution, 0)
  lps.forEach(i => { i.carry = lpBase > 0 ? lpCarry * (i.contribution / lpBase) : (lps.length ? lpCarry / lps.length : 0) })
  sponsors.forEach(i => { i.carry = gpBase > 0 ? gpCarry * (i.contribution / gpBase) : (sponsors.length ? gpCarry / sponsors.length : 0) })

  inv.forEach(i => { i.total = i.capital + i.pref + i.carry })

  return {
    distributable, prefRate, lpCarryPct, gpCarryPct, holdMonths,
    totalCapital, capitalReturned, prefEarned: totalPref, prefPaid,
    carryPool, lpCarry, gpCarry,
    rows: inv,
    totalDistributed: inv.reduce((s, i) => s + i.total, 0),
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
  { line: 12, label: 'Mortgage interest paid to banks',   categories: ['Mortgage Interest', 'Mortgage'], note: 'Split payments use the interest portion; whole "Mortgage" entries still include principal — confirm with your 1098' },
  { line: 14, label: 'Repairs',                           categories: ['Repair'] },
  { line: 15, label: 'Supplies',                          categories: ['Supplies'] },
  { line: 16, label: 'Taxes',                             categories: ['Property Tax'] },
  { line: 17, label: 'Utilities',                         categories: ['Utilities'] },
  { line: 19, label: 'Other',                             categories: ['HOA / CAM', 'Bank Charges', 'Other'] },
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
    ['Loan', 'Equity Contribution', 'Mortgage', 'Mortgage Principal', 'Member Loan', 'Distribution'].includes(t.category)
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
