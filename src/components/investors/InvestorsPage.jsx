import { useState, useEffect, useCallback, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  TrendingUp, Plus, MoreHorizontal, Pencil, Trash2, Loader2,
  ChevronLeft, ChevronRight, AlertCircle, Upload, CheckCircle2,
  XCircle, Info,
} from 'lucide-react'
import { getCRMInvestors, createInvestor, updateInvestor, deleteInvestorRecord, bulkImportInvestors } from '../../api/client'
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
  const [showBulkImport, setShowBulkImport] = useState(false)
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
            <Button variant="secondary" onClick={() => setShowBulkImport(true)}>
              <Upload className="w-4 h-4" /> Bulk Import
            </Button>
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

      {showBulkImport && (
        <BulkImportModal
          onClose={() => { setShowBulkImport(false); load(search, entityFilter, page) }}
        />
      )}
    </div>
  )
}

// ── Bulk Import Modal ─────────────────────────────────────────────────────────

function BulkImportModal({ onClose }) {
  const [step, setStep]     = useState('upload')   // upload | importing | done
  const [file, setFile]     = useState(null)
  const [error, setError]   = useState(null)
  const [summary, setSummary] = useState(null)
  const fileRef = useRef(null)

  const handleImport = async () => {
    if (!file) return
    setStep('importing')
    setError(null)
    try {
      const result = await bulkImportInvestors(file)
      setSummary(result)
      setStep('done')
    } catch (err) {
      setError(err.message || 'Import failed')
      setStep('upload')
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-2xl max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200">
          <div className="flex items-center gap-2">
            <Upload className="w-5 h-5 text-blue-600" />
            <h2 className="text-base font-semibold text-slate-900">Bulk Import Investors</h2>
          </div>
          <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100">
            <XCircle className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-auto p-6">
          {step === 'upload' && (
            <div className="space-y-5">
              <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 text-sm text-blue-800 flex gap-3">
                <Info className="w-4 h-4 mt-0.5 shrink-0" />
                <div>
                  <p className="font-semibold mb-1">Expected file format</p>
                  <p>Upload your investor allocation Excel workbook. Each property tab should contain investor names, contribution amounts, and ownership percentages. Known contacts will be matched automatically using fuzzy name matching.</p>
                </div>
              </div>

              <div
                className="border-2 border-dashed border-slate-300 rounded-xl p-10 flex flex-col items-center justify-center cursor-pointer hover:border-blue-400 hover:bg-blue-50/30 transition-colors"
                onClick={() => fileRef.current?.click()}
                onDragOver={e => e.preventDefault()}
                onDrop={e => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) setFile(f) }}
              >
                <Upload className="w-8 h-8 text-slate-300 mb-3" />
                {file ? (
                  <p className="text-sm font-semibold text-slate-700">{file.name}</p>
                ) : (
                  <>
                    <p className="text-sm font-semibold text-slate-700">Drop Excel file here</p>
                    <p className="text-xs text-slate-400 mt-1">or click to browse (.xlsx, .xls)</p>
                  </>
                )}
                <input
                  ref={fileRef}
                  type="file"
                  accept=".xlsx,.xls"
                  className="hidden"
                  onChange={e => setFile(e.target.files[0] || null)}
                />
              </div>

              {error && (
                <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-sm text-red-700 flex items-center gap-2">
                  <XCircle className="w-4 h-4 shrink-0" /> {error}
                </div>
              )}
            </div>
          )}

          {step === 'importing' && (
            <div className="flex flex-col items-center justify-center py-16 gap-4">
              <Loader2 className="w-10 h-10 text-blue-500 animate-spin" />
              <p className="text-sm font-semibold text-slate-700">Processing spreadsheet…</p>
              <p className="text-xs text-slate-400">This may take a moment for large files.</p>
            </div>
          )}

          {step === 'done' && summary && (
            <div className="space-y-5">
              {/* Success banner */}
              <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-4 flex items-start gap-3">
                <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0 mt-0.5" />
                <div>
                  <p className="text-sm font-semibold text-emerald-800">Import complete</p>
                  <p className="text-xs text-emerald-700 mt-0.5">
                    {summary.investors_created.length} investors · {summary.links_created.length} property links
                    {summary.sheet_used && <span> · from "{summary.sheet_used}"</span>}
                  </p>
                </div>
              </div>

              {/* Investors created */}
              {summary.investors_created.length > 0 && (
                <ImportSection title="Investors created" color="blue" items={summary.investors_created} />
              )}

              {/* Links */}
              {summary.links_created.length > 0 && (
                <ImportSection title="Property links added" color="emerald" items={summary.links_created} />
              )}

              {/* Unmatched properties */}
              {summary.unmatched_properties.length > 0 && (
                <div className="rounded-xl border border-amber-200 bg-amber-50 p-4">
                  <p className="text-xs font-semibold text-amber-700 uppercase tracking-wide mb-2">
                    ⚠ Columns not matched to a portfolio property
                  </p>
                  <ul className="space-y-1">
                    {summary.unmatched_properties.map((u, i) => (
                      <li key={i} className="text-sm text-amber-800">
                        <span className="font-semibold">{u.label}</span>
                        {u.reason && <span className="text-amber-600"> — {u.reason}</span>}
                      </li>
                    ))}
                  </ul>
                  <p className="text-xs text-amber-600 mt-2">
                    Add the missing portfolio properties to CRM, then re-run the import.
                  </p>
                </div>
              )}

              {/* Errors */}
              {summary.errors.length > 0 && (
                <div className="rounded-xl border border-red-200 bg-red-50 p-4">
                  <p className="text-xs font-semibold text-red-700 uppercase tracking-wide mb-2">Errors</p>
                  <ul className="space-y-1">
                    {summary.errors.map((e, i) => (
                      <li key={i} className="text-sm text-red-700">• {e}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-2 px-6 py-4 border-t border-slate-200">
          {step === 'done' ? (
            <Button onClick={onClose}>Done</Button>
          ) : (
            <>
              <button onClick={onClose} className="px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50 rounded-lg">
                Cancel
              </button>
              <Button onClick={handleImport} disabled={!file || step === 'importing'}>
                {step === 'importing'
                  ? <><Loader2 className="w-4 h-4 animate-spin" /> Importing…</>
                  : <><Upload className="w-4 h-4" /> Import</>}
              </Button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

function ImportSection({ title, color, items }) {
  const colors = {
    slate:   'border-slate-200 bg-slate-50 text-slate-700',
    blue:    'border-blue-200 bg-blue-50 text-blue-800',
    violet:  'border-violet-200 bg-violet-50 text-violet-800',
    emerald: 'border-emerald-200 bg-emerald-50 text-emerald-800',
    amber:   'border-amber-200 bg-amber-50 text-amber-800',
  }
  const cls = colors[color] || colors.slate
  return (
    <div className={`rounded-xl border p-4 ${cls}`}>
      <p className="text-xs font-semibold uppercase tracking-wide mb-2 opacity-70">{title} ({items.length})</p>
      <ul className="space-y-0.5 max-h-40 overflow-auto">
        {items.map((item, i) => (
          <li key={i} className="text-sm">• {item}</li>
        ))}
      </ul>
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
