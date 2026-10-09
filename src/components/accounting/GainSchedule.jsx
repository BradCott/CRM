// Gain Schedule — the accountant's acquisition + disposition (gain-on-sale)
// worksheet, auto-seeded from the ledger and editable. Outputs (basis split,
// net book value, GAIN ON SALE, journal entries) are computed by the shared
// computeGainSchedule() so this view and the Excel export always agree.
import { useEffect, useMemo, useState } from 'react'
import { Loader2, Save, Download, CheckCircle, TrendingUp, Info } from 'lucide-react'
import Button from '../ui/Button'
import { getGainSchedule, saveGainSchedule } from '../../api/client'
import { computeGainSchedule } from '../../utils/accounting'
import { exportGainScheduleExcel } from '../../utils/accountingExport'

const fmt$ = n => (n == null || n === '' || isNaN(n) ? '—'
  : (Number(n) < 0 ? `($${Math.abs(Number(n)).toLocaleString(undefined, { maximumFractionDigits: 2 })})`
    : `$${Number(n).toLocaleString(undefined, { maximumFractionDigits: 2 })}`))

function NumField({ label, value, onChange, placeholder }) {
  return (
    <label className="flex items-center justify-between gap-3 py-1.5">
      <span className="text-sm text-slate-600">{label}</span>
      <div className="relative">
        <span className="absolute left-2 top-1/2 -translate-y-1/2 text-slate-400 text-sm">$</span>
        <input
          type="number" value={value ?? ''} placeholder={placeholder}
          onChange={e => onChange(e.target.value === '' ? '' : Number(e.target.value))}
          className="w-40 text-sm text-right border border-slate-200 rounded-lg pl-5 pr-2 py-1.5 tabular-nums focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
      </div>
    </label>
  )
}
function DateField({ label, value, onChange }) {
  return (
    <label className="flex items-center justify-between gap-3 py-1.5">
      <span className="text-sm text-slate-600">{label}</span>
      <input type="date" value={value || ''} onChange={e => onChange(e.target.value || '')}
        className="w-40 text-sm border border-slate-200 rounded-lg px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-500" />
    </label>
  )
}
const Row = ({ label, value, strong }) => (
  <div className={`flex items-center justify-between py-1.5 ${strong ? 'border-t border-slate-200 mt-1 pt-2' : ''}`}>
    <span className={`text-sm ${strong ? 'font-semibold text-slate-800' : 'text-slate-500'}`}>{label}</span>
    <span className={`text-sm tabular-nums ${strong ? 'font-bold text-slate-900' : 'text-slate-700'}`}>{fmt$(value)}</span>
  </div>
)

