// Find duplicate records of a person/company anywhere in the database and merge
// this one into the real entity (e.g. "NetStreit Corp" → the canonical "NETSTREIT"
// that owns many properties and is already DNC).
import { useState, useEffect } from 'react'
import { X, Loader2, GitMerge, Ban, Search, AlertCircle } from 'lucide-react'
import Button from '../ui/Button'
import { getPersonDuplicates, mergePeople } from '../../api/client'

export default function DuplicateFinderModal({ person, onMerged, onClose }) {
  const [loading, setLoading]     = useState(true)
  const [candidates, setCandidates] = useState([])
  const [mergingId, setMergingId] = useState(null)
  const [error, setError]         = useState(null)

  useEffect(() => {
    setLoading(true)
    getPersonDuplicates(person.contact_id)
      .then(d => setCandidates(d.candidates || []))
      .catch(e => setError(e.message))
      .finally(() => setLoading(false))
  }, [person.contact_id])

  // Merge THIS recipient into the chosen canonical record (keep = candidate).
  async function mergeInto(candidate) {
    if (!window.confirm(`Merge "${person.name}" into "${candidate.name}"?\n\n${person.name}'s properties, mail history and contacts move onto ${candidate.name}, then "${person.name}" is deleted.`)) return
    setMergingId(candidate.id)
    setError(null)
    try {
      await mergePeople(candidate.id, [person.contact_id])
      onMerged(person.contact_id, candidate)
    } catch (e) {
      setError(e.message)
      setMergingId(null)
    }
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/40">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[85vh] flex flex-col">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 shrink-0">
          <div className="flex items-center gap-2 min-w-0">
            <Search className="w-4 h-4 text-violet-600 shrink-0" />
            <div className="min-w-0">
              <h2 className="text-base font-semibold text-slate-900 truncate">Find duplicates of “{person.name}”</h2>
              <p className="text-xs text-slate-400">Merge this record into the real entity</p>
            </div>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 shrink-0"><X className="w-5 h-5" /></button>
        </div>

        <div className="px-6 py-4 overflow-y-auto">
          {error && (
            <div className="mb-3 flex items-start gap-2 px-3 py-2 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
              <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />{error}
            </div>
          )}

          {loading ? (
            <div className="flex items-center justify-center py-12 text-slate-400 gap-2">
              <Loader2 className="w-5 h-5 animate-spin" /> Searching the database…
            </div>
          ) : candidates.length === 0 ? (
            <div className="text-center py-10">
              <p className="text-sm text-slate-500">No likely duplicates found.</p>
              <p className="text-xs text-slate-400 mt-1">This looks like a unique record.</p>
            </div>
          ) : (
            <>
              <p className="text-xs text-slate-500 mb-2">
                {candidates.length} possible match{candidates.length !== 1 ? 'es' : ''}. Pick the real entity to merge into — usually the one with the most properties.
              </p>
              <div className="space-y-2">
                {candidates.map(c => (
                  <div key={c.id} className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 px-3 py-2.5 hover:border-violet-300 transition-colors">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-medium text-slate-800">{c.name}</span>
                        {!!c.do_not_contact && (
                          <span className="inline-flex items-center gap-0.5 text-[10px] font-semibold text-red-700 bg-red-50 px-1.5 py-0.5 rounded-full"><Ban className="w-2.5 h-2.5" />DNC</span>
                        )}
                        <span className="text-[10px] text-slate-400">{Math.round(c.score * 100)}% match</span>
                      </div>
                      <p className="text-xs text-slate-400">
                        {c.property_count > 0 ? `${c.property_count.toLocaleString()} propert${c.property_count === 1 ? 'y' : 'ies'}` : 'No properties'}
                        {(c.city || c.state) ? ` · ${[c.city, c.state].filter(Boolean).join(', ')}` : ''}
                      </p>
                    </div>
                    <Button size="sm" variant="secondary" onClick={() => mergeInto(c)} disabled={mergingId !== null}>
                      {mergingId === c.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <><GitMerge className="w-3.5 h-3.5" /> Merge into</>}
                    </Button>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>

        <div className="px-6 py-3 border-t border-slate-100 bg-slate-50 rounded-b-2xl flex justify-end shrink-0">
          <Button variant="secondary" onClick={onClose}>Close</Button>
        </div>
      </div>
    </div>
  )
}
