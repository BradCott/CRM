// "Find Drive Docs" — locates the property's Drive folder (Brand - City) and
// lists its documents (recursively, with subfolder path). Falls back to a keyword
// search if no folder is found; lets you re-scan if it picked the wrong folder.
import { useState } from 'react'
import { FolderSearch, Loader2, ExternalLink, AlertCircle, FileText, Folder, RefreshCw, Download, ChevronDown } from 'lucide-react'
import { getPropertyDriveDocs } from '../../api/client'

// Which importers make sense for a file, by extension.
const IMPORT_TARGETS = [
  { key: 'settlement', label: 'Settlement Statement', exts: ['pdf'] },
  { key: 'amortization', label: 'Amortization Schedule', exts: ['pdf', 'xlsx', 'xls', 'csv'] },
  { key: 'investors', label: 'Investor Contributions', exts: ['xlsx', 'xls', 'csv'] },
]
const extOf = (name = '') => (name.split('.').pop() || '').toLowerCase()

function fmtDate(iso) {
  if (!iso) return ''
  try { return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) }
  catch { return '' }
}

export default function DriveDocsButton({ propertyId, className = '', onImport }) {
  const [open, setOpen]       = useState(false)
  const [loading, setLoading] = useState(false)
  const [result, setResult]   = useState(null)   // { connected, folder, files, matched, terms }
  const [error, setError]     = useState(null)
  const [menuId, setMenuId]   = useState(null)    // file id whose import menu is open

  async function run(rematch = false) {
    setOpen(true)
    setLoading(true)
    setError(null)
    try {
      setResult(await getPropertyDriveDocs(propertyId, rematch))
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  const folder = result?.folder
  const files  = result?.files || []

  return (
    <div className={`relative ${className}`}>
      <button
        onClick={() => (open ? setOpen(false) : run(false))}
        className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-600 border border-slate-200 rounded-lg px-3 py-1.5 hover:bg-slate-50 transition-colors"
        title="Find this property's folder in Google Drive and list its documents"
      >
        <FolderSearch className="w-3.5 h-3.5" /> Find Drive Docs
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-30" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-9 z-40 w-[26rem] max-w-[92vw] bg-white border border-slate-200 rounded-xl shadow-lg overflow-hidden">
            {/* Header — matched folder (or keyword-search note) */}
            <div className="px-4 py-2.5 border-b border-slate-100">
              {folder ? (
                <div className="flex items-center justify-between gap-2">
                  <a href={folder.webViewLink} target="_blank" rel="noopener noreferrer"
                    className="flex items-center gap-1.5 min-w-0 text-sm font-medium text-slate-800 hover:text-blue-600">
                    <Folder className="w-4 h-4 text-amber-500 shrink-0" />
                    <span className="truncate">{folder.name}</span>
                  </a>
                  <button onClick={() => run(true)} title="Wrong folder? Re-scan Drive"
                    className="flex items-center gap-1 text-[11px] text-slate-400 hover:text-slate-600 shrink-0">
                    <RefreshCw className="w-3 h-3" /> Re-scan
                  </button>
                </div>
              ) : (
                <span className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Drive Documents</span>
              )}
              {folder && <p className="text-[11px] text-slate-400 mt-0.5">{files.length} file{files.length !== 1 ? 's' : ''} in this property folder</p>}
            </div>

            <div className="max-h-80 overflow-y-auto">
              {loading && (
                <div className="flex items-center gap-2 px-4 py-6 text-sm text-slate-500 justify-center">
                  <Loader2 className="w-4 h-4 animate-spin" /> {result?.folder ? 'Re-scanning…' : 'Finding the property folder…'}
                </div>
              )}

              {!loading && error && (
                <div className="flex items-start gap-2 px-4 py-4 text-xs text-red-700">
                  <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" /> {error}
                </div>
              )}

              {!loading && !error && result?.connected === false && (
                <div className="px-4 py-4 text-xs text-slate-500">
                  No Google account is connected. Connect Google Drive in <span className="font-medium">Settings</span> first.
                </div>
              )}

              {!loading && !error && result?.connected && !folder && (
                <div className="px-4 py-3 text-xs text-amber-700 bg-amber-50 border-b border-amber-100">
                  Couldn't find a matching property folder, so this is a keyword search. Check the folder is named like <span className="font-medium">"{result?.terms?.[0] || 'Brand - City'}"</span> under Current Properties, then Re-scan.
                </div>
              )}

              {!loading && !error && result?.connected && files.length === 0 && (
                <div className="px-4 py-4 text-xs text-slate-500">This folder is empty (or nothing readable was found).</div>
              )}

              {!loading && !error && files.map(f => {
                const targets = onImport ? IMPORT_TARGETS.filter(t => t.exts.includes(extOf(f.name))) : []
                return (
                  <div key={f.id} className="flex items-center gap-2.5 px-4 py-2 hover:bg-slate-50 border-b border-slate-50 last:border-0 relative">
                    {f.iconLink
                      ? <img src={f.iconLink} alt="" className="w-4 h-4 shrink-0" onError={e => { e.currentTarget.style.display = 'none' }} />
                      : <FileText className="w-4 h-4 text-slate-400 shrink-0" />}
                    <a href={f.webViewLink} target="_blank" rel="noopener noreferrer" className="flex-1 min-w-0 group">
                      <span className="block text-sm text-slate-700 truncate group-hover:text-blue-600">{f.name}</span>
                      <span className="block text-[11px] text-slate-400 truncate">
                        {f.folderPath ? `📁 ${f.folderPath}` : ''}{f.folderPath && f.modifiedTime ? ' · ' : ''}{f.modifiedTime ? fmtDate(f.modifiedTime) : ''}
                      </span>
                    </a>
                    {targets.length > 0 ? (
                      <div className="relative shrink-0">
                        <button onClick={() => setMenuId(menuId === f.id ? null : f.id)}
                          className="inline-flex items-center gap-0.5 text-[11px] font-medium text-blue-600 border border-blue-200 rounded-md px-1.5 py-1 hover:bg-blue-50">
                          <Download className="w-3 h-3" /> Import <ChevronDown className="w-2.5 h-2.5" />
                        </button>
                        {menuId === f.id && (
                          <div className="absolute right-0 top-8 z-50 w-52 bg-white border border-slate-200 rounded-lg shadow-lg py-1">
                            {targets.map(t => (
                              <button key={t.key}
                                onClick={() => { setMenuId(null); setOpen(false); onImport(t.key, { id: f.id, name: f.name }) }}
                                className="w-full text-left px-3 py-1.5 text-xs text-slate-700 hover:bg-slate-50">
                                → {t.label}
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    ) : (
                      <a href={f.webViewLink} target="_blank" rel="noopener noreferrer" className="shrink-0">
                        <ExternalLink className="w-3.5 h-3.5 text-slate-300 hover:text-blue-500" />
                      </a>
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        </>
      )}
    </div>
  )
}
