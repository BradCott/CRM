import { useState, useMemo, useEffect, useRef } from 'react'
import { Search, Link2, Unlink, X } from 'lucide-react'
import { useApp } from '../../context/AppContext'

export default function PropertyLinkModal({ deal, onLink, onUnlink, onClose }) {
  const { allProperties } = useApp()
  const [q, setQ] = useState('')
  const inputRef  = useRef()

  useEffect(() => { inputRef.current?.focus() }, [])

  useEffect(() => {
    const handler = e => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onClose])

  const filtered = useMemo(() => {
    const lower = q.trim().toLowerCase()
    const list  = lower
      ? allProperties.filter(p =>
          [p.address, p.city, p.state, p.tenant_brand_name]
            .some(v => String(v || '').toLowerCase().includes(lower))
        )
      : allProperties
    return list.slice(0, 50)
  }, [allProperties, q])

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
      onMouseDown={e => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md mx-4 overflow-hidden flex flex-col max-h-[80vh]">

        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200 shrink-0">
          <div className="flex items-center gap-2">
            <Link2 className="w-4 h-4 text-blue-600" />
            <h2 className="text-sm font-semibold text-slate-900">Link to Market Property</h2>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-400 hover:text-slate-600 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Current link banner + unlink button */}
        {deal.property_id && (
          <div className="px-5 py-3 bg-blue-50 border-b border-blue-100 shrink-0 flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="text-xs font-semibold text-blue-700">Currently linked</p>
              <p className="text-xs text-blue-600 truncate mt-0.5">{deal.property_address || '—'}</p>
            </div>
            <button
              onClick={onUnlink}
              className="shrink-0 flex items-center gap-1.5 text-xs font-medium text-red-500 hover:text-red-700 px-2.5 py-1.5 rounded-lg hover:bg-red-50 transition-colors"
            >
              <Unlink className="w-3.5 h-3.5" />
              Remove
            </button>
          </div>
        )}

        {/* Search */}
        <div className="px-4 py-3 border-b border-slate-100 shrink-0">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400" />
            <input
              ref={inputRef}
              type="text"
              value={q}
              onChange={e => setQ(e.target.value)}
              placeholder="Search address, city, or tenant…"
              className="w-full pl-9 pr-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-400"
            />
          </div>
        </div>

        {/* Results */}
        <ul className="overflow-y-auto flex-1 divide-y divide-slate-100">
          {filtered.length === 0 ? (
            <li className="px-5 py-10 text-center text-sm text-slate-400">No properties match</li>
          ) : (
            filtered.map(p => {
              const isLinked = p.id === deal.property_id
              return (
                <li key={p.id}>
                  <button
                    onClick={() => onLink(p.id)}
                    className={`w-full text-left px-5 py-3 hover:bg-blue-50 transition-colors ${
                      isLinked ? 'bg-blue-50/70' : ''
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-slate-900 truncate">{p.address}</p>
                        <p className="text-xs text-slate-500 mt-0.5">
                          {[p.tenant_brand_name, p.city, p.state].filter(Boolean).join(' · ')}
                        </p>
                      </div>
                      {isLinked && (
                        <span className="shrink-0 text-xs font-medium text-blue-600 bg-blue-100 px-2 py-0.5 rounded-full mt-0.5">
                          Linked
                        </span>
                      )}
                    </div>
                  </button>
                </li>
              )
            })
          )}
        </ul>
      </div>
    </div>
  )
}
