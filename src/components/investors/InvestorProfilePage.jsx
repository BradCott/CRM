import { useState, useEffect, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import {
  ArrowLeft, Pencil, Check, X, Plus, Trash2, Loader2,
  DollarSign, Building2, TrendingUp, Calendar, AlertCircle,
} from 'lucide-react'
import {
  getInvestorProfile, updateInvestor, createDistribution, deleteDistribution,
  createInvestorLink, updateInvestorLink, deleteInvestorLink, getAllProperties,
} from '../../api/client'
import Button from '../ui/Button'
import ConfirmDialog from '../ui/ConfirmDialog'
import { InvestorForm } from './InvestorsPage'

// ── Formatters ────────────────────────────────────────────────────────────────

function fmt$(v, dash = '—') {
  if (v == null || v === 0) return dash
  if (v >= 1_000_000) return `$${(v / 1_000_000).toFixed(2)}M`
  return '$' + Math.abs(Math.round(Number(v))).toLocaleString()
}

function fmtDate(iso) {
  if (!iso) return '—'
  return new Date(iso + (iso.length === 10 ? 'T00:00:00' : '')).toLocaleDateString(undefined, {
    month: 'short', day: 'numeric', year: 'numeric',
  })
}

function fmtPct(v) {
  if (v == null) return '—'
  return `${Number(v).toFixed(1)}%`
}

// ── Stat card ─────────────────────────────────────────────────────────────────

function Stat({ label, value, sub, color = 'slate' }) {
  const colors = {
    slate:   'bg-slate-50  border-slate-200  text-slate-900',
    blue:    'bg-blue-50   border-blue-200   text-blue-900',
    emerald: 'bg-emerald-50 border-emerald-200 text-emerald-900',
    amber:   'bg-amber-50  border-amber-200  text-amber-900',
  }
  return (
    <div className={`rounded-xl border px-4 py-3 ${colors[color]}`}>
      <p className="text-xs font-medium text-slate-500 mb-1">{label}</p>
      <p className="text-xl font-bold tabular-nums">{value}</p>
      {sub && <p className="text-xs text-slate-400 mt-0.5">{sub}</p>}
    </div>
  )
}

// ── Distribution type badge ───────────────────────────────────────────────────

function TypeBadge({ type }) {
  const styles = {
    'Preferred Return': 'bg-blue-50 text-blue-700',
    'Principal':        'bg-slate-100 text-slate-600',
    'Profit':           'bg-emerald-50 text-emerald-700',
  }
  return (
    <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${styles[type] || 'bg-slate-100 text-slate-600'}`}>
      {type}
    </span>
  )
}

// ── Add Distribution Modal ────────────────────────────────────────────────────

function AddDistributionModal({ investorId, links, onSave, onClose }) {
  const [form, setForm] = useState({
    property_id:       links[0]?.property_id ?? '',
    amount:            '',
    distribution_date: new Date().toISOString().slice(0, 10),
    distribution_type: 'Preferred Return',
    notes:             '',
  })
  const [saving, setSaving] = useState(false)
  const [error, setError]   = useState(null)
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!form.amount || !form.distribution_date) return
    setSaving(true)
    setError(null)
    try {
      await createDistribution(investorId, {
        ...form,
        property_id: form.property_id || null,
        amount:      Number(form.amount),
      })
      onSave()
      onClose()
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  const inp = 'w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white'

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
          <h3 className="text-base font-semibold text-slate-900">Add Distribution</h3>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600"><X className="w-5 h-5" /></button>
        </div>
        <form onSubmit={handleSubmit} className="px-6 py-5 space-y-4">
          {error && (
            <div className="flex items-center gap-2 px-3 py-2 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
              <AlertCircle className="w-4 h-4 shrink-0" />{error}
            </div>
          )}
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Property</label>
            <select value={form.property_id} onChange={e => set('property_id', e.target.value)} className={inp}>
              <option value="">— All / General —</option>
              {links.map(l => (
                <option key={l.property_id} value={l.property_id}>{l.property_address}</option>
              ))}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Amount <span className="text-red-500">*</span></label>
              <div className="relative">
                <DollarSign className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                <input required type="number" min="0.01" step="0.01" value={form.amount}
                  onChange={e => set('amount', e.target.value)}
                  className={inp + ' pl-8'} placeholder="0.00" />
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Date <span className="text-red-500">*</span></label>
              <input required type="date" value={form.distribution_date}
                onChange={e => set('distribution_date', e.target.value)} className={inp} />
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Type</label>
            <select value={form.distribution_type} onChange={e => set('distribution_type', e.target.value)} className={inp}>
              {['Preferred Return', 'Principal', 'Profit'].map(t => <option key={t}>{t}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Notes</label>
            <textarea value={form.notes} onChange={e => set('notes', e.target.value)} rows={2}
              className={inp + ' resize-none'} placeholder="Optional note…" />
          </div>
          <div className="flex justify-end gap-2 pt-2 border-t border-slate-100">
            <button type="button" onClick={onClose}
              className="px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50 rounded-lg">
              Cancel
            </button>
            <Button type="submit" disabled={saving || !form.amount || !form.distribution_date}>
              {saving ? <><Loader2 className="w-4 h-4 animate-spin" /> Saving…</> : 'Add Distribution'}
            </Button>
          </div>
        </form>
      </div>
    </div>
  )
}

// ── Link to Property Modal ────────────────────────────────────────────────────

function LinkPropertyModal({ investorId, existingLinkIds, onSave, onClose }) {
  const [properties, setProperties]   = useState([])
  const [form, setForm] = useState({
    property_id:          '',
    contribution:         '',
    ownership_percentage: '',
    preferred_return_rate: '',
  })
  const [saving, setSaving] = useState(false)
  const [error, setError]   = useState(null)
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  useEffect(() => {
    getAllProperties()
      .then(data => setProperties((Array.isArray(data) ? data : data?.rows ?? []).filter(p => p.is_portfolio)))
      .catch(() => {})
  }, [])

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!form.property_id) return
    setSaving(true)
    setError(null)
    try {
      await createInvestorLink(investorId, {
        property_id:          Number(form.property_id),
        contribution:         form.contribution         !== '' ? Number(form.contribution)         : 0,
        ownership_percentage: form.ownership_percentage !== '' ? Number(form.ownership_percentage) : null,
        preferred_return_rate: form.preferred_return_rate !== '' ? Number(form.preferred_return_rate) : null,
      })
      onSave()
      onClose()
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  const inp = 'w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white'

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
          <h3 className="text-base font-semibold text-slate-900">Link to Property</h3>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600"><X className="w-5 h-5" /></button>
        </div>
        <form onSubmit={handleSubmit} className="px-6 py-5 space-y-4">
          {error && (
            <div className="flex items-center gap-2 px-3 py-2 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
              <AlertCircle className="w-4 h-4 shrink-0" />{error}
            </div>
          )}
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Property <span className="text-red-500">*</span></label>
            <select required value={form.property_id} onChange={e => set('property_id', e.target.value)} className={inp}>
              <option value="">Select a portfolio property…</option>
              {properties.map(p => (
                <option key={p.id} value={p.id} disabled={existingLinkIds.has(p.id)}>
                  {p.address}{p.city ? `, ${p.city}` : ''}{existingLinkIds.has(p.id) ? ' (already linked)' : ''}
                </option>
              ))}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Contribution ($)</label>
              <div className="relative">
                <DollarSign className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                <input type="number" min="0" step="1" value={form.contribution}
                  onChange={e => set('contribution', e.target.value)}
                  className={inp + ' pl-8'} placeholder="0" />
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Ownership %</label>
              <input type="number" min="0" max="100" step="0.01" value={form.ownership_percentage}
                onChange={e => set('ownership_percentage', e.target.value)}
                className={inp} placeholder="e.g. 25" />
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Preferred Return Rate (%)</label>
            <input type="number" min="0" max="100" step="0.1" value={form.preferred_return_rate}
              onChange={e => set('preferred_return_rate', e.target.value)}
              className={inp} placeholder="e.g. 8" />
          </div>
          <div className="flex justify-end gap-2 pt-2 border-t border-slate-100">
            <button type="button" onClick={onClose}
              className="px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50 rounded-lg">
              Cancel
            </button>
            <Button type="submit" disabled={saving || !form.property_id}>
              {saving ? <><Loader2 className="w-4 h-4 animate-spin" /> Saving…</> : 'Link Property'}
            </Button>
          </div>
        </form>
      </div>
    </div>
  )
}

// ── Main profile page ─────────────────────────────────────────────────────────

export default function InvestorProfilePage() {
  const { id }   = useParams()
  const navigate = useNavigate()

  const [investor, setInvestor]     = useState(null)
  const [loading, setLoading]       = useState(true)
  const [error, setError]           = useState(null)
  const [editing, setEditing]       = useState(false)
  const [showDist, setShowDist]     = useState(false)
  const [showLink, setShowLink]     = useState(false)
  const [deleteDist, setDeleteDist] = useState(null)
  const [deleteLink, setDeleteLink] = useState(null)
  const [editLink, setEditLink]     = useState(null)  // { id, contribution, ownership_percentage, preferred_return_rate }

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const data = await getInvestorProfile(id)
      setInvestor(data)
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }, [id])

  useEffect(() => { load() }, [load])

  const handleProfileSave = async (data) => {
    await updateInvestor(id, data)
    await load()
  }

  const handleDeleteDist = async () => {
    await deleteDistribution(deleteDist.id)
    setDeleteDist(null)
    await load()
  }

  const handleDeleteLink = async () => {
    await deleteInvestorLink(deleteLink.id)
    setDeleteLink(null)
    await load()
  }

  const handleSaveLink = async () => {
    if (!editLink) return
    await updateInvestorLink(editLink.id, {
      contribution:          editLink.contribution         !== '' ? Number(editLink.contribution)          : 0,
      ownership_percentage:  editLink.ownership_percentage !== '' ? Number(editLink.ownership_percentage)  : null,
      preferred_return_rate: editLink.preferred_return_rate !== '' ? Number(editLink.preferred_return_rate) : null,
    })
    setEditLink(null)
    await load()
  }

  if (loading) return (
    <div className="flex items-center justify-center h-full">
      <Loader2 className="w-6 h-6 text-slate-400 animate-spin" />
    </div>
  )

  if (error || !investor) return (
    <div className="flex flex-col items-center justify-center h-full gap-3">
      <AlertCircle className="w-8 h-8 text-red-400" />
      <p className="text-slate-600">{error || 'Investor not found'}</p>
      <button onClick={() => navigate('/investors')} className="text-blue-600 text-sm hover:underline">
        Back to Investors
      </button>
    </div>
  )

  const { portfolio_summary: ps, links, distributions } = investor
  const existingLinkIds = new Set((links || []).map(l => l.property_id))

  const inp = 'w-full px-3 py-1.5 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white'

  return (
    <div className="flex flex-col h-full overflow-hidden">

      {/* Header */}
      <div className="shrink-0 border-b border-slate-200 bg-white px-6 py-4">
        <div className="flex items-center gap-4">
          <button
            onClick={() => navigate('/investors')}
            className="flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-800 transition-colors"
          >
            <ArrowLeft className="w-4 h-4" /> Investors
          </button>
          <span className="text-slate-300">/</span>
          <h1 className="text-base font-semibold text-slate-900">{investor.name}</h1>
          {investor.is_incomplete && (
            <span className="flex items-center gap-1 text-xs text-amber-600 bg-amber-50 border border-amber-200 px-2 py-0.5 rounded-full">
              <AlertCircle className="w-3 h-3" /> Profile incomplete
            </span>
          )}
        </div>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto p-6 space-y-6 scrollbar-thin">

        {/* Portfolio Summary */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <Stat label="Total Invested"       value={fmt$(ps.total_invested, '$0')}                         color="blue" />
          <Stat label="Properties"           value={ps.num_properties}                                     color="slate" />
          <Stat label="Distributions Paid"   value={fmt$(ps.total_distributions, '$0')}                   color="emerald" />
          <Stat
            label="Pref Return Owed"
            value={fmt$(ps.net_preferred_return_owed, '$0')}
            sub={`$${Math.round(ps.total_accrued_preferred_return || 0).toLocaleString()} accrued`}
            color={ps.net_preferred_return_owed > 0 ? 'amber' : 'slate'}
          />
        </div>

        {/* Contact Info */}
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="flex items-center justify-between px-5 py-3 border-b border-slate-100">
            <h2 className="text-sm font-semibold text-slate-700">Contact Information</h2>
            {!editing && (
              <button
                onClick={() => setEditing(true)}
                className="flex items-center gap-1.5 text-xs text-slate-500 hover:text-blue-600 px-2 py-1 rounded hover:bg-slate-50 transition-colors"
              >
                <Pencil className="w-3.5 h-3.5" /> Edit
              </button>
            )}
          </div>

          {editing ? (
            <div className="p-5">
              <InvestorForm
                investor={investor}
                onSave={async (data) => { await handleProfileSave(data); setEditing(false) }}
                onClose={() => setEditing(false)}
              />
            </div>
          ) : (
            <div className="px-5 py-4 grid grid-cols-2 sm:grid-cols-3 gap-x-8 gap-y-4 text-sm">
              {[
                ['Entity Type',    investor.entity_type],
                ['Email',          investor.email],
                ['Phone',          investor.phone],
                ['Accreditation',  investor.accreditation_status],
                ['Tax ID',         investor.tax_id ? '••••••' + investor.tax_id.slice(-4) : null],
                ['Address',        [investor.address, investor.city, investor.state, investor.zip].filter(Boolean).join(', ')],
                ['Notes',          investor.notes],
              ].map(([label, val]) => (
                <div key={label}>
                  <p className="text-xs font-medium text-slate-400 mb-0.5">{label}</p>
                  <p className="text-slate-800">{val || <span className="text-slate-300">—</span>}</p>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Properties Table */}
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="flex items-center justify-between px-5 py-3 border-b border-slate-100">
            <h2 className="text-sm font-semibold text-slate-700">Properties</h2>
            <Button size="sm" onClick={() => setShowLink(true)}>
              <Plus className="w-3.5 h-3.5" /> Link Property
            </Button>
          </div>

          {links.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-10 text-center">
              <Building2 className="w-8 h-8 text-slate-300 mb-2" />
              <p className="text-sm text-slate-400">No properties linked yet</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 border-b border-slate-200">
                  <tr>
                    {['Property', 'Contribution', 'Ownership %', 'Pref Return %', 'Accrued', 'Paid Out', 'Net Owed', 'Linked', ''].map(h => (
                      <th key={h} className="px-4 py-2.5 text-left text-xs font-semibold text-slate-500 uppercase tracking-wide whitespace-nowrap">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {links.map(link => (
                    editLink?.id === link.id ? (
                      <tr key={link.id} className="border-b border-blue-200 bg-blue-50/40">
                        <td className="px-4 py-2 font-medium text-slate-800">
                          {link.property_address}
                          {link.property_city && <span className="text-slate-400 text-xs ml-1">{link.property_city}</span>}
                        </td>
                        <td className="px-2 py-2">
                          <input type="number" min="0" value={editLink.contribution}
                            onChange={e => setEditLink(l => ({ ...l, contribution: e.target.value }))}
                            className={inp + ' w-28'} />
                        </td>
                        <td className="px-2 py-2">
                          <input type="number" min="0" max="100" step="0.01" value={editLink.ownership_percentage ?? ''}
                            onChange={e => setEditLink(l => ({ ...l, ownership_percentage: e.target.value }))}
                            className={inp + ' w-20'} placeholder="%" />
                        </td>
                        <td className="px-2 py-2">
                          <input type="number" min="0" max="100" step="0.1" value={editLink.preferred_return_rate ?? ''}
                            onChange={e => setEditLink(l => ({ ...l, preferred_return_rate: e.target.value }))}
                            className={inp + ' w-20'} placeholder="%" />
                        </td>
                        <td colSpan={3} className="px-4 py-2 text-xs text-slate-400">Save to recalculate</td>
                        <td className="px-4 py-2" />
                        <td className="px-4 py-2">
                          <div className="flex items-center gap-1">
                            <button onClick={handleSaveLink} className="p-1 text-emerald-600 hover:bg-emerald-50 rounded">
                              <Check className="w-4 h-4" />
                            </button>
                            <button onClick={() => setEditLink(null)} className="p-1 text-slate-400 hover:bg-slate-100 rounded">
                              <X className="w-4 h-4" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    ) : (
                      <tr key={link.id} className="border-b border-slate-100 last:border-0 hover:bg-slate-50/50">
                        <td className="px-4 py-3">
                          <p className="font-medium text-slate-800">{link.property_address}</p>
                          {link.property_city && (
                            <p className="text-xs text-slate-400">{link.property_city}{link.property_state ? `, ${link.property_state}` : ''}</p>
                          )}
                        </td>
                        <td className="px-4 py-3 font-semibold text-slate-900 tabular-nums">{fmt$(link.contribution)}</td>
                        <td className="px-4 py-3 text-slate-700 tabular-nums">{fmtPct(link.ownership_percentage)}</td>
                        <td className="px-4 py-3 text-slate-700 tabular-nums">{fmtPct(link.preferred_return_rate)}</td>
                        <td className="px-4 py-3 text-slate-700 tabular-nums">{fmt$(link.accrued_preferred_return)}</td>
                        <td className="px-4 py-3 text-slate-700 tabular-nums">{fmt$(link.total_distributions_received)}</td>
                        <td className="px-4 py-3 tabular-nums">
                          <span className={link.net_preferred_return_owed > 0 ? 'text-amber-700 font-semibold' : 'text-slate-400'}>
                            {fmt$(link.net_preferred_return_owed, '$0')}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-xs text-slate-400">{fmtDate(link.created_at)}</td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-1">
                            <button
                              onClick={() => setEditLink({
                                id:                    link.id,
                                contribution:          link.contribution ?? '',
                                ownership_percentage:  link.ownership_percentage ?? '',
                                preferred_return_rate: link.preferred_return_rate ?? '',
                              })}
                              className="p-1 text-slate-300 hover:text-blue-500 hover:bg-blue-50 rounded"
                            >
                              <Pencil className="w-3.5 h-3.5" />
                            </button>
                            <button
                              onClick={() => setDeleteLink(link)}
                              className="p-1 text-slate-300 hover:text-red-500 hover:bg-red-50 rounded"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    )
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Distributions Table */}
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="flex items-center justify-between px-5 py-3 border-b border-slate-100">
            <h2 className="text-sm font-semibold text-slate-700">Distributions</h2>
            <Button size="sm" onClick={() => setShowDist(true)}>
              <Plus className="w-3.5 h-3.5" /> Add Distribution
            </Button>
          </div>

          {distributions.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-10 text-center">
              <DollarSign className="w-8 h-8 text-slate-300 mb-2" />
              <p className="text-sm text-slate-400">No distributions recorded yet</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 border-b border-slate-200">
                  <tr>
                    {['Date', 'Property', 'Type', 'Amount', 'Notes', ''].map(h => (
                      <th key={h} className="px-4 py-2.5 text-left text-xs font-semibold text-slate-500 uppercase tracking-wide">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {distributions.map(d => (
                    <tr key={d.id} className="border-b border-slate-100 last:border-0 hover:bg-slate-50/50">
                      <td className="px-4 py-3 text-slate-700 tabular-nums whitespace-nowrap">{fmtDate(d.distribution_date)}</td>
                      <td className="px-4 py-3 text-slate-600">{d.property_address || <span className="text-slate-300">General</span>}</td>
                      <td className="px-4 py-3"><TypeBadge type={d.distribution_type} /></td>
                      <td className="px-4 py-3 font-semibold text-emerald-700 tabular-nums">{fmt$(d.amount)}</td>
                      <td className="px-4 py-3 text-slate-400 text-xs max-w-[200px] truncate">{d.notes || '—'}</td>
                      <td className="px-4 py-3">
                        <button
                          onClick={() => setDeleteDist(d)}
                          className="p-1 text-slate-300 hover:text-red-500 hover:bg-red-50 rounded"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot className="border-t-2 border-slate-200 bg-slate-50">
                  <tr>
                    <td colSpan={3} className="px-4 py-2 text-xs font-semibold text-slate-500">Total Distributions</td>
                    <td className="px-4 py-2 font-bold text-emerald-700 tabular-nums">
                      {fmt$(distributions.reduce((s, d) => s + d.amount, 0))}
                    </td>
                    <td colSpan={2} />
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </div>

      </div>{/* end body */}

      {/* Modals */}
      {showDist && (
        <AddDistributionModal
          investorId={id}
          links={links}
          onSave={load}
          onClose={() => setShowDist(false)}
        />
      )}

      {showLink && (
        <LinkPropertyModal
          investorId={id}
          existingLinkIds={existingLinkIds}
          onSave={load}
          onClose={() => setShowLink(false)}
        />
      )}

      <ConfirmDialog
        isOpen={!!deleteDist}
        onClose={() => setDeleteDist(null)}
        onConfirm={handleDeleteDist}
        title="Delete distribution?"
        message={`${deleteDist ? fmt$(deleteDist.amount) : ''} distribution on ${fmtDate(deleteDist?.distribution_date)} will be permanently deleted.`}
      />

      <ConfirmDialog
        isOpen={!!deleteLink}
        onClose={() => setDeleteLink(null)}
        onConfirm={handleDeleteLink}
        title="Remove property link?"
        message={`This will remove the investment link for "${deleteLink?.property_address}". The distribution records will remain.`}
      />
    </div>
  )
}
