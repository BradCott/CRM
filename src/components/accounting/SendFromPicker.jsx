// "Send from" account picker for email draft screens. Lists connected send
// accounts (the app default + any additional per-send accounts) and lets you
// connect another — WITHOUT changing the app-wide default in Settings.
// Value is the account KEY (provider), e.g. 'google_send' or 'send:brad@knoxcre.com'.
import { useState, useEffect } from 'react'
import { Loader2, Plus } from 'lucide-react'
import { getSendAccounts, connectSendAccountUrl } from '../../api/client'

export default function SendFromPicker({ value, onChange, className = '' }) {
  const [accounts, setAccounts] = useState([])
  const [loading, setLoading]   = useState(true)

  useEffect(() => {
    getSendAccounts()
      .then(r => {
        const list = r.accounts || []
        setAccounts(list)
        // Default the selection: keep current if still valid, else the default/first.
        if (!value || !list.some(a => a.key === value)) {
          const def = list.find(a => a.is_default) || list[0]
          if (def) onChange?.(def.key)
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const connectAnother = () => {
    const here = window.location.pathname + window.location.search
    window.location.href = connectSendAccountUrl(here)
  }

  return (
    <div className={className}>
      <label className="block text-xs font-medium text-slate-500 mb-1">Send from</label>
      {loading ? (
        <div className="flex items-center gap-2 text-sm text-slate-400 py-2"><Loader2 className="w-4 h-4 animate-spin" /> Loading accounts…</div>
      ) : (
        <div className="flex items-center gap-2">
          <select
            value={value || ''}
            onChange={e => { if (e.target.value === '__add__') connectAnother(); else onChange?.(e.target.value) }}
            className="flex-1 text-sm border border-slate-200 rounded-lg px-3 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-emerald-400"
          >
            {accounts.length === 0 && <option value="">No account connected</option>}
            {accounts.map(a => <option key={a.key} value={a.key}>{a.label}</option>)}
            <option value="__add__">＋ Connect another account…</option>
          </select>
        </div>
      )}
      {!loading && accounts.length === 0 && (
        <button onClick={connectAnother} className="mt-1.5 inline-flex items-center gap-1 text-xs font-medium text-emerald-700 hover:text-emerald-900">
          <Plus className="w-3.5 h-3.5" /> Connect a sending account
        </button>
      )}
      <p className="text-[11px] text-slate-400 mt-1">Picks the mailbox for this email only — your Settings default is unchanged.</p>
    </div>
  )
}
