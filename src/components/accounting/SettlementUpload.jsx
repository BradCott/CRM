import { useState, useRef, useCallback } from 'react'
import { X, Upload, Loader2, CheckCircle, AlertCircle, Copy, Check } from 'lucide-react'
import Button from '../ui/Button'
import { uploadSettlement, createTransactions, saveJournalEntry } from '../../api/client'

const CATEGORIES = ['Equity Contribution', 'Purchase', 'Rent', 'Mortgage', 'Repair', 'Sale', 'Other']

const $ = v => v != null ? '$' + Math.abs(Math.round(Number(v))).toLocaleString() : '—'
const fmtSigned = (v, pos = false) => {
  if (v == null || v === '') return '—'
  const n = Number(v)
  if (!isFinite(n) || n === 0) return '—'
  return (pos ? '+' : '-') + '$' + Math.abs(Math.round(n)).toLocaleString()
}

// Build QuickBooks journal entry lines from fields + split.
//
// This formula always balances by definition on any settlement statement:
//   DEBITS  = Purchase Price (Building + Land split) + Total Closing Costs (line 103)
//   CREDITS = Loan + Earnest Money + Buyer Credits (prorations) + Cash to Close
//
// Individual line items (survey, title, etc.) are shown in the fields panel
// for reference but are NOT used as separate journal entry debits — only the
// total_closing_costs figure (line 103 / total buyer charges) is used.
function buildJournal(f, buildingPct, landPct) {
  const pp      = Number(f.purchase_price)      || 0
  const loan    = Number(f.loan_amount)          || 0
  const ctc     = Number(f.cash_to_close)        || 0
  const em      = Number(f.earnest_money)        || 0
  const rent    = Number(f.prorated_rent)        || 0
  const taxCr   = Number(f.tax_credits)          || 0  // credits FROM seller TO buyer
  const closing = Number(f.total_closing_costs)  || 0  // line 103 / total buyer charges

  const bPct  = Math.max(0, Math.min(100, Number(buildingPct) || 75)) / 100
  const lPct  = Math.max(0, Math.min(100, Number(landPct)     || 25)) / 100

  const debits = [
    { account: 'Building',            amount: pp * bPct },
    { account: 'Land',                amount: pp * lPct },
    { account: 'Total Closing Costs', amount: closing   },
  ].filter(d => d.amount > 0)

  const credits = [
    { account: 'Mortgage Loan Payable',         amount: loan  },
    { account: 'Earnest Money Deposit Applied', amount: em    },
    { account: 'Tax / Proration Credits',       amount: taxCr },
    { account: 'Prorated Rent Credit',          amount: rent  },
    { account: 'Cash / Checking Account',       amount: ctc   },
  ].filter(c => c.amount > 0)

  const totalDebits  = debits.reduce((s, d) => s + d.amount, 0)
  const totalCredits = credits.reduce((s, c) => s + c.amount, 0)
  const diff = totalDebits - totalCredits

  return { debits, credits, totalDebits, totalCredits, diff }
}

function buildClipboardText(journal, fields, date) {
  const lines = [
    `ACQUISITION JOURNAL ENTRY`,
    date ? `Date: ${date}` : '',
    fields.property_address ? `Property: ${fields.property_address}` : '',
    '',
    'DEBITS',
    ...journal.debits.map(d  => `  ${d.account.padEnd(40)} $${Math.round(d.amount).toLocaleString()}`),
    '',
    'CREDITS',
    ...journal.credits.map(c => `  ${c.account.padEnd(40)} $${Math.round(c.amount).toLocaleString()}`),
    '',
    `Total Debits:  $${Math.round(journal.totalDebits).toLocaleString()}`,
    `Total Credits: $${Math.round(journal.totalCredits).toLocaleString()}`,
    journal.diff !== 0 ? `Difference:    $${Math.round(Math.abs(journal.diff)).toLocaleString()} (${journal.diff > 0 ? 'debits exceed credits' : 'credits exceed debits'})` : 'Balanced: Yes',
  ].filter(l => l !== undefined)
  return lines.join('\n')
}

function Field({ label, value, onChange, prefix = '$' }) {
  return (
    <div className="flex items-center justify-between py-1.5 border-b border-slate-100 last:border-0">
      <span className="text-xs text-slate-500 shrink-0 mr-3">{label}</span>
      <div className="flex items-center gap-1">
        {prefix && <span className="text-xs text-slate-400">{prefix}</span>}
        <input
          type="number"
          min="0"
          value={value ?? ''}
          onChange={e => onChange(e.target.value === '' ? null : Number(e.target.value))}
          className="w-32 text-right text-sm font-medium text-slate-900 border border-slate-200 rounded px-2 py-0.5 outline-none focus:ring-2 focus:ring-blue-300 tabular-nums"
          placeholder="—"
        />
      </div>
    </div>
  )
}

