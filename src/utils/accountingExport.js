// Build + download the full accounting package (Ledger, Balance Sheet, P&L,
// Cash Flow, Schedule E) for a property, as an Excel workbook or a print-to-PDF view.
import XLSX from 'xlsx-js-style'
import { computePL, computeCashFlow, computeScheduleE, computeBalanceSheet, computeDepreciation, recoveryYears, computeVendorSummary } from './accounting'

// ── Excel styling (via xlsx-js-style) — bundle only ───────────────────────────
const FMT_USD  = '$#,##0.00;[Red]($#,##0.00)'   // currency; red parentheses for negatives
const FMT_MULT = '0.00"x"'                       // MOIC → 1.38x
const COLORS = { brand: '0F172A', head: '334155', ink: '1E293B', label: '334155', muted: '64748B', line: 'CBD5E1', section: 'EEF2F7', subtext: 'CBD5E1' }
const ST = {
  brand:      { font: { bold: true, sz: 18, color: { rgb: 'FFFFFF' } }, fill: { fgColor: { rgb: COLORS.brand } }, alignment: { vertical: 'center' } },
  brandSub:   { font: { sz: 10, color: { rgb: COLORS.subtext } }, fill: { fgColor: { rgb: COLORS.brand } }, alignment: { vertical: 'center' } },
  band:       { fill: { fgColor: { rgb: COLORS.brand } } },
  sheetTitle: { font: { bold: true, sz: 14, color: { rgb: COLORS.ink } } },
  meta:       { font: { sz: 9, color: { rgb: COLORS.muted } } },
  colHead:    { font: { bold: true, sz: 10, color: { rgb: 'FFFFFF' } }, fill: { fgColor: { rgb: COLORS.head } }, alignment: { horizontal: 'left', vertical: 'center' } },
  colHeadNum: { font: { bold: true, sz: 10, color: { rgb: 'FFFFFF' } }, fill: { fgColor: { rgb: COLORS.head } }, alignment: { horizontal: 'right', vertical: 'center' } },
  section:    { font: { bold: true, sz: 11, color: { rgb: COLORS.ink } }, fill: { fgColor: { rgb: COLORS.section } } },
  label:      { font: { sz: 11, color: { rgb: COLORS.label } } },
  money:      { font: { sz: 11, color: { rgb: COLORS.label } }, alignment: { horizontal: 'right' }, numFmt: FMT_USD },
  totLabel:   { font: { bold: true, sz: 11, color: { rgb: COLORS.ink } }, border: { top: { style: 'thin', color: { rgb: COLORS.line } } } },
  totMoney:   { font: { bold: true, sz: 11, color: { rgb: COLORS.ink } }, alignment: { horizontal: 'right' }, numFmt: FMT_USD, border: { top: { style: 'thin', color: { rgb: COLORS.line } } } },
  cell:       { font: { sz: 10, color: { rgb: COLORS.label } } },
  cellNum:    { font: { sz: 10, color: { rgb: COLORS.label } }, alignment: { horizontal: 'right' }, numFmt: FMT_USD },
  cellInt:    { font: { sz: 10, color: { rgb: COLORS.label } }, alignment: { horizontal: 'right' }, numFmt: '#,##0' },
  cellMult:   { font: { sz: 10, color: { rgb: COLORS.label } }, alignment: { horizontal: 'right' }, numFmt: FMT_MULT },
  totCell:    { font: { bold: true, sz: 10, color: { rgb: COLORS.ink } }, border: { top: { style: 'thin', color: { rgb: COLORS.line } } } },
  totCellNum: { font: { bold: true, sz: 10, color: { rgb: COLORS.ink } }, alignment: { horizontal: 'right' }, numFmt: FMT_USD, border: { top: { style: 'thin', color: { rgb: COLORS.line } } } },
  totCellMult:{ font: { bold: true, sz: 10, color: { rgb: COLORS.ink } }, alignment: { horizontal: 'right' }, numFmt: FMT_MULT, border: { top: { style: 'thin', color: { rgb: COLORS.line } } } },
  subTitle:   { font: { bold: true, sz: 11, color: { rgb: COLORS.ink } } },
}
const A1 = (r, c) => XLSX.utils.encode_cell({ r, c })
const isUpper = s => typeof s === 'string' && s.trim().length > 1 && s === s.toUpperCase() && /[A-Z]/.test(s)
const isTotal = s => typeof s === 'string' && /^(Total|Net |Operating Cash Flow|Gain \/|Income \/|Cash Available)/.test(s.trim())

function setS(ws, r, c, style) { const a = A1(r, c); if (!ws[a]) ws[a] = { t: 's', v: '' }; ws[a].s = style }
function setFmt(ws, r, c, z) { const a = A1(r, c); if (ws[a] && ws[a].t === 'n') ws[a].z = z }

