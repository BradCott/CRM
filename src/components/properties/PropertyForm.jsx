import { useState, useEffect } from 'react'
import { Input, Textarea, Select } from '../ui/Input'
import Button from '../ui/Button'
import { useApp } from '../../context/AppContext'

const EMPTY = {
  address: '', city: '', state: '', zip: '',
  tenant_brand_id: '', owner_id: '',
  building_size: '', land_area: '', year_built: '',
  property_type: '', construction_type: '',
  lease_type: '', lease_start: '', lease_end: '',
  annual_rent: '', noi: '', cap_rate: '', list_price: '',
  purchase_price: '', taxes: '', insurance: '',
  roof_year: '', hvac_year: '', parking_lot: '',
  listing_status: '', dd_end_date: '', close_date: '',
  notes: '',
}

const FEE_MULTIPLIER = 1.1 * 0.015  // purchase_price × 1.1 × 1.5%

function autoFee(purchasePrice) {
  const pp = parseFloat(purchasePrice)
  return pp > 0 ? Math.round(pp * FEE_MULTIPLIER * 100) / 100 : null
}

// Null DB values must become '' so React inputs stay controlled
function sanitize(obj) {
  return Object.fromEntries(Object.entries(obj).map(([k, v]) => [k, v ?? '']))
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
  const { tenantBrands, allPeople: owners } = useApp()
  const [form, setForm]   = useState(property ? sanitize({ ...EMPTY, ...property }) : { ...EMPTY })
  const [errors, setErrors] = useState({})
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState(null)

  // fee_amount = null → auto mode; string value → manual override
  const [feeOverride, setFeeOverride] = useState(property?.fee_amount != null)
  const [feeInput, setFeeInput]       = useState(
    property?.fee_amount != null
      ? String(property.fee_amount)
      : autoFee(property?.purchase_price) != null ? String(autoFee(property?.purchase_price)) : ''
  )

  // When purchase_price changes and not in override mode, update displayed fee
  useEffect(() => {
    if (!feeOverride) {
      const calc = autoFee(form.purchase_price)
      setFeeInput(calc != null ? String(calc) : '')
    }
  }, [form.purchase_price, feeOverride])

  const set = (field) => (e) => setForm(f => ({ ...f, [field]: e.target.value }))
  const num = (field) => (e) => setForm(f => ({ ...f, [field]: e.target.value }))

  const handleFeeChange = (e) => {
    setFeeOverride(true)
    setFeeInput(e.target.value)
  }

  const resetFee = () => {
    setFeeOverride(false)
    const calc = autoFee(form.purchase_price)
    setFeeInput(calc != null ? String(calc) : '')
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    const errs = validate(form)
    if (Object.keys(errs).length) { setErrors(errs); return }
    setSaving(true)
    setSaveError(null)
    try {
      const payload = { ...form }
      for (const f of ['building_size','land_area','year_built','annual_rent','noi','cap_rate','list_price','purchase_price','taxes','insurance','roof_year','hvac_year']) {
        payload[f] = payload[f] !== '' ? parseFloat(payload[f]) : null
      }
      for (const f of ['tenant_brand_id','owner_id']) {
        payload[f] = payload[f] !== '' ? parseInt(payload[f], 10) : null
      }
      // fee_amount: null if auto, parsed float if override
      payload.fee_amount = feeOverride && feeInput !== '' ? parseFloat(feeInput) : null
      await onSave(payload)
      onClose()
    } catch (err) {
      setSaveError(err.message || 'Failed to save property. Please try again.')
    } finally {
      setSaving(false)
    }
  }

  const Section = ({ title }) => (
    <p className="text-xs font-semibold text-slate-500 uppercase tracking-widest pt-4 pb-1 border-t border-slate-100">{title}</p>
  )

  return (
    <form onSubmit={handleSubmit} className="px-6 py-5 space-y-3">
      {saveError && (
        <div className="px-4 py-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
          {saveError}
        </div>
      )}
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
        <Input label="Annual rent ($)" type="number" value={form.annual_rent} onChange={num('annual_rent')} placeholder="120000" />
        <Input label="NOI ($)" type="number" value={form.noi} onChange={num('noi')} placeholder="115000" />
      </div>
      <div className="grid grid-cols-3 gap-3">
        <Input label="Cap rate (%)" type="number" step="0.01" value={form.cap_rate} onChange={num('cap_rate')} placeholder="5.75" />
        <Input label="List price ($)" type="number" value={form.list_price} onChange={num('list_price')} placeholder="2000000" />
        <Input label="Purchase price ($)" type="number" value={form.purchase_price} onChange={num('purchase_price')} placeholder="1800000" />
      </div>
      <div className="grid grid-cols-3 gap-3">
        <Input label="Taxes ($)" type="number" value={form.taxes} onChange={num('taxes')} placeholder="12000" />
        <Input label="Insurance ($)" type="number" value={form.insurance} onChange={num('insurance')} placeholder="3500" />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <Select label="Listing status" value={form.listing_status} onChange={set('listing_status')}>
          <option value="">— Not listed —</option>
          <option value="listed">Listed</option>
          <option value="under_contract">Under Contract</option>
          <option value="sold">Sold</option>
        </Select>
        <div>
          <div className="flex items-center justify-between mb-1">
            <label className="text-sm font-medium text-slate-700">
              Fee ($)
              {feeOverride
                ? <span className="ml-2 text-xs font-normal text-amber-600">manual override</span>
                : <span className="ml-2 text-xs font-normal text-slate-400">auto (purchase × 1.1 × 1.5%)</span>
              }
            </label>
            {feeOverride && (
              <button type="button" onClick={resetFee} className="text-xs text-blue-600 hover:underline">
                Reset to auto
              </button>
            )}
          </div>
          <input
            type="number"
            step="0.01"
            min="0"
            value={feeInput}
            onChange={handleFeeChange}
            placeholder={autoFee(form.purchase_price) != null ? String(autoFee(form.purchase_price)) : 'Enter purchase price first'}
            className={`w-full px-3 py-2 text-sm border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 ${
              feeOverride ? 'border-amber-300 bg-amber-50' : 'border-slate-200'
            }`}
          />
        </div>
      </div>

      {form.listing_status === 'under_contract' && (
        <>
          <Section title="Transaction Details" />
          <div className="grid grid-cols-2 gap-3">
            <Input label="DD End Date" type="date" value={form.dd_end_date} onChange={set('dd_end_date')} />
            <Input label="Closing Date" type="date" value={form.close_date} onChange={set('close_date')} />
          </div>
        </>
      )}

      <Section title="Systems & Condition" />
      <div className="grid grid-cols-3 gap-3">
        <Input label="Roof year" type="number" value={form.roof_year} onChange={num('roof_year')} placeholder="2018" />
        <Input label="HVAC year" type="number" value={form.hvac_year} onChange={num('hvac_year')} placeholder="2020" />
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
