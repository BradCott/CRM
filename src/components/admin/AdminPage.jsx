import { useState, useEffect, useCallback } from 'react'
import { ShieldCheck, UserPlus, Loader2, AlertCircle, CheckCircle, X, Copy, Check } from 'lucide-react'
import { useAuth } from '../../context/AuthContext'

const ROLES = [
  { value: 'admin',        label: 'Admin',        desc: 'Full access + user management' },
  { value: 'full_agent',   label: 'Full Agent',   desc: 'Read everything, no edits' },
  { value: 'junior_agent', label: 'Junior Agent', desc: 'Properties, Pipeline, Reports only' },
]

const STATUS_BADGE = {
  active:   'bg-emerald-100 text-emerald-700',
  inactive: 'bg-slate-100   text-slate-500',
}

const PROVIDER_BADGE = {
  google: 'bg-blue-100 text-blue-700',
  local:  'bg-slate-100 text-slate-600',
}

function InviteModal({ onClose, onInvited }) {
  const [email, setEmail]     = useState('')
  const [role, setRole]       = useState('junior_agent')
  const [saving, setSaving]   = useState(false)
  const [error, setError]     = useState(null)
  const [result, setResult]   = useState(null)  // { signupUrl, emailSent }
  const [copied, setCopied]   = useState(false)

  async function handleSubmit(e) {
    e.preventDefault()
    setError(null)
    setSaving(true)
    try {
      const res = await fetch('/api/admin/users/invite', {
        method:      'POST',
        credentials: 'include',
        headers:     { 'Content-Type': 'application/json' },
        body:        JSON.stringify({ email, role }),
      })
      const data = await res.json()
      if (!res.ok) setError(data.error || 'Failed to send invitation.')
      else { setResult(data); onInvited?.() }
    } catch {
      setError('Could not connect to the server.')
    } finally {
      setSaving(false)
    }
  }

  function copyLink() {
    navigator.clipboard.writeText(result.signupUrl)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
          <h2 className="text-base font-semibold text-slate-900">Invite User</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600"><X className="w-5 h-5" /></button>
        </div>

        <div className="px-6 py-5">
          {result ? (
            <div className="space-y-4">
              <div className="flex items-start gap-2.5 px-4 py-3 bg-emerald-50 border border-emerald-200 rounded-lg">
                <CheckCircle className="w-4 h-4 text-emerald-500 mt-0.5 shrink-0" />
                <div>
                  <p className="text-sm font-medium text-emerald-800">
                    {result.emailSent ? 'Invitation email sent!' : 'Invitation created'}
                  </p>
                  {!result.emailSent && (
                    <p className="text-xs text-emerald-600 mt-0.5">
                      SMTP is not configured — share the link below manually.
                    </p>
                  )}
                </div>
              </div>

              <div>
                <p className="text-xs font-medium text-slate-500 mb-1.5">Signup link</p>
                <div className="flex gap-2">
                  <input
                    readOnly
                    value={result.signupUrl}
                    className="flex-1 text-xs border border-slate-200 rounded-lg px-3 py-2 bg-slate-50 text-slate-700 outline-none"
                  />
                  <button
                    onClick={copyLink}
                    className="flex items-center gap-1.5 px-3 py-2 text-xs font-medium rounded-lg border border-slate-200 hover:bg-slate-50 transition-colors"
                  >
                    {copied ? <Check className="w-3.5 h-3.5 text-emerald-500" /> : <Copy className="w-3.5 h-3.5" />}
                    {copied ? 'Copied' : 'Copy'}
                  </button>
                </div>
              </div>

              <button
                onClick={onClose}
                className="w-full mt-2 py-2.5 rounded-xl text-sm font-medium bg-slate-100 hover:bg-slate-200 text-slate-700 transition-colors"
              >
                Done
              </button>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
              {error && (
                <div className="flex items-start gap-2 px-4 py-3 bg-red-50 border border-red-200 rounded-lg">
                  <AlertCircle className="w-4 h-4 text-red-500 mt-0.5 shrink-0" />
                  <p className="text-sm text-red-700">{error}</p>
                </div>
              )}

              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1.5">Email address</label>
                <input
                  type="email"
                  required
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  className="w-full border border-slate-300 rounded-xl px-3.5 py-2.5 text-sm outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  placeholder="colleague@example.com"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1.5">Role</label>
                <div className="space-y-2">
                  {ROLES.map(r => (
                    <label key={r.value} className={`flex items-start gap-3 p-3 rounded-xl border cursor-pointer transition-all ${
                      role === r.value ? 'border-blue-400 bg-blue-50' : 'border-slate-200 hover:border-slate-300'
                    }`}>
                      <input
                        type="radio"
                        name="role"
                        value={r.value}
                        checked={role === r.value}
                        onChange={() => setRole(r.value)}
                        className="mt-0.5 accent-blue-600"
                      />
                      <div>
                        <p className="text-sm font-medium text-slate-800">{r.label}</p>
                        <p className="text-xs text-slate-500">{r.desc}</p>
                      </div>
                    </label>
                  ))}
                </div>
              </div>

              <div className="flex gap-2 pt-2">
                <button type="button" onClick={onClose}
                  className="flex-1 py-2.5 rounded-xl text-sm font-medium border border-slate-200 hover:bg-slate-50 text-slate-600 transition-colors">
                  Cancel
                </button>
                <button type="submit" disabled={saving}
                  className="flex-1 py-2.5 rounded-xl text-sm font-semibold bg-blue-600 text-white hover:bg-blue-700 transition-colors disabled:opacity-50 flex items-center justify-center gap-2">
                  {saving && <Loader2 className="w-4 h-4 animate-spin" />}
                  {saving ? 'Sending…' : 'Send Invitation'}
                </button>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  )
}

export default function AdminPage() {
  const { user: me } = useAuth()
  const [users, setUsers]       = useState([])
  const [loading, setLoading]   = useState(true)
  const [error, setError]       = useState(null)
  const [showInvite, setShowInvite] = useState(false)
  const [updating, setUpdating]   = useState(null)  // userId being updated

  const loadUsers = useCallback(() => {
    fetch('/api/admin/users', { credentials: 'include' })
      .then(r => r.json())
      .then(data => setUsers(Array.isArray(data) ? data : []))
      .catch(e => setError(e.message))
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => { loadUsers() }, [loadUsers])

  async function changeRole(userId, role) {
    setUpdating(userId + '_role')
    try {
      const res = await fetch(`/api/admin/users/${userId}/role`, {
        method:      'PATCH',
        credentials: 'include',
        headers:     { 'Content-Type': 'application/json' },
        body:        JSON.stringify({ role }),
      })
      if (res.ok) {
        const updated = await res.json()
        setUsers(prev => prev.map(u => u.id === userId ? { ...u, ...updated } : u))
      } else {
        const d = await res.json()
        alert(d.error || 'Failed to update role.')
      }
    } finally {
      setUpdating(null)
    }
  }

  async function changeStatus(userId, status) {
    setUpdating(userId + '_status')
    try {
      const res = await fetch(`/api/admin/users/${userId}/status`, {
        method:      'PATCH',
        credentials: 'include',
        headers:     { 'Content-Type': 'application/json' },
        body:        JSON.stringify({ status }),
      })
      if (res.ok) {
        const updated = await res.json()
        setUsers(prev => prev.map(u => u.id === userId ? { ...u, ...updated } : u))
      } else {
        const d = await res.json()
        alert(d.error || 'Failed to update status.')
      }
    } finally {
      setUpdating(null)
    }
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <header className="shrink-0 px-6 pt-6 pb-5 bg-white border-b border-slate-200">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <ShieldCheck className="w-5 h-5 text-blue-600" />
            <h1 className="text-xl font-semibold text-slate-900">Admin Panel</h1>
          </div>
          <button
            onClick={() => setShowInvite(true)}
            className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white text-sm font-semibold rounded-xl hover:bg-blue-700 transition-colors"
          >
            <UserPlus className="w-4 h-4" /> Invite User
          </button>
        </div>
        <p className="mt-1 text-sm text-slate-500">Manage users, roles, and access</p>
      </header>

      <div className="flex-1 overflow-y-auto p-6">
        {error && (
          <div className="mb-4 px-4 py-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">{error}</div>
        )}

        {loading ? (
          <div className="flex items-center justify-center py-16">
            <Loader2 className="w-5 h-5 text-slate-400 animate-spin" />
          </div>
        ) : (
          <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200">
                  <th className="text-left text-xs font-semibold text-slate-500 uppercase tracking-wide px-6 py-3">Name</th>
                  <th className="text-left text-xs font-semibold text-slate-500 uppercase tracking-wide px-4 py-3">Email</th>
                  <th className="text-left text-xs font-semibold text-slate-500 uppercase tracking-wide px-4 py-3">Provider</th>
                  <th className="text-left text-xs font-semibold text-slate-500 uppercase tracking-wide px-4 py-3">Role</th>
                  <th className="text-left text-xs font-semibold text-slate-500 uppercase tracking-wide px-4 py-3">Status</th>
                  <th className="px-4 py-3 w-32" />
                </tr>
              </thead>
              <tbody>
                {users.map((u, i) => {
                  const isMe = u.id === me?.id
                  return (
                    <tr key={u.id} className={i % 2 === 0 ? 'bg-white' : 'bg-slate-50/60'}>
                      <td className="px-6 py-3.5 border-b border-slate-100">
                        <div className="flex items-center gap-2.5">
                          <div className="w-7 h-7 rounded-full bg-blue-100 flex items-center justify-center text-xs font-bold text-blue-700 shrink-0">
                            {(u.name || u.email)[0].toUpperCase()}
                          </div>
                          <span className="font-medium text-slate-800">{u.name || '—'}</span>
                          {isMe && <span className="text-xs text-slate-400 italic">you</span>}
                        </div>
                      </td>
                      <td className="px-4 py-3.5 border-b border-slate-100 text-slate-600">{u.email}</td>
                      <td className="px-4 py-3.5 border-b border-slate-100">
                        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${PROVIDER_BADGE[u.auth_provider] || PROVIDER_BADGE.local}`}>
                          {u.auth_provider === 'google' ? 'Google' : 'Password'}
                        </span>
                      </td>
                      <td className="px-4 py-3.5 border-b border-slate-100">
                        <select
                          value={u.role}
                          disabled={isMe || updating === u.id + '_role'}
                          onChange={e => changeRole(u.id, e.target.value)}
                          className="text-xs border border-slate-200 rounded-lg px-2.5 py-1.5 bg-white text-slate-700 outline-none focus:ring-1 focus:ring-blue-300 disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                          {ROLES.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
                        </select>
                      </td>
                      <td className="px-4 py-3.5 border-b border-slate-100">
                        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${STATUS_BADGE[u.status]}`}>
                          {u.status === 'active' ? 'Active' : 'Inactive'}
                        </span>
                      </td>
                      <td className="px-4 py-3.5 pr-6 border-b border-slate-100 text-right">
                        {!isMe && (
                          <button
                            disabled={updating === u.id + '_status'}
                            onClick={() => changeStatus(u.id, u.status === 'active' ? 'inactive' : 'active')}
                            className={`text-xs px-3 py-1.5 rounded-lg font-medium transition-colors disabled:opacity-40 ${
                              u.status === 'active'
                                ? 'text-slate-500 hover:bg-red-50 hover:text-red-600 border border-slate-200'
                                : 'text-emerald-600 hover:bg-emerald-50 border border-emerald-200'
                            }`}
                          >
                            {updating === u.id + '_status' ? '…' : u.status === 'active' ? 'Deactivate' : 'Reactivate'}
                          </button>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {showInvite && (
        <InviteModal
          onClose={() => setShowInvite(false)}
          onInvited={loadUsers}
        />
      )}
    </div>
  )
}
