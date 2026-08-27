// Compact, editable property snapshot: a dense detail grid (click any value to
// edit), the rent schedule, and a one-line responsibility strip. Auto-fills from
// the property record + AI lease abstract. Reused on Overview + Management dash.
import { useEffect, useState, useRef } from 'react'
import { Loader2, Pencil } from 'lucide-react'
import { getProperty, getPropertyLease, updatePropertyField } from '../../api/client'

const money = n => (n == null || n === '' || isNaN(Number(n))) ? null : '$' + Number(n).toLocaleString('en-US', { maximumFractionDigits: 0 })
const sf    = n => (n == null || n === '' || isNaN(Number(n))) ? null : `${Number(n).toLocaleString()} SF`
const acres = n => (n == null || n === '' || isNaN(Number(n))) ? null : `${Number(n)} Acres`
const mdy   = d => { if (!d) return null; const m = String(d).match(/^(\d{4})-(\d{2})-(\d{2})/); return m ? `${m[2]}/${m[3]}/${m[1]}` : d }
const monthlyFrom = a => (a == null || isNaN(Number(a))) ? null : Math.round(Number(a) / 12)
function yearsLeft(end) {
  if (!end) return null
  const ms = new Date(String(end).slice(0, 10) + 'T00:00:00') - new Date()
  if (isNaN(ms)) return null
  const y = ms / (1000 * 60 * 60 * 24 * 365.25)
  return y > 0 ? `${y.toFixed(1)} Years` : 'Expired'
}
function fmtVal(type, v) {
  if (v == null || v === '') return null
  if (type === 'currency') return money(v)
  if (type === 'date') return mdy(v)
  if (type === 'sf') return sf(v)
  if (type === 'acres') return acres(v)
  return v
}
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

// One dense, click-to-edit (or read-only) key/value cell.
function Cell({ label, value, column, type = 'text', readOnly, display, onSave, saving }) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const ref = useRef(null)
  useEffect(() => { if (editing) { ref.current?.focus(); ref.current?.select?.() } }, [editing])

  const shown = display != null ? display : fmtVal(type, value)
  const inputType = type === 'date' ? 'date' : (type === 'currency' || type === 'number' || type === 'sf' || type === 'acres') ? 'number' : 'text'
  const begin = () => { if (readOnly) return; setDraft(value == null ? '' : String(value)); setEditing(true) }
  const commit = () => {
    setEditing(false)
    const next = draft.trim(), orig = value == null ? '' : String(value)
    if (next !== orig) onSave(column, next === '' ? null : next)
  }

  return (
    <div className="min-w-0">
      <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide leading-tight">{label}</p>
      {editing ? (
        <input ref={ref} value={draft} type={inputType} onChange={e => setDraft(e.target.value)}
          onBlur={commit} onKeyDown={e => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') setEditing(false) }}
          className="w-full text-sm border border-blue-300 rounded px-1.5 py-0.5 focus:outline-none focus:ring-1 focus:ring-blue-400" />
      ) : (
        <button onClick={begin} disabled={readOnly}
          className={`group flex items-center gap-1 max-w-full text-sm text-left ${readOnly ? 'cursor-default text-slate-800' : 'text-slate-800 hover:text-blue-700'}`}>
          <span className="truncate font-medium">{shown ?? <span className="font-normal text-slate-300">{readOnly ? '—' : 'Add'}</span>}</span>
          {saving === column ? <Loader2 className="w-3 h-3 text-slate-300 animate-spin shrink-0" />
            : !readOnly && <Pencil className="w-3 h-3 text-slate-300 opacity-0 group-hover:opacity-100 shrink-0" />}
        </button>
      )}
    </div>
  )
}

