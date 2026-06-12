import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowLeft, Loader2, RefreshCw, ChevronDown, ChevronRight, Scale, BarChart2, Download } from 'lucide-react'
import { getAccountingReports } from '../../api/client'
import { PL_CATS } from '../../utils/accounting'
import knoxLogo from '../../assets/Knox.png'

// ── Formatters ────────────────────────────────────────────────────────────────

const MONTH_NAMES = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
const MONTH_FULL  = ['January','February','March','April','May','June',
                     'July','August','September','October','November','December']

function fmt$(n) {
  if (n === null || n === undefined) return '—'
  const abs = '$' + Math.abs(Math.round(n)).toLocaleString()
  return n < 0 ? `(${abs})` : abs
}
function fmtNum(n) {
  if (n === null || n === undefined || n === 0) return '—'
  const abs = '$' + Math.abs(Math.round(n)).toLocaleString()
  return n < 0 ? `(${abs})` : abs
}
function fmtPct(n) {
  if (n === null || n === undefined || !isFinite(n)) return '—'
  return Math.round(n) + '%'
}

// ── BS computation ────────────────────────────────────────────────────────────

function computeBS(transactions, investors) {
  const sum = txs => txs.reduce((s, t) => s + Number(t.amount), 0)
  const building = Math.abs(sum(transactions.filter(t => t.description === 'Building Value')))
  const land     = Math.abs(sum(transactions.filter(t => t.description === 'Land Value')))
  const totalRealEstate = building + land
  const opCash = sum(transactions.filter(t =>
    (PL_CATS.has(t.category) || t.category === 'Sale') && t.category !== 'Other' && t.source !== 'Settlement Statement'
  ))
  const otherOp = sum(transactions.filter(t =>
    t.category === 'Other' && t.source !== 'Settlement Statement'
  ))
  const equityContribCash = sum(transactions.filter(t => t.category === 'Equity Contribution'))
  const totalCash = opCash + otherOp + equityContribCash
  const loanBalance = sum(transactions.filter(t =>
    t.category === 'Loan' && t.description !== '1031 Exchange Proceeds'
  ))
  const exchange1031       = sum(transactions.filter(t => t.description === '1031 Exchange Proceeds'))
  const acquisitionCredits = sum(transactions.filter(t =>
    ['Rent','Other'].includes(t.category) && t.source === 'Settlement Statement' && Number(t.amount) > 0
  ))
  const investedCapital = investors.reduce((s, i) => s + Number(i.contribution || 0), 0)
  const totalAssets      = totalRealEstate + totalCash
  const totalLiabilities = loanBalance
  const totalEquity      = totalAssets - totalLiabilities
  const retainedEarnings = totalEquity - exchange1031 - acquisitionCredits - investedCapital
  return { building, land, totalRealEstate, totalCash, totalAssets,
           loanBalance, totalLiabilities,
           exchange1031, acquisitionCredits, investedCapital, retainedEarnings, totalEquity }
}

// ── P&L computation ───────────────────────────────────────────────────────────

function filterByPeriod(transactions, period, fromDate, toDate) {
  if (period === 'all') return transactions
  const now = new Date()
  let from = null, to = null
  if (period === 'ytd')    { from = new Date(now.getFullYear(), 0, 1); to = now }
  if (period === 'ly')     { from = new Date(now); from.setFullYear(from.getFullYear()-1); to = now }
  if (period === 'custom') {
    from = fromDate ? new Date(fromDate+'T00:00:00') : null
    to   = toDate   ? new Date(toDate  +'T23:59:59') : null
  }
  return transactions.filter(t => {
    const d = new Date(t.date+'T00:00:00')
    if (from && d < from) return false
    if (to   && d > to)   return false
    return true
  })
}

function computePL(transactions, period, fromDate, toDate) {
  const base = filterByPeriod(transactions, period, fromDate, toDate)
    .filter(t => PL_CATS.has(t.category))
  const pos = txs => txs.filter(t => Number(t.amount) > 0).reduce((s,t) => s+Number(t.amount), 0)
  const neg = txs => txs.filter(t => Number(t.amount) < 0).reduce((s,t) => s+Math.abs(Number(t.amount)), 0)
  const rentRevenue  = pos(base.filter(t => t.category === 'Rent'))
  const otherRevenue = pos(base.filter(t => t.category === 'Other'))
  const totalRevenue = rentRevenue + otherRevenue
  const mortgageExp  = neg(base.filter(t => t.category === 'Mortgage'))
  const repairExp    = neg(base.filter(t => t.category === 'Repair'))
  // "Other" expenses = every remaining operating expense category
  const otherExp     = neg(base.filter(t => !['Rent','Mortgage','Repair'].includes(t.category)))
  const totalExpenses = mortgageExp + repairExp + otherExp
  const noi    = totalRevenue - totalExpenses
  const margin = totalRevenue > 0 ? (noi / totalRevenue) * 100 : null
  return { rentRevenue, otherRevenue, totalRevenue, mortgageExp, repairExp, otherExp, totalExpenses, noi, margin }
}

// ── Monthly P&L grid ──────────────────────────────────────────────────────────

function computeMonthlyGrid(properties, year) {
  const allTxs = properties.flatMap(p => p.transactions)
  return MONTH_NAMES.map((_, m) => {
    const start = new Date(year, m, 1)
    const end   = new Date(year, m+1, 0, 23, 59, 59)
    const base  = allTxs.filter(t => {
      const d = new Date(t.date+'T00:00:00')
      return d >= start && d <= end && PL_CATS.has(t.category)
    })
    const pos = txs => txs.filter(t => Number(t.amount) > 0).reduce((s,t) => s+Number(t.amount), 0)
    const neg = txs => txs.filter(t => Number(t.amount) < 0).reduce((s,t) => s+Math.abs(Number(t.amount)), 0)
    const rentRevenue  = pos(base.filter(t => t.category === 'Rent'))
    const otherRevenue = pos(base.filter(t => t.category === 'Other'))
    const totalRevenue = rentRevenue + otherRevenue
    const mortgageExp  = neg(base.filter(t => t.category === 'Mortgage'))
    const repairExp    = neg(base.filter(t => t.category === 'Repair'))
    const otherExp     = neg(base.filter(t => !['Rent','Mortgage','Repair'].includes(t.category)))
    const totalExpenses = mortgageExp + repairExp + otherExp
    const noi = totalRevenue - totalExpenses
    return { month: m, rentRevenue, otherRevenue, totalRevenue, mortgageExp, repairExp, otherExp, totalExpenses, noi }
  })
}

