import { useState, useMemo, useEffect } from 'react'
import { Calculator, RotateCcw, TrendingUp } from 'lucide-react'

// ── Math ──────────────────────────────────────────────────────────────────────

const num = v => { const n = parseFloat(v); return Number.isFinite(n) ? n : 0 }

// IRR via bracketed bisection. Returns a decimal rate (0.25 = 25%) or null when
// the cash-flow stream has no sign change (no solvable IRR).
function irr(cashflows) {
  const npv = r => cashflows.reduce((s, cf, t) => s + cf / Math.pow(1 + r, t), 0)
  if (!cashflows.some(c => c < 0) || !cashflows.some(c => c > 0)) return null
  let lo = -0.9999, hi = 1
  let fLo = npv(lo), fHi = npv(hi), tries = 0
  while (fLo * fHi > 0 && hi < 1e6 && tries < 200) { hi *= 2; fHi = npv(hi); tries++ }
  if (fLo * fHi > 0) return null
  for (let i = 0; i < 200; i++) {
    const mid = (lo + hi) / 2, fMid = npv(mid)
    if (Math.abs(fMid) < 1e-7) return mid
    if (fLo * fMid < 0) { hi = mid; fHi = fMid } else { lo = mid; fLo = fMid }
  }
  return (lo + hi) / 2
}

// Levered net-lease model driven by going-in NOI (→ entry cap) and exit NOI
// (→ exit value). Lease fee + maintenance are one-time costs, paid with equity
// or rolled into the loan when "finance costs" is on. LTV = 0 → all-cash.
function buildModel(inp) {
  const price       = num(inp.price)
  const noi         = num(inp.noi)          // going-in NOI (operating cash flow each year)
  const exitNOI     = num(inp.exitNOI)      // stabilized NOI used only for the exit value
  const N           = Math.max(1, Math.round(num(inp.hold)))
  const exitCap     = num(inp.exitCap) / 100
  const ltv         = num(inp.ltv) / 100
  const rate        = num(inp.rate) / 100
  const amort       = num(inp.amortYears)   // 0 = interest-only
  const sellPct     = num(inp.sellingCost) / 100
  const leaseFee    = num(inp.leaseFee)
  const maintenance = num(inp.maintenance)
  const financeCosts = !!inp.financeCosts

  if (!price || !noi || !exitNOI || !exitCap) return null

  const entryCap = price > 0 ? noi / price : 0
  const extra    = leaseFee + maintenance
  const baseLoan = price * ltv
  const loan     = financeCosts ? baseLoan + extra : baseLoan
  const equity   = (price - baseLoan) + (financeCosts ? 0 : extra)
  if (equity <= 0) return null

  // Debt service + remaining balance at exit.
  const io = !amort || amort <= 0
  let annualDS, balanceAtN
  if (io) {
    annualDS = loan * rate
    balanceAtN = loan
  } else {
    const rMon = rate / 12, nMon = amort * 12
    const pay = rMon === 0 ? loan / nMon : loan * rMon / (1 - Math.pow(1 + rMon, -nMon))
    annualDS = pay * 12
    let bal = loan
    for (let m = 0; m < N * 12; m++) bal -= (pay - bal * rMon)
    balanceAtN = Math.max(0, bal)
  }

  // Operating cash flow uses the going-in NOI each year (flat); the exit value
  // uses the exit NOI ÷ exit cap.
  const years = []
  const cfs = [-equity]
  for (let i = 1; i <= N; i++) {
    const cf = noi - annualDS
    years.push({ year: i, noi, ds: annualDS, cashflow: cf })
    if (i < N) cfs.push(cf)
  }
  const exitValue    = exitNOI / exitCap
  const sellingCosts = exitValue * sellPct
  const netProceeds  = exitValue - sellingCosts - balanceAtN
  const lastYearCF   = years[N - 1].cashflow + netProceeds
  cfs.push(lastYearCF)
  years[N - 1] = { ...years[N - 1], sale: netProceeds, total: lastYearCF }

  const opCF          = years.reduce((s, y) => s + y.cashflow, 0)
  const distributions = opCF + netProceeds
  return {
    entryCap, noi, exitNOI, loan, equity, extra, financeCosts, annualDS, io, years,
    exitValue, sellingCosts, netProceeds, balanceAtN, irr: irr(cfs), emx: distributions / equity,
    coc1: years[0].cashflow / equity, avgCoC: (opCF / N) / equity, N, distributions,
  }
}

