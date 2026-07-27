// Investor Portal — a separate front-end surface with its own auth (Google +
// password), isolated from the CRM. Phase 1: login, invite-accept, and a home
// that proves the isolated session. Investment views come in Phase 2.
import { useState, useEffect, useRef } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Building2, Loader2, LogOut, AlertCircle, Lock, FileText, Download, Upload, Trash2, X, ChevronRight, PieChart, Wallet, TrendingUp, ArrowLeftRight, User, Mail, Menu, HandCoins, Landmark, CircleDollarSign } from 'lucide-react'
import {
  portalMe, portalPortfolio, portalPasswordLogin, portalInviteInfo, portalAccept, portalLogout, portalGoogleStartUrl,
  portalDocuments, portalDocUrl, uploadPortalDoc, deletePortalDoc, portalUpdateProfile, portalChangeEmail,
} from '../../api/client'

const fmt$ = (n) => (n == null) ? '—' : '$' + Math.round(Number(n)).toLocaleString()
const money = (n) => (n == null || n === '') ? '—' : Number(n).toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 })
const fmtDate = (d) => d ? new Date(String(d).length === 10 ? d + 'T12:00:00' : d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—'
const fmtPct = (n) => (n == null || n === '') ? '—' : `${Number(n).toFixed(2)}%`
const initials = (name = '') => name.trim().split(/\s+/).slice(0, 2).map(w => w[0]?.toUpperCase() || '').join('') || '•'

// Allocation palette (premium teal→indigo→amber spread).
const PALETTE = ['#059669', '#0d9488', '#0ea5e9', '#6366f1', '#f59e0b', '#8b5cf6', '#ec4899', '#64748b']

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

// A single KPI tile.
function Kpi({ icon: Icon, label, value, accent = 'text-slate-900', chip = 'bg-slate-100 text-slate-500' }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4">
      <div className="flex items-center gap-2 mb-2.5">
        <div className={`w-7 h-7 rounded-lg flex items-center justify-center ${chip}`}><Icon className="w-4 h-4" /></div>
        <p className="text-[10.5px] font-semibold text-slate-400 uppercase tracking-wider">{label}</p>
      </div>
      <p className={`text-xl font-bold tabular-nums ${accent}`}>{value}</p>
    </div>
  )
}

// Dependency-free SVG donut. segments: [{ value, color }].
function Donut({ segments, size = 168, thickness = 24 }) {
  const total = segments.reduce((s, x) => s + x.value, 0)
  const r = (size - thickness) / 2
  const c = 2 * Math.PI * r
  let offset = 0
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="shrink-0">
      <g transform={`rotate(-90 ${size / 2} ${size / 2})`}>
        {total === 0 ? (
          <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#e2e8f0" strokeWidth={thickness} />
        ) : segments.map((seg, i) => {
          const len = (seg.value / total) * c
          const el = (
            <circle key={i} cx={size / 2} cy={size / 2} r={r} fill="none" stroke={seg.color}
              strokeWidth={thickness} strokeDasharray={`${len} ${c - len}`} strokeDashoffset={-offset}
              strokeLinecap="butt" />
          )
          offset += len
          return el
        })}
      </g>
    </svg>
  )
}

// Trailing-8-quarter buckets from the distributions list.
function buildQuarters(distributions, count = 8) {
  const now = new Date()
  const seq = []
  let cy = now.getUTCFullYear(), cq = Math.floor(now.getUTCMonth() / 3)
  for (let i = 0; i < count; i++) { seq.unshift({ y: cy, q: cq }); cq--; if (cq < 0) { cq = 3; cy-- } }
  const map = {}
  seq.forEach(s => { map[`${s.y}-${s.q}`] = 0 })
  for (const d of distributions) {
    if (!d.date) continue
    const dt = new Date(String(d.date).length <= 10 ? d.date + 'T00:00:00Z' : d.date)
    if (isNaN(dt)) continue
    const k = `${dt.getUTCFullYear()}-${Math.floor(dt.getUTCMonth() / 3)}`
    if (k in map) map[k] += Number(d.amount) || 0
  }
  return seq.map(s => ({ label: `Q${s.q + 1} '${String(s.y).slice(2)}`, value: map[`${s.y}-${s.q}`] }))
}

