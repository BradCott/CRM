// Clean up operators/franchisees — rename, delete, and merge duplicates
// (fold several operators into one, reassigning their properties).
import { useState, useEffect, useMemo } from 'react'
import { X, Loader2, Trash2, GitMerge, Search, Check, Pencil } from 'lucide-react'
import Button from '../ui/Button'
import { getOperators, updateOperator, deleteOperator, mergeOperators } from '../../api/client'
import { useApp } from '../../context/AppContext'

export default function OperatorManager({ onClose }) {
  const { reloadOperators } = useApp()
  const [rows, setRows]       = useState([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy]       = useState(false)
  const [error, setError]     = useState(null)
  const [query, setQuery]     = useState('')
  const [selected, setSelected] = useState(() => new Set())
  const [mergeInto, setMergeInto] = useState('')
  const [editId, setEditId]   = useState(null)
  const [editName, setEditName] = useState('')

  const load = () => getOperators().then(rs => { setRows(rs); setLoading(false) }).catch(e => { setError(e.message); setLoading(false) })
  useEffect(() => { load() }, [])
  const refresh = async () => { await load(); reloadOperators?.() }

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return rows.filter(r => !q || (r.name || '').toLowerCase().includes(q))
  }, [rows, query])

  const toggle = (id) => setSelected(prev => {
    const next = new Set(prev); next.has(id) ? next.delete(id) : next.add(id); return next
  })

  async function handleMerge() {
    const into = Number(mergeInto)
    const from = [...selected].filter(id => id !== into)
    if (!into || !from.length) return
    const target = rows.find(r => r.id === into)
    if (!window.confirm(`Merge ${from.length} operator${from.length !== 1 ? 's' : ''} into "${target?.name}"? Their properties will be reassigned and the merged operators deleted.`)) return
    setBusy(true); setError(null)
    try {
      await mergeOperators(into, from)
      setSelected(new Set()); setMergeInto('')
      await refresh()
    } catch (e) { setError(e.message) } finally { setBusy(false) }
  }

  async function handleDelete(op) {
    if (!window.confirm(`Delete "${op.name}"? Its ${op.property_count || 0} propert${op.property_count === 1 ? 'y' : 'ies'} will become Unspecified.`)) return
    setBusy(true); setError(null)
    try { await deleteOperator(op.id); await refresh() }
    catch (e) { setError(e.message) } finally { setBusy(false) }
  }

  async function saveRename(op) {
    const name = editName.trim()
    setEditId(null)
    if (!name || name === op.name) return
    setBusy(true); setError(null)
    try { await updateOperator(op.id, { name, is_corporate: op.is_corporate }); await refresh() }
    catch (e) { setError(e.message) } finally { setBusy(false) }
  }

  const selectedList = [...selected]

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[88vh] flex flex-col">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 shrink-0">
          <div>
            <h2 className="text-base font-semibold text-slate-900">Manage Operators</h2>
            <p className="text-xs text-slate-500 mt-0.5">{rows.length} operators. Check duplicates and merge them into one.</p>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600"><X className="w-5 h-5" /></button>
        </div>

        <div className="px-6 py-3 border-b border-slate-100 shrink-0">
          <div className="relative">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Search operators…"
              className="w-full pl-9 pr-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-400" />
          </div>
          {error && <p className="text-xs text-red-600 mt-2">{error}</p>}
        </div>

        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <div className="flex items-center justify-center py-16 text-slate-400 gap-2"><Loader2 className="w-5 h-5 animate-spin" /> Loading…</div>
          ) : (
            <table className="w-full text-sm">
              <tbody>
                {filtered.map(op => (
                  <tr key={op.id} className="border-b border-slate-50 hover:bg-slate-50/60">
                    <td className="pl-6 pr-2 py-2 w-8">
                      <input type="checkbox" checked={selected.has(op.id)} onChange={() => toggle(op.id)} className="rounded border-slate-300" />
                    </td>
                    <td className="px-2 py-2">
                      {editId === op.id ? (
                        <input autoFocus value={editName} onChange={e => setEditName(e.target.value)}
                          onBlur={() => saveRename(op)}
                          onKeyDown={e => { if (e.key === 'Enter') saveRename(op); if (e.key === 'Escape') setEditId(null) }}
                          className="text-sm border border-blue-300 rounded px-2 py-1 outline-none focus:ring-2 focus:ring-blue-300 w-full" />
                      ) : (
                        <button onClick={() => { setEditId(op.id); setEditName(op.name) }}
                          className="group flex items-center gap-1.5 text-left">
                          <span className="text-slate-800">{op.name}</span>
                          {op.is_corporate ? <span className="text-[10px] font-semibold text-slate-500 bg-slate-100 px-1.5 rounded-full">CORP</span> : null}
                          <Pencil className="w-3 h-3 text-slate-300 opacity-0 group-hover:opacity-100" />
                        </button>
                      )}
                    </td>
                    <td className="px-2 py-2 text-right text-slate-400 tabular-nums w-24">{(op.property_count || 0).toLocaleString()} props</td>
                    <td className="px-2 pr-6 py-2 w-10 text-right">
                      <button onClick={() => handleDelete(op)} className="text-slate-300 hover:text-red-500" title="Delete operator"><Trash2 className="w-4 h-4" /></button>
                    </td>
                  </tr>
                ))}
                {filtered.length === 0 && <tr><td colSpan={4} className="px-6 py-8 text-center text-slate-400">No operators match.</td></tr>}
              </tbody>
            </table>
          )}
        </div>

        {/* Merge bar */}
        <div className="px-6 py-4 border-t border-slate-100 shrink-0 bg-slate-50 rounded-b-2xl">
          {selectedList.length > 0 ? (
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-sm text-slate-600"><span className="font-semibold">{selectedList.length}</span> selected — merge into</span>
              <select value={mergeInto} onChange={e => setMergeInto(e.target.value)}
                className="text-sm border border-slate-200 rounded-lg px-2 py-1.5 bg-white focus:outline-none focus:ring-2 focus:ring-blue-400 max-w-[220px]">
                <option value="">— choose target —</option>
                {[...rows].sort((a,b)=>(b.is_corporate-a.is_corporate)||a.name.localeCompare(b.name)).map(o => (
                  <option key={o.id} value={o.id}>{o.name}</option>
                ))}
              </select>
              <Button onClick={handleMerge} disabled={busy || !mergeInto || selectedList.every(id => id === Number(mergeInto))}>
                {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <GitMerge className="w-4 h-4" />} Merge
              </Button>
              <button onClick={() => setSelected(new Set())} className="text-xs text-slate-400 hover:text-slate-600 ml-1">clear</button>
            </div>
          ) : (
            <p className="text-xs text-slate-400">Tip: check the duplicates (e.g. two "Turbo Restaurants" spellings), pick the one to keep, and Merge. Click a name to rename; trash to delete.</p>
          )}
        </div>
      </div>
    </div>
  )
}
