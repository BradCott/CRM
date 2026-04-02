import { useState } from 'react'
import { Input, Textarea, Select } from '../ui/Input'
import Button from '../ui/Button'
import { useApp } from '../../context/AppContext'

const EMPTY = { first_name: '', last_name: '', email: '', phone: '', owner_id: '', title: '', notes: '' }

function validate(data) {
  const errors = {}
  if (!data.first_name.trim()) errors.first_name = 'First name is required'
  if (data.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.email)) errors.email = 'Invalid email address'
  return errors
}

export default function ContactForm({ contact, onSave, onClose }) {
  const { owners } = useApp()
  const [form, setForm] = useState(contact ? { ...contact, owner_id: contact.owner_id || '' } : { ...EMPTY })
  const [errors, setErrors] = useState({})
  const [saving, setSaving] = useState(false)

  const set = (field) => (e) => setForm(f => ({ ...f, [field]: e.target.value }))

  const handleSubmit = async (e) => {
    e.preventDefault()
    const errs = validate(form)
    if (Object.keys(errs).length) { setErrors(errs); return }
    setSaving(true)
    try {
      await onSave({ ...form, owner_id: form.owner_id || null })
      onClose()
    } finally {
      setSaving(false)
    }
  }

  const sortedOwners = [...owners].sort((a, b) => a.name.localeCompare(b.name))

  return (
    <form onSubmit={handleSubmit} className="px-6 py-5 space-y-4">
      <div className="grid grid-cols-2 gap-4">
        <Input label="First name *" value={form.first_name} onChange={set('first_name')} error={errors.first_name} placeholder="Sarah" autoFocus />
        <Input label="Last name" value={form.last_name} onChange={set('last_name')} placeholder="Johnson" />
      </div>
      <Input label="Email" type="email" value={form.email} onChange={set('email')} error={errors.email} placeholder="sarah@company.com" />
      <Input label="Phone" type="tel" value={form.phone} onChange={set('phone')} placeholder="(415) 555-0101" />
      <Input label="Title" value={form.title} onChange={set('title')} placeholder="Asset Manager" />
      <Select label="Owner / Company" value={form.owner_id} onChange={set('owner_id')}>
        <option value="">— No owner linked —</option>
        {sortedOwners.map(o => (
          <option key={o.id} value={o.id}>{o.name}</option>
        ))}
      </Select>
      <Textarea label="Notes" value={form.notes} onChange={set('notes')} placeholder="Any relevant context…" />

      <div className="flex justify-end gap-2 pt-2">
        <Button type="button" variant="secondary" onClick={onClose}>Cancel</Button>
        <Button type="submit" disabled={saving}>{saving ? 'Saving…' : contact ? 'Save changes' : 'Create contact'}</Button>
      </div>
    </form>
  )
}
