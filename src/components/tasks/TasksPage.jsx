// Tasks — the single source of truth for every to-do.
// Open tasks carry over automatically; nothing to rebuild each day.
import { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  ListTodo, Check, X, Clock3, Loader2, Plus, PauseCircle, Pencil,
  ChevronDown, AlertCircle, Filter,
} from 'lucide-react'
import { getTasks, createTask, updateTask, completeTask, getTaskUsers, getDeals, getAllProperties } from '../../api/client'
import { useAuth } from '../../context/AuthContext'
import TaskPanel from './TaskPanel'

// ── Date helpers (local time, YYYY-MM-DD) ─────────────────────────────────────
const todayStr = () => new Date().toLocaleDateString('en-CA')

function endOfWeekStr() {
  const d = new Date()
  d.setDate(d.getDate() + ((7 - d.getDay()) % 7)) // upcoming Sunday
  return d.toLocaleDateString('en-CA')
}

function addDaysStr(days) {
  const d = new Date()
  d.setDate(d.getDate() + days)
  return d.toLocaleDateString('en-CA')
}

function fmtDue(d) {
  if (!d) return null
  const dt = new Date(d + 'T00:00:00')
  return dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

const GROUP_ORDER = ['Overdue', 'Today', 'This week', 'Later', 'No date']

function bucketOf(due) {
  if (!due) return 'No date'
  const today = todayStr()
  if (due < today) return 'Overdue'
  if (due === today) return 'Today'
  return due <= endOfWeekStr() ? 'This week' : 'Later'
}

const GROUP_STYLE = {
  'Overdue':   'text-red-600',
  'Today':     'text-blue-600',
  'This week': 'text-slate-600',
  'Later':     'text-slate-500',
  'No date':   'text-slate-400',
}

const PRIORITY_DOT = {
  high:   'bg-red-500',
  normal: 'bg-slate-300',
  low:    'bg-slate-200',
}

// ── Light shorthand parsing for quick add ─────────────────────────────────────
// "insurance quote #plano fri !high @brad" → { title, due_date, priority, owner, deal/property }
function parseShorthand(raw, users, links = []) {
  let text = ' ' + raw.trim() + ' '
  const out = {}

  const priMatch = text.match(/\s!(high|normal|low)\s/i)
  if (priMatch) { out.priority = priMatch[1].toLowerCase(); text = text.replace(priMatch[0], ' ') }

  const ownerMatch = text.match(/\s@(\w+)\s/)
  if (ownerMatch) {
    const handle = ownerMatch[1].toLowerCase()
    const u = users.find(u => (u.name || '').toLowerCase().split(/\s+/)[0] === handle)
    if (u) { out.owner_id = u.id; text = text.replace(ownerMatch[0], ' ') }
  }

  // "#name" links to a deal or property whose name/address/tenant matches.
  const hashMatch = text.match(/\s#([\w-]+)\s/)
  if (hashMatch) {
    const token = hashMatch[1].toLowerCase()
    const link = links.find(l => l.search.includes(token))
    if (link) {
      if (link.type === 'deal') out.deal_id = link.id; else out.property_id = link.id
      text = text.replace(hashMatch[0], ' ')
    }
  }

  const DOW = { sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6 }
  const dateMatch = text.match(/\s(today|tomorrow|mon|tue|wed|thu|fri|sat|sun)(?:day|sday|nesday|rsday|urday)?\s/i)
  if (dateMatch) {
    const key = dateMatch[1].toLowerCase().slice(0, 3)
    if (dateMatch[1].toLowerCase() === 'today') out.due_date = todayStr()
    else if (dateMatch[1].toLowerCase() === 'tomorrow') out.due_date = addDaysStr(1)
    else if (key in DOW) {
      const now = new Date()
      let delta = (DOW[key] - now.getDay() + 7) % 7
      if (delta === 0) delta = 7 // next occurrence
      out.due_date = addDaysStr(delta)
    }
    text = text.replace(dateMatch[0], ' ')
  }

  out.title = text.trim()
  return out
}

export default function TasksPage() {
  const navigate = useNavigate()
  const { user } = useAuth()
  const [tasks, setTasks]     = useState([])
  const [users, setUsers]     = useState([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy]       = useState(null)
  const [openId, setOpenId]   = useState(null)   // side-panel task id

  // Filters
  const [owner, setOwner]       = useState('all')
  const [priority, setPriority] = useState('all')
  const [source, setSource]     = useState('all')
  const [showDone, setShowDone] = useState(false)

  // Quick add
  const [qTitle, setQTitle]     = useState('')
  const [qOpen, setQOpen]       = useState(false)
  const [qDue, setQDue]         = useState('')
  const [qPriority, setQPriority] = useState('normal')
  const [qOwner, setQOwner]     = useState('')
  const [qLink, setQLink]       = useState(null)   // { type, id, label }

  // Deals + properties for the link picker / "#" shorthand
  const [links, setLinks] = useState([])

  // Bulk selection
  const [selected, setSelected] = useState(new Set())
  const [snoozeFor, setSnoozeFor] = useState(null)
  const snoozeRef = useRef(null)

  const load = useCallback(() => {
    const params = {}
    if (owner !== 'all')    params.owner = owner
    if (priority !== 'all') params.priority = priority
    if (source !== 'all')   params.source = source
    if (showDone)           params.include_done = 1
    getTasks(params).then(setTasks).catch(console.error).finally(() => setLoading(false))
  }, [owner, priority, source, showDone])

  useEffect(() => { load() }, [load])
  useEffect(() => { getTaskUsers().then(setUsers).catch(() => {}) }, [])
  useEffect(() => {
    Promise.all([getDeals().catch(() => []), getAllProperties().catch(() => [])]).then(([deals, props]) => {
      const mk = (type, id, label, parts) => ({ type, id, label, search: parts.filter(Boolean).join(' ').toLowerCase() })
      setLinks([
        ...deals.map(d => mk('deal', d.id, d.address || d.title || d.tenant || `Deal #${d.id}`,
          [d.address, d.city, d.state, d.tenant, d.tenant_brand_name, d.title])),
        ...props.map(p => mk('property', p.id, p.address || p.display_name || `Property #${p.id}`,
          [p.address, p.city, p.state, p.display_name, p.tenant_brand_name])),
      ])
    })
  }, [])

  // Close the snooze menu on outside click
  useEffect(() => {
    if (!snoozeFor) return
    const h = (e) => { if (snoozeRef.current && !snoozeRef.current.contains(e.target)) setSnoozeFor(null) }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [snoozeFor])

  // Merge a server task into local state (or drop it if it left the current view)
  function applyUpdated(t) {
    setTasks(prev => {
      const stillVisible = showDone || (t.status === 'open' || t.status === 'waiting')
      const exists = prev.some(p => p.id === t.id)
      if (!stillVisible) return prev.filter(p => p.id !== t.id)
      return exists ? prev.map(p => p.id === t.id ? t : p) : [...prev, t]
    })
  }

  async function act(id, patch) {
    setBusy(id)
    try { applyUpdated(await updateTask(id, patch)) }
    catch (e) { console.error(e) }
    finally { setBusy(null); setSnoozeFor(null) }
  }

  async function markDone(id) {
    setBusy(id)
    try { applyUpdated(await completeTask(id)) }
    catch (e) { console.error(e) }
    finally { setBusy(null) }
  }

  async function handleAdd(e) {
    e.preventDefault()
    if (!qTitle.trim()) return
    const parsed = parseShorthand(qTitle, users, links)
    const payload = {
      title: parsed.title || qTitle.trim(),
      due_date: parsed.due_date || qDue || null,
      priority: parsed.priority || qPriority,
      owner_id: parsed.owner_id ?? (qOwner ? Number(qOwner) : undefined),
    }
    // Link: "#" shorthand wins, else the picker selection.
    if (parsed.deal_id)      payload.deal_id = parsed.deal_id
    else if (parsed.property_id) payload.property_id = parsed.property_id
    else if (qLink?.type === 'deal')     payload.deal_id = qLink.id
    else if (qLink?.type === 'property') payload.property_id = qLink.id
    try {
      const created = await createTask(payload)
      setTasks(prev => [created, ...prev])
      setQTitle(''); setQDue(''); setQPriority('normal'); setQOwner(''); setQLink(null)
    } catch (e) { console.error(e) }
  }

  // Split into waiting vs active, then bucket the active ones.
  const { groups, waiting, completed, counts } = useMemo(() => {
    const waiting = [], completed = [], active = []
    for (const t of tasks) {
      if (t.status === 'done' || t.status === 'dismissed') completed.push(t)
      else if (t.status === 'waiting') waiting.push(t)
      else active.push(t)
    }
    const groups = {}
    for (const g of GROUP_ORDER) groups[g] = []
    for (const t of active) groups[bucketOf(t.due_date)].push(t)

    const today = todayStr()
    const counts = {
      overdue: active.filter(t => t.due_date && t.due_date < today).length,
      today:   active.filter(t => t.due_date === today).length,
      waiting: waiting.length,
    }
    return { groups, waiting, completed, counts }
  }, [tasks])

  // ── Bulk actions ──
  const allVisibleIds = useMemo(
    () => [...GROUP_ORDER.flatMap(g => groups[g]), ...waiting].map(t => t.id),
    [groups, waiting],
  )
  function toggleSel(id) {
    setSelected(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n })
  }
  async function bulk(patch) {
    const ids = [...selected]
    setSelected(new Set())
    await Promise.all(ids.map(id => patch === 'done' ? completeTask(id) : updateTask(id, patch)))
    load()
  }

  if (loading) {
    return <div className="flex items-center justify-center h-full"><Loader2 className="w-6 h-6 text-slate-400 animate-spin" /></div>
  }

  return (
    <div className="flex-1 overflow-y-auto bg-slate-50">
      <div className="max-w-5xl mx-auto px-6 py-6 space-y-4">

        {/* Header */}
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-2.5">
            <ListTodo className="w-6 h-6 text-blue-600" />
            <h1 className="text-xl font-bold text-slate-900">Tasks</h1>
            <span className="text-sm text-slate-400">
              {counts.overdue} overdue · {counts.today} today · {counts.waiting} waiting
            </span>
          </div>
        </div>

        {/* Quick add */}
        <form onSubmit={handleAdd} className="bg-white rounded-2xl border border-slate-200 shadow-sm p-3">
          <div className="flex items-center gap-2">
            <Plus className="w-4 h-4 text-slate-400 shrink-0" />
            <input
              value={qTitle}
              onChange={e => setQTitle(e.target.value)}
              onFocus={() => setQOpen(true)}
              placeholder="Add a task…  (try: insurance quote #plano fri !high @brad)"
              className="flex-1 text-sm focus:outline-none bg-transparent"
            />
            <button type="button" onClick={() => setQOpen(o => !o)} className="text-slate-400 hover:text-slate-600 p-1">
              <ChevronDown className={`w-4 h-4 transition-transform ${qOpen ? 'rotate-180' : ''}`} />
            </button>
            <button type="submit" disabled={!qTitle.trim()} className="text-xs font-semibold text-white bg-blue-600 px-3 py-1.5 rounded-lg hover:bg-blue-700 disabled:opacity-40">Add</button>
          </div>
          {qOpen && (
            <div className="flex items-center gap-2 mt-2.5 pt-2.5 border-t border-slate-100 flex-wrap">
              <label className="text-xs text-slate-500">Due
                <input type="date" value={qDue} onChange={e => setQDue(e.target.value)} className="ml-1.5 text-xs border border-slate-200 rounded-md px-2 py-1" />
              </label>
              <label className="text-xs text-slate-500">Priority
                <select value={qPriority} onChange={e => setQPriority(e.target.value)} className="ml-1.5 text-xs border border-slate-200 rounded-md px-2 py-1">
                  <option value="high">High</option><option value="normal">Normal</option><option value="low">Low</option>
                </select>
              </label>
              <label className="text-xs text-slate-500">Owner
                <select value={qOwner} onChange={e => setQOwner(e.target.value)} className="ml-1.5 text-xs border border-slate-200 rounded-md px-2 py-1">
                  <option value="">Me</option>
                  {users.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
                </select>
              </label>
              <LinkPicker links={links} value={qLink} onChange={setQLink} />
            </div>
          )}
        </form>

        {/* Filters */}
        <div className="flex items-center gap-2 flex-wrap text-xs">
          <Filter className="w-3.5 h-3.5 text-slate-400" />
          <FilterSelect value={owner} onChange={setOwner} label="Owner">
            <option value="all">Everyone</option>
            <option value="me">Me</option>
            {users.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
          </FilterSelect>
          <FilterSelect value={priority} onChange={setPriority} label="Priority">
            <option value="all">Any priority</option>
            <option value="high">High</option><option value="normal">Normal</option><option value="low">Low</option>
          </FilterSelect>
          <FilterSelect value={source} onChange={setSource} label="Source">
            <option value="all">Any source</option>
            <option value="manual">Manual</option><option value="claude">Claude</option>
            <option value="critical_date">Critical date</option><option value="email">Email</option>
            <option value="meeting_notes">Meeting notes</option>
          </FilterSelect>
          <label className="flex items-center gap-1.5 text-slate-600 ml-1 cursor-pointer select-none">
            <input type="checkbox" checked={showDone} onChange={e => setShowDone(e.target.checked)} className="rounded border-slate-300" />
            Show completed
          </label>
        </div>

        {/* Bulk action bar */}
        {selected.size > 0 && (
          <div className="sticky top-2 z-10 flex items-center gap-2 bg-slate-900 text-white rounded-xl px-4 py-2 shadow-lg text-sm">
            <span className="font-semibold">{selected.size} selected</span>
            <button onClick={() => bulk('done')} className="px-2.5 py-1 rounded-lg hover:bg-white/15">Done</button>
            <button onClick={() => bulk({ status: 'dismissed' })} className="px-2.5 py-1 rounded-lg hover:bg-white/15">Dismiss</button>
            <select onChange={e => e.target.value && bulk({ owner_id: Number(e.target.value) })} defaultValue="" className="bg-white/10 rounded-lg px-2 py-1 text-white">
              <option value="" className="text-slate-900">Reassign…</option>
              {users.map(u => <option key={u.id} value={u.id} className="text-slate-900">{u.name}</option>)}
            </select>
            <input type="date" onChange={e => e.target.value && bulk({ due_date: e.target.value })} className="bg-white/10 rounded-lg px-2 py-1 text-white [color-scheme:dark]" title="Set due date" />
            <button onClick={() => setSelected(new Set())} className="ml-auto text-white/70 hover:text-white"><X className="w-4 h-4" /></button>
          </div>
        )}

        {/* Groups */}
        {allVisibleIds.length === 0 && completed.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 gap-2">
            <Check className="w-8 h-8 text-emerald-500" />
            <p className="text-sm font-medium text-slate-700">All clear</p>
            <p className="text-xs text-slate-400">No open tasks — add one above.</p>
          </div>
        ) : (
          <div className="space-y-5">
            {GROUP_ORDER.map(g => groups[g].length > 0 && (
              <Group key={g} label={g} count={groups[g].length} style={GROUP_STYLE[g]}>
                {groups[g].map(t => (
                  <TaskRow key={t.id} t={t} busy={busy === t.id}
                    selected={selected.has(t.id)} onSelect={() => toggleSel(t.id)}
                    onOpen={() => setOpenId(t.id)} onDone={() => markDone(t.id)}
                    onDismiss={() => act(t.id, { status: 'dismissed' })}
                    onWaiting={() => act(t.id, { status: 'waiting', follow_up_date: addDaysStr(3) })}
                    snoozeOpen={snoozeFor === t.id} onSnoozeToggle={() => setSnoozeFor(s => s === t.id ? null : t.id)}
                    onSnooze={(days, date) => act(t.id, { snoozed_until: date || addDaysStr(days) })}
                    snoozeRef={snoozeRef} navigate={navigate} />
                ))}
              </Group>
            ))}

            {waiting.length > 0 && (
              <Group label="Waiting on" count={waiting.length} style="text-amber-600" collapsible defaultOpen={false}>
                {waiting.map(t => (
                  <TaskRow key={t.id} t={t} busy={busy === t.id} waiting
                    selected={selected.has(t.id)} onSelect={() => toggleSel(t.id)}
                    onOpen={() => setOpenId(t.id)} onDone={() => markDone(t.id)}
                    onDismiss={() => act(t.id, { status: 'dismissed' })}
                    onWaiting={() => act(t.id, { status: 'open' })}
                    snoozeOpen={snoozeFor === t.id} onSnoozeToggle={() => setSnoozeFor(s => s === t.id ? null : t.id)}
                    onSnooze={(days, date) => act(t.id, { snoozed_until: date || addDaysStr(days) })}
                    snoozeRef={snoozeRef} navigate={navigate} />
                ))}
              </Group>
            )}

            {showDone && completed.length > 0 && (
              <Group label="Completed" count={completed.length} style="text-slate-400" collapsible defaultOpen={false}>
                {completed.map(t => (
                  <TaskRow key={t.id} t={t} busy={busy === t.id} done
                    selected={selected.has(t.id)} onSelect={() => toggleSel(t.id)}
                    onOpen={() => setOpenId(t.id)} onReopen={() => act(t.id, { status: 'open' })}
                    navigate={navigate} />
                ))}
              </Group>
            )}
          </div>
        )}
      </div>

      {openId != null && (
        <TaskPanel
          taskId={openId} users={users} currentUserId={user?.sub}
          onClose={() => setOpenId(null)}
          onSaved={(t) => { applyUpdated(t); }}
        />
      )}
    </div>
  )
}

// ── Sub-components ────────────────────────────────────────────────────────────

function FilterSelect({ value, onChange, label, children }) {
  return (
    <select aria-label={label} value={value} onChange={e => onChange(e.target.value)}
      className="border border-slate-200 bg-white rounded-lg px-2 py-1 text-slate-600 focus:outline-none focus:ring-2 focus:ring-blue-300">
      {children}
    </select>
  )
}

function Group({ label, count, style, children, collapsible, defaultOpen = true }) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div>
      <button
        onClick={collapsible ? () => setOpen(o => !o) : undefined}
        className={`flex items-center gap-2 mb-1.5 ${collapsible ? 'cursor-pointer' : 'cursor-default'}`}
      >
        {collapsible && <ChevronDown className={`w-3.5 h-3.5 text-slate-400 transition-transform ${open ? '' : '-rotate-90'}`} />}
        <span className={`text-xs font-bold uppercase tracking-wider ${style}`}>{label}</span>
        <span className="text-xs text-slate-400">{count}</span>
      </button>
      {open && <ul className="bg-white rounded-2xl border border-slate-200 shadow-sm divide-y divide-slate-100 overflow-hidden">{children}</ul>}
    </div>
  )
}

// Typeahead for linking a task to a deal or property in quick-add.
function LinkPicker({ links, value, onChange }) {
  const [q, setQ] = useState('')
  const [open, setOpen] = useState(false)
  const ref = useRef(null)
  useEffect(() => {
    const h = e => { if (ref.current && !ref.current.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [])

  if (value) {
    return (
      <span className="text-xs text-slate-500 flex items-center gap-1">Link
        <span className={`inline-flex items-center gap-1 ml-1 px-1.5 py-1 rounded-md max-w-[180px] ${value.type === 'deal' ? 'bg-blue-50 text-blue-700' : 'bg-emerald-50 text-emerald-700'}`}>
          <span className="truncate">{value.label}</span>
          <button type="button" onClick={() => onChange(null)} className="hover:text-red-500 shrink-0"><X className="w-3 h-3" /></button>
        </span>
      </span>
    )
  }
  const qq = q.trim().toLowerCase()
  const matches = (qq ? links.filter(l => l.search.includes(qq)) : links).slice(0, 8)
  return (
    <div className="relative text-xs text-slate-500" ref={ref}>Deal/Property
      <input value={q} onChange={e => { setQ(e.target.value); setOpen(true) }} onFocus={() => setOpen(true)}
        placeholder="search…" className="ml-1.5 text-xs border border-slate-200 rounded-md px-2 py-1 w-36" />
      {open && matches.length > 0 && (
        <div className="absolute left-0 top-full mt-1 z-20 bg-white border border-slate-200 rounded-lg shadow-lg py-1 w-64 max-h-56 overflow-y-auto">
          {matches.map(l => (
            <button type="button" key={`${l.type}-${l.id}`} onClick={() => { onChange(l); setQ(''); setOpen(false) }}
              className="w-full text-left px-3 py-1.5 hover:bg-slate-50 flex items-center gap-2">
              <span className={`text-[9px] font-bold px-1 py-0.5 rounded shrink-0 ${l.type === 'deal' ? 'bg-blue-100 text-blue-700' : 'bg-emerald-100 text-emerald-700'}`}>{l.type === 'deal' ? 'DEAL' : 'PROP'}</span>
              <span className="truncate">{l.label}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function TaskRow({
  t, busy, waiting, done, selected, onSelect, onOpen, onDone, onDismiss, onWaiting,
  onReopen, snoozeOpen, onSnoozeToggle, onSnooze, snoozeRef, navigate,
}) {
  const today = todayStr()
  const overdue = t.due_date && t.due_date < today && !done
  return (
    <li className="flex items-center gap-3 px-4 py-2.5 group hover:bg-slate-50/70 transition-colors">
      <input type="checkbox" checked={selected} onChange={onSelect} onClick={e => e.stopPropagation()}
        className="rounded border-slate-300 opacity-0 group-hover:opacity-100 checked:opacity-100 shrink-0" />
      <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${PRIORITY_DOT[t.priority] || PRIORITY_DOT.normal}`} title={`${t.priority} priority`} />

      <div className="flex-1 min-w-0 cursor-pointer" onClick={onOpen}>
        <p className={`text-sm truncate ${done ? 'text-slate-400 line-through' : 'text-slate-800'}`}>{t.title}</p>
        <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
          {t.deal_label && (
            <button onClick={e => { e.stopPropagation(); navigate(`/pipeline/${t.deal_id}`) }}
              className="text-[11px] text-blue-600 bg-blue-50 px-1.5 py-0.5 rounded hover:bg-blue-100 truncate max-w-[200px]">{t.deal_label}</button>
          )}
          {t.property_label && (
            <button onClick={e => { e.stopPropagation(); navigate(`/management/${t.property_id}`) }}
              className="text-[11px] text-emerald-700 bg-emerald-50 px-1.5 py-0.5 rounded hover:bg-emerald-100 truncate max-w-[200px]">{t.property_label}</button>
          )}
          {waiting && t.waiting_on && (
            <span className="text-[11px] text-amber-700 bg-amber-50 px-1.5 py-0.5 rounded truncate max-w-[220px]">Waiting: {t.waiting_on}</span>
          )}
          {t.source === 'claude' && <span className="text-[10px] font-bold text-violet-700 bg-violet-100 px-1.5 py-0.5 rounded">CLAUDE</span>}
        </div>
      </div>

      {t.due_date && (
        <span className={`text-xs shrink-0 flex items-center gap-1 ${overdue ? 'text-red-600 font-semibold' : 'text-slate-400'}`}>
          {overdue && <AlertCircle className="w-3 h-3" />}{fmtDue(t.due_date)}
        </span>
      )}
      {t.owner_initials && (
        <span className="w-6 h-6 rounded-full bg-slate-100 text-[10px] font-bold text-slate-600 flex items-center justify-center shrink-0" title={t.owner_name}>{t.owner_initials}</span>
      )}

      {done ? (
        <button onClick={onReopen} className="text-xs text-slate-400 hover:text-blue-600 shrink-0">Reopen</button>
      ) : (
        <div className="flex items-center gap-0.5 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
          <button onClick={onDone} disabled={busy} title="Done" className="p-1.5 rounded-lg text-emerald-500 hover:bg-emerald-50">
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
          </button>
          <div className="relative" ref={snoozeOpen ? snoozeRef : null}>
            <button onClick={onSnoozeToggle} title="Snooze" className="p-1.5 rounded-lg text-slate-400 hover:bg-slate-100"><Clock3 className="w-4 h-4" /></button>
            {snoozeOpen && (
              <div className="absolute right-0 top-full mt-1 z-20 bg-white border border-slate-200 rounded-lg shadow-lg py-1 w-32 text-sm">
                <button onClick={() => onSnooze(1)} className="w-full text-left px-3 py-1.5 hover:bg-slate-50">Tomorrow</button>
                <button onClick={() => onSnooze(7)} className="w-full text-left px-3 py-1.5 hover:bg-slate-50">Next week</button>
                <label className="block px-3 py-1.5 hover:bg-slate-50 cursor-pointer">Pick date
                  <input type="date" className="sr-only" onChange={e => e.target.value && onSnooze(null, e.target.value)} />
                </label>
              </div>
            )}
          </div>
          {!waiting && (
            <button onClick={onWaiting} title="Mark waiting" className="p-1.5 rounded-lg text-slate-400 hover:text-amber-600 hover:bg-amber-50"><PauseCircle className="w-4 h-4" /></button>
          )}
          {waiting && (
            <button onClick={onWaiting} title="Back to open" className="p-1.5 rounded-lg text-slate-400 hover:text-blue-600 hover:bg-blue-50"><ListTodo className="w-4 h-4" /></button>
          )}
          <button onClick={onOpen} title="Edit" className="p-1.5 rounded-lg text-slate-400 hover:bg-slate-100"><Pencil className="w-4 h-4" /></button>
          <button onClick={onDismiss} title="Dismiss" className="p-1.5 rounded-lg text-slate-300 hover:text-red-500 hover:bg-red-50"><X className="w-4 h-4" /></button>
        </div>
      )}
    </li>
  )
}
