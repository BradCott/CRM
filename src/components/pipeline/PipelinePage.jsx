import { useState } from 'react'
import { DragDropContext } from '@hello-pangea/dnd'
import { TrendingUp, Trophy, KanbanSquare, Loader2 } from 'lucide-react'
import { useApp } from '../../context/AppContext'
import KanbanColumn from './KanbanColumn'
import DealForm from './DealForm'
import Modal from '../ui/Modal'
import ConfirmDialog from '../ui/ConfirmDialog'
import EmptyState from '../ui/EmptyState'
import Button from '../ui/Button'

function formatPrice(val) {
  if (!val) return '$0'
  if (val >= 1_000_000) return `$${(val / 1_000_000).toFixed(1)}M`
  if (val >= 1_000) return `$${(val / 1_000).toFixed(0)}K`
  return `$${val}`
}

export default function PipelinePage() {
  const { deals, stages, addDeal, editDeal, removeDeal, moveDeal, loading } = useApp()
  const [showForm, setShowForm]     = useState(false)
  const [editTarget, setEditTarget] = useState(null)
  const [deleteTarget, setDeleteTarget] = useState(null)
  const [initialStage, setInitialStage] = useState('lead')

  const openDeals = deals.filter(d => !['closed_won', 'closed_lost'].includes(d.stage))
  const wonDeals  = deals.filter(d => d.stage === 'closed_won')
  const totalOpen = openDeals.reduce((s, d) => s + (d.purchase_price || 0), 0)
  const totalWon  = wonDeals.reduce((s, d) => s + (d.purchase_price || 0), 0)

  const handleAddDeal = (stageKey) => { setInitialStage(stageKey); setEditTarget(null); setShowForm(true) }
  const handleEditDeal = (deal) => { setEditTarget(deal); setShowForm(true) }

  const handleDragEnd = ({ destination, source, draggableId }) => {
    if (!destination) return
    if (destination.droppableId === source.droppableId && destination.index === source.index) return
    moveDeal(parseInt(draggableId, 10), destination.droppableId)
  }

  const dealsByStage = (key) => deals.filter(d => d.stage === key)

  const handleSave = async (data) => {
    if (editTarget) await editDeal(editTarget.id, data)
    else await addDeal(data)
  }

  if (loading) return (
    <div className="flex-1 flex items-center justify-center">
      <Loader2 className="w-6 h-6 text-slate-400 animate-spin" />
    </div>
  )

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <header className="shrink-0 px-6 pt-6 pb-0 bg-white border-b border-slate-200">
        <div className="flex items-center justify-between mb-5">
          <h1 className="text-xl font-semibold text-slate-900">Pipeline</h1>
          <Button onClick={() => handleAddDeal('lead')}>
            <TrendingUp className="w-4 h-4" /> New deal
          </Button>
        </div>
        <div className="flex items-center gap-6 pb-5">
          <Stat icon={TrendingUp} label="Open pipeline" value={formatPrice(totalOpen)} color="text-blue-600" />
          <div className="w-px h-8 bg-slate-200" />
          <Stat icon={Trophy} label="Closed won" value={formatPrice(totalWon)} color="text-green-600" />
          <div className="w-px h-8 bg-slate-200" />
          <Stat icon={KanbanSquare} label="Open deals" value={openDeals.length} color="text-amber-600" />
        </div>
      </header>

      {deals.length === 0 ? (
        <div className="flex-1 flex items-center justify-center">
          <EmptyState icon={KanbanSquare} title="No deals yet" description="Add properties first, then create deals." action="New deal" onAction={() => handleAddDeal('lead')} />
        </div>
      ) : (
        <div className="flex-1 overflow-x-auto overflow-y-auto p-6 scrollbar-thin">
          <DragDropContext onDragEnd={handleDragEnd}>
            <div className="flex gap-4 h-fit pb-4">
              {stages.map(stage => (
                <KanbanColumn
                  key={stage.key}
                  stage={stage}
                  deals={dealsByStage(stage.key)}
                  onAddDeal={handleAddDeal}
                  onEditDeal={handleEditDeal}
                  onDeleteDeal={setDeleteTarget}
                />
              ))}
            </div>
          </DragDropContext>
        </div>
      )}

      <Modal isOpen={showForm} onClose={() => { setShowForm(false); setEditTarget(null) }} title={editTarget ? 'Edit deal' : 'New deal'}>
        <DealForm deal={editTarget} initialStage={initialStage} onSave={handleSave} onClose={() => { setShowForm(false); setEditTarget(null) }} />
      </Modal>

      <ConfirmDialog
        isOpen={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={() => removeDeal(deleteTarget.id)}
        title="Delete deal?"
        message={`This deal will be permanently deleted.`}
      />
    </div>
  )
}

function Stat({ icon: Icon, label, value, color }) {
  return (
    <div className="flex items-center gap-2.5">
      <Icon className={`w-4 h-4 ${color} opacity-70`} />
      <div>
        <p className="text-xs text-slate-500">{label}</p>
        <p className={`text-sm font-bold ${color}`}>{value}</p>
      </div>
    </div>
  )
}
