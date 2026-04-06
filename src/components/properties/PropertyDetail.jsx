import { useEffect, useState } from 'react'
import {
  X, Pencil, Building2, MapPin, Phone, Mail, FileText,
  AlertCircle, CalendarDays, Wrench, User, TrendingUp, Landmark, CheckCircle2,
} from 'lucide-react'
import { getProperty, togglePortfolio } from '../../api/client'
import Button from '../ui/Button'

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
  const [data, setData] = useState(null)
  const [toggling, setToggling] = useState(false)

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
            {data.tenant_brand_name && (
              <span className="inline-block text-xs font-semibold text-blue-700 bg-blue-50 px-2.5 py-0.5 rounded-full mb-2">
                {data.tenant_brand_name}
              </span>
            )}
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
              <span className="font-semibold text-slate-900">{data.owner_name}</span>
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

        {/* Bottom padding */}
        <div className="h-8" />
      </div>
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
