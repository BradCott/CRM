import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowLeft, Loader2, RefreshCw, ChevronDown, ChevronRight, Scale, BarChart2 } from 'lucide-react'
import { getAccountingReports } from '../../api/client'

// ── Formatters ────────────────────────────────────────────────────────────────

function fmt$(n, opts = {}) {
  if (n === null || n === undefined) return '—'
  const abs = '$' + Math.abs(Math.round(n)).toLocaleString()
  if (n < 0) return opts.parens ? `(${abs})` : `-${abs}`
  return abs
}

function fmtPct(n) {
  if (n === null || n === undefined || !isFinite(n)) return '—'
  return Math.round(n) + '%'
}

// ── Per-property computation (mirrors BalanceSheet.jsx / ProfitLoss.jsx) ─────

function computeBS(transactions, investors) {
  const sum = txs => txs.reduce((s, t) => s + Number(t.amount), 0)

  const building = Math.abs(sum(transactions.filter(t => t.description === 'Building Value')))
  const land     = Math.abs(sum(transactions.filter(t => t.description === 'Land Value')))
  const totalRealEstate = building + land

  const opCash = sum(transactions.filter(t =>
    ['Rent', 'Mortgage', 'Repair', 'Sale'].includes(t.category) &&
    t.source !== 'Settlement Statement'
  ))
  const otherOp = sum(transactions.filter(t =>
    t.category === 'Other' && t.source !== 'Settlement Statement'
  ))
  const equityContribCash = sum(transactions.filter(t => t.category === 'Equity Contribution'))
  const totalCash = opCash + otherOp + equityContribCash

  const loanBalance = sum(transactions.filter(t =>
    t.category === 'Loan' && t.description !== '1031 Exchange Proceeds'
  ))
  const exchange1031 = sum(transactions.filter(t => t.description === '1031 Exchange Proceeds'))
  const acquisitionCredits = sum(transactions.filter(t =>
    ['Rent', 'Other'].includes(t.category) &&
    t.source === 'Settlement Statement' &&
    Number(t.amount) > 0
  ))
  const investedCapital = investors.reduce((s, i) => s + Number(i.contribution || 0), 0)

  const totalAssets      = totalRealEstate + totalCash
  const totalLiabilities = loanBalance
  const totalEquity      = totalAssets - totalLiabilities
  const retainedEarnings = totalEquity - exchange1031 - acquisitionCredits - investedCapital

  return {
    building, land, totalRealEstate,
    totalCash, totalAssets,
    loanBalance, totalLiabilities,
    exchange1031, acquisitionCredits, investedCapital, retainedEarnings,
    totalEquity,
  }
}

