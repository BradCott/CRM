import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { AppProvider } from './context/AppContext'
import AppShell from './components/layout/AppShell'
import PeoplePage from './components/people/PeoplePage'
import PipelinePage from './components/pipeline/PipelinePage'
import PropertiesPage from './components/properties/PropertiesPage'
import ImportPage from './components/import/ImportPage'
import ReportsPage from './components/reports/ReportsPage'
import PortfolioPage from './components/portfolio/PortfolioPage'

export default function App() {
  return (
    <AppProvider>
      <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <Routes>
          <Route element={<AppShell />}>
            <Route index element={<Navigate to="/people" replace />} />
            <Route path="/people"     element={<PeoplePage />} />
            <Route path="/properties" element={<PropertiesPage />} />
            <Route path="/pipeline"   element={<PipelinePage />} />
            <Route path="/portfolio"  element={<PortfolioPage />} />
            <Route path="/reports"    element={<ReportsPage />} />
            <Route path="/import"     element={<ImportPage />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </AppProvider>
  )
}
