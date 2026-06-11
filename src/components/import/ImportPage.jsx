import { useState, useRef, useEffect } from 'react'
import { Upload, CheckCircle, AlertCircle, FileText, Landmark, Download, Loader2, ShieldAlert, Building2 } from 'lucide-react'
import { importCsv, getImportStats, importRecentSales } from '../../api/client'
import { useApp } from '../../context/AppContext'
import Button from '../ui/Button'
import TopBar from '../layout/TopBar'

function PortfolioImportCard() {
  const [file, setFile]     = useState(null)
  const [loading, setLoad]  = useState(false)
  const [result, setResult] = useState(null)
  const [error, setError]   = useState(null)
  const [dragging, setDrag] = useState(false)
  const inputRef = useRef()

  const handleFile = (f) => { if (f) { setFile(f); setResult(null); setError(null) } }

  const handleImport = async () => {
    if (!file) return
    setLoad(true); setError(null)
    const fd = new FormData()
    fd.append('file', file)
    try {
      const res = await fetch('/api/portfolio-import', { method: 'POST', body: fd })
      const data = await res.json()
      if (!res.ok) setError(data.error || 'Import failed')
      else setResult(data)
    } catch (e) {
      setError(e.message)
    } finally {
      setLoad(false)
    }
  }

  return (
    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
      <div className="px-6 py-5 border-b border-slate-100">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-emerald-50 flex items-center justify-center">
            <Landmark className="w-5 h-5 text-emerald-600" />
          </div>
          <div className="flex-1">
            <h3 className="text-base font-semibold text-slate-900">Knox Portfolio Import</h3>
            <p className="text-sm text-slate-500">Upload your Portfolio.csv to import owned properties with financial data</p>
          </div>
          <a
            href="/api/portfolio-import/template"
            download
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg hover:bg-emerald-100 shrink-0"
          >
            <Download className="w-3.5 h-3.5" /> Template
          </a>
        </div>
      </div>

      <div className="px-6 py-5 space-y-4">
        <div
          className={`border-2 border-dashed rounded-xl p-8 text-center transition-colors cursor-pointer ${
            dragging ? 'border-emerald-400 bg-emerald-50' : file ? 'border-green-400 bg-green-50' : 'border-slate-200 hover:border-slate-300 hover:bg-slate-50'
          }`}
          onDragOver={e => { e.preventDefault(); setDrag(true) }}
          onDragLeave={() => setDrag(false)}
          onDrop={e => { e.preventDefault(); setDrag(false); handleFile(e.dataTransfer.files[0]) }}
          onClick={() => inputRef.current?.click()}
        >
          <input ref={inputRef} type="file" accept=".csv" className="hidden" onChange={e => handleFile(e.target.files[0])} />
          {file ? (
            <>
              <FileText className="w-10 h-10 text-green-500 mx-auto mb-2" />
              <p className="text-sm font-semibold text-green-700">{file.name}</p>
              <p className="text-xs text-green-600 mt-0.5">{(file.size / 1024 / 1024).toFixed(1)} MB — click to change</p>
            </>
          ) : (
            <>
              <Upload className="w-10 h-10 text-slate-400 mx-auto mb-2" />
              <p className="text-sm font-semibold text-slate-700">Drop your Portfolio CSV here or click to browse</p>
              <p className="text-xs text-slate-400 mt-1">Supports your existing Portfolio.csv format — columns mapped automatically</p>
            </>
          )}
        </div>

        {result && (
          <div className="p-4 bg-green-50 border border-green-200 rounded-xl">
            <div className="flex items-start gap-3">
              <CheckCircle className="w-5 h-5 text-green-600 shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-semibold text-green-800 mb-1">Portfolio import complete</p>
                <p className="text-sm text-green-700">
                  <strong>{result.imported}</strong> properties imported
                  {result.skipped > 0 ? `, ${result.skipped} skipped (no address)` : ''}
                </p>
              </div>
            </div>
          </div>
        )}

        {error && (
          <div className="flex items-start gap-3 p-4 bg-red-50 border border-red-200 rounded-xl">
            <AlertCircle className="w-5 h-5 text-red-500 shrink-0 mt-0.5" />
            <p className="text-sm text-red-700">{error}</p>
          </div>
        )}

        <Button className="w-full justify-center" disabled={!file || loading} onClick={handleImport}>
          {loading
            ? <><Loader2 className="w-4 h-4 animate-spin" /> Importing…</>
            : 'Import Knox Portfolio CSV'
          }
        </Button>

        <p className="text-xs text-slate-400 text-center">
          Re-importing is safe — existing portfolio properties are updated by address, not duplicated.
        </p>
      </div>
    </div>
  )
}

