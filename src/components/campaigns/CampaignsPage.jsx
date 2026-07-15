import { useState, useEffect, useCallback, Fragment } from 'react'
import { Mail, Loader2, ChevronDown, ChevronRight, CheckCircle, AlertCircle, Clock, Pause, Play, X, Pencil, Droplet, Reply, Send, TrendingUp, RefreshCw } from 'lucide-react'
import {
  getHandwryttenCampaigns, getHandwryttenSends,
  getHandwryttenDrips, updateHandwryttenDrip, cancelHandwryttenDrip,
  getHandwryttenDripQueue, retryHandwryttenDripFailed, getMailResponseSummary, markSendResponded,
} from '../../api/client'
import TopBar from '../layout/TopBar'
import MailPauseControl from '../handwrytten/MailPauseControl'

function fmtDate(iso) {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' })
}

// sent_at is stored as UTC "YYYY-MM-DD HH:MM:SS"; responded_at is ISO.
function parseTs(ts) {
  if (!ts) return null
  const d = new Date(ts.includes('T') ? ts : ts.replace(' ', 'T') + 'Z')
  return isNaN(d) ? null : d
}
function shortDate(ts) {
  const d = parseTs(ts)
  return d ? d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : ''
}
function daysBetween(a, b) {
  const da = parseTs(a), db = parseTs(b)
  return da && db ? Math.max(0, Math.round((db - da) / 86400000)) : null
}

function StatusBadge({ status }) {
  const map = {
    complete: { cls: 'bg-green-50 text-green-700',  icon: CheckCircle,     label: 'Complete'  },
    partial:  { cls: 'bg-amber-50 text-amber-700',   icon: AlertCircle,     label: 'Partial'   },
    failed:   { cls: 'bg-red-50 text-red-700',       icon: AlertCircle,     label: 'Failed'    },
    sending:  { cls: 'bg-blue-50 text-blue-700',     icon: Loader2,         label: 'Sending…'  },
    sent:     { cls: 'bg-green-50 text-green-700',   icon: CheckCircle,     label: 'Sent'      },
    pending:  { cls: 'bg-slate-100 text-slate-600',  icon: Clock,           label: 'Pending'   },
  }
  const { cls, icon: Icon, label } = map[status] || map.pending
  return (
    <span className={`inline-flex items-center gap-1 text-xs font-semibold px-2 py-0.5 rounded-full ${cls}`}>
      <Icon className="w-3 h-3" />
      {label}
    </span>
  )
}

function RespondedToggle({ send, onChange }) {
  const [busy, setBusy] = useState(false)
  const responded = !!send.responded_at
  async function toggle() {
    setBusy(true)
    try { await markSendResponded(send.id, !responded); onChange(send.id, !responded) }
    catch (e) { alert(e.message) }
    setBusy(false)
  }
  const days = responded ? daysBetween(send.sent_at, send.responded_at) : null
  return (
    <div className="flex flex-col items-start gap-0.5">
      <button onClick={toggle} disabled={busy}
        className={`inline-flex items-center gap-1 text-xs font-medium px-2 py-1 rounded-lg border transition-colors ${
          responded ? 'bg-emerald-50 text-emerald-700 border-emerald-200 hover:bg-emerald-100'
                    : 'text-slate-400 border-slate-200 hover:bg-slate-50 hover:text-slate-600'
        }`}
        title={responded ? `Responded${send.response_channel === 'email' ? ' (email reply)' : ''} — click to clear` : 'Mark as responded'}
      >
        <Reply className="w-3.5 h-3.5" />
        {responded ? 'Responded' : 'Mark'}
      </button>
      {responded && send.responded_at && (
        <span className="text-[10px] text-slate-400 pl-0.5">
          {shortDate(send.responded_at)}{days != null ? ` · ${days}d` : ''}
        </span>
      )}
    </div>
  )
}

