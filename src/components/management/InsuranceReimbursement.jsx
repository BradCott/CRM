// Insurance record: document vault (policy / invoice / proof of payment) +
// "email tenant for reimbursement" flow with those docs attached.
import { useState, useEffect, useCallback } from 'react'
import { FileText, Download, Trash2, Loader2, Mail, X, Check, AlertCircle, Send, Sparkles } from 'lucide-react'
import DropZone from '../ui/DropZone'

const parseAmt = (s) => { const n = parseFloat(String(s ?? '').replace(/[^0-9.\-]/g, '')); return isNaN(n) ? 0 : n }
const money = (n) => (n == null ? 'the insurance premium' : '$' + Math.round(n).toLocaleString())
const reimbBody = (amountStr, loc) =>
`Hello,

Per your lease, we've paid the property insurance premium for ${loc || 'the property'} and are requesting reimbursement of ${amountStr}.

Attached are the insurance policy, the invoice, and our proof of payment for your records. Please remit reimbursement at your earliest convenience, and let us know if you need anything further.

Thank you,
Knox Capital`
import {
  getInsuranceDocuments, uploadInsuranceDoc, insuranceDocUrl, deleteInsuranceDoc,
  prepareInsReimbursement, sendInsReimbursement, extractInsBreakdown,
} from '../../api/client'

const DOC_TYPES = ['Policy', 'Invoice', 'Proof of Payment', 'Other']
const TINT = {
  Policy: 'bg-blue-50 text-blue-700', Invoice: 'bg-violet-50 text-violet-700',
  'Proof of Payment': 'bg-emerald-50 text-emerald-700', Other: 'bg-slate-100 text-slate-600',
}

export default function InsuranceReimbursement({ policy }) {
  const insId = policy.id
  const [docs, setDocs]         = useState([])
  const [docType, setDocType]   = useState('Proof of Payment')
  const [uploading, setUp]      = useState(false)
  const [showEmail, setShowEmail] = useState(false)

  const load = useCallback(async () => { try { setDocs(await getInsuranceDocuments(insId)) } catch (_) {} }, [insId])
  useEffect(() => { load() }, [load])

  async function onFile(file) {
    if (!file) return
    setUp(true)
    try { await uploadInsuranceDoc(insId, file, docType); await load() } catch (e) { alert(e.message) } finally { setUp(false) }
  }
  async function onDelete(id) {
    if (!window.confirm('Remove this document?')) return
    try { await deleteInsuranceDoc(insId, id); await load() } catch (e) { alert(e.message) }
  }

  return (
    <div className="mt-4 pt-3 border-t border-slate-100">
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
              <a href={insuranceDocUrl(insId, d.id)} target="_blank" rel="noreferrer" className="text-blue-600 hover:text-blue-800 shrink-0"><Download className="w-3.5 h-3.5" /></a>
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

      {showEmail && <ReimbursementModal insId={insId} onClose={() => setShowEmail(false)} onSent={load} />}
    </div>
  )
}

