// Cash Flow Statement — operating / investing / financing, with drilldown
import { useState } from 'react'
import DrilldownModal from './DrilldownModal'
import { computeCashFlow, filterByPeriod } from '../../utils/accounting'
import { cashFlowRows } from '../../utils/accountingExport'
import ReportExportButton from './ReportExportButton'

function fmt$(n) {
  if (n === null || n === undefined) return '—'
  const abs = '$' + Math.abs(Math.round(n)).toLocaleString()
  if (n < 0) return `(${abs})`
  return abs
}

function Section({ title, amount, txs, onChanged, note }) {
  const [open, setOpen] = useState(false)
  const hasData = txs.length > 0
  return (
    <>
      <div className="bg-white border border-slate-200 rounded-xl px-5 py-4">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-semibold text-slate-900">{title}</p>
            {note && <p className="text-xs text-slate-400 mt-0.5">{note}</p>}
          </div>
          <button
            onClick={() => hasData && setOpen(true)}
            className={`text-lg font-bold tabular-nums ${amount >= 0 ? 'text-emerald-700' : 'text-red-600'} ${hasData ? 'underline decoration-dotted underline-offset-4 hover:opacity-70' : 'cursor-default'} transition-opacity`}
          >
            {fmt$(amount)}
          </button>
        </div>
        {hasData && (
          <p className="text-xs text-slate-400 mt-1">{txs.length} transaction{txs.length !== 1 ? 's' : ''} — click amount to view</p>
        )}
      </div>
      {open && (
        <DrilldownModal title={title} transactions={txs} onClose={() => setOpen(false)} onChanged={onChanged} />
      )}
    </>
  )
}

