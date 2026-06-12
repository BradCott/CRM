// Vendor spend summary — for 1099 preparation
import { useState } from 'react'
import DrilldownModal from './DrilldownModal'
import { computeVendorSummary } from '../../utils/accounting'

function fmt$(n) {
  return '$' + Math.abs(Math.round(Number(n))).toLocaleString()
}

export default function Vendors({ transactions, onChanged }) {
  const currentYear = new Date().getFullYear()
  const [year, setYear] = useState(currentYear)
  const [open, setOpen] = useState(null)   // vendor object

  const years = [...new Set(transactions.map(t => Number(t.date.slice(0, 4))))].sort((a, b) => b - a)
  if (!years.includes(currentYear)) years.unshift(currentYear)

  const vendors = computeVendorSummary(transactions, year)
  const total = vendors.reduce((s, v) => s + v.total, 0)

  return (
    <div className="max-w-2xl mx-auto px-6 py-6">
      <div className="flex items-start justify-between mb-4">
        <div>
          <h2 className="text-base font-bold text-slate-900">Vendor Payments</h2>
          <p className="text-xs text-slate-400">
            {year} payments by vendor — for 1099 prep. Vendors paid $600+ may need a 1099-NEC.
          </p>
        </div>
        <select
          value={year}
          onChange={e => setYear(Number(e.target.value))}
          className="text-sm border border-slate-200 rounded-lg px-3 py-1.5 bg-white focus:outline-none focus:ring-2 focus:ring-blue-400"
        >
          {years.map(y => <option key={y} value={y}>{y}</option>)}
        </select>
      </div>

      {vendors.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-slate-400 gap-2">
          <p className="text-sm font-medium">No vendor payments in {year}</p>
          <p className="text-xs">Add a vendor/payee name when recording transactions to track spend here</p>
        </div>
      ) : (
        <>
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr className="bg-slate-50 border-y border-slate-200">
                <th className="px-4 py-2.5 text-xs font-semibold text-slate-500 uppercase tracking-wide text-left">Vendor</th>
                <th className="px-3 py-2.5 text-xs font-semibold text-slate-500 uppercase tracking-wide text-right">Payments</th>
                <th className="px-3 py-2.5 text-xs font-semibold text-slate-500 uppercase tracking-wide text-right">Total Paid</th>
                <th className="px-4 py-2.5 text-xs font-semibold text-slate-500 uppercase tracking-wide text-right">1099?</th>
              </tr>
            </thead>
            <tbody>
              {vendors.map(v => (
                <tr key={v.vendor} className="border-b border-slate-100 hover:bg-slate-50 cursor-pointer" onClick={() => setOpen(v)}>
                  <td className="px-4 py-2.5 font-medium text-slate-900">{v.vendor}</td>
                  <td className="px-3 py-2.5 text-right text-slate-500 tabular-nums">{v.count}</td>
                  <td className="px-3 py-2.5 text-right font-semibold tabular-nums text-slate-900 underline decoration-dotted underline-offset-2">
                    {fmt$(v.total)}
                  </td>
                  <td className="px-4 py-2.5 text-right">
                    {v.total >= 600
                      ? <span className="text-xs font-semibold text-amber-700 bg-amber-50 px-2 py-0.5 rounded-full">Likely</span>
                      : <span className="text-xs text-slate-300">—</span>
                    }
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t-2 border-slate-300 bg-slate-50">
                <td className="px-4 py-2.5 text-xs font-bold text-slate-500 uppercase tracking-wide">Total</td>
                <td className="px-3 py-2.5 text-right tabular-nums text-slate-500">{vendors.reduce((s, v) => s + v.count, 0)}</td>
                <td className="px-3 py-2.5 text-right font-bold tabular-nums text-slate-900">{fmt$(total)}</td>
                <td />
              </tr>
            </tfoot>
          </table>
          <p className="mt-3 text-xs text-slate-400 italic">
            "Likely" flags vendors paid $600 or more — corporations and merchandise purchases are generally exempt; confirm with your CPA.
          </p>
        </>
      )}

      {open && (
        <DrilldownModal
          title={`${open.vendor} — ${year}`}
          transactions={open.txs}
          onClose={() => setOpen(null)}
          onChanged={onChanged}
        />
      )}
    </div>
  )
}
