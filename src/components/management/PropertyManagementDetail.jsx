import { useState, useEffect, useCallback, useRef } from 'react'
import DriveDocsButton from '../properties/DriveDocsButton'
import TenantNotifyButton from '../properties/TenantNotifyButton'
import LeaseSection from './LeaseSection'
import DashboardSection from './DashboardSection'
import InsuranceReimbursement from './InsuranceReimbursement'
import DropZone from '../ui/DropZone'
import { useParams, Link, useSearchParams } from 'react-router-dom'
import {
  ArrowLeft, ClipboardList, Shield, Receipt, Wrench, Users,
  Plus, Pencil, Trash2, CheckCircle2, Loader2,
  Upload, AlertCircle, ChevronDown, ChevronUp, FileUp, FileText, LayoutDashboard, Calculator,
} from 'lucide-react'
import {
  getProperty,
  getPropertyTasks,      createTask,        updateTask,        completeTask,    deleteTask,
  getPropertyInsurance,  createInsurance,   updateInsurance,   deleteInsurance, uploadInsurancePdf, uploadInsuranceDoc, markInsurancePaid,
  getPropertyTaxes,      createTax,         updateTax,         deleteTax,
  getPropertyMaintenance, createMaintenance, updateMaintenance, deleteMaintenance,
  getPropertyContacts,   createContact,     updateContact,     deleteContact,
} from '../../api/client'
import { Input, Select, Textarea } from '../ui/Input'
import Button from '../ui/Button'
import Modal from '../ui/Modal'

// ── Utilities ─────────────────────────────────────────────────────────────────

function fmt(n) {
  if (n == null || n === '') return '—'
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(n)
}

function parseDate(s) {
  if (!s) return null
  // MM/DD/YYYY
  const mdyMatch = String(s).match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/)
  if (mdyMatch) {
    const d = new Date(Number(mdyMatch[3]), Number(mdyMatch[1]) - 1, Number(mdyMatch[2]), 12)
    return isNaN(d) ? null : d
  }
  // YYYY-MM-DD (and ISO with time)
  const d = new Date(String(s).length === 10 ? s + 'T12:00:00' : s)
  return isNaN(d) ? null : d
}

