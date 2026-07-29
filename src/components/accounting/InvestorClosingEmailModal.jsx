// "Email Investors on Closing" — drafts a per-investor email with their expected
// sale return (broken out), clearly flags that disbursements must be verified
// before funds move, lets you AI-redraft the template, then sends to each investor
// through the connected Google account.
import { useState, useEffect } from 'react'
import { X, Loader2, Send, Sparkles, Mail, CheckCircle, AlertTriangle, ChevronRight, ChevronDown } from 'lucide-react'
import Button from '../ui/Button'
import { getInvestorReturns, draftInvestorEmail, emailInvestors } from '../../api/client'

const money = n => (n == null || isNaN(n) ? '$0' : (n < 0 ? `-$${Math.abs(Math.round(n)).toLocaleString()}` : `$${Math.round(n).toLocaleString()}`))
const COMPANY_RE = /\b(LLC|L\.L\.C|Inc|Corp|Company|Capital|Partners|Holdings|Trust|Fund|Group|Investments?|Ventures?)\b/i
const greeting = (name = '') => (COMPANY_RE.test(name) ? name.trim() : (name.trim().split(/\s+/)[0] || 'there'))

const DEFAULT_SUBJECT = '{{property}} has sold — your distribution summary'
const DEFAULT_BODY =
`Hi {{first_name}},

Great news — {{property}} has officially closed. Thank you for investing alongside Knox Capital.

Here is your expected distribution from the sale:
  • Return of capital: {{capital}}
  • Preferred return: {{pref}}
  • Profit / carry: {{carry}}
  • Total: {{total}}

Please note: these amounts are estimates. We are verifying all disbursements and no funds will be sent until that verification is complete. We'll follow up with the final numbers and wiring details shortly.

Thank you again for your trust and partnership.

Warm regards,
The Knox Capital Team`