// A branded header band + sheet title. Returns the number of rows it occupies.
function brandHeader(ws, property, sheetTitle, cols, merges) {
  merges.push({ s: { r: 0, c: 0 }, e: { r: 0, c: cols - 1 } })
  merges.push({ s: { r: 1, c: 0 }, e: { r: 1, c: cols - 1 } })
  merges.push({ s: { r: 3, c: 0 }, e: { r: 3, c: cols - 1 } })
  const set = (r, c, v, style) => { ws[A1(r, c)] = { t: 's', v, s: style } }
  set(0, 0, 'KNOX CAPITAL MANAGEMENT', ST.brand)
  set(1, 0, propTitle(property), ST.brandSub)
  set(3, 0, sheetTitle, ST.sheetTitle)
  set(4, 0, `Generated ${new Date().toLocaleDateString()}`, ST.meta)
  for (let c = 1; c < cols; c++) { setS(ws, 0, c, ST.band); setS(ws, 1, c, ST.band) }  // extend band fill across merge
  return 6  // data starts at row 6 (rows 0-1 band, 2 spacer, 3 title, 4 meta, 5 spacer)
}

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

// Per-investor contributions & returns summary. Purely factual — committed,
// contributed, distributions paid, net profit (distributions − contributed) and
// MOIC (distributions ÷ contributed) — with NO assumption about how book income
// is allocated. This avoids the misleading "negative ending balance" a naive
// contributed−distributions capital account shows on a profitable, sold deal.
// `caps` comes from GET .../capital-accounts (the app's own numbers).
export function capitalAccountsRows(caps) {
  const head = ['Investor', 'Committed', 'Contributed', 'Distributions Paid', 'Net Profit', 'MOIC']
  const list = Array.isArray(caps) ? caps : []
  const moic = (dist, contrib) => (contrib > 0 ? Number((dist / contrib).toFixed(2)) : '')
  const body = list.map(c => {
    const contributed = Number(c.contributed) || 0
    const dist = Number(c.distributions) || 0
    return [c.name || 'Investor', money(c.committed), money(contributed), money(dist), money(dist - contributed), moic(dist, contributed)]
  })
  const sum = k => list.reduce((t, c) => t + (Number(c[k]) || 0), 0)
  const totContrib = sum('contributed'), totDist = sum('distributions')
  const total = ['TOTAL', money(sum('committed')), money(totContrib), money(totDist), money(totDist - totContrib), moic(totDist, totContrib)]
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

// Grid/report sheet with the brand header. spec[c] ∈ text | money | int | mult.
function styledSheet(property, title, rows, { spec = [], widths = [], headerIdx = null, titleRows = [], totalRows = [] } = {}) {
  const cols = Math.max(spec.length, ...rows.map(r => r.length), 1)
  const reserve = Array.from({ length: 6 }, () => [''])
  const ws = XLSX.utils.aoa_to_sheet([...reserve, ...rows])
  const merges = []
  const start = brandHeader(ws, property, title, cols, merges)
  const styleFor = (kind, tot) =>
    kind === 'money' ? (tot ? ST.totCellNum : ST.cellNum)
    : kind === 'int'  ? (tot ? ST.totCell : ST.cellInt)
    : kind === 'mult' ? (tot ? ST.totCellMult : ST.cellMult)
    : (tot ? ST.totCell : ST.cell)
  rows.forEach((row, i) => {
    const r = start + i
    if (titleRows.includes(i)) { setS(ws, r, 0, ST.subTitle); return }
    if (i === headerIdx) {
      for (let c = 0; c < cols; c++) setS(ws, r, c, (spec[c] && spec[c] !== 'text') ? ST.colHeadNum : ST.colHead)
      return
    }
    const tot = totalRows.includes(i)
    for (let c = 0; c < cols; c++) setS(ws, r, c, styleFor(spec[c] || 'text', tot))
  })
  ws['!cols'] = (widths.length ? widths : Array.from({ length: cols }, () => 16)).map(w => ({ wch: w }))
  ws['!merges'] = merges
  ws['!rows'] = [{ hpt: 24 }, { hpt: 15 }]
  return ws
}

// Two-column label/value report (Balance Sheet, P&L, Cash Flow, Schedule E).
function twoColSheet(property, title, rows) {
  const reserve = Array.from({ length: 6 }, () => [''])
  const ws = XLSX.utils.aoa_to_sheet([...reserve, ...rows])
  const merges = []
  const start = brandHeader(ws, property, title, 2, merges)
  rows.forEach((row, i) => {
    const r = start + i
    const label = row[0], section = isUpper(label), total = isTotal(label)
    setS(ws, r, 0, section ? ST.section : total ? ST.totLabel : ST.label)
    setS(ws, r, 1, section ? ST.section : total ? ST.totMoney : ST.money)
  })
  ws['!cols'] = [{ wch: 44 }, { wch: 18 }]
  ws['!merges'] = merges
  ws['!rows'] = [{ hpt: 24 }, { hpt: 15 }]
  return ws
}

// Cover sheet.
function coverSheet(property, year) {
  const ws = XLSX.utils.aoa_to_sheet(Array.from({ length: 6 }, () => ['']))
  const merges = []
  brandHeader(ws, property, 'Accountant Package', 2, merges)
  const set = (r, c, v, s) => { ws[A1(r, c)] = { t: 's', v, s } }
  set(6, 0, 'Generated', ST.label); set(6, 1, new Date().toLocaleDateString(), ST.label)
  set(7, 0, 'Tax year', ST.label);  set(7, 1, String(year), ST.label)
  set(9, 0, 'Included in this workbook', ST.subTitle)
  const tabs = ['General Ledger', 'Balance Sheet', 'Profit & Loss', 'Cash Flow', 'Schedule E', 'Depreciation Schedule', '1099 Vendor Summary', 'Investor Summary']
  tabs.forEach((t, i) => set(10 + i, 0, '•  ' + t, ST.label))
  ws['!ref'] = XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: 10 + tabs.length, c: 1 } })
  ws['!cols'] = [{ wch: 44 }, { wch: 20 }]
  ws['!merges'] = merges
  ws['!rows'] = [{ hpt: 24 }, { hpt: 15 }]
  return ws
}

