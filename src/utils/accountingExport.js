// Build + download the full accounting package (Ledger, Balance Sheet, P&L,
// Cash Flow, Schedule E) for a property, as an Excel workbook or a print-to-PDF view.
import * as XLSX from 'xlsx'
import { computePL, computeCashFlow, computeScheduleE, computeBalanceSheet, computeDepreciation, recoveryYears, computeVendorSummary } from './accounting'

const money = n => (n == null || n === '' ? '' : Number(n))

function propTitle(property) {
  if (!property) return 'Property'
  return [property.address, [property.city, property.state].filter(Boolean).join(', ')].filter(Boolean).join(' — ')
}

// ── Each report as an array-of-arrays (rows) ──────────────────────────────────
export function ledgerRows(transactions) {
  const head = ['Date', 'Description', 'Category', 'Amount', 'Source', 'Status', 'Reconciled', 'Vendor', 'Investor']
  const body = transactions.map(t => [
    String(t.date).slice(0, 10), t.description || '', t.category || '', money(t.amount),
    t.source || '', t.review_status || '', t.reconciled ? 'Yes' : 'No', t.vendor || '', t.investor_name || '',
  ])
  return [head, ...body]
}

export function balanceSheetRows(recorded, investors) {
  const b = computeBalanceSheet(recorded, investors)
  return [
    ['ASSETS', ''],
    ['  Building (at cost)', money(b.building)],
    ['  Land (at cost)', money(b.land)],
    ['  Cash', money(b.totalCash)],
    ['Total Assets', money(b.totalAssets)],
    ['', ''],
    ['LIABILITIES', ''],
    ['  Loan Balance', money(b.loanBalance)],
    ...(b.memberLoan ? [['  Member Loan (Due to Owner)', money(b.memberLoan)]] : []),
    ['Total Liabilities', money(b.totalLiabilities)],
    ['', ''],
    ['EQUITY', ''],
    ['  Invested Capital', money(b.investedCapital)],
    ['  1031 Exchange Proceeds', money(b.exchange1031)],
    ['  Acquisition Credits', money(b.acquisitionCredits)],
    ['  Retained Earnings', money(b.retainedEarnings)],
    ['Total Equity', money(b.totalEquity)],
  ]
}

export function plRows(recorded) {
  const p = computePL(recorded)
  // Operating principal only — the loan PAYOFF at sale (source 'Sale') is a
  // disposition/financing event, not operating debt service. Including it made
  // "Cash Available" show a nonsensical ~−$493k on sold deals.
  const opPrincipal = (p.principalTxs || [])
    .filter(t => t.source !== 'Sale')
    .reduce((s, t) => s + Math.abs(Number(t.amount)), 0)
  const rows = [
    ['REVENUE', ''],
    ['  Rent', money(p.rentRevenue)],
    ['  Other Income', money(p.otherRevenue)],
    ['Total Revenue', money(p.totalRevenue)],
    ['', ''],
    ['EXPENSES', ''],
    ...p.expenses.map(e => ['  ' + e.label, money(e.amount)]),
    ['Total Expenses', money(p.totalExpenses)],
    ['', ''],
    ['Net Operating Income', money(p.noi)],
    ['  Less: Mortgage Principal (operating)', money(-opPrincipal)],
    ['Operating Cash Flow', money(p.noi - opPrincipal)],
  ]
  // On a sold property, surface the gain on sale + true net income — the engine
  // already computes these; the old export dropped them, hiding the deal's
  // single biggest number. (The loan payoff lands here via book value, not as
  // an operating expense.)
  if (p.hasSale) {
    rows.push(
      ['', ''],
      ['GAIN ON SALE', ''],
      ['  Sale Proceeds', money(p.saleProceeds)],
      ['  Less: Selling Costs', money(-p.sellingCosts)],
      ['  Less: Book Value of Property Sold', money(-p.bookValueSold)],
      ['Gain / (Loss) on Sale', money(p.gainOnSale)],
      ['', ''],
      ['Net Income (incl. gain on sale)', money(p.noi + p.gainOnSale)],
    )
  }
  return rows
}

