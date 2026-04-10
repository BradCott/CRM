import { useState, useEffect, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { ArrowLeft, Plus, FileText, Landmark, Trash2, Loader2 } from 'lucide-react'
import { getLedger, deleteTransaction } from '../../api/client'
import Button from '../ui/Button'
import AddTransactionModal from './AddTransactionModal'
import SettlementUpload from './SettlementUpload'
import BankStatementReview from './BankStatementReview'

const CATEGORY_COLORS = {
  'Equity Contribution': 'bg-blue-100 text-blue-700',
  'Purchase':            'bg-red-100 text-red-700',
  'Rent':                'bg-emerald-100 text-emerald-700',
  'Mortgage':            'bg-amber-100 text-amber-700',
  'Repair':              'bg-orange-100 text-orange-700',
  'Sale':                'bg-violet-100 text-violet-700',
  'Other':               'bg-slate-100 text-slate-600',
}

const SOURCE_LABELS = {
  'Manual':               { dot: 'bg-slate-400',   label: 'Manual' },
  'Settlement Statement': { dot: 'bg-blue-500',    label: 'Settlement' },
  'Bank Statement':       { dot: 'bg-emerald-500', label: 'Bank' },
}

function fmt$(v, signed = false) {
  if (v === null || v === undefined) return '—'
  const n = Number(v)
  const abs = '$' + Math.abs(Math.round(n)).toLocaleString()
  if (signed) return n >= 0 ? `+${abs}` : `-${abs}`
  return n < 0 ? `-${abs}` : abs
}

function fmtDate(iso) {
  if (!iso) return '—'
  return new Date(iso + 'T00:00:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
}

export default function LedgerPage() {
  const { propertyId } = useParams()
  const navigate       = useNavigate()

  const [property, setProperty]         = useState(null)
  const [transactions, setTransactions] = useState([])
  const [loading, setLoading]           = useState(true)
  const [error, setError]               = useState(null)

  const [showAdd, setShowAdd]               = useState(false)
  const [showSettlement, setShowSettlement] = useState(false)
  const [showBank, setShowBank]             = useState(false)
  const [deleting, setDeleting]             = useState(null)

  const reload = useCallback(() => {
    setLoading(true)
    getLedger(propertyId)
      .then(data => {
        setProperty(data.property)
        setTransactions(data.transactions)
      })
      .catch(e => setError(e.message))
      .finally(() => setLoading(false))
  }, [propertyId])

  useEffect(() => { reload() }, [reload])

  async function handleDelete(id) {
    setDeleting(id)
    try {
      await deleteTransaction(id)
      setTransactions(prev => prev.filter(t => t.id !== id))
    } finally {
      setDeleting(null)
    }
  }

  // Compute running balance (transactions already sorted date ASC)
  const withBalance = transactions.reduce((acc, tx) => {
    const prev = acc.length > 0 ? acc[acc.length - 1].running_balance : 0
    acc.push({ ...tx, running_balance: prev + Number(tx.amount) })
    return acc
  }, [])
  // Reverse for display (most recent first)
  const displayed = [...withBalance].reverse()

  const totals = {
    balance:   withBalance.length > 0 ? withBalance[withBalance.length - 1].running_balance : 0,
    equity:    transactions.filter(t => t.category === 'Equity Contribution' && t.amount > 0).reduce((s, t) => s + t.amount, 0),
    rent:      transactions.filter(t => t.category === 'Rent'               && t.amount > 0).reduce((s, t) => s + t.amount, 0),
    mortgage:  transactions.filter(t => t.category === 'Mortgage'           && t.amount < 0).reduce((s, t) => s + t.amount, 0),
  }

  if (loading) return (
    <div className="flex-1 flex items-center justify-center">
      <Loader2 className="w-6 h-6 text-slate-400 animate-spin" />
    </div>
  )

  if (error) return (
    <div className="flex-1 flex items-center justify-center">
      <p className="text-sm text-red-600">{error}</p>
    </div>
  )

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header */}
      <header className="shrink-0 px-6 pt-5 pb-0 bg-white border-b border-slate-200">
        <div className="flex items-center gap-3 mb-4">
          <button
            onClick={() => navigate('/accounting')}
            className="flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-800 transition-colors"
          >
            <ArrowLeft className="w-4 h-4" /> Accounting
          </button>
        </div>

        <div className="flex items-start justify-between mb-4">
          <div>
            {property?.address ? (
              <>
                <h1 className="text-xl font-semibold text-slate-900">{property.address}</h1>
                {(property.city || property.state) && (
                  <p className="text-sm text-slate-500 mt-0.5">
                    {[property.city, property.state].filter(Boolean).join(', ')}
                  </p>
                )}
              </>
            ) : (
              <h1 className="text-xl font-semibold text-slate-900">Property Ledger</h1>
            )}
          </div>

          <div className="flex items-center gap-2">
            <Button variant="secondary" onClick={() => setShowSettlement(true)}>
              <FileText className="w-4 h-4" /> Settlement Statement
            </Button>
            <Button variant="secondary" onClick={() => setShowBank(true)}>
              <Landmark className="w-4 h-4" /> Bank Statement
            </Button>
            <Button onClick={() => setShowAdd(true)}>
              <Plus className="w-4 h-4" /> Add Transaction
            </Button>
          </div>
        </div>

        {/* Summary stats */}
        <div className="flex items-center gap-6 pb-4 flex-wrap">
          <Stat label="Current Balance" value={fmt$(totals.balance)}
            color={totals.balance >= 0 ? 'text-emerald-600' : 'text-red-600'} />
          <div className="w-px h-8 bg-slate-200" />
          <Stat label="Equity Contributed" value={fmt$(totals.equity)}    color="text-blue-600" />
          <div className="w-px h-8 bg-slate-200" />
          <Stat label="Rent Collected"     value={fmt$(totals.rent)}      color="text-emerald-600" />
          <div className="w-px h-8 bg-slate-200" />
          <Stat label="Mortgage Paid"      value={fmt$(Math.abs(totals.mortgage))} color="text-amber-600" />
          <div className="w-px h-8 bg-slate-200" />
          <Stat label="Transactions"       value={transactions.length}    color="text-slate-700" />
        </div>
      </header>

      {/* Ledger table */}
      <div className="flex-1 overflow-y-auto">
        {transactions.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-24 text-slate-400 gap-2">
            <p className="text-sm font-medium">No transactions yet</p>
            <p className="text-xs">Add a transaction manually or upload a statement</p>
          </div>
        ) : (
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr className="bg-slate-50 border-y border-slate-200 sticky top-0 z-10">
                <Th>Date</Th>
                <Th>Description</Th>
                <Th>Category</Th>
                <Th right>Amount</Th>
                <Th right>Balance</Th>
                <Th>Source</Th>
                <th className="px-4 py-3 w-10" />
              </tr>
            </thead>
            <tbody>
              {displayed.map((tx, i) => {
                const catStyle  = CATEGORY_COLORS[tx.category] || CATEGORY_COLORS['Other']
                const srcConfig = SOURCE_LABELS[tx.source]     || SOURCE_LABELS['Manual']
                const isPos     = Number(tx.amount) >= 0

                return (
                  <tr key={tx.id} className={i % 2 === 0 ? 'bg-white' : 'bg-slate-50/60'}>
                    <td className="px-4 pl-6 py-3 border-b border-slate-100 text-slate-500 whitespace-nowrap text-xs">
                      {fmtDate(tx.date)}
                    </td>
                    <td className="px-4 py-3 border-b border-slate-100 text-slate-800 max-w-[260px] truncate font-medium">
                      {tx.description}
                    </td>
                    <td className="px-4 py-3 border-b border-slate-100">
                      <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${catStyle}`}>
                        {tx.category}
                      </span>
                    </td>
                    <td className={`px-4 py-3 border-b border-slate-100 text-right font-semibold tabular-nums whitespace-nowrap ${
                      isPos ? 'text-emerald-600' : 'text-red-600'
                    }`}>
                      {fmt$(tx.amount, true)}
                    </td>
                    <td className={`px-4 py-3 border-b border-slate-100 text-right tabular-nums whitespace-nowrap text-xs font-medium ${
                      Number(tx.running_balance) >= 0 ? 'text-slate-600' : 'text-red-500'
                    }`}>
                      {fmt$(tx.running_balance)}
                    </td>
                    <td className="px-4 py-3 border-b border-slate-100">
                      <span className="flex items-center gap-1.5 text-xs text-slate-500">
                        <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${srcConfig.dot}`} />
                        {srcConfig.label}
                      </span>
                    </td>
                    <td className="px-4 py-3 pr-6 border-b border-slate-100">
                      <button
                        onClick={() => handleDelete(tx.id)}
                        disabled={deleting === tx.id}
                        className="p-1.5 rounded text-slate-200 hover:text-red-500 hover:bg-red-50 transition-colors disabled:opacity-40"
                        title="Delete"
                      >
                        {deleting === tx.id
                          ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                          : <Trash2 className="w-3.5 h-3.5" />
                        }
                      </button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* Modals */}
      {showAdd && (
        <AddTransactionModal
          propertyId={propertyId}
          onSaved={reload}
          onClose={() => setShowAdd(false)}
        />
      )}

      {showSettlement && (
        <SettlementUpload
          propertyId={propertyId}
          onSaved={reload}
          onClose={() => setShowSettlement(false)}
        />
      )}

      {showBank && (
        <BankStatementReview
          propertyId={propertyId}
          onSaved={reload}
          onClose={() => setShowBank(false)}
        />
      )}
    </div>
  )
}

function Th({ children, right }) {
  return (
    <th className={`px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide whitespace-nowrap first:pl-6 ${right ? 'text-right' : 'text-left'}`}>
      {children}
    </th>
  )
}

function Stat({ label, value, color }) {
  return (
    <div>
      <p className="text-xs text-slate-500">{label}</p>
      <p className={`text-sm font-bold tabular-nums ${color}`}>{value}</p>
    </div>
  )
}
