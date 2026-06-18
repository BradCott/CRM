import { useState, useEffect } from 'react'
import { X } from 'lucide-react'
import { Input, Select } from '../ui/Input'
import Button from '../ui/Button'
import { createTransactions, getPropertyInvestorsList } from '../../api/client'
import CategorySelect from './CategorySelect'

const EMPTY = {
  date:        new Date().toISOString().slice(0, 10),
  description: '',
  category:    'Rent',
  amount:      '',
  vendor:      '',
  investor_id: '',
  sign:        '+',  // UI toggle: + or -
}

export default function AddTransactionModal({ propertyId, onSaved, onClose }) {
  const [form, setForm] = useState(EMPTY)
  const [saving, setSaving] = useState(false)
  const [error, setError]   = useState(null)
  const [investors, setInvestors] = useState([])

  useEffect(() => { getPropertyInvestorsList(propertyId).then(setInvestors).catch(() => {}) }, [propertyId])

  const set = field => e => setForm(f => ({ ...f, [field]: e.target.value }))

  async function handleSubmit(e) {
    e.preventDefault()
    if (!form.date || !form.description || !form.amount) {
      setError('Date, description, and amount are required.')
      return
    }
    const rawAmt = parseFloat(form.amount)
    if (isNaN(rawAmt) || rawAmt <= 0) {
      setError('Enter a valid positive amount.')
      return
    }
    setSaving(true)
    setError(null)
    try {
      await createTransactions(propertyId, [{
        date:        form.date,
        description: form.description.trim(),
        category:    form.category,
        amount:      form.sign === '-' ? -rawAmt : rawAmt,
        source:      'Manual',
        vendor:      form.vendor.trim() || null,
        investor_id: form.category === 'Equity Contribution' && form.investor_id ? Number(form.investor_id) : null,
      }])
      onSaved()
      onClose()
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
          <h2 className="text-base font-semibold text-slate-900">Add Transaction</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600">
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="px-6 py-5 space-y-4">
          {error && (
            <div className="px-3 py-2 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
              {error}
            </div>
          )}

          <Input label="Date" type="date" value={form.date} onChange={set('date')} />

          <Input
            label="Description"
            value={form.description}
            onChange={set('description')}
            placeholder="e.g. Monthly rent payment"
          />

          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Category</label>
            <CategorySelect
              value={form.category}
              onChange={v => setForm(f => ({ ...f, category: v }))}
              className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2 bg-white outline-none focus:ring-2 focus:ring-blue-200 focus:border-blue-400"
            />
          </div>

          {/* Investor — only relevant for equity contributions */}
          {form.category === 'Equity Contribution' && (
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Investor (whose capital is this?)</label>
              <select
                value={form.investor_id}
                onChange={set('investor_id')}
                className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2 bg-white outline-none focus:ring-2 focus:ring-blue-200 focus:border-blue-400"
              >
                <option value="">— Select investor —</option>
                {investors.map(i => <option key={i.id} value={i.id}>{i.name}</option>)}
              </select>
              <p className="mt-1 text-xs text-slate-400">Attributes this contribution to the investor's capital account.</p>
            </div>
          )}

          <Input
            label="Vendor / Payee (optional)"
            value={form.vendor}
            onChange={set('vendor')}
            placeholder="e.g. ABC Plumbing — used for 1099 tracking"
          />

          {/* Amount with +/- toggle */}
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Amount</label>
            <div className="flex gap-2">
              <div className="flex rounded-lg border border-slate-200 overflow-hidden shrink-0">
                {['+', '-'].map(s => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => setForm(f => ({ ...f, sign: s }))}
                    className={`w-10 text-sm font-bold transition-colors ${
                      form.sign === s
                        ? s === '+' ? 'bg-emerald-500 text-white' : 'bg-red-500 text-white'
                        : 'bg-white text-slate-400 hover:bg-slate-50'
                    }`}
                  >
                    {s}
                  </button>
                ))}
              </div>
              <input
                type="number"
                min="0"
                step="0.01"
                placeholder="0.00"
                value={form.amount}
                onChange={set('amount')}
                className="flex-1 border border-slate-200 rounded-lg px-3 py-2 text-sm text-slate-800 outline-none focus:ring-2 focus:ring-blue-200 focus:border-blue-400"
              />
            </div>
            <p className="mt-1 text-xs text-slate-400">
              {form.sign === '+' ? '+ Money received (credit)' : '− Money paid out (debit)'}
            </p>
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="secondary" onClick={onClose}>Cancel</Button>
            <Button type="submit" disabled={saving}>{saving ? 'Saving…' : 'Save Transaction'}</Button>
          </div>
        </form>
      </div>
    </div>
  )
}
