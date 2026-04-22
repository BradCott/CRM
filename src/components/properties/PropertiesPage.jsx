import { useState, useEffect, useCallback, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Building2, Plus, MoreHorizontal, Pencil, Trash2, Loader2,
  ChevronLeft, ChevronRight, AlertCircle, Settings2, Upload, Mail,
} from 'lucide-react'
import { getProperties } from '../../api/client'
import { useApp } from '../../context/AppContext'
import TopBar from '../layout/TopBar'
import Button from '../ui/Button'
import Modal from '../ui/Modal'
import ConfirmDialog from '../ui/ConfirmDialog'
import EmptyState from '../ui/EmptyState'
import PropertyForm from './PropertyForm'
import PropertyDetail from './PropertyDetail'
import BulkSendModal from '../handwrytten/BulkSendModal'
import ColumnCustomizer, {
  buildPanelCols, loadSavedCols, detectPreset, saveColsToStorage,
} from '../ui/ColumnCustomizer'

const PAGE_SIZE   = 75
const STORAGE_KEY = 'properties_columns_v1'

// ── Helpers ───────────────────────────────────────────────────────────────────
function fmt$(v) {
  if (!v) return null
  if (v >= 1_000_000) return `$${(v / 1_000_000).toFixed(2)}M`
  if (v >= 1_000)     return `$${Number(v).toLocaleString()}`
  return `$${v}`
}
function leaseStatus(leaseEnd) {
  if (!leaseEnd) return null
  const months = (new Date(leaseEnd + 'T00:00:00') - new Date()) / (1000*60*60*24*30)
  if (months < 0)   return { label: 'Expired',  cls: 'bg-red-100 text-red-700' }
  if (months < 12)  return { label: '< 1yr',    cls: 'bg-amber-100 text-amber-700' }
  if (months < 36)  return { label: '1–3 yrs',  cls: 'bg-yellow-100 text-yellow-700' }
  return { label: `${Math.round(months/12)}yr`, cls: 'bg-green-100 text-green-700' }
}
function daysUntilLease(leaseEnd) {
  if (!leaseEnd) return null
  return Math.ceil((new Date(leaseEnd + 'T00:00:00') - new Date()) / 86_400_000)
}
function fmtDate(d) {
  if (!d) return null
  return new Date(d + 'T00:00:00').toLocaleDateString('en-US', { month:'short', day:'numeric', year:'numeric' })
}

