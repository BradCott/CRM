// Floating AI copilot — available app-wide, context-aware
import { useState, useRef, useEffect } from 'react'
import { Sparkles, X, Send, Loader2 } from 'lucide-react'
import { askAssistant } from '../../api/client'
import { useAssistant } from '../../context/AssistantContext'

const SUGGESTIONS = [
  'Help me handle this settlement statement',
  'How do I split a mortgage payment into principal and interest?',
  'What category should I use for an HOA fee?',
  'How does the Needs Review workflow work?',
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
  const { getAssistantContext } = useAssistant()
  const [open, setOpen]       = useState(false)
  const [messages, setMessages] = useState([])
  const [input, setInput]     = useState('')
  const [loading, setLoading] = useState(false)
  const scrollRef = useRef(null)

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight
  }, [messages, loading])

  async function send(text) {
    const content = (text ?? input).trim()
    if (!content || loading) return
    const next = [...messages, { role: 'user', content }]
    setMessages(next)
    setInput('')
    setLoading(true)
    try {
      // Combine page-registered structured context with a live screen snapshot
      const registered = getAssistantContext()
      const screen = captureScreen()
      const context = [
        registered,
        screen && `=== Text currently visible on the user's screen ===\n${screen}`,
      ].filter(Boolean).join('\n\n')
      const { reply } = await askAssistant(next, context)
      setMessages([...next, { role: 'assistant', content: reply }])
    } catch (e) {
      setMessages([...next, { role: 'assistant', content: `Sorry — I hit an error: ${e.message}` }])
    } finally {
      setLoading(false)
    }
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
                  Ask me anything about handling transactions, settlement statements, categories, or how to use the CRM. I can see what you're working on.
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
              <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                <div className={`max-w-[85%] rounded-2xl px-3.5 py-2 text-sm ${
                  m.role === 'user'
                    ? 'bg-blue-600 text-white rounded-br-sm'
                    : 'bg-slate-100 text-slate-800 rounded-bl-sm'
                }`}>
                  <div className="space-y-1 leading-relaxed">{renderText(m.content)}</div>
                </div>
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
            <div className="flex items-end gap-2">
              <textarea
                value={input}
                onChange={e => setInput(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() } }}
                placeholder="Ask a question…"
                rows={1}
                className="flex-1 resize-none text-sm border border-slate-200 rounded-xl px-3 py-2 max-h-24 focus:outline-none focus:ring-2 focus:ring-blue-400"
              />
              <button
                onClick={() => send()}
                disabled={loading || !input.trim()}
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
