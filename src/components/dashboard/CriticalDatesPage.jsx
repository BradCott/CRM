import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  CalendarClock, Loader2, FileSignature, ScrollText, Landmark, Shield, Receipt,
  Building2, KeyRound, DollarSign, Circle, CheckCircle2,
} from 'lucide-react'
import { getCriticalDates, completeCriticalDate, uncompleteCriticalDate } from '../../api/client'

// kind → icon + short type label
const KIND = {
  dd_deadline:      { icon: FileSignature, tag: 'DD' },
  closing:          { icon: DollarSign,    tag: 'Closing' },
  effective_date:   { icon: FileSignature, tag: 'PSA' },
  earnest_due:      { icon: DollarSign,    tag: 'Earnest' },
  title_objection:  { icon: FileSignature, tag: 'Title' },
  order_by:         { icon: KeyRound,      tag: 'Order' },
  psa_date:         { icon: FileSignature, tag: 'PSA' },
  lease_expiration: { icon: ScrollText,    tag: 'Lease' },
  lease_key_date:   { icon: KeyRound,      tag: 'Lease' },
  loan_maturity:    { icon: Landmark,      tag: 'Loan' },
  insurance_exp:    { icon: Shield,        tag: 'Insurance' },
  tax_due:          { icon: Receipt,       tag: 'Tax' },
}

const WINDOWS = [
  { id: '30',  label: 'Next 30 days',  days: 30 },
  { id: '90',  label: 'Next 90 days',  days: 90 },
  { id: '180', label: 'Next 6 months', days: 180 },
  { id: 'all', label: 'All upcoming',  days: Infinity },
]

function fmtDate(iso) {
  if (!iso) return '—'
  const [y, m, d] = iso.split('-')
  return new Date(+y, +m - 1, +d).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
}

// severity by days-until → badge styling + relative text
function urgency(days) {
  if (days < 0)   return { cls: 'bg-red-50 text-red-700 border-red-200',       text: `${Math.abs(days)}d overdue` }
  if (days === 0) return { cls: 'bg-red-50 text-red-700 border-red-200',       text: 'Today' }
  if (days <= 14) return { cls: 'bg-red-50 text-red-600 border-red-200',       text: `${days}d` }
  if (days <= 45) return { cls: 'bg-amber-50 text-amber-700 border-amber-200', text: `${days}d` }
  if (days <= 90) return { cls: 'bg-blue-50 text-blue-700 border-blue-200',    text: `${days}d` }
  return { cls: 'bg-slate-100 text-slate-500 border-slate-200', text: `${days}d` }
}

// Stable identity for a computed date — matches the server completion key.
const keyOf = i => `${i.entity_type}:${i.entity_id}:${i.kind}:${i.date}`
const pick  = i => ({ entity_type: i.entity_type, entity_id: i.entity_id, kind: i.kind, date: i.date })

// Subtext: simple tenant brand + property city (e.g. "Sherwin-Williams · Poplar Bluff").
// Falls back to whatever is on hand when a brand/city isn't recorded.
function tenantCity(i) {
  const parts = [i.brand, i.city].filter(Boolean)
  return parts.length ? parts.join(' · ') : (i.city || i.sub || i.entity_name || '')
}

