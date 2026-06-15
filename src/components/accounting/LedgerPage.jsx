import { useState, useEffect, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { ArrowLeft, Plus, FileText, Landmark, Trash2, Loader2, Users, Pencil, Check, ChevronDown, ChevronRight, ChevronUp, ChevronsUpDown, Download, BarChart2, Scale, ArrowLeftRight, FileSpreadsheet, Target, Receipt, Store, HandCoins } from 'lucide-react'
import { getLedger, deleteTransaction, getInvestors, deleteInvestor, updateInvestorContribution, reconcileTransaction, recordTransaction, recordAllTransactions } from '../../api/client'
import { ALL_CATEGORIES } from '../../utils/accounting'
import Button from '../ui/Button'
import AddTransactionModal from './AddTransactionModal'
import SettlementUpload from './SettlementUpload'
import BankStatementReview from './BankStatementReview'
import InvestorUpload from './InvestorUpload'
import BalanceSheet from './BalanceSheet'
import ProfitLoss from './ProfitLoss'
import CashFlowStatement from './CashFlowStatement'
import ScheduleE from './ScheduleE'
import BudgetVsActual from './BudgetVsActual'
import Bills from './Bills'
import Vendors from './Vendors'
import Distributions from './Distributions'
import PlaidConnect from './PlaidConnect'
import { CATEGORY_COLORS } from '../../utils/accounting'

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
  const [activeView, setActiveView]         = useState('ledger') // 'ledger' | 'balance' | 'pl'
  const [ledgerOpen, setLedgerOpen]         = useState(false)
  const [sortState, setSortState]           = useState({ col: 'date', dir: 'desc' })
  const [invSort, setInvSort]               = useState({ col: 'contribution', dir: 'desc' })
  const [reviewFilter, setReviewFilter]     = useState('all') // 'all' | 'review' | 'recorded'
  const [reviewCats, setReviewCats]         = useState({})     // tx.id → category override
  const [recordingId, setRecordingId]       = useState(null)
  const [recordingAll, setRecordingAll]     = useState(false)

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
        // Surface pending review items: open the ledger and focus the review filter
        if (ledger.transactions.some(t => t.review_status === 'needs_review')) {
          setLedgerOpen(true)
          setReviewFilter('review')
        }
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

  async function handleReconcile(tx) {
    const next = tx.reconciled ? 0 : 1
    // Optimistic toggle
    setTransactions(prev => prev.map(t => t.id === tx.id ? { ...t, reconciled: next } : t))
    try {
      await reconcileTransaction(tx.id, !!next)
    } catch {
      setTransactions(prev => prev.map(t => t.id === tx.id ? { ...t, reconciled: tx.reconciled } : t))
    }
  }

  async function handleRecord(tx) {
    setRecordingId(tx.id)
    try {
      await recordTransaction(tx.id, { category: reviewCats[tx.id] ?? tx.category })
      await reload()
    } finally {
      setRecordingId(null)
    }
  }

  async function handleRecordAll() {
    setRecordingAll(true)
    try {
      await recordAllTransactions(propertyId)
      await reload()
    } finally {
      setRecordingAll(false)
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

  // QuickBooks-style split: 'needs_review' items are NOT in the books yet, so
  // they're excluded from every financial computation until recorded.
  const needsReview = transactions.filter(t => t.review_status === 'needs_review')
  const recordedTx  = transactions.filter(t => t.review_status !== 'needs_review')

  // Compute running balance over recorded transactions only
  const withBalance = recordedTx.reduce((acc, tx) => {
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

  // Cash balance excludes Building Value and Land Value — those are asset entries,
  // not cash movements, and would distort the cash position if included.
  const NON_CASH = new Set(['Building Value', 'Land Value'])
  const cashBalance = recordedTx
    .filter(t => !NON_CASH.has(t.description))
    .reduce((s, t) => s + Number(t.amount), 0)

  // Equity Contributed comes from the investors table, not from transactions,
  // so that settlement-statement categories don't inflate the figure.
  const equityContributed = investors.reduce((s, i) => s + Number(i.contribution || 0), 0)

  const totals = {
    balance:   cashBalance,
    equity:    equityContributed,
    rent:      recordedTx.filter(t => t.category === 'Rent'    && t.amount > 0).reduce((s, t) => s + Number(t.amount), 0),
    mortgage:  recordedTx.filter(t => t.category === 'Mortgage' && t.amount < 0).reduce((s, t) => s + Number(t.amount), 0),
  }

  function exportCSV() {
    const header = ['Date', 'Description', 'Category', 'Amount', 'Source', 'Vendor', 'Reconciled']
    const rows = transactions.map(t => [
      t.date,
      `"${(t.description || '').replace(/"/g, '""')}"`,
      t.category,
      t.amount,
      t.source,
      `"${(t.vendor || '').replace(/"/g, '""')}"`,
      t.reconciled ? 'Yes' : 'No',
    ])
    const csv = [header, ...rows].map(r => r.join(',')).join('\n')
    const blob = new Blob([csv], { type: 'text/csv' })
    const url  = URL.createObjectURL(blob)
    const a    = document.createElement('a')
    a.href     = url
    a.download = `${property?.address || 'ledger'} - Transactions.csv`
    a.click()
    URL.revokeObjectURL(url)
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
            <Button variant="secondary" onClick={exportCSV} title="Download all transactions as CSV">
              <Download className="w-4 h-4" /> Export
            </Button>
            <Button onClick={() => setShowAdd(true)}>
              <Plus className="w-4 h-4" /> Add Transaction
            </Button>
          </div>
        </div>

        {/* Summary stats */}
        <div className="flex items-center gap-6 pb-3 flex-wrap">
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

        {/* Tab navigation */}
        <div className="flex items-center gap-0 -mx-6 px-6 border-t border-slate-100 overflow-x-auto scrollbar-thin">
          {[
            { key: 'ledger',    label: 'Ledger',        Icon: null },
            { key: 'balance',   label: 'Balance Sheet', Icon: Scale },
            { key: 'pl',        label: 'P&L',           Icon: BarChart2 },
            { key: 'cashflow',  label: 'Cash Flow',     Icon: ArrowLeftRight },
            { key: 'schedulee', label: 'Schedule E',    Icon: FileSpreadsheet },
            { key: 'budget',    label: 'Budget',        Icon: Target },
            { key: 'bills',     label: 'Bills',         Icon: Receipt },
            { key: 'vendors',   label: 'Vendors',       Icon: Store },
            { key: 'distributions', label: 'Distributions', Icon: HandCoins },
          ].map(({ key, label, Icon }) => (
            <button
              key={key}
              onClick={() => setActiveView(key)}
              className={[
                'flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors whitespace-nowrap',
                activeView === key
                  ? 'border-blue-500 text-blue-600'
                  : 'border-transparent text-slate-500 hover:text-slate-700 hover:border-slate-300',
              ].join(' ')}
            >
              {Icon && <Icon className="w-3.5 h-3.5" />}
              {label}
            </button>
          ))}
        </div>
      </header>

      {/* Balance Sheet / P&L views — recorded transactions only */}
      {activeView === 'balance' && (
        <div className="flex-1 overflow-y-auto">
          <BalanceSheet transactions={recordedTx} investors={investors} />
        </div>
      )}
      {activeView === 'pl' && (
        <div className="flex-1 overflow-y-auto">
          <ProfitLoss transactions={recordedTx} onChanged={reload} />
        </div>
      )}
      {activeView === 'cashflow' && (
        <div className="flex-1 overflow-y-auto">
          <CashFlowStatement transactions={recordedTx} onChanged={reload} />
        </div>
      )}
      {activeView === 'schedulee' && (
        <div className="flex-1 overflow-y-auto">
          <ScheduleE property={property} transactions={recordedTx} onChanged={reload} />
        </div>
      )}
      {activeView === 'budget' && (
        <div className="flex-1 overflow-y-auto">
          <BudgetVsActual propertyId={propertyId} transactions={recordedTx} />
        </div>
      )}
      {activeView === 'bills' && (
        <div className="flex-1 overflow-y-auto">
          <Bills propertyId={propertyId} onChanged={reload} />
        </div>
      )}
      {activeView === 'vendors' && (
        <div className="flex-1 overflow-y-auto">
          <Vendors transactions={recordedTx} onChanged={reload} />
        </div>
      )}
      {activeView === 'distributions' && (
        <div className="flex-1 overflow-y-auto">
          <Distributions propertyId={propertyId} />
        </div>
      )}

      {/* Investors section — only in ledger view */}
      {activeView === 'ledger' && investors.length > 0 && (
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

      {/* Bank Connections — only in ledger view */}
      {activeView === 'ledger' && (
        <PlaidConnect propertyId={propertyId} onSaved={reload} />
      )}

      {/* Transaction Ledger — collapsible, only in ledger view */}
      {activeView === 'ledger' && <div className="flex-1 overflow-y-auto flex flex-col min-h-0">
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
            {needsReview.length > 0 && (
              <span className="text-xs font-bold bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full">
                {needsReview.length} need{needsReview.length !== 1 ? '' : 's'} review
              </span>
            )}
          </div>
        </button>

        {/* Table — only shown when open */}
        {ledgerOpen && (
          <div className="flex-1 overflow-y-auto">
            {/* Filter pills + record-all */}
            {transactions.length > 0 && (
              <div className="flex items-center justify-between px-6 py-2.5 bg-white border-b border-slate-100 sticky top-0 z-20">
                <div className="flex gap-1.5">
                  {[
                    { key: 'all',      label: `All ${transactions.length}` },
                    { key: 'review',   label: `Needs Review ${needsReview.length}`, amber: needsReview.length > 0 },
                    { key: 'recorded', label: `Recorded ${recordedTx.length}` },
                  ].map(p => (
                    <button
                      key={p.key}
                      onClick={() => setReviewFilter(p.key)}
                      className={`text-xs px-3 py-1.5 rounded-lg transition-colors ${
                        reviewFilter === p.key
                          ? p.amber ? 'bg-amber-500 text-white' : 'bg-slate-800 text-white'
                          : p.amber ? 'text-amber-700 bg-amber-50 hover:bg-amber-100' : 'text-slate-500 border border-slate-200 hover:border-slate-300'
                      }`}
                    >
                      {p.label}
                    </button>
                  ))}
                </div>
                {needsReview.length > 0 && (
                  <button
                    onClick={handleRecordAll}
                    disabled={recordingAll}
                    className="flex items-center gap-1.5 text-xs font-medium text-emerald-700 px-3 py-1.5 rounded-lg border border-emerald-200 hover:bg-emerald-50 transition-colors disabled:opacity-50"
                  >
                    {recordingAll
                      ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Recording…</>
                      : <><Check className="w-3.5 h-3.5" /> Record all {needsReview.length}</>}
                  </button>
                )}
              </div>
            )}

            {transactions.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 text-slate-400 gap-2">
                <p className="text-sm font-medium">No transactions yet</p>
                <p className="text-xs">Add a transaction manually or upload a statement</p>
              </div>
            ) : (
              <table className="w-full text-sm border-collapse">
                <thead>
                  <tr className="bg-slate-50 border-y border-slate-200 sticky top-[45px] z-10">
                    <SortTh col="date"        sort={sortState} onSort={handleSort}>Date</SortTh>
                    <SortTh col="description" sort={sortState} onSort={handleSort}>Description</SortTh>
                    <SortTh col="category"    sort={sortState} onSort={handleSort}>Category</SortTh>
                    <SortTh col="amount"      sort={sortState} onSort={handleSort} right>Amount</SortTh>
                    <SortTh col="source"      sort={sortState} onSort={handleSort}>Source</SortTh>
                    <th className="px-2 py-3 w-12 text-xs font-semibold text-slate-500 uppercase tracking-wide bg-slate-50" title="Reconciled against bank statement">Rec</th>
                    <th className="px-4 py-3 w-10" />
                  </tr>
                </thead>
                <tbody>
                  {sorted
                    .filter(tx => reviewFilter === 'all' ? true
                      : reviewFilter === 'review' ? tx.review_status === 'needs_review'
                      : tx.review_status !== 'needs_review')
                    .map((tx, i) => {
                    const catStyle  = CATEGORY_COLORS[tx.category] || CATEGORY_COLORS['Other']
                    const srcConfig = SOURCE_LABELS[tx.source]     || SOURCE_LABELS['Manual']
                    const isPos     = Number(tx.amount) >= 0
                    const pending   = tx.review_status === 'needs_review'

                    return (
                      <tr key={tx.id} className={pending ? 'bg-amber-50/50' : i % 2 === 0 ? 'bg-white' : 'bg-slate-50/60'}>
                        <td className="px-4 pl-6 py-3 border-b border-slate-100 text-slate-500 whitespace-nowrap text-xs">
                          {fmtDate(tx.date)}
                        </td>
                        <td className="px-4 py-3 border-b border-slate-100 text-slate-800 max-w-[260px] font-medium">
                          <span className="truncate block">{tx.description}</span>
                          {tx.vendor && <span className="text-xs text-slate-400 font-normal">{tx.vendor}</span>}
                        </td>
                        <td className="px-4 py-3 border-b border-slate-100">
                          {pending ? (
                            <select
                              value={reviewCats[tx.id] ?? tx.category}
                              onChange={e => setReviewCats(prev => ({ ...prev, [tx.id]: e.target.value }))}
                              className="text-xs border border-slate-200 rounded-lg px-2 py-1 focus:outline-none focus:ring-2 focus:ring-blue-400 bg-white"
                            >
                              {ALL_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
                            </select>
                          ) : (
                            <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${catStyle}`}>
                              {tx.category}
                            </span>
                          )}
                        </td>
                        <td className={`px-4 py-3 border-b border-slate-100 text-right font-semibold tabular-nums whitespace-nowrap ${
                          isPos ? 'text-emerald-600' : 'text-red-600'
                        }`}>
                          {fmt$(tx.amount, true)}
                        </td>
                        <td className="px-4 py-3 border-b border-slate-100">
                          {pending ? (
                            <span className="inline-flex items-center gap-1 text-[10px] font-bold text-amber-700 bg-amber-100 px-2 py-0.5 rounded-full">Needs review</span>
                          ) : (
                            <span className="flex items-center gap-1.5 text-xs text-slate-500">
                              <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${srcConfig.dot}`} />
                              {srcConfig.label}
                            </span>
                          )}
                        </td>
                        <td className="px-2 py-3 border-b border-slate-100 text-center">
                          {!pending && (
                            <input
                              type="checkbox"
                              checked={!!tx.reconciled}
                              onChange={() => handleReconcile(tx)}
                              className="rounded border-slate-300 text-emerald-600 focus:ring-emerald-500 cursor-pointer"
                              title={tx.reconciled ? 'Reconciled — click to undo' : 'Mark as reconciled'}
                            />
                          )}
                        </td>
                        <td className="px-4 py-3 pr-6 border-b border-slate-100">
                          <div className="flex items-center gap-1 justify-end">
                            {pending && (
                              <button
                                onClick={() => handleRecord(tx)}
                                disabled={recordingId === tx.id}
                                className="flex items-center gap-1 text-xs font-medium text-emerald-700 px-2 py-1 rounded-lg border border-emerald-200 hover:bg-emerald-50 transition-colors disabled:opacity-50"
                                title="Record this transaction into the books"
                              >
                                {recordingId === tx.id
                                  ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                  : <><Check className="w-3 h-3" /> Record</>}
                              </button>
                            )}
                            <button
                              onClick={() => handleDelete(tx.id)}
                              disabled={deleting === tx.id}
                              className="p-1.5 rounded text-slate-200 hover:text-red-500 hover:bg-red-50 transition-colors disabled:opacity-40"
                              title={pending ? 'Exclude (delete)' : 'Delete'}
                            >
                              {deleting === tx.id
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
              </table>
            )}
          </div>
        )}
      </div>}

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
          property={property}
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