function MonthlyCashFlow({ transactions, onChanged }) {
  const monthKeys = [...new Set(transactions.map(t => t.date.slice(0, 7)))].sort()
  if (monthKeys.length === 0) return <p className="text-sm text-slate-400 py-8 text-center">No transactions to display</p>

  const months = monthKeys.map(key => {
    const [y, m] = key.split('-')
    const label = new Date(Number(y), Number(m) - 1, 1).toLocaleDateString(undefined, { month: 'short', year: '2-digit' })
    return { key, label, cf: computeCashFlow(transactions.filter(t => t.date.startsWith(key))) }
  })
  const totals = computeCashFlow(transactions)

  const rows = [
    { key: 'operating', label: 'Operating Activities', get: cf => ({ v: cf.operating, txs: cf.operatingTxs }) },
    { key: 'investing', label: 'Investing Activities', get: cf => ({ v: cf.investing, txs: cf.investingTxs }), note: 'incl. sale proceeds' },
    { key: 'financing', label: 'Financing Activities', get: cf => ({ v: cf.financing, txs: cf.financingTxs }), note: 'incl. loan payoff, distributions' },
    { key: 'net',       label: 'Net Change in Cash',   get: cf => ({ v: cf.netChange, txs: [] }), bold: true },
  ]

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm border-collapse">
        <thead>
          <tr className="border-b-2 border-slate-200">
            <th className="px-3 py-2.5 text-xs font-semibold text-slate-500 uppercase tracking-wide text-left sticky left-0 bg-white min-w-[160px]"></th>
            {months.map(m => <th key={m.key} className="px-2 py-2.5 text-xs font-semibold text-slate-500 uppercase tracking-wide min-w-[90px] text-right">{m.label}</th>)}
            <th className="px-2 py-2.5 text-xs font-semibold text-slate-700 uppercase tracking-wide min-w-[90px] text-right border-l border-slate-200">Total</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(row => (
            <tr key={row.key} className={`${row.bold ? 'border-t-2 border-slate-300 bg-slate-50' : 'border-b border-slate-100'}`}>
              <td className={`px-3 py-2 text-xs sticky left-0 bg-inherit ${row.bold ? 'font-semibold text-slate-900' : 'text-slate-600'}`}>
                {row.label}{row.note && <span className="block text-[10px] text-slate-400 normal-case">{row.note}</span>}
              </td>
              {months.map(m => {
                const { v } = row.get(m.cf)
                return <td key={m.key} className={`px-2 py-2 text-xs tabular-nums text-right ${row.bold ? 'font-semibold' : ''} ${v < 0 ? 'text-red-600' : v > 0 ? 'text-emerald-700' : 'text-slate-300'}`}>{v === 0 ? '—' : fmt$(v)}</td>
              })}
              {(() => { const { v } = row.get(totals); return <td className={`px-2 py-2 text-xs tabular-nums text-right border-l border-slate-200 ${row.bold ? 'font-semibold' : ''} ${v < 0 ? 'text-red-600' : 'text-emerald-700'}`}>{fmt$(v)}</td> })()}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export default function CashFlowStatement({ property, transactions, onChanged }) {
  const [period,   setPeriod]   = useState('all')
  const [fromDate, setFromDate] = useState('')
  const [toDate,   setToDate]   = useState('')
  const [view,     setView]     = useState('summary') // 'summary' | 'monthly'

  const base = filterByPeriod(transactions, period, fromDate, toDate)
  const cf   = computeCashFlow(base)

  const periodLabel = {
    all:    'All Time',
    ytd:    `Year to Date (${new Date().getFullYear()})`,
    ly:     'Last 12 Months',
    custom: fromDate || toDate ? `${fromDate || '…'} → ${toDate || '…'}` : 'Custom Range',
  }[period]

  return (
    <div className="max-w-2xl mx-auto px-6 py-6 space-y-4">
      <div className="flex items-start justify-between">
        <div>
          <h2 className="text-base font-bold text-slate-900">Cash Flow Statement</h2>
          <p className="text-xs text-slate-400">{periodLabel}</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <div className="flex rounded-lg border border-slate-200 overflow-hidden text-xs font-medium">
            <button onClick={() => setView('summary')}
              className={`px-3 py-1.5 transition-colors ${view === 'summary' ? 'bg-slate-800 text-white' : 'bg-white text-slate-600 hover:bg-slate-50'}`}>Summary</button>
            <button onClick={() => setView('monthly')}
              className={`px-3 py-1.5 transition-colors ${view === 'monthly' ? 'bg-slate-800 text-white' : 'bg-white text-slate-600 hover:bg-slate-50'}`}>By Month</button>
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
          <ReportExportButton property={property} title="Cash Flow Statement" subtitle={periodLabel} buildRows={() => cashFlowRows(base)} />
        </div>
      </div>

      {period === 'custom' && (
        <div className="flex items-center gap-3">
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

      {view === 'monthly' && <MonthlyCashFlow transactions={base} onChanged={onChanged} />}

      {view === 'summary' && <>
      <Section title="Cash from Operating Activities" amount={cf.operating} txs={cf.operatingTxs}
        onChanged={onChanged} note="Rent collected minus operating expenses" />
      <Section title="Cash from Investing Activities" amount={cf.investing} txs={cf.investingTxs}
        onChanged={onChanged} note="Property purchases, sale proceeds, and acquisition costs" />
      <Section title="Cash from Financing Activities" amount={cf.financing} txs={cf.financingTxs}
        onChanged={onChanged} note="Loan proceeds, mortgage payments, and equity contributions" />

      <div className="bg-slate-50 border-2 border-slate-300 rounded-xl px-5 py-4">
        <div className="flex items-center justify-between">
          <span className="text-sm font-bold text-slate-900">Net Change in Cash</span>
          <span className={`text-xl font-bold tabular-nums ${cf.netChange >= 0 ? 'text-emerald-700' : 'text-red-600'}`}>
            {fmt$(cf.netChange)}
          </span>
        </div>
      </div>

      <p className="text-xs text-slate-400 italic">
        Note: mortgage payments are shown under financing in full (principal + interest combined).
        Building and land values are excluded — they are non-cash asset entries.
      </p>
      </>}
    </div>
  )
}
