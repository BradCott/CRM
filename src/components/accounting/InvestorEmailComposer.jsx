// Reusable investor-email composer. Auto-populates the property's cap-table
// investors as recipients (add / remove / edit email / add a one-off), gives a
// big drafting area, and an AI assist that drafts a clean email for the chosen
// PURPOSE. Broadcast model: one template, personalized per recipient via
// {{first_name}} / {{property}}. Built to be reused across contexts — pass a
// different `purpose` (and add an entry to PURPOSES) for the sale / accounting
// versions with only small tweaks.
import { useState, useEffect } from 'react'
import { X, Loader2, Send, Sparkles, Mail, CheckCircle, AlertTriangle, Plus, ChevronRight, ChevronDown } from 'lucide-react'
import Button from '../ui/Button'
import { getInvestorRecipients, draftInvestorEmail, emailInvestors } from '../../api/client'
import SendFromPicker from './SendFromPicker'

const COMPANY_RE = /\b(LLC|L\.L\.C|Inc|Corp|Company|Capital|Partners|Holdings|Trust|Fund|Group|Investments?|Ventures?)\b/i
const greeting = (name = '') => (COMPANY_RE.test(name) ? name.trim() : (name.trim().split(/\s+/)[0] || 'there'))

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

  useEffect(() => {
    getInvestorRecipients(propertyId)
      .then(rows => {
        const list = rows || []
        setRecipients(list)
        setExclude(new Set(list.filter(r => !r.email).map(r => r.id)))  // auto-skip anyone missing an email
      })
      .catch(e => setError(e.message))
      .finally(() => setLoading(false))
  }, [propertyId])

  const emailOf = r => (emailEdits[r.id] ?? r.email ?? '')
  const merge = (text, r) => text
    .replaceAll('{{first_name}}', greeting(r.name))
    .replaceAll('{{property}}', propName)

  const included = recipients.filter(r => !exclude.has(r.id) && emailOf(r).trim())

  const addRecipient = () => {
    const email = newEmail.trim()
    if (!email) return
    const id = `custom-${Date.now()}`
    setRecipients(list => [...list, { id, investor_id: null, name: newName.trim() || email, emails: [email], email, contribution: 0, custom: true }])
    setNewName(''); setNewEmail('')
  }

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
    if (!window.confirm(`Send this update to ${included.length} investor${included.length === 1 ? '' : 's'}?`)) return
    setSending(true); setError(null)
    try {
      const sends = included.map(r => ({ to: emailOf(r).trim(), name: r.name, subject: merge(subject, r), body: merge(body, r) }))
      const res = await emailInvestors(propertyId, { account: account || undefined, sends })
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
                  <input value={subject} onChange={e => setSubject(e.target.value)}
                    className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-emerald-400" />
                </div>
                <div className="flex flex-col">
                  <label className="block text-xs font-medium text-slate-500 mb-1">Message</label>
                  <textarea value={body} onChange={e => setBody(e.target.value)} rows={16}
                    className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2.5 leading-relaxed focus:outline-none focus:ring-2 focus:ring-emerald-400 resize-y" />
                  <p className="text-[11px] text-slate-400 mt-1">Personalized per recipient: <code>{'{{first_name}} {{property}}'}</code></p>
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

                {/* Preview */}
                {sample && (
                  <div>
                    <button onClick={() => setShowPreview(p => !p)} className="text-xs font-medium text-slate-500 hover:text-slate-700 inline-flex items-center gap-1">
                      {showPreview ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />} Preview as {greeting(sample.name)}
                    </button>
                    {showPreview && (
                      <div className="mt-2 bg-slate-50 rounded-lg p-3 text-xs text-slate-600 whitespace-pre-line border border-slate-100">
                        <p className="font-semibold text-slate-700 mb-1">{merge(subject, sample)}</p>
                        {merge(body, sample)}
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
                          <p className="text-sm font-medium text-slate-800 truncate">{r.name}</p>
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
