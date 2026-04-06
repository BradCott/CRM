import { useState, useEffect, useCallback, useRef } from 'react'
import {
  TrendingUp, Plus, MoreHorizontal, Pencil, Trash2, Loader2,
  ChevronLeft, ChevronRight, Building2, User, X, DollarSign,
} from 'lucide-react'
import { getInvestors, createInvestor, updateInvestor, deleteInvestor } from '../../api/client'
import { useApp } from '../../context/AppContext'
import TopBar from '../layout/TopBar'
import Button from '../ui/Button'
import Modal from '../ui/Modal'
import ConfirmDialog from '../ui/ConfirmDialog'
import MultiSelect from '../ui/MultiSelect'

const PAGE_SIZE = 75

const US_STATES = [
  'AL','AK','AZ','AR','CA','CO','CT','DE','FL','GA',
  'HI','ID','IL','IN','IA','KS','KY','LA','ME','MD',
  'MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ',
  'NM','NY','NC','ND','OH','OK','OR','PA','RI','SC',
  'SD','TN','TX','UT','VT','VA','WA','WV','WI','WY',
]

function fmt$(v) {
  if (!v && v !== 0) return null
  if (v >= 1_000_000) return `$${(v / 1_000_000).toFixed(1)}M`
  if (v >= 1_000)     return `$${Number(v).toLocaleString()}`
  return `$${v}`
}

function TypeBadge({ type }) {
  if (type === 'company') {
    return (
      <span className="inline-flex items-center gap-1 text-xs font-semibold text-violet-700 bg-violet-50 px-2 py-0.5 rounded-full">
        <Building2 className="w-3 h-3" /> Company
      </span>
    )
  }
  return (
    <span className="inline-flex items-center gap-1 text-xs font-semibold text-blue-700 bg-blue-50 px-2 py-0.5 rounded-full">
      <User className="w-3 h-3" /> Individual
    </span>
  )
}

