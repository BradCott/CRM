// Portfolio-wide cash reconciliation. Lists every property with its book cash vs.
// the actual bank balance, pulls linked-bank balances in one pass, and posts a
// 'Cash Adjustment' per property so the whole portfolio ties to reality at once.
import { useState, useEffect } from 'react'
import { X, Loader2, Banknote, AlertTriangle, CheckCircle } from 'lucide-react'
import Button from '../ui/Button'
import { reconcileCash, getPlaidBalance, getAccountingReports } from '../../api/client'
import { computeBalanceSheet } from '../../utils/accounting'

const money = n => (n == null || isNaN(n) ? '—' : (n < 0 ? `-$${Math.abs(Math.round(n)).toLocaleString()}` : `$${Math.round(n).toLocaleString()}`))
const num = v => { const n = parseFloat(String(v).replace(/[$,\s]/g, '')); return isFinite(n) ? n : NaN }

export default function PortfolioReconcileModal({ onClose, onDone }) {
  const [properties, setProperties] = useState([])
  const [loading, setLoading]       = useState(true)
  const [loadError, setLoadError]   = useState(null)
  // rows keyed by property id → { target, include, pulling, pullError }
  const [rows, setRows] = useState({})
  const [pullingAll, setPullingAll] = useState(false)
  const [posting, setPosting]       = useState(false)
  const [progress, setProgress]     = useState(null) // { done, total }
  const [result, setResult]         = useState(null) // { posted, skipped, failed:[] }
  const [asOf] = useState(new Date().toISOString().slice(0, 10))

  // Book cash computed the SAME way as the per-property ledger & sale wizard
  // (computeBalanceSheet), so the adjustment we post actually moves that number.
  useEffect(() => {
    getAccountingReports()
      .then(({ advanced, properties: list }) => {
        const items = (list || []).map(p => ({
          id: p.id, address: p.address, tenant: p.tenant, state: p.state, bank_count: p.bank_count,
          book: computeBalanceSheet(p.transactions || [], p.investors || [], advanced ? p.opening_balances : null).totalCash,
        }))
        setProperties(items)
        const m = {}
        for (const p of items) m[p.id] = { target: '', include: false, pulling: false, pullError: null }
        setRows(m)
      })
      .catch(e => setLoadError(e.message || 'Failed to load'))
      .finally(() => setLoading(false))
  }, [])

  const setRow = (id, patch) => setRows(r => ({ ...r, [id]: { ...r[id], ...patch } }))

  const bookOf = p => Number(p.book) || 0
  const adjOf  = p => { const t = num(rows[p.id]?.target); return isFinite(t) ? Math.round((t - bookOf(p)) * 100) / 100 : null }

  const pullOne = async (p) => {
    if (!p.bank_count) return
    setRow(p.id, { pulling: true, pullError: null })
    try {
      const r = await getPlaidBalance(p.id)
      setRow(p.id, { target: String(r.total), include: Math.abs(r.total - bookOf(p)) >= 0.01, pulling: false })
    } catch (e) {
      setRow(p.id, { pulling: false, pullError: e.message || 'No balance' })
    }
  }

  const pullAll = async () => {
    setPullingAll(true)
    for (const p of properties.filter(p => p.bank_count)) await pullOne(p)
    setPullingAll(false)
  }

  const selected = properties.filter(p => rows[p.id]?.include && adjOf(p) != null && Math.abs(adjOf(p)) >= 0.01)
  const totalAdj = selected.reduce((s, p) => s + adjOf(p), 0)

  const post = async () => {
    setPosting(true); setProgress({ done: 0, total: selected.length })
    const failed = []
    let posted = 0
    for (let i = 0; i < selected.length; i++) {
      const p = selected[i]
      try {
        await reconcileCash(p.id, { target_balance: num(rows[p.id].target), current_balance: bookOf(p), as_of: asOf })
        posted++
      } catch (e) {
        failed.push({ address: p.address, error: e.message || 'failed' })
      }
      setProgress({ done: i + 1, total: selected.length })
    }
    setResult({ posted, failed })
    setPosting(false)
    if (posted > 0) onDone?.()
  }

  const bankCount = properties.filter(p => p.bank_count).length

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-3xl max-h-[88vh] flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100 shrink-0">
          <div className="flex items-center gap-2">
            <Banknote className="w-5 h-5 text-emerald-600" />
            <h3 className="text-base font-semibold text-slate-900">Reconcile portfolio cash</h3>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600"><X className="w-5 h-5" /></button>
        </div>

        {loading ? (
          <div className="px-5 py-16 flex flex-col items-center gap-2 text-slate-400">
            <Loader2 className="w-6 h-6 animate-spin" />
            <p className="text-sm">Loading portfolio cash…</p>
          </div>
        ) : loadError ? (
          <div className="px-5 py-16 flex flex-col items-center gap-2 text-red-500">
            <AlertTriangle className="w-6 h-6" />
            <p className="text-sm">{loadError}</p>
          </div>
        ) : result ? (
          <div className="px-5 py-8 flex flex-col items-center gap-3 text-center">
            <CheckCircle className="w-10 h-10 text-emerald-500" />
            <p className="text-lg font-semibold text-slate-900">{result.posted} propert{result.posted === 1 ? 'y' : 'ies'} reconciled</p>
            {result.failed.length > 0 && (
              <div className="text-sm text-red-600 mt-1">
                <p className="font-medium">{result.failed.length} failed:</p>
                {result.failed.map((f, i) => <p key={i} className="text-xs">{f.address} — {f.error}</p>)}
              </div>
            )}
            <Button onClick={onClose} className="mt-2">Done</Button>
          </div>
        ) : (
          <>
            <div className="px-5 py-3 border-b border-slate-100 shrink-0 flex items-center justify-between gap-3">
              <p className="text-sm text-slate-500">
                Enter each property's real bank balance (or pull linked accounts), then post one <span className="font-medium text-slate-700">Cash Adjustment</span> each. P&amp;L is untouched.
              </p>
              {bankCount > 0 && (
                <button onClick={pullAll} disabled={pullingAll}
                  className="inline-flex items-center gap-1.5 text-xs font-medium text-emerald-700 border border-emerald-200 rounded-lg px-3 py-2 hover:bg-emerald-50 disabled:opacity-50 whitespace-nowrap">
                  {pullingAll ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Banknote className="w-3.5 h-3.5" />}
                  Pull all {bankCount} linked
                </button>
              )}
            </div>

            <div className="flex-1 overflow-y-auto">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-slate-50 border-b border-slate-200">
                  <tr>
                    <th className="px-4 py-2 text-left text-xs font-semibold text-slate-500 uppercase tracking-wide">Property</th>
                    <th className="px-3 py-2 text-right text-xs font-semibold text-slate-500 uppercase tracking-wide">Book cash</th>
                    <th className="px-3 py-2 text-right text-xs font-semibold text-slate-500 uppercase tracking-wide">Actual balance</th>
                    <th className="px-3 py-2 text-right text-xs font-semibold text-slate-500 uppercase tracking-wide">Adjustment</th>
                    <th className="px-3 py-2 text-center text-xs font-semibold text-slate-500 uppercase tracking-wide">Post</th>
                  </tr>
                </thead>
                <tbody>
                  {properties.map(p => {
                    const adj = adjOf(p)
                    const row = rows[p.id] || {}
                    return (
                      <tr key={p.id} className="border-b border-slate-100 hover:bg-slate-50/60">
                        <td className="px-4 py-2">
                          <p className="font-medium text-slate-800 truncate max-w-[220px]">{p.address}</p>
                          <p className="text-xs text-slate-400">{[p.tenant, p.state].filter(Boolean).join(' · ')}</p>
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums text-slate-700">{money(bookOf(p))}</td>
                        <td className="px-3 py-2 text-right">
                          <div className="flex items-center justify-end gap-1">
                            <input
                              value={row.target || ''}
                              onChange={e => setRow(p.id, { target: e.target.value, include: isFinite(num(e.target.value)) && Math.abs(num(e.target.value) - bookOf(p)) >= 0.01 })}
                              type="text" inputMode="decimal" placeholder="—"
                              className="w-28 text-right tabular-nums border border-slate-200 rounded-lg px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-emerald-400"
                            />
                            {p.bank_count > 0 && (
                              <button onClick={() => pullOne(p)} disabled={row.pulling} title="Pull linked bank balance"
                                className="text-emerald-600 hover:text-emerald-800 disabled:opacity-40">
                                {row.pulling ? <Loader2 className="w-4 h-4 animate-spin" /> : <Banknote className="w-4 h-4" />}
                              </button>
                            )}
                          </div>
                          {row.pullError && <p className="text-[10px] text-red-500 mt-0.5">{row.pullError}</p>}
                        </td>
                        <td className={`px-3 py-2 text-right tabular-nums font-medium ${adj == null ? 'text-slate-300' : adj < 0 ? 'text-red-600' : 'text-emerald-600'}`}>
                          {adj == null ? '—' : money(adj)}
                        </td>
                        <td className="px-3 py-2 text-center">
                          <input type="checkbox"
                            checked={!!row.include}
                            disabled={adj == null || Math.abs(adj) < 0.01}
                            onChange={e => setRow(p.id, { include: e.target.checked })}
                            className="rounded border-slate-300" />
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>

            <div className="px-5 py-4 border-t border-slate-100 shrink-0 flex items-center justify-between gap-3">
              <div className="text-sm text-slate-500">
                {progress
                  ? <span className="flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" /> Posting {progress.done}/{progress.total}…</span>
                  : selected.length > 0
                    ? <span><span className="font-medium text-slate-700">{selected.length}</span> selected · net {money(totalAdj)}</span>
                    : <span className="flex items-center gap-1.5 text-slate-400"><AlertTriangle className="w-4 h-4" /> Enter balances and check the ones to post</span>}
              </div>
              <div className="flex items-center gap-2">
                <button onClick={onClose} className="text-sm font-medium text-slate-500 hover:text-slate-700 px-3 py-2">Cancel</button>
                <Button onClick={post} disabled={posting || selected.length === 0}>
                  {posting ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                  Post {selected.length || ''} adjustment{selected.length === 1 ? '' : 's'}
                </Button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
