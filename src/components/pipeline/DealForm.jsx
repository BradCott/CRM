import { useState } from 'react'
import { Input, Textarea, Select } from '../ui/Input'
import Button from '../ui/Button'
import { useApp } from '../../context/AppContext'
import { TABLE_STAGES } from './DealTable'

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
      {/* Linked property (optional for LOI deals) */}
      <Select label="Linked property" value={form.property_id} onChange={set('property_id')}>
        <option value="">None / standalone LOI deal</option>
        {sortedProps.map(p => (
          <option key={p.id} value={p.id}>
            {[p.tenant_brand_name, p.address, p.city, p.state].filter(Boolean).join(' — ')}
          </option>
        ))}
      </Select>

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
