// Investor Portal — a separate front-end surface with its own auth (Google +
// password), isolated from the CRM. Phase 1: login, invite-accept, and a home
// that proves the isolated session. Investment views come in Phase 2.
import { useState, useEffect, useRef } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Building2, Loader2, LogOut, AlertCircle, Lock, FileText, Download, Upload, Trash2, LayoutGrid, List as ListIcon, X, ChevronRight } from 'lucide-react'
import {
  portalMe, portalPortfolio, portalPasswordLogin, portalInviteInfo, portalAccept, portalLogout, portalGoogleStartUrl,
  portalDocuments, portalDocUrl, uploadPortalDoc, deletePortalDoc,
} from '../../api/client'

const fmt$ = (n) => (n == null) ? '—' : '$' + Math.round(Number(n)).toLocaleString()
const fmtDate = (d) => d ? new Date(String(d).length === 10 ? d + 'T12:00:00' : d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—'
const fmtPct = (n) => (n == null || n === '') ? '—' : `${Number(n).toFixed(2)}%`

const ERRORS = {
  not_invited: "That Google account isn't on the invite list. Sign in with the exact email Knox invited, or contact Knox for access.",
  state:       'Your sign-in attempt expired — please try again.',
  google:      'Google sign-in failed — please try again.',
  unverified:  "That Google account's email isn't verified. Please verify it with Google, or set a password instead.",
}

function Brandmark() {
  return (
    <div className="flex items-center gap-2 justify-center">
      <div className="w-9 h-9 rounded-xl bg-slate-900 flex items-center justify-center">
        <Building2 className="w-5 h-5 text-white" />
      </div>
      <div className="text-left leading-tight">
        <p className="text-sm font-bold text-slate-900">Knox Capital</p>
        <p className="text-[11px] text-slate-400">Investor Portal</p>
      </div>
    </div>
  )
}

function GoogleButton({ label = 'Sign in with Google' }) {
  return (
    <a href={portalGoogleStartUrl()}
      className="flex items-center justify-center gap-2 w-full px-4 py-2.5 rounded-xl border border-slate-300 bg-white text-slate-700 font-medium text-sm hover:bg-slate-50 transition-colors">
      <svg className="w-4 h-4" viewBox="0 0 48 48"><path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/><path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/><path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/><path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/></svg>
      {label}
    </a>
  )
}

function CardShell({ children }) {
  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
      <div className="w-full max-w-sm">
        <div className="mb-6"><Brandmark /></div>
        <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-6">{children}</div>
        <p className="text-center text-[11px] text-slate-400 mt-4">Access is by invitation. Contact Knox Capital for help.</p>
      </div>
    </div>
  )
}

// ── Login ─────────────────────────────────────────────────────────────────────
function PortalLogin() {
  const [sp] = useSearchParams()
  const urlError = sp.get('error')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(urlError ? (ERRORS[urlError] || 'Sign-in failed.') : null)

  async function submit(e) {
    e.preventDefault()
    setBusy(true); setError(null)
    try { await portalPasswordLogin(email, password); window.location.href = '/portal' }
    catch (err) { setError(err.message || 'Invalid email or password'); setBusy(false) }
  }

  return (
    <CardShell>
      <h1 className="text-base font-bold text-slate-900 text-center mb-1">Sign in</h1>
      <p className="text-xs text-slate-500 text-center mb-5">View your investments, capital account, and distributions.</p>

      {error && (
        <div className="flex items-start gap-2 text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2 mb-4">
          <AlertCircle className="w-3.5 h-3.5 mt-0.5 shrink-0" /> {error}
        </div>
      )}

      <GoogleButton />

      <div className="flex items-center gap-3 my-4">
        <div className="h-px bg-slate-200 flex-1" /><span className="text-[11px] text-slate-400">or</span><div className="h-px bg-slate-200 flex-1" />
      </div>

      <form onSubmit={submit} className="space-y-2.5">
        <input type="email" required value={email} onChange={e => setEmail(e.target.value)} placeholder="Email"
          className="w-full px-3 py-2.5 text-sm border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-slate-400" />
        <input type="password" required value={password} onChange={e => setPassword(e.target.value)} placeholder="Password"
          className="w-full px-3 py-2.5 text-sm border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-slate-400" />
        <button type="submit" disabled={busy}
          className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-slate-900 text-white font-medium text-sm hover:bg-slate-800 disabled:opacity-50">
          {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Lock className="w-4 h-4" />} Sign in
        </button>
      </form>
    </CardShell>
  )
}

