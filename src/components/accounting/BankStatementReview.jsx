import { useState, useRef } from 'react'
import { X, Upload, Loader2, CheckCircle, AlertCircle, Link2 } from 'lucide-react'
import Button from '../ui/Button'
import { uploadBankStatement, createTransactions, categorizeTransactions, learnCategories, reconcileBatch } from '../../api/client'
import { guessCategory } from '../../utils/accounting'
import CategorySelect from './CategorySelect'

// A statement line already in the ledger = same amount (±$1) and date within 5 days.
function findExisting(existing, t) {
  const amt = Math.abs(Number(t.amount) || 0)
  const d = new Date((t.date || '') + 'T00:00:00').getTime()
  for (const e of existing) {
    if (Math.abs(Math.abs(Number(e.amount) || 0) - amt) > 1) continue
    const ed = new Date(String(e.date).slice(0, 10) + 'T00:00:00').getTime()
    if (!isNaN(d) && !isNaN(ed) && Math.abs(d - ed) <= 5 * 86400000) return e
  }
  return null
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

export default function BankStatementReview({ propertyId, existingTransactions = [], onSaved, onClose }) {
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
      const txs = (data.transactions || []).map((t, i) => {
        const match = findExisting(existingTransactions, t)
        return {
          _key:        i,
          date:        t.date,
          description: t.description,
          amount:      t.amount,
          category:    guessCategory(t.description, t.amount),
          existingId:  match ? match.id : null,   // already in the ledger (e.g. via Plaid)
          include:     !match,                     // only import lines that aren't already there
        }
      })
      setMeta({ account_info: data.account_info, statement_period: data.statement_period })
      setRows(txs)
      setStep('review')
      // Upgrade to learned-rule / AI categories in the background
      categorizeTransactions(txs.map(t => ({ description: t.description, amount: t.amount })))
        .then(({ suggestions }) => {
          if (!suggestions?.length) return
          setRows(prev => prev.map((r, i) => ({ ...r, category: suggestions[i]?.category ?? r.category })))
        })
        .catch(() => {})
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
    const toImport    = rows.filter(r => r.include)
    const toReconcile = [...new Set(rows.filter(r => r.existingId).map(r => r.existingId))]
    if (toImport.length === 0 && toReconcile.length === 0) return
    setStep('saving')
    setError(null)
    try {
      if (toImport.length) {
        const payload = toImport.map(r => ({
          date:        r.date,
          description: r.description,
          category:    r.category,
          amount:      parseFloat(r.amount),
          source:      'Bank Statement',
        }))
        await createTransactions(propertyId, payload)
        learnCategories(payload.map(p => ({ description: p.description, category: p.category }))).catch(() => {})
      }
      // Lines already in the ledger appeared on the statement → mark them reconciled.
      if (toReconcile.length) await reconcileBatch(toReconcile).catch(() => {})
      onSaved()
      onClose()
    } catch (err) {
      setError(err.message)
      setStep('review')
    }
  }

  const selectedCount = rows.filter(r => r.include).length
  const matchedCount  = rows.filter(r => r.existingId).length

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
              {step === 'review'  && `${rows.length} on the statement · ${matchedCount} already in your ledger · ${rows.length - matchedCount} new`}
              {step === 'saving'  && `Importing ${selectedCount} new · reconciling ${rows.filter(r => r.existingId).length} matched…`}
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

              {matchedCount > 0 && (
                <div className="mb-3 flex items-start gap-2 px-4 py-2.5 bg-blue-50 border border-blue-200 rounded-lg text-xs text-blue-800">
                  <Link2 className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                  <span><b>{matchedCount}</b> {matchedCount === 1 ? 'line is' : 'lines are'} already in your ledger (from Plaid or a prior import) — unchecked below so they won't duplicate. They'll be marked <b>reconciled ✓</b> on save. Only the <b>{rows.length - matchedCount} new</b> {rows.length - matchedCount === 1 ? 'line' : 'lines'} will import.</span>
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
                          {row.existingId && (
                            <span className="inline-flex items-center gap-1 mt-0.5 text-[10px] font-medium text-blue-600">
                              <Link2 className="w-2.5 h-2.5" /> already in ledger — will reconcile
                            </span>
                          )}
                        </td>
                        <td className="py-2 pr-3">
                          <CategorySelect
                            value={row.category}
                            onChange={v => updateRow(row._key, 'category', v)}
                            className="text-xs border border-slate-200 rounded px-2 py-1 bg-white text-slate-700 outline-none focus:ring-1 focus:ring-blue-300"
                          />
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
            <Button onClick={handleSave} disabled={(selectedCount === 0 && matchedCount === 0) || step === 'saving'}>
              {step === 'saving' ? (
                <><Loader2 className="w-4 h-4 animate-spin" /> Saving…</>
              ) : selectedCount > 0 ? (
                <><CheckCircle className="w-4 h-4" /> Import {selectedCount} · reconcile {matchedCount}</>
              ) : (
                <><CheckCircle className="w-4 h-4" /> Reconcile {matchedCount} matched</>
              )}
            </Button>
          )}
        </div>
      </div>
    </div>
  )
}
