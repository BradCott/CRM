import { useEffect, useState, useRef } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import {
  ArrowLeft, Loader2, Building2, CalendarDays, DollarSign, User, Link2, FileText,
  TrendingUp, Sparkles, ScrollText, AlertCircle, CheckCircle2, Pencil,
} from 'lucide-react'
import { useApp } from '../../context/AppContext'
import { getDeal, updateDealField, parseDealDoc } from '../../api/client'
import ReturnsCalculator from './ReturnsCalculator'

const STAGE_LABELS = {
  loi:             { label: 'LOI',             cls: 'bg-blue-100 text-blue-700' },
  psa_negotiation: { label: 'PSA Negotiation', cls: 'bg-amber-100 text-amber-700' },
  under_contract:  { label: 'Under Contract',  cls: 'bg-violet-100 text-violet-700' },
  money_hard:      { label: 'Money Hard',      cls: 'bg-green-100 text-green-700' },
}

const fmt$    = v => v == null || v === '' ? null : '$' + Math.round(Number(v)).toLocaleString()
const fmtPct  = v => v == null || v === '' ? null : `${Number(v).toFixed(2)}%`
const fmtNum  = v => v == null || v === '' ? null : Number(v).toLocaleString()
const fmtDate = v => { if (!v) return null; const m = String(v).match(/^(\d{4})-(\d{2})-(\d{2})/); return m ? `${m[2]}/${m[3]}/${m[1]}` : v }

function formatEditable(type, v) {
  if (v == null || v === '') return null
  switch (type) {
    case 'currency': return fmt$(v)
    case 'date':     return fmtDate(v)
    case 'sqft':     return `${fmtNum(v)} sf`
    case 'percent':  return fmtPct(v)
    default:         return v
  }
}

