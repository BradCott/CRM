// My Tasks — dashboard widget replacing "Today's Plays".
// Shows overdue + due-today + high-priority tasks (max ~10), with live counts
// and a link to the full /tasks page.
import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { ListTodo, Check, X, Loader2, Plus, ArrowRight, AlertCircle } from 'lucide-react'
import { getTasks, createTask, completeTask, updateTask } from '../../api/client'

const todayStr = () => new Date().toLocaleDateString('en-CA')

const PRIORITY_DOT = { high: 'bg-red-500', normal: 'bg-slate-300', low: 'bg-slate-200' }

export default function MyTasksWidget() {
  const navigate = useNavigate()
  const [tasks, setTasks]   = useState([])
  const [loading, setLoad]  = useState(true)
  const [busy, setBusy]     = useState(null)
  const [adding, setAdding] = useState(false)
  const [title, setTitle]   = useState('')

  const load = useCallback(() => {
    getTasks({ owner: 'me' }).then(setTasks).catch(console.error).finally(() => setLoad(false))
  }, [])
  useEffect(() => { load() }, [load])

  const today = todayStr()
  const active  = tasks.filter(t => t.status === 'open' || t.status === 'waiting')
  const counts  = {
    overdue: active.filter(t => t.due_date && t.due_date < today && t.status !== 'waiting').length,
    today:   active.filter(t => t.due_date === today && t.status !== 'waiting').length,
    waiting: active.filter(t => t.status === 'waiting').length,
  }

  // Surface urgent work first (overdue / due today / high priority), then fall
  // back to the rest of the open backlog so the widget reflects that there are
  // open tasks instead of reading "all clear" while the list sits full. Waiting
  // tasks are tracked in the counts, not shown as rows.
  const nonWaiting = active.filter(t => t.status !== 'waiting')
  const isUrgent = t => (t.due_date && t.due_date <= today) || t.priority === 'high'
  const byDue = (a, b) => (a.due_date || '9999-99-99').localeCompare(b.due_date || '9999-99-99')
  const urgent = nonWaiting.filter(isUrgent).sort(byDue)
  const rest   = nonWaiting.filter(t => !isUrgent(t)).sort(byDue)
  const focus  = [...urgent, ...rest].slice(0, 10)

  async function act(id, fn) {
    setBusy(id)
    try { await fn(); setTasks(prev => prev.filter(t => t.id !== id)) }
    catch (e) { console.error(e) }
    finally { setBusy(null) }
  }

  async function handleAdd(e) {
    e.preventDefault()
    if (!title.trim()) return
    const created = await createTask({ title: title.trim() })
    setTasks(prev => [created, ...prev])
    setTitle(''); setAdding(false)
  }

  return (
    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
      <div className="flex items-center justify-between px-5 py-3.5 border-b border-slate-100">
        <div className="flex items-center gap-2">
          <ListTodo className="w-4 h-4 text-blue-600" />
          <h2 className="text-sm font-bold text-slate-800">My Tasks</h2>
          <span className="text-xs text-slate-400">
            {counts.overdue} overdue · {counts.today} today · {counts.waiting} waiting
          </span>
        </div>
        <div className="flex items-center gap-1">
          <button onClick={() => setAdding(a => !a)} title="Add a task"
            className="p-1 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100"><Plus className="w-4 h-4" /></button>
          <button onClick={() => navigate('/tasks')} title="All tasks"
            className="p-1 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100"><ArrowRight className="w-4 h-4" /></button>
        </div>
      </div>

      {adding && (
        <form onSubmit={handleAdd} className="px-5 py-2.5 border-b border-slate-100 bg-slate-50 flex gap-2">
          <input autoFocus value={title} onChange={e => setTitle(e.target.value)} placeholder="What needs to happen?"
            className="flex-1 text-sm border border-slate-200 rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-400" />
          <button type="submit" className="text-xs font-medium text-blue-600 px-3 py-1.5 rounded-lg border border-blue-200 hover:bg-blue-50">Add</button>
        </form>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-10"><Loader2 className="w-5 h-5 text-slate-400 animate-spin" /></div>
      ) : focus.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-10 gap-1">
          <Check className="w-7 h-7 text-emerald-500" />
          <p className="text-sm font-medium text-slate-700">All clear</p>
          <p className="text-xs text-slate-400">Nothing due today — <button onClick={() => navigate('/tasks')} className="text-blue-600 hover:underline">see all tasks</button></p>
        </div>
      ) : (
        <ul className="divide-y divide-slate-100">
          {focus.map(t => {
            const overdue = t.due_date && t.due_date < today
            return (
              <li key={t.id} className="flex items-center gap-3 px-5 py-2.5 group hover:bg-slate-50/70 transition-colors">
                <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${PRIORITY_DOT[t.priority] || PRIORITY_DOT.normal}`} />
                <div className="flex-1 min-w-0 cursor-pointer" onClick={() => navigate('/tasks')}>
                  <p className="text-sm text-slate-800 truncate">{t.title}</p>
                  {(t.deal_label || t.property_label) && (
                    <p className="text-xs text-slate-400 truncate">{t.deal_label || t.property_label}</p>
                  )}
                </div>
                {t.due_date && (
                  <span className={`text-xs shrink-0 flex items-center gap-1 ${overdue ? 'text-red-600 font-semibold' : 'text-slate-400'}`}>
                    {overdue && <AlertCircle className="w-3 h-3" />}
                    {new Date(t.due_date + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                  </span>
                )}
                <div className="flex items-center gap-0.5 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
                  <button onClick={() => act(t.id, () => completeTask(t.id))} disabled={busy === t.id}
                    className="p-1.5 rounded-lg text-emerald-500 hover:bg-emerald-50" title="Done">
                    {busy === t.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                  </button>
                  <button onClick={() => act(t.id, () => updateTask(t.id, { status: 'dismissed' }))} disabled={busy === t.id}
                    className="p-1.5 rounded-lg text-slate-300 hover:text-red-500 hover:bg-red-50" title="Dismiss"><X className="w-4 h-4" /></button>
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
