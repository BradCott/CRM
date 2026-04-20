import { useState, useEffect, useCallback } from 'react'
import { Link } from 'react-router-dom'
import {
  Building2, ClipboardList, AlertTriangle, Shield,
  Receipt, ChevronRight, CheckCircle2, Loader2, RefreshCw,
} from 'lucide-react'
import { getManagementDashboard, completeTask } from '../../api/client'

function fmt(n) {
  if (n == null) return '—'
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(n)
}

function fmtDate(s) {
  if (!s) return '—'
  return new Date(s + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

function daysUntil(dateStr) {
  if (!dateStr) return null
  const d = new Date(dateStr + 'T12:00:00')
  const today = new Date()
  today.setHours(12, 0, 0, 0)
  return Math.round((d - today) / (1000 * 60 * 60 * 24))
}

const TASK_TYPE_COLORS = {
  insurance:   'bg-blue-100 text-blue-700',
  tax:         'bg-amber-100 text-amber-700',
  inspection:  'bg-purple-100 text-purple-700',
  lease:       'bg-green-100 text-green-700',
  maintenance: 'bg-orange-100 text-orange-700',
  other:       'bg-slate-100 text-slate-600',
}

function StatCard({ icon: Icon, label, value, color = 'blue', note }) {
  const colors = {
    blue:   'bg-blue-50   text-blue-600',
    red:    'bg-red-50    text-red-600',
    amber:  'bg-amber-50  text-amber-600',
    green:  'bg-green-50  text-green-600',
    slate:  'bg-slate-100 text-slate-600',
  }
  return (
    <div className="bg-white rounded-xl border border-slate-200 p-4 flex items-center gap-4">
      <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${colors[color]}`}>
        <Icon className="w-5 h-5" />
      </div>
      <div>
        <p className="text-xs text-slate-500 font-medium">{label}</p>
        <p className="text-xl font-bold text-slate-900">{value}</p>
        {note && <p className="text-xs text-slate-400 mt-0.5">{note}</p>}
      </div>
    </div>
  )
}

function TaskRow({ task, onComplete }) {
  const [completing, setCompleting] = useState(false)
  const days = daysUntil(task.due_date)
  const isOverdue = days !== null && days < 0

  async function handleComplete() {
    setCompleting(true)
    try {
      await onComplete(task.id)
    } finally {
      setCompleting(false)
    }
  }

  return (
    <tr className="hover:bg-slate-50 transition-colors">
      <td className="px-4 py-3 text-sm font-medium text-slate-800">
        <Link to={`/management/${task.property_id}`} className="hover:text-blue-600 hover:underline">
          {task.address}
          {task.city ? `, ${task.city}` : ''}
          {task.state ? ` ${task.state}` : ''}
        </Link>
      </td>
      <td className="px-4 py-3 text-sm text-slate-700">{task.title}</td>
      <td className="px-4 py-3">
        <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${TASK_TYPE_COLORS[task.task_type] || TASK_TYPE_COLORS.other}`}>
          {task.task_type}
        </span>
      </td>
      <td className={`px-4 py-3 text-sm font-medium ${isOverdue ? 'text-red-600' : 'text-slate-700'}`}>
        {fmtDate(task.due_date)}
        {isOverdue && <span className="ml-1 text-xs text-red-500">({Math.abs(days)}d overdue)</span>}
        {!isOverdue && days !== null && days <= 7 && <span className="ml-1 text-xs text-amber-500">({days}d)</span>}
      </td>
      <td className="px-4 py-3">
        <button
          onClick={handleComplete}
          disabled={completing}
          className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium bg-green-50 text-green-700 hover:bg-green-100 transition-colors disabled:opacity-50"
        >
          {completing ? <Loader2 className="w-3 h-3 animate-spin" /> : <CheckCircle2 className="w-3 h-3" />}
          Complete
        </button>
      </td>
    </tr>
  )
}

export default function ManagementDashboard() {
  const [data, setData]       = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const d = await getManagementDashboard()
      setData(d)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  async function handleComplete(taskId) {
    await completeTask(taskId)
    await load()
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-6 h-6 animate-spin text-slate-400" />
      </div>
    )
  }

  if (error) {
    return (
      <div className="p-6">
        <p className="text-red-600 text-sm">Failed to load: {error}</p>
        <button onClick={load} className="mt-2 text-sm text-blue-600 hover:underline">Retry</button>
      </div>
    )
  }

  const { properties = [], tasks_due = [], overdue_tasks = [], insurance_expiring = [], taxes_due = [], maintenance_spend_ytd = 0 } = data

  const totalRent = properties.reduce((s, p) => s + (p.annual_rent || 0), 0)

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 bg-white">
        <div>
          <h1 className="text-lg font-bold text-slate-900">Property Management</h1>
          <p className="text-sm text-slate-500">Tasks, insurance, taxes, maintenance — all in one place</p>
        </div>
        <button onClick={load} className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-100 rounded-lg transition-colors">
          <RefreshCw className="w-3.5 h-3.5" /> Refresh
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-6 space-y-6">

        {/* Stats */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <StatCard icon={Building2}      label="Portfolio Properties"  value={properties.length}         color="blue"  note={`${fmt(totalRent)}/yr rent`} />
          <StatCard icon={AlertTriangle}  label="Overdue Tasks"         value={overdue_tasks.length}      color={overdue_tasks.length > 0 ? 'red' : 'green'} />
          <StatCard icon={Shield}         label="Insurance Expiring"    value={insurance_expiring.length} color={insurance_expiring.length > 0 ? 'amber' : 'green'} note="next 90 days" />
          <StatCard icon={Receipt}        label="Maintenance YTD"       value={fmt(maintenance_spend_ytd)}  color="slate" />
        </div>

        {/* Overdue tasks */}
        {overdue_tasks.length > 0 && (
          <section>
            <h2 className="text-sm font-semibold text-red-700 mb-3 flex items-center gap-2">
              <AlertTriangle className="w-4 h-4" /> Overdue Tasks ({overdue_tasks.length})
            </h2>
            <div className="bg-white border border-red-200 rounded-xl overflow-hidden">
              <table className="w-full">
                <thead>
                  <tr className="bg-red-50 text-xs font-semibold text-red-700 uppercase tracking-wide">
                    <th className="px-4 py-2.5 text-left">Property</th>
                    <th className="px-4 py-2.5 text-left">Task</th>
                    <th className="px-4 py-2.5 text-left">Type</th>
                    <th className="px-4 py-2.5 text-left">Was Due</th>
                    <th className="px-4 py-2.5 text-left"></th>
                  </tr>
                </thead>
                <tbody>
                  {overdue_tasks.map(t => (
                    <TaskRow key={t.id} task={t} onComplete={handleComplete} />
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}

        {/* Upcoming tasks (next 30 days, excluding overdue) */}
        {tasks_due.filter(t => daysUntil(t.due_date) >= 0).length > 0 && (
          <section>
            <h2 className="text-sm font-semibold text-slate-700 mb-3 flex items-center gap-2">
              <ClipboardList className="w-4 h-4" /> Upcoming Tasks — Next 30 Days
            </h2>
            <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
              <table className="w-full">
                <thead>
                  <tr className="bg-slate-50 text-xs font-semibold text-slate-500 uppercase tracking-wide">
                    <th className="px-4 py-2.5 text-left">Property</th>
                    <th className="px-4 py-2.5 text-left">Task</th>
                    <th className="px-4 py-2.5 text-left">Type</th>
                    <th className="px-4 py-2.5 text-left">Due</th>
                    <th className="px-4 py-2.5 text-left"></th>
                  </tr>
                </thead>
                <tbody>
                  {tasks_due.filter(t => daysUntil(t.due_date) >= 0).map(t => (
                    <TaskRow key={t.id} task={t} onComplete={handleComplete} />
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}

        {/* Insurance expiring */}
        {insurance_expiring.length > 0 && (
          <section>
            <h2 className="text-sm font-semibold text-slate-700 mb-3 flex items-center gap-2">
              <Shield className="w-4 h-4 text-amber-500" /> Insurance Expiring — Next 90 Days
            </h2>
            <div className="bg-white border border-amber-200 rounded-xl overflow-hidden">
              <table className="w-full">
                <thead>
                  <tr className="bg-amber-50 text-xs font-semibold text-amber-700 uppercase tracking-wide">
                    <th className="px-4 py-2.5 text-left">Property</th>
                    <th className="px-4 py-2.5 text-left">Carrier</th>
                    <th className="px-4 py-2.5 text-left">Policy #</th>
                    <th className="px-4 py-2.5 text-left">Premium</th>
                    <th className="px-4 py-2.5 text-left">Expires</th>
                  </tr>
                </thead>
                <tbody>
                  {insurance_expiring.map(ins => {
                    const days = daysUntil(ins.expiry_date)
                    return (
                      <tr key={ins.id} className="hover:bg-slate-50 border-b border-slate-100 last:border-0">
                        <td className="px-4 py-3 text-sm font-medium">
                          <Link to={`/management/${ins.property_id}`} className="hover:text-blue-600 hover:underline">
                            {ins.address}{ins.city ? `, ${ins.city}` : ''}{ins.state ? ` ${ins.state}` : ''}
                          </Link>
                        </td>
                        <td className="px-4 py-3 text-sm text-slate-700">{ins.carrier || '—'}</td>
                        <td className="px-4 py-3 text-sm text-slate-500 font-mono text-xs">{ins.policy_number || '—'}</td>
                        <td className="px-4 py-3 text-sm text-slate-700">{fmt(ins.premium)}</td>
                        <td className={`px-4 py-3 text-sm font-medium ${days !== null && days <= 30 ? 'text-red-600' : 'text-amber-600'}`}>
                          {fmtDate(ins.expiry_date)}
                          {days !== null && <span className="ml-1 text-xs opacity-75">({days}d)</span>}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </section>
        )}

        {/* Taxes due */}
        {taxes_due.length > 0 && (
          <section>
            <h2 className="text-sm font-semibold text-slate-700 mb-3 flex items-center gap-2">
              <Receipt className="w-4 h-4 text-blue-500" /> Tax Payments Due — Next 90 Days
            </h2>
            <div className="bg-white border border-blue-200 rounded-xl overflow-hidden">
              <table className="w-full">
                <thead>
                  <tr className="bg-blue-50 text-xs font-semibold text-blue-700 uppercase tracking-wide">
                    <th className="px-4 py-2.5 text-left">Property</th>
                    <th className="px-4 py-2.5 text-left">Year</th>
                    <th className="px-4 py-2.5 text-left">Amount</th>
                    <th className="px-4 py-2.5 text-left">Due</th>
                  </tr>
                </thead>
                <tbody>
                  {taxes_due.map(tax => (
                    <tr key={tax.id} className="hover:bg-slate-50 border-b border-slate-100 last:border-0">
                      <td className="px-4 py-3 text-sm font-medium">
                        <Link to={`/management/${tax.property_id}`} className="hover:text-blue-600 hover:underline">
                          {tax.address}{tax.city ? `, ${tax.city}` : ''}{tax.state ? ` ${tax.state}` : ''}
                        </Link>
                      </td>
                      <td className="px-4 py-3 text-sm text-slate-700">{tax.tax_year || '—'}</td>
                      <td className="px-4 py-3 text-sm font-medium text-slate-900">{fmt(tax.amount)}</td>
                      <td className="px-4 py-3 text-sm font-medium text-amber-700">{fmtDate(tax.due_date)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}

        {/* Portfolio property list */}
        <section>
          <h2 className="text-sm font-semibold text-slate-700 mb-3 flex items-center gap-2">
            <Building2 className="w-4 h-4" /> All Portfolio Properties
          </h2>
          {properties.length === 0 ? (
            <div className="bg-white border border-slate-200 rounded-xl p-8 text-center text-sm text-slate-400">
              No portfolio properties yet. Add properties from Knox Portfolio and mark them as portfolio.
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {properties.map(p => (
                <Link
                  key={p.id}
                  to={`/management/${p.id}`}
                  className="flex items-center justify-between bg-white border border-slate-200 rounded-xl p-4 hover:border-blue-300 hover:shadow-sm transition-all group"
                >
                  <div>
                    <p className="text-sm font-semibold text-slate-900 group-hover:text-blue-700 transition-colors">{p.address}</p>
                    <p className="text-xs text-slate-500 mt-0.5">
                      {[p.city, p.state].filter(Boolean).join(', ')}
                      {p.tenant_brand_name ? ` · ${p.tenant_brand_name}` : ''}
                    </p>
                    {p.annual_rent && <p className="text-xs text-green-600 font-medium mt-1">{fmt(p.annual_rent)}/yr</p>}
                  </div>
                  <ChevronRight className="w-4 h-4 text-slate-400 group-hover:text-blue-500 transition-colors shrink-0" />
                </Link>
              ))}
            </div>
          )}
        </section>

      </div>
    </div>
  )
}
