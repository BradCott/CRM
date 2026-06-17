// Category dropdown with an inline "+ Add category…" that asks the type
// (so it's recorded as the right kind — P&L vs balance sheet), QuickBooks-style.
import { useState } from 'react'
import { Loader2, Check, X } from 'lucide-react'
import { useApp } from '../../context/AppContext'
import { ALL_CATEGORIES } from '../../utils/accounting'

const KIND_OPTIONS = [
  { value: 'expense',   label: 'Expense',   hint: 'Money out — appears on the P&L (repairs, insurance, fees)' },
  { value: 'income',    label: 'Income',    hint: 'Money in — appears on the P&L (rent, other revenue)' },
  { value: 'liability', label: 'Liability (loan/debt)', hint: 'Paying down a loan or note — balance sheet, not P&L' },
  { value: 'asset',     label: 'Asset',     hint: 'Buying or improving an asset — balance sheet, not P&L' },
  { value: 'equity',    label: 'Equity',    hint: 'Owner contribution or distribution — balance sheet, not P&L' },
]

export default function CategorySelect({ value, onChange, className = '', autoFocus }) {
  const { addCategory } = useApp()
  const [adding, setAdding] = useState(false)
  const [name, setName]     = useState('')
  const [kind, setKind]     = useState('expense')
  const [saving, setSaving] = useState(false)
  const [error, setError]   = useState(null)

  async function handleAdd() {
    const n = name.trim()
    if (!n) return
    setSaving(true)
    setError(null)
    try {
      await addCategory({ name: n, kind })   // creates + re-hydrates the live category lists
      onChange(n)                            // select the newly created category
      setAdding(false)
      setName('')
      setKind('expense')
    } catch (e) {
      setError(e.message)
    } finally {
      setSaving(false)
    }
  }

  if (adding) {
    return (
      <div className="border border-blue-200 rounded-lg p-2 bg-blue-50/50 space-y-1.5 min-w-[200px]">
        <input
          autoFocus
          value={name}
          onChange={e => setName(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') handleAdd(); if (e.key === 'Escape') setAdding(false) }}
          placeholder="New category name"
          className="w-full text-xs border border-slate-200 rounded px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-400"
        />
        <select
          value={kind}
          onChange={e => setKind(e.target.value)}
          className="w-full text-xs border border-slate-200 rounded px-2 py-1.5 bg-white focus:outline-none focus:ring-2 focus:ring-blue-400"
        >
          {KIND_OPTIONS.map(k => <option key={k.value} value={k.value}>{k.label}</option>)}
        </select>
        <p className="text-[10px] text-slate-500 leading-snug">{KIND_OPTIONS.find(k => k.value === kind)?.hint}</p>
        {error && <p className="text-[10px] text-red-600">{error}</p>}
        <div className="flex items-center gap-1">
          <button type="button" onClick={handleAdd} disabled={saving || !name.trim()}
            className="flex items-center gap-1 text-xs font-medium text-white bg-blue-600 hover:bg-blue-700 rounded px-2 py-1 disabled:opacity-50">
            {saving ? <Loader2 className="w-3 h-3 animate-spin" /> : <Check className="w-3 h-3" />} Add
          </button>
          <button type="button" onClick={() => { setAdding(false); setError(null) }}
            className="flex items-center gap-1 text-xs text-slate-500 hover:text-slate-700 px-1.5 py-1">
            <X className="w-3 h-3" /> Cancel
          </button>
        </div>
      </div>
    )
  }

  return (
    <select
      value={value ?? ''}
      autoFocus={autoFocus}
      onChange={e => { if (e.target.value === '__add__') setAdding(true); else onChange(e.target.value) }}
      className={className || 'text-sm border border-slate-200 rounded-lg px-2 py-1.5 bg-white focus:outline-none focus:ring-2 focus:ring-blue-400'}
    >
      {ALL_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
      <option value="__add__">+ Add category…</option>
    </select>
  )
}
