import { useEffect, useState, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  X, Pencil, Building2, MapPin, Phone, Mail, FileText,
  AlertCircle, CalendarDays, Wrench, User, TrendingUp, Landmark, CheckCircle2, ExternalLink,
  Sparkles, Loader2, Receipt, Check, Plus,
} from 'lucide-react'
import {
  getProperty, togglePortfolio, clearOwnershipReview, parseMarketingPackage, parseSettlementPdf,
  updatePropertyField, updatePropertyRelation, getTenantBrands, getOperators, getAllPeople,
} from '../../api/client'
import { useApp } from '../../context/AppContext'
import SendLetterModal from '../handwrytten/SendLetterModal'
import ExtractedFieldsModal from '../management/ExtractedFieldsModal'
import InvestorEmailComposer from '../accounting/InvestorEmailComposer'

const PIPELINE_STAGES = [
  { key: 'loi',             label: 'LOI' },
  { key: 'psa_negotiation', label: 'PSA Negotiation' },
  { key: 'under_contract',  label: 'Under Contract' },
  { key: 'money_hard',      label: 'Money Hard' },
]

const ROLE_LABELS = {
  owner:          'Owner',
  owner_company:  'Owner Company',
  broker:         'Broker',
  tenant_contact: 'Tenant Contact',
}
const ROLE_COLORS = {
  owner:          'bg-blue-50 text-blue-700',
  owner_company:  'bg-violet-50 text-violet-700',
  broker:         'bg-amber-50 text-amber-700',
  tenant_contact: 'bg-slate-100 text-slate-600',
}

function fmt$(v) {
  if (!v && v !== 0) return null
  if (v >= 1_000_000) return `$${(v / 1_000_000).toFixed(2)}M`
  if (v >= 1_000)     return `$${Number(v).toLocaleString()}`
  return `$${v}`
}
function fmtPct(v) { return v ? `${Number(v).toFixed(2)}%` : null }
function fmtSqft(v) { return v ? `${Number(v).toLocaleString()} sf` : null }
// land_area may be stored as a bare number or a string like "0.59 Acres";
// parse out the numeric portion so we never render "NaN".
function fmtAcres(v) {
  if (v == null || v === '') return null
  const n = parseFloat(String(v).replace(/,/g, ''))
  return Number.isFinite(n) ? `${n.toLocaleString()} acres` : null
}
// Dates are stored ISO (YYYY-MM-DD); render US-style MM/DD/YYYY without
// timezone drift (parse the parts directly rather than through Date()).
function fmtDate(v) {
  if (!v) return null
  const m = String(v).match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (m) return `${m[2]}/${m[3]}/${m[1]}`
  return v
}

function leaseMonths(leaseEnd) {
  if (!leaseEnd) return null
  return (new Date(leaseEnd + 'T00:00:00') - new Date()) / (1000 * 60 * 60 * 24 * 30)
}
function leaseColor(m) {
  if (m == null) return ''
  if (m < 0)   return 'text-red-600'
  if (m < 12)  return 'text-amber-600'
  if (m < 36)  return 'text-yellow-600'
  return 'text-emerald-600'
}
function leaseLabel(m) {
  if (m == null) return null
  if (m < 0) return 'Expired'
  const yrs = Math.floor(m / 12)
  const mos = Math.round(m % 12)
  if (yrs === 0) return `${mos}mo remaining`
  return mos > 0 ? `${yrs}y ${mos}mo remaining` : `${yrs}yr remaining`
}

