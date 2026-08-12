// Books Health Check panel — renders checkBooksHealth() findings. Used on the
// accounting page (collapsible one-line bar) and inside the Accountant Bundle
// modal (expanded, as a gate before sending). Read-only; it points at problems.
import { useMemo, useState } from 'react'
import { ShieldCheck, AlertTriangle, AlertCircle, Info, ChevronDown, ChevronRight } from 'lucide-react'
import { checkBooksHealth } from '../../utils/booksHealth'

const STYLES = {
  error:   { icon: AlertCircle,   chip: 'bg-red-100 text-red-700',     dot: 'text-red-500' },
  warning: { icon: AlertTriangle, chip: 'bg-amber-100 text-amber-700', dot: 'text-amber-500' },
  info:    { icon: Info,          chip: 'bg-slate-100 text-slate-600', dot: 'text-slate-400' },
}

export default function BooksHealthCheck({
  transactions = [], investors = [], bankBalance = null,
  collapsible = false, defaultOpen = false,
}) {
  const result = useMemo(
    () => checkBooksHealth(transactions, { investors, bankBalance }),
    [transactions, investors, bankBalance],
  )
  const [open, setOpen] = useState(defaultOpen)

  const { errors, warnings, ok } = result
  const headline = ok
    ? 'Books look healthy'
    : [errors ? `${errors} ${errors === 1 ? 'issue' : 'issues'} to fix` : null,
       warnings ? `${warnings} to review` : null].filter(Boolean).join(' · ')

  const tone = ok ? 'emerald' : errors ? 'red' : 'amber'
  const barColor = { emerald: 'border-emerald-200 bg-emerald-50', red: 'border-red-200 bg-red-50/50', amber: 'border-amber-200 bg-amber-50/50' }[tone]
  const HeadIcon = ok ? ShieldCheck : errors ? AlertCircle : AlertTriangle
  const headIconColor = { emerald: 'text-emerald-600', red: 'text-red-600', amber: 'text-amber-600' }[tone]

  const header = (
    <div className={`flex items-center gap-2 px-3 py-2 ${collapsible ? 'cursor-pointer select-none' : ''}`}
         onClick={collapsible ? () => setOpen(o => !o) : undefined}>
      <HeadIcon className={`shrink-0 ${headIconColor}`} style={{ width: 18, height: 18 }} />
      <p className="text-sm font-semibold text-slate-800">
        Books Health Check {ok ? '' : '— '}<span className="font-medium text-slate-600">{headline}</span>
      </p>
      {collapsible && !ok && (
        <span className="ml-auto text-slate-400">
          {open ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
        </span>
      )}
    </div>
  )

  // Healthy, or collapsed on the ledger page → just the one-line bar.
  if (ok || (collapsible && !open)) {
    return <div className={`rounded-lg border ${barColor}`}>{header}</div>
  }

  return (
    <div className={`rounded-lg border ${barColor}`}>
      <div className="border-b border-black/5">{header}</div>
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
