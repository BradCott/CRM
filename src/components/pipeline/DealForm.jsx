import { useState } from 'react'
import { Input, Textarea, Select } from '../ui/Input'
import Button from '../ui/Button'
import { useApp } from '../../context/AppContext'

const EMPTY = { property_id: '', stage: 'lead', purchase_price: '', close_date: '', notes: '' }

function validate(data) {
  const errors = {}
  if (!data.property_id) errors.property_id = 'Please select a property'
  if (data.purchase_price !== '' && isNaN(parseFloat(data.purchase_price))) errors.purchase_price = 'Enter a valid amount'
  return errors
}

export default function DealForm({ deal, initialStage, onSave, onClose }) {
  const { properties, stages } = useApp()
  const init = deal
    ? { ...deal, property_id: deal.property_id || '', purchase_price: deal.purchase_price ?? '' }
    : { ...EMPTY, stage: initialStage || 'lead' }

  const [form, setForm]     = useState(init)
  const [errors, setErrors] = useState({})
  const [saving, setSaving] = useState(false)

  const set = (field) => (e) => setForm(f => ({ ...f, [field]: e.target.value }))

  const handleSubmit = async (e) => {
    e.preventDefault()
    const errs = validate(form)
    if (Object.keys(errs).length) { setErrors(errs); return }
    setSaving(true)
    try {
      await onSave({
        ...form,
        property_id: form.property_id || null,
        purchase_price: form.purchase_price !== '' ? parseFloat(form.purchase_price) : null,
      })
      onClose()
    } finally {
      setSaving(false)
    }
  }

  const sortedProps = [...properties].sort((a, b) => {
    const la = `${a.tenant_brand_name || ''} ${a.address}`.toLowerCase()
    const lb = `${b.tenant_brand_name || ''} ${b.address}`.toLowerCase()
    return la.localeCompare(lb)
  })

  return (
    <form onSubmit={handleSubmit} className="px-6 py-5 space-y-4">
      <Select label="Property *" value={form.property_id} onChange={set('property_id')} error={errors.property_id} autoFocus>
        <option value="">Select a property…</option>
        {sortedProps.map(p => (
          <option key={p.id} value={p.id}>
            {[p.tenant_brand_name, p.address, p.city, p.state].filter(Boolean).join(' — ')}
          </option>
        ))}
      </Select>

      <Select label="Stage" value={form.stage} onChange={set('stage')}>
        {stages.map(s => <option key={s.key} value={s.key}>{s.label}</option>)}
      </Select>

      <div className="grid grid-cols-2 gap-4">
        <Input
          label="Purchase price ($)"
          type="number"
          min="0"
          step="1000"
          value={form.purchase_price}
          onChange={set('purchase_price')}
          error={errors.purchase_price}
          placeholder="1500000"
        />
        <Input label="Expected close date" type="date" value={form.close_date} onChange={set('close_date')} />
      </div>

      <Textarea label="Notes" value={form.notes} onChange={set('notes')} placeholder="Any deal context…" />

      <div className="flex justify-end gap-2 pt-2">
        <Button type="button" variant="secondary" onClick={onClose}>Cancel</Button>
        <Button type="submit" disabled={saving}>{saving ? 'Saving…' : deal ? 'Save changes' : 'Create deal'}</Button>
      </div>
    </form>
  )
}
