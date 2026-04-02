import { Draggable } from '@hello-pangea/dnd'
import { MapPin, Calendar, Pencil, Trash2, DollarSign } from 'lucide-react'
import { formatCurrency, formatDate } from '../../utils/formatters'

function formatPrice(val) {
  if (!val) return '—'
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(val)
}

export default function DealCard({ deal, index, onEdit, onDelete }) {
  const address = [deal.property_address, deal.city, deal.state].filter(Boolean).join(', ')

  return (
    <Draggable draggableId={String(deal.id)} index={index}>
      {(provided, snapshot) => (
        <div
          ref={provided.innerRef}
          {...provided.draggableProps}
          {...provided.dragHandleProps}
          className={`bg-white rounded-xl border p-3.5 cursor-grab active:cursor-grabbing transition-shadow group ${
            snapshot.isDragging
              ? 'border-blue-300 shadow-lg shadow-blue-100 rotate-1'
              : 'border-slate-200 shadow-sm hover:shadow-md hover:border-slate-300'
          }`}
        >
          {/* Tenant Brand + actions */}
          <div className="flex items-start justify-between gap-2 mb-1.5">
            <span className="text-xs font-semibold text-blue-600 bg-blue-50 px-2 py-0.5 rounded-full">
              {deal.tenant_brand_name || 'No tenant'}
            </span>
            <div className="flex items-center gap-0.5 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
              <button onClick={e => { e.stopPropagation(); onEdit(deal) }} className="w-6 h-6 rounded flex items-center justify-center text-slate-400 hover:text-slate-600 hover:bg-slate-100">
                <Pencil className="w-3 h-3" />
              </button>
              <button onClick={e => { e.stopPropagation(); onDelete(deal) }} className="w-6 h-6 rounded flex items-center justify-center text-slate-400 hover:text-red-600 hover:bg-red-50">
                <Trash2 className="w-3 h-3" />
              </button>
            </div>
          </div>

          {/* Address */}
          {address && (
            <div className="flex items-start gap-1.5 mb-2">
              <MapPin className="w-3.5 h-3.5 text-slate-400 shrink-0 mt-0.5" />
              <p className="text-sm font-medium text-slate-900 leading-snug">{address}</p>
            </div>
          )}

          {/* Price */}
          {deal.purchase_price ? (
            <div className="flex items-center gap-1.5 mb-2">
              <DollarSign className="w-3.5 h-3.5 text-slate-400" />
              <span className="text-base font-bold text-slate-900">{formatPrice(deal.purchase_price)}</span>
              {deal.cap_rate && (
                <span className="text-xs text-slate-500 ml-1">{deal.cap_rate}% cap</span>
              )}
            </div>
          ) : null}

          {/* Owner + close date */}
          <div className="flex items-center justify-between mt-1">
            {deal.owner_name
              ? <span className="text-xs text-slate-500 truncate">{deal.owner_name}</span>
              : <span />
            }
            {deal.close_date && (
              <div className="flex items-center gap-1 text-xs text-slate-400 shrink-0">
                <Calendar className="w-3 h-3" />
                {formatDate(deal.close_date)}
              </div>
            )}
          </div>
        </div>
      )}
    </Draggable>
  )
}
