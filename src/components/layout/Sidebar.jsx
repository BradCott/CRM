import { useState } from 'react'
import { NavLink } from 'react-router-dom'
import { Users, KanbanSquare, Building2, Upload, BarChart3, FileSearch, Landmark, TrendingUp, LayoutDashboard } from 'lucide-react'

const NAV = [
  { to: '/dashboard',  label: 'Dashboard',         icon: LayoutDashboard },
  { to: '/people',     label: 'People',            icon: Users },
  { to: '/properties', label: 'Market Properties', icon: Building2 },
  { to: '/portfolio',  label: 'Knox Portfolio',     icon: Landmark },
  { to: '/investors',  label: 'Investors',          icon: TrendingUp },
  { to: '/pipeline',   label: 'Pipeline',          icon: KanbanSquare },
  { to: '/reports',    label: 'Reports',           icon: FileSearch },
]

function LogoOrFallback() {
  const [imgError, setImgError] = useState(false)
  if (!imgError) {
    return (
      <img
        src="/logo.png"
        alt="Knox"
        className="max-h-10 max-w-[160px] object-contain"
        onError={() => setImgError(true)}
      />
    )
  }
  // Fallback while no logo file exists yet
  return (
    <div className="flex items-center gap-2.5">
      <div className="w-8 h-8 rounded-lg bg-blue-600 flex items-center justify-center shrink-0">
        <BarChart3 className="w-4 h-4 text-white" />
      </div>
      <span className="text-lg font-bold text-slate-900 tracking-tight">Knox CRM</span>
    </div>
  )
}

export default function Sidebar() {
  return (
    <aside className="w-56 shrink-0 flex flex-col bg-white border-r border-slate-200 h-full">
      <div className="flex items-center px-4 h-16 border-b border-slate-200">
        <LogoOrFallback />
      </div>

      <nav className="flex-1 px-3 py-4 space-y-0.5">
        <p className="px-2 mb-2 text-xs font-semibold text-slate-400 uppercase tracking-widest">Menu</p>
        {NAV.map(({ to, label, icon: Icon }) => (
          <NavLink
            key={to}
            to={to}
            className={({ isActive }) =>
              `flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                isActive ? 'bg-blue-50 text-blue-700' : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
              }`
            }
          >
            {({ isActive }) => (
              <>
                <Icon className={`w-4 h-4 ${isActive ? 'text-blue-600' : 'text-slate-400'}`} />
                {label}
              </>
            )}
          </NavLink>
        ))}

        <div className="pt-3">
          <p className="px-2 mb-2 text-xs font-semibold text-slate-400 uppercase tracking-widest">Data</p>
          <NavLink
            to="/import"
            className={({ isActive }) =>
              `flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                isActive ? 'bg-blue-50 text-blue-700' : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
              }`
            }
          >
            {({ isActive }) => (
              <>
                <Upload className={`w-4 h-4 ${isActive ? 'text-blue-600' : 'text-slate-400'}`} />
                Import
              </>
            )}
          </NavLink>
        </div>
      </nav>

      <div className="px-5 py-4 border-t border-slate-200">
        <p className="text-xs text-slate-400">v0.3.0 · SQLite</p>
      </div>
    </aside>
  )
}
