import { useState, useRef } from 'react'
import { X, Upload, Loader2, CheckCircle, AlertCircle } from 'lucide-react'
import Button from '../ui/Button'
import { uploadBankStatement, createTransactions } from '../../api/client'

const CATEGORIES = ['Rent', 'Mortgage', 'Repair', 'Equity Contribution', 'Sale', 'Other']

// Guess a category from the transaction description
function guessCategory(description) {
  const d = description.toLowerCase()
  if (/rent|lease/.test(d))                              return 'Rent'
  if (/mortgage|loan|payment|mtg|escrow/.test(d))        return 'Mortgage'
  if (/repair|maintenance|plumb|electric|hvac|roof/.test(d)) return 'Repair'
  return 'Other'
}

function fmt$(v) {
  if (v === null || v === undefined) return '—'
  const n = Number(v)
  const abs = '$' + Math.abs(Math.round(n)).toLocaleString()
  return n >= 0 ? `+${abs}` : `-${abs}`
}

function fmtDate(iso) {
  if (!iso) return '—'
  return new Date(iso + 'T00:00:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
}

export default function BankStatementReview({ propertyId, onSaved, onClose }) {
  const inputRef = useRef()
  const [step, setStep]     = useState('upload') // 'upload' | 'parsing' | 'review' | 'saving'
  const [error, setError]   = useState(null)
  const [meta, setMeta]     = useState(null)   // { account_info, statement_period }
  const [rows, setRows]     = useState([])

  async function handleFile(file) {
    if (!file) return
    setStep('parsing')
    setError(null)
    try {
      const data = await uploadBankStatement(propertyId, file)
      const txs = (data.transactions || []).map((t, i) => ({
        _key:        i,
        date:        t.date,
        description: t.description,
        amount:      t.amount,
        category:    guessCategory(t.description),
        include:     true,
      }))
      setMeta({ account_info: data.account_info, statement_period: data.statement_period })
      setRows(txs)
      setStep('review')
    } catch (err) {
      setError(err.message)
      setStep('upload')
    }
  }

  function updateRow(key, field, value) {
    setRows(prev => prev.map(r => r._key === key ? { ...r, [field]: value } : r))
  }

  function toggleAll(include) {
    setRows(prev => prev.map(r => ({ ...r, include })))
  }

  async function handleSave() {
    const selected = rows.filter(r => r.include)
    if (selected.length === 0) return
    setStep('saving')
    setError(null)
    try {
      const payload = selected.map(r => ({
        date:        r.date,
        description: r.description,
        category:    r.category,
        amount:      parseFloat(r.amount),
        source:      'Bank Statement',
      }))
      await createTransactions(propertyId, payload)
      onSaved()
      onClose()
    } catch (err) {
      setError(err.message)
      setStep('review')
    }
  }

  const selectedCount = rows.filter(r => r.include).length

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-3xl max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 shrink-0">
          <div>
            <h2 className="text-base font-semibold text-slate-900">Bank Statement</h2>
            <p className="text-xs text-slate-500 mt-0.5">
              {step === 'upload'  && 'Upload a PDF bank statement to extract transactions'}
              {step === 'parsing' && 'AI is reading your bank statement…'}
              {step === 'review'  && `${rows.length} transactions found — assign categories and select which to import`}
              {step === 'saving'  && `Saving ${selectedCount} transactions to ledger…`}
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

          {/* Upload step */}
          {(step === 'upload' || step === 'parsing') && (
            <div
              className={`border-2 border-dashed rounded-xl p-12 text-center cursor-pointer transition-all ${
                step === 'parsing'
                  ? 'border-blue-300 bg-blue-50/50 cursor-default'
                  : 'border-slate-300 hover:border-blue-300 hover:bg-blue-50/40'
              }`}
              onClick={() => step === 'upload' && inputRef.current?.click()}
            >
              <input
                ref={inputRef}
                type="file"
                accept=".pdf"
                className="hidden"
                onChange={e => handleFile(e.target.files[0])}
              />
              {step === 'parsing' ? (
                <>
                  <Loader2 className="w-10 h-10 mx-auto mb-3 text-blue-400 animate-spin" />
                  <p className="text-sm font-medium text-slate-700">Reading bank statement…</p>
                  <p className="text-xs text-slate-400 mt-1">Extracting all transactions</p>
                </>
              ) : (
                <>
                  <Upload className="w-10 h-10 mx-auto mb-3 text-slate-300" />
                  <p className="text-sm font-medium text-slate-700">Drop PDF or click to browse</p>
                  <p className="text-xs text-slate-400 mt-1">Bank or financial statement in PDF format</p>
                </>
              )}
            </div>
          )}

          {/* Review step */}
          {(step === 'review' || step === 'saving') && (
            <>
              {meta && (meta.account_info || meta.statement_period) && (
                <div className="mb-4 px-4 py-3 bg-slate-50 rounded-lg text-xs text-slate-600 flex gap-4">
                  {meta.account_info    && <span><span className="font-medium text-slate-800">Account:</span> {meta.account_info}</span>}
                  {meta.statement_period && <span><span className="font-medium text-slate-800">Period:</span> {meta.statement_period}</span>}
                </div>
              )}

              {/* Select all / none */}
              <div className="flex items-center justify-between mb-3">
                <div className="flex gap-3">
                  <button onClick={() => toggleAll(true)}  className="text-xs text-blue-600 hover:underline">Select all</button>
                  <button onClick={() => toggleAll(false)} className="text-xs text-slate-400 hover:underline">Deselect all</button>
                </div>
                <span className="text-xs text-slate-400">{selectedCount} of {rows.length} selected</span>
              </div>

              {rows.length === 0 ? (
                <p className="text-sm text-slate-400 italic text-center py-8">
                  No transactions found. Try a different file.
                </p>
              ) : (
                <table className="w-full text-sm border-collapse">
                  <thead>
                    <tr className="border-b border-slate-200">
                      <th className="w-8 py-2" />
                      <th className="text-left text-xs font-semibold text-slate-500 uppercase py-2 pr-3 w-28">Date</th>
                      <th className="text-left text-xs font-semibold text-slate-500 uppercase py-2 pr-3">Description</th>
                      <th className="text-left text-xs font-semibold text-slate-500 uppercase py-2 pr-3">Category</th>
                      <th className="text-right text-xs font-semibold text-slate-500 uppercase py-2">Amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map(row => (
                      <tr
                        key={row._key}
                        className={`border-b border-slate-100 transition-opacity ${row.include ? '' : 'opacity-40'}`}
                      >
                        <td className="py-2 pr-2">
                          <input
                            type="checkbox"
                            checked={row.include}
                            onChange={e => updateRow(row._key, 'include', e.target.checked)}
                            className="w-4 h-4 rounded border-slate-300 text-blue-600 cursor-pointer"
                          />
                        </td>
                        <td className="py-2 pr-3 text-xs text-slate-500 whitespace-nowrap">
                          {fmtDate(row.date)}
                        </td>
                        <td className="py-2 pr-3 max-w-[220px]">
                          <input
                            value={row.description}
                            onChange={e => updateRow(row._key, 'description', e.target.value)}
                            className="w-full text-sm text-slate-800 border-0 bg-transparent outline-none focus:bg-slate-50 rounded px-1 -mx-1 truncate"
                          />
                        </td>
                        <td className="py-2 pr-3">
                          <select
                            value={row.category}
                            onChange={e => updateRow(row._key, 'category', e.target.value)}
                            className="text-xs border border-slate-200 rounded px-2 py-1 bg-white text-slate-700 outline-none focus:ring-1 focus:ring-blue-300"
                          >
                            {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
                          </select>
                        </td>
                        <td className={`py-2 text-right font-semibold tabular-nums text-sm whitespace-nowrap ${
                          Number(row.amount) >= 0 ? 'text-emerald-600' : 'text-red-600'
                        }`}>
                          {fmt$(row.amount)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </>
          )}
        </div>

        {/* Footer */}
        <div className="shrink-0 flex items-center justify-between px-6 py-4 border-t border-slate-100 bg-slate-50 rounded-b-2xl">
          <button onClick={onClose} className="text-sm text-slate-400 hover:text-slate-600">Cancel</button>
          {(step === 'review' || step === 'saving') && (
            <Button onClick={handleSave} disabled={selectedCount === 0 || step === 'saving'}>
              {step === 'saving' ? (
                <><Loader2 className="w-4 h-4 animate-spin" /> Saving…</>
              ) : (
                <><CheckCircle className="w-4 h-4" /> Import {selectedCount} Transaction{selectedCount !== 1 ? 's' : ''}</>
              )}
            </Button>
          )}
        </div>
      </div>
    </div>
  )
}
