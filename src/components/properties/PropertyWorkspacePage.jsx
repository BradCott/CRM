// Full-page property workspace — one place to work a property with tabs for
// Overview, Management, and Accounting. Opened from the portfolio when you click
// a property. The active tab lives in ?tab= so it survives refresh and can be
// deep-linked. Management and Accounting read the :propertyId route param, so
// they render unchanged here.
import { useParams, useNavigate, useSearchParams } from 'react-router-dom'
import { ArrowLeft, Home, Wrench, Calculator } from 'lucide-react'
import PropertyDetail from './PropertyDetail'
import PropertyManagementDetail from '../management/PropertyManagementDetail'
import LedgerPage from '../accounting/LedgerPage'

const TABS = [
  { key: 'overview',   label: 'Overview',   icon: Home },
  { key: 'management', label: 'Management', icon: Wrench },
  { key: 'accounting', label: 'Accounting', icon: Calculator },
]

export default function PropertyWorkspacePage() {
  const { propertyId } = useParams()
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const tab = TABS.some(t => t.key === params.get('tab')) ? params.get('tab') : 'overview'
  const setTab = (k) => setParams(p => { p.set('tab', k); return p }, { replace: true })

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="shrink-0 border-b border-slate-200 bg-white px-4 pt-3">
        <button onClick={() => navigate('/portfolio')} className="flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-800 mb-2">
          <ArrowLeft className="w-4 h-4" /> Portfolio
        </button>
        <div className="flex items-center gap-1">
          {TABS.map(t => {
            const Icon = t.icon
            const active = tab === t.key
            return (
              <button key={t.key} onClick={() => setTab(t.key)}
                className={`flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors ${active ? 'border-emerald-500 text-emerald-700' : 'border-transparent text-slate-500 hover:text-slate-800'}`}>
                <Icon className="w-4 h-4" /> {t.label}
              </button>
            )
          })}
        </div>
      </div>
      <div className={`flex-1 min-h-0 ${tab === 'accounting' ? 'overflow-hidden' : 'overflow-y-auto'}`}>
        {tab === 'overview'   && <PropertyDetail propertyId={Number(propertyId)} embedded onEdit={() => {}} />}
        {tab === 'management' && <PropertyManagementDetail />}
        {tab === 'accounting' && <LedgerPage />}
      </div>
    </div>
  )
}
