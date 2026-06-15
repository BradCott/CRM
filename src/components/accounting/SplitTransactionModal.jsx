// Split one transaction into multiple category lines (e.g. principal + interest)
import { useState } from 'react'
import { X, Plus, Trash2, Loader2, Split } from 'lucide-react'
import Button from '../ui/Button'
import { splitTransaction } from '../../api/client'
import { ALL_CATEGORIES } from '../../utils/accounting'

function fmt$(n) {
  const abs = '$' + Math.abs(Number(n)).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  return Number(n) < 0 ? `-${abs}` : abs
}

export default function SplitTransactionModal({ tx, onSaved, onClose }) {
  const isMortgage = /mortgage/i.test(tx.category) || /mortgage/i.test(tx.description || '')
  const [lines, setLines] = useState(() =>
    isMortgage
      ? [
          { category: 'Mortgage Interest',  amount: '', description: '' },
          { category: 'Mortgage Principal', amount: '', description: '' },
        ]
      : [
          { category: tx.category, amount: String(tx.amount), description: '' },
          { category: 'Other',     amount: '',               description: '' },
        ]
  )
  const [saving, setSaving] = useState(false)
  const [error, setError]   = useState(null)

  const setLine = (i, field, val) => setLines(prev => prev.map((l, j) => j === i ? { ...l, [field]: val } : l))
  const addLine = () => setLines(prev => [...prev, { category: 'Other', amount: '', description: '' }])
  const removeLine = (i) => setLines(prev => prev.filter((_, j) => j !== i))

  const total     = lines.reduce((s, l) => s + (parseFloat(l.amount) || 0), 0)
  const remaining = Number(tx.amount) - total
  const balanced  = Math.abs(remaining) < 0.01

  // Fill the last empty line with the remaining amount
  function fillRemaining(i) {
    setLine(i, 'amount', ((parseFloat(lines[i].amount) || 0) + remaining).toFixed(2))
  }

  async function handleSave() {
    if (!balanced) { setError(`Splits must total ${fmt$(tx.amount)}`); return }
    setSaving(true)
    setError(null)
    try {
      await splitTransaction(tx.id, lines.map(l => ({
        category: l.category,
        amount:   parseFloat(l.amount),
        description: l.description.trim() || null,
      })))
      onSaved()
      onClose()
    } catch (e) {
      setError(e.message)
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
          <div className="flex items-center gap-2">
            <Split className="w-4 h-4 text-blue-600" />
            <h2 className="text-base font-semibold text-slate-900">Split Transaction</h2>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600"><X className="w-5 h-5" /></button>
        </div>

        <div className="px-6 py-4">
          <div className="flex items-center justify-between text-sm mb-3 pb-3 border-b border-slate-100">
            <div className="min-w-0">
              <p className="font-medium text-slate-800 truncate">{tx.description}</p>
              <p className="text-xs text-slate-400">{tx.date}</p>
            </div>
            <span className={`font-bold tabular-nums ${Number(tx.amount) >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>{fmt$(tx.amount)}</span>
          </div>

          {error && <div className="mb-3 px-3 py-2 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">{error}</div>}

          <div className="space-y-2">
            {lines.map((l, i) => (
              <div key={i} className="flex items-center gap-2">
                <select
                  value={l.category}
                  onChange={e => setLine(i, 'category', e.target.value)}
                  className="flex-1 text-sm border border-slate-200 rounded-lg px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-400 bg-white"
                >
                  {ALL_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
                <input
                  type="number" step="0.01" placeholder="0.00" value={l.amount}
                  onChange={e => setLine(i, 'amount', e.target.value)}
                  className="w-28 text-sm border border-slate-200 rounded-lg px-2 py-1.5 text-right tabular-nums focus:outline-none focus:ring-2 focus:ring-blue-400"
                />
                {!balanced && (
                  <button onClick={() => fillRemaining(i)} title="Fill remaining"
                    className="text-xs text-blue-500 hover:text-blue-700 px-1">↩</button>
                )}
                {lines.length > 2 && (
                  <button onClick={() => removeLine(i)} className="p-1 text-slate-300 hover:text-red-500">
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            ))}
          </div>

          <button onClick={addLine} className="mt-2 flex items-center gap-1 text-xs font-medium text-blue-600 hover:text-blue-800">
            <Plus className="w-3.5 h-3.5" /> Add line
          </button>

          <div className="flex items-center justify-between mt-4 pt-3 border-t border-slate-100 text-sm">
            <span className="text-slate-500">Remaining to allocate</span>
            <span className={`font-bold tabular-nums ${balanced ? 'text-emerald-600' : 'text-amber-600'}`}>
              {balanced ? '✓ Balanced' : fmt$(remaining)}
            </span>
          </div>
        </div>

        <div className="px-6 py-4 border-t border-slate-100 bg-slate-50 rounded-b-2xl flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button onClick={handleSave} disabled={saving || !balanced}>
            {saving ? <><Loader2 className="w-4 h-4 animate-spin" /> Splitting…</> : 'Split'}
          </Button>
        </div>
      </div>
    </div>
  )
}
