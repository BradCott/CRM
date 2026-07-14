// "We Sold the Building" — guided sale close-out.
// Steps: Sale → Safety check → Reserves → Distribute (waterfall) → Review & confirm.
// The waterfall (computeWaterfall) matches Knox's deal calculator to the cent.
import { useState, useEffect, useMemo } from 'react'
import {
  X, Loader2, AlertTriangle, CheckCircle, AlertCircle, ChevronRight, ChevronLeft, Banknote, Upload,
} from 'lucide-react'
import Button from '../ui/Button'
import { Input } from '../ui/Input'
import { computeBalanceSheet, computeWaterfall } from '../../utils/accounting'
import { getPropertyDistributions, getBills, saleCloseout, uploadSaleSettlement } from '../../api/client'

const STEPS = ['Sale', 'Safety Check', 'Reserves', 'Distribute', 'Review']
const money = n => (n == null || isNaN(n) ? '—' : (n < 0 ? `-$${Math.abs(Math.round(n)).toLocaleString()}` : `$${Math.round(n).toLocaleString()}`))
const num = v => { const n = parseFloat(String(v).replace(/[$,\s]/g, '')); return isFinite(n) ? n : 0 }

export default function SaleCloseoutWizard({ propertyId, property, transactions = [], initialFile, onClose, onSaved }) {
  const [step, setStep]       = useState(0)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving]   = useState(false)
  const [error, setError]     = useState(null)

  const [investors, setInvestors] = useState([])
  const [bills, setBills]         = useState([])

  // Balance-sheet figures from the current (recorded) ledger
  const bs = useMemo(() => computeBalanceSheet(transactions), [transactions])

  // ── Step 1: Sale ──
  const [saleDate, setSaleDate]         = useState(new Date().toISOString().slice(0, 10))
  const [salePrice, setSalePrice]       = useState('')
  const [sellingCosts, setSellingCosts] = useState('')
  const [loanPayoff, setLoanPayoff]     = useState('')
  const [memberPayoff, setMemberPayoff] = useState('')
  const [includeCash, setIncludeCash]   = useState(true)
  const [parsing, setParsing]           = useState(false)
  const [dragOver, setDragOver]         = useState(false)
  const [parsedNet, setParsedNet]       = useState(null)   // net proceeds from the statement, for cross-check

  // ── Step 3: Reserves ──
  const [reserves, setReserves] = useState([
    { label: 'Entity-level taxes', amount: '' },
    { label: 'Final tax return / accountant', amount: '' },
  ])

  // ── Step 4: Distribute (waterfall) ──
  const [prefRate, setPrefRate]       = useState(15)   // %
  const [lpCarryPct, setLpCarryPct]   = useState(40)   // %
  const [holdMonths, setHoldMonths]   = useState(12)
  const [sponsorIds, setSponsorIds]   = useState(() => new Set())

  useEffect(() => {
    let cancelled = false
    Promise.all([
      getPropertyDistributions(propertyId).then(r => r.investors || []).catch(() => []),
      getBills(propertyId).then(r => Array.isArray(r) ? r : (r?.bills || [])).catch(() => []),
    ]).then(([inv, bl]) => {
      if (cancelled) return
      setInvestors(inv)
      setBills(bl)
      // Pre-fill payoffs from the balance sheet
      setLoanPayoff(bs.loanBalance > 0 ? String(Math.round(bs.loanBalance)) : '')
      setMemberPayoff(bs.memberLoan > 0 ? String(Math.round(bs.memberLoan)) : '')
      // Best-effort default sponsor: an investor whose name looks like the sponsor
      const guess = inv.find(i => /knox|sponsor|\bgp\b/i.test(i.name || ''))
      if (guess) setSponsorIds(new Set([guess.id]))
      setLoading(false)
    })
    return () => { cancelled = true }
  }, [propertyId]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Derived money ──
  const reservesTotal = reserves.reduce((s, r) => s + num(r.amount), 0)
  const netProceeds   = num(salePrice) - num(sellingCosts) - num(loanPayoff)
  const cashAfterSale = (includeCash ? bs.totalCash : 0) + num(salePrice) - num(sellingCosts) - num(loanPayoff) - num(memberPayoff)
  const distributable = Math.max(0, cashAfterSale - reservesTotal)

  const waterfall = useMemo(() => computeWaterfall(
    investors.map(i => ({ id: i.id, name: i.name, contribution: i.contribution, isSponsor: sponsorIds.has(i.id) })),
    { distributable, prefRate: prefRate / 100, lpCarryPct: lpCarryPct / 100, holdMonths },
  ), [investors, sponsorIds, distributable, prefRate, lpCarryPct, holdMonths])

  // ── Safety checks ──
  const unpaidBills = bills.filter(b => !b.paid_at)
  const unpaidTotal = unpaidBills.reduce((s, b) => s + num(b.amount), 0)
  const needsReview = transactions.filter(t => t.review_status === 'needs_review').length
  const loanRemaining   = bs.loanBalance - num(loanPayoff)
  const memberRemaining = bs.memberLoan - num(memberPayoff)
  const checks = [
    { ok: unpaidBills.length === 0, warn: `${unpaidBills.length} unpaid bill${unpaidBills.length !== 1 ? 's' : ''} (${money(unpaidTotal)}) still open`, good: 'No unpaid bills' },
    { ok: needsReview === 0, warn: `${needsReview} transaction${needsReview !== 1 ? 's' : ''} still in "needs review"`, good: 'All transactions reviewed' },
    { ok: Math.abs(loanRemaining) < 1, warn: `Mortgage not fully paid off — ${money(loanRemaining)} would remain`, good: 'Mortgage payoff covers the loan balance' },
    { ok: Math.abs(memberRemaining) < 1, warn: `Member loan not fully repaid — ${money(memberRemaining)} would remain`, good: 'Member loans repaid' },
  ]
  const allClear = checks.every(c => c.ok)

  const toggleSponsor = (id) => setSponsorIds(prev => {
    const next = new Set(prev)
    next.has(id) ? next.delete(id) : next.add(id)
    return next
  })

  // Auto-parse a settlement dropped onto the "We Sold It" button
  useEffect(() => { if (initialFile) handleSettlementFile(initialFile) }, []) // eslint-disable-line react-hooks/exhaustive-deps

  async function handleSettlementFile(file) {
    if (!file) return
    setParsing(true)
    setError(null)
    try {
      const r = await uploadSaleSettlement(propertyId, file)
      if (r.sale_price)    setSalePrice(String(Math.round(r.sale_price)))
      if (r.selling_costs) setSellingCosts(String(Math.round(r.selling_costs)))
      if (r.loan_payoff)   setLoanPayoff(String(Math.round(r.loan_payoff)))
      if (r.settlement_date) setSaleDate(r.settlement_date)
      setParsedNet(r.net_proceeds || null)
    } catch (e) {
      setError(`Couldn't read that statement: ${e.message}`)
    } finally {
      setParsing(false)
    }
  }

  async function handleConfirm() {
    setSaving(true)
    setError(null)
    try {
      await saleCloseout(propertyId, {
        sale_date:          saleDate,
        sale_price:         num(salePrice),
        selling_costs:      num(sellingCosts),
        loan_payoff:        num(loanPayoff),
        member_loan_payoff: num(memberPayoff),
        reserves:           reserves.filter(r => num(r.amount) > 0).map(r => ({ label: r.label, amount: num(r.amount) })),
        distributions:      waterfall.rows.map(r => ({ investor_id: r.id, name: r.name, capital: r.capital, pref: r.pref, carry: r.carry })),
        mark_sold:          true,
      })
      onSaved?.()
      onClose()
    } catch (e) {
      setError(e.message)
      setSaving(false)
    }
  }

  const canNext =
    step === 0 ? num(salePrice) > 0 :
    step === 3 ? investors.length > 0 && Math.abs(waterfall.totalDistributed - distributable) < 2 :
    true

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-3xl max-h-[92vh] flex flex-col">
        {/* Header + stepper */}
        <div className="px-6 py-4 border-b border-slate-100 shrink-0">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Banknote className="w-5 h-5 text-emerald-600" />
              <h2 className="text-base font-semibold text-slate-900">Sell &amp; Close Out — {property?.address}</h2>
            </div>
            <button onClick={onClose} className="text-slate-400 hover:text-slate-600"><X className="w-5 h-5" /></button>
          </div>
          <div className="flex items-center gap-1.5 mt-3">
            {STEPS.map((s, i) => (
              <div key={s} className="flex items-center gap-1.5">
                <div className={`text-[11px] font-medium px-2 py-0.5 rounded-full ${i === step ? 'bg-emerald-600 text-white' : i < step ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-400'}`}>
                  {i + 1}. {s}
                </div>
                {i < STEPS.length - 1 && <ChevronRight className="w-3 h-3 text-slate-300" />}
              </div>
            ))}
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-6 py-5">
          {error && (
            <div className="mb-4 flex items-start gap-2 px-4 py-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
              <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />{error}
            </div>
          )}

          {loading ? (
            <div className="flex items-center justify-center py-16 text-slate-400 gap-2"><Loader2 className="w-5 h-5 animate-spin" /> Loading close-out data…</div>
          ) : (
            <>
              {/* STEP 1 — SALE */}
              {step === 0 && (
                <div className="space-y-4">
                  {/* Drop the seller's closing statement to auto-fill */}
                  <label
                    onDragOver={e => { e.preventDefault(); setDragOver(true) }}
                    onDragLeave={() => setDragOver(false)}
                    onDrop={e => { e.preventDefault(); setDragOver(false); handleSettlementFile(e.dataTransfer.files[0]) }}
                    className={`block border-2 border-dashed rounded-xl px-4 py-5 text-center cursor-pointer transition-colors ${
                      dragOver ? 'border-emerald-400 bg-emerald-50' : 'border-slate-200 hover:border-slate-300 hover:bg-slate-50'
                    }`}
                  >
                    <input type="file" accept=".pdf,.xlsx,.xls,.csv" className="hidden"
                      onChange={e => handleSettlementFile(e.target.files[0])} />
                    {parsing ? (
                      <span className="inline-flex items-center gap-2 text-sm text-slate-500"><Loader2 className="w-4 h-4 animate-spin" /> Reading the settlement statement…</span>
                    ) : (
                      <>
                        <Upload className="w-6 h-6 text-slate-400 mx-auto mb-1" />
                        <p className="text-sm font-medium text-slate-700">Drop the seller's closing statement to auto-fill</p>
                        <p className="text-xs text-slate-400 mt-0.5">PDF, Excel, or CSV — reads the sale price, selling costs &amp; loan payoff. Or just type them below.</p>
                      </>
                    )}
                  </label>

                  {parsedNet != null && (
                    <div className={`flex items-center gap-2 px-3 py-2 rounded-lg text-xs ${Math.abs(parsedNet - netProceeds) < 2 ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'}`}>
                      {Math.abs(parsedNet - netProceeds) < 2
                        ? <><CheckCircle className="w-3.5 h-3.5 shrink-0" /> Matches the statement's net proceeds to seller ({money(parsedNet)}).</>
                        : <><AlertTriangle className="w-3.5 h-3.5 shrink-0" /> Statement says net proceeds {money(parsedNet)}, but sale − costs − payoff = {money(netProceeds)}. Check the figures.</>}
                    </div>
                  )}

                  <p className="text-sm text-slate-500">Confirm the sale figures. Payoffs are pre-filled from the current balance sheet.</p>
                  <div className="grid grid-cols-2 gap-4">
                    <Input label="Sale date" type="date" value={saleDate} onChange={e => setSaleDate(e.target.value)} />
                    <Input label="Sale price" type="number" value={salePrice} onChange={e => setSalePrice(e.target.value)} placeholder="0" />
                    <Input label="Selling costs (commission, title, transfer tax)" type="number" value={sellingCosts} onChange={e => setSellingCosts(e.target.value)} placeholder="0" />
                    <Input label={`Loan payoff  ·  balance ${money(bs.loanBalance)}`} type="number" value={loanPayoff} onChange={e => setLoanPayoff(e.target.value)} placeholder="0" />
                    {bs.memberLoan > 0 && (
                      <Input label={`Member loan repayment  ·  owed ${money(bs.memberLoan)}`} type="number" value={memberPayoff} onChange={e => setMemberPayoff(e.target.value)} placeholder="0" />
                    )}
                  </div>
                  <div className="bg-slate-50 rounded-xl px-4 py-3 text-sm space-y-1.5">
                    <Line label="Sale price" v={num(salePrice)} />
                    <Line label="− Selling costs" v={-num(sellingCosts)} />
                    <Line label="− Loan payoff" v={-num(loanPayoff)} />
                    <Line label="Net sale proceeds" v={netProceeds} bold />
                  </div>
                </div>
              )}

              {/* STEP 2 — SAFETY CHECK */}
              {step === 1 && (
                <div className="space-y-3">
                  <p className="text-sm text-slate-500">Before distributing, make sure nothing's unpaid or unrecorded. Fix these in the ledger, or proceed with the override.</p>
                  {checks.map((c, i) => (
                    <div key={i} className={`flex items-start gap-2.5 px-4 py-3 rounded-lg border text-sm ${c.ok ? 'bg-emerald-50 border-emerald-200 text-emerald-800' : 'bg-amber-50 border-amber-200 text-amber-800'}`}>
                      {c.ok ? <CheckCircle className="w-4 h-4 shrink-0 mt-0.5" /> : <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />}
                      <span>{c.ok ? c.good : c.warn}</span>
                    </div>
                  ))}
                  {!allClear && (
                    <p className="text-xs text-slate-400 pt-1">You can still continue — these are warnings, not blocks. The close-out will proceed with the numbers you entered.</p>
                  )}
                </div>
              )}

              {/* STEP 3 — RESERVES */}
              {step === 2 && (
                <div className="space-y-4">
                  <p className="text-sm text-slate-500">Hold back cash before distributing. Reserves stay in the account (not distributed) — spend them later as normal transactions (entity taxes, accountant fees).</p>
                  <div className="space-y-2">
                    {reserves.map((r, i) => (
                      <div key={i} className="flex items-center gap-2">
                        <input value={r.label} onChange={e => setReserves(rs => rs.map((x, j) => j === i ? { ...x, label: e.target.value } : x))}
                          className="flex-1 text-sm border border-slate-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-emerald-400" placeholder="Reserve name" />
                        <input value={r.amount} onChange={e => setReserves(rs => rs.map((x, j) => j === i ? { ...x, amount: e.target.value } : x))}
                          type="number" className="w-36 text-sm text-right tabular-nums border border-slate-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-emerald-400" placeholder="0" />
                        <button onClick={() => setReserves(rs => rs.filter((_, j) => j !== i))} className="text-slate-300 hover:text-red-500"><X className="w-4 h-4" /></button>
                      </div>
                    ))}
                    <button onClick={() => setReserves(rs => [...rs, { label: '', amount: '' }])} className="text-xs font-medium text-emerald-600 hover:text-emerald-800">+ Add reserve</button>
                  </div>
                  <label className="flex items-center gap-2 text-sm text-slate-600 pt-1">
                    <input type="checkbox" checked={includeCash} onChange={e => setIncludeCash(e.target.checked)} className="rounded border-slate-300" />
                    Also distribute the current cash balance ({money(bs.totalCash)})
                  </label>
                  <div className="bg-slate-50 rounded-xl px-4 py-3 text-sm space-y-1.5">
                    <Line label="Cash after sale & payoffs" v={cashAfterSale} />
                    <Line label="− Reserves held back" v={-reservesTotal} />
                    <Line label="Available to distribute" v={distributable} bold />
                  </div>
                </div>
              )}

              {/* STEP 4 — DISTRIBUTE */}
              {step === 3 && (
                <div className="space-y-4">
                  <div className="grid grid-cols-3 gap-3">
                    <Input label="Preferred return %" type="number" value={prefRate} onChange={e => setPrefRate(e.target.value)} />
                    <Input label="LP carry % (above pref)" type="number" value={lpCarryPct} onChange={e => setLpCarryPct(e.target.value)} />
                    <Input label="Hold period (months)" type="number" value={holdMonths} onChange={e => setHoldMonths(e.target.value)} />
                  </div>
                  <p className="text-xs text-slate-400">GP carry = {100 - num(lpCarryPct)}%. Tick the box to mark which investor is the Sponsor / GP (takes the GP carry).</p>

                  {investors.length === 0 ? (
                    <div className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-4 py-3">No investors are linked to this property, so there's nothing to distribute. Add the cap table first.</div>
                  ) : (
                    <div className="border border-slate-200 rounded-xl overflow-hidden">
                      <table className="w-full text-xs">
                        <thead>
                          <tr className="bg-slate-50 border-b border-slate-200 text-slate-500 uppercase tracking-wide">
                            <th className="text-left px-3 py-2">Investor</th>
                            <th className="text-center px-2 py-2 w-14">GP?</th>
                            <th className="text-right px-2 py-2">Capital</th>
                            <th className="text-right px-2 py-2">Pref</th>
                            <th className="text-right px-2 py-2">Carry</th>
                            <th className="text-right px-3 py-2">Total</th>
                          </tr>
                        </thead>
                        <tbody>
                          {waterfall.rows.map(r => (
                            <tr key={r.id} className="border-b border-slate-100">
                              <td className="px-3 py-2 text-slate-800">{r.name}<span className="text-slate-400"> · {money(r.contribution)}</span></td>
                              <td className="text-center px-2 py-2">
                                <input type="checkbox" checked={sponsorIds.has(r.id)} onChange={() => toggleSponsor(r.id)} className="rounded border-slate-300" />
                              </td>
                              <td className="text-right px-2 py-2 tabular-nums">{money(r.capital)}</td>
                              <td className="text-right px-2 py-2 tabular-nums">{money(r.pref)}</td>
                              <td className="text-right px-2 py-2 tabular-nums">{money(r.carry)}</td>
                              <td className="text-right px-3 py-2 tabular-nums font-semibold">{money(r.total)}</td>
                            </tr>
                          ))}
                        </tbody>
                        <tfoot>
                          <tr className="bg-slate-50 font-semibold text-slate-700">
                            <td className="px-3 py-2" colSpan={2}>Total distributed</td>
                            <td className="text-right px-2 py-2 tabular-nums">{money(waterfall.capitalReturned)}</td>
                            <td className="text-right px-2 py-2 tabular-nums">{money(waterfall.prefPaid)}</td>
                            <td className="text-right px-2 py-2 tabular-nums">{money(waterfall.carryPool)}</td>
                            <td className="text-right px-3 py-2 tabular-nums">{money(waterfall.totalDistributed)}</td>
                          </tr>
                        </tfoot>
                      </table>
                    </div>
                  )}
                  <div className="text-xs text-slate-400">
                    Tier 1 return of capital {money(waterfall.capitalReturned)} · Tier 2 pref {money(waterfall.prefPaid)} · Tier 3 carry pool {money(waterfall.carryPool)} (LP {money(waterfall.lpCarry)} / GP {money(waterfall.gpCarry)}).
                  </div>
                </div>
              )}

              {/* STEP 5 — REVIEW */}
              {step === 4 && (
                <div className="space-y-4">
                  <p className="text-sm text-slate-500">Confirm the close-out. This records the sale, pays off the loan(s), distributes to investors, removes the property from the books, and marks it <span className="font-medium">Sold</span>.</p>
                  <div className="bg-slate-50 rounded-xl px-4 py-3 text-sm space-y-1.5">
                    <Line label="Sale price" v={num(salePrice)} />
                    <Line label="− Selling costs" v={-num(sellingCosts)} />
                    <Line label="− Loan payoff" v={-num(loanPayoff)} />
                    {num(memberPayoff) > 0 && <Line label="− Member loan repayment" v={-num(memberPayoff)} />}
                    {reservesTotal > 0 && <Line label="− Reserves held back" v={-reservesTotal} />}
                    <Line label="Distributed to investors" v={-waterfall.totalDistributed} bold />
                  </div>
                  {!allClear && (
                    <div className="flex items-start gap-2 px-4 py-3 bg-amber-50 border border-amber-200 rounded-lg text-xs text-amber-800">
                      <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" /> Heads up — you're proceeding past the safety warnings from step 2.
                    </div>
                  )}
                  <div className="text-xs text-slate-500">
                    Reserves of <span className="font-medium">{money(reservesTotal)}</span> stay in the account for entity taxes &amp; the final filing. Distribution detail is saved per investor (capital / pref / profit).
                  </div>
                </div>
              )}
            </>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-slate-100 flex items-center justify-between shrink-0">
          <button onClick={step === 0 ? onClose : () => setStep(s => s - 1)} className="flex items-center gap-1 text-sm text-slate-500 hover:text-slate-700">
            {step === 0 ? 'Cancel' : <><ChevronLeft className="w-4 h-4" /> Back</>}
          </button>
          {step < STEPS.length - 1 ? (
            <Button onClick={() => setStep(s => s + 1)} disabled={!canNext}>
              Next <ChevronRight className="w-4 h-4" />
            </Button>
          ) : (
            <Button onClick={handleConfirm} disabled={saving}>
              {saving ? <><Loader2 className="w-4 h-4 animate-spin" /> Recording…</> : <>Confirm &amp; Close Out</>}
            </Button>
          )}
        </div>
      </div>
    </div>
  )
}

function Line({ label, v, bold }) {
  return (
    <div className={`flex items-center justify-between ${bold ? 'border-t border-slate-200 pt-1.5 font-semibold text-slate-900' : 'text-slate-600'}`}>
      <span>{label}</span>
      <span className="tabular-nums">{money(v)}</span>
    </div>
  )
}
