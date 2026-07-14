import { useState } from 'react'
import DrilldownModal from './DrilldownModal'
import { computePL, filterByPeriod, PL_CATS, EXPENSE_CATEGORIES, expenseLabel } from '../../utils/accounting'
import { plRows } from '../../utils/accountingExport'
import ReportExportButton from './ReportExportButton'

function fmt$(n) {
  if (n === null || n === undefined) return '—'
  const abs = '$' + Math.abs(Math.round(n)).toLocaleString()
  if (n < 0) return `(${abs})`
  return abs
}

function Divider({ thick }) {
  return <div className={`${thick ? 'border-t-2 border-slate-300' : 'border-t border-slate-200'} my-2`} />
}

function SectionLabel({ children }) {
  return <p className="text-xs font-bold text-slate-400 uppercase tracking-wider mt-4 mb-1">{children}</p>
}

// Clickable number — opens drilldown modal
function ClickableAmount({ value, label, transactions, onChanged, bold, indent, color, note }) {
  const [open, setOpen] = useState(false)
  const hasData = transactions?.length > 0

  return (
    <>
      <div className={`flex items-start justify-between py-1.5 ${indent ? 'pl-6' : ''}`}>
        <div>
          <span className={`text-sm ${bold ? 'font-semibold text-slate-900' : 'text-slate-600'}`}>{label}</span>
          {note && <p className="text-xs text-slate-400 italic mt-0.5">{note}</p>}
        </div>
        <button
          onClick={() => hasData && setOpen(true)}
          className={`text-sm tabular-nums shrink-0 ml-4 ${bold ? 'font-semibold' : ''} ${color || (bold ? 'text-slate-900' : 'text-slate-700')} ${hasData ? 'underline decoration-dotted underline-offset-2 hover:opacity-70 cursor-pointer' : 'cursor-default'} transition-opacity`}
        >
          {fmt$(value)}
        </button>
      </div>
      {open && (
        <DrilldownModal
          title={label}
          transactions={transactions}
          onClose={() => setOpen(false)}
          onChanged={onChanged}
        />
      )}
    </>
  )
}

// ── Monthly view ──────────────────────────────────────────────────────────────

function Cell({ value, txs, label, onChanged, bold, color }) {
  const [open, setOpen] = useState(false)
  const hasData = txs?.length > 0
  return (
    <>
      <td className={`px-2 py-2 text-xs tabular-nums min-w-[90px] text-right ${bold ? 'font-semibold' : ''} ${color || 'text-slate-700'}`}>
        <button
          onClick={() => hasData && setOpen(true)}
          className={`w-full text-right ${hasData ? 'underline decoration-dotted underline-offset-2 hover:opacity-70' : 'cursor-default'} transition-opacity`}
        >
          {value > 0 ? fmt$(value) : '—'}
        </button>
      </td>
      {open && (
        <DrilldownModal title={label} transactions={txs} onClose={() => setOpen(false)} onChanged={onChanged} />
      )}
    </>
  )
}

