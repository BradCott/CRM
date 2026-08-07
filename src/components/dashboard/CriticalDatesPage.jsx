import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  CalendarClock, Loader2, FileSignature, ScrollText, Landmark, Shield, Receipt,
  Building2, KeyRound, DollarSign,
} from 'lucide-react'
import { getCriticalDates } from '../../api/client'

// kind → icon + short type label
const KIND = {
  dd_deadline:      { icon: FileSignature, tag: 'DD' },
  closing:          { icon: DollarSign,    tag: 'Closing' },
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

export default function CriticalDatesPage() {
  const navigate = useNavigate()
  const [data, setData]       = useState(null)
  const [loading, setLoading] = useState(true)
  const [bucket, setBucket]   = useState('all')   // all | deal | portfolio
  const [win, setWin]         = useState('90')

  useEffect(() => {
    getCriticalDates().then(setData).catch(() => setData({ deal: [], portfolio: [] })).finally(() => setLoading(false))
  }, [])

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
      .sort((a, b) => a.date < b.date ? -1 : a.date > b.date ? 1 : 0)
  }, [data, bucket, win])

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
          <div className="flex items-center rounded-lg border border-slate-200 bg-white p-0.5">
            {WINDOWS.map(w => (
              <button key={w.id} onClick={() => setWin(w.id)}
                className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${win === w.id ? 'bg-blue-600 text-white' : 'text-slate-500 hover:text-slate-700'}`}>
                {w.label}
              </button>
            ))}
          </div>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-20"><Loader2 className="w-6 h-6 text-slate-400 animate-spin" /></div>
        ) : items.length === 0 ? (
          <div className="text-center py-20 text-slate-400 text-sm">Nothing coming up in this window.</div>
        ) : (
          <div className="bg-white rounded-2xl border border-slate-200 shadow-sm divide-y divide-slate-100">
            {items.map((i, idx) => {
              const K = KIND[i.kind] || { icon: Building2, tag: '' }
              const u = urgency(i.daysUntil)
              return (
                <button key={idx} onClick={() => openItem(i)} className="w-full flex items-center gap-3 px-4 py-3 hover:bg-slate-50 text-left transition-colors">
                  <div className="w-9 h-9 rounded-lg bg-slate-100 flex items-center justify-center shrink-0">
                    <K.icon className="w-4 h-4 text-slate-500" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-semibold text-slate-800 truncate">{i.entity_name}</span>
                      <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded ${i.bucket === 'deal' ? 'bg-violet-50 text-violet-600' : 'bg-emerald-50 text-emerald-700'}`}>{K.tag}</span>
                    </div>
                    <p className="text-xs text-slate-500 truncate">{i.label}{i.sub ? ` · ${i.sub}` : ''}</p>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="text-sm font-medium text-slate-700 tabular-nums">{fmtDate(i.date)}</p>
                    <span className={`inline-block mt-0.5 text-[10px] font-semibold px-1.5 py-0.5 rounded border ${u.cls}`}>{u.text}</span>
                  </div>
                </button>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}

// Compact dashboard widget — shows the next few items from one bucket.
export function CriticalDatesWidget({ bucket, title, icon: Icon, limit = 5 }) {
  const navigate = useNavigate()
  const [items, setItems] = useState(null)

  useEffect(() => {
    getCriticalDates().then(d => setItems(d[bucket] || [])).catch(() => setItems([]))
  }, [bucket])

  const shown = (items || []).filter(i => i.daysUntil <= 60 || i.daysUntil < 0).slice(0, limit)

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
          {shown.map((i, idx) => {
            const K = KIND[i.kind] || { icon: Building2 }
            const u = urgency(i.daysUntil)
            return (
              <button key={idx} onClick={() => navigate(i.entity_type === 'deal' ? `/pipeline/${i.entity_id}` : `/management/${i.entity_id}`)}
                className="w-full flex items-center gap-2.5 px-4 py-2.5 hover:bg-slate-50 text-left transition-colors">
                <K.icon className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-medium text-slate-800 truncate">{i.entity_name}</p>
                  <p className="text-[11px] text-slate-400 truncate">{i.label}</p>
                </div>
                <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded border shrink-0 ${u.cls}`}>{u.text}</span>
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
