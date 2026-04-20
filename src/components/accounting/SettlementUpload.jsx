import { useState, useEffect, useRef, useCallback } from 'react'
import { X, Upload, Loader2, CheckCircle, AlertCircle, Copy, Check, Users } from 'lucide-react'
import Button from '../ui/Button'
import { uploadSettlement, createTransactions, saveJournalEntry, getInvestors } from '../../api/client'

// ── Formatters ────────────────────────────────────────────────────────────────

const $fmt = v =>
  v != null && v !== '' && isFinite(Number(v)) && Number(v) !== 0
    ? '$' + Math.abs(Math.round(Number(v))).toLocaleString()
    : '—'

// ── Journal entry builder ─────────────────────────────────────────────────────
//
// Structure (accountant's QuickBooks format):
//
// DEBITS
//   1. [Property Address]         — building asset  (totalCostBasis × buildingPct%)
//   2. Land                       —                  (totalCostBasis × landPct%)
//   3. Depreciation Expense       — only if non-zero
//   4. [Property Address]         — checking acct, equity received (sum of investor contributions)
//
// CREDITS
//   1. Rent Income                — prorated rent from settlement (if any)
//   2. MTG [Lender] [Address]     — loan amount
//   3. Accum Depreciation         — only if depreciation expense is non-zero
//   4. Equity - [Investor Name]   — one line per investor (if investors exist)
//   5. Tax / Proration Credits    — seller tax proration credit to buyer (if any)
//   6. [Property Address]         — checking acct, cash to close + earnest money combined
//
// Balance identity (settlement statement):
//   totalCostBasis = loan + rent + taxCr + (ctc + em)
//   → pp + closing = loan + rent + taxCr + ctc + em
//   Depreciation and equity are symmetric (debit = credit) so they cancel.

function buildJournal(f, buildingPct, landPct, investors = []) {
  const pp      = Number(f.purchase_price)      || 0
  const closing = Number(f.total_closing_costs) || 0
  const loan    = Number(f.loan_amount)          || 0
  const ctc     = Number(f.cash_to_close)        || 0
  const em      = Number(f.earnest_money)        || 0
  const rent    = Number(f.prorated_rent)        || 0
  const taxCr   = Number(f.tax_credits)          || 0
  const depr    = Number(f.depreciation_expense) || 0
  const addr    = (f.property_address  || '').trim() || 'Property'
  const lender  = (f.lender_name      || '').trim()

  const totalCostBasis = pp + closing
  const bPct = Math.max(0, Math.min(100, Number(buildingPct) || 75)) / 100
  const lPct = Math.max(0, Math.min(100, Number(landPct)     || 25)) / 100

  const buildingValue = totalCostBasis * bPct
  const landValue     = totalCostBasis * lPct

  const activeInvestors = (investors || []).filter(inv => Number(inv.contribution) > 0)
  const totalEquity = activeInvestors.reduce((s, inv) => s + Number(inv.contribution), 0)

  const mortgageAccount = lender ? `MTG ${lender} ${addr}` : `MTG ${addr}`

  // Cash to close + earnest money = total cash out by buyer (em was paid pre-closing)
  const cashAndEM = ctc + em

  // DEBITS — in spec order
  const debits = [
    buildingValue > 0 && { account: addr,                    amount: buildingValue, note: 'Building Asset' },
    landValue > 0     && { account: 'Land',                  amount: landValue },
    depr > 0          && { account: 'Depreciation Expense',  amount: depr },
    totalEquity > 0   && { account: addr,                    amount: totalEquity,   note: 'Checking — Equity Received' },
  ].filter(Boolean)

  // CREDITS — in spec order
  const credits = [
    rent > 0      && { account: 'Rent Income',            amount: rent },
    loan > 0      && { account: mortgageAccount,           amount: loan },
    depr > 0      && { account: 'Accum Depreciation',     amount: depr },
    ...activeInvestors.map(inv => ({ account: `Equity - ${inv.name}`, amount: Number(inv.contribution) })),
    taxCr > 0     && { account: 'Tax / Proration Credits', amount: taxCr },
    cashAndEM > 0 && { account: addr,                      amount: cashAndEM, note: 'Checking — Cash to Close' },
  ].filter(Boolean)

  const totalDebits  = debits.reduce((s, d) => s + d.amount, 0)
  const totalCredits = credits.reduce((s, c) => s + c.amount, 0)
  const diff = totalDebits - totalCredits

  return { debits, credits, totalDebits, totalCredits, diff, totalCostBasis, buildingValue, landValue }
}

// ── Clipboard copy (QuickBooks-pasteable table) ───────────────────────────────

