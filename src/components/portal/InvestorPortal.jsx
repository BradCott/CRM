// Investor Portal — a separate front-end surface with its own auth (Google +
// password), isolated from the CRM. Phase 1: login, invite-accept, and a home
// that proves the isolated session. Investment views come in Phase 2.
import { useState, useEffect } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Building2, Loader2, LogOut, AlertCircle, Lock } from 'lucide-react'
import {
  portalMe, portalPasswordLogin, portalInviteInfo, portalAccept, portalLogout, portalGoogleStartUrl,
} from '../../api/client'

const ERRORS = {
  not_invited: "That Google account isn't on the invite list. Sign in with the exact email Knox invited, or contact Knox for access.",
  state:       'Your sign-in attempt expired — please try again.',
  google:      'Google sign-in failed — please try again.',
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
function PortalHome({ me }) {
  const [out, setOut] = useState(false)
  async function logout() { setOut(true); try { await portalLogout() } finally { window.location.href = '/portal' } }
  return (
    <div className="min-h-screen bg-slate-50">
      <header className="bg-white border-b border-slate-200">
        <div className="max-w-4xl mx-auto px-5 py-3 flex items-center justify-between">
          <Brandmark />
          <button onClick={logout} disabled={out} className="inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-800">
            {out ? <Loader2 className="w-4 h-4 animate-spin" /> : <LogOut className="w-4 h-4" />} Sign out
          </button>
        </div>
      </header>
      <main className="max-w-4xl mx-auto px-5 py-8">
        <h1 className="text-xl font-bold text-slate-900">Welcome{me.name ? `, ${me.name.split(' ')[0]}` : ''}</h1>
        <p className="text-sm text-slate-500 mt-1">
          Signed in as {me.email}{me.investor?.name ? ` · ${me.investor.name}` : ''}
        </p>

        <div className="mt-6 rounded-2xl border border-slate-200 bg-white p-8 text-center">
          <div className="w-12 h-12 rounded-2xl bg-slate-100 flex items-center justify-center mx-auto mb-3">
            <Building2 className="w-6 h-6 text-slate-400" />
          </div>
          <p className="text-base font-semibold text-slate-800">Your investor dashboard is on the way</p>
          <p className="text-sm text-slate-500 mt-1 max-w-md mx-auto">
            Your holdings, capital account, distributions, and documents will appear here shortly. Thanks for being an investor with Knox Capital.
          </p>
        </div>
      </main>
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
