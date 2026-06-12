// Mail Engine — monthly letter pace + follow-up counts, keeps mail front of mind
import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { Mailbox, Loader2, Pencil } from 'lucide-react'
import { getMailStats, setMailTarget } from '../../api/client'

export default function MailEngine() {
  const navigate = useNavigate()
  const [stats, setStats]     = useState(null)
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft]     = useState('')

  useEffect(() => {
    getMailStats().then(setStats).catch(console.error).finally(() => setLoading(false))
  }, [])

  async function saveTarget() {
    const t = parseInt(draft, 10)
    if (isFinite(t) && t > 0) {
      await setMailTarget(t)
      setStats(prev => ({ ...prev, target: t }))
    }
    setEditing(false)
  }

  if (loading) return (
    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm px-5 py-8 flex justify-center">
      <Loader2 className="w-5 h-5 text-slate-400 animate-spin" />
    </div>
  )
  if (!stats) return null

  const pct = Math.min(100, (stats.sent_this_month / stats.target) * 100)
  const monthName = new Date().toLocaleDateString('en-US', { month: 'long' })

  return (
    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
      <div className="flex items-center justify-between px-5 py-3.5 border-b border-slate-100">
        <div className="flex items-center gap-2">
          <Mailbox className="w-4 h-4 text-violet-500" />
          <h2 className="text-sm font-bold text-slate-800">Mail Engine</h2>
        </div>
        <span className="text-xs text-slate-400">{monthName}</span>
      </div>

      <div className="px-5 py-4">
        <div className="flex items-baseline gap-1.5">
          <span className="text-2xl font-bold text-slate-900 tabular-nums">{stats.sent_this_month}</span>
          <span className="text-sm text-slate-400">
            / {editing ? (
              <input
                autoFocus
                type="number"
                value={draft}
                onChange={e => setDraft(e.target.value)}
                onBlur={saveTarget}
                onKeyDown={e => { if (e.key === 'Enter') saveTarget(); if (e.key === 'Escape') setEditing(false) }}
                className="w-16 text-sm border border-blue-300 rounded px-1.5 py-0.5 focus:outline-none focus:ring-2 focus:ring-blue-400"
              />
            ) : (
              <button
                onClick={() => { setDraft(String(stats.target)); setEditing(true) }}
                className="hover:text-slate-600 group inline-flex items-center gap-1"
                title="Edit monthly target"
              >
                {stats.target} letters
                <Pencil className="w-3 h-3 opacity-0 group-hover:opacity-100 transition-opacity" />
              </button>
            )}
          </span>
        </div>

        <div className="h-2.5 bg-slate-100 rounded-full overflow-hidden mt-2.5 mb-3">
          <div
            className={`h-full rounded-full transition-all ${pct >= 100 ? 'bg-emerald-500' : 'bg-violet-500'}`}
            style={{ width: `${Math.max(2, pct)}%` }}
          />
        </div>

        <div className="space-y-1.5">
          <button
            onClick={() => navigate('/campaigns')}
            className="w-full flex items-center justify-between text-left group"
          >
            <span className="text-xs text-slate-500 group-hover:text-slate-800 transition-colors">Due for follow-up (90+ days)</span>
            <span className={`text-xs font-bold tabular-nums ${stats.due_followup > 0 ? 'text-orange-600' : 'text-slate-400'}`}>
              {stats.due_followup}
            </span>
          </button>
          <button
            onClick={() => navigate('/campaigns')}
            className="w-full flex items-center justify-between text-left group"
          >
            <span className="text-xs text-slate-500 group-hover:text-slate-800 transition-colors">Owners never contacted</span>
            <span className="text-xs font-bold text-slate-600 tabular-nums">{stats.never_touched.toLocaleString()}</span>
          </button>
        </div>
      </div>
    </div>
  )
}