export default function PropertyDetail({ propertyId, onClose, onEdit, onPortfolioChange, embedded = false }) {
  const [showEmail, setShowEmail] = useState(false)
  // Panel vs. embedded (a tab inside the full-page property workspace).
  const shell = embedded
    ? 'w-full h-full bg-white flex flex-col overflow-y-auto'
    : 'fixed inset-y-0 right-0 w-[520px] bg-white border-l border-slate-200 shadow-2xl z-40 flex flex-col'
  const { addDeal } = useApp()
  const navigate = useNavigate()
  const [data, setData] = useState(null)
  const [toggling, setToggling] = useState(false)

  const [showLetterModal, setShowLetterModal] = useState(false)

  // Add-to-pipeline modal state
  const [showPipeline, setShowPipeline]   = useState(false)
  const [pipelinePrice, setPipelinePrice] = useState('')
  const [pipelineStage, setPipelineStage] = useState('loi')
  const [pipelineWorking, setPipelineWorking] = useState(false)

  // Auto-fill from documents (Offering Memorandum → property details, Settlement
  // Statement → sale price/date). Parses the PDF, then opens a review-and-confirm
  // modal that overwrites only the fields you approve.
  const [busyDoc, setBusyDoc]   = useState(null)   // 'marketing' | 'settlement' while parsing
  const [dragDoc, setDragDoc]   = useState(null)   // 'marketing' | 'settlement' — drop target being hovered
  const [docError, setDocError] = useState(null)
  const [autoFill, setAutoFill] = useState(null)   // { docType, data }
  const omInputRef  = useRef(null)
  const settInputRef = useRef(null)

  // Inline single-field editing: click a cell → edit in place → save just that
  // one column (never touches the others, so auto-filled data always sticks).
  const [savingField, setSavingField] = useState(null)
  const [saveError, setSaveError]     = useState(null)

  useEffect(() => {
    if (!propertyId) return
    setData(null)
    getProperty(propertyId).then(setData).catch(console.error)
  }, [propertyId])

  async function saveField(column, value) {
    setSavingField(column); setSaveError(null)
    setData(d => ({ ...d, [column]: value }))          // optimistic
    try {
      const row = await updatePropertyField(propertyId, column, value)
      setData(row)                                     // authoritative (refreshes derived cap rate, fee, etc.)
      onPortfolioChange?.()                            // let the parent list reflect the edit
    } catch (err) {
      setSaveError(err.message)
      getProperty(propertyId).then(setData).catch(() => {})   // revert to server truth
    } finally {
      setSavingField(null)
    }
  }

  // Link the property to a tenant brand / operator / owner. payload is {id} to
  // pick an existing record, {name} to find-or-create, or {} to clear.
  async function saveRelation(relation, payload) {
    setSavingField(relation); setSaveError(null)
    try {
      const row = await updatePropertyRelation(propertyId, relation, payload)
      setData(row)
      onPortfolioChange?.()
    } catch (err) {
      setSaveError(err.message)
      getProperty(propertyId).then(setData).catch(() => {})
    } finally {
      setSavingField(null)
    }
  }

  async function handleDocFile(docType, file) {
    if (!file) return
    setBusyDoc(docType); setDocError(null)
    try {
      const data = docType === 'settlement'
        ? await parseSettlementPdf(file)
        : await parseMarketingPackage(propertyId, file)
      setAutoFill({ docType, data })
    } catch (err) {
      setDocError(err.message)
    } finally {
      setBusyDoc(null)
    }
  }

  async function handlePortfolioToggle() {
    if (!data || toggling) return
    setToggling(true)
    try {
      const updated = await togglePortfolio(data.id, !data.is_portfolio)
      setData(d => ({ ...d, is_portfolio: updated.is_portfolio }))
      if (onPortfolioChange) onPortfolioChange()
    } finally {
      setToggling(false)
    }
  }

  async function handleAddToPipeline(e) {
    e.preventDefault()
    if (pipelineWorking) return
    setPipelineWorking(true)
    try {
      await addDeal({
        property_id:    data.id,
        stage:          pipelineStage,
        purchase_price: pipelinePrice !== '' ? parseFloat(pipelinePrice) : null,
        address:        data.address        || null,
        city:           data.city           || null,
        state:          data.state          || null,
        tenant:         data.tenant_brand_name || null,
      })
      setShowPipeline(false)
      setPipelinePrice('')
      setPipelineStage('loi')
      navigate('/pipeline')
    } finally {
      setPipelineWorking(false)
    }
  }

  if (!data) return (
    <div className={embedded ? 'w-full h-full bg-white flex items-center justify-center' : 'fixed inset-y-0 right-0 w-[520px] bg-white border-l border-slate-200 shadow-2xl z-40 flex items-center justify-center'}>
      <div className="w-5 h-5 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
    </div>
  )

  const lm = leaseMonths(data.lease_end)

  return (
    <div className={shell}>
      {/* ── Header ─────────────────────────────────────────────── */}
      <div className="px-6 pt-5 pb-4 border-b border-slate-100 shrink-0">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap mb-2">
              {data.tenant_brand_name && (
                <span className="text-xs font-semibold text-blue-700 bg-blue-50 px-2.5 py-0.5 rounded-full">
                  {data.tenant_brand_name}
                </span>
              )}
              {data.operator_name && (
                <span className={`text-xs font-semibold px-2.5 py-0.5 rounded-full ${data.operator_is_corporate ? 'text-slate-700 bg-slate-100' : 'text-violet-700 bg-violet-50'}`}>
                  {data.operator_name}
                </span>
              )}
              {data.needs_ownership_review ? (
                <span className="flex items-center gap-1 text-xs font-semibold text-amber-700 bg-amber-50 border border-amber-200 px-2 py-0.5 rounded-full">
                  <AlertCircle className="w-3 h-3" /> Ownership needs review
                  <button
                    onClick={async () => { await clearOwnershipReview(data.id); setData(d => ({ ...d, needs_ownership_review: 0 })) }}
                    className="ml-1 text-amber-500 hover:text-amber-800 font-bold leading-none"
                    title="Mark as reviewed"
                  >✕</button>
                </span>
              ) : null}
            </div>
            <h2 className="text-lg font-bold text-slate-900 leading-snug">{data.address}</h2>
            <p className="text-sm text-slate-500 mt-0.5">
              {[data.city, data.state, data.zip].filter(Boolean).join(', ')}
            </p>
          </div>
          <div className="flex items-center gap-1 shrink-0">
            <button
              onClick={handlePortfolioToggle}
              disabled={toggling}
              title={data?.is_portfolio ? 'Remove from portfolio' : 'Add to portfolio'}
              className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-semibold border transition-colors ${
                data?.is_portfolio
                  ? 'bg-emerald-50 text-emerald-700 border-emerald-200 hover:bg-emerald-100'
                  : 'bg-white text-slate-500 border-slate-200 hover:bg-slate-50'
              }`}
            >
              {data?.is_portfolio
                ? <><CheckCircle2 className="w-3.5 h-3.5" /> Portfolio</>
                : <><Landmark className="w-3.5 h-3.5" /> Add to Portfolio</>
              }
            </button>
            <button
              onClick={() => setShowPipeline(true)}
              title="Add to pipeline"
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-semibold border border-slate-200 bg-white text-slate-500 hover:bg-slate-50 transition-colors"
            >
              <TrendingUp className="w-3.5 h-3.5" /> Add to Pipeline
            </button>
            {data?.is_portfolio && (
              <button
                onClick={() => setShowEmail(true)}
                title="Email this property's investors an update"
                className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-semibold border border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 transition-colors"
              >
                <Mail className="w-3.5 h-3.5" /> Email Investors
              </button>
            )}
            {onClose && (
              <button onClick={onClose} className="w-8 h-8 rounded-lg flex items-center justify-center text-slate-400 hover:bg-slate-100">
                <X className="w-4 h-4" />
              </button>
            )}
          </div>
        </div>

        {/* Quick financial strip */}
        <div className="flex items-center gap-4 mt-3 pt-3 border-t border-slate-100 flex-wrap">
          {data.cap_rate && (
            <Kpi label="Cap Rate" value={fmtPct(data.cap_rate)} accent="emerald" />
          )}
          {data.noi && (
            <Kpi label="NOI" value={fmt$(data.noi)} />
          )}
          {data.list_price && (
            <Kpi label="List Price" value={fmt$(data.list_price)} />
          )}
          {data.estimated_value && (
            <Kpi label="Est. Value" value={fmt$(data.estimated_value)} />
          )}
          {data.annual_rent && (
            <Kpi label="Annual Rent" value={fmt$(data.annual_rent)} />
          )}
        </div>
      </div>

      {/* ── Body ───────────────────────────────────────────────── */}
      <div className="flex-1 overflow-y-auto">

        {/* Ownership-review banner — set by the recent-sales upload */}
        {data.needs_ownership_review ? (
          <div className="mx-6 mt-4 flex items-start gap-3 px-4 py-3 rounded-xl bg-amber-50 border border-amber-300">
            <AlertCircle className="w-4 h-4 text-amber-600 mt-0.5 shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-amber-800">Ownership needs review</p>
              <p className="text-xs text-amber-700 mt-0.5">
                Flagged from a recent-sales upload{data.needs_review_at
                  ? <> on <strong>{new Date(String(data.needs_review_at).replace(' ', 'T') + 'Z').toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}</strong></>
                  : ''} — this property likely sold, so confirm the current owner before mailing. Mail campaigns skip it until it's reviewed.
              </p>
            </div>
            <button
              onClick={async () => { await clearOwnershipReview(data.id); setData(d => ({ ...d, needs_ownership_review: 0, needs_review_at: null })) }}
              className="shrink-0 text-xs font-semibold text-amber-800 bg-white border border-amber-300 px-2.5 py-1.5 rounded-lg hover:bg-amber-100"
            >
              Mark reviewed
            </button>
          </div>
        ) : null}

        {saveError && (
          <div className="mx-6 mt-3 flex items-start gap-1.5 text-[11px] text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
            <AlertCircle className="w-3.5 h-3.5 mt-px shrink-0" />
            <span className="flex-1">Couldn’t save: {saveError}</span>
            <button onClick={() => setSaveError(null)} className="text-red-400 hover:text-red-700 font-bold leading-none">✕</button>
          </div>
        )}

        {/* Auto-fill from documents */}
        <div className="px-6 pt-4 pb-3 border-b border-slate-100 bg-slate-50/60">
          <div className="flex items-center gap-1.5 mb-2">
            <Sparkles className="w-3.5 h-3.5 text-blue-500" />
            <span className="text-xs font-semibold text-slate-600">Auto-fill from documents</span>
          </div>
          <div className="flex items-stretch gap-2">
            <button
              onClick={() => busyDoc || omInputRef.current?.click()}
              disabled={!!busyDoc}
              onDragOver={e => { e.preventDefault(); if (!busyDoc) setDragDoc('marketing') }}
              onDragLeave={e => { e.preventDefault(); setDragDoc(d => d === 'marketing' ? null : d) }}
              onDrop={e => { e.preventDefault(); setDragDoc(null); if (!busyDoc) handleDocFile('marketing', e.dataTransfer.files?.[0]) }}
              className={`flex-1 flex flex-col items-center justify-center gap-1 px-3 py-3 rounded-lg text-xs font-semibold border-2 border-dashed transition-colors disabled:opacity-60 ${
                dragDoc === 'marketing'
                  ? 'border-blue-400 bg-blue-50 text-blue-700'
                  : 'border-blue-200 bg-white text-blue-700 hover:bg-blue-50'
              }`}
            >
              {busyDoc === 'marketing'
                ? <><Loader2 className="w-4 h-4 animate-spin" /> Reading…</>
                : <><FileText className="w-4 h-4" /> Offering Memorandum<span className="text-[10px] font-normal text-slate-400">drop PDF or click</span></>}
            </button>
            <button
              onClick={() => busyDoc || settInputRef.current?.click()}
              disabled={!!busyDoc}
              onDragOver={e => { e.preventDefault(); if (!busyDoc) setDragDoc('settlement') }}
              onDragLeave={e => { e.preventDefault(); setDragDoc(d => d === 'settlement' ? null : d) }}
              onDrop={e => { e.preventDefault(); setDragDoc(null); if (!busyDoc) handleDocFile('settlement', e.dataTransfer.files?.[0]) }}
              className={`flex-1 flex flex-col items-center justify-center gap-1 px-3 py-3 rounded-lg text-xs font-semibold border-2 border-dashed transition-colors disabled:opacity-60 ${
                dragDoc === 'settlement'
                  ? 'border-emerald-400 bg-emerald-50 text-emerald-700'
                  : 'border-emerald-200 bg-white text-emerald-700 hover:bg-emerald-50'
              }`}
            >
              {busyDoc === 'settlement'
                ? <><Loader2 className="w-4 h-4 animate-spin" /> Reading…</>
                : <><Receipt className="w-4 h-4" /> Settlement Statement<span className="text-[10px] font-normal text-slate-400">drop PDF or click</span></>}
            </button>
          </div>
          <p className="text-[11px] text-slate-400 mt-1.5">
            OM fills property details (tenant, size, lease, price). Settlement fills the sale price &amp; date.
          </p>
          {docError && (
            <div className="mt-2 flex items-start gap-1.5 text-[11px] text-red-600">
              <AlertCircle className="w-3.5 h-3.5 mt-px shrink-0" /> {docError}
            </div>
          )}
          <input ref={omInputRef}   type="file" accept=".pdf" className="hidden" onChange={e => { handleDocFile('marketing', e.target.files?.[0]); e.target.value = '' }} />
          <input ref={settInputRef} type="file" accept=".pdf" className="hidden" onChange={e => { handleDocFile('settlement', e.target.files?.[0]); e.target.value = '' }} />
        </div>

        {/* Tenant & Operator */}
        <Section icon={User} title="Tenant & Operator">
          <Grid2>
            <RelationField
              label="Tenant" relation="tenant" propertyId={propertyId}
              currentId={data.tenant_brand_id} currentName={data.tenant_brand_name}
              loadOptions={getTenantBrands} onCommit={saveRelation} saving={savingField === 'tenant'}
            />
            <RelationField
              label="Operator / Franchisee" relation="operator" propertyId={propertyId}
              currentId={data.operator_id} currentName={data.operator_name}
              loadOptions={getOperators} onCommit={saveRelation} saving={savingField === 'operator'}
            />
          </Grid2>
        </Section>

        {/* Location */}
        <Section icon={MapPin} title="Property Address">
          <Grid2>
            <EF label="Street"  field="address" value={data.address} save={saveField} saving={savingField} />
            <EF label="City"    field="city"    value={data.city}    save={saveField} saving={savingField} />
            <EF label="State"   field="state"   value={data.state}   save={saveField} saving={savingField} />
            <EF label="ZIP"     field="zip"     value={data.zip}     save={saveField} saving={savingField} />
          </Grid2>
        </Section>

        {/* Building */}
        <Section icon={Building2} title="Building Info">
          <Grid2>
            <EF label="Property Type"  field="property_type"     value={data.property_type}     save={saveField} saving={savingField} />
            <EF label="Construction"   field="construction_type" value={data.construction_type} save={saveField} saving={savingField} />
            <EF label="Building Size"  field="building_size"     value={data.building_size} type="sqft"  save={saveField} saving={savingField} />
            <EF label="Land Area"      field="land_area"         value={data.land_area}     type="acres" save={saveField} saving={savingField} />
            <EF label="Year Built"     field="year_built"        value={data.year_built}    type="int"   save={saveField} saving={savingField} />
            <EF label="Year Purchased" field="year_purchased"    value={data.year_purchased} type="int"  save={saveField} saving={savingField} />
          </Grid2>
        </Section>

        {/* Lease */}
        <Section icon={CalendarDays} title="Lease">
          <Grid2>
            <EF label="Lease Type"  field="lease_type"  value={data.lease_type} save={saveField} saving={savingField} />
            <EF label="Lease Start" field="lease_start" value={data.lease_start} type="date" save={saveField} saving={savingField} />
            <EF label="Lease End"   field="lease_end"   value={data.lease_end}   type="date" save={saveField} saving={savingField}
              suffix={lm != null && <span className={`ml-2 text-xs font-medium ${leaseColor(lm)}`}>{leaseLabel(lm)}</span>} />
            <EF label="Annual Rent"     field="annual_rent"     value={data.annual_rent} type="currency" save={saveField} saving={savingField} />
            <EF label="Rent Bumps"      field="rent_bumps"      value={data.rent_bumps} save={saveField} saving={savingField} />
            <EF label="Renewal Options" field="renewal_options" value={data.renewal_options} save={saveField} saving={savingField} />
          </Grid2>
        </Section>

        {/* Financials */}
        <Section icon={TrendingUp} title="Financials">
          <Grid2>
            <Field label="Cap Rate"        value={fmtPct(data.cap_rate)} accent="emerald" />
            <EF label="NOI"             field="noi"             value={data.noi}             type="currency" save={saveField} saving={savingField} />
            <EF label="List Price"      field="list_price"      value={data.list_price}      type="currency" save={saveField} saving={savingField} />
            <EF label="Purchase Price"  field="purchase_price"  value={data.purchase_price}  type="currency" save={saveField} saving={savingField} />
            <EF label="Estimated Value" field="estimated_value" value={data.estimated_value} type="currency" save={saveField} saving={savingField} />
            <EF label="Expense"         field="expense"         value={data.expense}         type="currency" save={saveField} saving={savingField} />
            <EF label="Taxes"           field="taxes"           value={data.taxes}           type="currency" save={saveField} saving={savingField} />
            <EF label="Insurance"       field="insurance"       value={data.insurance}       type="currency" save={saveField} saving={savingField} />
            <Field label="Listing Status" value={
              data.listing_status === 'listed'           ? <span className="text-blue-700 font-semibold">Listed</span>
              : data.listing_status === 'under_contract' ? <span className="text-amber-700 font-semibold">Under Contract</span>
              : data.listing_status === 'sold'           ? <span className="text-slate-500 font-semibold">Sold</span>
              : null
            } />
            <Field label="Fee" value={(() => {
              const effective = data.fee_amount != null
                ? data.fee_amount
                : data.purchase_price ? data.purchase_price * 1.1 * 0.015 : null
              if (!effective) return null
              return (
                <span className="text-emerald-700 font-semibold">
                  {fmt$(effective)}
                  {data.fee_amount != null
                    ? <span className="ml-1.5 text-xs font-normal text-amber-600">override</span>
                    : <span className="ml-1.5 text-xs font-normal text-slate-400">auto</span>
                  }
                </span>
              )
            })()} />
          </Grid2>
        </Section>

        {/* Systems */}
        <Section icon={Wrench} title="Systems">
          <Grid2>
            <EF label="Roof Year"   field="roof_year"   value={data.roof_year} type="int" save={saveField} saving={savingField} />
            <EF label="HVAC Year"   field="hvac_year"   value={data.hvac_year} type="int" save={saveField} saving={savingField} />
            <EF label="Parking Lot" field="parking_lot" value={data.parking_lot} save={saveField} saving={savingField} />
          </Grid2>
        </Section>

        {/* Debt / Financing — portfolio only */}
        {(data.bank || data.outstanding_debt || data.interest_rate || data.maturity_date) && (
          <Section icon={TrendingUp} title="Debt & Financing">
            <Grid2>
              <EF label="Bank / Lender"     field="bank"             value={data.bank} save={saveField} saving={savingField} />
              <EF label="Interest Rate"     field="interest_rate"    value={data.interest_rate} type="percent" save={saveField} saving={savingField} />
              <EF label="Maturity Date"     field="maturity_date"    value={data.maturity_date} type="date" save={saveField} saving={savingField} />
              <EF label="Outstanding Debt"  field="outstanding_debt" value={data.outstanding_debt} type="currency" save={saveField} saving={savingField} />
              <EF label="Total Debt Payment" field="total_debt_pmt"  value={data.total_debt_pmt} type="currency" save={saveField} saving={savingField} />
              <EF label="Interest Payment"  field="interest_pmt"     value={data.interest_pmt} type="currency" save={saveField} saving={savingField} />
              <EF label="Principal Payment" field="principal_pmt"    value={data.principal_pmt} type="currency" save={saveField} saving={savingField} />
              <EF label="RTD / DSCR Ratio"  field="rtd_ratio"        value={data.rtd_ratio} type="number" save={saveField} saving={savingField} />
            </Grid2>
          </Section>
        )}

        {/* Insurance — portfolio only */}
        {(data.ins_broker || data.policy_number || data.insurance_exp) && (
          <Section icon={FileText} title="Insurance">
            <Grid2>
              <EF label="Broker"         field="ins_broker"     value={data.ins_broker} save={saveField} saving={savingField} />
              <EF label="Policy Number"  field="policy_number"  value={data.policy_number} save={saveField} saving={savingField} />
              <EF label="Account Number" field="account_number" value={data.account_number} save={saveField} saving={savingField} />
              <EF label="Expires"        field="insurance_exp"  value={data.insurance_exp} type="date" save={saveField} saving={savingField} />
            </Grid2>
          </Section>
        )}

        {/* Management — portfolio only */}
        {(data.store_manager || data.district_manager || data.store_number || data.qb_account) && (
          <Section icon={User} title="Management">
            <Grid2>
              <EF label="Store #"          field="store_number"     value={data.store_number} save={saveField} saving={savingField} />
              <EF label="QB Account"       field="qb_account"       value={data.qb_account} save={saveField} saving={savingField} />
              <EF label="Store Manager"    field="store_manager"    value={data.store_manager} save={saveField} saving={savingField} />
              <EF label="District Manager" field="district_manager" value={data.district_manager} save={saveField} saving={savingField} />
            </Grid2>
          </Section>
        )}

        {/* Notes */}
        <Section icon={FileText} title="Notes">
          <EF label="" field="notes" value={data.notes} type="textarea" save={saveField} saving={savingField} placeholder="Add notes…" />
        </Section>

        {/* Owner */}
        <Section icon={User} title="Owner">
          <div className="mb-3">
            <RelationField
              label="Owner" relation="owner" propertyId={propertyId}
              currentId={data.owner_id} currentName={data.owner_name}
              loadOptions={getAllPeople} onCommit={saveRelation} saving={savingField === 'owner'}
            />
          </div>
          {data.owner_name && (<>
            <div className="mb-3 flex items-center gap-2 flex-wrap">
              {/* Clickable owner name → people page */}
              {data.owner_id ? (
                <button
                  onClick={() => navigate(`/people?open=${data.owner_id}`)}
                  className="font-semibold text-blue-700 hover:underline flex items-center gap-1"
                >
                  {data.owner_name}
                  <ExternalLink className="w-3 h-3 opacity-60" />
                </button>
              ) : (
                <span className="font-semibold text-slate-900">{data.owner_name}</span>
              )}
              {data.owner_role && (
                <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${ROLE_COLORS[data.owner_role] || 'bg-slate-100 text-slate-600'}`}>
                  {ROLE_LABELS[data.owner_role] || data.owner_role}
                </span>
              )}
              {data.owner_sub_label && (
                <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 capitalize">{data.owner_sub_label}</span>
              )}
              {data.owner_do_not_contact ? (
                <span className="flex items-center gap-1 text-xs font-semibold text-red-700 bg-red-50 px-2 py-0.5 rounded-full">
                  <AlertCircle className="w-3 h-3" /> Do Not Contact
                </span>
              ) : null}
              {/* Send letter button */}
              {data.owner_id && data.owner_address && !data.owner_do_not_contact && (
                <button
                  onClick={() => setShowLetterModal(true)}
                  className="ml-auto flex items-center gap-1 text-xs font-medium text-blue-600 border border-blue-200 bg-blue-50 hover:bg-blue-100 px-2.5 py-1 rounded-lg transition-colors"
                >
                  <Mail className="w-3 h-3" /> Send Letter
                </button>
              )}
            </div>

            <div className="space-y-2.5">
              {data.owner_phone  && <ContactRow icon={Phone} label="Phone"   value={data.owner_phone}  href={`tel:${data.owner_phone}`} />}
              {data.owner_mobile && <ContactRow icon={Phone} label="Mobile"  value={data.owner_mobile} href={`tel:${data.owner_mobile}`} />}
              {data.owner_phone2 && <ContactRow icon={Phone} label="Phone 2" value={data.owner_phone2} href={`tel:${data.owner_phone2}`} />}
              {data.owner_email  && <ContactRow icon={Mail}  label="Email"   value={data.owner_email}  href={`mailto:${data.owner_email}`} />}
              {data.owner_email2 && <ContactRow icon={Mail}  label="Email 2" value={data.owner_email2} href={`mailto:${data.owner_email2}`} />}
            </div>

            {/* Owner address */}
            {data.owner_address && (
              <div className="mt-3 pt-3 border-t border-slate-100">
                <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-2">Mailing Address</p>
                <Grid2>
                  <Field label="Street" value={data.owner_address} />
                  <Field label="City"   value={data.owner_city} />
                  <Field label="State"  value={data.owner_state} />
                  <Field label="ZIP"    value={data.owner_zip} />
                </Grid2>
              </div>
            )}
            {data.owner_address2 && (
              <div className="mt-3 pt-3 border-t border-slate-100">
                <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-2">Alt Address</p>
                <Grid2>
                  <Field label="Street" value={data.owner_address2} />
                  <Field label="City"   value={data.owner_city2} />
                  <Field label="State"  value={data.owner_state2} />
                  <Field label="ZIP"    value={data.owner_zip2} />
                </Grid2>
              </div>
            )}
            {data.owner_notes && (
              <div className="mt-3 pt-3 border-t border-slate-100">
                <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-1">Owner Notes</p>
                <p className="text-sm text-slate-700 leading-relaxed whitespace-pre-line">{data.owner_notes}</p>
              </div>
            )}
          </>)}
        </Section>

        {(data.created_at || data.updated_at) && (
          <p className="px-1 pt-4 text-xs text-slate-400">
            {data.created_at && <>Added {new Date(String(data.created_at).replace(' ', 'T') + 'Z').toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })}</>}
            {data.created_at && data.updated_at && ' · '}
            {data.updated_at && <>Last updated {new Date(String(data.updated_at).replace(' ', 'T') + 'Z').toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })}</>}
          </p>
        )}

        {/* Bottom padding */}
        <div className="h-8" />
      </div>

      {/* Auto-fill review modal */}
      {autoFill && (
        <ExtractedFieldsModal
          propertyId={propertyId}
          docType={autoFill.docType}
          data={autoFill.data}
          onApplied={() => getProperty(propertyId).then(setData).catch(() => {})}
          onClose={() => setAutoFill(null)}
        />
      )}

      {/* Send Letter modal */}
      {showLetterModal && data.owner_id && (
        <SendLetterModal
          person={{
            id:         data.owner_id,
            name:       data.owner_name,
            first_name: data.owner_first_name,
            address:    data.owner_address,
            city:       data.owner_city,
            state:      data.owner_state,
            zip:        data.owner_zip,
          }}
          property={data}
          onClose={() => setShowLetterModal(false)}
          onSent={() => setShowLetterModal(false)}
        />
      )}

      {showEmail && (
        <InvestorEmailComposer
          propertyId={propertyId}
          property={data}
          purpose="update"
          onClose={() => setShowEmail(false)}
        />
      )}

      {/* Add-to-Pipeline mini-modal */}
      {showPipeline && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/30 rounded-none">
          <form
            onSubmit={handleAddToPipeline}
            className="bg-white rounded-2xl shadow-2xl w-80 mx-4 p-6 flex flex-col gap-4"
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <TrendingUp className="w-4 h-4 text-blue-600" />
                <h3 className="text-sm font-semibold text-slate-900">Add to Pipeline</h3>
              </div>
              <button
                type="button"
                onClick={() => setShowPipeline(false)}
                className="w-7 h-7 rounded-lg flex items-center justify-center text-slate-400 hover:bg-slate-100"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Property info */}
            <div className="bg-slate-50 rounded-lg px-3 py-2 text-xs text-slate-600">
              <p className="font-medium text-slate-800 truncate">{data.address}</p>
              {data.tenant_brand_name && <p className="text-slate-500 mt-0.5">{data.tenant_brand_name}</p>}
            </div>

            {/* Purchase Price */}
            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1.5">
                Purchase Price
              </label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-sm">$</span>
                <input
                  type="number"
                  min="0"
                  step="1"
                  value={pipelinePrice}
                  onChange={e => setPipelinePrice(e.target.value)}
                  placeholder="0"
                  className="w-full pl-7 pr-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-400"
                />
              </div>
            </div>

            {/* Deal Stage */}
            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1.5">
                Deal Stage
              </label>
              <select
                value={pipelineStage}
                onChange={e => setPipelineStage(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-400 bg-white"
              >
                {PIPELINE_STAGES.map(s => (
                  <option key={s.key} value={s.key}>{s.label}</option>
                ))}
              </select>
            </div>

            {/* Actions */}
            <div className="flex gap-2 pt-1">
              <button
                type="button"
                onClick={() => setShowPipeline(false)}
                className="flex-1 px-3 py-2 rounded-lg text-xs font-medium text-slate-600 border border-slate-200 hover:bg-slate-50 transition-colors"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={pipelineWorking}
                className="flex-1 px-3 py-2 rounded-lg text-xs font-semibold bg-blue-600 text-white hover:bg-blue-700 transition-colors disabled:opacity-50"
              >
                {pipelineWorking ? 'Adding…' : 'Add to Pipeline'}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  )
}

