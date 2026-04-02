import { useState, useEffect, useCallback, useRef } from 'react'
import { Building2, Plus, MoreHorizontal, Pencil, Trash2, Loader2, ChevronLeft, ChevronRight, AlertCircle } from 'lucide-react'
import { getProperties } from '../../api/client'
import { useApp } from '../../context/AppContext'
import TopBar from '../layout/TopBar'
import Button from '../ui/Button'
import Modal from '../ui/Modal'
import ConfirmDialog from '../ui/ConfirmDialog'
import EmptyState from '../ui/EmptyState'
import PropertyForm from './PropertyForm'
import PropertyDetail from './PropertyDetail'

const PAGE_SIZE = 75

function fmtPrice(v) {
  if (!v) return null
  if (v >= 1_000_000) return `$${(v/1_000_000).toFixed(2)}M`
  return `$${(v/1_000).toFixed(0)}K`
}

function leaseStatus(leaseEnd) {
  if (!leaseEnd) return null
  const months = (new Date(leaseEnd + 'T00:00:00') - new Date()) / (1000*60*60*24*30)
  if (months < 0)  return { label: 'Expired',  cls: 'bg-red-100 text-red-700' }
  if (months < 12) return { label: '< 1yr',    cls: 'bg-amber-100 text-amber-700' }
  if (months < 36) return { label: '1-3 yrs',  cls: 'bg-yellow-100 text-yellow-700' }
  return              { label: `${Math.round(months/12)}y`, cls: 'bg-green-100 text-green-700' }
}

