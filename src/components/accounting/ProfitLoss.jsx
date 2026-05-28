// Profit & Loss Statement — computed from ledger transactions

import { useState } from 'react'

function fmt$(n) {
  if (n === null || n === undefined) return '—'
  const abs = '$' + Math.abs(Math.round(n)).toLocaleString()
  if (n < 0) return `(${abs})`
  return abs
}

function Row({ label, value, bold, indent, color, note }) {
  return (
    <div className={`flex items-start justify-between py-1.5 ${indent ? 'pl-6' : ''}`}>
      <div>
        <span className={`text-sm ${bold ? 'font-semibold text-slate-900' : 'text-slate-600'}`}>{label}</span>
        {note && <p className="text-xs text-slate-400 italic mt-0.5">{note}</p>}
      </div>
      <span className={`text-sm tabular-nums shrink-0 ml-4 ${bold ? 'font-semibold' : ''} ${color || (bold ? 'text-slate-900' : 'text-slate-700')}`}>
        {typeof value === 'number' ? fmt$(value) : value}
      </span>
    </div>
  )
}

function Divider({ thick }) {
  return <div className={`${thick ? 'border-t-2 border-slate-300' : 'border-t border-slate-200'} my-2`} />
}

function SectionLabel({ children }) {
  return <p className="text-xs font-bold text-slate-400 uppercase tracking-wider mt-4 mb-1">{children}</p>
}

function filterByPeriod(transactions, period, fromDate, toDate) {
  if (period === 'all') return transactions

  const now = new Date()
  let from = null
  let to   = null

  if (period === 'ytd') {
    from = new Date(now.getFullYear(), 0, 1)
    to   = now
  } else if (period === 'ly') {
    from = new Date(now)
    from.setFullYear(from.getFullYear() - 1)
    to = now
  } else if (period === 'custom') {
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

export default function ProfitLoss({ transactions }) {
  const [period,   setPeriod]   = useState('all')
  const [fromDate, setFromDate] = useState('')
  const [toDate,   setToDate]   = useState('')

  // P&L only includes income/expense categories — not balance-sheet items
  const PL_CATS = new Set(['Rent', 'Mortgage', 'Repair', 'Other'])

  const base = filterByPeriod(transactions, period, fromDate, toDate)
    .filter(t => PL_CATS.has(t.category))

  const sum = (txs, sign) =>
    txs.filter(t => sign === 'pos' ? Number(t.amount) > 0 : Number(t.amount) < 0)
       .reduce((s, t) => s + Math.abs(Number(t.amount)), 0)

  // Revenue
  const rentRevenue    = sum(base.filter(t => t.category === 'Rent'),  'pos')
  const otherRevenue   = sum(base.filter(t => t.category === 'Other'), 'pos')
  const totalRevenue   = rentRevenue + otherRevenue

  // Expenses (shown as positive amounts for display)
  const mortgageExp    = sum(base.filter(t => t.category === 'Mortgage'), 'neg')
  const repairExp      = sum(base.filter(t => t.category === 'Repair'),   'neg')
  const otherExp       = sum(base.filter(t => t.category === 'Other'),    'neg')
  const totalExpenses  = mortgageExp + repairExp + otherExp

  const noi            = totalRevenue - totalExpenses

  const periodLabel = {
    all:    'All Time',
    ytd:    `Year to Date (${new Date().getFullYear()})`,
    ly:     'Last 12 Months',
    custom: fromDate || toDate
      ? `${fromDate || '…'} → ${toDate || '…'}`
      : 'Custom Range',
  }[period]

  return (
    <div className="max-w-lg mx-auto px-6 py-6">
      <div className="flex items-start justify-between mb-1">
        <div>
          <h2 className="text-base font-bold text-slate-900">Profit &amp; Loss</h2>
          <p className="text-xs text-slate-400">{periodLabel}</p>
        </div>

        <select
          value={period}
          onChange={e => setPeriod(e.target.value)}
          className="text-sm border border-slate-200 rounded-lg px-3 py-1.5 bg-white focus:outline-none focus:ring-2 focus:ring-blue-400"
        >
          <option value="all">All Time</option>
          <option value="ytd">Year to Date</option>
          <option value="ly">Last 12 Months</option>
          <option value="custom">Custom Range</option>
        </select>
      </div>

      {period === 'custom' && (
        <div className="flex items-center gap-3 mt-3 mb-4">
          <div>
            <label className="text-xs text-slate-500 block mb-1">From</label>
            <input
              type="date"
              value={fromDate}
              onChange={e => setFromDate(e.target.value)}
              className="text-sm border border-slate-200 rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-400"
            />
          </div>
          <div>
            <label className="text-xs text-slate-500 block mb-1">To</label>
            <input
              type="date"
              value={toDate}
              onChange={e => setToDate(e.target.value)}
              className="text-sm border border-slate-200 rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-400"
            />
          </div>
        </div>
      )}

      <div className="mt-4">
        {/* REVENUE */}
        <SectionLabel>Revenue</SectionLabel>

        {rentRevenue  > 0 && <Row label="Rental Income"  value={rentRevenue}  indent color="text-emerald-700" />}
        {otherRevenue > 0 && <Row label="Other Income"   value={otherRevenue} indent color="text-emerald-700" />}
        {totalRevenue === 0 && (
          <p className="text-sm text-slate-400 pl-6 py-1.5">No revenue in this period</p>
        )}

        <Divider thick />
        <Row label="TOTAL REVENUE" value={totalRevenue} bold color="text-emerald-700" />

        {/* EXPENSES */}
        <SectionLabel>Expenses</SectionLabel>

        {mortgageExp > 0 && (
          <Row label="Mortgage / Debt Service" value={mortgageExp} indent color="text-red-600"
            note="Includes principal; actual interest portion may differ" />
        )}
        {repairExp   > 0 && <Row label="Repairs &amp; Maintenance" value={repairExp} indent color="text-red-600" />}
        {otherExp    > 0 && <Row label="Other Expenses"            value={otherExp}  indent color="text-red-600" />}
        {totalExpenses === 0 && (
          <p className="text-sm text-slate-400 pl-6 py-1.5">No expenses in this period</p>
        )}

        <Divider thick />
        <Row label="TOTAL EXPENSES" value={totalExpenses} bold color="text-red-600" />

        {/* NOI */}
        <div className="mt-4 bg-slate-50 rounded-xl p-4 border border-slate-200">
          <div className="flex items-center justify-between">
            <span className="text-sm font-bold text-slate-900">Net Operating Income</span>
            <span className={`text-lg font-bold tabular-nums ${noi >= 0 ? 'text-emerald-700' : 'text-red-600'}`}>
              {fmt$(noi)}
            </span>
          </div>
          {totalRevenue > 0 && (
            <p className="text-xs text-slate-400 mt-1">
              Margin: {Math.round((noi / totalRevenue) * 100)}%
            </p>
          )}
        </div>
      </div>
    </div>
  )
}
