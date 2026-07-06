import { useEffect, useState } from 'react'
import { Chrome, Download, CheckCircle2, Mail, Building2, Copy, Check, AlertTriangle } from 'lucide-react'
import TopBar from '../layout/TopBar'
import { getPluginInfo, getPluginManaged, pluginDownloadUrl } from '../../api/client'
import { useAuth } from '../../context/AuthContext'

function CopyRow({ label, value, mono = true }) {
  const [done, setDone] = useState(false)
  const copy = () => { navigator.clipboard.writeText(value).then(() => { setDone(true); setTimeout(() => setDone(false), 1500) }) }
  return (
    <div>
      <p className="text-xs font-medium text-slate-500 mb-1">{label}</p>
      <div className="flex items-center gap-2">
        <code className={`flex-1 min-w-0 truncate px-3 py-2 bg-slate-900 text-slate-100 rounded-lg text-xs ${mono ? 'font-mono' : ''}`}>{value}</code>
        <button onClick={copy} className="shrink-0 w-9 h-9 flex items-center justify-center rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-50" title="Copy">
          {done ? <Check className="w-4 h-4 text-emerald-600" /> : <Copy className="w-4 h-4" />}
        </button>
      </div>
    </div>
  )
}

const STEPS = [
  { t: 'Download & unzip', d: 'Click the button above, then unzip the file somewhere permanent (e.g. your Documents folder — not Downloads, since the extension runs from wherever these files live).' },
  { t: 'Open Chrome extensions', d: 'Go to chrome://extensions in your address bar.' },
  { t: 'Turn on Developer mode', d: 'Flip the "Developer mode" switch in the top-right corner.' },
  { t: 'Load unpacked', d: 'Click "Load unpacked" (top-left) and select the unzipped knox-crm-extension folder — the one containing manifest.json.' },
  { t: 'Open Gmail', d: 'Go to Gmail, open any email, and press Ctrl+R to refresh. A blue "Knox CRM" button appears bottom-right.' },
]

