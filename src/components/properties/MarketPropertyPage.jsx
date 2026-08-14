// Full-page detail for a Market Property — replaces the old 520px slide-over.
// Opened from the Market Properties list (and from deal/person deep-links). Shows
// the property Overview via PropertyDetail's `embedded` mode. Unlike the portfolio
// workspace (/property/:id, which is role-gated and adds Management/Accounting
// tabs), this route stays open to every role that can see Market Properties, and
// omits the portfolio-only tabs that don't apply to a market prospect.
import { useParams, useNavigate } from 'react-router-dom'
import { ArrowLeft } from 'lucide-react'
import PropertyDetail from './PropertyDetail'

export default function MarketPropertyPage() {
  const { id } = useParams()
  const navigate = useNavigate()

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="shrink-0 border-b border-slate-200 bg-white px-4 pt-3 pb-2">
        <button
          onClick={() => navigate('/properties')}
          className="flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-800"
        >
          <ArrowLeft className="w-4 h-4" /> Market Properties
        </button>
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto">
        <PropertyDetail propertyId={Number(id)} embedded onEdit={() => {}} />
      </div>
    </div>
  )
}
