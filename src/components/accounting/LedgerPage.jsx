import { useState, useEffect, useCallback, useRef } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { ArrowLeft, Plus, FileText, Landmark, Trash2, Loader2, Users, Pencil, Check, X, ChevronDown, ChevronRight, ChevronUp, ChevronsUpDown, Download, BarChart2, Scale, ArrowLeftRight, FileSpreadsheet, Target, Receipt, Store, HandCoins, Split, Sparkles, Link2, AlertTriangle } from 'lucide-react'
import { getLedger, deleteTransaction, getInvestors, deleteInvestor, updateInvestorContribution, reconcileTransaction, recordTransaction, unrecordTransaction, recordAllTransactions, autoRecordTransactions, getReviewSuggestions, getAccountingSettings, getOpeningBalances, getPropertyInvestorsList, setTransactionInvestor, getInvestorSuggestions, updateTransaction, uploadAmortization, getCRMInvestors, linkCapTableInvestor, removeInvestorExcelEntries, matchTransaction, unmatchTransaction, getMatchCandidates } from '../../api/client'
import OpeningBalancesModal from './OpeningBalancesModal'
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
import CapitalAccounts from './CapitalAccounts'
import PlaidConnect from './PlaidConnect'
import SplitTransactionModal from './SplitTransactionModal'
import AmortizationCard from './AmortizationCard'
import CategorySelect from './CategorySelect'
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
  const [invCollapsed, setInvCollapsed]     = useState(() => {
    try { return localStorage.getItem('ledger_inv_collapsed') === '1' } catch { return false }
  })
  const toggleInvCollapsed = () => setInvCollapsed(v => {
    const next = !v
    try { localStorage.setItem('ledger_inv_collapsed', next ? '1' : '0') } catch { /* ignore */ }
    return next
  })
  const [amortRefresh, setAmortRefresh]     = useState(0)
  const [amortUploading, setAmortUploading] = useState(false)
  const amortInputRef                       = useRef(null)
  const [crmInvestors, setCrmInvestors]     = useState([])   // global investor profiles for the link picker
  const [linkingId, setLinkingId]           = useState(null) // cap-table row id being linked

  useEffect(() => { getCRMInvestors({ limit: 1000 }).then(r => setCrmInvestors(r.rows || [])).catch(() => {}) }, [])

  async function handleSetLink(rowId, investorId) {
    try {
      await linkCapTableInvestor(rowId, investorId || null)
      setInvestors(prev => prev.map(i => i.id === rowId ? { ...i, investor_id: investorId || null, linked: !!investorId } : i))
    } catch (e) { setError(e.message) }
    setLinkingId(null)
  }

  const [cleaningExcel, setCleaningExcel] = useState(false)
  async function handleRemoveExcelEquity() {
    setCleaningExcel(true)
    try { await removeInvestorExcelEntries(propertyId); await reload() }
    catch (e) { setError(e.message) }
    finally { setCleaningExcel(false) }
  }

  async function handleAmortUpload(file) {
    if (!file) return
    setAmortUploading(true)
    setError(null)
    try {
      await uploadAmortization(propertyId, file)
      setAmortRefresh(n => n + 1)   // remount the card so it shows the new schedule
      reload()
    } catch (e) {
      setError(e.message)
    } finally {
      setAmortUploading(false)
      if (amortInputRef.current) amortInputRef.current.value = ''
    }
  }
  const [reviewFilter, setReviewFilter]     = useState('all') // 'all' | 'review' | 'recorded'
  const [reviewCats, setReviewCats]         = useState({})     // tx.id → category override
  const [recordingId, setRecordingId]       = useState(null)
  const [recordingAll, setRecordingAll]     = useState(false)
  const [autoRecording, setAutoRecording]   = useState(false)
  const [suggestions, setSuggestions]       = useState({})   // tx.id → { suggested, confidence, hit_count }
  const [investorsList, setInvestorsList]   = useState([])   // [{id,name}] for the equity dropdown
  const [investorSug, setInvestorSug]       = useState({})   // tx.id → { investor_id, name, confidence }
  const [editingId, setEditingId]           = useState(null)   // tx.id being edited inline
  const [editForm, setEditForm]             = useState(null)
  const [savingEdit, setSavingEdit]         = useState(false)
  const [splitTx, setSplitTx]               = useState(null)    // transaction being split
  const [advanced, setAdvanced]             = useState(false)   // Advanced Accounting beta flag
  const [openingBalances, setOpeningBalances] = useState(null)
  const [showOpening, setShowOpening]       = useState(false)

  const reload = useCallback(() => {
    setLoading(true)
    Promise.all([
      getLedger(propertyId),
      getInvestors(propertyId),
      getAccountingSettings().catch(() => ({ advanced: false })),
      getOpeningBalances(propertyId).catch(() => null),
      getPropertyInvestorsList(propertyId).catch(() => []),
    ])
      .then(([ledger, invs, settings, opening, roster]) => {
        setProperty(ledger.property)
        setTransactions(ledger.transactions)
        setInvestors(invs)
        setAdvanced(!!settings.advanced)
        setOpeningBalances(opening)
        setInvestorsList(roster)
        // Suggest investors for any unattributed equity contributions
        if (ledger.transactions.some(t => t.category === 'Equity Contribution' && !t.investor_id)) {
          getInvestorSuggestions(propertyId).then(setInvestorSug).catch(() => {})
        }
        // Surface pending review items: open the ledger and focus the review filter
        if (ledger.transactions.some(t => t.review_status === 'needs_review')) {
          setLedgerOpen(true)
          setReviewFilter('review')
          // Fetch auto-pilot confidence + pre-fill suggested categories
          getReviewSuggestions(propertyId).then(list => {
            const map = {}
            for (const s of list) map[s.id] = s
            setSuggestions(map)
            setReviewCats(prev => {
              const next = { ...prev }
              for (const s of list) if (s.suggested && next[s.id] === undefined) next[s.id] = s.suggested
              return next
            })
          }).catch(() => {})
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

  async function handleUnrecord(tx) {
    setRecordingId(tx.id)
    try {
      await unrecordTransaction(tx.id)
      await reload()
    } finally {
      setRecordingId(null)
    }
  }

  const [matchingId, setMatchingId]         = useState(null)  // tx.id whose match menu is open
  const [matchCandidates, setMatchCandidates] = useState([])  // candidate entries to match against
  function openMatch(tx) {
    if (matchingId === tx.id) { setMatchingId(null); return }
    setMatchingId(tx.id)
    setMatchCandidates([])
    getMatchCandidates(propertyId, Math.abs(Number(tx.amount) || 0), tx.id).then(setMatchCandidates).catch(() => {})
  }
  async function handleMatch(tx, note, matchedToId = null) {
    setMatchingId(null)
    setRecordingId(tx.id)
    try { await matchTransaction(tx.id, note, matchedToId); await reload() }
    finally { setRecordingId(null) }
  }
  async function handleUnmatch(tx) {
    setRecordingId(tx.id)
    try { await unmatchTransaction(tx.id); await reload() }
    finally { setRecordingId(null) }
  }

  async function handleSetInvestor(txId, investorId) {
    // Optimistic update
    const inv = investorsList.find(i => i.id === Number(investorId))
    setTransactions(prev => prev.map(t => t.id === txId
      ? { ...t, investor_id: investorId ? Number(investorId) : null, investor_name: inv?.name || null } : t))
    setInvestorSug(prev => { const n = { ...prev }; delete n[txId]; return n })
    try { await setTransactionInvestor(txId, investorId ? Number(investorId) : null) }
    catch (e) { alert(e.message); reload() }
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

  async function handleAutoRecord() {
    setAutoRecording(true)
    try {
      const { recorded, left } = await autoRecordTransactions(propertyId)
      await reload()
      if (recorded === 0) {
        alert('Nothing recorded yet — the auto-pilot needs to see you categorize these merchants a few times first. Record some manually and it will learn.')
      } else {
        alert(`Auto-recorded ${recorded} confident transaction${recorded !== 1 ? 's' : ''}. ${left} left in Needs Review for you to check.`)
      }
    } finally {
      setAutoRecording(false)
    }
  }

  const confidentCount = Object.values(suggestions).filter(s => s.confidence === 'high').length

  function startEdit(tx) {
    setEditingId(tx.id)
    setEditForm({
      date: tx.date, description: tx.description, category: tx.category,
      amount: String(tx.amount), vendor: tx.vendor || '',
    })
  }

  function cancelEdit() {
    setEditingId(null)
    setEditForm(null)
  }

  async function saveEdit() {
    const amt = parseFloat(editForm.amount)
    if (!editForm.date || !editForm.description.trim() || !isFinite(amt)) return
    setSavingEdit(true)
    try {
      await updateTransaction(editingId, {
        date:        editForm.date,
        description: editForm.description.trim(),
        category:    editForm.category,
        amount:      amt,
        vendor:      editForm.vendor.trim() || null,
      })
      setEditingId(null)
      setEditForm(null)
      await reload()
    } catch (e) {
      setError(e.message)
    } finally {
      setSavingEdit(false)
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
  const matchedTx   = transactions.filter(t => t.review_status === 'matched')
  // Financial displays must use strictly 'recorded' so matched rows don't count.
  const recordedTx  = transactions.filter(t => t.review_status === 'recorded')

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
            <input ref={amortInputRef} type="file" accept=".pdf,.xlsx,.xls,.csv" className="hidden"
              onChange={e => handleAmortUpload(e.target.files[0])} />
            <Button variant="secondary" onClick={() => amortInputRef.current?.click()} disabled={amortUploading}
              title="Upload a loan amortization schedule — mortgage payments auto-split on sync">
              {amortUploading ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileSpreadsheet className="w-4 h-4" />} Amortization
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
            { key: 'capital',       label: 'Capital',       Icon: Users },
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
          {advanced && (
            <div className="flex items-center justify-end px-6 pt-4">
              <button
                onClick={() => setShowOpening(true)}
                className="flex items-center gap-1.5 text-xs font-medium text-blue-700 px-3 py-1.5 rounded-lg border border-blue-200 hover:bg-blue-50 transition-colors"
              >
                <Landmark className="w-3.5 h-3.5" /> {openingBalances?.as_of_date ? 'Edit' : 'Set'} opening balances
              </button>
            </div>
          )}
          <BalanceSheet transactions={recordedTx} investors={investors} opening={advanced ? openingBalances : null} />
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
      {activeView === 'capital' && (
        <div className="flex-1 overflow-y-auto">
          <CapitalAccounts propertyId={propertyId} />
        </div>
      )}
      {activeView === 'distributions' && (
        <div className="flex-1 overflow-y-auto">
          <Distributions propertyId={propertyId} />
        </div>
      )}

      {/* Legacy Excel-imported equity duplicates — offer one-click cleanup */}
      {activeView === 'ledger' && (() => {
        const dupes = transactions.filter(t => t.source === 'Excel Upload' && t.category === 'Equity Contribution')
        if (!dupes.length) return null
        const total = dupes.reduce((s, t) => s + Number(t.amount || 0), 0)
        return (
          <div className="shrink-0 mx-6 my-3 flex items-start gap-3 px-4 py-3 bg-amber-50 border border-amber-200 rounded-xl">
            <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
            <div className="flex-1 min-w-0 text-sm text-amber-800">
              <p className="font-medium">{dupes.length} equity {dupes.length === 1 ? 'entry' : 'entries'} were imported from the investor spreadsheet</p>
              <p className="text-xs mt-0.5">These duplicate your bank wire deposits. Remove them so equity is counted once (from the bank feed) — this won't touch the cap table.</p>
            </div>
            <button onClick={handleRemoveExcelEquity} disabled={cleaningExcel}
              className="shrink-0 flex items-center gap-1.5 text-xs font-semibold text-white bg-amber-600 hover:bg-amber-700 px-3 py-1.5 rounded-lg disabled:opacity-50">
              {cleaningExcel ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
              Remove {fmt$(total)}
            </button>
          </div>
        )
      })()}

      {/* Investors section — only in ledger view */}
      {activeView === 'ledger' && investors.length > 0 && (
        <div className="shrink-0 bg-slate-50 border-b border-slate-200">
          <button
            onClick={toggleInvCollapsed}
            className="w-full flex items-center gap-1.5 px-6 pt-3 pb-2 text-left hover:bg-slate-100/60 transition-colors"
            title={invCollapsed ? 'Show investors' : 'Hide investors'}
          >
            {invCollapsed ? <ChevronRight className="w-3.5 h-3.5 text-slate-400" /> : <ChevronDown className="w-3.5 h-3.5 text-slate-400" />}
            <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wide">
              Investors — {investors.length}
            </h3>
            {invCollapsed && (
              <span className="ml-2 text-xs text-slate-400 normal-case font-normal">
                {fmt$(equityContributed)} total equity ·<span className="text-blue-500"> show</span>
              </span>
            )}
          </button>
          {!invCollapsed && (
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr className="border-y border-slate-200">
                <SortTh col="name"             sort={invSort} onSort={handleInvSort}>Name</SortTh>
                <SortTh col="class"            sort={invSort} onSort={handleInvSort}>Class</SortTh>
                <SortTh col="percentage"       sort={invSort} onSort={handleInvSort}>Ownership</SortTh>
                <SortTh col="preferred_return" sort={invSort} onSort={handleInvSort}>Pref. Return</SortTh>
                <SortTh col="contribution"     sort={invSort} onSort={handleInvSort} right>Committed</SortTh>
                <th className="px-4 py-2 text-right text-xs font-semibold text-slate-500 uppercase tracking-wide" title="Equity actually recorded from the bank feed and attributed to this investor">Recorded</th>
                <th className="px-4 pr-6 py-2 w-16" />
              </tr>
            </thead>
            <tbody>
              {sortedInvestors.map(inv => {
                const isEditing = editingContrib?.id === inv.id
                return (
                  <tr key={inv.id} className="border-b border-slate-100 bg-white hover:bg-slate-50/60">
                    <td className="px-4 pl-6 py-2.5 font-medium text-slate-900">
                      {linkingId === inv.id ? (
                        <div className="flex items-center gap-1.5">
                          <span className="text-slate-500 text-xs shrink-0">{inv.name} →</span>
                          <select
                            autoFocus
                            defaultValue={inv.investor_id || ''}
                            onChange={e => handleSetLink(inv.id, e.target.value ? Number(e.target.value) : null)}
                            className="text-xs border border-blue-400 rounded px-2 py-1 outline-none focus:ring-2 focus:ring-blue-400 bg-white max-w-[200px]"
                          >
                            <option value="">— Not linked —</option>
                            {crmInvestors.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
                          </select>
                          <button onClick={() => setLinkingId(null)} className="text-slate-400 hover:text-slate-600" title="Cancel"><X className="w-3.5 h-3.5" /></button>
                        </div>
                      ) : inv.investor_id ? (
                        <button
                          onClick={() => navigate(`/investors/${inv.investor_id}`)}
                          className="text-blue-600 hover:text-blue-800 hover:underline text-left"
                          title="Open investor profile"
                        >
                          {inv.name}{inv.linked && <span className="ml-1 text-emerald-500" title="Manually linked">✓</span>}
                        </button>
                      ) : inv.name}
                    </td>
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
                    <td className="px-4 py-2.5 text-right tabular-nums whitespace-nowrap">
                      {(() => {
                        const committed = Number(inv.contribution) || 0
                        const recorded  = Number(inv.recorded) || 0
                        const pending   = Number(inv.pending) || 0
                        if (!inv.investor_id) return <span className="text-slate-300" title="Link this investor to reconcile recorded equity">—</span>
                        const matched = committed > 0 && Math.abs(recorded - committed) < 1
                        const over    = recorded - committed >= 1
                        return (
                          <span className="inline-flex items-center gap-1.5 justify-end">
                            <span className={matched ? 'font-semibold text-emerald-700' : recorded > 0 ? 'text-slate-700' : 'text-slate-400'}>{fmt$(recorded)}</span>
                            {matched ? (
                              <Check className="w-3.5 h-3.5 text-emerald-500" title="Recorded matches committed" />
                            ) : over ? (
                              <span className="text-[10px] font-semibold text-red-600 bg-red-50 px-1.5 py-0.5 rounded-full" title="Recorded more than committed">+{fmt$(recorded - committed)}</span>
                            ) : (
                              <span className="text-[10px] font-semibold text-amber-600 bg-amber-50 px-1.5 py-0.5 rounded-full"
                                title={pending > 0 ? `${fmt$(pending)} awaiting review` : `${fmt$(committed - recorded)} not yet recorded`}>
                                {pending > 0 ? `${fmt$(pending)} pending` : `${fmt$(committed - recorded)} short`}
                              </span>
                            )}
                          </span>
                        )
                      })()}
                    </td>
                    <td className="px-4 pr-6 py-2.5">
                      <div className="flex items-center justify-end gap-1">
                        <button
                          onClick={() => setLinkingId(linkingId === inv.id ? null : inv.id)}
                          className={`p-1 rounded transition-colors ${inv.linked ? 'text-emerald-500 hover:bg-emerald-50' : inv.investor_id ? 'text-slate-300 hover:text-blue-500 hover:bg-blue-50' : 'text-amber-500 hover:bg-amber-50'}`}
                          title={inv.linked ? 'Linked to investor profile — change' : inv.investor_id ? 'Auto-matched — set an explicit link' : 'Not linked — link to an investor profile'}
                        >
                          <Link2 className="w-3.5 h-3.5" />
                        </button>
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
                  Total Equity {(() => {
                    const committed = investors.reduce((s, i) => s + Number(i.contribution || 0), 0)
                    const recorded  = investors.reduce((s, i) => s + Number(i.recorded || 0), 0)
                    const diff = committed - recorded
                    if (Math.abs(diff) < 1) return <span className="ml-1 normal-case font-semibold text-emerald-600">· ✓ recorded equity reconciles</span>
                    if (diff > 0)          return <span className="ml-1 normal-case font-semibold text-amber-600">· {fmt$(diff)} not yet recorded</span>
                    return <span className="ml-1 normal-case font-semibold text-red-600">· {fmt$(-diff)} recorded over committed</span>
                  })()}
                </td>
                <td className="px-4 py-2.5 text-right font-bold text-emerald-700 tabular-nums">
                  {fmt$(investors.reduce((s, i) => s + Number(i.contribution), 0))}
                </td>
                <td className="px-4 py-2.5 text-right font-bold text-slate-800 tabular-nums">
                  {fmt$(investors.reduce((s, i) => s + Number(i.recorded || 0), 0))}
                </td>
                <td className="px-4 pr-6 py-2.5" />
              </tr>
            </tfoot>
          </table>
          )}
        </div>
      )}

      {/* Bank Connections — only in ledger view */}
      {activeView === 'ledger' && (
        <PlaidConnect propertyId={propertyId} onSaved={reload} />
      )}

      {/* Loan amortization — only in ledger view */}
      {activeView === 'ledger' && (
        <AmortizationCard key={amortRefresh} propertyId={propertyId} hideUploader />
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
                    ...(matchedTx.length > 0 ? [{ key: 'matched', label: `Matched ${matchedTx.length}` }] : []),
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
                  <div className="flex items-center gap-2">
                    <button
                      onClick={handleAutoRecord}
                      disabled={autoRecording || recordingAll}
                      title="Record everything the auto-pilot is confident about (learned from how you've categorized these merchants before). Questionable ones stay in Needs Review."
                      className="flex items-center gap-1.5 text-xs font-medium text-blue-700 px-3 py-1.5 rounded-lg border border-blue-200 hover:bg-blue-50 transition-colors disabled:opacity-50"
                    >
                      {autoRecording
                        ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Working…</>
                        : <><Sparkles className="w-3.5 h-3.5" /> Auto-record{confidentCount > 0 ? ` ${confidentCount}` : ''}</>}
                    </button>
                    <button
                      onClick={handleRecordAll}
                      disabled={recordingAll || autoRecording}
                      className="flex items-center gap-1.5 text-xs font-medium text-emerald-700 px-3 py-1.5 rounded-lg border border-emerald-200 hover:bg-emerald-50 transition-colors disabled:opacity-50"
                    >
                      {recordingAll
                        ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Recording…</>
                        : <><Check className="w-3.5 h-3.5" /> Record all {needsReview.length}</>}
                    </button>
                  </div>
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
                      : reviewFilter === 'matched' ? tx.review_status === 'matched'
                      : tx.review_status === 'recorded')
                    .map((tx, i) => {
                    const catStyle  = CATEGORY_COLORS[tx.category] || CATEGORY_COLORS['Other']
                    const srcConfig = SOURCE_LABELS[tx.source]     || SOURCE_LABELS['Manual']
                    const isPos     = Number(tx.amount) >= 0
                    const pending   = tx.review_status === 'needs_review'
                    const matched   = tx.review_status === 'matched'
                    const editing   = editingId === tx.id

                    // ── Inline edit mode: every field editable ──────────────────
                    if (editing) {
                      return (
                        <tr key={tx.id} className="bg-blue-50/60">
                          <td className="px-3 pl-5 py-2 border-b border-blue-100">
                            <input type="date" value={editForm.date}
                              onChange={e => setEditForm(f => ({ ...f, date: e.target.value }))}
                              className="text-xs border border-slate-300 rounded px-2 py-1 w-full focus:outline-none focus:ring-1 focus:ring-blue-400" />
                          </td>
                          <td className="px-3 py-2 border-b border-blue-100">
                            <input type="text" value={editForm.description}
                              onChange={e => setEditForm(f => ({ ...f, description: e.target.value }))}
                              placeholder="Description"
                              className="text-xs border border-slate-300 rounded px-2 py-1 w-full mb-1 focus:outline-none focus:ring-1 focus:ring-blue-400" />
                            <input type="text" value={editForm.vendor}
                              onChange={e => setEditForm(f => ({ ...f, vendor: e.target.value }))}
                              placeholder="Vendor / payee"
                              className="text-xs border border-slate-300 rounded px-2 py-1 w-full focus:outline-none focus:ring-1 focus:ring-blue-400" />
                          </td>
                          <td className="px-3 py-2 border-b border-blue-100">
                            <CategorySelect value={editForm.category}
                              onChange={v => setEditForm(f => ({ ...f, category: v }))}
                              className="text-xs border border-slate-300 rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-blue-400 bg-white" />
                          </td>
                          <td className="px-3 py-2 border-b border-blue-100 text-right">
                            <input type="number" step="0.01" value={editForm.amount}
                              onChange={e => setEditForm(f => ({ ...f, amount: e.target.value }))}
                              title="Positive = money in, negative = money out"
                              className="text-xs border border-slate-300 rounded px-2 py-1 w-24 text-right tabular-nums focus:outline-none focus:ring-1 focus:ring-blue-400" />
                          </td>
                          <td className="px-3 py-2 border-b border-blue-100 text-[10px] text-slate-400">
                            + in / − out
                          </td>
                          <td className="border-b border-blue-100" />
                          <td className="px-4 py-2 pr-6 border-b border-blue-100">
                            <div className="flex items-center gap-1 justify-end">
                              <button onClick={saveEdit} disabled={savingEdit}
                                className="p-1.5 rounded text-emerald-600 hover:bg-emerald-100 transition-colors disabled:opacity-50" title="Save">
                                {savingEdit ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                              </button>
                              <button onClick={cancelEdit}
                                className="p-1.5 rounded text-slate-400 hover:bg-slate-100 transition-colors" title="Cancel">
                                <X className="w-4 h-4" />
                              </button>
                            </div>
                          </td>
                        </tr>
                      )
                    }

                    return (
                      <tr key={tx.id}
                        onDoubleClick={() => startEdit(tx)}
                        className={`group cursor-default ${pending ? 'bg-amber-50/50' : i % 2 === 0 ? 'bg-white' : 'bg-slate-50/60'}`}>
                        <td className="px-4 pl-6 py-3 border-b border-slate-100 text-slate-500 whitespace-nowrap text-xs">
                          {fmtDate(tx.date)}
                        </td>
                        <td className="px-4 py-3 border-b border-slate-100 text-slate-800 max-w-[260px] font-medium">
                          <span className="truncate block">{tx.description}</span>
                          {tx.vendor && <span className="text-xs text-slate-400 font-normal">{tx.vendor}</span>}
                          {(tx.category === 'Equity Contribution' || reviewCats[tx.id] === 'Equity Contribution' || investorSug[tx.id]) && (
                            <div className="mt-1 flex items-center gap-1.5">
                              <Users className="w-3 h-3 text-slate-400 shrink-0" />
                              <select
                                value={tx.investor_id || ''}
                                onChange={e => handleSetInvestor(tx.id, e.target.value)}
                                className={`text-xs border rounded px-1.5 py-0.5 bg-white max-w-[180px] focus:outline-none focus:ring-1 focus:ring-blue-400 ${
                                  tx.investor_id ? 'border-slate-200 text-slate-700' : 'border-amber-300 text-amber-700'
                                }`}
                              >
                                <option value="">
                                  {investorSug[tx.id] ? `Suggested: ${investorSug[tx.id].name}` : '— Attribute to investor —'}
                                </option>
                                {investorsList.map(iv => <option key={iv.id} value={iv.id}>{iv.name}</option>)}
                              </select>
                              {!tx.investor_id && investorSug[tx.id] && (
                                <button
                                  onClick={() => {
                                    if (investorSug[tx.id].suggest_equity) setReviewCats(prev => ({ ...prev, [tx.id]: 'Equity Contribution' }))
                                    handleSetInvestor(tx.id, investorSug[tx.id].investor_id)
                                  }}
                                  className="text-xs font-medium text-blue-600 hover:underline shrink-0"
                                  title={`Auto-pilot match (${investorSug[tx.id].confidence} confidence)${investorSug[tx.id].suggest_equity ? ' — also sets category to Equity Contribution' : ''}`}
                                >
                                  {investorSug[tx.id].suggest_equity ? '✓ equity from ' + investorSug[tx.id].name.split(' ')[0] : '✓ accept'}
                                </button>
                              )}
                            </div>
                          )}
                        </td>
                        <td className="px-4 py-3 border-b border-slate-100">
                          {pending ? (
                            <div className="flex items-center gap-1.5">
                              <CategorySelect
                                value={reviewCats[tx.id] ?? tx.category}
                                onChange={v => setReviewCats(prev => ({ ...prev, [tx.id]: v }))}
                                className="text-xs border border-slate-200 rounded-lg px-2 py-1 focus:outline-none focus:ring-2 focus:ring-blue-400 bg-white"
                              />
                              {(() => {
                                const conf = suggestions[tx.id]?.confidence
                                if (conf === 'high') return <span title="High confidence — the auto-pilot has seen you categorize this merchant before" className="w-2 h-2 rounded-full bg-emerald-500 shrink-0" />
                                if (conf === 'medium') return <span title="Some history — confirm to teach the auto-pilot" className="w-2 h-2 rounded-full bg-amber-400 shrink-0" />
                                return <span title="New to the auto-pilot — your choice will train it" className="w-2 h-2 rounded-full bg-slate-300 shrink-0" />
                              })()}
                            </div>
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
                            {pending ? (
                              <>
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
                                <div className="relative">
                                  <button
                                    onClick={() => openMatch(tx)}
                                    disabled={recordingId === tx.id}
                                    className="flex items-center gap-1 text-xs font-medium text-slate-500 px-2 py-1 rounded-lg border border-slate-200 hover:bg-slate-50 transition-colors disabled:opacity-50"
                                    title="Match to something already in the books (e.g. the settlement) — reconciles it without double-counting"
                                  >
                                    <Link2 className="w-3 h-3" /> Match
                                  </button>
                                  {matchingId === tx.id && (
                                    <>
                                      <div className="fixed inset-0 z-10" onClick={() => setMatchingId(null)} />
                                      <div className="absolute right-0 top-8 z-20 w-72 max-h-80 overflow-y-auto bg-white border border-slate-200 rounded-xl shadow-lg py-1 text-xs">
                                        <p className="px-3 py-1 text-[10px] font-semibold text-slate-400 uppercase tracking-wide">Match to an entry already in the books</p>
                                        {matchCandidates.length === 0 ? (
                                          <p className="px-3 py-1.5 text-slate-400 italic">No recorded entries yet</p>
                                        ) : matchCandidates.map(c => {
                                          const close = Math.abs(Math.abs(c.amount) - Math.abs(tx.amount)) < 1
                                          return (
                                            <button key={c.id} onClick={() => handleMatch(tx, `${c.description} (${String(c.date).slice(0,10)})`, c.id)}
                                              className="w-full text-left px-3 py-1.5 hover:bg-slate-50 flex items-center justify-between gap-2">
                                              <span className="min-w-0">
                                                <span className="block truncate text-slate-700">{c.description || c.category}</span>
                                                <span className="text-[10px] text-slate-400">{String(c.date).slice(0,10)} · {c.source}</span>
                                              </span>
                                              <span className={`shrink-0 tabular-nums font-medium ${close ? 'text-emerald-600' : 'text-slate-500'}`}>{fmt$(c.amount)}{close ? ' ✓' : ''}</span>
                                            </button>
                                          )
                                        })}
                                        <div className="border-t border-slate-100 mt-1 pt-1">
                                          <p className="px-3 py-1 text-[10px] font-semibold text-slate-400 uppercase tracking-wide">Or just tag it (no single entry)</p>
                                          {['Settlement statement', 'Loan proceeds', 'Earnest money', 'Investor equity', 'Transfer between accounts', 'Duplicate / other'].map(reason => (
                                            <button key={reason} onClick={() => handleMatch(tx, reason)}
                                              className="w-full text-left px-3 py-1.5 text-slate-600 hover:bg-slate-50">
                                              {reason}
                                            </button>
                                          ))}
                                        </div>
                                      </div>
                                    </>
                                  )}
                                </div>
                              </>
                            ) : matched ? (
                              <div className="flex items-center gap-1.5">
                                <span className="inline-flex items-center gap-1 text-xs font-medium text-slate-500 bg-slate-100 px-2 py-1 rounded-lg" title={tx.matched_note || 'Matched — excluded from totals'}>
                                  <Link2 className="w-3 h-3" /> Matched{tx.matched_note ? `: ${tx.matched_note}` : ''}
                                </span>
                                <button
                                  onClick={() => handleUnmatch(tx)}
                                  disabled={recordingId === tx.id}
                                  className="flex items-center gap-1 text-xs font-medium text-amber-700 px-2 py-1 rounded-lg border border-amber-200 hover:bg-amber-50 transition-colors disabled:opacity-50 opacity-0 group-hover:opacity-100"
                                  title="Undo the match (send back to Needs Review)"
                                >
                                  {recordingId === tx.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : 'Unmatch'}
                                </button>
                              </div>
                            ) : (
                              <button
                                onClick={() => handleUnrecord(tx)}
                                disabled={recordingId === tx.id}
                                className="flex items-center gap-1 text-xs font-medium text-amber-700 px-2 py-1 rounded-lg border border-amber-200 hover:bg-amber-50 transition-colors disabled:opacity-50 opacity-0 group-hover:opacity-100"
                                title="Send this transaction back to Needs Review (removes it from the books until re-recorded)"
                              >
                                {recordingId === tx.id
                                  ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                  : <><ArrowLeftRight className="w-3 h-3" /> Unrecord</>}
                              </button>
                            )}
                            <button
                              onClick={() => startEdit(tx)}
                              className="p-1.5 rounded text-slate-300 hover:text-blue-600 hover:bg-blue-50 transition-colors"
                              title="Edit transaction"
                            >
                              <Pencil className="w-3.5 h-3.5" />
                            </button>
                            <button
                              onClick={() => setSplitTx(tx)}
                              className="p-1.5 rounded text-slate-300 hover:text-blue-600 hover:bg-blue-50 transition-colors"
                              title="Split (e.g. principal / interest)"
                            >
                              <Split className="w-3.5 h-3.5" />
                            </button>
                            <button
                              onClick={() => handleDelete(tx.id)}
                              disabled={deleting === tx.id}
                              className="p-1.5 rounded text-slate-300 hover:text-red-500 hover:bg-red-50 transition-colors disabled:opacity-40"
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
      {splitTx && (
        <SplitTransactionModal
          tx={splitTx}
          onSaved={reload}
          onClose={() => setSplitTx(null)}
        />
      )}

      {showOpening && (
        <OpeningBalancesModal
          propertyId={propertyId}
          initial={openingBalances}
          onSaved={reload}
          onClose={() => setShowOpening(false)}
        />
      )}

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
