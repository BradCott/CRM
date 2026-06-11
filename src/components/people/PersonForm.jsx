import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { AlertTriangle } from 'lucide-react'
import { Input, Textarea, Select } from '../ui/Input'
import Button from '../ui/Button'
import { useApp } from '../../context/AppContext'
import { checkPersonDuplicate } from '../../api/client'

const EMPTY = {
  name: '', first_name: '', last_name: '',
  role: 'owner', sub_label: '', owner_type: 'Individual',
  company_id: '',
  phone: '', phone2: '', mobile: '',
  email: '', email2: '',
  address: '', city: '', state: '', zip: '',
  do_not_contact: false,
  notes: '',
}

const ROLES = [
  { value: 'owner',          label: 'Owner (Individual)' },
  { value: 'owner_company',  label: 'Owner Company' },
  { value: 'broker',         label: 'Broker' },
  { value: 'tenant_contact', label: 'Tenant Contact' },
]

export default function PersonForm({ person, onSave, onClose }) {
  const navigate = useNavigate()
  const { allPeople } = useApp()
  const [form, setForm]   = useState(person ? {
    ...EMPTY, ...person,
    company_id: person.company_id || '',
    sub_label: person.sub_label || '',
    owner_type: person.owner_type || 'Individual',
    do_not_contact: !!person.do_not_contact,
  } : { ...EMPTY })
  const [saving, setSaving]         = useState(false)
  const [errors, setErrors]         = useState({})
  const [dupCheck, setDupCheck]     = useState(null) // null | { confidence, matched, candidates }
  const dupTimer                    = useRef(null)

  const set = (f) => (e) => setForm(p => ({ ...p, [f]: e.target.value }))
  const setBool = (f) => (e) => setForm(p => ({ ...p, [f]: e.target.checked }))

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
    setSaving(true)
    try {
      await onSave({ ...form, company_id: form.company_id || null, sub_label: form.sub_label || null })
      onClose()
    } finally { setSaving(false) }
  }

  const isPerson = ['owner','broker','tenant_contact'].includes(form.role)
  const companies = allPeople.filter(p => p.role === 'owner_company' && p.id !== person?.id)

  return (
    <form onSubmit={handleSubmit} className="px-6 py-5 space-y-4">
      {/* Role */}
      <div className="grid grid-cols-2 gap-4">
        <Select label="Role" value={form.role} onChange={set('role')}>
          {ROLES.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
        </Select>
        <Select label="Sub-label (optional)" value={form.sub_label} onChange={set('sub_label')}>
          <option value="">— None —</option>
          <option value="buyer">Buyer</option>
          <option value="seller">Seller</option>
        </Select>
      </div>

      {/* Owner type */}
      <Select label="Owner type" value={form.owner_type} onChange={set('owner_type')}>
        <option value="Individual">Individual</option>
        <option value="LLC">LLC</option>
        <option value="Institution">Institution</option>
      </Select>

      {/* Name fields */}
      {isPerson ? (
        <div className="grid grid-cols-2 gap-4">
          <Input label="First name" value={form.first_name} onChange={handleFirstLast('first_name')} placeholder="Thomas" autoFocus />
          <Input label="Last name" value={form.last_name} onChange={handleFirstLast('last_name')} placeholder="Belasco" />
        </div>
      ) : (
        <Input label="Company name *" value={form.name} onChange={set('name')} error={errors.name} placeholder="Exchange Right" autoFocus />
      )}

      {/* Link individual to company */}
      {isPerson && companies.length > 0 && (
        <Select label="Associated company (optional)" value={form.company_id} onChange={set('company_id')}>
          <option value="">— Independent —</option>
          {companies.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
        </Select>
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
