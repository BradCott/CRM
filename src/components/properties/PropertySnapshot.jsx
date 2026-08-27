// Clean, OM-style property snapshot: List Price / Cap Rate box, a striped detail
// table, the rent schedule, and a compact responsibility strip. Auto-fills from
// the property record + the AI lease abstract. Reused on the property Overview
// and the Management dashboard.
import { useEffect, useState } from 'react'
import { Building2, Loader2 } from 'lucide-react'
import { getProperty, getPropertyLease, propertyPhotoUrl } from '../../api/client'

const money = n => (n == null || n === '' || isNaN(Number(n))) ? null : '$' + Number(n).toLocaleString('en-US', { maximumFractionDigits: 0 })
const pct   = n => (n == null || n === '' || isNaN(Number(n))) ? null : `${Math.round(Number(n) * 100) / 100}%`
const sf    = n => (n == null || n === '' || isNaN(Number(n))) ? null : `${Number(n).toLocaleString()} SF`
const acres = n => (n == null || n === '' || isNaN(Number(n))) ? null : `${Number(n)} Acres`
const mdy   = d => { if (!d) return null; const m = String(d).match(/^(\d{4})-(\d{2})-(\d{2})/); return m ? `${m[2]}/${m[3]}/${m[1]}` : d }
function yearsLeft(end) {
  if (!end) return null
  const ms = new Date(String(end).slice(0, 10) + 'T00:00:00') - new Date()
  if (isNaN(ms)) return null
  const y = ms / (1000 * 60 * 60 * 24 * 365.25)
  return y > 0 ? `${y.toFixed(1)} Years` : 'Expired'
}
const monthlyFrom = a => (a == null || isNaN(Number(a))) ? null : Math.round(Number(a) / 12)

// Loose match of a responsibility matrix category → party.
function partyFor(resps, needles) {
  const r = resps.find(x => { const c = (x.category || '').toLowerCase(); return needles.some(n => c.includes(n)) })
  return r?.party || null
}
function recovery(explicit, resps, needles) {
  if (explicit && String(explicit).trim()) return explicit
  const p = partyFor(resps, needles)
  if (!p) return null
  if (p === 'Landlord') return "Landlord's expense"
  if (p === 'Tenant') return 'Tenant (direct/reimbursed)'
  return p
}