export default function CriticalDatesPage() {
  const navigate = useNavigate()
  const [data, setData]       = useState(null)
  const [loading, setLoading] = useState(true)
  const [bucket, setBucket]   = useState('all')   // all | deal | portfolio
  const [win, setWin]         = useState('90')
  const [showDone, setShowDone] = useState(false)

  useEffect(() => {
    getCriticalDates().then(setData).catch(() => setData({ deal: [], portfolio: [] })).finally(() => setLoading(false))
  }, [])

  // Optimistically flip an item's done state in both buckets, then persist.
  const setDone = async (item, done) => {
    const k = keyOf(item)
    const flip = v => d => ({
      deal:      d.deal.map(x => keyOf(x) === k ? { ...x, done: v } : x),
      portfolio: d.portfolio.map(x => keyOf(x) === k ? { ...x, done: v } : x),
    })
    setData(flip(done))
    try { await (done ? completeCriticalDate(pick(item)) : uncompleteCriticalDate(pick(item))) }
    catch { setData(flip(!done)) }   // revert on failure
  }

  const items = useMemo(() => {
    if (!data) return []
    const all = [
      ...data.deal.map(i => ({ ...i, bucket: 'deal' })),
      ...data.portfolio.map(i => ({ ...i, bucket: 'portfolio' })),
    ]
    const days = WINDOWS.find(w => w.id === win)?.days ?? Infinity
    return all
      .filter(i => bucket === 'all' || i.bucket === bucket)
      .filter(i => i.daysUntil < 0 || i.daysUntil <= days)   // overdue always shown
      .filter(i => showDone || !i.done)                      // hide completed unless toggled
      .sort((a, b) => a.date < b.date ? -1 : a.date > b.date ? 1 : 0)
  }, [data, bucket, win, showDone])

  const doneCount = useMemo(
    () => !data ? 0 : [...data.deal, ...data.portfolio].filter(i => i.done).length,
    [data],
  )

  const openItem = (i) => navigate(i.entity_type === 'deal' ? `/pipeline/${i.entity_id}` : `/management/${i.entity_id}`)

  return (
    <div className="flex-1 overflow-y-auto bg-slate-50">
      <div className="max-w-5xl mx-auto px-6 py-6">
        <div className="flex items-center gap-2 mb-1">
          <CalendarClock className="w-5 h-5 text-blue-500" />
          <h1 className="text-xl font-bold text-slate-900">Critical Dates</h1>
        </div>
        <p className="text-sm text-slate-500 mb-5">Upcoming escrow deadlines and portfolio dates. Overdue items are always shown.</p>

        {/* Filters */}
        <div className="flex items-center justify-between gap-3 mb-4 flex-wrap">
          <div className="flex items-center rounded-lg border border-slate-200 bg-white p-0.5">
            {[['all', 'All'], ['deal', 'Escrow'], ['portfolio', 'Portfolio']].map(([id, label]) => (
              <button key={id} onClick={() => setBucket(id)}
                className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${bucket === id ? 'bg-slate-800 text-white' : 'text-slate-500 hover:text-slate-700'}`}>
                {label}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-3 flex-wrap">
            <button onClick={() => setShowDone(v => !v)}
              className={`px-3 py-1.5 rounded-lg border text-xs font-medium transition-colors ${showDone ? 'bg-emerald-50 border-emerald-200 text-emerald-700' : 'bg-white border-slate-200 text-slate-500 hover:text-slate-700'}`}>
              {showDone ? 'Hide completed' : `Show completed${doneCount ? ` (${doneCount})` : ''}`}
            </button>
            <div className="flex items-center rounded-lg border border-slate-200 bg-white p-0.5">
              {WINDOWS.map(w => (
                <button key={w.id} onClick={() => setWin(w.id)}
                  className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${win === w.id ? 'bg-blue-600 text-white' : 'text-slate-500 hover:text-slate-700'}`}>
                  {w.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-20"><Loader2 className="w-6 h-6 text-slate-400 animate-spin" /></div>
        ) : items.length === 0 ? (
          <div className="text-center py-20 text-slate-400 text-sm">Nothing coming up in this window.</div>
        ) : (
          <div className="bg-white rounded-2xl border border-slate-200 shadow-sm divide-y divide-slate-100">
            {items.map((i) => {
              const K = KIND[i.kind] || { icon: Building2, tag: '' }
              const u = urgency(i.daysUntil)
              return (
                <div key={keyOf(i)} className={`flex items-center gap-3 px-4 py-3 transition-colors ${i.done ? 'bg-slate-50/60' : 'hover:bg-slate-50'}`}>
                  <button
                    onClick={() => setDone(i, !i.done)}
                    title={i.done ? 'Mark as not complete' : 'Mark complete'}
                    className={`shrink-0 ${i.done ? 'text-emerald-500 hover:text-slate-400' : 'text-slate-300 hover:text-emerald-500'} transition-colors`}>
                    {i.done ? <CheckCircle2 className="w-5 h-5" /> : <Circle className="w-5 h-5" />}
                  </button>
                  <button onClick={() => openItem(i)} className="min-w-0 flex-1 flex items-center gap-3 text-left">
                    <div className="w-9 h-9 rounded-lg bg-slate-100 flex items-center justify-center shrink-0">
                      <K.icon className="w-4 h-4 text-slate-500" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className={`text-sm font-semibold truncate ${i.done ? 'text-slate-400 line-through' : 'text-slate-800'}`}>{i.label}</span>
                        <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded ${i.bucket === 'deal' ? 'bg-violet-50 text-violet-600' : 'bg-emerald-50 text-emerald-700'}`}>{K.tag}</span>
                      </div>
                      <p className={`text-xs truncate ${i.done ? 'text-slate-300' : 'text-slate-500'}`}>{tenantCity(i)}</p>
                    </div>
                  </button>
                  <div className="text-right shrink-0">
                    <p className={`text-sm font-medium tabular-nums ${i.done ? 'text-slate-400' : 'text-slate-700'}`}>{fmtDate(i.date)}</p>
                    {!i.done && <span className={`inline-block mt-0.5 text-[10px] font-semibold px-1.5 py-0.5 rounded border ${u.cls}`}>{u.text}</span>}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}

// Compact dashboard widget — shows the next few outstanding items from one bucket.
export function CriticalDatesWidget({ bucket, title, icon: Icon, limit = 5 }) {
  const navigate = useNavigate()
  const [items, setItems] = useState(null)

  useEffect(() => {
    getCriticalDates().then(d => setItems(d[bucket] || [])).catch(() => setItems([]))
  }, [bucket])

  // Mark complete → the item drops off the widget immediately (undo lives on "View all").
  const markDone = async (item) => {
    const k = keyOf(item)
    setItems(prev => (prev || []).map(x => keyOf(x) === k ? { ...x, done: true } : x))
    try { await completeCriticalDate(pick(item)) }
    catch { setItems(prev => (prev || []).map(x => keyOf(x) === k ? { ...x, done: false } : x)) }
  }

  const shown = (items || []).filter(i => !i.done && (i.daysUntil <= 60 || i.daysUntil < 0)).slice(0, limit)

  return (
    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm">
      <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100">
        <div className="flex items-center gap-2">
          <Icon className="w-4 h-4 text-slate-400" />
          <h3 className="text-sm font-semibold text-slate-800">{title}</h3>
        </div>
        <button onClick={() => navigate('/critical-dates')} className="text-xs text-blue-600 hover:underline">View all</button>
      </div>
      {items == null ? (
        <div className="flex items-center justify-center py-8"><Loader2 className="w-4 h-4 text-slate-300 animate-spin" /></div>
      ) : shown.length === 0 ? (
        <p className="text-xs text-slate-400 px-4 py-6 text-center">Nothing upcoming.</p>
      ) : (
        <div className="divide-y divide-slate-50">
          {shown.map((i) => {
            const u = urgency(i.daysUntil)
            return (
              <div key={keyOf(i)} className="flex items-center gap-2.5 px-4 py-2.5 hover:bg-slate-50 transition-colors">
                <button
                  onClick={() => markDone(i)}
                  title="Mark complete"
                  className="shrink-0 text-slate-300 hover:text-emerald-500 transition-colors">
                  <Circle className="w-4 h-4" />
                </button>
                <button onClick={() => navigate(i.entity_type === 'deal' ? `/pipeline/${i.entity_id}` : `/management/${i.entity_id}`)}
                  className="min-w-0 flex-1 text-left">
                  <p className="text-xs font-semibold text-slate-800 truncate">{i.label}</p>
                  <p className="text-[11px] text-slate-400 truncate">{tenantCity(i)}</p>
                </button>
                <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded border shrink-0 ${u.cls}`}>{u.text}</span>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
