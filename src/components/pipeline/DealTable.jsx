import { useState, useCallback, useMemo, useRef, useEffect } from 'react'
import { Settings2, Trash2, ChevronUp, ChevronDown, ChevronsUpDown, CheckCircle, XCircle } from 'lucide-react'
import ColumnCustomizer, {
  buildPanelCols, loadSavedCols, detectPreset, saveColsToStorage,
} from '../ui/ColumnCustomizer'

// ── Stage definitions (table-specific) ───────────────────────────────────────

export const TABLE_STAGES = [
  { key: 'loi',             label: 'LOI',             bg: 'bg-blue-100',   text: 'text-blue-700',   dot: 'bg-blue-500' },
  { key: 'psa_negotiation', label: 'PSA Negotiation', bg: 'bg-amber-100',  text: 'text-amber-700',  dot: 'bg-amber-500' },
  { key: 'under_contract',  label: 'Under Contract',  bg: 'bg-violet-100', text: 'text-violet-700', dot: 'bg-violet-500' },
  { key: 'money_hard',      label: 'Money Hard',      bg: 'bg-green-100',  text: 'text-green-700',  dot: 'bg-green-500' },
]
const STAGE_MAP = Object.fromEntries(TABLE_STAGES.map(s => [s.key, s]))

// ── Column definitions ────────────────────────────────────────────────────────

export const COL_DEFS = {
  tenant:             { label: 'Tenant',        type: 'text' },
  address:            { label: 'Address',       type: 'text' },
  city:               { label: 'City',          type: 'text' },
  state:              { label: 'State',         type: 'text' },
  cap_rate:           { label: 'Cap Rate',      type: 'number', step: 0.01 },
  purchase_price:     { label: 'Price',         type: 'number', step: 1 },
  fee:                { label: 'Fee (1.5%)',    type: null },      // calculated, read-only
  due_diligence_days: { label: 'Due Diligence', type: 'number', step: 1 },
  dd_deadline:        { label: 'DD Deadline',   type: 'date' },
  stage:              { label: 'Stage',         type: 'select' },
  close_date:         { label: 'Close Date',    type: 'date' },
}

const ALL_COL_KEYS = Object.keys(COL_DEFS)
const DEFAULT_COLS = ['tenant', 'address', 'city', 'state', 'cap_rate', 'purchase_price', 'fee', 'due_diligence_days', 'dd_deadline', 'stage']
const STORAGE_KEY  = 'pipeline_cols_v2'

const PRESETS = [
  { id: 'default',   label: 'Default',       cols: DEFAULT_COLS },
  { id: 'financial', label: 'Financial',     cols: ['tenant', 'purchase_price', 'fee', 'cap_rate', 'close_date', 'stage'] },
  { id: 'location',  label: 'Location',      cols: ['tenant', 'address', 'city', 'state', 'stage'] },
]

// ── Formatters ────────────────────────────────────────────────────────────────

function fmtPrice(v) {
  if (v == null || v === '') return null
  return '$' + Math.round(Number(v)).toLocaleString()
}

function fmtDate(iso) {
  if (!iso) return null
  return new Date(iso + 'T00:00:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
}

function StageBadge({ stage }) {
  const s = STAGE_MAP[stage]
  if (!s) return <span className="text-xs text-slate-400 italic">{stage || '—'}</span>
  return (
    <span className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium whitespace-nowrap ${s.bg} ${s.text}`}>
      <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${s.dot}`} />
      {s.label}
    </span>
  )
}

function displayValue(col, deal) {
  switch (col) {
    case 'tenant':             return deal.tenant || null
    case 'address':            return deal.address || null
    case 'city':               return deal.city || null
    case 'state':              return deal.state || null
    case 'cap_rate':           return deal.cap_rate != null ? `${Number(deal.cap_rate).toFixed(2)}%` : null
    case 'purchase_price':     return fmtPrice(deal.purchase_price)
    case 'fee':                return deal.purchase_price ? fmtPrice(deal.purchase_price * 0.015) : null
    case 'due_diligence_days': return deal.due_diligence_days ? `${deal.due_diligence_days} days` : null
    case 'dd_deadline':        return fmtDate(deal.dd_deadline)
    case 'stage':              return <StageBadge stage={deal.stage} />
    case 'close_date':         return fmtDate(deal.close_date)
    default:                   return null
  }
}