/* ── Sub-components ────────────────────────────────────────── */

function Section({ icon: Icon, title, children }) {
  return (
    <div className="px-6 py-4 border-t border-slate-100">
      <div className="flex items-center gap-2 mb-3">
        <Icon className="w-3.5 h-3.5 text-slate-400" />
        <p className="text-xs font-semibold text-slate-400 uppercase tracking-widest">{title}</p>
      </div>
      {children}
    </div>
  )
}

function Grid2({ children }) {
  return <div className="grid grid-cols-2 gap-x-6 gap-y-3">{children}</div>
}

// Format a raw column value for read-mode display, by editor type.
function formatEditable(type, value) {
  if (value == null || value === '') return null
  switch (type) {
    case 'currency': return fmt$(value)
    case 'date':     return fmtDate(value)
    case 'sqft':     return fmtSqft(value)
    case 'acres':    return fmtAcres(value)
    case 'percent':  return `${value}%`
    default:         return value            // text / number / int / textarea
  }
}

// EF — an inline click-to-edit field. Read mode shows the formatted value (or a
// dash) and a pencil on hover; clicking swaps to the right input. Enter / blur
// saves just this one column; Escape cancels. `save(column, value)` does the PATCH.
function EF({ label, field, value, type = 'text', accent, suffix, placeholder, save, saving }) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft]     = useState('')
  const inputRef = useRef(null)

  useEffect(() => {
    if (editing) { inputRef.current?.focus(); inputRef.current?.select?.() }
  }, [editing])

  const isBusy = saving === field
  const numeric = ['currency', 'number', 'sqft', 'acres', 'percent'].includes(type)

  function begin() { if (isBusy) return; setDraft(value == null ? '' : String(value)); setEditing(true) }
  function cancel() { setEditing(false) }
  function commit() {
    setEditing(false)
    const next = draft.trim()
    const orig = value == null ? '' : String(value)
    if (next === orig) return
    save(field, next === '' ? null : next)
  }

  const display = formatEditable(type, value)
  const inputCls = 'w-full px-2 py-1 text-sm border border-blue-300 rounded-md bg-white focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-400'

  if (editing) {
    return (
      <div className={type === 'textarea' ? 'col-span-2' : ''}>
        {label && <p className="text-xs text-slate-400 mb-0.5">{label}</p>}
        {type === 'textarea' ? (
          <textarea ref={inputRef} rows={3} value={draft} placeholder={placeholder}
            onChange={e => setDraft(e.target.value)} onBlur={commit}
            onKeyDown={e => { if (e.key === 'Escape') cancel() }}
            className={inputCls + ' leading-relaxed resize-y'} />
        ) : (
          <input ref={inputRef}
            type={type === 'date' ? 'date' : numeric && type !== 'text' ? 'number' : 'text'}
            step={type === 'int' ? '1' : 'any'} value={draft} placeholder={placeholder}
            onChange={e => setDraft(e.target.value)} onBlur={commit}
            onKeyDown={e => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') cancel() }}
            className={inputCls} />
        )}
      </div>
    )
  }

  return (
    <button type="button" onClick={begin} disabled={isBusy}
      className={`group text-left w-full ${type === 'textarea' ? 'col-span-2' : ''}`}>
      {label && <p className="text-xs text-slate-400 mb-0.5">{label}</p>}
      <div className={`text-sm font-medium rounded px-1 -mx-1 min-h-[1.25rem] flex items-start gap-1 group-hover:bg-blue-50/60 transition-colors ${
        display == null ? 'text-slate-300' : accent === 'emerald' ? 'text-emerald-700' : 'text-slate-800'
      }`}>
        <span className={type === 'textarea' ? 'whitespace-pre-line leading-relaxed flex-1' : 'flex-1'}>
          {display == null ? (placeholder || '—') : display}{suffix}
        </span>
        {isBusy
          ? <Loader2 className="w-3 h-3 text-blue-400 animate-spin shrink-0 mt-0.5" />
          : <Pencil className="w-3 h-3 text-slate-300 opacity-0 group-hover:opacity-100 shrink-0 mt-0.5" />}
      </div>
    </button>
  )
}

