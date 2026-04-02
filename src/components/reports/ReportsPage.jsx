import { useState, useEffect, useCallback, useRef } from 'react'
import { Download, Save, Trash2, BookmarkCheck, ChevronUp, ChevronDown, SlidersHorizontal, X } from 'lucide-react'
import MultiSelect from '../ui/MultiSelect'
import {
  getFilterOptions, getReports, exportReportUrl,
  getSavedSearches, createSavedSearch, deleteSavedSearch,
} from '../../api/client'

const DEFAULT_FILTERS = {
  tenants: [],
  states: [],
  year_built_min: '',
  year_built_max: '',
  year_purchased_min: '',
  year_purchased_max: '',
  owner_type: '',   // '' | 'person' | 'company'
  dnc: '',          // '' | 'exclude' | 'only'
  has_email: '',    // '' | '1'
  search: '',
}

const PAGE_SIZE = 75

const COL_DEFS = [
  { key: 'tenant_brand',   label: 'Tenant',        sortable: true },
  { key: 'address',        label: 'Address',        sortable: true },
  { key: 'city',           label: 'City',           sortable: false },
  { key: 'state',          label: 'State',          sortable: true },
  { key: 'year_built',     label: 'Yr Built',       sortable: true },
  { key: 'year_purchased', label: 'Yr Purchased',   sortable: true },
  { key: 'lease_type',     label: 'Lease',          sortable: true },
  { key: 'lease_end',      label: 'Lease End',      sortable: true },
  { key: 'cap_rate',       label: 'Cap %',          sortable: true },
  { key: 'noi',            label: 'NOI',            sortable: true },
  { key: 'list_price',     label: 'List Price',     sortable: true },
  { key: 'annual_rent',    label: 'Ann. Rent',      sortable: true },
  { key: 'owner_name',     label: 'Owner',          sortable: true },
]

function filtersToParams(f) {
  const p = {}
  if (f.tenants.length)        p.tenants = f.tenants.join(',')
  if (f.states.length)         p.states  = f.states.join(',')
  if (f.year_built_min)        p.year_built_min = f.year_built_min
  if (f.year_built_max)        p.year_built_max = f.year_built_max
  if (f.year_purchased_min)    p.year_purchased_min = f.year_purchased_min
  if (f.year_purchased_max)    p.year_purchased_max = f.year_purchased_max
  if (f.owner_type)            p.owner_type = f.owner_type
  if (f.dnc)                   p.dnc = f.dnc
  if (f.has_email === '1')     p.has_email = '1'
  if (f.search)                p.search = f.search
  return p
}

function fmt(val, key) {
  if (val == null || val === '') return <span className="text-slate-300">—</span>
  if (key === 'cap_rate') return `${Number(val).toFixed(2)}%`
  if (key === 'noi' || key === 'list_price' || key === 'annual_rent') {
    return `$${Number(val).toLocaleString()}`
  }
  return val
}