function fmtDate(s) {
  const d = parseDate(s)
  if (!d) return '—'
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

function toYMD(s) {
  if (!s) return ''
  // Already YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s
  const d = parseDate(s)
  if (!d) return ''
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function daysUntil(dateStr) {
  if (!dateStr) return null
  const d = parseDate(dateStr)
  if (!d) return null
  const today = new Date()
  today.setHours(12, 0, 0, 0)
  return Math.round((d - today) / (1000 * 60 * 60 * 24))
}

const TASK_TYPES    = ['inspection', 'insurance', 'tax', 'lease', 'maintenance', 'other']
const RECURS_OPTS   = ['none', 'monthly', 'quarterly', 'annually']
const MAINT_CATS    = ['HVAC', 'Roof', 'Plumbing', 'Electrical', 'Landscaping', 'Parking Lot', 'General', 'Other']
const CONTACT_ROLES = ['Property Manager', 'Contractor', 'Roofer', 'Electrician', 'Plumber', 'HVAC', 'Landscaper', 'Insurance Agent', 'Attorney', 'Accountant', 'Other']
const KNOWN_ROLES = CONTACT_ROLES.filter(r => r !== 'Other')

const TASK_COLORS = {
  insurance:   'bg-blue-100   text-blue-700',
  tax:         'bg-amber-100  text-amber-700',
  inspection:  'bg-purple-100 text-purple-700',
  lease:       'bg-green-100  text-green-700',
  maintenance: 'bg-orange-100 text-orange-700',
  other:       'bg-slate-100  text-slate-600',
}

// ── Reusable section wrapper ──────────────────────────────────────────────────

function Section({ icon: Icon, title, actions, children }) {
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-slate-700">
          <Icon className="w-4 h-4 text-slate-400" /> {title}
        </h2>
        <div className="flex items-center gap-3">{actions}</div>
      </div>
      {children}
    </div>
  )
}

// ── Tasks Section ─────────────────────────────────────────────────────────────

function TasksSection({ propertyId }) {
  const [tasks, setTasks]           = useState([])
  const [loading, setLoading]       = useState(true)
  const [showDone, setShowDone]     = useState(false)
  const [modal, setModal]           = useState(null) // null | 'add' | task object
  const [form, setForm]             = useState({})
  const [saving, setSaving]         = useState(false)
  const [completingIds, setCompletingIds] = useState(new Set())

  const load = useCallback(async () => {
    setLoading(true)
    try { setTasks(await getPropertyTasks(propertyId)) } catch {}
    setLoading(false)
  }, [propertyId])

  useEffect(() => { load() }, [load])

  function openAdd() {
    setForm({ title: '', task_type: 'other', due_date: '', recurs: 'none', notes: '' })
    setModal('add')
  }

  function openEdit(task) {
    setForm({ ...task, due_date: task.due_date || '', notes: task.notes || '' })
    setModal(task)
  }

  const set = f => e => setForm(prev => ({ ...prev, [f]: e.target.value }))

  async function handleSave(e) {
    e.preventDefault()
    setSaving(true)
    try {
      if (modal === 'add') await createTask(propertyId, form)
      else                 await updateTask(modal.id, form)
      setModal(null)
      await load()
    } catch (err) {
      alert('Error: ' + err.message)
    } finally {
      setSaving(false)
    }
  }

  async function handleComplete(id) {
    setCompletingIds(prev => new Set([...prev, id]))
    try {
      await completeTask(id)
      await load()
    } catch (err) {
      alert('Error completing task: ' + err.message)
    } finally {
      setCompletingIds(prev => { const s = new Set(prev); s.delete(id); return s })
    }
  }

  async function handleDelete(id) {
    if (!confirm('Delete this task?')) return
    await deleteTask(id)
    await load()
  }

  const pending   = tasks.filter(t => !t.completed_at)
  const completed = tasks.filter(t =>  t.completed_at)

  return (
    <Section
      icon={ClipboardList}
      title={`Tasks (${pending.length} pending)`}
      actions={
        <button onClick={openAdd} className="flex items-center gap-1 text-xs text-blue-600 hover:underline font-medium">
          <Plus className="w-3 h-3" /> Add task
        </button>
      }
    >
      {loading ? <p className="text-sm text-slate-400">Loading…</p> : (
        <>
          {pending.length === 0 && (
            <p className="text-sm text-slate-400 py-2">No pending tasks.</p>
          )}

          <div className="space-y-2">
            {pending.map(task => {
              const days      = daysUntil(task.due_date)
              const isOverdue = days !== null && days < 0
              const isDueSoon = !isOverdue && days !== null && days <= 7
              const completing = completingIds.has(task.id)

              return (
                <div
                  key={task.id}
                  className={`flex items-start gap-3 p-3 rounded-xl border transition-colors ${
                    isOverdue ? 'bg-red-50 border-red-200' : 'bg-white border-slate-200 hover:border-slate-300'
                  }`}
                >
                  {/* Task details */}
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-slate-900 leading-snug">{task.title}</p>
                    <div className="flex flex-wrap items-center gap-2 mt-1.5">
                      <span className={`text-xs px-1.5 py-0.5 rounded-full font-medium ${TASK_COLORS[task.task_type] || TASK_COLORS.other}`}>
                        {task.task_type}
                      </span>
                      {task.due_date && (
                        <span className={`text-xs font-medium ${
                          isOverdue ? 'text-red-600' : isDueSoon ? 'text-amber-600' : 'text-slate-500'
                        }`}>
                          {isOverdue
                            ? `${Math.abs(days)}d overdue — was due ${fmtDate(task.due_date)}`
                            : `Due ${fmtDate(task.due_date)}`
                          }
                        </span>
                      )}
                      {task.recurs && task.recurs !== 'none' && (
                        <span className="text-xs text-slate-400 italic">↺ {task.recurs}</span>
                      )}
                    </div>
                    {task.notes && (
                      <p className="text-xs text-slate-400 mt-1 truncate">{task.notes}</p>
                    )}
                  </div>

                  {/* Actions */}
                  <div className="flex items-center gap-2 shrink-0 pt-0.5">
                    {/* Mark Complete — clearly visible green button */}
                    <button
                      onClick={() => handleComplete(task.id)}
                      disabled={completing}
                      className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold border transition-colors disabled:opacity-60 whitespace-nowrap ${
                        completing
                          ? 'bg-green-50 text-green-600 border-green-200'
                          : 'bg-green-50 text-green-700 border-green-200 hover:bg-green-100 hover:border-green-300'
                      }`}
                    >
                      {completing
                        ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        : <CheckCircle2 className="w-3.5 h-3.5" />
                      }
                      {completing ? 'Saving…' : 'Mark Complete'}
                    </button>
                    <button
                      onClick={() => openEdit(task)}
                      className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-400 hover:text-slate-600 transition-colors"
                    >
                      <Pencil className="w-3.5 h-3.5" />
                    </button>
                    <button
                      onClick={() => handleDelete(task.id)}
                      className="p-1.5 rounded-lg hover:bg-red-50 text-slate-400 hover:text-red-500 transition-colors"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              )
            })}
          </div>

          {/* Completed tasks (collapsible) */}
          {completed.length > 0 && (
            <div className="pt-1">
              <button
                onClick={() => setShowDone(s => !s)}
                className="flex items-center gap-1.5 text-xs text-slate-400 hover:text-slate-600 transition-colors"
              >
                {showDone ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                {completed.length} completed task{completed.length !== 1 ? 's' : ''}
              </button>
              {showDone && (
                <div className="space-y-1.5 mt-2">
                  {completed.map(task => (
                    <div key={task.id} className="flex items-center gap-3 p-2.5 rounded-xl border border-slate-100 bg-slate-50/80">
                      <CheckCircle2 className="w-4 h-4 text-green-500 shrink-0" />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm line-through text-slate-400">{task.title}</p>
                        {task.completed_at && (
                          <p className="text-xs text-slate-400 mt-0.5">
                            Completed {new Date(task.completed_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                          </p>
                        )}
                      </div>
                      <button
                        onClick={() => handleDelete(task.id)}
                        className="p-1 rounded hover:bg-red-50 text-slate-300 hover:text-red-400 transition-colors"
                      >
                        <Trash2 className="w-3 h-3" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </>
      )}

      {/* Add / Edit Task modal */}
      <Modal isOpen={!!modal} onClose={() => setModal(null)} title={modal === 'add' ? 'Add Task' : 'Edit Task'} size="md">
        <form onSubmit={handleSave} className="px-6 py-5 space-y-3">
          <Input label="Title *" value={form.title || ''} onChange={set('title')} autoFocus />
          <div className="grid grid-cols-2 gap-3">
            <Select label="Type" value={form.task_type || 'other'} onChange={set('task_type')}>
              {TASK_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
            </Select>
            <Select label="Recurs" value={form.recurs || 'none'} onChange={set('recurs')}>
              {RECURS_OPTS.map(t => <option key={t} value={t}>{t}</option>)}
            </Select>
          </div>
          <Input label="Due date" type="date" value={form.due_date || ''} onChange={set('due_date')} />
          <Textarea label="Notes" value={form.notes || ''} onChange={set('notes')} />
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="secondary" onClick={() => setModal(null)}>Cancel</Button>
            <Button type="submit" disabled={saving || !form.title?.trim()}>{saving ? 'Saving…' : 'Save'}</Button>
          </div>
        </form>
      </Modal>
    </Section>
  )
}

// ── Insurance Section ─────────────────────────────────────────────────────────

const INS_REVIEW_SECTIONS = [
  { label: 'POLICY INFO', fields: [
    { key: 'insurance_company', label: 'Insurance Company' },
    { key: 'policy_number',     label: 'Policy Number'     },
    { key: 'named_insured',     label: 'Named Insured'     },
    { key: 'agent_name',        label: 'Agent Name'        },
    { key: 'agent_phone',       label: 'Agent Phone'       },
  ]},
  { label: 'PROPERTY', fields: [
    { key: 'property_address',  label: 'Property Address'  },
    { key: 'construction_type', label: 'Construction Type' },
    { key: 'year_built',        label: 'Year Built'        },
    { key: 'valuation_method',  label: 'Valuation Method'  },
  ]},
  { label: 'COVERAGE & COSTS', span: 2, fields: [
    { key: 'premium',                    label: 'Premium'                    },
    { key: 'premium_due_date',           label: 'Premium Due Date'           },
    { key: 'deductible',                 label: 'Deductible'                 },
    { key: 'building_coverage',          label: 'Building Coverage'          },
    { key: 'general_liability_coverage', label: 'General Liability Coverage' },
    { key: 'general_aggregate',          label: 'General Aggregate'          },
  ]},
  { label: 'MORTGAGE', fields: [
    { key: 'mortgagee', label: 'Mortgagee' },
  ]},
  { label: 'DATES', fields: [
    { key: 'effective_date',  label: 'Effective Date'  },
    { key: 'expiration_date', label: 'Expiration Date' },
  ]},
]

const INS_EMPTY = {
  carrier: '', policy_number: '', premium: '', coverage_amount: '', deductible: '',
  effective_date: '', expiry_date: '', auto_renewal: false,
  agent_name: '', agent_phone: '', agent_email: '', notes: '',
}

function parseAmount(str) {
  if (str == null || str === '') return ''
  const n = parseFloat(String(str).replace(/[$,]/g, ''))
  return isNaN(n) ? '' : String(n)
}

function InsuranceSection({ propertyId }) {
  const [policies, setPolicies]           = useState([])
  const [loading, setLoading]             = useState(true)
  const [modal, setModal]                 = useState(null) // null | 'add' | policy object
  const [form, setForm]                   = useState({})
  const [saving, setSaving]               = useState(false)
  const [uploading, setUploading]         = useState(false)
  const [parseError, setParseError]       = useState(null)
  const [extractedData, setExtractedData] = useState(null)
  const [parsedFile, setParsedFile]       = useState(null)   // the uploaded PDF, kept to auto-attach as the policy doc
  const [paidReceiptFor, setPaidReceiptFor] = useState(null) // insurance id to prompt a proof-of-payment upload
  const [receiptBusy, setReceiptBusy]     = useState(false)
  const fileInputRef                      = useRef(null)

  const load = useCallback(async () => {
    setLoading(true)
    try { setPolicies(await getPropertyInsurance(propertyId)) } catch {}
    setLoading(false)
  }, [propertyId])

  useEffect(() => { load() }, [load])

  function openAdd() {
    setForm({ ...INS_EMPTY })
    setParseError(null)
    setModal('add')
  }

  function openEdit(p) {
    setForm({ ...INS_EMPTY, ...p, auto_renewal: !!p.auto_renewal })
    setParseError(null)
    setModal(p)
  }

  function handleUploadClick() {
    setParseError(null)
    fileInputRef.current?.click()
  }

  async function processInsuranceFile(file) {
    if (!file) return
    setUploading(true)
    setParseError(null)
    try {
      const data = await uploadInsurancePdf(propertyId, file)
      setExtractedData(data)
      setParsedFile(file)   // keep it so we can attach it as the Policy document on save
    } catch (err) {
      setParseError(err.message)
    } finally {
      setUploading(false)
    }
  }

  function handleFileSelected(e) {
    const file = e.target.files?.[0]
    e.target.value = ''
    processInsuranceFile(file)
  }

  async function handleSaveExtracted() {
    const d = extractedData
    const extraLines = []
    if (d.named_insured)              extraLines.push(`Named Insured: ${d.named_insured}`)
    if (d.property_address)           extraLines.push(`Property Address: ${d.property_address}`)
    if (d.premium_due_date)           extraLines.push(`Premium Due Date: ${d.premium_due_date}`)
    if (d.building_coverage)          extraLines.push(`Building Coverage: ${d.building_coverage}`)
    if (d.general_liability_coverage) extraLines.push(`General Liability Coverage: ${d.general_liability_coverage}`)
    if (d.general_aggregate)          extraLines.push(`General Aggregate: ${d.general_aggregate}`)
    if (d.mortgagee)                  extraLines.push(`Mortgagee: ${d.mortgagee}`)
    if (d.construction_type)          extraLines.push(`Construction Type: ${d.construction_type}`)
    if (d.year_built)                 extraLines.push(`Year Built: ${d.year_built}`)
    if (d.valuation_method)           extraLines.push(`Valuation Method: ${d.valuation_method}`)

    const payload = {
      carrier:          d.insurance_company  || '',
      policy_number:    d.policy_number      || '',
      premium:          parseAmount(d.premium),
      deductible:       parseAmount(d.deductible),
      effective_date:   toYMD(d.effective_date),
      expiry_date:      toYMD(d.expiration_date),
      premium_due_date: toYMD(d.premium_due_date),
      agent_name:       d.agent_name         || '',
      agent_phone:      d.agent_phone        || '',
      coverage_amount:  parseAmount(d.building_coverage),
      notes:            extraLines.join('\n'),
      premium_breakdown: Array.isArray(d.premium_items) && d.premium_items.length
        ? JSON.stringify(d.premium_items.filter(i => i && (i.label || i.amount)))
        : null,
    }

    setSaving(true)
    try {
      const created = await createInsurance(propertyId, payload)
      // Attach the parsed PDF as the policy document so it's ready for the
      // tenant reimbursement email.
      if (created?.id && parsedFile) {
        try { await uploadInsuranceDoc(created.id, parsedFile, 'Policy') } catch (_) {}
      }
      setExtractedData(null)
      setParsedFile(null)
      await load()
    } catch (err) {
      alert('Error saving: ' + err.message)
    } finally {
      setSaving(false)
    }
  }

  const set = f => e => setForm(prev => ({
    ...prev,
    [f]: e.target.type === 'checkbox' ? e.target.checked : e.target.value,
  }))

  async function handleSave(e) {
    e.preventDefault()
    setSaving(true)
    try {
      if (modal === 'add') await createInsurance(propertyId, form)
      else                 await updateInsurance(modal.id, form)
      setModal(null)
      await load()
    } catch (err) {
      alert('Error: ' + err.message)
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete(id) {
    if (!confirm('Delete this policy?')) return
    await deleteInsurance(id)
    await load()
  }

  async function handleMarkPaid(id, paid) {
    try {
      await markInsurancePaid(id, paid)
      await load()
      if (paid) setPaidReceiptFor(id)   // prompt to attach the receipt
    } catch (err) {
      alert('Error: ' + err.message)
    }
  }

  return (
    <Section
      icon={Shield}
      title={`Insurance (${policies.length})`}
      actions={
        <>
          <input
            ref={fileInputRef}
            type="file"
            accept=".pdf,image/*"
            className="hidden"
            onChange={handleFileSelected}
          />
          <button
            onClick={handleUploadClick}
            onDragOver={e => e.preventDefault()}
            onDrop={e => { e.preventDefault(); processInsuranceFile(e.dataTransfer.files?.[0]) }}
            disabled={uploading}
            title="Upload or drag-and-drop an insurance PDF"
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-blue-50 text-blue-700 border border-blue-200 hover:bg-blue-100 hover:border-blue-300 transition-colors disabled:opacity-60"
          >
            {uploading
              ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Parsing PDF…</>
              : <><FileUp className="w-3.5 h-3.5" /> Upload PDF</>
            }
          </button>
          <button
            onClick={openAdd}
            className="flex items-center gap-1 text-xs text-blue-600 hover:underline font-medium"
          >
            <Plus className="w-3 h-3" /> Add manually
          </button>
        </>
      }
    >
      {/* Upload parse error banner */}
      {parseError && (
        <div className="flex items-start gap-2 px-3 py-2.5 bg-red-50 border border-red-200 rounded-lg text-xs text-red-700">
          <AlertCircle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
          <div>
            <p className="font-semibold">Could not parse document</p>
            <p>{parseError}</p>
          </div>
          <button onClick={() => setParseError(null)} className="ml-auto text-red-400 hover:text-red-600">✕</button>
        </div>
      )}

      {loading ? <p className="text-sm text-slate-400">Loading…</p> : (
        policies.length === 0
          ? (
            <div className="py-6 text-center border border-dashed border-slate-200 rounded-xl">
              <Shield className="w-8 h-8 text-slate-200 mx-auto mb-2" />
              <p className="text-sm text-slate-400">No insurance policies on file.</p>
              <p className="text-xs text-slate-400 mt-1">Upload a PDF or add manually using the buttons above.</p>
            </div>
          )
          : (
            <div className="space-y-4">
              {policies.map(p => {
                const days         = daysUntil(p.expiry_date)
                const expiringSoon = days !== null && days <= 90
                const expired      = days !== null && days < 0

                // Parse extra fields stored in notes
                const noteLines = (p.notes || '').split('\n')
                function noteVal(key) {
                  const line = noteLines.find(l => l.startsWith(key + ': '))
                  return line ? line.slice(key.length + 2).trim() : ''
                }
                const namedInsured    = noteVal('Named Insured')
                const propertyAddress = noteVal('Property Address')
                const premiumDueDate  = noteVal('Premium Due Date')
                const buildingCov     = noteVal('Building Coverage')
                const genLiability    = noteVal('General Liability Coverage')
                const genAggregate    = noteVal('General Aggregate')
                const mortgagee       = noteVal('Mortgagee')
                const constructionType = noteVal('Construction Type')
                const yearBuilt       = noteVal('Year Built')
                const valuationMethod = noteVal('Valuation Method')

                function Row({ label, value, className = '' }) {
                  if (!value) return null
                  return (
                    <div className="grid grid-cols-2 gap-2 py-0.5">
                      <span className="text-xs text-slate-400">{label}</span>
                      <span className={`text-xs font-medium text-slate-800 ${className}`}>{value}</span>
                    </div>
                  )
                }

                function SectionHead({ label }) {
                  return (
                    <div className="text-[10px] font-semibold tracking-widest text-slate-400 uppercase mt-3 mb-1 pb-1 border-b border-slate-100 first:mt-0">
                      {label}
                    </div>
                  )
                }

                const expiryDisplay = p.expiry_date
                  ? `${fmtDate(p.expiry_date)}${days !== null ? ` (${expired ? 'expired' : days + 'd'})` : ''}`
                  : ''

                return (
                  <div
                    key={p.id}
                    className={`p-4 rounded-xl border ${
                      expired      ? 'border-red-200 bg-red-50' :
                      expiringSoon ? 'border-amber-200 bg-amber-50' :
                                     'border-slate-200 bg-white'
                    }`}
                  >
                    {/* Card header with paid badge + edit/delete */}
                    <div className="flex items-start justify-between gap-3 mb-3">
                      <div className="flex items-start gap-3">
                        {/* Paid status badge */}
                        {p.paid_status === 'paid' ? (
                          <div className="flex flex-col items-center">
                            <span className="px-2.5 py-1 rounded-lg bg-green-100 border border-green-300 text-green-700 text-xs font-black tracking-widest uppercase">PAID</span>
                            {p.paid_date && <span className="text-[10px] text-green-600 mt-0.5">{fmtDate(p.paid_date)}</span>}
                          </div>
                        ) : (
                          <span className="px-2.5 py-1 rounded-lg bg-red-100 border border-red-300 text-red-700 text-xs font-black tracking-widest uppercase">UNPAID</span>
                        )}
                        <div>
                          <p className="text-sm font-semibold text-slate-900">{p.carrier || 'Unknown carrier'}</p>
                          {p.policy_number && <p className="text-xs text-slate-500 font-mono mt-0.5">{p.policy_number}</p>}
                        </div>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        {/* Mark as Paid / Undo */}
                        {p.paid_status === 'paid' ? (
                          <button
                            onClick={() => handleMarkPaid(p.id, false)}
                            className="px-2.5 py-1 rounded-lg text-xs font-medium bg-slate-100 text-slate-500 border border-slate-200 hover:bg-slate-200 transition-colors"
                          >
                            Undo
                          </button>
                        ) : (
                          <button
                            onClick={() => handleMarkPaid(p.id, true)}
                            className="px-2.5 py-1 rounded-lg text-xs font-semibold bg-green-600 text-white hover:bg-green-700 transition-colors"
                          >
                            Mark as Paid
                          </button>
                        )}
                        <button onClick={() => openEdit(p)} className="p-1.5 rounded hover:bg-white/80 text-slate-400 hover:text-slate-600 transition-colors">
                          <Pencil className="w-3.5 h-3.5" />
                        </button>
                        <button onClick={() => handleDelete(p.id)} className="p-1.5 rounded hover:bg-red-100 text-slate-400 hover:text-red-500 transition-colors">
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>

                    {/* Two-column sectioned layout */}
                    <div className="grid grid-cols-2 gap-x-6">

                      {/* Left column */}
                      <div>
                        <SectionHead label="POLICY INFO" />
                        <Row label="Insurance Company" value={p.carrier} />
                        <Row label="Policy Number"     value={p.policy_number} />
                        <Row label="Named Insured"     value={namedInsured} />
                        <Row label="Agent Name"        value={p.agent_name} />
                        <Row label="Agent Phone"       value={p.agent_phone} />

                        <SectionHead label="PROPERTY" />
                        <Row label="Property Address"  value={propertyAddress} />
                        <Row label="Construction Type" value={constructionType} />
                        <Row label="Year Built"        value={yearBuilt} />
                        <Row label="Valuation Method"  value={valuationMethod} />
                      </div>

                      {/* Right column */}
                      <div>
                        <SectionHead label="COVERAGE & COSTS" />
                        <Row label="Premium"          value={p.premium != null && p.premium !== '' ? fmt(p.premium) : ''} />
                        {(() => {
                          let items = []
                          try { items = p.premium_breakdown ? JSON.parse(p.premium_breakdown) : [] } catch { /* ignore */ }
                          if (!Array.isArray(items) || items.length === 0) return null
                          return (
                            <div className="ml-1 pl-3 border-l-2 border-slate-100 my-1 space-y-0.5">
                              {items.map((it, i) => (
                                <div key={i} className="flex items-center justify-between gap-2 text-xs text-slate-500">
                                  <span className="truncate">{it.label || '—'}</span>
                                  <span className="tabular-nums shrink-0">{it.amount || ''}</span>
                                </div>
                              ))}
                            </div>
                          )
                        })()}
                        <Row label="Premium Due Date" value={premiumDueDate} />
                        <Row label="Deductible"       value={p.deductible != null && p.deductible !== '' ? fmt(p.deductible) : ''} />
                        <Row label="Building Coverage"    value={buildingCov  || (p.coverage_amount != null && p.coverage_amount !== '' ? fmt(p.coverage_amount) : '')} />
                        <Row label="General Liability"    value={genLiability} />
                        <Row label="General Aggregate"    value={genAggregate} />

                        <SectionHead label="DATES" />
                        <Row label="Effective Date"   value={fmtDate(p.effective_date)} />
                        <Row
                          label="Expiration Date"
                          value={expiryDisplay}
                          className={expired ? 'text-red-600' : expiringSoon ? 'text-amber-700' : ''}
                        />

                        {mortgagee && (
                          <>
                            <SectionHead label="MORTGAGE" />
                            <Row label="Mortgagee" value={mortgagee} />
                          </>
                        )}
                      </div>

                    </div>

                    <InsuranceReimbursement policy={p} />
                  </div>
                )
              })}
            </div>
          )
      )}

      {/* Proof-of-payment prompt — shown right after marking a policy paid */}
      {paidReceiptFor && (
        <Modal isOpen onClose={() => setPaidReceiptFor(null)} title="Upload proof of payment" size="sm">
          <div className="p-5 space-y-3">
            <p className="text-sm text-slate-500">Marked paid. Attach the receipt / proof of payment — it'll be ready to include in the tenant reimbursement email.</p>
            <DropZone
              accept=".pdf,image/*"
              busy={receiptBusy}
              label="Drop the receipt or click to browse"
              onFile={async (file) => {
                if (!file) return
                setReceiptBusy(true)
                try { await uploadInsuranceDoc(paidReceiptFor, file, 'Proof of Payment'); setPaidReceiptFor(null); await load() }
                catch (e) { alert(e.message) } finally { setReceiptBusy(false) }
              }}
            />
            <div className="text-right"><button onClick={() => setPaidReceiptFor(null)} className="text-xs text-slate-500 hover:text-slate-700">Skip for now</button></div>
          </div>
        </Modal>
      )}

      {/* Extraction review modal — shown after PDF parse, before saving */}
      <Modal
        isOpen={!!extractedData}
        onClose={() => setExtractedData(null)}
        title="Extracted Insurance Data"
        size="lg"
      >
        <div className="px-6 py-5 space-y-5">
          <p className="text-xs text-slate-500 bg-slate-50 border border-slate-200 rounded-lg px-3 py-2">
            Review the information extracted from the PDF, then click <strong>Save Policy</strong> to add it to this property.
          </p>

          <div className="grid grid-cols-2 gap-x-6 gap-y-5">
            {INS_REVIEW_SECTIONS.map(section => (
              <div key={section.label} className={section.span === 2 ? 'col-span-2' : ''}>
                <div className="text-[10px] font-semibold tracking-widest text-slate-400 uppercase mb-2 pb-1.5 border-b border-slate-100">
                  {section.label}
                </div>
                <table className="w-full text-xs">
                  <tbody>
                    {section.fields.map(f => (
                      <tr key={f.key} className="border-b border-slate-50 last:border-0">
                        <td className="py-1 pr-4 text-slate-500 whitespace-nowrap w-2/5">{f.label}</td>
                        <td className="py-1 text-slate-900 font-medium">
                          {extractedData?.[f.key] || <span className="text-slate-300">—</span>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ))}
          </div>

          <div className="flex justify-end gap-2 pt-1 border-t border-slate-100">
            <Button type="button" variant="secondary" onClick={() => setExtractedData(null)}>Discard</Button>
            <Button type="button" disabled={saving} onClick={handleSaveExtracted}>
              {saving ? 'Saving…' : 'Save Policy'}
            </Button>
          </div>
        </div>
      </Modal>

      {/* Add / Edit policy modal */}
      <Modal
        isOpen={!!modal}
        onClose={() => setModal(null)}
        title={modal === 'add' ? 'Add Insurance Policy' : 'Edit Insurance Policy'}
        size="lg"
      >
        <form onSubmit={handleSave} className="px-6 py-5 space-y-4">
          {modal === 'add' && (
            <p className="text-xs text-slate-500 bg-slate-50 border border-slate-200 rounded-lg px-3 py-2">
              Review the extracted fields below, fill in anything missing, then click Save.
            </p>
          )}
          <div className="grid grid-cols-2 gap-3">
            <Input label="Carrier"       value={form.carrier || ''}       onChange={set('carrier')}       placeholder="State Farm" autoFocus />
            <Input label="Policy number" value={form.policy_number || ''} onChange={set('policy_number')} placeholder="ABC-123456" />
          </div>
          <div className="grid grid-cols-3 gap-3">
            <Input label="Annual premium ($)"  type="number" step="0.01" value={form.premium || ''}         onChange={set('premium')} />
            <Input label="Coverage amount ($)" type="number"             value={form.coverage_amount || ''} onChange={set('coverage_amount')} />
            <Input label="Deductible ($)"      type="number"             value={form.deductible || ''}      onChange={set('deductible')} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Input label="Coverage start date" type="date" value={form.effective_date || ''} onChange={set('effective_date')} />
            <Input label="Coverage end date"   type="date" value={form.expiry_date || ''}    onChange={set('expiry_date')} />
          </div>
          <div className="grid grid-cols-3 gap-3">
            <Input label="Agent name"  value={form.agent_name  || ''} onChange={set('agent_name')} />
            <Input label="Agent phone" value={form.agent_phone || ''} onChange={set('agent_phone')} />
            <Input label="Agent email" value={form.agent_email || ''} onChange={set('agent_email')} />
          </div>
          <Textarea label="Notes" value={form.notes || ''} onChange={set('notes')} />
          <div className="flex justify-end gap-2 pt-1">
            <Button type="button" variant="secondary" onClick={() => setModal(null)}>Cancel</Button>
            <Button type="submit" disabled={saving}>{saving ? 'Saving…' : 'Save policy'}</Button>
          </div>
        </form>
      </Modal>
    </Section>
  )
}

// ── Taxes Section ─────────────────────────────────────────────────────────────

function TaxesSection({ propertyId }) {
  const [taxes, setTaxes]     = useState([])
  const [loading, setLoading] = useState(true)
  const [modal, setModal]     = useState(null)
  const [form, setForm]       = useState({})
  const [saving, setSaving]   = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try { setTaxes(await getPropertyTaxes(propertyId)) } catch {}
    setLoading(false)
  }, [propertyId])

  useEffect(() => { load() }, [load])

  const EMPTY = {
    tax_year: new Date().getFullYear(), due_date: '', amount: '',
    paid_date: '', paid_amount: '', parcel_number: '', taxing_authority: '', notes: '',
  }

  function openAdd() { setForm(EMPTY); setModal('add') }
  function openEdit(t) { setForm({ ...EMPTY, ...t }); setModal(t) }
  const set = f => e => setForm(prev => ({ ...prev, [f]: e.target.value }))

  async function handleSave(e) {
    e.preventDefault()
    setSaving(true)
    try {
      if (modal === 'add') await createTax(propertyId, form)
      else                 await updateTax(modal.id, form)
      setModal(null)
      await load()
    } catch (err) {
      alert('Error: ' + err.message)
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete(id) {
    if (!confirm('Delete this tax record?')) return
    await deleteTax(id)
    await load()
  }

  return (
    <Section
      icon={Receipt}
      title={`Property Taxes (${taxes.length})`}
      actions={
        <button onClick={openAdd} className="flex items-center gap-1 text-xs text-blue-600 hover:underline font-medium">
          <Plus className="w-3 h-3" /> Add tax record
        </button>
      }
    >
      {loading ? <p className="text-sm text-slate-400">Loading…</p> : (
        taxes.length === 0
          ? <p className="text-sm text-slate-400 py-2">No tax records on file.</p>
          : (
            <div className="overflow-hidden border border-slate-200 rounded-xl">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-slate-50 text-xs font-semibold text-slate-500 uppercase tracking-wide">
                    <th className="px-4 py-2.5 text-left">Year</th>
                    <th className="px-4 py-2.5 text-left">Amount</th>
                    <th className="px-4 py-2.5 text-left">Due</th>
                    <th className="px-4 py-2.5 text-left">Paid</th>
                    <th className="px-4 py-2.5 text-left">Authority</th>
                    <th className="px-4 py-2.5"></th>
                  </tr>
                </thead>
                <tbody>
                  {taxes.map(t => (
                    <tr key={t.id} className="border-t border-slate-100 hover:bg-slate-50">
                      <td className="px-4 py-3 font-medium">{t.tax_year || '—'}</td>
                      <td className="px-4 py-3">{fmt(t.amount)}</td>
                      <td className="px-4 py-3 text-slate-500">{fmtDate(t.due_date)}</td>
                      <td className="px-4 py-3">
                        {t.paid_date
                          ? <span className="inline-flex items-center gap-1 text-xs text-green-700 bg-green-50 px-1.5 py-0.5 rounded-full font-medium">
                              <CheckCircle2 className="w-3 h-3" />{fmtDate(t.paid_date)}
                            </span>
                          : <span className="text-xs text-amber-600 font-medium">Unpaid</span>
                        }
                      </td>
                      <td className="px-4 py-3 text-slate-500">{t.taxing_authority || '—'}</td>
                      <td className="px-4 py-3">
                        <div className="flex gap-1 justify-end">
                          <button onClick={() => openEdit(t)} className="p-1 rounded hover:bg-slate-100 text-slate-400 hover:text-slate-600"><Pencil className="w-3.5 h-3.5" /></button>
                          <button onClick={() => handleDelete(t.id)} className="p-1 rounded hover:bg-red-50 text-slate-400 hover:text-red-500"><Trash2 className="w-3.5 h-3.5" /></button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
      )}

      <Modal isOpen={!!modal} onClose={() => setModal(null)} title={modal === 'add' ? 'Add Tax Record' : 'Edit Tax Record'} size="md">
        <form onSubmit={handleSave} className="px-6 py-5 space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <Input label="Tax year" type="number" value={form.tax_year || ''} onChange={set('tax_year')} />
            <Input label="Amount ($)" type="number" step="0.01" value={form.amount || ''} onChange={set('amount')} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Input label="Due date"  type="date" value={form.due_date  || ''} onChange={set('due_date')} />
            <Input label="Paid date" type="date" value={form.paid_date || ''} onChange={set('paid_date')} />
          </div>
          <Input label="Paid amount ($)" type="number" step="0.01" value={form.paid_amount || ''} onChange={set('paid_amount')} />
          <div className="grid grid-cols-2 gap-3">
            <Input label="Parcel number"    value={form.parcel_number    || ''} onChange={set('parcel_number')} />
            <Input label="Taxing authority" value={form.taxing_authority || ''} onChange={set('taxing_authority')} placeholder="County Assessor" />
          </div>
          <Textarea label="Notes" value={form.notes || ''} onChange={set('notes')} />
          <div className="flex justify-end gap-2 pt-1">
            <Button type="button" variant="secondary" onClick={() => setModal(null)}>Cancel</Button>
            <Button type="submit" disabled={saving}>{saving ? 'Saving…' : 'Save'}</Button>
          </div>
        </form>
      </Modal>
    </Section>
  )
}

// ── Maintenance Section ───────────────────────────────────────────────────────

function MaintenanceSection({ propertyId }) {
  const [records, setRecords]     = useState([])
  const [loading, setLoading]     = useState(true)
  const [modal, setModal]         = useState(null)
  const [form, setForm]           = useState({})
  const [saving, setSaving]       = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try { setRecords(await getPropertyMaintenance(propertyId)) } catch {}
    setLoading(false)
  }, [propertyId])

  useEffect(() => { load() }, [load])

  const EMPTY = {
    date: new Date().toISOString().slice(0, 10), vendor: '', description: '',
    category: 'Other', cost: '', invoice_number: '', notes: '',
  }

  function openAdd() { setForm(EMPTY); setModal('add') }
  function openEdit(r) { setForm({ ...EMPTY, ...r }); setModal(r) }
  const set = f => e => setForm(prev => ({ ...prev, [f]: e.target.value }))

  async function handleSave(e) {
    e.preventDefault()
    setSaving(true)
    try {
      if (modal === 'add') await createMaintenance(propertyId, form)
      else                 await updateMaintenance(modal.id, form)
      setModal(null)
      await load()
    } catch (err) {
      alert('Error: ' + err.message)
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete(id) {
    if (!confirm('Delete this maintenance record?')) return
    await deleteMaintenance(id)
    await load()
  }

  const totalCost = records.reduce((s, r) => s + (r.cost || 0), 0)

  return (
    <Section
      icon={Wrench}
      title={`Maintenance Log${records.length > 0 ? ` (${records.length} records · ${fmt(totalCost)} total)` : ''}`}
      actions={
        <button onClick={openAdd} className="flex items-center gap-1 text-xs text-blue-600 hover:underline font-medium">
          <Plus className="w-3 h-3" /> Add record
        </button>
      }
    >
      {loading ? <p className="text-sm text-slate-400">Loading…</p> : (
        records.length === 0
          ? <p className="text-sm text-slate-400 py-2">No maintenance records.</p>
          : (
            <div className="overflow-hidden border border-slate-200 rounded-xl">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-slate-50 text-xs font-semibold text-slate-500 uppercase tracking-wide">
                    <th className="px-4 py-2.5 text-left">Date</th>
                    <th className="px-4 py-2.5 text-left">Description</th>
                    <th className="px-4 py-2.5 text-left">Category</th>
                    <th className="px-4 py-2.5 text-left">Vendor</th>
                    <th className="px-4 py-2.5 text-left">Cost</th>
                    <th className="px-4 py-2.5"></th>
                  </tr>
                </thead>
                <tbody>
                  {records.map(r => (
                    <tr key={r.id} className="border-t border-slate-100 hover:bg-slate-50">
                      <td className="px-4 py-3 text-slate-500 whitespace-nowrap">{fmtDate(r.date)}</td>
                      <td className="px-4 py-3 font-medium max-w-xs truncate">{r.description}</td>
                      <td className="px-4 py-3">
                        <span className="text-xs bg-slate-100 text-slate-600 px-1.5 py-0.5 rounded-full">{r.category}</span>
                      </td>
                      <td className="px-4 py-3 text-slate-500">{r.vendor || '—'}</td>
                      <td className="px-4 py-3 font-medium">{r.cost != null ? fmt(r.cost) : '—'}</td>
                      <td className="px-4 py-3">
                        <div className="flex gap-1 justify-end">
                          <button onClick={() => openEdit(r)} className="p-1 rounded hover:bg-slate-100 text-slate-400 hover:text-slate-600"><Pencil className="w-3.5 h-3.5" /></button>
                          <button onClick={() => handleDelete(r.id)} className="p-1 rounded hover:bg-red-50 text-slate-400 hover:text-red-500"><Trash2 className="w-3.5 h-3.5" /></button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
      )}

      <Modal isOpen={!!modal} onClose={() => setModal(null)} title={modal === 'add' ? 'Add Maintenance Record' : 'Edit Maintenance Record'} size="md">
        <form onSubmit={handleSave} className="px-6 py-5 space-y-3">
          <Input label="Description *" value={form.description || ''} onChange={set('description')} autoFocus />
          <div className="grid grid-cols-2 gap-3">
            <Input label="Date *" type="date" value={form.date || ''} onChange={set('date')} />
            <Select label="Category" value={form.category || 'Other'} onChange={set('category')}>
              {MAINT_CATS.map(c => <option key={c} value={c}>{c}</option>)}
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Input label="Vendor"  value={form.vendor  || ''} onChange={set('vendor')} />
            <Input label="Cost ($)" type="number" step="0.01" value={form.cost || ''} onChange={set('cost')} />
          </div>
          <Input label="Invoice #" value={form.invoice_number || ''} onChange={set('invoice_number')} />
          <Textarea label="Notes" value={form.notes || ''} onChange={set('notes')} />
          <div className="flex justify-end gap-2 pt-1">
            <Button type="button" variant="secondary" onClick={() => setModal(null)}>Cancel</Button>
            <Button type="submit" disabled={saving || !form.description?.trim() || !form.date}>
              {saving ? 'Saving…' : 'Save'}
            </Button>
          </div>
        </form>
      </Modal>
    </Section>
  )
}

// ── Contacts Section ──────────────────────────────────────────────────────────

function ContactsSection({ propertyId }) {
  const [contacts, setContacts] = useState([])
  const [loading, setLoading]   = useState(true)
  const [modal, setModal]       = useState(null)
  const [form, setForm]         = useState({})
  const [saving, setSaving]     = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try { setContacts(await getPropertyContacts(propertyId)) } catch {}
    setLoading(false)
  }, [propertyId])

  useEffect(() => { load() }, [load])

  const EMPTY = { name: '', role: 'Property Manager', company: '', phone: '', email: '', notes: '' }
  // A role that isn't one of the presets (incl. blank) is a custom "Other" value.
  const isOtherRole = !KNOWN_ROLES.includes(form.role)

  function openAdd() { setForm(EMPTY); setModal('add') }
  function openEdit(c) { setForm({ ...EMPTY, ...c }); setModal(c) }
  const set = f => e => setForm(prev => ({ ...prev, [f]: e.target.value }))

  async function handleSave(e) {
    e.preventDefault()
    setSaving(true)
    try {
      if (modal === 'add') await createContact(propertyId, form)
      else                 await updateContact(modal.id, form)
      setModal(null)
      await load()
    } catch (err) {
      alert('Error: ' + err.message)
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete(id) {
    if (!confirm('Remove this contact?')) return
    await deleteContact(id)
    await load()
  }

  return (
    <Section
      icon={Users}
      title={`Vendor Contacts (${contacts.length})`}
      actions={
        <button onClick={openAdd} className="flex items-center gap-1 text-xs text-blue-600 hover:underline font-medium">
          <Plus className="w-3 h-3" /> Add contact
        </button>
      }
    >
      {loading ? <p className="text-sm text-slate-400">Loading…</p> : (
        contacts.length === 0
          ? <p className="text-sm text-slate-400 py-2">No contacts on file.</p>
          : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
              {contacts.map(c => (
                <div key={c.id} className="flex items-start gap-3 p-3 bg-white border border-slate-200 rounded-xl">
                  <div className="w-8 h-8 rounded-lg bg-slate-100 flex items-center justify-center text-xs font-bold text-slate-500 shrink-0">
                    {c.name[0].toUpperCase()}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-slate-900">{c.name}</p>
                    <p className="text-xs text-slate-500">{c.role}{c.company ? ` · ${c.company}` : ''}</p>
                    {c.phone && <p className="text-xs text-slate-600 mt-0.5">{c.phone}</p>}
                    {c.email && <a href={`mailto:${c.email}`} className="text-xs text-blue-600 hover:underline">{c.email}</a>}
                  </div>
                  <div className="flex gap-1 shrink-0">
                    <button onClick={() => openEdit(c)} className="p-1 rounded hover:bg-slate-100 text-slate-400 hover:text-slate-600"><Pencil className="w-3.5 h-3.5" /></button>
                    <button onClick={() => handleDelete(c.id)} className="p-1 rounded hover:bg-red-50 text-slate-400 hover:text-red-500"><Trash2 className="w-3.5 h-3.5" /></button>
                  </div>
                </div>
              ))}
            </div>
          )
      )}

      <Modal isOpen={!!modal} onClose={() => setModal(null)} title={modal === 'add' ? 'Add Contact' : 'Edit Contact'} size="md">
        <form onSubmit={handleSave} className="px-6 py-5 space-y-3">
          <Input label="Name *" value={form.name || ''} onChange={set('name')} autoFocus />
          <div className="grid grid-cols-2 gap-3">
            <Select
              label="Role"
              value={isOtherRole ? 'Other' : form.role}
              onChange={e => { const v = e.target.value; setForm(prev => ({ ...prev, role: v === 'Other' ? '' : v })) }}
            >
              {CONTACT_ROLES.map(r => <option key={r} value={r}>{r}</option>)}
            </Select>
            <Input label="Company" value={form.company || ''} onChange={set('company')} />
          </div>
          {isOtherRole && (
            <Input
              label="Specify role"
              value={form.role || ''}
              onChange={set('role')}
              placeholder="e.g. Roofer, Fire &amp; Safety, Pest Control"
            />
          )}
          <div className="grid grid-cols-2 gap-3">
            <Input label="Phone" value={form.phone || ''} onChange={set('phone')} />
            <Input label="Email" type="email" value={form.email || ''} onChange={set('email')} />
          </div>
          <Textarea label="Notes" value={form.notes || ''} onChange={set('notes')} />
          <div className="flex justify-end gap-2 pt-1">
            <Button type="button" variant="secondary" onClick={() => setModal(null)}>Cancel</Button>
            <Button type="submit" disabled={saving || !form.name?.trim()}>{saving ? 'Saving…' : 'Save'}</Button>
          </div>
        </form>
      </Modal>
    </Section>
  )
}

// ── Main Page ─────────────────────────────────────────────────────────────────

const TABS = [
  { id: 'dash',        label: 'Dashboard',   icon: LayoutDashboard },
  { id: 'lease',       label: 'Lease',       icon: FileText },
  { id: 'tasks',       label: 'Tasks',       icon: ClipboardList },
  { id: 'insurance',   label: 'Insurance',   icon: Shield },
  { id: 'taxes',       label: 'Taxes',       icon: Receipt },
  { id: 'maintenance', label: 'Maintenance', icon: Wrench },
  { id: 'contacts',    label: 'Contacts',    icon: Users },
]

export default function PropertyManagementDetail() {
  const { propertyId }  = useParams()
  const [searchParams]  = useSearchParams()
  const [property, setProperty] = useState(null)
  const [loading, setLoading]   = useState(true)
  const [tab, setTab]           = useState(searchParams.get('tab') || 'dash')

  useEffect(() => {
    setLoading(true)
    getProperty(propertyId)
      .then(p => { setProperty(p); setLoading(false) })
      .catch(() => setLoading(false))
  }, [propertyId])

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-6 h-6 animate-spin text-slate-400" />
      </div>
    )
  }

  if (!property) {
    return <div className="p-6 text-sm text-slate-500">Property not found.</div>
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="px-6 py-4 border-b border-slate-200 bg-white">
        <Link
          to="/management"
          className="flex items-center gap-1 text-xs text-slate-500 hover:text-blue-600 mb-2 w-fit transition-colors"
        >
          <ArrowLeft className="w-3 h-3" /> Back to dashboard
        </Link>
        <div className="flex items-start justify-between gap-3">
          <div>
            <h1 className="text-lg font-bold text-slate-900">{property.address}</h1>
            <p className="text-sm text-slate-500">
              {[property.city, property.state, property.zip].filter(Boolean).join(', ')}
              {property.tenant_brand_name ? ` · ${property.tenant_brand_name}` : ''}
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <TenantNotifyButton propertyId={propertyId} />
            <DriveDocsButton propertyId={propertyId} />
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 px-6 py-2 border-b border-slate-200 bg-white overflow-x-auto">
        {TABS.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium whitespace-nowrap transition-colors ${
              tab === id ? 'bg-blue-50 text-blue-700' : 'text-slate-600 hover:bg-slate-100'
            }`}
          >
            <Icon className="w-3.5 h-3.5" />
            {label}
          </button>
        ))}
        <Link
          to={`/accounting/${propertyId}`}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium whitespace-nowrap transition-colors text-slate-600 hover:bg-slate-100"
          title="Open this property's accounting ledger"
        >
          <Calculator className="w-3.5 h-3.5" />
          Accounting
        </Link>
      </div>

      {/* Tab content */}
      <div className="flex-1 overflow-y-auto p-6">
        {tab === 'dash'        && <DashboardSection   propertyId={propertyId} />}
        {tab === 'lease'       && <LeaseSection       propertyId={propertyId} />}
        {tab === 'tasks'       && <TasksSection       propertyId={propertyId} />}
        {tab === 'insurance'   && <InsuranceSection   propertyId={propertyId} />}
        {tab === 'taxes'       && <TaxesSection       propertyId={propertyId} />}
        {tab === 'maintenance' && <MaintenanceSection propertyId={propertyId} />}
        {tab === 'contacts'    && <ContactsSection    propertyId={propertyId} />}
      </div>
    </div>
  )
}