export function cashFlowRows(recorded) {
  const c = computeCashFlow(recorded)
  return [
    ['Operating Activities', money(c.operating)],
    ['Investing Activities', money(c.investing)],
    ['Financing Activities', money(c.financing)],
    ['Net Change in Cash', money(c.netChange)],
  ]
}

export function scheduleERows(recorded, year) {
  const s = computeScheduleE(recorded, year)
  return [
    ['Rents received (line 3)', money(s.rentsReceived)],
    ['', ''],
    ...s.lines.map(l => [`Line ${l.line} — ${l.label}`, money(l.amount)]),
    ['Line 18 — Depreciation', money(s.depreciation)],
    ['Total expenses (line 20)', money(s.totalExpenses)],
    ['Income / (loss) (line 21)', money(s.incomeOrLoss)],
  ]
}

// Per-investor capital accounts (committed, contributed, distributions paid,
// ending balance, still-unfunded). `caps` comes from GET .../capital-accounts —
// the same source the app's Capital Accounts tab uses, so the numbers agree.
export function capitalAccountsRows(caps) {
  const head = ['Investor', 'Committed', 'Contributed Capital', 'Distributions Paid', 'Ending Capital Balance', 'Unfunded']
  const list = Array.isArray(caps) ? caps : []
  const body = list.map(c => [
    c.name || 'Investor', money(c.committed), money(c.contributed),
    money(c.distributions), money(c.capital_balance), money(c.unfunded),
  ])
  const sum = k => list.reduce((t, c) => t + (Number(c[k]) || 0), 0)
  const total = ['TOTAL', money(sum('committed')), money(sum('contributed')),
    money(sum('distributions')), money(sum('capital_balance')), money(sum('unfunded'))]
  return body.length ? [head, ...body, total] : [head, ['No investors on the cap table', '', '', '', '', '']]
}

function buildReports(property, transactions, investors) {
  const recorded = transactions.filter(t => t.review_status === 'recorded')
  const year = new Date().getFullYear()
  return {
    ledger:       { rows: ledgerRows(transactions) },
    balanceSheet: { title: 'Balance Sheet', rows: balanceSheetRows(recorded, investors) },
    pl:           { title: 'Profit & Loss', rows: plRows(recorded) },
    cashFlow:     { title: 'Cash Flow', rows: cashFlowRows(recorded) },
    scheduleE:    { title: `Schedule E (${year})`, rows: scheduleERows(recorded, year) },
    year,
  }
}

const fileBase = (property) => `${(property?.address || 'property').replace(/[^\w-]+/g, '_')}_accounting`

