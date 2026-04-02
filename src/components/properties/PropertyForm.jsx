import { useState } from 'react'
import { Input, Textarea, Select } from '../ui/Input'
import Button from '../ui/Button'
import { useApp } from '../../context/AppContext'

const EMPTY = {
  address: '', city: '', state: '', zip: '',
  tenant_brand_id: '', owner_id: '',
  building_size: '', land_area: '', year_built: '',
  property_type: '', construction_type: '',
  lease_type: '', lease_start: '', lease_end: '',
  rental_rate: '', noi: '', cap_rate: '', list_price: '',
  taxes: '', insurance: '',
  roof: '', hvac: '', parking_lot: '',
  notes: '',
}

const PROPERTY_TYPES  = ['Retail', 'Net Lease', 'Industrial', 'Office', 'Medical', 'Restaurant', 'Auto', 'Other']
const CONSTRUCTION    = ['Masonry', 'Frame', 'Steel', 'Concrete', 'Other']
const LEASE_TYPES     = ['NNN', 'NN', 'N', 'Gross', 'Modified Gross', 'Ground Lease']

function validate(data) {
  const errors = {}
  if (!data.address.trim()) errors.address = 'Address is required'
  return errors
}

export default function PropertyForm({ property, onSave, onClose }) {
  const { tenantBrands, owners } = useApp()
  const [form, setForm]   = useState(property ? { ...EMPTY, ...property } : { ...EMPTY })
  const [errors, setErrors] = useState({})
  const [saving, setSaving] = useState(false)

  const set = (field) => (e) => setForm(f => ({ ...f, [field]: e.target.value }))
  const num = (field) => (e) => setForm(f => ({ ...f, [field]: e.target.value }))

  const handleSubmit = async (e) => {
    e.preventDefault()
    const errs = validate(form)
    if (Object.keys(errs).length) { setErrors(errs); return }
    setSaving(true)
    try {
      const payload = { ...form }
      // Convert numeric strings to numbers (or null)
      for (const f of ['building_size','land_area','year_built','rental_rate','noi','cap_rate','list_price','taxes','insurance']) {
        payload[f] = payload[f] !== '' ? parseFloat(payload[f]) : null
      }
      for (const f of ['tenant_brand_id','owner_id']) {
        payload[f] = payload[f] !== '' ? parseInt(payload[f], 10) : null
      }
      await onSave(payload)
      onClose()
    } finally {
      setSaving(false)
    }
  }

  const Section = ({ title }) => (
    <p className="text-xs font-semibold text-slate-500 uppercase tracking-widest pt-4 pb-1 border-t border-slate-100">{title}</p>
  )

  return (
    <form onSubmit={handleSubmit} className="px-6 py-5 space-y-3">
      <Section title="Location" />
      <Input label="Street address *" value={form.address} onChange={set('address')} error={errors.address} placeholder="123 Main St" autoFocus />
      <div className="grid grid-cols-3 gap-3">
        <Input label="City" value={form.city} onChange={set('city')} placeholder="Chicago" />
        <Input label="State" value={form.state} onChange={set('state')} placeholder="IL" maxLength={2} />
        <Input label="ZIP" value={form.zip} onChange={set('zip')} placeholder="60601" />
      </div>

      <Section title="Tenant & Ownership" />
      <div className="grid grid-cols-2 gap-3">
        <Select label="Tenant brand" value={form.tenant_brand_id} onChange={set('tenant_brand_id')}>
          <option value="">— None —</option>
          {[...tenantBrands].sort((a,b)=>a.name.localeCompare(b.name)).map(t => (
            <option key={t.id} value={t.id}>{t.name}</option>
          ))}
        </Select>
        <Select label="Owner" value={form.owner_id} onChange={set('owner_id')}>
          <option value="">— None —</option>
          {[...owners].sort((a,b)=>a.name.localeCompare(b.name)).map(o => (
            <option key={o.id} value={o.id}>{o.name}</option>
          ))}
        </Select>
      </div>

      <Section title="Building Details" />
      <div className="grid grid-cols-3 gap-3">
        <Input label="Building size (sq ft)" type="number" value={form.building_size} onChange={num('building_size')} placeholder="8500" />
        <Input label="Land area (acres)" type="number" step="0.01" value={form.land_area} onChange={num('land_area')} placeholder="1.25" />
        <Input label="Year built" type="number" value={form.year_built} onChange={num('year_built')} placeholder="2005" />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Select label="Property type" value={form.property_type} onChange={set('property_type')}>
          <option value="">— Select —</option>
          {PROPERTY_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
        </Select>
        <Select label="Construction" value={form.construction_type} onChange={set('construction_type')}>
          <option value="">— Select —</option>
          {CONSTRUCTION.map(t => <option key={t} value={t}>{t}</option>)}
        </Select>
      </div>

      <Section title="Lease & Financials" />
      <div className="grid grid-cols-3 gap-3">
        <Select label="Lease type" value={form.lease_type} onChange={set('lease_type')}>
          <option value="">— Select —</option>
          {LEASE_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
        </Select>
        <Input label="Lease start" type="date" value={form.lease_start} onChange={set('lease_start')} />
        <Input label="Lease end" type="date" value={form.lease_end} onChange={set('lease_end')} />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Input label="Annual rental rate ($)" type="number" value={form.rental_rate} onChange={num('rental_rate')} placeholder="120000" />
        <Input label="NOI ($)" type="number" value={form.noi} onChange={num('noi')} placeholder="115000" />
      </div>
      <div className="grid grid-cols-3 gap-3">
        <Input label="Cap rate (%)" type="number" step="0.01" value={form.cap_rate} onChange={num('cap_rate')} placeholder="5.75" />
        <Input label="List price ($)" type="number" value={form.list_price} onChange={num('list_price')} placeholder="2000000" />
        <Input label="Taxes ($)" type="number" value={form.taxes} onChange={num('taxes')} placeholder="12000" />
      </div>
      <Input label="Insurance ($)" type="number" value={form.insurance} onChange={num('insurance')} placeholder="3500" />

      <Section title="Systems & Condition" />
      <div className="grid grid-cols-3 gap-3">
        <Input label="Roof" value={form.roof} onChange={set('roof')} placeholder="2018 TPO" />
        <Input label="HVAC" value={form.hvac} onChange={set('hvac')} placeholder="2020 Carrier" />
        <Input label="Parking lot" value={form.parking_lot} onChange={set('parking_lot')} placeholder="Good, 2022 seal" />
      </div>

      <Textarea label="Notes" value={form.notes} onChange={set('notes')} placeholder="Any relevant property context…" />

      <div className="flex justify-end gap-2 pt-3">
        <Button type="button" variant="secondary" onClick={onClose}>Cancel</Button>
        <Button type="submit" disabled={saving}>{saving ? 'Saving…' : property ? 'Save changes' : 'Create property'}</Button>
      </div>
    </form>
  )
}
