import { useRef, useState, useEffect } from 'react'
import { Upload, FileText, X, CheckCircle, AlertCircle, Loader2, FileUp } from 'lucide-react'
import Button from '../ui/Button'

// Build a human-readable notes block from all parsed LOI fields
function buildNotes(p) {
  const lines = []
  if (p.tenant)             lines.push(`Tenant: ${p.tenant}`)
  if (p.buyer)              lines.push(`Buyer: ${p.buyer}`)
  if (p.seller)             lines.push(`Seller: ${p.seller}`)
  if (p.address)            lines.push(`Property: ${p.address}`)
  if (p.earnest_money)      lines.push(`Earnest Money: $${p.earnest_money.toLocaleString()}`)
  if (p.due_diligence_days) lines.push(`Due Diligence: ${p.due_diligence_days} days`)
  if (p.cap_rate)           lines.push(`Cap Rate: ${p.cap_rate}%`)
  return lines.join('\n')
}

function fmt$(v) {
  if (!v) return null
  if (v >= 1_000_000) return `$${(v / 1_000_000).toFixed(2)}M`
  return `$${Number(v).toLocaleString()}`
}

export default function LOIImportButton({ onParsed }) {
  const [open, setOpen]       = useState(false)
  const [dragging, setDrag]   = useState(false)
  const [file, setFile]       = useState(null)
  const [loading, setLoading] = useState(false)
  const [parsed, setParsed]   = useState(null)
  const [error, setError]     = useState(null)
  const inputRef = useRef()

  useEffect(() => {
    if (!open) return
    const prevent = e => e.preventDefault()
    window.addEventListener('dragover', prevent)
    window.addEventListener('drop', prevent)
    return () => {
      window.removeEventListener('dragover', prevent)
      window.removeEventListener('drop', prevent)
    }
  }, [open])

  function reset() {
    setFile(null); setParsed(null); setError(null); setLoading(false)
  }

  function handleClose() {
    setOpen(false); reset()
  }

  async function handleFile(f) {
    if (!f) return
    setFile(f); setParsed(null); setError(null)
    setLoading(true)
    try {
      const fd = new FormData()
      fd.append('file', f)
      const res  = await fetch('/api/loi-import', { method: 'POST', body: fd })
      const data = await res.json()
      if (!res.ok || !data.ok) {
        setError(data.error || 'Import failed')
      } else {
        setParsed(data.parsed)
      }
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  function handleCreateDeal() {
    const p = parsed
    const prefill = {
      purchase_price: p.purchase_price ?? '',
      close_date:     p.close_date     ?? '',
      notes:          buildNotes(p),
    }
    handleClose()
    onParsed(prefill)
  }

  // --- Render ---
  const hasAny = parsed && Object.keys(parsed).length > 0

  return (
    <>
      <Button variant="secondary" onClick={() => setOpen(true)}>
        <FileUp className="w-4 h-4" /> Import LOI
      </Button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          {/* Backdrop */}
          <div className="absolute inset-0 bg-black/40" onClick={handleClose} />

          {/* Modal */}
          <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden">
            {/* Header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
              <div className="flex items-center gap-2">
                <FileUp className="w-4 h-4 text-blue-600" />
                <h2 className="text-base font-semibold text-slate-900">Import LOI</h2>
              </div>
              <button onClick={handleClose} className="w-8 h-8 flex items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100">
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="px-6 py-5 space-y-4">
              {/* Drop zone — shown until parsing succeeds */}
              {!parsed && (
                <div
                  className={`border-2 border-dashed rounded-xl p-8 text-center transition-colors cursor-pointer ${
                    dragging ? 'border-blue-400 bg-blue-50' :
                    file     ? 'border-slate-300 bg-slate-50' :
                    'border-slate-200 hover:border-slate-300 hover:bg-slate-50'
                  }`}
                  onDragOver={e => { e.preventDefault(); setDrag(true) }}
                  onDragLeave={() => setDrag(false)}
                  onDrop={e => { e.preventDefault(); e.stopPropagation(); setDrag(false); handleFile(e.dataTransfer.files[0]) }}
                  onClick={() => !loading && inputRef.current?.click()}
                >
                  <input
                    ref={inputRef}
                    type="file"
                    accept=".docx,.pdf,.txt"
                    className="hidden"
                    onChange={e => handleFile(e.target.files[0])}
                  />
                  {loading ? (
                    <>
                      <Loader2 className="w-10 h-10 text-blue-500 mx-auto mb-2 animate-spin" />
                      <p className="text-sm font-semibold text-slate-700">Parsing {file?.name}…</p>
                      <p className="text-xs text-slate-400 mt-1">Extracting fields from document</p>
                    </>
                  ) : file ? (
                    <>
                      <FileText className="w-10 h-10 text-slate-400 mx-auto mb-2" />
                      <p className="text-sm font-semibold text-slate-700">{file.name}</p>
                      <p className="text-xs text-slate-400 mt-1">Click to choose a different file</p>
                    </>
                  ) : (
                    <>
                      <Upload className="w-10 h-10 text-slate-300 mx-auto mb-2" />
                      <p className="text-sm font-semibold text-slate-700">Drop your LOI here</p>
                      <p className="text-xs text-slate-400 mt-1">Supports .docx, .pdf, and .txt</p>
                    </>
                  )}
                </div>
              )}

              {/* Error */}
              {error && (
                <div className="flex items-start gap-3 p-4 bg-red-50 border border-red-200 rounded-xl">
                  <AlertCircle className="w-4 h-4 text-red-500 mt-0.5 shrink-0" />
                  <div>
                    <p className="text-sm text-red-700">{error}</p>
                    <button onClick={reset} className="text-xs text-red-500 underline mt-1">Try another file</button>
                  </div>
                </div>
              )}

              {/* Parsed results */}
              {parsed && (
                <div className="space-y-3">
                  <div className="flex items-center gap-2">
                    <CheckCircle className="w-4 h-4 text-emerald-500" />
                    <p className="text-sm font-semibold text-slate-700">Extracted from {file?.name}</p>
                    <button onClick={reset} className="ml-auto text-xs text-slate-400 hover:text-slate-600 underline">
                      Re-upload
                    </button>
                  </div>

                  {!hasAny && (
                    <p className="text-sm text-slate-500 italic px-1">
                      No fields could be extracted — the deal form will open blank. You can fill it in manually.
                    </p>
                  )}

                  {hasAny && (
                    <div className="bg-slate-50 rounded-xl border border-slate-100 divide-y divide-slate-100">
                      {parsed.purchase_price && <Row label="Purchase price" value={fmt$(parsed.purchase_price)} highlight />}
                      {parsed.close_date     && <Row label="Closing date"   value={new Date(parsed.close_date + 'T00:00:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })} />}
                      {parsed.tenant         && <Row label="Tenant"         value={parsed.tenant} />}
                      {parsed.buyer          && <Row label="Buyer"          value={parsed.buyer} />}
                      {parsed.seller         && <Row label="Seller"         value={parsed.seller} />}
                      {parsed.address        && <Row label="Property"       value={parsed.address} />}
                      {parsed.earnest_money  && <Row label="Earnest money"  value={fmt$(parsed.earnest_money)} />}
                      {parsed.due_diligence_days && <Row label="Due diligence" value={`${parsed.due_diligence_days} days`} />}
                      {parsed.cap_rate       && <Row label="Cap rate"       value={`${parsed.cap_rate}%`} />}
                    </div>
                  )}
                </div>
              )}

              {/* Actions */}
              <div className="flex justify-end gap-2 pt-1">
                <Button variant="secondary" onClick={handleClose}>Cancel</Button>
                {parsed && (
                  <Button onClick={handleCreateDeal}>
                    <CheckCircle className="w-4 h-4" />
                    {hasAny ? 'Create deal with these fields' : 'Create deal'}
                  </Button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  )
}

function Row({ label, value, highlight }) {
  return (
    <div className="flex items-center justify-between px-4 py-2.5 gap-4">
      <span className="text-xs text-slate-500 shrink-0">{label}</span>
      <span className={`text-sm font-medium truncate text-right ${highlight ? 'text-emerald-700' : 'text-slate-800'}`}>
        {value}
      </span>
    </div>
  )
}
