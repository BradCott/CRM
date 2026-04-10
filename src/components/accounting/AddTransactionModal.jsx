import { useState } from 'react'
import { X } from 'lucide-react'
import { Input, Select } from '../ui/Input'
import Button from '../ui/Button'
import { createTransactions } from '../../api/client'

const CATEGORIES = ['Equity Contribution', 'Purchase', 'Rent', 'Mortgage', 'Repair', 'Sale', 'Other']

const EMPTY = {
  date:        new Date().toISOString().slice(0, 10),
  description: '',
  category:    'Rent',
  amount:      '',
  sign:        '+',  // UI toggle: + or -
}

export default function AddTransactionModal({ propertyId, onSaved, onClose }) {
  const [form, setForm] = useState(EMPTY)
  const [saving, setSaving] = useState(false)
  const [error, setError]   = useState(null)

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

          <Select label="Category" value={form.category} onChange={set('category')}>
            {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
          </Select>

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