// ── Formatting ──────────────────────────────────────────────────────────────

const fmt$ = v => v == null || !Number.isFinite(v) ? '—' :
  (v < 0 ? '-$' : '$') + Math.round(Math.abs(v)).toLocaleString()
const fmtPct = v => v == null || !Number.isFinite(v) ? '—' : `${(v * 100).toFixed(2)}%`
const fmtX   = v => v == null || !Number.isFinite(v) ? '—' : `${v.toFixed(2)}x`

// ── Component ─────────────────────────────────────────────────────────────────

const DEFAULTS = {
  price: '', noi: '', exitNOI: '', hold: '5', exitCap: '',
  ltv: '60', rate: '6.5', amortYears: '0', sellingCost: '2',
  leaseFee: '0', maintenance: '0', financeCosts: false,
}

// Seed from the deal (NOI, price, cap), then let saved per-deal tweaks win.
function initialInputs(dealId, seedPrice, seedNOI, seedCap) {
  const price = seedPrice != null ? Math.round(seedPrice) : null
  const noi = seedNOI != null ? Math.round(seedNOI)
    : (price != null && seedCap != null ? Math.round(price * seedCap / 100) : null)
  const entryCapPct = seedCap != null ? seedCap
    : (noi != null && price ? +(noi / price * 100).toFixed(2) : null)
  const seeded = {
    ...DEFAULTS,
    price:   price != null ? String(price) : '',
    noi:     noi != null ? String(noi) : '',
    exitNOI: noi != null ? String(noi) : '',            // default exit NOI = going-in NOI
    exitCap: entryCapPct != null ? String(entryCapPct) : '',
  }
  try {
    const saved = JSON.parse(localStorage.getItem(`deal_calc_v2_${dealId}`) || 'null')
    if (saved) return { ...seeded, ...saved }
  } catch { /* ignore */ }
  return seeded
}