export default function ExtensionPage() {
  const { user } = useAuth()
  const isAdmin = user?.role === 'admin'
  const [info, setInfo] = useState(null)
  const [managed, setManaged] = useState(null)
  useEffect(() => { getPluginInfo().then(setInfo).catch(() => {}) }, [])
  useEffect(() => { if (isAdmin) getPluginManaged().then(setManaged).catch(() => {}) }, [isAdmin])

  const managedJson = managed
    ? JSON.stringify({ crmUrl: managed.crmUrl, crmKey: managed.crmKey }, null, 2)
    : ''

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <TopBar title="Browser Extension" />
      <div className="flex-1 overflow-auto p-6 scrollbar-thin">
        <div className="max-w-2xl mx-auto space-y-6">

          {/* Hero / download */}
          <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6">
            <div className="flex items-start gap-4">
              <div className="w-12 h-12 rounded-xl bg-blue-50 flex items-center justify-center shrink-0">
                <Chrome className="w-6 h-6 text-blue-600" />
              </div>
              <div className="flex-1 min-w-0">
                <h2 className="text-lg font-bold text-slate-900">Knox CRM for Gmail</h2>
                <p className="text-sm text-slate-600 mt-1 leading-relaxed">
                  Add contacts, log emails, and pull phone numbers into the CRM without leaving your inbox.
                  {info?.version && <span className="text-slate-400"> · v{info.version}</span>}
                </p>
                <a
                  href={pluginDownloadUrl()}
                  className="inline-flex items-center gap-2 mt-4 px-4 py-2.5 bg-blue-600 text-white text-sm font-semibold rounded-xl hover:bg-blue-700 transition-colors"
                >
                  <Download className="w-4 h-4" /> Download extension (.zip)
                </a>
                <p className="flex items-center gap-1.5 text-xs text-emerald-700 mt-2.5">
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  Pre-configured for your account — no setup key needed.
                </p>
              </div>
            </div>
          </div>

          {/* Steps */}
          <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6">
            <h3 className="text-sm font-semibold text-slate-500 uppercase tracking-wide mb-4">Install (Chrome / Edge — about 1 minute)</h3>
            <ol className="space-y-4">
              {STEPS.map((s, i) => (
                <li key={i} className="flex gap-3">
                  <span className="w-6 h-6 rounded-full bg-blue-600 text-white text-xs font-bold flex items-center justify-center shrink-0 mt-0.5">{i + 1}</span>
                  <div>
                    <p className="text-sm font-semibold text-slate-800">{s.t}</p>
                    <p className="text-sm text-slate-600 mt-0.5 leading-relaxed">{s.d}</p>
                  </div>
                </li>
              ))}
            </ol>
          </div>

          {/* Usage */}
          <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6">
            <h3 className="text-sm font-semibold text-slate-500 uppercase tracking-wide mb-3">Using it</h3>
            <div className="flex items-start gap-3 text-sm text-slate-600 leading-relaxed">
              <Mail className="w-4 h-4 text-slate-400 mt-0.5 shrink-0" />
              <p>
                Open an email and click <b className="text-slate-800">Knox CRM</b> (bottom-right). If the sender is already a
                contact you can log the email or add a phone number; if not, search for a contact to attach their address to,
                or <b className="text-slate-800">＋ New contact</b> to add them (tenant contact, owner, broker, …).
              </p>
            </div>
          </div>

          {/* Admin: deploy to the whole team via Workspace */}
          {isAdmin && managed && (
            <div className="bg-white rounded-2xl border border-blue-200 shadow-sm p-6">
              <div className="flex items-center gap-2 mb-1">
                <Building2 className="w-4 h-4 text-blue-600" />
                <h3 className="text-sm font-bold text-slate-900">Deploy to your team (Google Workspace)</h3>
              </div>
              <p className="text-sm text-slate-600 mb-4 leading-relaxed">
                Force-install for everyone in your organization — it auto-installs and auto-updates, with no action needed from teammates.
              </p>

              {!managed.signingConfigured && (
                <div className="flex gap-2.5 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 mb-4 text-sm text-amber-800">
                  <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                  <span>Server signing key isn’t set yet. Add the <code className="font-mono">CRX_PRIVATE_KEY</code> value to Railway (ask your developer for it) before the update URL will work.</span>
                </div>
              )}

              <div className="space-y-3 mb-5">
                <CopyRow label="Extension ID" value={managed.extensionId || '—'} />
                <CopyRow label="Update URL (custom/self-hosted)" value={managed.updateUrl} />
                <div>
                  <p className="text-xs font-medium text-slate-500 mb-1">Policy for extensions (managed config JSON)</p>
                  <div className="flex items-start gap-2">
                    <pre className="flex-1 min-w-0 overflow-x-auto px-3 py-2 bg-slate-900 text-slate-100 rounded-lg text-xs font-mono">{managedJson}</pre>
                    <button onClick={() => navigator.clipboard.writeText(managedJson)} className="shrink-0 w-9 h-9 flex items-center justify-center rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-50" title="Copy">
                      <Copy className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              </div>

              <ol className="space-y-3 text-sm">
                {[
                  <>Go to <b>admin.google.com</b> → <b>Devices → Chrome → Apps &amp; extensions → Users &amp; browsers</b>. Pick the org unit (or top-level for everyone).</>,
                  <>Click the yellow <b>+</b> (bottom-right) → <b>Add Chrome app or extension by ID</b>.</>,
                  <>Paste the <b>Extension ID</b>, and under source choose <b>From a custom URL</b> — paste the <b>Update URL</b> above.</>,
                  <>Set installation policy to <b>Force install</b> (optionally “…and pin to toolbar”).</>,
                  <>In that extension’s <b>Policy for extensions</b> box, paste the <b>managed config JSON</b> above (this delivers the CRM URL + key securely — it is never in the package).</>,
                  <>Click <b>Save</b>. Within a bit, everyone signed into Chrome with their Workspace account gets it automatically.</>,
                ].map((t, i) => (
                  <li key={i} className="flex gap-3">
                    <span className="w-5 h-5 rounded-full bg-blue-600 text-white text-xs font-bold flex items-center justify-center shrink-0 mt-0.5">{i + 1}</span>
                    <span className="text-slate-700 leading-relaxed">{t}</span>
                  </li>
                ))}
              </ol>
              <p className="text-xs text-slate-400 mt-4">To push an update later, the developer bumps the extension version — Chrome re-pulls it from the update URL automatically.</p>
            </div>
          )}

          {/* Troubleshooting */}
          <div className="rounded-2xl border border-slate-200 bg-slate-50 p-5">
            <p className="text-xs text-slate-500 leading-relaxed">
              <b className="text-slate-600">Not connecting?</b> Click the puzzle-piece icon → Knox CRM, and confirm the CRM URL and key are
              filled in (the download pre-fills them). <b className="text-slate-600">Updates:</b> this is a manually-loaded extension, so
              when a new version ships, download it again and re-load it from chrome://extensions.
            </p>
          </div>

        </div>
      </div>
    </div>
  )
}