function BarChart({ bars }) {
  const max = Math.max(1, ...bars.map(b => b.value))
  const any = bars.some(b => b.value > 0)
  if (!any) return (
    <div className="h-44 flex items-center justify-center text-center text-sm text-slate-400 px-6">
      No distributions in the last two years. When you receive one, it'll appear here.
    </div>
  )
  return (
    <div className="flex items-end gap-2 h-44 px-1">
      {bars.map((b, i) => (
        <div key={i} className="flex-1 flex flex-col items-center min-w-0 h-full">
          <div className="relative w-full flex-1 flex items-end justify-center">
            <div className="w-full max-w-[26px] rounded-t bg-emerald-500 hover:bg-emerald-600 transition-colors"
              style={{ height: b.value > 0 ? `${Math.max(3, (b.value / max) * 100)}%` : '0' }}
              title={money(b.value)} />
          </div>
          <span className="text-[9px] text-slate-400 mt-1.5 truncate w-full text-center">{b.label}</span>
        </div>
      ))}
    </div>
  )
}

// Left-nav contents, shared by the desktop rail and the mobile drawer.
function NavContent({ section, go, onLogout, out }) {
  const main = [
    ['investments', 'My Investments', PieChart],
    ['transactions', 'Transactions', ArrowLeftRight],
    ['documents', 'Documents', FileText],
  ]
  const foot = [
    ['account', 'Account', User],
    ['contact', 'Contact Us', Mail],
  ]
  const Item = ([id, label, Icon]) => (
    <button key={id} onClick={() => go(id)}
      className={`flex items-center gap-3 w-full px-3 py-2.5 rounded-xl text-sm font-medium transition-colors ${
        section === id ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-100'
      }`}>
      <Icon className="w-4 h-4 shrink-0" /> {label}
    </button>
  )
  return (
    <div className="flex flex-col h-full">
      <div className="px-5 py-5"><Brandmark /></div>
      <nav className="flex-1 px-3 space-y-1">
        {main.map(Item)}
        <div className="h-px bg-slate-100 my-3 mx-2" />
        {foot.map(Item)}
      </nav>
      <div className="p-3 border-t border-slate-100">
        <button onClick={onLogout} disabled={out}
          className="flex items-center gap-3 w-full px-3 py-2.5 rounded-xl text-sm font-medium text-slate-500 hover:bg-slate-100 disabled:opacity-50">
          {out ? <Loader2 className="w-4 h-4 animate-spin" /> : <LogOut className="w-4 h-4" />} Sign out
        </button>
      </div>
    </div>
  )
}

// A property thumbnail placeholder (portal has no access to CRM photos).
function Thumb() {
  return (
    <div className="w-11 h-11 rounded-lg bg-gradient-to-br from-slate-700 to-slate-900 flex items-center justify-center shrink-0">
      <Building2 className="w-5 h-5 text-white/80" />
    </div>
  )
}