// ── Single report (current tab, respecting its period filter) ─────────────────
// rows = array-of-arrays. isGrid = true for the ledger (header row + many cols).
export function exportReport(format, { property, title, subtitle = '', rows, isGrid = false }) {
  const safe = title.replace(/[^\w]+/g, '_')
  if (format === 'excel') {
    const sheet = [[title], subtitle ? [subtitle] : [], [], ...rows]
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(sheet), title.slice(0, 28))
    XLSX.writeFile(wb, `${fileBase(property)}_${safe}.xlsx`)
    return
  }
  const esc = s => String(s == null ? '' : s).replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]))
  const fmt = v => (typeof v === 'number' ? (v < 0 ? `($${Math.abs(Math.round(v)).toLocaleString()})` : `$${Math.round(v).toLocaleString()}`) : esc(v))
  let table
  if (isGrid) {
    const [head, ...body] = rows
    table = `<table class="grid"><thead><tr>${head.map(h => `<th>${esc(h)}</th>`).join('')}</tr></thead>
      <tbody>${body.map(r => `<tr>${r.map((c, i) => `<td class="${i === 3 ? 'num' : ''}">${i === 3 ? fmt(c) : esc(c)}</td>`).join('')}</tr>`).join('')}</tbody></table>`
  } else {
    table = `<table>${rows.map(([a, b]) => {
      const strong = typeof a === 'string' && (a === a.toUpperCase() || /^(Total|Net|Income)/.test(a.trim()))
      return `<tr class="${strong ? 'strong' : ''}"><td>${esc(a)}</td><td class="num">${b === '' ? '' : fmt(b)}</td></tr>`
    }).join('')}</table>`
  }
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>${esc(propTitle(property))} — ${esc(title)}</title>
    <style>
      body{font:12px -apple-system,Segoe UI,Roboto,Arial,sans-serif;color:#1e293b;padding:24px;}
      h1{font-size:16px;margin:0 0 2px;} .sub{color:#64748b;margin:0 0 16px;font-size:12px;}
      table{width:100%;border-collapse:collapse;} td,th{padding:3px 6px;}
      td.num{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap;}
      tr.strong td{font-weight:700;border-top:1px solid #cbd5e1;}
      table.grid th{background:#f1f5f9;text-align:left;font-size:10px;text-transform:uppercase;color:#64748b;border-bottom:1px solid #cbd5e1;}
      table.grid td{border-bottom:1px solid #f1f5f9;font-size:11px;}
    </style></head><body>
      <h1>${esc(propTitle(property))} — ${esc(title)}</h1>
      <p class="sub">${subtitle ? esc(subtitle) + ' · ' : ''}generated ${new Date().toLocaleDateString()}</p>
      ${table}
      <script>window.onload=function(){setTimeout(function(){window.print()},250)}</script>
    </body></html>`
  const w = window.open('', '_blank')
  if (!w) { alert('Please allow pop-ups to export the PDF.'); return }
  w.document.write(html); w.document.close()
}

// ── Excel ─────────────────────────────────────────────────────────────────────
export function exportAccountingExcel(property, transactions, investors) {
  const r = buildReports(property, transactions, investors)
  const wb = XLSX.utils.book_new()
  const add = (name, rows) => XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), name)
  add('Ledger', r.ledger.rows)
  add('Balance Sheet', r.balanceSheet.rows)
  add('P&L', r.pl.rows)
  add('Cash Flow', r.cashFlow.rows)
  add('Schedule E', r.scheduleE.rows)
  XLSX.writeFile(wb, `${fileBase(property)}.xlsx`)
}

// ── Accountant Bundle ─────────────────────────────────────────────────────────
// A single workbook with everything a CPA needs for a property's return / sale:
// the five core reports plus a depreciation schedule and 1099 vendor summary.
function depreciationRows(transactions, property) {
  const dep = computeDepreciation(transactions, { years: recoveryYears(property?.depreciation_years) })
  if (!dep) return [['Depreciation Schedule'], ['No Building Value on the books — nothing to depreciate.']]
  return [
    ['Depreciation Schedule'],
    ['Basis', dep.basis], ['In service', dep.inService], ['Recovery period (yrs)', dep.years], ['Method', 'Straight line, mid-month'],
    [],
    ['Year', 'Depreciation', 'Accumulated', 'Remaining Basis'],
    ...dep.rows.map(r => [r.year, r.amount, r.accumulated, r.remaining]),
  ]
}
function vendorRows(transactions) {
  const vs = computeVendorSummary(transactions)
  if (!vs.length) return [['Vendor 1099 Summary'], ['No vendor payments recorded.']]
  return [['Vendor 1099 Summary'], [], ['Vendor', 'Total Paid', 'Payments', '1099 likely ($600+)'],
    ...vs.map(v => [v.vendor, v.total, v.count, v.total >= 600 ? 'Yes' : ''])]
}

export function buildBundleWorkbook(property, transactions, investors, caps) {
  const r = buildReports(property, transactions, investors)
  const wb = XLSX.utils.book_new()
  const add = (name, rows) => XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), name.slice(0, 28))
  add('Summary', [
    ['Accountant Package'],
    ['Property', propTitle(property)],
    ['Generated', new Date().toLocaleDateString()],
    ['Tax year', r.year],
    [],
    ['Included: Ledger, Balance Sheet, P&L, Cash Flow, Schedule E, Depreciation, Vendors (1099), Capital Accounts.'],
  ])
  add('Ledger', r.ledger.rows)
  add('Balance Sheet', r.balanceSheet.rows)
  add('P&L', r.pl.rows)
  add('Cash Flow', r.cashFlow.rows)
  add('Schedule E', r.scheduleE.rows)
  add('Depreciation', depreciationRows(transactions, property))
  add('Vendors (1099)', vendorRows(transactions))
  add('Capital Accounts', capitalAccountsRows(caps))
  return wb
}

export const bundleFilename = (property) => `${fileBase(property)}_accountant_bundle.xlsx`
export function downloadBundle(property, transactions, investors, caps) {
  XLSX.writeFile(buildBundleWorkbook(property, transactions, investors, caps), bundleFilename(property))
}
export function bundleBase64(property, transactions, investors, caps) {
  return XLSX.write(buildBundleWorkbook(property, transactions, investors, caps), { type: 'base64', bookType: 'xlsx' })
}

// ── PDF (styled print view — user saves as PDF) ───────────────────────────────
export function exportAccountingPdf(property, transactions, investors) {
  const r = buildReports(property, transactions, investors)
  const esc = s => String(s == null ? '' : s).replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]))
  const fmt = v => (typeof v === 'number' ? (v < 0 ? `($${Math.abs(Math.round(v)).toLocaleString()})` : `$${Math.round(v).toLocaleString()}`) : esc(v))

  const twoCol = (title, rows) => `
    <h2>${esc(title)}</h2>
    <table>${rows.map(([a, b]) => {
      const strong = typeof a === 'string' && (a === a.toUpperCase() || /^(Total|Net|Income)/.test(a.trim()))
      return `<tr class="${strong ? 'strong' : ''}"><td>${esc(a)}</td><td class="num">${b === '' ? '' : fmt(b)}</td></tr>`
    }).join('')}</table>`

  const ledgerTable = () => {
    const [head, ...body] = r.ledger.rows
    return `<h2>Ledger</h2><table class="grid"><thead><tr>${head.map(h => `<th>${esc(h)}</th>`).join('')}</tr></thead>
      <tbody>${body.map(row => `<tr>${row.map((c, i) => `<td class="${i === 3 ? 'num' : ''}">${i === 3 ? fmt(c) : esc(c)}</td>`).join('')}</tr>`).join('')}</tbody></table>`
  }

  const html = `<!doctype html><html><head><meta charset="utf-8"><title>${esc(propTitle(property))} — Accounting</title>
    <style>
      body{font:12px -apple-system,Segoe UI,Roboto,Arial,sans-serif;color:#1e293b;padding:24px;}
      h1{font-size:18px;margin:0 0 2px;} .sub{color:#64748b;margin:0 0 18px;font-size:12px;}
      h2{font-size:14px;margin:22px 0 6px;padding-bottom:4px;border-bottom:2px solid #e2e8f0;page-break-after:avoid;}
      table{width:100%;border-collapse:collapse;margin-bottom:6px;} td,th{padding:3px 6px;}
      td.num{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap;}
      tr.strong td{font-weight:700;border-top:1px solid #cbd5e1;}
      table.grid th{background:#f1f5f9;text-align:left;font-size:10px;text-transform:uppercase;color:#64748b;border-bottom:1px solid #cbd5e1;}
      table.grid td{border-bottom:1px solid #f1f5f9;font-size:11px;}
      .reports{page-break-after:always;}
      @media print{ h2{page-break-inside:avoid;} }
    </style></head><body>
      <h1>${esc(propTitle(property))}</h1>
      <p class="sub">Accounting reports · generated ${new Date().toLocaleDateString()}</p>
      <div class="reports">
        ${twoCol(r.balanceSheet.title, r.balanceSheet.rows)}
        ${twoCol(r.pl.title, r.pl.rows)}
        ${twoCol(r.cashFlow.title, r.cashFlow.rows)}
        ${twoCol(r.scheduleE.title, r.scheduleE.rows)}
      </div>
      ${ledgerTable()}
      <script>window.onload=function(){setTimeout(function(){window.print()},250)}</script>
    </body></html>`

  const w = window.open('', '_blank')
  if (!w) { alert('Please allow pop-ups to export the PDF.'); return }
  w.document.write(html)
  w.document.close()
}