function filterByPeriod(transactions, period, fromDate, toDate) {
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

function computePL(transactions, period, fromDate, toDate) {
  const base = filterByPeriod(transactions, period, fromDate, toDate)
    .filter(t => ['Rent', 'Mortgage', 'Repair', 'Other'].includes(t.category))

  const pos = (txs) => txs.filter(t => Number(t.amount) > 0).reduce((s, t) => s + Number(t.amount), 0)
  const neg = (txs) => txs.filter(t => Number(t.amount) < 0).reduce((s, t) => s + Math.abs(Number(t.amount)), 0)

  const rentRevenue  = pos(base.filter(t => t.category === 'Rent'))
  const otherRevenue = pos(base.filter(t => t.category === 'Other'))
  const totalRevenue = rentRevenue + otherRevenue

  const mortgageExp  = neg(base.filter(t => t.category === 'Mortgage'))
  const repairExp    = neg(base.filter(t => t.category === 'Repair'))
  const otherExp     = neg(base.filter(t => t.category === 'Other'))
  const totalExpenses = mortgageExp + repairExp + otherExp

  const noi    = totalRevenue - totalExpenses
  const margin = totalRevenue > 0 ? (noi / totalRevenue) * 100 : null

  return { rentRevenue, otherRevenue, totalRevenue, mortgageExp, repairExp, otherExp, totalExpenses, noi, margin }
}

// ── Shared table helpers ──────────────────────────────────────────────────────

function Th({ children, right }) {
  return (
    <th className={`px-4 py-2.5 text-xs font-semibold text-slate-500 uppercase tracking-wide whitespace-nowrap first:pl-5 last:pr-5 ${right ? 'text-right' : 'text-left'}`}>
      {children}
    </th>
  )
}

function Td({ children, right, bold, color, muted }) {
  return (
    <td className={[
      'px-4 py-2.5 text-sm border-b border-slate-100 tabular-nums whitespace-nowrap first:pl-5 last:pr-5',
      right ? 'text-right' : 'text-left',
      bold  ? 'font-semibold' : '',
      color || (muted ? 'text-slate-400' : 'text-slate-700'),
    ].join(' ')}>
      {children}
    </td>
  )
}

function TotalRow({ label, values, colorFn }) {
  return (
    <tr className="bg-slate-50 border-t-2 border-slate-200">
      <td className="px-4 pl-5 py-2.5 text-xs font-bold text-slate-500 uppercase tracking-wide">{label}</td>
      {values.map((v, i) => (
        <td key={i} className={`px-4 py-2.5 text-sm font-bold text-right tabular-nums last:pr-5 ${colorFn ? colorFn(v) : 'text-slate-900'}`}>
          {typeof v === 'number' ? fmt$(v) : v}
        </td>
      ))}
    </tr>
  )
}

// ── Consolidated summary cards ────────────────────────────────────────────────

function SummaryCard({ label, value, sub, color = 'text-slate-900' }) {
  return (
    <div className="bg-white border border-slate-200 rounded-xl px-5 py-4">
      <p className="text-xs text-slate-400 mb-1">{label}</p>
      <p className={`text-xl font-bold tabular-nums ${color}`}>{value}</p>
      {sub && <p className="text-xs text-slate-400 mt-0.5">{sub}</p>}
    </div>
  )
}

// ── Balance Sheet view ────────────────────────────────────────────────────────

function BalanceSheetView({ properties }) {
  const [expanded, setExpanded] = useState(false)

  const rows = properties.map(p => ({
    ...p,
    bs: computeBS(p.transactions, p.investors),
  }))

  // Portfolio totals
  const total = rows.reduce((acc, r) => {
    const b = r.bs
    return {
      totalRealEstate:    acc.totalRealEstate    + b.totalRealEstate,
      totalCash:          acc.totalCash          + b.totalCash,
      totalAssets:        acc.totalAssets        + b.totalAssets,
      loanBalance:        acc.loanBalance        + b.loanBalance,
      totalLiabilities:   acc.totalLiabilities   + b.totalLiabilities,
      exchange1031:       acc.exchange1031        + b.exchange1031,
      acquisitionCredits: acc.acquisitionCredits + b.acquisitionCredits,
      investedCapital:    acc.investedCapital     + b.investedCapital,
      retainedEarnings:   acc.retainedEarnings    + b.retainedEarnings,
      totalEquity:        acc.totalEquity         + b.totalEquity,
    }
  }, {
    totalRealEstate: 0, totalCash: 0, totalAssets: 0,
    loanBalance: 0, totalLiabilities: 0,
    exchange1031: 0, acquisitionCredits: 0, investedCapital: 0,
    retainedEarnings: 0, totalEquity: 0,
  })

  const totalLE   = total.totalLiabilities + total.totalEquity
  const balanced  = Math.abs(total.totalAssets - totalLE) < properties.length * 2

  return (
    <div className="space-y-6">
      {/* Summary cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <SummaryCard label="Total Real Property" value={fmt$(total.totalRealEstate)} sub="at acquisition cost" color="text-slate-900" />
        <SummaryCard label="Total Mortgage Debt" value={fmt$(total.loanBalance)} sub="original balances" color="text-amber-700" />
        <SummaryCard label="Total Equity"         value={fmt$(total.totalEquity)}  color={total.totalEquity >= 0 ? 'text-emerald-700' : 'text-red-600'} />
        <SummaryCard label="Properties"           value={properties.length}        sub="in portfolio" />
      </div>

      {/* Consolidated balance sheet */}
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div className="px-5 py-3.5 border-b border-slate-100 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-slate-900">Portfolio Balance Sheet</h3>
          {balanced
            ? <span className="text-xs text-emerald-600 font-medium">✓ Balanced</span>
            : <span className="text-xs text-amber-600">⚠ Difference: {fmt$(Math.abs(total.totalAssets - totalLE))}</span>
          }
        </div>

        <div className="px-5 py-4 space-y-0 divide-y divide-slate-100">
          {/* Assets */}
          <div className="pb-3">
            <p className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">Assets</p>
            <BSLine label="Real Property (at cost)" value={total.totalRealEstate} />
            <BSLine label="Cash & Cash Equivalents" value={total.totalCash} note="Operational cash flows"
              color={total.totalCash >= 0 ? undefined : 'text-red-600'} />
            <BSLine label="TOTAL ASSETS" value={total.totalAssets} bold
              color={total.totalAssets >= 0 ? 'text-emerald-700' : 'text-red-600'} />
          </div>

          {/* Liabilities */}
          <div className="py-3">
            <p className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2 pt-1">Liabilities</p>
            <BSLine label="Mortgage Payable (original)" value={total.loanBalance}
              note="Actual outstanding balance lower as principal paid down" />
            <BSLine label="TOTAL LIABILITIES" value={total.totalLiabilities} bold />
          </div>

          {/* Equity */}
          <div className="pt-3">
            <p className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">Equity</p>
            {total.exchange1031     > 0 && <BSLine label="1031 Exchange Proceeds"       value={total.exchange1031} />}
            {total.acquisitionCredits > 0 && <BSLine label="Acquisition Credits (prorations)" value={total.acquisitionCredits} />}
            {total.investedCapital  > 0 && <BSLine label="Invested Capital"             value={total.investedCapital} />}
            <BSLine label="Retained Earnings (Deficit)" value={total.retainedEarnings}
              color={total.retainedEarnings >= 0 ? 'text-emerald-700' : 'text-red-600'} />
            <BSLine label="TOTAL EQUITY" value={total.totalEquity} bold
              color={total.totalEquity >= 0 ? 'text-emerald-700' : 'text-red-600'} />
          </div>
        </div>
      </div>

      {/* Per-property breakdown table */}
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <button
          onClick={() => setExpanded(e => !e)}
          className="w-full flex items-center justify-between px-5 py-3.5 border-b border-slate-100 hover:bg-slate-50 transition-colors text-left"
        >
          <span className="text-sm font-semibold text-slate-900">By Property</span>
          {expanded
            ? <ChevronDown className="w-4 h-4 text-slate-400" />
            : <ChevronRight className="w-4 h-4 text-slate-400" />
          }
        </button>

        {expanded && (
          <div className="overflow-x-auto">
            <table className="w-full text-sm border-collapse min-w-[700px]">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200">
                  <Th>Property</Th>
                  <Th right>Real Property</Th>
                  <Th right>Cash</Th>
                  <Th right>Total Assets</Th>
                  <Th right>Mortgage</Th>
                  <Th right>Equity</Th>
                </tr>
              </thead>
              <tbody>
                {rows.map(r => {
                  const b = r.bs
                  return (
                    <tr key={r.id} className="hover:bg-slate-50/60">
                      <Td>
                        <div>
                          <p className="font-medium text-slate-900 truncate max-w-[200px]">{r.address}</p>
                          {(r.city || r.state) && (
                            <p className="text-xs text-slate-400">{[r.city, r.state].filter(Boolean).join(', ')}</p>
                          )}
                        </div>
                      </Td>
                      <Td right>{fmt$(b.totalRealEstate)}</Td>
                      <Td right color={b.totalCash < 0 ? 'text-red-600' : undefined}>{fmt$(b.totalCash)}</Td>
                      <Td right bold>{fmt$(b.totalAssets)}</Td>
                      <Td right color="text-amber-700">{fmt$(b.loanBalance) || '—'}</Td>
                      <Td right color={b.totalEquity >= 0 ? 'text-emerald-700' : 'text-red-600'} bold>{fmt$(b.totalEquity)}</Td>
                    </tr>
                  )
                })}
              </tbody>
              <TotalRow
                label="Portfolio Total"
                values={[
                  total.totalRealEstate,
                  total.totalCash,
                  total.totalAssets,
                  total.loanBalance,
                  total.totalEquity,
                ]}
                colorFn={(v, i) => {
                  if (i === 4) return v >= 0 ? 'text-emerald-700' : 'text-red-600'
                  if (i === 3) return 'text-amber-700'
                  return 'text-slate-900'
                }}
              />
            </table>
          </div>
        )}
      </div>
    </div>
  )
}

function BSLine({ label, value, bold, color, note }) {
  return (
    <div className="flex items-start justify-between py-1">
      <div>
        <span className={`text-sm ${bold ? 'font-semibold text-slate-900' : 'text-slate-600'}`}>{label}</span>
        {note && <p className="text-xs text-slate-400 italic">{note}</p>}
      </div>
      <span className={`text-sm tabular-nums ml-6 shrink-0 ${bold ? 'font-semibold' : ''} ${color || (bold ? 'text-slate-900' : 'text-slate-700')}`}>
        {fmt$(value)}
      </span>
    </div>
  )
}

// ── P&L view ──────────────────────────────────────────────────────────────────

function PLView({ properties }) {
  const [period,   setPeriod]   = useState('all')
  const [fromDate, setFromDate] = useState('')
  const [toDate,   setToDate]   = useState('')
  const [expanded, setExpanded] = useState(false)

  const rows = properties.map(p => ({
    ...p,
    pl: computePL(p.transactions, period, fromDate, toDate),
  }))

  const total = rows.reduce((acc, r) => {
    const pl = r.pl
    return {
      rentRevenue:   acc.rentRevenue   + pl.rentRevenue,
      otherRevenue:  acc.otherRevenue  + pl.otherRevenue,
      totalRevenue:  acc.totalRevenue  + pl.totalRevenue,
      mortgageExp:   acc.mortgageExp   + pl.mortgageExp,
      repairExp:     acc.repairExp     + pl.repairExp,
      otherExp:      acc.otherExp      + pl.otherExp,
      totalExpenses: acc.totalExpenses + pl.totalExpenses,
      noi:           acc.noi           + pl.noi,
    }
  }, { rentRevenue: 0, otherRevenue: 0, totalRevenue: 0, mortgageExp: 0, repairExp: 0, otherExp: 0, totalExpenses: 0, noi: 0 })

  const totalMargin = total.totalRevenue > 0 ? (total.noi / total.totalRevenue) * 100 : null

  const periodLabel = {
    all: 'All Time', ytd: `YTD ${new Date().getFullYear()}`,
    ly: 'Last 12 Months', custom: 'Custom Range',
  }[period]

  return (
    <div className="space-y-6">
      {/* Period filter */}
      <div className="flex items-center gap-3 flex-wrap">
        <span className="text-sm text-slate-500">Period:</span>
        {['all', 'ytd', 'ly', 'custom'].map(p => (
          <button
            key={p}
            onClick={() => setPeriod(p)}
            className={`px-3 py-1.5 text-sm rounded-lg border transition-colors ${
              period === p
                ? 'bg-blue-600 border-blue-600 text-white'
                : 'bg-white border-slate-200 text-slate-600 hover:border-blue-300'
            }`}
          >
            {{ all: 'All Time', ytd: `YTD ${new Date().getFullYear()}`, ly: 'Last 12 Mo', custom: 'Custom' }[p]}
          </button>
        ))}
        {period === 'custom' && (
          <div className="flex items-center gap-2 ml-2">
            <input type="date" value={fromDate} onChange={e => setFromDate(e.target.value)}
              className="text-sm border border-slate-200 rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-400" />
            <span className="text-slate-400 text-sm">→</span>
            <input type="date" value={toDate} onChange={e => setToDate(e.target.value)}
              className="text-sm border border-slate-200 rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-400" />
          </div>
        )}
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <SummaryCard label="Total Revenue" value={fmt$(total.totalRevenue)} sub={periodLabel} color="text-emerald-700" />
        <SummaryCard label="Total Expenses" value={fmt$(total.totalExpenses)} color="text-red-600" />
        <SummaryCard label="Net Operating Income" value={fmt$(total.noi)}
          color={total.noi >= 0 ? 'text-emerald-700' : 'text-red-600'}
          sub={totalMargin != null ? `${Math.round(totalMargin)}% margin` : undefined} />
        <SummaryCard label="Properties w/ Income" value={rows.filter(r => r.pl.totalRevenue > 0).length}
          sub={`of ${properties.length} total`} />
      </div>

      {/* Consolidated P&L */}
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div className="px-5 py-3.5 border-b border-slate-100">
          <h3 className="text-sm font-semibold text-slate-900">Portfolio P&amp;L — {periodLabel}</h3>
        </div>
        <div className="px-5 py-4 space-y-0 divide-y divide-slate-100">
          <div className="pb-3">
            <p className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">Revenue</p>
            {total.rentRevenue  > 0 && <BSLine label="Rental Income" value={total.rentRevenue}  color="text-emerald-700" />}
            {total.otherRevenue > 0 && <BSLine label="Other Income"  value={total.otherRevenue} color="text-emerald-700" />}
            {total.totalRevenue === 0 && <p className="text-sm text-slate-400 py-1">No revenue in this period</p>}
            <BSLine label="TOTAL REVENUE" value={total.totalRevenue} bold color="text-emerald-700" />
          </div>
          <div className="py-3">
            <p className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2 pt-1">Expenses</p>
            {total.mortgageExp > 0 && <BSLine label="Mortgage / Debt Service" value={total.mortgageExp}  color="text-red-600"
              note="Includes principal; actual interest portion may differ" />}
            {total.repairExp   > 0 && <BSLine label="Repairs &amp; Maintenance"  value={total.repairExp}   color="text-red-600" />}
            {total.otherExp    > 0 && <BSLine label="Other Expenses"           value={total.otherExp}    color="text-red-600" />}
            {total.totalExpenses === 0 && <p className="text-sm text-slate-400 py-1">No expenses in this period</p>}
            <BSLine label="TOTAL EXPENSES" value={total.totalExpenses} bold color="text-red-600" />
          </div>
          <div className="pt-3">
            <div className="flex items-center justify-between bg-slate-50 rounded-xl px-4 py-3">
              <span className="text-sm font-bold text-slate-900">NET OPERATING INCOME</span>
              <div className="text-right">
                <span className={`text-xl font-bold tabular-nums ${total.noi >= 0 ? 'text-emerald-700' : 'text-red-600'}`}>
                  {fmt$(total.noi)}
                </span>
                {totalMargin != null && (
                  <p className="text-xs text-slate-400 mt-0.5">{Math.round(totalMargin)}% margin</p>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Per-property breakdown */}
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <button
          onClick={() => setExpanded(e => !e)}
          className="w-full flex items-center justify-between px-5 py-3.5 border-b border-slate-100 hover:bg-slate-50 transition-colors text-left"
        >
          <span className="text-sm font-semibold text-slate-900">By Property</span>
          {expanded
            ? <ChevronDown className="w-4 h-4 text-slate-400" />
            : <ChevronRight className="w-4 h-4 text-slate-400" />
          }
        </button>

        {expanded && (
          <div className="overflow-x-auto">
            <table className="w-full text-sm border-collapse min-w-[700px]">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200">
                  <Th>Property</Th>
                  <Th right>Revenue</Th>
                  <Th right>Mortgage</Th>
                  <Th right>Repairs</Th>
                  <Th right>Other Exp</Th>
                  <Th right>NOI</Th>
                  <Th right>Margin</Th>
                </tr>
              </thead>
              <tbody>
                {rows.map(r => {
                  const pl = r.pl
                  return (
                    <tr key={r.id} className="hover:bg-slate-50/60">
                      <Td>
                        <div>
                          <p className="font-medium text-slate-900 truncate max-w-[200px]">{r.address}</p>
                          {(r.city || r.state) && (
                            <p className="text-xs text-slate-400">{[r.city, r.state].filter(Boolean).join(', ')}</p>
                          )}
                        </div>
                      </Td>
                      <Td right color="text-emerald-700">{pl.totalRevenue > 0 ? fmt$(pl.totalRevenue) : <span className="text-slate-300">—</span>}</Td>
                      <Td right color="text-amber-700">{pl.mortgageExp > 0 ? fmt$(pl.mortgageExp) : <span className="text-slate-300">—</span>}</Td>
                      <Td right color="text-red-600">{pl.repairExp > 0 ? fmt$(pl.repairExp) : <span className="text-slate-300">—</span>}</Td>
                      <Td right color="text-red-600">{pl.otherExp > 0 ? fmt$(pl.otherExp) : <span className="text-slate-300">—</span>}</Td>
                      <Td right bold color={pl.noi >= 0 ? 'text-emerald-700' : 'text-red-600'}>{fmt$(pl.noi)}</Td>
                      <Td right muted>{fmtPct(pl.margin)}</Td>
                    </tr>
                  )
                })}
              </tbody>
              <TotalRow
                label="Portfolio Total"
                values={[
                  total.totalRevenue,
                  total.mortgageExp,
                  total.repairExp,
                  total.otherExp,
                  total.noi,
                  totalMargin != null ? fmtPct(totalMargin) : '—',
                ]}
                colorFn={(v, i) => {
                  if (i === 4) return (typeof v === 'number' && v >= 0) ? 'text-emerald-700' : 'text-red-600'
                  if (i === 5) return 'text-slate-600'
                  return 'text-slate-900'
                }}
              />
            </table>
          </div>
        )}
      </div>
    </div>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function AccountingReports() {
  const navigate = useNavigate()
  const [properties, setProperties] = useState([])
  const [loading,    setLoading]    = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error,      setError]      = useState(null)
  const [activeTab,  setActiveTab]  = useState('balance') // 'balance' | 'pl'

  const load = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true)
    else setLoading(true)
    setError(null)
    try {
      const data = await getAccountingReports()
      setProperties(data)
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header */}
      <header className="shrink-0 px-6 pt-5 pb-0 bg-white border-b border-slate-200">
        <div className="flex items-center gap-3 mb-3">
          <button
            onClick={() => navigate('/accounting')}
            className="flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-800 transition-colors"
          >
            <ArrowLeft className="w-4 h-4" /> Accounting
          </button>
        </div>

        <div className="flex items-center justify-between mb-3">
          <h1 className="text-xl font-semibold text-slate-900">Portfolio Reports</h1>
          <button
            onClick={() => load(true)}
            disabled={refreshing}
            className="flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-700 transition-colors disabled:opacity-50"
            title="Refresh data"
          >
            <RefreshCw className={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`} />
            {refreshing ? 'Refreshing…' : 'Refresh'}
          </button>
        </div>

        {/* Tabs */}
        <div className="flex items-center gap-0">
          {[
            { key: 'balance', label: 'Balance Sheet', Icon: Scale },
            { key: 'pl',      label: 'P&L',           Icon: BarChart2 },
          ].map(({ key, label, Icon }) => (
            <button
              key={key}
              onClick={() => setActiveTab(key)}
              className={[
                'flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors whitespace-nowrap',
                activeTab === key
                  ? 'border-blue-500 text-blue-600'
                  : 'border-transparent text-slate-500 hover:text-slate-700 hover:border-slate-300',
              ].join(' ')}
            >
              <Icon className="w-3.5 h-3.5" />
              {label}
            </button>
          ))}
        </div>
      </header>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-6">
        {loading && (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="w-6 h-6 text-slate-400 animate-spin" />
          </div>
        )}

        {error && (
          <div className="mb-4 px-4 py-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
            {error}
          </div>
        )}

        {!loading && properties.length === 0 && (
          <div className="flex flex-col items-center justify-center py-20 text-slate-400 gap-2">
            <p className="text-sm font-medium">No portfolio properties with transactions</p>
            <p className="text-xs">Add transactions to properties to generate reports</p>
          </div>
        )}

        {!loading && properties.length > 0 && (
          <>
            {activeTab === 'balance' && <BalanceSheetView properties={properties} />}
            {activeTab === 'pl'      && <PLView properties={properties} />}
          </>
        )}
      </div>
    </div>
  )
}
