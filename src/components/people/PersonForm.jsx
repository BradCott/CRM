import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { AlertTriangle, Plus, X } from 'lucide-react'
import { Input, Textarea, Select } from '../ui/Input'
import Button from '../ui/Button'
import { useApp } from '../../context/AppContext'
import { checkPersonDuplicate, getTenantRoles, createTenantRole } from '../../api/client'
import { US_STATES, REGIONS } from '../../constants/territory'

const EMPTY = {
  name: '', first_name: '', last_name: '',
  role: 'owner', sub_label: '', owner_type: 'Individual',
  company_id: '',
  phone: '', phone2: '', mobile: '',
  email: '', email2: '',
  address: '', city: '', state: '', zip: '',
  do_not_contact: false,
  notes: '',
  // Tenant-contact fields
  tenant_brand_id: '', title: '',
  tenant_roles: [], territory_states: [], territory_regions: [],
}

// Backend stores these as JSON strings; the form works with arrays.
function parseArr(v) {
  if (Array.isArray(v)) return v
  if (typeof v === 'string' && v.trim()) { try { const a = JSON.parse(v); return Array.isArray(a) ? a : [] } catch { return [] } }
  return []
}

const ROLES = [
  { value: 'owner',          label: 'Owner (Individual)' },
  { value: 'owner_company',  label: 'Owner Company' },
  { value: 'broker',         label: 'Broker' },
  { value: 'tenant_contact', label: 'Tenant Contact' },
]

