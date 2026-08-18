import { useEffect, useState, useRef } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import {
  ArrowLeft, Loader2, Building2, CalendarDays, DollarSign, User, Link2, FileText,
  TrendingUp, Sparkles, ScrollText, AlertCircle, CheckCircle2, Pencil, FileSignature, CalendarClock,
  ExternalLink, ClipboardCheck, X, UploadCloud, Users, Mail,
} from 'lucide-react'
import { useApp } from '../../context/AppContext'
import { getDeal, updateDealField, parseDealDoc, deleteDealProposal, getInvestorRecipients } from '../../api/client'
import ReturnsCalculator from './ReturnsCalculator'
import InvestorUpload from '../accounting/InvestorUpload'
import InvestorEmailComposer from '../accounting/InvestorEmailComposer'

const STAGE_LABELS = {
  loi:             { label: 'LOI',             cls: 'bg-blue-100 text-blue-700' },
  psa_negotiation: { label: 'PSA Negotiation', cls: 'bg-amber-100 text-amber-700' },
  under_contract:  { label: 'Under Contract',  cls: 'bg-violet-100 text-violet-700' },
  money_hard:      { label: 'Money Hard',      cls: 'bg-green-100 text-green-700' },
}

const DOC_LABEL = { om: 'OM', lease: 'lease', psa: 'PSA', proposal: 'proposal' }

