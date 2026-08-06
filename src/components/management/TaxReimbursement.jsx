// Tax record: installment payments (1st half / 2nd half) + document vault +
// "email tenant for reimbursement" with the tax bill & proof of payment attached.
// Mirrors InsuranceReimbursement; the installments act like the premium line
// items — pick which to request and the amount + email note update.
import { useState, useEffect, useCallback } from 'react'
import { FileText, Download, Trash2, Loader2, Mail, X, Check, AlertCircle, Send, Plus, Coins } from 'lucide-react'
import DropZone from '../ui/DropZone'
import { ContactPicker } from './InsuranceReimbursement'
import {
  getTaxDocuments, uploadTaxDoc, taxDocUrl, deleteTaxDoc,
  prepareTaxReimbursement, sendTaxReimbursement,
  getTaxInstallments, addTaxInstallment, deleteTaxInstallment,
} from '../../api/client'

const parseAmt = (s) => { const n = parseFloat(String(s ?? '').replace(/[^0-9.\-]/g, '')); return isNaN(n) ? 0 : n }
const money = (n) => (n == null ? 'the property taxes' : '$' + Math.round(Number(n)).toLocaleString())
const fmtDate = (d) => d ? new Date(String(d).length === 10 ? d + 'T12:00:00' : d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : ''

// "the 1st half and 2nd half of the 2025 real estate taxes"
function describeWhat(labels, year) {
  const yr = year ? year + ' ' : ''
  if (labels && labels.length) return `the ${labels.join(' and ')} of the ${yr}real estate taxes`
  return `the ${yr}real estate taxes`
}
const reimbBody = (amountStr, loc, year, labels) =>
`Hello,

Per your lease, we've paid ${describeWhat(labels, year)} for ${loc || 'the property'} and are requesting reimbursement of ${amountStr}.

Attached are the tax bill and our proof of payment for your records. Please remit reimbursement at your earliest convenience, and let us know if you need anything further.

Thank you,
Knox Capital`

const DOC_TYPES = ['Tax Bill', 'Proof of Payment', 'Other']
const TINT = {
  'Tax Bill': 'bg-blue-50 text-blue-700',
  'Proof of Payment': 'bg-emerald-50 text-emerald-700',
  Other: 'bg-slate-100 text-slate-600',
}

export default function TaxReimbursement({ tax, onChange }) {
  const taxId = tax.id
  const [docs, setDocs]         = useState([])
  const [insts, setInsts]       = useState([])
  const [docType, setDocType]   = useState('Proof of Payment')
  const [uploading, setUp]      = useState(false)
  const [showEmail, setShowEmail] = useState(false)
  // add-installment row
  const [iLabel, setILabel] = useState('1st Half')
  const [iAmount, setIAmount] = useState('')
  const [iDate, setIDate] = useState('')
  const [addingInst, setAddingInst] = useState(false)

  const load = useCallback(async () => {
    try { setDocs(await getTaxDocuments(taxId)) } catch (_) {}
    try { setInsts(await getTaxInstallments(taxId)) } catch (_) {}
  }, [taxId])
  useEffect(() => { load() }, [load])

  async function onFile(file) {
    if (!file) return
    setUp(true)
    try { await uploadTaxDoc(taxId, file, docType); await load() } catch (e) { alert(e.message) } finally { setUp(false) }
  }
  async function onDelete(id) {
    if (!window.confirm('Remove this document?')) return
    try { await deleteTaxDoc(taxId, id); await load() } catch (e) { alert(e.message) }
  }
  async function addInst() {
    if (!iAmount.trim()) return
    setAddingInst(true)
    try {
      await addTaxInstallment(taxId, { label: iLabel.trim() || null, amount: parseAmt(iAmount), paid_date: iDate || null })
      setIAmount(''); setIDate('')
      setILabel(iLabel === '1st Half' ? '2nd Half' : iLabel)
      await load(); onChange?.()
    } catch (e) { alert(e.message) } finally { setAddingInst(false) }
  }
  async function delInst(id) {
    try { await deleteTaxInstallment(id); await load(); onChange?.() } catch (e) { alert(e.message) }
  }

  const paidTotal = insts.reduce((s, i) => s + (Number(i.amount) || 0), 0)

  return (
    <div className="mt-4 pt-3 border-t border-slate-100">
      {/* Installment payments */}
      <div className="mb-3">
        <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-wide mb-1.5 flex items-center gap-1.5"><Coins className="w-3.5 h-3.5" /> Payments</p>
        {insts.length > 0 && (
          <ul className="space-y-1 mb-2">
            {insts.map(i => (
              <li key={i.id} className="flex items-center gap-2 text-sm">
                <span className="font-medium text-slate-700">{i.label || 'Payment'}</span>
                <span className="tabular-nums text-slate-800">{money(i.amount)}</span>
                {i.paid_date && <span className="text-xs text-slate-400">· {fmtDate(i.paid_date)}</span>}
                <button onClick={() => delInst(i.id)} className="ml-auto text-slate-300 hover:text-red-500 shrink-0"><Trash2 className="w-3.5 h-3.5" /></button>
              </li>
            ))}
            <li className="text-xs text-slate-500 pt-1 border-t border-slate-100">Total paid: <span className="font-semibold tabular-nums">{money(paidTotal)}</span>{tax.amount ? ` of ${money(tax.amount)} billed` : ''}</li>
          </ul>
        )}
        <div className="flex flex-wrap items-center gap-1.5">
          <select value={iLabel} onChange={e => setILabel(e.target.value)} className="text-xs border border-slate-200 rounded-lg px-2 py-1.5 bg-white">
            {['1st Half', '2nd Half', 'Full Payment', 'Supplemental'].map(l => <option key={l}>{l}</option>)}
          </select>
          <div className="relative">
            <span className="absolute left-2 top-1/2 -translate-y-1/2 text-xs text-slate-400">$</span>
            <input value={iAmount} onChange={e => setIAmount(e.target.value)} placeholder="amount" className="w-24 text-xs border border-slate-200 rounded-lg pl-5 pr-2 py-1.5" />
          </div>
          <input type="date" value={iDate} onChange={e => setIDate(e.target.value)} className="text-xs border border-slate-200 rounded-lg px-2 py-1.5" />
          <button onClick={addInst} disabled={addingInst || !iAmount.trim()}
            className="inline-flex items-center gap-1 text-xs font-semibold px-2.5 py-1.5 rounded-lg bg-slate-800 text-white hover:bg-slate-900 disabled:opacity-50">
            {addingInst ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />} Log payment
          </button>
        </div>
        <p className="text-[11px] text-slate-400 mt-1">Log each installment (e.g. 1st half, 2nd half) as you pay it. This keeps the "paid" amount accurate and lets you request reimbursement per installment.</p>
      </div>

      {/* Documents & reimbursement */}
      <div className="flex items-center justify-between gap-2 mb-2 flex-wrap">
        <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-wide">Documents &amp; Reimbursement</p>
        <button onClick={() => setShowEmail(true)}
          className="inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1.5 rounded-lg bg-blue-600 text-white hover:bg-blue-700">
          <Mail className="w-3.5 h-3.5" /> Email tenant for reimbursement
        </button>
      </div>

      {docs.length > 0 && (
        <ul className="space-y-1 mb-2">
          {docs.map(d => (
            <li key={d.id} className="flex items-center gap-2">
              <FileText className="w-4 h-4 text-slate-400 shrink-0" />
              <span className="text-sm text-slate-700 truncate flex-1">{d.file_name}</span>
              <span className={`text-[10px] font-semibold uppercase px-1.5 py-0.5 rounded-full shrink-0 ${TINT[d.doc_type] || TINT.Other}`}>{d.doc_type}</span>
              <a href={taxDocUrl(taxId, d.id)} target="_blank" rel="noreferrer" className="text-blue-600 hover:text-blue-800 shrink-0"><Download className="w-3.5 h-3.5" /></a>
              <button onClick={() => onDelete(d.id)} className="text-slate-300 hover:text-red-500 shrink-0"><Trash2 className="w-3.5 h-3.5" /></button>
            </li>
          ))}
        </ul>
      )}

      <div className="flex items-center gap-2">
        <select value={docType} onChange={e => setDocType(e.target.value)} className="text-xs border border-slate-200 rounded-lg px-2 py-1.5 bg-white shrink-0">
          {DOC_TYPES.map(t => <option key={t}>{t}</option>)}
        </select>
        <DropZone onFile={onFile} busy={uploading} label={`Drop ${docType.toLowerCase()} or click`} className="flex-1" />
      </div>

      {showEmail && <ReimbursementModal taxId={taxId} onClose={() => setShowEmail(false)} onSent={load} />}
    </div>
  )
}

function ReimbursementModal({ taxId, onClose, onSent }) {
  const [data, setData]       = useState(null)
  const [loading, setLoading] = useState(true)
  const [to, setTo]           = useState('')
  const [cc, setCc]           = useState('')
  const [subject, setSubject] = useState('')
  const [amount, setAmount]   = useState('')      // used only when there are no installments
  const [insts, setInsts]     = useState([])      // [{ id, label, amount, paid_date, selected }]
  const [body, setBody]       = useState('')
  const [bodyEdited, setBodyEdited] = useState(false)
  const [selected, setSel]    = useState(() => new Set())
  const [docs, setDocs]       = useState([])
  const [uploadType, setUploadType]     = useState('Proof of Payment')
  const [uploadingDoc, setUploadingDoc] = useState(false)
  const [sending, setSending] = useState(false)
  const [error, setError]     = useState(null)
  const [sent, setSent]       = useState(null)

  useEffect(() => {
    prepareTaxReimbursement(taxId)
      .then(d => {
        setData(d)
        setSubject(d.subject || '')
        setTo(d.contacts?.[0]?.email || '')
        setDocs(d.documents || [])
        setSel(new Set((d.documents || []).map(x => x.id)))
        setInsts((d.installments || []).map(i => ({ ...i, selected: true })))
        if (!(d.installments || []).length) setAmount(d.amount != null ? String(Math.round(Number(d.amount))) : '')
      })
      .catch(e => setError(e.message))
      .finally(() => setLoading(false))
  }, [taxId])

  const hasInsts = insts.length > 0
  const selectedLabels = insts.filter(i => i.selected).map(i => (i.label || 'payment').toLowerCase())
  const selectedAmount = hasInsts
    ? insts.filter(i => i.selected).reduce((s, i) => s + (Number(i.amount) || 0), 0)
    : (amount === '' ? null : parseAmt(amount))

  // Keep the message amount + installment wording in sync unless hand-edited.
  useEffect(() => {
    if (!data || bodyEdited) return
    setBody(reimbBody(money(selectedAmount), data.loc, data.tax_year, hasInsts ? selectedLabels : null))
  }, [selectedAmount, data, bodyEdited, hasInsts, selectedLabels.join('|')])

  const toggleDoc  = (id)  => setSel(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n })
  const toggleInst = (id)  => setInsts(prev => prev.map(i => i.id === id ? { ...i, selected: !i.selected } : i))

  async function onUploadDoc(file) {
    if (!file) return
    setUploadingDoc(true)
    try {
      await uploadTaxDoc(taxId, file, uploadType)
      const fresh = await getTaxDocuments(taxId)
      setDocs(fresh)
      setSel(new Set(fresh.map(d => d.id)))
    } catch (e) { alert(e.message) } finally { setUploadingDoc(false) }
  }

  async function send() {
    setSending(true); setError(null)
    try {
      const r = await sendTaxReimbursement(taxId, {
        to: to.split(',').map(s => s.trim()).filter(Boolean),
        cc: cc.trim() || undefined, subject, body, documentIds: [...selected],
      })
      setSent(r); onSent?.()
    } catch (e) { setError(e.message) } finally { setSending(false) }
  }

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/40 p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
          <div className="flex items-center gap-2"><Mail className="w-5 h-5 text-blue-600" /><h2 className="text-base font-bold text-slate-900">Tenant Tax Reimbursement</h2></div>
          <button onClick={onClose} className="w-8 h-8 rounded-lg flex items-center justify-center text-slate-400 hover:bg-slate-100"><X className="w-4 h-4" /></button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-4">
          {loading ? (
            <div className="flex items-center justify-center py-14 gap-2 text-slate-400"><Loader2 className="w-5 h-5 animate-spin" /> Preparing…</div>
          ) : sent ? (
            <div className="flex flex-col items-center justify-center py-12 text-center gap-2">
              <div className="w-12 h-12 rounded-2xl bg-emerald-50 flex items-center justify-center"><Check className="w-6 h-6 text-emerald-600" /></div>
              <p className="text-base font-semibold text-slate-900">Sent to {sent.sent_to.join(', ')}</p>
              <p className="text-sm text-slate-500">{sent.attachments} document{sent.attachments === 1 ? '' : 's'} attached · logged on the property.</p>
            </div>
          ) : data ? (
            <>
              <div>
                <label className="block text-xs font-semibold text-slate-600 uppercase tracking-wide mb-1">To</label>
                <input value={to} onChange={e => setTo(e.target.value)} placeholder="tenant@example.com" className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500" />
                <ContactPicker contacts={data.contacts} to={to} setTo={setTo} />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-600 uppercase tracking-wide mb-1">Cc <span className="normal-case text-slate-400">(optional)</span></label>
                <input value={cc} onChange={e => setCc(e.target.value)} className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-600 uppercase tracking-wide mb-1">Subject</label>
                <input value={subject} onChange={e => setSubject(e.target.value)} className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </div>

              {hasInsts ? (
                <div>
                  <label className="block text-xs font-semibold text-slate-600 uppercase tracking-wide mb-1.5">Which payments to request</label>
                  <div className="rounded-xl border border-slate-200 divide-y divide-slate-100">
                    {insts.map(i => (
                      <label key={i.id} className="flex items-center gap-2.5 px-3 py-2 hover:bg-slate-50 cursor-pointer">
                        <input type="checkbox" checked={i.selected} onChange={() => toggleInst(i.id)} className="w-4 h-4 accent-blue-600 shrink-0" />
                        <span className="text-sm font-medium text-slate-700 flex-1">{i.label || 'Payment'}{i.paid_date ? ` · ${fmtDate(i.paid_date)}` : ''}</span>
                        <span className="text-sm tabular-nums text-slate-800">{money(i.amount)}</span>
                      </label>
                    ))}
                    <div className="flex items-center justify-end px-3 py-2 bg-slate-50">
                      <span className="text-sm font-semibold text-blue-700 tabular-nums">Requesting {money(selectedAmount)}</span>
                    </div>
                  </div>
                  <p className="text-[11px] text-slate-400 mt-1">Uncheck an installment to request just one half. The message updates automatically.</p>
                </div>
              ) : (
                <div>
                  <label className="block text-xs font-semibold text-slate-600 uppercase tracking-wide mb-1">Reimbursement amount</label>
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-slate-400">$</span>
                    <input value={amount} onChange={e => setAmount(e.target.value)} placeholder="0"
                      className="w-full pl-6 pr-3 py-2 text-sm border border-slate-200 rounded-lg tabular-nums focus:outline-none focus:ring-2 focus:ring-blue-500" />
                  </div>
                  <p className="text-[11px] text-slate-400 mt-1">Defaults to the tax paid. If it's paid in installments, log them on the record and they'll appear here to pick from.</p>
                </div>
              )}

              <div>
                <label className="block text-xs font-semibold text-slate-600 uppercase tracking-wide mb-1">Message</label>
                <textarea value={body} onChange={e => { setBody(e.target.value); setBodyEdited(true) }} rows={9} className="w-full px-3 py-2.5 text-sm border border-slate-200 rounded-xl resize-y focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-600 uppercase tracking-wide mb-1.5">Attachments</label>
                {docs.length > 0 && (
                  <div className="rounded-xl border border-slate-200 divide-y divide-slate-100 mb-2">
                    {docs.map(d => (
                      <label key={d.id} className="flex items-center gap-2.5 px-3 py-2 hover:bg-slate-50 cursor-pointer">
                        <input type="checkbox" checked={selected.has(d.id)} onChange={() => toggleDoc(d.id)} className="w-4 h-4 accent-blue-600 shrink-0" />
                        <FileText className="w-4 h-4 text-slate-400 shrink-0" />
                        <span className="text-sm text-slate-700 truncate flex-1">{d.file_name}</span>
                        <span className={`text-[10px] font-semibold uppercase px-1.5 py-0.5 rounded-full shrink-0 ${TINT[d.doc_type] || TINT.Other}`}>{d.doc_type}</span>
                      </label>
                    ))}
                  </div>
                )}
                <div className="flex items-center gap-2">
                  <select value={uploadType} onChange={e => setUploadType(e.target.value)} className="text-xs border border-slate-200 rounded-lg px-2 py-1.5 bg-white shrink-0">
                    {DOC_TYPES.map(t => <option key={t}>{t}</option>)}
                  </select>
                  <DropZone onFile={onUploadDoc} busy={uploadingDoc} label={`Drop ${uploadType.toLowerCase()} or click`} className="flex-1" />
                </div>
                <p className="text-[11px] text-slate-400 mt-1">Missing the tax bill or receipt? Drop it here — it attaches to the email and saves on the record.</p>
              </div>
              {error && <div className="flex items-start gap-2 text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2"><AlertCircle className="w-4 h-4 mt-0.5 shrink-0" /> {error}</div>}
            </>
          ) : error ? (
            <div className="flex items-start gap-2 text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2"><AlertCircle className="w-4 h-4 mt-0.5 shrink-0" /> {error}</div>
          ) : null}
        </div>

        <div className="flex items-center justify-between px-6 py-4 border-t border-slate-100">
          <button onClick={onClose} className="text-sm text-slate-500 hover:text-slate-700">{sent ? 'Close' : 'Cancel'}</button>
          {data && !sent && (
            <button onClick={send} disabled={sending || !to.trim() || !subject.trim() || !body.trim()}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 disabled:opacity-50">
              {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />} Review &amp; Send{selected.size > 0 ? ` (${selected.size})` : ''}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
