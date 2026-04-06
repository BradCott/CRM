import { useEffect, useState } from 'react'
import { Settings, FolderOpen, CheckCircle, XCircle, AlertCircle, LogOut, Chrome, ExternalLink } from 'lucide-react'
import { getGoogleStatus, disconnectGoogle } from '../../api/client'
import Button from '../ui/Button'

export default function SettingsPage() {
  const [status, setStatus]   = useState(null)
  const [loading, setLoading] = useState(true)
  const [msg, setMsg]         = useState(null)

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
                  <div>
                    <p className="text-xs font-semibold text-slate-700">LOIs Folder</p>
                    <p className={`text-xs mt-0.5 ${status.driveFolderFound ? 'text-slate-500' : 'text-amber-600'}`}>
                      {status.driveFolderFound
                        ? `Watching — checked ${status.lastDriveCheck ? fmtDate(status.lastDriveCheck) : 'not yet'}`
                        : 'Folder named "LOIs" not found in your Drive'}
                    </p>
                  </div>
                </div>
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