export default function PropertiesPage() {
  const { tenantBrands, propertyStates, addProperty, editProperty, removeProperty } = useApp()

  const [rows, setRows]           = useState([])
  const [total, setTotal]         = useState(0)
  const [page, setPage]           = useState(0)
  const [search, setSearch]       = useState('')
  const [tenantFilter, setTenant] = useState('')
  const [stateFilter, setState]   = useState('')
  const [fetching, setFetching]   = useState(false)
  const [showForm, setShowForm]         = useState(false)
  const [editTarget, setEditTarget]     = useState(null)
  const [deleteTarget, setDeleteTarget] = useState(null)
  const [detailId, setDetailId]         = useState(null)
  const [openMenu, setOpenMenu]         = useState(null)
  const searchTimer = useRef(null)

  const load = useCallback(async (s, tenant, state, pg) => {
    setFetching(true)
    try {
      const params = { limit: PAGE_SIZE, offset: pg * PAGE_SIZE }
      if (s)      params.search = s
      if (tenant) params.tenant = tenant
      if (state)  params.state = state
      const res = await getProperties(params)
      setRows(res.rows)
      setTotal(res.total)
    } finally { setFetching(false) }
  }, [])

  useEffect(() => { load(search, tenantFilter, stateFilter, page) }, [page, tenantFilter, stateFilter]) // eslint-disable-line

  const handleSearch = (val) => {
    setSearch(val)
    clearTimeout(searchTimer.current)
    searchTimer.current = setTimeout(() => { setPage(0); load(val, tenantFilter, stateFilter, 0) }, 300)
  }

  const handleSave = async (data) => {
    if (editTarget) await editProperty(editTarget.id, data)
    else await addProperty(data)
    load(search, tenantFilter, stateFilter, page)
  }

  const handleDelete = async () => {
    await removeProperty(deleteTarget.id)
    load(search, tenantFilter, stateFilter, page)
  }

  const totalPages = Math.ceil(total / PAGE_SIZE)

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <TopBar
        title={`Properties${total > 0 ? ` (${total.toLocaleString()})` : ''}`}
        onSearch={handleSearch}
        searchPlaceholder="Search address, city, owner…"
        actions={
          <div className="flex items-center gap-2">
            <select value={tenantFilter} onChange={e => { setTenant(e.target.value); setPage(0); load(search, e.target.value, stateFilter, 0) }}
              className="text-sm border border-slate-200 rounded-lg px-3 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500">
              <option value="">All tenants</option>
              {tenantBrands.map(t => <option key={t.id} value={t.name}>{t.name}</option>)}
            </select>
            <select value={stateFilter} onChange={e => { setState(e.target.value); setPage(0); load(search, tenantFilter, e.target.value, 0) }}
              className="text-sm border border-slate-200 rounded-lg px-3 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500">
              <option value="">All states</option>
              {propertyStates.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
            <Button onClick={() => { setEditTarget(null); setShowForm(true) }}>
              <Plus className="w-4 h-4" /> New property
            </Button>
          </div>
        }
      />

      <div className="flex-1 overflow-auto p-6 scrollbar-thin">
        {fetching && rows.length === 0 ? (
          <div className="flex items-center justify-center h-48"><Loader2 className="w-6 h-6 text-slate-400 animate-spin" /></div>
        ) : rows.length === 0 ? (
          <EmptyState icon={Building2} title="No properties found" description="Import your Salesforce data or add properties manually." action="New property" onAction={() => setShowForm(true)} />
        ) : (
          <>
            <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 border-b border-slate-200">
                  <tr>
                    {['Address','Tenant','Owner','Lease','Cap Rate','NOI','List Price','Lease End'].map(h => (
                      <th key={h} className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wide">{h}</th>
                    ))}
                    <th className="w-12" />
                  </tr>
                </thead>
                <tbody>
                  {rows.map((p, i) => {
                    const ls = leaseStatus(p.lease_end)
                    return (
                      <tr key={p.id} onClick={() => setDetailId(p.id)} className={`border-b border-slate-100 last:border-0 hover:bg-blue-50/40 transition-colors cursor-pointer ${i%2===0?'bg-white':'bg-slate-50/40'}`}>
                        <td className="px-4 py-3">
                          <p className="font-medium text-slate-900">{p.address}</p>
                          {(p.city||p.state) && <p className="text-xs text-slate-500">{[p.city,p.state,p.zip].filter(Boolean).join(', ')}</p>}
                        </td>
                        <td className="px-4 py-3">
                          {p.tenant_brand_name
                            ? <span className="text-xs font-semibold text-blue-700 bg-blue-50 px-2 py-0.5 rounded-full">{p.tenant_brand_name}</span>
                            : <span className="text-slate-300">—</span>}
                        </td>
                        <td className="px-4 py-3 max-w-[180px]">
                          <div>
                            <p className="text-slate-700 truncate">{p.owner_name || <span className="text-slate-300">—</span>}</p>
                            {p.owner_do_not_contact ? <span className="text-xs text-red-500 flex items-center gap-0.5"><AlertCircle className="w-3 h-3"/>DNC</span> : null}
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          {p.lease_type ? <span className="text-xs font-medium bg-slate-100 text-slate-700 px-2 py-0.5 rounded-full">{p.lease_type}</span> : <span className="text-slate-300">—</span>}
                        </td>
                        <td className="px-4 py-3">
                          {p.cap_rate ? <span className="font-semibold text-emerald-700">{p.cap_rate}%</span> : <span className="text-slate-300">—</span>}
                        </td>
                        <td className="px-4 py-3 text-slate-700">{p.noi ? fmtPrice(p.noi) : <span className="text-slate-300">—</span>}</td>
                        <td className="px-4 py-3 font-medium text-slate-900">{p.list_price ? fmtPrice(p.list_price) : <span className="text-slate-300 font-normal">—</span>}</td>
                        <td className="px-4 py-3">
                          {ls ? <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${ls.cls}`}>{ls.label}</span> : <span className="text-slate-300">—</span>}
                        </td>
                        <td className="px-4 py-3" onClick={e => e.stopPropagation()}>
                          <div className="relative">
                            <button className="w-8 h-8 rounded-lg flex items-center justify-center text-slate-400 hover:bg-slate-100" onClick={()=>setOpenMenu(openMenu===p.id?null:p.id)}>
                              <MoreHorizontal className="w-4 h-4"/>
                            </button>
                            {openMenu===p.id && (
                              <div className="absolute right-0 top-9 w-40 bg-white border border-slate-200 rounded-xl shadow-lg z-10 py-1 text-sm">
                                <button className="flex items-center gap-2 w-full px-3 py-2 text-slate-700 hover:bg-slate-50" onClick={()=>{setEditTarget(p);setShowForm(true);setOpenMenu(null)}}>
                                  <Pencil className="w-3.5 h-3.5"/> Edit
                                </button>
                                <button className="flex items-center gap-2 w-full px-3 py-2 text-red-600 hover:bg-red-50" onClick={()=>{setDeleteTarget(p);setOpenMenu(null)}}>
                                  <Trash2 className="w-3.5 h-3.5"/> Delete
                                </button>
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
                  <Button variant="secondary" size="sm" disabled={page===0} onClick={()=>setPage(p=>p-1)}><ChevronLeft className="w-4 h-4"/></Button>
                  <span className="text-sm text-slate-600">Page {page+1} of {totalPages}</span>
                  <Button variant="secondary" size="sm" disabled={page>=totalPages-1} onClick={()=>setPage(p=>p+1)}><ChevronRight className="w-4 h-4"/></Button>
                </div>
              </div>
            )}
          </>
        )}
      </div>

      <Modal isOpen={showForm} onClose={()=>{setShowForm(false);setEditTarget(null)}} title={editTarget?'Edit property':'New property'} size="lg">
        <PropertyForm property={editTarget} onSave={handleSave} onClose={()=>{setShowForm(false);setEditTarget(null)}} />
      </Modal>
      <ConfirmDialog isOpen={!!deleteTarget} onClose={()=>setDeleteTarget(null)} onConfirm={handleDelete} title="Delete property?" message={`"${deleteTarget?.address}" will be permanently deleted.`} />

      {detailId && (
        <>
          <div className="fixed inset-0 z-30 bg-black/10" onClick={() => setDetailId(null)} />
          <PropertyDetail
            propertyId={detailId}
            onClose={() => setDetailId(null)}
            onEdit={() => {
              const p = rows.find(r => r.id === detailId)
              if (p) { setEditTarget(p); setShowForm(true) }
              setDetailId(null)
            }}
          />
        </>
      )}
      {openMenu && <div className="fixed inset-0 z-0" onClick={()=>setOpenMenu(null)}/>}
    </div>
  )
}
