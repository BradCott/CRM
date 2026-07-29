// CAM tab: track property-work invoices that roll up into CAM actuals for the
// year, plus how the tenant reimburses CAM (monthly installments vs. one
// reimbursement per year — mirrors the Insurance/Reconciliation setup).
import { useState, useEffect, useCallback } from 'react'
import { Wrench, Loader2, Plus, Trash2, Paperclip, FileText } from 'lucide-react'
import {
  getCamInvoices, createCamInvoice, uploadCamInvoice, deleteCamInvoice, camInvoiceUrl, parseCamInvoice,
  getExpenseSettings, updateExpenseSetting,
} from '../../api/client'
import { Input, Textarea } from '../ui/Input'
import Button from '../ui/Button'
import DropZone from '../ui/DropZone'

const fmt$ = (n) => (n == null || n === '') ? '—' : '$' + Number(n).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 })
const fmtDate = (d) => d ? new Date(String(d).length === 10 ? d + 'T12:00:00' : d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—'
const EMPTY = { vendor: '', description: '', amount: '', invoice_date: '', paid_date: '', notes: '' }

export default function CamSection({ propertyId }) {
  const nowYear = new Date().getFullYear()
  const [year, setYear]         = useState(nowYear)
  const [loading, setLoading]   = useState(true)
  const [invoices, setInvoices] = useState([])
  const [total, setTotal]       = useState(0)
  const [method, setMethod]     = useState('direct')
  const [form, setForm]         = useState(EMPTY)
  const [file, setFile]         = useState(null)
  const [saving, setSaving]     = useState(false)
  const [parsing, setParsing]   = useState(false)
  const [parsed, setParsed]     = useState(false)
  const [error, setError]       = useState(null)
  const [busyId, setBusyId]     = useState(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [inv, settings] = await Promise.all([
        getCamInvoices(propertyId, { year }),
        getExpenseSettings(propertyId),
      ])
      setInvoices(inv.invoices || [])
      setTotal(inv.total || 0)
      const cam = (settings || []).find(s => s.expense_type === 'cam')
      setMethod(cam?.method === 'installments' ? 'installments' : 'direct')
    } catch (e) { setError(e.message) } finally { setLoading(false) }
  }, [propertyId, year])
  useEffect(() => { load() }, [load])

  async function setCamMethod(m) {
    setMethod(m)
    try { await updateExpenseSetting(propertyId, 'cam', { method: m }) }
    catch (e) { setError(e.message) }
  }

  // Drop/select a file → keep it attached AND read it with AI to prefill the
  // form. Only fills fields the user hasn't already typed into.
  async function onFile(f) {
    setError(null); setParsed(false)
    setFile(f)
    if (!f) return
    setParsing(true)
    try {
      const d = await parseCamInvoice(propertyId, f)
      setForm(prev => ({
        vendor:       prev.vendor       || d.vendor       || '',
        description:  prev.description  || d.description  || '',
        amount:       prev.amount       || d.amount       || '',
        invoice_date: prev.invoice_date || d.invoice_date || '',
        paid_date:    prev.paid_date    || d.paid_date    || '',
        notes:        prev.notes,
      }))
      setParsed(true)
    } catch (e) {
      // Parsing is best-effort; the file is still attached for manual entry.
      const noKey = /ANTHROPIC_API_KEY/i.test(e.message || '')
      setError(noKey
        ? 'Auto-read isn’t available here — your invoice is still attached, just enter the details manually.'
        : 'Couldn’t auto-read this invoice — your file is still attached, just enter the details manually.')
    } finally { setParsing(false) }
  }

  async function addInvoice() {
    if (form.amount === '' || form.amount == null) { setError('Enter an amount.'); return }
    setSaving(true); setError(null)
    try {
      if (file) await uploadCamInvoice(propertyId, file, form)
      else await createCamInvoice(propertyId, form)
      setForm(EMPTY); setFile(null); setParsed(false)
      await load()
    } catch (e) { setError(e.message) } finally { setSaving(false) }
  }

  async function del(id) {
    if (!window.confirm('Delete this invoice?')) return
    setBusyId(id)
    try { await deleteCamInvoice(id); await load() }
    catch (e) { setError(e.message) } finally { setBusyId(null) }
  }

  const years = Array.from({ length: 6 }, (_, i) => nowYear - i)

  return (
    <div className="space-y-5">
      {/* Header: year + reimbursement method + running total */}
      <div className="rounded-xl border border-slate-200 bg-white p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2 text-sm font-semibold text-slate-700">
            <Wrench className="w-4 h-4 text-orange-500" /> CAM — Common Area Maintenance
          </div>
          <select value={year} onChange={e => setYear(parseInt(e.target.value, 10))}
            className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm hover:border-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500">
            {years.map(y => <option key={y} value={y}>{y}</option>)}
          </select>
        </div>

        <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1.5">How the tenant reimburses CAM</p>
            <div className="inline-flex rounded-lg border border-slate-200 p-0.5">
              <button onClick={() => setCamMethod('installments')}
                className={`px-3 py-1.5 text-xs font-semibold rounded-md ${method === 'installments' ? 'bg-blue-600 text-white' : 'text-slate-600 hover:bg-slate-100'}`}>
                Monthly installments
              </button>
              <button onClick={() => setCamMethod('direct')}
                className={`px-3 py-1.5 text-xs font-semibold rounded-md ${method === 'direct' ? 'bg-blue-600 text-white' : 'text-slate-600 hover:bg-slate-100'}`}>
                One reimbursement / year
              </button>
            </div>
            <p className="text-[11px] text-slate-400 mt-1.5">
              {method === 'installments'
                ? 'Tenant pays monthly. The dashboard nets these invoices against what they’ve paid in so far.'
                : 'Tenant reimburses the full CAM total, typically once a year.'}
            </p>
          </div>
          <div className="rounded-xl border border-orange-200 bg-orange-50/50 p-3 flex flex-col justify-center">
            <p className="text-[11px] font-semibold text-orange-700 uppercase tracking-wide">{year} CAM invoices total</p>
            <p className="text-2xl font-bold text-orange-800 tabular-nums">{fmt$(total)}</p>
            <p className="text-[11px] text-orange-600">{invoices.length} invoice{invoices.length === 1 ? '' : 's'}</p>
          </div>
        </div>
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}

      {/* Add invoice */}
      <div className="rounded-xl border border-slate-200 bg-white p-4">
        <p className="text-sm font-semibold text-slate-700 mb-3 flex items-center gap-1.5"><Plus className="w-4 h-4" /> Add an invoice</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          <Input label="Vendor" value={form.vendor} onChange={e => setForm(f => ({ ...f, vendor: e.target.value }))} placeholder="e.g. ABC Landscaping" />
          <Input label="Amount ($)" type="number" value={form.amount} onChange={e => setForm(f => ({ ...f, amount: e.target.value }))} placeholder="0.00" />
          <Input label="Invoice date" type="date" value={form.invoice_date} onChange={e => setForm(f => ({ ...f, invoice_date: e.target.value }))} />
          <Input label="Description" value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} placeholder="e.g. Q2 lot sweeping" />
          <Input label="Paid date (optional)" type="date" value={form.paid_date} onChange={e => setForm(f => ({ ...f, paid_date: e.target.value }))} />
        </div>
        <div className="mt-3">
          <DropZone
            onFile={onFile}
            accept=".pdf,image/*"
            busy={parsing}
            label={parsing ? 'Reading invoice…' : file ? `Attached: ${file.name}` : 'Drop the invoice PDF/image — we’ll auto-read the details'}
            hint={parsing ? 'Extracting vendor, amount and date with AI' : 'Or click to browse. You can still edit anything it reads.'}
          />
          {parsed && !parsing && (
            <p className="text-[11px] text-emerald-600 mt-1.5">Auto-filled from the invoice — review the fields above before saving.</p>
          )}
        </div>
        <div className="mt-3 flex items-center gap-2">
          <Button onClick={addInvoice} disabled={saving || parsing}>
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />} Add invoice
          </Button>
          {file && <button onClick={() => { setFile(null); setParsed(false) }} className="text-xs text-slate-500 hover:text-slate-700">Clear file</button>}
        </div>
      </div>

      {/* Invoice list */}
      <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
        <div className="px-4 py-2 border-b border-slate-100 text-xs font-semibold text-slate-500 uppercase tracking-wide">{year} invoices</div>
        {loading ? (
          <div className="flex items-center justify-center py-12"><Loader2 className="w-5 h-5 text-slate-400 animate-spin" /></div>
        ) : invoices.length ? (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-[11px] uppercase tracking-wide text-slate-400 border-b border-slate-100">
                <th className="px-4 py-2 font-semibold">Date</th>
                <th className="px-4 py-2 font-semibold">Vendor</th>
                <th className="px-4 py-2 font-semibold">Description</th>
                <th className="px-4 py-2 font-semibold text-right">Amount</th>
                <th className="px-4 py-2 font-semibold text-center">File</th>
                <th className="px-4 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {invoices.map(inv => (
                <tr key={inv.id} className="border-b border-slate-50 last:border-0 hover:bg-slate-50/60">
                  <td className="px-4 py-2 text-slate-600 whitespace-nowrap">{fmtDate(inv.invoice_date)}</td>
                  <td className="px-4 py-2 text-slate-800 font-medium">{inv.vendor || '—'}</td>
                  <td className="px-4 py-2 text-slate-600">{inv.description || '—'}</td>
                  <td className="px-4 py-2 text-right tabular-nums text-slate-800">{fmt$(inv.amount)}</td>
                  <td className="px-4 py-2 text-center">
                    {inv.file_name ? (
                      <a href={camInvoiceUrl(inv.id)} target="_blank" rel="noreferrer" title={inv.file_name} className="inline-flex text-blue-600 hover:text-blue-700">
                        <Paperclip className="w-4 h-4" />
                      </a>
                    ) : <span className="text-slate-300"><FileText className="w-4 h-4 inline" /></span>}
                  </td>
                  <td className="px-4 py-2 text-right">
                    <button onClick={() => del(inv.id)} disabled={busyId === inv.id} className="text-slate-300 hover:text-red-500">
                      {busyId === inv.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t border-slate-200 bg-slate-50">
                <td colSpan={3} className="px-4 py-2 text-right text-xs font-semibold text-slate-500 uppercase tracking-wide">Total</td>
                <td className="px-4 py-2 text-right font-bold tabular-nums text-slate-800">{fmt$(total)}</td>
                <td colSpan={2}></td>
              </tr>
            </tfoot>
          </table>
        ) : (
          <p className="text-sm text-slate-400 px-4 py-8 text-center">No CAM invoices for {year} yet. Add your first above.</p>
        )}
      </div>
    </div>
  )
}