export default function GainSchedule({ property, propertyId }) {
  const [loading, setLoading] = useState(true)
  const [saving, setSaving]   = useState(false)
  const [saved, setSaved]     = useState(false)
  const [error, setError]     = useState(null)
  const [data, setData]       = useState(null)   // { buildingPct, recoveryYears, acquisition, disposition }

  useEffect(() => {
    setLoading(true)
    getGainSchedule(propertyId)
      .then(d => setData(d))
      .catch(e => setError(e.message || 'Could not load the gain schedule'))
      .finally(() => setLoading(false))
  }, [propertyId])

  const out = useMemo(() => (data ? computeGainSchedule(data) : null), [data])

  const setAcq  = (k, v) => setData(d => ({ ...d, acquisition: { ...d.acquisition, [k]: v } }))
  const setDisp = (k, v) => setData(d => ({ ...d, disposition: { ...d.disposition, [k]: v } }))
  const setPct  = (v) => setData(d => ({ ...d, buildingPct: v === '' ? '' : Number(v) / 100 }))

  const save = async () => {
    setSaving(true); setError(null); setSaved(false)
    try {
      await saveGainSchedule(propertyId, data)
      setSaved(true); setTimeout(() => setSaved(false), 2500)
    } catch (e) { setError(e.message || 'Save failed') }
    finally { setSaving(false) }
  }
  const exportXlsx = () => {
    try { exportGainScheduleExcel(property, data) }
    catch (e) { setError(e.message || 'Export failed') }
  }

  if (loading) return <div className="p-10 flex items-center justify-center text-slate-400"><Loader2 className="w-5 h-5 animate-spin mr-2" /> Loading gain schedule…</div>
  if (!data || !out) return <div className="p-10 text-slate-400">{error || 'No data.'}</div>

  const a = out.acquisition, d = out.disposition
  const pctWhole = Math.round((data.buildingPct || 0.75) * 100)

  return (
    <div className="p-6 space-y-5 max-w-5xl">
      {/* Header + actions */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-lg font-semibold text-slate-900 flex items-center gap-2"><TrendingUp className="w-5 h-5 text-emerald-600" /> Gain Schedule</h2>
          <p className="text-sm text-slate-500">Acquisition &amp; disposition (gain-on-sale) worksheet — auto-filled from the ledger, editable.</p>
        </div>
        <div className="flex items-center gap-2">
          <label className="flex items-center gap-2 text-sm text-slate-600 bg-slate-50 border border-slate-200 rounded-lg px-3 py-1.5">
            Building split
            <input type="number" min="0" max="100" value={pctWhole}
              onChange={e => setPct(e.target.value)}
              className="w-14 text-right border border-slate-200 rounded px-1.5 py-0.5 tabular-nums focus:outline-none focus:ring-2 focus:ring-blue-500" />
            <span className="text-slate-400">% / {100 - pctWhole}% land</span>
          </label>
          <Button variant="secondary" onClick={exportXlsx}><Download className="w-4 h-4" /> Export Excel</Button>
          <Button onClick={save} disabled={saving}>
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : saved ? <CheckCircle className="w-4 h-4" /> : <Save className="w-4 h-4" />}
            {saved ? 'Saved' : 'Save'}
          </Button>
        </div>
      </div>

      {error && <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</div>}

      <div className="grid md:grid-cols-2 gap-5">
        {/* ── Acquisition ── */}
        <div className="border border-slate-200 rounded-xl overflow-hidden">
          <div className="bg-slate-50 px-4 py-2.5 font-semibold text-slate-700 text-sm uppercase tracking-wide">Acquisition</div>
          <div className="p-4">
            <DateField label="Date Acquired" value={data.acquisition.dateAcquired} onChange={v => setAcq('dateAcquired', v)} />
            <NumField label="Purchase Price"   value={data.acquisition.purchasePrice} onChange={v => setAcq('purchasePrice', v)} />
            <NumField label="Seller Credit"    value={data.acquisition.sellerCredit}  onChange={v => setAcq('sellerCredit', v)} />
            <NumField label="Closing Costs"    value={data.acquisition.closingCosts}  onChange={v => setAcq('closingCosts', v)} />
            <div className="my-2 border-t border-dashed border-slate-200" />
            <NumField label="Loan"             value={data.acquisition.loan}          onChange={v => setAcq('loan', v)} />
            <NumField label="Rent Credit"      value={data.acquisition.rentCredit}    onChange={v => setAcq('rentCredit', v)} />
            <NumField label="R/E Tax Credit"   value={data.acquisition.reTaxCredit}   onChange={v => setAcq('reTaxCredit', v)} />
            <NumField label="Insurance Credit" value={data.acquisition.insuranceCredit} onChange={v => setAcq('insuranceCredit', v)} />
            <NumField label="Cash to Close"    value={data.acquisition.cash}          onChange={v => setAcq('cash', v)} />
            <NumField label="Earnest Money"    value={data.acquisition.earnestMoney}  onChange={v => setAcq('earnestMoney', v)} />

            <div className="mt-3 bg-slate-50 rounded-lg px-3 py-2">
              <Row label="Total Cost" value={a.totalCost} />
              <Row label={`Building (${pctWhole}%)`} value={a.building} />
              <Row label={`Land (${100 - pctWhole}%)`} value={a.land} />
              <Row label="Journal balance check" value={a.balanceCheck} strong />
            </div>
          </div>
        </div>

        {/* ── Disposition ── */}
        <div className="border border-slate-200 rounded-xl overflow-hidden">
          <div className="bg-slate-50 px-4 py-2.5 font-semibold text-slate-700 text-sm uppercase tracking-wide">Disposition — Gain on Sale</div>
          <div className="p-4">
            <DateField label="Date Sold" value={data.disposition.dateSold} onChange={v => setDisp('dateSold', v)} />
            <NumField label="Sales Price"   value={data.disposition.salesPrice}  onChange={v => setDisp('salesPrice', v)} />
            <NumField label="Commission"    value={data.disposition.commission}  onChange={v => setDisp('commission', v)} />
            <NumField label="Closing Costs" value={data.disposition.closingCosts} onChange={v => setDisp('closingCosts', v)} />
            <div className="my-2 border-t border-dashed border-slate-200" />
            <NumField label="Loan Payoff"   value={data.disposition.loanPayoff}  onChange={v => setDisp('loanPayoff', v)} />
            <NumField label="Interest Exp"  value={data.disposition.interestExp} onChange={v => setDisp('interestExp', v)} />
            <NumField label="Insurance"     value={data.disposition.insurance}   onChange={v => setDisp('insurance', v)} />
            <NumField label="R/E Taxes"     value={data.disposition.reTaxes}     onChange={v => setDisp('reTaxes', v)} />
            <NumField label="Rent"          value={data.disposition.rent}        onChange={v => setDisp('rent', v)} />
            <NumField label="Cash Received" value={data.disposition.cashReceived} onChange={v => setDisp('cashReceived', v)} />
            <NumField label="Accum. Depreciation (blank = auto)" value={data.disposition.accumDep} placeholder={Math.round(d.autoAD)} onChange={v => setDisp('accumDep', v)} />

            <div className="mt-3 bg-slate-50 rounded-lg px-3 py-2">
              <Row label="Net Book Value" value={d.netBookValue} />
              <Row label="Selling Costs" value={d.sellingCosts} />
              <div className="flex items-center justify-between py-2 mt-1 border-t border-slate-300">
                <span className="text-sm font-bold text-slate-900">GAIN ON SALE</span>
                <span className={`text-base font-bold tabular-nums ${d.gainOnSale >= 0 ? 'text-emerald-700' : 'text-red-600'}`}>{fmt$(d.gainOnSale)}</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      <p className="text-xs text-slate-400 flex items-start gap-1.5">
        <Info className="w-3.5 h-3.5 mt-0.5 shrink-0" />
        Acquisition is seeded from the settlement; disposition from the sale close-out. Accumulated depreciation is straight-lined on the building basis over {out.recoveryYears} years through the sale date unless you enter a value. These two tabs are also included in the Accountant Bundle.
      </p>
    </div>
  )
}