// ── Knox letterhead print export ──────────────────────────────────────────────

const PRINT_CSS = `
  * { box-sizing: border-box; }
  body { font-family: Arial, Helvetica, sans-serif; font-size: 11px; color: #1e293b; margin: 0; padding: 28px 32px; }
  .letterhead { display: flex; align-items: flex-start; justify-content: space-between; border-bottom: 3px solid #0f2544; padding-bottom: 14px; margin-bottom: 22px; }
  .letterhead img { height: 56px; }
  .letterhead-right { text-align: right; }
  .letterhead-right h1 { font-size: 18px; color: #0f2544; margin: 0 0 2px; letter-spacing: 0.03em; }
  .letterhead-right p { font-size: 10px; color: #64748b; margin: 1px 0; }
  .report-title { font-size: 15px; font-weight: bold; color: #0f2544; margin: 0 0 2px; }
  .report-sub   { font-size: 10px; color: #64748b; margin: 0 0 18px; }
  table { width: 100%; border-collapse: collapse; margin-bottom: 20px; }
  th { background: #f1f5f9; padding: 6px 10px; text-align: left; font-size: 9px; text-transform: uppercase; letter-spacing: 0.06em; color: #475569; border-bottom: 1px solid #e2e8f0; white-space: nowrap; }
  th.r { text-align: right; }
  td { padding: 5px 10px; border-bottom: 1px solid #f1f5f9; vertical-align: top; }
  td.r { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
  tr.section { background: #f8fafc; }
  tr.section td { font-size: 9px; font-weight: bold; text-transform: uppercase; letter-spacing: 0.07em; color: #94a3b8; padding: 10px 10px 3px; border-bottom: none; }
  tr.subtotal td { font-weight: 600; background: #f8fafc; border-top: 1px solid #e2e8f0; }
  tr.grandtotal td { font-weight: bold; background: #f1f5f9; border-top: 2px solid #cbd5e1; font-size: 12px; }
  tr.noi td { font-weight: bold; font-size: 12px; background: #f0fdf4; border-top: 2px solid #a7f3d0; }
  tr.noi-neg td { font-weight: bold; font-size: 12px; background: #fff5f5; border-top: 2px solid #fecaca; }
  .pos { color: #059669; }
  .neg { color: #dc2626; }
  .muted { color: #94a3b8; }
  .note { font-size: 9px; color: #94a3b8; font-style: italic; display: block; margin-top: 1px; }
  .balanced { color: #059669; font-size: 10px; font-weight: 600; }
  .footer { margin-top: 32px; border-top: 1px solid #e2e8f0; padding-top: 8px; font-size: 9px; color: #94a3b8; display: flex; justify-content: space-between; }
  @media print { @page { margin: 0.6in; } body { padding: 0; } }
`

function letterhead(subtitle) {
  const logoUrl = `${window.location.origin}${knoxLogo}`
  const now = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })
  return `
    <div class="letterhead">
      <img src="${logoUrl}" alt="Knox Capital" />
      <div class="letterhead-right">
        <h1>Knox Capital</h1>
        <p>${subtitle}</p>
        <p>Generated ${now}</p>
      </div>
    </div>`
}

function openPrintWindow(title, subtitle, bodyHtml) {
  const win = window.open('', '_blank', 'width=900,height=700')
  win.document.write(`<!DOCTYPE html><html><head>
    <meta charset="utf-8"/>
    <title>${title}</title>
    <style>${PRINT_CSS}</style>
  </head><body>
    ${letterhead(subtitle)}
    ${bodyHtml}
    <div class="footer">
      <span>Knox Capital — Confidential</span>
      <span>${title}</span>
    </div>
  </body></html>`)
  win.document.close()
  // slight delay so images load before print dialog opens
  setTimeout(() => { win.focus(); win.print() }, 600)
}

function exportBS(total, rows, asOf) {
  const R = (label, val, cls = '', note = '') =>
    `<tr><td>${label}${note ? `<span class="note">${note}</span>` : ''}</td><td class="r ${cls}">${val}</td></tr>`

  const propRows = rows.map(r => {
    const b = r.bs
    return `<tr>
      <td style="padding-left:20px">${r.address}${r.city||r.state ? `<span class="note">${[r.city,r.state].filter(Boolean).join(', ')}</span>` : ''}</td>
      <td class="r">${fmt$(b.totalRealEstate)}</td>
      <td class="r ${b.totalCash<0?'neg':''}">${fmt$(b.totalCash)}</td>
      <td class="r">${fmt$(b.totalAssets)}</td>
      <td class="r">${fmt$(b.loanBalance)||'—'}</td>
      <td class="r ${b.totalEquity>=0?'pos':'neg'}">${fmt$(b.totalEquity)}</td>
    </tr>`
  }).join('')

  const totalLE  = total.totalLiabilities + total.totalEquity
  const balanced = Math.abs(total.totalAssets - totalLE) < rows.length * 2

  const html = `
    <p class="report-title">Portfolio Balance Sheet</p>
    <p class="report-sub">As of ${asOf}</p>

    <table>
      <tr class="section"><td colspan="2">Assets</td></tr>
      ${R('Real Property (at cost)', fmt$(total.totalRealEstate))}
      ${R('Cash & Cash Equivalents', `<span class="${total.totalCash<0?'neg':''}">${fmt$(total.totalCash)}</span>`, '', 'Operational cash flows since acquisition')}
      <tr class="subtotal">${R('Total Assets', `<span class="${total.totalAssets>=0?'pos':'neg'}">${fmt$(total.totalAssets)}</span>`)}</tr>

      <tr class="section"><td colspan="2">Liabilities</td></tr>
      ${R('Mortgage Payable (original balance)', fmt$(total.loanBalance), '', 'Actual outstanding balance lower as principal paid down')}
      <tr class="subtotal">${R('Total Liabilities', fmt$(total.totalLiabilities))}</tr>

      <tr class="section"><td colspan="2">Equity</td></tr>
      ${total.exchange1031     > 0 ? R('1031 Exchange Proceeds',           fmt$(total.exchange1031))        : ''}
      ${total.acquisitionCredits>0 ? R('Acquisition Credits (prorations)', fmt$(total.acquisitionCredits)) : ''}
      ${total.investedCapital  > 0 ? R('Invested Capital',                 fmt$(total.investedCapital))     : ''}
      ${R('Retained Earnings (Deficit)', `<span class="${total.retainedEarnings>=0?'pos':'neg'}">${fmt$(total.retainedEarnings)}</span>`)}
      <tr class="subtotal">${R('Total Equity', `<span class="${total.totalEquity>=0?'pos':'neg'}">${fmt$(total.totalEquity)}</span>`)}</tr>

      <tr class="grandtotal"><td colspan="2"></td></tr>
      ${R('Total Liabilities + Equity', fmt$(totalLE))}
    </table>
    <p class="${balanced?'balanced':'neg'}">${balanced ? '✓ Balanced' : `⚠ Difference: ${fmt$(Math.abs(total.totalAssets-totalLE))}`}</p>

    <br/>
    <p class="report-title" style="font-size:13px">By Property</p>
    <table>
      <thead>
        <tr>
          <th>Property</th><th class="r">Real Property</th><th class="r">Cash</th>
          <th class="r">Total Assets</th><th class="r">Mortgage</th><th class="r">Equity</th>
        </tr>
      </thead>
      <tbody>
        ${propRows}
        <tr class="grandtotal">
          <td>Portfolio Total</td>
          <td class="r">${fmt$(total.totalRealEstate)}</td>
          <td class="r ${total.totalCash<0?'neg':''}">${fmt$(total.totalCash)}</td>
          <td class="r">${fmt$(total.totalAssets)}</td>
          <td class="r">${fmt$(total.loanBalance)}</td>
          <td class="r ${total.totalEquity>=0?'pos':'neg'}">${fmt$(total.totalEquity)}</td>
        </tr>
      </tbody>
    </table>`

  openPrintWindow('Portfolio Balance Sheet', 'Balance Sheet', html)
}

