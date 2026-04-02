import { useState, useEffect, useCallback, useRef } from 'react'
import {
  Landmark, Plus, MoreHorizontal, Pencil, Trash2, Loader2,
  ChevronLeft, ChevronRight, AlertCircle, Upload, Download, X, CheckCircle2,
} from 'lucide-react'
import { getProperties } from '../../api/client'
import { useApp } from '../../context/AppContext'
import TopBar from '../layout/TopBar'
import Button from '../ui/Button'
import Modal from '../ui/Modal'
import ConfirmDialog from '../ui/ConfirmDialog'
import PropertyForm from '../properties/PropertyForm'
import PropertyDetail from '../properties/PropertyDetail'

const PAGE_SIZE = 75

function fmt$(v) {
  if (!v) return null
  if (v >= 1_000_000) return `$${(v / 1_000_000).toFixed(2)}M`
  if (v >= 1_000)     return `$${Number(v).toLocaleString()}`
  return `$${v}`
}

function leaseStatus(leaseEnd) {
  if (!leaseEnd) return null
  const months = (new Date(leaseEnd + 'T00:00:00') - new Date()) / (1000 * 60 * 60 * 24 * 30)
  if (months < 0)   return { label: 'Expired',   cls: 'bg-red-100 text-red-700' }
  if (months < 12)  return { label: '< 1yr',     cls: 'bg-amber-100 text-amber-700' }
  if (months < 36)  return { label: '1–3 yrs',   cls: 'bg-yellow-100 text-yellow-700' }
  const yrs = Math.round(months / 12)
  return { label: `${yrs}yr`, cls: 'bg-green-100 text-green-700' }
}

