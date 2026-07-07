import { useState } from 'react'
import { CalendarOff, Play, ChevronDown } from 'lucide-react'
import { setMailPause } from '../../api/client'

const OPTIONS = [
  { key: '6m',      label: '6 months' },
  { key: '1y',      label: '1 year' },
  { key: '2y',      label: '2 years' },
  { key: '3y',      label: '3 years' },
  { key: 'forever', label: 'Forever' },
]

const today = () => new Date().toISOString().slice(0, 10)
export const isPaused = (until) => !!until && until >= today()
export function pauseLabel(until) {
  if (!isPaused(until)) return null
  if (until >= '2999-01-01') return 'Paused — forever'
  return `Paused until ${new Date(until + 'T00:00:00').toLocaleDateString(undefined, { month: 'short', year: 'numeric' })}`
}

// Compact pause/resume control for a contact's mailings.
export default function MailPauseControl({ personId, pausedUntil, onChange }) {
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const paused = isPaused(pausedUntil)

  async function apply(duration) {
    setBusy(true)
    try {
      const r = await setMailPause(personId, duration)
      onChange?.(r.mail_pause_until)
    } catch (e) { alert(e.message) }
    setBusy(false); setOpen(false)
  }

  return (
    <div className="relative inline-block">
      <button
        onClick={() => setOpen(v => !v)}
        disabled={busy}
        className={`inline-flex items-center gap-1 text-xs font-medium px-2 py-1 rounded-lg border transition-colors ${
          paused ? 'bg-amber-50 text-amber-700 border-amber-200 hover:bg-amber-100'
                 : 'text-slate-500 border-slate-200 hover:bg-slate-50'
        }`}
        title={paused ? pauseLabel(pausedUntil) : 'Pause mailing to this contact'}
      >
        <CalendarOff className="w-3.5 h-3.5" />
        {paused ? pauseLabel(pausedUntil) : 'Pause mailing'}
        <ChevronDown className="w-3 h-3" />
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-8 z-20 w-44 bg-white border border-slate-200 rounded-xl shadow-lg py-1 text-sm">
            <p className="px-3 py-1 text-[10px] font-semibold text-slate-400 uppercase tracking-wide">Remove from mailing</p>
            {OPTIONS.map(o => (
              <button key={o.key} onClick={() => apply(o.key)}
                className="w-full text-left px-3 py-1.5 text-slate-700 hover:bg-slate-50">
                {o.label}
              </button>
            ))}
            {paused && (
              <button onClick={() => apply('resume')}
                className="w-full text-left px-3 py-1.5 text-emerald-700 hover:bg-emerald-50 flex items-center gap-1.5 border-t border-slate-100 mt-1">
                <Play className="w-3.5 h-3.5" /> Resume mailing
              </button>
            )}
          </div>
        </>
      )}
    </div>
  )
}
