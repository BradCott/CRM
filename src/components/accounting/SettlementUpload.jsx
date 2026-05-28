import { useState, useEffect, useRef, useCallback } from 'react'
import { X, Upload, Loader2, CheckCircle, AlertCircle, AlertTriangle, Copy, Check, Users } from 'lucide-react'
import Button from '../ui/Button'
import { uploadSettlement, createTransactions, saveJournalEntry, getInvestors } from '../../api/client'

// ── Formatters ────────────────────────────────────────────────────────────────

const $fmt = v =>
  v != null && v !== '' && isFinite(Number(v)) && Number(v) !== 0
    ? '$' + Math.abs(Math.round(Number(v))).toLocaleString()
    : '—'

// ── Journal entry builder ─────────────────────────────────────────────────────
//
// Structure (QuickBooks journal entry format):
//
// DEBITS
//   1. [Property Name]  — building asset  (totalBasis × buildingPct%)
//   2. Land             —                  (totalBasis × landPct%)
//   3. [Property Name]  — EMD funded outside LLC (if applicable)
//   4. [Property Name]  — checking acct, equity received (sum of investor contributions)
//
// CREDITS
//   1. MTG [Lender]                        — loan amount
//   2. Rental Income                       — prorated rent (if any)
//   3. Taxes & licenses:Property taxes     — tax proration credit (if any)
//   4. Insurance                           — insurance proration credit (if any)
//   5. Repairs & maintenance               — CAM / maintenance credit (if any)
//   6. Equity - [Investor Name]            — one line per investor (if any)
//   7. [Equity Account]                    — EMD funded outside LLC (if applicable)
//   8. [Property Name]                     — checking acct, cash out (ctc [+ em if inside LLC])
//
// Balance identity:
//   totalBasis = loan + exchange + rent + taxCr + insuranceCr + camCr + bankCashOut
//   where totalBasis = (pp - sellerCr) + closingCosts
//   Equity and EMD-outside-LLC lines are symmetric (debit = credit).

function buildJournal(f, buildingPct, landPct, investors = [], emdOutsideLLC = false, emdEquityAccount = '', propertyName = '') {
  const pp          = Number(f.purchase_price)        || 0
  const sellerCr    = Number(f.seller_closing_credit) || 0
  const closing     = Number(f.total_closing_costs)   || 0
  const loan        = Number(f.loan_amount)           || 0
  const ctc         = Number(f.cash_to_close)         || 0
  const em          = Number(f.earnest_money)         || 0
  const rent        = Number(f.prorated_rent)         || 0
  const taxCr       = Number(f.tax_credits)           || 0
  const insuranceCr = Number(f.insurance_credit)      || 0
  const camCr       = Number(f.cam_credit)            || 0
  const exchange    = Number(f.exchange_proceeds)     || 0
  const lender      = (f.lender_name || '').trim()

  // Account name: CRM property name takes priority over PDF-extracted address
  const addr = propertyName || (f.property_address || '').trim() || 'Property'

  // Net purchase price = total consideration − seller closing credit
  const netPP          = pp - sellerCr
  const totalCostBasis = netPP + closing

  const bPct = Math.max(0, Math.min(100, Number(buildingPct) || 90)) / 100
  const lPct = Math.max(0, Math.min(100, Number(landPct)     || 10)) / 100

  const buildingValue = totalCostBasis * bPct
  const landValue     = totalCostBasis * lPct

  const activeInvestors = (investors || []).filter(inv => Number(inv.contribution) > 0)
  const totalEquity = activeInvestors.reduce((s, inv) => s + Number(inv.contribution), 0)

  const mortgageAccount = lender ? `MTG ${lender}` : `MTG ${addr}`

  // EMD: if funded outside the LLC, it was personal money — show as DEBIT Building + CREDIT equity
  // If inside LLC, it was a normal cash outflow — include in the bank cash credit
  const emdEquity   = emdOutsideLLC ? em  : 0
  const bankCashOut = emdOutsideLLC ? ctc : (ctc + em)
  const equityAcct  = (emdEquityAccount || '').trim() || 'Equity - Contributor'

  // DEBITS
  const debits = [
    buildingValue > 0 && { account: addr,  amount: buildingValue, note: 'Building Asset' },
    landValue > 0     && { account: 'Land', amount: landValue },
    emdEquity > 0     && { account: addr,  amount: emdEquity,    note: 'EMD (funded outside LLC)' },
    totalEquity > 0   && { account: addr,  amount: totalEquity,  note: 'Checking — Equity Received' },
  ].filter(Boolean)

  // CREDITS
  const credits = [
    loan > 0         && { account: mortgageAccount,                   amount: loan },
    exchange > 0     && { account: '1031 Exchange Proceeds',          amount: exchange },
    rent > 0         && { account: 'Rental Income',                   amount: rent },
    taxCr > 0        && { account: 'Taxes & licenses:Property taxes', amount: taxCr },
    insuranceCr > 0  && { account: 'Insurance',                       amount: insuranceCr },
    camCr > 0        && { account: 'Repairs & maintenance',           amount: camCr },
    ...activeInvestors.map(inv => ({ account: `Equity - ${inv.name}`, amount: Number(inv.contribution) })),
    emdEquity > 0    && { account: equityAcct,                        amount: emdEquity },
    bankCashOut > 0  && { account: addr,                              amount: bankCashOut, note: 'Checking — Cash to Close' },
  ].filter(Boolean)

  const totalDebits  = debits.reduce((s, d) => s + d.amount, 0)
  const totalCredits = credits.reduce((s, c) => s + c.amount, 0)
  const diff = totalDebits - totalCredits

  return { debits, credits, totalDebits, totalCredits, diff, totalCostBasis, netPP, buildingValue, landValue }
}

