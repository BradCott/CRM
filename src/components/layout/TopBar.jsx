import { Search } from 'lucide-react'

export default function TopBar({ title, actions, onSearch, searchPlaceholder = 'Search…' }) {
  return (
    <header className="h-16 shrink-0 flex items-center justify-between px-6 bg-white border-b border-slate-200">
      <h1 className="text-xl font-semibold text-slate-900">{title}</h1>

      <div className="flex items-center gap-3">
        {onSearch && (
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
            <input
              type="text"
              placeholder={searchPlaceholder}
              onChange={e => onSearch(e.target.value)}
              className="pl-9 pr-3 py-2 text-sm rounded-lg border border-slate-200 bg-slate-50 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:bg-white w-56 transition-all"
            />
          </div>
        )}
        {actions}
      </div>
    </header>
  )
}
