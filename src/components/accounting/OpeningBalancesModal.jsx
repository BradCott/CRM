// Opening balances — a property's starting point so books can begin mid-life
// without entering full history. Additive to transaction-derived figures and
// only used when Advanced Accounting (beta) is on.
import { useState } from 'react'
import { X, Landmark, Loader2, AlertCircle, CheckCircle } from 'lucide-react'
import Button from '../ui/Button'
import { saveOpeningBalances } from '../../api/client'

const FIELDS = [
  { key: 'cash',              label: 'Cash / bank balance',   side: 'asset',     hint: 'Money in the property’s accounts on the start date' },
  { key: 'real_estate',       label: 'Real estate (at cost)', side: 'asset',     hint: 'Building + land at purchase cost' },
  { key: 'loan_balance',      label: 'Loan balance',          side: 'liability', hint: 'Outstanding mortgage principal on the start date' },
  { key: 'invested_capital',  label: 'Invested capital',      side: 'equity',    hint: 'Owner / investor money put in before the start date' },
  { key: 'retained_earnings', label: 'Retained earnings',     side: 'equity',    hint: 'Accumulated profit (or loss) before the start date — can be negative' },
]

function fmt$(n) {
  const v = Number(n) || 0
  const abs = '$' + Math.abs(Math.round(v)).toLocaleString()
  return v < 0 ? `(${abs})` : abs
}

export default function OpeningBalancesModal({ propertyId, initial, onSaved, onClose }) {
  const [form, setForm] = useState({
    as_of_date:        initial?.as_of_date || new Date().toISOString().slice(0, 10),
    cash:              initial?.cash ?? '',
    real_estate:       initial?.real_estate ?? '',
    loan_balance:      initial?.loan_balance ?? '',
    invested_capital:  initial?.invested_capital ?? '',
    retained_earnings: initial?.retained_earnings ?? '',
    notes:             initial?.notes || '',
  })
  const [saving, setSaving] = useState(false)
  const [error, setError]   = useState(null)

  const num = v => (v === '' || v === null || v === undefined ? 0 : parseFloat(v) || 0)
  const set = key => e => setForm(f => ({ ...f, [key]: e.target.value }))

  const assets      = num(form.cash) + num(form.real_estate)
  const liabilities = num(form.loan_balance)
  const equity      = num(form.invested_capital) + num(form.retained_earnings)
  const diff        = assets - (liabilities + equity)
  const balanced    = Math.abs(diff) < 1

  async function handleSave() {
    setSaving(true)
    setError(null)
    try {
      await saveOpeningBalances(propertyId, form)
      onSaved?.()
      onClose()
    } catch (e) {
      setError(e.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 shrink-0">
          <div className="flex items-center gap-2">
            <Landmark className="w-4 h-4 text-blue-600" />
            <div>
              <h2 className="text-base font-semibold text-slate-900">Opening Balances</h2>
              <p className="text-xs text-slate-400">Where this property’s books start</p>
            </div>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600"><X className="w-5 h-5" /></button>
        </div>

        <div className="px-6 py-4 overflow-y-auto space-y-4">
          <p className="text-xs text-slate-500 bg-slate-50 rounded-lg px-3 py-2">
            Use this only if you are <span className="font-semibold">not</span> entering the property’s full history.
            Enter the balances as of the start date; everything you record afterward adds to these.
            Leave blank (0) for a property entered from day one.
          </p>

          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">As of date</label>
            <input type="date" value={form.as_of_date} onChange={set('as_of_date')}
              className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-400" />
          </div>

          {FIELDS.map(f => (
            <div key={f.key}>
              <div className="flex items-center justify-between mb-1">
                <label className="text-xs font-medium text-slate-600">{f.label}</label>
                <span className={`text-[10px] uppercase tracking-wide font-semibold ${
                  f.side === 'asset' ? 'text-emerald-600' : f.side === 'liability' ? 'text-rose-600' : 'text-indigo-600'
                }`}>{f.side}</span>
              </div>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-sm">$</span>
                <input
                  type="number" step="0.01" value={form[f.key]} onChange={set(f.key)} placeholder="0.00"
                  className="w-full text-sm border border-slate-200 rounded-lg pl-7 pr-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-400"
                />
              </div>
              <p className="text-[11px] text-slate-400 mt-0.5">{f.hint}</p>
            </div>
          ))}

          {/* Live balance check */}
          <div className={`rounded-xl border px-3 py-3 ${balanced ? 'border-emerald-200 bg-emerald-50' : 'border-amber-200 bg-amber-50'}`}>
            <div className="flex items-center justify-between text-xs">
              <span className="text-slate-600">Assets</span><span className="font-semibold tabular-nums">{fmt$(assets)}</span>
            </div>
            <div className="flex items-center justify-between text-xs">
              <span className="text-slate-600">Liabilities + Equity</span><span className="font-semibold tabular-nums">{fmt$(liabilities + equity)}</span>
            </div>
            <div className="border-t border-slate-200 my-1.5" />
            {balanced ? (
              <p className="flex items-center gap-1.5 text-xs font-medium text-emerald-700">
                <CheckCircle className="w-3.5 h-3.5" /> Balanced
              </p>
            ) : (
              <p className="flex items-start gap-1.5 text-xs font-medium text-amber-700">
                <AlertCircle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                Off by {fmt$(Math.abs(diff))} — assets should equal liabilities + equity. Adjust before saving, or save anyway and the difference will land in retained earnings.
              </p>
            )}
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Notes (optional)</label>
            <textarea value={form.notes} onChange={set('notes')} rows={2}
              className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2 resize-none focus:outline-none focus:ring-2 focus:ring-blue-400" />
          </div>

          {error && <div className="px-3 py-2 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">{error}</div>}
        </div>

        <div className="px-6 py-3 border-t border-slate-100 bg-slate-50 rounded-b-2xl flex justify-end gap-2 shrink-0">
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button onClick={handleSave} disabled={saving}>
            {saving ? <><Loader2 className="w-4 h-4 animate-spin" /> Saving…</> : 'Save opening balances'}
          </Button>
        </div>
      </div>
    </div>
  )
}