function exportPL(total, rows, periodLabel, monthlyGrid, year) {
  const propRows = rows.map(r => {
    const pl = r.pl
    return `<tr>
      <td>${r.address}${r.city||r.state ? `<span class="note">${[r.city,r.state].filter(Boolean).join(', ')}</span>` : ''}</td>
      <td class="r pos">${pl.totalRevenue > 0 ? fmt$(pl.totalRevenue) : '<span class="muted">—</span>'}</td>
      <td class="r neg">${pl.mortgageExp  > 0 ? fmt$(pl.mortgageExp)  : '<span class="muted">—</span>'}</td>
      <td class="r neg">${pl.repairExp    > 0 ? fmt$(pl.repairExp)    : '<span class="muted">—</span>'}</td>
      <td class="r neg">${pl.otherExp     > 0 ? fmt$(pl.otherExp)     : '<span class="muted">—</span>'}</td>
      <td class="r ${pl.noi>=0?'pos':'neg'}">${fmt$(pl.noi)}</td>
      <td class="r muted">${fmtPct(pl.margin)}</td>
    </tr>`
  }).join('')

  const noiCls = total.noi >= 0 ? 'noi' : 'noi-neg'

  // Monthly grid
  const totalRow = monthlyGrid.reduce((acc, m) => ({
    rentRevenue:  acc.rentRevenue  + m.rentRevenue,
    otherRevenue: acc.otherRevenue + m.otherRevenue,
    totalRevenue: acc.totalRevenue + m.totalRevenue,
    mortgageExp:  acc.mortgageExp  + m.mortgageExp,
    repairExp:    acc.repairExp    + m.repairExp,
    otherExp:     acc.otherExp     + m.otherExp,
    totalExpenses:acc.totalExpenses+ m.totalExpenses,
    noi:          acc.noi          + m.noi,
  }), { rentRevenue:0, otherRevenue:0, totalRevenue:0, mortgageExp:0, repairExp:0, otherExp:0, totalExpenses:0, noi:0 })

  const mHeaders = MONTH_NAMES.map(m => `<th class="r">${m}</th>`).join('')
  const mCell    = (val, cls='') => `<td class="r ${cls}">${fmtNum(val)}</td>`

  const monthlyHtml = `
    <br/>
    <p class="report-title" style="font-size:13px">Monthly Breakdown — ${year}</p>
    <div style="overflow-x:auto">
    <table>
      <thead><tr><th>Line Item</th>${mHeaders}<th class="r">Total</th></tr></thead>
      <tbody>
        <tr class="section"><td colspan="14">Revenue</td></tr>
        <tr>
          <td style="padding-left:14px">Rental Income</td>
          ${monthlyGrid.map(m => mCell(m.rentRevenue,'pos')).join('')}
          <td class="r pos">${fmtNum(totalRow.rentRevenue)}</td>
        </tr>
        ${totalRow.otherRevenue > 0 ? `<tr>
          <td style="padding-left:14px">Other Income</td>
          ${monthlyGrid.map(m => mCell(m.otherRevenue,'pos')).join('')}
          <td class="r pos">${fmtNum(totalRow.otherRevenue)}</td>
        </tr>` : ''}
        <tr class="subtotal">
          <td>Total Revenue</td>
          ${monthlyGrid.map(m => `<td class="r pos">${fmtNum(m.totalRevenue)}</td>`).join('')}
          <td class="r pos">${fmtNum(totalRow.totalRevenue)}</td>
        </tr>

        <tr class="section"><td colspan="14">Expenses</td></tr>
        ${totalRow.mortgageExp > 0 ? `<tr>
          <td style="padding-left:14px">Mortgage</td>
          ${monthlyGrid.map(m => mCell(m.mortgageExp,'neg')).join('')}
          <td class="r neg">${fmtNum(totalRow.mortgageExp)}</td>
        </tr>` : ''}
        ${totalRow.repairExp > 0 ? `<tr>
          <td style="padding-left:14px">Repairs</td>
          ${monthlyGrid.map(m => mCell(m.repairExp,'neg')).join('')}
          <td class="r neg">${fmtNum(totalRow.repairExp)}</td>
        </tr>` : ''}
        ${totalRow.otherExp > 0 ? `<tr>
          <td style="padding-left:14px">Other</td>
          ${monthlyGrid.map(m => mCell(m.otherExp,'neg')).join('')}
          <td class="r neg">${fmtNum(totalRow.otherExp)}</td>
        </tr>` : ''}
        <tr class="subtotal">
          <td>Total Expenses</td>
          ${monthlyGrid.map(m => `<td class="r neg">${fmtNum(m.totalExpenses)}</td>`).join('')}
          <td class="r neg">${fmtNum(totalRow.totalExpenses)}</td>
        </tr>

        <tr class="${totalRow.noi>=0?'noi':'noi-neg'}">
          <td>Net Operating Income</td>
          ${monthlyGrid.map(m => `<td class="r ${m.noi>=0?'pos':'neg'}">${fmtNum(m.noi)}</td>`).join('')}
          <td class="r ${totalRow.noi>=0?'pos':'neg'}">${fmtNum(totalRow.noi)}</td>
        </tr>
      </tbody>
    </table>
    </div>`

  const html = `
    <p class="report-title">Portfolio Profit & Loss</p>
    <p class="report-sub">${periodLabel}</p>

    <table>
      <tr class="section"><td colspan="2">Revenue</td></tr>
      ${total.rentRevenue  > 0 ? `<tr><td style="padding-left:14px">Rental Income</td><td class="r pos">${fmt$(total.rentRevenue)}</td></tr>`  : ''}
      ${total.otherRevenue > 0 ? `<tr><td style="padding-left:14px">Other Income</td><td class="r pos">${fmt$(total.otherRevenue)}</td></tr>` : ''}
      <tr class="subtotal"><td>Total Revenue</td><td class="r pos">${fmt$(total.totalRevenue)}</td></tr>

      <tr class="section"><td colspan="2">Expenses</td></tr>
      ${total.mortgageExp > 0 ? `<tr><td style="padding-left:14px">Mortgage / Debt Service<span class="note">Includes principal; actual interest may differ</span></td><td class="r neg">${fmt$(total.mortgageExp)}</td></tr>` : ''}
      ${total.repairExp   > 0 ? `<tr><td style="padding-left:14px">Repairs & Maintenance</td><td class="r neg">${fmt$(total.repairExp)}</td></tr>` : ''}
      ${total.otherExp    > 0 ? `<tr><td style="padding-left:14px">Other Expenses</td><td class="r neg">${fmt$(total.otherExp)}</td></tr>` : ''}
      <tr class="subtotal"><td>Total Expenses</td><td class="r neg">${fmt$(total.totalExpenses)}</td></tr>

      <tr class="${noiCls}"><td>NET OPERATING INCOME</td><td class="r ${total.noi>=0?'pos':'neg'}">${fmt$(total.noi)}</td></tr>
    </table>

    <br/>
    <p class="report-title" style="font-size:13px">By Property — ${periodLabel}</p>
    <table>
      <thead>
        <tr>
          <th>Property</th><th class="r">Revenue</th><th class="r">Mortgage</th>
          <th class="r">Repairs</th><th class="r">Other Exp</th><th class="r">NOI</th><th class="r">Margin</th>
        </tr>
      </thead>
      <tbody>
        ${propRows}
        <tr class="grandtotal">
          <td>Portfolio Total</td>
          <td class="r pos">${fmt$(total.totalRevenue)}</td>
          <td class="r neg">${fmt$(total.mortgageExp)}</td>
          <td class="r neg">${fmt$(total.repairExp)}</td>
          <td class="r neg">${fmt$(total.otherExp)}</td>
          <td class="r ${total.noi>=0?'pos':'neg'}">${fmt$(total.noi)}</td>
          <td class="r muted">${fmtPct(total.totalRevenue>0?(total.noi/total.totalRevenue)*100:null)}</td>
        </tr>
      </tbody>
    </table>
    ${monthlyHtml}`

  openPrintWindow('Portfolio P&L', `P&L — ${periodLabel}`, html)
}