// ── Clipboard copy (QuickBooks-pasteable table) ───────────────────────────────

function buildClipboardText(journal, fields, date, propertyName = '') {
  const addr = propertyName || (fields.property_address || '').trim()
  const COL  = 50
  const NUM  = 16
  const fmt  = n => (n != null ? '$' + Math.round(n).toLocaleString() : '')

  const rows = [
    ...journal.debits.map(d  => ({ account: d.account, debit: d.amount, credit: null })),
    ...journal.credits.map(c => ({ account: c.account, debit: null,     credit: c.amount })),
  ]

  return [
    'ACQUISITION JOURNAL ENTRY',
    date  ? `Date: ${date}`        : null,
    addr  ? `Property: ${addr}`    : null,
    '',
    `${'Account Name'.padEnd(COL)} ${'Debit'.padStart(NUM)} ${'Credit'.padStart(NUM)}`,
    '-'.repeat(COL + NUM * 2 + 2),
    ...rows.map(r =>
      `${r.account.padEnd(COL)} ${(r.debit  != null ? fmt(r.debit)  : '').padStart(NUM)} ${(r.credit != null ? fmt(r.credit) : '').padStart(NUM)}`
    ),
    '-'.repeat(COL + NUM * 2 + 2),
    `${'TOTALS'.padEnd(COL)} ${fmt(journal.totalDebits).padStart(NUM)} ${fmt(journal.totalCredits).padStart(NUM)}`,
    '',
    Math.abs(journal.diff) < 1
      ? 'Balanced: Yes'
      : `Difference: ${fmt(Math.abs(journal.diff))} (${journal.diff > 0 ? 'debits exceed credits' : 'credits exceed debits'})`,
  ].filter(l => l !== null).join('\n')
}

// ── Uncertain items — category map + helpers ──────────────────────────────────

const FIELD_MAP = {
  'Loan Amount':       'loan_amount',
  '1031 Exchange':     'exchange_proceeds',
  'Cash to Close':     'cash_to_close',
  'Earnest Money':     'earnest_money',
  'Seller Credit':     'seller_closing_credit',
  'Prorated Rent':     'prorated_rent',
  'Tax Proration':     'tax_credits',
  'Insurance Credit':  'insurance_credit',
  'CAM Credit':        'cam_credit',
  'Ignore':            null,
}

/** Returns true if the item description looks like a broker/agent commission. */
function isBrokerFee(description) {
  if (!description) return false
  const d = description.toLowerCase()
  return d.includes('commission') || d.includes('broker') || d.includes('realty') || d.includes('agent fee')
}