export default function PropertySnapshot({ propertyId }) {
  const [p, setP] = useState(null)
  const [lease, setLease] = useState(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(null)

  useEffect(() => {
    let live = true
    Promise.all([
      getProperty(propertyId).catch(() => null),
      getPropertyLease(propertyId).then(r => r.lease).catch(() => null),
    ]).then(([prop, lz]) => { if (live) { setP(prop); setLease(lz) } })
      .finally(() => { if (live) setLoading(false) })
    return () => { live = false }
  }, [propertyId])

  async function onSave(column, value) {
    setP(prev => ({ ...prev, [column]: value }))   // optimistic
    setSaving(column)
    try { await updatePropertyField(propertyId, column, value) }
    catch (e) { alert(e.message); getProperty(propertyId).then(setP).catch(() => {}) }
    finally { setSaving(null) }
  }

  if (loading) return <div className="flex justify-center py-6"><Loader2 className="w-5 h-5 text-slate-300 animate-spin" /></div>
  if (!p) return null

  const s = lease?.abstract?.summary || {}
  const resps = Array.isArray(lease?.abstract?.responsibilities) ? lease.abstract.responsibilities : []
  const guarantor = s.guarantor || (p.operator_is_corporate ? 'Corporate' : p.operator_name) || null

  const cells = [
    { label: 'Tenant', display: p.tenant_brand_name || s.tenant || null, readOnly: true },
    { label: 'Guarantor', display: guarantor, readOnly: true },
    { label: 'NOI', column: 'noi', value: p.noi, type: 'currency' },
    { label: 'Building Size', column: 'building_size', value: p.building_size, type: 'sf' },
    { label: 'Lot Size', column: 'land_area', value: p.land_area, type: 'acres' },
    { label: 'Year Built', column: 'year_built', value: p.year_built, type: 'number' },
    { label: 'Lease Type', column: 'lease_type', value: p.lease_type, type: 'text' },
    { label: 'Expiration', column: 'lease_end', value: p.lease_end, type: 'date' },
    { label: 'Term Remaining', display: yearsLeft(p.lease_end || s.expiration_date), readOnly: true },
    { label: 'Options', column: 'renewal_options', value: p.renewal_options, type: 'text' },
    { label: 'ROFR', display: s.right_of_first_refusal, readOnly: true },
  ]

  let rows = Array.isArray(lease?.abstract?.rent_schedule) ? lease.abstract.rent_schedule.filter(Boolean) : []
  if (!rows.length && p.annual_rent) {
    rows = [{ period: 'In-Place', monthly: monthlyFrom(p.annual_rent), annual: Number(p.annual_rent), increase: p.rent_bumps || '—' }]
  }
  const totalAnnual = p.annual_rent != null ? Number(p.annual_rent) : (rows[0] ? Number(rows[0].annual) : null)
  const showTotal = totalAnnual != null && !isNaN(totalAnnual)

  const respItems = [
    ['Roof', partyFor(resps, ['roof'])],
    ['Structure', partyFor(resps, ['structure', 'foundation'])],
    ['HVAC', partyFor(resps, ['hvac'])],
    ['Parking', partyFor(resps, ['parking', 'paving'])],
    ['Taxes', recovery(s.taxes_recovery, resps, ['tax'])],
    ['Insurance', recovery(s.insurance_recovery, resps, ['building insurance', 'property insurance', 'insurance'])],
  ].filter(([, v]) => v)

  return (
    <div className="rounded-xl border border-slate-200 bg-white overflow-hidden text-sm">
      {/* Dense editable detail grid */}
      <div className="p-4 grid grid-cols-2 sm:grid-cols-3 gap-x-5 gap-y-2.5">
        {cells.map(c => <Cell key={c.label} {...c} onSave={onSave} saving={saving} />)}
      </div>

      {/* Rent schedule */}
      {rows.length > 0 && (
        <div className="border-t border-slate-100">
          <table className="w-full text-[13px] tabular-nums">
            <thead>
              <tr className="bg-slate-700 text-white text-[10px] uppercase tracking-wide">
                <th className="px-4 py-1.5 text-left font-semibold">Rent Schedule</th>
                <th className="px-4 py-1.5 text-right font-semibold">Monthly</th>
                <th className="px-4 py-1.5 text-right font-semibold">Annual</th>
                <th className="px-4 py-1.5 text-right font-semibold">Increase</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i} className={i % 2 ? 'bg-white' : 'bg-slate-50'}>
                  <td className="px-4 py-1 text-slate-700">{r.period || '—'}</td>
                  <td className="px-4 py-1 text-right text-slate-700">{money(r.monthly ?? monthlyFrom(r.annual)) || '—'}</td>
                  <td className="px-4 py-1 text-right text-slate-700">{money(r.annual) || '—'}</td>
                  <td className="px-4 py-1 text-right text-slate-500">{r.increase || '—'}</td>
                </tr>
              ))}
              {showTotal && (
                <tr className="bg-slate-100 font-semibold border-t border-slate-200">
                  <td className="px-4 py-1 text-slate-800">Total In-Place — Yr 1</td>
                  <td className="px-4 py-1 text-right text-slate-800">{money(monthlyFrom(totalAnnual)) || '—'}</td>
                  <td className="px-4 py-1 text-right text-slate-800">{money(totalAnnual) || '—'}</td>
                  <td className="px-4 py-1 text-right text-slate-500">—</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* Responsibilities — one compact line */}
      {respItems.length > 0 && (
        <div className="border-t border-slate-100 px-4 py-2 flex flex-wrap items-center gap-x-4 gap-y-1">
          <span className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide">Responsibilities</span>
          {respItems.map(([label, value]) => (
            <span key={label} className="text-xs text-slate-600"><span className="text-slate-400">{label}:</span> <span className="font-medium">{value}</span></span>
          ))}
        </div>
      )}
    </div>
  )
}