// ── Shared UI helpers ─────────────────────────────────────────────────────────

function Th({ children, right }) {
  return (
    <th className={`px-3 py-2.5 text-xs font-semibold text-slate-500 uppercase tracking-wide whitespace-nowrap first:pl-5 last:pr-5 ${right?'text-right':'text-left'}`}>
      {children}
    </th>
  )
}
function Td({ children, right, bold, color, muted }) {
  return (
    <td className={['px-3 py-2.5 text-sm border-b border-slate-100 tabular-nums whitespace-nowrap first:pl-5 last:pr-5',
      right?'text-right':'', bold?'font-semibold':'', color||(muted?'text-slate-400':'text-slate-700')].join(' ')}>
      {children}
    </td>
  )
}
function TotalRow({ label, values, colorFn }) {
  return (
    <tr className="bg-slate-50 border-t-2 border-slate-200">
      <td className="px-3 pl-5 py-2.5 text-xs font-bold text-slate-500 uppercase tracking-wide">{label}</td>
      {values.map((v,i) => (
        <td key={i} className={`px-3 py-2.5 text-sm font-bold text-right tabular-nums last:pr-5 ${colorFn?colorFn(v,i):'text-slate-900'}`}>
          {typeof v==='number' ? fmt$(v) : v}
        </td>
      ))}
    </tr>
  )
}
function SummaryCard({ label, value, sub, color='text-slate-900' }) {
  return (
    <div className="bg-white border border-slate-200 rounded-xl px-5 py-4">
      <p className="text-xs text-slate-400 mb-1">{label}</p>
      <p className={`text-xl font-bold tabular-nums ${color}`}>{value}</p>
      {sub && <p className="text-xs text-slate-400 mt-0.5">{sub}</p>}
    </div>
  )
}
function BSLine({ label, value, bold, color, note }) {
  return (
    <div className="flex items-start justify-between py-1">
      <div>
        <span className={`text-sm ${bold?'font-semibold text-slate-900':'text-slate-600'}`}>{label}</span>
        {note && <p className="text-xs text-slate-400 italic">{note}</p>}
      </div>
      <span className={`text-sm tabular-nums ml-6 shrink-0 ${bold?'font-semibold':''} ${color||(bold?'text-slate-900':'text-slate-700')}`}>
        {fmt$(value)}
      </span>
    </div>
  )
}

// ── Balance Sheet view ────────────────────────────────────────────────────────