/** Map AI suggestion text to one of the FIELD_MAP keys. */
function guessCategory(suggestion, description) {
  if (isBrokerFee(description)) return 'Ignore'
  if (!suggestion) return 'Ignore'
  const s = suggestion.toLowerCase()
  if (s.includes('1031') || s.includes('exchange') || s.includes('intermediary') || s.includes('qi deposit')) return '1031 Exchange'
  if (s.includes('loan') || s.includes('mortgage') || s.includes('principal')) return 'Loan Amount'
  if (s.includes('cash') && (s.includes('close') || s.includes('closing')))    return 'Cash to Close'
  if (s.includes('earnest'))                                                     return 'Earnest Money'
  if (s.includes('seller') && s.includes('credit'))                            return 'Seller Credit'
  if (s.includes('rent'))                                                        return 'Prorated Rent'
  if (s.includes('tax') || s.includes('proration'))                            return 'Tax Proration'
  if (s.includes('insurance'))                                                   return 'Insurance Credit'
  if (s.includes('cam') || s.includes('maintenance'))                          return 'CAM Credit'
  return 'Ignore'
}

/** A single uncertain-item row. */
function UncertainItem({ item, onAssign }) {
  const [selection, setSelection] = useState(() => guessCategory(item.suggestion, item.description))
  const brokerFee = isBrokerFee(item.description)

  return (
    <div className="bg-white border border-amber-100 rounded-lg px-3 py-2.5">
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-baseline gap-2 flex-wrap">
            <span className="text-sm font-medium text-slate-800">{item.description}</span>
            <span className="text-sm font-bold text-slate-900 tabular-nums">{$fmt(item.amount)}</span>
          </div>
          {item.suggestion && (
            <p className="text-xs text-amber-700 mt-0.5">
              AI guess: <span className="font-medium">{item.suggestion}</span>
            </p>
          )}
          {item.reason && (
            <p className="text-xs text-slate-400 mt-0.5 italic">{item.reason}</p>
          )}
        </div>
        <div className="flex flex-col items-end gap-1.5 shrink-0 mt-0.5">
          <div className="flex items-center gap-2">
            <select
              value={selection}
              onChange={e => setSelection(e.target.value)}
              className="text-xs border border-slate-200 rounded px-2 py-1 outline-none focus:ring-2 focus:ring-amber-300 bg-white text-slate-700"
            >
              {Object.keys(FIELD_MAP).map(cat => (
                <option key={cat} value={cat}>{cat}</option>
              ))}
            </select>
            <button
              onClick={() => onAssign(selection, item.amount)}
              className="text-xs px-3 py-1 bg-amber-500 text-white rounded-lg hover:bg-amber-600 active:bg-amber-700 font-semibold transition-colors whitespace-nowrap"
            >
              Assign
            </button>
          </div>
          {brokerFee && (
            <p className="text-xs text-slate-500 max-w-xs text-right">
              <span className="font-medium text-slate-600">Note:</span>{' '}
              If you are the buyer this is typically a seller expense and can be ignored.
            </p>
          )}
        </div>
      </div>
    </div>
  )
}

/** Yellow review panel for uncertain items. */
function UncertainItemsPanel({ items, onAssign }) {
  if (!items || items.length === 0) return null
  return (
    <div className="px-4 py-3 bg-amber-50 border border-amber-200 rounded-xl space-y-2">
      <div className="flex items-start gap-2 mb-1">
        <AlertTriangle className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" />
        <div>
          <span className="text-sm font-semibold text-amber-800">
            {items.length} item{items.length !== 1 ? 's' : ''} flagged for review
          </span>
          <p className="text-xs text-amber-700 mt-0.5">
            Assign each item to a field, or ignore if it's a seller expense or already included in your totals.
          </p>
        </div>
      </div>
      {items.map((item, idx) => (
        <UncertainItem
          key={`${item.description}-${item.amount}-${idx}`}
          item={item}
          onAssign={(category, amount) => onAssign(idx, category, amount)}
        />
      ))}
    </div>
  )
}

// ── Field components ──────────────────────────────────────────────────────────

function Field({ label, value, onChange, hint }) {
  return (
    <div className="flex items-center justify-between py-1.5 border-b border-slate-100 last:border-0">
      <div className="shrink-0 mr-3">
        <span className="text-xs text-slate-500">{label}</span>
        {hint && <p className="text-[10px] text-slate-400">{hint}</p>}
      </div>
      <div className="flex items-center gap-1">
        <span className="text-xs text-slate-400">$</span>
        <input
          type="number" min="0"
          value={value ?? ''}
          onChange={e => onChange(e.target.value === '' ? null : Number(e.target.value))}
          className="w-32 text-right text-sm font-medium text-slate-900 border border-slate-200 rounded px-2 py-0.5 outline-none focus:ring-2 focus:ring-blue-300 tabular-nums"
          placeholder="—"
        />
      </div>
    </div>
  )
}

