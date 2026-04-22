import { useState, useEffect } from 'react'
import { X, Mail, Loader2, CheckCircle, AlertCircle, Eye, EyeOff } from 'lucide-react'
import { useAuth } from '../../context/AuthContext'
import {
  getHandwryttenCards,
  getHandwryttenFonts,
  sendHandwryttenLetter,
} from '../../api/client'
import Button from '../ui/Button'

const DEFAULT_TEMPLATE =
  `{first_name}, Any chance you'd ever consider selling your {tenant} in {city}? ` +
  `I buy these around the country and figured it was worth reaching out directly. ` +
  `We're a small group, move quick, no brokers, no fluff. ` +
  `Even if you're just curious what it might be worth, I'm happy to run numbers. ` +
  `Call, text, or email anytime.`

const CHAR_WARN  = 700
const CHAR_MAX   = 1000

function applyMerge(template, person, property) {
  if (!template) return ''
  const first = person?.first_name || (person?.name || '').split(' ')[0] || ''
  const last  = person?.last_name  || (person?.name || '').split(' ').slice(1).join(' ') || ''
  return template
    .replace(/\{first_name\}/gi, first   || '[First Name]')
    .replace(/\{last_name\}/gi,  last    || '[Last Name]')
    .replace(/\{full_name\}/gi,  person?.name || '[Full Name]')
    .replace(/\{tenant\}/gi,     property?.tenant_brand_name || '[Tenant]')
    .replace(/\{city\}/gi,       property?.city  || '[City]')
    .replace(/\{state\}/gi,      property?.state || '[State]')
}