export default function PersonForm({ person, onSave, onClose, presetRole }) {
  const navigate = useNavigate()
  const { allPeople, tenantBrands, addTenantBrand } = useApp()
  const [form, setForm]   = useState(person ? {
    ...EMPTY, ...person,
    company_id: person.company_id || '',
    tenant_brand_id: person.tenant_brand_id || '',
    title: person.title || '',
    sub_label: person.sub_label || '',
    owner_type: person.owner_type || 'Individual',
    do_not_contact: !!person.do_not_contact,
    tenant_roles: parseArr(person.tenant_roles),
    territory_states: parseArr(person.territory_states),
    territory_regions: parseArr(person.territory_regions),
  } : { ...EMPTY, role: presetRole || 'owner' })
  const [saving, setSaving]         = useState(false)
  const [errors, setErrors]         = useState({})
  const [dupCheck, setDupCheck]     = useState(null) // null | { confidence, matched, candidates }
  const dupTimer                    = useRef(null)

  // Extensible tenant-contact job roles
  const [roleTypes, setRoleTypes]   = useState([])
  const [addingRole, setAddingRole] = useState(false)
  const [newRole, setNewRole]       = useState('')
  const [addingBrand, setAddingBrand] = useState(false)
  const [newBrand, setNewBrand]     = useState('')

  useEffect(() => { getTenantRoles().then(setRoleTypes).catch(() => {}) }, [])

  const set = (f) => (e) => setForm(p => ({ ...p, [f]: e.target.value }))
  const setBool = (f) => (e) => setForm(p => ({ ...p, [f]: e.target.checked }))

  // Toggle a value in one of the array fields (roles / states / regions)
  const toggleIn = (field, val) => setForm(p => {
    const cur = p[field] || []
    return { ...p, [field]: cur.includes(val) ? cur.filter(x => x !== val) : [...cur, val] }
  })

  const handleAddRole = async () => {
    const label = newRole.trim()
    if (!label) return
    try {
      const created = await createTenantRole(label)
      setRoleTypes(rs => [...rs, created])
      toggleIn('tenant_roles', created.label)
    } catch { /* duplicate — just select it if it exists */ toggleIn('tenant_roles', label) }
    setNewRole(''); setAddingRole(false)
  }

  const handleAddBrand = async () => {
    const name = newBrand.trim()
    if (!name) return
    const created = await addTenantBrand({ name })
    if (created?.id) setForm(p => ({ ...p, tenant_brand_id: created.id }))
    setNewBrand(''); setAddingBrand(false)
  }

  // Debounced duplicate check — only for new records
  useEffect(() => {
    if (person) return // skip for edits
    clearTimeout(dupTimer.current)
    const name = form.name.trim()
    if (!name) { setDupCheck(null); return }
    dupTimer.current = setTimeout(async () => {
      try {
        const result = await checkPersonDuplicate({ name, city: form.city, state: form.state, address: form.address })
        setDupCheck(result.confidence === 'none' ? null : result)
      } catch { /* ignore */ }
    }, 400)
    return () => clearTimeout(dupTimer.current)
  }, [form.name, form.city, form.state, form.address, person])

  // Auto-fill name from first+last for person roles
  const handleFirstLast = (field) => (e) => {
    const val = e.target.value
    setForm(p => {
      const updated = { ...p, [field]: val }
      if (updated.role === 'owner' || updated.role === 'broker' || updated.role === 'tenant_contact') {
        const fn = field === 'first_name' ? val : p.first_name
        const ln = field === 'last_name'  ? val : p.last_name
        updated.name = [fn, ln].filter(Boolean).join(' ') || p.name
      }
      return updated
    })
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!form.name.trim()) { setErrors({ name: 'Name is required' }); return }
    // Soft nudge: a tenant contact with no territory at all is allowed (admin/
    // accounting/nationwide), but confirm it's intentional.
    if (isTenant && !form.territory_states.length && !form.territory_regions.length) {
      if (!window.confirm("This tenant contact has no territory (no states or regions). That's fine for admin/accounting/nationwide roles — save without a territory?")) return
    }
    setSaving(true)
    try {
      await onSave({
        ...form,
        company_id: form.company_id || null,
        sub_label: form.sub_label || null,
        tenant_brand_id: isTenant ? (form.tenant_brand_id || null) : null,
      })
      onClose()
    } finally { setSaving(false) }
  }

  const isPerson = ['owner','broker','tenant_contact'].includes(form.role)
  const isTenant = form.role === 'tenant_contact'
  const companies = allPeople.filter(p => p.role === 'owner_company' && p.id !== person?.id)

  return (
    <form onSubmit={handleSubmit} className="px-6 py-5 space-y-4">
      {/* Role */}
      <div className="grid grid-cols-2 gap-4">
        <Select label="Role" value={form.role} onChange={set('role')}>
          {ROLES.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
        </Select>
        {!isTenant && (
          <Select label="Sub-label (optional)" value={form.sub_label} onChange={set('sub_label')}>
            <option value="">— None —</option>
            <option value="buyer">Buyer</option>
            <option value="seller">Seller</option>
          </Select>
        )}
      </div>

      {/* Owner type — not relevant for tenant contacts */}
      {!isTenant && (
        <Select label="Owner type" value={form.owner_type} onChange={set('owner_type')}>
          <option value="Individual">Individual</option>
          <option value="LLC">LLC</option>
          <option value="Institution">Institution</option>
        </Select>
      )}

      {/* Name fields */}
      {isPerson ? (
        <div className="grid grid-cols-2 gap-4">
          <Input label="First name" value={form.first_name} onChange={handleFirstLast('first_name')} placeholder="Thomas" autoFocus />
          <Input label="Last name" value={form.last_name} onChange={handleFirstLast('last_name')} placeholder="Belasco" />
        </div>
      ) : (
        <Input label="Company name *" value={form.name} onChange={set('name')} error={errors.name} placeholder="Exchange Right" autoFocus />
      )}

      {/* Link individual to company (owner side) */}
      {!isTenant && isPerson && companies.length > 0 && (
        <Select label="Associated company (optional)" value={form.company_id} onChange={set('company_id')}>
          <option value="">— Independent —</option>
          {companies.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
        </Select>
      )}

      {/* ── Tenant contact section ─────────────────────────────────────────── */}
      {isTenant && (
        <div className="rounded-xl border border-slate-200 bg-slate-50/60 p-4 space-y-4">
          <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Tenant details</p>

          {/* Tenant brand */}
          {addingBrand ? (
            <div className="flex items-end gap-2">
              <Input label="New tenant name" value={newBrand} onChange={e => setNewBrand(e.target.value)} placeholder="Sherwin Williams" autoFocus />
              <Button type="button" onClick={handleAddBrand} className="mb-0.5">Add</Button>
              <Button type="button" variant="secondary" onClick={() => { setAddingBrand(false); setNewBrand('') }} className="mb-0.5">Cancel</Button>
            </div>
          ) : (
            <div>
              <Select label="Tenant (company)" value={form.tenant_brand_id} onChange={set('tenant_brand_id')}>
                <option value="">— Select tenant —</option>
                {[...tenantBrands].sort((a,b) => a.name.localeCompare(b.name)).map(b => (
                  <option key={b.id} value={b.id}>{b.name}</option>
                ))}
              </Select>
              <button type="button" onClick={() => setAddingBrand(true)}
                className="mt-1 inline-flex items-center gap-1 text-xs text-blue-600 hover:underline">
                <Plus className="w-3 h-3" /> Add a new tenant
              </button>
            </div>
          )}

          {/* Title */}
          <Input label="Title (optional)" value={form.title} onChange={set('title')} placeholder="Sr. Real Estate Manager" />

          {/* Roles — extensible multi-select */}
          <div>
            <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1.5">What they do (roles)</label>
            <div className="flex flex-wrap gap-1.5">
              {roleTypes.map(rt => {
                const on = form.tenant_roles.includes(rt.label)
                return (
                  <button type="button" key={rt.id} onClick={() => toggleIn('tenant_roles', rt.label)}
                    className={`px-2.5 py-1 rounded-full text-xs font-medium border transition-colors ${on ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-slate-600 border-slate-300 hover:border-blue-400'}`}>
                    {rt.label}
                  </button>
                )
              })}
              {addingRole ? (
                <span className="inline-flex items-center gap-1">
                  <input value={newRole} onChange={e => setNewRole(e.target.value)} autoFocus placeholder="New role"
                    onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); handleAddRole() } }}
                    className="px-2 py-1 text-xs border border-slate-300 rounded-full w-28 focus:outline-none focus:ring-2 focus:ring-blue-400" />
                  <button type="button" onClick={handleAddRole} className="text-xs text-blue-600 font-medium">Add</button>
                  <button type="button" onClick={() => { setAddingRole(false); setNewRole('') }} className="text-slate-400"><X className="w-3.5 h-3.5" /></button>
                </span>
              ) : (
                <button type="button" onClick={() => setAddingRole(true)}
                  className="px-2.5 py-1 rounded-full text-xs font-medium border border-dashed border-slate-300 text-slate-500 hover:border-blue-400 inline-flex items-center gap-1">
                  <Plus className="w-3 h-3" /> Add role
                </button>
              )}
            </div>
          </div>

          {/* Territory — regions */}
          <div>
            <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1.5">Regions (optional)</label>
            <div className="flex flex-wrap gap-1.5">
              {REGIONS.map(r => {
                const on = form.territory_regions.includes(r)
                return (
                  <button type="button" key={r} onClick={() => toggleIn('territory_regions', r)}
                    className={`px-2.5 py-1 rounded-full text-xs font-medium border transition-colors ${on ? 'bg-emerald-600 text-white border-emerald-600' : 'bg-white text-slate-600 border-slate-300 hover:border-emerald-400'}`}>
                    {r}
                  </button>
                )
              })}
            </div>
          </div>

          {/* Territory — states */}
          <div>
            <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1.5">States (optional)</label>
            {form.territory_states.length > 0 && (
              <div className="flex flex-wrap gap-1.5 mb-2">
                {form.territory_states.map(s => (
                  <span key={s} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-600 text-white text-xs font-medium">
                    {s}
                    <button type="button" onClick={() => toggleIn('territory_states', s)}><X className="w-3 h-3" /></button>
                  </span>
                ))}
              </div>
            )}
            <Select label="" value="" onChange={e => { if (e.target.value) toggleIn('territory_states', e.target.value) }}>
              <option value="">＋ Add a state…</option>
              {US_STATES.filter(s => !form.territory_states.includes(s)).map(s => <option key={s} value={s}>{s}</option>)}
            </Select>
          </div>
        </div>
      )}

      {/* Contact info */}
      <div className="grid grid-cols-2 gap-4">
        <Input label="Phone" value={form.phone} onChange={set('phone')} placeholder="(555) 555-5555" />
        <Input label="Mobile" value={form.mobile} onChange={set('mobile')} placeholder="(555) 555-5555" />
      </div>
      <div className="grid grid-cols-2 gap-4">
        <Input label="Email" type="email" value={form.email} onChange={set('email')} placeholder="name@company.com" />
        <Input label="Email 2" type="email" value={form.email2} onChange={set('email2')} placeholder="alt@company.com" />
      </div>

      {/* Address */}
      <Input label="Street address" value={form.address} onChange={set('address')} placeholder="123 Main St" />
      <div className="grid grid-cols-3 gap-3">
        <Input label="City" value={form.city} onChange={set('city')} />
        <Input label="State" value={form.state} onChange={set('state')} maxLength={2} />
        <Input label="ZIP" value={form.zip} onChange={set('zip')} />
      </div>

      <Textarea label="Notes" value={form.notes} onChange={set('notes')} placeholder="Any relevant context…" />

      {/* Duplicate warning */}
      {dupCheck && (
        <div className={`rounded-lg border px-4 py-3 text-sm flex gap-3 ${
          dupCheck.confidence === 'confident'
            ? 'bg-amber-50 border-amber-200 text-amber-800'
            : 'bg-blue-50 border-blue-200 text-blue-800'
        }`}>
          <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
          <div className="flex-1 min-w-0">
            {dupCheck.confidence === 'confident' ? (
              <>
                <p className="font-medium">Likely duplicate</p>
                <p className="text-xs mt-0.5">
                  <button
                    type="button"
                    onClick={() => { onClose(); navigate(`/people?highlight=${dupCheck.matched.id}`) }}
                    className="underline hover:no-underline font-medium"
                  >
                    {dupCheck.matched.name}
                  </button>
                  {dupCheck.matched.city ? ` · ${[dupCheck.matched.city, dupCheck.matched.state].filter(Boolean).join(', ')}` : ''}
                  {' '}already exists.
                </p>
              </>
            ) : (
              <>
                <p className="font-medium">Similar names found</p>
                <ul className="text-xs mt-0.5 space-y-0.5">
                  {(dupCheck.candidates || [dupCheck.matched]).slice(0, 3).map(c => (
                    <li key={c.id}>
                      <button
                        type="button"
                        onClick={() => { onClose(); navigate(`/people?highlight=${c.id}`) }}
                        className="underline hover:no-underline"
                      >{c.name}</button>
                      {c.city ? ` · ${[c.city, c.state].filter(Boolean).join(', ')}` : ''}
                    </li>
                  ))}
                </ul>
              </>
            )}
          </div>
        </div>
      )}

      {/* Do not contact */}
      <label className="flex items-center gap-3 cursor-pointer select-none">
        <input
          type="checkbox"
          checked={form.do_not_contact}
          onChange={setBool('do_not_contact')}
          className="w-4 h-4 rounded border-slate-300 text-red-600 focus:ring-red-500"
        />
        <span className="text-sm font-medium text-red-700">Do Not Contact / Do Not Mail</span>
      </label>

      <div className="flex justify-end gap-2 pt-2">
        <Button type="button" variant="secondary" onClick={onClose}>Cancel</Button>
        <Button type="submit" disabled={saving}>{saving ? 'Saving…' : person ? 'Save changes' : 'Create'}</Button>
      </div>
    </form>
  )
}
