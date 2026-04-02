import { Droppable } from '@hello-pangea/dnd'
import { Plus } from 'lucide-react'
import DealCard from './DealCard'
import { formatCurrency } from '../../utils/formatters'
import { STAGE_COLORS } from '../../utils/constants'

export default function KanbanColumn({ stage, deals, onAddDeal, onEditDeal, onDeleteDeal }) {
  const c = STAGE_COLORS[stage.color] || STAGE_COLORS.slate
  const totalValue = deals.reduce((sum, d) => sum + (d.value || 0), 0)

  return (
    <div className="flex flex-col w-72 shrink-0">
      {/* Column header */}
      <div className={`rounded-t-xl px-4 py-3 border ${c.border} ${c.header}`}>
        <div className="flex items-center justify-between mb-0.5">
          <div className="flex items-center gap-2">
            <span className={`w-2.5 h-2.5 rounded-full ${c.dot}`} />
            <span className={`text-sm font-semibold ${c.text}`}>{stage.label}</span>
          </div>
          <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${c.bg} ${c.text}`}>{deals.length}</span>
        </div>
        {totalValue > 0 && (
          <p className="text-xs font-semibold text-slate-500 pl-4">{formatCurrency(totalValue)}</p>
        )}
      </div>

      {/* Cards droppable area */}
      <Droppable droppableId={stage.key}>
        {(provided, snapshot) => (
          <div
            ref={provided.innerRef}
            {...provided.droppableProps}
            className={`flex-1 min-h-32 p-2 space-y-2 border-x border-b rounded-b-xl transition-colors ${c.border} ${
              snapshot.isDraggingOver ? `${c.header} border-dashed` : 'bg-slate-50/60'
            }`}
          >
            {deals.map((deal, i) => (
              <DealCard
                key={deal.id}
                deal={deal}
                index={i}
                onEdit={onEditDeal}
                onDelete={onDeleteDeal}
              />
            ))}
            {provided.placeholder}
            <button
              onClick={() => onAddDeal(stage.key)}
              className={`flex items-center gap-1.5 w-full px-3 py-2 rounded-lg text-xs font-medium transition-colors text-slate-400 hover:text-slate-600 hover:bg-white`}
            >
              <Plus className="w-3.5 h-3.5" />
              Add deal
            </button>
          </div>
        )}
      </Droppable>
    </div>
  )
}
