import { NavLink, useNavigate } from 'react-router-dom'
import {
  Users, KanbanSquare, Building2, Upload, FileSearch,
  Landmark, TrendingUp, LayoutDashboard, Settings, BookOpen, ShieldCheck, LogOut,
} from 'lucide-react'
import { useAuth } from '../../context/AuthContext'
import knoxKC from '../../assets/Knox-KC.jpg'

// Nav items and which roles can see them
const NAV = [
  { to: '/dashboard',  label: 'Dashboard',         icon: LayoutDashboard, roles: ['admin', 'full_agent', 'junior_agent'] },
  { to: '/people',     label: 'People',            icon: Users,           roles: ['admin', 'full_agent', 'junior_agent'] },
  { to: '/properties', label: 'Market Properties', icon: Building2,       roles: ['admin', 'full_agent', 'junior_agent'] },
  { to: '/portfolio',  label: 'Knox Portfolio',    icon: Landmark,        roles: ['admin', 'full_agent'] },
  { to: '/accounting', label: 'Accounting',        icon: BookOpen,        roles: ['admin', 'full_agent'] },
  { to: '/investors',  label: 'Investors',         icon: TrendingUp,      roles: ['admin', 'full_agent'] },
  { to: '/pipeline',   label: 'Pipeline',          icon: KanbanSquare,    roles: ['admin', 'full_agent', 'junior_agent'] },
  { to: '/reports',    label: 'Reports',           icon: FileSearch,      roles: ['admin', 'full_agent', 'junior_agent'] },
]

const BOTTOM_NAV = [
  { to: '/import',   label: 'Import',   icon: Upload,       roles: ['admin'] },
  { to: '/settings', label: 'Settings', icon: Settings,     roles: ['admin'] },
  { to: '/admin',    label: 'Admin',    icon: ShieldCheck,  roles: ['admin'] },
]

const ROLE_LABELS = {
  admin:        'Admin',
  full_agent:   'Full Agent',
  junior_agent: 'Junior Agent',
}

function SidebarLogo() {
  return (
    <img
      src={knoxKC}
      alt="Knox"
      className="w-12 h-12 rounded-lg object-cover"
    />
  )
}

function NavItem({ to, label, icon: Icon }) {
  return (
    <NavLink
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
  )
}

export default function Sidebar() {
  const { user, logout } = useAuth()
  const navigate         = useNavigate()
  const role             = user?.role || 'junior_agent'

  const visibleNav    = NAV.filter(n => n.roles.includes(role))
  const visibleBottom = BOTTOM_NAV.filter(n => n.roles.includes(role))

  async function handleLogout() {
    await logout()
    navigate('/login', { replace: true })
  }

  return (
    <aside className="w-56 shrink-0 flex flex-col bg-white border-r border-slate-200 h-full">
      <div className="flex items-center justify-center h-16 border-b border-slate-200">
        <SidebarLogo />
      </div>

      <nav className="flex-1 px-3 py-4 space-y-0.5 overflow-y-auto">
        <p className="px-2 mb-2 text-xs font-semibold text-slate-400 uppercase tracking-widest">Menu</p>
        {visibleNav.map(({ to, label, icon }) => (
          <NavItem key={to} to={to} label={label} icon={icon} />
        ))}

        {visibleBottom.length > 0 && (
          <div className="pt-3">
            <p className="px-2 mb-2 text-xs font-semibold text-slate-400 uppercase tracking-widest">Tools</p>
            {visibleBottom.map(({ to, label, icon }) => (
              <NavItem key={to} to={to} label={label} icon={icon} />
            ))}
          </div>
        )}
      </nav>

      {/* User info + logout */}
      <div className="px-3 py-3 border-t border-slate-200">
        {user && (
          <div className="flex items-center gap-2.5 px-3 py-2 mb-1 rounded-lg">
            <div className="w-6 h-6 rounded-full bg-blue-100 flex items-center justify-center text-xs font-bold text-blue-700 shrink-0">
              {(user.name || user.email)[0].toUpperCase()}
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-xs font-medium text-slate-800 truncate">{user.name || user.email}</p>
              <p className="text-xs text-slate-400">{ROLE_LABELS[user.role] || user.role}</p>
            </div>
          </div>
        )}
        <button
          onClick={handleLogout}
          className="flex items-center gap-3 px-3 py-2 w-full rounded-lg text-sm font-medium text-slate-500 hover:bg-slate-100 hover:text-slate-900 transition-colors"
        >
          <LogOut className="w-4 h-4 text-slate-400" />
          Sign out
        </button>
        <p className="px-3 pt-1 text-xs text-slate-400">v0.4.0 · SQLite</p>
      </div>
    </aside>
  )
}
