import { useState, useEffect, useCallback, useRef } from 'react'
import { Building2, UserPlus, Loader2, Pencil, Trash2, MoreHorizontal, ChevronLeft, ChevronRight } from 'lucide-react'
import { getPeople } from '../../api/client'
import { useApp } from '../../context/AppContext'
import TopBar from '../layout/TopBar'
import Button from '../ui/Button'
import Avatar from '../ui/Avatar'
import Modal from '../ui/Modal'
import ConfirmDialog from '../ui/ConfirmDialog'
import EmptyState from '../ui/EmptyState'
import PersonForm from './PersonForm'
import PersonDetail from './PersonDetail'
import { getTenantRoles } from '../../api/client'
import { US_STATES } from '../../constants/territory'

const PAGE_SIZE = 75

function parseArr(v) {
  if (Array.isArray(v)) return v
  if (typeof v === 'string' && v.trim()) { try { const a = JSON.parse(v); return Array.isArray(a) ? a : [] } catch { return [] } }
  return []
}

function Chips({ items, color }) {
  if (!items.length) return <span className="text-slate-300">—</span>
  return (
    <div className="flex flex-wrap gap-1">
      {items.map(x => <span key={x} className={`text-xs font-medium px-1.5 py-0.5 rounded-full ${color}`}>{x}</span>)}
    </div>
  )
}

