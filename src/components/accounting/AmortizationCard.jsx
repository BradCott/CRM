// Loan amortization — upload a schedule; mortgage payments auto-split on sync
import { useState, useEffect, useRef, useCallback } from 'react'
import { Landmark, Upload, Loader2, Trash2, FileText, CheckCircle, AlertCircle } from 'lucide-react'
import { getAmortization, uploadAmortization, deleteAmortization } from '../../api/client'

function fmt$(n) {
  if (n === null || n === undefined) return '—'
  return '$' + Math.abs(Math.round(Number(n))).toLocaleString()
}
function fmtDate(iso) {
  if (!iso) return '—'
  return new Date(iso.slice(0, 10) + 'T00:00:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
}

export default function AmortizationCard({ propertyId, hideUploader = false }) {
  const [data, setData]       = useState(null)   // { schedule, next, used }
  const [loading, setLoading] = useState(true)
  const [uploading, setUploading] = useState(false)
  const [error, setError]     = useState(null)
  const [dragging, setDrag]   = useState(false)
  const inputRef = useRef()

  const load = useCallback(() => {
    getAmortization(propertyId).then(setData).catch(() => {}).finally(() => setLoading(false))
  }, [propertyId])

  useEffect(() => { load() }, [load])

  async function handleFile(file) {
    if (!file) return
    setUploading(true)
    setError(null)
    try {
      await uploadAmortization(propertyId, file)
      load()
    } catch (e) {
      setError(e.message)
    } finally {
      setUploading(false)
    }
  }

  async function handleDelete() {
    if (!data?.schedule || !window.confirm('Remove this amortization schedule? Mortgage payments will stop auto-splitting.')) return
    await deleteAmortization(data.schedule.id)
    setData({ schedule: null })
  }

  if (loading) return null

  const s = data?.schedule
  // Upload now lives in the top toolbar; with no schedule there's nothing to show.
  if (!s && hideUploader) return null

  return (
    <div className="shrink-0 bg-white border-b border-slate-200">
      <div className="px-6 pt-3 pb-2 flex items-center justify-between">
        <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wide flex items-center gap-1.5">
          <Landmark className="w-3.5 h-3.5" /> Loan Amortization
        </h3>
        {s && (
          <button onClick={handleDelete} className="text-xs text-slate-300 hover:text-red-500 transition-colors flex items-center gap-1">
            <Trash2 className="w-3 h-3" /> Remove
          </button>
        )}
      </div>

      {error && (
        <div className="mx-6 mb-3 flex items-center gap-2 px-3 py-2 bg-red-50 border border-red-200 rounded-lg text-xs text-red-700">
          <AlertCircle className="w-3.5 h-3.5 shrink-0" />{error}
        </div>
      )}

      {s ? (
        <div className="px-6 pb-4">
          <div className="flex items-center gap-2 mb-3">
            <CheckCircle className="w-4 h-4 text-emerald-500 shrink-0" />
            <p className="text-sm text-slate-700">
              <span className="font-medium">{s.name || 'Loan'}</span> — payments auto-split into principal &amp; interest on sync
            </p>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <Stat label="Monthly Payment" value={fmt$(s.payment_amount)} />
            <Stat label="Original Balance" value={fmt$(s.original_principal)} />
            <Stat label="Rate" value={s.annual_rate != null ? `${s.annual_rate}%` : '—'} />
            <Stat label="Term" value={s.term_months ? `${s.term_months} mo` : '—'} />
          </div>
          {data.next && (
            <p className="text-xs text-slate-400 mt-3">
              Next scheduled payment {fmtDate(data.next.due_date)}: {fmt$(data.next.principal)} principal · {fmt$(data.next.interest)} interest
              {data.used > 0 && <> · {data.used} payment{data.used !== 1 ? 's' : ''} matched so far</>}
            </p>
          )}
        </div>
      ) : (
        <div className="px-6 pb-4">
          <div
            className={`border-2 border-dashed rounded-xl p-5 text-center transition-colors cursor-pointer ${
              dragging ? 'border-blue-400 bg-blue-50' : 'border-slate-200 hover:border-slate-300 hover:bg-slate-50'
            }`}
            onDragOver={e => { e.preventDefault(); setDrag(true) }}
            onDragLeave={() => setDrag(false)}
            onDrop={e => { e.preventDefault(); setDrag(false); handleFile(e.dataTransfer.files[0]) }}
            onClick={() => inputRef.current?.click()}
          >
            <input ref={inputRef} type="file" accept=".pdf,.xlsx,.xls,.csv" className="hidden" onChange={e => handleFile(e.target.files[0])} />
            {uploading ? (
              <div className="flex items-center justify-center gap-2 text-slate-500 text-sm py-2">
                <Loader2 className="w-4 h-4 animate-spin" /> Reading loan terms…
              </div>
            ) : (
              <>
                <Upload className="w-7 h-7 text-slate-400 mx-auto mb-1.5" />
                <p className="text-sm font-medium text-slate-700">Upload an amortization schedule</p>
                <p className="text-xs text-slate-400 mt-0.5">PDF, Excel, or CSV — mortgage payments will auto-split into principal &amp; interest as they sync</p>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

function Stat({ label, value }) {
  return (
    <div className="bg-slate-50 rounded-lg px-3 py-2">
      <p className="text-[10px] text-slate-400 uppercase tracking-wide">{label}</p>
      <p className="text-sm font-bold text-slate-800 tabular-nums">{value}</p>
    </div>
  )
}
