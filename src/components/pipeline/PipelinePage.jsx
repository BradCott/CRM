import { useState, useCallback, Component } from 'react'
import { DragDropContext } from '@hello-pangea/dnd'
import { TrendingUp, Trophy, KanbanSquare, LayoutList, Loader2, FileSignature, Building2, Banknote, Archive } from 'lucide-react'
import { useApp } from '../../context/AppContext'
import KanbanColumn from './KanbanColumn'
import DealForm from './DealForm'
import DealTable from './DealTable'
import DroppedDeals from './DroppedDeals'
import LOIDropZone from './LOIDropZone'
import Modal from '../ui/Modal'
import ConfirmDialog from '../ui/ConfirmDialog'
import Button from '../ui/Button'

function formatPrice(val) {
  if (!val) return '$0'
  if (val >= 1_000_000) return `$${(val / 1_000_000).toFixed(1)}M`
  if (val >= 1_000) return `$${(val / 1_000).toFixed(0)}K`
  return `$${val}`
}

function fmtStat(val) {
  if (!val) return '$0'
  return '$' + Math.round(val).toLocaleString()
}

function loadView() {
  try { return localStorage.getItem('pipeline_view') || 'table' } catch { return 'table' }
}
function saveView(v) {
  try { localStorage.setItem('pipeline_view', v) } catch {}
}