export default function PropertySnapshot({ propertyId }) {
  const [p, setP] = useState(null)
  const [lease, setLease] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let live = true
    Promise.all([
      getProperty(propertyId).catch(() => null),
      getPropertyLease(propertyId).then(r => r.lease).catch(() => null),
    ]).then(([prop, lz]) => { if (live) { setP(prop); setLease(lz) } })
      .finally(() => { if (live) setLoading(false) })
    return () => { live = false }
  }, [propertyId])

  if (loading) return <div className="flex justify-center py-10"><Loader2 className="w-5 h-5 text-slate-300 animate-spin" /></div>
  if (!p) return null

  const s = lease?.abstract?.summary || {}
  const resps = Array.isArray(lease?.abstract?.responsibilities) ? lease.abstract.responsibilities : []
  const guarantor = s.guarantor || (p.operator_is_corporate ? 'Corporate' : p.operator_name) || null

  const details = [
    ['NOI', money(p.noi)],
    ['Tenant', p.tenant_brand_name || s.tenant || null],
    ['Guarantor', guarantor],
    ['Building Size', sf(p.building_size)],
    ['Lot Size', acres(p.land_area)],
    ['Year Built', p.year_built || null],
    ['Lease Type', p.lease_type || s.lease_type || null],
    ['Lease Expiration', mdy(p.lease_end || s.expiration_date)],
    ['Term Remaining', yearsLeft(p.lease_end || s.expiration_date)],
    ['Options', p.renewal_options || s.renewal_options || null],
    ['Right of First Refusal', s.right_of_first_refusal || null],
  ].filter(([, v]) => v != null && v !== '')

  // Rent schedule: prefer the AI-extracted steps; else a single in-place row.
  let rows = Array.isArray(lease?.abstract?.rent_schedule) ? lease.abstract.rent_schedule.filter(Boolean) : []
  if (!rows.length && p.annual_rent) {
    rows = [{ period: 'In-Place', monthly: monthlyFrom(p.annual_rent), annual: Number(p.annual_rent), increase: p.rent_bumps || '—' }]
  }
  const totalAnnual = p.annual_rent != null ? Number(p.annual_rent) : (rows[0] ? Number(rows[0].annual) : null)
  const showTotal = totalAnnual != null && !isNaN(totalAnnual)

  const roof = partyFor(resps, ['roof']), structure = partyFor(resps, ['structure', 'foundation'])
  const hvac = partyFor(resps, ['hvac']), parking = partyFor(resps, ['parking', 'paving'])
  const taxes = recovery(s.taxes_recovery, resps, ['tax'])
  const insurance = recovery(s.insurance_recovery, resps, ['building insurance', 'property insurance', 'insurance'])
  const hasResp = roof || structure || hvac || parking || taxes || insurance

  const hasPhoto = !!p.photo_path

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Photo */}
        <div className="rounded-lg overflow-hidden bg-slate-100 aspect-[4/3] flex items-center justify-center">
          {hasPhoto
            ? <img src={propertyPhotoUrl(propertyId)} alt={p.address || 'Property'} className="w-full h-full object-cover" />
            : <Building2 className="w-10 h-10 text-slate-300" />}
        </div>

        {/* Stat box + details */}
        <div className="flex flex-col gap-3 min-w-0">
          <div className="rounded-lg bg-slate-800 text-white flex">
            <div className="flex-1 px-5 py-4 border-r border-white/10">
              <div className="text-[10px] tracking-widest text-slate-300 uppercase font-semibold mb-1">List Price</div>
              <div className="text-2xl font-bold leading-none tabular-nums">{money(p.list_price) || '—'}</div>
            </div>
            <div className="flex-1 px-5 py-4">
              <div className="text-[10px] tracking-widest text-slate-300 uppercase font-semibold mb-1">Cap Rate</div>
              <div className="text-2xl font-bold leading-none text-cyan-400 tabular-nums">{pct(p.cap_rate) || '—'}</div>
            </div>
          </div>

          <div className="rounded-lg overflow-hidden border border-slate-100">
            <table className="w-full text-sm">
              <tbody>
                {details.map(([label, value], i) => (
                  <tr key={label} className={i % 2 ? 'bg-white' : 'bg-slate-50'}>
                    <td className="px-4 py-1.5 text-slate-500 whitespace-nowrap">{label}</td>
                    <td className="px-4 py-1.5 text-right font-semibold text-slate-800 tabular-nums">{value}</td>
                  </tr>
                ))}
                {details.length === 0 && <tr><td className="px-4 py-4 text-sm text-slate-400 text-center">No details yet.</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* Rent schedule */}
      {rows.length > 0 && (
        <div className="rounded-lg overflow-hidden border border-slate-200">
          <table className="w-full text-sm tabular-nums">
            <thead>
              <tr className="bg-slate-800 text-white text-[11px] uppercase tracking-wide">
                <th className="px-4 py-2 text-left font-semibold">Rent Schedule</th>
                <th className="px-4 py-2 text-right font-semibold">Monthly</th>
                <th className="px-4 py-2 text-right font-semibold">Annual</th>
                <th className="px-4 py-2 text-right font-semibold">Increase</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i} className={i % 2 ? 'bg-white' : 'bg-slate-50'}>
                  <td className="px-4 py-1.5 text-slate-700">{r.period || '—'}</td>
                  <td className="px-4 py-1.5 text-right text-slate-700">{money(r.monthly ?? monthlyFrom(r.annual)) || '—'}</td>
                  <td className="px-4 py-1.5 text-right text-slate-700">{money(r.annual) || '—'}</td>
                  <td className="px-4 py-1.5 text-right text-slate-500">{r.increase || '—'}</td>
                </tr>
              ))}
              {showTotal && (
                <tr className="bg-slate-100 font-semibold border-t border-slate-300">
                  <td className="px-4 py-1.5 text-slate-800">Total In-Place — Year 1</td>
                  <td className="px-4 py-1.5 text-right text-slate-800">{money(monthlyFrom(totalAnnual)) || '—'}</td>
                  <td className="px-4 py-1.5 text-right text-slate-800">{money(totalAnnual) || '—'}</td>
                  <td className="px-4 py-1.5 text-right text-slate-500">—</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* Responsibilities (compact) */}
      {hasResp && (
        <div className="rounded-lg overflow-hidden border border-slate-100">
          <div className="bg-slate-50 px-4 py-1.5 text-[11px] font-semibold text-slate-500 uppercase tracking-wide">Landlord / Tenant Responsibilities</div>
          <table className="w-full text-sm">
            <tbody>
              {[['Roof', roof], ['Structure', structure], ['HVAC', hvac], ['Parking', parking], ['Real Estate Taxes', taxes], ['Building Insurance', insurance]]
                .filter(([, v]) => v)
                .map(([label, value], i) => (
                  <tr key={label} className={i % 2 ? 'bg-white' : 'bg-slate-50'}>
                    <td className="px-4 py-1.5 text-slate-500 whitespace-nowrap">{label}</td>
                    <td className="px-4 py-1.5 text-right font-medium text-slate-700">{value}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
