// Reusable investor-email composer. Auto-populates the property's cap-table
// investors as recipients (add / remove / edit email / add a one-off), gives a
// big drafting area, and an AI assist that drafts a clean email for the chosen
// PURPOSE. Broadcast model: one template, personalized per recipient via
// {{first_name}} / {{property}}. Built to be reused across contexts — pass a
// different `purpose` (and add an entry to PURPOSES) for the sale / accounting
// versions with only small tweaks.
import { useState, useEffect, useRef } from 'react'
import { X, Loader2, Send, Sparkles, Mail, CheckCircle, AlertTriangle, Plus, ChevronRight, ChevronDown, Paperclip, Braces, ShieldAlert } from 'lucide-react'
import Button from '../ui/Button'
import { getInvestorRecipients, draftInvestorEmail, emailInvestors } from '../../api/client'
import SendFromPicker from './SendFromPicker'

const COMPANY_RE = /\b(LLC|L\.L\.C|Inc|Corp|Company|Capital|Partners|Holdings|Trust|Fund|Group|Investments?|Ventures?)\b/i
const greeting = (name = '') => (COMPANY_RE.test(name) ? name.trim() : (name.trim().split(/\s+/)[0] || 'there'))
// The name to greet a recipient by: the explicit first name if set, else fall back
// to parsing the display name (which becomes the entity name for a company).
const greetName = r => (r?.first_name?.trim() ? r.first_name.trim() : greeting(r?.name || ''))
// A recipient whose greeting would fall back to an entity name — needs a first name.
const missingFirstName = r => !r?.first_name?.trim() && COMPANY_RE.test(r?.name || '')

// Merge tokens available in the subject/body. Kept in one place so the Insert-field
// menu and the merge() replacer stay in sync — add a row here to add a field.
const fmtMoney = n => (n || n === 0) ? `$${Number(n).toLocaleString('en-US', { maximumFractionDigits: 0 })}` : ''
const MERGE_FIELDS = [
  { token: '{{first_name}}',   label: 'First name',       value: r => greetName(r) },
  { token: '{{name}}',         label: 'Full / entity name', value: r => r?.name || '' },
  { token: '{{entity}}',       label: 'Entity name',      value: r => r?.entity || r?.name || '' },
  { token: '{{contribution}}', label: 'Contribution ($)', value: r => fmtMoney(r?.contribution) },
  { token: '{{property}}',     label: 'Property',         value: (r, propName) => propName },
]

// Appended to the body when the sender is including wiring instructions. The single
// most effective protection against wire-fraud / business-email-compromise: tell the
// investor to phone-verify before ever acting on emailed bank details.
const WIRE_WARNING = phone =>
`\n\n⚠️ WIRE FRAUD WARNING: We will never change our wiring instructions by email. Before sending any funds, call us at ${phone} to verbally verify the account details. If you receive an email asking you to use different bank details, do not act on it — call us first.`

const fmtSize = n => n < 1024 ? `${n} B` : n < 1024 * 1024 ? `${(n / 1024).toFixed(0)} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`
const MAX_ATTACH_BYTES = 18 * 1024 * 1024  // server body cap is 25MB; base64 inflates ~33%
// Read a File into an attachment record with base64 content (data: prefix stripped).
const fileToAttachment = file => new Promise((resolve, reject) => {
  const reader = new FileReader()
  reader.onload = () => {
    const res = String(reader.result || '')
    resolve({
      id: `${file.name}-${file.size}-${Math.random().toString(36).slice(2)}`,
      filename: file.name,
      contentType: file.type || 'application/octet-stream',
      size: file.size,
      content: res.includes(',') ? res.split(',')[1] : res,
    })
  }
  reader.onerror = reject
  reader.readAsDataURL(file)
})

