import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Landmark, TrendingUp, Users, FileCheck2, AlertTriangle,
  CalendarClock, Loader2, KanbanSquare,
  History, Mail, Shield, CheckCircle2, Building2,
  MapPin, Calendar, Send, BookOpen, Plus,
} from 'lucide-react'
import { getDashboard, getDeals, getDashboardActivity, getDashboardMapProperties, getDashboardLeaseExpirations, getLauncherCounts } from '../../api/client'
import knoxLogo from '../../assets/Knox.png'
import PortfolioMap from './PortfolioMap'
import TodaysPlays from './TodaysPlays'
import BrokerLeaderboard from './BrokerLeaderboard'
import MailEngine from './MailEngine'
import TreasuryChart from './TreasuryChart'

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

function timeRemaining(leaseEnd) {
  if (!leaseEnd) return { label: 'Unknown', cls: 'text-slate-400' }
  const end   = new Date(leaseEnd + 'T00:00:00')
  const now   = new Date()
  const totalMonths = Math.round((end - now) / (1000 * 60 * 60 * 24 * 30.44))
  if (totalMonths < 0) return { label: 'EXPIRED', cls: 'text-red-600 font-bold' }
  const years  = Math.floor(totalMonths / 12)
  const months = totalMonths % 12
  const parts  = []
  if (years  > 0) parts.push(`${years} yr${years  > 1 ? 's' : ''}`)
  if (months > 0 || years === 0) parts.push(`${months} mo`)
  const cls = totalMonths < 12  ? 'text-red-600 font-semibold'
            : totalMonths < 24  ? 'text-amber-700 font-semibold'
            : 'text-emerald-700'
  return { label: parts.join(' '), cls }
}

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

const STAGE_BAR = {
  'LOI':             'bg-violet-300',
  'PSA Negotiation': 'bg-amber-300',
  'Under Contract':  'bg-blue-400',
  'Money Hard':      'bg-emerald-400',
}

