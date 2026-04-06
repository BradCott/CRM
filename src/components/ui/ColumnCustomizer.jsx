/**
 * Shared column-customizer panel + utility functions.
 * Used by PropertiesPage, PortfolioPage, and PeoplePage.
 */
import { Settings2, X, GripVertical, Check, CheckCircle2 } from 'lucide-react'
import { DragDropContext, Droppable, Draggable } from '@hello-pangea/dnd'

// ── Utilities ─────────────────────────────────────────────────────────────────

/** Build the full ordered [{key, enabled}] list for the panel from saved active-col keys. */
export function buildPanelCols(activeCols, allColKeys) {
  const activeSet = new Set(activeCols)
  return [
    ...activeCols.map(k => ({ key: k, enabled: true })),
    ...allColKeys.filter(k => !activeSet.has(k)).map(k => ({ key: k, enabled: false })),
  ]
}

/** Load saved col keys from localStorage; falls back to defaultCols. */
export function loadSavedCols(storageKey, defaultCols, colDefs) {
  try {
    const raw = localStorage.getItem(storageKey)
    if (raw) {
      const saved = JSON.parse(raw)
      const valid = saved.filter(k => colDefs[k])
      if (valid.length > 0) return valid
    }
  } catch (_) {}
  return defaultCols
}

/** Return the preset id whose cols exactly match the given array, or null. */
export function detectPreset(cols, presets) {
  for (const p of presets) {
    if (cols.length === p.cols.length && cols.every((k, i) => k === p.cols[i])) return p.id
  }
  return null
}

/** Persist col keys to localStorage. */
export function saveColsToStorage(storageKey, cols) {
  try { localStorage.setItem(storageKey, JSON.stringify(cols)) } catch (_) {}
}

// ── Panel component ───────────────────────────────────────────────────────────

/**
 * Generic slide-in column-customizer panel.
 *
 * Props:
 *   colDefs      – { [key]: { label } }
 *   presets      – [{ id, label, cols }]
 *   panelCols    – [{ key, enabled }]  (ordered full list)
 *   activePreset – string|null
 *   savedIndicator – bool
 *   onToggle(key)
 *   onDragEnd(result)
 *   onPreset(preset)
 *   onSave()
 *   onClose()
 */
export default function ColumnCustomizer({
  colDefs, presets,
  panelCols, activePreset, savedIndicator,
  onToggle, onDragEnd, onPreset, onSave, onClose,
}) {
  return (
    <div
      className="fixed inset-y-0 right-0 w-72 bg-white border-l border-slate-200 shadow-2xl z-40 flex flex-col"
      onClick={e => e.stopPropagation()}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100 shrink-0">
        <div className="flex items-center gap-2">
          <Settings2 className="w-4 h-4 text-slate-400" />
          <h2 className="text-sm font-bold text-slate-800">Customize Columns</h2>
        </div>
        <button onClick={onClose} className="w-8 h-8 rounded-lg flex items-center justify-center text-slate-400 hover:bg-slate-100">
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Preset views */}
      <div className="px-5 py-4 border-b border-slate-100 shrink-0">
        <p className="text-xs font-semibold text-slate-400 uppercase tracking-widest mb-3">Saved Views</p>
        <div className="space-y-1">
          {presets.map(preset => (
            <button
              key={preset.id}
              onClick={() => onPreset(preset)}
              className={`w-full text-left px-3 py-2 rounded-lg text-sm font-medium transition-colors flex items-center justify-between ${
                activePreset === preset.id
                  ? 'bg-blue-50 text-blue-700'
                  : 'text-slate-600 hover:bg-slate-50'
              }`}
            >
              {preset.label}
              {activePreset === preset.id && <Check className="w-3.5 h-3.5 text-blue-500" />}
            </button>
          ))}
        </div>
      </div>

      {/* Draggable column list */}
      <div className="flex-1 overflow-y-auto px-5 py-4">
        <p className="text-xs font-semibold text-slate-400 uppercase tracking-widest mb-3">
          Column Order
          <span className="ml-2 text-slate-300 font-normal normal-case tracking-normal">drag to reorder</span>
        </p>
        <DragDropContext onDragEnd={onDragEnd}>
          <Droppable droppableId="cols">
            {(provided) => (
              <div ref={provided.innerRef} {...provided.droppableProps} className="space-y-0.5">
                {panelCols.map((col, index) => (
                  <Draggable key={col.key} draggableId={col.key} index={index}>
                    {(provided, snapshot) => (
                      <div
                        ref={provided.innerRef}
                        {...provided.draggableProps}
                        className={`flex items-center gap-2.5 px-2 py-2 rounded-lg select-none transition-colors ${
                          snapshot.isDragging ? 'bg-blue-50 shadow-md ring-1 ring-blue-100' : 'hover:bg-slate-50'
                        }`}
                      >
                        <div
                          {...provided.dragHandleProps}
                          className="text-slate-300 hover:text-slate-400 cursor-grab active:cursor-grabbing shrink-0"
                        >
                          <GripVertical className="w-4 h-4" />
                        </div>
                        <button
                          type="button"
                          onClick={() => onToggle(col.key)}
                          className={`w-4 h-4 rounded border-2 flex items-center justify-center shrink-0 transition-colors ${
                            col.enabled ? 'bg-blue-600 border-blue-600' : 'border-slate-300 bg-white'
                          }`}
                        >
                          {col.enabled && <Check className="w-2.5 h-2.5 text-white" strokeWidth={3} />}
                        </button>
                        <span className={`text-sm leading-none ${col.enabled ? 'text-slate-800 font-medium' : 'text-slate-400'}`}>
                          {colDefs[col.key]?.label ?? col.key}
                        </span>
                      </div>
                    )}
                  </Draggable>
                ))}
                {provided.placeholder}
              </div>
            )}
          </Droppable>
        </DragDropContext>
      </div>

      {/* Footer */}
      <div className="px-5 py-4 border-t border-slate-100 shrink-0 space-y-2">
        <button
          onClick={onSave}
          className={`w-full flex items-center justify-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold transition-colors ${
            savedIndicator
              ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
              : 'bg-blue-600 text-white hover:bg-blue-700'
          }`}
        >
          {savedIndicator ? <><CheckCircle2 className="w-4 h-4" /> Saved</> : 'Save View'}
        </button>
        <p className="text-xs text-slate-400 text-center">Saved views persist across sessions</p>
      </div>
    </div>
  )
}