export default function PortfolioPage() {
  const { tenantBrands, propertyStates, addProperty, editProperty, removeProperty } = useApp()

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
  const [showImport, setShowImport]     = useState(false)
  const searchTimer = useRef(null)

  const load = useCallback(async (s, tenant, state, pg) => {
    setFetching(true)
    try {
      const params = { portfolio: '1', limit: PAGE_SIZE, offset: pg * PAGE_SIZE }
      if (s)      params.search = s
      if (tenant) params.tenant = tenant
      if (state)  params.state  = state
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

  // Called from PropertyDetail when the portfolio toggle changes
  const handlePortfolioChange = () => {
    load(search, tenantFilter, stateFilter, page)
  }

  const totalPages = Math.ceil(total / PAGE_SIZE)

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <TopBar
        title={total > 0 ? `Portfolio (${total.toLocaleString()})` : 'Portfolio'}
        onSearch={handleSearch}
        searchPlaceholder="Search address, city, tenant…"
        actions={
          <div className="flex items-center gap-2">
            <select
              value={tenantFilter}
              onChange={e => { setTenant(e.target.value); setPage(0); load(search, e.target.value, stateFilter, 0) }}
              className="text-sm border border-slate-200 rounded-lg px-3 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="">All tenants</option>
              {tenantBrands.map(t => <option key={t.id} value={t.name}>{t.name}</option>)}
            </select>
            <select
              value={stateFilter}
              onChange={e => { setState(e.target.value); setPage(0); load(search, tenantFilter, e.target.value, 0) }}
              className="text-sm border border-slate-200 rounded-lg px-3 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="">All states</option>
              {propertyStates.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
            <button
              onClick={() => setShowImport(true)}
              className="flex items-center gap-1.5 px-3 py-2 text-sm font-medium text-slate-600 border border-slate-200 rounded-lg hover:bg-slate-50"
            >
              <Upload className="w-4 h-4" /> Import CSV
            </button>
            <Button onClick={() => { setEditTarget(null); setShowForm(true) }}>
              <Plus className="w-4 h-4" /> Add property
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
          <EmptyPortfolio onAdd={() => setShowForm(true)} />
        ) : (
          <>
            {/* Summary strip */}
            <PortfolioSummary rows={rows} />

            <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden mt-4">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 border-b border-slate-200">
                  <tr>
                    {['Property', 'Tenant', 'Owner', 'Lease Type', 'Lease End', 'Cap Rate', 'NOI', 'Ann. Rent', 'Purchase Price'].map(h => (
                      <th key={h} className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wide whitespace-nowrap">{h}</th>
                    ))}
                    <th className="w-12" />
                  </tr>
                </thead>
                <tbody>
                  {rows.map((p, i) => {
                    const ls = leaseStatus(p.lease_end)
                    return (
                      <tr
                        key={p.id}
                        onClick={() => setDetailId(p.id)}
                        className={`border-b border-slate-100 last:border-0 hover:bg-blue-50/40 transition-colors cursor-pointer ${i % 2 === 0 ? 'bg-white' : 'bg-slate-50/40'}`}
                      >
                        <td className="px-4 py-3">
                          <p className="font-medium text-slate-900">{p.address}</p>
                          {(p.city || p.state) && (
                            <p className="text-xs text-slate-500">{[p.city, p.state, p.zip].filter(Boolean).join(', ')}</p>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          {p.tenant_brand_name
                            ? <span className="text-xs font-semibold text-blue-700 bg-blue-50 px-2 py-0.5 rounded-full">{p.tenant_brand_name}</span>
                            : <span className="text-slate-300">—</span>}
                        </td>
                        <td className="px-4 py-3 max-w-[160px]">
                          <p className="text-slate-700 truncate">{p.owner_name || <span className="text-slate-300">—</span>}</p>
                          {p.owner_do_not_contact ? (
                            <span className="text-xs text-red-500 flex items-center gap-0.5 mt-0.5">
                              <AlertCircle className="w-3 h-3" /> DNC
                            </span>
                          ) : null}
                        </td>
                        <td className="px-4 py-3">
                          {p.lease_type
                            ? <span className="text-xs font-medium bg-slate-100 text-slate-700 px-2 py-0.5 rounded-full">{p.lease_type}</span>
                            : <span className="text-slate-300">—</span>}
                        </td>
                        <td className="px-4 py-3">
                          {ls
                            ? <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${ls.cls}`}>{ls.label}</span>
                            : <span className="text-slate-300">—</span>}
                        </td>
                        <td className="px-4 py-3">
                          {p.cap_rate
                            ? <span className="font-bold text-emerald-700">{Number(p.cap_rate).toFixed(2)}%</span>
                            : <span className="text-slate-300">—</span>}
                        </td>
                        <td className="px-4 py-3 text-slate-700">{fmt$(p.noi) || <span className="text-slate-300">—</span>}</td>
                        <td className="px-4 py-3 text-slate-700">{fmt$(p.annual_rent) || <span className="text-slate-300">—</span>}</td>
                        <td className="px-4 py-3 font-medium text-slate-900">{fmt$(p.purchase_price) || <span className="text-slate-300 font-normal">—</span>}</td>
                        <td className="px-4 py-3" onClick={e => e.stopPropagation()}>
                          <div className="relative">
                            <button
                              className="w-8 h-8 rounded-lg flex items-center justify-center text-slate-400 hover:bg-slate-100"
                              onClick={() => setOpenMenu(openMenu === p.id ? null : p.id)}
                            >
                              <MoreHorizontal className="w-4 h-4" />
                            </button>
                            {openMenu === p.id && (
                              <div className="absolute right-0 top-9 w-44 bg-white border border-slate-200 rounded-xl shadow-lg z-10 py-1 text-sm">
                                <button
                                  className="flex items-center gap-2 w-full px-3 py-2 text-slate-700 hover:bg-slate-50"
                                  onClick={() => { setEditTarget(p); setShowForm(true); setOpenMenu(null) }}
                                >
                                  <Pencil className="w-3.5 h-3.5" /> Edit
                                </button>
                                <button
                                  className="flex items-center gap-2 w-full px-3 py-2 text-red-600 hover:bg-red-50"
                                  onClick={() => { setDeleteTarget(p); setOpenMenu(null) }}
                                >
                                  <Trash2 className="w-3.5 h-3.5" /> Delete
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

      <Modal isOpen={showForm} onClose={() => { setShowForm(false); setEditTarget(null) }} title={editTarget ? 'Edit property' : 'Add to portfolio'} size="lg">
        <PropertyForm property={editTarget} onSave={handleSave} onClose={() => { setShowForm(false); setEditTarget(null) }} />
      </Modal>
      <ConfirmDialog
        isOpen={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={handleDelete}
        title="Remove from portfolio?"
        message={`"${deleteTarget?.address}" will be permanently deleted.`}
      />

      {detailId && (
        <>
          <div className="fixed inset-0 z-30 bg-black/10" onClick={() => setDetailId(null)} />
          <PropertyDetail
            propertyId={detailId}
            onClose={() => setDetailId(null)}
            onPortfolioChange={handlePortfolioChange}
            onEdit={() => {
              const p = rows.find(r => r.id === detailId)
              if (p) { setEditTarget(p); setShowForm(true) }
              setDetailId(null)
            }}
          />
        </>
      )}
      {openMenu && <div className="fixed inset-0 z-0" onClick={() => setOpenMenu(null)} />}

      {showImport && (
        <PortfolioImportModal
          onClose={() => setShowImport(false)}
          onImported={() => { setShowImport(false); load(search, tenantFilter, stateFilter, page) }}
        />
      )}
    </div>
  )
}

function PortfolioSummary({ rows }) {
  const withCap   = rows.filter(r => r.cap_rate)
  const avgCap    = withCap.length ? (withCap.reduce((s, r) => s + Number(r.cap_rate), 0) / withCap.length).toFixed(2) : null
  const totalNOI  = rows.reduce((s, r) => s + (r.noi || 0), 0)
  const totalRent = rows.reduce((s, r) => s + (r.annual_rent || 0), 0)
  const totalCost = rows.reduce((s, r) => s + (r.purchase_price || 0), 0)

  return (
    <div className="grid grid-cols-4 gap-4">
      {[
        { label: 'Properties',   value: rows.length, fmt: v => v },
        { label: 'Avg Cap Rate', value: avgCap,       fmt: v => `${v}%` },
        { label: 'Total NOI',    value: totalNOI || null, fmt: fmt$ },
        { label: 'Total Cost',   value: totalCost || null, fmt: fmt$ },
      ].map(({ label, value, fmt }) => (
        <div key={label} className="bg-white rounded-xl border border-slate-200 px-5 py-4">
          <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide">{label}</p>
          <p className="text-2xl font-bold text-slate-900 mt-1">{value != null ? fmt(value) : <span className="text-slate-300 text-lg">—</span>}</p>
        </div>
      ))}
    </div>
  )
}

function PortfolioImportModal({ onClose, onImported }) {
  const [file, setFile]       = useState(null)
  const [status, setStatus]   = useState(null) // null | 'uploading' | {imported, skipped} | {error}
  const fileRef = useRef()

  async function handleUpload() {
    if (!file) return
    setStatus('uploading')
    const fd = new FormData()
    fd.append('file', file)
    try {
      const res = await fetch('/api/portfolio-import', { method: 'POST', body: fd })
      const data = await res.json()
      if (!res.ok) setStatus({ error: data.error || 'Import failed' })
      else setStatus(data)
    } catch (e) {
      setStatus({ error: e.message })
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md mx-4 overflow-hidden">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
          <h2 className="text-base font-bold text-slate-900">Import Knox Portfolio</h2>
          <button onClick={onClose} className="w-8 h-8 rounded-lg flex items-center justify-center text-slate-400 hover:bg-slate-100">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="px-6 py-5 space-y-5">
          {/* Template download */}
          <div className="bg-blue-50 border border-blue-100 rounded-xl px-4 py-3 flex items-center justify-between gap-3">
            <div>
              <p className="text-sm font-semibold text-blue-800">Step 1 — Download the template</p>
              <p className="text-xs text-blue-600 mt-0.5">Fill it in with your 15 properties, then upload below.</p>
            </div>
            <a
              href="/api/portfolio-import/template"
              download
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-blue-700 bg-white border border-blue-200 rounded-lg hover:bg-blue-50 shrink-0"
            >
              <Download className="w-3.5 h-3.5" /> Template
            </a>
          </div>

          {/* File picker */}
          <div>
            <p className="text-sm font-semibold text-slate-700 mb-2">Step 2 — Upload your filled CSV</p>
            <div
              onClick={() => fileRef.current?.click()}
              className="border-2 border-dashed border-slate-200 rounded-xl px-4 py-6 text-center cursor-pointer hover:border-blue-300 hover:bg-blue-50/30 transition-colors"
            >
              <Upload className="w-6 h-6 text-slate-300 mx-auto mb-2" />
              {file
                ? <p className="text-sm font-medium text-slate-700">{file.name}</p>
                : <p className="text-sm text-slate-400">Click to choose a CSV file</p>
              }
              <input ref={fileRef} type="file" accept=".csv" className="hidden" onChange={e => { setFile(e.target.files[0]); setStatus(null) }} />
            </div>
          </div>

          {/* Result */}
          {status && status !== 'uploading' && (
            status.error
              ? <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-sm text-red-700">{status.error}</div>
              : <div className="bg-emerald-50 border border-emerald-200 rounded-xl px-4 py-3 flex items-center gap-2 text-sm text-emerald-800">
                  <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                  <span><strong>{status.imported}</strong> properties imported{status.skipped > 0 ? `, ${status.skipped} skipped (no address)` : ''}.</span>
                </div>
          )}
        </div>

        <div className="flex justify-end gap-2 px-6 py-4 border-t border-slate-100">
          {status?.imported > 0
            ? <Button onClick={onImported}>Done — View Portfolio</Button>
            : <>
                <button onClick={onClose} className="px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50 rounded-lg">Cancel</button>
                <Button onClick={handleUpload} disabled={!file || status === 'uploading'}>
                  {status === 'uploading' ? <><Loader2 className="w-4 h-4 animate-spin mr-1" /> Importing…</> : 'Import'}
                </Button>
              </>
          }
        </div>
      </div>
    </div>
  )
}

function EmptyPortfolio({ onAdd }) {
  return (
    <div className="flex flex-col items-center justify-center h-64 text-center">
      <div className="w-14 h-14 rounded-2xl bg-slate-100 flex items-center justify-center mb-4">
        <Landmark className="w-7 h-7 text-slate-400" />
      </div>
      <h3 className="text-base font-semibold text-slate-700 mb-1">No properties in your portfolio yet</h3>
      <p className="text-sm text-slate-400 mb-5 max-w-xs">
        Open any property and click <strong>Add to Portfolio</strong>, or add a new one directly.
      </p>
      <Button onClick={onAdd}><Plus className="w-4 h-4" /> Add property</Button>
    </div>
  )
}
