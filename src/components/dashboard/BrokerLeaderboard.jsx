// Top Brokers — commissions paid leaderboard with period selector + backfill flow
import { useState, useEffect, useCallback } from 'react'
import { Award, Loader2, X, HelpCircle } from 'lucide-react'
import { getBrokerLeaderboard, assignDealBroker, getAllPeople, createPerson } from '../../api/client'

function fmt$(n) {
  if (!n && n !== 0) return '—'
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000)     return `$${Math.round(n / 1_000)}K`
  return `$${Math.round(n)}`
}

const PERIODS = [
  { label: '6m', months: 6 },
  { label: '1y', months: 12 },
  { label: '2y', months: 24 },
  { label: '4y', months: 48 },
  { label: 'All', months: null },
]

const BAR_COLORS = ['bg-blue-500', 'bg-blue-400', 'bg-blue-300', 'bg-blue-200', 'bg-blue-100']

function AssignModal({ deals, onSaved, onClose }) {
  const [people, setPeople]       = useState([])
  const [dealId, setDealId]       = useState(deals[0]?.id || '')
  const [brokerId, setBrokerId]   = useState('')
  const [newBroker, setNewBroker] = useState('')
  const [commission, setCommission] = useState('')
  const [saving, setSaving]       = useState(false)
  const [error, setError]         = useState(null)

  useEffect(() => {
    getAllPeople().then(all => {
      setPeople(all.filter(p => p.role === 'broker'))
    }).catch(console.error)
  }, [])

  async function handleSubmit(e) {
    e.preventDefault()
    if (!dealId || (!brokerId && !newBroker.trim())) {
      setError('Pick a deal and a broker.')
      return
    }
    setSaving(true)
    setError(null)
    try {
      let bid = brokerId
      if (!bid) {
        const created = await createPerson({ name: newBroker.trim(), role: 'broker' })
        bid = created.id
      }
      await assignDealBroker(dealId, {
        broker_id: bid,
        broker_commission: commission ? parseFloat(commission) : null,
      })
      onSaved()
      onClose()
    } catch (err) {
      setError(err.message)
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
          <h2 className="text-base font-semibold text-slate-900">Assign Broker</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600"><X className="w-5 h-5" /></button>
        </div>
        <form onSubmit={handleSubmit} className="px-6 py-5 space-y-4">
          {error && <div className="px-3 py-2 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">{error}</div>}

          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Closed deal</label>
            <select value={dealId} onChange={e => setDealId(e.target.value)}
              className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-400">
              {deals.map(d => (
                <option key={d.id} value={d.id}>
                  {d.label}{d.price ? ` — ${fmt$(d.price)}` : ''}{d.close_date ? ` (${d.close_date})` : ''}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Broker</label>
            <select value={brokerId} onChange={e => { setBrokerId(e.target.value); if (e.target.value) setNewBroker('') }}
              className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-400">
              <option value="">— Add new broker —</option>
              {people.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
            {!brokerId && (
              <input
                value={newBroker}
                onChange={e => setNewBroker(e.target.value)}
                placeholder="New broker name"
                className="mt-2 w-full text-sm border border-slate-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-400"
              />
            )}
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Commission paid (optional)</label>
            <input
              type="number" min="0" step="0.01" value={commission}
              onChange={e => setCommission(e.target.value)}
              placeholder="e.g. 65000"
              className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-400"
            />
            <p className="mt-1 text-xs text-slate-400">From the settlement statement — leave blank if unknown</p>
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={onClose} className="text-sm text-slate-500 px-4 py-2 hover:text-slate-700">Cancel</button>
            <button type="submit" disabled={saving}
              className="text-sm font-medium text-white bg-blue-600 px-4 py-2 rounded-lg hover:bg-blue-700 disabled:opacity-50">
              {saving ? 'Saving…' : 'Assign'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

export default function BrokerLeaderboard() {
  const [months, setMonths]   = useState(12)
  const [data, setData]       = useState({ leaderboard: [], missing: [] })
  const [loading, setLoading] = useState(true)
  const [showAssign, setShowAssign] = useState(false)

  const load = useCallback(() => {
    setLoading(true)
    getBrokerLeaderboard(months).then(setData).catch(console.error).finally(() => setLoading(false))
  }, [months])

  useEffect(() => { load() }, [load])

  const max = data.leaderboard[0]?.total_paid || 1

  return (
    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
      <div className="flex items-center justify-between px-5 py-3.5 border-b border-slate-100">
        <div className="flex items-center gap-2">
          <Award className="w-4 h-4 text-amber-500" />
          <h2 className="text-sm font-bold text-slate-800">Top Brokers</h2>
        </div>
        <div className="flex gap-1">
          {PERIODS.map(p => (
            <button
              key={p.label}
              onClick={() => setMonths(p.months)}
              className={`text-xs px-2.5 py-1 rounded-lg transition-colors ${
                months === p.months
                  ? 'bg-slate-800 text-white'
                  : 'text-slate-500 border border-slate-200 hover:border-slate-300'
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-10">
          <Loader2 className="w-5 h-5 text-slate-400 animate-spin" />
        </div>
      ) : data.leaderboard.length === 0 ? (
        <div className="px-5 py-8 text-center">
          <p className="text-sm text-slate-400">No broker data yet for this period</p>
          {data.missing.length > 0 && (
            <button onClick={() => setShowAssign(true)}
              className="mt-2 text-xs font-medium text-blue-600 hover:text-blue-800 underline">
              Assign brokers to {data.missing.length} closed deal{data.missing.length !== 1 ? 's' : ''}
            </button>
          )}
        </div>
      ) : (
        <div className="px-5 py-3">
          {data.leaderboard.map((b, i) => (
            <div key={b.broker_id} className="flex items-center gap-3 py-2">
              <span className={`text-sm font-bold w-5 shrink-0 ${i === 0 ? 'text-amber-600' : 'text-slate-400'}`}>{i + 1}</span>
              <p className="text-sm font-medium text-slate-800 w-32 truncate shrink-0">{b.broker_name}</p>
              <div className="flex-1 h-2 bg-slate-100 rounded-full overflow-hidden">
                <div
                  className={`h-full rounded-full ${BAR_COLORS[Math.min(i, BAR_COLORS.length - 1)]}`}
                  style={{ width: `${Math.max(4, (b.total_paid / max) * 100)}%` }}
                />
              </div>
              <span className="text-xs font-semibold text-slate-700 tabular-nums w-20 text-right shrink-0">
                {fmt$(b.total_paid)} · {b.deals_closed}
              </span>
            </div>
          ))}
        </div>
      )}

      {data.missing.length > 0 && data.leaderboard.length > 0 && (
        <button
          onClick={() => setShowAssign(true)}
          className="w-full flex items-center gap-2 px-5 py-2.5 border-t border-amber-100 bg-amber-50/60 text-left hover:bg-amber-50 transition-colors"
        >
          <HelpCircle className="w-3.5 h-3.5 text-amber-600 shrink-0" />
          <span className="text-xs text-amber-800">
            {data.missing.length} closed deal{data.missing.length !== 1 ? 's' : ''} missing broker info — tap to assign
          </span>
        </button>
      )}

      {showAssign && data.missing.length > 0 && (
        <AssignModal deals={data.missing} onSaved={load} onClose={() => setShowAssign(false)} />
      )}
    </div>
  )
}
