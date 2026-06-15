import { useState, useEffect, useCallback } from 'react'
import { usePlaidLink } from 'react-plaid-link'
import { Link2, RefreshCw, Trash2, Loader2, Building2, AlertCircle, CheckCircle, WifiOff } from 'lucide-react'
import {
  createPlaidLinkToken, exchangePlaidToken, getPlaidConnections,
  syncPlaidConnection, disconnectPlaid, createTransactions,
  categorizeTransactions, learnCategories,
} from '../../api/client'
import Button from '../ui/Button'
import { ALL_CATEGORIES as CATEGORIES, guessCategory } from '../../utils/accounting'

const SOURCE_BADGE = {
  rule:  { label: 'learned', cls: 'bg-emerald-100 text-emerald-700' },
  ai:    { label: 'AI',      cls: 'bg-violet-100 text-violet-700' },
  guess: { label: 'guess',   cls: 'bg-slate-100 text-slate-500' },
}

function fmt$(n) {
  if (!n && n !== 0) return '—'
  const abs = '$' + Math.abs(Math.round(n)).toLocaleString()
  return n < 0 ? `-${abs}` : abs
}
function fmtDate(iso) {
  if (!iso) return '—'
  return new Date(iso + 'T00:00:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
}
function fmtTs(iso) {
  if (!iso) return 'Never'
  const d = new Date(iso)
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) + ' ' +
         d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
}

// ── Sync review modal ─────────────────────────────────────────────────────────