function TextField({ label, value, onChange, hint }) {
  return (
    <div className="flex items-center justify-between py-1.5 border-b border-slate-100 last:border-0">
      <div className="shrink-0 mr-3">
        <span className="text-xs text-slate-500">{label}</span>
        {hint && <p className="text-[10px] text-slate-400">{hint}</p>}
      </div>
      <input
        type="text"
        value={value ?? ''}
        onChange={e => onChange(e.target.value || null)}
        className="w-40 text-right text-sm font-medium text-slate-900 border border-slate-200 rounded px-2 py-0.5 outline-none focus:ring-2 focus:ring-blue-300"
        placeholder="—"
      />
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

export default function SettlementUpload({ propertyId, property, onSaved, onClose }) {
  const inputRef = useRef()
  const [step, setStep]               = useState('upload')
  const [error, setError]             = useState(null)
  const [fields, setFields]           = useState(null)
  const [buildingPct, setBuildingPct] = useState(90)
  const [landPct, setLandPct]         = useState(10)
  const [copied, setCopied]           = useState(false)
  const [dragOver, setDragOver]       = useState(false)
  const [investors, setInvestors]     = useState([])
  const [uncertainItems, setUncertainItems] = useState([])
  const [emdOutsideLLC, setEmdOutsideLLC]   = useState(false)
  const [emdEquityAccount, setEmdEquityAccount] = useState('')

  // CRM property name used as QuickBooks account name
  const propertyName = property?.address || ''

  const setField = useCallback((key, val) => setFields(prev => ({ ...prev, [key]: val })), [])

  function assignUncertainItem(idx, category, amount) {
    const fieldKey = FIELD_MAP[category]
    if (fieldKey) {
      setFields(prev => ({ ...prev, [fieldKey]: (Number(prev[fieldKey]) || 0) + amount }))
    }
    setUncertainItems(prev => prev.filter((_, i) => i !== idx))
  }

  useEffect(() => {
    getInvestors(propertyId)
      .then(data => setInvestors(Array.isArray(data) ? data : []))
      .catch(() => setInvestors([]))
  }, [propertyId])

  async function handleFile(file) {
    if (!file) return
    setStep('parsing')
    setError(null)
    try {
      const data = await uploadSettlement(propertyId, file)
      setFields({ ...data, depreciation_expense: 0 })
      setUncertainItems(Array.isArray(data.uncertain_items) ? data.uncertain_items : [])
      setStep('review')
    } catch (err) {
      setError(err.message)
      setStep('upload')
    }
  }

  const sellerCr       = fields ? (Number(fields.seller_closing_credit) || 0) : 0
  const pp             = fields ? (Number(fields.purchase_price)        || 0) : 0
  const netPurchasePrice = pp - sellerCr
  const totalCostBasis   = fields
    ? netPurchasePrice + (Number(fields.total_closing_costs) || 0)
    : 0

  const journal = fields
    ? buildJournal(fields, buildingPct, landPct, investors, emdOutsideLLC, emdEquityAccount, propertyName)
    : null

  async function handleSave() {
    if (!fields) return
    setStep('saving')
    setError(null)
    try {
      const date    = fields.settlement_date || new Date().toISOString().slice(0, 10)
      const cb      = totalCostBasis
      const bPct    = (Number(buildingPct) || 90) / 100
      const lPct    = (Number(landPct)     || 10) / 100

      const txs = [
        cb > 0                           && { description: 'Building Value',               category: 'Purchase', amount: -(cb * bPct) },
        cb > 0                           && { description: 'Land Value',                   category: 'Purchase', amount: -(cb * lPct) },
        fields.loan_amount               && { description: 'Loan Proceeds',                category: 'Loan',     amount:  Number(fields.loan_amount) },
        fields.earnest_money             && { description: 'Earnest Money Deposit',        category: 'Purchase', amount: -Number(fields.earnest_money) },
        fields.cash_to_close             && { description: 'Cash to Close',                category: 'Purchase', amount: -Number(fields.cash_to_close) },
        fields.loan_origination_fee      && { description: 'Loan Origination Fee',         category: 'Purchase', amount: -Number(fields.loan_origination_fee) },
        fields.appraisal_fee             && { description: 'Appraisal Fee',                category: 'Purchase', amount: -Number(fields.appraisal_fee) },
        fields.title_and_closing_fees    && { description: 'Title and Closing Fees',       category: 'Purchase', amount: -Number(fields.title_and_closing_fees) },
        fields.endorsements_fee          && { description: 'Title Endorsements',           category: 'Purchase', amount: -Number(fields.endorsements_fee) },
        fields.recording_fees            && { description: 'Recording Fees',               category: 'Purchase', amount: -Number(fields.recording_fees) },
        fields.survey_fee                && { description: 'Survey Fee',                   category: 'Purchase', amount: -Number(fields.survey_fee) },
        fields.environmental_fees        && { description: 'Environmental / Phase I Fees', category: 'Purchase', amount: -Number(fields.environmental_fees) },
        fields.flood_determination_fee   && { description: 'Flood Determination Fee',      category: 'Purchase', amount: -Number(fields.flood_determination_fee) },
        fields.acquisition_fee           && { description: 'Knox Capital Acquisition Fee', category: 'Purchase', amount: -Number(fields.acquisition_fee) },
        fields.buyer_taxes_paid          && { description: 'Property Taxes Paid at Closing', category: 'Purchase', amount: -Number(fields.buyer_taxes_paid) },
        fields.prorated_rent             && { description: 'Prorated Rent Credit',         category: 'Rent',     amount:  Number(fields.prorated_rent) },
        fields.tax_credits               && { description: 'Property Tax Proration',       category: 'Other',    amount:  Number(fields.tax_credits) },
        fields.insurance_credit          && { description: 'Insurance Proration Credit',   category: 'Other',    amount:  Number(fields.insurance_credit) },
        fields.cam_credit                && { description: 'CAM / Maintenance Credit',     category: 'Other',    amount:  Number(fields.cam_credit) },
        fields.exchange_proceeds         && { description: '1031 Exchange Proceeds',       category: 'Loan',     amount:  Number(fields.exchange_proceeds) },
      ].filter(Boolean).map(t => ({ ...t, date, source: 'Settlement Statement' }))

      if (txs.length > 0) await createTransactions(propertyId, txs)

      await saveJournalEntry(propertyId, {
        entry_type: 'acquisition',
        entry_date: date,
        label:      propertyName || fields.property_address || 'Acquisition',
        content:    buildClipboardText(journal, fields, date, propertyName),
      })

      onSaved()
      onClose()
    } catch (err) {
      setError(err.message)
      setStep('review')
    }
  }

  function handleCopy() {
    if (!journal || !fields) return
    navigator.clipboard.writeText(buildClipboardText(journal, fields, fields.settlement_date, propertyName)).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-5xl max-h-[92vh] flex flex-col">

        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 shrink-0">
          <div>
            <h2 className="text-base font-semibold text-slate-900">Settlement Statement</h2>
            <p className="text-xs text-slate-500 mt-0.5">
              {step === 'upload'  && 'Upload a PDF — supports First American Title and HUD-1 formats'}
              {step === 'parsing' && 'AI is reading your settlement statement…'}
              {step === 'review'  && 'Review extracted fields and journal entry before saving'}
              {step === 'saving'  && 'Saving to ledger…'}
            </p>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-6 py-5">
          {error && (
            <div className="mb-4 flex items-start gap-2 px-4 py-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
              <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
              {error}
            </div>
          )}

          {/* ── Upload / Parsing ── */}
          {(step === 'upload' || step === 'parsing') && (
            <div
              className={`border-2 border-dashed rounded-xl p-12 text-center transition-all ${
                step === 'parsing'
                  ? 'border-blue-300 bg-blue-50/50 cursor-default'
                  : dragOver
                    ? 'border-blue-400 bg-blue-50 cursor-copy'
                    : 'border-slate-300 hover:border-blue-300 hover:bg-blue-50/40 cursor-pointer'
              }`}
              onClick={() => step === 'upload' && inputRef.current?.click()}
              onDragOver={e => { e.preventDefault(); if (step === 'upload') setDragOver(true) }}
              onDragLeave={e => { e.preventDefault(); setDragOver(false) }}
              onDrop={e => {
                e.preventDefault(); setDragOver(false)
                if (step !== 'upload') return
                const file = e.dataTransfer.files[0]
                if (file) handleFile(file)
              }}
            >
              <input ref={inputRef} type="file" accept=".pdf" className="hidden"
                onChange={e => handleFile(e.target.files[0])} />
              {step === 'parsing' ? (
                <>
                  <Loader2 className="w-10 h-10 mx-auto mb-3 text-blue-400 animate-spin" />
                  <p className="text-sm font-medium text-slate-700">Reading settlement statement…</p>
                  <p className="text-xs text-slate-400 mt-1">This may take a few seconds</p>
                </>
              ) : (
                <>
                  <Upload className={`w-10 h-10 mx-auto mb-3 ${dragOver ? 'text-blue-400' : 'text-slate-300'}`} />
                  <p className="text-sm font-medium text-slate-700">{dragOver ? 'Release to upload' : 'Drop PDF or click to browse'}</p>
                  <p className="text-xs text-slate-400 mt-1">First American Title or HUD-1 format</p>
                </>
              )}
            </div>
          )}

          {/* ── Review ── */}
          {(step === 'review' || step === 'saving') && fields && (
            <div className="space-y-5">

              {/* Property / date banner */}
              {(propertyName || fields.property_address || fields.settlement_date) && (
                <div className="px-4 py-3 bg-slate-50 rounded-lg text-sm text-slate-600">
                  {(propertyName || fields.property_address) && (
                    <span className="font-medium text-slate-800">{propertyName || fields.property_address}</span>
                  )}
                  {fields.settlement_date && (
                    <span className="ml-3 text-slate-400">
                      · Closed {new Date(fields.settlement_date + 'T00:00:00').toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' })}
                    </span>
                  )}
                </div>
              )}

              {/* Uncertain items review panel */}
              <UncertainItemsPanel items={uncertainItems} onAssign={assignUncertainItem} />

              <div className="grid grid-cols-2 gap-6">

                {/* ── LEFT: Extracted Fields ── */}
                <div className="space-y-4">

                  {/* Purchase price & basis */}
                  <div>
                    <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">Purchase & Cost Basis</h3>
                    <div className="bg-slate-50 rounded-xl px-4 py-2">
                      <Field label="Total Consideration" value={fields.purchase_price} onChange={v => setField('purchase_price', v)} />
                      <Field label="Seller Closing Credit" value={fields.seller_closing_credit} onChange={v => setField('seller_closing_credit', v)} hint="reduces net purchase price" />
                      {/* Net purchase price — computed */}
                      <div className="flex items-center justify-between py-1.5 border-b border-slate-100">
                        <span className="text-xs text-slate-500">Net Purchase Price</span>
                        <span className="text-sm font-medium text-slate-700 tabular-nums">{$fmt(netPurchasePrice)}</span>
                      </div>
                      <Field label="Total Closing Costs" value={fields.total_closing_costs} onChange={v => setField('total_closing_costs', v)} />
                      {/* Total Cost Basis — computed */}
                      <div className="flex items-center justify-between py-2 border-t-2 border-slate-200 mt-0.5">
                        <span className="text-xs font-semibold text-slate-700">Total Cost Basis</span>
                        <span className="text-sm font-bold text-slate-900 tabular-nums">{$fmt(totalCostBasis)}</span>
                      </div>
                    </div>
                  </div>

                  {/* Financing & cash */}
                  <div>
                    <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">Financing & Cash</h3>
                    <div className="bg-slate-50 rounded-xl px-4 py-2">
                      <TextField label="Lender Name" value={fields.lender_name} onChange={v => setField('lender_name', v)} hint="QB liability account" />
                      <Field label="Loan Amount" value={fields.loan_amount} onChange={v => setField('loan_amount', v)} />
                      <Field label="Cash to Close" value={fields.cash_to_close} onChange={v => setField('cash_to_close', v)} />
                      <Field label="Earnest Money Deposit" value={fields.earnest_money} onChange={v => setField('earnest_money', v)} />
                    </div>
                  </div>

                  {/* EMD source */}
                  <div>
                    <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">EMD Source</h3>
                    <div className="bg-slate-50 rounded-xl px-4 py-3 space-y-2">
                      <label className="flex items-center gap-2.5 cursor-pointer select-none">
                        <div
                          onClick={() => setEmdOutsideLLC(v => !v)}
                          className={`w-9 h-5 rounded-full transition-colors shrink-0 ${emdOutsideLLC ? 'bg-blue-500' : 'bg-slate-300'}`}
                        >
                          <div className={`w-4 h-4 bg-white rounded-full shadow mt-0.5 transition-transform ${emdOutsideLLC ? 'translate-x-4.5' : 'translate-x-0.5'}`} />
                        </div>
                        <span className="text-xs text-slate-700">EMD was funded outside the LLC</span>
                      </label>
                      {emdOutsideLLC && (
                        <div className="pt-1">
                          <p className="text-[10px] text-slate-500 mb-1.5">
                            Adds DEBIT Building + CREDIT equity for the EMD amount — removes EMD from bank cash credit.
                          </p>
                          <div className="flex items-center justify-between">
                            <span className="text-xs text-slate-500 shrink-0 mr-3">Equity Account</span>
                            <input
                              type="text"
                              value={emdEquityAccount}
                              onChange={e => setEmdEquityAccount(e.target.value)}
                              placeholder="e.g. Equity - Brad Cottam"
                              className="flex-1 text-right text-xs border border-slate-200 rounded px-2 py-1 outline-none focus:ring-2 focus:ring-blue-300"
                            />
                          </div>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Credits from seller */}
                  <div>
                    <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">Prorations & Credits</h3>
                    <div className="bg-slate-50 rounded-xl px-4 py-2">
                      <Field label="1031 Exchange Proceeds" value={fields.exchange_proceeds} onChange={v => setField('exchange_proceeds', v)} hint="QI deposit applied to purchase" />
                      <Field label="Tax Proration Credit" value={fields.tax_credits} onChange={v => setField('tax_credits', v)} />
                      <Field label="Prorated Rent Credit" value={fields.prorated_rent} onChange={v => setField('prorated_rent', v)} />
                      <Field label="Insurance Credit" value={fields.insurance_credit} onChange={v => setField('insurance_credit', v)} />
                      <Field label="CAM / Maintenance Credit" value={fields.cam_credit} onChange={v => setField('cam_credit', v)} />
                    </div>
                  </div>

                  {/* Building / Land Split */}
                  <div>
                    <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">Building / Land Split</h3>
                    <div className="bg-slate-50 rounded-xl px-4 py-2">
                      <div className="flex items-center justify-between py-1.5 border-b border-slate-100">
                        <span className="text-xs text-slate-500">Building %</span>
                        <div className="flex items-center gap-2">
                          <input
                            type="number" min="0" max="100"
                            value={buildingPct}
                            onChange={e => { const v = Math.max(0, Math.min(100, Number(e.target.value))); setBuildingPct(v); setLandPct(100 - v) }}
                            className="w-16 text-right text-sm font-medium border border-slate-200 rounded px-2 py-0.5 outline-none focus:ring-2 focus:ring-blue-300"
                          />
                          <span className="text-xs text-slate-400">%</span>
                          <span className="text-xs font-medium text-slate-600 tabular-nums w-24 text-right">{$fmt(totalCostBasis * buildingPct / 100)}</span>
                        </div>
                      </div>
                      <div className="flex items-center justify-between py-1.5">
                        <span className="text-xs text-slate-500">Land %</span>
                        <div className="flex items-center gap-2">
                          <input
                            type="number" min="0" max="100"
                            value={landPct}
                            onChange={e => { const v = Math.max(0, Math.min(100, Number(e.target.value))); setLandPct(v); setBuildingPct(100 - v) }}
                            className="w-16 text-right text-sm font-medium border border-slate-200 rounded px-2 py-0.5 outline-none focus:ring-2 focus:ring-blue-300"
                          />
                          <span className="text-xs text-slate-400">%</span>
                          <span className="text-xs font-medium text-slate-600 tabular-nums w-24 text-right">{$fmt(totalCostBasis * landPct / 100)}</span>
                        </div>
                      </div>
                      {(buildingPct + landPct) !== 100 && (
                        <p className="text-xs text-amber-600 pt-1.5 border-t border-slate-100 mt-0.5">
                          ⚠ Percentages must add to 100%
                        </p>
                      )}
                    </div>
                  </div>

                  {/* Investors indicator */}
                  {investors.length > 0 ? (
                    <div className="flex items-center gap-2 px-3 py-2 bg-emerald-50 border border-emerald-200 rounded-lg text-xs text-emerald-700">
                      <Users className="w-3.5 h-3.5 shrink-0" />
                      <span>
                        <span className="font-semibold">{investors.length} investor{investors.length !== 1 ? 's' : ''} loaded</span>
                        {' — equity lines included in journal entry'}
                      </span>
                    </div>
                  ) : (
                    <div className="flex items-center gap-2 px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-xs text-slate-400">
                      <Users className="w-3.5 h-3.5 shrink-0" />
                      <span>No investors uploaded — equity lines will be omitted</span>
                    </div>
                  )}
                </div>

                {/* ── RIGHT: Journal Entry ── */}
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wide">QuickBooks Journal Entry</h3>
                    <button
                      onClick={handleCopy}
                      className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border border-slate-200 hover:bg-slate-50 text-slate-600 transition-colors"
                    >
                      {copied ? <Check className="w-3.5 h-3.5 text-emerald-500" /> : <Copy className="w-3.5 h-3.5" />}
                      {copied ? 'Copied!' : 'Copy'}
                    </button>
                  </div>

                  {journal && (
                    <div className="border border-slate-200 rounded-xl overflow-hidden text-xs">
                      <table className="w-full border-collapse">
                        <thead>
                          <tr className="bg-slate-50 border-b border-slate-200">
                            <th className="text-left px-3 py-2 font-semibold text-slate-500 uppercase tracking-wide">Account Name</th>
                            <th className="text-right px-3 py-2 font-semibold text-slate-500 uppercase tracking-wide w-24">Debit</th>
                            <th className="text-right px-3 py-2 font-semibold text-slate-500 uppercase tracking-wide w-24">Credit</th>
                          </tr>
                        </thead>
                        <tbody>
                          {journal.debits.map((d, i) => (
                            <tr key={`d${i}`} className="border-b border-slate-100">
                              <td className="px-3 py-1.5">
                                <span className="text-slate-800 font-medium">{d.account}</span>
                                {d.note && <span className="ml-1.5 text-slate-400 text-[10px] font-normal">({d.note})</span>}
                              </td>
                              <td className="px-3 py-1.5 text-right text-slate-900 font-medium tabular-nums">{$fmt(d.amount)}</td>
                              <td className="px-3 py-1.5 text-right text-slate-300">—</td>
                            </tr>
                          ))}
                          {journal.credits.map((c, i) => (
                            <tr key={`c${i}`} className="border-b border-slate-100 bg-slate-50/50">
                              <td className="px-3 py-1.5 pl-5">
                                <span className="text-slate-700">{c.account}</span>
                                {c.note && <span className="ml-1.5 text-slate-400 text-[10px]">({c.note})</span>}
                              </td>
                              <td className="px-3 py-1.5 text-right text-slate-300">—</td>
                              <td className="px-3 py-1.5 text-right text-slate-900 font-medium tabular-nums">{$fmt(c.amount)}</td>
                            </tr>
                          ))}
                        </tbody>
                        <tfoot>
                          <tr className="border-t-2 border-slate-300 bg-slate-50">
                            <td className="px-3 py-2 font-semibold text-slate-700 text-xs">Totals</td>
                            <td className="px-3 py-2 text-right font-bold text-slate-900 tabular-nums">{$fmt(journal.totalDebits)}</td>
                            <td className="px-3 py-2 text-right font-bold text-slate-900 tabular-nums">{$fmt(journal.totalCredits)}</td>
                          </tr>
                          <tr>
                            <td colSpan={3} className={`px-3 py-2 text-center text-xs font-semibold ${Math.abs(journal.diff) < 1 ? 'text-emerald-600 bg-emerald-50' : 'text-red-600 bg-red-50'}`}>
                              {Math.abs(journal.diff) < 1
                                ? '✓ Balanced'
                                : journal.diff > 0
                                  ? `⚠ Debits exceed credits by ${$fmt(journal.diff)} — check a credit field`
                                  : `⚠ Credits exceed debits by ${$fmt(Math.abs(journal.diff))} — check a debit field`
                              }
                            </td>
                          </tr>
                        </tfoot>
                      </table>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="shrink-0 flex items-center justify-between px-6 py-4 border-t border-slate-100 bg-slate-50 rounded-b-2xl">
          <button onClick={onClose} className="text-sm text-slate-400 hover:text-slate-600">Cancel</button>
          {(step === 'review' || step === 'saving') && (
            <Button onClick={handleSave} disabled={!fields || step === 'saving'}>
              {step === 'saving' ? (
                <><Loader2 className="w-4 h-4 animate-spin" /> Saving…</>
              ) : (
                <><CheckCircle className="w-4 h-4" /> Save to Ledger</>
              )}
            </Button>
          )}
        </div>
      </div>
    </div>
  )
}
