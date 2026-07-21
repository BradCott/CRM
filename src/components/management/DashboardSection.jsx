// Property command center: photo, estimated sales, store contact, key alerts
// (tax/insurance due + tenant reimbursements owed), open tasks, landlord
// responsibilities (from the lease abstract), and vendors/contacts.
import { useState, useEffect, useCallback, useRef } from 'react'
import {
  Camera, Pencil, Phone, User, ClipboardList, Shield, Receipt, HandCoins,
  AlertTriangle, Loader2, Check, X, Building2, DollarSign, ExternalLink, Plus, Trash2, PhoneCall,
} from 'lucide-react'
import { getPropertyDash, updatePropertyDash, uploadPropertyPhoto, propertyPhotoUrl, getCallNotes, addCallNote, deleteCallNote, markInsuranceReimbursed } from '../../api/client'

const fmtDateTime = (d) => d ? new Date(String(d).includes('T') ? d : d.replace(' ', 'T') + 'Z').toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' }) : ''

const fmt$ = (n) => (n == null || n === '') ? '—' : '$' + Math.round(Number(n)).toLocaleString()
const fmtDate = (d) => d ? new Date(String(d).length === 10 ? d + 'T12:00:00' : d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—'

function DueBadge({ days }) {
  if (days == null) return null
  const cls = days < 0 ? 'bg-red-50 text-red-700' : days <= 30 ? 'bg-amber-50 text-amber-700' : 'bg-slate-100 text-slate-500'
  const txt = days < 0 ? `${Math.abs(days)}d overdue` : days === 0 ? 'due today' : `in ${days}d`
  return <span className={`text-[11px] font-semibold px-1.5 py-0.5 rounded-full ${cls}`}>{txt}</span>
}

const TASK_TINT = {
  tax: 'bg-emerald-50 text-emerald-700', insurance: 'bg-blue-50 text-blue-700',
  lease: 'bg-violet-50 text-violet-700', inspection: 'bg-amber-50 text-amber-700',
  maintenance: 'bg-orange-50 text-orange-700', other: 'bg-slate-100 text-slate-600',
}

function Card({ title, icon: Icon, children, tint = 'text-slate-400' }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
      <div className="px-4 py-2 border-b border-slate-100 flex items-center gap-1.5 text-xs font-semibold text-slate-500 uppercase tracking-wide">
        {Icon && <Icon className={`w-3.5 h-3.5 ${tint}`} />} {title}
      </div>
      <div className="p-4">{children}</div>
    </div>
  )
}

function ManagerCallLog({ propertyId, storeManager }) {
  const [notes, setNotes] = useState([])
  const [text, setText]   = useState('')
  const [saving, setSaving] = useState(false)

  const load = useCallback(async () => { try { setNotes(await getCallNotes(propertyId)) } catch (_) {} }, [propertyId])
  useEffect(() => { load() }, [load])

  async function add() {
    if (!text.trim()) return
    setSaving(true)
    try { await addCallNote(propertyId, text.trim()); setText(''); await load() } catch (e) { alert(e.message) } finally { setSaving(false) }
  }
  async function del(id) {
    if (!window.confirm('Delete this note?')) return
    try { await deleteCallNote(id); await load() } catch (e) { alert(e.message) }
  }

  return (
    <Card title="Store Manager Call Log" icon={PhoneCall}>
      <div className="flex gap-2 mb-3">
        <textarea value={text} onChange={e => setText(e.target.value)} rows={2}
          placeholder={`Log a call${storeManager ? ' with ' + storeManager : ''} — what was discussed…`}
          className="flex-1 text-sm border border-slate-200 rounded-lg px-3 py-2 resize-none focus:outline-none focus:ring-2 focus:ring-blue-500" />
        <button onClick={add} disabled={saving || !text.trim()}
          className="shrink-0 self-end inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-2 rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50">
          {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />} Log call
        </button>
      </div>
      {notes.length ? (
        <ul className="space-y-2 max-h-72 overflow-y-auto">
          {notes.map(n => (
            <li key={n.id} className="group rounded-lg border border-slate-100 px-3 py-2">
              <div className="flex items-center justify-between gap-2 mb-0.5">
                <span className="text-[11px] text-slate-400">{fmtDateTime(n.created_at)}{n.author ? ` · ${n.author}` : ''}</span>
                <button onClick={() => del(n.id)} className="text-slate-300 hover:text-red-500 opacity-0 group-hover:opacity-100 shrink-0"><Trash2 className="w-3.5 h-3.5" /></button>
              </div>
              <p className="text-sm text-slate-700 whitespace-pre-line">{n.note}</p>
            </li>
          ))}
        </ul>
      ) : <p className="text-sm text-slate-400">No call notes yet. Log your first call above — each entry is time-stamped.</p>}
    </Card>
  )
}

