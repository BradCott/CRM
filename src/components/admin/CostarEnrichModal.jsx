// Enrich from CoStar — upload a CoStar export, match rows to properties by
// address, and fill year built / building size / land area / type / construction.
// Two-step: preview (proposed changes, conflicts highlighted) → apply the ones
// you keep. Never a silent overwrite: existing values that differ show old → new.
import { useState } from 'react'
import { X, Loader2, Upload, CheckCircle, AlertTriangle, Building2 } from 'lucide-react'
import Button from '../ui/Button'
import { costarEnrichPreview, costarEnrichApply } from '../../api/client'

const LABELS = { year_built: 'Year Built', building_size: 'Building Size', land_area: 'Land Area', property_type: 'Property Type', construction_type: 'Construction' }
const fmt = (field, v) =>
  v == null || v === '' ? '—'
  : field === 'building_size' ? `${Number(v).toLocaleString()} sf`
  : field === 'land_area' ? `${Number(v).toLocaleString()} ac`
  : String(v)

export default function CostarEnrichModal({ onClose, onApplied }) {
  const [file, setFile]       = useState(null)
  const [loading, setLoading] = useState(false)
  const [preview, setPreview] = useState(null)   // { detected, matched, unmatched, total }
  const [include, setInclude] = useState(() => new Set())
  const [applying, setApplying] = useState(false)
  const [result, setResult]   = useState(null)
  const [error, setError]     = useState(null)
  const [showUnmatched, setShowUnmatched] = useState(false)

  const runPreview = async (f) => {
    setFile(f); setLoading(true); setError(null); setPreview(null)
    try {
      const p = await costarEnrichPreview(f)
      setPreview(p)
      setInclude(new Set(p.matched.map(m => m.property_id)))   // all in by default
    } catch (e) { setError(e.message || 'Could not read the file') }
    finally { setLoading(false) }
  }

  const apply = async () => {
    const changes = preview.matched
      .filter(m => include.has(m.property_id))
      .map(m => ({ property_id: m.property_id, fields: Object.fromEntries(Object.entries(m.fields).map(([k, v]) => [k, v.val])) }))
    if (!changes.length) { setError('Nothing selected to apply'); return }
    setApplying(true); setError(null)
    try {
      const r = await costarEnrichApply(changes)
      setResult(r)
      onApplied?.()
    } catch (e) { setError(e.message || 'Apply failed'); setApplying(false) }
  }

  const conflicts = preview ? preview.matched.filter(m => Object.values(m.fields).some(f => f.conflict)).length : 0
  const selected = preview ? preview.matched.filter(m => include.has(m.property_id)).length : 0

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-3xl h-[88vh] flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100 shrink-0">
          <div className="flex items-center gap-2">
            <Building2 className="w-5 h-5 text-blue-600" />
            <h3 className="text-base font-semibold text-slate-900">Enrich from CoStar</h3>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600"><X className="w-5 h-5" /></button>
        </div>

        {result ? (
          <div className="flex-1 flex flex-col items-center justify-center gap-3 text-center px-5">
            <CheckCircle className="w-10 h-10 text-emerald-500" />
            <p className="text-lg font-semibold text-slate-900">Updated {result.updated} propert{result.updated === 1 ? 'y' : 'ies'}</p>
            <p className="text-sm text-slate-500">{result.fields_set} field{result.fields_set === 1 ? '' : 's'} filled from the CoStar export.</p>
            <Button onClick={onClose} className="mt-2">Done</Button>
          </div>
        ) : !preview ? (
          <div className="flex-1 flex flex-col items-center justify-center gap-4 px-6">
            <label className="w-full max-w-md border-2 border-dashed border-slate-200 rounded-2xl p-8 text-center cursor-pointer hover:border-blue-300 hover:bg-blue-50/40 transition-colors">
              <input type="file" accept=".csv,.xlsx,.xls" className="hidden"
                onChange={e => { const f = e.target.files?.[0]; if (f) runPreview(f) }} />
              {loading ? (
                <div className="flex flex-col items-center gap-2 text-slate-500"><Loader2 className="w-7 h-7 animate-spin" /> Matching to your properties…</div>
              ) : (
                <div className="flex flex-col items-center gap-2 text-slate-500">
                  <Upload className="w-8 h-8 text-slate-400" />
                  <p className="text-sm font-medium text-slate-700">Drop a CoStar export (CSV or Excel)</p>
                  <p className="text-xs text-slate-400">It'll match on address and fill year built, building size, land area, property type & construction.</p>
                </div>
              )}
            </label>
            {error && <p className="text-sm text-red-600 flex items-center gap-1.5"><AlertTriangle className="w-4 h-4" /> {error}</p>}
          </div>
        ) : (
          <div className="flex-1 min-h-0 flex flex-col">
            <div className="px-5 py-3 border-b border-slate-100 shrink-0 flex items-center justify-between flex-wrap gap-2">
              <div className="text-sm text-slate-600 flex items-center gap-x-1.5 flex-wrap">
                <span className="text-slate-400">{preview.counts.total.toLocaleString()} rows:</span>
                <span className="font-semibold text-emerald-700">{preview.counts.to_update.toLocaleString()} to update</span>
                {conflicts > 0 && <span className="text-amber-600">· {conflicts} overwrite existing</span>}
                {preview.counts.already_current > 0 && <span className="text-slate-500">· {preview.counts.already_current.toLocaleString()} already current / blank</span>}
                {preview.counts.unmatched > 0 && <span className="text-slate-500">· <button onClick={() => setShowUnmatched(s => !s)} className="underline hover:text-slate-700">{preview.counts.unmatched.toLocaleString()} not found</button></span>}
              </div>
              <div className="text-xs text-slate-400">Mapped: {preview.detected.map(d => LABELS[d.field]).join(', ')}</div>
            </div>

            {showUnmatched && preview.unmatched.length > 0 && (
              <div className="px-5 py-2 bg-slate-50 border-b border-slate-100 shrink-0 max-h-44 overflow-y-auto">
                <div className="flex items-center justify-between mb-1 sticky top-0 bg-slate-50 py-0.5">
                  <p className="text-[11px] font-semibold text-slate-400 uppercase">Not found in your CRM by address ({preview.unmatched.length})</p>
                  <button onClick={() => navigator.clipboard?.writeText(preview.unmatched.join('\n'))} className="text-[11px] text-blue-600 hover:underline">Copy list</button>
                </div>
                {preview.unmatched.map((u, i) => <p key={i} className="text-xs text-slate-500">{u}</p>)}
              </div>
            )}

            <div className="flex-1 overflow-y-auto px-5 py-3 space-y-2">
              {preview.matched.length === 0 && <p className="text-sm text-slate-400 text-center py-8">No changes — every matched property already has these values.</p>}
              {preview.matched.map(m => {
                const on = include.has(m.property_id)
                return (
                  <div key={m.property_id} className={`border rounded-lg px-3 py-2.5 ${on ? 'border-slate-200' : 'border-slate-100 opacity-50'}`}>
                    <div className="flex items-start gap-2.5">
                      <input type="checkbox" checked={on} className="mt-1 rounded border-slate-300"
                        onChange={e => setInclude(s => { const n = new Set(s); e.target.checked ? n.add(m.property_id) : n.delete(m.property_id); return n })} />
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium text-slate-800 truncate">{m.address}</p>
                        <p className="text-xs text-slate-400">{[m.city, m.state].filter(Boolean).join(', ')}</p>
                        <div className="flex flex-wrap gap-1.5 mt-1.5">
                          {Object.entries(m.fields).map(([field, v]) => (
                            <span key={field} className={`text-xs rounded px-2 py-0.5 border ${v.conflict ? 'bg-amber-50 border-amber-200 text-amber-800' : 'bg-emerald-50 border-emerald-200 text-emerald-700'}`}>
                              <span className="text-slate-500">{LABELS[field]}:</span>{' '}
                              {v.conflict ? <><span className="line-through text-slate-400">{fmt(field, v.old)}</span> → <span className="font-medium">{fmt(field, v.val)}</span></> : <span className="font-medium">{fmt(field, v.val)}</span>}
                            </span>
                          ))}
                        </div>
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>

            {error && <p className="px-5 text-sm text-red-600 flex items-center gap-1.5"><AlertTriangle className="w-4 h-4" /> {error}</p>}

            <div className="flex items-center justify-between gap-2 px-5 py-4 border-t border-slate-100 shrink-0">
              <p className="text-xs text-slate-400">Amber = overwriting an existing value. Uncheck any you want to skip.</p>
              <div className="flex items-center gap-2">
                <button onClick={() => setPreview(null)} className="text-sm font-medium text-slate-500 hover:text-slate-700 px-3 py-2">Back</button>
                <Button onClick={apply} disabled={applying || selected === 0}>
                  {applying ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle className="w-4 h-4" />} Apply to {selected}
                </Button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