// ── Column definitions ────────────────────────────────────────────────────────
const COLUMN_DEFS = {
  address: {
    label: 'Address',
    td(p, k) {
      return (
        <td key={k} className="px-4 py-3">
          <p className="font-medium text-slate-900">{p.address}</p>
          {(p.city||p.state) && <p className="text-xs text-slate-500">{[p.city,p.state,p.zip].filter(Boolean).join(', ')}</p>}
        </td>
      )
    },
  },
  tenant: {
    label: 'Tenant',
    td(p, k) {
      return (
        <td key={k} className="px-4 py-3">
          {p.tenant_brand_name
            ? <span className="text-xs font-semibold text-blue-700 bg-blue-50 px-2 py-0.5 rounded-full">{p.tenant_brand_name}</span>
            : <span className="text-slate-300">—</span>}
        </td>
      )
    },
  },
  owner: {
    label: 'Owner',
    td(p, k) {
      return (
        <td key={k} className="px-4 py-3 max-w-[180px]">
          <p className="text-slate-700 truncate">{p.owner_name || <span className="text-slate-300">—</span>}</p>
          {p.owner_do_not_contact ? <span className="text-xs text-red-500 flex items-center gap-0.5 mt-0.5"><AlertCircle className="w-3 h-3"/>DNC</span> : null}
        </td>
      )
    },
  },
  state: {
    label: 'State',
    td(p, k) { return <td key={k} className="px-4 py-3 text-slate-700">{p.state||<span className="text-slate-300">—</span>}</td> },
  },
  city: {
    label: 'City',
    td(p, k) { return <td key={k} className="px-4 py-3 text-slate-700">{p.city||<span className="text-slate-300">—</span>}</td> },
  },
  property_type: {
    label: 'Property Type',
    td(p, k) {
      return (
        <td key={k} className="px-4 py-3">
          {p.property_type
            ? <span className="text-xs font-medium bg-slate-100 text-slate-700 px-2 py-0.5 rounded-full">{p.property_type}</span>
            : <span className="text-slate-300">—</span>}
        </td>
      )
    },
  },
  lease_type: {
    label: 'Lease Type',
    td(p, k) {
      return (
        <td key={k} className="px-4 py-3">
          {p.lease_type
            ? <span className="text-xs font-medium bg-slate-100 text-slate-700 px-2 py-0.5 rounded-full">{p.lease_type}</span>
            : <span className="text-slate-300">—</span>}
        </td>
      )
    },
  },
  lease_start: {
    label: 'Lease Start',
    td(p, k) { return <td key={k} className="px-4 py-3 text-xs text-slate-600">{fmtDate(p.lease_start)||<span className="text-slate-300">—</span>}</td> },
  },
  lease_end: {
    label: 'Lease End',
    td(p, k) {
      const ls = leaseStatus(p.lease_end)
      return <td key={k} className="px-4 py-3">{ls?<span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${ls.cls}`}>{ls.label}</span>:<span className="text-slate-300">—</span>}</td>
    },
  },
  days_remaining: {
    label: 'Days Remaining',
    td(p, k) {
      const days = daysUntilLease(p.lease_end)
      return (
        <td key={k} className="px-4 py-3">
          {days != null
            ? <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${days<0?'bg-red-100 text-red-700':days<365?'bg-amber-100 text-amber-700':'bg-green-100 text-green-700'}`}>
                {days < 0 ? `${Math.abs(days).toLocaleString()}d over` : `${days.toLocaleString()}d`}
              </span>
            : <span className="text-slate-300">—</span>}
        </td>
      )
    },
  },
  cap_rate: {
    label: 'Cap Rate',
    td(p, k) {
      return <td key={k} className="px-4 py-3">{p.cap_rate?<span className="font-semibold text-emerald-700">{Number(p.cap_rate).toFixed(2)}%</span>:<span className="text-slate-300">—</span>}</td>
    },
  },
  noi: {
    label: 'NOI',
    td(p, k) { return <td key={k} className="px-4 py-3 text-slate-700">{fmt$(p.noi)||<span className="text-slate-300">—</span>}</td> },
  },
  annual_rent: {
    label: 'Annual Rent',
    td(p, k) { return <td key={k} className="px-4 py-3 text-slate-700">{fmt$(p.annual_rent)||<span className="text-slate-300">—</span>}</td> },
  },
  list_price: {
    label: 'List Price',
    td(p, k) { return <td key={k} className="px-4 py-3 font-medium text-slate-900">{fmt$(p.list_price)||<span className="text-slate-300 font-normal">—</span>}</td> },
  },
  building_size: {
    label: 'Bldg Size',
    td(p, k) {
      return <td key={k} className="px-4 py-3 text-slate-700">{p.building_size?`${Number(p.building_size).toLocaleString()} sf`:<span className="text-slate-300">—</span>}</td>
    },
  },
  year_built: {
    label: 'Year Built',
    td(p, k) { return <td key={k} className="px-4 py-3 text-slate-700">{p.year_built||<span className="text-slate-300">—</span>}</td> },
  },
}

const ALL_COLUMN_KEYS = Object.keys(COLUMN_DEFS)
const DEFAULT_COLS    = ['address','tenant','owner','lease_type','cap_rate','noi','list_price','lease_end']

const PRESET_VIEWS = [
  { id: 'default',     label: 'Default',     cols: DEFAULT_COLS },
  { id: 'prospecting', label: 'Prospecting', cols: ['address','tenant','state','lease_end','owner','list_price'] },
  { id: 'financials',  label: 'Financials',  cols: ['address','tenant','cap_rate','noi','annual_rent','list_price'] },
  { id: 'research',    label: 'Research',    cols: ['address','tenant','property_type','year_built','building_size','state'] },
]

