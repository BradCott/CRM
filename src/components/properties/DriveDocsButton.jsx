// "Find Drive Docs" — searches the shared Google Drive for files relevant to a
// property (address, tenant brand, store number) and lists them with links.
import { useState } from 'react'
import { FolderSearch, Loader2, ExternalLink, AlertCircle, FileText } from 'lucide-react'
import { getPropertyDriveDocs } from '../../api/client'

function fmtDate(iso) {
  if (!iso) return ''
  try { return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) }
  catch { return '' }
}

export default function DriveDocsButton({ propertyId, className = '' }) {
  const [open, setOpen]       = useState(false)
  const [loading, setLoading] = useState(false)
  const [result, setResult]   = useState(null)   // { connected, files, terms }
  const [error, setError]     = useState(null)

  async function run() {
    setOpen(true)
    setLoading(true)
    setError(null)
    try {
      setResult(await getPropertyDriveDocs(propertyId))
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className={`relative ${className}`}>
      <button
        onClick={() => (open ? setOpen(false) : run())}
        className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-600 border border-slate-200 rounded-lg px-3 py-1.5 hover:bg-slate-50 transition-colors"
        title="Search Google Drive for documents about this property"
      >
        <FolderSearch className="w-3.5 h-3.5" /> Find Drive Docs
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-30" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-9 z-40 w-96 max-w-[90vw] bg-white border border-slate-200 rounded-xl shadow-lg overflow-hidden">
            <div className="px-4 py-2.5 border-b border-slate-100 flex items-center justify-between">
              <span className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Drive Documents</span>
              {result?.terms?.length > 0 && (
                <span className="text-[11px] text-slate-400 truncate ml-2" title={result.terms.join(' · ')}>
                  {result.terms.join(' · ')}
                </span>
              )}
            </div>

            <div className="max-h-80 overflow-y-auto">
              {loading && (
                <div className="flex items-center gap-2 px-4 py-6 text-sm text-slate-500 justify-center">
                  <Loader2 className="w-4 h-4 animate-spin" /> Searching Drive…
                </div>
              )}

              {!loading && error && (
                <div className="flex items-start gap-2 px-4 py-4 text-xs text-red-700">
                  <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" /> {error}
                </div>
              )}

              {!loading && !error && result && result.connected === false && (
                <div className="px-4 py-4 text-xs text-slate-500">
                  No Google account is connected. Connect Google Drive in <span className="font-medium">Settings</span> to search for documents.
                </div>
              )}

              {!loading && !error && result?.connected && result.files.length === 0 && (
                <div className="px-4 py-4 text-xs text-slate-500">
                  No matching documents found in Drive for this property.
                </div>
              )}

              {!loading && !error && result?.files?.map(f => (
                <a
                  key={f.id}
                  href={f.webViewLink}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-2.5 px-4 py-2.5 hover:bg-slate-50 border-b border-slate-50 last:border-0 group"
                >
                  {f.iconLink
                    ? <img src={f.iconLink} alt="" className="w-4 h-4 shrink-0" onError={e => { e.currentTarget.style.display = 'none' }} />
                    : <FileText className="w-4 h-4 text-slate-400 shrink-0" />}
                  <span className="flex-1 min-w-0">
                    <span className="block text-sm text-slate-700 truncate">{f.name}</span>
                    {f.modifiedTime && <span className="block text-[11px] text-slate-400">Modified {fmtDate(f.modifiedTime)}</span>}
                  </span>
                  <ExternalLink className="w-3.5 h-3.5 text-slate-300 group-hover:text-blue-500 shrink-0" />
                </a>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  )
}
