// Historical Transactions — sold deals + track-record returns. Properties move
// here automatically when marked sold (via "We Sold It" close-out or the quick
// Mark-as-Sold action). Metrics are derived from the close-out's investor
// distributions where available; deals without close-out data show what we have.
import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { History, Loader2, Building2, TrendingUp, Search, X, Check, AlertCircle } from 'lucide-react'
import { getHistoricalTransactions, getProperties, markPropertySold } from '../../api/client'
import TopBar from '../layout/TopBar'

const money = (n) => (n == null || n === '') ? '—' : (Math.abs(n) >= 1_000_000 ? `$${(n / 1_000_000).toFixed(2)}M` : `$${Math.round(Number(n)).toLocaleString()}`)
const moneyExact = (n) => (n == null) ? '—' : `$${Math.round(Number(n)).toLocaleString()}`
const pct = (n) => (n == null) ? '—' : `${(n * 100).toFixed(1)}%`
const mult = (n) => (n == null) ? '—' : `${n.toFixed(2)}x`
const fmtDate = (d) => d ? new Date(String(d).length === 10 ? d + 'T12:00:00' : d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—'
const holdText = (m) => m == null ? '—' : (m >= 12 ? `${Math.floor(m / 12)}y ${m % 12}m` : `${m}m`)

export default function HistoricalTransactionsPage() {
  const navigate = useNavigate()
  const [rows, setRows]       = useState(null)
  const [showMark, setShowMark] = useState(false)

  const load = useCallback(() => { getHistoricalTransactions().then(setRows).catch(() => setRows([])) }, [])
  useEffect(() => { load() }, [load])

  const totals = (rows || []).reduce((a, r) => ({
    invested: a.invested + (r.invested || 0),
    returned: a.returned + (r.total_distributed || 0),
    gain: a.gain + (r.gain || 0),
    sponsor: a.sponsor + (r.sponsor_gain || 0),
  }), { invested: 0, returned: 0, gain: 0, sponsor: 0 })

  return (
    <div className="flex flex-col h-full">
      <TopBar
        title={rows?.length ? `Historical Transactions (${rows.length})` : 'Historical Transactions'}
        actions={
          <button onClick={() => setShowMark(true)}
            className="inline-flex items-center gap-1.5 text-sm font-medium px-3 py-2 rounded-lg bg-slate-900 text-white hover:bg-slate-800">
            <Building2 className="w-4 h-4" /> Mark a property as sold
          </button>
        }
      />

      <div className="flex-1 overflow-y-auto p-6">
        {rows === null ? (
          <div className="flex justify-center py-20"><Loader2 className="w-6 h-6 text-slate-400 animate-spin" /></div>
        ) : rows.length === 0 ? (
          <div className="max-w-md mx-auto text-center py-20">
            <History className="w-10 h-10 text-slate-300 mx-auto mb-3" />
            <p className="text-base font-semibold text-slate-700">No historical transactions yet</p>
            <p className="text-sm text-slate-500 mt-1">Sold properties land here automatically after a "We Sold It" close-out. You can also mark one sold above. Importing your pre-CRM track record is coming soon.</p>
          </div>
        ) : (
          <div className="max-w-6xl mx-auto space-y-5">
            {/* Track-record summary */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <Tile label="Deals" value={rows.length} />
              <Tile label="Capital Invested" value={money(totals.invested)} />
              <Tile label="Returned to Investors" value={money(totals.returned)} accent="text-emerald-700" />
              <Tile label="Total Gain on Sales" value={money(totals.gain)} accent="text-emerald-700" />
            </div>

            <div className="rounded-2xl border border-slate-200 bg-white overflow-hidden">
              <div className="overflow-x-auto">
                <table className="min-w-full text-sm">
                  <thead className="bg-slate-50 border-b border-slate-100">
                    <tr>
                      {['Property', 'Bought', 'Sold', 'Hold', 'Invested', 'Returned', 'PROR', 'EMx', 'IRR', 'Investor Gain', 'Knox Gain'].map((h, i) => (
                        <th key={h} className={`px-3 py-2.5 text-[11px] font-semibold text-slate-500 uppercase tracking-wide whitespace-nowrap ${i === 0 ? 'text-left' : 'text-right'}`}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map(r => (
                      <tr key={r.id} onClick={() => navigate(`/accounting/${r.id}`)} className="border-b border-slate-50 last:border-0 hover:bg-slate-50/70 cursor-pointer">
                        <td className="px-3 py-3">
                          <p className="font-semibold text-slate-800">{r.tenant_brand_name || r.address}</p>
                          <p className="text-xs text-slate-400">{[r.city, r.state].filter(Boolean).join(', ') || r.address}</p>
                        </td>
                        <td className="px-3 py-3 text-right whitespace-nowrap"><p className="tabular-nums text-slate-800">{money(r.buy)}</p><p className="text-[11px] text-slate-400">{fmtDate(r.close_date)}</p></td>
                        <td className="px-3 py-3 text-right whitespace-nowrap"><p className="tabular-nums text-slate-800">{money(r.sell)}</p><p className="text-[11px] text-slate-400">{fmtDate(r.sold_date)}</p></td>
                        <td className="px-3 py-3 text-right text-slate-600 whitespace-nowrap">{holdText(r.hold_months)}</td>
                        <td className="px-3 py-3 text-right tabular-nums text-slate-600">{money(r.invested)}</td>
                        <td className="px-3 py-3 text-right tabular-nums text-emerald-700">{money(r.total_distributed)}</td>
                        <td className="px-3 py-3 text-right tabular-nums text-slate-600">{money(r.pref)}</td>
                        <td className="px-3 py-3 text-right tabular-nums font-medium text-slate-800">{mult(r.emx)}</td>
                        <td className="px-3 py-3 text-right tabular-nums font-medium text-slate-800">{pct(r.irr)}</td>
                        <td className="px-3 py-3 text-right tabular-nums text-emerald-700">{money(r.investor_gain)}</td>
                        <td className="px-3 py-3 text-right tabular-nums text-blue-700">{money(r.sponsor_gain)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
            <p className="text-[11px] text-slate-400">
              Returns are derived from each deal's close-out distributions. Deals marked sold without a full close-out show price &amp; hold only — run "We Sold It" on the ledger to populate investor returns. Click a row to open its ledger.
            </p>
          </div>
        )}
      </div>

      {showMark && <MarkSoldModal onClose={() => setShowMark(false)} onDone={() => { setShowMark(false); load() }} />}
    </div>
  )
}

function Tile({ label, value, accent = 'text-slate-900' }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3">
      <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">{label}</p>
      <p className={`text-xl font-bold tabular-nums mt-0.5 ${accent}`}>{value}</p>
    </div>
  )
}

// Search a portfolio property and mark it sold (quick path — no full waterfall).
function MarkSoldModal({ onClose, onDone }) {
  const [q, setQ]         = useState('')
  const [results, setRes] = useState([])
  const [picked, setPicked] = useState(null)
  const [salePrice, setSalePrice] = useState('')
  const [soldDate, setSoldDate]   = useState(new Date().toISOString().slice(0, 10))
  const [busy, setBusy]   = useState(false)
  const [err, setErr]     = useState(null)

  useEffect(() => {
    if (picked || q.trim().length < 2) { setRes([]); return }
    let alive = true
    const t = setTimeout(() => {
      getProperties({ portfolio: '1', sold: '0', search: q.trim(), limit: 8 })
        .then(r => alive && setRes(r.rows || []))
        .catch(() => {})
    }, 250)
    return () => { alive = false; clearTimeout(t) }
  }, [q, picked])

  async function confirm() {
    if (!picked) return
    setBusy(true); setErr(null)
    try {
      await markPropertySold(picked.id, { sold: true, sold_date: soldDate, sale_price: salePrice ? Number(salePrice) : null })
      onDone()
    } catch (e) { setErr(e.message) } finally { setBusy(false) }
  }

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/40 p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
          <h2 className="text-base font-bold text-slate-900">Mark a property as sold</h2>
          <button onClick={onClose} className="w-8 h-8 rounded-lg flex items-center justify-center text-slate-400 hover:bg-slate-100"><X className="w-4 h-4" /></button>
        </div>
        <div className="px-6 py-5 space-y-4">
          {!picked ? (
            <div>
              <label className="block text-xs font-semibold text-slate-600 uppercase tracking-wide mb-1">Property</label>
              <div className="relative">
                <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <input value={q} onChange={e => setQ(e.target.value)} autoFocus placeholder="Search portfolio by address or tenant…"
                  className="w-full pl-9 pr-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </div>
              {results.length > 0 && (
                <ul className="mt-1.5 rounded-xl border border-slate-200 divide-y divide-slate-100 max-h-60 overflow-y-auto">
                  {results.map(p => (
                    <li key={p.id}>
                      <button onClick={() => { setPicked(p); setSalePrice('') }} className="w-full text-left px-3 py-2 hover:bg-slate-50">
                        <p className="text-sm font-medium text-slate-800">{p.tenant_brand_name || p.address}</p>
                        <p className="text-xs text-slate-400">{[p.city, p.state].filter(Boolean).join(', ') || p.address}</p>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              <p className="text-[11px] text-slate-400 mt-2">This is the quick path — it moves the property to Historical without a distribution waterfall. For full investor returns, use <strong>We Sold It</strong> on the property's ledger instead.</p>
            </div>
          ) : (
            <>
              <div className="flex items-center justify-between rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
                <div className="min-w-0"><p className="text-sm font-semibold text-slate-800 truncate">{picked.tenant_brand_name || picked.address}</p><p className="text-xs text-slate-400 truncate">{[picked.city, picked.state].filter(Boolean).join(', ')}</p></div>
                <button onClick={() => setPicked(null)} className="text-xs text-blue-600 hover:underline shrink-0">Change</button>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-600 uppercase tracking-wide mb-1">Sale price</label>
                  <div className="relative"><span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-slate-400">$</span>
                    <input value={salePrice} onChange={e => setSalePrice(e.target.value)} placeholder="optional" className="w-full pl-6 pr-3 py-2 text-sm border border-slate-200 rounded-lg tabular-nums focus:outline-none focus:ring-2 focus:ring-blue-500" /></div>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-600 uppercase tracking-wide mb-1">Sale date</label>
                  <input type="date" value={soldDate} onChange={e => setSoldDate(e.target.value)} className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500" />
                </div>
              </div>
              {err && <div className="flex items-start gap-2 text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2"><AlertCircle className="w-4 h-4 mt-0.5 shrink-0" /> {err}</div>}
            </>
          )}
        </div>
        <div className="flex items-center justify-between px-6 py-4 border-t border-slate-100">
          <button onClick={onClose} className="text-sm text-slate-500 hover:text-slate-700">Cancel</button>
          {picked && (
            <button onClick={confirm} disabled={busy}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-slate-900 text-white text-sm font-medium hover:bg-slate-800 disabled:opacity-50">
              {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />} Mark sold &amp; move
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
