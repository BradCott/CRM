import { useEffect, useState } from 'react'
import { Chrome, Download, CheckCircle2, Mail } from 'lucide-react'
import TopBar from '../layout/TopBar'
import { getPluginInfo, pluginDownloadUrl } from '../../api/client'

const STEPS = [
  { t: 'Download & unzip', d: 'Click the button above, then unzip the file somewhere permanent (e.g. your Documents folder — not Downloads, since the extension runs from wherever these files live).' },
  { t: 'Open Chrome extensions', d: 'Go to chrome://extensions in your address bar.' },
  { t: 'Turn on Developer mode', d: 'Flip the "Developer mode" switch in the top-right corner.' },
  { t: 'Load unpacked', d: 'Click "Load unpacked" (top-left) and select the unzipped knox-crm-extension folder — the one containing manifest.json.' },
  { t: 'Open Gmail', d: 'Go to Gmail, open any email, and press Ctrl+R to refresh. A blue "Knox CRM" button appears bottom-right.' },
]

export default function ExtensionPage() {
  const [info, setInfo] = useState(null)
  useEffect(() => { getPluginInfo().then(setInfo).catch(() => {}) }, [])

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
