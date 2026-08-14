import { useState, useRef, useMemo, useEffect } from 'react'
import { Input, Textarea, Select } from '../ui/Input'
import Button from '../ui/Button'
import { useApp } from '../../context/AppContext'
import { TABLE_STAGES } from './DealTable'

const propLabel = p => [p.tenant_brand_name, p.address, p.city, p.state].filter(Boolean).join(' — ')

// Type-to-search property picker — replaces a giant <select> of every property.
// Type to filter by address/city/tenant; click to pick; ✕ to clear back to none.
function PropertyCombobox({ label, value, onChange, properties }) {
  const selected = properties.find(p => String(p.id) === String(value)) || null
  const [query, setQuery] = useState('')
  const [open, setOpen]   = useState(false)
  const boxRef = useRef(null)

  useEffect(() => {
    const h = e => { if (boxRef.current && !boxRef.current.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    const list = q
      ? properties.filter(p => [p.address, p.city, p.state, p.tenant_brand_name]
          .some(v => String(v || '').toLowerCase().includes(q)))
      : properties
    return list.slice(0, 50)
  }, [properties, query])

  const displayValue = open ? query : (selected ? propLabel(selected) : '')

  const choose = p => { onChange(p ? String(p.id) : ''); setQuery(''); setOpen(false) }

  return (
    <div className="flex flex-col gap-1" ref={boxRef}>
      <label className="text-sm font-medium text-slate-700">{label}</label>
      <div className="relative">
        <input
          value={displayValue}
          placeholder="Search address, city, or tenant… (optional)"
          onFocus={() => { setQuery(''); setOpen(true) }}
          onChange={e => { setQuery(e.target.value); setOpen(true) }}
          className="block w-full rounded-lg border px-3 py-2 pr-8 text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-colors border-slate-300 bg-white hover:border-slate-400"
        />
        {selected && !open && (
          <button type="button" tabIndex={-1} onClick={() => choose(null)} title="Clear"
            className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600">✕</button>
        )}
        {open && (
          <ul className="absolute z-20 mt-1 max-h-60 w-full overflow-auto rounded-lg border border-slate-200 bg-white shadow-lg text-sm">
            <li>
              <button type="button" onClick={() => choose(null)}
                className="w-full text-left px-3 py-2 text-slate-500 hover:bg-slate-50">None / standalone LOI deal</button>
            </li>
            {filtered.length === 0 ? (
              <li className="px-3 py-2 text-slate-400">No properties match</li>
            ) : filtered.map(p => (
              <li key={p.id}>
                <button type="button" onClick={() => choose(p)}
                  className={`w-full text-left px-3 py-2 hover:bg-blue-50 ${String(p.id) === String(value) ? 'bg-blue-50/60 font-medium' : ''}`}>
                  {propLabel(p)}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}

const EMPTY = {
  property_id: '', stage: 'loi',
  purchase_price: '', close_date: '', notes: '',
  tenant: '', address: '', city: '', state: '',
  cap_rate: '', due_diligence_days: '',
}

function validate(data) {
  const errors = {}
  if (data.purchase_price !== '' && isNaN(parseFloat(data.purchase_price))) {
    errors.purchase_price = 'Enter a valid amount'
  }
  if (data.cap_rate !== '' && isNaN(parseFloat(data.cap_rate))) {
    errors.cap_rate = 'Enter a valid percentage'
  }
  return errors
}

export default function DealForm({ deal, initialStage, prefill, onSave, onClose }) {
  // AppContext exposes allProperties, not properties — alias it here
  const { allProperties: properties, stages } = useApp()

  const init = deal
    ? {
        ...EMPTY,
        ...deal,
        property_id:       deal.property_id    ?? '',
        purchase_price:    deal.purchase_price  != null ? String(deal.purchase_price)   : '',
        cap_rate:          deal.cap_rate        != null ? String(deal.cap_rate)          : '',
        due_diligence_days: deal.due_diligence_days != null ? String(deal.due_diligence_days) : '',
        close_date:        deal.close_date      ?? '',
        tenant:            deal.tenant          ?? '',
        address:           deal.address         ?? '',
        city:              deal.city            ?? '',
        state:             deal.state           ?? '',
        notes:             deal.notes           ?? '',
      }
    : { ...EMPTY, stage: initialStage || 'lead', ...(prefill || {}) }

  const [form, setForm]     = useState(init)
  const [errors, setErrors] = useState({})
  const [saving, setSaving] = useState(false)

  const set = field => e => setForm(f => ({ ...f, [field]: e.target.value }))

  const handleSubmit = async (e) => {
    e.preventDefault()
    const errs = validate(form)
    if (Object.keys(errs).length) { setErrors(errs); return }
    setSaving(true)
    try {
      await onSave({
        ...form,
        property_id:        form.property_id || null,
        purchase_price:     form.purchase_price     !== '' ? parseFloat(form.purchase_price)     : null,
        cap_rate:           form.cap_rate           !== '' ? parseFloat(form.cap_rate)           : null,
        due_diligence_days: form.due_diligence_days !== '' ? parseInt(form.due_diligence_days, 10) : null,
      })
      onClose()
    } finally {
      setSaving(false)
    }
  }

  const sortedProps = (properties || []).slice().sort((a, b) => {
    const la = `${a.tenant_brand_name || ''} ${a.address}`.toLowerCase()
    const lb = `${b.tenant_brand_name || ''} ${b.address}`.toLowerCase()
    return la.localeCompare(lb)
  })

  return (
    <form onSubmit={handleSubmit} className="px-6 py-5 space-y-4">
      {/* Linked property (optional for LOI deals) — type to search */}
      <PropertyCombobox
        label="Linked property"
        value={form.property_id}
        onChange={id => setForm(f => ({ ...f, property_id: id }))}
        properties={sortedProps}
      />

      <Select label="Stage" value={form.stage} onChange={set('stage')}>
        {TABLE_STAGES.map(s => <option key={s.key} value={s.key}>{s.label}</option>)}
      </Select>

      {/* Tenant + Cap Rate */}
      <div className="grid grid-cols-2 gap-4">
        <Input
          label="Tenant / Brand"
          value={form.tenant}
          onChange={set('tenant')}
          placeholder="e.g. Starbucks"
        />
        <Input
          label="Cap Rate (%)"
          type="number"
          min="0"
          step="0.01"
          value={form.cap_rate}
          onChange={set('cap_rate')}
          error={errors.cap_rate}
          placeholder="5.50"
        />
      </div>

      {/* Address */}
      <Input
        label="Property Address"
        value={form.address}
        onChange={set('address')}
        placeholder="123 Main St"
      />

      {/* City + State + Due Diligence */}
      <div className="grid grid-cols-3 gap-4">
        <Input label="City"  value={form.city}  onChange={set('city')}  placeholder="Austin" />
        <Input label="State" value={form.state} onChange={set('state')} placeholder="TX" />
        <Input
          label="Due Diligence (days)"
          type="number"
          min="0"
          step="1"
          value={form.due_diligence_days}
          onChange={set('due_diligence_days')}
          placeholder="15"
        />
      </div>

      {/* Price + Close Date */}
      <div className="grid grid-cols-2 gap-4">
        <Input
          label="Purchase Price ($)"
          type="number"
          min="0"
          step="1"
          value={form.purchase_price}
          onChange={set('purchase_price')}
          error={errors.purchase_price}
          placeholder="1500000"
        />
        <Input label="Expected Close Date" type="date" value={form.close_date} onChange={set('close_date')} />
      </div>

      <Textarea label="Notes" value={form.notes} onChange={set('notes')} placeholder="Any deal context…" />

      <div className="flex justify-end gap-2 pt-2">
        <Button type="button" variant="secondary" onClick={onClose}>Cancel</Button>
        <Button type="submit" disabled={saving}>{saving ? 'Saving…' : deal ? 'Save changes' : 'Create deal'}</Button>
      </div>
    </form>
  )
}
