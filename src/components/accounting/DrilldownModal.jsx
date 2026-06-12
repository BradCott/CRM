import { useState } from 'react'
import { X, Pencil, Check, XCircle, Trash2, Loader2 } from 'lucide-react'
import { updateTransaction, deleteTransaction } from '../../api/client'

const CATEGORIES = ['Rent', 'Mortgage', 'Repair', 'Other', 'Equity Contribution', 'Purchase', 'Loan', 'Sale']

function fmt$(n) {
  if (n === null || n === undefined) return '—'
  const abs = '$' + Math.abs(Math.round(n)).toLocaleString()
  return n < 0 ? `(${abs})` : abs
}

function fmtDate(iso) {
  if (!iso) return '—'
  return new Date(iso + 'T00:00:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
}

function EditRow({ tx, onSaved, onDeleted }) {
  const [editing, setEditing] = useState(false)
  const [saving,  setSaving]  = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [form, setForm] = useState({ date: tx.date, description: tx.description, category: tx.category, amount: tx.amount })

  const set = f => e => setForm(p => ({ ...p, [f]: e.target.value }))

  async function handleSave() {
    setSaving(true)
    try {
      const updated = await updateTransaction(tx.id, { ...form, amount: parseFloat(form.amount) })
      onSaved(updated)
      setEditing(false)
    } catch (e) {
      alert(e.message)
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete() {
    if (!window.confirm('Delete this transaction?')) return
    setDeleting(true)
    try {
      await deleteTransaction(tx.id)
      onDeleted(tx.id)
    } catch (e) {
      alert(e.message)
      setDeleting(false)
    }
  }

  if (editing) {
    return (
      <tr className="bg-blue-50 border-b border-blue-100">
        <td className="px-3 py-2">
          <input type="date" value={form.date} onChange={set('date')}
            className="text-xs border border-slate-300 rounded px-2 py-1 w-full focus:outline-none focus:ring-1 focus:ring-blue-400" />
        </td>
        <td className="px-3 py-2">
          <input type="text" value={form.description} onChange={set('description')}
            className="text-xs border border-slate-300 rounded px-2 py-1 w-full focus:outline-none focus:ring-1 focus:ring-blue-400" />
        </td>
        <td className="px-3 py-2">
          <select value={form.category} onChange={set('category')}
            className="text-xs border border-slate-300 rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-blue-400">
            {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
        </td>
        <td className="px-3 py-2">
          <input type="number" value={form.amount} onChange={set('amount')} step="0.01"
            className="text-xs border border-slate-300 rounded px-2 py-1 w-24 text-right focus:outline-none focus:ring-1 focus:ring-blue-400" />
        </td>
        <td className="px-3 py-2 whitespace-nowrap">
          <div className="flex items-center gap-1">
            <button onClick={handleSave} disabled={saving}
              className="p-1 rounded text-emerald-600 hover:bg-emerald-100 transition-colors disabled:opacity-50">
              {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
            </button>
            <button onClick={() => setEditing(false)}
              className="p-1 rounded text-slate-400 hover:bg-slate-100 transition-colors">
              <XCircle className="w-3.5 h-3.5" />
            </button>
          </div>
        </td>
      </tr>
    )
  }

  return (
    <tr className="border-b border-slate-100 hover:bg-slate-50 group cursor-pointer" onClick={() => setEditing(true)}>
      <td className="px-3 py-2.5 text-xs text-slate-500 whitespace-nowrap">{fmtDate(tx.date)}</td>
      <td className="px-3 py-2.5 text-xs text-slate-800 font-medium max-w-[200px] truncate">{tx.description}</td>
      <td className="px-3 py-2.5 text-xs text-slate-500">{tx.category}</td>
      <td className={`px-3 py-2.5 text-xs font-semibold tabular-nums text-right whitespace-nowrap ${Number(tx.amount) >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
        {fmt$(Number(tx.amount))}
      </td>
      <td className="px-3 py-2.5 whitespace-nowrap">
        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
          <button onClick={e => { e.stopPropagation(); setEditing(true) }}
            className="p-1 rounded text-slate-400 hover:text-blue-600 hover:bg-blue-50 transition-colors">
            <Pencil className="w-3 h-3" />
          </button>
          <button onClick={e => { e.stopPropagation(); handleDelete() }} disabled={deleting}
            className="p-1 rounded text-slate-400 hover:text-red-500 hover:bg-red-50 transition-colors disabled:opacity-50">
            {deleting ? <Loader2 className="w-3 h-3 animate-spin" /> : <Trash2 className="w-3 h-3" />}
          </button>
        </div>
      </td>
    </tr>
  )
}

export default function DrilldownModal({ title, transactions: initial, onClose, onChanged }) {
  const [rows, setRows] = useState(initial)

  const total = rows.reduce((s, t) => s + Number(t.amount), 0)

  function handleSaved(updated) {
    setRows(prev => prev.map(r => r.id === updated.id ? updated : r))
    onChanged?.()
  }

  function handleDeleted(id) {
    setRows(prev => prev.filter(r => r.id !== id))
    onChanged?.()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-3xl max-h-[85vh] flex flex-col">

        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between shrink-0">
          <div>
            <h2 className="text-base font-semibold text-slate-900">{title}</h2>
            <p className="text-xs text-slate-400 mt-0.5">
              {rows.length} transaction{rows.length !== 1 ? 's' : ''} · Total: <span className={`font-semibold ${total >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>{fmt$(Math.abs(total))}</span>
            </p>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Table */}
        <div className="flex-1 overflow-y-auto">
          {rows.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-slate-400 gap-2">
              <p className="text-sm">No transactions</p>
            </div>
          ) : (
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200 sticky top-0 z-10">
                  <th className="px-3 py-2.5 text-xs font-semibold text-slate-500 uppercase tracking-wide text-left whitespace-nowrap">Date</th>
                  <th className="px-3 py-2.5 text-xs font-semibold text-slate-500 uppercase tracking-wide text-left">Description</th>
                  <th className="px-3 py-2.5 text-xs font-semibold text-slate-500 uppercase tracking-wide text-left">Category</th>
                  <th className="px-3 py-2.5 text-xs font-semibold text-slate-500 uppercase tracking-wide text-right">Amount</th>
                  <th className="px-3 py-2.5 w-16"></th>
                </tr>
              </thead>
              <tbody>
                {rows.map(tx => (
                  <EditRow key={tx.id} tx={tx} onSaved={handleSaved} onDeleted={handleDeleted} />
                ))}
              </tbody>
            </table>
          )}
        </div>

        <div className="px-6 py-3 border-t border-slate-100 bg-slate-50 rounded-b-2xl flex items-center justify-between shrink-0">
          <p className="text-xs text-slate-400">Click any row to edit</p>
          <button onClick={onClose} className="text-sm font-medium text-slate-600 hover:text-slate-900 transition-colors">Close</button>
        </div>
      </div>
    </div>
  )
}