// Per-purpose defaults. Add a key here to spin up a new variant (sale, accounting…).
const PURPOSES = {
  update: {
    title: 'Email investors — property update',
    defaultSubject: 'Update on {{property}}',
    defaultBody:
`Hi {{first_name}},

I wanted to share a quick update on {{property}}.

[Share the news here — leasing, operations, a capital project, financing, or a milestone.]

As always, thank you for investing alongside Knox Capital. Please reach out with any questions.

Warm regards,
The Knox Capital Team`,
    draftPlaceholder: 'e.g. we renewed the tenant for 5 years at a 10% bump — write a warm update and thank them for their partnership',
    footer: 'Everyone on the list gets the same message, personalized with their name.',
  },
  pipeline: {
    title: 'Email investors — deal update',
    defaultSubject: '{{property}} — closing update',
    defaultBody:
`Hi {{first_name}},

A quick update on {{property}} as we move toward closing.

[Share where things stand — due diligence, financing, the expected close date, and any next steps or what to expect from here.]

Thank you as always for investing alongside Knox Capital. Please reach out with any questions.

Warm regards,
The Knox Capital Team`,
    draftPlaceholder: "e.g. due diligence is done and we're clear to close Aug 21 — write a confident update on where we stand and what's next",
    footer: 'A progress update to the committed investors. Personalized with each name.',
  },
}

