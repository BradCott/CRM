import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { AppProvider } from './context/AppContext'
import AppShell from './components/layout/AppShell'
import PeoplePage from './components/people/PeoplePage'
import PipelinePage from './components/pipeline/PipelinePage'
import PropertiesPage from './components/properties/PropertiesPage'
import ImportPage from './components/import/ImportPage'
import ReportsPage from './components/reports/ReportsPage'
import PortfolioPage from './components/portfolio/PortfolioPage'
import InvestorsPage from './components/investors/InvestorsPage'
import DashboardPage from './components/dashboard/DashboardPage'
import SettingsPage from './components/settings/SettingsPage'

export default function App() {
  return (
    <AppProvider>
      <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <Routes>
          <Route element={<AppShell />}>
            <Route index element={<Navigate to="/dashboard" replace />} />
            <Route path="/dashboard" element={<DashboardPage />} />
            <Route path="/people"     element={<PeoplePage />} />
            <Route path="/properties" element={<PropertiesPage />} />
            <Route path="/pipeline"   element={<PipelinePage />} />
            <Route path="/portfolio"  element={<PortfolioPage />} />
            <Route path="/investors"  element={<InvestorsPage />} />
            <Route path="/reports"    element={<ReportsPage />} />
            <Route path="/import"     element={<ImportPage />} />
            <Route path="/settings"  element={<SettingsPage />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </AppProvider>
  )
}
