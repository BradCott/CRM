// Schedule E (Form 1040) worksheet — per property, per tax year, with depreciation
import { useState } from 'react'
import { ChevronDown, ChevronRight, Printer } from 'lucide-react'
import DrilldownModal from './DrilldownModal'
import { computeScheduleE, DEPRECIATION_YEARS } from '../../utils/accounting'
import { scheduleERows } from '../../utils/accountingExport'
import ReportExportButton from './ReportExportButton'

function fmt$(n) {
  if (n === null || n === undefined) return '—'
  const abs = '$' + Math.abs(Math.round(n)).toLocaleString()
  if (n < 0) return `(${abs})`
  return abs
}

function LineRow({ line, label, amount, txs, onChanged, note, bold }) {
  const [open, setOpen] = useState(false)
  const hasData = txs?.length > 0
  return (
    <>
      <div className={`flex items-start justify-between py-1.5 ${bold ? '' : ''}`}>
        <div className="flex items-baseline gap-2">
          {line != null && <span className="text-xs text-slate-300 tabular-nums w-6 shrink-0">{line}</span>}
          <div>
            <span className={`text-sm ${bold ? 'font-semibold text-slate-900' : 'text-slate-600'}`}>{label}</span>
            {note && <p className="text-xs text-slate-400 italic mt-0.5 max-w-sm">{note}</p>}
          </div>
        </div>
        <button
          onClick={() => hasData && setOpen(true)}
          className={`text-sm tabular-nums shrink-0 ml-4 ${bold ? 'font-semibold text-slate-900' : 'text-slate-700'} ${hasData ? 'underline decoration-dotted underline-offset-2 hover:opacity-70' : 'cursor-default'} transition-opacity`}
        >
          {fmt$(amount)}
        </button>
      </div>
      {open && (
        <DrilldownModal title={`Line ${line ?? ''} — ${label}`} transactions={txs} onClose={() => setOpen(false)} onChanged={onChanged} />
      )}
    </>
  )
}

function exportPrint(property, se) {
  const win = window.open('', '_blank', 'width=800,height=700')
  const rows = se.lines.filter(l => l.amount > 0).map(l =>
    `<tr><td class="ln">${l.line}</td><td>${l.label}</td><td class="r">${fmt$(l.amount)}</td></tr>`
  ).join('')
  win.document.write(`<!DOCTYPE html><html><head><title>Schedule E ${se.year}</title><style>
    body { font-family: Arial, sans-serif; font-size: 12px; color: #1e293b; padding: 32px; }
    h1 { font-size: 16px; margin: 0 0 2px; } h2 { font-size: 12px; color: #64748b; font-weight: normal; margin: 0 0 20px; }
    table { width: 100%; border-collapse: collapse; max-width: 560px; }
    td { padding: 5px 8px; border-bottom: 1px solid #e2e8f0; }
    td.ln { color: #94a3b8; width: 28px; } td.r { text-align: right; font-variant-numeric: tabular-nums; }
    tr.total td { font-weight: bold; border-top: 2px solid #94a3b8; }
    .income { font-weight: bold; font-size: 14px; }
  </style></head><body>
    <h1>Schedule E Worksheet — ${se.year}</h1>
    <h2>${property?.address || ''}${property?.city ? `, ${property.city}, ${property.state || ''}` : ''}</h2>
    <table>
      <tr><td class="ln">3</td><td>Rents received</td><td class="r">${fmt$(se.rentsReceived)}</td></tr>
      ${rows}
      ${se.depreciation > 0 ? `<tr><td class="ln">18</td><td>Depreciation expense</td><td class="r">${fmt$(se.depreciation)}</td></tr>` : ''}
      <tr class="total"><td class="ln">20</td><td>Total expenses</td><td class="r">${fmt$(se.totalExpenses)}</td></tr>
      <tr class="total income"><td class="ln">21</td><td>Income or (loss)</td><td class="r">${fmt$(se.incomeOrLoss)}</td></tr>
    </table>
    <p style="margin-top:24px;font-size:10px;color:#94a3b8">Prepared from CRM ledger data — review with your CPA before filing. Mortgage line includes principal; use Form 1098 for the interest split.</p>
  </body></html>`)
  win.document.close()
  setTimeout(() => { win.focus(); win.print() }, 400)
}

