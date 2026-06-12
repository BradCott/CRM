// 10-Year Treasury — 6-month yield chart with today's rate front and center
import { useState, useEffect } from 'react'
import { TrendingUp, TrendingDown, Minus, Loader2 } from 'lucide-react'
import { getTreasury } from '../../api/client'

function fmtDate(iso) {
  return new Date(iso + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

export default function TreasuryChart() {
  const [data, setData]       = useState(null)
  const [loading, setLoading] = useState(true)
  const [hover, setHover]     = useState(null)   // index into series

  useEffect(() => {
    getTreasury().then(setData).catch(console.error).finally(() => setLoading(false))
  }, [])

  if (loading) return (
    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm px-5 py-8 flex justify-center">
      <Loader2 className="w-5 h-5 text-slate-400 animate-spin" />
    </div>
  )
  if (!data?.series?.length) return null

  const { series, latest } = data
  const rates = series.map(p => p.rate)
  const min = Math.min(...rates)
  const max = Math.max(...rates)
  const pad = (max - min) * 0.12 || 0.1
  const lo = min - pad
  const hi = max + pad

  // Chart geometry
  const W = 300, H = 80
  const x = i => (i / (series.length - 1)) * W
  const y = v => H - ((v - lo) / (hi - lo)) * H

  const points = series.map((p, i) => `${x(i).toFixed(1)},${y(p.rate).toFixed(1)}`).join(' ')
  const areaPath = `M0,${H} L${points.split(' ').join(' L')} L${W},${H} Z`

  // Deltas
  const prev    = series.length > 1 ? series[series.length - 2].rate : latest.rate
  const dayChg  = latest.rate - prev
  const sixMoChg = latest.rate - series[0].rate

  const trendIcon = dayChg > 0.001 ? TrendingUp : dayChg < -0.001 ? TrendingDown : Minus
  const TrendIcon = trendIcon
  // For a buyer, rising rates are the warning color
  const trendColor = dayChg > 0.001 ? 'text-red-600' : dayChg < -0.001 ? 'text-emerald-600' : 'text-slate-400'

  const shown = hover != null ? series[hover] : null

  function handleMove(e) {
    const rect = e.currentTarget.getBoundingClientRect()
    const frac = (e.clientX - rect.left) / rect.width
    const idx = Math.round(frac * (series.length - 1))
    setHover(Math.max(0, Math.min(series.length - 1, idx)))
  }

  return (
    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
      <div className="flex items-center justify-between px-5 py-3.5 border-b border-slate-100">
        <h2 className="text-sm font-bold text-slate-800">10-Year Treasury</h2>
        <span className="text-xs text-slate-400">6 months</span>
      </div>

      <div className="px-5 pt-4">
        <div className="flex items-baseline justify-between">
          <div className="flex items-baseline gap-2">
            <span className="text-3xl font-bold text-slate-900 tabular-nums">
              {(shown ? shown.rate : latest.rate).toFixed(2)}%
            </span>
            {!shown && (
              <span className={`flex items-center gap-0.5 text-xs font-semibold ${trendColor}`}>
                <TrendIcon className="w-3.5 h-3.5" />
                {dayChg >= 0 ? '+' : ''}{(dayChg * 100).toFixed(0)} bps
              </span>
            )}
          </div>
          <span className="text-xs text-slate-400">
            {shown ? fmtDate(shown.date) : `as of ${fmtDate(latest.date)}`}
          </span>
        </div>
        <p className="text-xs text-slate-400 mt-0.5">
          {sixMoChg >= 0 ? '+' : ''}{(sixMoChg * 100).toFixed(0)} bps over 6 months · range {min.toFixed(2)}–{max.toFixed(2)}%
        </p>
      </div>

      <div
        className="px-5 pb-4 pt-2 cursor-crosshair"
        onMouseMove={handleMove}
        onMouseLeave={() => setHover(null)}
      >
        <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ height: 90 }} preserveAspectRatio="none">
          <path d={areaPath} fill="rgb(219 234 254)" opacity="0.6" />
          <polyline points={points} fill="none" stroke="rgb(37 99 235)" strokeWidth="1.8" vectorEffect="non-scaling-stroke" />
          {hover != null && (
            <line x1={x(hover)} y1="0" x2={x(hover)} y2={H} stroke="rgb(148 163 184)" strokeWidth="1" strokeDasharray="3,2" vectorEffect="non-scaling-stroke" />
          )}
          <circle
            cx={x(hover != null ? hover : series.length - 1)}
            cy={y((hover != null ? series[hover] : latest).rate)}
            r="3.5"
            fill="rgb(37 99 235)"
            stroke="white"
            strokeWidth="1.5"
          />
        </svg>
        <div className="flex justify-between mt-1">
          <span className="text-[10px] text-slate-400">{fmtDate(series[0].date)}</span>
          <span className="text-[10px] text-slate-400">{fmtDate(latest.date)}</span>
        </div>
      </div>
    </div>
  )
}
