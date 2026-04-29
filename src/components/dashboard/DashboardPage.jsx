import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Landmark, TrendingUp, Users, FileCheck2, AlertTriangle,
  CalendarClock, Loader2, KanbanSquare,
  Clock, History, Mail, Shield, CheckCircle2, DollarSign, Building2, BarChart3,
} from 'lucide-react'
import { getDashboard, getDeals, getDashboardFinancials, getDashboardDeadlines, getDashboardActivity } from '../../api/client'
import knoxLogo from '../../assets/Knox.png'

// ── Formatters ────────────────────────────────────────────────────────────────
function fmt$(v) {
  if (!v && v !== 0) return '—'
  if (v >= 1_000_000) return `$${(v / 1_000_000).toFixed(2)}M`
  if (v >= 1_000)     return `$${Number(v).toLocaleString()}`
  return `$${v}`
}

function fmtDate(d) {
  if (!d) return '—'
  return new Date(d + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

function daysUntil(d) {
  if (!d) return null
  return Math.ceil((new Date(d + 'T00:00:00') - new Date()) / 86_400_000)
}

function monthsUntil(d) {
  if (!d) return null
  return (new Date(d + 'T00:00:00') - new Date()) / (86_400_000 * 30.44)
}

// ── Relative time ─────────────────────────────────────────────────────────────
function timeAgo(ts) {
  if (!ts) return '—'
  const diff = Date.now() - new Date(ts).getTime()
  if (diff < 0) return 'just now'
  const mins = Math.floor(diff / 60_000)
  if (mins < 1)  return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24)  return `${hrs}h ago`
  const days = Math.floor(hrs / 24)
  return `${days}d ago`
}

// ── Pipeline stage config ─────────────────────────────────────────────────────
const STAGE_ORDER = { 'Money Hard': 1, 'Under Contract': 2, 'PSA Negotiation': 3, 'LOI': 4 }

const STAGE_BADGE = {
  'Money Hard':      'bg-emerald-100 text-emerald-800 border border-emerald-200',
  'Under Contract':  'bg-blue-100 text-blue-800 border border-blue-200',
  'PSA Negotiation': 'bg-amber-100 text-amber-800 border border-amber-200',
  'LOI':             'bg-violet-100 text-violet-800 border border-violet-200',
}

// ── Main component ────────────────────────────────────────────────────────────
export default function DashboardPage() {
  const navigate = useNavigate()
  const [data, setData]           = useState(null)
  const [loading, setLoading]     = useState(true)
  const [pipeline, setPipeline]   = useState([])
  const [financials, setFinancials] = useState(null)
  const [deadlines, setDeadlines] = useState([])
  const [activity, setActivity]   = useState([])

  useEffect(() => {
    getDashboard()
      .then(setData)
      .catch(console.error)
      .finally(() => setLoading(false))

    getDeals()
      .then(deals => {
        const active = deals
          .filter(d => d.stage !== 'Closed' && d.stage !== 'Dropped')
          .sort((a, b) => {
            const ao = STAGE_ORDER[a.stage] ?? 99
            const bo = STAGE_ORDER[b.stage] ?? 99
            return ao - bo
          })
        setPipeline(active)
      })
      .catch(console.error)

    getDashboardFinancials().then(setFinancials).catch(console.error)
    getDashboardDeadlines().then(setDeadlines).catch(console.error)
    getDashboardActivity().then(setActivity).catch(console.error)
  }, [])

  const today = new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })

  // Group expiring leases into buckets
  const leaseGroups = [
    { label: '0 – 3 Years',   min: 0,  max: 36,  color: 'red'    },
    { label: '3 – 5 Years',   min: 36, max: 60,  color: 'amber'  },
    { label: '5 – 7.5 Years', min: 60, max: 90,  color: 'emerald' },
  ]

  const groupedLeases = leaseGroups.map(g => ({
    ...g,
    leases: (data?.expiring_leases || []).filter(l => {
      const m = monthsUntil(l.lease_end)
      return m != null && m > g.min && m <= g.max
    }),
  }))

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="w-6 h-6 text-slate-400 animate-spin" />
      </div>
    )
  }

  return (
    <div className="flex-1 overflow-y-auto bg-slate-50">
      <div className="max-w-7xl mx-auto px-6 py-8 space-y-8">

        {/* ── Header ─────────────────────────────────────────────────────── */}
        <div className="flex items-center justify-between">
          <LogoOrFallback />
          <p className="text-sm text-slate-400">{today}</p>
        </div>

        {/* ── Metric cards ───────────────────────────────────────────────── */}
        <div className="grid grid-cols-4 gap-4">
          <MetricCard
            icon={Landmark}
            label="Portfolio Purchase Value"
            value={fmt$(data?.portfolio_purchase_value)}
            color="blue"
          />
          <MetricCard
            icon={TrendingUp}
            label="Total Fees to Collect"
            value={fmt$(data?.fees_to_collect)}
            color="emerald"
          />
          <MetricCard
            icon={FileCheck2}
            label="Properties Under Contract"
            value={data?.under_contract_count ?? '—'}
            color="amber"
          />
          <MetricCard
            icon={Users}
            label="Active Investors"
            value={data?.active_investors_count ?? '—'}
            color="violet"
          />
        </div>

        {/* ── Under Contract ─────────────────────────────────────────────── */}
        <Section title="Properties Under Contract" icon={FileCheck2}>
          {!data?.under_contract?.length ? (
            <EmptyRow message="No properties currently under contract." />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 border-b border-slate-200">
                  <tr>
                    {['Property', 'Tenant', 'Purchase Price', 'DD End', 'Closing Date', 'Days to Close'].map(h => (
                      <th key={h} className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wide whitespace-nowrap">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {data.under_contract.map((p, i) => {
                    const days = daysUntil(p.close_date)
                    return (
                      <tr key={p.id} className={`border-b border-slate-100 last:border-0 ${i % 2 === 0 ? 'bg-white' : 'bg-slate-50/40'}`}>
                        <td className="px-4 py-3">
                          <p className="font-medium text-slate-900">{p.address}</p>
                          {(p.city || p.state) && <p className="text-xs text-slate-500">{[p.city, p.state].filter(Boolean).join(', ')}</p>}
                        </td>
                        <td className="px-4 py-3">
                          {p.tenant_brand_name
                            ? <span className="text-xs font-semibold text-blue-700 bg-blue-50 px-2 py-0.5 rounded-full">{p.tenant_brand_name}</span>
                            : <span className="text-slate-300">—</span>}
                        </td>
                        <td className="px-4 py-3 font-medium text-slate-900">{fmt$(p.purchase_price)}</td>
                        <td className="px-4 py-3 text-slate-700">{fmtDate(p.dd_end_date)}</td>
                        <td className="px-4 py-3 text-slate-700">{fmtDate(p.close_date)}</td>
                        <td className="px-4 py-3">
                          {days != null ? (
                            <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${
                              days < 0   ? 'bg-red-100 text-red-700'
                              : days < 14 ? 'bg-amber-100 text-amber-700'
                              : 'bg-emerald-100 text-emerald-700'
                            }`}>
                              {days < 0 ? `${Math.abs(days)}d overdue` : `${days}d`}
                            </span>
                          ) : <span className="text-slate-300">—</span>}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Section>

        {/* ── Active Pipeline ────────────────────────────────────────────── */}
        <Section title="Active Pipeline" icon={KanbanSquare}>
          {pipeline.length === 0 ? (
            <EmptyRow message="No active pipeline deals." />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 border-b border-slate-200">
                  <tr>
                    {['Address', 'Tenant', 'Deal Stage', 'Purchase Price', 'EMD Amount', 'Est. Equity (25%)'].map(h => (
                      <th key={h} className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wide whitespace-nowrap">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {pipeline.map((deal, i) => {
                    const equity = deal.purchase_price ? deal.purchase_price * 0.25 : null
                    return (
                      <tr
                        key={deal.id}
                        onClick={() => navigate('/pipeline')}
                        className={`border-b border-slate-100 last:border-0 cursor-pointer hover:bg-blue-50/50 transition-colors ${i % 2 === 0 ? 'bg-white' : 'bg-slate-50/40'}`}
                      >
                        <td className="px-4 py-3">
                          <p className="font-medium text-slate-900">{deal.address || '—'}</p>
                          {(deal.city || deal.state) && (
                            <p className="text-xs text-slate-500">{[deal.city, deal.state].filter(Boolean).join(', ')}</p>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          {deal.tenant_brand_name
                            ? <span className="text-xs font-semibold text-blue-700 bg-blue-50 px-2 py-0.5 rounded-full">{deal.tenant_brand_name}</span>
                            : deal.tenant
                              ? <span className="text-sm text-slate-700">{deal.tenant}</span>
                              : <span className="text-slate-300">—</span>}
                        </td>
                        <td className="px-4 py-3">
                          <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${STAGE_BADGE[deal.stage] || 'bg-slate-100 text-slate-600 border border-slate-200'}`}>
                            {deal.stage}
                          </span>
                        </td>
                        <td className="px-4 py-3 font-medium text-slate-900">{fmt$(deal.purchase_price)}</td>
                        <td className="px-4 py-3 text-slate-700">{fmt$(deal.earnest_money)}</td>
                        <td className="px-4 py-3 text-emerald-700 font-medium">{fmt$(equity)}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Section>

        {/* ── Upcoming Deadlines ─────────────────────────────────────────── */}
        <Section title="Upcoming Deadlines" icon={Clock}>
          {deadlines.length === 0 ? (
            <EmptyRow message="No upcoming deadlines." />
          ) : (
            <ul className="divide-y divide-slate-100">
              {deadlines.map((item, i) => {
                const days = daysUntil(item.due_date)
                const overdue = days !== null && days < 0
                const urgent  = days !== null && days <= 7
                const soon    = days !== null && days <= 30
                const urgencyDot = overdue || urgent ? 'bg-red-400'
                  : soon ? 'bg-amber-400' : 'bg-emerald-400'
                const urgencyText = overdue || urgent ? 'text-red-600 font-semibold'
                  : soon ? 'text-amber-700 font-semibold' : 'text-emerald-700'
                const typeIcon = item.type === 'insurance' ? Shield
                  : item.type === 'deal' ? KanbanSquare : Clock

                const TypeIcon = typeIcon
                const navTarget = item.type === 'insurance'
                  ? `/management/${item.property_id}?tab=insurance`
                  : item.type === 'deal'
                  ? '/pipeline'
                  : item.property_id ? `/management/${item.property_id}` : null

                return (
                  <li
                    key={`${item.type}-${item.id}-${i}`}
                    onClick={navTarget ? () => navigate(navTarget) : undefined}
                    className={`flex items-center gap-4 px-6 py-3.5 ${navTarget ? 'cursor-pointer hover:bg-slate-50 transition-colors' : ''}`}
                  >
                    <div className={`w-2 h-2 rounded-full shrink-0 ${urgencyDot}`} />
                    <TypeIcon className="w-4 h-4 text-slate-400 shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-slate-800 truncate">{item.title}</p>
                      {item.property_address && (
                        <p className="text-xs text-slate-400 truncate">
                          {[item.property_address, item.property_city].filter(Boolean).join(', ')}
                        </p>
                      )}
                    </div>
                    <div className="text-right shrink-0">
                      <p className={`text-xs ${urgencyText}`}>
                        {overdue
                          ? `${Math.abs(days)}d overdue`
                          : days === 0 ? 'Today'
                          : `${days}d`}
                      </p>
                      <p className="text-xs text-slate-400">{fmtDate(item.due_date)}</p>
                    </div>
                  </li>
                )
              })}
            </ul>
          )}
        </Section>

        {/* ── Recent Activity ─────────────────────────────────────────────── */}
        <Section title="Recent Activity" icon={History}>
          {activity.length === 0 ? (
            <EmptyRow message="No recent activity." />
          ) : (
            <ul className="divide-y divide-slate-100">
              {activity.map((item, i) => {
                const TypeIcon = item.type === 'letter'    ? Mail
                  : item.type === 'insurance' ? Shield
                  : item.type === 'task_done' ? CheckCircle2
                  : KanbanSquare

                const iconColor = item.type === 'letter'    ? 'text-blue-400'
                  : item.type === 'insurance' ? 'text-amber-400'
                  : item.type === 'task_done' ? 'text-emerald-500'
                  : 'text-violet-400'

                const navTarget = item.type === 'insurance' && item.property_id
                  ? `/management/${item.property_id}?tab=insurance`
                  : (item.type === 'task_done' || item.type === 'insurance') && item.property_id
                  ? `/management/${item.property_id}`
                  : item.type === 'deal' ? '/pipeline'
                  : null

                return (
                  <li
                    key={`act-${item.type}-${item.id}-${i}`}
                    onClick={navTarget ? () => navigate(navTarget) : undefined}
                    className={`flex items-center gap-4 px-6 py-3.5 ${navTarget ? 'cursor-pointer hover:bg-slate-50 transition-colors' : ''}`}
                  >
                    <div className={`w-8 h-8 rounded-full bg-slate-100 flex items-center justify-center shrink-0`}>
                      <TypeIcon className={`w-4 h-4 ${iconColor}`} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-slate-800 truncate">{item.description}</p>
                      {item.actor && (
                        <p className="text-xs text-slate-400">{item.actor}</p>
                      )}
                    </div>
                    <p className="text-xs text-slate-400 shrink-0">{timeAgo(item.timestamp)}</p>
                  </li>
                )
              })}
            </ul>
          )}
        </Section>

        {/* ── Leases Expiring ────────────────────────────────────────────── */}
        <Section title="Leases Expiring Soon" icon={CalendarClock}>
          {groupedLeases.every(g => g.leases.length === 0) ? (
            <EmptyRow message="No leases expiring in the next 7.5 years." />
          ) : (
            <div className="grid grid-cols-3 gap-4 p-4">
              {groupedLeases.map(group => (
                <LeaseGroup key={group.label} group={group} />
              ))}
            </div>
          )}
        </Section>

      </div>
    </div>
  )
}

// ── Sub-components ────────────────────────────────────────────────────────────

function LogoOrFallback() {
  return (
    <div className="bg-black rounded-xl px-4 py-2 shadow-sm">
      <img src={knoxLogo} alt="Knox" style={{ width: 180 }} className="object-contain" />
    </div>
  )
}

const COLOR_MAP = {
  blue:    { bg: 'bg-blue-50',    icon: 'text-blue-600',   val: 'text-blue-800'   },
  emerald: { bg: 'bg-emerald-50', icon: 'text-emerald-600',val: 'text-emerald-800'},
  amber:   { bg: 'bg-amber-50',   icon: 'text-amber-600',  val: 'text-amber-800'  },
  violet:  { bg: 'bg-violet-50',  icon: 'text-violet-600', val: 'text-violet-800' },
}

function MetricCard({ icon: Icon, label, value, color }) {
  const c = COLOR_MAP[color]
  return (
    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm px-6 py-5">
      <div className={`w-10 h-10 rounded-xl ${c.bg} flex items-center justify-center mb-3`}>
        <Icon className={`w-5 h-5 ${c.icon}`} />
      </div>
      <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-1">{label}</p>
      <p className={`text-3xl font-bold ${c.val}`}>{value}</p>
    </div>
  )
}

function Section({ title, icon: Icon, children }) {
  return (
    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
      <div className="flex items-center gap-2 px-6 py-4 border-b border-slate-100">
        <Icon className="w-4 h-4 text-slate-400" />
        <h2 className="text-sm font-bold text-slate-800 uppercase tracking-widest">{title}</h2>
      </div>
      {children}
    </div>
  )
}

function EmptyRow({ message }) {
  return (
    <div className="flex items-center gap-2 px-6 py-8 text-slate-400">
      <AlertTriangle className="w-4 h-4" />
      <p className="text-sm">{message}</p>
    </div>
  )
}

const LEASE_COLORS = {
  red:     { header: 'bg-red-50 border-red-200',     badge: 'bg-red-100 text-red-700',     dot: 'bg-red-400'     },
  amber:   { header: 'bg-amber-50 border-amber-200', badge: 'bg-amber-100 text-amber-700', dot: 'bg-amber-400'   },
  emerald: { header: 'bg-emerald-50 border-emerald-200', badge: 'bg-emerald-100 text-emerald-700', dot: 'bg-emerald-400' },
}

function LeaseGroup({ group }) {
  const c = LEASE_COLORS[group.color]
  return (
    <div className={`rounded-xl border ${c.header} overflow-hidden`}>
      <div className="px-4 py-3 border-b border-inherit flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className={`w-2 h-2 rounded-full ${c.dot}`} />
          <p className="text-sm font-semibold text-slate-700">{group.label}</p>
        </div>
        <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${c.badge}`}>
          {group.leases.length}
        </span>
      </div>
      {group.leases.length === 0 ? (
        <p className="px-4 py-4 text-sm text-slate-400 italic">None</p>
      ) : (
        <ul className="divide-y divide-slate-100">
          {group.leases.map(l => (
            <li key={l.id} className="px-4 py-3">
              <p className="text-sm font-medium text-slate-800 truncate">{l.address}</p>
              <div className="flex items-center gap-2 mt-0.5">
                {l.tenant_brand_name && (
                  <span className="text-xs text-blue-600 font-medium">{l.tenant_brand_name}</span>
                )}
                <span className="text-xs text-slate-400">{fmtDate(l.lease_end)}</span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
