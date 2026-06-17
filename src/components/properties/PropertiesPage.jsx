import { useState, useEffect, useCallback, useRef } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import {
  Building2, Plus, MoreHorizontal, Pencil, Trash2, Loader2,
  ChevronLeft, ChevronRight, ChevronUp, ChevronDown, ChevronsUpDown,
  AlertCircle, Settings2, Upload, Mail, ShieldAlert, Check,
} from 'lucide-react'
import { getProperties, bulkDeleteProperties } from '../../api/client'
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
const STORAGE_KEY = 'properties_columns_v2'

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
  owner_address: {
    label: 'Owner Address',
    td(p, k) {
      const line1 = p.owner_address
      const line2 = [p.owner_city, p.owner_state, p.owner_zip].filter(Boolean).join(', ')
      return (
        <td key={k} className="px-4 py-3 max-w-[200px]">
          {line1
            ? <>
                <p className="text-slate-700 truncate text-sm">{line1}</p>
                {line2 && <p className="text-xs text-slate-400 truncate">{line2}</p>}
              </>
            : <span className="text-slate-300">—</span>
          }
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
  date_added: {
    label: 'Date Added',
    td(p, k) { return <td key={k} className="px-4 py-3 text-xs text-slate-500 whitespace-nowrap">{fmtDate(p.created_at?.slice(0,10))||<span className="text-slate-300">—</span>}</td> },
  },
  last_updated: {
    label: 'Last Updated',
    td(p, k) { return <td key={k} className="px-4 py-3 text-xs text-slate-500 whitespace-nowrap">{fmtDate(p.updated_at?.slice(0,10))||<span className="text-slate-300">—</span>}</td> },
  },
}

// ── Multi-Select Dropdown ─────────────────────────────────────────────────────
function MultiSelectDropdown({ label, options, selected, onChange, placeholder = 'Search…' }) {
  const [open, setOpen]     = useState(false)
  const [query, setQuery]   = useState('')
  const ref = useRef(null)

  useEffect(() => {
    function onClickOutside(e) { if (ref.current && !ref.current.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', onClickOutside)
    return () => document.removeEventListener('mousedown', onClickOutside)
  }, [])

  const filtered = options.filter(o => o.toLowerCase().includes(query.toLowerCase()))
  const allChecked = selected.length === 0

  const toggle = (val) => {
    if (selected.includes(val)) onChange(selected.filter(v => v !== val))
    else onChange([...selected, val])
  }

  const btnLabel = selected.length === 0
    ? `All ${label}`
    : selected.length === 1
      ? selected[0]
      : `${selected.length} ${label}`

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen(o => !o)}
        className={`flex items-center gap-1.5 text-sm border rounded-lg px-3 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 transition-colors ${
          selected.length > 0 ? 'border-blue-400 text-blue-700 bg-blue-50' : 'border-slate-200 text-slate-700'
        }`}
      >
        <span>{btnLabel}</span>
        <ChevronDown className="w-3.5 h-3.5 shrink-0 text-slate-400" />
      </button>
      {open && (
        <div className="absolute right-0 top-[calc(100%+4px)] z-50 bg-white border border-slate-200 rounded-xl shadow-lg w-52 py-2">
          {options.length > 8 && (
            <div className="px-2 pb-1.5">
              <input
                autoFocus
                value={query}
                onChange={e => setQuery(e.target.value)}
                placeholder={placeholder}
                className="w-full text-xs border border-slate-200 rounded-lg px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-400"
              />
            </div>
          )}
          <div className="max-h-60 overflow-y-auto">
            <button
              className={`flex items-center gap-2 w-full px-3 py-1.5 text-sm hover:bg-slate-50 ${allChecked ? 'text-blue-600 font-medium' : 'text-slate-600'}`}
              onClick={() => { onChange([]); setQuery('') }}
            >
              {allChecked && <Check className="w-3.5 h-3.5 shrink-0" />}
              {!allChecked && <span className="w-3.5 h-3.5 shrink-0" />}
              All {label}
            </button>
            {filtered.map(opt => {
              const checked = selected.includes(opt)
              return (
                <button key={opt}
                  className={`flex items-center gap-2 w-full px-3 py-1.5 text-sm hover:bg-slate-50 ${checked ? 'text-blue-600' : 'text-slate-700'}`}
                  onClick={() => toggle(opt)}
                >
                  {checked ? <Check className="w-3.5 h-3.5 shrink-0 text-blue-500" /> : <span className="w-3.5 h-3.5 shrink-0" />}
                  <span className="truncate">{opt}</span>
                </button>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}

const ALL_COLUMN_KEYS = Object.keys(COLUMN_DEFS)
const DEFAULT_COLS    = ['address','tenant','owner','owner_address','lease_type','cap_rate','list_price','lease_end']

const PRESET_VIEWS = [
  { id: 'default',     label: 'Default',     cols: DEFAULT_COLS },
  { id: 'prospecting', label: 'Prospecting', cols: ['address','tenant','state','owner','owner_address','lease_end','list_price'] },
  { id: 'financials',  label: 'Financials',  cols: ['address','tenant','cap_rate','noi','annual_rent','list_price'] },
  { id: 'research',    label: 'Research',    cols: ['address','tenant','property_type','year_built','building_size','state'] },
  { id: 'timeline',    label: 'Timeline',    cols: ['address','tenant','owner','date_added','last_updated'] },
]

// ── Main component ────────────────────────────────────────────────────────────
export default function PropertiesPage() {
  const { tenantBrands, propertyStates, addProperty, editProperty, removeProperty } = useApp()
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const [showBulkSend, setShowBulkSend] = useState(false)

  const [rows, setRows]                 = useState([])
  const [total, setTotal]               = useState(0)
  const [page, setPage]                 = useState(0)
  const [search, setSearch]             = useState('')
  const [tenantFilters, setTenantFilters] = useState([])
  const [stateFilters, setStateFilters]   = useState([])
  const [needsReviewFilter, setNeedsReviewFilter] = useState(false)
  const [fetching, setFetching]         = useState(false)
  const [showForm, setShowForm]         = useState(false)
  const [editTarget, setEditTarget]     = useState(null)
  const [deleteTarget, setDeleteTarget] = useState(null)
  const [detailId, setDetailId]         = useState(() => {
    const id = new URLSearchParams(window.location.search).get('open')
    return id ? Number(id) : null
  })
  const [openMenu, setOpenMenu]         = useState(null)
  const [showCustomizer, setShowCustomizer] = useState(false)
  const [selected, setSelected]         = useState(() => new Set())
  const [bulkDeleting, setBulkDeleting] = useState(false)
  const [selectingAll, setSelectingAll] = useState(false)

  const [activeCols, setActiveCols]         = useState(() => loadSavedCols(STORAGE_KEY, DEFAULT_COLS, COLUMN_DEFS))
  const [panelCols, setPanelCols]           = useState(() => buildPanelCols(loadSavedCols(STORAGE_KEY, DEFAULT_COLS, COLUMN_DEFS), ALL_COLUMN_KEYS))
  const [activePreset, setActivePreset]     = useState(() => detectPreset(loadSavedCols(STORAGE_KEY, DEFAULT_COLS, COLUMN_DEFS), PRESET_VIEWS))
  const [savedIndicator, setSavedIndicator] = useState(false)
  const [sortCol, setSortCol]               = useState('address')
  const [sortDir, setSortDir]               = useState('asc')

  const searchTimer = useRef(null)

  const load = useCallback(async (s, tenants, states, needsReview, pg, col = 'address', dir = 'asc') => {
    setFetching(true)
    try {
      const params = { portfolio: '0', limit: PAGE_SIZE, offset: pg * PAGE_SIZE, sortCol: col, sortDir: dir }
      if (s)                    params.search = s
      if (tenants.length)       params.tenants = tenants.join(',')
      if (states.length)        params.states  = states.join(',')
      if (needsReview)          params.needsReview = '1'
      const res = await getProperties(params)
      setRows(res.rows); setTotal(res.total)
    } finally { setFetching(false) }
  }, [])

  useEffect(() => { load(search, tenantFilters, stateFilters, needsReviewFilter, page, sortCol, sortDir) }, [page, tenantFilters, stateFilters, needsReviewFilter]) // eslint-disable-line

  const handleSort = (key) => {
    const newDir = sortCol === key && sortDir === 'asc' ? 'desc' : 'asc'
    const newCol = key
    setSortCol(newCol); setSortDir(newDir); setPage(0)
    load(search, tenantFilters, stateFilters, needsReviewFilter, 0, newCol, newDir)
  }

  const handleSearch = (val) => {
    setSearch(val); clearTimeout(searchTimer.current)
    searchTimer.current = setTimeout(() => { setPage(0); load(val, tenantFilters, stateFilters, needsReviewFilter, 0, sortCol, sortDir) }, 300)
  }
  const handleSave = async (data) => {
    const marketData = { ...data, is_portfolio: 0 }
    if (editTarget) await editProperty(editTarget.id, marketData); else await addProperty(marketData)
    load(search, tenantFilters, stateFilters, needsReviewFilter, page, sortCol, sortDir)
  }
  const handleDelete = async () => {
    await removeProperty(deleteTarget.id); load(search, tenantFilters, stateFilters, needsReviewFilter, page, sortCol, sortDir)
  }

  // ── Bulk selection / delete ──────────────────────────────────────────────────
  const toggleRow = (id) => setSelected(prev => {
    const next = new Set(prev)
    next.has(id) ? next.delete(id) : next.add(id)
    return next
  })
  const allOnPageSelected = rows.length > 0 && rows.every(r => selected.has(r.id))
  const togglePage = () => setSelected(prev => {
    const next = new Set(prev)
    if (allOnPageSelected) rows.forEach(r => next.delete(r.id))
    else rows.forEach(r => next.add(r.id))
    return next
  })
  const clearSelection = () => setSelected(new Set())

  // Select every property matching the current filters (across all pages)
  const selectAllMatching = async () => {
    setSelectingAll(true)
    try {
      const params = { portfolio: '0', limit: 100000, offset: 0 }
      if (search)              params.search = search
      if (tenantFilters.length) params.tenants = tenantFilters.join(',')
      if (stateFilters.length)  params.states  = stateFilters.join(',')
      if (needsReviewFilter)    params.needsReview = '1'
      const res = await getProperties(params)
      setSelected(new Set(res.rows.map(r => r.id)))
    } finally { setSelectingAll(false) }
  }

  const handleBulkDelete = async () => {
    const ids = [...selected]
    if (!ids.length) return
    if (!window.confirm(`Permanently delete ${ids.length} propert${ids.length === 1 ? 'y' : 'ies'}? This cannot be undone.`)) return
    setBulkDeleting(true)
    try {
      await bulkDeleteProperties(ids)
      clearSelection()
      const newTotal = total - ids.length
      const lastPage = Math.max(0, Math.ceil(newTotal / PAGE_SIZE) - 1)
      const goPage = Math.min(page, lastPage)
      setPage(goPage)
      await load(search, tenantFilters, stateFilters, needsReviewFilter, goPage, sortCol, sortDir)
    } finally {
      setBulkDeleting(false)
    }
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
            <MultiSelectDropdown
              label="tenants"
              options={tenantBrands.map(t => t.name)}
              selected={tenantFilters}
              onChange={vals => { setTenantFilters(vals); setPage(0) }}
              placeholder="Search tenants…"
            />
            <MultiSelectDropdown
              label="states"
              options={propertyStates}
              selected={stateFilters}
              onChange={vals => { setStateFilters(vals); setPage(0) }}
              placeholder="Search states…"
            />
            <button
              onClick={() => { setNeedsReviewFilter(v => !v); setPage(0) }}
              className={`flex items-center gap-1.5 text-sm border rounded-lg px-3 py-2 transition-colors ${
                needsReviewFilter
                  ? 'bg-amber-50 border-amber-400 text-amber-700'
                  : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'
              }`}
              title="Show only properties flagged for ownership review"
            >
              <ShieldAlert className="w-4 h-4" />
              Needs Review
            </button>
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
            {selected.size > 0 && (
              <div className="flex items-center justify-between mb-3 px-4 py-2.5 bg-blue-50 border border-blue-200 rounded-xl">
                <div className="flex items-center gap-3 text-sm">
                  <span className="font-semibold text-blue-800">{selected.size} selected</span>
                  <button onClick={clearSelection} className="text-blue-600 hover:text-blue-800 text-xs">Clear</button>
                  {selected.size < total && (
                    <button onClick={selectAllMatching} disabled={selectingAll}
                      className="text-blue-600 hover:text-blue-800 text-xs underline disabled:opacity-50">
                      {selectingAll ? 'Selecting…' : `Select all ${total.toLocaleString()} matching`}
                    </button>
                  )}
                </div>
                <button
                  onClick={handleBulkDelete}
                  disabled={bulkDeleting}
                  className="flex items-center gap-1.5 text-sm font-medium text-white bg-red-600 px-3 py-1.5 rounded-lg hover:bg-red-700 transition-colors disabled:opacity-50"
                >
                  {bulkDeleting
                    ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Deleting…</>
                    : <><Trash2 className="w-3.5 h-3.5" /> Delete {selected.size}</>}
                </button>
              </div>
            )}
            <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 border-b border-slate-200">
                  <tr>
                    <th className="px-4 py-3 w-10">
                      <input type="checkbox" checked={allOnPageSelected} onChange={togglePage}
                        className="rounded border-slate-300 cursor-pointer" title="Select all on this page" />
                    </th>
                    {activeCols.map(key => {
                      const isActive = sortCol === key
                      return (
                        <th key={key}
                          onClick={() => handleSort(key)}
                          className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wide whitespace-nowrap cursor-pointer select-none hover:bg-slate-100 transition-colors group"
                        >
                          <div className="flex items-center gap-1">
                            <span className={isActive ? 'text-blue-600' : ''}>{COLUMN_DEFS[key].label}</span>
                            {isActive
                              ? sortDir === 'asc'
                                ? <ChevronUp className="w-3.5 h-3.5 text-blue-500 shrink-0" />
                                : <ChevronDown className="w-3.5 h-3.5 text-blue-500 shrink-0" />
                              : <ChevronsUpDown className="w-3.5 h-3.5 text-slate-300 group-hover:text-slate-400 shrink-0" />
                            }
                          </div>
                        </th>
                      )
                    })}
                    <th className="w-12" />
                  </tr>
                </thead>
                <tbody>
                  {rows.map((p, i) => (
                    <tr key={p.id} onClick={() => { setDetailId(p.id); setShowCustomizer(false) }}
                      className={`border-b border-slate-100 last:border-0 hover:bg-blue-50/40 transition-colors cursor-pointer ${selected.has(p.id) ? 'bg-blue-50/60' : i%2===0?'bg-white':'bg-slate-50/40'}`}>
                      <td className="px-4 py-3" onClick={e => e.stopPropagation()}>
                        <input type="checkbox" checked={selected.has(p.id)} onChange={() => toggleRow(p.id)}
                          className="rounded border-slate-300 cursor-pointer" />
                      </td>
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
