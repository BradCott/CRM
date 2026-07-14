// Floating AI copilot — available app-wide, context-aware
import { useState, useRef, useEffect } from 'react'
import { Sparkles, X, Send, Loader2, Check, Trash2, AlertTriangle, Paperclip, FileText } from 'lucide-react'
import { askAssistant, executeAssistantAction } from '../../api/client'
import { useAssistant } from '../../context/AssistantContext'

const DESTRUCTIVE = new Set(['delete_properties', 'delete_people', 'delete_transactions', 'delete_investor'])

// Read a File → { name, mime, data(base64) } for sending to the copilot
function fileToAttachment(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve({ name: file.name, mime: file.type, data: String(reader.result).split(',')[1] })
    reader.onerror = reject
    reader.readAsDataURL(file)
  })
}

const SUGGESTIONS = [
  '📎 Upload a rent roll or statement and I\'ll propose the updates',
  'Recategorize all Home Depot transactions on this property to Repair',
  'Remove the duplicate Sponsor row from this cap table',
  "Summarize this property's finances",
]

// Minimal markdown: **bold**, bullet lines, paragraphs
function renderText(text) {
  return text.split('\n').map((line, i) => {
    const bulleted = /^\s*[-*]\s+/.test(line)
    const content = line.replace(/^\s*[-*]\s+/, '')
    const parts = content.split(/(\*\*[^*]+\*\*)/g).map((p, j) =>
      p.startsWith('**') && p.endsWith('**')
        ? <strong key={j}>{p.slice(2, -2)}</strong>
        : <span key={j}>{p}</span>
    )
    if (!line.trim()) return <div key={i} className="h-2" />
    return (
      <p key={i} className={bulleted ? 'flex gap-1.5 pl-1' : ''}>
        {bulleted && <span className="text-slate-400">•</span>}
        <span>{parts}</span>
      </p>
    )
  })
}

// Capture what's visible on screen so the copilot can "see" the page. Prefers
// the top-most open modal/dialog (e.g. the settlement statement window).
function captureScreen() {
  const overlays = [...document.querySelectorAll('.fixed.inset-0')]
    .filter(el => el.offsetParent !== null && (el.innerText || '').trim().length > 0)
  const target = overlays.length ? overlays[overlays.length - 1]
    : document.querySelector('main') || document.body
  const text = (target?.innerText || '')
    .replace(/\s*\n\s*\n\s*/g, '\n')
    .trim()
  return text.slice(0, 7000)
}

