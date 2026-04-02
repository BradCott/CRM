import { useState, useMemo } from 'react'
import { Landmark, Plus, MoreHorizontal, Pencil, Trash2, Loader2 } from 'lucide-react'
import { useApp } from '../../context/AppContext'
import TopBar from '../layout/TopBar'
import Button from '../ui/Button'
import Modal from '../ui/Modal'
import ConfirmDialog from '../ui/ConfirmDialog'
import EmptyState from '../ui/EmptyState'
import { Input, Select, Textarea } from '../ui/Input'

const EMPTY = { name: '', type: 'company', address: '', city: '', state: '', zip: '', phone: '', email: '' }

function OwnerForm({ owner, onSave, onClose }) {
  const [form, setForm]   = useState(owner ? { ...owner } : { ...EMPTY })
  const [saving, setSaving] = useState(false)
  const set = (f) => (e) => setForm(p => ({ ...p, [f]: e.target.value }))

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!form.name.trim()) return
    setSaving(true)
    try { await onSave(form); onClose() } finally { setSaving(false) }
  }

  return (
    <form onSubmit={handleSubmit} className="px-6 py-5 space-y-4">
      <Input label="Name *" value={form.name} onChange={set('name')} placeholder="CVS Health Corp" autoFocus />
      <Select label="Type" value={form.type} onChange={set('type')}>
        <option value="company">Company</option>
        <option value="individual">Individual</option>
        <option value="reit">REIT</option>
      </Select>
      <Input label="Street address" value={form.address} onChange={set('address')} placeholder="1 CVS Drive" />
      <div className="grid grid-cols-3 gap-3">
        <Input label="City" value={form.city} onChange={set('city')} placeholder="Woonsocket" />
        <Input label="State" value={form.state} onChange={set('state')} placeholder="RI" maxLength={2} />
        <Input label="ZIP" value={form.zip} onChange={set('zip')} placeholder="02895" />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Input label="Phone" value={form.phone} onChange={set('phone')} placeholder="(401) 765-1500" />
        <Input label="Email" type="email" value={form.email} onChange={set('email')} placeholder="contact@corp.com" />
      </div>
      <div className="flex justify-end gap-2 pt-2">
        <Button type="button" variant="secondary" onClick={onClose}>Cancel</Button>
        <Button type="submit" disabled={saving}>{saving ? 'Saving…' : owner ? 'Save changes' : 'Create owner'}</Button>
      </div>
    </form>
  )
}

const TYPE_BADGES = {
  company:    'bg-blue-50 text-blue-700',
  individual: 'bg-violet-50 text-violet-700',
  reit:       'bg-emerald-50 text-emerald-700',
}

export default function OwnersPage() {
  const { owners, addOwner, editOwner, removeOwner, loading } = useApp()
  const [search, setSearch]         = useState('')
  const [showForm, setShowForm]     = useState(false)
  const [editTarget, setEditTarget] = useState(null)
  const [deleteTarget, setDeleteTarget] = useState(null)
  const [openMenu, setOpenMenu]     = useState(null)

  const filtered = useMemo(() => {
    const q = search.toLowerCase()
    return owners.filter(o => !q || o.name?.toLowerCase().includes(q) || o.city?.toLowerCase().includes(q))
  }, [owners, search])

  const handleSave = async (data) => {
    if (editTarget) await editOwner(editTarget.id, data)
    else await addOwner(data)
  }

  if (loading) return <div className="flex-1 flex items-center justify-center"><Loader2 className="w-6 h-6 text-slate-400 animate-spin" /></div>

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <TopBar
        title={`Owners${owners.length > 0 ? ` (${owners.length})` : ''}`}
        onSearch={setSearch}
        searchPlaceholder="Search owners…"
        actions={<Button onClick={() => { setEditTarget(null); setShowForm(true) }}><Plus className="w-4 h-4" /> New owner</Button>}
      />
      <div className="flex-1 overflow-auto p-6 scrollbar-thin">
        {owners.length === 0 ? (
          <EmptyState icon={Landmark} title="No owners yet" description="Import from Account.csv or add manually." action="New owner" onAction={() => setShowForm(true)} />
        ) : filtered.length === 0 ? (
          <EmptyState icon={Landmark} title="No results" description={`No owners match "${search}"`} />
        ) : (
          <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 border-b border-slate-200">
                <tr>
                  {['Name','Type','Address','Phone','Email'].map(h => (
                    <th key={h} className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wide">{h}</th>
                  ))}
                  <th className="w-12" />
                </tr>
              </thead>
              <tbody>
                {filtered.map((o, i) => (
                  <tr key={o.id} className={`border-b border-slate-100 last:border-0 hover:bg-blue-50/40 transition-colors ${i % 2 === 0 ? 'bg-white' : 'bg-slate-50/50'}`}>
                    <td className="px-4 py-3 font-medium text-slate-900">{o.name}</td>
                    <td className="px-4 py-3">
                      <span className={`text-xs font-medium px-2 py-0.5 rounded-full capitalize ${TYPE_BADGES[o.type] || TYPE_BADGES.company}`}>{o.type}</span>
                    </td>
                    <td className="px-4 py-3 text-slate-600">
                      {[o.address, o.city, o.state].filter(Boolean).join(', ') || <span className="text-slate-300">—</span>}
                    </td>
                    <td className="px-4 py-3 text-slate-600">{o.phone || <span className="text-slate-300">—</span>}</td>
                    <td className="px-4 py-3">
                      {o.email ? <a href={`mailto:${o.email}`} className="text-blue-600 hover:underline">{o.email}</a> : <span className="text-slate-300">—</span>}
                    </td>
                    <td className="px-4 py-3" onClick={e => e.stopPropagation()}>
                      <div className="relative">
                        <button className="w-8 h-8 rounded-lg flex items-center justify-center text-slate-400 hover:bg-slate-100" onClick={() => setOpenMenu(openMenu === o.id ? null : o.id)}>
                          <MoreHorizontal className="w-4 h-4" />
                        </button>
                        {openMenu === o.id && (
                          <div className="absolute right-0 top-9 w-40 bg-white border border-slate-200 rounded-xl shadow-lg z-10 py-1 text-sm">
                            <button className="flex items-center gap-2 w-full px-3 py-2 text-slate-700 hover:bg-slate-50" onClick={() => { setEditTarget(o); setShowForm(true); setOpenMenu(null) }}>
                              <Pencil className="w-3.5 h-3.5" /> Edit
                            </button>
                            <button className="flex items-center gap-2 w-full px-3 py-2 text-red-600 hover:bg-red-50" onClick={() => { setDeleteTarget(o); setOpenMenu(null) }}>
                              <Trash2 className="w-3.5 h-3.5" /> Delete
                            </button>
                          </div>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <Modal isOpen={showForm} onClose={() => { setShowForm(false); setEditTarget(null) }} title={editTarget ? 'Edit owner' : 'New owner'}>
        <OwnerForm owner={editTarget} onSave={handleSave} onClose={() => { setShowForm(false); setEditTarget(null) }} />
      </Modal>

      <ConfirmDialog
        isOpen={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={() => removeOwner(deleteTarget.id)}
        title="Delete owner?"
        message={`"${deleteTarget?.name}" will be permanently deleted.`}
      />
      {openMenu && <div className="fixed inset-0 z-0" onClick={() => setOpenMenu(null)} />}
    </div>
  )
}