function RecentSalesImportCard() {
  const [file, setFile]     = useState(null)
  const [loading, setLoad]  = useState(false)
  const [result, setResult] = useState(null)
  const [error, setError]   = useState(null)
  const [dragging, setDrag] = useState(false)
  const inputRef = useRef()

  const handleFile = (f) => { if (f) { setFile(f); setResult(null); setError(null) } }

  const handleImport = async () => {
    if (!file) return
    setLoad(true); setError(null)
    try {
      const res = await importRecentSales(file)
      setResult(res)
    } catch (e) {
      setError(e.message)
    } finally {
      setLoad(false)
    }
  }

  return (
    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
      <div className="px-6 py-5 border-b border-slate-100">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-amber-50 flex items-center justify-center">
            <ShieldAlert className="w-5 h-5 text-amber-600" />
          </div>
          <div>
            <h3 className="text-base font-semibold text-slate-900">Recent Sales — Ownership Review</h3>
            <p className="text-sm text-slate-500">Upload a CoStar recent-sales export (.xlsx or .csv) to flag properties with potentially stale owner data</p>
          </div>
        </div>
      </div>

      <div className="px-6 py-5 space-y-4">
        <div
          className={`border-2 border-dashed rounded-xl p-8 text-center transition-colors cursor-pointer ${
            dragging ? 'border-amber-400 bg-amber-50' : file ? 'border-green-400 bg-green-50' : 'border-slate-200 hover:border-slate-300 hover:bg-slate-50'
          }`}
          onDragOver={e => { e.preventDefault(); setDrag(true) }}
          onDragLeave={() => setDrag(false)}
          onDrop={e => { e.preventDefault(); setDrag(false); handleFile(e.dataTransfer.files[0]) }}
          onClick={() => inputRef.current?.click()}
        >
          <input ref={inputRef} type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={e => handleFile(e.target.files[0])} />
          {file ? (
            <>
              <FileText className="w-10 h-10 text-green-500 mx-auto mb-2" />
              <p className="text-sm font-semibold text-green-700">{file.name}</p>
              <p className="text-xs text-green-600 mt-0.5">{(file.size / 1024 / 1024).toFixed(1)} MB — click to change</p>
            </>
          ) : (
            <>
              <Upload className="w-10 h-10 text-slate-400 mx-auto mb-2" />
              <p className="text-sm font-semibold text-slate-700">Drop your CoStar sales export here or click to browse</p>
              <p className="text-xs text-slate-400 mt-1">Supports .xlsx and .csv — matches on address, flags properties as "Needs Ownership Review"</p>
            </>
          )}
        </div>

        {result && (
          <div className="p-4 bg-amber-50 border border-amber-200 rounded-xl">
            <div className="flex items-start gap-3">
              <CheckCircle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
              <div className="flex-1">
                <p className="text-sm font-semibold text-amber-800 mb-1">
                  {result.matched} propert{result.matched === 1 ? 'y' : 'ies'} flagged for ownership review
                </p>
                <p className="text-sm text-amber-700">
                  {result.total} rows in file · {result.matched} matched · {result.unmatched} unmatched
                </p>
                {result.unmatched_sample?.length > 0 && (
                  <details className="mt-2">
                    <summary className="text-xs text-amber-600 cursor-pointer hover:text-amber-800">
                      Show unmatched addresses ({result.unmatched})
                    </summary>
                    <ul className="mt-1 space-y-0.5">
                      {result.unmatched_sample.map((a, i) => (
                        <li key={i} className="text-xs text-amber-700 font-mono">{a}</li>
                      ))}
                      {result.unmatched > result.unmatched_sample.length && (
                        <li className="text-xs text-amber-500">…and {result.unmatched - result.unmatched_sample.length} more</li>
                      )}
                    </ul>
                  </details>
                )}
              </div>
            </div>
          </div>
        )}

        {error && (
          <div className="flex items-start gap-3 p-4 bg-red-50 border border-red-200 rounded-xl">
            <AlertCircle className="w-5 h-5 text-red-500 shrink-0 mt-0.5" />
            <p className="text-sm text-red-700">{error}</p>
          </div>
        )}

        <Button className="w-full justify-center" disabled={!file || loading} onClick={handleImport}>
          {loading
            ? <><Loader2 className="w-4 h-4 animate-spin" /> Matching addresses…</>
            : 'Flag Properties for Ownership Review'
          }
        </Button>

        <p className="text-xs text-slate-400 text-center">
          Re-uploading is safe — already-flagged properties stay flagged, new matches are added. Flags are cleared individually from the property detail page.
        </p>
      </div>
    </div>
  )
}