// ── Main Page ─────────────────────────────────────────────────────────────────
export default function InvestorsPage() {
  const { tenantBrands } = useApp()
  const brandNames = tenantBrands.map(b => b.name)

  const [rows, setRows]                 = useState([])
  const [total, setTotal]               = useState(0)
  const [page, setPage]                 = useState(0)
  const [search, setSearch]             = useState('')
  const [typeFilter, setTypeFilter]     = useState('')
  const [fetching, setFetching]         = useState(false)
  const [showForm, setShowForm]         = useState(false)
  const [editTarget, setEditTarget]     = useState(null)
  const [deleteTarget, setDeleteTarget] = useState(null)
  const [openMenu, setOpenMenu]         = useState(null)
  const searchTimer = useRef(null)

  const load = useCallback(async (s, type, pg) => {
    setFetching(true)
    try {
      const params = { limit: PAGE_SIZE, offset: pg * PAGE_SIZE }
      if (s)    params.search = s
      if (type) params.type   = type
      const res = await getInvestors(params)
      setRows(res.rows)
      setTotal(res.total)
    } finally { setFetching(false) }
  }, [])

  useEffect(() => { load(search, typeFilter, page) }, [page, typeFilter]) // eslint-disable-line

  const handleSearch = (val) => {
    setSearch(val)
    clearTimeout(searchTimer.current)
    searchTimer.current = setTimeout(() => { setPage(0); load(val, typeFilter, 0) }, 300)
  }

  const handleSave = async (data) => {
    if (editTarget) await updateInvestor(editTarget.id, data)
    else await createInvestor(data)
    load(search, typeFilter, page)
  }

  const handleDelete = async () => {
    await deleteInvestor(deleteTarget.id)
    load(search, typeFilter, page)
  }

  const totalPages = Math.ceil(total / PAGE_SIZE)

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <TopBar
        title={total > 0 ? `Investors (${total.toLocaleString()})` : 'Investors'}
        onSearch={handleSearch}
        searchPlaceholder="Search name, email, city…"
        actions={
          <div className="flex items-center gap-2">
            <select
              value={typeFilter}
              onChange={e => { setTypeFilter(e.target.value); setPage(0); load(search, e.target.value, 0) }}
              className="text-sm border border-slate-200 rounded-lg px-3 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="">All types</option>
              <option value="individual">Individual</option>
              <option value="company">Company</option>
            </select>
            <Button onClick={() => { setEditTarget(null); setShowForm(true) }}>
              <Plus className="w-4 h-4" /> Add investor
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
                    {['Name', 'Type', 'Contact', 'Location', 'Deal Range', 'Pref. Tenants', 'Pref. States', 'Total Invested'].map(h => (
                      <th key={h} className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wide whitespace-nowrap">{h}</th>
                    ))}
                    <th className="w-12" />
                  </tr>
                </thead>
                <tbody>
                  {rows.map((inv, i) => (
                    <tr
                      key={inv.id}
                      className={`border-b border-slate-100 last:border-0 hover:bg-blue-50/40 transition-colors ${i % 2 === 0 ? 'bg-white' : 'bg-slate-50/40'}`}
                    >
                      <td className="px-4 py-3">
                        <p className="font-medium text-slate-900">{inv.name}</p>
                        {inv.notes && <p className="text-xs text-slate-400 truncate max-w-[180px]">{inv.notes}</p>}
                      </td>
                      <td className="px-4 py-3"><TypeBadge type={inv.type} /></td>
                      <td className="px-4 py-3">
                        {inv.email && <p className="text-slate-700 truncate max-w-[160px]">{inv.email}</p>}
                        {inv.phone && <p className="text-xs text-slate-500">{inv.phone}</p>}
                        {!inv.email && !inv.phone && <span className="text-slate-300">—</span>}
                      </td>
                      <td className="px-4 py-3">
                        {(inv.city || inv.state) ? (
                          <p className="text-slate-700">{[inv.city, inv.state].filter(Boolean).join(', ')}</p>
                        ) : <span className="text-slate-300">—</span>}
                        {inv.address && <p className="text-xs text-slate-400 truncate max-w-[140px]">{inv.address}</p>}
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        {(inv.min_deal_size || inv.max_deal_size) ? (
                          <p className="text-slate-700 text-xs">
                            {fmt$(inv.min_deal_size) || '—'} – {fmt$(inv.max_deal_size) || '—'}
                          </p>
                        ) : <span className="text-slate-300">—</span>}
                      </td>
                      <td className="px-4 py-3">
                        {inv.preferred_tenant_brands?.length > 0 ? (
                          <div className="flex flex-wrap gap-1 max-w-[160px]">
                            {inv.preferred_tenant_brands.slice(0, 2).map(b => (
                              <span key={b} className="text-xs bg-slate-100 text-slate-600 px-1.5 py-0.5 rounded">{b}</span>
                            ))}
                            {inv.preferred_tenant_brands.length > 2 && (
                              <span className="text-xs text-slate-400">+{inv.preferred_tenant_brands.length - 2}</span>
                            )}
                          </div>
                        ) : <span className="text-slate-300">—</span>}
                      </td>
                      <td className="px-4 py-3">
                        {inv.preferred_states?.length > 0 ? (
                          <p className="text-xs text-slate-700">{inv.preferred_states.slice(0, 4).join(', ')}{inv.preferred_states.length > 4 ? ` +${inv.preferred_states.length - 4}` : ''}</p>
                        ) : <span className="text-slate-300">—</span>}
                      </td>
                      <td className="px-4 py-3 font-medium text-slate-900">
                        {fmt$(inv.total_investments) || <span className="text-slate-300 font-normal">—</span>}
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
          brandNames={brandNames}
          onSave={handleSave}
          onClose={() => { setShowForm(false); setEditTarget(null) }}
        />
      </Modal>

      <ConfirmDialog
        isOpen={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={handleDelete}
        title="Delete investor?"
        message={`"${deleteTarget?.name}" will be permanently deleted.`}
      />

      {openMenu && <div className="fixed inset-0 z-0" onClick={() => setOpenMenu(null)} />}
    </div>
  )
}

// ── Investor Form ─────────────────────────────────────────────────────────────
function InvestorForm({ investor, brandNames, onSave, onClose }) {
  const [saving, setSaving] = useState(false)
  const [form, setForm] = useState({
    name:                    investor?.name                    ?? '',
    type:                    investor?.type                    ?? 'individual',
    email:                   investor?.email                   ?? '',
    phone:                   investor?.phone                   ?? '',
    address:                 investor?.address                 ?? '',
    city:                    investor?.city                    ?? '',
    state:                   investor?.state                   ?? '',
    zip:                     investor?.zip                     ?? '',
    total_investments:       investor?.total_investments       ?? '',
    preferred_tenant_brands: investor?.preferred_tenant_brands ?? [],
    preferred_states:        investor?.preferred_states        ?? [],
    min_deal_size:           investor?.min_deal_size           ?? '',
    max_deal_size:           investor?.max_deal_size           ?? '',
    notes:                   investor?.notes                   ?? '',
  })

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!form.name.trim()) return
    setSaving(true)
    try {
      await onSave({
        ...form,
        total_investments: form.total_investments !== '' ? Number(form.total_investments) : null,
        min_deal_size:     form.min_deal_size     !== '' ? Number(form.min_deal_size)     : null,
        max_deal_size:     form.max_deal_size     !== '' ? Number(form.max_deal_size)     : null,
      })
      onClose()
    } finally {
      setSaving(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6 p-6">
      {/* Identity */}
      <section>
        <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-widest mb-3">Identity</h3>
        <div className="grid grid-cols-2 gap-4">
          <div className="col-span-2">
            <label className="block text-sm font-medium text-slate-700 mb-1">Name <span className="text-red-500">*</span></label>
            <input
              required
              value={form.name}
              onChange={e => set('name', e.target.value)}
              className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="Full name or company name"
            />
          </div>
          <div className="col-span-2">
            <label className="block text-sm font-medium text-slate-700 mb-2">Type</label>
            <div className="flex gap-4">
              {[['individual', 'Individual'], ['company', 'Company']].map(([val, label]) => (
                <label key={val} className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="radio"
                    name="type"
                    value={val}
                    checked={form.type === val}
                    onChange={() => set('type', val)}
                    className="text-blue-600 focus:ring-blue-500"
                  />
                  <span className="text-sm text-slate-700">{label}</span>
                </label>
              ))}
            </div>
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
              className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="email@example.com" />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Phone</label>
            <input type="tel" value={form.phone} onChange={e => set('phone', e.target.value)}
              className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="(555) 000-0000" />
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
              className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="123 Main St" />
          </div>
          <div className="col-span-3">
            <label className="block text-sm font-medium text-slate-700 mb-1">City</label>
            <input value={form.city} onChange={e => set('city', e.target.value)}
              className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500" />
          </div>
          <div className="col-span-2">
            <label className="block text-sm font-medium text-slate-700 mb-1">State</label>
            <select value={form.state} onChange={e => set('state', e.target.value)}
              className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white">
              <option value="">—</option>
              {US_STATES.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
          <div className="col-span-1">
            <label className="block text-sm font-medium text-slate-700 mb-1">ZIP</label>
            <input value={form.zip} onChange={e => set('zip', e.target.value)}
              className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="00000" />
          </div>
        </div>
      </section>

      {/* Investment Profile */}
      <section>
        <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-widest mb-3">Investment Profile</h3>
        <div className="grid grid-cols-3 gap-4 mb-4">
          <div className="col-span-3 sm:col-span-1">
            <label className="block text-sm font-medium text-slate-700 mb-1">Total Invested ($)</label>
            <div className="relative">
              <DollarSign className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
              <input type="number" min="0" value={form.total_investments} onChange={e => set('total_investments', e.target.value)}
                className="w-full pl-8 pr-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="0" />
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Min Deal Size ($)</label>
            <div className="relative">
              <DollarSign className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
              <input type="number" min="0" value={form.min_deal_size} onChange={e => set('min_deal_size', e.target.value)}
                className="w-full pl-8 pr-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="0" />
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Max Deal Size ($)</label>
            <div className="relative">
              <DollarSign className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
              <input type="number" min="0" value={form.max_deal_size} onChange={e => set('max_deal_size', e.target.value)}
                className="w-full pl-8 pr-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="0" />
            </div>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-2">Preferred Tenant Brands</label>
            <MultiSelect
              options={brandNames}
              selected={form.preferred_tenant_brands}
              onChange={v => set('preferred_tenant_brands', v)}
              placeholder="Any tenant"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-2">Preferred States</label>
            <MultiSelect
              options={US_STATES}
              selected={form.preferred_states}
              onChange={v => set('preferred_states', v)}
              placeholder="Any state"
            />
          </div>
        </div>
      </section>

      {/* Notes */}
      <section>
        <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-widest mb-3">Notes</h3>
        <textarea
          value={form.notes}
          onChange={e => set('notes', e.target.value)}
          rows={3}
          className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
          placeholder="Any additional notes about this investor…"
        />
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
        Add individuals or companies who buy NNN properties so you can match them to deals.
      </p>
      <Button onClick={onAdd}><Plus className="w-4 h-4" /> Add investor</Button>
    </div>
  )
}
