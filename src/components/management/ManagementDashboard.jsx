import { useState, useEffect, useCallback } from 'react'
import { Link } from 'react-router-dom'
import {
  Building2, ClipboardList, AlertTriangle, Shield, Receipt,
  ChevronRight, CheckCircle2, Loader2, RefreshCw,
  LayoutGrid, List, ArrowUpDown, ArrowUp, ArrowDown,
} from 'lucide-react'
import { getManagementDashboard, completeTask, getAllManagementTasks } from '../../api/client'

// ── Shared utilities ──────────────────────────────────────────────────────────

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
  insurance:   'bg-blue-100   text-blue-700',
  tax:         'bg-amber-100  text-amber-700',
  inspection:  'bg-purple-100 text-purple-700',
  lease:       'bg-green-100  text-green-700',
  maintenance: 'bg-orange-100 text-orange-700',
  other:       'bg-slate-100  text-slate-600',
}

// ── Stat card ─────────────────────────────────────────────────────────────────

function StatCard({ icon: Icon, label, value, color = 'blue', note }) {
  const bg = {
    blue:  'bg-blue-50   text-blue-600',
    red:   'bg-red-50    text-red-600',
    amber: 'bg-amber-50  text-amber-600',
    green: 'bg-green-50  text-green-600',
    slate: 'bg-slate-100 text-slate-600',
  }
  return (
    <div className="bg-white rounded-xl border border-slate-200 p-4 flex items-center gap-4">
      <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${bg[color]}`}>
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

// ── Property card ─────────────────────────────────────────────────────────────

function PropertyCard({ property, counts = {} }) {
  return (
    <Link
      to={`/management/${property.id}`}
      className="flex flex-col bg-white border border-slate-200 rounded-xl p-4 hover:border-blue-300 hover:shadow-sm transition-all group"
    >
      <div className="flex items-start justify-between gap-2 mb-3">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-slate-900 group-hover:text-blue-700 transition-colors leading-snug truncate">
            {property.address}
          </p>
          <p className="text-xs text-slate-500 mt-0.5 truncate">
            {[property.city, property.state].filter(Boolean).join(', ')}
          </p>
        </div>
        <ChevronRight className="w-4 h-4 text-slate-300 group-hover:text-blue-400 shrink-0 mt-0.5 transition-colors" />
      </div>

      {property.tenant_brand_name && (
        <p className="text-xs font-medium text-slate-600 bg-slate-50 px-2 py-0.5 rounded-full w-fit mb-2.5 truncate">
          {property.tenant_brand_name}
        </p>
      )}

      {/* Task status badges */}
      <div className="flex flex-wrap gap-1.5 mt-auto">
        {counts.overdue > 0 && (
          <span className="inline-flex items-center gap-1 text-xs font-semibold text-red-700 bg-red-100 px-2 py-0.5 rounded-full">
            <AlertTriangle className="w-3 h-3" />
            {counts.overdue} overdue
          </span>
        )}
        {counts.due_soon > 0 && (
          <span className="inline-flex items-center gap-1 text-xs font-semibold text-amber-700 bg-amber-100 px-2 py-0.5 rounded-full">
            {counts.due_soon} due soon
          </span>
        )}
        {counts.completed > 0 && (
          <span className="inline-flex items-center gap-1 text-xs font-medium text-green-700 bg-green-100 px-2 py-0.5 rounded-full">
            <CheckCircle2 className="w-3 h-3" />
            {counts.completed} done
          </span>
        )}
        {!counts.overdue && !counts.due_soon && !counts.completed && (
          <span className="text-xs text-slate-400">No tasks</span>
        )}
      </div>
    </Link>
  )
}

// ── Properties view ───────────────────────────────────────────────────────────

function PropertiesView({ data, onRefresh }) {
  const [propView, setPropView] = useState('cards') // 'cards' | 'list'

  const {
    properties = [],
    task_counts = {},
    overdue_tasks = [],
    insurance_expiring = [],
    maintenance_spend_ytd = 0,
  } = data

  const totalRent = properties.reduce((s, p) => s + (p.annual_rent || 0), 0)

  return (
    <div className="space-y-5">
      {/* Stats bar */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard icon={Building2}     label="Portfolio Properties" value={properties.length}         color="blue"  note={fmt(totalRent) + '/yr rent'} />
        <StatCard icon={AlertTriangle} label="Overdue Tasks"        value={overdue_tasks.length}      color={overdue_tasks.length > 0 ? 'red' : 'green'} />
        <StatCard icon={Shield}        label="Insurance Expiring"   value={insurance_expiring.length} color={insurance_expiring.length > 0 ? 'amber' : 'green'} note="next 90 days" />
        <StatCard icon={Receipt}       label="Maintenance YTD"      value={fmt(maintenance_spend_ytd)} color="slate" />
      </div>

      {/* Alert banners (compact) */}
      {overdue_tasks.length > 0 && (
        <div className="flex items-center gap-3 px-4 py-2.5 bg-red-50 border border-red-200 rounded-xl text-sm">
          <AlertTriangle className="w-4 h-4 text-red-500 shrink-0" />
          <span className="text-red-700 font-medium">
            {overdue_tasks.length} overdue task{overdue_tasks.length !== 1 ? 's' : ''} across your portfolio
          </span>
          <button
            onClick={() => { /* parent handles switching view */ }}
            className="ml-auto text-xs text-red-600 hover:underline font-medium whitespace-nowrap"
          >
            — see All Tasks tab
          </button>
        </div>
      )}

      {/* Property grid header with view toggle */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold text-slate-700 flex items-center gap-2">
            <Building2 className="w-4 h-4 text-slate-400" />
            All Portfolio Properties ({properties.length})
          </h2>

          <div className="flex items-center bg-slate-100 rounded-lg p-0.5 gap-0.5">
            <button
              onClick={() => setPropView('cards')}
              className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-medium transition-colors ${
                propView === 'cards' ? 'bg-white shadow-sm text-slate-900' : 'text-slate-500 hover:text-slate-700'
              }`}
            >
              <LayoutGrid className="w-3.5 h-3.5" /> Cards
            </button>
            <button
              onClick={() => setPropView('list')}
              className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-medium transition-colors ${
                propView === 'list' ? 'bg-white shadow-sm text-slate-900' : 'text-slate-500 hover:text-slate-700'
              }`}
            >
              <List className="w-3.5 h-3.5" /> List
            </button>
          </div>
        </div>

        {properties.length === 0 ? (
          <div className="bg-white border border-dashed border-slate-200 rounded-xl p-10 text-center">
            <Building2 className="w-8 h-8 text-slate-200 mx-auto mb-2" />
            <p className="text-sm text-slate-400">No portfolio properties yet.</p>
            <p className="text-xs text-slate-400 mt-1">Add properties from Knox Portfolio and mark them as portfolio.</p>
          </div>
        ) : propView === 'cards' ? (
          /* Cards grid */
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {properties.map(p => (
              <PropertyCard key={p.id} property={p} counts={task_counts[p.id] || {}} />
            ))}
          </div>
        ) : (
          /* List table */
          <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-slate-50 text-xs font-semibold text-slate-500 uppercase tracking-wide border-b border-slate-200">
                  <th className="px-4 py-3 text-left">Property</th>
                  <th className="px-4 py-3 text-left">City, State</th>
                  <th className="px-4 py-3 text-left">Tenant</th>
                  <th className="px-4 py-3 text-center">Overdue</th>
                  <th className="px-4 py-3 text-center">Due Soon</th>
                  <th className="px-4 py-3 text-center">Completed</th>
                  <th className="px-4 py-3 text-right">Annual Rent</th>
                  <th className="px-4 py-3"></th>
                </tr>
              </thead>
              <tbody>
                {properties.map(p => {
                  const c = task_counts[p.id] || {}
                  return (
                    <tr key={p.id} className="border-t border-slate-100 hover:bg-slate-50 transition-colors">
                      <td className="px-4 py-3 font-medium text-slate-900">{p.address}</td>
                      <td className="px-4 py-3 text-slate-500">{[p.city, p.state].filter(Boolean).join(', ') || '—'}</td>
                      <td className="px-4 py-3 text-slate-500">{p.tenant_brand_name || '—'}</td>
                      <td className="px-4 py-3 text-center">
                        {c.overdue > 0
                          ? <span className="inline-block text-xs font-bold text-red-700 bg-red-100 px-2 py-0.5 rounded-full">{c.overdue}</span>
                          : <span className="text-slate-300 text-xs">—</span>}
                      </td>
                      <td className="px-4 py-3 text-center">
                        {c.due_soon > 0
                          ? <span className="inline-block text-xs font-bold text-amber-700 bg-amber-100 px-2 py-0.5 rounded-full">{c.due_soon}</span>
                          : <span className="text-slate-300 text-xs">—</span>}
                      </td>
                      <td className="px-4 py-3 text-center">
                        {c.completed > 0
                          ? <span className="inline-block text-xs font-bold text-green-700 bg-green-100 px-2 py-0.5 rounded-full">{c.completed}</span>
                          : <span className="text-slate-300 text-xs">—</span>}
                      </td>
                      <td className="px-4 py-3 text-right font-medium text-slate-700">{p.annual_rent ? fmt(p.annual_rent) : '—'}</td>
                      <td className="px-4 py-3">
                        <Link
                          to={`/management/${p.id}`}
                          className="flex items-center gap-1 text-xs text-blue-600 hover:underline font-medium justify-end whitespace-nowrap"
                        >
                          Open <ChevronRight className="w-3 h-3" />
                        </Link>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}

// ── All Tasks view ────────────────────────────────────────────────────────────

function SortIcon({ field, sortField, sortDir }) {
  if (sortField !== field) return <ArrowUpDown className="w-3 h-3 opacity-40" />
  return sortDir === 'asc'
    ? <ArrowUp   className="w-3 h-3 text-blue-600" />
    : <ArrowDown className="w-3 h-3 text-blue-600" />
}

function statusRank(task) {
  if (task.completed_at) return 4
  const days = daysUntil(task.due_date)
  if (days === null)  return 3
  if (days < 0)       return 0   // overdue
  if (days <= 7)      return 1   // due soon
  return 2
}

function AllTasksView() {
  const [tasks, setTasks]         = useState([])
  const [loading, setLoading]     = useState(true)
  const [statusFilter, setStatusFilter] = useState('pending') // 'pending' | 'all'
  const [sortField, setSortField] = useState('due_date')
  const [sortDir, setSortDir]     = useState('asc')
  const [completingIds, setCompletingIds] = useState(new Set())

  const load = useCallback(async () => {
    setLoading(true)
    try {
      setTasks(await getAllManagementTasks(statusFilter))
    } catch (err) {
      console.error('Failed to load tasks:', err)
    } finally {
      setLoading(false)
    }
  }, [statusFilter])

  useEffect(() => { load() }, [load])

  function toggleSort(field) {
    if (sortField === field) {
      setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    } else {
      setSortField(field)
      setSortDir('asc')
    }
  }

  const sorted = [...tasks].sort((a, b) => {
    let av, bv
    if (sortField === 'due_date') {
      av = a.due_date || 'zzz'
      bv = b.due_date || 'zzz'
    } else if (sortField === 'property') {
      av = (a.address || '').toLowerCase()
      bv = (b.address || '').toLowerCase()
    } else if (sortField === 'task_type') {
      av = a.task_type || ''
      bv = b.task_type || ''
    } else if (sortField === 'status') {
      av = statusRank(a)
      bv = statusRank(b)
    } else {
      return 0
    }
    if (av < bv) return sortDir === 'asc' ? -1 : 1
    if (av > bv) return sortDir === 'asc' ?  1 : -1
    return 0
  })

  async function handleComplete(id) {
    setCompletingIds(prev => new Set([...prev, id]))
    try {
      await completeTask(id)
      await load()
    } catch (err) {
      alert('Error: ' + err.message)
    } finally {
      setCompletingIds(prev => { const s = new Set(prev); s.delete(id); return s })
    }
  }

  function Th({ field, label }) {
    return (
      <th
        className="px-4 py-3 text-left cursor-pointer select-none hover:bg-slate-100 transition-colors"
        onClick={() => toggleSort(field)}
      >
        <span className="flex items-center gap-1.5 text-xs font-semibold text-slate-500 uppercase tracking-wide whitespace-nowrap">
          {label} <SortIcon field={field} sortField={sortField} sortDir={sortDir} />
        </span>
      </th>
    )
  }

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex items-center justify-between">
        <div className="flex items-center bg-slate-100 rounded-lg p-0.5 gap-0.5">
          <button
            onClick={() => setStatusFilter('pending')}
            className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
              statusFilter === 'pending' ? 'bg-white shadow-sm text-slate-900' : 'text-slate-500 hover:text-slate-700'
            }`}
          >
            Pending
          </button>
          <button
            onClick={() => setStatusFilter('all')}
            className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
              statusFilter === 'all' ? 'bg-white shadow-sm text-slate-900' : 'text-slate-500 hover:text-slate-700'
            }`}
          >
            All (incl. completed)
          </button>
        </div>
        <p className="text-xs text-slate-400">
          {loading ? 'Loading…' : `${sorted.length} task${sorted.length !== 1 ? 's' : ''}`}
        </p>
      </div>

      {/* Tasks table */}
      {loading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="w-5 h-5 animate-spin text-slate-400" />
        </div>
      ) : sorted.length === 0 ? (
        <div className="bg-white border border-dashed border-slate-200 rounded-xl p-10 text-center">
          <ClipboardList className="w-8 h-8 text-slate-200 mx-auto mb-2" />
          <p className="text-sm text-slate-400">No tasks found.</p>
        </div>
      ) : (
        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200">
                <Th field="property"  label="Property" />
                <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wide">Task</th>
                <Th field="task_type" label="Type" />
                <Th field="due_date"  label="Due Date" />
                <Th field="status"    label="Status" />
                <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wide">Recurs</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody>
              {sorted.map(task => {
                const days        = daysUntil(task.due_date)
                const isOverdue   = !task.completed_at && days !== null && days < 0
                const isDueSoon   = !task.completed_at && !isOverdue && days !== null && days <= 7
                const isDone      = !!task.completed_at
                const completing  = completingIds.has(task.id)

                return (
                  <tr
                    key={task.id}
                    className={`border-t border-slate-100 transition-colors ${
                      isOverdue ? 'bg-red-50/40 hover:bg-red-50' :
                      isDueSoon ? 'bg-amber-50/30 hover:bg-amber-50' :
                                  'hover:bg-slate-50'
                    }`}
                  >
                    {/* Property */}
                    <td className="px-4 py-3">
                      <Link
                        to={`/management/${task.property_id}`}
                        className="text-sm font-medium text-slate-800 hover:text-blue-600 hover:underline leading-tight block"
                      >
                        {task.address}
                      </Link>
                      <p className="text-xs text-slate-400 mt-0.5">
                        {[task.city, task.state].filter(Boolean).join(', ')}
                        {task.tenant_brand_name ? ` · ${task.tenant_brand_name}` : ''}
                      </p>
                    </td>

                    {/* Task title */}
                    <td className="px-4 py-3">
                      <p className={`text-sm font-medium ${isDone ? 'line-through text-slate-400' : 'text-slate-800'}`}>
                        {task.title}
                      </p>
                    </td>

                    {/* Type badge */}
                    <td className="px-4 py-3">
                      <span className={`text-xs px-1.5 py-0.5 rounded-full font-medium ${TASK_TYPE_COLORS[task.task_type] || TASK_TYPE_COLORS.other}`}>
                        {task.task_type}
                      </span>
                    </td>

                    {/* Due date */}
                    <td className={`px-4 py-3 text-sm font-medium whitespace-nowrap ${
                      isOverdue ? 'text-red-600' : isDueSoon ? 'text-amber-600' : 'text-slate-600'
                    }`}>
                      {task.due_date ? fmtDate(task.due_date) : '—'}
                      {isOverdue   && <span className="block text-xs font-normal text-red-400">{Math.abs(days)}d overdue</span>}
                      {isDueSoon   && <span className="block text-xs font-normal text-amber-400">in {days}d</span>}
                    </td>

                    {/* Status */}
                    <td className="px-4 py-3">
                      {isDone ? (
                        <span className="inline-flex items-center gap-1 text-xs font-medium text-green-700 bg-green-100 px-2 py-0.5 rounded-full">
                          <CheckCircle2 className="w-3 h-3" /> Done
                        </span>
                      ) : isOverdue ? (
                        <span className="inline-flex items-center gap-1 text-xs font-medium text-red-700 bg-red-100 px-2 py-0.5 rounded-full">
                          <AlertTriangle className="w-3 h-3" /> Overdue
                        </span>
                      ) : isDueSoon ? (
                        <span className="text-xs font-medium text-amber-700 bg-amber-100 px-2 py-0.5 rounded-full">Due soon</span>
                      ) : (
                        <span className="text-xs text-slate-400">Pending</span>
                      )}
                    </td>

                    {/* Recurs */}
                    <td className="px-4 py-3 text-xs text-slate-400 italic">
                      {task.recurs && task.recurs !== 'none' ? `↺ ${task.recurs}` : '—'}
                    </td>

                    {/* Mark Complete */}
                    <td className="px-4 py-3">
                      {!isDone && (
                        <button
                          onClick={() => handleComplete(task.id)}
                          disabled={completing}
                          className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-semibold bg-green-50 text-green-700 border border-green-200 hover:bg-green-100 transition-colors disabled:opacity-50 whitespace-nowrap"
                        >
                          {completing
                            ? <Loader2 className="w-3 h-3 animate-spin" />
                            : <CheckCircle2 className="w-3 h-3" />
                          }
                          {completing ? 'Saving…' : 'Mark Complete'}
                        </button>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

// ── Main dashboard ────────────────────────────────────────────────────────────

export default function ManagementDashboard() {
  const [data, setData]       = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState(null)
  const [view, setView]       = useState('properties') // 'properties' | 'all-tasks'

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      setData(await getManagementDashboard())
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

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

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 bg-white shrink-0">
        <div>
          <h1 className="text-lg font-bold text-slate-900">Property Management</h1>
          <p className="text-sm text-slate-500">Portfolio overview, tasks, insurance &amp; maintenance</p>
        </div>
        <button
          onClick={load}
          className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-100 rounded-lg transition-colors"
        >
          <RefreshCw className="w-3.5 h-3.5" /> Refresh
        </button>
      </div>

      {/* View tabs */}
      <div className="flex gap-1 px-6 py-2 border-b border-slate-200 bg-white shrink-0">
        <button
          onClick={() => setView('properties')}
          className={`flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-sm font-medium transition-colors ${
            view === 'properties' ? 'bg-blue-50 text-blue-700' : 'text-slate-600 hover:bg-slate-100'
          }`}
        >
          <Building2 className="w-3.5 h-3.5" /> Properties
        </button>
        <button
          onClick={() => setView('all-tasks')}
          className={`flex items-center gap-2 px-4 py-1.5 rounded-lg text-sm font-medium transition-colors ${
            view === 'all-tasks' ? 'bg-blue-50 text-blue-700' : 'text-slate-600 hover:bg-slate-100'
          }`}
        >
          <ClipboardList className="w-3.5 h-3.5" />
          All Tasks
          {/* Overdue badge on the tab */}
          {(data?.overdue_tasks?.length ?? 0) > 0 && (
            <span className="inline-block text-xs font-bold text-white bg-red-500 px-1.5 py-0.5 rounded-full leading-none">
              {data.overdue_tasks.length}
            </span>
          )}
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-6">
        {view === 'properties' && <PropertiesView data={data} onRefresh={load} />}
        {view === 'all-tasks'  && <AllTasksView />}
      </div>
    </div>
  )
}