function ReimbursementModal({ insId, onClose, onSent }) {
  const [data, setData]       = useState(null)
  const [loading, setLoading] = useState(true)
  const [to, setTo]           = useState('')
  const [cc, setCc]           = useState('')
  const [subject, setSubject] = useState('')
  const [body, setBody]       = useState('')
  const [bodyEdited, setBodyEdited] = useState(false)
  const [selected, setSel]    = useState(() => new Set())   // attached doc ids
  const [docs, setDocs]       = useState([])
  const [items, setItems]     = useState([])                // premium breakdown [{label, amount, value, selected}]
  const [uploadType, setUploadType]     = useState('Invoice')
  const [uploadingDoc, setUploadingDoc] = useState(false)
  const [extracting, setExtracting]     = useState(false)
  const [sending, setSending] = useState(false)
  const [error, setError]     = useState(null)
  const [sent, setSent]       = useState(null)

  useEffect(() => {
    prepareInsReimbursement(insId)
      .then(d => {
        setData(d)
        setSubject(d.subject || '')
        setTo(d.contacts?.[0]?.email || '')
        setDocs(d.documents || [])
        setSel(new Set((d.documents || []).map(x => x.id)))
        const its = (d.premium_items || []).map(i => ({ label: i.label, amount: i.amount, value: parseAmt(i.amount), selected: true }))
        setItems(its)
        const init = its.length ? its.reduce((s, i) => s + i.value, 0) : (d.premium ?? null)
        setBody(reimbBody(money(init), d.loc))
      })
      .catch(e => setError(e.message))
      .finally(() => setLoading(false))
  }, [insId])

  const hasBreakdown   = items.length > 0
  const selectedAmount = hasBreakdown ? items.filter(i => i.selected).reduce((s, i) => s + i.value, 0) : (data?.premium ?? null)

  // Keep the amount in the message in sync with the breakdown, unless edited.
  useEffect(() => {
    if (!data || bodyEdited) return
    setBody(reimbBody(money(selectedAmount), data.loc))
  }, [selectedAmount, data, bodyEdited])

  const toggleDoc  = (id)  => setSel(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n })
  const toggleItem = (idx) => setItems(prev => prev.map((it, i) => i === idx ? { ...it, selected: !it.selected } : it))

  async function extractBreakdown() {
    setExtracting(true)
    try {
      const r = await extractInsBreakdown(insId)
      setItems((r.premium_items || []).map(i => ({ label: i.label, amount: i.amount, value: parseAmt(i.amount), selected: true })))
    } catch (e) { alert(e.message) } finally { setExtracting(false) }
  }

  async function onUploadDoc(file) {
    if (!file) return
    setUploadingDoc(true)
    try {
      await uploadInsuranceDoc(insId, file, uploadType)
      const fresh = await getInsuranceDocuments(insId)
      setDocs(fresh)
      setSel(new Set(fresh.map(d => d.id)))
    } catch (e) { alert(e.message) } finally { setUploadingDoc(false) }
  }

  async function send() {
    setSending(true); setError(null)
    try {
      const r = await sendInsReimbursement(insId, {
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
          <div className="flex items-center gap-2"><Mail className="w-5 h-5 text-blue-600" /><h2 className="text-base font-bold text-slate-900">Tenant Reimbursement</h2></div>
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
                {data.contacts?.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 mt-1.5">
                    {data.contacts.map(c => (
                      <button key={c.id} onClick={() => setTo(c.email)} className="text-xs px-2 py-0.5 rounded-full bg-slate-100 text-slate-600 hover:bg-blue-100 hover:text-blue-700">{c.name}{c.title ? ` · ${c.title}` : ''}</button>
                    ))}
                  </div>
                )}
                {!data.contacts?.length && <p className="text-xs text-amber-600 mt-1">No tenant contact on file for this brand — enter an email above.</p>}
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-600 uppercase tracking-wide mb-1">Cc <span className="normal-case text-slate-400">(optional)</span></label>
                <input value={cc} onChange={e => setCc(e.target.value)} className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-600 uppercase tracking-wide mb-1">Subject</label>
                <input value={subject} onChange={e => setSubject(e.target.value)} className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </div>
              {/* No breakdown yet — pull the property/liability split from the invoice */}
              {!hasBreakdown && (
                <div className="rounded-xl border border-slate-200 bg-slate-50/60 px-3 py-2.5 flex items-center justify-between gap-2">
                  <span className="text-xs text-slate-500">To exclude liability, pull the premium split from the invoice/policy.</span>
                  <button onClick={extractBreakdown} disabled={extracting}
                    className="inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1.5 rounded-lg border border-slate-200 text-slate-600 hover:bg-white disabled:opacity-50 shrink-0">
                    {extracting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />} Extract split
                  </button>
                </div>
              )}

              {/* Reimbursement amount — exclude charges the tenant doesn't cover */}
              {hasBreakdown && (
                <div>
                  <label className="block text-xs font-semibold text-slate-600 uppercase tracking-wide mb-1.5">Reimbursement amount</label>
                  <div className="rounded-xl border border-slate-200 divide-y divide-slate-100">
                    {items.map((it, i) => (
                      <label key={i} className="flex items-center gap-2.5 px-3 py-2 hover:bg-slate-50 cursor-pointer">
                        <input type="checkbox" checked={it.selected} onChange={() => toggleItem(i)} className="w-4 h-4 accent-blue-600 shrink-0" />
                        <span className="text-sm text-slate-700 flex-1 truncate">{it.label || '—'}</span>
                        <span className="text-sm text-slate-500 tabular-nums shrink-0">{it.amount}</span>
                      </label>
                    ))}
                    <div className="flex items-center justify-between px-3 py-2 bg-slate-50">
                      <span className="text-sm font-semibold text-slate-700">Requesting</span>
                      <span className="text-sm font-semibold text-blue-700 tabular-nums">{money(selectedAmount)}</span>
                    </div>
                  </div>
                  <p className="text-[11px] text-slate-400 mt-1">Uncheck charges the tenant doesn't reimburse (e.g. liability — property only). The amount in the message updates automatically.</p>
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
                <p className="text-[11px] text-slate-400 mt-1">Missing the policy or invoice? Drop it here — it attaches to the email and saves on the record.</p>
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