// Depreciation: mini-title + key/value meta + a year-by-year grid.
function depreciationSheet(property, rows) {
  const reserve = Array.from({ length: 6 }, () => [''])
  const ws = XLSX.utils.aoa_to_sheet([...reserve, ...rows])
  const merges = []
  const start = brandHeader(ws, property, 'Depreciation Schedule', 4, merges)
  rows.forEach((row, i) => {
    const r = start + i
    if (i === 0) { setS(ws, r, 0, ST.subTitle); return }
    if (row[0] === 'Year' && row.length >= 4) { for (let c = 0; c < 4; c++) setS(ws, r, c, c === 0 ? ST.colHead : ST.colHeadNum); return }
    if (typeof row[0] === 'number' && row.length >= 4) { setS(ws, r, 0, ST.cellInt); setS(ws, r, 1, ST.cellNum); setS(ws, r, 2, ST.cellNum); setS(ws, r, 3, ST.cellNum); return }
    // meta key/value rows (Basis is money, others text)
    setS(ws, r, 0, ST.label); setS(ws, r, 1, row[0] === 'Basis' ? ST.cellNum : ST.cell)
  })
  ws['!cols'] = [{ wch: 10 }, { wch: 16 }, { wch: 16 }, { wch: 16 }]
  ws['!merges'] = merges
  ws['!rows'] = [{ hpt: 24 }, { hpt: 15 }]
  return ws
}

export function buildBundleWorkbook(property, transactions, investors, caps) {
  const r = buildReports(property, transactions, investors)
  const capRows = capitalAccountsRows(caps)
  const wb = XLSX.utils.book_new()
  const add = (name, ws) => XLSX.utils.book_append_sheet(wb, ws, name.slice(0, 28))
  add('Summary', coverSheet(property, r.year))
  add('Ledger', styledSheet(property, 'General Ledger', r.ledger.rows, {
    headerIdx: 0, spec: ['text', 'text', 'text', 'money', 'text', 'text', 'text', 'text', 'text'],
    widths: [12, 42, 20, 15, 18, 12, 11, 20, 24],
  }))
  add('Balance Sheet', twoColSheet(property, 'Balance Sheet', r.balanceSheet.rows))
  add('P&L', twoColSheet(property, 'Profit & Loss', r.pl.rows))
  add('Cash Flow', twoColSheet(property, 'Cash Flow', r.cashFlow.rows))
  add('Schedule E', twoColSheet(property, `Schedule E (${r.year})`, r.scheduleE.rows))
  add('Depreciation', depreciationSheet(property, depreciationRows(transactions, property)))
  add('Vendors (1099)', styledSheet(property, '1099 Vendor Summary', vendorRows(transactions), {
    titleRows: [0], headerIdx: 2, spec: ['text', 'money', 'int', 'text'], widths: [30, 16, 12, 18],
  }))
  add('Investor Summary', styledSheet(property, 'Investor Summary', capRows, {
    headerIdx: 0, spec: ['text', 'money', 'money', 'money', 'money', 'mult'], widths: [34, 15, 15, 17, 15, 9],
    totalRows: capRows.length > 2 ? [capRows.length - 1] : [],
  }))
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
