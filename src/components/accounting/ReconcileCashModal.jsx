// Reconcile book cash to the actual bank balance. Posts a single 'Cash Adjustment'
// entry for the difference so the ledger's Current Balance matches reality —
// fixes botched imports / unrecorded activity. Can pull the live linked-bank balance.
import { useState, useMemo } from 'react'
import { X, Loader2, Banknote, AlertTriangle, ChevronRight, ChevronDown } from 'lucide-react'
import Button from '../ui/Button'
import { reconcileCash, getPlaidBalance } from '../../api/client'
import { computeCashBreakdown } from '../../utils/accounting'

const money = n => (n == null || isNaN(n) ? '—' : (n < 0 ? `-$${Math.abs(Math.round(n)).toLocaleString()}` : `$${Math.round(n).toLocaleString()}`))
const num = v => { const n = parseFloat(String(v).replace(/[$,\s]/g, '')); return isFinite(n) ? n : NaN }

export default function ReconcileCashModal({ propertyId, currentBalance, transactions = [], opening = null, onClose, onSaved }) {
  const [target, setTarget]   = useState('')
  const [asOf, setAsOf]       = useState(new Date().toISOString().slice(0, 10))
  const [saving, setSaving]   = useState(false)
  const [pulling, setPulling] = useState(false)
  const [error, setError]     = useState(null)
  const [bankInfo, setBankInfo] = useState(null)
  const [showBreakdown, setShowBreakdown] = useState(true)
  const [openLine, setOpenLine] = useState(null)
  const breakdown = useMemo(() => computeCashBreakdown(transactions, opening), [transactions, opening])

  const targetNum = num(target)
  const delta = isFinite(targetNum) ? Math.round((targetNum - currentBalance) * 100) / 100 : null

  const pullBank = async () => {
    setPulling(true); setError(null)
    try {
      const r = await getPlaidBalance(propertyId)
      setTarget(String(r.total))
      setBankInfo(r)
    } catch (e) {
      setError(e.message || 'Could not read the linked bank balance')
    } finally { setPulling(false) }
  }

  const save = async () => {
    if (!isFinite(targetNum)) { setError('Enter the actual bank balance'); return }
    setSaving(true); setError(null)
    try {
      await reconcileCash(propertyId, { target_balance: targetNum, current_balance: currentBalance, as_of: asOf })
      onSaved?.()
      onClose()
    } catch (e) {
      setError(e.message || 'Reconcile failed')
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
          <div className="flex items-center gap-2">
            <Banknote className="w-5 h-5 text-emerald-600" />
            <h3 className="text-base font-semibold text-slate-900">Reconcile cash to bank</h3>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600"><X className="w-5 h-5" /></button>
        </div>

        <div className="px-5 py-4 space-y-4">
          <p className="text-sm text-slate-500">
            Trues up the ledger's cash balance to your real bank balance. Posts one dated
            <span className="font-medium text-slate-700"> Cash Adjustment</span> entry for the difference — it doesn't touch P&L income or expenses.
          </p>

          <div className="flex items-center justify-between text-sm bg-slate-50 rounded-lg px-3 py-2">
            <span className="text-slate-500">Current book cash</span>
            <span className="font-medium tabular-nums text-slate-900">{money(currentBalance)}</span>
          </div>

          {/* Audit trail — what makes up the book cash */}
          {breakdown.lines.length > 0 && (
            <div className="border border-slate-200 rounded-lg overflow-hidden">
              <button onClick={() => setShowBreakdown(s => !s)}
                className="w-full flex items-center justify-between px-3 py-2 text-sm hover:bg-slate-50">
                <span className="font-medium text-slate-700">What's in this balance?</span>
                {showBreakdown ? <ChevronDown className="w-4 h-4 text-slate-400" /> : <ChevronRight className="w-4 h-4 text-slate-400" />}
              </button>
              {showBreakdown && (
                <div className="border-t border-slate-100 divide-y divide-slate-50">
                  {breakdown.lines.map(l => (
                    <div key={l.key}>
                      <button onClick={() => setOpenLine(openLine === l.key ? null : l.key)}
                        className={`w-full flex items-center justify-between px-3 py-1.5 text-sm text-left hover:bg-slate-50 ${l.flag ? 'bg-amber-50/60' : ''}`}>
                        <span className="flex items-center gap-1.5 text-slate-600">
                          {l.txs.length > 0 && (openLine === l.key ? <ChevronDown className="w-3 h-3 text-slate-300" /> : <ChevronRight className="w-3 h-3 text-slate-300" />)}
                          {l.label}{l.txs.length > 0 ? <span className="text-slate-300"> ({l.txs.length})</span> : null}
                          {l.flag && <span className="text-[10px] font-medium text-amber-600 bg-amber-100 rounded px-1">check</span>}
                        </span>
                        <span className={`tabular-nums ${l.amount < 0 ? 'text-red-600' : 'text-slate-800'}`}>{money(l.amount)}</span>
                      </button>
                      {l.note && <p className="px-3 pb-1 text-[11px] text-amber-600">{l.note}</p>}
                      {openLine === l.key && l.txs.length > 0 && (
                        <div className="px-3 pb-2 bg-slate-50/60 max-h-40 overflow-y-auto">
                          {l.txs.map(t => (
                            <div key={t.id} className="flex items-center justify-between text-xs py-0.5 text-slate-500">
                              <span className="truncate mr-2">{t.date} · {t.description || t.category}</span>
                              <span className={`tabular-nums shrink-0 ${Number(t.amount) < 0 ? 'text-red-500' : 'text-slate-600'}`}>{money(Number(t.amount))}</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
                  <div className="flex items-center justify-between px-3 py-1.5 text-sm font-semibold bg-slate-50">
                    <span className="text-slate-700">Book cash</span>
                    <span className="tabular-nums text-slate-900">{money(breakdown.total)}</span>
                  </div>
                  {breakdown.excluded.length > 0 && (
                    <div className="px-3 py-2 bg-slate-50/40">
                      <p className="text-[11px] text-slate-400 mb-1">Acquisition items excluded from cash (for reference):</p>
                      {breakdown.excluded.map(l => (
                        <div key={l.key} className="flex items-center justify-between text-xs py-0.5 text-slate-400">
                          <span className="truncate mr-2">{l.label}</span>
                          <span className="tabular-nums shrink-0">{money(l.amount)}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1">Actual bank balance</label>
            <div className="flex items-center gap-2">
              <input
                value={target}
                onChange={e => setTarget(e.target.value)}
                type="text" inputMode="decimal" placeholder="15,792.40"
                className="flex-1 text-sm text-right tabular-nums border border-slate-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-emerald-400"
              />
              <button onClick={pullBank} disabled={pulling}
                className="inline-flex items-center gap-1 text-xs font-medium text-emerald-700 border border-emerald-200 rounded-lg px-2.5 py-2 hover:bg-emerald-50 disabled:opacity-50 whitespace-nowrap">
                {pulling ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Banknote className="w-3.5 h-3.5" />}
                Pull from bank
              </button>
            </div>
            {bankInfo?.accounts?.length > 0 && (
              <p className="text-xs text-slate-400 mt-1">
                {bankInfo.accounts.map(a => `${a.name}${a.mask ? ` ••${a.mask}` : ''}: ${money(a.balance)}`).join(' · ')} (as of {bankInfo.as_of})
              </p>
            )}
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1">Adjustment date</label>
            <input value={asOf} onChange={e => setAsOf(e.target.value)} type="date"
              className="text-sm border border-slate-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-emerald-400" />
          </div>

          {delta != null && (
            <div className={`rounded-lg px-3 py-2.5 text-sm ${Math.abs(delta) < 0.01 ? 'bg-slate-50 text-slate-500' : 'bg-amber-50 text-amber-800'}`}>
              {Math.abs(delta) < 0.01 ? (
                <span>Already matches — no adjustment needed.</span>
              ) : (
                <div className="flex items-center justify-between">
                  <span>Will post a <span className="font-medium">{delta < 0 ? 'reduction' : 'increase'}</span> of</span>
                  <span className="font-semibold tabular-nums">{money(delta)}</span>
                </div>
              )}
            </div>
          )}

          {error && (
            <p className="text-sm text-red-600 flex items-center gap-1.5"><AlertTriangle className="w-4 h-4" /> {error}</p>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 px-5 py-4 border-t border-slate-100">
          <button onClick={onClose} className="text-sm font-medium text-slate-500 hover:text-slate-700 px-3 py-2">Cancel</button>
          <Button onClick={save} disabled={saving || !isFinite(targetNum)}>
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
            Post adjustment
          </Button>
        </div>
      </div>
    </div>
  )
}