export default function DashboardSection({ propertyId }) {
  const [dash, setDash]       = useState(null)
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState(false)
  const [form, setForm]       = useState({})
  const [saving, setSaving]   = useState(false)
  const [photoV, setPhotoV]   = useState(0)
  const [uploadingPhoto, setUploadingPhoto] = useState(false)
  const photoRef = useRef()

  const load = useCallback(async () => {
    setLoading(true)
    try { setDash(await getPropertyDash(propertyId)) } catch (_) {} finally { setLoading(false) }
  }, [propertyId])
  useEffect(() => { load() }, [load])

  function startEdit() {
    const p = dash.property
    setForm({
      store_manager: p.store_manager || '', store_phone: p.store_phone || '',
      estimated_sales: p.estimated_sales ?? '', estimated_sales_date: p.estimated_sales_date || '',
    })
    setEditing(true)
  }
  async function save() {
    setSaving(true)
    try { await updatePropertyDash(propertyId, form); setEditing(false); await load() }
    catch (e) { alert(e.message) } finally { setSaving(false) }
  }
  async function onPhoto(file) {
    if (!file) return
    setUploadingPhoto(true)
    try { await uploadPropertyPhoto(propertyId, file); setPhotoV(v => v + 1); await load() }
    catch (e) { alert(e.message) } finally { setUploadingPhoto(false) }
  }
  const [reimbBusy, setReimbBusy] = useState(null)   // insurance_id currently updating
  async function setReimb(insuranceId, status) {
    if (status === 'limbo' && !window.confirm("Keep this open and check back in 30 days?")) return
    setReimbBusy(insuranceId)
    try { await markInsuranceReimbursed(insuranceId, status); await load() }
    catch (e) { alert(e.message) } finally { setReimbBusy(null) }
  }

  if (loading) return <div className="flex items-center justify-center py-16"><Loader2 className="w-6 h-6 text-slate-400 animate-spin" /></div>
  if (!dash) return <p className="text-sm text-slate-400 py-10 text-center">Couldn't load the dashboard.</p>

  const { property: p, tasks, insurance, taxes, contacts, maintenance_vendors, landlord_responsibilities, awaiting_reimbursement } = dash
  const nextTax = taxes.find(t => !t.paid) || null
  const owedTotal = awaiting_reimbursement.reduce((a, r) => a + (Number(r.amount) || 0), 0)

  return (
    <div className="space-y-5">
      {/* Hero: photo + store info + estimated sales */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Photo */}
        <div
          className="relative rounded-xl border border-slate-200 bg-slate-50 overflow-hidden aspect-[4/3] group"
          onDragOver={e => e.preventDefault()}
          onDrop={e => { e.preventDefault(); onPhoto(e.dataTransfer.files?.[0]) }}
          title="Drag a photo here to upload"
        >
          {p.has_photo ? (
            <img src={`${propertyPhotoUrl(propertyId)}?v=${photoV}`} alt="Property" className="w-full h-full object-cover" />
          ) : (
            <div className="w-full h-full flex flex-col items-center justify-center text-slate-300">
              <Building2 className="w-10 h-10 mb-1" />
              <span className="text-xs">No photo yet</span>
            </div>
          )}
          <button onClick={() => photoRef.current?.click()} disabled={uploadingPhoto}
            className="absolute bottom-2 right-2 inline-flex items-center gap-1 text-xs font-medium px-2.5 py-1.5 rounded-lg bg-white/90 border border-slate-200 text-slate-700 hover:bg-white shadow-sm">
            {uploadingPhoto ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Camera className="w-3.5 h-3.5" />}
            {p.has_photo ? 'Replace' : 'Add photo'}
          </button>
          <input ref={photoRef} type="file" accept="image/*" className="hidden" onChange={e => onPhoto(e.target.files[0])} />
        </div>

        {/* Store info */}
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <div className="flex items-start justify-between">
            <div className="min-w-0">
              <p className="text-base font-bold text-slate-900 truncate">{p.address}</p>
              <p className="text-sm text-slate-500">
                {[p.city, p.state].filter(Boolean).join(', ')}{p.tenant_brand_name ? ` · ${p.tenant_brand_name}` : ''}
              </p>
            </div>
            {!editing && (
              <button onClick={startEdit} className="shrink-0 text-slate-400 hover:text-slate-600 p-1 rounded-lg hover:bg-slate-100" title="Edit store info & sales">
                <Pencil className="w-4 h-4" />
              </button>
            )}
          </div>

          {editing ? (
            <div className="mt-3 space-y-2">
              <input value={form.store_manager} onChange={e => setForm(f => ({ ...f, store_manager: e.target.value }))}
                placeholder="Store manager name" className="w-full px-2.5 py-1.5 text-sm border border-slate-200 rounded-lg" />
              <input value={form.store_phone} onChange={e => setForm(f => ({ ...f, store_phone: e.target.value }))}
                placeholder="Store phone" className="w-full px-2.5 py-1.5 text-sm border border-slate-200 rounded-lg" />
              <div className="flex gap-2">
                <input type="number" value={form.estimated_sales} onChange={e => setForm(f => ({ ...f, estimated_sales: e.target.value }))}
                  placeholder="Est. annual sales $" className="flex-1 px-2.5 py-1.5 text-sm border border-slate-200 rounded-lg" />
                <input type="date" value={form.estimated_sales_date} onChange={e => setForm(f => ({ ...f, estimated_sales_date: e.target.value }))}
                  className="px-2.5 py-1.5 text-sm border border-slate-200 rounded-lg" title="As-of date (from site visit)" />
              </div>
              <div className="flex gap-2 pt-1">
                <button onClick={save} disabled={saving} className="inline-flex items-center gap-1 text-xs font-semibold px-3 py-1.5 rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50">
                  {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />} Save
                </button>
                <button onClick={() => setEditing(false)} className="inline-flex items-center gap-1 text-xs font-medium px-3 py-1.5 rounded-lg text-slate-500 hover:bg-slate-100">
                  <X className="w-3.5 h-3.5" /> Cancel
                </button>
              </div>
            </div>
          ) : (
            <div className="mt-3 space-y-1.5 text-sm">
              <p className="flex items-center gap-2 text-slate-700"><User className="w-3.5 h-3.5 text-slate-400" /> {p.store_manager || <span className="text-slate-400">No store manager</span>}</p>
              <p className="flex items-center gap-2 text-slate-700">
                <Phone className="w-3.5 h-3.5 text-slate-400" />
                {p.store_phone ? <a href={`tel:${p.store_phone}`} className="hover:text-blue-600">{p.store_phone}</a> : <span className="text-slate-400">No store phone</span>}
              </p>
            </div>
          )}
        </div>

        {/* Estimated sales */}
        <div className="rounded-xl border border-emerald-200 bg-emerald-50/50 p-4 flex flex-col justify-center">
          <div className="flex items-center gap-1.5 text-xs font-semibold text-emerald-700 uppercase tracking-wide mb-1">
            <DollarSign className="w-3.5 h-3.5" /> Est. Store Sales
          </div>
          <p className="text-3xl font-bold text-emerald-800 tabular-nums leading-tight">{fmt$(p.estimated_sales)}</p>
          <p className="text-xs text-emerald-600 mt-1">
            {p.estimated_sales_date ? `As of ${fmtDate(p.estimated_sales_date)} (site visit)` : 'Add an estimate from your next site visit'}
          </p>
        </div>
      </div>

      {/* Alerts: insurance, taxes, reimbursements owed */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card title="Insurance" icon={Shield} tint="text-blue-500">
          {insurance ? (
            <div className="space-y-1.5 text-sm">
              <p className="text-slate-700 font-medium truncate">{insurance.carrier || 'Policy on file'}</p>
              <p className="flex items-center gap-2 text-slate-600">Expires {fmtDate(insurance.expiry_date)} <DueBadge days={insurance.days_until} /></p>
              <div className="flex flex-wrap gap-1.5 pt-1">
                <span className={`text-[11px] font-semibold px-1.5 py-0.5 rounded-full ${insurance.paid_status === 'paid' ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'}`}>{insurance.paid_status === 'paid' ? 'Paid' : 'Unpaid'}</span>
                <span className={`text-[11px] font-semibold px-1.5 py-0.5 rounded-full ${insurance.reimbursed_status === 'reimbursed' ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}>{insurance.reimbursed_status === 'reimbursed' ? 'Reimbursed' : 'Not reimbursed'}</span>
              </div>
            </div>
          ) : <p className="text-sm text-slate-400">No policy on file — add one in the Insurance tab.</p>}
        </Card>

        <Card title="Next Tax Due" icon={Receipt} tint="text-emerald-500">
          {nextTax ? (
            <div className="space-y-1.5 text-sm">
              <p className="flex items-center gap-2 text-slate-700 font-medium">{fmtDate(nextTax.due_date)} <DueBadge days={nextTax.days_until} /></p>
              <p className="text-slate-600">{fmt$(nextTax.amount)}{nextTax.tax_year ? ` · ${nextTax.tax_year}` : ''}</p>
            </div>
          ) : taxes.length ? <p className="text-sm text-emerald-600">All recorded taxes paid.</p> : <p className="text-sm text-slate-400">No taxes on file — add in the Taxes tab.</p>}
        </Card>

        <Card title="Awaiting Reimbursement" icon={HandCoins} tint="text-amber-500">
          {awaiting_reimbursement.length ? (
            <div className="space-y-1.5 text-sm">
              <p className="text-lg font-bold text-amber-700 tabular-nums">{fmt$(owedTotal)} owed by tenant</p>
              <ul className="space-y-2">
                {awaiting_reimbursement.map((r, i) => (
                  <li key={i} className="text-slate-600">
                    <div className="flex items-center justify-between">
                      <span>{r.label}</span><span className="tabular-nums">{fmt$(r.amount)}</span>
                    </div>
                    {r.insurance_id && (
                      <div className="flex items-center flex-wrap gap-1.5 mt-1">
                        <button
                          onClick={() => setReimb(r.insurance_id, 'reimbursed')}
                          disabled={reimbBusy === r.insurance_id}
                          className="inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-1 rounded-lg bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-50"
                        >
                          {reimbBusy === r.insurance_id ? <Loader2 className="w-3 h-3 animate-spin" /> : <Check className="w-3 h-3" />} Mark reimbursed
                        </button>
                        <button
                          onClick={() => setReimb(r.insurance_id, 'limbo')}
                          disabled={reimbBusy === r.insurance_id}
                          className="inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-1 rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50 disabled:opacity-50"
                        >
                          Still in limbo
                        </button>
                        {r.next_check && (
                          <span className="text-[11px] text-slate-400">next check {fmtDate(r.next_check)}</span>
                        )}
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          ) : <p className="text-sm text-slate-400">Nothing outstanding.</p>}
        </Card>
      </div>

      {/* Tasks + Landlord responsibilities */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card title={`Open Tasks (${tasks.length})`} icon={ClipboardList}>
          {tasks.length ? (
            <ul className="divide-y divide-slate-100 -my-1 max-h-72 overflow-y-auto">
              {tasks.map(t => (
                <li key={t.id} className="flex items-center gap-2 py-2">
                  <span className={`text-[10px] font-semibold uppercase px-1.5 py-0.5 rounded-full shrink-0 ${TASK_TINT[t.task_type] || TASK_TINT.other}`}>{t.task_type}</span>
                  <span className="text-sm text-slate-700 flex-1 truncate">{t.title}</span>
                  {t.due_date && <span className="text-xs text-slate-400 shrink-0">{fmtDate(t.due_date)}</span>}
                  <DueBadge days={t.days_until} />
                </li>
              ))}
            </ul>
          ) : <p className="text-sm text-slate-400">No open tasks. 🎉</p>}
        </Card>

        <Card title="Landlord Responsibilities" icon={Building2}>
          {landlord_responsibilities.length ? (
            <ul className="flex flex-wrap gap-1.5">
              {landlord_responsibilities.map((r, i) => (
                <li key={i} title={r.detail || ''} className="text-xs bg-emerald-50 border border-emerald-200 text-emerald-800 px-2 py-0.5 rounded-full">{r.category}</li>
              ))}
            </ul>
          ) : <p className="text-sm text-slate-400">Upload the lease (Lease tab) to see what the landlord is on the hook for.</p>}
        </Card>
      </div>

      {/* Vendors & contacts */}
      <Card title="Vendors & Contacts" icon={User}>
        {(contacts.length || maintenance_vendors.length) ? (
          <div className="space-y-3">
            {contacts.length > 0 && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {contacts.map(c => (
                  <div key={c.id} className="flex items-start justify-between gap-2 rounded-lg border border-slate-100 px-3 py-2">
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-slate-800 truncate">{c.name}</p>
                      <p className="text-xs text-slate-400 truncate">{[c.role, c.company].filter(Boolean).join(' · ')}</p>
                    </div>
                    {c.phone && <a href={`tel:${c.phone}`} className="text-xs text-blue-600 hover:underline whitespace-nowrap shrink-0">{c.phone}</a>}
                  </div>
                ))}
              </div>
            )}
            {maintenance_vendors.length > 0 && (
              <div>
                <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-wide mb-1">Vendors used (from maintenance)</p>
                <div className="flex flex-wrap gap-1.5">
                  {maintenance_vendors.map((v, i) => (
                    <span key={i} title={v.last_date ? `Last: ${fmtDate(v.last_date)} · ${v.jobs} job(s)` : ''} className="text-xs bg-slate-100 text-slate-600 px-2 py-0.5 rounded-full">{v.name}</span>
                  ))}
                </div>
              </div>
            )}
          </div>
        ) : <p className="text-sm text-slate-400">No vendors or contacts yet — add them in the Contacts &amp; Maintenance tabs.</p>}
      </Card>

      {/* Store manager call log */}
      <ManagerCallLog propertyId={propertyId} storeManager={p.store_manager} />
    </div>
  )
}