function StatBadge({ label, value, color = 'slate' }) {
  const colors = {
    slate: 'bg-slate-100 text-slate-700',
    blue:  'bg-blue-50 text-blue-700',
    green: 'bg-green-50 text-green-700',
    amber: 'bg-amber-50 text-amber-700',
  }
  return (
    <div className={`flex flex-col items-center px-5 py-3 rounded-xl ${colors[color]}`}>
      <span className="text-2xl font-bold">{typeof value === 'number' ? value.toLocaleString() : value}</span>
      <span className="text-xs font-medium mt-0.5 opacity-75">{label}</span>
    </div>
  )
}


export default function ImportPage() {
  const { reloadAll, notify } = useApp()
  const [file, setFile]         = useState(null)
  const [dragging, setDragging] = useState(false)
  const [loading, setLoading]   = useState(false)
  const [result, setResult]     = useState(null)
  const [error, setError]       = useState(null)
  const [stats, setStats]       = useState(null)
  const inputRef = useRef()

  useEffect(() => {
    getImportStats().then(setStats).catch(() => {})
  }, [])

  const handleFile = (f) => {
    if (!f) return
    setFile(f); setResult(null); setError(null)
  }

  const handleImport = async () => {
    if (!file) return
    setLoading(true); setError(null)
    try {
      const fd = new FormData()
      fd.append('file', file)
      const res = await fetch('/api/import/prospects', { method: 'POST', body: fd, credentials: 'include' })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Import failed')
      setResult(data)
      await reloadAll()
      setStats(await getImportStats())
      notify(`Import complete — ${data.created} new, ${data.updated} updated`)
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <TopBar title="Import Data" />
      <div className="flex-1 overflow-auto p-6 scrollbar-thin">
        <div className="max-w-2xl mx-auto space-y-6">

          {/* Current DB stats */}
          {stats && (
            <div>
              <p className="text-sm font-semibold text-slate-700 mb-3">Current database</p>
              <div className="flex gap-3 flex-wrap">
                <StatBadge label="Properties" value={stats.properties} color="blue" />
                <StatBadge label="People" value={stats.people} color="blue" />
                <StatBadge label="Tenant Brands" value={stats.tenant_brands} color="slate" />
                <StatBadge label="Deals" value={stats.deals} color="green" />
              </div>
            </div>
          )}

          {/* Property Import card */}
          <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
            <div className="px-6 py-5 border-b border-slate-100">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-violet-50 flex items-center justify-center">
                  <Building2 className="w-5 h-5 text-violet-600" />
                </div>
                <div className="flex-1">
                  <h3 className="text-base font-semibold text-slate-900">Property Import</h3>
                  <p className="text-sm text-slate-500">Import properties from Clarity First, Reonomy, or any source (.csv or .xlsx)</p>
                </div>
                <a
                  href="/api/import/prospect-template"
                  download
                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-violet-700 bg-violet-50 border border-violet-200 rounded-lg hover:bg-violet-100 shrink-0"
                >
                  <Download className="w-3.5 h-3.5" /> Template
                </a>
              </div>
            </div>

            <div className="px-6 py-5 space-y-4">
              <div
                className={`border-2 border-dashed rounded-xl p-8 text-center transition-colors cursor-pointer ${
                  dragging ? 'border-violet-400 bg-violet-50' : file ? 'border-green-400 bg-green-50' : 'border-slate-200 hover:border-slate-300 hover:bg-slate-50'
                }`}
                onDragOver={e => { e.preventDefault(); setDragging(true) }}
                onDragLeave={() => setDragging(false)}
                onDrop={e => { e.preventDefault(); setDragging(false); handleFile(e.dataTransfer.files[0]) }}
                onClick={() => inputRef.current?.click()}
              >
                <input ref={inputRef} type="file" accept=".csv,.xlsx,.xls" className="hidden" onChange={e => handleFile(e.target.files[0])} />
                {file ? (
                  <>
                    <FileText className="w-10 h-10 text-green-500 mx-auto mb-2" />
                    <p className="text-sm font-semibold text-green-700">{file.name}</p>
                    <p className="text-xs text-green-600 mt-0.5">{(file.size / 1024 / 1024).toFixed(1)} MB — click to change</p>
                  </>
                ) : (
                  <>
                    <Upload className="w-10 h-10 text-slate-400 mx-auto mb-2" />
                    <p className="text-sm font-semibold text-slate-700">Drop your file here or click to browse</p>
                    <p className="text-xs text-slate-400 mt-1">Supports .csv and .xlsx — duplicate properties and people are detected automatically</p>
                  </>
                )}
              </div>

              {result && (
                <div className="p-4 bg-green-50 border border-green-200 rounded-xl">
                  <div className="flex items-start gap-3">
                    <CheckCircle className="w-5 h-5 text-green-600 shrink-0 mt-0.5" />
                    <div className="flex-1">
                      <p className="text-sm font-semibold text-green-800 mb-1">Import complete</p>
                      <div className="flex flex-wrap gap-4 text-sm text-green-700">
                        <span><strong>{result.created}</strong> new properties</span>
                        <span><strong>{result.updated}</strong> updated</span>
                        <span><strong>{result.people_created}</strong> new people</span>
                        <span><strong>{result.people_linked}</strong> people linked</span>
                        {result.skipped > 0 && <span className="text-amber-700"><strong>{result.skipped}</strong> skipped</span>}
                      </div>
                      {result.errors?.length > 0 && (
                        <details className="mt-2">
                          <summary className="text-xs text-green-600 cursor-pointer hover:text-green-800">
                            {result.errors.length} row error{result.errors.length > 1 ? 's' : ''}
                          </summary>
                          <ul className="mt-1 space-y-0.5">
                            {result.errors.slice(0, 10).map((e, i) => (
                              <li key={i} className="text-xs text-red-600 font-mono">{e}</li>
                            ))}
                          </ul>
                        </details>
                      )}
                    </div>
                  </div>
                </div>
              )}

              {error && (
                <div className="flex items-start gap-3 p-4 bg-red-50 border border-red-200 rounded-xl">
                  <AlertCircle className="w-5 h-5 text-red-500 shrink-0 mt-0.5" />
                  <p className="text-sm text-red-700">{error}</p>
                </div>
              )}

              <Button className="w-full justify-center" disabled={!file || loading} onClick={handleImport}>
                {loading
                  ? <><Loader2 className="w-4 h-4 animate-spin" /> Importing…</>
                  : 'Import Properties'
                }
              </Button>

              <p className="text-xs text-slate-400 text-center">
                Re-importing is safe — existing properties matched by address are updated, not duplicated. Existing people matched by name + city are linked, not recreated.
              </p>
            </div>
          </div>

          {/* Knox Portfolio import */}
          <PortfolioImportCard />

          {/* Recent sales / ownership review */}
          <RecentSalesImportCard />

          {/* Column guide */}
          <div className="p-4 bg-slate-50 rounded-xl border border-slate-200">
            <p className="text-sm font-semibold text-slate-700 mb-3">Required columns</p>
            <div className="grid grid-cols-2 gap-3 text-xs text-slate-600">
              <div>
                <p className="font-semibold text-slate-800 mb-1">Mandatory (highlighted yellow in template)</p>
                <ul className="space-y-0.5">
                  <li><code className="bg-slate-200 px-1 rounded">address</code> — street address</li>
                  <li><code className="bg-slate-200 px-1 rounded">city</code></li>
                  <li><code className="bg-slate-200 px-1 rounded">state</code> — 2-letter abbreviation</li>
                  <li><code className="bg-slate-200 px-1 rounded">tenant_brand</code> — e.g. "Joe Hudson Collision"</li>
                </ul>
              </div>
              <div>
                <p className="font-semibold text-slate-800 mb-1">De-duplication</p>
                <ul className="space-y-0.5">
                  <li>Properties matched by normalized address — never duplicated</li>
                  <li>People matched by name + city — existing records linked, not recreated</li>
                  <li>Re-importing fills in empty fields on existing records</li>
                </ul>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
