// Task side panel — view + edit every field, with links to the related deal /
// property / contact / email thread.
import { useState, useEffect } from 'react'
import { X, Loader2, ExternalLink, Trash2 } from 'lucide-react'
import { getTask, updateTask, getDeals, getAllProperties, getAllPeople } from '../../api/client'

const FIELDS = ['title', 'notes', 'status', 'priority', 'due_date', 'owner_id',
  'waiting_on', 'follow_up_date', 'deal_id', 'property_id', 'person_id']

function gmailThreadUrl(ref) {
  return `https://mail.google.com/mail/u/0/#all/${ref}`
}

export default function TaskPanel({ taskId, users, currentUserId, onClose, onSaved }) {
  const [task, setTask]     = useState(null)
  const [form, setForm]     = useState(null)
  const [saving, setSaving] = useState(false)
  const [lists, setLists]   = useState({ deals: [], properties: [], people: [] })

  useEffect(() => {
    getTask(taskId).then(t => { setTask(t); setForm(pick(t)) }).catch(console.error)
  }, [taskId])

  useEffect(() => {
    Promise.all([getDeals().catch(() => []), getAllProperties().catch(() => []), getAllPeople().catch(() => [])])
      .then(([deals, properties, people]) => setLists({ deals, properties, people }))
  }, [])

  function pick(t) {
    const o = {}
    for (const f of FIELDS) o[f] = t[f] ?? ''
    return o
  }
  const set = (f, v) => setForm(prev => ({ ...prev, [f]: v }))

  async function save(overrides) {
    setSaving(true)
    try {
      const patch = {}
      for (const f of FIELDS) patch[f] = form[f] === '' ? null : form[f]
      Object.assign(patch, overrides)
      const updated = await updateTask(taskId, patch)
      setTask(updated)
      onSaved?.(updated)
      onClose()
    } catch (e) { console.error(e); setSaving(false) }
  }

  const dealOptions = lists.deals.map(d => ({ id: d.id, label: d.address || d.title || `Deal #${d.id}` }))

  return (
    <div className="fixed inset-0 z-40 flex justify-end" onMouseDown={onClose}>
      <div className="absolute inset-0 bg-slate-900/20" />
      <div onMouseDown={e => e.stopPropagation()}
        className="relative w-full max-w-md bg-white h-full shadow-2xl flex flex-col animate-[slideIn_.15s_ease-out]">
        <style>{`@keyframes slideIn{from{transform:translateX(16px);opacity:.6}to{transform:translateX(0);opacity:1}}`}</style>

        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-slate-100">
          <h2 className="text-sm font-bold text-slate-800">Task details</h2>
          <button onClick={onClose} className="p-1 rounded-lg text-slate-400 hover:bg-slate-100"><X className="w-4 h-4" /></button>
        </div>

        {!form ? (
          <div className="flex-1 flex items-center justify-center"><Loader2 className="w-5 h-5 text-slate-400 animate-spin" /></div>
        ) : (
          <>
            <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
              <Field label="Title">
                <input value={form.title} onChange={e => set('title', e.target.value)} className={inp} />
              </Field>

              <Field label="Notes">
                <textarea value={form.notes} onChange={e => set('notes', e.target.value)} rows={3} className={inp} />
              </Field>

              <div className="grid grid-cols-2 gap-3">
                <Field label="Status">
                  <select value={form.status} onChange={e => set('status', e.target.value)} className={inp}>
                    <option value="open">Open</option><option value="waiting">Waiting</option>
                    <option value="done">Done</option><option value="dismissed">Dismissed</option>
                  </select>
                </Field>
                <Field label="Priority">
                  <select value={form.priority} onChange={e => set('priority', e.target.value)} className={inp}>
                    <option value="high">High</option><option value="normal">Normal</option><option value="low">Low</option>
                  </select>
                </Field>
                <Field label="Due date">
                  <input type="date" value={form.due_date || ''} onChange={e => set('due_date', e.target.value)} className={inp} />
                </Field>
                <Field label="Owner">
                  <select value={form.owner_id || ''} onChange={e => set('owner_id', e.target.value)} className={inp}>
                    <option value="">Unassigned</option>
                    {users.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
                  </select>
                </Field>
              </div>

              {form.status === 'waiting' && (
                <div className="grid grid-cols-2 gap-3 bg-amber-50/60 rounded-xl p-3 border border-amber-100">
                  <Field label="Waiting on">
                    <input value={form.waiting_on} onChange={e => set('waiting_on', e.target.value)} placeholder="Title co — Bartlesville" className={inp} />
                  </Field>
                  <Field label="Follow up">
                    <input type="date" value={form.follow_up_date || ''} onChange={e => set('follow_up_date', e.target.value)} className={inp} />
                  </Field>
                </div>
              )}

              <Field label="Linked deal">
                <select value={form.deal_id || ''} onChange={e => set('deal_id', e.target.value)} className={inp}>
                  <option value="">None</option>
                  {dealOptions.map(d => <option key={d.id} value={d.id}>{d.label}</option>)}
                </select>
              </Field>
              <Field label="Linked property">
                <select value={form.property_id || ''} onChange={e => set('property_id', e.target.value)} className={inp}>
                  <option value="">None</option>
                  {lists.properties.map(p => <option key={p.id} value={p.id}>{p.address || `Property #${p.id}`}</option>)}
                </select>
              </Field>
              <Field label="Linked contact">
                <select value={form.person_id || ''} onChange={e => set('person_id', e.target.value)} className={inp}>
                  <option value="">None</option>
                  {lists.people.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
              </Field>

              {/* Source + meta */}
              <div className="text-xs text-slate-400 space-y-1 pt-2 border-t border-slate-100">
                {task?.source && <p>Source: <span className="text-slate-600">{task.source}</span>{task.created_by ? ` · by ${task.created_by}` : ''}</p>}
                {task?.source === 'email' && task?.source_ref && (
                  <a href={gmailThreadUrl(task.source_ref)} target="_blank" rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-blue-600 hover:underline">Open email thread <ExternalLink className="w-3 h-3" /></a>
                )}
                {task?.updated_at && <p>Updated {new Date(task.updated_at + 'Z').toLocaleString()}{task.updated_by ? ` by ${task.updated_by}` : ''}</p>}
              </div>
            </div>

            {/* Footer */}
            <div className="flex items-center gap-2 px-5 py-3 border-t border-slate-100">
              <button onClick={() => save()} disabled={saving || !form.title.trim()}
                className="flex-1 text-sm font-semibold text-white bg-blue-600 py-2 rounded-lg hover:bg-blue-700 disabled:opacity-40 flex items-center justify-center gap-2">
                {saving && <Loader2 className="w-4 h-4 animate-spin" />} Save
              </button>
              <button onClick={() => save({ status: 'dismissed' })} disabled={saving}
                title="Dismiss task" className="p-2 rounded-lg text-slate-400 hover:text-red-500 hover:bg-red-50"><Trash2 className="w-4 h-4" /></button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

const inp = 'w-full text-sm border border-slate-200 rounded-lg px-2.5 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-300'

function Field({ label, children }) {
  return (
    <label className="block">
      <span className="text-xs font-medium text-slate-500 mb-1 block">{label}</span>
      {children}
    </label>
  )
}
