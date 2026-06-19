import { useState, useEffect, useCallback, useRef } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import {
  Users, UserPlus, MoreHorizontal, Pencil, Trash2, Loader2,
  AlertCircle, ChevronLeft, ChevronRight, Settings2, Download, GitMerge,
} from 'lucide-react'
import { getPeople, bulkDeletePeople, exportPeopleUrl } from '../../api/client'
import { useApp } from '../../context/AppContext'
import TopBar from '../layout/TopBar'
import Button from '../ui/Button'
import Avatar from '../ui/Avatar'
import Modal from '../ui/Modal'
import ConfirmDialog from '../ui/ConfirmDialog'
import EmptyState from '../ui/EmptyState'
import PersonForm from './PersonForm'
import PersonDetail from './PersonDetail'
import DuplicateFinderModal from '../handwrytten/DuplicateFinderModal'
import ColumnCustomizer, {
  buildPanelCols, loadSavedCols, detectPreset, saveColsToStorage,
} from '../ui/ColumnCustomizer'

const PAGE_SIZE   = 75
const STORAGE_KEY = 'people_columns_v1'

const ROLE_LABELS = { owner:'Owner', owner_company:'Owner Co.', broker:'Broker', tenant_contact:'Tenant' }
const ROLE_COLORS = { owner:'bg-blue-50 text-blue-700', owner_company:'bg-violet-50 text-violet-700', broker:'bg-amber-50 text-amber-700', tenant_contact:'bg-slate-100 text-slate-600' }

function fmtDate(iso) {
  if (!iso) return null
  return new Date(String(iso).replace(' ', 'T') + 'Z').toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
}

// ── Column definitions ────────────────────────────────────────────────────────
const COLUMN_DEFS = {
  name: {
    label: 'Name',
    td(p, k) {
      return (
        <td key={k} className="px-4 py-3">
          <div className="flex items-center gap-3">
            <Avatar contact={{ firstName: p.first_name||p.name.split(' ')[0], lastName: p.last_name||p.name.split(' ').slice(1).join(' ') }} size="sm" />
            <div>
              <span className="font-medium text-slate-900">{p.name}</span>
              {p.do_not_contact ? (
                <span className="ml-2 inline-flex items-center gap-0.5 text-xs text-red-600">
                  <AlertCircle className="w-3 h-3" /> DNC
                </span>
              ) : null}
              {p.sub_label && (
                <span className="ml-1.5 text-xs font-medium px-1.5 py-0.5 rounded-full bg-emerald-50 text-emerald-700 capitalize">{p.sub_label}</span>
              )}
            </div>
          </div>
        </td>
      )
    },
  },
  role: {
    label: 'Role',
    td(p, k) {
      return (
        <td key={k} className="px-4 py-3">
          <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${ROLE_COLORS[p.role]||'bg-slate-100 text-slate-600'}`}>
            {ROLE_LABELS[p.role]||p.role}
          </span>
        </td>
      )
    },
  },
  owner_type: {
    label: 'Owner Type',
    td(p, k) {
      return (
        <td key={k} className="px-4 py-3">
          {p.owner_type && p.owner_type !== 'Individual'
            ? <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${p.owner_type==='LLC'?'bg-purple-50 text-purple-700':p.owner_type==='Institution'?'bg-teal-50 text-teal-700':'bg-slate-100 text-slate-600'}`}>{p.owner_type}</span>
            : <span className="text-slate-300">—</span>}
        </td>
      )
    },
  },
  sub_label: {
    label: 'Label',
    td(p, k) {
      return (
        <td key={k} className="px-4 py-3">
          {p.sub_label
            ? <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 capitalize">{p.sub_label}</span>
            : <span className="text-slate-300">—</span>}
        </td>
      )
    },
  },
  company: {
    label: 'Company',
    td(p, k) {
      return <td key={k} className="px-4 py-3 text-slate-600 max-w-[160px] truncate">{p.company_name||<span className="text-slate-300">—</span>}</td>
    },
  },
  phone: {
    label: 'Phone',
    td(p, k) {
      return <td key={k} className="px-4 py-3 text-slate-600">{p.phone||p.mobile||<span className="text-slate-300">—</span>}</td>
    },
  },
  mobile: {
    label: 'Mobile',
    td(p, k) {
      return <td key={k} className="px-4 py-3 text-slate-600">{p.mobile||<span className="text-slate-300">—</span>}</td>
    },
  },
  email: {
    label: 'Email',
    td(p, k) {
      return (
        <td key={k} className="px-4 py-3">
          {p.email
            ? <a href={`mailto:${p.email}`} className="text-blue-600 hover:underline" onClick={e => e.stopPropagation()}>{p.email}</a>
            : <span className="text-slate-300">—</span>}
        </td>
      )
    },
  },
  location: {
    label: 'City / State',
    td(p, k) {
      return <td key={k} className="px-4 py-3 text-slate-600">{[p.city,p.state].filter(Boolean).join(', ')||<span className="text-slate-300">—</span>}</td>
    },
  },
  state: {
    label: 'State',
    td(p, k) {
      return <td key={k} className="px-4 py-3 text-slate-600">{p.state||<span className="text-slate-300">—</span>}</td>
    },
  },
  dnc: {
    label: 'DNC',
    td(p, k) {
      return (
        <td key={k} className="px-4 py-3">
          {p.do_not_contact
            ? <span className="inline-flex items-center gap-1 text-xs font-semibold text-red-700 bg-red-50 px-2 py-0.5 rounded-full"><AlertCircle className="w-3 h-3"/>DNC</span>
            : <span className="text-slate-300">—</span>}
        </td>
      )
    },
  },
  date_added: {
    label: 'Date Added',
    td(p, k) {
      return <td key={k} className="px-4 py-3 text-slate-500 text-xs whitespace-nowrap">{fmtDate(p.created_at) || <span className="text-slate-300">—</span>}</td>
    },
  },
  last_updated: {
    label: 'Last Updated',
    td(p, k) {
      return <td key={k} className="px-4 py-3 text-slate-500 text-xs whitespace-nowrap">{fmtDate(p.updated_at) || <span className="text-slate-300">—</span>}</td>
    },
  },
}

