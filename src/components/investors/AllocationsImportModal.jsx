// Import investor equity positions from an "Investor Allocations" matrix.
// Upload → map each property column to a portfolio property → confirm → import.
import { useState } from 'react'
import { X, Upload, Loader2, CheckCircle, AlertCircle, ArrowRight, Users, Building2 } from 'lucide-react'
import Button from '../ui/Button'
import { previewAllocations, importAllocations } from '../../api/client'

function fmt$(n) {
  return '$' + Math.abs(Math.round(Number(n) || 0)).toLocaleString()
}

export default function AllocationsImportModal({ onClose, onDone }) {
  const [step, setStep]       = useState('upload')   // upload | review | importing | done
  const [file, setFile]       = useState(null)
  const [preview, setPreview] = useState(null)
  const [mapping, setMapping] = useState({})         // colIndex → propertyId
  const [result, setResult]   = useState(null)
  const [error, setError]     = useState(null)
  const [dragOver, setDragOver] = useState(false)

  async function handleFile(f) {
    if (!f) return
    setFile(f)
    setStep('upload')
    setError(null)
    try {
      const data = await previewAllocations(f)
      setPreview(data)
      const init = {}
      for (const c of data.columns) if (c.matchedPropertyId) init[c.index] = c.matchedPropertyId
      setMapping(init)
      setStep('review')
    } catch (e) {
      setError(e.message)
    }
  }

  async function handleImport() {
    setStep('importing')
    setError(null)
    try {
      const res = await importAllocations(file, mapping)
      setResult(res)
      setStep('done')
      onDone?.()
    } catch (e) {
      setError(e.message)
      setStep('review')
    }
  }

  const mappedCount = preview ? preview.columns.filter(c => mapping[c.index]).length : 0
  const unmappedCount = preview ? preview.columns.length - mappedCount : 0

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-3xl max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 shrink-0">
          <div>
            <h2 className="text-base font-semibold text-slate-900">Import Investor Allocations</h2>
            <p className="text-xs text-slate-500 mt-0.5">
              {step === 'upload'   && 'Upload your capital allocations spreadsheet'}
              {step === 'review'   && 'Confirm which property each column maps to'}
              {step === 'importing'&& 'Building equity positions…'}
              {step === 'done'     && 'Import complete'}
            </p>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600"><X className="w-5 h-5" /></button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-5">
          {error && (
            <div className="mb-4 flex items-start gap-2 px-4 py-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
              <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />{error}
            </div>
          )}

          {/* Upload */}
          {step === 'upload' && (
            <div
              className={`border-2 border-dashed rounded-xl p-12 text-center transition-colors cursor-pointer ${
                dragOver ? 'border-blue-400 bg-blue-50' : 'border-slate-300 hover:border-blue-300 hover:bg-blue-50/40'
              }`}
              onClick={() => document.getElementById('alloc-file')?.click()}
              onDragOver={e => { e.preventDefault(); setDragOver(true) }}
              onDragLeave={e => { e.preventDefault(); setDragOver(false) }}
              onDrop={e => { e.preventDefault(); setDragOver(false); handleFile(e.dataTransfer.files[0]) }}
            >
              <input id="alloc-file" type="file" accept=".xlsx,.xls" className="hidden" onChange={e => handleFile(e.target.files[0])} />
              {file ? (
                <><Loader2 className="w-8 h-8 mx-auto mb-2 text-blue-400 animate-spin" /><p className="text-sm text-slate-600">Reading {file.name}…</p></>
              ) : (
                <><Upload className="w-8 h-8 mx-auto mb-2 text-slate-300" /><p className="text-sm font-medium text-slate-700">Drop your allocations .xlsx or click to browse</p>
                  <p className="text-xs text-slate-400 mt-1">Looks for a sheet named "Investor Allocations" — investors in rows, properties in columns</p></>
              )}
            </div>
          )}

          {/* Review */}
          {(step === 'review' || step === 'importing') && preview && (
            <div className="space-y-5">
              <div className="grid grid-cols-3 gap-3">
                <div className="bg-blue-50 rounded-xl p-3 text-center">
                  <Users className="w-4 h-4 text-blue-500 mx-auto mb-1" />
                  <p className="text-lg font-bold text-blue-700">{preview.investors.length}</p>
                  <p className="text-xs text-blue-600">Investors</p>
                </div>
                <div className="bg-emerald-50 rounded-xl p-3 text-center">
                  <Building2 className="w-4 h-4 text-emerald-500 mx-auto mb-1" />
                  <p className="text-lg font-bold text-emerald-700">{mappedCount}</p>
                  <p className="text-xs text-emerald-600">Properties mapped</p>
                </div>
                <div className={`rounded-xl p-3 text-center ${unmappedCount > 0 ? 'bg-amber-50' : 'bg-slate-50'}`}>
                  <AlertCircle className={`w-4 h-4 mx-auto mb-1 ${unmappedCount > 0 ? 'text-amber-500' : 'text-slate-300'}`} />
                  <p className={`text-lg font-bold ${unmappedCount > 0 ? 'text-amber-700' : 'text-slate-400'}`}>{unmappedCount}</p>
                  <p className={`text-xs ${unmappedCount > 0 ? 'text-amber-600' : 'text-slate-400'}`}>Unmapped (skipped)</p>
                </div>
              </div>

              {/* Column → property mapping */}
              <div>
                <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">Map each column to a property</h3>
                <div className="border border-slate-200 rounded-xl divide-y divide-slate-100 max-h-72 overflow-y-auto">
                  {preview.columns.map(c => (
                    <div key={c.index} className="flex items-center gap-3 px-3 py-2">
                      <span className="text-sm font-medium text-slate-700 w-40 shrink-0 truncate">{c.label}</span>
                      <ArrowRight className="w-3.5 h-3.5 text-slate-300 shrink-0" />
                      <select
                        value={mapping[c.index] || ''}
                        onChange={e => setMapping(m => ({ ...m, [c.index]: e.target.value ? Number(e.target.value) : undefined }))}
                        className={`flex-1 text-xs border rounded-lg px-2 py-1.5 bg-white focus:outline-none focus:ring-2 focus:ring-blue-400 ${
                          mapping[c.index] ? 'border-slate-200' : 'border-amber-300 bg-amber-50'
                        }`}
                      >
                        <option value="">— Skip this column —</option>
                        {preview.properties.map(p => <option key={p.id} value={p.id}>{p.label}</option>)}
                      </select>
                    </div>
                  ))}
                </div>
                {unmappedCount > 0 && (
                  <p className="text-xs text-amber-600 mt-1.5">
                    {unmappedCount} column{unmappedCount !== 1 ? 's are' : ' is'} unmapped — those contributions will be skipped. Add the property to your portfolio first if you want to include it.
                  </p>
                )}
              </div>

              {/* Investor list */}
              <div>
                <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">Investors detected</h3>
                <div className="border border-slate-200 rounded-xl divide-y divide-slate-100 max-h-48 overflow-y-auto">
                  {preview.investors.map((inv, i) => (
                    <div key={i} className="flex items-center justify-between px-3 py-1.5">
                      <span className="text-sm text-slate-700">{inv.name}</span>
                      <span className="text-xs text-slate-500 tabular-nums">{fmt$(inv.total)} · {inv.positions} position{inv.positions !== 1 ? 's' : ''}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* Done */}
          {step === 'done' && result && (
            <div className="text-center py-8">
              <CheckCircle className="w-12 h-12 text-emerald-500 mx-auto mb-3" />
              <h3 className="text-lg font-bold text-slate-900">Allocations imported</h3>
              <div className="grid grid-cols-3 gap-3 mt-5 max-w-md mx-auto">
                <Stat label="New investors" value={result.investorsCreated} />
                <Stat label="Matched existing" value={result.investorsMatched} />
                <Stat label="Equity positions" value={result.linksUpserted} color="text-emerald-700" />
              </div>
              {result.skipped > 0 && (
                <p className="text-xs text-amber-600 mt-4">{result.skipped} contribution{result.skipped !== 1 ? 's' : ''} skipped (unmapped columns).</p>
              )}
            </div>
          )}
        </div>

        <div className="shrink-0 flex items-center justify-between px-6 py-4 border-t border-slate-100 bg-slate-50 rounded-b-2xl">
          <button onClick={onClose} className="text-sm text-slate-500 hover:text-slate-700">
            {step === 'done' ? 'Close' : 'Cancel'}
          </button>
          {step === 'review' && (
            <Button onClick={handleImport} disabled={mappedCount === 0}>
              <CheckCircle className="w-4 h-4" /> Import {preview.investors.length} investors · {mappedCount} properties
            </Button>
          )}
          {step === 'importing' && (
            <Button disabled><Loader2 className="w-4 h-4 animate-spin" /> Importing…</Button>
          )}
        </div>
      </div>
    </div>
  )
}

function Stat({ label, value, color = 'text-slate-800' }) {
  return (
    <div className="bg-slate-50 rounded-xl p-3">
      <p className={`text-2xl font-bold ${color}`}>{value}</p>
      <p className="text-xs text-slate-500 mt-0.5">{label}</p>
    </div>
  )
}