function SyncReview({ propertyId, transactions: raw, onSaved, onClose }) {
  // Start with an instant local guess so the table renders immediately,
  // then upgrade to learned-rule / AI suggestions from the server.
  const [rows, setRows] = useState(() =>
    raw.map(t => ({ ...t, category: guessCategory(t.description, t.amount), source: 'guess', edited: false, include: true }))
  )
  const [saving, setSaving]         = useState(false)
  const [error,  setError]          = useState(null)
  const [suggesting, setSuggesting] = useState(raw.length > 0)

  // Fetch smarter suggestions on open
  useEffect(() => {
    let cancelled = false
    if (!raw.length) { setSuggesting(false); return }
    categorizeTransactions(raw.map(t => ({
      description: t.description, amount: t.amount, plaid_category: t.plaid_category,
    })))
      .then(({ suggestions }) => {
        if (cancelled || !suggestions?.length) return
        setRows(prev => prev.map((r, i) =>
          r.edited ? r : { ...r, category: suggestions[i]?.category ?? r.category, source: suggestions[i]?.source ?? r.source }
        ))
      })
      .catch(() => {})
      .finally(() => { if (!cancelled) setSuggesting(false) })
    return () => { cancelled = true }
  }, [raw])

  const included = rows.filter(r => r.include)
  const learnedCount = rows.filter(r => r.source === 'rule').length

  async function handleImport() {
    if (!included.length) return onClose()
    setSaving(true)
    setError(null)
    try {
      await createTransactions(propertyId, included.map(r => ({
        date:        r.date,
        description: r.description,
        category:    r.category,
        amount:      r.amount,
        source:      'Bank Statement',
      })))
      // Teach the rules engine from the approved categories (fire-and-forget)
      learnCategories(included.map(r => ({ description: r.description, category: r.category }))).catch(() => {})
      onSaved()
      onClose()
    } catch (e) {
      setError(e.message)
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-3xl max-h-[85vh] flex flex-col">

        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between shrink-0">
          <div>
            <h2 className="text-base font-semibold text-slate-900">Review Synced Transactions</h2>
            <p className="text-xs text-slate-500 mt-0.5">
              {suggesting ? (
                <span className="inline-flex items-center gap-1.5"><Loader2 className="w-3 h-3 animate-spin" /> Auto-categorizing…</span>
              ) : (
                <>
                  {raw.length} transaction{raw.length !== 1 ? 's' : ''} — categories auto-filled
                  {learnedCount > 0 && <span className="text-emerald-600 font-medium"> · {learnedCount} from learned rules</span>}
                  . Adjust any and they'll be remembered.
                </>
              )}
            </p>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 p-1 rounded-lg hover:bg-slate-100 transition-colors">
            <span className="text-lg leading-none">✕</span>
          </button>
        </div>

        {/* Table */}
        <div className="flex-1 overflow-y-auto">
          {raw.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-slate-400 gap-2">
              <CheckCircle className="w-8 h-8 opacity-40" />
              <p className="text-sm font-medium">All caught up</p>
              <p className="text-xs">No new transactions since last sync</p>
            </div>
          ) : (
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200 sticky top-0 z-10">
                  <th className="px-4 pl-5 py-2.5 w-8">
                    <input type="checkbox"
                      checked={rows.every(r => r.include)}
                      onChange={e => setRows(prev => prev.map(r => ({ ...r, include: e.target.checked })))}
                      className="rounded border-slate-300"
                    />
                  </th>
                  <th className="px-3 py-2.5 text-xs font-semibold text-slate-500 uppercase tracking-wide text-left whitespace-nowrap">Date</th>
                  <th className="px-3 py-2.5 text-xs font-semibold text-slate-500 uppercase tracking-wide text-left">Description</th>
                  <th className="px-3 py-2.5 text-xs font-semibold text-slate-500 uppercase tracking-wide text-right whitespace-nowrap">Amount</th>
                  <th className="px-3 pr-5 py-2.5 text-xs font-semibold text-slate-500 uppercase tracking-wide text-left whitespace-nowrap">Category</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row, i) => (
                  <tr key={i} className={`border-b border-slate-100 hover:bg-slate-50/60 transition-colors ${!row.include ? 'opacity-40' : ''}`}>
                    <td className="px-4 pl-5 py-2.5">
                      <input type="checkbox" checked={row.include}
                        onChange={e => setRows(prev => prev.map((r, j) => j === i ? { ...r, include: e.target.checked } : r))}
                        className="rounded border-slate-300"
                      />
                    </td>
                    <td className="px-3 py-2.5 text-slate-500 text-xs whitespace-nowrap">{fmtDate(row.date)}</td>
                    <td className="px-3 py-2.5 text-slate-800 font-medium max-w-[240px] truncate">{row.description}</td>
                    <td className={`px-3 py-2.5 text-right font-semibold tabular-nums whitespace-nowrap ${Number(row.amount) >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                      {fmt$(row.amount)}
                    </td>
                    <td className="px-3 pr-5 py-2.5">
                      <div className="flex items-center gap-1.5">
                        <select value={row.category}
                          onChange={e => setRows(prev => prev.map((r, j) => j === i ? { ...r, category: e.target.value, source: 'edited', edited: true } : r))}
                          className="text-xs border border-slate-200 rounded-lg px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-400 bg-white"
                        >
                          {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
                        </select>
                        {SOURCE_BADGE[row.source] && (
                          <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded-full shrink-0 ${SOURCE_BADGE[row.source].cls}`}>
                            {SOURCE_BADGE[row.source].label}
                          </span>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {error && (
          <div className="mx-6 mb-2 flex items-center gap-2 px-3 py-2 bg-red-50 border border-red-200 rounded-lg text-xs text-red-700">
            <AlertCircle className="w-3.5 h-3.5 shrink-0" />{error}
          </div>
        )}

        <div className="px-6 py-4 border-t border-slate-100 bg-slate-50 rounded-b-2xl flex items-center justify-between shrink-0">
          <button onClick={onClose} className="text-sm text-slate-400 hover:text-slate-600 transition-colors">Cancel</button>
          <Button onClick={handleImport} disabled={saving || !included.length}>
            {saving
              ? <><Loader2 className="w-4 h-4 animate-spin" /> Saving…</>
              : included.length === 0
                ? 'No transactions selected'
                : `Import ${included.length} Transaction${included.length !== 1 ? 's' : ''}`
            }
          </Button>
        </div>
      </div>
    </div>
  )
}

// ── PlaidLink wrapper — isolated so hook re-initialises when token changes ────

function PlaidLinkButton({ linkToken, onSuccess, onExit, children }) {
  const { open, ready } = usePlaidLink({
    token: linkToken,
    onSuccess,
    onExit,
  })

  useEffect(() => {
    if (ready) open()
  }, [ready])   // eslint-disable-line react-hooks/exhaustive-deps

  return null   // button is rendered by the parent; this component just triggers open()
}

// ── Main PlaidConnect component ───────────────────────────────────────────────

export default function PlaidConnect({ propertyId, onSaved }) {
  const [connections,    setConnections]    = useState([])
  const [loading,        setLoading]        = useState(true)
  const [linkToken,      setLinkToken]      = useState(null)   // triggers PlaidLink
  const [fetchingToken,  setFetchingToken]  = useState(false)
  const [syncing,        setSyncing]        = useState(null)   // conn id
  const [disconnecting,  setDisconnecting]  = useState(null)   // conn id
  const [syncResult,     setSyncResult]     = useState(null)   // { transactions }
  const [notConfigured,  setNotConfigured]  = useState(false)
  const [error,          setError]          = useState(null)

  const loadConnections = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      setConnections(await getPlaidConnections(propertyId))
    } catch (e) {
      if (e.message?.toLowerCase().includes('not configured')) setNotConfigured(true)
      else setError(e.message)
    } finally {
      setLoading(false)
    }
  }, [propertyId])

  useEffect(() => { loadConnections() }, [loadConnections])

  async function handleConnect() {
    setFetchingToken(true)
    setError(null)
    setNotConfigured(false)
    try {
      const { link_token } = await createPlaidLinkToken()
      setLinkToken(link_token)
    } catch (e) {
      if (e.message?.toLowerCase().includes('not configured')) setNotConfigured(true)
      else setError(e.message)
      setFetchingToken(false)
    }
  }

  async function handlePlaidSuccess(public_token, metadata) {
    setLinkToken(null)
    setFetchingToken(false)
    setError(null)
    const account = metadata.accounts?.[0] || {}
    try {
      await exchangePlaidToken({
        public_token,
        property_id:      propertyId,
        account_id:       account.id         || '',
        account_name:     account.name       || 'Account',
        account_mask:     account.mask       || '',
        institution_name: metadata.institution?.name || '',
      })
      await loadConnections()
    } catch (e) {
      setError(e.message || 'Failed to connect bank account — check Railway logs for details')
    }
  }

  async function handleSync(connId) {
    setSyncing(connId)
    setError(null)
    try {
      const result = await syncPlaidConnection(connId)
      await loadConnections()     // refresh last_synced_at
      if (result.count > 0) {
        setSyncResult(result.transactions)
      }
    } catch (e) {
      setError(e.message)
    } finally {
      setSyncing(null)
    }
  }

  async function handleDisconnect(connId) {
    if (!window.confirm('Disconnect this bank account? Existing transactions will remain in the ledger.')) return
    setDisconnecting(connId)
    try {
      await disconnectPlaid(connId)
      setConnections(prev => prev.filter(c => c.id !== connId))
    } catch (e) {
      setError(e.message)
    } finally {
      setDisconnecting(null)
    }
  }

  // ── Render ──────────────────────────────────────────────────────────────────

  if (loading) return (
    <div className="shrink-0 border-b border-slate-200 px-6 py-4 flex items-center gap-2 text-slate-400">
      <Loader2 className="w-4 h-4 animate-spin" />
      <span className="text-sm">Loading bank connections…</span>
    </div>
  )

  return (
    <>
      {/* Plaid Link — mounts only when we have a token */}
      {linkToken && (
        <PlaidLinkButton
          linkToken={linkToken}
          onSuccess={handlePlaidSuccess}
          onExit={(err, metadata) => {
            setLinkToken(null)
            setFetchingToken(false)
            if (err) setError(`Plaid error: ${err.error_message || err.display_message || err.error_code || JSON.stringify(err)}`)
          }}
        />
      )}

      <div className="shrink-0 bg-white border-b border-slate-200">
        {/* Section header */}
        <div className="px-6 pt-3 pb-2 flex items-center justify-between">
          <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wide">
            Connected Bank Accounts{connections.length > 0 && ` — ${connections.length}`}
          </h3>
          {!notConfigured && (
            <button
              onClick={handleConnect}
              disabled={fetchingToken}
              className="flex items-center gap-1.5 text-xs font-medium text-blue-600 hover:text-blue-800 px-3 py-1.5 rounded-lg border border-blue-200 hover:border-blue-400 hover:bg-blue-50 transition-colors disabled:opacity-50"
            >
              {fetchingToken
                ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Connecting…</>
                : <><Link2 className="w-3.5 h-3.5" /> Connect Bank Account</>
              }
            </button>
          )}
        </div>

        {/* Plaid not configured notice */}
        {notConfigured && (
          <div className="mx-6 mb-3 flex items-start gap-2.5 px-4 py-3 bg-amber-50 border border-amber-200 rounded-lg">
            <WifiOff className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-medium text-amber-800">Plaid not configured</p>
              <p className="text-xs text-amber-700 mt-0.5">
                Add <code className="bg-amber-100 px-1 rounded">PLAID_CLIENT_ID</code>,{' '}
                <code className="bg-amber-100 px-1 rounded">PLAID_SECRET</code>, and{' '}
                <code className="bg-amber-100 px-1 rounded">PLAID_ENV</code> to your Railway environment variables,
                then redeploy. Sign up free at{' '}
                <a href="https://dashboard.plaid.com/signup" target="_blank" rel="noopener noreferrer"
                  className="underline hover:text-amber-900">dashboard.plaid.com</a>.
              </p>
            </div>
          </div>
        )}

        {/* Generic error */}
        {error && (
          <div className="mx-6 mb-3 flex items-center gap-2 px-3 py-2 bg-red-50 border border-red-200 rounded-lg text-xs text-red-700">
            <AlertCircle className="w-3.5 h-3.5 shrink-0" />
            <span>{error}</span>
            <button onClick={() => setError(null)} className="ml-auto text-red-400 hover:text-red-600">✕</button>
          </div>
        )}

        {/* Empty state */}
        {!notConfigured && connections.length === 0 && (
          <p className="px-6 pb-4 text-sm text-slate-400">
            No accounts connected yet. Click "Connect Bank Account" to link via Plaid.
          </p>
        )}

        {/* Connected accounts list */}
        {connections.length > 0 && (
          <div className="px-6 pb-3 space-y-2">
            {connections.map(conn => (
              <div key={conn.id}
                className="flex items-center justify-between bg-slate-50 rounded-xl px-4 py-3 border border-slate-200">
                <div className="flex items-center gap-3 min-w-0">
                  <div className="w-8 h-8 rounded-lg bg-blue-100 flex items-center justify-center shrink-0">
                    <Building2 className="w-4 h-4 text-blue-600" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-slate-900">
                      {conn.institution_name || 'Bank'}
                      {conn.account_mask && (
                        <span className="text-slate-400 font-normal"> ····{conn.account_mask}</span>
                      )}
                    </p>
                    <p className="text-xs text-slate-400 truncate">
                      {conn.account_name} · Last synced: {fmtTs(conn.last_synced_at)}
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-2 shrink-0 ml-4">
                  <button
                    onClick={() => handleSync(conn.id)}
                    disabled={syncing === conn.id}
                    className="flex items-center gap-1.5 text-xs font-medium text-blue-600 hover:text-blue-800 px-3 py-1.5 rounded-lg border border-blue-200 hover:bg-blue-50 transition-colors disabled:opacity-50"
                  >
                    {syncing === conn.id
                      ? <><Loader2 className="w-3 h-3 animate-spin" /> Syncing…</>
                      : <><RefreshCw className="w-3 h-3" /> Sync</>
                    }
                  </button>
                  <button
                    onClick={() => handleDisconnect(conn.id)}
                    disabled={!!disconnecting}
                    className="p-1.5 rounded-lg text-slate-300 hover:text-red-500 hover:bg-red-50 transition-colors disabled:opacity-40"
                    title="Disconnect account"
                  >
                    {disconnecting === conn.id
                      ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      : <Trash2 className="w-3.5 h-3.5" />
                    }
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Sync review modal */}
      {syncResult && (
        <SyncReview
          propertyId={propertyId}
          transactions={syncResult}
          onSaved={onSaved}
          onClose={() => setSyncResult(null)}
        />
      )}
    </>
  )
}