// RelationField — inline picker for a linked record (tenant brand / operator /
// owner). Click to open a searchable list of existing records; type a new name
// and pick "Create …" to add one on the fly; "Clear" unlinks. Commits via
// onCommit(relation, {id} | {name} | {}).
function RelationField({ label, relation, propertyId, currentId, currentName, loadOptions, onCommit, saving }) {
  const [open, setOpen]       = useState(false)
  const [query, setQuery]     = useState('')
  const [options, setOptions] = useState(null)   // null = not yet loaded
  const [loading, setLoading] = useState(false)
  const boxRef   = useRef(null)
  const inputRef = useRef(null)

  useEffect(() => {
    if (!open) return
    inputRef.current?.focus()
    if (options == null && !loading) {
      setLoading(true)
      Promise.resolve(loadOptions())
        .then(list => setOptions(Array.isArray(list) ? list : (list?.rows || [])))
        .catch(() => setOptions([]))
        .finally(() => setLoading(false))
    }
  }, [open])   // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!open) return
    function onDoc(e) { if (boxRef.current && !boxRef.current.contains(e.target)) close() }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [open])

  function close() { setOpen(false); setQuery('') }
  async function choose(payload) { close(); await onCommit(relation, payload) }

  const q = query.trim().toLowerCase()
  const filtered = (options || []).filter(o => o.name?.toLowerCase().includes(q)).slice(0, 8)
  const exact    = (options || []).some(o => o.name?.toLowerCase() === q)

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} disabled={saving} className="group text-left w-full">
        <p className="text-xs text-slate-400 mb-0.5">{label}</p>
        <div className={`text-sm font-medium rounded px-1 -mx-1 min-h-[1.25rem] flex items-center gap-1 group-hover:bg-blue-50/60 transition-colors ${currentName ? 'text-slate-800' : 'text-slate-300'}`}>
          <span className="flex-1 truncate">{currentName || '—'}</span>
          {saving
            ? <Loader2 className="w-3 h-3 text-blue-400 animate-spin shrink-0" />
            : <Pencil className="w-3 h-3 text-slate-300 opacity-0 group-hover:opacity-100 shrink-0" />}
        </div>
      </button>
    )
  }

  return (
    <div ref={boxRef} className="relative">
      <p className="text-xs text-slate-400 mb-0.5">{label}</p>
      <input
        ref={inputRef} value={query} placeholder="Search or type a new name…"
        onChange={e => setQuery(e.target.value)}
        onKeyDown={e => {
          if (e.key === 'Escape') close()
          if (e.key === 'Enter') {
            if (filtered.length === 1) choose({ id: filtered[0].id })
            else if (q && !exact) choose({ name: query.trim() })
          }
        }}
        className="w-full px-2 py-1 text-sm border border-blue-300 rounded-md bg-white focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-400"
      />
      <div className="absolute z-50 mt-1 w-full max-h-60 overflow-y-auto bg-white border border-slate-200 rounded-lg shadow-xl py-1">
        {loading && <div className="px-3 py-2 text-xs text-slate-400 flex items-center gap-1.5"><Loader2 className="w-3 h-3 animate-spin" /> Loading…</div>}
        {!loading && filtered.map(o => (
          <button key={o.id} type="button" onMouseDown={e => e.preventDefault()} onClick={() => choose({ id: o.id })}
            className="w-full text-left px-3 py-1.5 text-sm text-slate-700 hover:bg-blue-50 flex items-center gap-2">
            <span className="flex-1 truncate">{o.name}</span>
            {o.id === currentId && <Check className="w-3.5 h-3.5 text-emerald-600 shrink-0" />}
          </button>
        ))}
        {!loading && q && !exact && (
          <button type="button" onMouseDown={e => e.preventDefault()} onClick={() => choose({ name: query.trim() })}
            className="w-full text-left px-3 py-1.5 text-sm text-blue-700 hover:bg-blue-50 flex items-center gap-2 border-t border-slate-100">
            <Plus className="w-3.5 h-3.5 shrink-0" /> Create “{query.trim()}”
          </button>
        )}
        {!loading && !q && filtered.length === 0 && (
          <div className="px-3 py-2 text-xs text-slate-400">No records yet — type a name to create one.</div>
        )}
        {currentId && (
          <button type="button" onMouseDown={e => e.preventDefault()} onClick={() => choose({})}
            className="w-full text-left px-3 py-1.5 text-xs text-slate-500 hover:bg-slate-50 flex items-center gap-2 border-t border-slate-100">
            <X className="w-3.5 h-3.5 shrink-0" /> Clear
          </button>
        )}
      </div>
    </div>
  )
}

