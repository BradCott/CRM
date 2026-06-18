// Chart of Accounts — view every category grouped by account type (Income,
// Expenses, Assets, Liabilities, Equity), see where each lands on the books,
// and add/remove custom categories.
import { useState, useEffect } from 'react'
import { X, Plus, Trash2, Loader2, BookOpen } from 'lucide-react'
import Button from '../ui/Button'
import { useApp } from '../../context/AppContext'
import { getCategories } from '../../api/client'
import {
  CATEGORY_COLORS, ACCOUNT_TYPES, buildChartOfAccounts, PL_CATS, SCHEDULE_E_LINES,
} from '../../utils/accounting'

// Map each category → its Schedule E line label (for the tax hint).
const SCHED_E_BY_CAT = {}
for (const l of SCHEDULE_E_LINES) for (const c of l.categories) SCHED_E_BY_CAT[c] = `Sch. E line ${l.line}`

const KIND_OPTIONS = [
  { value: 'expense',   label: 'Expense'   },
  { value: 'income',    label: 'Income'    },
  { value: 'liability', label: 'Liability' },
  { value: 'asset',     label: 'Asset'     },
  { value: 'equity',    label: 'Equity'    },
]

const STATEMENT_TAG = {
  'Profit & Loss': 'bg-emerald-50 text-emerald-700',
  'Balance Sheet': 'bg-indigo-50 text-indigo-700',
}

export default function CategoryManager({ onClose }) {
  const { customCategories, addCategory, removeCategory } = useApp()
  const [builtin, setBuiltin] = useState([])
  const [name, setName]   = useState('')
  const [kind, setKind]   = useState('expense')
  const [busy, setBusy]   = useState(false)
  const [error, setError] = useState(null)

  useEffect(() => {
    getCategories().then(d => setBuiltin(d.builtin || [])).catch(() => {})
  }, [])

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

  const chart   = buildChartOfAccounts(builtin, customCategories)
  const typeMeta = Object.fromEntries(ACCOUNT_TYPES.map(t => [t.kind, t]))

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[88vh] flex flex-col">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 shrink-0">
          <div className="flex items-center gap-2">
            <BookOpen className="w-4 h-4 text-blue-600" />
            <div>
              <h2 className="text-base font-semibold text-slate-900">Chart of Accounts</h2>
              <p className="text-xs text-slate-400">Every category and how it's classified</p>
            </div>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600"><X className="w-5 h-5" /></button>
        </div>

        <div className="px-6 py-4 overflow-y-auto">
          {/* Add custom category */}
          <form onSubmit={handleAdd} className="flex gap-2 mb-1">
            <input
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="New category (e.g. Landscaping)"
              className="flex-1 text-sm border border-slate-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-400"
            />
            <select value={kind} onChange={e => setKind(e.target.value)}
              className="text-sm border border-slate-200 rounded-lg px-2 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-blue-400">
              {KIND_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
            <Button type="submit" disabled={busy || !name.trim()}>
              {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
            </Button>
          </form>
          <p className="text-xs text-slate-400 mb-4">
            Income & expense categories appear on the P&L. Asset, liability, and equity categories appear on the Balance Sheet.
          </p>

          {error && <div className="mb-3 px-3 py-2 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">{error}</div>}

          {/* Grouped chart */}
          <div className="space-y-5">
            {chart.map(group => (
              <div key={group.kind}>
                <div className="flex items-baseline justify-between mb-2">
                  <h3 className="text-sm font-bold text-slate-800">{group.label}</h3>
                  <span className={`text-[11px] font-medium px-2 py-0.5 rounded-full ${STATEMENT_TAG[group.statement]}`}>
                    {group.statement}
                  </span>
                </div>
                <p className="text-xs text-slate-400 mb-2">{group.hint}</p>
                {group.categories.length === 0 ? (
                  <p className="text-xs text-slate-300 italic">No categories</p>
                ) : (
                  <div className="rounded-xl border border-slate-200 divide-y divide-slate-100">
                    {group.categories.map(cat => (
                      <div key={cat.name} className="flex items-center justify-between px-3 py-2">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${CATEGORY_COLORS[cat.name] || 'bg-slate-100 text-slate-600'}`}>
                            {cat.name}
                          </span>
                          {!cat.builtin && <span className="text-[11px] text-blue-500 font-medium">Custom</span>}
                          {PL_CATS.has(cat.name) && <span className="text-[11px] text-slate-400">P&amp;L</span>}
                          {SCHED_E_BY_CAT[cat.name] && <span className="text-[11px] text-slate-400">· {SCHED_E_BY_CAT[cat.name]}</span>}
                        </div>
                        {!cat.builtin && (
                          <button
                            onClick={() => removeCategory(cat.id).catch(e => setError(e.message))}
                            className="p-1 text-slate-300 hover:text-red-500 transition-colors" title="Remove">
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
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
