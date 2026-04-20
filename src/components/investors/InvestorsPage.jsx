import { useState, useEffect, useCallback, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  TrendingUp, Plus, MoreHorizontal, Pencil, Trash2, Loader2,
  ChevronLeft, ChevronRight, AlertCircle,
} from 'lucide-react'
import { getCRMInvestors, createInvestor, updateInvestor, deleteInvestorRecord } from '../../api/client'
import TopBar from '../layout/TopBar'
import Button from '../ui/Button'
import Modal from '../ui/Modal'
import ConfirmDialog from '../ui/ConfirmDialog'

const PAGE_SIZE = 100

const ENTITY_TYPES  = ['Individual', 'LLC', 'Trust', 'Partnership']
const ACCRED_STATUS = ['Accredited', 'Non-Accredited']

const US_STATES = [
  'AL','AK','AZ','AR','CA','CO','CT','DE','FL','GA',
  'HI','ID','IL','IN','IA','KS','KY','LA','ME','MD',
  'MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ',
  'NM','NY','NC','ND','OH','OK','OR','PA','RI','SC',
  'SD','TN','TX','UT','VT','VA','WA','WV','WI','WY',
]

function fmt$(v) {
  if (v == null || v === 0) return '—'
  if (v >= 1_000_000) return `$${(v / 1_000_000).toFixed(1)}M`
  return '$' + Number(v).toLocaleString()
}

