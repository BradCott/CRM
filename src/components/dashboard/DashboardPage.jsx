import { useState, useEffect } from 'react'
import {
  Landmark, TrendingUp, Users, FileCheck2, AlertTriangle,
  CalendarClock, Loader2,
} from 'lucide-react'
import { getDashboard } from '../../api/client'
import knoxLogo from '../../assets/Knox.png'

// ── Quotes ────────────────────────────────────────────────────────────────────
const QUOTES = [
  { text: "Buy land, they're not making it anymore.", author: "Mark Twain" },
  { text: "The best investment on earth is earth.", author: "Louis Glickman" },
  { text: "Don't wait to buy real estate. Buy real estate and wait.", author: "Will Rogers" },
  { text: "Real estate cannot be lost or stolen, nor can it be carried away.", author: "Franklin D. Roosevelt" },
  { text: "Ninety percent of all millionaires become so through owning real estate.", author: "Andrew Carnegie" },
  { text: "The wise young man or wage earner of today invests his money in real estate.", author: "Andrew Carnegie" },
  { text: "In real estate, you make 10% of your money because you're a genius and 90% because you catch a great wave.", author: "Jeff Greene" },
  { text: "The major fortunes in America have been made in land.", author: "John D. Rockefeller" },
  { text: "To be successful in real estate, you must always and consistently put your clients' best interests first.", author: "Anthony Hitt" },
  { text: "Every person who invests in well-selected real estate in a growing section of a prosperous community adopts the surest and safest method of becoming independent.", author: "Theodore Roosevelt" },
  { text: "Real estate investing, even on a very small scale, remains a tried and true means of building an individual's cash flow.", author: "Robert Kiyosaki" },
  { text: "The secret of getting ahead is getting started.", author: "Mark Twain" },
  { text: "Success usually comes to those who are too busy to be looking for it.", author: "Henry David Thoreau" },
  { text: "The best time to plant a tree was 20 years ago. The second best time is now.", author: "Chinese Proverb" },
  { text: "Opportunities are usually disguised as hard work, so most people don't recognize them.", author: "Ann Landers" },
  { text: "It's not about how much money you make, but how much money you keep.", author: "Robert Kiyosaki" },
  { text: "Real estate is at the corner of every great fortune.", author: "Ivar Kreuger" },
  { text: "Location, location, location.", author: "Harold Samuel" },
  { text: "If you don't own a home, buy one. If you own a home, buy another one.", author: "John Paulson" },
  { text: "A man who has money may be anxious, but not afraid. It is the man without money who is afraid.", author: "E.W. Howe" },
  { text: "The art of investing in real estate is to buy land on which others want to build.", author: "Carolus Linnaeus" },
]

function getQuote() {
  const day = Math.floor(Date.now() / 86_400_000)
  return QUOTES[day % QUOTES.length]
}

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

// ── Main component ────────────────────────────────────────────────────────────
export default function DashboardPage() {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const quote = getQuote()

  useEffect(() => {
    getDashboard()
      .then(setData)
      .catch(console.error)
      .finally(() => setLoading(false))
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

        {/* ── Quote ──────────────────────────────────────────────────────── */}
        <div className="bg-white rounded-2xl border border-slate-200 px-8 py-5 shadow-sm">
          <p className="text-slate-600 italic text-base leading-relaxed">"{quote.text}"</p>
          <p className="text-sm text-slate-400 mt-2">— {quote.author}</p>
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