export default function PipelinePage() {
  const { deals, stages, addDeal, editDeal, removeDeal, moveDeal, closeDeal, dropDeal, loading } = useApp()
  const [view, setView]               = useState(loadView)
  const [showForm, setShowForm]       = useState(false)
  const [editTarget, setEditTarget]   = useState(null)
  const [deleteTarget, setDeleteTarget] = useState(null)
  const [initialStage, setInitialStage] = useState('loi')
  const [loiPrefill, setLoiPrefill]   = useState(null)

  const openDeals          = deals.filter(d => !['closed_won', 'closed_lost', 'money_hard'].includes(d.stage))
  const loiDeals           = deals.filter(d => d.stage === 'loi')
  const underContractDeals = deals.filter(d => d.stage === 'under_contract')

  const totalPipeline      = deals.reduce((s, d) => s + (d.purchase_price || 0), 0)
  const loiTotal           = loiDeals.reduce((s, d) => s + (d.purchase_price || 0), 0)
  const underContractTotal = underContractDeals.reduce((s, d) => s + (d.purchase_price || 0), 0)
  const earnestMoneyTotal  = underContractDeals.reduce((s, d) => s + (d.earnest_money || 0), 0)

  const closeForm = () => { setShowForm(false); setEditTarget(null); setLoiPrefill(null) }

  const handleAddDeal   = (stageKey) => { setInitialStage(stageKey || 'loi'); setEditTarget(null); setLoiPrefill(null); setShowForm(true) }
  const handleLOIParsed = (prefill)  => { setInitialStage('loi'); setEditTarget(null); setLoiPrefill(prefill); setShowForm(true) }

  // Inline cell save: merge new field value into the full deal object and PUT
  const handleCellSave = useCallback(async (id, field, value) => {
    const deal = deals.find(d => d.id === id)
    if (!deal) return
    await editDeal(id, {
      property_id:        deal.property_id,
      stage:              deal.stage,
      purchase_price:     deal.purchase_price,
      close_date:         deal.close_date,
      notes:              deal.notes,
      address:            deal.address,
      city:               deal.city,
      state:              deal.state,
      tenant:             deal.tenant,
      cap_rate:           deal.cap_rate,
      due_diligence_days: deal.due_diligence_days,
      dd_deadline:        deal.dd_deadline,
      earnest_money:      deal.earnest_money,
      [field]:            value,
    })
  }, [deals, editDeal])

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

  const switchView = (v) => { setView(v); saveView(v) }

  if (loading) return (
    <div className="flex-1 flex items-center justify-center">
      <Loader2 className="w-6 h-6 text-slate-400 animate-spin" />
    </div>
  )

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header */}
      <header className="shrink-0 px-6 pt-6 pb-0 bg-white border-b border-slate-200">
        <div className="flex items-center justify-between mb-5">
          <h1 className="text-xl font-semibold text-slate-900">Pipeline</h1>
          <div className="flex items-center gap-2">
            <div className="flex items-center rounded-lg border border-slate-200 bg-slate-50 p-0.5">
              <button
                onClick={() => switchView('table')}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
                  view === 'table' ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500 hover:text-slate-700'
                }`}
              >
                <LayoutList className="w-3.5 h-3.5" /> Table
              </button>
              <button
                onClick={() => switchView('kanban')}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
                  view === 'kanban' ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500 hover:text-slate-700'
                }`}
              >
                <KanbanSquare className="w-3.5 h-3.5" /> Kanban
              </button>
              <button
                onClick={() => switchView('dropped')}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
                  view === 'dropped' ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500 hover:text-slate-700'
                }`}
              >
                <Archive className="w-3.5 h-3.5" /> Dropped
              </button>
            </div>
            {view !== 'dropped' && (
              <Button onClick={() => handleAddDeal('loi')}>
                <TrendingUp className="w-4 h-4" /> New deal
              </Button>
            )}
          </div>
        </div>

        <div className="flex items-center gap-6 pb-5 flex-wrap">
          <Stat icon={TrendingUp}     label="Total Pipeline"       value={fmtStat(totalPipeline)}      color="text-blue-600" />
          <div className="w-px h-8 bg-slate-200 shrink-0" />
          <Stat icon={FileSignature}  label="LOI Total"            value={fmtStat(loiTotal)}           color="text-violet-600" />
          <div className="w-px h-8 bg-slate-200 shrink-0" />
          <Stat icon={Building2}      label="Under Contract Total"  value={fmtStat(underContractTotal)} color="text-amber-600" />
          <div className="w-px h-8 bg-slate-200 shrink-0" />
          <Stat icon={Banknote}       label="Total Earnest Money"  value={fmtStat(earnestMoneyTotal)}  color="text-emerald-600" />
        </div>
      </header>

      {/* Content */}
      <div className="flex-1 overflow-x-auto overflow-y-auto scrollbar-thin pt-4">
        {view === 'table' && (
          <DealTable
            deals={deals}
            onDelete={setDeleteTarget}
            onCellSave={handleCellSave}
            onCloseDeal={closeDeal}
            onDropDeal={dropDeal}
          />
        )}

        {view === 'dropped' && <DroppedDeals />}

        {view === 'kanban' && deals.length > 0 && (
          <DragDropContext onDragEnd={handleDragEnd}>
            <div className="flex gap-4 h-fit px-6 pb-6">
              {stages.map(stage => (
                <KanbanColumn
                  key={stage.key}
                  stage={stage}
                  deals={dealsByStage(stage.key)}
                  onAddDeal={handleAddDeal}
                  onEditDeal={deal => { setEditTarget(deal); setLoiPrefill(null); setShowForm(true) }}
                  onDeleteDeal={setDeleteTarget}
                />
              ))}
            </div>
          </DragDropContext>
        )}

        {view === 'kanban' && deals.length === 0 && (
          <div className="flex items-center justify-center py-16 text-slate-400 text-sm">
            Click "New deal" to get started
          </div>
        )}
      </div>

      {/* LOI drop zone — fixed bottom-left, hidden on Dropped view */}
      {view !== 'dropped' && <LOIDropZone onParsed={handleLOIParsed} />}

      {/* New deal / LOI form modal */}
      <Modal isOpen={showForm} onClose={closeForm} title={editTarget ? 'Edit deal' : 'New deal'}>
        <FormErrorBoundary onClose={closeForm}>
          <DealForm
            deal={editTarget}
            initialStage={initialStage}
            prefill={loiPrefill}
            onSave={handleSave}
            onClose={closeForm}
          />
        </FormErrorBoundary>
      </Modal>

      <ConfirmDialog
        isOpen={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={() => { removeDeal(deleteTarget.id); setDeleteTarget(null) }}
        title="Delete deal?"
        message="This deal will be permanently deleted."
      />
    </div>
  )
}

class FormErrorBoundary extends Component {
  constructor(props) { super(props); this.state = { error: null } }
  static getDerivedStateFromError(error) { return { error } }
  componentDidCatch(error, info) { console.error('[DealForm] crash:', error, info) }
  render() {
    if (this.state.error) {
      return (
        <div className="px-6 py-8 text-center space-y-3">
          <p className="text-sm font-semibold text-red-600">Something went wrong opening the form</p>
          <p className="text-xs text-slate-500 font-mono break-all">{this.state.error.message}</p>
          <button onClick={this.props.onClose} className="text-xs text-slate-400 underline">Close</button>
        </div>
      )
    }
    return this.props.children
  }
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
