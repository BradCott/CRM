import { useState, useRef, useEffect } from 'react'
import { ChevronDown, X, Search } from 'lucide-react'

export default function MultiSelect({ label, options = [], selected = [], onChange, placeholder = 'All' }) {
  const [open, setOpen]       = useState(false)
  const [search, setSearch]   = useState('')
  const containerRef          = useRef(null)

  // Close on outside click
  useEffect(() => {
    const handler = (e) => { if (!containerRef.current?.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const filtered = options.filter(o => o.toLowerCase().includes(search.toLowerCase()))

  const toggle = (val) => {
    if (selected.includes(val)) onChange(selected.filter(v => v !== val))
    else onChange([...selected, val])
  }

  const clear = (e) => { e.stopPropagation(); onChange([]) }

  const displayLabel = selected.length === 0
    ? placeholder
    : selected.length === 1
      ? selected[0]
      : `${selected.length} selected`

  return (
    <div ref={containerRef} className="relative flex flex-col gap-1">
      {label && <label className="text-xs font-semibold text-slate-500 uppercase tracking-wide">{label}</label>}

      {/* Trigger */}
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className={`flex items-center justify-between gap-2 px-3 py-2 text-sm rounded-lg border bg-white transition-colors min-w-[140px] ${
          open ? 'border-blue-400 ring-2 ring-blue-100' : 'border-slate-200 hover:border-slate-300'
        }`}
      >
        <span className={`truncate ${selected.length ? 'text-slate-900 font-medium' : 'text-slate-400'}`}>
          {displayLabel}
        </span>
        <div className="flex items-center gap-1 shrink-0">
          {selected.length > 0 && (
            <span onClick={clear} className="w-4 h-4 rounded-full bg-slate-200 hover:bg-red-100 hover:text-red-600 flex items-center justify-center transition-colors">
              <X className="w-2.5 h-2.5" />
            </span>
          )}
          <ChevronDown className={`w-3.5 h-3.5 text-slate-400 transition-transform ${open ? 'rotate-180' : ''}`} />
        </div>
      </button>

      {/* Dropdown */}
      {open && (
        <div className="absolute top-full left-0 mt-1 z-50 bg-white border border-slate-200 rounded-xl shadow-lg min-w-[200px] max-w-[280px]">
          {/* Search */}
          {options.length > 8 && (
            <div className="p-2 border-b border-slate-100">
              <div className="relative">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400" />
                <input
                  autoFocus
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  placeholder="Search…"
                  className="w-full pl-8 pr-3 py-1.5 text-sm rounded-lg border border-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
            </div>
          )}

          {/* Select all / clear */}
          <div className="flex gap-2 px-3 py-2 border-b border-slate-100">
            <button type="button" onClick={() => onChange(filtered)} className="text-xs text-blue-600 hover:underline">Select all</button>
            <span className="text-slate-300">·</span>
            <button type="button" onClick={() => onChange([])} className="text-xs text-slate-500 hover:underline">Clear</button>
          </div>

          {/* Options */}
          <ul className="max-h-56 overflow-y-auto py-1 scrollbar-thin">
            {filtered.length === 0 ? (
              <li className="px-4 py-3 text-sm text-slate-400 text-center">No results</li>
            ) : filtered.map(opt => (
              <li key={opt}>
                <label className="flex items-center gap-2.5 px-3 py-1.5 hover:bg-slate-50 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={selected.includes(opt)}
                    onChange={() => toggle(opt)}
                    className="w-3.5 h-3.5 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                  />
                  <span className="text-sm text-slate-800 truncate">{opt}</span>
                </label>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}
