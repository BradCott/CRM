// Accounts Payable — bills with due dates; marking paid posts a ledger transaction
import { useState, useEffect, useCallback } from 'react'
import { Plus, Loader2, Trash2, CheckCircle, AlertCircle, X } from 'lucide-react'
import Button from '../ui/Button'
import { Input, Select } from '../ui/Input'
import { getBills, createBill, payBill, deleteBill } from '../../api/client'
import { EXPENSE_CATEGORIES, expenseLabel } from '../../utils/accounting'

function fmt$(n) {
  return '$' + Math.abs(Math.round(Number(n))).toLocaleString()
}
function fmtDate(iso) {
  if (!iso) return '—'
  return new Date(iso.slice(0, 10) + 'T00:00:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
}
function daysUntil(iso) {
  const due = new Date(iso + 'T00:00:00')
  const today = new Date(); today.setHours(0, 0, 0, 0)
  return Math.round((due - today) / 86400000)
}

const EMPTY = {
  payee: '', description: '', category: 'Other',
  amount: '', due_date: new Date().toISOString().slice(0, 10),
}

function AddBillModal({ propertyId, onSaved, onClose }) {
  const [form, setForm]     = useState(EMPTY)
  const [saving, setSaving] = useState(false)
  const [error, setError]   = useState(null)
  const set = f => e => setForm(p => ({ ...p, [f]: e.target.value }))

  async function handleSubmit(e) {
    e.preventDefault()
    if (!form.payee.trim() || !form.amount || !form.due_date) {
      setError('Payee, amount, and due date are required.')
      return
    }
    setSaving(true)
    setError(null)
    try {
      await createBill(propertyId, { ...form, payee: form.payee.trim(), amount: parseFloat(form.amount) })
      onSaved()
      onClose()
    } catch (err) {
      setError(err.message)
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
          <h2 className="text-base font-semibold text-slate-900">Add Bill</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600"><X className="w-5 h-5" /></button>
        </div>
        <form onSubmit={handleSubmit} className="px-6 py-5 space-y-4">
          {error && <div className="px-3 py-2 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">{error}</div>}
          <Input label="Payee" value={form.payee} onChange={set('payee')} placeholder="e.g. State Farm Insurance" autoFocus />
          <Input label="Description (optional)" value={form.description} onChange={set('description')} placeholder="Annual premium" />
          <div className="grid grid-cols-2 gap-4">
            <Select label="Category" value={form.category} onChange={set('category')}>
              {EXPENSE_CATEGORIES.map(c => <option key={c} value={c}>{expenseLabel(c)}</option>)}
            </Select>
            <Input label="Amount" type="number" min="0" step="0.01" value={form.amount} onChange={set('amount')} placeholder="0.00" />
          </div>
          <Input label="Due date" type="date" value={form.due_date} onChange={set('due_date')} />
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="secondary" onClick={onClose}>Cancel</Button>
            <Button type="submit" disabled={saving}>{saving ? 'Saving…' : 'Add Bill'}</Button>
          </div>
        </form>
      </div>
    </div>
  )
}

export default function Bills({ propertyId, onChanged }) {
  const [bills, setBills]       = useState([])
  const [loading, setLoading]   = useState(true)
  const [showAdd, setShowAdd]   = useState(false)
  const [paying, setPaying]     = useState(null)
  const [deleting, setDeleting] = useState(null)
  const [error, setError]       = useState(null)

  const load = useCallback(async () => {
    setLoading(true)
    try { setBills(await getBills(propertyId)) }
    catch (e) { setError(e.message) }
    finally { setLoading(false) }
  }, [propertyId])

  useEffect(() => { load() }, [load])

  async function handlePay(id) {
    setPaying(id)
    setError(null)
    try {
      await payBill(id)
      await load()
      onChanged?.()   // refresh ledger — payment posted as a transaction
    } catch (e) {
      setError(e.message)
    } finally {
      setPaying(null)
    }
  }

  async function handleDelete(id) {
    if (!window.confirm('Delete this bill?')) return
    setDeleting(id)
    try {
      await deleteBill(id)
      setBills(prev => prev.filter(b => b.id !== id))
    } catch (e) {
      setError(e.message)
    } finally {
      setDeleting(null)
    }
  }

  const unpaid = bills.filter(b => !b.paid_at)
  const paid   = bills.filter(b => b.paid_at)
  const totalDue = unpaid.reduce((s, b) => s + Number(b.amount), 0)
  const overdue  = unpaid.filter(b => daysUntil(b.due_date) < 0)

  if (loading) return (
    <div className="flex items-center justify-center py-16">
      <Loader2 className="w-5 h-5 text-slate-400 animate-spin" />
    </div>
  )

  return (
    <div className="max-w-3xl mx-auto px-6 py-6">
      <div className="flex items-start justify-between mb-4">
        <div>
          <h2 className="text-base font-bold text-slate-900">Bills — Accounts Payable</h2>
          <p className="text-xs text-slate-400">
            {unpaid.length} unpaid · {fmt$(totalDue)} due
            {overdue.length > 0 && <span className="text-red-600 font-semibold"> · {overdue.length} overdue</span>}
          </p>
        </div>
        <Button onClick={() => setShowAdd(true)}><Plus className="w-4 h-4" /> Add Bill</Button>
      </div>

      {error && (
        <div className="mb-4 flex items-center gap-2 px-4 py-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
          <AlertCircle className="w-4 h-4 shrink-0" />{error}
        </div>
      )}

      {bills.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-slate-400 gap-2">
          <p className="text-sm font-medium">No bills yet</p>
          <p className="text-xs">Track upcoming property taxes, insurance premiums, and vendor invoices</p>
        </div>
      ) : (
        <div className="space-y-2">
          {unpaid.map(b => {
            const days = daysUntil(b.due_date)
            const isOverdue = days < 0
            const isSoon    = days >= 0 && days <= 7
            return (
              <div key={b.id} className={`flex items-center justify-between rounded-xl px-4 py-3 border ${
                isOverdue ? 'bg-red-50 border-red-200' : isSoon ? 'bg-amber-50 border-amber-200' : 'bg-white border-slate-200'
              }`}>
                <div className="min-w-0">
                  <p className="text-sm font-medium text-slate-900 truncate">
                    {b.payee}
                    {b.description && <span className="text-slate-400 font-normal"> — {b.description}</span>}
                  </p>
                  <p className="text-xs mt-0.5">
                    <span className="text-slate-400">{expenseLabel(b.category)} · Due {fmtDate(b.due_date)}</span>
                    {isOverdue && <span className="text-red-600 font-semibold"> · {Math.abs(days)} day{Math.abs(days) !== 1 ? 's' : ''} overdue</span>}
                    {isSoon && !isOverdue && <span className="text-amber-700 font-medium"> · due in {days} day{days !== 1 ? 's' : ''}</span>}
                  </p>
                </div>
                <div className="flex items-center gap-3 shrink-0 ml-4">
                  <span className="text-sm font-bold tabular-nums text-slate-900">{fmt$(b.amount)}</span>
                  <button
                    onClick={() => handlePay(b.id)}
                    disabled={paying === b.id}
                    className="flex items-center gap-1.5 text-xs font-medium text-emerald-700 px-3 py-1.5 rounded-lg border border-emerald-200 hover:bg-emerald-50 transition-colors disabled:opacity-50"
                  >
                    {paying === b.id
                      ? <><Loader2 className="w-3 h-3 animate-spin" /> Paying…</>
                      : <><CheckCircle className="w-3 h-3" /> Mark Paid</>
                    }
                  </button>
                  <button
                    onClick={() => handleDelete(b.id)}
                    disabled={deleting === b.id}
                    className="p-1.5 rounded text-slate-300 hover:text-red-500 hover:bg-red-50 transition-colors disabled:opacity-40"
                  >
                    {deleting === b.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
                  </button>
                </div>
              </div>
            )
          })}

          {paid.length > 0 && (
            <>
              <p className="text-xs font-bold text-slate-400 uppercase tracking-wider pt-4 pb-1">Paid</p>
              {paid.map(b => (
                <div key={b.id} className="flex items-center justify-between rounded-xl px-4 py-3 border bg-slate-50 border-slate-100 opacity-70">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-slate-600 truncate line-through decoration-slate-300">
                      {b.payee}{b.description && <span className="font-normal"> — {b.description}</span>}
                    </p>
                    <p className="text-xs text-slate-400 mt-0.5">
                      {expenseLabel(b.category)} · Paid {fmtDate(b.paid_at)}
                    </p>
                  </div>
                  <div className="flex items-center gap-3 shrink-0 ml-4">
                    <span className="text-sm font-semibold tabular-nums text-slate-500">{fmt$(b.amount)}</span>
                    <CheckCircle className="w-4 h-4 text-emerald-500" />
                    <button
                      onClick={() => handleDelete(b.id)}
                      disabled={deleting === b.id}
                      className="p-1.5 rounded text-slate-300 hover:text-red-500 hover:bg-red-50 transition-colors disabled:opacity-40"
                    >
                      {deleting === b.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
                    </button>
                  </div>
                </div>
              ))}
            </>
          )}
        </div>
      )}

      <p className="mt-4 text-xs text-slate-400 italic">
        Marking a bill paid posts the payment to the ledger automatically (as a negative transaction in the bill's category, with the payee recorded as vendor).
      </p>

      {showAdd && (
        <AddBillModal propertyId={propertyId} onSaved={load} onClose={() => setShowAdd(false)} />
      )}
    </div>
  )
}
