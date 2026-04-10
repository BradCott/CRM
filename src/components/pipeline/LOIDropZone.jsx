import { useRef, useState, useEffect } from 'react'
import { Upload, CheckCircle, AlertCircle, Loader2, X } from 'lucide-react'
import Button from '../ui/Button'

function buildNotes(p) {
  const lines = []
  if (p.earnest_money)       lines.push(`Earnest Money: $${Number(p.earnest_money).toLocaleString()}`)
  if (p.closing_period_days) lines.push(`Closing Period: ${p.closing_period_days} days from contract`)
  if (p.buyer)               lines.push(`Buyer: ${p.buyer}`)
  if (p.seller)              lines.push(`Seller: ${p.seller}`)
  if (p.title_company)       lines.push(`Title Company: ${p.title_company}`)
  if (p.listing_broker)      lines.push(`Listing Broker: ${p.listing_broker}`)
  if (p.buyer_broker)        lines.push(`Buyer's Broker: ${p.buyer_broker}`)
  return lines.join('\n')
}

function fmt$(v) {
  if (!v) return null
  return '$' + Math.round(Number(v)).toLocaleString()
}

function fmtDate(iso) {
  if (!iso) return null
  return new Date(iso + 'T00:00:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
}

export default function LOIDropZone({ onParsed }) {
  const [dragging, setDrag]   = useState(false)
  const [file, setFile]       = useState(null)
  const [loading, setLoading] = useState(false)
  const [parsed, setParsed]   = useState(null)
  const [error, setError]     = useState(null)
  const inputRef = useRef()

  useEffect(() => {
    const prevent = e => e.preventDefault()
    window.addEventListener('dragover', prevent)
    window.addEventListener('drop', prevent)
    return () => {
      window.removeEventListener('dragover', prevent)
      window.removeEventListener('drop', prevent)
    }
  }, [])

  function reset() {
    setFile(null); setParsed(null); setError(null); setLoading(false)
  }

  async function handleFile(f) {
    if (!f) return
    setFile(f); setParsed(null); setError(null); setLoading(true)
    try {
      const fd = new FormData()
      fd.append('file', f)
      const res  = await fetch('/api/loi-import', { method: 'POST', body: fd })
      const data = await res.json()
      if (!res.ok || !data.ok) setError(data.error || 'Import failed')
      else setParsed(data.parsed)
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  function handleCreateDeal() {
    try {
      const p = parsed
      const prefill = {
        purchase_price:     p.purchase_price     != null ? String(p.purchase_price)     : '',
        close_date:         p.close_date         ?? '',
        tenant:             p.tenant             ?? '',
        address:            p.address            ?? '',
        city:               p.city               ?? '',
        state:              p.state              ?? '',
        cap_rate:           p.cap_rate           != null ? String(p.cap_rate)           : '',
        due_diligence_days: p.due_diligence_days != null ? String(p.due_diligence_days) : '',
        earnest_money:      p.earnest_money      != null ? String(p.earnest_money)      : '',
        notes:              buildNotes(p),
      }
      reset()
      onParsed(prefill)
    } catch (err) {
      setError(`Failed to open deal form: ${err.message}`)
    }
  }

  const hasAny = parsed && Object.values(parsed).some(v => v !== null && v !== undefined)

  return (
    <>
      {/* Parsed results card — floats above the drop zone */}
      {parsed && (
        <div className="fixed bottom-28 left-6 z-50 w-72 bg-white border border-slate-200 rounded-xl shadow-xl overflow-hidden">
          <div className="flex items-center gap-2 px-4 py-3 bg-slate-50 border-b border-slate-100">
            <CheckCircle className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
            <p className="text-xs font-semibold text-slate-700 flex-1 truncate">Extracted from {file?.name}</p>
            <button onClick={reset} className="text-slate-400 hover:text-slate-600">
              <X className="w-3.5 h-3.5" />
            </button>
          </div>

          {!hasAny ? (
            <p className="text-xs text-slate-500 italic px-4 py-3">No fields found — form will open blank.</p>
          ) : (
            <div className="divide-y divide-slate-100 max-h-60 overflow-y-auto">
              {parsed.purchase_price     && <Row label="Price"         value={fmt$(parsed.purchase_price)} />}
              {parsed.tenant             && <Row label="Tenant"        value={parsed.tenant} />}
              {parsed.address            && <Row label="Address"       value={parsed.address} />}
              {parsed.city               && <Row label="City"          value={parsed.city} />}
              {parsed.state              && <Row label="State"         value={parsed.state} />}
              {parsed.cap_rate           && <Row label="Cap Rate"      value={`${parsed.cap_rate}%`} />}
              {parsed.due_diligence_days && <Row label="Due Diligence" value={`${parsed.due_diligence_days} days`} />}
              {parsed.close_date         && <Row label="Close Date"    value={fmtDate(parsed.close_date)} />}
              {parsed.earnest_money      && <Row label="Earnest $"     value={fmt$(parsed.earnest_money)} />}
              {parsed.closing_period_days && <Row label="Closing"      value={`${parsed.closing_period_days} days`} />}
              {parsed.title_company      && <Row label="Title Co."     value={parsed.title_company} />}
              {parsed.listing_broker     && <Row label="Listing Bkr"  value={parsed.listing_broker} />}
              {parsed.buyer_broker       && <Row label="Buyer Bkr"    value={parsed.buyer_broker} />}
            </div>
          )}

          <div className="flex gap-2 px-4 py-3 border-t border-slate-100 bg-slate-50">
            <button onClick={reset} className="text-xs text-slate-400 hover:text-slate-600">Cancel</button>
            <Button onClick={handleCreateDeal} className="flex-1 text-xs py-1.5">
              <CheckCircle className="w-3.5 h-3.5" />
              Create deal
            </Button>
          </div>
        </div>
      )}

      {/* Compact drop zone — fixed bottom-left */}
      <div className="fixed bottom-6 left-6 z-50 w-44">
        <div
          className={`border-2 border-dashed rounded-xl p-3 text-center transition-all cursor-pointer select-none shadow-sm ${
            dragging
              ? 'border-blue-400 bg-blue-50 scale-105'
              : error
              ? 'border-red-300 bg-red-50'
              : 'border-slate-300 bg-white hover:border-blue-300 hover:bg-blue-50/40'
          }`}
          onDragOver={e => { e.preventDefault(); e.stopPropagation(); setDrag(true) }}
          onDragLeave={e => { if (!e.currentTarget.contains(e.relatedTarget)) setDrag(false) }}
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
              <Loader2 className="w-5 h-5 mx-auto mb-1 text-blue-400 animate-spin" />
              <p className="text-xs font-medium text-slate-600 truncate">Parsing…</p>
            </>
          ) : error ? (
            <>
              <AlertCircle className="w-5 h-5 mx-auto mb-1 text-red-400" />
              <p className="text-xs font-medium text-red-600">Parse failed</p>
              <button onClick={e => { e.stopPropagation(); reset() }} className="text-xs text-slate-400 underline mt-0.5">Try again</button>
            </>
          ) : (
            <>
              <Upload className={`w-5 h-5 mx-auto mb-1 transition-colors ${dragging ? 'text-blue-400' : 'text-slate-400'}`} />
              <p className="text-xs font-medium text-slate-600">Drop LOI</p>
              <p className="text-xs text-slate-400">or click to browse</p>
            </>
          )}
        </div>
      </div>
    </>
  )
}

function Row({ label, value }) {
  return (
    <div className="flex items-center justify-between px-4 py-1.5 gap-3">
      <span className="text-xs text-slate-400 shrink-0">{label}</span>
      <span className="text-xs font-medium text-slate-700 truncate text-right">{value}</span>
    </div>
  )
}
