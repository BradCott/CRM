import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { BookOpen, Loader2, ArrowRight, DollarSign, TrendingUp, Home } from 'lucide-react'
import { getAccountingSummary } from '../../api/client'

function fmt$(v) {
  if (!v && v !== 0) return '$0'
  const abs = Math.abs(Math.round(Number(v)))
  const s = '$' + abs.toLocaleString()
  return Number(v) < 0 ? `-${s}` : s
}

function StatBox({ label, value, color = 'text-slate-700' }) {
  return (
    <div className="min-w-0">
      <p className="text-xs text-slate-400 truncate">{label}</p>
      <p className={`text-sm font-bold tabular-nums ${color}`}>{value}</p>
    </div>
  )
}

export default function AccountingPage() {
  const navigate = useNavigate()
  const [properties, setProperties] = useState([])
  const [loading, setLoading]       = useState(true)
  const [error, setError]           = useState(null)

  useEffect(() => {
    getAccountingSummary()
      .then(setProperties)
      .catch(e => setError(e.message))
      .finally(() => setLoading(false))
  }, [])

  if (loading) return (
    <div className="flex-1 flex items-center justify-center">
      <Loader2 className="w-6 h-6 text-slate-400 animate-spin" />
    </div>
  )

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header */}
      <header className="shrink-0 px-6 pt-6 pb-5 bg-white border-b border-slate-200">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <BookOpen className="w-5 h-5 text-blue-600" />
            <h1 className="text-xl font-semibold text-slate-900">Accounting</h1>
          </div>
        </div>
        <p className="mt-1 text-sm text-slate-500">Per-property ledgers for your Knox portfolio</p>
      </header>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-6">
        {error && (
          <div className="mb-4 px-4 py-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
            {error}
          </div>
        )}

        {!loading && properties.length === 0 && (
          <div className="flex flex-col items-center justify-center py-24 text-slate-400 gap-3">
            <Home className="w-10 h-10 opacity-30" />
            <p className="text-sm font-medium">No portfolio properties yet</p>
            <p className="text-xs">Mark properties as "Portfolio" in Knox Portfolio to see them here</p>
          </div>
        )}

        {properties.length > 0 && (
          <div className="grid grid-cols-1 gap-3 max-w-4xl">
            {properties.map(p => {
              const balance = Number(p.cash_balance)
              const balanceColor = balance >= 0 ? 'text-emerald-600' : 'text-red-600'

              return (
                <button
                  key={p.id}
                  onClick={() => navigate(`/accounting/${p.id}`)}
                  className="w-full text-left bg-white border border-slate-200 rounded-xl px-5 py-4 hover:border-blue-300 hover:shadow-sm transition-all group"
                >
                  <div className="flex items-center justify-between gap-4">
                    {/* Property info */}
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 mb-0.5">
                        {p.tenant && (
                          <span className="text-xs font-semibold text-blue-600 bg-blue-50 px-2 py-0.5 rounded-full">
                            {p.tenant}
                          </span>
                        )}
                        {p.tx_count === 0 && (
                          <span className="text-xs text-slate-400 italic">No transactions yet</span>
                        )}
                      </div>
                      <p className="font-semibold text-slate-900 truncate">{p.address}</p>
                      <p className="text-xs text-slate-500">
                        {[p.city, p.state].filter(Boolean).join(', ')}
                      </p>
                    </div>

                    {/* Stats */}
                    <div className="flex items-center gap-6 shrink-0">
                      <StatBox
                        label="Cash Balance"
                        value={fmt$(p.cash_balance)}
                        color={balanceColor}
                      />
                      <div className="w-px h-8 bg-slate-100" />
                      <StatBox
                        label="Equity In"
                        value={fmt$(p.equity_contributed)}
                        color="text-slate-700"
                      />
                      <div className="w-px h-8 bg-slate-100" />
                      <StatBox
                        label="Rent Collected"
                        value={fmt$(p.rent_collected)}
                        color="text-emerald-600"
                      />
                      <ArrowRight className="w-4 h-4 text-slate-300 group-hover:text-blue-500 transition-colors ml-2" />
                    </div>
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