export default function DealDetailPage() {
  const { dealId } = useParams()
  const navigate = useNavigate()
  const { deals } = useApp()
  const [deal, setDeal]         = useState(() => deals.find(d => String(d.id) === dealId) || null)
  const [loading, setLoading]   = useState(!deal)
  const [notFound, setNotFound] = useState(false)
  const [savingField, setSavingField] = useState(null)
  const [saveError, setSaveError]     = useState(null)

  // Document parser (auto-fill)
  const [busyDoc, setBusyDoc]   = useState(null)   // 'om' | 'lease'
  const [dragDoc, setDragDoc]   = useState(null)
  const [docError, setDocError] = useState(null)
  const [applied, setApplied]   = useState(null)   // { docType, count }
  const omRef    = useRef(null)
  const leaseRef = useRef(null)

  useEffect(() => {
    let alive = true
    getDeal(dealId)
      .then(d => { if (alive) { setDeal(d); setLoading(false) } })
      .catch(() => { if (alive) { setLoading(false); setNotFound(true) } })
    return () => { alive = false }
  }, [dealId])

  async function saveField(column, value) {
    setSavingField(column); setSaveError(null)
    setDeal(d => ({ ...d, [column]: value }))
    try {
      const row = await updateDealField(dealId, column, value)
      setDeal(row)
    } catch (err) {
      setSaveError(err.message)
      getDeal(dealId).then(setDeal).catch(() => {})
    } finally {
      setSavingField(null)
    }
  }

  async function handleDoc(docType, fileList) {
    const files = Array.from(fileList || []).filter(Boolean)
    if (!files.length) return
    setBusyDoc(docType); setDocError(null); setApplied(null)
    try {
      const { deal: updated, applied: cols } = await parseDealDoc(dealId, docType, files)
      setDeal(updated)
      setApplied({ docType, count: cols.length })
    } catch (err) {
      setDocError(err.message)
    } finally {
      setBusyDoc(null)
    }
  }

  if (loading) return (
    <div className="flex-1 flex items-center justify-center py-20"><Loader2 className="w-6 h-6 text-slate-400 animate-spin" /></div>
  )
  if (notFound || !deal) return (
    <div className="flex-1 flex flex-col items-center justify-center py-20 gap-3">
      <p className="text-sm text-slate-500">Deal not found.</p>
      <button onClick={() => navigate('/pipeline')} className="text-sm text-blue-600 hover:underline">← Back to pipeline</button>
    </div>
  )

  const stage = STAGE_LABELS[deal.stage]
  const impliedNOI = deal.noi || (deal.purchase_price && deal.cap_rate ? deal.purchase_price * (deal.cap_rate / 100) : null)
  const cityState = [deal.city, deal.state].filter(Boolean).join(', ')
  let abstract = null
  try { abstract = deal.lease_abstract ? JSON.parse(deal.lease_abstract) : null } catch { abstract = null }
  const efProps = { save: saveField, saving: savingField }

  return (
    <div className="flex-1 overflow-y-auto bg-slate-50">
      <div className="max-w-6xl mx-auto px-6 py-6 space-y-5">
        {/* Header */}
        <div>
          <button onClick={() => navigate('/pipeline')} className="flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-800 mb-3">
            <ArrowLeft className="w-4 h-4" /> Pipeline
          </button>
          <div className="flex items-start justify-between gap-3 flex-wrap">
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap mb-1">
                {deal.tenant && <span className="text-xs font-semibold text-blue-700 bg-blue-50 px-2.5 py-0.5 rounded-full">{deal.tenant}</span>}
                {stage && <span className={`text-xs font-semibold px-2.5 py-0.5 rounded-full ${stage.cls}`}>{stage.label}</span>}
              </div>
              <h1 className="text-xl font-bold text-slate-900 leading-snug">{deal.address || 'Untitled deal'}</h1>
              {cityState && <p className="text-sm text-slate-500 mt-0.5">{cityState}</p>}
            </div>
            <div className="flex items-center gap-6 shrink-0">
              {deal.purchase_price && (<div className="text-right"><p className="text-xs text-slate-400">Purchase Price</p><p className="text-lg font-bold text-slate-900">{fmt$(deal.purchase_price)}</p></div>)}
              {deal.cap_rate != null && (<div className="text-right"><p className="text-xs text-slate-400">Cap Rate</p><p className="text-lg font-bold text-emerald-700">{fmtPct(deal.cap_rate)}</p></div>)}
            </div>
          </div>
        </div>

        {saveError && (
          <div className="flex items-start gap-1.5 text-[11px] text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
            <AlertCircle className="w-3.5 h-3.5 mt-px shrink-0" /><span className="flex-1">Couldn’t save: {saveError}</span>
            <button onClick={() => setSaveError(null)} className="text-red-400 hover:text-red-700 font-bold leading-none">✕</button>
          </div>
        )}

        {/* Document parser */}
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5">
          <div className="flex items-center gap-1.5 mb-3">
            <Sparkles className="w-4 h-4 text-blue-500" />
            <h2 className="text-xs font-semibold text-slate-400 uppercase tracking-widest">Auto-fill from documents</h2>
          </div>
          <div className="grid sm:grid-cols-2 gap-3">
            <DropZone
              label="Offering Memorandum" hint="OM / flyer — fills property & pricing" icon={FileText} accent="blue"
              busy={busyDoc === 'om'} drag={dragDoc === 'om'} disabled={!!busyDoc}
              onEnter={() => setDragDoc('om')} onLeave={() => setDragDoc(null)}
              onDrop={fl => handleDoc('om', fl)} onClick={() => omRef.current?.click()}
            />
            <DropZone
              label="Lease + Amendments" hint="drop the lease and any amendments together" icon={ScrollText} accent="emerald"
              busy={busyDoc === 'lease'} drag={dragDoc === 'lease'} disabled={!!busyDoc}
              onEnter={() => setDragDoc('lease')} onLeave={() => setDragDoc(null)}
              onDrop={fl => handleDoc('lease', fl)} onClick={() => leaseRef.current?.click()}
            />
          </div>
          {applied && (
            <div className="mt-2 flex items-center gap-1.5 text-[11px] text-emerald-700">
              <CheckCircle2 className="w-3.5 h-3.5 shrink-0" /> Filled {applied.count} field{applied.count === 1 ? '' : 's'} from the {applied.docType === 'om' ? 'OM' : 'lease'}. Click any cell to adjust.
            </div>
          )}
          {docError && (
            <div className="mt-2 flex items-start gap-1.5 text-[11px] text-red-600">
              <AlertCircle className="w-3.5 h-3.5 mt-px shrink-0" /> {docError}
            </div>
          )}
          <input ref={omRef}    type="file" accept=".pdf" className="hidden" onChange={e => { handleDoc('om', e.target.files); e.target.value = '' }} />
          <input ref={leaseRef} type="file" accept=".pdf" multiple className="hidden" onChange={e => { handleDoc('lease', e.target.files); e.target.value = '' }} />
        </div>

        {/* Purchase details */}
        <Card icon={Building2} title="Purchase Details">
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-x-6 gap-y-4">
            <EF label="Purchase Price" field="purchase_price" value={deal.purchase_price} type="currency" {...efProps} />
            <EF label="Cap Rate"       field="cap_rate"       value={deal.cap_rate}       type="percent" accent {...efProps} />
            <EF label="NOI"            field="noi"            value={deal.noi}            type="currency" {...efProps} />
            <EF label="List Price"     field="list_price"     value={deal.list_price}     type="currency" {...efProps} />
            <Detail label="Implied NOI" value={fmt$(impliedNOI)} />
            <EF label="Property Type"  field="property_type"  value={deal.property_type}  {...efProps} />
            <EF label="Building Size"  field="building_size"  value={deal.building_size}  type="sqft" {...efProps} />
            <EF label="Year Built"     field="year_built"     value={deal.year_built}     type="int" {...efProps} />
            <EF label="Close Date"     field="close_date"     value={deal.close_date}     type="date" {...efProps} />
            <EF label="DD Deadline"    field="dd_deadline"    value={deal.dd_deadline}    type="date" {...efProps} />
            <EF label="Due Diligence"  field="due_diligence_days" value={deal.due_diligence_days} type="int" {...efProps} />
            <EF label="Earnest Money"  field="earnest_money"  value={deal.earnest_money}  type="currency" {...efProps} />
            <EF label="Address"        field="address"        value={deal.address}        {...efProps} />
            <EF label="City"           field="city"           value={deal.city}           {...efProps} />
            <EF label="State"          field="state"          value={deal.state}          {...efProps} />
            <EF label="Tenant"         field="tenant"         value={deal.tenant}         {...efProps} />
          </div>
          {deal.property_id && deal.property_address && (
            <button onClick={() => navigate(`/properties?open=${deal.property_id}`)} className="mt-4 pt-4 border-t border-slate-100 flex items-center gap-1.5 text-sm text-blue-600 hover:underline w-full text-left">
              <Link2 className="w-3.5 h-3.5 shrink-0" /> Linked property: {deal.property_address}
            </button>
          )}
        </Card>

        {/* Lease abstract */}
        <Card icon={ScrollText} title="Lease Abstract">
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-x-6 gap-y-4">
            <EF label="Lease Type"      field="lease_type"        value={deal.lease_type} {...efProps} />
            <EF label="Guarantor"       field="guarantor"         value={deal.guarantor} {...efProps} />
            <EF label="Commencement"    field="lease_commencement" value={deal.lease_commencement} type="date" {...efProps} />
            <EF label="Expiration"      field="lease_expiration"  value={deal.lease_expiration} type="date" {...efProps} />
            <EF label="Term"            field="lease_term"        value={deal.lease_term} {...efProps} />
            <EF label="Base Rent"       field="base_rent"         value={deal.base_rent} {...efProps} />
            <EF label="Annual Rent"     field="annual_rent"       value={deal.annual_rent} type="currency" {...efProps} />
            <EF label="Security Deposit" field="security_deposit" value={deal.security_deposit} {...efProps} />
            <EF label="Permitted Use"   field="permitted_use"     value={deal.permitted_use} {...efProps} wide />
            <EF label="Rent Escalations" field="rent_escalations" value={deal.rent_escalations} {...efProps} wide />
            <EF label="Renewal Options" field="renewal_options"   value={deal.renewal_options} {...efProps} wide />
            <EF label="Renewal Notice"  field="renewal_notice"    value={deal.renewal_notice} {...efProps} wide />
          </div>

          {/* Responsibility matrix + key dates (read-only, from parsed abstract) */}
          {abstract?.responsibilities?.length > 0 && (
            <div className="mt-5 pt-4 border-t border-slate-100">
              <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-2">Responsibilities</p>
              <div className="overflow-x-auto">
                <table className="w-full text-sm border-collapse">
                  <thead><tr className="text-xs text-slate-400 border-b border-slate-100">
                    <th className="text-left font-medium py-1.5 pr-3">Category</th>
                    <th className="text-left font-medium py-1.5 px-3">Party</th>
                    <th className="text-left font-medium py-1.5 pl-3">Detail</th>
                  </tr></thead>
                  <tbody>
                    {abstract.responsibilities.map((r, i) => (
                      <tr key={i} className="border-b border-slate-50 align-top">
                        <td className="py-1.5 pr-3 text-slate-600 whitespace-nowrap">{r.category}</td>
                        <td className="py-1.5 px-3"><PartyBadge party={r.party} /></td>
                        <td className="py-1.5 pl-3 text-slate-600">{r.detail}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
          {abstract?.key_dates?.length > 0 && (
            <div className="mt-4 pt-4 border-t border-slate-100">
              <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-2">Key Dates</p>
              <div className="grid sm:grid-cols-2 gap-x-6 gap-y-1.5">
                {abstract.key_dates.map((k, i) => (
                  <div key={i} className="flex items-center justify-between text-sm">
                    <span className="text-slate-500">{k.label}</span>
                    <span className="font-medium text-slate-800">{fmtDate(k.date) || k.date}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
          <div className="mt-4 pt-4 border-t border-slate-100">
            <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-1">Lease Notes</p>
            <EF label="" field="lease_notes" value={deal.lease_notes} type="textarea" placeholder="Notes on the lease…" {...efProps} />
          </div>
        </Card>

        {/* Deal notes */}
        <Card icon={FileText} title="Deal Notes">
          <EF label="" field="notes" value={deal.notes} type="textarea" placeholder="Notes on this deal…" {...efProps} />
        </Card>

        {/* Returns calculator */}
        <ReturnsCalculator dealId={deal.id} seedPrice={deal.purchase_price} seedNOI={deal.noi} seedCap={deal.cap_rate} />
      </div>
    </div>
  )
}

// ── UI pieces ─────────────────────────────────────────────────────────────────

function Card({ icon: Icon, title, children }) {
  return (
    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5">
      <div className="flex items-center gap-2 mb-4">
        <Icon className="w-4 h-4 text-slate-400" />
        <h2 className="text-xs font-semibold text-slate-400 uppercase tracking-widest">{title}</h2>
      </div>
      {children}
    </div>
  )
}

function Detail({ label, value }) {
  return (
    <div>
      <p className="text-xs text-slate-400 mb-0.5">{label}</p>
      <p className={`text-sm font-medium ${value ? 'text-slate-800' : 'text-slate-300'}`}>{value || '—'}</p>
    </div>
  )
}

function PartyBadge({ party }) {
  const map = { Tenant: 'bg-blue-50 text-blue-700', Landlord: 'bg-amber-50 text-amber-700', Shared: 'bg-violet-50 text-violet-700', Unclear: 'bg-slate-100 text-slate-500' }
  return <span className={`text-xs font-medium px-2 py-0.5 rounded-full whitespace-nowrap ${map[party] || 'bg-slate-100 text-slate-500'}`}>{party || '—'}</span>
}

// Inline click-to-edit cell → saves one deal column.
function EF({ label, field, value, type = 'text', accent, placeholder, wide, save, saving }) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft]     = useState('')
  const ref = useRef(null)
  useEffect(() => { if (editing) { ref.current?.focus(); ref.current?.select?.() } }, [editing])

  const isBusy  = saving === field
  const numeric = ['currency', 'sqft', 'percent'].includes(type)
  const colSpan = wide || type === 'textarea' ? 'sm:col-span-2' : ''

  function begin() { if (isBusy) return; setDraft(value == null ? '' : String(value)); setEditing(true) }
  function commit() {
    setEditing(false)
    const next = draft.trim(), orig = value == null ? '' : String(value)
    if (next === orig) return
    save(field, next === '' ? null : next)
  }

  const display = formatEditable(type, value)
  const inputCls = 'w-full px-2 py-1 text-sm border border-blue-300 rounded-md bg-white focus:outline-none focus:ring-2 focus:ring-blue-500/30'

  if (editing) {
    return (
      <div className={colSpan}>
        {label && <p className="text-xs text-slate-400 mb-0.5">{label}</p>}
        {type === 'textarea' ? (
          <textarea ref={ref} rows={3} value={draft} placeholder={placeholder}
            onChange={e => setDraft(e.target.value)} onBlur={commit}
            onKeyDown={e => { if (e.key === 'Escape') setEditing(false) }} className={inputCls + ' resize-y leading-relaxed'} />
        ) : (
          <input ref={ref} type={type === 'date' ? 'date' : numeric || type === 'int' ? 'number' : 'text'}
            step={type === 'int' ? '1' : 'any'} value={draft} placeholder={placeholder}
            onChange={e => setDraft(e.target.value)} onBlur={commit}
            onKeyDown={e => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') setEditing(false) }} className={inputCls} />
        )}
      </div>
    )
  }

  return (
    <button type="button" onClick={begin} disabled={isBusy} className={`group text-left w-full ${colSpan}`}>
      {label && <p className="text-xs text-slate-400 mb-0.5">{label}</p>}
      <div className={`text-sm font-medium rounded px-1 -mx-1 min-h-[1.25rem] flex items-start gap-1 group-hover:bg-blue-50/60 transition-colors ${display == null ? 'text-slate-300' : accent ? 'text-emerald-700' : 'text-slate-800'}`}>
        <span className={`flex-1 ${type === 'textarea' ? 'whitespace-pre-line leading-relaxed' : ''}`}>{display == null ? (placeholder || '—') : display}</span>
        {isBusy
          ? <Loader2 className="w-3 h-3 text-blue-400 animate-spin shrink-0 mt-0.5" />
          : <Pencil className="w-3 h-3 text-slate-300 opacity-0 group-hover:opacity-100 shrink-0 mt-0.5" />}
      </div>
    </button>
  )
}

// Drag-and-drop upload target.
function DropZone({ label, hint, icon: Icon, accent, busy, drag, disabled, onEnter, onLeave, onDrop, onClick }) {
  const colors = accent === 'emerald'
    ? { on: 'border-emerald-400 bg-emerald-50 text-emerald-700', off: 'border-emerald-200 bg-white text-emerald-700 hover:bg-emerald-50' }
    : { on: 'border-blue-400 bg-blue-50 text-blue-700', off: 'border-blue-200 bg-white text-blue-700 hover:bg-blue-50' }
  return (
    <button
      onClick={() => !disabled && onClick()} disabled={disabled}
      onDragOver={e => { e.preventDefault(); if (!disabled) onEnter() }}
      onDragLeave={e => { e.preventDefault(); onLeave() }}
      onDrop={e => { e.preventDefault(); onLeave(); if (!disabled) onDrop(e.dataTransfer.files) }}
      className={`flex flex-col items-center justify-center gap-1 px-4 py-5 rounded-xl text-sm font-semibold border-2 border-dashed transition-colors disabled:opacity-60 ${drag ? colors.on : colors.off}`}
    >
      {busy
        ? <><Loader2 className="w-5 h-5 animate-spin" /> Reading…</>
        : <><Icon className="w-5 h-5" /> {label}<span className="text-[11px] font-normal text-slate-400">{hint}</span></>}
    </button>
  )
}