function MonthlyView({ transactions, onChanged }) {
  const base = transactions.filter(t => PL_CATS.has(t.category))

  const monthKeys = [...new Set(base.map(t => t.date.slice(0, 7)))].sort()
  if (monthKeys.length === 0) {
    return <p className="text-sm text-slate-400 py-8 text-center">No transactions to display</p>
  }

  const months = monthKeys.map(key => {
    const [year, month] = key.split('-')
    const label = new Date(Number(year), Number(month) - 1, 1)
      .toLocaleDateString(undefined, { month: 'short', year: '2-digit' })
    return { key, label, pl: computePL(base.filter(t => t.date.startsWith(key))) }
  })

  const totals = computePL(base)

  // Expense categories with any activity across the whole range
  const activeExpenseCats = EXPENSE_CATEGORIES.filter(cat =>
    totals.expenses.some(e => e.category === cat)
  )

  const expenseFor = (pl, cat) => pl.expenses.find(e => e.category === cat) || { amount: 0, txs: [] }

  const rows = [
    { key: 'rent',  label: 'Rental Income', get: pl => ({ value: pl.rentRevenue, txs: pl.txs.rentTxs }), color: 'text-emerald-700' },
    ...(totals.otherRevenue > 0
      ? [{ key: 'otherRev', label: 'Other Income', get: pl => ({ value: pl.otherRevenue, txs: pl.txs.otherRevTxs }), color: 'text-emerald-700' }]
      : []),
    { key: 'totalRev', label: 'Total Revenue', get: pl => ({ value: pl.totalRevenue, txs: [...pl.txs.rentTxs, ...pl.txs.otherRevTxs] }), color: 'text-emerald-700', bold: true, divider: true },
    ...activeExpenseCats.map(cat => ({
      key: cat, label: expenseLabel(cat),
      get: pl => { const e = expenseFor(pl, cat); return { value: e.amount, txs: e.txs } },
      color: 'text-red-600',
    })),
    { key: 'totalExp', label: 'Total Expenses', get: pl => ({ value: pl.totalExpenses, txs: pl.txs.allExpenseTxs }), color: 'text-red-600', bold: true, divider: true },
    { key: 'noi', label: 'Net Operating Income', get: pl => ({ value: pl.noi, txs: [] }), noi: true, bold: true },
    { key: 'principal', label: 'Less: Mortgage Principal', get: pl => ({ value: pl.principalPaid, txs: pl.principalTxs }), color: 'text-red-600' },
    { key: 'cashAvail', label: 'Cash Available', get: pl => ({ value: pl.cashAvailable, txs: [] }), noi: true, bold: true, divider: true },
  ]

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm border-collapse">
        <thead>
          <tr className="border-b-2 border-slate-200">
            <th className="px-3 py-2.5 text-xs font-semibold text-slate-500 uppercase tracking-wide text-left sticky left-0 bg-white min-w-[160px]"></th>
            {months.map(m => (
              <th key={m.key} className="px-2 py-2.5 text-xs font-semibold text-slate-500 uppercase tracking-wide min-w-[90px] text-right">{m.label}</th>
            ))}
            <th className="px-2 py-2.5 text-xs font-semibold text-slate-700 uppercase tracking-wide min-w-[90px] text-right border-l border-slate-200">Total</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(row => (
            <tr key={row.key} className={`${row.divider ? 'border-t-2 border-slate-300' : 'border-b border-slate-100'} ${row.bold ? 'bg-slate-50' : ''}`}>
              <td className={`px-3 py-2 text-xs sticky left-0 bg-inherit ${row.bold ? 'font-semibold text-slate-900' : 'text-slate-600'}`}>
                {row.label}
              </td>
              {months.map(m => {
                const { value, txs } = row.get(m.pl)
                return (
                  <Cell key={m.key} value={value} txs={txs}
                    label={`${row.label} — ${m.label}`} onChanged={onChanged} bold={row.bold}
                    color={row.noi ? (m.pl.noi >= 0 ? 'text-emerald-700' : 'text-red-600') : row.color} />
                )
              })}
              {(() => {
                const { value, txs } = row.get(totals)
                return (
                  <Cell value={value} txs={txs}
                    label={`${row.label} — All Months`} onChanged={onChanged} bold={row.bold}
                    color={row.noi ? (totals.noi >= 0 ? 'text-emerald-700' : 'text-red-600') : row.color} />
                )
              })()}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

export default function ProfitLoss({ property, transactions, onChanged }) {
  const [period,   setPeriod]   = useState('ytd')
  const [fromDate, setFromDate] = useState('')
  const [toDate,   setToDate]   = useState('')
  const [view,     setView]     = useState('summary') // 'summary' | 'monthly'

  const base = filterByPeriod(transactions, period, fromDate, toDate)
  const pl   = computePL(base)

  const periodLabel = {
    all:    'All Time',
    ytd:    `Year to Date (${new Date().getFullYear()})`,
    ly:     'Last 12 Months',
    custom: fromDate || toDate ? `${fromDate || '…'} → ${toDate || '…'}` : 'Custom Range',
  }[period]

  return (
    <div className="px-6 py-6">
      {/* Header controls */}
      <div className="flex items-center justify-between mb-4 gap-3 flex-wrap">
        <div>
          <h2 className="text-base font-bold text-slate-900">Profit &amp; Loss</h2>
          <p className="text-xs text-slate-400">{periodLabel}</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <div className="flex rounded-lg border border-slate-200 overflow-hidden text-xs font-medium">
            <button
              onClick={() => setView('summary')}
              className={`px-3 py-1.5 transition-colors ${view === 'summary' ? 'bg-slate-800 text-white' : 'bg-white text-slate-600 hover:bg-slate-50'}`}
            >
              Summary
            </button>
            <button
              onClick={() => setView('monthly')}
              className={`px-3 py-1.5 transition-colors ${view === 'monthly' ? 'bg-slate-800 text-white' : 'bg-white text-slate-600 hover:bg-slate-50'}`}
            >
              By Month
            </button>
          </div>
          <select
            value={period}
            onChange={e => setPeriod(e.target.value)}
            className="text-sm border border-slate-200 rounded-lg px-3 py-1.5 bg-white focus:outline-none focus:ring-2 focus:ring-blue-400"
          >
            <option value="ytd">Year to Date</option>
            <option value="ly">Last 12 Months</option>
            <option value="all">All Time</option>
            <option value="custom">Custom Range</option>
          </select>
          <ReportExportButton property={property} title="Profit & Loss" subtitle={periodLabel} buildRows={() => plRows(base)} />
        </div>
      </div>

      {period === 'custom' && (
        <div className="flex items-center gap-3 mb-4">
          <div>
            <label className="text-xs text-slate-500 block mb-1">From</label>
            <input type="date" value={fromDate} onChange={e => setFromDate(e.target.value)}
              className="text-sm border border-slate-200 rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-400" />
          </div>
          <div>
            <label className="text-xs text-slate-500 block mb-1">To</label>
            <input type="date" value={toDate} onChange={e => setToDate(e.target.value)}
              className="text-sm border border-slate-200 rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-400" />
          </div>
        </div>
      )}

      {/* Monthly view */}
      {view === 'monthly' && (
        <MonthlyView transactions={base} onChanged={onChanged} />
      )}

      {/* Summary view */}
      {view === 'summary' && (
        <div className="max-w-lg">
          <SectionLabel>Revenue</SectionLabel>

          {pl.rentRevenue > 0 && (
            <ClickableAmount label="Rental Income" value={pl.rentRevenue} transactions={pl.txs.rentTxs}
              indent color="text-emerald-700" onChanged={onChanged} />
          )}
          {pl.otherRevenue > 0 && (
            <ClickableAmount label="Other Income" value={pl.otherRevenue} transactions={pl.txs.otherRevTxs}
              indent color="text-emerald-700" onChanged={onChanged} />
          )}
          {pl.totalRevenue === 0 && (
            <p className="text-sm text-slate-400 pl-6 py-1.5">No revenue in this period</p>
          )}

          <Divider thick />
          <ClickableAmount label="TOTAL REVENUE" value={pl.totalRevenue}
            transactions={[...pl.txs.rentTxs, ...pl.txs.otherRevTxs]}
            bold color="text-emerald-700" onChanged={onChanged} />

          <SectionLabel>Expenses</SectionLabel>

          {pl.expenses.map(e => (
            <ClickableAmount key={e.category} label={e.label} value={e.amount}
              transactions={e.txs} indent color="text-red-600" onChanged={onChanged}
              note={e.category === 'Mortgage' ? 'Includes principal; actual interest portion may differ' : undefined} />
          ))}
          {pl.totalExpenses === 0 && (
            <p className="text-sm text-slate-400 pl-6 py-1.5">No expenses in this period</p>
          )}

          <Divider thick />
          <ClickableAmount label="TOTAL EXPENSES" value={pl.totalExpenses}
            transactions={pl.txs.allExpenseTxs}
            bold color="text-red-600" onChanged={onChanged} />

          <div className="mt-4 bg-slate-50 rounded-xl p-4 border border-slate-200">
            <div className="flex items-center justify-between">
              <span className="text-sm font-bold text-slate-900">Net Operating Income</span>
              <span className={`text-lg font-bold tabular-nums ${pl.noi >= 0 ? 'text-emerald-700' : 'text-red-600'}`}>
                {fmt$(pl.noi)}
              </span>
            </div>
            {pl.totalRevenue > 0 && (
              <p className="text-xs text-slate-400 mt-1">
                Margin: {Math.round((pl.noi / pl.totalRevenue) * 100)}%
              </p>
            )}

            {/* Below NOI: principal isn't a P&L expense but is real cash out */}
            <ClickableAmount label="Less: Mortgage Principal" value={-pl.principalPaid}
              transactions={pl.principalTxs} color="text-red-600" onChanged={onChanged} />
            <div className="flex items-center justify-between border-t-2 border-slate-200 mt-2 pt-2">
              <span className="text-sm font-bold text-slate-900" title="NOI minus principal paid — the actual cash left after debt service">Cash Available</span>
              <span className={`text-lg font-bold tabular-nums ${pl.cashAvailable >= 0 ? 'text-emerald-700' : 'text-red-600'}`}>
                {fmt$(pl.cashAvailable)}
              </span>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
