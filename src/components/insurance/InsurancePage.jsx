import { useState, useEffect, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { Shield, ChevronUp, ChevronDown, ChevronsUpDown, Search, Loader2 } from 'lucide-react'
import { getAllInsurance } from '../../api/client'

// ── Utilities ─────────────────────────────────────────────────────────────────

function parseDate(s) {
  if (!s) return null
  const mdy = String(s).match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/)
  if (mdy) {
    const d = new Date(Number(mdy[3]), Number(mdy[1]) - 1, Number(mdy[2]), 12)
    return isNaN(d) ? null : d
  }
  const d = new Date(String(s).length === 10 ? s + 'T12:00:00' : s)
  return isNaN(d) ? null : d
}

function fmtDate(s) {
  const d = parseDate(s)
  if (!d) return '—'
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

function daysUntil(s) {
  const d = parseDate(s)
  if (!d) return null
  const today = new Date()
  today.setHours(12, 0, 0, 0)
  return Math.round((d - today) / (1000 * 60 * 60 * 24))
}

function fmt(n) {
  if (n == null || n === '') return '—'
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(n)
}

function noteVal(notes, key) {
  if (!notes) return ''
  const line = notes.split('\n').find(l => l.startsWith(key + ': '))
  return line ? line.slice(key.length + 2).trim() : ''
}

// ── Sort helpers ──────────────────────────────────────────────────────────────

const COLS = [
  { key: 'property_address', label: 'Property' },
  { key: 'named_insured',    label: 'Entity (Named Insured)' },
  { key: 'carrier',          label: 'Carrier' },
  { key: 'policy_number',    label: 'Policy Number' },
  { key: 'premium',          label: 'Premium' },
  { key: 'effective_date',   label: 'Effective Date' },
  { key: 'expiry_date',      label: 'Expiration Date' },
  { key: 'paid_status',        label: 'Paid Status' },
  { key: 'reimbursed_status',  label: 'Reimbursed' },
  { key: 'days_until_expiry',  label: 'Days Until Exp.' },
]

function sortValue(row, key) {
  switch (key) {
    case 'named_insured':    return noteVal(row.notes, 'Named Insured').toLowerCase()
    case 'days_until_expiry': return daysUntil(row.expiry_date) ?? Infinity
    case 'premium':          return row.premium ?? -Infinity
    case 'effective_date':   return parseDate(row.effective_date)?.getTime() ?? 0
    case 'expiry_date':      return parseDate(row.expiry_date)?.getTime() ?? 0
    default:                 return String(row[key] || '').toLowerCase()
  }
}

function SortIcon({ col, sortKey, sortDir }) {
  if (sortKey !== col) return <ChevronsUpDown className="w-3 h-3 text-slate-300 ml-1" />
  return sortDir === 'asc'
    ? <ChevronUp   className="w-3 h-3 text-blue-500 ml-1" />
    : <ChevronDown className="w-3 h-3 text-blue-500 ml-1" />
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function InsurancePage() {
  const navigate = useNavigate()
  const [policies, setPolicies] = useState([])
  const [loading, setLoading]   = useState(true)
  const [search, setSearch]     = useState('')
  const [sortKey, setSortKey]   = useState('expiry_date')
  const [sortDir, setSortDir]   = useState('asc')

  useEffect(() => {
    getAllInsurance()
      .then(setPolicies)
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  function handleSort(key) {
    if (sortKey === key) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortKey(key); setSortDir('asc') }
  }

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return q
      ? policies.filter(p =>
          [p.property_address, p.property_city, p.policy_number, p.carrier,
           p.tenant_name, noteVal(p.notes, 'Named Insured')]
            .some(v => String(v || '').toLowerCase().includes(q))
        )
      : policies
  }, [policies, search])

  const sorted = useMemo(() => {
    return [...filtered].sort((a, b) => {
      const av = sortValue(a, sortKey)
      const bv = sortValue(b, sortKey)
      if (av < bv) return sortDir === 'asc' ? -1 : 1
      if (av > bv) return sortDir === 'asc' ?  1 : -1
      return 0
    })
  }, [filtered, sortKey, sortDir])

  function handleRowClick(p) {
    navigate(`/management/${p.property_id}?tab=insurance`)
  }

  return (
    <div className="flex flex-col h-full bg-slate-50">

      {/* Header */}
      <div className="px-6 py-4 bg-white border-b border-slate-200">
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <Shield className="w-5 h-5 text-blue-600" />
            <h1 className="text-lg font-semibold text-slate-900">Insurance</h1>
            {!loading && (
              <span className="ml-1 text-xs text-slate-400 font-normal">
                {filtered.length} {filtered.length === 1 ? 'policy' : 'policies'}
              </span>
            )}
          </div>

          {/* Search */}
          <div className="relative w-72">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400" />
            <input
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search property, carrier, policy…"
              className="w-full pl-9 pr-3 py-1.5 text-sm border border-slate-200 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-400"
            />
          </div>
        </div>
      </div>

      {/* Table */}
      <div className="flex-1 overflow-auto px-6 py-4">
        {loading ? (
          <div className="flex items-center justify-center py-24">
            <Loader2 className="w-6 h-6 animate-spin text-slate-400" />
          </div>
        ) : sorted.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-24 gap-2 text-center">
            <Shield className="w-10 h-10 text-slate-200" />
            <p className="text-sm text-slate-400">{search ? 'No policies match your search.' : 'No insurance policies found.'}</p>
          </div>
        ) : (
          <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50">
                  {COLS.map(col => (
                    <th
                      key={col.key}
                      onClick={() => handleSort(col.key)}
                      className="px-4 py-2.5 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider cursor-pointer hover:text-slate-700 select-none whitespace-nowrap"
                    >
                      <span className="inline-flex items-center">
                        {col.label}
                        <SortIcon col={col.key} sortKey={sortKey} sortDir={sortDir} />
                      </span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {sorted.map(p => {
                  const days        = daysUntil(p.expiry_date)
                  const expiringSoon = days !== null && days <= 60
                  const expired      = days !== null && days < 0
                  const namedInsured = noteVal(p.notes, 'Named Insured')

                  return (
                    <tr
                      key={p.id}
                      onClick={() => handleRowClick(p)}
                      className="hover:bg-blue-50/50 cursor-pointer transition-colors"
                    >
                      {/* Property */}
                      <td className="px-4 py-3">
                        <p className="font-medium text-slate-800 text-xs">{p.property_address}</p>
                        <p className="text-xs text-slate-400">{[p.property_city, p.property_state].filter(Boolean).join(', ')}</p>
                      </td>

                      {/* Entity / Named Insured */}
                      <td className="px-4 py-3 text-xs text-slate-600">{namedInsured || '—'}</td>

                      {/* Carrier */}
                      <td className="px-4 py-3 text-xs font-medium text-slate-800">{p.carrier || '—'}</td>

                      {/* Policy Number */}
                      <td className="px-4 py-3 text-xs font-mono text-slate-500">{p.policy_number || '—'}</td>

                      {/* Premium */}
                      <td className="px-4 py-3 text-xs text-slate-700">{fmt(p.premium)}</td>

                      {/* Effective Date */}
                      <td className="px-4 py-3 text-xs text-slate-600">{fmtDate(p.effective_date)}</td>

                      {/* Expiration Date */}
                      <td className="px-4 py-3 text-xs">
                        <span className={expired ? 'text-red-600 font-semibold' : expiringSoon ? 'text-amber-700 font-semibold' : 'text-slate-600'}>
                          {fmtDate(p.expiry_date)}
                        </span>
                      </td>

                      {/* Paid Status */}
                      <td className="px-4 py-3">
                        {p.paid_status === 'paid' ? (
                          <span className="inline-block px-2 py-0.5 rounded text-xs font-bold bg-green-100 text-green-700 border border-green-200 tracking-wide">PAID</span>
                        ) : (
                          <span className="inline-block px-2 py-0.5 rounded text-xs font-bold bg-red-100 text-red-700 border border-red-200 tracking-wide">UNPAID</span>
                        )}
                      </td>

                      {/* Reimbursed Status */}
                      <td className="px-4 py-3">
                        {p.reimbursed_status === 'reimbursed' ? (
                          <span className="inline-block px-2 py-0.5 rounded text-xs font-bold bg-green-100 text-green-700 border border-green-200 tracking-wide">REIMBURSED</span>
                        ) : (
                          <span className="inline-block px-2 py-0.5 rounded text-xs font-bold bg-red-100 text-red-700 border border-red-200 tracking-wide">UNREIMBURSED</span>
                        )}
                      </td>

                      {/* Days Until Expiry */}
                      <td className="px-4 py-3 text-xs">
                        {days === null ? (
                          <span className="text-slate-300">—</span>
                        ) : expired ? (
                          <span className="text-red-600 font-semibold">Expired {Math.abs(days)}d ago</span>
                        ) : (
                          <span className={expiringSoon ? 'text-amber-700 font-semibold' : 'text-slate-600'}>
                            {days}d
                          </span>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