export default function InvestorClosingEmailModal({ propertyId, property, onClose }) {
  const propName = [property?.address, property?.city, property?.state].filter(Boolean).join(', ') || 'the property'
  const [returns, setReturns]   = useState([])
  const [loading, setLoading]   = useState(true)
  const [subject, setSubject]   = useState(DEFAULT_SUBJECT)
  const [body, setBody]         = useState(DEFAULT_BODY)
  const [from, setFrom]         = useState('brad@knoxcre.com')
  const [instructions, setInstructions] = useState('')
  const [drafting, setDrafting] = useState(false)
  const [sending, setSending]   = useState(false)
  const [result, setResult]     = useState(null)
  const [error, setError]       = useState(null)
  const [exclude, setExclude]   = useState(() => new Set())
  const [emailEdits, setEmailEdits] = useState({}) // investor_id -> email override
  const [preview, setPreview]   = useState(null)   // investor_id being previewed

  useEffect(() => {
    getInvestorReturns(propertyId)
      .then(rows => {
        setReturns(rows || [])
        setExclude(new Set((rows || []).filter(r => !r.email).map(r => r.investor_id))) // auto-skip no-email
      })
      .catch(e => setError(e.message))
      .finally(() => setLoading(false))
  }, [propertyId])

  const emailOf = r => (emailEdits[r.investor_id] ?? r.email ?? '')
  const merge = (text, r) => text
    .replaceAll('{{first_name}}', greeting(r.name))
    .replaceAll('{{property}}', propName)
    .replaceAll('{{total}}', money(r.total))
    .replaceAll('{{capital}}', money(r.capital))
    .replaceAll('{{pref}}', money(r.pref))
    .replaceAll('{{carry}}', money(r.carry))

  const recipients = returns.filter(r => !exclude.has(r.investor_id) && emailOf(r).trim())

  const aiRedraft = async () => {
    setDrafting(true); setError(null)
    try {
      const r = await draftInvestorEmail(propertyId, { instructions, current_subject: subject, current_body: body })
      if (r.subject) setSubject(r.subject)
      if (r.body) setBody(r.body)
      setInstructions('')
    } catch (e) { setError(e.message || 'Draft failed') }
    finally { setDrafting(false) }
  }

  const send = async () => {
    if (!recipients.length) { setError('No recipients with an email address'); return }
    if (!window.confirm(`Send the closing email to ${recipients.length} investor${recipients.length === 1 ? '' : 's'}? Each gets their own return figures.`)) return
    setSending(true); setError(null)
    try {
      const sends = recipients.map(r => ({ to: emailOf(r).trim(), name: r.name, subject: merge(subject, r), body: merge(body, r) }))
      const res = await emailInvestors(propertyId, { from: from.trim() || undefined, sends })
      setResult(res)
    } catch (e) { setError(e.message || 'Send failed'); setSending(false) }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-2xl max-h-[92vh] flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100 shrink-0">
          <div className="flex items-center gap-2">
            <Mail className="w-5 h-5 text-emerald-600" />
            <h3 className="text-base font-semibold text-slate-900">Email investors — {propName}</h3>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600"><X className="w-5 h-5" /></button>
        </div>

        {result ? (
          <div className="px-5 py-10 flex flex-col items-center gap-3 text-center">
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
          <div className="px-5 py-16 flex flex-col items-center gap-2 text-slate-400"><Loader2 className="w-6 h-6 animate-spin" /><p className="text-sm">Loading investor returns…</p></div>
        ) : returns.length === 0 ? (
          <div className="px-5 py-16 flex flex-col items-center gap-2 text-slate-400"><AlertTriangle className="w-6 h-6" /><p className="text-sm">No recorded distributions for this property yet — close out the sale first.</p></div>
        ) : (
          <div className="px-5 py-4 space-y-4 overflow-y-auto">
            {/* Template */}
            <div>
              <label className="block text-xs font-medium text-slate-500 mb-1">Subject</label>
              <input value={subject} onChange={e => setSubject(e.target.value)}
                className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-emerald-400" />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-500 mb-1">Message template</label>
              <textarea value={body} onChange={e => setBody(e.target.value)} rows={11}
                className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2 font-mono focus:outline-none focus:ring-2 focus:ring-emerald-400 resize-y" />
              <p className="text-[11px] text-slate-400 mt-1">Tokens filled per investor: <code>{'{{first_name}} {{property}} {{capital}} {{pref}} {{carry}} {{total}}'}</code></p>
            </div>

            {/* AI redraft */}
            <div className="bg-violet-50 border border-violet-100 rounded-lg px-3 py-3 space-y-2">
              <label className="flex items-center gap-1.5 text-xs font-medium text-violet-700"><Sparkles className="w-3.5 h-3.5" /> Redraft with AI</label>
              <div className="flex items-center gap-2">
                <input value={instructions} onChange={e => setInstructions(e.target.value)}
                  placeholder="e.g. warmer tone, mention the 18-month hold, add a thank-you for their patience"
                  className="flex-1 text-sm border border-violet-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-violet-400" />
                <button onClick={aiRedraft} disabled={drafting}
                  className="inline-flex items-center gap-1.5 text-sm font-medium text-white bg-violet-600 rounded-lg px-3 py-2 hover:bg-violet-700 disabled:opacity-50 whitespace-nowrap">
                  {drafting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />} Redraft
                </button>
              </div>
            </div>

            {/* From */}
            <div>
              <label className="block text-xs font-medium text-slate-500 mb-1">From</label>
              <input value={from} onChange={e => setFrom(e.target.value)} type="email"
                className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-emerald-400" />
              <p className="text-[11px] text-slate-400 mt-1">Sends through your connected Google account (must be brad@knoxcre.com, or a verified “send as” alias).</p>
            </div>

            {/* Recipients */}
            <div>
              <p className="text-xs font-medium text-slate-500 mb-1.5">Recipients ({recipients.length} of {returns.length})</p>
              <div className="border border-slate-200 rounded-lg divide-y divide-slate-100">
                {returns.map(r => {
                  const included = !exclude.has(r.investor_id) && emailOf(r).trim()
                  return (
                    <div key={r.investor_id} className="px-3 py-2">
                      <div className="flex items-center gap-2">
                        <input type="checkbox" checked={!exclude.has(r.investor_id)}
                          onChange={e => setExclude(s => { const n = new Set(s); e.target.checked ? n.delete(r.investor_id) : n.add(r.investor_id); return n })}
                          className="rounded border-slate-300" />
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-slate-800 truncate">{r.name}</p>
                          <input value={emailOf(r)} onChange={e => setEmailEdits(m => ({ ...m, [r.investor_id]: e.target.value }))}
                            placeholder="add email…"
                            className={`w-full text-xs mt-0.5 border rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-emerald-400 ${emailOf(r).trim() ? 'border-slate-200 text-slate-600' : 'border-amber-300 bg-amber-50'}`} />
                        </div>
                        <div className="text-right shrink-0">
                          <p className="text-sm font-semibold text-emerald-700 tabular-nums">{money(r.total)}</p>
                          <button onClick={() => setPreview(preview === r.investor_id ? null : r.investor_id)}
                            className="text-[11px] text-slate-400 hover:text-slate-600 inline-flex items-center gap-0.5">
                            {preview === r.investor_id ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />} preview
                          </button>
                        </div>
                      </div>
                      {preview === r.investor_id && (
                        <div className="mt-2 ml-6 bg-slate-50 rounded-lg p-3 text-xs text-slate-600 whitespace-pre-line">
                          <p className="font-semibold text-slate-700 mb-1">{merge(subject, r)}</p>
                          {merge(body, r)}
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            </div>

            {error && <p className="text-sm text-red-600 flex items-center gap-1.5"><AlertTriangle className="w-4 h-4" /> {error}</p>}
          </div>
        )}

        {!result && !loading && returns.length > 0 && (
          <div className="flex items-center justify-between gap-2 px-5 py-4 border-t border-slate-100 shrink-0">
            <p className="text-xs text-slate-400">Each investor gets their own figures. Estimates only — disbursements verified before funds move.</p>
            <div className="flex items-center gap-2">
              <button onClick={onClose} className="text-sm font-medium text-slate-500 hover:text-slate-700 px-3 py-2">Cancel</button>
              <Button onClick={send} disabled={sending || recipients.length === 0}>
                {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />} Send to {recipients.length}
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