function CampaignRow({ campaign }) {
  const [expanded,  setExpanded]  = useState(false)
  const [sends,     setSends]     = useState([])
  const [loading,   setLoading]   = useState(false)

  async function toggleExpand() {
    if (!expanded && sends.length === 0) {
      setLoading(true)
      try {
        const { rows } = await getHandwryttenSends({ campaign_id: campaign.id, limit: 200 })
        setSends(rows)
      } catch (_) {}
      setLoading(false)
    }
    setExpanded(v => !v)
  }

  const onRespondedChange = (sendId, responded) =>
    setSends(prev => prev.map(s => s.id === sendId ? { ...s, responded_at: responded ? new Date().toISOString() : null } : s))
  const onPauseChange = (contactId, until) =>
    setSends(prev => prev.map(s => s.contact_id === contactId ? { ...s, contact_pause_until: until } : s))

  return (
    <>
      <tr
        onClick={toggleExpand}
        className="border-b border-slate-100 hover:bg-slate-50 cursor-pointer"
      >
        <td className="px-4 py-3 w-8">
          {expanded
            ? <ChevronDown className="w-4 h-4 text-slate-400" />
            : <ChevronRight className="w-4 h-4 text-slate-400" />
          }
        </td>
        <td className="px-4 py-3 text-sm text-slate-600">{fmtDate(campaign.sent_at)}</td>
        <td className="px-4 py-3">
          <p className="text-sm text-slate-800 line-clamp-2 max-w-xs">{campaign.message_template}</p>
        </td>
        <td className="px-4 py-3 text-center">
          <span className="text-sm font-semibold text-slate-800">{campaign.total_count}</span>
        </td>
        <td className="px-4 py-3 text-center">
          <span className="text-sm font-semibold text-green-700">{campaign.sent_count}</span>
        </td>
        <td className="px-4 py-3 text-center">
          {campaign.failed_count > 0
            ? <span className="text-sm font-semibold text-red-600">{campaign.failed_count}</span>
            : <span className="text-sm text-slate-300">—</span>
          }
        </td>
        <td className="px-4 py-3 text-center whitespace-nowrap">
          {campaign.sent_count > 0 ? (
            <span className="text-sm font-semibold text-emerald-700">
              {campaign.responded_count || 0}
              <span className="text-xs font-normal text-slate-400"> · {Math.round((campaign.responded_count || 0) / campaign.sent_count * 100)}%</span>
            </span>
          ) : <span className="text-sm text-slate-300">—</span>}
        </td>
        <td className="px-4 py-3">
          <StatusBadge status={campaign.status} />
        </td>
        <td className="px-4 py-3 text-sm text-slate-500">{campaign.sent_by_name || '—'}</td>
      </tr>

      {expanded && (
        <tr>
          <td colSpan={9} className="bg-slate-50 px-4 py-3">
            {loading ? (
              <div className="flex items-center gap-2 text-sm text-slate-400 py-2">
                <Loader2 className="w-4 h-4 animate-spin" /> Loading sends…
              </div>
            ) : sends.length === 0 ? (
              <p className="text-sm text-slate-400 py-2">No individual send records found.</p>
            ) : (
              <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
                <table className="min-w-full text-xs">
                  <thead>
                    <tr className="bg-slate-50 border-b border-slate-100">
                      <th className="px-3 py-2 text-left font-semibold text-slate-500">Recipient</th>
                      <th className="px-3 py-2 text-left font-semibold text-slate-500">Address</th>
                      <th className="px-3 py-2 text-left font-semibold text-slate-500">Property</th>
                      <th className="px-3 py-2 text-left font-semibold text-slate-500">Status</th>
                      <th className="px-3 py-2 text-left font-semibold text-slate-500">Responded</th>
                      <th className="px-3 py-2 text-left font-semibold text-slate-500">Mailing</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sends.map(s => (
                      <Fragment key={s.id}>
                        <tr className={s.status === 'failed' ? '' : 'border-b border-slate-50'}>
                          <td className="px-3 py-2 text-slate-800 font-medium">{s.contact_name || '—'}</td>
                          <td className="px-3 py-2 text-slate-500">
                            {[s.contact_city, s.contact_state].filter(Boolean).join(', ') || '—'}
                          </td>
                          <td className="px-3 py-2 text-slate-500">
                            {s.tenant_brand_name && (
                              <span className="text-xs bg-blue-50 text-blue-700 font-semibold px-1.5 py-0.5 rounded-full mr-1">
                                {s.tenant_brand_name}
                              </span>
                            )}
                            {s.property_city && `${s.property_city}, ${s.property_state}`}
                          </td>
                          <td className="px-3 py-2"><StatusBadge status={s.status} /></td>
                          <td className="px-3 py-2">
                            <RespondedToggle send={s} onChange={onRespondedChange} />
                          </td>
                          <td className="px-3 py-2">
                            {s.contact_id
                              ? <MailPauseControl personId={s.contact_id} pausedUntil={s.contact_pause_until}
                                  onChange={until => onPauseChange(s.contact_id, until)} />
                              : <span className="text-slate-300">—</span>}
                          </td>
                        </tr>
                        {s.status === 'failed' && s.error_message && (
                          <tr className="border-b border-slate-50">
                            <td colSpan={6} className="px-3 pb-2">
                              <div className="flex items-start gap-1.5 text-[11px] text-red-700 bg-red-50 border border-red-100 rounded-lg px-2.5 py-1.5">
                                <AlertCircle className="w-3 h-3 mt-0.5 shrink-0" />
                                <span className="break-words">{s.error_message}</span>
                              </div>
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </td>
        </tr>
      )}
    </>
  )
}

// ── Active / past drip campaigns ──────────────────────────────────────────────

const DRIP_STATUS = {
  active:    { cls: 'bg-blue-50 text-blue-700',   label: 'Active'    },
  paused:    { cls: 'bg-amber-50 text-amber-700',  label: 'Paused'    },
  complete:  { cls: 'bg-green-50 text-green-700',  label: 'Complete'  },
  cancelled: { cls: 'bg-slate-100 text-slate-500', label: 'Cancelled' },
}

function DripCard({ drip, onChange }) {
  const [busy, setBusy]       = useState(false)
  const [editing, setEditing] = useState(false)
  const [batch, setBatch]     = useState(drip.batch_size)
  const [interval, setInterval] = useState(drip.interval_days)
  const [showDetail, setShowDetail] = useState(false)
  const [detail, setDetail]         = useState(null)   // { rows, reasons }
  const [loadingDetail, setLoadingDetail] = useState(false)

  const done    = drip.sent_count + drip.failed_count
  const pct     = drip.total_count > 0 ? Math.round((done / drip.total_count) * 100) : 0
  const st      = DRIP_STATUS[drip.status] || DRIP_STATUS.active
  const live    = drip.status === 'active' || drip.status === 'paused'

  async function toggleDetail() {
    if (!showDetail && !detail) {
      setLoadingDetail(true)
      try { setDetail(await getHandwryttenDripQueue(drip.id)) } catch (_) {}
      setLoadingDetail(false)
    }
    setShowDetail(v => !v)
  }

  async function handleRetry() {
    if (!window.confirm(`Resend the ${drip.failed_count} failed letter${drip.failed_count === 1 ? '' : 's'}? They'll be re-queued and start sending now.`)) return
    setBusy(true)
    try {
      const { requeued } = await retryHandwryttenDripFailed(drip.id)
      await onChange()
      try { setDetail(await getHandwryttenDripQueue(drip.id)) } catch (_) {}
      window.alert(`${requeued} letter${requeued === 1 ? '' : 's'} re-queued — they're sending now.`)
    } catch (e) { window.alert(e.message) } finally { setBusy(false) }
  }

  async function act(fn) {
    setBusy(true)
    try { await fn(); await onChange() } catch (e) { alert(e.message) } finally { setBusy(false) }
  }

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <Droplet className="w-4 h-4 text-blue-500 shrink-0" />
            <p className="text-sm font-semibold text-slate-800 truncate">{drip.name || 'Mail campaign'}</p>
            <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${st.cls}`}>{st.label}</span>
          </div>
          <p className="text-xs text-slate-500 mt-1 line-clamp-1">{drip.message_template}</p>
        </div>
        {live && (
          <div className="flex items-center gap-1 shrink-0">
            {drip.status === 'active' ? (
              <button title="Pause" disabled={busy} onClick={() => act(() => updateHandwryttenDrip(drip.id, { status: 'paused' }))}
                className="p-1.5 rounded-lg text-slate-500 hover:bg-slate-100">
                <Pause className="w-4 h-4" />
              </button>
            ) : (
              <button title="Resume" disabled={busy} onClick={() => act(() => updateHandwryttenDrip(drip.id, { status: 'active' }))}
                className="p-1.5 rounded-lg text-blue-600 hover:bg-blue-50">
                <Play className="w-4 h-4" />
              </button>
            )}
            <button title="Edit pace" disabled={busy} onClick={() => setEditing(v => !v)}
              className="p-1.5 rounded-lg text-slate-500 hover:bg-slate-100">
              <Pencil className="w-4 h-4" />
            </button>
            <button title="Cancel remaining" disabled={busy}
              onClick={() => { if (window.confirm('Cancel this drip? Remaining letters will not be sent.')) act(() => cancelHandwryttenDrip(drip.id)) }}
              className="p-1.5 rounded-lg text-red-500 hover:bg-red-50">
              <X className="w-4 h-4" />
            </button>
          </div>
        )}
      </div>

      {/* Progress */}
      <div className="mt-3">
        <div className="flex items-center justify-between text-xs text-slate-500 mb-1">
          <span>{done.toLocaleString()} / {drip.total_count.toLocaleString()} sent{drip.failed_count > 0 ? ` · ${drip.failed_count} failed` : ''}</span>
          <span>{drip.remaining?.toLocaleString?.() ?? (drip.total_count - done)} remaining</span>
        </div>
        <div className="h-2 rounded-full bg-slate-100 overflow-hidden">
          <div className="h-full bg-blue-500 transition-all" style={{ width: `${pct}%` }} />
        </div>
        <p className="text-xs text-slate-400 mt-1.5">
          {drip.batch_size} every {drip.interval_days} day{drip.interval_days !== 1 ? 's' : ''}
          {live && drip.next_run_at && ` · next batch ${fmtDate(drip.next_run_at + 'Z')}`}
        </p>
      </div>

      {editing && (
        <div className="mt-3 flex flex-wrap items-center gap-2 text-sm border-t border-slate-100 pt-3">
          <span className="text-slate-600">Send</span>
          <input type="number" min="1" value={batch} onChange={e => setBatch(e.target.value)}
            className="w-16 text-center border border-slate-300 rounded-lg px-2 py-1" />
          <span className="text-slate-600">every</span>
          <input type="number" min="1" value={interval} onChange={e => setInterval(e.target.value)}
            className="w-16 text-center border border-slate-300 rounded-lg px-2 py-1" />
          <span className="text-slate-600">days</span>
          <button disabled={busy}
            onClick={() => act(() => updateHandwryttenDrip(drip.id, { batch_size: batch, interval_days: interval })).then(() => setEditing(false))}
            className="ml-auto px-3 py-1 text-xs font-semibold rounded-lg bg-blue-600 text-white hover:bg-blue-700">
            Save
          </button>
        </div>
      )}

      {/* Send details / failure breakdown */}
      {done > 0 && (
        <div className="mt-3 border-t border-slate-100 pt-2">
          <button onClick={toggleDetail}
            className="flex items-center gap-1 text-xs font-medium text-slate-500 hover:text-slate-700">
            {showDetail ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
            {drip.failed_count > 0 ? `View ${drip.failed_count} failure${drip.failed_count === 1 ? '' : 's'} & details` : 'View send details'}
          </button>

          {showDetail && (
            <div className="mt-2">
              {loadingDetail ? (
                <div className="flex items-center gap-2 text-xs text-slate-400 py-2">
                  <Loader2 className="w-3.5 h-3.5 animate-spin" /> Loading…
                </div>
              ) : !detail ? (
                <p className="text-xs text-slate-400 py-2">Couldn't load details.</p>
              ) : (
                <>
                  {drip.failed_count > 0 && (
                    <div className="flex items-center justify-between gap-2 mb-3 bg-red-50 border border-red-100 rounded-lg px-3 py-2">
                      <span className="text-xs text-red-700">
                        {drip.failed_count} letter{drip.failed_count === 1 ? '' : 's'} failed at the mail service — fixed the cause? Resend them.
                      </span>
                      <button onClick={handleRetry} disabled={busy}
                        className="flex items-center gap-1 text-xs font-semibold px-3 py-1.5 rounded-lg bg-red-600 text-white hover:bg-red-700 disabled:opacity-50 shrink-0">
                        {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
                        Resend {drip.failed_count} failed
                      </button>
                    </div>
                  )}
                  {detail.reasons.length > 0 ? (
                    <div className="space-y-1.5 mb-3">
                      <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-wide">Why letters didn't send</p>
                      {detail.reasons.map((r, i) => (
                        <div key={i} className={`flex items-start gap-2 text-xs rounded-lg px-2.5 py-1.5 border ${
                          r.status === 'failed' ? 'bg-red-50 border-red-100 text-red-700' : 'bg-amber-50 border-amber-100 text-amber-700'
                        }`}>
                          <span className="font-bold tabular-nums shrink-0">{r.count}×</span>
                          <span className="uppercase text-[10px] font-semibold mt-0.5 shrink-0 opacity-70">{r.status}</span>
                          <span className="break-words">{r.reason}</span>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-xs text-emerald-600 mb-3">No problems — every processed letter was sent.</p>
                  )}

                  <div className="max-h-56 overflow-auto rounded-lg border border-slate-100">
                    <table className="min-w-full text-[11px]">
                      <tbody>
                        {detail.rows.filter(r => r.status === 'failed' || r.status === 'skipped').map(r => (
                          <tr key={r.id} className="border-b border-slate-50 last:border-0">
                            <td className="px-2.5 py-1.5 text-slate-700 font-medium whitespace-nowrap">{r.contact_name || '—'}</td>
                            <td className="px-2.5 py-1.5 text-slate-400 whitespace-nowrap">{[r.contact_city, r.contact_state].filter(Boolean).join(', ')}</td>
                            <td className="px-2.5 py-1.5 text-slate-500">{r.error_message || r.status}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function DripsSection() {
  const [drips, setDrips] = useState([])
  const load = useCallback(async () => {
    try { setDrips(await getHandwryttenDrips()) } catch (_) {}
  }, [])
  useEffect(() => {
    load()
    const t = window.setInterval(load, 30000) // refresh progress periodically
    return () => window.clearInterval(t)
  }, [load])

  const active = drips.filter(d => d.status === 'active' || d.status === 'paused')
  const past   = drips.filter(d => d.status === 'complete' || d.status === 'cancelled')

  if (drips.length === 0) return null

  return (
    <div className="mb-6 space-y-3">
      <h2 className="text-sm font-semibold text-slate-700">Drip Campaigns</h2>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        {[...active, ...past].map(d => <DripCard key={d.id} drip={d} onChange={load} />)}
      </div>
    </div>
  )
}

function SummaryCard({ icon: Icon, label, value, tint }) {
  return (
    <div className="flex items-center gap-3 bg-white rounded-2xl border border-slate-200 shadow-sm px-5 py-4">
      <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${tint}`}><Icon className="w-5 h-5" /></div>
      <div>
        <p className="text-xl font-bold text-slate-900 tabular-nums leading-tight">{value}</p>
        <p className="text-xs text-slate-500">{label}</p>
      </div>
    </div>
  )
}

export default function CampaignsPage() {
  const [campaigns, setCampaigns]   = useState([])
  const [total,     setTotal]       = useState(0)
  const [loading,   setLoading]     = useState(true)
  const [page,      setPage]        = useState(0)
  const [summary,   setSummary]     = useState(null)
  const PAGE_SIZE = 20

  const load = useCallback(async (p = 0) => {
    setLoading(true)
    try {
      const { rows, total: t } = await getHandwryttenCampaigns({ limit: PAGE_SIZE, offset: p * PAGE_SIZE })
      setCampaigns(rows)
      setTotal(t)
      setPage(p)
    } catch (_) {}
    setLoading(false)
  }, [])

  useEffect(() => { load(0) }, [load])
  useEffect(() => { getMailResponseSummary().then(setSummary).catch(() => {}) }, [])

  const totalPages = Math.ceil(total / PAGE_SIZE)

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <TopBar
        title={`Mail Campaigns${total > 0 ? ` (${total})` : ''}`}
        actions={null}
      />

      <div className="flex-1 overflow-auto p-6">
        {summary && summary.sent > 0 && (
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
            <SummaryCard icon={Send}       label="Letters sent"      value={summary.sent.toLocaleString()}       tint="bg-blue-50 text-blue-600" />
            <SummaryCard icon={Reply}      label="Responses"         value={summary.responses.toLocaleString()}  tint="bg-emerald-50 text-emerald-600" />
            <SummaryCard icon={TrendingUp} label="Response rate"     value={`${summary.rate}%`}                   tint="bg-violet-50 text-violet-600" />
            <SummaryCard icon={Clock}      label="Avg. time to respond" value={summary.avgDays != null ? `${summary.avgDays} days` : '—'} tint="bg-amber-50 text-amber-600" />
          </div>
        )}
        <DripsSection />
        {loading && campaigns.length === 0 ? (
          <div className="flex items-center justify-center h-48">
            <Loader2 className="w-6 h-6 text-slate-400 animate-spin" />
          </div>
        ) : campaigns.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-64 text-center gap-3">
            <div className="w-12 h-12 rounded-2xl bg-slate-100 flex items-center justify-center">
              <Mail className="w-6 h-6 text-slate-400" />
            </div>
            <p className="text-base font-semibold text-slate-700">No campaigns yet</p>
            <p className="text-sm text-slate-400 max-w-sm">
              Use the Mail Campaign button on the Market Properties page to send your first bulk campaign.
            </p>
          </div>
        ) : (
          <>
            <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden shadow-sm">
              <table className="min-w-full">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-200">
                    <th className="px-4 py-3 w-8" />
                    <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wide">Date Sent</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wide">Message</th>
                    <th className="px-4 py-3 text-center text-xs font-semibold text-slate-500 uppercase tracking-wide">Total</th>
                    <th className="px-4 py-3 text-center text-xs font-semibold text-slate-500 uppercase tracking-wide">Sent</th>
                    <th className="px-4 py-3 text-center text-xs font-semibold text-slate-500 uppercase tracking-wide">Failed</th>
                    <th className="px-4 py-3 text-center text-xs font-semibold text-slate-500 uppercase tracking-wide">Responses</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wide">Status</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wide">Sent By</th>
                  </tr>
                </thead>
                <tbody>
                  {campaigns.map(c => <CampaignRow key={c.id} campaign={c} />)}
                </tbody>
              </table>
            </div>

            {/* Pagination */}
            {totalPages > 1 && (
              <div className="flex items-center justify-between mt-4">
                <p className="text-sm text-slate-500">
                  {page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, total)} of {total}
                </p>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => load(page - 1)}
                    disabled={page === 0}
                    className="px-3 py-1.5 text-sm border border-slate-200 rounded-lg text-slate-600 hover:bg-slate-50 disabled:opacity-40"
                  >Previous</button>
                  <button
                    onClick={() => load(page + 1)}
                    disabled={page >= totalPages - 1}
                    className="px-3 py-1.5 text-sm border border-slate-200 rounded-lg text-slate-600 hover:bg-slate-50 disabled:opacity-40"
                  >Next</button>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
