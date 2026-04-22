import { useState, useEffect, useCallback } from 'react'
import { Mail, Loader2, ChevronDown, ChevronRight, CheckCircle, AlertCircle, Clock } from 'lucide-react'
import { getHandwryttenCampaigns, getHandwryttenSends } from '../../api/client'
import TopBar from '../layout/TopBar'

function fmtDate(iso) {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' })
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
        <td className="px-4 py-3">
          <StatusBadge status={campaign.status} />
        </td>
        <td className="px-4 py-3 text-sm text-slate-500">{campaign.sent_by_name || '—'}</td>
      </tr>

      {expanded && (
        <tr>
          <td colSpan={8} className="bg-slate-50 px-4 py-3">
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
                      <th className="px-3 py-2 text-left font-semibold text-slate-500">Order ID</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sends.map(s => (
                      <tr key={s.id} className="border-b border-slate-50">
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
                        <td className="px-3 py-2 text-slate-400 font-mono">{s.handwrytten_order_id || '—'}</td>
                      </tr>
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

export default function CampaignsPage() {
  const [campaigns, setCampaigns]   = useState([])
  const [total,     setTotal]       = useState(0)
  const [loading,   setLoading]     = useState(true)
  const [page,      setPage]        = useState(0)
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

  const totalPages = Math.ceil(total / PAGE_SIZE)

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <TopBar
        title={`Mail Campaigns${total > 0 ? ` (${total})` : ''}`}
        actions={null}
      />

      <div className="flex-1 overflow-auto p-6">
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
