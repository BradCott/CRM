// Deal/property correspondence timeline — reusable on the deal page and the
// property pages. Newest first, filter by type, quick manual notes.
import { useState, useEffect, useCallback } from 'react'
import {
  Clock, Mail, StickyNote, ArrowRightLeft, CheckCircle2, FileText, Phone,
  Settings2, Plus, Loader2, ExternalLink,
} from 'lucide-react'
import { getDealActivity, logDealActivity } from '../../api/client'

const TYPE_META = {
  email:          { label: 'Email',   icon: Mail,          cls: 'text-sky-600 bg-sky-50' },
  note:           { label: 'Note',    icon: StickyNote,    cls: 'text-amber-600 bg-amber-50' },
  status_change:  { label: 'Status',  icon: ArrowRightLeft,cls: 'text-violet-600 bg-violet-50' },
  task_completed: { label: 'Task',    icon: CheckCircle2,  cls: 'text-emerald-600 bg-emerald-50' },
  document:       { label: 'Doc',     icon: FileText,      cls: 'text-blue-600 bg-blue-50' },
  call:           { label: 'Call',    icon: Phone,         cls: 'text-indigo-600 bg-indigo-50' },
  system:         { label: 'System',  icon: Settings2,     cls: 'text-slate-500 bg-slate-100' },
}
const FILTERS = ['all', 'email', 'note', 'status_change', 'task_completed', 'call', 'document']

function timeAgo(ts) {
  if (!ts) return ''
  const d = new Date(ts.includes('T') ? ts : ts.replace(' ', 'T') + 'Z')
  const diff = Date.now() - d.getTime()
  if (isNaN(diff)) return ''
  const m = Math.floor(diff / 60000)
  if (m < 1) return 'just now'
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  const days = Math.floor(h / 24)
  if (days < 30) return `${days}d ago`
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

function gmailUrl(threadId) { return `https://mail.google.com/mail/u/0/#all/${threadId}` }

export default function Timeline({ dealId, propertyId, title = 'Timeline' }) {
  const [items, setItems]   = useState([])
  const [loading, setLoad]  = useState(true)
  const [filter, setFilter] = useState('all')
  const [note, setNote]     = useState('')
  const [saving, setSaving] = useState(false)

  const params = dealId ? { deal_id: dealId } : propertyId ? { property_id: propertyId } : null

  const load = useCallback(() => {
    if (!params) { setLoad(false); return }
    getDealActivity(params).then(setItems).catch(console.error).finally(() => setLoad(false))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dealId, propertyId])
  useEffect(() => { load() }, [load])

  async function addNote(e) {
    e.preventDefault()
    if (!note.trim() || !params) return
    setSaving(true)
    try {
      const entry = await logDealActivity({ ...params, type: 'note', summary: note.trim() })
      setItems(prev => [entry, ...prev])
      setNote('')
    } catch (e) { console.error(e) } finally { setSaving(false) }
  }

  const shown = filter === 'all' ? items : items.filter(i => i.type === filter)

  return (
    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
      <div className="flex items-center gap-2 px-5 py-3.5 border-b border-slate-100">
        <Clock className="w-4 h-4 text-slate-400" />
        <h2 className="text-sm font-bold text-slate-800">{title}</h2>
        <span className="text-xs text-slate-400">{items.length}</span>
      </div>

      {/* Quick note */}
      <form onSubmit={addNote} className="flex items-center gap-2 px-5 py-2.5 border-b border-slate-100 bg-slate-50">
        <StickyNote className="w-4 h-4 text-slate-400 shrink-0" />
        <input value={note} onChange={e => setNote(e.target.value)} placeholder="Add a note…"
          className="flex-1 text-sm bg-transparent focus:outline-none" />
        <button type="submit" disabled={!note.trim() || saving}
          className="text-xs font-semibold text-blue-600 px-2.5 py-1 rounded-lg border border-blue-200 hover:bg-blue-50 disabled:opacity-40 flex items-center gap-1">
          {saving ? <Loader2 className="w-3 h-3 animate-spin" /> : <Plus className="w-3 h-3" />} Note
        </button>
      </form>

      {/* Type filters */}
      <div className="flex items-center gap-1.5 px-5 py-2 border-b border-slate-100 flex-wrap">
        {FILTERS.map(f => (
          <button key={f} onClick={() => setFilter(f)}
            className={`text-[11px] px-2 py-0.5 rounded-full capitalize ${filter === f ? 'bg-slate-800 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}>
            {f === 'all' ? 'All' : (TYPE_META[f]?.label || f)}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-10"><Loader2 className="w-5 h-5 text-slate-400 animate-spin" /></div>
      ) : shown.length === 0 ? (
        <p className="px-5 py-8 text-sm text-slate-400 text-center">No activity yet.</p>
      ) : (
        <ul className="divide-y divide-slate-50">
          {shown.map(e => {
            const meta = TYPE_META[e.type] || TYPE_META.system
            const Icon = meta.icon
            return (
              <li key={e.id} className="flex gap-3 px-5 py-3">
                <span className={`w-7 h-7 rounded-full flex items-center justify-center shrink-0 ${meta.cls}`}>
                  <Icon className="w-3.5 h-3.5" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm text-slate-800">{e.summary || meta.label}</p>
                  {e.detail && <p className="text-xs text-slate-500 mt-0.5 whitespace-pre-wrap">{e.detail}</p>}
                  <div className="flex items-center gap-2 mt-1 text-[11px] text-slate-400 flex-wrap">
                    <span>{timeAgo(e.occurred_at || e.created_at)}</span>
                    {e.created_by && <span>· {e.created_by}</span>}
                    {e.participants && <span className="truncate">· {e.participants}</span>}
                    {e.gmail_thread_id && (
                      <a href={gmailUrl(e.gmail_thread_id)} target="_blank" rel="noopener noreferrer"
                        className="inline-flex items-center gap-0.5 text-blue-500 hover:underline">thread <ExternalLink className="w-2.5 h-2.5" /></a>
                    )}
                  </div>
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