export default function ReturnsCalculator({ dealId, seedPrice, seedNOI, seedCap }) {
  const [inp, setInp] = useState(() => initialInputs(dealId, seedPrice, seedNOI, seedCap))

  useEffect(() => {
    try { localStorage.setItem(`deal_calc_v2_${dealId}`, JSON.stringify(inp)) } catch { /* ignore */ }
  }, [inp, dealId])

  const model = useMemo(() => buildModel(inp), [inp])
  const set = (k) => (e) => setInp(p => ({ ...p, [k]: e.target.value }))
  const toggle = (k) => (e) => setInp(p => ({ ...p, [k]: e.target.checked }))
  const reset = () => {
    try { localStorage.removeItem(`deal_calc_v2_${dealId}`) } catch { /* ignore */ }
    setInp(initialInputs(dealId, seedPrice, seedNOI, seedCap))
  }

  const extra   = num(inp.leaseFee) + num(inp.maintenance)
  const hasLoan = num(inp.ltv) > 0 || (inp.financeCosts && extra > 0)
  const entryCapPreview = num(inp.price) > 0 && num(inp.noi) > 0 ? num(inp.noi) / num(inp.price) : null
  const exitPreview = num(inp.exitCap) > 0 && num(inp.exitNOI) > 0 ? num(inp.exitNOI) / (num(inp.exitCap) / 100) : null

  return (
    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
      <div className="flex items-center justify-between px-5 py-3.5 border-b border-slate-100 bg-slate-50/60">
        <div className="flex items-center gap-2">
          <Calculator className="w-4 h-4 text-blue-500" />
          <h3 className="text-sm font-semibold text-slate-800">Quick Returns — IRR &amp; Equity Multiple</h3>
        </div>
        <button onClick={reset} className="flex items-center gap-1 text-xs text-slate-400 hover:text-slate-600">
          <RotateCcw className="w-3 h-3" /> Reset to deal
        </button>
      </div>

      <div className="grid md:grid-cols-2 gap-5 p-5">
        {/* Inputs */}
        <div className="space-y-3">
          <p className="text-xs font-semibold text-slate-400 uppercase tracking-widest">Assumptions</p>
          <div className="grid grid-cols-2 gap-3">
            <NumIn label="Purchase Price" prefix="$" value={inp.price} onChange={set('price')} />
            <Computed label="Entry Cap (auto)" value={fmtPct(entryCapPreview)} />
            <NumIn label="Going-in NOI" prefix="$" value={inp.noi} onChange={set('noi')} />
            <NumIn label="Exit NOI"     prefix="$" value={inp.exitNOI} onChange={set('exitNOI')} />
            <NumIn label="Exit Cap" suffix="%" value={inp.exitCap} onChange={set('exitCap')} step="0.01" />
            <Computed label="Exit Value (auto)" value={fmt$(exitPreview)} />
            <NumIn label="Hold Period" suffix="yrs" value={inp.hold} onChange={set('hold')} step="1" />
            <NumIn label="Selling Costs" suffix="%" value={inp.sellingCost} onChange={set('sellingCost')} step="0.1" />
            <NumIn label="Lease Fee" prefix="$" value={inp.leaseFee} onChange={set('leaseFee')} />
            <NumIn label="Maintenance Expense" prefix="$" value={inp.maintenance} onChange={set('maintenance')} />
          </div>
          <label className="flex items-center gap-2 text-xs text-slate-600 cursor-pointer select-none">
            <input type="checkbox" checked={inp.financeCosts} onChange={toggle('financeCosts')} className="accent-blue-600 w-3.5 h-3.5" />
            Finance lease fee &amp; maintenance in the loan
          </label>

          {/* Leverage */}
          <div className="pt-1">
            <div className="flex items-center justify-between mb-1">
              <label className="text-xs font-medium text-slate-500">Leverage (LTV)</label>
              <span className="text-xs font-bold text-slate-800">{num(inp.ltv)}%{num(inp.ltv) === 0 && <span className="ml-1 font-normal text-slate-400">all-cash</span>}</span>
            </div>
            <input type="range" min="0" max="85" step="5" value={inp.ltv} onChange={set('ltv')} className="w-full accent-blue-600" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <NumIn label="Interest Rate" suffix="%" value={inp.rate} onChange={set('rate')} step="0.05" disabled={!hasLoan} />
            <NumIn label="Amortization" suffix="yrs" value={inp.amortYears} onChange={set('amortYears')} step="1" hint="0 = interest-only" disabled={!hasLoan} />
          </div>
        </div>

        {/* Results */}
        <div className="space-y-3">
          <p className="text-xs font-semibold text-slate-400 uppercase tracking-widest">Estimated Return</p>
          <div className="grid grid-cols-2 gap-3">
            <Headline label="Levered IRR" value={fmtPct(model?.irr)} accent="blue" />
            <Headline label="Equity Multiple" value={fmtX(model?.emx)} accent="emerald" />
          </div>
          <div className="rounded-xl border border-slate-100 divide-y divide-slate-100 text-sm">
            <Row label="Entry Cap"           value={fmtPct(model?.entryCap)} />
            <Row label="Going-in NOI"        value={fmt$(model?.noi)} />
            <Row label="Equity Invested"     value={fmt$(model?.equity)} />
            <Row label={`Loan Amount${model?.financeCosts && model?.extra ? ' (incl. costs)' : ''}`} value={fmt$(model?.loan)} />
            <Row label={`Annual Debt Service${model && !model.io ? ' (amort.)' : model ? ' (IO)' : ''}`} value={fmt$(model?.annualDS)} />
            <Row label="Avg Cash-on-Cash"    value={fmtPct(model?.avgCoC)} />
            <Row label="Exit Value"          value={fmt$(model?.exitValue)} />
            <Row label="Net Sale Proceeds"   value={fmt$(model?.netProceeds)} />
          </div>
          {!model && <p className="text-xs text-amber-600">Enter a purchase price, going-in NOI, exit NOI, and exit cap to calculate.</p>}
        </div>
      </div>

      {/* Cash-flow schedule */}
      {model && (
        <div className="px-5 pb-5">
          <div className="flex items-center gap-1.5 mb-2">
            <TrendingUp className="w-3.5 h-3.5 text-slate-400" />
            <p className="text-xs font-semibold text-slate-400 uppercase tracking-widest">Cash Flow</p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr className="text-xs text-slate-400 border-b border-slate-100">
                  <th className="text-left font-medium py-1.5 pr-3">Year</th>
                  <th className="text-right font-medium py-1.5 px-3">NOI</th>
                  <th className="text-right font-medium py-1.5 px-3">Debt Service</th>
                  <th className="text-right font-medium py-1.5 px-3">Cash Flow</th>
                  <th className="text-right font-medium py-1.5 pl-3">Sale</th>
                </tr>
              </thead>
              <tbody>
                <tr className="border-b border-slate-50">
                  <td className="py-1.5 pr-3 text-slate-500">0</td>
                  <td className="py-1.5 px-3 text-right text-slate-300">—</td>
                  <td className="py-1.5 px-3 text-right text-slate-300">—</td>
                  <td className="py-1.5 px-3 text-right font-medium text-red-600">{fmt$(-model.equity)}</td>
                  <td className="py-1.5 pl-3 text-right text-slate-300">—</td>
                </tr>
                {model.years.map(y => (
                  <tr key={y.year} className="border-b border-slate-50">
                    <td className="py-1.5 pr-3 text-slate-500">{y.year}</td>
                    <td className="py-1.5 px-3 text-right text-slate-600">{fmt$(y.noi)}</td>
                    <td className="py-1.5 px-3 text-right text-slate-500">{model.annualDS ? fmt$(-y.ds) : '—'}</td>
                    <td className="py-1.5 px-3 text-right font-medium text-slate-800">{fmt$(y.cashflow)}</td>
                    <td className="py-1.5 pl-3 text-right text-emerald-700">{y.sale != null ? fmt$(y.sale) : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-[11px] text-slate-400 mt-2 leading-relaxed">
            Quick estimate only. Entry cap = NOI ÷ price. Operating cash flow uses the going-in NOI each year; the
            exit value uses exit NOI ÷ exit cap, net of selling costs and loan payoff. Not a substitute for a full underwrite.
          </p>
        </div>
      )}
    </div>
  )
}

// ── Small UI pieces ──────────────────────────────────────────────────────────

function NumIn({ label, value, onChange, prefix, suffix, step, hint, disabled }) {
  return (
    <div>
      <label className="block text-xs font-medium text-slate-500 mb-1">{label}</label>
      <div className={`relative flex items-center rounded-lg border ${disabled ? 'bg-slate-50 border-slate-100' : 'border-slate-200 focus-within:border-blue-400 focus-within:ring-2 focus-within:ring-blue-500/20'}`}>
        {prefix && <span className="pl-2.5 text-sm text-slate-400">{prefix}</span>}
        <input
          type="number" inputMode="decimal" value={value} onChange={onChange} step={step} disabled={disabled}
          className="w-full bg-transparent px-2.5 py-1.5 text-sm text-slate-800 outline-none disabled:text-slate-400"
        />
        {suffix && <span className="pr-2.5 text-sm text-slate-400">{suffix}</span>}
      </div>
      {hint && <p className="text-[10px] text-slate-400 mt-0.5">{hint}</p>}
    </div>
  )
}

// Read-only auto-computed value styled like an input.
function Computed({ label, value }) {
  return (
    <div>
      <label className="block text-xs font-medium text-slate-500 mb-1">{label}</label>
      <div className="flex items-center rounded-lg border border-dashed border-slate-200 bg-slate-50 px-2.5 py-1.5">
        <span className="text-sm font-semibold text-slate-700">{value}</span>
      </div>
    </div>
  )
}

function Headline({ label, value, accent }) {
  const color = accent === 'emerald' ? 'text-emerald-700' : 'text-blue-700'
  const bg    = accent === 'emerald' ? 'bg-emerald-50 border-emerald-100' : 'bg-blue-50 border-blue-100'
  return (
    <div className={`rounded-xl border px-4 py-3 ${bg}`}>
      <p className="text-xs font-medium text-slate-500">{label}</p>
      <p className={`text-2xl font-bold ${color} tabular-nums`}>{value}</p>
    </div>
  )
}

function Row({ label, value }) {
  return (
    <div className="flex items-center justify-between px-3 py-2">
      <span className="text-slate-500">{label}</span>
      <span className="font-medium text-slate-800 tabular-nums">{value}</span>
    </div>
  )
}
