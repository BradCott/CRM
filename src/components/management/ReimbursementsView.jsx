import { useState, useEffect, useCallback, useMemo } from 'react'
import { Link } from 'react-router-dom'
import {
  Loader2, RefreshCcw, CheckCircle2, Receipt, DollarSign,
  FileText, X, Pencil, Trash2, AlertTriangle,
} from 'lucide-react'
import {
  getAllReimbursements, billReimbursement, receiveReimbursement,
  updateReimbursement, deleteReimbursement,
} from '../../api/client'

// ── utils ─────────────────────────────────────────────────────────────────────
function fmt(n) {
  if (n == null) return '—'
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(n)
}
function fmtDate(s) {
  if (!s) return '—'
  return new Date(s + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}
function outstandingOf(r) {
  const rec = r.recoverable_amount != null ? r.recoverable_amount : (r.expense_amount || 0)
  return Math.max(0, (rec || 0) - (r.received_amount || 0))
}

const TYPE_LABEL = { tax: 'Real Estate Tax', insurance: 'Insurance', cam: 'CAM' }
const TYPE_COLORS = {
  tax:       'bg-amber-100 text-amber-700',
  insurance: 'bg-blue-100  text-blue-700',
  cam:       'bg-purple-100 text-purple-700',
}
const STATUS_META = {
  not_billed:   { label: 'Not billed',   cls: 'bg-slate-100 text-slate-600' },
  billed:       { label: 'Billed',       cls: 'bg-amber-100 text-amber-700' },
  partial:      { label: 'Partial',      cls: 'bg-orange-100 text-orange-700' },
  received:     { label: 'Received',     cls: 'bg-green-100 text-green-700' },
  waived:       { label: 'Waived',       cls: 'bg-slate-100 text-slate-400' },
  tenant_direct:{ label: 'Tenant-direct',cls: 'bg-indigo-100 text-indigo-700' },
}

// ── Edit modal ──────────────────────────────────────────────────────────────
function EditModal({ row, onClose, onSaved }) {
  const [f, setF] = useState({
    expense_amount:     row.expense_amount     ?? '',
    recoverable_amount: row.recoverable_amount ?? '',
    recovery_method:    row.recovery_method    ?? 'landlord_bills',
    billed_amount:      row.billed_amount      ?? '',
    billed_date:        row.billed_date        ?? '',
    received_amount:    row.received_amount    ?? '',
    received_date:      row.received_date      ?? '',
    notes:             row.notes              ?? '',
    waived:            row.status === 'waived',
  })
  const [saving, setSaving] = useState(false)
  const set = (k) => (e) => setF(p => ({ ...p, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }))

  async function save() {
    setSaving(true)
    try {
      await updateReimbursement(row.id, {
        expense_amount:     f.expense_amount,
        recoverable_amount: f.recoverable_amount,
        recovery_method:    f.recovery_method,
        billed_amount:      f.billed_amount,
        billed_date:        f.billed_date,
        received_amount:    f.received_amount,
        received_date:      f.received_date,
        notes:              f.notes,
        status:             f.waived ? 'waived' : 'auto',
      })
      onSaved()
    } catch (err) {
      alert('Error: ' + err.message)
    } finally {
      setSaving(false)
    }
  }

  const Field = ({ label, children }) => (
    <label className="block">
      <span className="text-xs font-medium text-slate-500">{label}</span>
      {children}
    </label>
  )
  const input = 'mt-1 w-full px-2.5 py-1.5 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-400'

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-lg" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-3 border-b border-slate-200">
          <h3 className="text-sm font-bold text-slate-900">
            Edit reimbursement — {TYPE_LABEL[row.expense_type] || row.expense_type} {row.year}
          </h3>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600"><X className="w-4 h-4" /></button>
        </div>
        <div className="p-5 grid grid-cols-2 gap-3">
          <Field label="Expense amount"><input type="number" step="0.01" className={input} value={f.expense_amount} onChange={set('expense_amount')} /></Field>
          <Field label="Recoverable (after caps)"><input type="number" step="0.01" className={input} value={f.recoverable_amount} onChange={set('recoverable_amount')} /></Field>
          <Field label="Recovery method">
            <select className={input} value={f.recovery_method} onChange={set('recovery_method')}>
              <option value="landlord_bills">Landlord fronts &amp; bills tenant</option>
              <option value="tenant_direct">Tenant pays directly</option>
            </select>
          </Field>
          <div />
          <Field label="Billed amount"><input type="number" step="0.01" className={input} value={f.billed_amount} onChange={set('billed_amount')} /></Field>
          <Field label="Billed date"><input type="date" className={input} value={f.billed_date} onChange={set('billed_date')} /></Field>
          <Field label="Received amount"><input type="number" step="0.01" className={input} value={f.received_amount} onChange={set('received_amount')} /></Field>
          <Field label="Received date"><input type="date" className={input} value={f.received_date} onChange={set('received_date')} /></Field>
          <div className="col-span-2">
            <Field label="Notes"><textarea rows={2} className={input} value={f.notes} onChange={set('notes')} /></Field>
          </div>
          <label className="col-span-2 flex items-center gap-2 text-sm text-slate-600">
            <input type="checkbox" checked={f.waived} onChange={set('waived')} />
            Waived (not recovering this expense)
          </label>
        </div>
        <div className="flex justify-end gap-2 px-5 py-3 border-t border-slate-200">
          <button onClick={onClose} className="px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-100 rounded-lg">Cancel</button>
          <button onClick={save} disabled={saving} className="px-3 py-1.5 text-sm font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-lg disabled:opacity-50 flex items-center gap-1.5">
            {saving && <Loader2 className="w-3.5 h-3.5 animate-spin" />} Save
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Main view ─────────────────────────────────────────────────────────────────
export default function ReimbursementsView() {
  const [rows, setRows]       = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState(null)
  const [year, setYear]       = useState('')
  const [status, setStatus]   = useState('')
  const [type, setType]       = useState('')
  const [busyIds, setBusyIds] = useState(new Set())
  const [editRow, setEditRow] = useState(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      setRows(await getAllReimbursements({ year, status, type }))
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }, [year, status, type])

  useEffect(() => { load() }, [load])

  // Distinct years for the filter, from whatever is loaded (plus current year).
  const years = useMemo(() => {
    const s = new Set(rows.map(r => r.year))
    s.add(new Date().getFullYear())
    return [...s].sort((a, b) => b - a)
  }, [rows])

  const totals = useMemo(() => {
    const t = { outstanding: 0, received: 0, count: rows.length }
    for (const r of rows) {
      if (r.recovery_method === 'landlord_bills' && r.status !== 'waived') t.outstanding += outstandingOf(r)
      t.received += r.received_amount || 0
    }
    return t
  }, [rows])

  async function act(id, fn) {
    setBusyIds(prev => new Set([...prev, id]))
    try { await fn(); await load() }
    catch (err) { alert('Error: ' + err.message) }
    finally { setBusyIds(prev => { const s = new Set(prev); s.delete(id); return s }) }
  }

  return (
    <div className="p-6 space-y-5">
      {/* Summary */}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
        <div className="bg-white rounded-xl border border-slate-200 p-4 flex items-center gap-4">
          <div className="w-10 h-10 rounded-lg flex items-center justify-center bg-amber-50 text-amber-600"><DollarSign className="w-5 h-5" /></div>
          <div><p className="text-xs text-slate-500 font-medium">Outstanding</p><p className="text-xl font-bold text-slate-900">{fmt(totals.outstanding)}</p><p className="text-xs text-slate-400 mt-0.5">owed by tenants</p></div>
        </div>
        <div className="bg-white rounded-xl border border-slate-200 p-4 flex items-center gap-4">
          <div className="w-10 h-10 rounded-lg flex items-center justify-center bg-green-50 text-green-600"><CheckCircle2 className="w-5 h-5" /></div>
          <div><p className="text-xs text-slate-500 font-medium">Received</p><p className="text-xl font-bold text-slate-900">{fmt(totals.received)}</p></div>
        </div>
        <div className="bg-white rounded-xl border border-slate-200 p-4 flex items-center gap-4">
          <div className="w-10 h-10 rounded-lg flex items-center justify-center bg-slate-100 text-slate-600"><Receipt className="w-5 h-5" /></div>
          <div><p className="text-xs text-slate-500 font-medium">Line items</p><p className="text-xl font-bold text-slate-900">{totals.count}</p></div>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2">
        <select value={year} onChange={e => setYear(e.target.value)} className="px-2.5 py-1.5 text-sm border border-slate-200 rounded-lg bg-white">
          <option value="">All years</option>
          {years.map(y => <option key={y} value={y}>{y}</option>)}
        </select>
        <select value={type} onChange={e => setType(e.target.value)} className="px-2.5 py-1.5 text-sm border border-slate-200 rounded-lg bg-white">
          <option value="">All types</option>
          <option value="tax">Real Estate Tax</option>
          <option value="insurance">Insurance</option>
          <option value="cam">CAM</option>
        </select>
        <select value={status} onChange={e => setStatus(e.target.value)} className="px-2.5 py-1.5 text-sm border border-slate-200 rounded-lg bg-white">
          <option value="">All statuses</option>
          <option value="not_billed">Not billed</option>
          <option value="billed">Billed</option>
          <option value="partial">Partial</option>
          <option value="received">Received</option>
          <option value="tenant_direct">Tenant-direct</option>
          <option value="waived">Waived</option>
        </select>
        <button onClick={load} className="ml-auto flex items-center gap-1.5 px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-100 rounded-lg">
          <RefreshCcw className="w-3.5 h-3.5" /> Refresh
        </button>
      </div>

      {/* Table */}
      {loading ? (
        <div className="flex items-center justify-center py-12"><Loader2 className="w-5 h-5 animate-spin text-slate-400" /></div>
      ) : error ? (
        <div className="flex items-center gap-2 text-sm text-red-600"><AlertTriangle className="w-4 h-4" /> {error}</div>
      ) : rows.length === 0 ? (
        <div className="bg-white border border-dashed border-slate-200 rounded-xl p-10 text-center">
          <Receipt className="w-8 h-8 text-slate-200 mx-auto mb-2" />
          <p className="text-sm text-slate-400">No reimbursements yet.</p>
          <p className="text-xs text-slate-400 mt-1">Mark a tax bill or insurance premium as paid to open one automatically.</p>
        </div>
      ) : (
        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-50 text-xs font-semibold text-slate-500 uppercase tracking-wide border-b border-slate-200">
                <th className="px-4 py-3 text-left">Property</th>
                <th className="px-4 py-3 text-left">Type</th>
                <th className="px-3 py-3 text-center">Year</th>
                <th className="px-4 py-3 text-right">Recoverable</th>
                <th className="px-4 py-3 text-right">Billed</th>
                <th className="px-4 py-3 text-right">Received</th>
                <th className="px-4 py-3 text-right">Outstanding</th>
                <th className="px-4 py-3 text-left">Status</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody>
              {rows.map(r => {
                const meta = STATUS_META[r.status] || STATUS_META.not_billed
                const busy = busyIds.has(r.id)
                const out  = outstandingOf(r)
                const done = r.status === 'received' || r.status === 'waived' || r.recovery_method === 'tenant_direct'
                return (
                  <tr key={r.id} className="border-t border-slate-100 hover:bg-slate-50/60">
                    <td className="px-4 py-3">
                      <Link to={`/management/${r.property_id}`} className="font-medium text-blue-700 hover:underline">{r.property_address}</Link>
                      <p className="text-xs text-slate-400 mt-0.5">
                        {[r.property_city, r.property_state].filter(Boolean).join(', ')}
                        {r.tenant_brand_name ? ` · ${r.tenant_brand_name}` : ''}
                      </p>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`text-xs px-1.5 py-0.5 rounded-full font-medium ${TYPE_COLORS[r.expense_type] || 'bg-slate-100 text-slate-600'}`}>
                        {TYPE_LABEL[r.expense_type] || r.expense_type}
                      </span>
                    </td>
                    <td className="px-3 py-3 text-center text-slate-600">{r.year}</td>
                    <td className="px-4 py-3 text-right text-slate-700">{fmt(r.recoverable_amount ?? r.expense_amount)}</td>
                    <td className="px-4 py-3 text-right text-slate-600">{r.billed_amount != null ? fmt(r.billed_amount) : '—'}</td>
                    <td className="px-4 py-3 text-right text-slate-600">{r.received_amount != null ? fmt(r.received_amount) : '—'}</td>
                    <td className={`px-4 py-3 text-right font-semibold ${out > 0 ? 'text-slate-900' : 'text-slate-300'}`}>{out > 0 ? fmt(out) : '—'}</td>
                    <td className="px-4 py-3"><span className={`text-xs px-2 py-0.5 rounded-full font-medium ${meta.cls}`}>{meta.label}</span></td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end gap-1">
                        {!done && r.status === 'not_billed' && (
                          <button onClick={() => act(r.id, () => billReimbursement(r.id))} disabled={busy}
                            className="flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-semibold bg-amber-50 text-amber-700 border border-amber-200 hover:bg-amber-100 disabled:opacity-50 whitespace-nowrap">
                            {busy ? <Loader2 className="w-3 h-3 animate-spin" /> : <FileText className="w-3 h-3" />} Bill
                          </button>
                        )}
                        {!done && (r.status === 'billed' || r.status === 'partial') && (
                          <button onClick={() => act(r.id, () => receiveReimbursement(r.id))} disabled={busy}
                            className="flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-semibold bg-green-50 text-green-700 border border-green-200 hover:bg-green-100 disabled:opacity-50 whitespace-nowrap">
                            {busy ? <Loader2 className="w-3 h-3 animate-spin" /> : <CheckCircle2 className="w-3 h-3" />} Received
                          </button>
                        )}
                        <button onClick={() => setEditRow(r)} className="p-1 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100" title="Edit"><Pencil className="w-3.5 h-3.5" /></button>
                        <button onClick={() => { if (confirm('Delete this reimbursement?')) act(r.id, () => deleteReimbursement(r.id)) }} className="p-1 rounded-lg text-slate-400 hover:text-red-600 hover:bg-red-50" title="Delete"><Trash2 className="w-3.5 h-3.5" /></button>
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {editRow && <EditModal row={editRow} onClose={() => setEditRow(null)} onSaved={() => { setEditRow(null); load() }} />}
    </div>
  )
}