// ── Main component ────────────────────────────────────────────────────────────
export default function PropertiesPage() {
  const { tenantBrands, propertyStates, addProperty, editProperty, removeProperty } = useApp()
  const navigate = useNavigate()
  const [showBulkSend, setShowBulkSend] = useState(false)

  const [rows, setRows]                 = useState([])
  const [total, setTotal]               = useState(0)
  const [page, setPage]                 = useState(0)
  const [search, setSearch]             = useState('')
  const [tenantFilter, setTenant]       = useState('')
  const [stateFilter, setState]         = useState('')
  const [fetching, setFetching]         = useState(false)
  const [showForm, setShowForm]         = useState(false)
  const [editTarget, setEditTarget]     = useState(null)
  const [deleteTarget, setDeleteTarget] = useState(null)
  const [detailId, setDetailId]         = useState(null)
  const [openMenu, setOpenMenu]         = useState(null)
  const [showCustomizer, setShowCustomizer] = useState(false)

  const [activeCols, setActiveCols]         = useState(() => loadSavedCols(STORAGE_KEY, DEFAULT_COLS, COLUMN_DEFS))
  const [panelCols, setPanelCols]           = useState(() => buildPanelCols(loadSavedCols(STORAGE_KEY, DEFAULT_COLS, COLUMN_DEFS), ALL_COLUMN_KEYS))
  const [activePreset, setActivePreset]     = useState(() => detectPreset(loadSavedCols(STORAGE_KEY, DEFAULT_COLS, COLUMN_DEFS), PRESET_VIEWS))
  const [savedIndicator, setSavedIndicator] = useState(false)

  const searchTimer = useRef(null)

  const load = useCallback(async (s, tenant, state, pg) => {
    setFetching(true)
    try {
      const params = { portfolio: '0', limit: PAGE_SIZE, offset: pg * PAGE_SIZE }
      if (s)      params.search = s
      if (tenant) params.tenant = tenant
      if (state)  params.state  = state
      const res = await getProperties(params)
      setRows(res.rows); setTotal(res.total)
    } finally { setFetching(false) }
  }, [])

  useEffect(() => { load(search, tenantFilter, stateFilter, page) }, [page, tenantFilter, stateFilter]) // eslint-disable-line

  const handleSearch = (val) => {
    setSearch(val); clearTimeout(searchTimer.current)
    searchTimer.current = setTimeout(() => { setPage(0); load(val, tenantFilter, stateFilter, 0) }, 300)
  }
  const handleSave = async (data) => {
    const marketData = { ...data, is_portfolio: 0 }
    if (editTarget) await editProperty(editTarget.id, marketData); else await addProperty(marketData)
    load(search, tenantFilter, stateFilter, page)
  }
  const handleDelete = async () => {
    await removeProperty(deleteTarget.id); load(search, tenantFilter, stateFilter, page)
  }

  // Column customizer
  const applyPreset = (preset) => {
    setPanelCols(buildPanelCols(preset.cols, ALL_COLUMN_KEYS))
    setActiveCols(preset.cols); setActivePreset(preset.id)
  }
  const handleToggleCol = (key) => {
    setPanelCols(prev => {
      const next = prev.map(c => c.key === key ? { ...c, enabled: !c.enabled } : c)
      setActiveCols(next.filter(c => c.enabled).map(c => c.key))
      return next
    }); setActivePreset(null)
  }
  const handleDragEnd = (result) => {
    if (!result.destination) return
    setPanelCols(prev => {
      const next = [...prev]
      const [moved] = next.splice(result.source.index, 1)
      next.splice(result.destination.index, 0, moved)
      setActiveCols(next.filter(c => c.enabled).map(c => c.key))
      return next
    }); setActivePreset(null)
  }
  const handleSaveView = () => {
    saveColsToStorage(STORAGE_KEY, activeCols)
    setSavedIndicator(true); setTimeout(() => setSavedIndicator(false), 2000)
  }

  const totalPages = Math.ceil(total / PAGE_SIZE)
  const activePresetLabel = PRESET_VIEWS.find(p => p.id === activePreset)?.label

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
            <button
              onClick={() => setShowCustomizer(c => !c)}
              className={`flex items-center gap-1.5 px-3 py-2 text-sm font-medium border rounded-lg transition-colors ${showCustomizer ? 'bg-blue-50 text-blue-700 border-blue-200' : 'text-slate-600 border-slate-200 hover:bg-slate-50'}`}
            >
              <Settings2 className="w-4 h-4" />
              {activePresetLabel ?? 'Columns'}
            </button>
            <button
              onClick={() => setShowBulkSend(true)}
              className="flex items-center gap-1.5 px-3 py-2 text-sm font-medium border rounded-lg transition-colors text-slate-600 border-slate-200 hover:bg-slate-50"
            >
              <Mail className="w-4 h-4" />
              Mail Campaign
            </button>
            <button
              onClick={() => navigate('/import')}
              className="flex items-center gap-1.5 px-3 py-2 text-sm font-medium border rounded-lg transition-colors text-slate-600 border-slate-200 hover:bg-slate-50"
            >
              <Upload className="w-4 h-4" />
              Import Properties
            </button>
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
                    {activeCols.map(key => (
                      <th key={key} className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wide whitespace-nowrap">
                        {COLUMN_DEFS[key].label}
                      </th>
                    ))}
                    <th className="w-12" />
                  </tr>
                </thead>
                <tbody>
                  {rows.map((p, i) => (
                    <tr key={p.id} onClick={() => { setDetailId(p.id); setShowCustomizer(false) }}
                      className={`border-b border-slate-100 last:border-0 hover:bg-blue-50/40 transition-colors cursor-pointer ${i%2===0?'bg-white':'bg-slate-50/40'}`}>
                      {activeCols.map(key => COLUMN_DEFS[key].td(p, key))}
                      <td className="px-4 py-3" onClick={e => e.stopPropagation()}>
                        <div className="relative">
                          <button className="w-8 h-8 rounded-lg flex items-center justify-center text-slate-400 hover:bg-slate-100" onClick={() => setOpenMenu(openMenu===p.id?null:p.id)}>
                            <MoreHorizontal className="w-4 h-4" />
                          </button>
                          {openMenu===p.id && (
                            <div className="absolute right-0 top-9 w-40 bg-white border border-slate-200 rounded-xl shadow-lg z-10 py-1 text-sm">
                              <button className="flex items-center gap-2 w-full px-3 py-2 text-slate-700 hover:bg-slate-50" onClick={() => { setEditTarget(p); setShowForm(true); setOpenMenu(null) }}><Pencil className="w-3.5 h-3.5"/> Edit</button>
                              <button className="flex items-center gap-2 w-full px-3 py-2 text-red-600 hover:bg-red-50" onClick={() => { setDeleteTarget(p); setOpenMenu(null) }}><Trash2 className="w-3.5 h-3.5"/> Delete</button>
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

      {showCustomizer && (
        <>
          <div className="fixed inset-0 z-30" onClick={() => setShowCustomizer(false)} />
          <ColumnCustomizer
            colDefs={COLUMN_DEFS} presets={PRESET_VIEWS}
            panelCols={panelCols} activePreset={activePreset} savedIndicator={savedIndicator}
            onToggle={handleToggleCol} onDragEnd={handleDragEnd} onPreset={applyPreset}
            onSave={handleSaveView} onClose={() => setShowCustomizer(false)}
          />
        </>
      )}

      <Modal isOpen={showForm} onClose={() => { setShowForm(false); setEditTarget(null) }} title={editTarget?'Edit property':'New property'} size="lg">
        <PropertyForm property={editTarget} onSave={handleSave} onClose={() => { setShowForm(false); setEditTarget(null) }} />
      </Modal>
      <ConfirmDialog isOpen={!!deleteTarget} onClose={() => setDeleteTarget(null)} onConfirm={handleDelete} title="Delete property?" message={`"${deleteTarget?.address}" will be permanently deleted.`} />
      {detailId && (
        <>
          <div className="fixed inset-0 z-30 bg-black/10" onClick={() => setDetailId(null)} />
          <PropertyDetail propertyId={detailId} onClose={() => setDetailId(null)}
            onEdit={() => { const p=rows.find(r=>r.id===detailId); if(p){setEditTarget(p);setShowForm(true)} setDetailId(null) }} />
        </>
      )}
      {openMenu && <div className="fixed inset-0 z-0" onClick={() => setOpenMenu(null)} />}
      {showBulkSend && (
        <BulkSendModal
          onClose={() => setShowBulkSend(false)}
          onDone={() => setShowBulkSend(false)}
        />
      )}
    </div>
  )
}
