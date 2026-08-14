// Remove reconciliation plugs — lists every 'Cash Adjustment' / 'Reconciliation'
// entry across the portfolio and clears them in one pass. These were band-aids
// for the old cash-overstatement bug; now that closing cash reduces cash
// correctly they double-correct, so they should go. Review first, then remove.
import { useEffect, useState } from 'react'
import { X, Loader2, AlertTriangle, Trash2, CheckCircle } from 'lucide-react'
import Button from '../ui/Button'
import { getCashAdjustments, clearCashAdjustments } from '../../api/client'

const usd = n => (Number(n) < 0 ? '-$' : '$') + Math.abs(Math.round(Number(n) || 0)).toLocaleString()

export default function RemovePlugsModal({ onClose, onCleared }) {
  const [data, setData]       = useState(null)   // { plugs, count, total }
  const [loading, setLoading] = useState(true)
  const [working, setWorking] = useState(false)
  const [done, setDone]       = useState(null)   // deleted count
  const [error, setError]     = useState(null)

  useEffect(() => {
    getCashAdjustments()
      .then(setData)
      .catch(e => setError(e.message || 'Could not load plugs'))
      .finally(() => setLoading(false))
  }, [])

  const removeAll = async () => {
    if (!window.confirm(`Delete all ${data.count} reconciliation plug${data.count === 1 ? '' : 's'}? This only removes 'Cash Adjustment' reconciliation entries — nothing else is touched.`)) return
    setWorking(true); setError(null)
    try {
      const r = await clearCashAdjustments({ all: true })
      setDone(r.deleted)
      onCleared?.(r.deleted)
    } catch (e) {
      setError(e.message || 'Remove failed')
    } finally {
      setWorking(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg max-h-[85vh] flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100 shrink-0">
          <h3 className="text-base font-semibold text-slate-900">Remove reconciliation plugs</h3>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600"><X className="w-5 h-5" /></button>
        </div>

        {done != null ? (
          <div className="px-5 py-10 flex flex-col items-center gap-3 text-center">
            <CheckCircle className="w-10 h-10 text-emerald-500" />
            <p className="text-lg font-semibold text-slate-900">Removed {done} plug{done === 1 ? '' : 's'}</p>
            <p className="text-sm text-slate-500">Each property's cash now comes straight from its real transactions. Refresh a ledger to see it.</p>
            <Button onClick={onClose} className="mt-2">Done</Button>
          </div>
        ) : loading ? (
          <div className="px-5 py-12 flex items-center justify-center text-slate-400 gap-2">
            <Loader2 className="w-5 h-5 animate-spin" /> Scanning the portfolio…
          </div>
        ) : (
          <div className="px-5 py-4 space-y-4 overflow-y-auto">
            <p className="text-sm text-slate-600">
              These are the <span className="font-medium">reconcile-to-bank plugs</span> across your properties. They were compensating for the old
              cash-overstatement bug — now that closing cash is subtracted correctly, they'd push cash too low. Removing them lets each ledger's
              cash come straight from its real transactions.
            </p>

            {(!data || data.count === 0) ? (
              <div className="flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2.5">
                <CheckCircle className="w-5 h-5 text-emerald-600 shrink-0" />
                <p className="text-sm text-emerald-800">No reconciliation plugs found — nothing to clean up.</p>
              </div>
            ) : (
              <>
                <div className="border border-slate-200 rounded-lg divide-y divide-slate-100 max-h-72 overflow-y-auto">
                  {data.plugs.map(p => (
                    <div key={p.id} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
                      <div className="min-w-0">
                        <p className="font-medium text-slate-800 truncate">{p.property_name}</p>
                        <p className="text-xs text-slate-400">{String(p.date).slice(0, 10)}</p>
                      </div>
                      <span className={`shrink-0 tabular-nums font-medium ${Number(p.amount) < 0 ? 'text-red-600' : 'text-slate-600'}`}>{usd(p.amount)}</span>
                    </div>
                  ))}
                </div>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-slate-500">{data.count} plug{data.count === 1 ? '' : 's'} across the portfolio</span>
                  <span className="font-semibold text-slate-800">net {usd(data.total)}</span>
                </div>
                <div className="flex items-start gap-2 rounded-lg bg-amber-50 border border-amber-200 px-3 py-2 text-xs text-amber-700">
                  <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                  After removing these, glance at each property's Books Health Check — if a cash-vs-bank gap remains, it's a real un-recorded item to fix, not a plug to re-add.
                </div>
              </>
            )}

            {error && <p className="text-sm text-red-600 flex items-center gap-1.5"><AlertTriangle className="w-4 h-4" /> {error}</p>}

            {data && data.count > 0 && (
              <div className="flex justify-end">
                <Button onClick={removeAll} disabled={working} className="bg-red-600 hover:bg-red-700">
                  {working ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
                  Remove all {data.count} plug{data.count === 1 ? '' : 's'}
                </Button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
