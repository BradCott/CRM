import { useState, useRef } from 'react'
import { Upload, X, Loader2, Check, Pencil, Link, AlertCircle, UserPlus } from 'lucide-react'
import { uploadInvestorContributions, saveInvestors, confirmInvestorMatch, createInvestor } from '../../api/client'

const CLASSES = ['Investor', 'Sponsor']

function fmt$(v) {
  if (v === null || v === undefined || v === '') return '—'
  return '$' + Number(v).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })
}

export default function InvestorUpload({ propertyId, onSaved, onClose }) {
  const fileRef = useRef(null)

  // step: 'upload' | 'parsing' | 'review' | 'saving' | 'done' | 'match_review'
  const [step, setStep]           = useState('upload')
  const [error, setError]         = useState(null)
  const [investors, setInvestors]   = useState([])  // review rows
  const [editIdx, setEditIdx]     = useState(null)  // which row is being edited inline
  const [matchResults, setMatchResults] = useState(null)  // { linked, needs_review, new_profiles }
  const [propertyId_, setPropertyId_] = useState(null)  // stored for confirm-match calls

  // ── Upload & parse ──────────────────────────────────────────────────────────
  async function handleFile(file) {
    if (!file) return
    setError(null)
    setStep('parsing')
    try {
      const result = await uploadInvestorContributions(propertyId, file)
      if (!result.investors?.length) {
        setError('No investor data found in this file. Check that it contains investor names and contribution amounts.')
        setStep('upload')
        return
      }
      setInvestors(result.investors.map((inv, i) => ({ ...inv, _id: i })))
      setStep('review')
    } catch (err) {
      setError(err.message)
      setStep('upload')
    }
  }

  function handleDrop(e) {
    e.preventDefault()
    const file = e.dataTransfer.files[0]
    if (file) handleFile(file)
  }

  // ── Inline editing ──────────────────────────────────────────────────────────
  function updateInvestor(idx, field, value) {
    setInvestors(prev => prev.map((inv, i) => i === idx ? { ...inv, [field]: value } : inv))
  }

  function removeInvestor(idx) {
    setInvestors(prev => prev.filter((_, i) => i !== idx))
  }

  // ── Save ────────────────────────────────────────────────────────────────────
  async function handleSave() {
    setError(null)
    setStep('saving')
    try {
      const result = await saveInvestors(propertyId, investors.map(({ _id, ...inv }) => ({
        ...inv,
        contribution:     parseFloat(inv.contribution) || 0,
        percentage:       inv.percentage !== '' && inv.percentage !== null ? parseFloat(inv.percentage) : null,
        preferred_return: inv.preferred_return !== '' && inv.preferred_return !== null ? parseFloat(inv.preferred_return) : null,
      })))

      // Show match review if anything needs attention, otherwise done
      const mr = result?.match_results
      if (mr && mr.needs_review?.length > 0) {
        setMatchResults(mr)
        setPropertyId_(propertyId)
        setStep('match_review')
      } else {
        setMatchResults(mr)
        setStep('done')
        setTimeout(() => { onSaved(); onClose() }, 1200)
      }
    } catch (err) {
      setError(err.message)
      setStep('review')
    }
  }

  async function handleConfirmMatch(item) {
    try {
      await confirmInvestorMatch({
        investor_id:          item.investor_id,
        property_id:          propertyId_,
        contribution:         item.contribution,
        preferred_return_rate: item.preferred_return,
      })
      setMatchResults(prev => ({
        ...prev,
        linked:       [...(prev.linked || []), { ...item, status: 'confirmed' }],
        needs_review: prev.needs_review.filter(r => r.investor_id !== item.investor_id || r.name !== item.name),
      }))
    } catch (e) {
      console.error('Confirm match failed:', e.message)
    }
  }

  async function handleRejectMatch(item) {
    // Create a new stub profile instead
    try {
      await createInvestor({ name: item.name, is_incomplete: 1 })
    } catch (e) { /* ignore */ }
    setMatchResults(prev => ({
      ...prev,
      new_profiles: [...(prev.new_profiles || []), { name: item.name }],
      needs_review: prev.needs_review.filter(r => r.investor_id !== item.investor_id || r.name !== item.name),
    }))
  }

  function handleMatchDone() {
    onSaved()
    onClose()
  }

  // ── Render ──────────────────────────────────────────────────────────────────
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-5xl max-h-[90vh] flex flex-col">

        {/* Header */}
        <div className="flex items-center justify-between px-6 pt-5 pb-4 border-b border-slate-200 shrink-0">
          <div>
            <h2 className="text-base font-semibold text-slate-900">Investor Contributions Upload</h2>
            <p className="text-xs text-slate-500 mt-0.5">
              {step === 'upload'       && 'Upload an Excel file with investor details'}
              {step === 'parsing'      && 'Extracting investor data…'}
              {step === 'review'       && `Review ${investors.length} investor${investors.length !== 1 ? 's' : ''} before saving`}
              {step === 'saving'       && 'Saving…'}
              {step === 'match_review' && 'Review investor profile matches'}
              {step === 'done'         && 'Saved!'}
            </p>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-400 hover:text-slate-600 transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-6 py-5">

          {error && (
            <div className="mb-4 px-4 py-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
              {error}
            </div>
          )}

          {/* Upload step */}
          {(step === 'upload' || step === 'parsing') && (
            <div
              onDrop={handleDrop}
              onDragOver={e => e.preventDefault()}
              className="border-2 border-dashed border-slate-300 hover:border-blue-400 rounded-xl p-12 text-center cursor-pointer transition-colors"
              onClick={() => step === 'upload' && fileRef.current?.click()}
            >
              <input
                ref={fileRef}
                type="file"
                accept=".xlsx,.xls,.csv"
                className="hidden"
                onChange={e => handleFile(e.target.files[0])}
              />
              {step === 'parsing' ? (
                <div className="flex flex-col items-center gap-3">
                  <Loader2 className="w-8 h-8 text-blue-500 animate-spin" />
                  <p className="text-sm text-slate-600 font-medium">Analyzing with AI…</p>
                  <p className="text-xs text-slate-400">This usually takes a few seconds</p>
                </div>
              ) : (
                <div className="flex flex-col items-center gap-3">
                  <div className="w-12 h-12 rounded-full bg-blue-50 flex items-center justify-center">
                    <Upload className="w-6 h-6 text-blue-500" />
                  </div>
                  <div>
                    <p className="text-sm font-medium text-slate-700">Drop Excel file here or click to browse</p>
                    <p className="text-xs text-slate-400 mt-1">.xlsx, .xls, or .csv — investor name, contribution, and ownership percentage</p>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Review step */}
          {step === 'review' && investors.length > 0 && (
            <div>
              <p className="text-xs text-slate-500 mb-3">
                Click <Pencil className="inline w-3 h-3" /> to edit any field. Remove rows that should not be saved.
              </p>
              <table className="w-full text-sm border-collapse">
                <thead>
                  <tr className="bg-slate-50 border-y border-slate-200">
                    {['Name', 'Address', 'Contribution', 'Ownership %', 'Class', 'Pref. Return %', ''].map(h => (
                      <th key={h} className="px-3 py-2.5 text-left text-xs font-semibold text-slate-500 uppercase tracking-wide first:pl-4 last:pr-4">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {investors.map((inv, idx) => (
                    editIdx === idx
                      ? <EditRow key={inv._id} inv={inv} onChange={(f, v) => updateInvestor(idx, f, v)} onDone={() => setEditIdx(null)} />
                      : <ReadRow key={inv._id} inv={inv} onEdit={() => setEditIdx(idx)} onRemove={() => removeInvestor(idx)} />
                  ))}
                </tbody>
              </table>

              {/* Totals row */}
              <div className="mt-4 flex items-center gap-6 px-2 py-3 bg-slate-50 rounded-lg border border-slate-200">
                <span className="text-xs font-semibold text-slate-600 uppercase tracking-wide">Totals</span>
                <span className="text-sm font-bold text-slate-900">
                  {investors.length} investor{investors.length !== 1 ? 's' : ''}
                </span>
                <span className="text-sm font-bold text-emerald-700">
                  {fmt$(investors.reduce((s, i) => s + (parseFloat(i.contribution) || 0), 0))} total equity
                </span>
                <span className="text-sm text-slate-600">
                  {investors.reduce((s, i) => s + (parseFloat(i.percentage) || 0), 0).toFixed(1)}% total ownership
                </span>
              </div>
            </div>
          )}

          {/* Match Review */}
          {step === 'match_review' && matchResults && (
            <div className="space-y-4">
              {/* Auto-linked */}
              {matchResults.linked?.length > 0 && (
                <div className="px-4 py-3 bg-emerald-50 border border-emerald-200 rounded-xl">
                  <div className="flex items-center gap-2 mb-2">
                    <Link className="w-4 h-4 text-emerald-600" />
                    <span className="text-sm font-semibold text-emerald-800">
                      {matchResults.linked.length} investor{matchResults.linked.length !== 1 ? 's' : ''} linked automatically
                    </span>
                  </div>
                  <ul className="space-y-1">
                    {matchResults.linked.map((item, i) => (
                      <li key={i} className="text-xs text-emerald-700">
                        <span className="font-medium">{item.name}</span>
                        {item.matched_name && item.matched_name !== item.name && (
                          <span className="text-emerald-500 ml-1">→ {item.matched_name}</span>
                        )}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Needs review */}
              {matchResults.needs_review?.length > 0 && (
                <div className="px-4 py-3 bg-amber-50 border border-amber-200 rounded-xl">
                  <div className="flex items-center gap-2 mb-3">
                    <AlertCircle className="w-4 h-4 text-amber-500" />
                    <span className="text-sm font-semibold text-amber-800">
                      {matchResults.needs_review.length} uncertain match{matchResults.needs_review.length !== 1 ? 'es' : ''} — confirm or create new profile
                    </span>
                  </div>
                  <div className="space-y-2">
                    {matchResults.needs_review.map((item, i) => (
                      <div key={i} className="bg-white rounded-lg border border-amber-100 px-3 py-2.5 flex items-center justify-between gap-4">
                        <div>
                          <p className="text-sm font-medium text-slate-800">{item.name}</p>
                          <p className="text-xs text-slate-500">
                            Possible match: <span className="font-medium text-slate-700">{item.matched_name}</span>
                            <span className="ml-1 text-slate-400">({Math.round(item.score * 100)}% similar)</span>
                          </p>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          <button
                            onClick={() => handleConfirmMatch(item)}
                            className="text-xs px-3 py-1 bg-emerald-500 text-white rounded-lg hover:bg-emerald-600 font-semibold"
                          >
                            Use existing
                          </button>
                          <button
                            onClick={() => handleRejectMatch(item)}
                            className="text-xs px-3 py-1 bg-slate-100 text-slate-700 rounded-lg hover:bg-slate-200 font-medium"
                          >
                            New profile
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* New profiles */}
              {matchResults.new_profiles?.length > 0 && (
                <div className="px-4 py-3 bg-blue-50 border border-blue-200 rounded-xl">
                  <div className="flex items-center gap-2 mb-2">
                    <UserPlus className="w-4 h-4 text-blue-600" />
                    <span className="text-sm font-semibold text-blue-800">
                      {matchResults.new_profiles.length} new investor profile{matchResults.new_profiles.length !== 1 ? 's' : ''} created
                    </span>
                  </div>
                  <ul className="space-y-1">
                    {matchResults.new_profiles.map((item, i) => (
                      <li key={i} className="text-xs text-blue-700 font-medium">{item.name}</li>
                    ))}
                  </ul>
                  <p className="text-xs text-blue-600 mt-2">These profiles are incomplete. Visit the Investors page to add contact details.</p>
                </div>
              )}
            </div>
          )}

          {/* Done */}
          {step === 'done' && (
            <div className="space-y-4">
              <div className="flex flex-col items-center justify-center py-8 gap-3">
                <div className="w-12 h-12 rounded-full bg-emerald-100 flex items-center justify-center">
                  <Check className="w-6 h-6 text-emerald-600" />
                </div>
                <p className="text-sm font-medium text-slate-700">Investors saved successfully</p>
              </div>
              {/* Quick match summary on done screen (no needs_review) */}
              {matchResults && (matchResults.linked?.length > 0 || matchResults.new_profiles?.length > 0) && (
                <div className="px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-600 space-y-1">
                  {matchResults.linked?.length > 0 && (
                    <p><span className="font-semibold text-emerald-700">{matchResults.linked.length}</span> matched to existing investor profiles</p>
                  )}
                  {matchResults.new_profiles?.length > 0 && (
                    <p><span className="font-semibold text-blue-700">{matchResults.new_profiles.length}</span> new stub profiles created — complete them in the Investors page</p>
                  )}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        {step === 'review' && (
          <div className="px-6 py-4 border-t border-slate-200 flex justify-end gap-3 shrink-0">
            <button onClick={onClose}
              className="px-4 py-2 text-sm font-medium text-slate-600 bg-slate-100 hover:bg-slate-200 rounded-xl transition-colors">
              Cancel
            </button>
            <button onClick={handleSave} disabled={investors.length === 0}
              className="px-5 py-2 text-sm font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-xl transition-colors disabled:opacity-40">
              Save {investors.length} Investor{investors.length !== 1 ? 's' : ''}
            </button>
          </div>
        )}

        {step === 'match_review' && matchResults && (
          <div className="px-6 py-4 border-t border-slate-200 flex items-center justify-between shrink-0">
            <p className="text-xs text-slate-400">
              {matchResults.needs_review?.length > 0
                ? 'Resolve the uncertain matches above, then click Done.'
                : 'All matches resolved.'}
            </p>
            <button
              onClick={handleMatchDone}
              disabled={matchResults.needs_review?.length > 0}
              className="px-5 py-2 text-sm font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-xl transition-colors disabled:opacity-40"
            >
              Done
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

function ReadRow({ inv, onEdit, onRemove }) {
  return (
    <tr className="border-b border-slate-100 hover:bg-slate-50/60">
      <td className="px-3 py-3 pl-4 font-medium text-slate-900">{inv.name}</td>
      <td className="px-3 py-3 text-slate-500 text-xs max-w-[160px] truncate">{inv.address || '—'}</td>
      <td className="px-3 py-3 font-semibold text-emerald-700 tabular-nums">{fmt$(inv.contribution)}</td>
      <td className="px-3 py-3 text-slate-700 tabular-nums">{inv.percentage != null ? `${inv.percentage}%` : '—'}</td>
      <td className="px-3 py-3">
        <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${
          inv.class === 'Sponsor' ? 'bg-violet-100 text-violet-700' : 'bg-blue-100 text-blue-700'
        }`}>
          {inv.class || 'Investor'}
        </span>
      </td>
      <td className="px-3 py-3 text-slate-700 tabular-nums">{inv.preferred_return != null ? `${inv.preferred_return}%` : '—'}</td>
      <td className="px-3 py-3 pr-4">
        <div className="flex items-center gap-1">
          <button onClick={onEdit} className="p-1 rounded text-slate-300 hover:text-blue-500 hover:bg-blue-50 transition-colors" title="Edit">
            <Pencil className="w-3.5 h-3.5" />
          </button>
          <button onClick={onRemove} className="p-1 rounded text-slate-300 hover:text-red-500 hover:bg-red-50 transition-colors" title="Remove">
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      </td>
    </tr>
  )
}

function EditRow({ inv, onChange, onDone }) {
  const cell = 'px-1 py-1 border border-slate-300 rounded text-sm w-full outline-none focus:ring-2 focus:ring-blue-400'
  return (
    <tr className="border-b border-blue-200 bg-blue-50/40">
      <td className="px-2 py-2 pl-3">
        <input className={cell} value={inv.name} onChange={e => onChange('name', e.target.value)} />
      </td>
      <td className="px-2 py-2">
        <input className={cell} value={inv.address || ''} onChange={e => onChange('address', e.target.value)} placeholder="Address" />
      </td>
      <td className="px-2 py-2">
        <input className={cell} type="number" min="0" value={inv.contribution} onChange={e => onChange('contribution', e.target.value)} />
      </td>
      <td className="px-2 py-2">
        <input className={cell} type="number" min="0" max="100" step="0.01" value={inv.percentage ?? ''} onChange={e => onChange('percentage', e.target.value)} placeholder="%" />
      </td>
      <td className="px-2 py-2">
        <select className={cell} value={inv.class || 'Investor'} onChange={e => onChange('class', e.target.value)}>
          {CLASSES.map(c => <option key={c}>{c}</option>)}
        </select>
      </td>
      <td className="px-2 py-2">
        <input className={cell} type="number" min="0" max="100" step="0.1" value={inv.preferred_return ?? ''} onChange={e => onChange('preferred_return', e.target.value)} placeholder="%" />
      </td>
      <td className="px-2 py-2 pr-3">
        <button onClick={onDone} className="p-1 rounded text-emerald-600 hover:bg-emerald-50 transition-colors" title="Done">
          <Check className="w-4 h-4" />
        </button>
      </td>
    </tr>
  )
}