export default function ReportsPage() {
  const [filterOptions, setFilterOptions] = useState({ tenants: [], states: [], yearBuiltRange: {}, yearPurchasedRange: {} })
  const [filters, setFilters]     = useState(DEFAULT_FILTERS)
  const [sort, setSort]           = useState({ col: 'state', dir: 'asc' })
  const [page, setPage]           = useState(0)

  const [rows, setRows]           = useState([])
  const [total, setTotal]         = useState(0)
  const [loading, setLoading]     = useState(false)

  const [savedSearches, setSavedSearches] = useState([])
  const [saveOpen, setSaveOpen]   = useState(false)
  const [saveName, setSaveName]   = useState('')
  const [exporting, setExporting] = useState(false)

  const searchRef = useRef(null)

  // Load filter options + saved searches once
  useEffect(() => {
    getFilterOptions().then(setFilterOptions).catch(console.error)
    getSavedSearches().then(setSavedSearches).catch(console.error)
  }, [])

  // Load report rows whenever filters/sort/page change
  const loadRows = useCallback(async () => {
    setLoading(true)
    try {
      const params = {
        ...filtersToParams(filters),
        sort: sort.col,
        dir: sort.dir,
        limit: PAGE_SIZE,
        offset: page * PAGE_SIZE,
      }
      const data = await getReports(params)
      setRows(data.rows)
      setTotal(data.total)
    } catch (e) {
      console.error(e)
    } finally {
      setLoading(false)
    }
  }, [filters, sort, page])

  useEffect(() => { loadRows() }, [loadRows])

  // Reset page when filters/sort change
  useEffect(() => { setPage(0) }, [filters, sort])

  function setFilter(key, val) {
    setFilters(f => ({ ...f, [key]: val }))
  }

  function toggleSort(col) {
    setSort(s => s.col === col
      ? { col, dir: s.dir === 'asc' ? 'desc' : 'asc' }
      : { col, dir: 'asc' }
    )
  }

  function clearFilters() {
    setFilters(DEFAULT_FILTERS)
    setSort({ col: 'state', dir: 'asc' })
    setPage(0)
  }

  const hasFilters = Object.entries(filters).some(([k, v]) =>
    Array.isArray(v) ? v.length > 0 : v !== ''
  )

  // Export CSV
  async function handleExport() {
    setExporting(true)
    try {
      const params = { ...filtersToParams(filters), sort: sort.col, dir: sort.dir }
      const url = exportReportUrl(params)
      const a = document.createElement('a')
      a.href = url
      a.click()
    } finally {
      setExporting(false)
    }
  }

  // Save search
  async function handleSave() {
    if (!saveName.trim()) return
    const saved = await createSavedSearch({ name: saveName.trim(), filters })
    setSavedSearches(s => [...s, saved])
    setSaveName('')
    setSaveOpen(false)
  }

  async function handleDeleteSaved(id) {
    await deleteSavedSearch(id)
    setSavedSearches(s => s.filter(x => x.id !== id))
  }

  function applySearch(s) {
    const parsed = typeof s.filters === 'string' ? JSON.parse(s.filters) : s.filters
    setFilters({ ...DEFAULT_FILTERS, ...parsed })
    setPage(0)
  }

  const totalPages = Math.ceil(total / PAGE_SIZE)

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 bg-white shrink-0">
        <div>
          <h1 className="text-xl font-bold text-slate-900">Reports</h1>
          {total > 0 && (
            <p className="text-sm text-slate-500 mt-0.5">
              {total.toLocaleString()} properties
            </p>
          )}
        </div>
        <div className="flex items-center gap-2">
          {hasFilters && (
            <button onClick={clearFilters} className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-slate-500 hover:text-slate-800 border border-slate-200 rounded-lg hover:bg-slate-50">
              <X className="w-3.5 h-3.5" />
              Clear filters
            </button>
          )}
          <button
            onClick={() => setSaveOpen(o => !o)}
            className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-slate-700 border border-slate-200 rounded-lg hover:bg-slate-50"
          >
            <Save className="w-4 h-4" />
            Save search
          </button>
          <button
            onClick={handleExport}
            disabled={exporting || total === 0}
            className="flex items-center gap-1.5 px-4 py-1.5 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg disabled:opacity-50"
          >
            <Download className="w-4 h-4" />
            {exporting ? 'Exporting…' : 'Export CSV'}
          </button>
        </div>
      </div>

      {/* Save search popover */}
      {saveOpen && (
        <div className="mx-6 mt-3 p-4 bg-amber-50 border border-amber-200 rounded-xl flex items-center gap-3 shrink-0">
          <BookmarkCheck className="w-4 h-4 text-amber-600 shrink-0" />
          <span className="text-sm font-medium text-amber-800">Save current filters as:</span>
          <input
            autoFocus
            value={saveName}
            onChange={e => setSaveName(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') handleSave(); if (e.key === 'Escape') setSaveOpen(false) }}
            placeholder="Search name…"
            className="flex-1 px-3 py-1.5 text-sm border border-amber-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-400 bg-white"
          />
          <button onClick={handleSave} className="px-3 py-1.5 text-sm font-medium text-white bg-amber-500 hover:bg-amber-600 rounded-lg">Save</button>
          <button onClick={() => setSaveOpen(false)} className="text-amber-600 hover:text-amber-800"><X className="w-4 h-4" /></button>
        </div>
      )}

      {/* Saved searches chips */}
      {savedSearches.length > 0 && (
        <div className="flex items-center gap-2 px-6 py-2 flex-wrap shrink-0 border-b border-slate-100 bg-slate-50">
          <span className="text-xs font-semibold text-slate-400 uppercase tracking-wide mr-1">Saved:</span>
          {savedSearches.map(s => (
            <div key={s.id} className="flex items-center gap-1 pl-2.5 pr-1 py-1 bg-white border border-slate-200 rounded-full text-xs font-medium text-slate-700 hover:border-blue-300 group">
              <button onClick={() => applySearch(s)} className="hover:text-blue-600">{s.name}</button>
              <button onClick={() => handleDeleteSaved(s.id)} className="w-4 h-4 rounded-full flex items-center justify-center hover:bg-red-100 hover:text-red-600 opacity-0 group-hover:opacity-100 transition-opacity ml-0.5">
                <X className="w-2.5 h-2.5" />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Filter bar */}
      <div className="px-6 py-3 border-b border-slate-100 bg-white shrink-0">
        <div className="flex flex-wrap items-end gap-3">
          <MultiSelect
            label="Tenant Brand"
            options={filterOptions.tenants}
            selected={filters.tenants}
            onChange={v => setFilter('tenants', v)}
          />
          <MultiSelect
            label="State"
            options={filterOptions.states}
            selected={filters.states}
            onChange={v => setFilter('states', v)}
          />

          {/* Year Built */}
          <div className="flex flex-col gap-1">
            <label className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Year Built</label>
            <div className="flex items-center gap-1.5">
              <input
                type="number"
                placeholder={filterOptions.yearBuiltRange?.min || '1950'}
                value={filters.year_built_min}
                onChange={e => setFilter('year_built_min', e.target.value)}
                className="w-20 px-2 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-400"
              />
              <span className="text-slate-400 text-sm">–</span>
              <input
                type="number"
                placeholder={filterOptions.yearBuiltRange?.max || '2024'}
                value={filters.year_built_max}
                onChange={e => setFilter('year_built_max', e.target.value)}
                className="w-20 px-2 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-400"
              />
            </div>
          </div>

          {/* Year Purchased */}
          <div className="flex flex-col gap-1">
            <label className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Year Purchased</label>
            <div className="flex items-center gap-1.5">
              <input
                type="number"
                placeholder={filterOptions.yearPurchasedRange?.min || '1990'}
                value={filters.year_purchased_min}
                onChange={e => setFilter('year_purchased_min', e.target.value)}
                className="w-20 px-2 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-400"
              />
              <span className="text-slate-400 text-sm">–</span>
              <input
                type="number"
                placeholder={filterOptions.yearPurchasedRange?.max || '2024'}
                value={filters.year_purchased_max}
                onChange={e => setFilter('year_purchased_max', e.target.value)}
                className="w-20 px-2 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-400"
              />
            </div>
          </div>

          {/* Owner Type */}
          <div className="flex flex-col gap-1">
            <label className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Owner Type</label>
            <div className="flex items-center gap-1 h-[38px]">
              {[['', 'All'], ['person', 'Individual'], ['company', 'Business']].map(([val, lbl]) => (
                <button
                  key={val}
                  onClick={() => setFilter('owner_type', val)}
                  className={`px-2.5 py-1.5 text-xs rounded-lg border font-medium transition-colors ${
                    filters.owner_type === val
                      ? 'bg-blue-600 text-white border-blue-600'
                      : 'bg-white text-slate-600 border-slate-200 hover:border-slate-300'
                  }`}
                >
                  {lbl}
                </button>
              ))}
            </div>
          </div>

          {/* DNC */}
          <div className="flex flex-col gap-1">
            <label className="text-xs font-semibold text-slate-500 uppercase tracking-wide">DNC</label>
            <div className="flex items-center gap-1 h-[38px]">
              {[['', 'All'], ['exclude', 'Exclude'], ['only', 'Only']].map(([val, lbl]) => (
                <button
                  key={val}
                  onClick={() => setFilter('dnc', val)}
                  className={`px-2.5 py-1.5 text-xs rounded-lg border font-medium transition-colors ${
                    filters.dnc === val
                      ? 'bg-blue-600 text-white border-blue-600'
                      : 'bg-white text-slate-600 border-slate-200 hover:border-slate-300'
                  }`}
                >
                  {lbl}
                </button>
              ))}
            </div>
          </div>

          {/* Has Email */}
          <div className="flex flex-col gap-1">
            <label className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Email</label>
            <div className="flex items-center h-[38px]">
              <button
                onClick={() => setFilter('has_email', filters.has_email === '1' ? '' : '1')}
                className={`px-2.5 py-1.5 text-xs rounded-lg border font-medium transition-colors ${
                  filters.has_email === '1'
                    ? 'bg-blue-600 text-white border-blue-600'
                    : 'bg-white text-slate-600 border-slate-200 hover:border-slate-300'
                }`}
              >
                Has email
              </button>
            </div>
          </div>

          {/* Search */}
          <div className="flex flex-col gap-1 flex-1 min-w-[180px]">
            <label className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Search</label>
            <input
              ref={searchRef}
              value={filters.search}
              onChange={e => setFilter('search', e.target.value)}
              placeholder="Address, city, or owner…"
              className="px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-400"
            />
          </div>
        </div>
      </div>

      {/* Table */}
      <div className="flex-1 overflow-auto min-h-0">
        <table className="w-full text-sm border-collapse">
          <thead className="sticky top-0 bg-slate-50 z-10">
            <tr>
              {COL_DEFS.map(col => (
                <th
                  key={col.key}
                  onClick={col.sortable ? () => toggleSort(col.key) : undefined}
                  className={`text-left px-3 py-2.5 text-xs font-semibold text-slate-500 uppercase tracking-wide border-b border-slate-200 whitespace-nowrap ${
                    col.sortable ? 'cursor-pointer hover:text-slate-800 select-none' : ''
                  }`}
                >
                  <span className="flex items-center gap-1">
                    {col.label}
                    {col.sortable && sort.col === col.key && (
                      sort.dir === 'asc'
                        ? <ChevronUp className="w-3 h-3" />
                        : <ChevronDown className="w-3 h-3" />
                    )}
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={COL_DEFS.length} className="px-3 py-16 text-center text-slate-400">
                  Loading…
                </td>
              </tr>
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={COL_DEFS.length} className="px-3 py-16 text-center text-slate-400">
                  No properties match the current filters.
                </td>
              </tr>
            ) : rows.map((row, i) => (
              <tr key={row.id} className={`border-b border-slate-100 hover:bg-blue-50/40 ${i % 2 === 0 ? 'bg-white' : 'bg-slate-50/50'}`}>
                <td className="px-3 py-2 font-medium text-slate-900">{fmt(row.tenant_brand, 'tenant_brand')}</td>
                <td className="px-3 py-2 text-slate-700">{fmt(row.address, 'address')}</td>
                <td className="px-3 py-2 text-slate-600">{fmt(row.city, 'city')}</td>
                <td className="px-3 py-2">
                  <span className="inline-flex px-1.5 py-0.5 rounded text-xs font-mono font-semibold bg-slate-100 text-slate-700">{fmt(row.state, 'state')}</span>
                </td>
                <td className="px-3 py-2 text-slate-600">{fmt(row.year_built, 'year_built')}</td>
                <td className="px-3 py-2 text-slate-600">{fmt(row.year_purchased, 'year_purchased')}</td>
                <td className="px-3 py-2 text-slate-600">{fmt(row.lease_type, 'lease_type')}</td>
                <td className="px-3 py-2 text-slate-600">{fmt(row.lease_end, 'lease_end')}</td>
                <td className="px-3 py-2 text-right tabular-nums">{fmt(row.cap_rate, 'cap_rate')}</td>
                <td className="px-3 py-2 text-right tabular-nums">{fmt(row.noi, 'noi')}</td>
                <td className="px-3 py-2 text-right tabular-nums">{fmt(row.list_price, 'list_price')}</td>
                <td className="px-3 py-2 text-right tabular-nums">{fmt(row.annual_rent, 'annual_rent')}</td>
                <td className="px-3 py-2">
                  <span className={row.do_not_contact ? 'text-red-600 font-medium' : 'text-slate-700'}>
                    {fmt(row.owner_name, 'owner_name')}
                  </span>
                  {row.do_not_contact ? <span className="ml-1 text-xs text-red-400">DNC</span> : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between px-6 py-3 border-t border-slate-200 bg-white shrink-0">
          <span className="text-sm text-slate-500">
            Showing {page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, total)} of {total.toLocaleString()}
          </span>
          <div className="flex items-center gap-1">
            <button
              disabled={page === 0}
              onClick={() => setPage(p => p - 1)}
              className="px-3 py-1.5 text-sm border border-slate-200 rounded-lg hover:bg-slate-50 disabled:opacity-40"
            >
              Previous
            </button>
            <span className="px-3 py-1.5 text-sm text-slate-600">{page + 1} / {totalPages}</span>
            <button
              disabled={page >= totalPages - 1}
              onClick={() => setPage(p => p + 1)}
              className="px-3 py-1.5 text-sm border border-slate-200 rounded-lg hover:bg-slate-50 disabled:opacity-40"
            >
              Next
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