// ── Accept invite (set a password) ────────────────────────────────────────────
function PortalAccept() {
  const [sp] = useSearchParams()
  const token = sp.get('token') || ''
  const [info, setInfo] = useState(null)     // { valid, email, name } | null
  const [loading, setLoading] = useState(true)
  const [password, setPassword] = useState('')
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  useEffect(() => {
    portalInviteInfo(token).then(i => { setInfo(i); if (i.name) setName(i.name) }).catch(() => setInfo({ valid: false })).finally(() => setLoading(false))
  }, [token])

  async function submit(e) {
    e.preventDefault()
    setBusy(true); setError(null)
    try { await portalAccept(token, password, name); window.location.href = '/portal' }
    catch (err) { setError(err.message); setBusy(false) }
  }

  if (loading) return <CardShell><div className="flex justify-center py-6"><Loader2 className="w-6 h-6 text-slate-400 animate-spin" /></div></CardShell>
  if (!info?.valid) return (
    <CardShell>
      <div className="text-center py-4">
        <AlertCircle className="w-8 h-8 text-amber-500 mx-auto mb-2" />
        <p className="text-sm font-semibold text-slate-800">This invite link is invalid or expired</p>
        <p className="text-xs text-slate-500 mt-1">Ask Knox Capital to send you a fresh invitation.</p>
      </div>
    </CardShell>
  )

  return (
    <CardShell>
      <h1 className="text-base font-bold text-slate-900 text-center mb-1">Welcome</h1>
      <p className="text-xs text-slate-500 text-center mb-5">Setting up access for <span className="font-medium text-slate-700">{info.email}</span></p>

      <GoogleButton label="Continue with Google" />
      <div className="flex items-center gap-3 my-4">
        <div className="h-px bg-slate-200 flex-1" /><span className="text-[11px] text-slate-400">or set a password</span><div className="h-px bg-slate-200 flex-1" />
      </div>

      {error && (
        <div className="flex items-start gap-2 text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2 mb-3">
          <AlertCircle className="w-3.5 h-3.5 mt-0.5 shrink-0" /> {error}
        </div>
      )}

      <form onSubmit={submit} className="space-y-2.5">
        <input value={name} onChange={e => setName(e.target.value)} placeholder="Your name"
          className="w-full px-3 py-2.5 text-sm border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-slate-400" />
        <input type="password" required value={password} onChange={e => setPassword(e.target.value)} placeholder="Create a password (8+ characters)"
          className="w-full px-3 py-2.5 text-sm border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-slate-400" />
        <button type="submit" disabled={busy}
          className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-slate-900 text-white font-medium text-sm hover:bg-slate-800 disabled:opacity-50">
          {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : null} Create account
        </button>
      </form>
    </CardShell>
  )
}

// ── Home (authenticated) ──────────────────────────────────────────────────────
function Stat({ label, value, tint = 'text-slate-900' }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white px-5 py-4">
      <p className="text-xs text-slate-400">{label}</p>
      <p className={`text-2xl font-bold tabular-nums mt-0.5 ${tint}`}>{value}</p>
    </div>
  )
}