// Raw value used to seed the input when editing begins
function getRawValue(col, deal) {
  switch (col) {
    case 'cap_rate':           return deal.cap_rate        != null ? String(deal.cap_rate)        : ''
    case 'purchase_price':     return deal.purchase_price  != null ? String(Math.round(deal.purchase_price)) : ''
    case 'due_diligence_days': return deal.due_diligence_days != null ? String(deal.due_diligence_days) : ''
    case 'dd_deadline':        return deal.dd_deadline  ?? ''
    case 'close_date':         return deal.close_date   ?? ''
    case 'stage':              return deal.stage        ?? 'loi'
    default:                   return deal[col] ?? ''
  }
}

// Convert draft string back to the right type for saving
function processValue(col, draft) {
  switch (col) {
    case 'purchase_price':     return draft !== '' ? parseFloat(draft)  : null
    case 'cap_rate':           return draft !== '' ? parseFloat(draft)  : null
    case 'due_diligence_days': return draft !== '' ? parseInt(draft, 10) : null
    case 'stage':              return draft
    default:                   return draft.trim() || null
  }
}

// ── Sorting ───────────────────────────────────────────────────────────────────

const STAGE_ORDER = Object.fromEntries(TABLE_STAGES.map((s, i) => [s.key, i]))

function getSortValue(col, deal) {
  switch (col) {
    case 'cap_rate':           return deal.cap_rate        ?? -Infinity
    case 'purchase_price':     return deal.purchase_price  ?? -Infinity
    case 'fee':                return deal.purchase_price  ? deal.purchase_price * 0.015 : -Infinity
    case 'due_diligence_days': return deal.due_diligence_days ?? -Infinity
    case 'stage':              return STAGE_ORDER[deal.stage] ?? 99
    case 'dd_deadline':        return deal.dd_deadline  ?? ''
    case 'close_date':         return deal.close_date   ?? ''
    default:                   return (deal[col] ?? '').toString().toLowerCase()
  }
}

// ── Inline input component ────────────────────────────────────────────────────

function InlineInput({ col, draft, onChange, onCommit, onCancel }) {
  const ref = useRef()
  useEffect(() => { ref.current?.focus(); ref.current?.select?.() }, [])

  function onKeyDown(e) {
    if (e.key === 'Enter')  { e.preventDefault(); onCommit() }
    if (e.key === 'Escape') { e.preventDefault(); onCancel() }
  }

  const base = 'w-full bg-white border border-blue-400 rounded px-2 py-0.5 text-sm text-slate-800 outline-none ring-2 ring-blue-200'

  if (col === 'stage') {
    return (
      <select
        ref={ref}
        value={draft}
        onChange={e => onChange(e.target.value)}
        onBlur={onCommit}
        onKeyDown={onKeyDown}
        className={base}
      >
        {TABLE_STAGES.map(s => <option key={s.key} value={s.key}>{s.label}</option>)}
      </select>
    )
  }

  const def  = COL_DEFS[col]
  const type = def?.type === 'number' ? 'number' : def?.type === 'date' ? 'date' : 'text'

  return (
    <input
      ref={ref}
      type={type}
      value={draft}
      step={def?.step}
      min={def?.type === 'number' ? '0' : undefined}
      onChange={e => onChange(e.target.value)}
      onBlur={onCommit}
      onKeyDown={onKeyDown}
      className={base}
    />
  )
}

// ── Main component ────────────────────────────────────────────────────────────