function InvestmentsSection({ pf, onSelect }) {
  const s = pf.summary
  const holdings = pf.holdings || []
  const distributions = pf.distributions || []

  const segments = holdings.map((h, i) => ({
    label: h.property.tenant_brand || h.property.address,
    value: Number(h.contribution) || 0,
    color: PALETTE[i % PALETTE.length],
  }))
  const totalAlloc = segments.reduce((a, x) => a + x.value, 0)
  const quarters = buildQuarters(distributions)

  return (
    <div className="space-y-6">
      {/* KPI row */}
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-5 gap-3">
        <Kpi icon={Wallet}            label="Total Funded"     value={money(s.total_funded)} chip="bg-slate-100 text-slate-600" />
        <Kpi icon={HandCoins}         label="Distributions"    value={money(s.total_distributions)} accent="text-emerald-700" chip="bg-emerald-50 text-emerald-600" />
        <Kpi icon={Landmark}          label="Return of Capital" value={money(s.return_of_capital)} chip="bg-sky-50 text-sky-600" />
        <Kpi icon={CircleDollarSign}  label="Balance"          value={money(s.balance)} chip="bg-indigo-50 text-indigo-600" />
        <Kpi icon={TrendingUp}        label="Pref Return Owed" value={money(s.net_preferred_return_owed)} accent="text-amber-700" chip="bg-amber-50 text-amber-600" />
      </div>

      {/* Portfolio + distributions */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="rounded-2xl border border-slate-200 bg-white p-5">
          <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-4">Portfolio Allocation</p>
          {holdings.length === 0 ? (
            <p className="text-sm text-slate-400 py-10 text-center">No investments yet.</p>
          ) : (
            <div className="flex items-center gap-5">
              <div className="relative">
                <Donut segments={segments} />
                <div className="absolute inset-0 flex flex-col items-center justify-center">
                  <p className="text-[10px] text-slate-400 uppercase tracking-wide">Funded</p>
                  <p className="text-base font-bold text-slate-900 tabular-nums">{fmt$(totalAlloc)}</p>
                </div>
              </div>
              <ul className="flex-1 space-y-2 min-w-0">
                {segments.map((seg, i) => (
                  <li key={i} className="flex items-center gap-2 text-sm min-w-0">
                    <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: seg.color }} />
                    <span className="text-slate-600 truncate flex-1">{seg.label}</span>
                    <span className="text-slate-400 tabular-nums shrink-0">{totalAlloc ? Math.round((seg.value / totalAlloc) * 100) : 0}%</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-5">
          <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-4">Distributions · Trailing 2 Years</p>
          <BarChart bars={quarters} />
        </div>
      </div>

      {/* Investment overview table */}
      <div>
        <p className="text-sm font-semibold text-slate-700 mb-2">Investment Overview</p>
        {holdings.length === 0 ? (
          <div className="rounded-2xl border border-slate-200 bg-white p-8 text-center text-sm text-slate-500">No investments are on file yet. If this looks wrong, contact Knox Capital.</div>
        ) : (
          <div className="rounded-2xl border border-slate-200 bg-white overflow-hidden">
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead className="bg-slate-50 border-b border-slate-100">
                  <tr>
                    <th className="text-left px-4 py-2.5 text-[11px] font-semibold text-slate-500 uppercase tracking-wide">Offering</th>
                    <th className="text-right px-4 py-2.5 text-[11px] font-semibold text-slate-500 uppercase tracking-wide">Funded</th>
                    <th className="text-right px-4 py-2.5 text-[11px] font-semibold text-slate-500 uppercase tracking-wide">Distributions</th>
                    <th className="text-right px-4 py-2.5 text-[11px] font-semibold text-slate-500 uppercase tracking-wide">Return of Capital</th>
                    <th className="text-right px-4 py-2.5 text-[11px] font-semibold text-slate-500 uppercase tracking-wide">Balance</th>
                    <th className="px-2" />
                  </tr>
                </thead>
                <tbody>
                  {holdings.map(h => (
                    <tr key={h.id} onClick={() => onSelect(h)} className="border-b border-slate-50 last:border-0 hover:bg-slate-50/70 cursor-pointer">
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-3">
                          <Thumb />
                          <div className="min-w-0">
                            <p className="font-semibold text-slate-800 truncate">{h.property.tenant_brand || h.property.address}</p>
                            <p className="text-xs text-slate-400 truncate">{[h.property.city, h.property.state].filter(Boolean).join(', ')}</p>
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-right whitespace-nowrap">
                        <p className="tabular-nums text-slate-800">{money(h.contribution)}</p>
                        <p className="text-[11px] text-slate-400">{fmtDate(h.funded_date)}</p>
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums text-emerald-700">{money(h.distributions_received)}</td>
                      <td className="px-4 py-3 text-right tabular-nums text-slate-600">{money(h.return_of_capital)}</td>
                      <td className="px-4 py-3 text-right tabular-nums font-medium text-slate-800">{money(h.balance)}</td>
                      <td className="px-2 py-3 text-slate-300"><ChevronRight className="w-4 h-4" /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

function TransactionsSection({ pf }) {
  const [tab, setTab] = useState('distributions')
  const distributions = pf.distributions || []
  const holdings = pf.holdings || []
  const s = pf.summary || {}

  return (
    <div>
      {/* Sub-tabs */}
      <div className="flex items-center gap-6 border-b border-slate-200 mb-5">
        {[['distributions', 'Distributions'], ['contributions', 'Contributions']].map(([id, label]) => (
          <button key={id} onClick={() => setTab(id)}
            className={`-mb-px pb-2.5 text-sm font-medium border-b-2 transition-colors ${
              tab === id ? 'border-slate-900 text-slate-900' : 'border-transparent text-slate-400 hover:text-slate-600'
            }`}>
            {label}
          </button>
        ))}
      </div>

      {tab === 'distributions' ? (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-4">
            <div className="rounded-2xl border border-slate-200 bg-slate-50 px-5 py-4">
              <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">Invested All-Time</p>
              <p className="text-xl font-bold text-slate-900 tabular-nums mt-0.5">{money(s.total_funded)}</p>
            </div>
            <div className="rounded-2xl border border-slate-200 bg-slate-50 px-5 py-4">
              <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">Return of Capital</p>
              <p className="text-xl font-bold text-slate-900 tabular-nums mt-0.5">{money(s.return_of_capital)}</p>
            </div>
          </div>
          {distributions.length === 0 ? (
            <div className="rounded-2xl border border-slate-200 bg-white p-8 text-center text-sm text-slate-500">No distributions yet. They'll appear here as they're paid.</div>
          ) : (
            <div className="rounded-2xl border border-slate-200 bg-white overflow-hidden">
              <div className="overflow-x-auto">
                <table className="min-w-full text-sm">
                  <thead className="bg-slate-50 border-b border-slate-100">
                    <tr>
                      <th className="text-left px-4 py-2.5 text-[11px] font-semibold text-slate-500 uppercase tracking-wide">Offering</th>
                      <th className="text-left px-4 py-2.5 text-[11px] font-semibold text-slate-500 uppercase tracking-wide">Date</th>
                      <th className="text-left px-4 py-2.5 text-[11px] font-semibold text-slate-500 uppercase tracking-wide">Type</th>
                      <th className="text-left px-4 py-2.5 text-[11px] font-semibold text-slate-500 uppercase tracking-wide">Memo</th>
                      <th className="text-right px-4 py-2.5 text-[11px] font-semibold text-slate-500 uppercase tracking-wide">Amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    {distributions.map(d => (
                      <tr key={d.id} className="border-b border-slate-50 last:border-0">
                        <td className="px-4 py-2.5 text-slate-700">{d.property ? d.property.address : '—'}</td>
                        <td className="px-4 py-2.5 text-slate-600 whitespace-nowrap">{fmtDate(d.date)}</td>
                        <td className="px-4 py-2.5">
                          <span className={`text-[11px] font-medium px-2 py-0.5 rounded-full ${
                            d.type === 'Principal' ? 'bg-sky-50 text-sky-700' : d.type === 'Profit' ? 'bg-violet-50 text-violet-700' : 'bg-emerald-50 text-emerald-700'
                          }`}>{d.type === 'Principal' ? 'Return of Capital' : d.type || '—'}</span>
                        </td>
                        <td className="px-4 py-2.5 text-slate-500 max-w-[240px] truncate">{d.notes || '—'}</td>
                        <td className="px-4 py-2.5 text-right font-medium text-emerald-700 tabular-nums">{money(d.amount)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      ) : (
        holdings.length === 0 ? (
          <div className="rounded-2xl border border-slate-200 bg-white p-8 text-center text-sm text-slate-500">No contributions on file.</div>
        ) : (
          <div className="rounded-2xl border border-slate-200 bg-white overflow-hidden">
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead className="bg-slate-50 border-b border-slate-100">
                  <tr>
                    <th className="text-left px-4 py-2.5 text-[11px] font-semibold text-slate-500 uppercase tracking-wide">Offering</th>
                    <th className="text-left px-4 py-2.5 text-[11px] font-semibold text-slate-500 uppercase tracking-wide">Date</th>
                    <th className="text-right px-4 py-2.5 text-[11px] font-semibold text-slate-500 uppercase tracking-wide">Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {holdings.map(h => (
                    <tr key={h.id} className="border-b border-slate-50 last:border-0">
                      <td className="px-4 py-2.5 text-slate-700">{h.property.tenant_brand || h.property.address}</td>
                      <td className="px-4 py-2.5 text-slate-600 whitespace-nowrap">{fmtDate(h.funded_date)}</td>
                      <td className="px-4 py-2.5 text-right font-medium text-slate-800 tabular-nums">{money(h.contribution)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )
      )}
    </div>
  )
}

function Field({ label, value, onChange, placeholder, className = '' }) {
  return (
    <label className={`block ${className}`}>
      <span className="block text-[11px] font-semibold text-slate-400 uppercase tracking-wide mb-1">{label}</span>
      <input value={value ?? ''} onChange={e => onChange(e.target.value)} placeholder={placeholder}
        className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-slate-400" />
    </label>
  )
}

function AccountSection({ me, onLogout, out }) {
  const p = me.profile || {}
  const [form, setForm]   = useState({ name: me.name || p.name || '', phone: p.phone || '', address: p.address || '', city: p.city || '', state: p.state || '', zip: p.zip || '' })
  const [saving, setSaving] = useState(false)
  const [note, setNote]   = useState(null)   // { type, text }
  const set = (k) => (v) => setForm(f => ({ ...f, [k]: v }))

  // Email change
  const [email, setEmail]       = useState(me.email || '')
  const [pending, setPending]   = useState(me.pending_email || null)
  const [emailBusy, setEmailBusy] = useState(false)
  const [emailNote, setEmailNote] = useState(null)

  async function saveProfile() {
    setSaving(true); setNote(null)
    try { await portalUpdateProfile(form); setNote({ type: 'ok', text: 'Your information has been updated.' }) }
    catch (e) { setNote({ type: 'err', text: e.message }) }
    finally { setSaving(false) }
  }
  async function changeEmail() {
    setEmailBusy(true); setEmailNote(null)
    try {
      const r = await portalChangeEmail(email.trim())
      setPending(r.pending_email)
      setEmailNote({ type: 'ok', text: `We sent a confirmation link to ${r.pending_email}. Click it to finish — your email won't change until you do.` })
    } catch (e) { setEmailNote({ type: 'err', text: e.message }) }
    finally { setEmailBusy(false) }
  }

  return (
    <div className="max-w-xl space-y-5">
      {/* Identity header */}
      <div className="flex items-center gap-3">
        <div className="w-12 h-12 rounded-full bg-slate-900 text-white flex items-center justify-center text-base font-bold">{initials(me.name || me.email)}</div>
        <div>
          <p className="text-base font-bold text-slate-900">{me.name || me.email}</p>
          <p className="text-xs text-slate-400">{me.investor?.name ? `${me.investor.name} · ` : ''}Knox Capital Investor Portal</p>
        </div>
      </div>

      {/* Contact info */}
      <div className="rounded-2xl border border-slate-200 bg-white p-5">
        <p className="text-sm font-semibold text-slate-700 mb-4">Your Information</p>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Name"  value={form.name}  onChange={set('name')}  className="col-span-2" />
          <Field label="Phone" value={form.phone} onChange={set('phone')} className="col-span-2" placeholder="(555) 555-5555" />
          <Field label="Mailing Address" value={form.address} onChange={set('address')} className="col-span-2" placeholder="123 Main St" />
          <Field label="City"  value={form.city}  onChange={set('city')} />
          <div className="grid grid-cols-2 gap-3">
            <Field label="State" value={form.state} onChange={set('state')} />
            <Field label="ZIP"   value={form.zip}   onChange={set('zip')} />
          </div>
        </div>
        {note && <p className={`text-xs mt-3 ${note.type === 'err' ? 'text-red-600' : 'text-emerald-600'}`}>{note.text}</p>}
        <div className="mt-4">
          <button onClick={saveProfile} disabled={saving}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-slate-900 text-white text-sm font-medium hover:bg-slate-800 disabled:opacity-50">
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : null} Save changes
          </button>
        </div>
      </div>

      {/* Email */}
      <div className="rounded-2xl border border-slate-200 bg-white p-5">
        <p className="text-sm font-semibold text-slate-700 mb-1">Email Address</p>
        <p className="text-xs text-slate-400 mb-4">Changing your email requires confirming it — we'll send a link to the new address.</p>
        {pending && (
          <div className="flex items-start gap-2 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 mb-3">
            <AlertCircle className="w-3.5 h-3.5 mt-0.5 shrink-0" /> Pending confirmation: <span className="font-medium">{pending}</span>. Check that inbox for the link.
          </div>
        )}
        <div className="flex flex-col sm:flex-row gap-2">
          <input type="email" value={email} onChange={e => setEmail(e.target.value)}
            className="flex-1 px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-slate-400" />
          <button onClick={changeEmail} disabled={emailBusy || !email.trim() || email.trim().toLowerCase() === (me.email || '').toLowerCase()}
            className="inline-flex items-center justify-center gap-2 px-4 py-2 rounded-xl border border-slate-300 text-slate-700 text-sm font-medium hover:bg-slate-50 disabled:opacity-50 shrink-0">
            {emailBusy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Mail className="w-4 h-4" />} Send confirmation
          </button>
        </div>
        {emailNote && <p className={`text-xs mt-3 ${emailNote.type === 'err' ? 'text-red-600' : 'text-emerald-600'}`}>{emailNote.text}</p>}
      </div>

      <button onClick={onLogout} disabled={out}
        className="inline-flex items-center gap-2 text-sm font-medium text-slate-500 hover:text-red-600 disabled:opacity-50">
        {out ? <Loader2 className="w-4 h-4 animate-spin" /> : <LogOut className="w-4 h-4" />} Sign out
      </button>
    </div>
  )
}

function ContactSection() {
  return (
    <div className="max-w-lg">
      <div className="rounded-2xl border border-slate-200 bg-white p-6">
        <div className="w-11 h-11 rounded-xl bg-slate-900 flex items-center justify-center mb-4"><Mail className="w-5 h-5 text-white" /></div>
        <p className="text-base font-bold text-slate-900">Contact Knox Capital</p>
        <p className="text-sm text-slate-500 mt-1 mb-4">Questions about your investments, distributions, or documents? We're happy to help.</p>
        <a href="mailto:management@knoxcre.com"
          className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-slate-900 text-white text-sm font-medium hover:bg-slate-800">
          <Mail className="w-4 h-4" /> management@knoxcre.com
        </a>
      </div>
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
      <div className="rounded-2xl border border-slate-200 bg-white divide-y divide-slate-100"
        onDragOver={e => e.preventDefault()}
        onDrop={e => { e.preventDefault(); if (!uploading) onUpload(e.dataTransfer.files?.[0]) }}
      >
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

const SECTION_TITLES = {
  investments: 'My Investments',
  transactions: 'Transactions',
  documents: 'Documents',
  account: 'Account',
  contact: 'Contact Us',
}

function PortalHome({ me }) {
  const [out, setOut]         = useState(false)
  const [pf, setPf]           = useState(null)
  const [loading, setLoading] = useState(true)
  const [section, setSection] = useState('investments')
  const [navOpen, setNavOpen] = useState(false)   // mobile drawer
  const [selected, setSelected] = useState(null)  // clicked holding → detail

  const [emailFlash, setEmailFlash] = useState(null)

  useEffect(() => { portalPortfolio().then(setPf).catch(() => {}).finally(() => setLoading(false)) }, [])
  useEffect(() => {
    const v = new URLSearchParams(window.location.search).get('email')
    if (!v) return
    const map = {
      confirmed: { type: 'ok',  text: 'Your email address has been confirmed and updated.' },
      invalid:   { type: 'err', text: 'That confirmation link is invalid or has expired. Please request a new one.' },
      taken:     { type: 'err', text: 'That email is already in use, so the change was cancelled.' },
    }
    if (map[v]) { setEmailFlash(map[v]); setSection('account') }
    window.history.replaceState({}, '', '/portal')
  }, [])
  async function logout() { setOut(true); try { await portalLogout() } finally { window.location.href = '/portal' } }
  const go = (id) => { setSection(id); setNavOpen(false) }

  function Body() {
    if (loading) return <div className="flex justify-center py-24"><Loader2 className="w-6 h-6 text-slate-400 animate-spin" /></div>
    if (section === 'documents')    return <PortalDocuments />
    if (section === 'account')      return <AccountSection me={me} onLogout={logout} out={out} />
    if (section === 'contact')      return <ContactSection />
    if (!pf?.summary) return <div className="rounded-2xl border border-slate-200 bg-white p-8 text-center text-sm text-slate-500">We couldn't load your portfolio right now. Please try again shortly.</div>
    if (section === 'transactions') return <TransactionsSection pf={pf} />
    return <InvestmentsSection pf={pf} onSelect={setSelected} />
  }

  return (
    <div className="min-h-screen bg-slate-50">
      {/* Desktop rail */}
      <aside className="hidden lg:flex flex-col fixed inset-y-0 left-0 w-60 bg-white border-r border-slate-200 z-30">
        <NavContent section={section} go={go} onLogout={logout} out={out} />
      </aside>

      {/* Mobile drawer */}
      {navOpen && (
        <div className="lg:hidden fixed inset-0 z-40">
          <div className="absolute inset-0 bg-black/40" onClick={() => setNavOpen(false)} />
          <div className="absolute inset-y-0 left-0 w-64 bg-white shadow-xl">
            <button onClick={() => setNavOpen(false)} className="absolute top-4 right-4 text-slate-400 hover:text-slate-600"><X className="w-5 h-5" /></button>
            <NavContent section={section} go={go} onLogout={logout} out={out} />
          </div>
        </div>
      )}

      <div className="lg:pl-60">
        {/* Top bar */}
        <header className="sticky top-0 z-20 bg-white/80 backdrop-blur border-b border-slate-200">
          <div className="flex items-center justify-between px-4 lg:px-8 h-16">
            <div className="flex items-center gap-3">
              <button onClick={() => setNavOpen(true)} className="lg:hidden text-slate-500 hover:text-slate-800"><Menu className="w-5 h-5" /></button>
              <h1 className="text-lg font-bold text-slate-900">{SECTION_TITLES[section]}</h1>
            </div>
            <button onClick={() => go('account')} className="flex items-center gap-2 rounded-full pl-1 pr-3 py-1 hover:bg-slate-100 transition-colors">
              <span className="w-8 h-8 rounded-full bg-slate-900 text-white flex items-center justify-center text-xs font-bold">{initials(me.name || me.email)}</span>
              <span className="hidden sm:block text-sm font-medium text-slate-700 max-w-[160px] truncate">{me.name || me.email}</span>
            </button>
          </div>
        </header>

        <main className="max-w-6xl mx-auto px-4 lg:px-8 py-6">
          {emailFlash && (
            <div className={`flex items-start gap-2 text-sm rounded-xl px-4 py-3 mb-5 border ${
              emailFlash.type === 'err' ? 'bg-red-50 border-red-200 text-red-700' : 'bg-emerald-50 border-emerald-200 text-emerald-700'
            }`}>
              <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" /> {emailFlash.text}
            </div>
          )}
          <Body />
          <p className="text-[11px] text-slate-400 text-center pt-8">Figures are for your information and may not reflect the most recent activity. Contact Knox Capital with any questions.</p>
        </main>
      </div>

      {selected && <HoldingDetail h={selected} onClose={() => setSelected(null)} />}
    </div>
  )
}

// Detail overlay for a single investment (more info to come).
function HoldingDetail({ h, onClose }) {
  const rows = [
    ['Funded', money(h.contribution)],
    ['Funded Date', fmtDate(h.funded_date)],
    ['Ownership', h.ownership_percentage != null ? fmtPct(h.ownership_percentage) : '—'],
    ['Preferred Return Rate', h.preferred_return_rate != null ? fmtPct(h.preferred_return_rate) : '—'],
    ['Distributions Received', money(h.distributions_received)],
    ['Return of Capital', money(h.return_of_capital)],
    ['Balance', money(h.balance)],
    ['Preferred Return Owed', money(h.net_preferred_return_owed)],
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