function buildClipboardText(journal, fields, date) {
  const addr = (fields.property_address || '').trim()
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

// ── Field components ──────────────────────────────────────────────────────────

function Field({ label, value, onChange }) {
  return (
    <div className="flex items-center justify-between py-1.5 border-b border-slate-100 last:border-0">
      <span className="text-xs text-slate-500 shrink-0 mr-3">{label}</span>
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

function TextField({ label, value, onChange }) {
  return (
    <div className="flex items-center justify-between py-1.5 border-b border-slate-100 last:border-0">
      <span className="text-xs text-slate-500 shrink-0 mr-3">{label}</span>
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

export default function SettlementUpload({ propertyId, onSaved, onClose }) {
  const inputRef = useRef()
  const [step, setStep]               = useState('upload')
  const [error, setError]             = useState(null)
  const [fields, setFields]           = useState(null)
  const [buildingPct, setBuildingPct] = useState(75)
  const [landPct, setLandPct]         = useState(25)
  const [copied, setCopied]           = useState(false)
  const [dragOver, setDragOver]       = useState(false)
  const [investors, setInvestors]     = useState([])

  const setField = useCallback((key, val) => setFields(prev => ({ ...prev, [key]: val })), [])

  // Load investors so equity lines appear automatically when they've been uploaded
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
      // Seed depreciation_expense = 0 (almost always zero at closing; user can edit)
      setFields({ ...data, depreciation_expense: 0 })
      setStep('review')
    } catch (err) {
      setError(err.message)
      setStep('upload')
    }
  }

  // Compute totalCostBasis for the left panel display
  const totalCostBasis = fields
    ? (Number(fields.purchase_price) || 0) + (Number(fields.total_closing_costs) || 0)
    : 0

  const journal = fields ? buildJournal(fields, buildingPct, landPct, investors) : null

  async function handleSave() {
    if (!fields) return
    setStep('saving')
    setError(null)
    try {
      const date    = fields.settlement_date || new Date().toISOString().slice(0, 10)
      const pp      = Number(fields.purchase_price)      || 0
      const closing = Number(fields.total_closing_costs) || 0
      const cb      = pp + closing   // total cost basis
      const bPct    = (Number(buildingPct) || 75) / 100
      const lPct    = (Number(landPct)     || 25) / 100

      // Ledger transactions — building/land now split from total cost basis
      const txs = [
        cb > 0                        && { description: 'Building Value',               category: 'Purchase', amount: -(cb * bPct) },
        cb > 0                        && { description: 'Land Value',                   category: 'Purchase', amount: -(cb * lPct) },
        fields.loan_amount            && { description: 'Loan Proceeds',                category: 'Loan',     amount:  Number(fields.loan_amount) },
        fields.earnest_money          && { description: 'Earnest Money Deposit',        category: 'Purchase', amount: -Number(fields.earnest_money) },
        fields.cash_to_close          && { description: 'Cash to Close',                category: 'Purchase', amount: -Number(fields.cash_to_close) },
        fields.loan_origination_fee   && { description: 'Loan Origination Fee',         category: 'Purchase', amount: -Number(fields.loan_origination_fee) },
        fields.appraisal_fee          && { description: 'Appraisal Fee',                category: 'Purchase', amount: -Number(fields.appraisal_fee) },
        fields.title_and_closing_fees && { description: 'Title and Closing Fees',       category: 'Purchase', amount: -Number(fields.title_and_closing_fees) },
        fields.recording_fees         && { description: 'Recording Fees',               category: 'Purchase', amount: -Number(fields.recording_fees) },
        fields.survey_fee             && { description: 'Survey Fee',                   category: 'Purchase', amount: -Number(fields.survey_fee) },
        fields.environmental_fees     && { description: 'Environmental / Phase I Fees', category: 'Purchase', amount: -Number(fields.environmental_fees) },
        fields.acquisition_fee        && { description: 'Knox Capital Acquisition Fee', category: 'Purchase', amount: -Number(fields.acquisition_fee) },
        fields.buyer_taxes_paid       && { description: 'Property Taxes Paid at Closing', category: 'Purchase', amount: -Number(fields.buyer_taxes_paid) },
        fields.prorated_rent          && { description: 'Prorated Rent Credit',         category: 'Rent',     amount:  Number(fields.prorated_rent) },
        fields.tax_credits            && { description: 'Property Tax Proration',       category: 'Other',    amount:  Number(fields.tax_credits) },
      ].filter(Boolean).map(t => ({ ...t, date, source: 'Settlement Statement' }))

      if (txs.length > 0) await createTransactions(propertyId, txs)

      // Save journal entry (formatted for QuickBooks paste)
      await saveJournalEntry(propertyId, {
        entry_type: 'acquisition',
        entry_date: date,
        label:      fields.property_address || 'Acquisition',
        content:    buildClipboardText(journal, fields, date),
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
    navigator.clipboard.writeText(buildClipboardText(journal, fields, fields.settlement_date)).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-4xl max-h-[92vh] flex flex-col">

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
              {(fields.property_address || fields.settlement_date) && (
                <div className="px-4 py-3 bg-slate-50 rounded-lg text-sm text-slate-600">
                  {fields.property_address && (
                    <span className="font-medium text-slate-800">{fields.property_address}</span>
                  )}
                  {fields.settlement_date && (
                    <span className="ml-3 text-slate-400">
                      · Closed {new Date(fields.settlement_date + 'T00:00:00').toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' })}
                    </span>
                  )}
                </div>
              )}

              <div className="grid grid-cols-2 gap-6">

                {/* ── LEFT: Extracted Fields ── */}
                <div className="space-y-4">
                  <div>
                    <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">Extracted Fields</h3>
                    <div className="bg-slate-50 rounded-xl px-4 py-2">
                      <Field
                        label="Purchase Price"
                        value={fields.purchase_price}
                        onChange={v => setField('purchase_price', v)}
                      />
                      <Field
                        label="Total Closing Costs"
                        value={fields.total_closing_costs}
                        onChange={v => setField('total_closing_costs', v)}
                      />
                      {/* Total Cost Basis — computed, read-only */}
                      <div className="flex items-center justify-between py-2 mt-1 border-t-2 border-slate-200">
                        <span className="text-xs font-semibold text-slate-700">Total Cost Basis</span>
                        <span className="text-sm font-bold text-slate-900 tabular-nums">{$fmt(totalCostBasis)}</span>
                      </div>

                      {/* Separator */}
                      <div className="border-t border-slate-100 mt-0.5 pt-1">
                        <Field
                          label="Loan Amount"
                          value={fields.loan_amount}
                          onChange={v => setField('loan_amount', v)}
                        />
                        <Field
                          label="Cash to Close"
                          value={fields.cash_to_close}
                          onChange={v => setField('cash_to_close', v)}
                        />
                        <Field
                          label="Earnest Money Deposit"
                          value={fields.earnest_money}
                          onChange={v => setField('earnest_money', v)}
                        />
                        <Field
                          label="Tax Proration Credit"
                          value={fields.tax_credits}
                          onChange={v => setField('tax_credits', v)}
                        />
                        <Field
                          label="Prorated Rent Credit"
                          value={fields.prorated_rent}
                          onChange={v => setField('prorated_rent', v)}
                        />
                        <TextField
                          label="Lender Name"
                          value={fields.lender_name}
                          onChange={v => setField('lender_name', v)}
                        />
                        <Field
                          label="Depreciation Expense"
                          value={fields.depreciation_expense}
                          onChange={v => setField('depreciation_expense', v)}
                        />
                      </div>
                    </div>
                  </div>

                  {/* Building / Land Split */}
                  <div>
                    <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">Building / Land Split</h3>
                    <div className="bg-slate-50 rounded-xl px-4 py-2">
                      {/* Building row */}
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
                          <span className="text-xs font-medium text-slate-600 tabular-nums w-24 text-right">
                            {$fmt(totalCostBasis * buildingPct / 100)}
                          </span>
                        </div>
                      </div>
                      {/* Land row */}
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
                          <span className="text-xs font-medium text-slate-600 tabular-nums w-24 text-right">
                            {$fmt(totalCostBasis * landPct / 100)}
                          </span>
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
                          {/* Debits */}
                          {journal.debits.map((d, i) => (
                            <tr key={`d${i}`} className="border-b border-slate-100">
                              <td className="px-3 py-1.5">
                                <span className="text-slate-800 font-medium">{d.account}</span>
                                {d.note && (
                                  <span className="ml-1.5 text-slate-400 text-[10px] font-normal">({d.note})</span>
                                )}
                              </td>
                              <td className="px-3 py-1.5 text-right text-slate-900 font-medium tabular-nums">{$fmt(d.amount)}</td>
                              <td className="px-3 py-1.5 text-right text-slate-300">—</td>
                            </tr>
                          ))}
                          {/* Credits */}
                          {journal.credits.map((c, i) => (
                            <tr key={`c${i}`} className="border-b border-slate-100 bg-slate-50/50">
                              <td className="px-3 py-1.5 pl-5">
                                <span className="text-slate-700">{c.account}</span>
                                {c.note && (
                                  <span className="ml-1.5 text-slate-400 text-[10px]">({c.note})</span>
                                )}
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