export default function SettlementUpload({ propertyId, onSaved, onClose }) {
  const inputRef = useRef()
  const [step, setStep]           = useState('upload')
  const [error, setError]         = useState(null)
  const [fields, setFields]       = useState(null)
  const [buildingPct, setBuildingPct] = useState(75)
  const [landPct, setLandPct]         = useState(25)
  const [copied, setCopied]       = useState(false)
  const [dragOver, setDragOver]   = useState(false)

  const setField = useCallback((key, val) => setFields(prev => ({ ...prev, [key]: val })), [])

  async function handleFile(file) {
    if (!file) return
    setStep('parsing')
    setError(null)
    try {
      const data = await uploadSettlement(propertyId, file)
      setFields(data)
      setStep('review')
    } catch (err) {
      setError(err.message)
      setStep('upload')
    }
  }

  const journal = fields ? buildJournal(fields, buildingPct, landPct) : null

  async function handleSave() {
    if (!fields) return
    setStep('saving')
    setError(null)
    try {
      const date = fields.settlement_date || new Date().toISOString().slice(0, 10)
      const pp   = Number(fields.purchase_price) || 0
      const bPct = (Number(buildingPct) || 75) / 100
      const lPct = (Number(landPct) || 25) / 100

      // Build transactions for ledger.
      // Sign convention: negative = cash/asset out, positive = cash in.
      // Building/Land are asset entries (not cash), excluded from cash balance in LedgerPage.
      const txs = [
        pp > 0                        && { description: 'Building Value',               category: 'Purchase', amount: -(pp * bPct) },
        pp > 0                        && { description: 'Land Value',                   category: 'Purchase', amount: -(pp * lPct) },
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

      const filteredTxs = txs

      if (filteredTxs.length > 0) {
        await createTransactions(propertyId, filteredTxs)
      }

      // Save journal entry
      const content = buildClipboardText(journal, fields, date)
      await saveJournalEntry(propertyId, {
        entry_type: 'acquisition',
        entry_date: date,
        label:      fields.property_address || 'Acquisition',
        content,
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
    const text = buildClipboardText(journal, fields, fields.settlement_date)
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }

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

          {/* Upload */}
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
                e.preventDefault()
                setDragOver(false)
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

          {/* Review */}
          {(step === 'review' || step === 'saving') && fields && (
            <div className="space-y-6">
              {/* Property info */}
              {(fields.property_address || fields.settlement_date) && (
                <div className="px-4 py-3 bg-slate-50 rounded-lg text-sm text-slate-600">
                  {fields.property_address && <span className="font-medium text-slate-800">{fields.property_address}</span>}
                  {fields.settlement_date  && <span className="ml-3 text-slate-400">· Closed {new Date(fields.settlement_date + 'T00:00:00').toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' })}</span>}
                </div>
              )}

              <div className="grid grid-cols-2 gap-6">
                {/* Left — Extracted Fields */}
                <div>
                  <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-3">Extracted Fields</h3>
                  <div className="bg-slate-50 rounded-xl px-4 py-2">
                    <Field label="Purchase Price"             value={fields.purchase_price}         onChange={v => setField('purchase_price', v)} />
                    <Field label="Loan Amount"                value={fields.loan_amount}            onChange={v => setField('loan_amount', v)} />
                    <Field label="Earnest Money Deposit"      value={fields.earnest_money}          onChange={v => setField('earnest_money', v)} />
                    <Field label="Cash to Close"              value={fields.cash_to_close}          onChange={v => setField('cash_to_close', v)} />
                    <Field label="Total Closing Costs (Line 103)" value={fields.total_closing_costs} onChange={v => setField('total_closing_costs', v)} />
                    <p className="text-xs text-slate-400 pt-2 pb-1 border-t border-slate-100 mt-1">Individual line items (for reference)</p>
                    <Field label="Loan Origination Fee"       value={fields.loan_origination_fee}   onChange={v => setField('loan_origination_fee', v)} />
                    <Field label="Appraisal Fee"              value={fields.appraisal_fee}          onChange={v => setField('appraisal_fee', v)} />
                    <Field label="Title & Closing Fees"       value={fields.title_and_closing_fees} onChange={v => setField('title_and_closing_fees', v)} />
                    <Field label="Recording Fees"             value={fields.recording_fees}         onChange={v => setField('recording_fees', v)} />
                    <Field label="Survey Fee"                 value={fields.survey_fee}             onChange={v => setField('survey_fee', v)} />
                    <Field label="Environmental / PCA"        value={fields.environmental_fees}     onChange={v => setField('environmental_fees', v)} />
                    <Field label="Knox Acquisition Fee"       value={fields.acquisition_fee}        onChange={v => setField('acquisition_fee', v)} />
                    <Field label="Property Taxes Paid at Closing" value={fields.buyer_taxes_paid}   onChange={v => setField('buyer_taxes_paid', v)} />
                    <p className="text-xs text-slate-400 pt-2 pb-1 border-t border-slate-100 mt-1">Credits received by buyer</p>
                    <Field label="Tax Proration Credit (from Seller)"  value={fields.tax_credits}   onChange={v => setField('tax_credits', v)} />
                    <Field label="Prorated Rent (Credit to Buyer)"     value={fields.prorated_rent}  onChange={v => setField('prorated_rent', v)} />
                  </div>

                  {/* Building / Land split */}
                  <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wide mt-4 mb-2">Building / Land Split</h3>
                  <div className="bg-slate-50 rounded-xl px-4 py-2">
                    <div className="flex items-center justify-between py-1.5 border-b border-slate-100">
                      <span className="text-xs text-slate-500">Building %</span>
                      <div className="flex items-center gap-2">
                        <input type="number" min="0" max="100" value={buildingPct}
                          onChange={e => { setBuildingPct(Number(e.target.value)); setLandPct(100 - Number(e.target.value)) }}
                          className="w-20 text-right text-sm font-medium border border-slate-200 rounded px-2 py-0.5 outline-none focus:ring-2 focus:ring-blue-300"
                        />
                        <span className="text-xs text-slate-400">%</span>
                      </div>
                    </div>
                    <div className="flex items-center justify-between py-1.5">
                      <span className="text-xs text-slate-500">Land %</span>
                      <div className="flex items-center gap-2">
                        <input type="number" min="0" max="100" value={landPct}
                          onChange={e => { setLandPct(Number(e.target.value)); setBuildingPct(100 - Number(e.target.value)) }}
                          className="w-20 text-right text-sm font-medium border border-slate-200 rounded px-2 py-0.5 outline-none focus:ring-2 focus:ring-blue-300"
                        />
                        <span className="text-xs text-slate-400">%</span>
                      </div>
                    </div>
                    {fields.purchase_price && (
                      <div className="pt-2 pb-1 text-xs text-slate-400 text-right border-t border-slate-100 mt-1">
                        Building: {$(fields.purchase_price * buildingPct / 100)} · Land: {$(fields.purchase_price * landPct / 100)}
                      </div>
                    )}
                  </div>
                </div>

                {/* Right — Journal Entry */}
                <div>
                  <div className="flex items-center justify-between mb-3">
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
                            <th className="text-left px-3 py-2 font-semibold text-slate-500 uppercase tracking-wide">Account</th>
                            <th className="text-right px-3 py-2 font-semibold text-slate-500 uppercase tracking-wide">Debit</th>
                            <th className="text-right px-3 py-2 font-semibold text-slate-500 uppercase tracking-wide">Credit</th>
                          </tr>
                        </thead>
                        <tbody>
                          {journal.debits.map((d, i) => (
                            <tr key={i} className="border-b border-slate-100">
                              <td className="px-3 py-1.5 text-slate-800">{d.account}</td>
                              <td className="px-3 py-1.5 text-right text-slate-900 font-medium tabular-nums">{$(d.amount)}</td>
                              <td className="px-3 py-1.5 text-right text-slate-400">—</td>
                            </tr>
                          ))}
                          {journal.credits.map((c, i) => (
                            <tr key={i} className="border-b border-slate-100 bg-slate-50/40">
                              <td className="px-3 py-1.5 text-slate-800 pl-6">{c.account}</td>
                              <td className="px-3 py-1.5 text-right text-slate-400">—</td>
                              <td className="px-3 py-1.5 text-right text-slate-900 font-medium tabular-nums">{$(c.amount)}</td>
                            </tr>
                          ))}
                        </tbody>
                        <tfoot>
                          <tr className="border-t-2 border-slate-300 bg-slate-50">
                            <td className="px-3 py-2 font-semibold text-slate-700">Totals</td>
                            <td className="px-3 py-2 text-right font-bold text-slate-900 tabular-nums">{$(journal.totalDebits)}</td>
                            <td className="px-3 py-2 text-right font-bold text-slate-900 tabular-nums">{$(journal.totalCredits)}</td>
                          </tr>
                          <tr>
                            <td colSpan={3} className={`px-3 py-1.5 text-center text-xs font-medium ${Math.abs(journal.diff) < 1 ? 'text-emerald-600' : 'text-red-600'}`}>
                              {Math.abs(journal.diff) < 1
                                ? '✓ Balanced'
                                : journal.diff > 0
                                  ? `⚠ Debits exceed credits by ${$(journal.diff)} — increase a credit field`
                                  : `⚠ Credits exceed debits by ${$(Math.abs(journal.diff))} — increase a debit field`
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
