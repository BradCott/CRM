import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  X, Pencil, Building2, MapPin, Phone, Mail, FileText,
  AlertCircle, CalendarDays, Wrench, User, TrendingUp, Landmark, CheckCircle2, ExternalLink,
} from 'lucide-react'
import { getProperty, togglePortfolio, clearOwnershipReview } from '../../api/client'
import { useApp } from '../../context/AppContext'
import Button from '../ui/Button'
import SendLetterModal from '../handwrytten/SendLetterModal'

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

export default function PropertyDetail({ propertyId, onClose, onEdit, onPortfolioChange }) {
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

  useEffect(() => {
    if (!propertyId) return
    setData(null)
    getProperty(propertyId).then(setData).catch(console.error)
  }, [propertyId])

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
    <div className="fixed inset-y-0 right-0 w-[520px] bg-white border-l border-slate-200 shadow-2xl z-40 flex items-center justify-center">
      <div className="w-5 h-5 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
    </div>
  )

  const lm = leaseMonths(data.lease_end)

  return (
    <div className="fixed inset-y-0 right-0 w-[520px] bg-white border-l border-slate-200 shadow-2xl z-40 flex flex-col">
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
            <Button variant="ghost" size="sm" onClick={onEdit}>
              <Pencil className="w-3.5 h-3.5 mr-1" /> Edit
            </Button>
            <button onClick={onClose} className="w-8 h-8 rounded-lg flex items-center justify-center text-slate-400 hover:bg-slate-100">
              <X className="w-4 h-4" />
            </button>
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

        {/* Location */}
        <Section icon={MapPin} title="Property Address">
          <Grid2>
            <Field label="Street"  value={data.address} />
            <Field label="City"    value={data.city} />
            <Field label="State"   value={data.state} />
            <Field label="ZIP"     value={data.zip} />
          </Grid2>
        </Section>

        {/* Building */}
        <Section icon={Building2} title="Building Info">
          <Grid2>
            <Field label="Property Type"    value={data.property_type} />
            <Field label="Construction"     value={data.construction_type} />
            <Field label="Building Size"    value={fmtSqft(data.building_size)} />
            <Field label="Land Area"        value={data.land_area ? `${Number(data.land_area).toLocaleString()} sf` : null} />
            <Field label="Year Built"       value={data.year_built} />
            <Field label="Year Purchased"   value={data.year_purchased} />
          </Grid2>
        </Section>

        {/* Lease */}
        <Section icon={CalendarDays} title="Lease">
          <Grid2>
            <Field label="Lease Type"      value={data.lease_type} />
            <Field label="Lease Start"     value={data.lease_start} />
            <Field label="Lease End"       value={data.lease_end
              ? <span>{data.lease_end}{lm != null && <span className={`ml-2 text-xs font-medium ${leaseColor(lm)}`}>{leaseLabel(lm)}</span>}</span>
              : null}
            />
            <Field label="Annual Rent"     value={fmt$(data.annual_rent)} />
            <Field label="Rent Bumps"      value={data.rent_bumps} />
            <Field label="Renewal Options" value={data.renewal_options} />
          </Grid2>
        </Section>

        {/* Financials */}
        <Section icon={TrendingUp} title="Financials">
          <Grid2>
            <Field label="Cap Rate"        value={fmtPct(data.cap_rate)} accent="emerald" />
            <Field label="NOI"             value={fmt$(data.noi)} />
            <Field label="List Price"      value={fmt$(data.list_price)} />
            <Field label="Purchase Price"  value={fmt$(data.purchase_price)} />
            <Field label="Estimated Value" value={fmt$(data.estimated_value)} />
            <Field label="Expense"         value={fmt$(data.expense)} />
            <Field label="Taxes"           value={fmt$(data.taxes)} />
            <Field label="Insurance"       value={fmt$(data.insurance)} />
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
            <Field label="Roof Year"   value={data.roof_year} />
            <Field label="HVAC Year"   value={data.hvac_year} />
            <Field label="Parking Lot" value={data.parking_lot} />
          </Grid2>
        </Section>

        {/* Debt / Financing — portfolio only */}
        {(data.bank || data.outstanding_debt || data.interest_rate || data.maturity_date) && (
          <Section icon={TrendingUp} title="Debt & Financing">
            <Grid2>
              <Field label="Bank / Lender"      value={data.bank} />
              <Field label="Interest Rate"       value={data.interest_rate ? `${data.interest_rate}%` : null} />
              <Field label="Maturity Date"       value={data.maturity_date} />
              <Field label="Outstanding Debt"    value={fmt$(data.outstanding_debt)} />
              <Field label="Total Debt Payment"  value={fmt$(data.total_debt_pmt)} />
              <Field label="Interest Payment"    value={fmt$(data.interest_pmt)} />
              <Field label="Principal Payment"   value={fmt$(data.principal_pmt)} />
              <Field label="RTD / DSCR Ratio"    value={data.rtd_ratio ? Number(data.rtd_ratio).toFixed(3) : null} />
            </Grid2>
          </Section>
        )}

        {/* Insurance — portfolio only */}
        {(data.ins_broker || data.policy_number || data.insurance_exp) && (
          <Section icon={FileText} title="Insurance">
            <Grid2>
              <Field label="Broker"         value={data.ins_broker} />
              <Field label="Policy Number"  value={data.policy_number} />
              <Field label="Account Number" value={data.account_number} />
              <Field label="Expires"        value={data.insurance_exp} />
            </Grid2>
          </Section>
        )}

        {/* Management — portfolio only */}
        {(data.store_manager || data.district_manager || data.store_number || data.qb_account) && (
          <Section icon={User} title="Management">
            <Grid2>
              <Field label="Store #"          value={data.store_number} />
              <Field label="QB Account"       value={data.qb_account} />
              <Field label="Store Manager"    value={data.store_manager} />
              <Field label="District Manager" value={data.district_manager} />
            </Grid2>
          </Section>
        )}

        {/* Notes */}
        {data.notes && (
          <Section icon={FileText} title="Notes">
            <p className="text-sm text-slate-700 leading-relaxed whitespace-pre-line">{data.notes}</p>
          </Section>
        )}

        {/* Owner */}
        {data.owner_name && (
          <Section icon={User} title="Owner">
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
          </Section>
        )}

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