function Field({ label, value, accent }) {
  if (!value && value !== 0) return (
    <div>
      <p className="text-xs text-slate-400 mb-0.5">{label}</p>
      <p className="text-sm text-slate-300">—</p>
    </div>
  )
  return (
    <div>
      <p className="text-xs text-slate-400 mb-0.5">{label}</p>
      <p className={`text-sm font-medium ${accent === 'emerald' ? 'text-emerald-700' : 'text-slate-800'}`}>
        {value}
      </p>
    </div>
  )
}

function Kpi({ label, value, accent }) {
  if (!value) return null
  return (
    <div>
      <p className="text-xs text-slate-400">{label}</p>
      <p className={`text-sm font-bold ${accent === 'emerald' ? 'text-emerald-700' : 'text-slate-800'}`}>{value}</p>
    </div>
  )
}

function ContactRow({ icon: Icon, label, value, href }) {
  return (
    <div className="flex items-center gap-3">
      <div className="w-7 h-7 rounded-lg bg-slate-100 flex items-center justify-center shrink-0">
        <Icon className="w-3.5 h-3.5 text-slate-500" />
      </div>
      <div className="min-w-0">
        <p className="text-xs text-slate-400">{label}</p>
        {href
          ? <a href={href} className="text-sm text-blue-600 hover:underline truncate block">{value}</a>
          : <p className="text-sm text-slate-800 truncate">{value}</p>
        }
      </div>
    </div>
  )
}