export default function AssistantWidget() {
  const { getAssistantContext, registerOpener } = useAssistant()
  const [open, setOpen]       = useState(false)
  const [messages, setMessages] = useState([])
  const [input, setInput]     = useState('')
  const [loading, setLoading] = useState(false)
  const [attachments, setAttachments] = useState([])   // { name, mime, data }
  const scrollRef = useRef(null)
  const fileRef   = useRef(null)

  async function addFiles(fileList) {
    const files = [...(fileList || [])].slice(0, 5)
    const atts = await Promise.all(files.map(fileToAttachment))
    setAttachments(prev => [...prev, ...atts].slice(0, 5))
  }

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight
  }, [messages, loading])

  // Let other parts of the app open the copilot with a ready-to-send prompt
  useEffect(() => {
    registerOpener((prompt) => {
      setOpen(true)
      if (prompt) setInput(prompt)
    })
    return () => registerOpener(null)
  }, [registerOpener])

  async function send(text) {
    const content = (text ?? input).trim()
    const atts = attachments
    if ((!content && !atts.length) || loading) return
    const apiText = content || 'Please review the attached document(s) and propose the changes that make sense.'
    // Display message (shows the file chips); API sends the real text + attachments
    const shown = [...messages, { role: 'user', content, attachmentNames: atts.map(a => a.name) }]
    const apiMsgs = [...messages.map(({ role, content }) => ({ role, content })), { role: 'user', content: apiText }]
    setMessages(shown)
    setInput('')
    setAttachments([])
    setLoading(true)
    try {
      const registered = getAssistantContext()
      const screen = captureScreen()
      const context = [
        registered,
        screen && `=== Text currently visible on the user's screen ===\n${screen}`,
      ].filter(Boolean).join('\n\n')
      const { reply, actions } = await askAssistant(apiMsgs, context, atts)
      const withStatus = (actions || []).map(a => ({ ...a, status: 'pending' }))
      setMessages([...shown, { role: 'assistant', content: reply, actions: withStatus }])
    } catch (e) {
      setMessages([...shown, { role: 'assistant', content: `Sorry — I hit an error: ${e.message}` }])
    } finally {
      setLoading(false)
    }
  }

  async function runAction(msgIdx, actIdx) {
    setMessages(prev => prev.map((m, i) => i !== msgIdx ? m : {
      ...m, actions: m.actions.map((a, j) => j === actIdx ? { ...a, status: 'running' } : a),
    }))
    const action = messages[msgIdx].actions[actIdx]
    try {
      const { result } = await executeAssistantAction({ type: action.type, params: action.params })
      setMessages(prev => prev.map((m, i) => i !== msgIdx ? m : {
        ...m, actions: m.actions.map((a, j) => j === actIdx ? { ...a, status: 'done', result } : a),
      }))
    } catch (e) {
      setMessages(prev => prev.map((m, i) => i !== msgIdx ? m : {
        ...m, actions: m.actions.map((a, j) => j === actIdx ? { ...a, status: 'error', result: e.message } : a),
      }))
    }
  }

  function dismissAction(msgIdx, actIdx) {
    setMessages(prev => prev.map((m, i) => i !== msgIdx ? m : {
      ...m, actions: m.actions.map((a, j) => j === actIdx ? { ...a, status: 'dismissed' } : a),
    }))
  }

  return (
    <>
      {/* Launcher */}
      {!open && (
        <button
          onClick={() => setOpen(true)}
          className="fixed bottom-5 right-5 z-[60] flex items-center gap-2 px-4 py-3 rounded-full bg-blue-600 text-white shadow-lg hover:bg-blue-700 transition-colors"
          title="Ask the Knox copilot"
        >
          <Sparkles className="w-5 h-5" />
          <span className="text-sm font-semibold">Ask Copilot</span>
        </button>
      )}

      {/* Panel */}
      {open && (
        <div className="fixed bottom-5 right-5 z-[60] w-[400px] max-w-[calc(100vw-2rem)] h-[560px] max-h-[calc(100vh-2.5rem)] bg-white rounded-2xl shadow-2xl border border-slate-200 flex flex-col">
          <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100 shrink-0">
            <div className="flex items-center gap-2">
              <div className="w-7 h-7 rounded-lg bg-blue-50 flex items-center justify-center">
                <Sparkles className="w-4 h-4 text-blue-600" />
              </div>
              <div>
                <p className="text-sm font-semibold text-slate-900 leading-tight">Knox Copilot</p>
                <p className="text-[11px] text-slate-400 leading-tight">Accounting & app help</p>
              </div>
            </div>
            <button onClick={() => setOpen(false)} className="text-slate-400 hover:text-slate-600 p-1 rounded-lg hover:bg-slate-100">
              <X className="w-4 h-4" />
            </button>
          </div>

          <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-3 space-y-3 scrollbar-thin">
            {messages.length === 0 && (
              <div className="space-y-3">
                <p className="text-sm text-slate-500">
                  Ask me anything, or <span className="font-medium text-slate-700">attach a document</span> (📎) — a statement, rent roll, lease, spreadsheet — and I'll read it and propose the exact changes to make. I can see what you're working on, and every change is yours to confirm.
                </p>
                <div className="space-y-1.5">
                  {SUGGESTIONS.map(s => (
                    <button key={s} onClick={() => send(s)}
                      className="w-full text-left text-xs text-blue-700 bg-blue-50 hover:bg-blue-100 rounded-lg px-3 py-2 transition-colors">
                      {s}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {messages.map((m, i) => (
              <div key={i}>
                <div className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                  <div className={`max-w-[85%] rounded-2xl px-3.5 py-2 text-sm ${
                    m.role === 'user'
                      ? 'bg-blue-600 text-white rounded-br-sm'
                      : 'bg-slate-100 text-slate-800 rounded-bl-sm'
                  }`}>
                    {m.attachmentNames?.length > 0 && (
                      <div className="flex flex-wrap gap-1 mb-1.5">
                        {m.attachmentNames.map((n, k) => (
                          <span key={k} className={`inline-flex items-center gap-1 text-[11px] px-1.5 py-0.5 rounded-md ${m.role === 'user' ? 'bg-blue-500/60' : 'bg-slate-200'}`}>
                            <FileText className="w-3 h-3" /> {n}
                          </span>
                        ))}
                      </div>
                    )}
                    {m.content && <div className="space-y-1 leading-relaxed">{renderText(m.content)}</div>}
                  </div>
                </div>

                {/* Proposed actions — confirm before anything is changed */}
                {m.actions?.map((a, j) => {
                  const destructive = DESTRUCTIVE.has(a.type)
                  return (
                    <div key={j} className={`mt-2 rounded-xl border p-3 ${
                      a.status === 'done' ? 'border-emerald-200 bg-emerald-50'
                      : a.status === 'error' ? 'border-red-200 bg-red-50'
                      : a.status === 'dismissed' ? 'border-slate-200 bg-slate-50 opacity-60'
                      : destructive ? 'border-red-200 bg-red-50/50' : 'border-blue-200 bg-blue-50/50'
                    }`}>
                      <div className="flex items-start gap-2">
                        {destructive
                          ? <AlertTriangle className="w-4 h-4 text-red-500 shrink-0 mt-0.5" />
                          : <Sparkles className="w-4 h-4 text-blue-500 shrink-0 mt-0.5" />}
                        <p className="text-xs text-slate-700 flex-1">{a.summary}</p>
                      </div>
                      {a.status === 'pending' && (
                        <div className="flex gap-2 mt-2 pl-6">
                          <button onClick={() => runAction(i, j)}
                            className={`flex items-center gap-1 text-xs font-medium px-3 py-1.5 rounded-lg text-white transition-colors ${destructive ? 'bg-red-600 hover:bg-red-700' : 'bg-blue-600 hover:bg-blue-700'}`}>
                            {destructive ? <Trash2 className="w-3 h-3" /> : <Check className="w-3 h-3" />} Confirm
                          </button>
                          <button onClick={() => dismissAction(i, j)}
                            className="text-xs font-medium px-3 py-1.5 rounded-lg text-slate-500 hover:bg-slate-100 transition-colors">
                            Dismiss
                          </button>
                        </div>
                      )}
                      {a.status === 'running' && <p className="text-xs text-slate-500 mt-1.5 pl-6 flex items-center gap-1.5"><Loader2 className="w-3 h-3 animate-spin" /> Working…</p>}
                      {a.status === 'done' && <p className="text-xs text-emerald-700 font-medium mt-1.5 pl-6 flex items-center gap-1"><Check className="w-3 h-3" /> {a.result}</p>}
                      {a.status === 'error' && <p className="text-xs text-red-700 mt-1.5 pl-6">{a.result}</p>}
                      {a.status === 'dismissed' && <p className="text-xs text-slate-400 mt-1.5 pl-6">Dismissed</p>}
                    </div>
                  )
                })}
              </div>
            ))}

            {loading && (
              <div className="flex justify-start">
                <div className="bg-slate-100 rounded-2xl rounded-bl-sm px-3.5 py-2.5">
                  <Loader2 className="w-4 h-4 text-slate-400 animate-spin" />
                </div>
              </div>
            )}
          </div>

          <div className="px-3 py-3 border-t border-slate-100 shrink-0">
            {attachments.length > 0 && (
              <div className="flex flex-wrap gap-1.5 mb-2">
                {attachments.map((a, k) => (
                  <span key={k} className="inline-flex items-center gap-1 text-[11px] bg-slate-100 text-slate-600 px-2 py-1 rounded-md">
                    <FileText className="w-3 h-3" /> <span className="max-w-[140px] truncate">{a.name}</span>
                    <button onClick={() => setAttachments(prev => prev.filter((_, j) => j !== k))} className="text-slate-400 hover:text-red-500"><X className="w-3 h-3" /></button>
                  </span>
                ))}
              </div>
            )}
            <div className="flex items-end gap-2">
              <input ref={fileRef} type="file" multiple accept=".pdf,.xlsx,.xls,.csv,.png,.jpg,.jpeg,.txt" className="hidden"
                onChange={e => { addFiles(e.target.files); e.target.value = '' }} />
              <button onClick={() => fileRef.current?.click()} disabled={loading}
                className="p-2 rounded-xl text-slate-400 hover:text-blue-600 hover:bg-slate-100 transition-colors shrink-0 disabled:opacity-40"
                title="Attach a document (PDF, Excel, CSV, image)">
                <Paperclip className="w-4 h-4" />
              </button>
              <textarea
                value={input}
                onChange={e => setInput(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() } }}
                placeholder={attachments.length ? 'Add a note, or just send…' : 'Ask, or attach a document…'}
                rows={1}
                className="flex-1 resize-none text-sm border border-slate-200 rounded-xl px-3 py-2 max-h-24 focus:outline-none focus:ring-2 focus:ring-blue-400"
              />
              <button
                onClick={() => send()}
                disabled={loading || (!input.trim() && !attachments.length)}
                className="p-2 rounded-xl bg-blue-600 text-white hover:bg-blue-700 transition-colors disabled:opacity-40 shrink-0"
              >
                <Send className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
