import { useState, useRef } from 'react'
import { X, Upload, Loader2, CheckCircle, AlertCircle, Pencil } from 'lucide-react'
import Button from '../ui/Button'
import { uploadSettlement, createTransactions } from '../../api/client'

const CATEGORIES = ['Equity Contribution', 'Purchase', 'Rent', 'Mortgage', 'Repair', 'Sale', 'Other']

function fmt$(v) {
  if (v === null || v === undefined) return '—'
  const n = Number(v)
  const abs = '$' + Math.abs(Math.round(n)).toLocaleString()
  return n >= 0 ? `+${abs}` : `-${abs}`
}

export default function SettlementUpload({ propertyId, onSaved, onClose }) {
  const inputRef = useRef()
  const [step, setStep]     = useState('upload') // 'upload' | 'parsing' | 'review' | 'saving'
  const [error, setError]   = useState(null)
  const [parsed, setParsed] = useState(null)   // { settlement_date, property_address, transactions[] }
  const [rows, setRows]     = useState([])     // editable rows

  async function handleFile(file) {
    if (!file) return
    setStep('parsing')
    setError(null)
    try {
      const data = await uploadSettlement(propertyId, file)
      const txs = (data.transactions || []).map((t, i) => ({
        _key:        i,
        date:        data.settlement_date || new Date().toISOString().slice(0, 10),
        description: t.description,
        category:    t.category,
        amount:      t.amount,
      }))
      setParsed(data)
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

  function removeRow(key) {
    setRows(prev => prev.filter(r => r._key !== key))
  }

  async function handleSave() {
    if (rows.length === 0) return
    setStep('saving')
    setError(null)
    try {
      const payload = rows.map(r => ({
        date:        r.date,
        description: r.description,
        category:    r.category,
        amount:      parseFloat(r.amount),
        source:      'Settlement Statement',
      }))
      await createTransactions(propertyId, payload)
      onSaved()
      onClose()
    } catch (err) {
      setError(err.message)
      setStep('review')
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 shrink-0">
          <div>
            <h2 className="text-base font-semibold text-slate-900">Settlement Statement</h2>
            <p className="text-xs text-slate-500 mt-0.5">
              {step === 'upload'  && 'Upload a PDF to extract closing transactions automatically'}
              {step === 'parsing' && 'AI is reading your settlement statement…'}
              {step === 'review'  && `Review ${rows.length} extracted transactions before saving`}
              {step === 'saving'  && 'Saving transactions to ledger…'}
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
                  <p className="text-sm font-medium text-slate-700">Reading settlement statement…</p>
                  <p className="text-xs text-slate-400 mt-1">This may take a few seconds</p>
                </>
              ) : (
                <>
                  <Upload className="w-10 h-10 mx-auto mb-3 text-slate-300" />
                  <p className="text-sm font-medium text-slate-700">Drop PDF or click to browse</p>
                  <p className="text-xs text-slate-400 mt-1">HUD-1, ALTA Closing Disclosure, or similar</p>
                </>
              )}
            </div>
          )}

          {/* Review step */}
          {(step === 'review' || step === 'saving') && (
            <>
              {parsed?.property_address && (
                <div className="mb-4 px-4 py-3 bg-slate-50 rounded-lg text-sm text-slate-600">
                  <span className="font-medium text-slate-800">Property: </span>
                  {parsed.property_address}
                  {parsed.settlement_date && (
                    <span className="ml-3 text-slate-400">
                      · Closed {new Date(parsed.settlement_date + 'T00:00:00').toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' })}
                    </span>
                  )}
                </div>
              )}

              {rows.length === 0 ? (
                <p className="text-sm text-slate-400 italic text-center py-8">
                  No transactions extracted. Try a different file.
                </p>
              ) : (
                <table className="w-full text-sm border-collapse">
                  <thead>
                    <tr className="border-b border-slate-200">
                      <th className="text-left text-xs font-semibold text-slate-500 uppercase py-2 pr-3">Description</th>
                      <th className="text-left text-xs font-semibold text-slate-500 uppercase py-2 pr-3">Category</th>
                      <th className="text-right text-xs font-semibold text-slate-500 uppercase py-2 pr-3">Amount</th>
                      <th className="w-8" />
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map(row => (
                      <tr key={row._key} className="border-b border-slate-100">
                        <td className="py-2 pr-3">
                          <input
                            value={row.description}
                            onChange={e => updateRow(row._key, 'description', e.target.value)}
                            className="w-full text-sm text-slate-800 border-0 bg-transparent outline-none focus:bg-slate-50 rounded px-1 -mx-1"
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
                        <td className={`py-2 pr-3 text-right font-semibold tabular-nums text-sm whitespace-nowrap ${
                          Number(row.amount) >= 0 ? 'text-emerald-600' : 'text-red-600'
                        }`}>
                          {fmt$(row.amount)}
                        </td>
                        <td className="py-2 text-right">
                          <button
                            onClick={() => removeRow(row._key)}
                            className="text-slate-300 hover:text-red-400 transition-colors"
                          >
                            <X className="w-4 h-4" />
                          </button>
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
            <Button onClick={handleSave} disabled={rows.length === 0 || step === 'saving'}>
              {step === 'saving' ? (
                <><Loader2 className="w-4 h-4 animate-spin" /> Saving…</>
              ) : (
                <><CheckCircle className="w-4 h-4" /> Save {rows.length} Transaction{rows.length !== 1 ? 's' : ''}</>
              )}
            </Button>
          )}
        </div>
      </div>
    </div>
  )
}
