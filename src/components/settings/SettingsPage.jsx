import { useEffect, useState } from 'react'
import { Settings, FolderOpen, CheckCircle, XCircle, AlertCircle, LogOut, Chrome, ExternalLink, RefreshCw, PlayCircle, Download, Database, Mail } from 'lucide-react'
import { getGoogleStatus, disconnectGoogle, diagnoseDrive, runDriveWatcher, setLoiFolder, syncGmailNow, getBackupInfo, backupDbUrl, exportJsonUrl, exportExcelUrl, getEmailFrom, setEmailFrom } from '../../api/client'
import Button from '../ui/Button'

// Preset "From" addresses for outbound app email. Sending as management@
// requires it to be a verified "Send mail as" alias on the connected account.
const FROM_PRESETS = [
  { label: 'Management', value: 'Knox Capital Management <management@knoxcre.com>', hint: 'management@knoxcre.com' },
  { label: 'Brad',       value: 'Brad Cott <brad@knoxcre.com>',                     hint: 'brad@knoxcre.com' },
]

export default function SettingsPage() {
  const [status, setStatus]   = useState(null)
  const [loading, setLoading] = useState(true)
  const [msg, setMsg]         = useState(null)
  const [diag, setDiag]       = useState(null)
  const [diagLoading, setDiagLoading] = useState(false)
  const [backupInfo, setBackupInfo] = useState(null)
  const [folderInput, setFolderInput] = useState('')
  const [pinning, setPinning]   = useState(false)
  const [gmailSyncing, setGmailSyncing] = useState(false)
  const [senderFrom, setSenderFrom] = useState('')
  const [emailSaving, setEmailSaving] = useState(false)
  const [emailNote, setEmailNote]   = useState('')

  useEffect(() => { getEmailFrom().then(r => setSenderFrom(r.from)).catch(() => {}) }, [])

  async function chooseFrom(value) {
    if (value === senderFrom) return
    setEmailSaving(true); setEmailNote('')
    try {
      const r = await setEmailFrom(value)
      setSenderFrom(r.from)
      setEmailNote(`Saved — outbound email now sends from ${r.from}.`)
    } catch (e) {
      setEmailNote(`Error: ${e.message}`)
    } finally {
      setEmailSaving(false)
    }
  }

  async function handleGmailSync() {
    setGmailSyncing(true)
    setMsg(null)
    try {
      const r = await syncGmailNow()
      setMsg({ type: 'success', text:
        `Gmail synced — ${r.synced} email${r.synced === 1 ? '' : 's'} logged to contacts${r.replies > 0 ? `, including ${r.replies} repl${r.replies === 1 ? 'y' : 'ies'} to a mailer (see Today's Plays).` : '.'}` })
    } catch (err) {
      setMsg({ type: 'error', text: err.message })
    } finally {
      setGmailSyncing(false)
    }
  }

  async function handlePinFolder() {
    if (!folderInput.trim()) return
    setPinning(true)
    setMsg(null)
    try {
      const result = await setLoiFolder(folderInput.trim())
      setDiag(result)
      setFolderInput('')
      setMsg({ type: 'success', text: `Pinned the LOIs folder. ${result.dealsCreated > 0 ? `Imported ${result.dealsCreated} deal(s).` : 'Scanned — no new deals (check the folder below).'}` })
    } catch (err) {
      setMsg({ type: 'error', text: err.message })
    } finally {
      setPinning(false)
    }
  }

  useEffect(() => { getBackupInfo().then(setBackupInfo).catch(() => {}) }, [])

  async function handleTestNow(reset = false) {
    setDiagLoading(true)
    setMsg(null)
    try {
      const result = await runDriveWatcher(reset)
      setDiag(result)
      if (result.dealsCreated > 0) {
        setMsg({ type: 'success', text: `Imported ${result.dealsCreated} deal${result.dealsCreated > 1 ? 's' : ''} into the pipeline.` })
      }
    } catch (err) {
      setMsg({ type: 'error', text: err.message })
    } finally {
      setDiagLoading(false)
    }
  }

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    if (params.get('google') === 'connected') {
      setMsg({ type: 'success', text: 'Google account connected successfully!' })
      window.history.replaceState({}, '', '/settings')
    } else if (params.get('google') === 'error') {
      setMsg({ type: 'error', text: 'Failed to connect Google account. Please try again.' })
      window.history.replaceState({}, '', '/settings')
    }
    loadStatus()
  }, [])

  async function loadStatus() {
    setLoading(true)
    try {
      setStatus(await getGoogleStatus())
    } catch (_) {
      setStatus({ connected: false })
    } finally {
      setLoading(false)
    }
  }

  async function handleDisconnect() {
    if (!confirm('Disconnect Google account? The Drive watcher will stop.')) return
    try {
      await disconnectGoogle()
      setStatus({ connected: false })
      setMsg({ type: 'success', text: 'Google account disconnected.' })
    } catch (err) {
      setMsg({ type: 'error', text: err.message })
    }
  }

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-2 px-6 py-4 border-b border-slate-200 shrink-0">
        <Settings className="w-5 h-5 text-slate-400" />
        <h1 className="text-lg font-bold text-slate-900">Settings</h1>
      </div>

      <div className="flex-1 overflow-y-auto p-6">
        <div className="max-w-2xl space-y-6">

          {/* Google Drive integration */}
          <Card title="Google Drive" subtitle='Watch the "LOIs" folder and auto-create pipeline deals when new documents are added.'>
            {msg && (
              <div className={`flex items-center gap-2 text-sm px-4 py-3 rounded-xl mb-4 ${
                msg.type === 'success' ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700'
              }`}>
                {msg.type === 'success'
                  ? <CheckCircle className="w-4 h-4 shrink-0" />
                  : <XCircle    className="w-4 h-4 shrink-0" />}
                {msg.text}
              </div>
            )}

            {loading ? (
              <div className="flex items-center gap-2 text-sm text-slate-500">
                <div className="w-4 h-4 border-2 border-blue-400 border-t-transparent rounded-full animate-spin" />
                Checking connection...
              </div>
            ) : status?.connected ? (
              <div className="space-y-4">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-emerald-50 flex items-center justify-center shrink-0">
                    <CheckCircle className="w-5 h-5 text-emerald-600" />
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-slate-800">Connected</p>
                    <p className="text-xs text-slate-500">{status.email}</p>
                  </div>
                  <button
                    onClick={handleDisconnect}
                    className="ml-auto flex items-center gap-1.5 text-xs text-slate-400 hover:text-red-600 transition-colors"
                  >
                    <LogOut className="w-3.5 h-3.5" /> Disconnect
                  </button>
                </div>

                <div className={`flex items-center gap-3 p-4 rounded-xl border ${
                  status.driveFolderFound
                    ? 'border-slate-100 bg-slate-50'
                    : 'border-amber-200 bg-amber-50'
                }`}>
                  <FolderOpen className={`w-4 h-4 shrink-0 ${status.driveFolderFound ? 'text-slate-400' : 'text-amber-500'}`} />
                  <div className="flex-1">
                    <p className="text-xs font-semibold text-slate-700">LOIs Folder</p>
                    <p className={`text-xs mt-0.5 ${status.driveFolderFound ? 'text-slate-500' : 'text-amber-600'}`}>
                      {status.driveFolderFound
                        ? `Watching — checked ${status.lastDriveCheck ? fmtDate(status.lastDriveCheck) : 'not yet'}`
                        : 'Folder named "LOIs" not found in your Drive'}
                    </p>
                  </div>
                  <button
                    onClick={() => handleTestNow(false)}
                    disabled={diagLoading}
                    className="flex items-center gap-1.5 text-xs font-medium text-blue-600 hover:text-blue-800 px-3 py-1.5 rounded-lg border border-blue-200 hover:bg-blue-50 transition-colors shrink-0 disabled:opacity-50"
                  >
                    {diagLoading
                      ? <><RefreshCw className="w-3.5 h-3.5 animate-spin" /> Testing…</>
                      : <><PlayCircle className="w-3.5 h-3.5" /> Test now</>}
                  </button>
                </div>

                {/* Pin the exact LOIs folder (fixes "wrong folder" — multiple LOIs folders) */}
                <div className="mb-3 p-3 rounded-xl border border-slate-200 bg-slate-50">
                  <p className="text-xs font-semibold text-slate-600 mb-1">Pin the exact LOIs folder</p>
                  <p className="text-[11px] text-slate-400 mb-2">
                    If it's reading the wrong folder, open <strong>Knox CRE/LOIs</strong> in Google Drive, copy the URL from your browser, and paste it here.
                  </p>
                  <div className="flex gap-2">
                    <input
                      value={folderInput}
                      onChange={e => setFolderInput(e.target.value)}
                      placeholder="https://drive.google.com/drive/folders/…"
                      className="flex-1 text-xs border border-slate-300 rounded-lg px-2.5 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-400"
                    />
                    <button
                      onClick={handlePinFolder}
                      disabled={pinning || !folderInput.trim()}
                      className="flex items-center gap-1.5 text-xs font-medium text-white bg-blue-600 hover:bg-blue-700 px-3 py-1.5 rounded-lg disabled:opacity-50 shrink-0"
                    >
                      {pinning ? <><RefreshCw className="w-3.5 h-3.5 animate-spin" /> Pinning…</> : <><FolderOpen className="w-3.5 h-3.5" /> Pin & scan</>}
                    </button>
                  </div>
                </div>

                {/* Pull recent Gmail into contact timelines (auto-runs every 15 min) */}
                <div className="mb-3 p-3 rounded-xl border border-slate-200 bg-slate-50 flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-xs font-semibold text-slate-600">Sync Gmail to contacts</p>
                    <p className="text-[11px] text-slate-400">Logs emails to/from your contacts and flags replies to mailers. Runs automatically every 15 min.</p>
                  </div>
                  <button
                    onClick={handleGmailSync}
                    disabled={gmailSyncing}
                    className="flex items-center gap-1.5 text-xs font-medium text-blue-600 hover:text-blue-800 px-3 py-1.5 rounded-lg border border-blue-200 hover:bg-blue-50 transition-colors disabled:opacity-50 shrink-0"
                  >
                    {gmailSyncing ? <><RefreshCw className="w-3.5 h-3.5 animate-spin" /> Syncing…</> : <><RefreshCw className="w-3.5 h-3.5" /> Sync now</>}
                  </button>
                </div>

                {diag && (
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <p className="text-xs text-slate-500">
                        {diag.dealsCreated > 0
                          ? `${diag.dealsCreated} deal(s) imported.`
                          : 'No new deals — already imported, or folder empty.'}
                      </p>
                      <button
                        onClick={() => handleTestNow(true)}
                        disabled={diagLoading}
                        className="text-xs text-slate-400 hover:text-slate-700 underline disabled:opacity-50"
                      >
                        Re-scan last 7 days
                      </button>
                    </div>
                    {['LOIs', 'notes'].map(key => {
                      const f = diag.folders?.[key]
                      if (!f) return null
                      const ok = f.found && f.fileCount >= 0
                      return (
                        <div key={key} className={`p-3 rounded-xl border text-xs ${
                          f.found ? 'border-emerald-200 bg-emerald-50' : 'border-amber-200 bg-amber-50'
                        }`}>
                          <div className="flex items-center gap-2">
                            {f.found
                              ? <CheckCircle className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                              : <AlertCircle className="w-3.5 h-3.5 text-amber-600 shrink-0" />}
                            <span className="font-semibold text-slate-700">"{f.name}" folder</span>
                            {f.inSharedDrive && <span className="text-[10px] bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded-full">Shared Drive</span>}
                          </div>
                          <p className={`mt-1 ${f.found ? 'text-emerald-700' : 'text-amber-700'}`}>{f.message}</p>
                          {f.recentFiles?.length > 0 && (
                            <ul className="mt-1.5 space-y-0.5 text-slate-500">
                              {f.recentFiles.map((rf, i) => (
                                <li key={i} className="truncate">• {rf.name}</li>
                              ))}
                            </ul>
                          )}
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            ) : (
              <div className="space-y-4">
                <div className="flex items-start gap-3 p-4 bg-slate-50 rounded-xl">
                  <AlertCircle className="w-4 h-4 text-slate-400 mt-0.5 shrink-0" />
                  <p className="text-sm text-slate-600">
                    Connect your Google account to watch your <strong>LOIs</strong> folder.
                    New documents are automatically parsed and added to the pipeline.
                  </p>
                </div>
                <Button onClick={() => { window.location.href = '/api/auth/google' }} variant="primary">
                  <GoogleIcon />
                  Connect Google Account
                </Button>
              </div>
            )}
          </Card>

          {/* Outbound email sender */}
          <Card title="Outbound Email" subtitle="Which address the CRM sends from — reimbursement requests, tenant notices, portal invites, and reminders.">
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-2">
                {FROM_PRESETS.map(p => {
                  const active = senderFrom === p.value
                  return (
                    <button
                      key={p.value}
                      onClick={() => chooseFrom(p.value)}
                      disabled={emailSaving}
                      className={`text-left p-3 rounded-xl border transition-colors disabled:opacity-60 ${
                        active ? 'border-blue-400 bg-blue-50 ring-1 ring-blue-300' : 'border-slate-200 hover:border-slate-300'
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <span className="text-sm font-semibold text-slate-800">{p.label}</span>
                        {active && <CheckCircle className="w-4 h-4 text-blue-600" />}
                      </div>
                      <p className="text-xs text-slate-500 mt-0.5">{p.hint}</p>
                    </button>
                  )
                })}
              </div>
              {senderFrom && !FROM_PRESETS.some(p => p.value === senderFrom) && (
                <p className="text-xs text-slate-500">Custom sender: <span className="font-mono">{senderFrom}</span></p>
              )}
              {emailNote && (
                <p className={`text-xs ${emailNote.startsWith('Error') ? 'text-red-600' : 'text-emerald-600'}`}>{emailNote}</p>
              )}
              <div className="flex items-start gap-2 p-3 bg-slate-50 rounded-xl border border-slate-100">
                <Mail className="w-4 h-4 text-slate-400 mt-0.5 shrink-0" />
                <p className="text-[11px] text-slate-500 leading-relaxed">
                  All email goes out through the one connected Google account{status?.email ? <> (<strong>{status.email}</strong>)</> : ''}, so <strong>Brad and Cole both send from the address chosen here</strong> — nothing to set up per person.
                  Sending as <strong>management@</strong> only works if it's a verified “Send mail as” alias on that account.
                </p>
              </div>
            </div>
          </Card>

          {/* Data & Backup */}
          <Card title="Data & Backup" subtitle="Download a complete copy of all CRM data to keep an off-site backup.">
            <div className="space-y-4">
              <div className="flex items-start gap-3 p-4 bg-slate-50 rounded-xl border border-slate-100">
                <Database className="w-4 h-4 text-slate-500 mt-0.5 shrink-0" />
                <div className="text-sm text-slate-600">
                  <p className="font-medium text-slate-800 mb-0.5">Everything in one file</p>
                  <p className="text-xs leading-relaxed">
                    Includes every property, person, deal, investor, accounting transaction, campaign — all tables.
                    {backupInfo && (
                      <> Currently <strong>{backupInfo.totalRows.toLocaleString()}</strong> records across {backupInfo.tableCount} tables.</>
                    )}
                  </p>
                </div>
              </div>

              <div className="flex flex-wrap gap-2">
                <a href={exportExcelUrl} download
                  className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-emerald-600 hover:bg-emerald-700 rounded-lg transition-colors">
                  <Download className="w-4 h-4" /> Export to Excel (.xlsx)
                </a>
                <a href={backupDbUrl} download
                  className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-slate-700 border border-slate-200 hover:bg-slate-50 rounded-lg transition-colors">
                  <Download className="w-4 h-4" /> Full backup (.db)
                </a>
                <a href={exportJsonUrl} download
                  className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-slate-700 border border-slate-200 hover:bg-slate-50 rounded-lg transition-colors">
                  <Download className="w-4 h-4" /> Data (.json)
                </a>
              </div>

              <p className="text-xs text-slate-400 leading-relaxed">
                <strong>Excel</strong> is the easiest to read — one tab per data type, with a "Properties + Owners" tab listing every property next to its owner.
                The <strong>.db</strong> file is a complete, restorable database backup (store it safely — it can't be opened directly).
                The <strong>.json</strong> file is a plain-text copy. Do this periodically and keep the file somewhere secure.
              </p>
            </div>
          </Card>

          {/* Chrome Extension */}
          <Card title="Gmail Chrome Extension" subtitle='Add a "Log to CRM" button inside Gmail to capture emails with one click.'>
            <div className="space-y-4">
              <div className="flex items-start gap-3 p-4 bg-blue-50 rounded-xl border border-blue-100">
                <Chrome className="w-4 h-4 text-blue-500 mt-0.5 shrink-0" />
                <div className="text-sm text-blue-800">
                  <p className="font-medium mb-1">Install the Knox CRM extension</p>
                  <p className="text-xs text-blue-600 leading-relaxed">
                    The extension lives in the <code className="bg-blue-100 px-1 rounded">extension/</code> folder
                    in the project. Load it in Chrome as an unpacked extension to add
                    a "Log to CRM" button directly inside Gmail.
                  </p>
                </div>
              </div>

              <ol className="space-y-2 text-sm text-slate-600">
                <Step n={1}>Open <strong>chrome://extensions</strong> in Chrome</Step>
                <Step n={2}>Enable <strong>Developer mode</strong> (top-right toggle)</Step>
                <Step n={3}>Click <strong>Load unpacked</strong> and select the <code className="bg-slate-100 px-1.5 py-0.5 rounded text-xs">extension/</code> folder from this project</Step>
                <Step n={4}>Open <strong>Gmail</strong> — each email will have a "Log to CRM" button</Step>
                <Step n={5}>Click the Knox icon in Chrome's toolbar to configure the CRM URL if needed</Step>
              </ol>

              <div className="p-3 bg-slate-50 rounded-xl border border-slate-100 text-xs text-slate-500">
                Default CRM URL: <code className="font-mono">http://localhost:3001</code> — change in the extension popup if you're using Railway.
              </div>
            </div>
          </Card>

        </div>
      </div>
    </div>
  )
}

function Card({ title, subtitle, children }) {
  return (
    <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden">
      <div className="px-6 py-4 border-b border-slate-100 bg-slate-50">
        <h2 className="text-sm font-semibold text-slate-700">{title}</h2>
        {subtitle && <p className="text-xs text-slate-500 mt-0.5">{subtitle}</p>}
      </div>
      <div className="px-6 py-5">{children}</div>
    </div>
  )
}

function Step({ n, children }) {
  return (
    <li className="flex items-start gap-3">
      <span className="w-5 h-5 rounded-full bg-slate-200 text-slate-600 text-xs font-bold flex items-center justify-center shrink-0 mt-0.5">
        {n}
      </span>
      <span>{children}</span>
    </li>
  )
}

function GoogleIcon() {
  return (
    <svg className="w-4 h-4 mr-2" viewBox="0 0 24 24">
      <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
      <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
      <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
      <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
    </svg>
  )
}

function fmtDate(iso) {
  const d = new Date(iso)
  const diff = Date.now() - d
  if (diff < 60_000)    return 'just now'
  if (diff < 3600_000)  return `${Math.floor(diff / 60_000)}m ago`
  if (diff < 86400_000) return `${Math.floor(diff / 3600_000)}h ago`
  return d.toLocaleDateString()
}