export default function TenantContactsPage() {
  const { addPerson, editPerson, removePerson, tenantBrands } = useApp()

  const [rows, setRows]     = useState([])
  const [total, setTotal]   = useState(0)
  const [page, setPage]     = useState(0)
  const [search, setSearch] = useState('')
  const [brandFilter, setBrandFilter] = useState('')
  const [roleFilter, setRoleFilter]   = useState('')
  const [stateFilter, setStateFilter] = useState('')
  const [roleTypes, setRoleTypes]     = useState([])
  const [fetching, setFetching]       = useState(false)

  const [showForm, setShowForm]       = useState(false)
  const [editTarget, setEditTarget]   = useState(null)
  const [deleteTarget, setDeleteTarget] = useState(null)
  const [detailId, setDetailId]       = useState(null)
  const [openMenu, setOpenMenu]       = useState(null)
  const searchTimer = useRef(null)

  useEffect(() => { getTenantRoles().then(setRoleTypes).catch(() => {}) }, [])

  const load = useCallback(async (s, brand, role, st, pg) => {
    setFetching(true)
    try {
      const params = { role: 'tenant_contact', limit: PAGE_SIZE, offset: pg * PAGE_SIZE, sortCol: 'name', sortDir: 'asc' }
      if (s)     params.search = s
      if (brand) params.tenant_brand_id = brand
      if (role)  params.tenant_role = role
      if (st)    params.territory_state = st
      const res = await getPeople(params)
      setRows(res.rows); setTotal(res.total)
    } finally { setFetching(false) }
  }, [])

  useEffect(() => { load(search, brandFilter, roleFilter, stateFilter, page) }, [page, brandFilter, roleFilter, stateFilter]) // eslint-disable-line

  const handleSearch = (val) => {
    setSearch(val); clearTimeout(searchTimer.current)
    searchTimer.current = setTimeout(() => { setPage(0); load(val, brandFilter, roleFilter, stateFilter, 0) }, 300)
  }
  const handleSave = async (data) => {
    if (editTarget) await editPerson(editTarget.id, data); else await addPerson(data)
    load(search, brandFilter, roleFilter, stateFilter, page)
  }
  const handleDelete = async () => {
    await removePerson(deleteTarget.id); setDeleteTarget(null); load(search, brandFilter, roleFilter, stateFilter, page)
  }

  const totalPages = Math.ceil(total / PAGE_SIZE)
  const selectCls = 'text-sm border border-slate-200 rounded-lg px-3 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500'

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <TopBar
        title={`Tenant Contacts${total > 0 ? ` (${total.toLocaleString()})` : ''}`}
        onSearch={handleSearch}
        searchPlaceholder="Search name, email, phone…"
        actions={
          <div className="flex items-center gap-2">
            <select value={brandFilter} onChange={e => { setBrandFilter(e.target.value); setPage(0) }} className={selectCls}>
              <option value="">All tenants</option>
              {[...tenantBrands].sort((a,b) => a.name.localeCompare(b.name)).map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
            <select value={roleFilter} onChange={e => { setRoleFilter(e.target.value); setPage(0) }} className={selectCls}>
              <option value="">All roles</option>
              {roleTypes.map(r => <option key={r.id} value={r.label}>{r.label}</option>)}
            </select>
            <select value={stateFilter} onChange={e => { setStateFilter(e.target.value); setPage(0) }} className={selectCls}>
              <option value="">All states</option>
              {US_STATES.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
            <Button onClick={() => { setEditTarget(null); setShowForm(true) }}>
              <UserPlus className="w-4 h-4" /> New tenant contact
            </Button>
          </div>
        }
      />

      <div className="flex-1 overflow-auto p-6 scrollbar-thin">
        {fetching && rows.length === 0 ? (
          <div className="flex items-center justify-center h-48"><Loader2 className="w-6 h-6 text-slate-400 animate-spin" /></div>
        ) : rows.length === 0 ? (
          <EmptyState icon={Building2} title="No tenant contacts yet"
            description="Add a tenant's real-estate team member, or log one directly from Gmail."
            action="New tenant contact" onAction={() => { setEditTarget(null); setShowForm(true) }} />
        ) : (
          <>
            <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 border-b border-slate-200">
                  <tr>
                    {['Name','Tenant','Roles','Territory','Phone','Email'].map(h => (
                      <th key={h} className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wide whitespace-nowrap">{h}</th>
                    ))}
                    <th className="w-12" />
                  </tr>
                </thead>
                <tbody>
                  {rows.map((p, i) => {
                    const states = parseArr(p.territory_states), regions = parseArr(p.territory_regions), roles = parseArr(p.tenant_roles)
                    const territory = [...regions, ...states]
                    return (
                      <tr key={p.id}
                        className={`border-b border-slate-100 last:border-0 hover:bg-blue-50/40 transition-colors cursor-pointer ${i%2===0?'bg-white':'bg-slate-50/40'}`}
                        onClick={() => setDetailId(p.id)}>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-3">
                            <Avatar contact={{ firstName: p.first_name||p.name.split(' ')[0], lastName: p.last_name||'' }} size="sm" />
                            <div>
                              <span className="font-medium text-slate-900">{p.name}</span>
                              {p.title && <div className="text-xs text-slate-500">{p.title}</div>}
                            </div>
                          </div>
                        </td>
                        <td className="px-4 py-3 text-slate-700">{p.tenant_brand_name || <span className="text-slate-300">—</span>}</td>
                        <td className="px-4 py-3"><Chips items={roles} color="bg-blue-50 text-blue-700" /></td>
                        <td className="px-4 py-3 max-w-[220px]">
                          {territory.length
                            ? <Chips items={territory} color="bg-emerald-50 text-emerald-700" />
                            : <span className="text-slate-300">—</span>}
                        </td>
                        <td className="px-4 py-3 text-slate-600">{p.phone||p.mobile||<span className="text-slate-300">—</span>}</td>
                        <td className="px-4 py-3">
                          {p.email
                            ? <a href={`mailto:${p.email}`} className="text-blue-600 hover:underline" onClick={e => e.stopPropagation()}>{p.email}</a>
                            : <span className="text-slate-300">—</span>}
                        </td>
                        <td className="px-4 py-3" onClick={e => e.stopPropagation()}>
                          <div className="relative">
                            <button className="w-8 h-8 rounded-lg flex items-center justify-center text-slate-400 hover:bg-slate-100" onClick={() => setOpenMenu(openMenu===p.id?null:p.id)}>
                              <MoreHorizontal className="w-4 h-4" />
                            </button>
                            {openMenu===p.id && (
                              <div className="absolute right-0 top-9 w-36 bg-white border border-slate-200 rounded-xl shadow-lg z-10 py-1 text-sm">
                                <button className="flex items-center gap-2 w-full px-3 py-2 text-slate-700 hover:bg-slate-50" onClick={() => { setEditTarget(p); setShowForm(true); setOpenMenu(null) }}><Pencil className="w-3.5 h-3.5"/> Edit</button>
                                <button className="flex items-center gap-2 w-full px-3 py-2 text-red-600 hover:bg-red-50" onClick={() => { setDeleteTarget(p); setOpenMenu(null) }}><Trash2 className="w-3.5 h-3.5"/> Delete</button>
                              </div>
                            )}
                          </div>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
            {totalPages > 1 && (
              <div className="flex items-center justify-between mt-4 px-1">
                <p className="text-sm text-slate-500">Showing {page*PAGE_SIZE+1}–{Math.min((page+1)*PAGE_SIZE,total)} of {total.toLocaleString()}</p>
                <div className="flex items-center gap-2">
                  <Button variant="secondary" size="sm" disabled={page===0} onClick={() => setPage(p=>p-1)}><ChevronLeft className="w-4 h-4"/></Button>
                  <span className="text-sm text-slate-600">Page {page+1} of {totalPages}</span>
                  <Button variant="secondary" size="sm" disabled={page>=totalPages-1} onClick={() => setPage(p=>p+1)}><ChevronRight className="w-4 h-4"/></Button>
                </div>
              </div>
            )}
          </>
        )}
      </div>

      <Modal isOpen={showForm} onClose={() => { setShowForm(false); setEditTarget(null) }} title={editTarget?'Edit tenant contact':'New tenant contact'}>
        <PersonForm person={editTarget} presetRole="tenant_contact" onSave={handleSave} onClose={() => { setShowForm(false); setEditTarget(null) }} />
      </Modal>
      <ConfirmDialog isOpen={!!deleteTarget} onClose={() => setDeleteTarget(null)} onConfirm={handleDelete} title="Delete tenant contact?" message={`"${deleteTarget?.name}" will be permanently deleted.`} />
      {detailId && (
        <>
          <div className="fixed inset-0 z-30" onClick={() => setDetailId(null)} />
          <PersonDetail personId={detailId} onClose={() => setDetailId(null)}
            onEdit={() => { const p=rows.find(r=>r.id===detailId); if(p){setEditTarget(p);setShowForm(true)} setDetailId(null) }} />
        </>
      )}
      {openMenu && <div className="fixed inset-0 z-0" onClick={() => setOpenMenu(null)} />}
    </div>
  )
}