function PortalDocuments() {
  const [docs, setDocs]       = useState(null)
  const [uploading, setUp]    = useState(false)
  const ref = useRef(null)

  async function load() { try { const r = await portalDocuments(); setDocs(r.documents) } catch (_) { setDocs([]) } }
  useEffect(() => { load() }, [])

  async function onUpload(file) {
    if (!file) return
    setUp(true)
    try { await uploadPortalDoc(file); await load() } catch (e) { alert(e.message) } finally { setUp(false) }
  }
  async function onDelete(id) {
    if (!window.confirm('Remove this document you uploaded?')) return
    try { await deletePortalDoc(id); await load() } catch (e) { alert(e.message) }
  }

  if (docs === null) return null
  const shared = docs.filter(d => d.direction === 'to_investor')
  const mine   = docs.filter(d => d.direction === 'from_investor')

  return (
    <div>
      <h2 className="text-sm font-semibold text-slate-700 mb-2">Documents</h2>
      <div className="rounded-2xl border border-slate-200 bg-white divide-y divide-slate-100">
        <div className="px-4 py-3">
          <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-wide mb-2">Shared with you</p>
          {shared.length ? (
            <ul className="space-y-1.5">
              {shared.map(d => (
                <li key={d.id} className="flex items-center gap-2">
                  <FileText className="w-4 h-4 text-slate-400 shrink-0" />
                  <span className="text-sm text-slate-700 truncate flex-1">{d.file_name}</span>
                  {d.category && d.category !== 'Other' && <span className="text-[10px] font-semibold uppercase px-1.5 py-0.5 rounded-full bg-slate-100 text-slate-500 shrink-0">{d.category}</span>}
                  <a href={portalDocUrl(d.id)} className="text-xs text-blue-600 hover:underline inline-flex items-center gap-1 shrink-0"><Download className="w-3.5 h-3.5" /> Download</a>
                </li>
              ))}
            </ul>
          ) : <p className="text-sm text-slate-400">Knox hasn't shared any documents yet.</p>}
        </div>

        <div className="px-4 py-3">
          <div className="flex items-center justify-between mb-2">
            <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-wide">Your uploads</p>
            <button onClick={() => ref.current?.click()} disabled={uploading}
              className="inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1.5 rounded-lg bg-slate-900 text-white hover:bg-slate-800 disabled:opacity-50">
              {uploading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Upload className="w-3.5 h-3.5" />} Upload
            </button>
            <input ref={ref} type="file" className="hidden" onChange={e => { onUpload(e.target.files[0]); e.target.value = '' }} />
          </div>
          {mine.length ? (
            <ul className="space-y-1.5">
              {mine.map(d => (
                <li key={d.id} className="flex items-center gap-2">
                  <FileText className="w-4 h-4 text-slate-400 shrink-0" />
                  <span className="text-sm text-slate-700 truncate flex-1">{d.file_name}</span>
                  <a href={portalDocUrl(d.id)} className="text-xs text-blue-600 hover:underline shrink-0">Download</a>
                  <button onClick={() => onDelete(d.id)} className="text-slate-300 hover:text-red-500 shrink-0"><Trash2 className="w-3.5 h-3.5" /></button>
                </li>
              ))}
            </ul>
          ) : <p className="text-sm text-slate-400">Nothing uploaded yet.</p>}
          <p className="text-[11px] text-amber-600 mt-2 flex items-start gap-1"><AlertCircle className="w-3 h-3 mt-0.5 shrink-0" /> This portal is new — please hold off on highly sensitive documents until Knox confirms the security review is complete.</p>
        </div>
      </div>
    </div>
  )
}

function PortalHome({ me }) {
  const [out, setOut]         = useState(false)
  const [pf, setPf]           = useState(null)
  const [loading, setLoading] = useState(true)
  const [view, setView]       = useState(null)     // 'cards' | 'list' (null = auto by count)
  const [selected, setSelected] = useState(null)   // clicked holding → detail

  useEffect(() => { portalPortfolio().then(setPf).catch(() => {}).finally(() => setLoading(false)) }, [])
  async function logout() { setOut(true); try { await portalLogout() } finally { window.location.href = '/portal' } }

  const s = pf?.summary
  const holdings = pf?.holdings || []
  const distributions = pf?.distributions || []

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="bg-white border-b border-slate-200">
        <div className="max-w-5xl mx-auto px-5 py-3 flex items-center justify-between">
          <Brandmark />
          <button onClick={logout} disabled={out} className="inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-800">
            {out ? <Loader2 className="w-4 h-4 animate-spin" /> : <LogOut className="w-4 h-4" />} Sign out
          </button>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-5 py-8 space-y-6">
        <div>
          <h1 className="text-xl font-bold text-slate-900">Welcome{me.name ? `, ${me.name.split(' ')[0]}` : ''}</h1>
          <p className="text-sm text-slate-500 mt-1">{me.investor?.name || me.email}</p>
        </div>

        {loading ? (
          <div className="flex justify-center py-16"><Loader2 className="w-6 h-6 text-slate-400 animate-spin" /></div>
        ) : !s ? (
          <div className="rounded-2xl border border-slate-200 bg-white p-8 text-center text-sm text-slate-500">We couldn't load your portfolio right now. Please try again shortly.</div>
        ) : (
          <>
            {/* Summary */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
              <Stat label="Total Invested"        value={fmt$(s.total_invested)} />
              <Stat label="Properties"            value={s.num_properties} />
              <Stat label="Distributions Received" value={fmt$(s.total_distributions)} tint="text-emerald-700" />
              <Stat label="Pref Return Owed"      value={fmt$(s.net_preferred_return_owed)} tint="text-amber-700" />
            </div>

            {/* Holdings */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <h2 className="text-sm font-semibold text-slate-700">Your Investments</h2>
                {holdings.length > 0 && (
                  <div className="flex items-center gap-1 bg-slate-100 rounded-lg p-0.5">
                    {[['cards', LayoutGrid, 'Cards'], ['list', ListIcon, 'List']].map(([v, Icon, label]) => {
                      const active = (view ?? (holdings.length <= 2 ? 'cards' : 'list')) === v
                      return (
                        <button key={v} onClick={() => setView(v)} title={label}
                          className={`p-1.5 rounded-md ${active ? 'bg-white shadow-sm text-slate-800' : 'text-slate-400 hover:text-slate-600'}`}>
                          <Icon className="w-4 h-4" />
                        </button>
                      )
                    })}
                  </div>
                )}
              </div>

              {holdings.length === 0 ? (
                <div className="rounded-2xl border border-slate-200 bg-white p-8 text-center text-sm text-slate-500">No investments are on file yet. If this looks wrong, contact Knox Capital.</div>
              ) : (view ?? (holdings.length <= 2 ? 'cards' : 'list')) === 'cards' ? (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {holdings.map(h => (
                    <button key={h.id} onClick={() => setSelected(h)}
                      className="text-left rounded-2xl border border-slate-200 bg-white p-5 hover:border-slate-300 hover:shadow-sm transition-all">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="text-sm font-semibold text-slate-900 truncate">{h.property.address}</p>
                          <p className="text-xs text-slate-400">{[h.property.city, h.property.state].filter(Boolean).join(', ')}{h.property.tenant_brand ? ` · ${h.property.tenant_brand}` : ''}</p>
                        </div>
                        {h.ownership_percentage != null && (
                          <span className="text-xs font-semibold bg-slate-100 text-slate-600 px-2 py-0.5 rounded-full shrink-0">{fmtPct(h.ownership_percentage)}</span>
                        )}
                      </div>
                      <div className="grid grid-cols-2 gap-x-4 gap-y-2 mt-4 text-sm">
                        <div><p className="text-[11px] text-slate-400">Invested</p><p className="font-medium text-slate-800 tabular-nums">{fmt$(h.contribution)}</p></div>
                        <div><p className="text-[11px] text-slate-400">Pref Rate</p><p className="font-medium text-slate-800">{h.preferred_return_rate != null ? fmtPct(h.preferred_return_rate) : '—'}</p></div>
                        <div><p className="text-[11px] text-slate-400">Distributions</p><p className="font-medium text-emerald-700 tabular-nums">{fmt$(h.distributions_received)}</p></div>
                        <div><p className="text-[11px] text-slate-400">Pref Owed</p><p className="font-medium text-amber-700 tabular-nums">{fmt$(h.net_preferred_return_owed)}</p></div>
                      </div>
                    </button>
                  ))}
                </div>
              ) : (
                <div className="rounded-2xl border border-slate-200 bg-white overflow-hidden">
                  <div className="overflow-x-auto">
                    <table className="min-w-full text-sm">
                      <thead className="bg-slate-50 border-b border-slate-100">
                        <tr>
                          <th className="text-left px-4 py-2 text-xs font-semibold text-slate-500 uppercase tracking-wide">Property</th>
                          <th className="text-right px-4 py-2 text-xs font-semibold text-slate-500 uppercase tracking-wide">Ownership</th>
                          <th className="text-right px-4 py-2 text-xs font-semibold text-slate-500 uppercase tracking-wide">Invested</th>
                          <th className="text-right px-4 py-2 text-xs font-semibold text-slate-500 uppercase tracking-wide">Distributions</th>
                          <th className="text-right px-4 py-2 text-xs font-semibold text-slate-500 uppercase tracking-wide">Pref Owed</th>
                          <th className="px-2 py-2" />
                        </tr>
                      </thead>
                      <tbody>
                        {holdings.map(h => (
                          <tr key={h.id} onClick={() => setSelected(h)} className="border-b border-slate-50 last:border-0 hover:bg-slate-50/60 cursor-pointer">
                            <td className="px-4 py-2.5">
                              <p className="font-medium text-slate-800">{h.property.address}</p>
                              <p className="text-xs text-slate-400">{[h.property.city, h.property.state].filter(Boolean).join(', ')}{h.property.tenant_brand ? ` · ${h.property.tenant_brand}` : ''}</p>
                            </td>
                            <td className="px-4 py-2.5 text-right text-slate-600">{h.ownership_percentage != null ? fmtPct(h.ownership_percentage) : '—'}</td>
                            <td className="px-4 py-2.5 text-right tabular-nums text-slate-800">{fmt$(h.contribution)}</td>
                            <td className="px-4 py-2.5 text-right tabular-nums text-emerald-700">{fmt$(h.distributions_received)}</td>
                            <td className="px-4 py-2.5 text-right tabular-nums text-amber-700">{fmt$(h.net_preferred_return_owed)}</td>
                            <td className="px-2 py-2.5 text-slate-300"><ChevronRight className="w-4 h-4" /></td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>

            {/* Distributions */}
            {distributions.length > 0 && (
              <div>
                <h2 className="text-sm font-semibold text-slate-700 mb-2">Distributions</h2>
                <div className="rounded-2xl border border-slate-200 bg-white overflow-hidden">
                  <table className="min-w-full text-sm">
                    <thead className="bg-slate-50 border-b border-slate-100">
                      <tr>
                        <th className="text-left px-4 py-2 text-xs font-semibold text-slate-500 uppercase tracking-wide">Date</th>
                        <th className="text-left px-4 py-2 text-xs font-semibold text-slate-500 uppercase tracking-wide">Property</th>
                        <th className="text-left px-4 py-2 text-xs font-semibold text-slate-500 uppercase tracking-wide">Type</th>
                        <th className="text-right px-4 py-2 text-xs font-semibold text-slate-500 uppercase tracking-wide">Amount</th>
                      </tr>
                    </thead>
                    <tbody>
                      {distributions.map(d => (
                        <tr key={d.id} className="border-b border-slate-50 last:border-0">
                          <td className="px-4 py-2 text-slate-600 whitespace-nowrap">{fmtDate(d.date)}</td>
                          <td className="px-4 py-2 text-slate-700">{d.property ? `${d.property.address}${d.property.city ? `, ${d.property.city}` : ''}` : '—'}</td>
                          <td className="px-4 py-2 text-slate-500">{d.type || '—'}</td>
                          <td className="px-4 py-2 text-right font-medium text-emerald-700 tabular-nums">{fmt$(d.amount)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            <PortalDocuments />

            <p className="text-[11px] text-slate-400 text-center pt-2">Figures are for your information and may not reflect the most recent activity. Contact Knox Capital with any questions.</p>
          </>
        )}
      </main>

      {selected && <HoldingDetail h={selected} onClose={() => setSelected(null)} />}
    </div>
  )
}

// Detail overlay for a single investment (more info to come).
function HoldingDetail({ h, onClose }) {
  const rows = [
    ['Ownership', h.ownership_percentage != null ? fmtPct(h.ownership_percentage) : '—'],
    ['Amount Invested', fmt$(h.contribution)],
    ['Preferred Return Rate', h.preferred_return_rate != null ? fmtPct(h.preferred_return_rate) : '—'],
    ['Distributions Received', fmt$(h.distributions_received)],
    ['Preferred Return Owed', fmt$(h.net_preferred_return_owed)],
  ]
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md" onClick={e => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-3 px-5 py-4 border-b border-slate-100">
          <div className="min-w-0">
            <p className="text-base font-bold text-slate-900 truncate">{h.property.address}</p>
            <p className="text-xs text-slate-400">{[h.property.city, h.property.state].filter(Boolean).join(', ')}{h.property.tenant_brand ? ` · ${h.property.tenant_brand}` : ''}</p>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 p-1 rounded-lg hover:bg-slate-100 shrink-0"><X className="w-4 h-4" /></button>
        </div>
        <div className="px-5 py-4">
          <dl className="divide-y divide-slate-100">
            {rows.map(([label, val]) => (
              <div key={label} className="flex items-center justify-between py-2.5">
                <dt className="text-sm text-slate-500">{label}</dt>
                <dd className="text-sm font-medium text-slate-800 tabular-nums">{val}</dd>
              </div>
            ))}
          </dl>
          <p className="text-[11px] text-slate-400 mt-3">More property details and documents will appear here soon.</p>
        </div>
      </div>
    </div>
  )
}

// ── Route entry: decides login vs home ────────────────────────────────────────
export default function InvestorPortal() {
  const [state, setState] = useState('loading') // loading | authed | anon
  const [me, setMe] = useState(null)
  useEffect(() => { portalMe().then(m => { setMe(m); setState('authed') }).catch(() => setState('anon')) }, [])
  if (state === 'loading') return <div className="min-h-screen bg-slate-50 flex items-center justify-center"><Loader2 className="w-6 h-6 text-slate-400 animate-spin" /></div>
  if (state === 'authed') return <PortalHome me={me} />
  return <PortalLogin />
}

export { PortalAccept }
