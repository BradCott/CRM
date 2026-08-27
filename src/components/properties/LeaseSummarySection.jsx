// Lease Summary — a compact, read-only view of the AI lease abstract, shown on the
// property Overview. Auto-populates from whatever lease/amendments have been
// uploaded (Management → Lease). Surfaces the terms a portfolio owner checks most:
// rate, term, options, escalations, the major landlord/tenant responsibilities
// (roof, structure, HVAC, parking), and how taxes & insurance are handled.
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { FileText, Loader2, Sparkles, ChevronRight } from 'lucide-react'
import { getPropertyLease } from '../../api/client'

const PARTY_STYLE = {
  Tenant:   'bg-blue-50 text-blue-700 border-blue-200',
  Landlord: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  Shared:   'bg-violet-50 text-violet-700 border-violet-200',
  Unclear:  'bg-slate-100 text-slate-500 border-slate-200',
}
const Badge = ({ p }) => (
  <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full border whitespace-nowrap ${PARTY_STYLE[p] || PARTY_STYLE.Unclear}`}>{p || 'Unclear'}</span>
)

// Major responsibilities we always surface, matched loosely against the matrix
// categories (e.g. "Structure / Foundation", "Parking Lot / Paving").
const MAJOR = [
  ['Roof',      ['roof']],
  ['Structure', ['structure', 'foundation']],
  ['HVAC',      ['hvac']],
  ['Parking',   ['parking', 'paving']],
]
function findParty(resps, needles) {
  const r = resps.find(x => { const c = (x.category || '').toLowerCase(); return needles.some(n => c.includes(n)) })
  return r?.party || null
}
// Prefer the explicit recovery classification from the abstract; else infer a
// reasonable label from who bears the cost in the responsibility matrix.
function recovery(explicit, resps, needles) {
  if (explicit && String(explicit).trim()) return explicit
  const p = findParty(resps, needles)
  if (!p) return null
  if (p === 'Landlord') return "Landlord's expense"
  if (p === 'Tenant')   return 'Tenant (direct or reimbursed)'
  return p
}

const Term = ({ label, value }) => value ? (
  <div className="min-w-0">
    <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-wide">{label}</p>
    <p className="text-sm text-slate-800 break-words">{value}</p>
  </div>
) : null

export default function LeaseSummarySection({ propertyId }) {
  const [lease, setLease] = useState(null)
  const [loading, setLoading] = useState(true)
  const nav = useNavigate()

  useEffect(() => {
    let live = true
    getPropertyLease(propertyId)
      .then(r => { if (live) setLease(r.lease) })
      .catch(() => {})
      .finally(() => { if (live) setLoading(false) })
    return () => { live = false }
  }, [propertyId])

  const openManager = () => nav(`/property/${propertyId}?tab=management`)

  const wrap = body => (
    <div className="px-6 py-4 border-t border-slate-100">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <FileText className="w-3.5 h-3.5 text-slate-400" />
          <p className="text-xs font-semibold text-slate-400 uppercase tracking-widest">Lease Summary</p>
        </div>
        {lease?.abstract && (
          <button onClick={openManager} className="text-[11px] font-medium text-blue-600 hover:text-blue-700 inline-flex items-center gap-0.5">
            Full lease <ChevronRight className="w-3 h-3" />
          </button>
        )}
      </div>
      {body}
    </div>
  )

  if (loading) return wrap(<div className="flex justify-center py-4"><Loader2 className="w-4 h-4 text-slate-300 animate-spin" /></div>)

  if (lease?.status === 'processing') {
    return wrap(<p className="text-xs text-slate-500 flex items-center gap-2"><Loader2 className="w-3.5 h-3.5 animate-spin text-blue-500" /> Abstracting the lease with AI…</p>)
  }

  const a = lease?.abstract
  if (!a) {
    return wrap(
      <button onClick={openManager} className="w-full flex items-center gap-3 rounded-xl border border-dashed border-slate-200 hover:border-blue-300 hover:bg-blue-50/40 px-4 py-3 text-left transition-colors">
        <span className="w-8 h-8 rounded-lg bg-blue-50 flex items-center justify-center shrink-0"><Sparkles className="w-4 h-4 text-blue-600" /></span>
        <span className="min-w-0">
          <span className="block text-sm font-medium text-slate-700">Upload a lease to auto-fill this</span>
          <span className="block text-xs text-slate-400">AI pulls the rate, term, options, escalations and who&apos;s responsible for roof, structure, HVAC, parking, taxes &amp; insurance.</span>
        </span>
      </button>
    )
  }

  const s = a.summary || {}
  const resps = Array.isArray(a.responsibilities) ? a.responsibilities : []
  const taxes = recovery(s.taxes_recovery, resps, ['tax'])
  const insurance = recovery(s.insurance_recovery, resps, ['building insurance', 'property insurance', 'insurance'])

  return wrap(
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-x-6 gap-y-3">
        <Term label="Lease Type" value={s.lease_type} />
        <Term label="Term" value={s.term} />
        <Term label="Base Rent" value={s.base_rent} />
        <Term label="Escalations" value={s.rent_escalations} />
        <Term label="Renewal Options" value={s.renewal_options} />
        <Term label="Renewal Notice" value={s.renewal_notice} />
      </div>

      <div>
        <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-wide mb-2">Major Responsibilities</p>
        <div className="grid grid-cols-2 gap-2">
          {MAJOR.map(([label, needles]) => (
            <div key={label} className="flex items-center justify-between gap-2 rounded-lg border border-slate-100 bg-slate-50/60 px-3 py-1.5">
              <span className="text-xs font-medium text-slate-600">{label}</span>
              <Badge p={findParty(resps, needles)} />
            </div>
          ))}
        </div>
      </div>

      {(taxes || insurance) && (
        <div>
          <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-wide mb-2">Taxes &amp; Insurance</p>
          <div className="space-y-1.5">
            {taxes && <div className="flex items-start justify-between gap-3 text-xs"><span className="text-slate-500 shrink-0">Real Estate Taxes</span><span className="font-medium text-slate-700 text-right">{taxes}</span></div>}
            {insurance && <div className="flex items-start justify-between gap-3 text-xs"><span className="text-slate-500 shrink-0">Building Insurance</span><span className="font-medium text-slate-700 text-right">{insurance}</span></div>}
          </div>
        </div>
      )}
    </div>
  )
}