export default function DealTable({ deals, onDelete, onCellSave, onCloseDeal, onDropDeal }) {
  const [activeCols, setActiveCols] = useState(() => loadSavedCols(STORAGE_KEY, DEFAULT_COLS, COL_DEFS))
  const [panelCols, setPanelCols]   = useState(() => buildPanelCols(loadSavedCols(STORAGE_KEY, DEFAULT_COLS, COL_DEFS), ALL_COL_KEYS))
  const [activePreset, setActivePreset] = useState(() => detectPreset(loadSavedCols(STORAGE_KEY, DEFAULT_COLS, COL_DEFS), PRESETS))
  const [showPanel, setShowPanel]   = useState(false)
  const [saved, setSaved]           = useState(false)
  const [sortCol, setSortCol]       = useState('tenant')
  const [sortDir, setSortDir]       = useState('asc')
  const [editing, setEditing]       = useState(null) // { dealId, col }
  const [draft, setDraft]           = useState('')
  const [closeMenu, setCloseMenu]   = useState(null) // { dealId, step: 'menu'|'confirm', action: 'closed'|'dropped' }
  const [actionWorking, setActionWorking] = useState(false)

  const sortedDeals = useMemo(() => {
    return [...deals].sort((a, b) => {
      const av = getSortValue(sortCol, a)
      const bv = getSortValue(sortCol, b)
      let cmp = typeof av === 'string' ? av.localeCompare(bv) : av < bv ? -1 : av > bv ? 1 : 0
      return sortDir === 'asc' ? cmp : -cmp
    })
  }, [deals, sortCol, sortDir])

  function handleSort(col) {
    if (col === 'fee') return // fee is calculated, sort by price instead
    if (col === sortCol) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortCol(col); setSortDir('asc') }
  }

  function startEdit(deal, col) {
    if (COL_DEFS[col]?.type === null) return // read-only (fee)
    setEditing({ dealId: deal.id, col })
    setDraft(getRawValue(col, deal))
  }

  function commitEdit() {
    if (!editing) return
    const { dealId, col } = editing
    const value = processValue(col, draft)
    setEditing(null)
    onCellSave(dealId, col, value)
  }

  function cancelEdit() {
    setEditing(null)
  }

  const handleToggle = useCallback(key => {
    setPanelCols(prev => {
      const next = prev.map(c => c.key === key ? { ...c, enabled: !c.enabled } : c)
      setActivePreset(detectPreset(next.filter(c => c.enabled).map(c => c.key), PRESETS))
      return next
    })
  }, [])

  const handleDragEnd = useCallback(({ source, destination }) => {
    if (!destination || source.index === destination.index) return
    setPanelCols(prev => {
      const next = [...prev]
      const [moved] = next.splice(source.index, 1)
      next.splice(destination.index, 0, moved)
      setActivePreset(detectPreset(next.filter(c => c.enabled).map(c => c.key), PRESETS))
      return next
    })
  }, [])

  const handlePreset = useCallback(preset => {
    setPanelCols(buildPanelCols(preset.cols, ALL_COL_KEYS))
    setActivePreset(preset.id)
  }, [])

  const handleSave = useCallback(() => {
    const cols = panelCols.filter(c => c.enabled).map(c => c.key)
    setActiveCols(cols)
    saveColsToStorage(STORAGE_KEY, cols)
    setSaved(true)
    setTimeout(() => setSaved(false), 1800)
    setShowPanel(false)
  }, [panelCols])

  if (deals.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-slate-400 gap-2">
        <p className="text-sm font-medium">No deals yet</p>
        <p className="text-xs">Drop an LOI (bottom-left) or click "New deal" to get started</p>
      </div>
    )
  }

  return (
    <>
      {/* Toolbar */}
      <div className="flex items-center justify-end px-6 pb-3">
        <button
          onClick={() => setShowPanel(v => !v)}
          className="flex items-center gap-1.5 text-xs font-medium text-slate-500 hover:text-slate-700 px-3 py-1.5 rounded-lg hover:bg-slate-100 transition-colors"
        >
          <Settings2 className="w-3.5 h-3.5" /> Customize Columns
        </button>
      </div>

      {/* Table */}
      <div className="pb-24 overflow-x-auto">
        <table className="w-full text-sm border-collapse">
          <thead>
            <tr className="bg-slate-50 border-y border-slate-200">
              {activeCols.map(col => (
                <th
                  key={col}
                  onClick={() => handleSort(col)}
                  className={`text-left text-xs font-semibold text-slate-500 uppercase tracking-wide px-4 py-3 whitespace-nowrap first:pl-6 last:pr-6 select-none ${
                    COL_DEFS[col]?.type !== null ? 'cursor-pointer hover:bg-slate-100 transition-colors' : ''
                  }`}
                >
                  <div className="flex items-center gap-1">
                    {COL_DEFS[col]?.label ?? col}
                    {COL_DEFS[col]?.type !== null && (
                      col === sortCol
                        ? sortDir === 'asc'
                          ? <ChevronUp className="w-3 h-3 text-blue-500" />
                          : <ChevronDown className="w-3 h-3 text-blue-500" />
                        : <ChevronsUpDown className="w-3 h-3 text-slate-300" />
                    )}
                  </div>
                </th>
              ))}
              <th className="px-3 py-3 pr-6 w-48" />
            </tr>
          </thead>
          <tbody>
            {sortedDeals.map((deal, i) => (
              <tr
                key={deal.id}
                className={i % 2 === 0 ? 'bg-white' : 'bg-slate-50/60'}
              >
                {activeCols.map(col => {
                  const isEditing = editing?.dealId === deal.id && editing?.col === col
                  const isReadOnly = COL_DEFS[col]?.type === null

                  return (
                    <td
                      key={col}
                      className={`px-4 first:pl-6 last:pr-6 border-b border-slate-100 ${
                        isEditing ? 'py-1' : 'py-3'
                      } ${!isReadOnly && !isEditing ? 'cursor-text hover:bg-blue-50/60 transition-colors' : ''}`}
                      onClick={() => !isEditing && !isReadOnly && startEdit(deal, col)}
                    >
                      {isEditing ? (
                        <InlineInput
                          col={col}
                          draft={draft}
                          onChange={setDraft}
                          onCommit={commitEdit}
                          onCancel={cancelEdit}
                        />
                      ) : (
                        <div className="min-w-0">
                          {col === 'stage' ? (
                            <StageBadge stage={deal.stage} />
                          ) : (
                            <span className={`block truncate max-w-[220px] ${
                              col === 'tenant'         ? 'font-semibold text-slate-800' :
                              col === 'purchase_price' ? 'font-medium text-slate-700' :
                              col === 'cap_rate'       ? 'font-medium text-slate-700' :
                              col === 'fee'            ? 'font-medium text-emerald-700' :
                              'text-slate-600'
                            }`}>
                              {displayValue(col, deal) ?? <span className="text-slate-300 font-normal">—</span>}
                            </span>
                          )}
                        </div>
                      )}
                    </td>
                  )
                })}

                {/* Actions cell */}
                <td className="px-3 py-3 pr-6 border-b border-slate-100 whitespace-nowrap">
                  <div className="flex items-center gap-1.5">
                    {/* Close / Drop inline menu */}
                    {closeMenu?.dealId === deal.id ? (
                      closeMenu.step === 'menu' ? (
                        <div className="flex items-center gap-1">
                          <button
                            onClick={e => { e.stopPropagation(); setCloseMenu({ dealId: deal.id, step: 'confirm', action: 'closed' }) }}
                            className="text-xs px-2 py-0.5 rounded bg-emerald-50 text-emerald-700 hover:bg-emerald-100 font-medium"
                          >
                            Close
                          </button>
                          <button
                            onClick={e => { e.stopPropagation(); setCloseMenu({ dealId: deal.id, step: 'confirm', action: 'dropped' }) }}
                            className="text-xs px-2 py-0.5 rounded bg-slate-100 text-slate-600 hover:bg-slate-200 font-medium"
                          >
                            Drop
                          </button>
                          <button
                            onClick={e => { e.stopPropagation(); setCloseMenu(null) }}
                            className="text-slate-300 hover:text-slate-500 ml-0.5"
                          >
                            <XCircle className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      ) : (
                        <div className="flex items-center gap-1">
                          <span className="text-xs text-slate-500">Sure?</span>
                          <button
                            disabled={actionWorking}
                            onClick={async e => {
                              e.stopPropagation()
                              const action = closeMenu.action
                              const dealId = deal.id
                              console.log('[Close/Drop] Yes clicked — action:', action, 'dealId:', dealId)
                              setActionWorking(true)
                              try {
                                if (action === 'closed') {
                                  console.log('[Close/Drop] calling onCloseDeal(', dealId, ')')
                                  await onCloseDeal(dealId)
                                } else {
                                  console.log('[Close/Drop] calling onDropDeal(', dealId, ')')
                                  await onDropDeal(dealId)
                                }
                                console.log('[Close/Drop] success')
                              } catch (err) {
                                console.error('[Close/Drop] error:', err)
                                alert(`Action failed: ${err.message}`)
                              } finally {
                                setActionWorking(false)
                                setCloseMenu(null)
                              }
                            }}
                            className="text-xs px-2 py-0.5 rounded bg-red-50 text-red-600 hover:bg-red-100 font-medium disabled:opacity-50"
                          >
                            {actionWorking ? '…' : 'Yes'}
                          </button>
                          <button
                            onClick={e => { e.stopPropagation(); setCloseMenu(null) }}
                            className="text-xs text-slate-400 hover:text-slate-600"
                          >
                            No
                          </button>
                        </div>
                      )
                    ) : (
                      <button
                        onClick={e => { e.stopPropagation(); setCloseMenu({ dealId: deal.id, step: 'menu' }) }}
                        className="text-xs text-slate-300 hover:text-slate-600 px-2 py-0.5 rounded hover:bg-slate-100 transition-colors"
                      >
                        Close / Drop
                      </button>
                    )}

                    <button
                      onClick={e => { e.stopPropagation(); onDelete(deal) }}
                      className="p-1.5 rounded hover:bg-red-50 text-slate-200 hover:text-red-500 transition-colors"
                      title="Delete deal"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Column customizer panel */}
      {showPanel && (
        <>
          <div className="fixed inset-0 z-30" onClick={() => setShowPanel(false)} />
          <ColumnCustomizer
            colDefs={COL_DEFS}
            presets={PRESETS}
            panelCols={panelCols}
            activePreset={activePreset}
            savedIndicator={saved}
            onToggle={handleToggle}
            onDragEnd={handleDragEnd}
            onPreset={handlePreset}
            onSave={handleSave}
            onClose={() => setShowPanel(false)}
          />
        </>
      )}
    </>
  )
}