function EntityBadge({ type }) {
  const styles = {
    'Individual':  'bg-blue-50 text-blue-700',
    'LLC':         'bg-violet-50 text-violet-700',
    'Trust':       'bg-amber-50 text-amber-700',
    'Partnership': 'bg-emerald-50 text-emerald-700',
  }
  return (
    <span className={`inline-block text-xs font-semibold px-2 py-0.5 rounded-full ${styles[type] || 'bg-slate-100 text-slate-600'}`}>
      {type || '—'}
    </span>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function InvestorsPage() {
  const navigate = useNavigate()

  const [rows, setRows]                 = useState([])
  const [total, setTotal]               = useState(0)
  const [page, setPage]                 = useState(0)
  const [search, setSearch]             = useState('')
  const [entityFilter, setEntityFilter] = useState('')
  const [fetching, setFetching]         = useState(false)
  const [showForm, setShowForm]         = useState(false)
  const [editTarget, setEditTarget]     = useState(null)
  const [deleteTarget, setDeleteTarget] = useState(null)
  const [openMenu, setOpenMenu]         = useState(null)
  const searchTimer = useRef(null)

  const load = useCallback(async (s, entity, pg) => {
    setFetching(true)
    try {
      const params = { limit: PAGE_SIZE, offset: pg * PAGE_SIZE }
      if (s)      params.search      = s
      if (entity) params.entity_type = entity
      const res = await getCRMInvestors(params)
      setRows(res.rows)
      setTotal(res.total)
    } finally { setFetching(false) }
  }, [])

  useEffect(() => { load(search, entityFilter, page) }, [page, entityFilter]) // eslint-disable-line

  const handleSearch = (val) => {
    setSearch(val)
    clearTimeout(searchTimer.current)
    searchTimer.current = setTimeout(() => { setPage(0); load(val, entityFilter, 0) }, 300)
  }

  const handleSave = async (data) => {
    if (editTarget) await updateInvestor(editTarget.id, data)
    else await createInvestor(data)
    load(search, entityFilter, page)
  }

  const handleDelete = async () => {
    await deleteInvestorRecord(deleteTarget.id)
    load(search, entityFilter, page)
  }

  const totalPages = Math.ceil(total / PAGE_SIZE)

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <TopBar
        title={total > 0 ? `Investors (${total.toLocaleString()})` : 'Investors'}
        onSearch={handleSearch}
        searchPlaceholder="Search name, email, phone…"
        actions={
          <div className="flex items-center gap-2">
            <select
              value={entityFilter}
              onChange={e => { setEntityFilter(e.target.value); setPage(0); load(search, e.target.value, 0) }}
              className="text-sm border border-slate-200 rounded-lg px-3 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="">All types</option>
              {ENTITY_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
            <Button onClick={() => { setEditTarget(null); setShowForm(true) }}>
              <Plus className="w-4 h-4" /> Add Investor
            </Button>
          </div>
        }
      />

      <div className="flex-1 overflow-auto p-6 scrollbar-thin">
        {fetching && rows.length === 0 ? (
          <div className="flex items-center justify-center h-48">
            <Loader2 className="w-6 h-6 text-slate-400 animate-spin" />
          </div>
        ) : rows.length === 0 ? (
          <EmptyInvestors onAdd={() => setShowForm(true)} />
        ) : (
          <>
            <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 border-b border-slate-200">
                  <tr>
                    {['Name', 'Entity Type', 'Email', 'Phone', 'Total Invested', '# Properties', 'Pref Return %', ''].map(h => (
                      <th key={h} className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wide whitespace-nowrap">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((inv, i) => (
                    <tr
                      key={inv.id}
                      className={`border-b border-slate-100 last:border-0 hover:bg-blue-50/50 transition-colors cursor-pointer ${i % 2 === 0 ? '' : 'bg-slate-50/30'}`}
                      onClick={() => navigate(`/investors/${inv.id}`)}
                    >
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <p className="font-semibold text-slate-900">{inv.name}</p>
                          {inv.is_incomplete ? (
                            <span title="Profile incomplete" className="text-amber-400">
                              <AlertCircle className="w-3.5 h-3.5" />
                            </span>
                          ) : null}
                        </div>
                        {inv.city && inv.state && (
                          <p className="text-xs text-slate-400">{inv.city}, {inv.state}</p>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <EntityBadge type={inv.entity_type} />
                      </td>
                      <td className="px-4 py-3 text-slate-700 max-w-[180px] truncate">
                        {inv.email || <span className="text-slate-300">—</span>}
                      </td>
                      <td className="px-4 py-3 text-slate-700">
                        {inv.phone || <span className="text-slate-300">—</span>}
                      </td>
                      <td className="px-4 py-3 font-semibold text-slate-900 tabular-nums">
                        {inv.total_invested > 0 ? fmt$(inv.total_invested) : <span className="text-slate-300 font-normal">—</span>}
                      </td>
                      <td className="px-4 py-3 text-slate-700 tabular-nums text-center">
                        {inv.num_properties > 0 ? inv.num_properties : <span className="text-slate-300">—</span>}
                      </td>
                      <td className="px-4 py-3 text-slate-700 tabular-nums">
                        {inv.avg_preferred_return_rate != null
                          ? `${Number(inv.avg_preferred_return_rate).toFixed(1)}%`
                          : <span className="text-slate-300">—</span>}
                      </td>
                      <td className="px-4 py-3" onClick={e => e.stopPropagation()}>
                        <div className="relative">
                          <button
                            className="w-8 h-8 rounded-lg flex items-center justify-center text-slate-400 hover:bg-slate-100"
                            onClick={() => setOpenMenu(openMenu === inv.id ? null : inv.id)}
                          >
                            <MoreHorizontal className="w-4 h-4" />
                          </button>
                          {openMenu === inv.id && (
                            <div className="absolute right-0 top-9 w-44 bg-white border border-slate-200 rounded-xl shadow-lg z-10 py-1 text-sm">
                              <button
                                className="flex items-center gap-2 w-full px-3 py-2 text-slate-700 hover:bg-slate-50"
                                onClick={() => { navigate(`/investors/${inv.id}`) }}
                              >
                                <TrendingUp className="w-3.5 h-3.5" /> View profile
                              </button>
                              <button
                                className="flex items-center gap-2 w-full px-3 py-2 text-slate-700 hover:bg-slate-50"
                                onClick={() => { setEditTarget(inv); setShowForm(true); setOpenMenu(null) }}
                              >
                                <Pencil className="w-3.5 h-3.5" /> Edit
                              </button>
                              <button
                                className="flex items-center gap-2 w-full px-3 py-2 text-red-600 hover:bg-red-50"
                                onClick={() => { setDeleteTarget(inv); setOpenMenu(null) }}
                              >
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

            {totalPages > 1 && (
              <div className="flex items-center justify-between mt-4 px-1">
                <p className="text-sm text-slate-500">
                  Showing {page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, total)} of {total.toLocaleString()}
                </p>
                <div className="flex items-center gap-2">
                  <Button variant="secondary" size="sm" disabled={page === 0} onClick={() => setPage(p => p - 1)}>
                    <ChevronLeft className="w-4 h-4" />
                  </Button>
                  <span className="text-sm text-slate-600">Page {page + 1} of {totalPages}</span>
                  <Button variant="secondary" size="sm" disabled={page >= totalPages - 1} onClick={() => setPage(p => p + 1)}>
                    <ChevronRight className="w-4 h-4" />
                  </Button>
                </div>
              </div>
            )}
          </>
        )}
      </div>

      <Modal
        isOpen={showForm}
        onClose={() => { setShowForm(false); setEditTarget(null) }}
        title={editTarget ? 'Edit Investor' : 'Add Investor'}
        size="lg"
      >
        <InvestorForm
          investor={editTarget}
          onSave={handleSave}
          onClose={() => { setShowForm(false); setEditTarget(null) }}
        />
      </Modal>

      <ConfirmDialog
        isOpen={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={handleDelete}
        title="Delete investor?"
        message={`"${deleteTarget?.name}" and all their links and distribution records will be permanently deleted.`}
      />

      {openMenu && <div className="fixed inset-0 z-0" onClick={() => setOpenMenu(null)} />}
    </div>
  )
}

// ── Investor Form ─────────────────────────────────────────────────────────────

export function InvestorForm({ investor, onSave, onClose }) {
  const [saving, setSaving] = useState(false)
  const [form, setForm] = useState({
    name:                 investor?.name                 ?? '',
    entity_type:          investor?.entity_type          ?? 'Individual',
    email:                investor?.email                ?? '',
    phone:                investor?.phone                ?? '',
    address:              investor?.address              ?? '',
    city:                 investor?.city                 ?? '',
    state:                investor?.state                ?? '',
    zip:                  investor?.zip                  ?? '',
    tax_id:               investor?.tax_id               ?? '',
    accreditation_status: investor?.accreditation_status ?? 'Accredited',
    notes:                investor?.notes                ?? '',
  })

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!form.name.trim()) return
    setSaving(true)
    try {
      await onSave({ ...form })
      onClose()
    } finally {
      setSaving(false)
    }
  }

  const inp = 'w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500'

  return (
    <form onSubmit={handleSubmit} className="space-y-5 p-6">

      {/* Identity */}
      <section>
        <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-widest mb-3">Identity</h3>
        <div className="grid grid-cols-2 gap-4">
          <div className="col-span-2">
            <label className="block text-sm font-medium text-slate-700 mb-1">Full Name <span className="text-red-500">*</span></label>
            <input required value={form.name} onChange={e => set('name', e.target.value)}
              className={inp} placeholder="Full name or entity name" />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Entity Type</label>
            <select value={form.entity_type} onChange={e => set('entity_type', e.target.value)} className={inp + ' bg-white'}>
              {ENTITY_TYPES.map(t => <option key={t}>{t}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Accreditation Status</label>
            <select value={form.accreditation_status} onChange={e => set('accreditation_status', e.target.value)} className={inp + ' bg-white'}>
              {ACCRED_STATUS.map(s => <option key={s}>{s}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Tax ID</label>
            <input value={form.tax_id} onChange={e => set('tax_id', e.target.value)}
              className={inp} placeholder="XX-XXXXXXX" />
          </div>
        </div>
      </section>

      {/* Contact */}
      <section>
        <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-widest mb-3">Contact</h3>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Email</label>
            <input type="email" value={form.email} onChange={e => set('email', e.target.value)}
              className={inp} placeholder="email@example.com" />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Phone</label>
            <input type="tel" value={form.phone} onChange={e => set('phone', e.target.value)}
              className={inp} placeholder="(555) 000-0000" />
          </div>
        </div>
      </section>

      {/* Address */}
      <section>
        <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-widest mb-3">Address</h3>
        <div className="grid grid-cols-6 gap-4">
          <div className="col-span-6">
            <label className="block text-sm font-medium text-slate-700 mb-1">Street</label>
            <input value={form.address} onChange={e => set('address', e.target.value)}
              className={inp} placeholder="123 Main St" />
          </div>
          <div className="col-span-3">
            <label className="block text-sm font-medium text-slate-700 mb-1">City</label>
            <input value={form.city} onChange={e => set('city', e.target.value)} className={inp} />
          </div>
          <div className="col-span-2">
            <label className="block text-sm font-medium text-slate-700 mb-1">State</label>
            <select value={form.state} onChange={e => set('state', e.target.value)} className={inp + ' bg-white'}>
              <option value="">—</option>
              {US_STATES.map(s => <option key={s}>{s}</option>)}
            </select>
          </div>
          <div className="col-span-1">
            <label className="block text-sm font-medium text-slate-700 mb-1">ZIP</label>
            <input value={form.zip} onChange={e => set('zip', e.target.value)}
              className={inp} placeholder="00000" />
          </div>
        </div>
      </section>

      {/* Notes */}
      <section>
        <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-widest mb-3">Notes</h3>
        <textarea value={form.notes} onChange={e => set('notes', e.target.value)} rows={3}
          className={inp + ' resize-none'}
          placeholder="Any additional notes about this investor…" />
      </section>

      <div className="flex justify-end gap-2 pt-2 border-t border-slate-100">
        <button type="button" onClick={onClose}
          className="px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50 rounded-lg">
          Cancel
        </button>
        <Button type="submit" disabled={saving || !form.name.trim()}>
          {saving ? <><Loader2 className="w-4 h-4 animate-spin" /> Saving…</> : investor ? 'Save changes' : 'Add investor'}
        </Button>
      </div>
    </form>
  )
}

// ── Empty state ───────────────────────────────────────────────────────────────
function EmptyInvestors({ onAdd }) {
  return (
    <div className="flex flex-col items-center justify-center h-64 text-center">
      <div className="w-14 h-14 rounded-2xl bg-slate-100 flex items-center justify-center mb-4">
        <TrendingUp className="w-7 h-7 text-slate-400" />
      </div>
      <h3 className="text-base font-semibold text-slate-700 mb-1">No investors yet</h3>
      <p className="text-sm text-slate-400 mb-5 max-w-xs">
        Add investor profiles to track contributions, preferred returns, and distributions across all properties.
      </p>
      <Button onClick={onAdd}><Plus className="w-4 h-4" /> Add Investor</Button>
    </div>
  )
}
