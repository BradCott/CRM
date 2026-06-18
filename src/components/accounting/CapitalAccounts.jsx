// Capital Accounts — per-investor committed vs contributed vs distributed.
// Contributed = recorded equity contributions attributed to that investor.
import { useState, useEffect } from 'react'
import { Loader2, Users } from 'lucide-react'
import { getCapitalAccounts } from '../../api/client'

function fmt$(n) {
  if (n === null || n === undefined) return '—'
  const abs = '$' + Math.abs(Math.round(n)).toLocaleString()
  return n < 0 ? `(${abs})` : abs
}

export default function CapitalAccounts({ propertyId }) {
  const [rows, setRows]       = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    setLoading(true)
    getCapitalAccounts(propertyId).then(setRows).catch(() => {}).finally(() => setLoading(false))
  }, [propertyId])

  if (loading) return (
    <div className="flex items-center justify-center py-16"><Loader2 className="w-5 h-5 text-slate-400 animate-spin" /></div>
  )

  const tot = rows.reduce((a, r) => ({
    committed:    a.committed + (r.committed || 0),
    contributed:  a.contributed + (r.contributed || 0),
    distributions:a.distributions + (r.distributions || 0),
    capital_balance: a.capital_balance + (r.capital_balance || 0),
    unfunded:     a.unfunded + (r.unfunded || 0),
  }), { committed: 0, contributed: 0, distributions: 0, capital_balance: 0, unfunded: 0 })

  return (
    <div className="px-6 py-6 max-w-4xl">
      <div className="flex items-center gap-2 mb-1">
        <Users className="w-4 h-4 text-slate-400" />
        <h2 className="text-base font-bold text-slate-900">Capital Accounts</h2>
      </div>
      <p className="text-xs text-slate-400 mb-4">
        Committed = cap-table allocation · Contributed = recorded equity wires attributed to the investor · Balance = contributed − distributions.
      </p>

      {rows.length === 0 ? (
        <div className="rounded-xl border border-slate-200 p-8 text-center text-sm text-slate-400">
          No investors linked to this property yet. Import allocations or attribute an equity contribution to an investor.
        </div>
      ) : (
        <div className="rounded-xl border border-slate-200 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 border-b border-slate-200">
              <tr>
                <th className="text-left px-4 py-2.5 text-xs font-semibold text-slate-500 uppercase tracking-wide">Investor</th>
                <th className="text-right px-4 py-2.5 text-xs font-semibold text-slate-500 uppercase tracking-wide">Committed</th>
                <th className="text-right px-4 py-2.5 text-xs font-semibold text-slate-500 uppercase tracking-wide">Contributed</th>
                <th className="text-right px-4 py-2.5 text-xs font-semibold text-slate-500 uppercase tracking-wide">Unfunded</th>
                <th className="text-right px-4 py-2.5 text-xs font-semibold text-slate-500 uppercase tracking-wide">Distributions</th>
                <th className="text-right px-4 py-2.5 text-xs font-semibold text-slate-500 uppercase tracking-wide">Balance</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(r => (
                <tr key={r.investor_id} className="border-b border-slate-100 last:border-0 hover:bg-slate-50/60">
                  <td className="px-4 py-2.5 font-medium text-slate-800">{r.name}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums text-slate-600">{fmt$(r.committed)}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums text-slate-800 font-medium">{fmt$(r.contributed)}</td>
                  <td className={`px-4 py-2.5 text-right tabular-nums ${r.unfunded > 0 ? 'text-amber-600' : 'text-slate-300'}`}>
                    {r.unfunded > 0 ? fmt$(r.unfunded) : '—'}
                  </td>
                  <td className="px-4 py-2.5 text-right tabular-nums text-slate-600">{r.distributions ? fmt$(r.distributions) : '—'}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums font-semibold text-emerald-700">{fmt$(r.capital_balance)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="bg-slate-50 border-t-2 border-slate-200 font-semibold">
                <td className="px-4 py-2.5 text-slate-900">Total</td>
                <td className="px-4 py-2.5 text-right tabular-nums text-slate-700">{fmt$(tot.committed)}</td>
                <td className="px-4 py-2.5 text-right tabular-nums text-slate-900">{fmt$(tot.contributed)}</td>
                <td className={`px-4 py-2.5 text-right tabular-nums ${tot.unfunded > 0 ? 'text-amber-600' : 'text-slate-400'}`}>{tot.unfunded ? fmt$(tot.unfunded) : '—'}</td>
                <td className="px-4 py-2.5 text-right tabular-nums text-slate-700">{tot.distributions ? fmt$(tot.distributions) : '—'}</td>
                <td className="px-4 py-2.5 text-right tabular-nums text-emerald-700">{fmt$(tot.capital_balance)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </div>
  )
}
