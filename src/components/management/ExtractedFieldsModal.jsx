import { useState, useEffect } from 'react'
import { X, Loader2, CheckCircle, AlertCircle, Sparkles, UserPlus } from 'lucide-react'
import Button from '../ui/Button'
import { getExtractDiff, applyExtracted } from '../../api/client'

// Review-and-confirm auto-fill. Given the raw JSON a document parser returned,
// this fetches a field-by-field diff (current → proposed) from the server, lets
// the user pick which fields to apply (overwrite), then writes them. A newly
// named tenant is auto-created on apply.

const DOC_LABELS = {
  insurance:  'Insurance Policy',
  tax:        'Tax Bill',
  lease:      'Lease',
  settlement: 'Settlement Statement',
  marketing:  'Marketing Package',
}

function fmtVal(v, type) {
  if (v == null || v === '') return <span className="text-slate-300">—</span>
  if (type === 'currency') {
    const n = Number(v)
    return Number.isFinite(n) ? `$${n.toLocaleString()}` : String(v)
  }
  if (type === 'number') {
    const n = Number(v)
    return Number.isFinite(n) ? n.toLocaleString() : String(v)
  }
  return String(v)
}

export default function ExtractedFieldsModal({ propertyId, docType, data, onApplied, onClose }) {
  const [step, setStep]     = useState('loading') // loading | review | saving
  const [error, setError]   = useState(null)
  const [fields, setFields] = useState([])         // [{ key, label, type, current, proposed }]
  const [tenant, setTenant] = useState(null)       // { name, existingId, isNew, current }
  const [picked, setPicked] = useState({})         // { [key]: bool }
  const [pickTenant, setPickTenant] = useState(false)

  useEffect(() => {
    let alive = true
    ;(async () => {
      try {
        const res = await getExtractDiff(propertyId, docType, data)
        if (!alive) return
        setFields(res.fields || [])
        setTenant(res.tenant || null)
        // Default-check every field whose proposed value differs from current.
        const init = {}
        for (const f of (res.fields || [])) {
          init[f.key] = String(f.current ?? '') !== String(f.proposed ?? '')
        }
        setPicked(init)
        setPickTenant(!!(res.tenant && res.tenant.name && res.tenant.name !== res.tenant.current))
        setStep('review')
      } catch (err) {
        if (alive) { setError(err.message); setStep('review') }
      }
    })()
    return () => { alive = false }
  }, [propertyId, docType, data])

  const selectedCount = Object.values(picked).filter(Boolean).length + (pickTenant && tenant ? 1 : 0)

  async function handleApply() {
    const toApply = {}
    for (const f of fields) if (picked[f.key]) toApply[f.key] = f.proposed
    const tenantName = pickTenant && tenant ? tenant.name : undefined
    if (!Object.keys(toApply).length && !tenantName) { onClose(); return }
    setStep('saving')
    setError(null)
    try {
      await applyExtracted(propertyId, toApply, tenantName)
      onApplied?.()
      onClose()
    } catch (err) {
      setError(err.message)
      setStep('review')
    }
  }

  const hasChanges = fields.length > 0 || tenant

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[92vh] flex flex-col">

        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-blue-50 flex items-center justify-center">
              <Sparkles className="w-4 h-4 text-blue-500" />
            </div>
            <div>
              <h2 className="text-base font-semibold text-slate-900">Auto-fill from {DOC_LABELS[docType] || 'Document'}</h2>
              <p className="text-xs text-slate-500 mt-0.5">Review the fields below, then apply the ones you want.</p>
            </div>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600"><X className="w-5 h-5" /></button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-6 py-5">
          {error && (
            <div className="mb-4 flex items-start gap-2 px-4 py-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
              <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />{error}
            </div>
          )}

          {step === 'loading' ? (
            <div className="py-12 text-center">
              <Loader2 className="w-8 h-8 mx-auto mb-3 text-blue-400 animate-spin" />
              <p className="text-sm text-slate-500">Matching document fields to this property…</p>
            </div>
          ) : !hasChanges ? (
            <div className="py-12 text-center">
              <p className="text-sm text-slate-500">No fillable property details were found in this document.</p>
            </div>
          ) : (
            <div className="overflow-hidden rounded-xl border border-slate-200">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-slate-50 text-[11px] uppercase tracking-wide text-slate-400">
                    <th className="w-10 px-3 py-2"></th>
                    <th className="px-3 py-2 text-left font-medium">Field</th>
                    <th className="px-3 py-2 text-left font-medium">Current</th>
                    <th className="px-3 py-2 text-left font-medium">New</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {tenant && (
                    <tr className="bg-emerald-50/40">
                      <td className="px-3 py-2.5 text-center">
                        <input type="checkbox" checked={pickTenant} onChange={e => setPickTenant(e.target.checked)}
                          className="rounded border-slate-300 text-blue-600 focus:ring-blue-500" />
                      </td>
                      <td className="px-3 py-2.5 font-medium text-slate-700">Tenant</td>
                      <td className="px-3 py-2.5 text-slate-500">
                        {tenant.current || <span className="text-slate-300">—</span>}
                      </td>
                      <td className="px-3 py-2.5">
                        <span className="text-slate-900">{tenant.name}</span>
                        {tenant.isNew && (
                          <span className="ml-2 inline-flex items-center gap-1 text-[10px] font-medium text-emerald-600 bg-emerald-100 rounded px-1.5 py-0.5">
                            <UserPlus className="w-3 h-3" /> New tenant
                          </span>
                        )}
                      </td>
                    </tr>
                  )}
                  {fields.map(f => {
                    const changed = String(f.current ?? '') !== String(f.proposed ?? '')
                    return (
                      <tr key={f.key} className={picked[f.key] ? '' : 'opacity-60'}>
                        <td className="px-3 py-2.5 text-center">
                          <input type="checkbox" checked={!!picked[f.key]}
                            onChange={e => setPicked(p => ({ ...p, [f.key]: e.target.checked }))}
                            className="rounded border-slate-300 text-blue-600 focus:ring-blue-500" />
                        </td>
                        <td className="px-3 py-2.5 font-medium text-slate-700">{f.label}</td>
                        <td className="px-3 py-2.5 text-slate-500">{fmtVal(f.current, f.type)}</td>
                        <td className="px-3 py-2.5">
                          <span className={changed ? 'text-slate-900 font-medium' : 'text-slate-500'}>
                            {fmtVal(f.proposed, f.type)}
                          </span>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="shrink-0 flex items-center justify-between px-6 py-4 border-t border-slate-100 bg-slate-50 rounded-b-2xl">
          <p className="text-xs text-slate-400">
            {selectedCount} field{selectedCount === 1 ? '' : 's'} selected — existing values will be overwritten.
          </p>
          <div className="flex items-center gap-3">
            <button onClick={onClose} className="text-sm text-slate-400 hover:text-slate-600">Skip</button>
            <Button onClick={handleApply} disabled={step === 'saving' || step === 'loading' || selectedCount === 0}>
              {step === 'saving'
                ? <><Loader2 className="w-4 h-4 animate-spin" /> Applying…</>
                : <><CheckCircle className="w-4 h-4" /> Apply {selectedCount || ''}</>
              }
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}