const ALL_COLUMN_KEYS = Object.keys(COLUMN_DEFS)
const DEFAULT_COLS    = ['name','role','owner_type','company','phone','email','location']

const PRESET_VIEWS = [
  { id: 'default',    label: 'Default',      cols: DEFAULT_COLS },
  { id: 'outreach',   label: 'Outreach',     cols: ['name','role','phone','email','dnc','location'] },
  { id: 'owners',     label: 'Owners',       cols: ['name','owner_type','company','location','phone'] },
  { id: 'full',       label: 'Full Details', cols: ['name','role','owner_type','sub_label','company','phone','email','location'] },
  { id: 'timeline',   label: 'Timeline',     cols: ['name','role','location','date_added','last_updated'] },
]

// ── Main component ────────────────────────────────────────────────────────────
export default function PeoplePage() {
  const { addPerson, editPerson, removePerson } = useApp()
  const [searchParams] = useSearchParams()

  const [rows, setRows]         = useState([])
  const [total, setTotal]       = useState(0)
  const [page, setPage]         = useState(0)
  const [search, setSearch]     = useState('')
  const [roleFilter, setRole]   = useState('')
  const [dncFilter, setDnc]     = useState('')
  const [ownerTypeFilter, setOwnerType] = useState('')
  const [dateFilter, setDateFilter] = useState({ addedAfter: '', addedBefore: '', updatedAfter: '', updatedBefore: '' })
  const [sort, setSort] = useState({ col: 'name', dir: 'asc' })
  const [fetching, setFetching] = useState(false)

  // Date filters + sort are read from a ref so every existing reload path picks
  // them up without threading extra args through each caller.
  const extraRef = useRef({ dateFilter, sort })
  extraRef.current = { dateFilter, sort }

  const [showForm, setShowForm]         = useState(false)
  const [editTarget, setEditTarget]     = useState(null)
  const [deleteTarget, setDeleteTarget] = useState(null)
  const [detailId, setDetailId]         = useState(() => {
    const id = new URLSearchParams(window.location.search).get('open')
    return id ? Number(id) : null
  })
  const [openMenu, setOpenMenu]         = useState(null)
  const [dupeFor, setDupeFor]           = useState(null)
  const [showCustomizer, setShowCustomizer] = useState(false)
  const [selected, setSelected]         = useState(() => new Set())
  const [bulkDeleting, setBulkDeleting] = useState(false)
  const [selectingAll, setSelectingAll] = useState(false)

  const [activeCols, setActiveCols]         = useState(() => loadSavedCols(STORAGE_KEY, DEFAULT_COLS, COLUMN_DEFS))
  const [panelCols, setPanelCols]           = useState(() => buildPanelCols(loadSavedCols(STORAGE_KEY, DEFAULT_COLS, COLUMN_DEFS), ALL_COLUMN_KEYS))
  const [activePreset, setActivePreset]     = useState(() => detectPreset(loadSavedCols(STORAGE_KEY, DEFAULT_COLS, COLUMN_DEFS), PRESET_VIEWS))
  const [savedIndicator, setSavedIndicator] = useState(false)

  const searchTimer = useRef(null)

  const load = useCallback(async (s, role, dnc, ownerType, pg) => {
    setFetching(true)
    try {
      const params = { limit: PAGE_SIZE, offset: pg * PAGE_SIZE }
      if (s)          params.search = s
      if (role)       params.role = role
      if (dnc !== '') params.do_not_contact = dnc
      if (ownerType) params.owner_type = ownerType
      const { dateFilter: df, sort: so } = extraRef.current
      for (const key of ['addedAfter', 'addedBefore', 'updatedAfter', 'updatedBefore']) {
        if (df[key]) params[key] = df[key]
      }
      params.sortCol = so.col
      params.sortDir = so.dir
      const res = await getPeople(params)
      setRows(res.rows); setTotal(res.total)
    } finally { setFetching(false) }
  }, [])

  useEffect(() => { load(search, roleFilter, dncFilter, ownerTypeFilter, page) }, [page, roleFilter, dncFilter, ownerTypeFilter]) // eslint-disable-line
  // Reload from page 0 when date filters or sort change
  useEffect(() => { setPage(0); load(search, roleFilter, dncFilter, ownerTypeFilter, 0) }, [dateFilter, sort]) // eslint-disable-line

  const setDate = (key, val) => setDateFilter(d => ({ ...d, [key]: val }))
  const hasDateFilter = Object.values(dateFilter).some(Boolean)

  // Export the current filtered view to CSV (cookie auth → direct download link)
  const handleExport = () => {
    const params = { sortCol: sort.col, sortDir: sort.dir }
    if (search)            params.search = search
    if (roleFilter)        params.role = roleFilter
    if (dncFilter !== '')  params.do_not_contact = dncFilter
    if (ownerTypeFilter)   params.owner_type = ownerTypeFilter
    for (const key of ['addedAfter', 'addedBefore', 'updatedAfter', 'updatedBefore']) {
      if (dateFilter[key]) params[key] = dateFilter[key]
    }
    const a = document.createElement('a')
    a.href = exportPeopleUrl(params)
    a.click()
  }

  const handleSearch = (val) => {
    setSearch(val); clearTimeout(searchTimer.current)
    searchTimer.current = setTimeout(() => { setPage(0); load(val, roleFilter, dncFilter, ownerTypeFilter, 0) }, 300)
  }
  const handleRoleFilter      = (val) => { setRole(val);      setPage(0); load(search, val, dncFilter, ownerTypeFilter, 0) }
  const handleDncFilter       = (val) => { setDnc(val);       setPage(0); load(search, roleFilter, val, ownerTypeFilter, 0) }
  const handleOwnerTypeFilter = (val) => { setOwnerType(val); setPage(0); load(search, roleFilter, dncFilter, val, 0) }

  const handleSave = async (data) => {
    if (editTarget) await editPerson(editTarget.id, data); else await addPerson(data)
    load(search, roleFilter, dncFilter, ownerTypeFilter, page)
  }
  const handleDelete = async () => {
    await removePerson(deleteTarget.id); load(search, roleFilter, dncFilter, ownerTypeFilter, page)
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

  const selectAllMatching = async () => {
    setSelectingAll(true)
    try {
      const params = { limit: 100000, offset: 0 }
      if (search)          params.search = search
      if (roleFilter)      params.role = roleFilter
      if (dncFilter !== '') params.do_not_contact = dncFilter
      if (ownerTypeFilter) params.owner_type = ownerTypeFilter
      const { dateFilter: df } = extraRef.current
      for (const key of ['addedAfter', 'addedBefore', 'updatedAfter', 'updatedBefore']) {
        if (df[key]) params[key] = df[key]
      }
      const res = await getPeople(params)
      setSelected(new Set(res.rows.map(r => r.id)))
    } finally { setSelectingAll(false) }
  }

  const handleBulkDelete = async () => {
    const ids = [...selected]
    if (!ids.length) return
    if (!window.confirm(`Permanently delete ${ids.length} ${ids.length === 1 ? 'person' : 'people'}? This cannot be undone.`)) return
    setBulkDeleting(true)
    try {
      await bulkDeletePeople(ids)
      clearSelection()
      const newTotal = total - ids.length
      const lastPage = Math.max(0, Math.ceil(newTotal / PAGE_SIZE) - 1)
      const goPage = Math.min(page, lastPage)
      setPage(goPage)
      await load(search, roleFilter, dncFilter, ownerTypeFilter, goPage)
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
        title={`People${total > 0 ? ` (${total.toLocaleString()})` : ''}`}
        onSearch={handleSearch}
        searchPlaceholder="Search name, email, phone, city…"
        actions={
          <div className="flex items-center gap-2">
            <select value={roleFilter} onChange={e => handleRoleFilter(e.target.value)}
              className="text-sm border border-slate-200 rounded-lg px-3 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500">
              <option value="">All roles</option>
              <option value="owner">Owner</option>
              <option value="owner_company">Owner Company</option>
              <option value="broker">Broker</option>
              <option value="tenant_contact">Tenant Contact</option>
            </select>
            <select value={ownerTypeFilter} onChange={e => handleOwnerTypeFilter(e.target.value)}
              className="text-sm border border-slate-200 rounded-lg px-3 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500">
              <option value="">All types</option>
              <option value="Individual">Individual</option>
              <option value="LLC">LLC</option>
              <option value="Institution">Institution</option>
            </select>
            <select value={dncFilter} onChange={e => handleDncFilter(e.target.value)}
              className="text-sm border border-slate-200 rounded-lg px-3 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500">
              <option value="">All</option>
              <option value="0">Contactable</option>
              <option value="1">Do Not Contact</option>
            </select>
            <button
              onClick={handleExport}
              disabled={total === 0}
              className="flex items-center gap-1.5 px-3 py-2 text-sm font-medium border rounded-lg transition-colors text-slate-600 border-slate-200 hover:bg-slate-50 disabled:opacity-50"
              title="Export the current filtered list to CSV"
            >
              <Download className="w-4 h-4" />
              Export CSV
            </button>
            <button
              onClick={() => setShowCustomizer(c => !c)}
              className={`flex items-center gap-1.5 px-3 py-2 text-sm font-medium border rounded-lg transition-colors ${showCustomizer ? 'bg-blue-50 text-blue-700 border-blue-200' : 'text-slate-600 border-slate-200 hover:bg-slate-50'}`}
            >
              <Settings2 className="w-4 h-4" />
              {activePresetLabel ?? 'Columns'}
            </button>
            <Button onClick={() => { setEditTarget(null); setShowForm(true) }}>
              <UserPlus className="w-4 h-4" /> New person
            </Button>
          </div>
        }
      />

      <div className="flex-1 overflow-auto p-6 scrollbar-thin">
        {/* Date filters + sort */}
        <div className="flex flex-wrap items-end gap-3 mb-4">
          <div className="flex flex-col gap-1">
            <label className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Date Added</label>
            <div className="flex items-center gap-1.5">
              <input type="date" value={dateFilter.addedAfter} onChange={e => setDate('addedAfter', e.target.value)}
                className="px-2 py-1.5 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-400" />
              <span className="text-slate-400 text-sm">–</span>
              <input type="date" value={dateFilter.addedBefore} onChange={e => setDate('addedBefore', e.target.value)}
                className="px-2 py-1.5 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-400" />
            </div>
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Last Updated</label>
            <div className="flex items-center gap-1.5">
              <input type="date" value={dateFilter.updatedAfter} onChange={e => setDate('updatedAfter', e.target.value)}
                className="px-2 py-1.5 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-400" />
              <span className="text-slate-400 text-sm">–</span>
              <input type="date" value={dateFilter.updatedBefore} onChange={e => setDate('updatedBefore', e.target.value)}
                className="px-2 py-1.5 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-400" />
            </div>
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Sort by</label>
            <select
              value={`${sort.col}:${sort.dir}`}
              onChange={e => { const [col, dir] = e.target.value.split(':'); setSort({ col, dir }) }}
              className="px-2 py-1.5 text-sm border border-slate-200 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-blue-400"
            >
              <option value="name:asc">Name (A–Z)</option>
              <option value="name:desc">Name (Z–A)</option>
              <option value="date_added:desc">Date Added (newest)</option>
              <option value="date_added:asc">Date Added (oldest)</option>
              <option value="last_updated:desc">Last Updated (newest)</option>
              <option value="last_updated:asc">Last Updated (oldest)</option>
            </select>
          </div>
          {hasDateFilter && (
            <button
              onClick={() => setDateFilter({ addedAfter: '', addedBefore: '', updatedAfter: '', updatedBefore: '' })}
              className="px-3 py-1.5 text-sm text-slate-500 hover:text-slate-800 border border-slate-200 rounded-lg hover:bg-slate-50"
            >
              Clear dates
            </button>
          )}
        </div>

        {fetching && rows.length === 0 ? (
          <div className="flex items-center justify-center h-48"><Loader2 className="w-6 h-6 text-slate-400 animate-spin" /></div>
        ) : rows.length === 0 ? (
          <EmptyState icon={Users} title="No people found" description="Import your Salesforce data or add people manually." action="New person" onAction={() => setShowForm(true)} />
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
                    <tr key={p.id}
                      className={`border-b border-slate-100 last:border-0 hover:bg-blue-50/40 transition-colors cursor-pointer ${selected.has(p.id) ? 'bg-blue-50/60' : i%2===0?'bg-white':'bg-slate-50/40'}`}
                      onClick={() => { setDetailId(p.id); setShowCustomizer(false) }}
                    >
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
                              <button className="flex items-center gap-2 w-full px-3 py-2 text-violet-700 hover:bg-violet-50" onClick={() => { setDupeFor({ contact_id: p.id, name: p.name }); setOpenMenu(null) }}><GitMerge className="w-3.5 h-3.5"/> Find duplicates</button>
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

      <Modal isOpen={showForm} onClose={() => { setShowForm(false); setEditTarget(null) }} title={editTarget?'Edit person':'New person'}>
        <PersonForm person={editTarget} onSave={handleSave} onClose={() => { setShowForm(false); setEditTarget(null) }} />
      </Modal>
      <ConfirmDialog isOpen={!!deleteTarget} onClose={() => setDeleteTarget(null)} onConfirm={handleDelete} title="Delete person?" message={`"${deleteTarget?.name}" will be permanently deleted.`} />
      {detailId && (
        <>
          <div className="fixed inset-0 z-30" onClick={() => setDetailId(null)} />
          <PersonDetail personId={detailId} onClose={() => setDetailId(null)}
            onEdit={() => { const p=rows.find(r=>r.id===detailId); if(p){setEditTarget(p);setShowForm(true)} setDetailId(null) }} />
        </>
      )}
      {openMenu && <div className="fixed inset-0 z-0" onClick={() => setOpenMenu(null)} />}

      {dupeFor && (
        <DuplicateFinderModal
          person={dupeFor}
          onClose={() => setDupeFor(null)}
          onMerged={() => { setDupeFor(null); load(search, roleFilter, dncFilter, ownerTypeFilter, page) }}
        />
      )}
    </div>
  )
}
