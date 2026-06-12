// Investor Distributions — record and track payouts per property
import { useState, useEffect, useCallback } from 'react'
import { Plus, Loader2, Trash2, X, HandCoins, AlertCircle } from 'lucide-react'
import Button from '../ui/Button'
import { Input, Select, Textarea } from '../ui/Input'
import { getPropertyDistributions, createDistribution, deleteDistribution } from '../../api/client'

const TYPES = ['Preferred Return', 'Principal', 'Profit']

const TYPE_STYLES = {
  'Preferred Return': 'bg-blue-100 text-blue-700',
  'Principal':        'bg-violet-100 text-violet-700',
  'Profit':           'bg-emerald-100 text-emerald-700',
}

function fmt$(n) {
  return '$' + Math.abs(Math.round(Number(n))).toLocaleString()
}
function fmtDate(iso) {
  if (!iso) return '—'
  return new Date(iso.slice(0, 10) + 'T00:00:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
}

function RecordModal({ propertyId, investors, onSaved, onClose }) {
  const [form, setForm] = useState({
    investor_id: investors[0]?.id || '',
    amount: '',
    distribution_date: new Date().toISOString().slice(0, 10),
    distribution_type: 'Preferred Return',
    notes: '',
  })
  const [saving, setSaving] = useState(false)
  const [error, setError]   = useState(null)
  const set = f => e => setForm(p => ({ ...p, [f]: e.target.value }))

  async function handleSubmit(e) {
    e.preventDefault()
    if (!form.investor_id || !form.amount) {
      setError('Investor and amount are required.')
      return
    }
    setSaving(true)
    setError(null)
    try {
      await createDistribution(form.investor_id, {
        property_id:       Number(propertyId),
        amount:            parseFloat(form.amount),
        distribution_date: form.distribution_date,
        distribution_type: form.distribution_type,
        notes:             form.notes.trim() || null,
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
          <h2 className="text-base font-semibold text-slate-900">Record Distribution</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600"><X className="w-5 h-5" /></button>
        </div>
        <form onSubmit={handleSubmit} className="px-6 py-5 space-y-4">
          {error && <div className="px-3 py-2 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">{error}</div>}
          <Select label="Investor" value={form.investor_id} onChange={set('investor_id')}>
            {investors.map(i => (
              <option key={i.id} value={i.id}>
                {i.name}{i.contribution > 0 ? ` — ${fmt$(i.contribution)} invested` : ''}
              </option>
            ))}
          </Select>
          <div className="grid grid-cols-2 gap-4">
            <Input label="Amount" type="number" min="0" step="0.01" value={form.amount} onChange={set('amount')} placeholder="0.00" autoFocus />
            <Input label="Date" type="date" value={form.distribution_date} onChange={set('distribution_date')} />
          </div>
          <Select label="Type" value={form.distribution_type} onChange={set('distribution_type')}>
            {TYPES.map(t => <option key={t} value={t}>{t}</option>)}
          </Select>
          <Textarea label="Notes (optional)" value={form.notes} onChange={set('notes')} placeholder="Q2 distribution…" />
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="secondary" onClick={onClose}>Cancel</Button>
            <Button type="submit" disabled={saving}>{saving ? 'Saving…' : 'Record Distribution'}</Button>
          </div>
        </form>
      </div>
    </div>
  )
}

export default function Distributions({ propertyId }) {
  const [data, setData]         = useState({ distributions: [], investors: [] })
  const [loading, setLoading]   = useState(true)
  const [showAdd, setShowAdd]   = useState(false)
  const [deleting, setDeleting] = useState(null)
  const [error, setError]       = useState(null)

  const load = useCallback(async () => {
    setLoading(true)
    try { setData(await getPropertyDistributions(propertyId)) }
    catch (e) { setError(e.message) }
    finally { setLoading(false) }
  }, [propertyId])

  useEffect(() => { load() }, [load])

  async function handleDelete(id) {
    if (!window.confirm('Delete this distribution record?')) return
    setDeleting(id)
    try {
      await deleteDistribution(id)
      setData(prev => ({ ...prev, distributions: prev.distributions.filter(d => d.id !== id) }))
    } catch (e) {
      setError(e.message)
    } finally {
      setDeleting(null)
    }
  }

  const { distributions, investors } = data
  const total = distributions.reduce((s, d) => s + Number(d.amount), 0)
  const byType = TYPES.map(t => ({
    type: t,
    total: distributions.filter(d => d.distribution_type === t).reduce((s, d) => s + Number(d.amount), 0),
  })).filter(t => t.total > 0)

  // Per-investor rollup: contribution vs total received
  const byInvestor = investors.map(inv => {
    const received = distributions
      .filter(d => d.investor_id === inv.id)
      .reduce((s, d) => s + Number(d.amount), 0)
    return {
      ...inv, received,
      pctReturned: inv.contribution > 0 ? (received / inv.contribution) * 100 : null,
    }
  })
  // Investors with distributions but no link row (edge case)
  const linkedIds = new Set(investors.map(i => i.id))
  const unlinked = [...new Set(distributions.filter(d => !linkedIds.has(d.investor_id)).map(d => d.investor_id))]
    .map(id => {
      const ds = distributions.filter(d => d.investor_id === id)
      return { id, name: ds[0].investor_name, contribution: 0, received: ds.reduce((s, d) => s + Number(d.amount), 0), pctReturned: null }
    })
  const investorRows = [...byInvestor, ...unlinked]

  if (loading) return (
    <div className="flex items-center justify-center py-16">
      <Loader2 className="w-5 h-5 text-slate-400 animate-spin" />
    </div>
  )

  return (
    <div className="max-w-3xl mx-auto px-6 py-6">
      <div className="flex items-start justify-between mb-4">
        <div>
          <h2 className="text-base font-bold text-slate-900">Investor Distributions</h2>
          <p className="text-xs text-slate-400">
            {fmt$(total)} distributed
            {byType.length > 0 && <> — {byType.map(t => `${fmt$(t.total)} ${t.type.toLowerCase()}`).join(' · ')}</>}
          </p>
        </div>
        <Button onClick={() => setShowAdd(true)} disabled={investors.length === 0}>
          <Plus className="w-4 h-4" /> Record Distribution
        </Button>
      </div>

      {error && (
        <div className="mb-4 flex items-center gap-2 px-4 py-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
          <AlertCircle className="w-4 h-4 shrink-0" />{error}
        </div>
      )}

      {investors.length === 0 && distributions.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-slate-400 gap-2">
          <HandCoins className="w-8 h-8 opacity-30" />
          <p className="text-sm font-medium">No linked investors</p>
          <p className="text-xs">Upload investor contributions on the Ledger tab to link investors to this property</p>
        </div>
      ) : (
        <>
          {/* Per-investor summary */}
          {investorRows.length > 0 && (
            <div className="mb-6 bg-white border border-slate-200 rounded-xl overflow-hidden">
              <table className="w-full text-sm border-collapse">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-200">
                    <th className="px-4 py-2.5 text-xs font-semibold text-slate-500 uppercase tracking-wide text-left">Investor</th>
                    <th className="px-3 py-2.5 text-xs font-semibold text-slate-500 uppercase tracking-wide text-right">Invested</th>
                    <th className="px-3 py-2.5 text-xs font-semibold text-slate-500 uppercase tracking-wide text-right">Pref %</th>
                    <th className="px-3 py-2.5 text-xs font-semibold text-slate-500 uppercase tracking-wide text-right">Received</th>
                    <th className="px-4 py-2.5 text-xs font-semibold text-slate-500 uppercase tracking-wide text-right">Capital Returned</th>
                  </tr>
                </thead>
                <tbody>
                  {investorRows.map(inv => (
                    <tr key={inv.id} className="border-b border-slate-100">
                      <td className="px-4 py-2.5 font-medium text-slate-900">{inv.name}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums text-slate-700">{inv.contribution > 0 ? fmt$(inv.contribution) : '—'}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums text-slate-500 text-xs">
                        {inv.preferred_return_rate != null ? `${inv.preferred_return_rate}%` : '—'}
                      </td>
                      <td className="px-3 py-2.5 text-right tabular-nums font-semibold text-emerald-700">
                        {inv.received > 0 ? fmt$(inv.received) : <span className="text-slate-300 font-normal">—</span>}
                      </td>
                      <td className="px-4 py-2.5 text-right">
                        {inv.pctReturned != null ? (
                          <div className="flex items-center justify-end gap-2">
                            <div className="w-16 h-1.5 bg-slate-100 rounded-full overflow-hidden">
                              <div className="h-full rounded-full bg-emerald-500" style={{ width: `${Math.min(100, inv.pctReturned)}%` }} />
                            </div>
                            <span className="text-xs tabular-nums text-slate-500 w-10">{Math.round(inv.pctReturned)}%</span>
                          </div>
                        ) : <span className="text-xs text-slate-300">—</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="border-t-2 border-slate-300 bg-slate-50">
                    <td className="px-4 py-2.5 text-xs font-bold text-slate-500 uppercase tracking-wide">Total</td>
                    <td className="px-3 py-2.5 text-right tabular-nums font-bold text-slate-900">
                      {fmt$(investorRows.reduce((s, i) => s + Number(i.contribution || 0), 0))}
                    </td>
                    <td />
                    <td className="px-3 py-2.5 text-right tabular-nums font-bold text-emerald-700">{fmt$(total)}</td>
                    <td />
                  </tr>
                </tfoot>
              </table>
            </div>
          )}

          {/* Distribution history */}
          <p className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">History</p>
          {distributions.length === 0 ? (
            <p className="text-sm text-slate-400 py-4">No distributions recorded yet</p>
          ) : (
            <div className="space-y-2">
              {distributions.map(d => (
                <div key={d.id} className="flex items-center justify-between bg-white rounded-xl px-4 py-3 border border-slate-200">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-slate-900">
                      {d.investor_name}
                      <span className={`ml-2 inline-block px-2 py-0.5 rounded-full text-xs font-medium ${TYPE_STYLES[d.distribution_type] || 'bg-slate-100 text-slate-600'}`}>
                        {d.distribution_type}
                      </span>
                    </p>
                    <p className="text-xs text-slate-400 mt-0.5">
                      {fmtDate(d.distribution_date)}{d.notes ? ` — ${d.notes}` : ''}
                    </p>
                  </div>
                  <div className="flex items-center gap-3 shrink-0 ml-4">
                    <span className="text-sm font-bold tabular-nums text-emerald-700">{fmt$(d.amount)}</span>
                    <button
                      onClick={() => handleDelete(d.id)}
                      disabled={deleting === d.id}
                      className="p-1.5 rounded text-slate-300 hover:text-red-500 hover:bg-red-50 transition-colors disabled:opacity-40"
                    >
                      {deleting === d.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {showAdd && (
        <RecordModal propertyId={propertyId} investors={investors} onSaved={load} onClose={() => setShowAdd(false)} />
      )}
    </div>
  )
}