export default function InvestorEmailComposer({ propertyId, property, purpose = 'update', onClose }) {
  const cfg = PURPOSES[purpose] || PURPOSES.update
  const propName = [property?.address, property?.city, property?.state].filter(Boolean).join(', ') || 'the property'

  const [recipients, setRecipients] = useState([])
  const [loading, setLoading]   = useState(true)
  const [subject, setSubject]   = useState(cfg.defaultSubject)
  const [body, setBody]         = useState(cfg.defaultBody)
  const [account, setAccount]   = useState('')
  const [instructions, setInstructions] = useState('')
  const [drafting, setDrafting] = useState(false)
  const [sending, setSending]   = useState(false)
  const [result, setResult]     = useState(null)
  const [error, setError]       = useState(null)
  const [exclude, setExclude]   = useState(() => new Set())
  const [emailEdits, setEmailEdits] = useState({})  // id -> email override
  const [showPreview, setShowPreview] = useState(false)
  const [newName, setNewName]   = useState('')
  const [newEmail, setNewEmail] = useState('')
  const [attachments, setAttachments] = useState([])  // {id, filename, contentType, size, content(base64)}
  const [fieldMenu, setFieldMenu] = useState(false)   // Insert-field dropdown open
  const [wireWarn, setWireWarn]   = useState(false)   // append wire-fraud warning
  const [wirePhone, setWirePhone] = useState('')      // verification phone for the warning
  const subjRef = useRef(null)
  const bodyRef = useRef(null)
  const activeRef = useRef('body')  // which field last had focus, for token insertion

  useEffect(() => {
    getInvestorRecipients(propertyId)
      .then(rows => {
        // Fan out each entity into one recipient PER CONTACT (each greeted by their
        // own first name). Investors with no contacts stay a single recipient.
        const list = (rows || []).flatMap(r => {
          if (r.contacts && r.contacts.length) {
            return r.contacts.map((c, i) => ({
              id: `contact-${c.id}`,
              investor_id: r.investor_id,
              name: c.name || r.name,        // the contact person's name
              entity: r.name,                // the entity they belong to
              first_name: c.first_name || r.first_name || '',
              emails: c.email ? [c.email] : [],
              email: c.email || '',
              // Contribution is the entity's investment — surface it on every contact
              // so {{contribution}} merges correctly for each of them.
              contribution: r.contribution,
            }))
          }
          return [r]
        })
        setRecipients(list)
        setExclude(new Set(list.filter(r => !r.email).map(r => r.id)))  // auto-skip anyone missing an email
      })
      .catch(e => setError(e.message))
      .finally(() => setLoading(false))
  }, [propertyId])

  const emailOf = r => (emailEdits[r.id] ?? r.email ?? '')
  const merge = (text, r) => MERGE_FIELDS.reduce(
    (out, f) => out.replaceAll(f.token, f.value(r, propName)),
    text ?? '')

  // Insert a merge token at the cursor of whichever field (subject/body) was last
  // focused. onMouseDown-preventDefault on the menu keeps that field focused so the
  // caret position is preserved.
  const insertToken = token => {
    const isBody = activeRef.current !== 'subject'
    const el = isBody ? bodyRef.current : subjRef.current
    const val = isBody ? body : subject
    const set = isBody ? setBody : setSubject
    const focused = el && document.activeElement === el
    const start = focused ? el.selectionStart : val.length
    const end   = focused ? el.selectionEnd   : val.length
    set(val.slice(0, start) + token + val.slice(end))
    requestAnimationFrame(() => {
      if (!el) return
      el.focus()
      const pos = start + token.length
      try { el.setSelectionRange(pos, pos) } catch { /* ignore */ }
    })
  }

  const included = recipients.filter(r => !exclude.has(r.id) && emailOf(r).trim())

  const addRecipient = () => {
    const email = newEmail.trim()
    if (!email) return
    const id = `custom-${Date.now()}`
    setRecipients(list => [...list, { id, investor_id: null, name: newName.trim() || email, emails: [email], email, contribution: 0, custom: true }])
    setNewName(''); setNewEmail('')
  }

  const totalAttachBytes = attachments.reduce((n, a) => n + (a.size || 0), 0)
  const addFiles = async fileList => {
    const files = Array.from(fileList || [])
    if (!files.length) return
    setError(null)
    try {
      const added = await Promise.all(files.map(fileToAttachment))
      setAttachments(a => [...a, ...added])
    } catch { setError('Could not read one of the files') }
  }
  const removeAttachment = id => setAttachments(a => a.filter(x => x.id !== id))

  const aiDraft = async () => {
    setDrafting(true); setError(null)
    try {
      const r = await draftInvestorEmail(propertyId, { purpose, instructions, current_subject: subject, current_body: body })
      if (r.subject) setSubject(r.subject)
      if (r.body) setBody(r.body)
      setInstructions('')
    } catch (e) { setError(e.message || 'Draft failed') }
    finally { setDrafting(false) }
  }

  const send = async () => {
    if (!included.length) { setError('No recipients with an email address'); return }
    if (totalAttachBytes > MAX_ATTACH_BYTES) { setError(`Attachments are too large (${fmtSize(totalAttachBytes)}). Keep the total under ${fmtSize(MAX_ATTACH_BYTES)}.`); return }
    if (wireWarn && !wirePhone.trim()) { setError('Enter a verification phone number for the wire-fraud warning (or uncheck it).'); return }
    const attachNote = attachments.length ? ` with ${attachments.length} attachment${attachments.length === 1 ? '' : 's'}` : ''
    if (!window.confirm(`Send this update${attachNote} to ${included.length} investor${included.length === 1 ? '' : 's'}?`)) return
    setSending(true); setError(null)
    try {
      const warn = wireWarn ? WIRE_WARNING(wirePhone.trim()) : ''
      const sends = included.map(r => ({ to: emailOf(r).trim(), name: r.name, subject: merge(subject, r), body: merge(body, r) + warn }))
      const res = await emailInvestors(propertyId, {
        account: account || undefined,
        sends,
        attachments: attachments.map(a => ({ filename: a.filename, contentType: a.contentType, content: a.content })),
      })
      setResult(res)
    } catch (e) { setError(e.message || 'Send failed'); setSending(false) }
  }

  const sample = included[0] || recipients[0]

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-5xl h-[90vh] flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100 shrink-0">
          <div className="flex items-center gap-2">
            <Mail className="w-5 h-5 text-emerald-600" />
            <h3 className="text-base font-semibold text-slate-900">{cfg.title} · {propName}</h3>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600"><X className="w-5 h-5" /></button>
        </div>

        {result ? (
          <div className="flex-1 flex flex-col items-center justify-center gap-3 text-center px-5">
            <CheckCircle className="w-10 h-10 text-emerald-500" />
            <p className="text-lg font-semibold text-slate-900">{result.sent} email{result.sent === 1 ? '' : 's'} sent</p>
            {result.failed?.length > 0 && (
              <div className="text-sm text-red-600">
                <p className="font-medium">{result.failed.length} failed:</p>
                {result.failed.map((f, i) => <p key={i} className="text-xs">{f.name || f.to} — {f.error}</p>)}
              </div>
            )}
            <Button onClick={onClose} className="mt-2">Done</Button>
          </div>
        ) : loading ? (
          <div className="flex-1 flex flex-col items-center justify-center gap-2 text-slate-400"><Loader2 className="w-6 h-6 animate-spin" /><p className="text-sm">Loading investors…</p></div>
        ) : (
          <div className="flex-1 min-h-0 grid grid-cols-1 md:grid-cols-3 gap-0 overflow-hidden">
            {/* Left: the email */}
            <div className="md:col-span-2 flex flex-col min-h-0 border-r border-slate-100">
              <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
                <div>
                  <label className="block text-xs font-medium text-slate-500 mb-1">Subject</label>
                  <input ref={subjRef} value={subject} onChange={e => setSubject(e.target.value)}
                    onFocus={() => { activeRef.current = 'subject' }}
                    className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-emerald-400" />
                </div>
                <div className="flex flex-col">
                  <div className="flex items-center justify-between mb-1">
                    <label className="block text-xs font-medium text-slate-500">Message</label>
                    <div className="relative">
                      <button type="button" onMouseDown={e => e.preventDefault()} onClick={() => setFieldMenu(o => !o)}
                        className="inline-flex items-center gap-1 text-[11px] font-medium text-emerald-700 border border-emerald-200 bg-emerald-50 rounded px-2 py-1 hover:bg-emerald-100">
                        <Braces className="w-3 h-3" /> Insert field
                      </button>
                      {fieldMenu && (
                        <>
                          <div className="fixed inset-0 z-10" onMouseDown={() => setFieldMenu(false)} />
                          <div className="absolute right-0 mt-1 z-20 w-52 bg-white border border-slate-200 rounded-lg shadow-lg py-1">
                            {MERGE_FIELDS.map(f => (
                              <button key={f.token} type="button" onMouseDown={e => e.preventDefault()}
                                onClick={() => { insertToken(f.token); setFieldMenu(false) }}
                                className="w-full text-left px-3 py-1.5 text-xs text-slate-700 hover:bg-emerald-50 flex items-center justify-between gap-2">
                                <span>{f.label}</span><code className="text-[10px] text-slate-400">{f.token}</code>
                              </button>
                            ))}
                          </div>
                        </>
                      )}
                    </div>
                  </div>
                  <textarea ref={bodyRef} value={body} onChange={e => setBody(e.target.value)} rows={16}
                    onFocus={() => { activeRef.current = 'body' }}
                    className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2.5 leading-relaxed focus:outline-none focus:ring-2 focus:ring-emerald-400 resize-y" />
                  <p className="text-[11px] text-slate-400 mt-1">Personalized per recipient — use <span className="font-medium">Insert field</span> or type tokens like <code>{'{{first_name}}'}</code>, <code>{'{{contribution}}'}</code>.</p>
                </div>

                {/* AI assist */}
                <div className="bg-violet-50 border border-violet-100 rounded-lg px-3 py-3 space-y-2">
                  <label className="flex items-center gap-1.5 text-xs font-medium text-violet-700"><Sparkles className="w-3.5 h-3.5" /> Draft with Claude</label>
                  <textarea value={instructions} onChange={e => setInstructions(e.target.value)} rows={2}
                    placeholder={cfg.draftPlaceholder}
                    className="w-full text-sm border border-violet-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-violet-400 resize-y" />
                  <div className="flex justify-end">
                    <button onClick={aiDraft} disabled={drafting}
                      className="inline-flex items-center gap-1.5 text-sm font-medium text-white bg-violet-600 rounded-lg px-3 py-2 hover:bg-violet-700 disabled:opacity-50">
                      {drafting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />} {body.trim() && body !== cfg.defaultBody ? 'Redraft' : 'Draft it'}
                    </button>
                  </div>
                </div>

                {/* Attachments */}
                <div>
                  <label className="block text-xs font-medium text-slate-500 mb-1">Attachments</label>
                  <label
                    onDragOver={e => e.preventDefault()}
                    onDrop={e => { e.preventDefault(); addFiles(e.dataTransfer.files) }}
                    className="flex items-center justify-center gap-2 border-2 border-dashed border-slate-200 rounded-lg px-3 py-4 text-xs text-slate-500 cursor-pointer hover:border-emerald-400 hover:bg-emerald-50/40 transition-colors">
                    <Paperclip className="w-4 h-4 shrink-0" />
                    <span>Drop files here or <span className="text-emerald-700 font-medium">browse</span> — e.g. wiring instructions (PDF)</span>
                    <input type="file" multiple className="hidden" onChange={e => { addFiles(e.target.files); e.target.value = '' }} />
                  </label>
                  {attachments.length > 0 && (
                    <div className="mt-2 space-y-1">
                      {attachments.map(a => (
                        <div key={a.id} className="flex items-center gap-2 text-xs bg-slate-50 border border-slate-100 rounded px-2 py-1.5">
                          <Paperclip className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                          <span className="flex-1 truncate text-slate-700" title={a.filename}>{a.filename}</span>
                          <span className="text-slate-400 shrink-0">{fmtSize(a.size)}</span>
                          <button onClick={() => removeAttachment(a.id)} className="text-slate-400 hover:text-red-500 shrink-0" title="Remove"><X className="w-3.5 h-3.5" /></button>
                        </div>
                      ))}
                      <p className={`text-[11px] ${totalAttachBytes > MAX_ATTACH_BYTES ? 'text-red-500 font-medium' : 'text-slate-400'}`}>
                        Attached to every recipient's email. {fmtSize(totalAttachBytes)} total.
                      </p>
                    </div>
                  )}
                </div>

                {/* Wire-fraud warning toggle */}
                <div className="bg-amber-50 border border-amber-200 rounded-lg px-3 py-3">
                  <label className="flex items-start gap-2 cursor-pointer">
                    <input type="checkbox" checked={wireWarn} onChange={e => setWireWarn(e.target.checked)} className="mt-0.5 rounded border-amber-300" />
                    <span className="text-xs">
                      <span className="font-semibold text-amber-900 flex items-center gap-1"><ShieldAlert className="w-3.5 h-3.5" /> Include wire-fraud warning</span>
                      <span className="text-amber-700 block mt-0.5">Appends a notice telling investors to call and verify before wiring. Tick this whenever the email includes wiring instructions.</span>
                    </span>
                  </label>
                  {wireWarn && (
                    <input value={wirePhone} onChange={e => setWirePhone(e.target.value)} placeholder="Verification phone, e.g. (913) 555-0100"
                      className="w-full text-xs mt-2 ml-6 max-w-[calc(100%-1.5rem)] border border-amber-300 rounded px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-amber-400" />
                  )}
                </div>

                {/* Preview */}
                {sample && (
                  <div>
                    <button onClick={() => setShowPreview(p => !p)} className="text-xs font-medium text-slate-500 hover:text-slate-700 inline-flex items-center gap-1">
                      {showPreview ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />} Preview as {greetName(sample)}
                    </button>
                    {showPreview && (
                      <div className="mt-2 bg-slate-50 rounded-lg p-3 text-xs text-slate-600 whitespace-pre-line border border-slate-100">
                        <p className="font-semibold text-slate-700 mb-1">{merge(subject, sample)}</p>
                        {merge(body, sample)}{wireWarn ? WIRE_WARNING(wirePhone.trim() || '[verification phone]') : ''}
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>

            {/* Right: recipients + send-from */}
            <div className="flex flex-col min-h-0">
              <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
                <SendFromPicker value={account} onChange={setAccount} />

                <div>
                  <p className="text-xs font-medium text-slate-500 mb-1.5">Recipients ({included.length} of {recipients.length})</p>
                  <div className="border border-slate-200 rounded-lg divide-y divide-slate-100 max-h-[40vh] overflow-y-auto">
                    {recipients.length === 0 && <p className="px-3 py-3 text-xs text-slate-400 italic">No investors on this property's cap table yet. Add recipients below.</p>}
                    {recipients.map(r => (
                      <div key={r.id} className="px-3 py-2 flex items-start gap-2">
                        <input type="checkbox" checked={!exclude.has(r.id)}
                          onChange={e => setExclude(s => { const n = new Set(s); e.target.checked ? n.delete(r.id) : n.add(r.id); return n })}
                          className="mt-1 rounded border-slate-300" />
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-slate-800 truncate">{r.name}
                            {missingFirstName(r) && <span className="ml-1.5 text-[10px] font-semibold text-amber-700 bg-amber-50 border border-amber-200 rounded px-1 py-0.5" title="No first name set — this email will greet them by the entity name. Add a contact/first name on the Investors page.">no first name</span>}
                          </p>
                          {r.entity && r.entity !== r.name && <p className="text-[11px] text-slate-400 truncate">{r.entity}</p>}
                          <input value={emailOf(r)} onChange={e => setEmailEdits(m => ({ ...m, [r.id]: e.target.value }))}
                            placeholder="add email…"
                            className={`w-full text-xs mt-0.5 border rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-emerald-400 ${emailOf(r).trim() ? 'border-slate-200 text-slate-600' : 'border-amber-300 bg-amber-50'}`} />
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Add a one-off recipient */}
                <div className="space-y-1.5">
                  <p className="text-xs font-medium text-slate-500">Add someone</p>
                  <div className="flex items-center gap-1.5">
                    <input value={newName} onChange={e => setNewName(e.target.value)} placeholder="Name (optional)"
                      className="w-28 text-xs border border-slate-200 rounded px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-emerald-400" />
                    <input value={newEmail} onChange={e => setNewEmail(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') addRecipient() }}
                      type="email" placeholder="email@…"
                      className="flex-1 text-xs border border-slate-200 rounded px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-emerald-400" />
                    <button onClick={addRecipient} disabled={!newEmail.trim()}
                      className="shrink-0 inline-flex items-center gap-1 text-xs font-medium text-emerald-700 border border-emerald-200 bg-emerald-50 rounded px-2 py-1.5 hover:bg-emerald-100 disabled:opacity-40">
                      <Plus className="w-3.5 h-3.5" /> Add
                    </button>
                  </div>
                </div>

                {error && <p className="text-sm text-red-600 flex items-center gap-1.5"><AlertTriangle className="w-4 h-4" /> {error}</p>}
              </div>
            </div>
          </div>
        )}

        {!result && !loading && (
          <div className="flex items-center justify-between gap-2 px-5 py-4 border-t border-slate-100 shrink-0">
            <p className="text-xs text-slate-400">{cfg.footer}</p>
            <div className="flex items-center gap-2">
              <button onClick={onClose} className="text-sm font-medium text-slate-500 hover:text-slate-700 px-3 py-2">Cancel</button>
              <Button onClick={send} disabled={sending || included.length === 0}>
                {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />} Send to {included.length}
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