// ── Main component ────────────────────────────────────────────────────────────
export default function DashboardPage() {
  const navigate = useNavigate()
  const [data, setData]           = useState(null)
  const [loading, setLoading]     = useState(true)
  const [pipeline, setPipeline]   = useState([])
  const [activity, setActivity]             = useState([])
  const [mapProperties, setMapProperties]   = useState([])
  const [leaseExpirations, setLeaseExpirations] = useState([])
  const [launcher, setLauncher]   = useState(null)
  const [mapOpen, setMapOpen]     = useState(false)

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

    getDashboardActivity().then(setActivity).catch(console.error)
    getDashboardMapProperties().then(setMapProperties).catch(console.error)
    getDashboardLeaseExpirations().then(setLeaseExpirations).catch(console.error)
    getLauncherCounts().then(setLauncher).catch(console.error)
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

  const pipelineValue = pipeline.reduce((s, d) => s + (Number(d.purchase_price) || 0), 0)
  const stageCounts = pipeline.reduce((acc, d) => {
    acc[d.stage] = (acc[d.stage] || 0) + 1
    return acc
  }, {})

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="w-6 h-6 text-slate-400 animate-spin" />
      </div>
    )
  }

  return (
    <div className="flex-1 overflow-y-auto bg-slate-50">
      <div className="max-w-7xl mx-auto px-6 py-6 space-y-6">

        {/* ── Header ─────────────────────────────────────────────────────── */}
        <div className="flex items-center justify-between">
          <div className="bg-black rounded-xl px-4 py-2 shadow-sm">
            <img src={knoxLogo} alt="Knox" style={{ width: 160 }} className="object-contain" />
          </div>
          <p className="text-sm text-slate-400">{today}</p>
        </div>

        {/* ── Action launcher ────────────────────────────────────────────── */}
        <div className="grid grid-cols-4 gap-3">
          <LauncherButton
            icon={Send} color="text-violet-600" bg="hover:border-violet-300"
            label="Send Mail"
            sub={launcher?.mail_due > 0 ? `${launcher.mail_due} owners due` : 'All caught up'}
            subColor={launcher?.mail_due > 0 ? 'text-orange-600' : 'text-slate-400'}
            onClick={() => navigate('/campaigns')}
          />
          <LauncherButton
            icon={Building2} color="text-blue-600" bg="hover:border-blue-300"
            label="Market Properties"
            sub={launcher?.market_new > 0 ? `${launcher.market_new} new this week` : 'Browse market'}
            subColor="text-slate-400"
            onClick={() => navigate('/properties')}
          />
          <LauncherButton
            icon={BookOpen} color="text-emerald-600" bg="hover:border-emerald-300"
            label="Accounting"
            sub={launcher?.bills_due > 0 ? `${launcher.bills_due} bill${launcher.bills_due !== 1 ? 's' : ''} due soon` : 'Books current'}
            subColor={launcher?.bills_due > 0 ? 'text-amber-600' : 'text-slate-400'}
            onClick={() => navigate('/accounting')}
          />
          <LauncherButton
            icon={Plus} color="text-slate-600" bg="hover:border-slate-400"
            label="New Deal"
            sub="Add to pipeline"
            subColor="text-slate-400"
            onClick={() => navigate('/pipeline')}
          />
        </div>

        {/* ── Command center: plays + brokers | mail + stats + activity ──── */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 items-start">
          <div className="lg:col-span-2 space-y-4">
            <TodaysPlays />
            <BrokerLeaderboard />
          </div>

          <div className="space-y-4">
            <TreasuryChart />
            <MailEngine />

            {/* Compact stats */}
            <div className="bg-white rounded-2xl border border-slate-200 shadow-sm px-5 py-4">
              <div className="grid grid-cols-2 gap-x-4 gap-y-3">
                <MiniStat icon={Landmark} label="Portfolio" value={fmt$(data?.portfolio_purchase_value)} color="text-blue-700" />
                <MiniStat icon={KanbanSquare} label="Pipeline" value={fmt$(pipelineValue)} color="text-violet-700" />
                <MiniStat icon={TrendingUp} label="Fees to Collect" value={fmt$(data?.fees_to_collect)} color="text-emerald-700" />
                <MiniStat icon={Users} label="Investors" value={data?.active_investors_count ?? '—'} color="text-slate-700" />
              </div>
              {/* Stage distribution bar */}
              {pipeline.length > 0 && (
                <div className="mt-4 pt-3 border-t border-slate-100">
                  <div className="flex gap-1 mb-1.5">
                    {Object.entries(STAGE_BAR).map(([stage, cls]) =>
                      stageCounts[stage] ? (
                        <div key={stage} className={`h-2 rounded-full ${cls}`} style={{ flex: stageCounts[stage] }} title={`${stage}: ${stageCounts[stage]}`} />
                      ) : null
                    )}
                  </div>
                  <p className="text-xs text-slate-400">
                    {pipeline.length} active deal{pipeline.length !== 1 ? 's' : ''} · {Object.entries(stageCounts).map(([s, n]) => `${s} ${n}`).join(' · ')}
                  </p>
                </div>
              )}
            </div>

            {/* Compact activity */}
            <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
              <div className="flex items-center gap-2 px-5 py-3 border-b border-slate-100">
                <History className="w-4 h-4 text-slate-400" />
                <h2 className="text-sm font-bold text-slate-800">Activity</h2>
              </div>
              {activity.length === 0 ? (
                <p className="px-5 py-4 text-xs text-slate-400">No recent activity</p>
              ) : (
                <ul className="divide-y divide-slate-50">
                  {activity.slice(0, 6).map((item, i) => {
                    const TypeIcon = item.type === 'letter' ? Mail
                      : item.type === 'insurance' ? Shield
                      : item.type === 'task_done' ? CheckCircle2
                      : KanbanSquare
                    return (
                      <li key={`act-${item.type}-${item.id}-${i}`} className="flex items-center gap-2.5 px-5 py-2">
                        <TypeIcon className="w-3.5 h-3.5 text-slate-300 shrink-0" />
                        <p className="flex-1 text-xs text-slate-600 truncate">{item.description}</p>
                        <span className="text-[10px] text-slate-400 shrink-0">{timeAgo(item.timestamp)}</span>
                      </li>
                    )
                  })}
                </ul>
              )}
            </div>
          </div>
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

        {/* ── Portfolio Map — collapsed by default ───────────────────────── */}
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
          <button
            onClick={() => setMapOpen(o => !o)}
            className="w-full flex items-center justify-between px-6 py-4 hover:bg-slate-50 transition-colors text-left"
          >
            <div className="flex items-center gap-2">
              <MapPin className="w-4 h-4 text-slate-400" />
              <h2 className="text-sm font-bold text-slate-800 uppercase tracking-widest">Portfolio Map</h2>
              <span className="text-xs text-slate-400 normal-case tracking-normal">{mapProperties.length} properties</span>
            </div>
            <span className="text-xs text-slate-400">{mapOpen ? 'Hide' : 'Show'}</span>
          </button>
          {mapOpen && (
            <div className="overflow-hidden rounded-b-2xl border-t border-slate-100">
              <PortfolioMap properties={mapProperties} />
            </div>
          )}
        </div>

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

        {/* ── Lease Expirations ───────────────────────────────────────────── */}
        <Section title="Lease Expirations" icon={Calendar}>
          {leaseExpirations.length === 0 ? (
            <EmptyRow message="No portfolio properties found." />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 border-b border-slate-200">
                  <tr>
                    {['Property', 'Tenant', 'Lease Expiration', 'Time Remaining'].map(h => (
                      <th key={h} className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wide whitespace-nowrap">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {leaseExpirations.map((p, i) => {
                    const { label, cls } = timeRemaining(p.lease_end)
                    return (
                      <tr
                        key={p.id}
                        onClick={() => navigate(`/management/${p.id}`)}
                        className={`border-b border-slate-100 last:border-0 cursor-pointer hover:bg-blue-50/50 transition-colors ${i % 2 === 0 ? 'bg-white' : 'bg-slate-50/40'}`}
                      >
                        <td className="px-4 py-3">
                          <p className="font-medium text-slate-900">{p.address}</p>
                          {(p.city || p.state) && (
                            <p className="text-xs text-slate-500">{[p.city, p.state].filter(Boolean).join(', ')}</p>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          {p.tenant_brand_name
                            ? <span className="text-xs font-semibold text-blue-700 bg-blue-50 px-2 py-0.5 rounded-full">{p.tenant_brand_name}</span>
                            : <span className="text-slate-300">—</span>}
                        </td>
                        <td className="px-4 py-3 text-slate-700">{p.lease_end ? fmtDate(p.lease_end) : <span className="text-slate-300">—</span>}</td>
                        <td className={`px-4 py-3 ${cls}`}>{label}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Section>

      </div>
    </div>
  )
}

// ── Sub-components ────────────────────────────────────────────────────────────

function LauncherButton({ icon: Icon, color, bg, label, sub, subColor, onClick }) {
  return (
    <button
      onClick={onClick}
      className={`bg-white rounded-2xl border border-slate-200 shadow-sm px-4 py-4 text-center transition-all hover:shadow-md ${bg} group`}
    >
      <Icon className={`w-7 h-7 mx-auto ${color} group-hover:scale-110 transition-transform`} />
      <p className="mt-2 text-sm font-semibold text-slate-900">{label}</p>
      <p className={`text-xs mt-0.5 ${subColor}`}>{sub}</p>
    </button>
  )
}

function MiniStat({ icon: Icon, label, value, color }) {
  return (
    <div className="flex items-center gap-2.5 min-w-0">
      <Icon className="w-4 h-4 text-slate-300 shrink-0" />
      <div className="min-w-0">
        <p className="text-[10px] text-slate-400 uppercase tracking-wide truncate">{label}</p>
        <p className={`text-sm font-bold tabular-nums ${color}`}>{value}</p>
      </div>
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