export default function SendLetterModal({ person, property, onClose, onSent }) {
  const { user } = useAuth()

  const [message,      setMessage]      = useState(DEFAULT_TEMPLATE)
  const [cards,        setCards]        = useState([])
  const [fonts,        setFonts]        = useState([])
  const [selectedCard, setSelectedCard] = useState(null)
  const [selectedFont, setSelectedFont] = useState(null)
  const [loadingMeta,  setLoadingMeta]  = useState(true)
  const [metaError,    setMetaError]    = useState(null)
  const [showPreview,  setShowPreview]  = useState(false)
  const [sending,      setSending]      = useState(false)
  const [result,       setResult]       = useState(null) // { success, error }

  useEffect(() => {
    async function load() {
      try {
        const [cardsData, fontsData] = await Promise.all([
          getHandwryttenCards(),
          getHandwryttenFonts(),
        ])

        const cardList = Array.isArray(cardsData)
          ? cardsData
          : cardsData?.cards || cardsData?.data || []
        const fontList = Array.isArray(fontsData)
          ? fontsData
          : fontsData?.fonts || fontsData?.data || []

        setCards(cardList)
        setFonts(fontList)

        // Default card: "Knox 1" if available, else first
        const defaultCard = cardList.find(c =>
          (c.name || '').toLowerCase().includes('knox 1')
        ) || cardList[0] || null
        setSelectedCard(defaultCard?.id ?? null)

        // Default font: "jokester jared" if available, else first
        const defaultFont = fontList.find(f =>
          (f.name || '').toLowerCase().includes('jokester') ||
          (f.name || '').toLowerCase().includes('jared')
        ) || fontList[0] || null
        setSelectedFont(defaultFont?.id ?? null)
      } catch (err) {
        setMetaError(err.message)
      } finally {
        setLoadingMeta(false)
      }
    }
    load()
  }, [])

  async function handleSend() {
    setSending(true)
    setResult(null)
    try {
      await sendHandwryttenLetter({
        contact_id:  person.id,
        property_id: property?.id || null,
        message,
        card_id:     selectedCard,
        font:        selectedFont,
      })
      setResult({ success: true })
      onSent?.()
    } catch (err) {
      setResult({ success: false, error: err.message })
    } finally {
      setSending(false)
    }
  }

  const preview  = applyMerge(message, person, property)
  const charCount = message.length
  const overLimit = charCount > CHAR_MAX
  const nearLimit = charCount > CHAR_WARN

  const hasAddress = !!person?.address

  // ── Success state ─────────────────────────────────────────────────────────
  if (result?.success) {
    return (
      <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
        <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-8 text-center">
          <CheckCircle className="w-12 h-12 text-green-500 mx-auto mb-4" />
          <h2 className="text-lg font-bold text-slate-900 mb-2">Letter Sent!</h2>
          <p className="text-sm text-slate-500 mb-6">
            Your handwritten letter to <strong>{person?.name}</strong> has been queued for delivery.
          </p>
          <Button onClick={onClose}>Close</Button>
        </div>
      </div>
    )
  }

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl flex flex-col max-h-[90vh]">

        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
          <div className="flex items-center gap-2">
            <Mail className="w-5 h-5 text-blue-600" />
            <h2 className="text-base font-bold text-slate-900">Send Handwritten Letter</h2>
          </div>
          <button onClick={onClose} className="w-8 h-8 rounded-lg flex items-center justify-center text-slate-400 hover:bg-slate-100">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto">
          {/* Recipient info */}
          <div className="px-6 pt-4 pb-3 bg-slate-50 border-b border-slate-100">
            <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-1">To</p>
            <p className="text-sm font-semibold text-slate-900">{person?.name}</p>
            {hasAddress ? (
              <p className="text-xs text-slate-500 mt-0.5">
                {[person.address, person.city, person.state, person.zip].filter(Boolean).join(', ')}
              </p>
            ) : (
              <p className="text-xs text-red-500 font-medium mt-0.5 flex items-center gap-1">
                <AlertCircle className="w-3 h-3" /> No mailing address on file — letter cannot be sent
              </p>
            )}
          </div>

          <div className="px-6 py-4 space-y-5">

            {/* Message */}
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className="text-xs font-semibold text-slate-600 uppercase tracking-wide">Message</label>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setShowPreview(v => !v)}
                    className="flex items-center gap-1 text-xs text-blue-600 hover:text-blue-800"
                  >
                    {showPreview ? <EyeOff className="w-3 h-3" /> : <Eye className="w-3 h-3" />}
                    {showPreview ? 'Edit' : 'Preview'}
                  </button>
                  <span className={`text-xs font-medium ${overLimit ? 'text-red-600' : nearLimit ? 'text-amber-600' : 'text-slate-400'}`}>
                    {charCount}/{CHAR_MAX}
                  </span>
                </div>
              </div>

              {showPreview ? (
                <div className="w-full min-h-[140px] p-3 bg-amber-50 border border-amber-200 rounded-xl text-sm text-slate-800 leading-relaxed whitespace-pre-wrap">
                  {preview}
                </div>
              ) : (
                <textarea
                  value={message}
                  onChange={e => setMessage(e.target.value)}
                  rows={6}
                  className={`w-full px-3 py-2.5 text-sm border rounded-xl resize-none focus:outline-none focus:ring-2 focus:ring-blue-500 ${
                    overLimit ? 'border-red-300 bg-red-50' : 'border-slate-200'
                  }`}
                  placeholder="Write your message…"
                />
              )}
              {overLimit && (
                <p className="text-xs text-red-600 mt-1 flex items-center gap-1">
                  <AlertCircle className="w-3 h-3" /> Message exceeds {CHAR_MAX} characters. Handwrytten may truncate.
                </p>
              )}
              <p className="text-xs text-slate-400 mt-1">
                Merge fields: <code className="bg-slate-100 px-1 rounded">{'{first_name}'}</code>{' '}
                <code className="bg-slate-100 px-1 rounded">{'{tenant}'}</code>{' '}
                <code className="bg-slate-100 px-1 rounded">{'{city}'}</code>{' '}
                <code className="bg-slate-100 px-1 rounded">{'{state}'}</code>{' '}
                <code className="bg-slate-100 px-1 rounded">{'{full_name}'}</code>
              </p>
            </div>

            {/* Card selector */}
            {loadingMeta ? (
              <div className="flex items-center gap-2 text-sm text-slate-400">
                <Loader2 className="w-4 h-4 animate-spin" /> Loading cards & fonts…
              </div>
            ) : metaError ? (
              <p className="text-sm text-amber-600 bg-amber-50 rounded-lg px-3 py-2">
                Could not load cards: {metaError}. You can still send — the card selection will be skipped.
              </p>
            ) : (
              <>
                {/* Card thumbnails */}
                {cards.length > 0 && (
                  <div>
                    <label className="text-xs font-semibold text-slate-600 uppercase tracking-wide mb-2 block">
                      Card Template
                    </label>
                    <div className="flex gap-3 overflow-x-auto pb-2">
                      {cards.map(card => (
                        <button
                          key={card.id}
                          onClick={() => setSelectedCard(card.id)}
                          className={`shrink-0 rounded-xl border-2 overflow-hidden transition-all ${
                            selectedCard === card.id
                              ? 'border-blue-500 shadow-md'
                              : 'border-slate-200 hover:border-slate-300'
                          }`}
                        >
                          {card.thumbnail || card.image_url || card.preview_url ? (
                            <img
                              src={card.thumbnail || card.image_url || card.preview_url}
                              alt={card.name}
                              className="w-24 h-16 object-cover"
                            />
                          ) : (
                            <div className="w-24 h-16 bg-slate-100 flex items-center justify-center">
                              <span className="text-xs text-slate-400">No preview</span>
                            </div>
                          )}
                          <p className="text-xs text-center py-1 px-2 truncate max-w-[96px] text-slate-700 font-medium">
                            {card.name}
                          </p>
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {/* Font selector */}
                {fonts.length > 0 && (
                  <div>
                    <label className="text-xs font-semibold text-slate-600 uppercase tracking-wide mb-1.5 block">
                      Handwriting Font
                    </label>
                    <select
                      value={selectedFont ?? ''}
                      onChange={e => setSelectedFont(e.target.value || null)}
                      className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                    >
                      <option value="">— Select font —</option>
                      {fonts.map(f => (
                        <option key={f.id} value={f.id}>{f.name}</option>
                      ))}
                    </select>
                  </div>
                )}
              </>
            )}

            {/* Signature */}
            <div>
              <label className="text-xs font-semibold text-slate-600 uppercase tracking-wide mb-1.5 block">
                Signature (from)
              </label>
              <div className="px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm text-slate-700">
                {user?.name || user?.email || 'Your name'}
              </div>
              <p className="text-xs text-slate-400 mt-1">This is the name that appears as the sender.</p>
            </div>

            {/* Send error */}
            {result?.error && (
              <div className="flex items-start gap-2 text-sm text-red-700 bg-red-50 rounded-xl px-3 py-2.5">
                <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
                <span>{result.error}</span>
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-6 py-4 border-t border-slate-100 bg-white rounded-b-2xl">
          <button onClick={onClose} className="text-sm text-slate-500 hover:text-slate-700">
            Cancel
          </button>
          <Button
            onClick={handleSend}
            disabled={sending || !hasAddress || overLimit}
          >
            {sending
              ? <><Loader2 className="w-4 h-4 animate-spin" /> Sending…</>
              : <><Mail className="w-4 h-4" /> Send Letter</>
            }
          </Button>
        </div>

      </div>
    </div>
  )
}
