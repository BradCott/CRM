// Dashboard global quick-search — type a name/address and jump to any person,
// property, or active deal. Debounced dropdown; results grouped by type.
import { useState, useEffect, useRef, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { Search, User, Building2, Briefcase, X, Loader2 } from 'lucide-react'
import { globalSearch } from '../../api/client'

export default function GlobalSearch() {
  const navigate = useNavigate()
  const [q, setQ]           = useState('')
  const [res, setRes]       = useState(null)   // { people, properties, deals }
  const [loading, setLoading] = useState(false)
  const [open, setOpen]     = useState(false)
  const boxRef = useRef(null)
  const timer  = useRef(null)

  useEffect(() => {
    const h = e => { if (boxRef.current && !boxRef.current.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [])

  useEffect(() => {
    clearTimeout(timer.current)
    const query = q.trim()
    if (query.length < 2) { setRes(null); setLoading(false); return }
    setLoading(true)
    timer.current = setTimeout(() => {
      globalSearch(query)
        .then(r => { setRes(r); setLoading(false) })
        .catch(() => { setRes(null); setLoading(false) })
    }, 220)
    return () => clearTimeout(timer.current)
  }, [q])

  const go = useCallback((path) => { setOpen(false); setQ(''); setRes(null); navigate(path) }, [navigate])

  const total = res ? (res.people.length + res.properties.length + res.deals.length) : 0
  const showDropdown = open && q.trim().length >= 2

  return (
    <div ref={boxRef} className="relative w-full max-w-xl">
      <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
      <input
        value={q}
        onChange={e => { setQ(e.target.value); setOpen(true) }}
        onFocus={() => setOpen(true)}
        onKeyDown={e => { if (e.key === 'Escape') { setOpen(false); e.currentTarget.blur() } }}
        placeholder="Search people, properties, deals…"
        className="w-full pl-9 pr-8 py-2.5 text-sm bg-white border border-slate-200 rounded-xl shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-400"
      />
      {q && (
        <button onClick={() => { setQ(''); setRes(null) }} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600" title="Clear">
          <X className="w-4 h-4" />
        </button>
      )}

      {showDropdown && (
        <div className="absolute z-40 mt-1.5 w-full bg-white border border-slate-200 rounded-xl shadow-xl overflow-hidden max-h-[70vh] overflow-y-auto">
          {loading && !res ? (
            <div className="flex items-center gap-2 px-4 py-3 text-sm text-slate-400"><Loader2 className="w-4 h-4 animate-spin" /> Searching…</div>
          ) : total === 0 ? (
            <div className="px-4 py-3 text-sm text-slate-400">No matches for &ldquo;{q.trim()}&rdquo;</div>
          ) : (
            <>
              <Group title="People" icon={User} items={res.people} render={p => (
                <button key={`pe${p.id}`} onClick={() => go(`/people?open=${p.id}`)} className="w-full text-left px-4 py-2 hover:bg-blue-50 flex items-center gap-2">
                  <User className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                  <span className="text-sm text-slate-800 truncate">{p.name || '—'}</span>
                  <span className="text-xs text-slate-400 truncate ml-auto">{[p.city, p.state].filter(Boolean).join(', ')}</span>
                </button>
              )} />
              <Group title="Properties" icon={Building2} items={res.properties} render={p => (
                <button key={`pr${p.id}`} onClick={() => go(`/properties?open=${p.id}`)} className="w-full text-left px-4 py-2 hover:bg-blue-50 flex items-center gap-2">
                  <Building2 className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                  <span className="text-sm text-slate-800 truncate">{p.address}</span>
                  <span className="text-xs text-slate-400 truncate ml-auto">{p.tenant_brand_name || [p.city, p.state].filter(Boolean).join(', ')}</span>
                </button>
              )} />
              <Group title="Deals" icon={Briefcase} items={res.deals} render={d => (
                <button key={`dl${d.id}`} onClick={() => go(`/pipeline/${d.id}`)} className="w-full text-left px-4 py-2 hover:bg-blue-50 flex items-center gap-2">
                  <Briefcase className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                  <span className="text-sm text-slate-800 truncate">{d.address || d.title || d.tenant || `Deal #${d.id}`}</span>
                  <span className="text-xs text-slate-400 truncate ml-auto">{d.stage}</span>
                </button>
              )} />
            </>
          )}
        </div>
      )}
    </div>
  )
}

function Group({ title, icon: Icon, items, render }) {
  if (!items || items.length === 0) return null
  return (
    <div className="py-1 border-t border-slate-100 first:border-0">
      <div className="px-4 py-1 text-[10px] font-semibold text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
        <Icon className="w-3 h-3" /> {title}
      </div>
      {items.map(render)}
    </div>
  )
}
