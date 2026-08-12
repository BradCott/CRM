// Books Health Check panel — renders checkBooksHealth() findings. Used on the
// accounting page (always visible) and inside the Accountant Bundle modal (as a
// gate before sending). Read-only; it points at problems, it doesn't fix them.
import { useMemo } from 'react'
import { ShieldCheck, AlertTriangle, AlertCircle, Info } from 'lucide-react'
import { checkBooksHealth } from '../../utils/booksHealth'

const STYLES = {
  error:   { icon: AlertCircle,   ring: 'border-red-200',    chip: 'bg-red-100 text-red-700',       dot: 'text-red-500' },
  warning: { icon: AlertTriangle, ring: 'border-amber-200',  chip: 'bg-amber-100 text-amber-700',   dot: 'text-amber-500' },
  info:    { icon: Info,          ring: 'border-slate-200',  chip: 'bg-slate-100 text-slate-600',   dot: 'text-slate-400' },
}

export default function BooksHealthCheck({ transactions = [], investors = [], bankBalance = null, compact = false }) {
  const result = useMemo(
    () => checkBooksHealth(transactions, { investors, bankBalance }),
    [transactions, investors, bankBalance],
  )

  if (result.ok) {
    return (
      <div className="flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2.5">
        <ShieldCheck className="w-5 h-5 text-emerald-600 shrink-0" />
        <div>
          <p className="text-sm font-medium text-emerald-800">Books look healthy</p>
          {!compact && <p className="text-xs text-emerald-600">No loan, cash, categorization, or close-out problems detected.</p>}
        </div>
      </div>
    )
  }

  const { errors, warnings } = result
  const headline = [
    errors ? `${errors} ${errors === 1 ? 'issue' : 'issues'} to fix` : null,
    warnings ? `${warnings} to review` : null,
  ].filter(Boolean).join(' · ')

  return (
    <div className={`rounded-lg border ${errors ? 'border-red-200 bg-red-50/40' : 'border-amber-200 bg-amber-50/40'}`}>
      <div className="flex items-center gap-2 px-3 py-2.5 border-b border-black/5">
        {errors
          ? <AlertCircle className="w-5 h-5 text-red-600 shrink-0" />
          : <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0" />}
        <p className="text-sm font-semibold text-slate-800">Books Health Check — {headline}</p>
      </div>
      <ul className="divide-y divide-black/5">
        {result.findings.map((f, i) => {
          const s = STYLES[f.severity] || STYLES.info
          const Icon = s.icon
          return (
            <li key={i} className="flex gap-2.5 px-3 py-2.5">
              <Icon className={`w-4 h-4 mt-0.5 shrink-0 ${s.dot}`} />
              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-sm font-medium text-slate-800">{f.title}</span>
                  <span className={`text-[10px] uppercase tracking-wide font-semibold rounded px-1.5 py-0.5 ${s.chip}`}>{f.severity}</span>
                </div>
                <p className="text-xs text-slate-600 mt-0.5 leading-relaxed">{f.detail}</p>
              </div>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
