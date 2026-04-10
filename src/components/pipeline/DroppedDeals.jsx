import { useState, useEffect } from 'react'
import { RotateCcw, Loader2 } from 'lucide-react'
import { getDroppedDeals } from '../../api/client'
import { useApp } from '../../context/AppContext'

function fmtPrice(v) {
  if (v == null || v === '') return '—'
  return '$' + Math.round(Number(v)).toLocaleString()
}

function fmtDate(iso) {
  if (!iso) return '—'
  return new Date(iso + 'T00:00:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
}

export default function DroppedDeals() {
  const { restoreDeal } = useApp()
  const [deals, setDeals] = useState([])
  const [loading, setLoading] = useState(true)
  const [restoring, setRestoring] = useState(null)

  useEffect(() => {
    getDroppedDeals()
      .then(setDeals)
      .catch(e => console.error('Failed to load dropped deals:', e))
      .finally(() => setLoading(false))
  }, [])

  async function handleRestore(id) {
    setRestoring(id)
    try {
      await restoreDeal(id)
      setDeals(prev => prev.filter(d => d.id !== id))
    } finally {
      setRestoring(null)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="w-5 h-5 text-slate-400 animate-spin" />
      </div>
    )
  }

  if (deals.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-slate-400 gap-2">
        <p className="text-sm font-medium">No dropped deals</p>
        <p className="text-xs">Deals you drop from the pipeline will appear here</p>
      </div>
    )
  }

  return (
    <div className="pb-24 overflow-x-auto">
      <table className="w-full text-sm border-collapse">
        <thead>
          <tr className="bg-slate-50 border-y border-slate-200">
            {['Tenant', 'Address', 'City', 'State', 'Cap Rate', 'Price', 'Stage', 'Close Date'].map(h => (
              <th key={h} className="text-left text-xs font-semibold text-slate-500 uppercase tracking-wide px-4 py-3 whitespace-nowrap first:pl-6">
                {h}
              </th>
            ))}
            <th className="px-4 py-3 pr-6 w-24" />
          </tr>
        </thead>
        <tbody>
          {deals.map((deal, i) => (
            <tr key={deal.id} className={i % 2 === 0 ? 'bg-white' : 'bg-slate-50/60'}>
              <td className="px-4 pl-6 py-3 border-b border-slate-100 font-semibold text-slate-800 max-w-[180px] truncate">
                {deal.tenant || <span className="text-slate-300">—</span>}
              </td>
              <td className="px-4 py-3 border-b border-slate-100 text-slate-600 max-w-[200px] truncate">
                {deal.address || <span className="text-slate-300">—</span>}
              </td>
              <td className="px-4 py-3 border-b border-slate-100 text-slate-600">
                {deal.city || <span className="text-slate-300">—</span>}
              </td>
              <td className="px-4 py-3 border-b border-slate-100 text-slate-600">
                {deal.state || <span className="text-slate-300">—</span>}
              </td>
              <td className="px-4 py-3 border-b border-slate-100 text-slate-600">
                {deal.cap_rate != null ? `${Number(deal.cap_rate).toFixed(2)}%` : <span className="text-slate-300">—</span>}
              </td>
              <td className="px-4 py-3 border-b border-slate-100 font-medium text-slate-700">
                {fmtPrice(deal.purchase_price)}
              </td>
              <td className="px-4 py-3 border-b border-slate-100 text-slate-500 text-xs italic">
                {deal.stage || '—'}
              </td>
              <td className="px-4 py-3 border-b border-slate-100 text-slate-600">
                {fmtDate(deal.close_date)}
              </td>
              <td className="px-4 py-3 pr-6 border-b border-slate-100">
                <button
                  onClick={() => handleRestore(deal.id)}
                  disabled={restoring === deal.id}
                  className="flex items-center gap-1 text-xs text-slate-400 hover:text-blue-600 px-2 py-0.5 rounded hover:bg-blue-50 transition-colors disabled:opacity-50"
                >
                  {restoring === deal.id
                    ? <Loader2 className="w-3 h-3 animate-spin" />
                    : <RotateCcw className="w-3 h-3" />
                  }
                  Restore
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
