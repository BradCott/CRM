// Today's Plays — the per-user action queue (system + meeting notes + email)
import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { Zap, Check, X, Clock3, Loader2, Plus, Sparkles } from 'lucide-react'
import { getPlays, patchPlay, createPlay } from '../../api/client'

const TYPE_BADGE = {
  mail:   { label: 'MAIL',  cls: 'bg-orange-100 text-orange-700' },
  deal:   { label: 'DEAL',  cls: 'bg-red-100 text-red-700' },
  stale:  { label: 'STALE', cls: 'bg-violet-100 text-violet-700' },
  hot:    { label: 'HOT',   cls: 'bg-emerald-100 text-emerald-700' },
  bill:   { label: 'BILL',  cls: 'bg-amber-100 text-amber-700' },
  lease:  { label: 'LEASE', cls: 'bg-blue-100 text-blue-700' },
  task:   { label: 'TASK',  cls: 'bg-slate-200 text-slate-700' },
  notes:  { label: 'MTG',   cls: 'bg-indigo-100 text-indigo-700' },
  email:  { label: 'EMAIL', cls: 'bg-sky-100 text-sky-700' },
  custom: { label: 'TODO',  cls: 'bg-slate-200 text-slate-700' },
}

export default function TodaysPlays() {
  const navigate = useNavigate()
  const [plays, setPlays]     = useState([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy]       = useState(null)
  const [adding, setAdding]   = useState(false)
  const [newTitle, setNewTitle] = useState('')

  const load = useCallback(() => {
    getPlays().then(setPlays).catch(console.error).finally(() => setLoading(false))
  }, [])

  useEffect(() => { load() }, [load])

  async function act(id, status, snooze_days) {
    setBusy(id)
    try {
      await patchPlay(id, { status, snooze_days })
      setPlays(prev => prev.filter(p => p.id !== id || status === 'open')
        .map(p => p.id === id ? { ...p, status } : p))
    } catch (e) {
      console.error(e)
    } finally {
      setBusy(null)
    }
  }

  async function handleAdd(e) {
    e.preventDefault()
    if (!newTitle.trim()) return
    const play = await createPlay({ title: newTitle.trim() })
    setPlays(prev => [play, ...prev])
    setNewTitle('')
    setAdding(false)
  }

  const open      = plays.filter(p => p.status === 'open' || p.status === 'snoozed')
  const suggested = plays.filter(p => p.status === 'suggested')

  return (
    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
      <div className="flex items-center justify-between px-5 py-3.5 border-b border-slate-100">
        <div className="flex items-center gap-2">
          <Zap className="w-4 h-4 text-amber-500" />
          <h2 className="text-sm font-bold text-slate-800">Today's Plays</h2>
          {open.length > 0 && (
            <span className="text-xs font-bold bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full">{open.length}</span>
          )}
        </div>
        <button
          onClick={() => setAdding(a => !a)}
          className="p-1 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors"
          title="Add a play"
        >
          <Plus className="w-4 h-4" />
        </button>
      </div>

      {adding && (
        <form onSubmit={handleAdd} className="px-5 py-2.5 border-b border-slate-100 bg-slate-50 flex gap-2">
          <input
            autoFocus
            value={newTitle}
            onChange={e => setNewTitle(e.target.value)}
            placeholder="What needs to happen?"
            className="flex-1 text-sm border border-slate-200 rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-400"
          />
          <button type="submit" className="text-xs font-medium text-blue-600 px-3 py-1.5 rounded-lg border border-blue-200 hover:bg-blue-50">Add</button>
        </form>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-10">
          <Loader2 className="w-5 h-5 text-slate-400 animate-spin" />
        </div>
      ) : open.length === 0 && suggested.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-10 gap-1">
          <Check className="w-7 h-7 text-emerald-500" />
          <p className="text-sm font-medium text-slate-700">All clear</p>
          <p className="text-xs text-slate-400">No plays in your queue — go find a deal</p>
        </div>
      ) : (
        <ul className="divide-y divide-slate-100">
          {open.map(p => {
            const badge = TYPE_BADGE[p.play_type] || TYPE_BADGE.custom
            return (
              <li key={p.id} className="flex items-center gap-3 px-5 py-2.5 group hover:bg-slate-50/70 transition-colors">
                <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full shrink-0 ${badge.cls}`}>{badge.label}</span>
                <div
                  className={`flex-1 min-w-0 ${p.route ? 'cursor-pointer' : ''}`}
                  onClick={p.route ? () => navigate(p.route) : undefined}
                >
                  <p className="text-sm text-slate-800 truncate">{p.title}</p>
                  {p.detail && <p className="text-xs text-slate-400 truncate">{p.detail}</p>}
                </div>
                <div className="flex items-center gap-0.5 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
                  <button
                    onClick={() => act(p.id, 'done')}
                    disabled={busy === p.id}
                    className="p-1.5 rounded-lg text-emerald-500 hover:bg-emerald-50 transition-colors"
                    title="Done"
                  >
                    {busy === p.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                  </button>
                  <button
                    onClick={() => act(p.id, 'snoozed', 1)}
                    disabled={busy === p.id}
                    className="p-1.5 rounded-lg text-slate-400 hover:bg-slate-100 transition-colors"
                    title="Snooze 1 day"
                  >
                    <Clock3 className="w-4 h-4" />
                  </button>
                  <button
                    onClick={() => act(p.id, 'dismissed')}
                    disabled={busy === p.id}
                    className="p-1.5 rounded-lg text-slate-300 hover:text-red-500 hover:bg-red-50 transition-colors"
                    title="Dismiss"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              </li>
            )
          })}

          {suggested.length > 0 && (
            <li className="px-5 py-2 bg-sky-50/60">
              <p className="text-xs font-semibold text-sky-700 flex items-center gap-1.5">
                <Sparkles className="w-3.5 h-3.5" /> From this morning's email — accept or dismiss
              </p>
            </li>
          )}
          {suggested.map(p => (
            <li key={p.id} className="flex items-center gap-3 px-5 py-2.5 bg-sky-50/30">
              <span className="text-[10px] font-bold px-2 py-0.5 rounded-full shrink-0 bg-sky-100 text-sky-700">EMAIL</span>
              <div className="flex-1 min-w-0">
                <p className="text-sm text-slate-800 truncate">{p.title}</p>
                {p.detail && <p className="text-xs text-slate-400 truncate">{p.detail}</p>}
              </div>
              <div className="flex items-center gap-1.5 shrink-0">
                <button
                  onClick={() => act(p.id, 'open')}
                  disabled={busy === p.id}
                  className="text-xs font-medium text-sky-700 px-2.5 py-1 rounded-lg border border-sky-200 hover:bg-sky-100 transition-colors"
                >
                  Accept
                </button>
                <button
                  onClick={() => act(p.id, 'dismissed')}
                  disabled={busy === p.id}
                  className="p-1.5 rounded-lg text-slate-300 hover:text-red-500 hover:bg-red-50 transition-colors"
                  title="Dismiss"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
