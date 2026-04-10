import { useState, useEffect, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { ArrowLeft, Plus, FileText, Landmark, Trash2, Loader2, Users, Pencil, Check, ChevronDown, ChevronRight, ChevronUp, ChevronsUpDown } from 'lucide-react'
import { getLedger, deleteTransaction, getInvestors, deleteInvestor, updateInvestorContribution } from '../../api/client'
import Button from '../ui/Button'
import AddTransactionModal from './AddTransactionModal'
import SettlementUpload from './SettlementUpload'
import BankStatementReview from './BankStatementReview'
import InvestorUpload from './InvestorUpload'

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
  'Excel Upload':         { dot: 'bg-violet-500',  label: 'Excel' },
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
  const [showInvestors, setShowInvestors]   = useState(false)
  const [deleting, setDeleting]             = useState(null)

  const [investors, setInvestors]           = useState([])
  const [deletingInv, setDeletingInv]       = useState(null)
  const [editingContrib, setEditingContrib] = useState(null) // { id, value }
  const [ledgerOpen, setLedgerOpen]         = useState(false)
  const [sortState, setSortState]           = useState({ col: 'date', dir: 'desc' })
  const [invSort, setInvSort]               = useState({ col: 'contribution', dir: 'desc' })

  const reload = useCallback(() => {
    setLoading(true)
    Promise.all([
      getLedger(propertyId),
      getInvestors(propertyId),
    ])
      .then(([ledger, invs]) => {
        setProperty(ledger.property)
        setTransactions(ledger.transactions)
        setInvestors(invs)
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

  async function handleDeleteInvestor(id) {
    setDeletingInv(id)
    try {
      await deleteInvestor(id)
      setInvestors(prev => prev.filter(i => i.id !== id))
    } finally {
      setDeletingInv(null)
    }
  }

  async function handleSaveContrib(id) {
    const raw = editingContrib?.value
    const amount = parseFloat(raw)
    if (!isFinite(amount) || amount < 0) { setEditingContrib(null); return }
    try {
      const updated = await updateInvestorContribution(id, amount)
      setInvestors(prev => prev.map(i => i.id === id ? { ...i, contribution: updated.contribution } : i))
    } catch (e) {
      console.error('Failed to update contribution:', e)
    } finally {
      setEditingContrib(null)
    }
  }

  // Compute running balance (transactions already sorted date ASC)
  const withBalance = transactions.reduce((acc, tx) => {
    const prev = acc.length > 0 ? acc[acc.length - 1].running_balance : 0
    acc.push({ ...tx, running_balance: prev + Number(tx.amount) })
    return acc
  }, [])
  const handleInvSort = col => setInvSort(prev => ({
    col,
    dir: prev.col === col && prev.dir === 'asc' ? 'desc' : 'asc',
  }))

  const sortedInvestors = [...investors].sort((a, b) => {
    const { col, dir } = invSort
    let av, bv
    if      (col === 'name')             { av = (a.name || '').toLowerCase();       bv = (b.name || '').toLowerCase() }
    else if (col === 'class')            { av = (a.class || '').toLowerCase();      bv = (b.class || '').toLowerCase() }
    else if (col === 'percentage')       { av = a.percentage ?? -1;                 bv = b.percentage ?? -1 }
    else if (col === 'preferred_return') { av = a.preferred_return ?? -1;           bv = b.preferred_return ?? -1 }
    else                                 { av = Number(a.contribution);             bv = Number(b.contribution) }
    if (av < bv) return dir === 'asc' ? -1 : 1
    if (av > bv) return dir === 'asc' ?  1 : -1
    return 0
  })

  const handleSort = col => setSortState(prev => ({
    col,
    dir: prev.col === col && prev.dir === 'asc' ? 'desc' : 'asc',
  }))

  // Sort transactions for display
  const sorted = [...transactions].sort((a, b) => {
    const { col, dir } = sortState
    let av, bv
    if      (col === 'date')        { av = a.date;                              bv = b.date }
    else if (col === 'description') { av = (a.description || '').toLowerCase(); bv = (b.description || '').toLowerCase() }
    else if (col === 'category')    { av = a.category;                          bv = b.category }
    else if (col === 'amount')      { av = Number(a.amount);                    bv = Number(b.amount) }
    else if (col === 'source')      { av = a.source;                            bv = b.source }
    else                            { av = 0; bv = 0 }
    if (av < bv) return dir === 'asc' ? -1 : 1
    if (av > bv) return dir === 'asc' ?  1 : -1
    return 0
  })

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

          <div className="flex items-center gap-2 flex-wrap">
            <Button variant="secondary" onClick={() => setShowSettlement(true)}>
              <FileText className="w-4 h-4" /> Settlement Statement
            </Button>
            <Button variant="secondary" onClick={() => setShowBank(true)}>
              <Landmark className="w-4 h-4" /> Bank Statement
            </Button>
            <Button variant="secondary" onClick={() => setShowInvestors(true)}>
              <Users className="w-4 h-4" /> Investor Contributions
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

      {/* Investors section */}
      {investors.length > 0 && (
        <div className="shrink-0 bg-slate-50 border-b border-slate-200">
          <div className="px-6 pt-3 pb-1">
            <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wide">
              Investors — {investors.length}
            </h3>
          </div>
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr className="border-y border-slate-200">
                <SortTh col="name"             sort={invSort} onSort={handleInvSort}>Name</SortTh>
                <SortTh col="class"            sort={invSort} onSort={handleInvSort}>Class</SortTh>
                <SortTh col="percentage"       sort={invSort} onSort={handleInvSort}>Ownership</SortTh>
                <SortTh col="preferred_return" sort={invSort} onSort={handleInvSort}>Pref. Return</SortTh>
                <SortTh col="contribution"     sort={invSort} onSort={handleInvSort} right>Contribution</SortTh>
                <th className="px-4 pr-6 py-2 w-16" />
              </tr>
            </thead>
            <tbody>
              {sortedInvestors.map(inv => {
                const isEditing = editingContrib?.id === inv.id
                return (
                  <tr key={inv.id} className="border-b border-slate-100 bg-white hover:bg-slate-50/60">
                    <td className="px-4 pl-6 py-2.5 font-medium text-slate-900">{inv.name}</td>
                    <td className="px-4 py-2.5">
                      {inv.class ? (
                        <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${
                          inv.class === 'Sponsor' ? 'bg-violet-100 text-violet-700' : 'bg-blue-100 text-blue-700'
                        }`}>{inv.class}</span>
                      ) : '—'}
                    </td>
                    <td className="px-4 py-2.5 text-slate-600 text-xs tabular-nums">
                      {inv.percentage != null ? `${inv.percentage}%` : '—'}
                    </td>
                    <td className="px-4 py-2.5 text-slate-600 text-xs tabular-nums">
                      {inv.preferred_return != null ? `${inv.preferred_return}%` : '—'}
                    </td>
                    <td className="px-4 py-2.5 text-right tabular-nums">
                      {isEditing ? (
                        <input
                          type="number"
                          min="0"
                          autoFocus
                          value={editingContrib.value}
                          onChange={e => setEditingContrib(prev => ({ ...prev, value: e.target.value }))}
                          onBlur={() => handleSaveContrib(inv.id)}
                          onKeyDown={e => { if (e.key === 'Enter') handleSaveContrib(inv.id); if (e.key === 'Escape') setEditingContrib(null) }}
                          className="w-32 text-right border border-blue-400 rounded px-2 py-0.5 text-sm outline-none focus:ring-2 focus:ring-blue-400"
                        />
                      ) : (
                        <span className="font-semibold text-emerald-700">{fmt$(inv.contribution)}</span>
                      )}
                    </td>
                    <td className="px-4 pr-6 py-2.5">
                      <div className="flex items-center justify-end gap-1">
                        {isEditing ? (
                          <button
                            onClick={() => handleSaveContrib(inv.id)}
                            className="p-1 rounded text-emerald-500 hover:bg-emerald-50 transition-colors"
                            title="Save"
                          >
                            <Check className="w-3.5 h-3.5" />
                          </button>
                        ) : (
                          <button
                            onClick={() => setEditingContrib({ id: inv.id, value: inv.contribution })}
                            className="p-1 rounded text-slate-300 hover:text-blue-500 hover:bg-blue-50 transition-colors"
                            title="Edit contribution"
                          >
                            <Pencil className="w-3.5 h-3.5" />
                          </button>
                        )}
                        <button
                          onClick={() => handleDeleteInvestor(inv.id)}
                          disabled={deletingInv === inv.id}
                          className="p-1 rounded text-slate-300 hover:text-red-500 hover:bg-red-50 transition-colors disabled:opacity-40"
                          title="Remove investor"
                        >
                          {deletingInv === inv.id
                            ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                            : <Trash2 className="w-3.5 h-3.5" />
                          }
                        </button>
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
            <tfoot>
              <tr className="border-t-2 border-slate-200 bg-slate-50">
                <td colSpan={4} className="px-4 pl-6 py-2.5 text-xs font-semibold text-slate-500 uppercase tracking-wide">
                  Total Equity Contributed
                </td>
                <td className="px-4 py-2.5 text-right font-bold text-emerald-700 tabular-nums">
                  {fmt$(investors.reduce((s, i) => s + Number(i.contribution), 0))}
                </td>
                <td className="px-4 pr-6 py-2.5" />
              </tr>
            </tfoot>
          </table>
        </div>
      )}

      {/* Transaction Ledger — collapsible */}
      <div className="flex-1 overflow-y-auto flex flex-col min-h-0">
        {/* Section header / toggle */}
        <button
          onClick={() => setLedgerOpen(o => !o)}
          className="shrink-0 w-full flex items-center justify-between px-6 py-3 bg-white border-b border-slate-200 hover:bg-slate-50 transition-colors text-left"
        >
          <div className="flex items-center gap-2">
            {ledgerOpen
              ? <ChevronDown className="w-4 h-4 text-slate-400" />
              : <ChevronRight className="w-4 h-4 text-slate-400" />
            }
            <span className="text-sm font-semibold text-slate-700">Transaction Ledger</span>
            <span className="text-xs text-slate-400 font-normal">{transactions.length} transaction{transactions.length !== 1 ? 's' : ''}</span>
          </div>
        </button>

        {/* Table — only shown when open */}
        {ledgerOpen && (
          <div className="flex-1 overflow-y-auto">
            {transactions.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 text-slate-400 gap-2">
                <p className="text-sm font-medium">No transactions yet</p>
                <p className="text-xs">Add a transaction manually or upload a statement</p>
              </div>
            ) : (
              <table className="w-full text-sm border-collapse">
                <thead>
                  <tr className="bg-slate-50 border-y border-slate-200 sticky top-0 z-10">
                    <SortTh col="date"        sort={sortState} onSort={handleSort}>Date</SortTh>
                    <SortTh col="description" sort={sortState} onSort={handleSort}>Description</SortTh>
                    <SortTh col="category"    sort={sortState} onSort={handleSort}>Category</SortTh>
                    <SortTh col="amount"      sort={sortState} onSort={handleSort} right>Amount</SortTh>
                    <SortTh col="source"      sort={sortState} onSort={handleSort}>Source</SortTh>
                    <th className="px-4 py-3 w-10" />
                  </tr>
                </thead>
                <tbody>
                  {sorted.map((tx, i) => {
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

      {showInvestors && (
        <InvestorUpload
          propertyId={propertyId}
          onSaved={reload}
          onClose={() => setShowInvestors(false)}
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

function SortTh({ col, sort, onSort, right, children }) {
  const active = sort.col === col
  const asc    = active && sort.dir === 'asc'

  return (
    <th
      onClick={() => onSort(col)}
      style={{ cursor: 'pointer', userSelect: 'none' }}
      className={[
        'px-4 py-3 text-xs font-semibold uppercase tracking-wide whitespace-nowrap transition-colors',
        right ? 'text-right' : 'text-left',
        active ? 'text-blue-600 bg-blue-50' : 'text-slate-500 bg-slate-50 hover:bg-slate-100 hover:text-slate-700',
      ].join(' ')}
    >
      <span className={`inline-flex items-center gap-1.5 ${right ? 'justify-end' : 'justify-start'}`}>
        {children}
        {active ? (
          asc
            ? <ChevronUp   className="w-3.5 h-3.5 text-blue-500 shrink-0" />
            : <ChevronDown className="w-3.5 h-3.5 text-blue-500 shrink-0" />
        ) : (
          <ChevronsUpDown className="w-3.5 h-3.5 text-slate-400 shrink-0" />
        )}
      </span>
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