const fmt$    = v => v == null || v === '' ? null : '$' + Math.round(Number(v)).toLocaleString()
const fmtPct  = v => v == null || v === '' ? null : `${Number(v).toFixed(2)}%`
const fmtNum  = v => v == null || v === '' ? null : Number(v).toLocaleString()
const fmtDate = v => { if (!v) return null; const m = String(v).match(/^(\d{4})-(\d{2})-(\d{2})/); return m ? `${m[2]}/${m[3]}/${m[1]}` : v }
function daysUntil(iso) {
  const m = String(iso || '').match(/^(\d{4})-(\d{2})-(\d{2})/); if (!m) return null
  const d = new Date(+m[1], +m[2] - 1, +m[3]); d.setHours(0, 0, 0, 0)
  const t = new Date(); t.setHours(0, 0, 0, 0)
  return Math.round((d - t) / 86400000)
}
function dueBadge(days) {
  if (days < 0)   return 'bg-red-50 text-red-700 border-red-200'
  if (days <= 14) return 'bg-red-50 text-red-600 border-red-200'
  if (days <= 45) return 'bg-amber-50 text-amber-700 border-amber-200'
  if (days <= 90) return 'bg-blue-50 text-blue-700 border-blue-200'
  return 'bg-slate-100 text-slate-500 border-slate-200'
}
// Years/months left on the current lease term, computed from the expiration date.
function termRemaining(iso) {
  const days = daysUntil(iso)
  if (days == null) return null
  if (days < 0) return 'Expired'
  const months = Math.round(days / 30.44)
  if (months < 12) return `${months} mo`
  const y = Math.floor(months / 12), m = months % 12
  return m ? `${y}y ${m}mo` : `${y} yr`
}

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

  // Document parser — single upload box, auto-classified server-side.
  const [busyDoc, setBusyDoc]   = useState(false)
  const [dragDoc, setDragDoc]   = useState(false)
  const [docError, setDocError] = useState(null)
  const [applied, setApplied]   = useState(null)   // { docType, count, proposal }
  const fileRef = useRef(null)

  // Investors — cap table on the deal's property (carries over to portfolio).
  const [investors, setInvestors]   = useState([])
  const [showInvestorUpload, setShowInvestorUpload] = useState(false)
  const [showEmail, setShowEmail]   = useState(false)
  const loadInvestors = () => {
    if (!deal?.property_id) { setInvestors([]); return }
    getInvestorRecipients(deal.property_id).then(r => setInvestors(Array.isArray(r) ? r : [])).catch(() => setInvestors([]))
  }

  useEffect(() => {
    let alive = true
    getDeal(dealId)
      .then(d => { if (alive) { setDeal(d); setLoading(false) } })
      .catch(() => { if (alive) { setLoading(false); setNotFound(true) } })
    return () => { alive = false }
  }, [dealId])

  useEffect(() => { loadInvestors() /* eslint-disable-next-line */ }, [deal?.property_id])

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

  async function handleDoc(fileList) {
    const files = Array.from(fileList || []).filter(Boolean)
    if (!files.length) return
    setBusyDoc(true); setDocError(null); setApplied(null)
    try {
      const res = await parseDealDoc(dealId, files)   // auto-classified
      setDeal(res.deal)
      setApplied({ docType: res.docType, count: res.applied?.length, proposal: res.proposal })
    } catch (err) {
      setDocError(err.message)
    } finally {
      setBusyDoc(false)
    }
  }

  async function removeProposal(pid) {
    try { setDeal(await deleteDealProposal(dealId, pid)) }
    catch (err) { setSaveError(err.message) }
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
              {deal.property_id ? (
                <button onClick={() => navigate(`/properties?open=${deal.property_id}`)}
                  className="group inline-flex items-center gap-1.5 text-left">
                  <h1 className="text-xl font-bold text-slate-900 leading-snug group-hover:text-blue-700 group-hover:underline">{deal.address || 'Untitled deal'}</h1>
                  <ExternalLink className="w-4 h-4 text-slate-400 group-hover:text-blue-600 shrink-0" />
                </button>
              ) : (
                <h1 className="text-xl font-bold text-slate-900 leading-snug">{deal.address || 'Untitled deal'}</h1>
              )}
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

        {/* Document parser — single auto-detecting upload box */}
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5">
          <div className="flex items-center gap-1.5 mb-3">
            <Sparkles className="w-4 h-4 text-blue-500" />
            <h2 className="text-xs font-semibold text-slate-400 uppercase tracking-widest">Auto-fill from documents</h2>
          </div>
          <button
            onClick={() => !busyDoc && fileRef.current?.click()} disabled={busyDoc}
            onDragOver={e => { e.preventDefault(); if (!busyDoc) setDragDoc(true) }}
            onDragLeave={e => { e.preventDefault(); setDragDoc(false) }}
            onDrop={e => { e.preventDefault(); setDragDoc(false); if (!busyDoc) handleDoc(e.dataTransfer.files) }}
            className={`w-full flex flex-col items-center justify-center gap-1.5 px-4 py-7 rounded-xl text-sm font-semibold border-2 border-dashed transition-colors disabled:opacity-70 ${
              dragDoc ? 'border-blue-400 bg-blue-50 text-blue-700' : 'border-slate-300 bg-slate-50/50 text-slate-600 hover:bg-blue-50/40 hover:border-blue-300'}`}
          >
            {busyDoc
              ? <><Loader2 className="w-5 h-5 animate-spin" /> Reading &amp; identifying…</>
              : <><UploadCloud className="w-6 h-6 text-slate-400" /> Drop a document or click to upload
                  <span className="text-[11px] font-normal text-slate-400">OM, lease (+ amendments), PSA, or a survey / environmental / PCR proposal — auto-detected</span></>}
          </button>
          {applied && (
            <div className="mt-2 flex items-center gap-1.5 text-[11px] text-emerald-700">
              <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
              {applied.proposal
                ? <>Added {applied.proposal.kind} proposal{applied.proposal.vendor ? ` (${applied.proposal.vendor})` : ''} — see Third-Party Reports below.</>
                : applied.docType === 'psa'
                ? <>Read the PSA · escrow dates calculated from the effective date. Click any cell to adjust.</>
                : <>Detected {DOC_LABEL[applied.docType] || 'document'} · filled {applied.count} field{applied.count === 1 ? '' : 's'}. Click any cell to adjust.</>}
            </div>
          )}
          {docError && (
            <div className="mt-2 flex items-start gap-1.5 text-[11px] text-red-600">
              <AlertCircle className="w-3.5 h-3.5 mt-px shrink-0" /> {docError}
            </div>
          )}
          <input ref={fileRef} type="file" accept=".pdf" multiple className="hidden" onChange={e => { handleDoc(e.target.files); e.target.value = '' }} />
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
            <EF label="Due Diligence"  field="due_diligence_days" value={deal.due_diligence_days} type="int" {...efProps} />
            <EF label="Address"        field="address"        value={deal.address}        {...efProps} />
            <EF label="City"           field="city"           value={deal.city}           {...efProps} />
            <EF label="State"          field="state"          value={deal.state}          {...efProps} />
            <EF label="Tenant"         field="tenant"         value={deal.tenant}         {...efProps} />
          </div>
        </Card>

        {/* PSA abstract — named escrow dates (fill from a dropped PSA or edit manually) */}
        <Card icon={CalendarClock} title="PSA Abstract">
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-6 gap-y-4">
            <EF label="Effective Date"          field="effective_date"       value={deal.effective_date}       type="date" {...efProps} />
            <EF label="Earnest Money Amount"    field="earnest_money"        value={deal.earnest_money}        type="currency" {...efProps} />
            <EF label="Earnest Money Due Date"  field="earnest_due_date"     value={deal.earnest_due_date}     type="date" {...efProps} />
            <EF label="DD Expiration"           field="dd_deadline"          value={deal.dd_deadline}          type="date" {...efProps} />
            <EF label="Title Objection Deadline" field="title_objection_date" value={deal.title_objection_date} type="date" {...efProps} />
            <EF label="Close Date"              field="close_date"           value={deal.close_date}           type="date" {...efProps} />
          </div>
          <p className="text-[11px] text-slate-400 mt-2">Dates auto-calculate from the Effective Date using the contract's timing rules — change the Effective Date and they all shift. Uploading a PSA amendment updates the affected deadlines. Edit any date to pin it manually.</p>

          {/* Third-party DD timelines — vendor proposals + drop-dead order dates */}
          <div className="mt-5 pt-4 border-t border-slate-100">
            <div className="flex items-center gap-1.5 mb-2">
              <ClipboardCheck className="w-3.5 h-3.5 text-slate-400" />
              <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide">Third-Party Reports — Order By</p>
            </div>
            {deal.proposals?.length ? (
              <div className="border border-slate-100 rounded-xl divide-y divide-slate-50">
                {deal.proposals.map(p => {
                  const du = p.order_by_date != null ? daysUntil(p.order_by_date) : null
                  return (
                    <div key={p.id} className="flex items-center gap-3 px-3 py-2.5">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-semibold text-slate-800 capitalize">{p.kind}</span>
                          {p.vendor && <span className="text-xs text-slate-400 truncate">· {p.vendor}</span>}
                        </div>
                        <p className="text-xs text-slate-500">
                          {p.turnaround_text || (p.turnaround_days ? `${p.turnaround_days} days` : 'turnaround not found')}
                          {p.cost ? ` · ${fmt$(p.cost)}` : ''}
                        </p>
                      </div>
                      <div className="text-right shrink-0">
                        <p className="text-[10px] text-slate-400 uppercase tracking-wide">Order by</p>
                        {p.order_by_date ? (
                          <span className="flex items-center gap-1.5 justify-end">
                            <span className="text-sm font-medium text-slate-800 tabular-nums">{fmtDate(p.order_by_date)}</span>
                            {du != null && <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded border ${dueBadge(du)}`}>{du < 0 ? `${Math.abs(du)}d overdue` : `${du}d`}</span>}
                          </span>
                        ) : <span className="text-xs text-slate-300">set DD Expiration</span>}
                      </div>
                      <button onClick={() => removeProposal(p.id)} title="Remove" className="text-slate-300 hover:text-red-500 shrink-0"><X className="w-4 h-4" /></button>
                    </div>
                  )
                })}
              </div>
            ) : (
              <p className="text-sm text-slate-400">Drop a survey, environmental, or PCR proposal above — it computes a drop-dead order date (DD Expiration − turnaround) so the report lands before due diligence ends.</p>
            )}
          </div>
        </Card>

        {/* Lease abstract */}
        <Card icon={ScrollText} title="Lease Abstract">
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-x-6 gap-y-4">
            <EF label="Lease Type" field="lease_type" value={deal.lease_type} type="select"
              options={['Ground Lease', 'NNN', 'NN', 'Modified Gross', 'Gross']} {...efProps} />
            <EF label="Base Rent" field="annual_rent" value={deal.annual_rent} type="currency" {...efProps} />
            <EF label="Lease Expiration" field="lease_expiration" value={deal.lease_expiration} type="date" {...efProps} />
            <Detail label="Term Remaining" value={termRemaining(deal.lease_expiration)} />
            <EF label="Rent Escalations (current term)" field="rent_escalations" value={deal.rent_escalations} type="select"
              options={['Yes', 'No']} {...efProps} />
            <EF label="Options Remaining" field="renewal_option_count" value={deal.renewal_option_count} type="int" {...efProps} />
            <EF label="Option Length" field="renewal_option_length" value={deal.renewal_option_length} {...efProps} />
            <EF label="Option Increase" field="renewal_option_increase" value={deal.renewal_option_increase} {...efProps} />
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

        {/* Investors — upload the calculator, review the cap table, email them */}
        <Card icon={Users} title="Investors">
          {!deal.property_id ? (
            <p className="text-sm text-slate-500">Link this deal to a property first (the ↗ button by the address) — investors attach to that property so they carry over when you close into the portfolio.</p>
          ) : (
            <>
              <div className="flex items-center justify-between mb-3">
                <p className="text-xs text-slate-400">{investors.length ? `${investors.length} on the cap table` : 'No investors yet'}</p>
                <div className="flex items-center gap-2">
                  <button onClick={() => setShowInvestorUpload(true)} className="inline-flex items-center gap-1.5 text-xs font-medium text-blue-600 hover:text-blue-800 border border-blue-200 rounded-lg px-2.5 py-1.5">
                    <UploadCloud className="w-3.5 h-3.5" /> Upload calculator
                  </button>
                  {investors.length > 0 && (
                    <button onClick={() => setShowEmail(true)} className="inline-flex items-center gap-1.5 text-xs font-semibold text-white bg-emerald-600 hover:bg-emerald-700 rounded-lg px-2.5 py-1.5">
                      <Mail className="w-3.5 h-3.5" /> Email investors
                    </button>
                  )}
                </div>
              </div>
              {investors.length > 0 ? (
                <div className="rounded-lg border border-slate-200 divide-y divide-slate-100">
                  {investors.map(inv => (
                    <div key={inv.id} className="flex items-center justify-between gap-2 px-3 py-2 text-sm">
                      <div className="min-w-0">
                        <p className="font-medium text-slate-800 truncate">{inv.name}</p>
                        <p className={`text-[11px] truncate ${inv.email ? 'text-slate-400' : 'text-amber-600'}`}>{inv.email || 'no email on file'}</p>
                      </div>
                      {inv.contribution ? <span className="text-xs font-medium text-slate-600 tabular-nums shrink-0">{fmt$(inv.contribution)}</span> : null}
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-slate-500">Upload your deal calculator (.xlsx) — it reads the cap table so you can email the investors from here. They carry over to the portfolio automatically when you close.</p>
              )}
            </>
          )}
        </Card>

        {/* Deal notes */}
        <Card icon={FileText} title="Deal Notes">
          <EF label="" field="notes" value={deal.notes} type="textarea" placeholder="Notes on this deal…" {...efProps} />
        </Card>

        {/* Returns calculator */}
        <ReturnsCalculator dealId={deal.id} seedPrice={deal.purchase_price} seedNOI={deal.noi} seedCap={deal.cap_rate} />
      </div>

      {showInvestorUpload && deal.property_id && (
        <InvestorUpload
          propertyId={deal.property_id}
          onSaved={() => { setShowInvestorUpload(false); loadInvestors() }}
          onClose={() => setShowInvestorUpload(false)}
        />
      )}
      {showEmail && deal.property_id && (
        <InvestorEmailComposer
          propertyId={deal.property_id}
          property={{ address: deal.address, city: deal.city, state: deal.state }}
          purpose="pipeline"
          onClose={() => setShowEmail(false)}
        />
      )}
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
function EF({ label, field, value, type = 'text', accent, placeholder, wide, options, save, saving }) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft]     = useState('')
  const ref = useRef(null)
  useEffect(() => { if (editing) { ref.current?.focus(); ref.current?.select?.() } }, [editing])

  const isBusy  = saving === field
  const numeric = ['currency', 'sqft', 'percent'].includes(type)
  const colSpan = wide || type === 'textarea' ? 'sm:col-span-2' : ''

  function begin() { if (isBusy) return; setDraft(value == null ? '' : String(value)); setEditing(true) }
  function commit(raw) {
    setEditing(false)
    const next = String(raw ?? draft).trim(), orig = value == null ? '' : String(value)
    if (next === orig) return
    save(field, next === '' ? null : next)
  }

  const display = formatEditable(type, value)
  const inputCls = 'w-full px-2 py-1 text-sm border border-blue-300 rounded-md bg-white focus:outline-none focus:ring-2 focus:ring-blue-500/30'

  if (editing) {
    return (
      <div className={colSpan}>
        {label && <p className="text-xs text-slate-400 mb-0.5">{label}</p>}
        {type === 'select' ? (
          <select ref={ref} value={draft} onBlur={() => commit()}
            onChange={e => { setDraft(e.target.value); commit(e.target.value) }}
            onKeyDown={e => { if (e.key === 'Escape') setEditing(false) }} className={inputCls}>
            <option value="">—</option>
            {(options || []).map(o => <option key={o} value={o}>{o}</option>)}
          </select>
        ) : type === 'textarea' ? (
          <textarea ref={ref} rows={3} value={draft} placeholder={placeholder}
            onChange={e => setDraft(e.target.value)} onBlur={() => commit()}
            onKeyDown={e => { if (e.key === 'Escape') setEditing(false) }} className={inputCls + ' resize-y leading-relaxed'} />
        ) : (
          <input ref={ref} type={type === 'date' ? 'date' : numeric || type === 'int' ? 'number' : 'text'}
            step={type === 'int' ? '1' : 'any'} value={draft} placeholder={placeholder}
            onChange={e => setDraft(e.target.value)} onBlur={() => commit()}
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
  const palette = {
    emerald: { on: 'border-emerald-400 bg-emerald-50 text-emerald-700', off: 'border-emerald-200 bg-white text-emerald-700 hover:bg-emerald-50' },
    violet:  { on: 'border-violet-400 bg-violet-50 text-violet-700',    off: 'border-violet-200 bg-white text-violet-700 hover:bg-violet-50' },
    blue:    { on: 'border-blue-400 bg-blue-50 text-blue-700',          off: 'border-blue-200 bg-white text-blue-700 hover:bg-blue-50' },
  }
  const colors = palette[accent] || palette.blue
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
