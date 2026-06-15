// Charge-type registry — view built-in categories, add/remove custom ones
import { useState } from 'react'
import { X, Plus, Trash2, Loader2, Tag } from 'lucide-react'
import Button from '../ui/Button'
import { useApp } from '../../context/AppContext'
import { CATEGORY_COLORS } from '../../utils/accounting'

const BUILTIN = [
  'Rent', 'Mortgage', 'Mortgage Interest', 'Mortgage Principal', 'Repair', 'Insurance',
  'Property Tax', 'Utilities', 'Management Fees', 'Legal & Professional', 'Advertising',
  'Supplies', 'Travel', 'Commissions', 'Cleaning & Maintenance', 'HOA / CAM', 'Bank Charges',
  'Equity Contribution', 'Purchase', 'Loan', 'Sale', 'Other',
]

export default function CategoryManager({ onClose }) {
  const { customCategories, addCategory, removeCategory } = useApp()
  const [name, setName]   = useState('')
  const [kind, setKind]   = useState('expense')
  const [busy, setBusy]   = useState(false)
  const [error, setError] = useState(null)

  async function handleAdd(e) {
    e.preventDefault()
    if (!name.trim()) return
    setBusy(true)
    setError(null)
    try {
      await addCategory({ name: name.trim(), kind })
      setName('')
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[85vh] flex flex-col">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 shrink-0">
          <div className="flex items-center gap-2">
            <Tag className="w-4 h-4 text-blue-600" />
            <h2 className="text-base font-semibold text-slate-900">Charge Types</h2>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600"><X className="w-5 h-5" /></button>
        </div>

        <div className="px-6 py-4 overflow-y-auto">
          <form onSubmit={handleAdd} className="flex gap-2 mb-4">
            <input
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="New charge type (e.g. Bank Charges)"
              className="flex-1 text-sm border border-slate-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-400"
            />
            <select value={kind} onChange={e => setKind(e.target.value)}
              className="text-sm border border-slate-200 rounded-lg px-2 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-blue-400">
              <option value="expense">Expense</option>
              <option value="income">Income</option>
            </select>
            <Button type="submit" disabled={busy || !name.trim()}>
              {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
            </Button>
          </form>

          {error && <div className="mb-3 px-3 py-2 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">{error}</div>}

          {customCategories.length > 0 && (
            <>
              <p className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">Your charge types</p>
              <div className="space-y-1.5 mb-5">
                {customCategories.map(c => (
                  <div key={c.id} className="flex items-center justify-between bg-slate-50 rounded-lg px-3 py-2">
                    <div className="flex items-center gap-2">
                      <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${CATEGORY_COLORS[c.name] || 'bg-slate-100 text-slate-600'}`}>
                        {c.name}
                      </span>
                      <span className="text-xs text-slate-400 capitalize">{c.kind}</span>
                    </div>
                    <button onClick={() => removeCategory(c.id).catch(e => setError(e.message))}
                      className="p-1 text-slate-300 hover:text-red-500 transition-colors" title="Remove">
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            </>
          )}

          <p className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">Built-in</p>
          <div className="flex flex-wrap gap-1.5">
            {BUILTIN.map(c => (
              <span key={c} className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${CATEGORY_COLORS[c] || 'bg-slate-100 text-slate-600'}`}>
                {c}
              </span>
            ))}
          </div>
        </div>

        <div className="px-6 py-3 border-t border-slate-100 bg-slate-50 rounded-b-2xl flex justify-end shrink-0">
          <Button variant="secondary" onClick={onClose}>Done</Button>
        </div>
      </div>
    </div>
  )
}