function BalanceSheetView({ properties }) {
  const [expanded, setExpanded] = useState(false)
  const rows = properties.map(p => ({ ...p, bs: computeBS(p.transactions, p.investors) }))
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
  }, { totalRealEstate:0, totalCash:0, totalAssets:0, loanBalance:0, totalLiabilities:0,
       exchange1031:0, acquisitionCredits:0, investedCapital:0, retainedEarnings:0, totalEquity:0 })

  const totalLE  = total.totalLiabilities + total.totalEquity
  const balanced = Math.abs(total.totalAssets - totalLE) < properties.length * 2
  const asOf     = new Date().toLocaleDateString('en-US', { year:'numeric', month:'long', day:'numeric' })

  return (
    <div className="space-y-6">
      {/* Summary cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <SummaryCard label="Total Real Property" value={fmt$(total.totalRealEstate)} sub="at acquisition cost" />
        <SummaryCard label="Total Mortgage Debt" value={fmt$(total.loanBalance)} sub="original balances" color="text-amber-700" />
        <SummaryCard label="Total Equity" value={fmt$(total.totalEquity)} color={total.totalEquity>=0?'text-emerald-700':'text-red-600'} />
        <SummaryCard label="Properties" value={properties.length} sub="in portfolio" />
      </div>

      {/* Consolidated BS + export button */}
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div className="px-5 py-3.5 border-b border-slate-100 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <h3 className="text-sm font-semibold text-slate-900">Portfolio Balance Sheet</h3>
            {balanced
              ? <span className="text-xs text-emerald-600 font-medium">✓ Balanced</span>
              : <span className="text-xs text-amber-600">⚠ Difference: {fmt$(Math.abs(total.totalAssets-totalLE))}</span>
            }
          </div>
          <button
            onClick={() => exportBS(total, rows, asOf)}
            className="flex items-center gap-1.5 text-xs font-medium text-blue-600 hover:text-blue-800 transition-colors px-3 py-1.5 rounded-lg border border-blue-200 hover:border-blue-400 hover:bg-blue-50"
          >
            <Download className="w-3.5 h-3.5" /> Export PDF
          </button>
        </div>

        <div className="px-5 py-4 divide-y divide-slate-100">
          <div className="pb-3">
            <p className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">Assets</p>
            <BSLine label="Real Property (at cost)" value={total.totalRealEstate} />
            <BSLine label="Cash & Cash Equivalents" value={total.totalCash}
              note="Operational cash flows since acquisition"
              color={total.totalCash>=0?undefined:'text-red-600'} />
            <BSLine label="TOTAL ASSETS" value={total.totalAssets} bold
              color={total.totalAssets>=0?'text-emerald-700':'text-red-600'} />
          </div>
          <div className="py-3">
            <p className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2 pt-1">Liabilities</p>
            <BSLine label="Mortgage Payable (original)" value={total.loanBalance}
              note="Actual outstanding balance lower as principal paid down" />
            <BSLine label="TOTAL LIABILITIES" value={total.totalLiabilities} bold />
          </div>
          <div className="pt-3">
            <p className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">Equity</p>
            {total.exchange1031      > 0 && <BSLine label="1031 Exchange Proceeds"         value={total.exchange1031} />}
            {total.acquisitionCredits> 0 && <BSLine label="Acquisition Credits (prorations)" value={total.acquisitionCredits} />}
            {total.investedCapital   > 0 && <BSLine label="Invested Capital"               value={total.investedCapital} />}
            <BSLine label="Retained Earnings (Deficit)" value={total.retainedEarnings}
              color={total.retainedEarnings>=0?'text-emerald-700':'text-red-600'} />
            <BSLine label="TOTAL EQUITY" value={total.totalEquity} bold
              color={total.totalEquity>=0?'text-emerald-700':'text-red-600'} />
          </div>
          <div className="pt-3">
            <BSLine label="TOTAL LIABILITIES + EQUITY" value={totalLE} bold />
          </div>
        </div>
      </div>

      {/* Per-property table */}
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <button
          onClick={() => setExpanded(e=>!e)}
          className="w-full flex items-center justify-between px-5 py-3.5 border-b border-slate-100 hover:bg-slate-50 transition-colors text-left"
        >
          <span className="text-sm font-semibold text-slate-900">By Property</span>
          {expanded ? <ChevronDown className="w-4 h-4 text-slate-400" /> : <ChevronRight className="w-4 h-4 text-slate-400" />}
        </button>
        {expanded && (
          <div className="overflow-x-auto">
            <table className="w-full text-sm border-collapse min-w-[700px]">
              <thead><tr className="bg-slate-50 border-b border-slate-200">
                <Th>Property</Th><Th right>Real Property</Th><Th right>Cash</Th>
                <Th right>Total Assets</Th><Th right>Mortgage</Th><Th right>Equity</Th>
              </tr></thead>
              <tbody>
                {rows.map(r => {
                  const b = r.bs
                  return (
                    <tr key={r.id} className="hover:bg-slate-50/60">
                      <Td><div>
                        <p className="font-medium text-slate-900 truncate max-w-[200px]">{r.address}</p>
                        {(r.city||r.state) && <p className="text-xs text-slate-400">{[r.city,r.state].filter(Boolean).join(', ')}</p>}
                      </div></Td>
                      <Td right>{fmt$(b.totalRealEstate)}</Td>
                      <Td right color={b.totalCash<0?'text-red-600':undefined}>{fmt$(b.totalCash)}</Td>
                      <Td right bold>{fmt$(b.totalAssets)}</Td>
                      <Td right color="text-amber-700">{b.loanBalance>0?fmt$(b.loanBalance):'—'}</Td>
                      <Td right bold color={b.totalEquity>=0?'text-emerald-700':'text-red-600'}>{fmt$(b.totalEquity)}</Td>
                    </tr>
                  )
                })}
              </tbody>
              <TotalRow label="Portfolio Total"
                values={[total.totalRealEstate, total.totalCash, total.totalAssets, total.loanBalance, total.totalEquity]}
                colorFn={(v,i) => {
                  if (i===4) return v>=0?'text-emerald-700':'text-red-600'
                  if (i===3) return 'text-amber-700'
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

// ── P&L view ──────────────────────────────────────────────────────────────────

function PLView({ properties }) {
  const [period,   setPeriod]   = useState('all')
  const [fromDate, setFromDate] = useState('')
  const [toDate,   setToDate]   = useState('')
  const [expanded, setExpanded] = useState(false)
  const [monthYear, setMonthYear] = useState(new Date().getFullYear())

  const rows = properties.map(p => ({ ...p, pl: computePL(p.transactions, period, fromDate, toDate) }))
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
  }, { rentRevenue:0, otherRevenue:0, totalRevenue:0, mortgageExp:0, repairExp:0, otherExp:0, totalExpenses:0, noi:0 })

  const totalMargin = total.totalRevenue > 0 ? (total.noi/total.totalRevenue)*100 : null

  const periodLabel = {
    all: 'All Time', ytd: `YTD ${new Date().getFullYear()}`,
    ly: 'Last 12 Months',
    custom: fromDate||toDate ? `${fromDate||'…'} → ${toDate||'…'}` : 'Custom Range',
  }[period]

  // Monthly grid
  const monthlyGrid = computeMonthlyGrid(properties, monthYear)
  const monthlyTotal = monthlyGrid.reduce((acc, m) => ({
    rentRevenue:   acc.rentRevenue   + m.rentRevenue,
    otherRevenue:  acc.otherRevenue  + m.otherRevenue,
    totalRevenue:  acc.totalRevenue  + m.totalRevenue,
    mortgageExp:   acc.mortgageExp   + m.mortgageExp,
    repairExp:     acc.repairExp     + m.repairExp,
    otherExp:      acc.otherExp      + m.otherExp,
    totalExpenses: acc.totalExpenses + m.totalExpenses,
    noi:           acc.noi           + m.noi,
  }), { rentRevenue:0, otherRevenue:0, totalRevenue:0, mortgageExp:0, repairExp:0, otherExp:0, totalExpenses:0, noi:0 })

  const hasMonthlyData = monthlyGrid.some(m => m.totalRevenue > 0 || m.totalExpenses > 0)

  const MonthCell = ({ val, color }) => (
    <td className={`px-2 py-2.5 text-right text-xs tabular-nums border-b border-slate-100 ${color||'text-slate-700'} ${val===0?'text-slate-300':''}`}>
      {val === 0 ? '—' : fmtNum(val)}
    </td>
  )

  return (
    <div className="space-y-6">
      {/* Period filter */}
      <div className="flex items-center gap-3 flex-wrap">
        <span className="text-sm text-slate-500">Period:</span>
        {['all','ytd','ly','custom'].map(p => (
          <button key={p} onClick={() => setPeriod(p)}
            className={`px-3 py-1.5 text-sm rounded-lg border transition-colors ${
              period===p ? 'bg-blue-600 border-blue-600 text-white' : 'bg-white border-slate-200 text-slate-600 hover:border-blue-300'
            }`}>
            {{ all:'All Time', ytd:`YTD ${new Date().getFullYear()}`, ly:'Last 12 Mo', custom:'Custom' }[p]}
          </button>
        ))}
        {period==='custom' && (
          <div className="flex items-center gap-2 ml-2">
            <input type="date" value={fromDate} onChange={e=>setFromDate(e.target.value)}
              className="text-sm border border-slate-200 rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-400" />
            <span className="text-slate-400 text-sm">→</span>
            <input type="date" value={toDate} onChange={e=>setToDate(e.target.value)}
              className="text-sm border border-slate-200 rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-400" />
          </div>
        )}
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <SummaryCard label="Total Revenue" value={fmt$(total.totalRevenue)} sub={periodLabel} color="text-emerald-700" />
        <SummaryCard label="Total Expenses" value={fmt$(total.totalExpenses)} color="text-red-600" />
        <SummaryCard label="Net Operating Income" value={fmt$(total.noi)}
          color={total.noi>=0?'text-emerald-700':'text-red-600'}
          sub={totalMargin!=null?`${Math.round(totalMargin)}% margin`:undefined} />
        <SummaryCard label="Properties w/ Income" value={rows.filter(r=>r.pl.totalRevenue>0).length}
          sub={`of ${properties.length} total`} />
      </div>

      {/* Consolidated P&L + export */}
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div className="px-5 py-3.5 border-b border-slate-100 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-slate-900">Portfolio P&amp;L — {periodLabel}</h3>
          <button
            onClick={() => exportPL(total, rows, periodLabel, monthlyGrid, monthYear)}
            className="flex items-center gap-1.5 text-xs font-medium text-blue-600 hover:text-blue-800 transition-colors px-3 py-1.5 rounded-lg border border-blue-200 hover:border-blue-400 hover:bg-blue-50"
          >
            <Download className="w-3.5 h-3.5" /> Export PDF
          </button>
        </div>
        <div className="px-5 py-4 divide-y divide-slate-100">
          <div className="pb-3">
            <p className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">Revenue</p>
            {total.rentRevenue  > 0 && <BSLine label="Rental Income"  value={total.rentRevenue}  color="text-emerald-700" />}
            {total.otherRevenue > 0 && <BSLine label="Other Income"   value={total.otherRevenue} color="text-emerald-700" />}
            {total.totalRevenue===0 && <p className="text-sm text-slate-400 py-1">No revenue in this period</p>}
            <BSLine label="TOTAL REVENUE" value={total.totalRevenue} bold color="text-emerald-700" />
          </div>
          <div className="py-3">
            <p className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2 pt-1">Expenses</p>
            {total.mortgageExp > 0 && <BSLine label="Mortgage / Debt Service" value={total.mortgageExp} color="text-red-600"
              note="Includes principal; actual interest may differ" />}
            {total.repairExp   > 0 && <BSLine label="Repairs & Maintenance"   value={total.repairExp}   color="text-red-600" />}
            {total.otherExp    > 0 && <BSLine label="Other Expenses"          value={total.otherExp}    color="text-red-600" />}
            {total.totalExpenses===0 && <p className="text-sm text-slate-400 py-1">No expenses in this period</p>}
            <BSLine label="TOTAL EXPENSES" value={total.totalExpenses} bold color="text-red-600" />
          </div>
          <div className="pt-3">
            <div className="flex items-center justify-between bg-slate-50 rounded-xl px-4 py-3">
              <span className="text-sm font-bold text-slate-900">NET OPERATING INCOME</span>
              <div className="text-right">
                <span className={`text-xl font-bold tabular-nums ${total.noi>=0?'text-emerald-700':'text-red-600'}`}>{fmt$(total.noi)}</span>
                {totalMargin!=null && <p className="text-xs text-slate-400 mt-0.5">{Math.round(totalMargin)}% margin</p>}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ── Monthly Breakdown ── */}
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div className="px-5 py-3.5 border-b border-slate-100 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-slate-900">Monthly Breakdown</h3>
          <div className="flex items-center gap-2">
            <button onClick={() => setMonthYear(y => y-1)}
              className="px-2 py-1 text-slate-500 hover:text-slate-800 hover:bg-slate-100 rounded transition-colors text-sm">‹</button>
            <span className="text-sm font-semibold text-slate-700 w-12 text-center">{monthYear}</span>
            <button onClick={() => setMonthYear(y => y+1)}
              disabled={monthYear >= new Date().getFullYear()}
              className="px-2 py-1 text-slate-500 hover:text-slate-800 hover:bg-slate-100 rounded transition-colors text-sm disabled:opacity-30">›</button>
          </div>
        </div>

        {!hasMonthlyData ? (
          <p className="text-sm text-slate-400 px-5 py-6 text-center">No transactions recorded in {monthYear}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse" style={{ minWidth: '900px' }}>
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200">
                  <th className="px-4 pl-5 py-2.5 text-xs font-semibold text-slate-500 uppercase tracking-wide text-left whitespace-nowrap w-36">Line Item</th>
                  {MONTH_NAMES.map(m => (
                    <th key={m} className="px-2 py-2.5 text-xs font-semibold text-slate-500 uppercase tracking-wide text-right whitespace-nowrap">{m}</th>
                  ))}
                  <th className="px-3 pr-5 py-2.5 text-xs font-semibold text-slate-500 uppercase tracking-wide text-right whitespace-nowrap">Total</th>
                </tr>
              </thead>
              <tbody>
                {/* Revenue */}
                <tr className="bg-slate-50/70">
                  <td colSpan={14} className="px-4 pl-5 py-1.5 text-xs font-bold text-slate-400 uppercase tracking-wider">Revenue</td>
                </tr>
                <tr>
                  <td className="px-4 pl-5 py-2 text-sm text-slate-600 border-b border-slate-100">Rental Income</td>
                  {monthlyGrid.map(m => <MonthCell key={m.month} val={m.rentRevenue}  color="text-emerald-700" />)}
                  <td className={`px-3 pr-5 py-2 text-sm text-right font-semibold tabular-nums border-b border-slate-100 ${monthlyTotal.rentRevenue>0?'text-emerald-700':'text-slate-300'}`}>{fmtNum(monthlyTotal.rentRevenue)}</td>
                </tr>
                {monthlyTotal.otherRevenue > 0 && (
                  <tr>
                    <td className="px-4 pl-5 py-2 text-sm text-slate-600 border-b border-slate-100">Other Income</td>
                    {monthlyGrid.map(m => <MonthCell key={m.month} val={m.otherRevenue} color="text-emerald-700" />)}
                    <td className={`px-3 pr-5 py-2 text-sm text-right font-semibold tabular-nums border-b border-slate-100 ${monthlyTotal.otherRevenue>0?'text-emerald-700':'text-slate-300'}`}>{fmtNum(monthlyTotal.otherRevenue)}</td>
                  </tr>
                )}
                <tr className="bg-emerald-50/40">
                  <td className="px-4 pl-5 py-2 text-sm font-semibold text-slate-800 border-b border-slate-200">Total Revenue</td>
                  {monthlyGrid.map(m => (
                    <td key={m.month} className={`px-2 py-2 text-right text-xs font-semibold tabular-nums border-b border-slate-200 ${m.totalRevenue>0?'text-emerald-700':'text-slate-300'}`}>{fmtNum(m.totalRevenue)}</td>
                  ))}
                  <td className={`px-3 pr-5 py-2 text-sm text-right font-bold tabular-nums border-b border-slate-200 ${monthlyTotal.totalRevenue>0?'text-emerald-700':'text-slate-300'}`}>{fmtNum(monthlyTotal.totalRevenue)}</td>
                </tr>

                {/* Expenses */}
                <tr className="bg-slate-50/70">
                  <td colSpan={14} className="px-4 pl-5 py-1.5 text-xs font-bold text-slate-400 uppercase tracking-wider">Expenses</td>
                </tr>
                {monthlyTotal.mortgageExp > 0 && (
                  <tr>
                    <td className="px-4 pl-5 py-2 text-sm text-slate-600 border-b border-slate-100">Mortgage</td>
                    {monthlyGrid.map(m => <MonthCell key={m.month} val={m.mortgageExp} color="text-amber-700" />)}
                    <td className={`px-3 pr-5 py-2 text-sm text-right font-semibold tabular-nums border-b border-slate-100 ${monthlyTotal.mortgageExp>0?'text-amber-700':'text-slate-300'}`}>{fmtNum(monthlyTotal.mortgageExp)}</td>
                  </tr>
                )}
                {monthlyTotal.repairExp > 0 && (
                  <tr>
                    <td className="px-4 pl-5 py-2 text-sm text-slate-600 border-b border-slate-100">Repairs</td>
                    {monthlyGrid.map(m => <MonthCell key={m.month} val={m.repairExp} color="text-red-600" />)}
                    <td className={`px-3 pr-5 py-2 text-sm text-right font-semibold tabular-nums border-b border-slate-100 ${monthlyTotal.repairExp>0?'text-red-600':'text-slate-300'}`}>{fmtNum(monthlyTotal.repairExp)}</td>
                  </tr>
                )}
                {monthlyTotal.otherExp > 0 && (
                  <tr>
                    <td className="px-4 pl-5 py-2 text-sm text-slate-600 border-b border-slate-100">Other</td>
                    {monthlyGrid.map(m => <MonthCell key={m.month} val={m.otherExp} color="text-red-600" />)}
                    <td className={`px-3 pr-5 py-2 text-sm text-right font-semibold tabular-nums border-b border-slate-100 ${monthlyTotal.otherExp>0?'text-red-600':'text-slate-300'}`}>{fmtNum(monthlyTotal.otherExp)}</td>
                  </tr>
                )}
                <tr className="bg-red-50/30">
                  <td className="px-4 pl-5 py-2 text-sm font-semibold text-slate-800 border-b border-slate-200">Total Expenses</td>
                  {monthlyGrid.map(m => (
                    <td key={m.month} className={`px-2 py-2 text-right text-xs font-semibold tabular-nums border-b border-slate-200 ${m.totalExpenses>0?'text-red-600':'text-slate-300'}`}>{fmtNum(m.totalExpenses)}</td>
                  ))}
                  <td className={`px-3 pr-5 py-2 text-sm text-right font-bold tabular-nums border-b border-slate-200 ${monthlyTotal.totalExpenses>0?'text-red-600':'text-slate-300'}`}>{fmtNum(monthlyTotal.totalExpenses)}</td>
                </tr>

                {/* NOI */}
                <tr className="bg-slate-100">
                  <td className="px-4 pl-5 py-2.5 text-sm font-bold text-slate-900 border-t border-slate-300">Net Operating Income</td>
                  {monthlyGrid.map(m => (
                    <td key={m.month} className={`px-2 py-2.5 text-right text-xs font-bold tabular-nums border-t border-slate-300 ${
                      m.noi > 0 ? 'text-emerald-700' : m.noi < 0 ? 'text-red-600' : 'text-slate-300'
                    }`}>{m.noi===0 ? '—' : fmtNum(m.noi)}</td>
                  ))}
                  <td className={`px-3 pr-5 py-2.5 text-sm text-right font-bold tabular-nums border-t border-slate-300 ${monthlyTotal.noi>=0?'text-emerald-700':'text-red-600'}`}>{fmtNum(monthlyTotal.noi)}</td>
                </tr>
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Per-property table */}
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <button
          onClick={() => setExpanded(e=>!e)}
          className="w-full flex items-center justify-between px-5 py-3.5 border-b border-slate-100 hover:bg-slate-50 transition-colors text-left"
        >
          <span className="text-sm font-semibold text-slate-900">By Property</span>
          {expanded ? <ChevronDown className="w-4 h-4 text-slate-400" /> : <ChevronRight className="w-4 h-4 text-slate-400" />}
        </button>
        {expanded && (
          <div className="overflow-x-auto">
            <table className="w-full text-sm border-collapse min-w-[700px]">
              <thead><tr className="bg-slate-50 border-b border-slate-200">
                <Th>Property</Th><Th right>Revenue</Th><Th right>Mortgage</Th>
                <Th right>Repairs</Th><Th right>Other Exp</Th><Th right>NOI</Th><Th right>Margin</Th>
              </tr></thead>
              <tbody>
                {rows.map(r => {
                  const pl = r.pl
                  return (
                    <tr key={r.id} className="hover:bg-slate-50/60">
                      <Td><div>
                        <p className="font-medium text-slate-900 truncate max-w-[200px]">{r.address}</p>
                        {(r.city||r.state) && <p className="text-xs text-slate-400">{[r.city,r.state].filter(Boolean).join(', ')}</p>}
                      </div></Td>
                      <Td right color="text-emerald-700">{pl.totalRevenue>0?fmt$(pl.totalRevenue):<span className="text-slate-300">—</span>}</Td>
                      <Td right color="text-amber-700">{pl.mortgageExp>0?fmt$(pl.mortgageExp):<span className="text-slate-300">—</span>}</Td>
                      <Td right color="text-red-600">{pl.repairExp>0?fmt$(pl.repairExp):<span className="text-slate-300">—</span>}</Td>
                      <Td right color="text-red-600">{pl.otherExp>0?fmt$(pl.otherExp):<span className="text-slate-300">—</span>}</Td>
                      <Td right bold color={pl.noi>=0?'text-emerald-700':'text-red-600'}>{fmt$(pl.noi)}</Td>
                      <Td right muted>{fmtPct(pl.margin)}</Td>
                    </tr>
                  )
                })}
              </tbody>
              <TotalRow label="Portfolio Total"
                values={[total.totalRevenue, total.mortgageExp, total.repairExp, total.otherExp, total.noi,
                  totalMargin!=null?fmtPct(totalMargin):'—']}
                colorFn={(v,i) => {
                  if (i===4) return (typeof v==='number'&&v>=0)?'text-emerald-700':'text-red-600'
                  if (i===5) return 'text-slate-600'
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
  const [activeTab,  setActiveTab]  = useState('balance')

  const load = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true); else setLoading(true)
    setError(null)
    try { setProperties(await getAccountingReports()) }
    catch (e) { setError(e.message) }
    finally { setLoading(false); setRefreshing(false) }
  }, [])

  useEffect(() => { load() }, [load])

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <header className="shrink-0 px-6 pt-5 pb-0 bg-white border-b border-slate-200">
        <div className="flex items-center gap-3 mb-3">
          <button onClick={() => navigate('/accounting')}
            className="flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-800 transition-colors">
            <ArrowLeft className="w-4 h-4" /> Accounting
          </button>
        </div>
        <div className="flex items-center justify-between mb-3">
          <h1 className="text-xl font-semibold text-slate-900">Portfolio Reports</h1>
          <button onClick={() => load(true)} disabled={refreshing}
            className="flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-700 transition-colors disabled:opacity-50">
            <RefreshCw className={`w-4 h-4 ${refreshing?'animate-spin':''}`} />
            {refreshing ? 'Refreshing…' : 'Refresh'}
          </button>
        </div>
        <div className="flex items-center gap-0">
          {[
            { key:'balance', label:'Balance Sheet', Icon:Scale },
            { key:'pl',      label:'P&L',           Icon:BarChart2 },
          ].map(({ key, label, Icon }) => (
            <button key={key} onClick={() => setActiveTab(key)}
              className={['flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors whitespace-nowrap',
                activeTab===key
                  ? 'border-blue-500 text-blue-600'
                  : 'border-transparent text-slate-500 hover:text-slate-700 hover:border-slate-300',
              ].join(' ')}>
              <Icon className="w-3.5 h-3.5" />{label}
            </button>
          ))}
        </div>
      </header>

      <div className="flex-1 overflow-y-auto p-6">
        {loading && <div className="flex items-center justify-center py-20"><Loader2 className="w-6 h-6 text-slate-400 animate-spin" /></div>}
        {error   && <div className="mb-4 px-4 py-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">{error}</div>}
        {!loading && properties.length === 0 && (
          <div className="flex flex-col items-center justify-center py-20 text-slate-400 gap-2">
            <p className="text-sm font-medium">No portfolio properties with transactions</p>
            <p className="text-xs">Add transactions to properties to generate reports</p>
          </div>
        )}
        {!loading && properties.length > 0 && (
          <>
            {activeTab==='balance' && <BalanceSheetView properties={properties} />}
            {activeTab==='pl'      && <PLView properties={properties} />}
          </>
        )}
      </div>
    </div>
  )
}
