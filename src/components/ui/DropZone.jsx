// Reusable drag-and-drop file input. Drop a file (or multiple) OR click to browse.
import { useState, useRef } from 'react'
import { Upload, Loader2 } from 'lucide-react'

export default function DropZone({ onFile, onFiles, multiple = false, accept, label = 'Drop a file or click to browse', hint, busy, disabled, className = '' }) {
  const [drag, setDrag] = useState(false)
  const ref = useRef(null)

  function emit(fileList) {
    const files = Array.from(fileList || [])
    if (!files.length) return
    if (multiple && onFiles) onFiles(files)
    else if (onFile) onFile(files[0])
  }

  return (
    <div
      onClick={() => { if (!disabled && !busy) ref.current?.click() }}
      onDragOver={e => { e.preventDefault(); if (!disabled) setDrag(true) }}
      onDragLeave={() => setDrag(false)}
      onDrop={e => { e.preventDefault(); setDrag(false); if (!disabled && !busy) emit(e.dataTransfer.files) }}
      className={`border-2 border-dashed rounded-xl text-center cursor-pointer transition-colors ${
        drag ? 'border-blue-400 bg-blue-50' : 'border-slate-200 hover:border-slate-300 hover:bg-slate-50'
      } ${(disabled || busy) ? 'opacity-60 pointer-events-none' : ''} ${className}`}
    >
      <input ref={ref} type="file" accept={accept} multiple={multiple} className="hidden" onChange={e => { emit(e.target.files); e.target.value = '' }} />
      <div className="flex items-center justify-center gap-2 py-3 px-3 text-sm text-slate-500">
        {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
        <span>{busy ? 'Uploading…' : label}</span>
      </div>
      {hint && <p className="text-[11px] text-slate-400 pb-2 -mt-1">{hint}</p>}
    </div>
  )
}
