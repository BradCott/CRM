import { BrowserRouter, Routes, Route, Navigate, Outlet, useLocation } from 'react-router-dom'
import { AppProvider }   from './context/AppContext'
import { AuthProvider, useAuth, ROLE_ACCESS } from './context/AuthContext'
import AppShell         from './components/layout/AppShell'
import PeoplePage       from './components/people/PeoplePage'
import PipelinePage     from './components/pipeline/PipelinePage'
import PropertiesPage   from './components/properties/PropertiesPage'
import ImportPage       from './components/import/ImportPage'
import ReportsPage      from './components/reports/ReportsPage'
import PortfolioPage    from './components/portfolio/PortfolioPage'
import InvestorsPage    from './components/investors/InvestorsPage'
import DashboardPage    from './components/dashboard/DashboardPage'
import SettingsPage     from './components/settings/SettingsPage'
import AccountingPage   from './components/accounting/AccountingPage'
import LedgerPage       from './components/accounting/LedgerPage'
import LoginPage        from './components/auth/LoginPage'
import SignupPage       from './components/auth/SignupPage'
import AdminPage                 from './components/admin/AdminPage'
import ManagementDashboard       from './components/management/ManagementDashboard'
import PropertyManagementDetail  from './components/management/PropertyManagementDetail'
import { Loader2 }      from 'lucide-react'

// ── Guards ────────────────────────────────────────────────────────────────────

/** Blocks unauthenticated access. Shows spinner during auth check. */
function RequireAuth() {
  const { user, loading } = useAuth()
  const location = useLocation()

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <Loader2 className="w-6 h-6 text-slate-400 animate-spin" />
      </div>
    )
  }
  if (!user) {
    return <Navigate to="/login" state={{ from: location }} replace />
  }
  // AppProvider only mounts after successful auth so its data fetches have a valid cookie
  return <AppProvider><Outlet /></AppProvider>
}

/** Shows "no permission" if the current path is outside the user's role access. */
function RequireRole({ children }) {
  const { user } = useAuth()
  const location = useLocation()

  if (!user) return <Navigate to="/login" replace />

  const allowed = ROLE_ACCESS[user.role] || []
  const hasAccess = allowed.includes('*') ||
    allowed.some(p => location.pathname === p || location.pathname.startsWith(p + '/'))

  if (!hasAccess) {
    return (
      <div className="flex flex-col items-center justify-center h-full py-24 gap-3 text-center">
        <p className="text-5xl">🔒</p>
        <p className="text-base font-semibold text-slate-700">You do not have permission to view this page.</p>
        <p className="text-sm text-slate-400">Contact your Knox CRM administrator if you need access.</p>
      </div>
    )
  }
  return children
}

// ── App ───────────────────────────────────────────────────────────────────────

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <Routes>
          {/* Public routes — no auth or data context needed */}
          <Route path="/login"         element={<LoginPage />} />
          <Route path="/signup"        element={<SignupPage />} />
          <Route path="/signup/:token" element={<SignupPage />} />

          {/* Protected: RequireAuth mounts AppProvider only after auth */}
          <Route element={<RequireAuth />}>
            <Route element={<AppShell />}>
              <Route index element={<Navigate to="/dashboard" replace />} />

              {/* All authenticated roles */}
              <Route path="/dashboard"  element={<DashboardPage />} />
              <Route path="/people"     element={<PeoplePage />} />
              <Route path="/properties" element={<PropertiesPage />} />
              <Route path="/pipeline"   element={<PipelinePage />} />
              <Route path="/reports"    element={<ReportsPage />} />

              {/* Admin + Full Agent only */}
              <Route path="/portfolio"   element={<RequireRole><PortfolioPage /></RequireRole>} />
              <Route path="/management"  element={<RequireRole><ManagementDashboard /></RequireRole>} />
              <Route path="/management/:propertyId" element={<RequireRole><PropertyManagementDetail /></RequireRole>} />
              <Route path="/investors"  element={<RequireRole><InvestorsPage /></RequireRole>} />
              <Route path="/accounting" element={<RequireRole><AccountingPage /></RequireRole>} />
              <Route path="/accounting/:propertyId" element={<RequireRole><LedgerPage /></RequireRole>} />

              {/* Admin only */}
              <Route path="/import"    element={<RequireRole><ImportPage /></RequireRole>} />
              <Route path="/settings"  element={<RequireRole><SettingsPage /></RequireRole>} />
              <Route path="/admin"     element={<RequireRole><AdminPage /></RequireRole>} />
            </Route>
          </Route>
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  )
}
