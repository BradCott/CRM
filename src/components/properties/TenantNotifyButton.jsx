// "Notify tenant of new ownership" — drafts an email to the property's tenant
// letting them know Knox is the new landlord, with the Deed / notice letter /
// Assignment of Lease / W-9 pulled straight from the property's Drive folder.
// Always review-then-send: nothing leaves until the user clicks Send.
import { useState } from 'react'
import { Mail, X, Loader2, Check, Paperclip, AlertCircle, FileText, Send } from 'lucide-react'
import { prepareTenantNotify, sendTenantNotify } from '../../api/client'
import { ContactPicker } from '../management/InsuranceReimbursement'
import Button from '../ui/Button'

const DOC_ORDER = ['Deed', 'Tenant Notice Letter', 'Assignment of Lease', 'W-9']

export default function TenantNotifyButton({ propertyId, className = '' }) {
  const [open, setOpen]       = useState(false)
  const [loading, setLoading] = useState(false)
  const [data, setData]       = useState(null)      // prepare result
  const [to, setTo]           = useState('')
  const [cc, setCc]           = useState('')
  const [subject, setSubject] = useState('')
  const [body, setBody]       = useState('')
  const [selected, setSelected] = useState(() => new Set())
  const [sending, setSending] = useState(false)
  const [error, setError]     = useState(null)
  const [sent, setSent]       = useState(null)

  async function openModal() {
    setOpen(true); setLoading(true); setError(null); setSent(null)
    try {
      const d = await prepareTenantNotify(propertyId)
      setData(d)
      setSubject(d.draft?.subject || '')
      setBody(d.draft?.body || '')
      setTo(d.contacts?.[0]?.email || '')
      setSelected(new Set((d.files || []).filter(f => f.suggested).map(f => f.id)))
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  function close() {
    setOpen(false); setData(null); setError(null); setSent(null)
    setTo(''); setCc(''); setSubject(''); setBody(''); setSelected(new Set())
  }

  const toggleFile = (id) => setSelected(prev => {
    const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n
  })

  async function handleSend() {
    setSending(true); setError(null)
    try {
      const res = await sendTenantNotify(propertyId, {
        to:           to.split(',').map(s => s.trim()).filter(Boolean),
        cc:           cc.trim() || undefined,
        subject, body,
        driveFileIds: [...selected],
      })
      setSent(res)
    } catch (e) {
      setError(e.message)
    } finally {
      setSending(false)
    }
  }

  // Files sorted: suggested/target docs first (in canonical order), then the rest.
  const files = [...(data?.files || [])].sort((a, b) => {
    const ai = a.docType ? DOC_ORDER.indexOf(a.docType) : 99
    const bi = b.docType ? DOC_ORDER.indexOf(b.docType) : 99
    return (a.suggested === b.suggested ? 0 : a.suggested ? -1 : 1) || ai - bi
  })

  return (
    <>
      <button
        onClick={openModal}
        className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-lg border border-blue-200 bg-blue-50 text-blue-700 hover:bg-blue-100 transition-colors ${className}`}
        title="Email the tenant that Knox is the new landlord, with the closing docs attached"
      >
        <Mail className="w-4 h-4" /> Notify tenant of new ownership
      </button>

      {open && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/40 p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col">
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
              <div className="flex items-center gap-2">
                <Mail className="w-5 h-5 text-blue-600" />
                <h2 className="text-base font-bold text-slate-900">Notify Tenant — New Ownership</h2>
              </div>
              <button onClick={close} className="w-8 h-8 rounded-lg flex items-center justify-center text-slate-400 hover:bg-slate-100">
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Body */}
            <div className="flex-1 overflow-y-auto px-6 py-5 space-y-4">
              {loading ? (
                <div className="flex items-center justify-center py-16 gap-2 text-slate-400">
                  <Loader2 className="w-5 h-5 animate-spin" /> Drafting email &amp; finding documents…
                </div>
              ) : sent ? (
                <div className="flex flex-col items-center justify-center py-12 text-center gap-2">
                  <div className="w-12 h-12 rounded-2xl bg-emerald-50 flex items-center justify-center">
                    <Check className="w-6 h-6 text-emerald-600" />
                  </div>
                  <p className="text-base font-semibold text-slate-900">Sent to {sent.sent_to.join(', ')}</p>
                  <p className="text-sm text-slate-500">{sent.attachments} document{sent.attachments === 1 ? '' : 's'} attached · logged on the property.</p>
                </div>
              ) : data ? (
                <>
                  {/* Recipient */}
                  <div>
                    <label className="block text-xs font-semibold text-slate-600 uppercase tracking-wide mb-1">To</label>
                    <input value={to} onChange={e => setTo(e.target.value)} placeholder="tenant@example.com"
                      className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500" />
                    <ContactPicker contacts={data.contacts} to={to} setTo={setTo} />
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-600 uppercase tracking-wide mb-1">Cc <span className="normal-case text-slate-400">(optional)</span></label>
                    <input value={cc} onChange={e => setCc(e.target.value)}
                      className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500" />
                  </div>

                  {/* Subject */}
                  <div>
                    <label className="block text-xs font-semibold text-slate-600 uppercase tracking-wide mb-1">Subject</label>
                    <input value={subject} onChange={e => setSubject(e.target.value)}
                      className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500" />
                  </div>

                  {/* Body */}
                  <div>
                    <label className="block text-xs font-semibold text-slate-600 uppercase tracking-wide mb-1">Message <span className="normal-case text-slate-400">(AI draft — edit freely)</span></label>
                    <textarea value={body} onChange={e => setBody(e.target.value)} rows={10}
                      className="w-full px-3 py-2.5 text-sm border border-slate-200 rounded-xl resize-y focus:outline-none focus:ring-2 focus:ring-blue-500" />
                  </div>

                  {/* Attachments */}
                  <div>
                    <label className="block text-xs font-semibold text-slate-600 uppercase tracking-wide mb-1.5 flex items-center gap-1">
                      <Paperclip className="w-3.5 h-3.5" /> Attachments from Drive
                      {selected.size > 0 && <span className="normal-case text-blue-600 font-normal">({selected.size} selected)</span>}
                    </label>
                    {!data.drive?.connected ? (
                      <div className="flex items-start gap-2 text-xs text-amber-700 bg-amber-50 border border-amber-100 rounded-lg px-3 py-2">
                        <AlertCircle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                        Google Drive isn't connected, so no documents can be attached automatically. You can still send the email.
                      </div>
                    ) : files.length === 0 ? (
                      <p className="text-xs text-slate-400">No files found in this property's Drive folder{data.drive?.folder?.name ? ` (${data.drive.folder.name})` : ''}.</p>
                    ) : (
                      <div className="rounded-xl border border-slate-200 divide-y divide-slate-100 max-h-52 overflow-y-auto">
                        {files.map(f => (
                          <label key={f.id} className="flex items-center gap-2.5 px-3 py-2 hover:bg-slate-50 cursor-pointer">
                            <input type="checkbox" checked={selected.has(f.id)} onChange={() => toggleFile(f.id)}
                              className="w-4 h-4 accent-blue-600 shrink-0" />
                            <FileText className="w-4 h-4 text-slate-400 shrink-0" />
                            <div className="min-w-0 flex-1">
                              <p className="text-sm text-slate-700 truncate">{f.name}</p>
                              {f.path && <p className="text-[10px] text-slate-400 truncate">{f.path}</p>}
                            </div>
                            {f.docType && (
                              <span className={`text-[10px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded-full shrink-0 ${
                                f.source === 'llc' ? 'bg-violet-50 text-violet-700' : 'bg-blue-50 text-blue-700'
                              }`}>{f.docType}</span>
                            )}
                          </label>
                        ))}
                      </div>
                    )}
                    <p className="text-[11px] text-slate-400 mt-1">Deed, notice letter &amp; Assignment come from this property's folder. The <span className="text-violet-600 font-medium">W-9</span> is pulled from your LLC folders — if more than one shows, pick the right entity's. Double-check before sending.</p>
                  </div>

                  {error && (
                    <div className="flex items-start gap-2 text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
                      <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" /> {error}
                    </div>
                  )}
                </>
              ) : error ? (
                <div className="flex items-start gap-2 text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
                  <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" /> {error}
                </div>
              ) : null}
            </div>

            {/* Footer */}
            <div className="flex items-center justify-between px-6 py-4 border-t border-slate-100">
              <button onClick={close} className="text-sm text-slate-500 hover:text-slate-700">
                {sent ? 'Close' : 'Cancel'}
              </button>
              {data && !sent && (
                <Button onClick={handleSend} disabled={sending || !to.trim() || !subject.trim() || !body.trim()}>
                  {sending
                    ? <><Loader2 className="w-4 h-4 animate-spin" /> Sending…</>
                    : <><Send className="w-4 h-4" /> Review &amp; Send{selected.size > 0 ? ` (${selected.size} attached)` : ''}</>}
                </Button>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  )
}
