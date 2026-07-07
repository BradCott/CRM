import { useState } from 'react'
import { Download, ChevronDown, FileSpreadsheet, FileText } from 'lucide-react'
import { exportReport } from '../../utils/accountingExport'

// Export just this report (with its current period/filter). buildRows() returns
// the array-of-arrays for the report at call time, so it reflects live filters.
export default function ReportExportButton({ property, title, subtitle = '', buildRows, isGrid = false }) {
  const [open, setOpen] = useState(false)
  const go = (format) => { setOpen(false); exportReport(format, { property, title, subtitle, rows: buildRows(), isGrid }) }
  return (
    <div className="relative">
      <button onClick={() => setOpen(o => !o)}
        className="inline-flex items-center gap-1 text-xs font-medium text-slate-500 border border-slate-200 rounded-lg px-2.5 py-1.5 hover:bg-slate-50 transition-colors">
        <Download className="w-3.5 h-3.5" /> Export <ChevronDown className="w-3 h-3" />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-30" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-9 z-40 w-36 bg-white border border-slate-200 rounded-xl shadow-lg py-1 text-sm">
            <button onClick={() => go('excel')} className="w-full text-left px-3 py-2 text-slate-700 hover:bg-slate-50 flex items-center gap-2">
              <FileSpreadsheet className="w-4 h-4 text-emerald-600" /> Excel
            </button>
            <button onClick={() => go('pdf')} className="w-full text-left px-3 py-2 text-slate-700 hover:bg-slate-50 flex items-center gap-2">
              <FileText className="w-4 h-4 text-red-500" /> PDF
            </button>
          </div>
        </>
      )}
    </div>
  )
}
