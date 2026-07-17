// Lease abstraction tab: upload a lease PDF → AI abstracts it → show the key
// terms and an easy-to-read tenant/landlord responsibility matrix. The backbone
// for AI-driven management, so it's built to grow.
import { useState, useEffect, useCallback, useRef } from 'react'
import { FileText, Upload, Loader2, ExternalLink, Trash2, AlertCircle, Sparkles, RefreshCw } from 'lucide-react'
import { getPropertyLease, uploadPropertyLease, deletePropertyLease, leaseFileUrl } from '../../api/client'

const PARTY_STYLE = {
  Tenant:   'bg-blue-50 text-blue-700 border-blue-200',
  Landlord: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  Shared:   'bg-violet-50 text-violet-700 border-violet-200',
  Unclear:  'bg-slate-100 text-slate-500 border-slate-200',
}
function PartyBadge({ party }) {
  return <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full border whitespace-nowrap ${PARTY_STYLE[party] || PARTY_STYLE.Unclear}`}>{party || 'Unclear'}</span>
}

const SUMMARY_FIELDS = [
  ['tenant', 'Tenant'], ['landlord', 'Landlord'], ['guarantor', 'Guarantor'],
  ['premises', 'Premises'], ['permitted_use', 'Permitted Use'], ['lease_type', 'Lease Type'],
  ['commencement_date', 'Commencement'], ['expiration_date', 'Expiration'], ['term', 'Term'],
  ['base_rent', 'Base Rent'], ['rent_escalations', 'Escalations'],
  ['security_deposit', 'Security Deposit'], ['renewal_options', 'Renewal Options'],
]

function UploadZone({ onFile, uploading, error, dragging, setDragging, inputRef, hasExisting }) {
  return (
    <div className="max-w-xl mx-auto py-8">
      <div
        className={`border-2 border-dashed rounded-2xl p-10 text-center transition-colors cursor-pointer ${
          dragging ? 'border-blue-400 bg-blue-50' : 'border-slate-200 hover:border-slate-300 hover:bg-slate-50'
        } ${uploading ? 'pointer-events-none opacity-70' : ''}`}
        onDragOver={e => { e.preventDefault(); setDragging(true) }}
        onDragLeave={() => setDragging(false)}
        onDrop={e => { e.preventDefault(); setDragging(false); onFile(e.dataTransfer.files[0]) }}
        onClick={() => inputRef.current?.click()}
      >
        <input ref={inputRef} type="file" accept=".pdf" className="hidden" onChange={e => onFile(e.target.files[0])} />
        {uploading ? (
          <>
            <Loader2 className="w-10 h-10 text-blue-500 mx-auto mb-3 animate-spin" />
            <p className="text-sm font-semibold text-slate-700">Abstracting the lease with AI…</p>
            <p className="text-xs text-slate-400 mt-1">Reading the document and mapping responsibilities — this takes ~15–30 seconds.</p>
          </>
        ) : (
          <>
            <div className="w-12 h-12 rounded-2xl bg-blue-50 flex items-center justify-center mx-auto mb-3">
              <Sparkles className="w-6 h-6 text-blue-600" />
            </div>
            <p className="text-sm font-semibold text-slate-700">{hasExisting ? 'Upload a new lease' : 'Upload the lease'}</p>
            <p className="text-xs text-slate-400 mt-1">Drop a PDF or click to browse — AI extracts the key terms and a tenant/landlord responsibility matrix.</p>
          </>
        )}
      </div>
      {error && (
        <div className="mt-3 flex items-start gap-2 text-sm text-red-700 bg-red-50 border border-red-200 rounded-xl px-3 py-2">
          <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" /> {error}
        </div>
      )}
    </div>
  )
}

export default function LeaseSection({ propertyId }) {
  const [lease, setLease]       = useState(null)
  const [loading, setLoading]   = useState(true)
  const [uploading, setUploading] = useState(false)
  const [error, setError]       = useState(null)
  const [dragging, setDragging] = useState(false)
  const inputRef = useRef()

  const load = useCallback(async () => {
    setLoading(true)
    try { const r = await getPropertyLease(propertyId); setLease(r.lease) } catch (_) {} finally { setLoading(false) }
  }, [propertyId])
  useEffect(() => { load() }, [load])

  async function handleFile(file) {
    if (!file) return
    setUploading(true); setError(null)
    try { const r = await uploadPropertyLease(propertyId, file); setLease(r.lease) }
    catch (e) { setError(e.message) }
    finally { setUploading(false) }
  }

  async function handleDelete() {
    if (!window.confirm('Remove this lease abstract and file?')) return
    try { await deletePropertyLease(propertyId); setLease(null) } catch (e) { alert(e.message) }
  }

  if (loading) return <div className="flex items-center justify-center py-16"><Loader2 className="w-6 h-6 text-slate-400 animate-spin" /></div>

  const a = lease?.abstract
  if (!lease || !a) {
    return <UploadZone onFile={handleFile} uploading={uploading} error={error} dragging={dragging} setDragging={setDragging} inputRef={inputRef} hasExisting={false} />
  }

  const s = a.summary || {}
  const resps = Array.isArray(a.responsibilities) ? a.responsibilities : []
  const byParty = (p) => resps.filter(r => r.party === p)
  const tenant = byParty('Tenant'), landlord = byParty('Landlord'), shared = byParty('Shared'), unclear = byParty('Unclear')

  return (
    <div className="space-y-5">
      {/* Header actions */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2 min-w-0">
          <FileText className="w-4 h-4 text-slate-400 shrink-0" />
          <span className="text-sm font-medium text-slate-700 truncate">{lease.file_name || 'Lease'}</span>
          {lease.updated_at && <span className="text-xs text-slate-400 shrink-0">· abstracted {String(lease.updated_at).slice(0, 10)}</span>}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {lease.has_file && (
            <a href={leaseFileUrl(propertyId)} target="_blank" rel="noreferrer"
              className="inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1.5 rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50">
              <ExternalLink className="w-3.5 h-3.5" /> View PDF
            </a>
          )}
          <button onClick={() => inputRef.current?.click()} disabled={uploading}
            className="inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1.5 rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50 disabled:opacity-50">
            {uploading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />} Re-upload
          </button>
          <button onClick={handleDelete} className="inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1.5 rounded-lg border border-red-200 text-red-600 hover:bg-red-50">
            <Trash2 className="w-3.5 h-3.5" /> Remove
          </button>
          <input ref={inputRef} type="file" accept=".pdf" className="hidden" onChange={e => handleFile(e.target.files[0])} />
        </div>
      </div>

      {error && (
        <div className="flex items-start gap-2 text-sm text-red-700 bg-red-50 border border-red-200 rounded-xl px-3 py-2">
          <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" /> {error}
        </div>
      )}

      {/* Key terms */}
      <div className="rounded-xl border border-slate-200 overflow-hidden">
        <div className="bg-slate-50 px-4 py-2 text-xs font-semibold text-slate-500 uppercase tracking-wide">Key Terms</div>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-x-6 gap-y-3 p-4">
          {SUMMARY_FIELDS.filter(([k]) => s[k]).map(([k, label]) => (
            <div key={k} className="min-w-0">
              <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-wide">{label}</p>
              <p className="text-sm text-slate-800 break-words">{s[k]}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Quick who-does-what */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="rounded-xl border border-blue-200 bg-blue-50/40 p-4">
          <p className="text-xs font-semibold text-blue-700 uppercase tracking-wide mb-2">Tenant is responsible for</p>
          {tenant.length ? (
            <ul className="flex flex-wrap gap-1.5">
              {tenant.map((r, i) => <li key={i} className="text-xs bg-white border border-blue-200 text-blue-800 px-2 py-0.5 rounded-full">{r.category}</li>)}
            </ul>
          ) : <p className="text-xs text-slate-400">Nothing clearly assigned.</p>}
        </div>
        <div className="rounded-xl border border-emerald-200 bg-emerald-50/40 p-4">
          <p className="text-xs font-semibold text-emerald-700 uppercase tracking-wide mb-2">Landlord is responsible for</p>
          {landlord.length ? (
            <ul className="flex flex-wrap gap-1.5">
              {landlord.map((r, i) => <li key={i} className="text-xs bg-white border border-emerald-200 text-emerald-800 px-2 py-0.5 rounded-full">{r.category}</li>)}
            </ul>
          ) : <p className="text-xs text-slate-400">Nothing clearly assigned.</p>}
        </div>
      </div>

      {/* Full responsibility matrix */}
      <div className="rounded-xl border border-slate-200 overflow-hidden">
        <div className="bg-slate-50 px-4 py-2 text-xs font-semibold text-slate-500 uppercase tracking-wide flex items-center justify-between">
          <span>Responsibility Matrix</span>
          <span className="normal-case font-normal text-slate-400">{resps.length} item{resps.length === 1 ? '' : 's'}</span>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <tbody>
              {[...tenant, ...landlord, ...shared, ...unclear].map((r, i) => (
                <tr key={i} className="border-b border-slate-100 last:border-0 align-top">
                  <td className="px-4 py-2.5 font-medium text-slate-800 whitespace-nowrap w-48">{r.category}</td>
                  <td className="px-4 py-2.5 w-28"><PartyBadge party={r.party} /></td>
                  <td className="px-4 py-2.5 text-slate-600">{r.detail || '—'}</td>
                </tr>
              ))}
              {resps.length === 0 && (
                <tr><td className="px-4 py-6 text-center text-sm text-slate-400">No responsibilities were extracted.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Key dates */}
      {Array.isArray(a.key_dates) && a.key_dates.length > 0 && (
        <div className="rounded-xl border border-slate-200 overflow-hidden">
          <div className="bg-slate-50 px-4 py-2 text-xs font-semibold text-slate-500 uppercase tracking-wide">Key Dates</div>
          <ul className="divide-y divide-slate-100">
            {a.key_dates.map((d, i) => (
              <li key={i} className="flex items-center justify-between px-4 py-2 text-sm">
                <span className="text-slate-700">{d.label}</span>
                <span className="text-slate-500 tabular-nums">{d.date}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Notes */}
      {a.notes && (
        <div className="rounded-xl border border-amber-200 bg-amber-50/50 p-4">
          <p className="text-xs font-semibold text-amber-700 uppercase tracking-wide mb-1">Notes</p>
          <p className="text-sm text-slate-700 whitespace-pre-line">{a.notes}</p>
        </div>
      )}

      <p className="text-[11px] text-slate-400 text-center">
        AI-generated from the lease document — verify against the source before relying on it for a decision.
      </p>
    </div>
  )
}
