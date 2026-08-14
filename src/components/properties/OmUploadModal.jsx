// Confirm dialog for uploading an Offering Memorandum from the Market Properties
// page. Parses the OM, then shows whether it matched an existing property (attach)
// or will create a new one — and commits only on confirm.
import { useEffect, useState } from 'react'
import { Loader2, AlertCircle, CheckCircle2, Building2, Plus, Paperclip } from 'lucide-react'
import Modal from '../ui/Modal'
import Button from '../ui/Button'
import { parseOM, commitOM } from '../../api/client'

// Human labels for the extracted fields we preview.
const FIELD_LABELS = {
  address: 'Address', city: 'City', state: 'State', zip: 'ZIP', tenant: 'Tenant',
  property_type: 'Property Type', building_size: 'Building Size', year_built: 'Year Built',
  lease_type: 'Lease Type', lease_end: 'Lease End', annual_rent: 'Annual Rent',
  noi: 'NOI', cap_rate: 'Cap Rate', list_price: 'List Price',
}
const PREVIEW_ORDER = ['address', 'city', 'state', 'tenant', 'property_type', 'list_price', 'cap_rate', 'lease_end']

export default function OmUploadModal({ file, onClose, onDone }) {
  const [phase, setPhase]   = useState('parsing')   // parsing | review | error | committing
  const [result, setResult] = useState(null)        // { extracted, match, action }
  const [error, setError]   = useState(null)

  useEffect(() => {
    let cancelled = false
    setPhase('parsing'); setError(null)
    parseOM(file)
      .then(r => { if (!cancelled) { setResult(r); setPhase('review') } })
      .catch(e => { if (!cancelled) { setError(e.message); setPhase('error') } })
    return () => { cancelled = true }
  }, [file])

  async function handleConfirm() {
    setPhase('committing'); setError(null)
    try {
      const res = await commitOM(file, result.extracted, result.match?.id || null)
      onDone(res)
    } catch (e) {
      setError(e.message); setPhase('review')
    }
  }

  const ex = result?.extracted || {}
  const match = result?.match

  return (
    <Modal isOpen onClose={phase === 'committing' ? undefined : onClose} title="Upload Offering Memorandum" size="md">
      <div className="px-6 py-5 space-y-4">
        <p className="text-xs text-slate-500 flex items-center gap-1.5">
          <Paperclip className="w-3.5 h-3.5 shrink-0" /> {file.name}
        </p>

        {phase === 'parsing' && (
          <div className="flex items-center gap-2 py-6 text-sm text-slate-500">
            <Loader2 className="w-4 h-4 animate-spin" /> Reading the OM and matching it to your properties…
          </div>
        )}

        {phase === 'error' && (
          <div className="flex items-start gap-2 px-3 py-2.5 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
            <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
            <div><p className="font-semibold">Couldn’t process this document</p><p className="text-xs mt-0.5">{error}</p></div>
          </div>
        )}

        {(phase === 'review' || phase === 'committing') && result && (
          <>
            {error && (
              <div className="flex items-start gap-2 px-3 py-2 bg-red-50 border border-red-200 rounded-lg text-xs text-red-700">
                <AlertCircle className="w-3.5 h-3.5 mt-0.5 shrink-0" /> {error}
              </div>
            )}

            {match ? (
              <div className="px-3 py-2.5 bg-blue-50 border border-blue-200 rounded-lg">
                <p className="text-sm font-semibold text-blue-800 flex items-center gap-1.5">
                  <Building2 className="w-4 h-4" /> Matches an existing property
                </p>
                <p className="text-sm text-blue-700 mt-0.5">{match.address}{[match.city, match.state].filter(Boolean).length ? ` · ${[match.city, match.state].filter(Boolean).join(', ')}` : ''}</p>
                <p className="text-xs text-blue-600 mt-1.5">The OM will be attached to it, and any fields that are still blank will be filled from the OM. Existing data is never overwritten.</p>
              </div>
            ) : (
              <div className="px-3 py-2.5 bg-emerald-50 border border-emerald-200 rounded-lg">
                <p className="text-sm font-semibold text-emerald-800 flex items-center gap-1.5">
                  <Plus className="w-4 h-4" /> No match — a new market property will be created
                </p>
                <p className="text-xs text-emerald-700 mt-1.5">Review the details read from the OM below. You can edit anything after it’s created.</p>
              </div>
            )}

            {/* Extracted preview */}
            <div className="border border-slate-200 rounded-lg divide-y divide-slate-100">
              {PREVIEW_ORDER.filter(k => ex[k] != null && ex[k] !== '').map(k => (
                <div key={k} className="flex items-center justify-between gap-3 px-3 py-1.5">
                  <span className="text-xs text-slate-400">{FIELD_LABELS[k] || k}</span>
                  <span className="text-xs font-medium text-slate-800 text-right truncate">{String(ex[k])}</span>
                </div>
              ))}
              {PREVIEW_ORDER.filter(k => ex[k] != null && ex[k] !== '').length === 0 && (
                <div className="px-3 py-2 text-xs text-slate-400">No fields could be read from the document.</div>
              )}
            </div>

            <div className="flex justify-end gap-2 pt-1">
              <Button type="button" variant="secondary" onClick={onClose} disabled={phase === 'committing'}>Cancel</Button>
              <Button type="button" onClick={handleConfirm} disabled={phase === 'committing'}>
                {phase === 'committing'
                  ? <><Loader2 className="w-4 h-4 mr-1.5 animate-spin" /> Saving…</>
                  : match ? <><Paperclip className="w-4 h-4 mr-1.5" /> Attach to this property</>
                          : <><Plus className="w-4 h-4 mr-1.5" /> Create property & attach</>}
              </Button>
            </div>
          </>
        )}
      </div>
    </Modal>
  )
}
