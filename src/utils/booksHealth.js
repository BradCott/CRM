// Books Health Check — a fail-safe that re-derives a property's books and flags
// the things that quietly produce a wrong accountant package: a negative loan,
// core entries dropped from reports because they're not "recorded", cash plugs
// masking a double-entry, income mis-categorized as an expense, and sale close-out
// gaps. Read-only: it never changes data, it just tells you what to fix.
//
// Returns { findings: [{ severity, code, title, detail, txns }], errors, warnings, ok }.
// severity: 'error'  — reports/package will be wrong until fixed
//           'warning' — very likely wrong; review before sending
//           'info'    — cosmetic artifact, safe to clean up
import { computeBalanceSheet, computePL, EXPENSE_CATEGORIES } from './accounting.js'

// Reports (Balance Sheet, P&L, Schedule E, the bundle) only count 'recorded'
// transactions — anything left 'matched' or 'needs_review' is excluded.
const isReported = t => t.review_status === 'recorded'

// Primary book entries: if one of these is excluded from reports, a real number
// goes missing (unlike a duplicate bank line, which SHOULD be excluded).
const PRIMARY_CATS = new Set(['Loan', 'Sale', 'Equity Contribution', 'Purchase', 'Distribution', 'Mortgage Principal'])

const usd = n => (Number(n) < 0 ? '-$' : '$') + Math.abs(Math.round(Number(n) || 0)).toLocaleString()
const oneLine = t => `${(t.description || t.category || 'entry').slice(0, 48)} ${usd(t.amount)}`

export function checkBooksHealth(transactions = [], opts = {}) {
  const txs = Array.isArray(transactions) ? transactions : []
  const recorded = txs.filter(isReported)
  const findings = []
  const add = (severity, code, title, detail, txns = []) => findings.push({ severity, code, title, detail, txns })

  const bs = computeBalanceSheet(recorded, opts.investors || [])
  const hasSale = txs.some(t => t.category === 'Sale')

  // 1 — Negative loan balance (a loan can never be < 0).
  if (bs.loanBalance < -1) {
    add('error', 'loan_negative', 'Loan balance is negative',
      `Reports show a loan balance of ${usd(bs.loanBalance)}. A loan can't be negative — this almost always means the loan-proceeds line is marked "matched" (so reports drop it) while the payoff is still counted. Set the loan-proceeds line back to "recorded".`)
  }

  // 2 — Primary entries still in limbo: sitting in "needs review", neither recorded
  // nor matched, so they're silently excluded. (A 'matched' primary is a
  // deliberately-reconciled duplicate — that's fine and not flagged here; the
  // loan-balance check above still catches a wrongly-matched loan proceeds.)
  const dropped = txs.filter(t => t.review_status === 'needs_review' && PRIMARY_CATS.has(t.category) && Math.abs(Number(t.amount)) >= 100)
  if (dropped.length) {
    const net = dropped.reduce((s, t) => s + Number(t.amount), 0)
    add('error', 'dropped_primary',
      `${dropped.length} key ${dropped.length === 1 ? 'entry is' : 'entries are'} still in "needs review"`,
      `These core entries haven't been recorded or matched yet, so they're excluded from every report (net ${usd(net)}): ${dropped.slice(0, 4).map(oneLine).join('  •  ')}${dropped.length > 4 ? '  •  …' : ''}. Record each real one — or if it duplicates another line, match or delete it.`,
      dropped)
  }

  // 3 — Cash-adjustment plug masking a double-entry.
  const adj = txs.filter(t => t.category === 'Cash Adjustment')
  const adjSum = adj.reduce((s, t) => s + Number(t.amount), 0)
  if (Math.abs(adjSum) >= 1000) {
    add('warning', 'cash_plug', 'A large cash-adjustment plug is hiding a problem',
      `There's a ${usd(adjSum)} "Cash Adjustment" forcing book cash to match the bank. That usually papers over a double-entered purchase or wire rather than fixing it. Find and delete the duplicate entry, then remove the plug.`,
      adj)
  }

  // 4 — Income mis-tagged as an expense (money IN sitting in an expense/debt line).
  // Exclude 'Other' (dual-use: a positive Other is legitimate other-income), and
  // exclude refunds/credits/overages (a positive amount there is a valid reversal
  // of the expense, e.g. a refunded interest payment — not a mis-tag).
  const REFUND_RE = /refund|reversal|rebate|overage|chargeback|credit\b/i
  const EXP = new Set([...EXPENSE_CATEGORIES, 'Mortgage Principal'])
  EXP.delete('Other')
  const posExpense = recorded.filter(t => EXP.has(t.category) && Number(t.amount) >= 1
    && !REFUND_RE.test(t.description || ''))
  if (posExpense.length) {
    add('warning', 'income_as_expense',
      `${posExpense.length} positive amount${posExpense.length === 1 ? '' : 's'} tagged as an expense`,
      `These are money IN but sit in an expense/debt category — most likely income mis-categorized (e.g. a rent deposit tagged "Mortgage"): ${posExpense.slice(0, 4).map(t => `${oneLine(t)} (${t.category})`).join('  •  ')}${posExpense.length > 4 ? '  •  …' : ''}.`,
      posExpense)
  }

  // 5 — Expense mis-tagged as income (money OUT sitting in Rent).
  const negRent = recorded.filter(t => t.category === 'Rent' && Number(t.amount) < 0)
  if (negRent.length) {
    add('warning', 'expense_as_income',
      `${negRent.length} negative amount${negRent.length === 1 ? '' : 's'} tagged as Rent`,
      `Money OUT categorized as Rent income — likely an expense mis-categorized: ${negRent.slice(0, 4).map(oneLine).join('  •  ')}.`,
      negRent)
  }

  // 6 — Sale close-out sanity.
  if (hasSale) {
    if (bs.totalRealEstate > 1) {
      add('warning', 'basis_not_removed', 'Property basis is still on the books after the sale',
        `The balance sheet still shows ${usd(bs.totalRealEstate)} of building/land even though the property sold. The close-out should remove the basis with offsetting Building/Land entries.`)
    }
    const trivialDist = txs.filter(t => t.category === 'Distribution' && Math.abs(Number(t.amount)) > 0 && Math.abs(Number(t.amount)) < 5)
    if (trivialDist.length) {
      add('info', 'dist_artifact', `${trivialDist.length} trivial distribution artifact${trivialDist.length === 1 ? '' : 's'}`,
        `Tiny distribution lines (e.g. ${usd(trivialDist[0].amount)}) are rounding artifacts from the close-out waterfall — safe to delete.`,
        trivialDist)
    }
    const pl = computePL(recorded)
    if (pl.saleTxs.length && pl.gainOnSale === 0) {
      add('info', 'no_gain', 'The sale posted no gain or loss',
        `If the property sold for more or less than its book value, the close-out is likely missing the basis-removal or a proceeds/cost line.`)
    }
  }

  // 7 — Book cash vs the actual bank balance (only when a bank figure is supplied).
  if (opts.bankBalance != null && isFinite(Number(opts.bankBalance))) {
    const diff = bs.totalCash - Number(opts.bankBalance)
    if (Math.abs(diff) >= 100) {
      add('warning', 'cash_vs_bank', "Book cash doesn't match the bank",
        `Book cash is ${usd(bs.totalCash)} vs the bank's ${usd(opts.bankBalance)} — off by ${usd(diff)}. Reconcile before sending.`)
    }
  }

  const errors = findings.filter(f => f.severity === 'error').length
  const warnings = findings.filter(f => f.severity === 'warning').length
  return { findings, errors, warnings, ok: findings.length === 0 }
}
