import { useState, useEffect } from 'react'
import { useParams, useNavigate, useSearchParams } from 'react-router-dom'
import { AlertCircle, CheckCircle, Loader2 } from 'lucide-react'
import { useAuth } from '../../context/AuthContext'
import knoxLogo from '../../assets/Knox.png'

const ROLE_LABELS = {
  admin:        'Admin',
  full_agent:   'Full Agent',
  junior_agent: 'Junior Agent',
}

const GOOGLE_ERROR_MESSAGES = {
  google_cancelled:     'Google sign-in was cancelled.',
  google_failed:        'Google sign-in failed. Please try again.',
  invite_invalid:       'This invitation link is invalid.',
  invite_used:          'This invitation has already been used.',
  google_email_mismatch: 'The Google account email does not match your invitation. Please use the email address you were invited with.',
  signup_not_allowed:   'Signup is only available for the first user. Contact your admin for an invitation.',
}

export default function SignupPage() {
  const { token }          = useParams()   // invite token from URL, may be undefined
  const [searchParams]     = useSearchParams()
  const navigate           = useNavigate()
  const { login }          = useAuth()

  const [invite, setInvite]       = useState(null)
  const [checking, setChecking]   = useState(!!token)
  const [inviteError, setInviteError] = useState(null)

  // Controlled form fields
  const [email, setEmail]       = useState('')  // only for first-user bootstrap
  const [name, setName]         = useState('')
  const [password, setPassword] = useState('')
  const [password2, setPassword2] = useState('')
  const [saving, setSaving]     = useState(false)
  const [error, setError]       = useState(
    searchParams.get('error') ? GOOGLE_ERROR_MESSAGES[searchParams.get('error')] || 'An error occurred.' : null
  )

  // Verify invite token on mount (skip for first-user bootstrap)
  useEffect(() => {
    if (!token) return
    fetch(`/api/auth/invite/${token}`)
      .then(r => r.json())
      .then(data => {
        if (data.error) setInviteError(data.error)
        else setInvite(data)
      })
      .catch(() => setInviteError('Could not verify invitation.'))
      .finally(() => setChecking(false))
  }, [token])

  async function handleSubmit(e) {
    e.preventDefault()
    setError(null)

    if (password !== password2) { setError('Passwords do not match.'); return }
    if (password.length < 8)    { setError('Password must be at least 8 characters.'); return }

    setSaving(true)
    try {
      const body = token
        ? { token, name, password }
        : { name, email, password }

      const res = await fetch('/api/auth/signup', {
        method:      'POST',
        credentials: 'include',
        headers:     { 'Content-Type': 'application/json' },
        body:        JSON.stringify(body),
      })
      const data = await res.json()
      if (!res.ok) setError(data.error || 'Signup failed.')
      else { login(data.user); navigate('/dashboard', { replace: true }) }
    } catch {
      setError('Could not connect to the server.')
    } finally {
      setSaving(false)
    }
  }

  // Google signup URL — carries the invite token (or empty for first-user)
  const googleSignupHref = token
    ? `/api/auth/google/signup?token=${encodeURIComponent(token)}`
    : '/api/auth/google/signup'

  // ── Loading state while verifying invite ─────────────────────────────────────
  if (checking) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <Loader2 className="w-6 h-6 text-slate-400 animate-spin" />
      </div>
    )
  }

  // ── Invalid invite (bad token, already used, etc.) ────────────────────────────
  if (inviteError) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 px-4">
        <div className="text-center max-w-sm">
          <div className="w-14 h-14 rounded-2xl bg-red-100 flex items-center justify-center mx-auto mb-4">
            <AlertCircle className="w-7 h-7 text-red-500" />
          </div>
          <h2 className="text-xl font-semibold text-slate-900 mb-2">Invalid Invitation</h2>
          <p className="text-sm text-slate-500 mb-6">{inviteError}</p>
          <a href="/login" className="text-sm text-blue-600 hover:underline">Back to login</a>
        </div>
      </div>
    )
  }

  // ── Main signup form ──────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-50 to-slate-100 px-4">
      <div className="w-full max-w-sm">
        {/* Logo */}
        <div className="text-center mb-8">
          <div className="inline-block bg-black rounded-xl px-5 py-3 shadow-lg">
            <img src={knoxLogo} alt="Knox" style={{ width: 220 }} className="object-contain" />
          </div>
          <p className="mt-4 text-sm text-slate-500">
            {token ? 'Accept your invitation' : 'Create your admin account'}
          </p>
        </div>

        <div className="bg-white rounded-2xl shadow-sm border border-slate-200 px-8 py-8">
          {/* Invite badge */}
          {invite && (
            <div className="mb-5 flex items-start gap-2.5 px-4 py-3 bg-blue-50 border border-blue-200 rounded-lg">
              <CheckCircle className="w-4 h-4 text-blue-500 mt-0.5 shrink-0" />
              <div>
                <p className="text-sm text-blue-800 font-medium">{invite.email}</p>
                <p className="text-xs text-blue-600">Role: {ROLE_LABELS[invite.role] || invite.role}</p>
              </div>
            </div>
          )}

          {/* Error banner */}
          {error && (
            <div className="mb-5 flex items-start gap-2.5 px-4 py-3 bg-red-50 border border-red-200 rounded-lg">
              <AlertCircle className="w-4 h-4 text-red-500 mt-0.5 shrink-0" />
              <p className="text-sm text-red-700">{error}</p>
            </div>
          )}

          {/* Google sign-in */}
          <a
            href={googleSignupHref}
            className="flex items-center justify-center gap-3 w-full px-4 py-2.5 border border-slate-300 rounded-xl text-sm font-medium text-slate-700 bg-white hover:bg-slate-50 hover:border-slate-400 transition-all shadow-sm"
          >
            <svg viewBox="0 0 24 24" className="w-5 h-5" aria-hidden="true">
              <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
              <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
              <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
              <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
            </svg>
            Sign in with Google
          </a>

          {/* Divider */}
          <div className="flex items-center gap-3 my-5">
            <div className="flex-1 h-px bg-slate-200" />
            <span className="text-xs text-slate-400 font-medium uppercase tracking-wider">or</span>
            <div className="flex-1 h-px bg-slate-200" />
          </div>

          {/* Email/password form */}
          <form onSubmit={handleSubmit} className="space-y-4">
            {/* Email shown only for first-user bootstrap (no invite token) */}
            {!token && (
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1.5">Email</label>
                <input
                  type="email"
                  required
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  className="w-full border border-slate-300 rounded-xl px-3.5 py-2.5 text-sm text-slate-900 outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all"
                  placeholder="you@example.com"
                />
              </div>
            )}

            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1.5">Full name</label>
              <input
                type="text"
                required
                value={name}
                onChange={e => setName(e.target.value)}
                className="w-full border border-slate-300 rounded-xl px-3.5 py-2.5 text-sm text-slate-900 outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all"
                placeholder="Jane Smith"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1.5">Password</label>
              <input
                type="password"
                required
                minLength={8}
                value={password}
                onChange={e => setPassword(e.target.value)}
                className="w-full border border-slate-300 rounded-xl px-3.5 py-2.5 text-sm text-slate-900 outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all"
                placeholder="Min. 8 characters"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1.5">Confirm password</label>
              <input
                type="password"
                required
                value={password2}
                onChange={e => setPassword2(e.target.value)}
                className="w-full border border-slate-300 rounded-xl px-3.5 py-2.5 text-sm text-slate-900 outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all"
                placeholder="••••••••"
              />
            </div>

            <button
              type="submit"
              disabled={saving}
              className="w-full bg-blue-600 text-white text-sm font-semibold py-2.5 rounded-xl hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 transition-all disabled:opacity-50 flex items-center justify-center gap-2 mt-2"
            >
              {saving && <Loader2 className="w-4 h-4 animate-spin" />}
              {saving ? 'Creating account…' : 'Create account'}
            </button>
          </form>
        </div>

        <p className="text-center mt-4 text-xs text-slate-400">
          Already have an account? <a href="/login" className="text-blue-600 hover:underline">Sign in</a>
        </p>
      </div>
    </div>
  )
}
