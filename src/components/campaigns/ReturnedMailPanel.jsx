// Returned-mail intake for the Campaigns page. One smart upload: rows carrying a
// re-prospected owner/address get corrected and queued to re-mail (remail_ready);
// rows left blank get their on-file owner paused so the bad address is never mailed
// again. A one-click button then launches a campaign to the corrected set.
import { useState, useRef } from 'react'
import { MailWarning, Upload, Loader2, CheckCircle, AlertTriangle, Send, FileDown } from 'lucide-react'
import { uploadReturnedMail } from '../../api/client'
import BulkSendModal from '../handwrytten/BulkSendModal'

function Stat({ value, label, tint }) {
  return (
    <div className={`rounded-xl border px-3 py-2 ${tint}`}>
      <p className="text-lg font-bold tabular-nums leading-none">{value ?? 0}</p>
      <p className="text-[11px] mt-1 leading-tight">{label}</p>
    </div>
  )
}

export default function ReturnedMailPanel() {
  const [busy, setBusy]         = useState(false)
  const [result, setResult]     = useState(null)
  const [error, setError]       = useState(null)
  const [dragging, setDragging] = useState(false)
  const [showRemail, setShowRemail] = useState(false)
  const inputRef = useRef(null)

  async function handleFile(file) {
    if (!file) return
    setBusy(true); setError(null); setResult(null)
    try { setResult(await uploadReturnedMail(file)) }
    catch (e) { setError(e.message || 'Upload failed') }
    finally { setBusy(false) }
  }

  return (
    <div className="mb-6 bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
      <div className="px-5 py-3 border-b border-slate-100 flex items-center gap-2 flex-wrap">
        <MailWarning className="w-4 h-4 text-amber-600" />
        <h2 className="text-sm font-semibold text-slate-800">Returned Mail</h2>
        <span className="text-xs text-slate-400">upload re-prospected returns</span>
        <button onClick={() => setShowRemail(true)}
          className="ml-auto inline-flex items-center gap-1.5 text-xs font-semibold text-emerald-700 border border-emerald-200 bg-emerald-50 rounded-lg px-2.5 py-1.5 hover:bg-emerald-100">
          <Send className="w-3.5 h-3.5" /> Re-mail corrected returns
        </button>
      </div>

      <div className="p-5">
        <label
          onDragOver={e => { e.preventDefault(); setDragging(true) }}
          onDragLeave={() => setDragging(false)}
          onDrop={e => { e.preventDefault(); setDragging(false); handleFile(e.dataTransfer.files?.[0]) }}
          className={`flex flex-col items-center justify-center gap-2 border-2 border-dashed rounded-xl px-6 py-8 text-center cursor-pointer transition-colors ${dragging ? 'border-blue-400 bg-blue-50' : 'border-slate-200 hover:border-slate-300 hover:bg-slate-50'} ${busy ? 'pointer-events-none opacity-70' : ''}`}>
          <input ref={inputRef} type="file" accept=".csv,.xlsx,.xls" className="hidden" onChange={e => { handleFile(e.target.files?.[0]); e.target.value = '' }} />
          {busy ? (
            <><Loader2 className="w-6 h-6 text-blue-500 animate-spin" /><p className="text-sm font-medium text-slate-600">Processing returns…</p></>
          ) : (
            <>
              <div className="w-11 h-11 rounded-2xl bg-amber-50 flex items-center justify-center"><Upload className="w-5 h-5 text-amber-600" /></div>
              <p className="text-sm font-semibold text-slate-700">Drop your returned-mail file, or click to browse</p>
              <p className="text-xs text-slate-400 max-w-md">CSV/Excel. Rows with a new owner/address are corrected &amp; queued to re-mail; rows left blank pause the on-file owner so the bad address isn&apos;t mailed again.</p>
            </>
          )}
        </label>

        <p className="mt-2 text-xs text-slate-400">
          Match on <code className="bg-slate-100 px-1 rounded">address, city, state, zip</code>; correct with <code className="bg-slate-100 px-1 rounded">owner_name, owner_address, owner_city, owner_state, owner_zip, owner_phone, owner_email</code> (leave blank = unresolved).
          <a href="/api/import/property-updates-template" className="ml-2 inline-flex items-center gap-1 text-blue-600 hover:underline"><FileDown className="w-3 h-3" /> template</a>
        </p>

        {error && <div className="mt-3 flex items-start gap-2 text-sm text-red-700 bg-red-50 border border-red-200 rounded-xl px-3 py-2"><AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" /> {error}</div>}

        {result && (
          <div className="mt-4">
            <div className="flex items-center gap-2 text-sm text-slate-600 mb-2"><CheckCircle className="w-4 h-4 text-emerald-500" /> Processed {result.total} row{result.total === 1 ? '' : 's'}.</div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              <Stat value={result.resolved} label="Corrected &amp; queued to re-mail" tint="border-emerald-200 bg-emerald-50 text-emerald-800" />
              <Stat value={result.unresolved} label="Paused — bad address" tint="border-amber-200 bg-amber-50 text-amber-800" />
              <Stat value={result.not_found} label="Not matched to a property" tint="border-slate-200 bg-slate-50 text-slate-600" />
              <Stat value={(result.people_created || 0) + (result.people_updated || 0)} label="Owners created / updated" tint="border-blue-200 bg-blue-50 text-blue-800" />
            </div>
            {result.resolved > 0 && (
              <button onClick={() => setShowRemail(true)} className="mt-3 inline-flex items-center gap-1.5 text-sm font-semibold text-white bg-emerald-600 rounded-lg px-3 py-2 hover:bg-emerald-700">
                <Send className="w-4 h-4" /> Re-mail the {result.resolved} corrected
              </button>
            )}
            {result.not_found > 0 && result.unmatched_sample?.length > 0 && (
              <details className="mt-2 text-xs text-slate-500">
                <summary className="cursor-pointer hover:text-slate-700">{result.not_found} not matched — show examples</summary>
                <ul className="mt-1 list-disc pl-5 space-y-0.5">{result.unmatched_sample.map((s, i) => <li key={i}>{s}</li>)}</ul>
              </details>
            )}
          </div>
        )}
      </div>

      {showRemail && <BulkSendModal initialRemailOnly onClose={() => setShowRemail(false)} onDone={() => setShowRemail(false)} />}
    </div>
  )
}