export default function ScheduleE({ property, transactions, onChanged }) {
  const currentYear = new Date().getFullYear()
  const [year, setYear] = useState(currentYear)
  const [showDep, setShowDep] = useState(false)

  const se = computeScheduleE(transactions, year)

  // Years with any transactions, for the picker
  const years = [...new Set(transactions.map(t => Number(t.date.slice(0, 4))))].sort((a, b) => b - a)
  if (!years.includes(currentYear)) years.unshift(currentYear)

  return (
    <div className="max-w-2xl mx-auto px-6 py-6">
      <div className="flex items-start justify-between mb-4">
        <div>
          <h2 className="text-base font-bold text-slate-900">Schedule E Worksheet</h2>
          <p className="text-xs text-slate-400">Tax year {year} — supplemental income from rental real estate</p>
        </div>
        <div className="flex items-center gap-2">
          <select
            value={year}
            onChange={e => setYear(Number(e.target.value))}
            className="text-sm border border-slate-200 rounded-lg px-3 py-1.5 bg-white focus:outline-none focus:ring-2 focus:ring-blue-400"
          >
            {years.map(y => <option key={y} value={y}>{y}</option>)}
          </select>
          <ReportExportButton property={property} title="Schedule E" subtitle={`Tax year ${year}`} buildRows={() => scheduleERows(transactions, year)} />
          <button
            onClick={() => exportPrint(property, se)}
            className="flex items-center gap-1.5 text-xs font-medium text-blue-600 hover:text-blue-800 px-3 py-1.5 rounded-lg border border-blue-200 hover:bg-blue-50 transition-colors"
          >
            <Printer className="w-3.5 h-3.5" /> Print
          </button>
        </div>
      </div>

      {/* Income */}
      <p className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-1">Income</p>
      <LineRow line={3} label="Rents received" amount={se.rentsReceived}
        txs={transactions.filter(t => t.date.startsWith(String(year)) && t.category === 'Rent' && Number(t.amount) > 0)}
        onChanged={onChanged} bold />

      {/* Expenses */}
      <p className="text-xs font-bold text-slate-400 uppercase tracking-wider mt-5 mb-1">Expenses</p>
      {se.lines.filter(l => l.amount > 0).map(l => (
        <LineRow key={l.line} line={l.line} label={l.label} amount={l.amount} txs={l.txs}
          onChanged={onChanged} note={l.note} />
      ))}
      {se.depreciation > 0 && (
        <LineRow line={18} label="Depreciation expense" amount={se.depreciation} txs={[]}
          note={`27.5-year straight line on building basis of ${fmt$(se.dep?.basis)}`} />
      )}
      {se.lines.every(l => l.amount === 0) && se.depreciation === 0 && (
        <p className="text-sm text-slate-400 py-2">No deductible expenses recorded for {year}</p>
      )}

      <div className="border-t-2 border-slate-300 mt-3 pt-1">
        <LineRow line={20} label="Total expenses" amount={se.totalExpenses} txs={[]} bold />
      </div>

      <div className="mt-4 bg-slate-50 rounded-xl p-4 border border-slate-200">
        <div className="flex items-center justify-between">
          <div>
            <span className="text-sm font-bold text-slate-900">Line 21 — Income or (Loss)</span>
            <p className="text-xs text-slate-400 mt-0.5">Rents received minus total expenses</p>
          </div>
          <span className={`text-lg font-bold tabular-nums ${se.incomeOrLoss >= 0 ? 'text-emerald-700' : 'text-red-600'}`}>
            {fmt$(se.incomeOrLoss)}
          </span>
        </div>
      </div>

      {/* Depreciation schedule */}
      {se.dep ? (
        <div className="mt-6 bg-white border border-slate-200 rounded-xl overflow-hidden">
          <button
            onClick={() => setShowDep(s => !s)}
            className="w-full flex items-center justify-between px-5 py-3.5 hover:bg-slate-50 transition-colors text-left"
          >
            <div>
              <span className="text-sm font-semibold text-slate-900">Depreciation Schedule</span>
              <p className="text-xs text-slate-400 mt-0.5">
                Basis {fmt$(se.dep.basis)} · In service {se.dep.inService} · {DEPRECIATION_YEARS}-year straight line, mid-month convention
              </p>
            </div>
            {showDep ? <ChevronDown className="w-4 h-4 text-slate-400" /> : <ChevronRight className="w-4 h-4 text-slate-400" />}
          </button>
          {showDep && (
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr className="bg-slate-50 border-y border-slate-200">
                  <th className="px-5 py-2 text-xs font-semibold text-slate-500 uppercase tracking-wide text-left">Year</th>
                  <th className="px-3 py-2 text-xs font-semibold text-slate-500 uppercase tracking-wide text-right">Depreciation</th>
                  <th className="px-3 py-2 text-xs font-semibold text-slate-500 uppercase tracking-wide text-right">Accumulated</th>
                  <th className="px-5 py-2 text-xs font-semibold text-slate-500 uppercase tracking-wide text-right">Remaining Basis</th>
                </tr>
              </thead>
              <tbody>
                {se.dep.rows.map(r => (
                  <tr key={r.year} className={`border-b border-slate-100 ${r.year === year ? 'bg-blue-50/60' : ''} ${r.year > new Date().getFullYear() ? 'text-slate-400' : ''}`}>
                    <td className="px-5 py-2 text-xs tabular-nums">{r.year}{r.year === year ? ' ←' : ''}</td>
                    <td className="px-3 py-2 text-xs tabular-nums text-right">{fmt$(r.amount)}</td>
                    <td className="px-3 py-2 text-xs tabular-nums text-right">{fmt$(r.accumulated)}</td>
                    <td className="px-5 py-2 text-xs tabular-nums text-right">{fmt$(r.remaining)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      ) : (
        <p className="mt-6 text-xs text-slate-400 italic">
          No depreciation schedule — upload a settlement statement with a Building Value entry to enable it.
        </p>
      )}

      <p className="mt-4 text-xs text-slate-400 italic">
        Worksheet only — review with your CPA before filing. Acquisition costs from settlement statements are
        excluded (they are capitalized into basis, not deducted).
      </p>
    </div>
  )
}
