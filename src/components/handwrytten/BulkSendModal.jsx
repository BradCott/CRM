import { useState, useEffect, useCallback } from 'react'
import { X, Mail, Loader2, CheckCircle, AlertCircle, ChevronRight, Users, Search } from 'lucide-react'
import {
  getHandwryttenCards,
  getHandwryttenFonts,
  sendHandwryttenBulk,
  getProperties,
} from '../../api/client'
import { useApp } from '../../context/AppContext'
import Button from '../ui/Button'

const DEFAULT_TEMPLATE =
  `{first_name}, Any chance you'd ever consider selling your {tenant} in {city}? ` +
  `I buy these around the country and figured it was worth reaching out directly. ` +
  `We're a small group, move quick, no brokers, no fluff. ` +
  `Even if you're just curious what it might be worth, I'm happy to run numbers. ` +
  `Call, text, or email anytime.`

const CHAR_MAX  = 1000
const COST_LOW  = 3.00
const COST_HIGH = 4.00

const OWNER_TYPES = ['Individual', 'LLC', 'Trust', 'Institution', 'Corporation']

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

// ── Multi-select state picker ─────────────────────────────────────────────────
function StateMultiSelect({ allStates, selected, onChange }) {
  const [query, setQuery] = useState('')
  const visible = allStates.filter(s => !query || s.toLowerCase().includes(query.toLowerCase()))

  function toggle(s) {
    onChange(
      selected.includes(s) ? selected.filter(x => x !== s) : [...selected, s]
    )
  }

  return (
    <div className="border border-slate-200 rounded-xl overflow-hidden">
      <div className="flex items-center gap-2 px-3 py-2 border-b border-slate-100 bg-slate-50">
        <Search className="w-3.5 h-3.5 text-slate-400 shrink-0" />
        <input
          type="text"
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder="Search states…"
          className="flex-1 text-sm bg-transparent outline-none placeholder-slate-400"
        />
        {selected.length > 0 && (
          <button onClick={() => onChange([])} className="text-xs text-blue-600 hover:text-blue-800 shrink-0">
            Clear
          </button>
        )}
      </div>
      <div className="max-h-36 overflow-y-auto">
        {visible.length === 0 && (
          <p className="text-xs text-slate-400 px-3 py-2">No states match</p>
        )}
        {visible.map(s => (
          <label key={s} className="flex items-center gap-2 px-3 py-1.5 hover:bg-slate-50 cursor-pointer">
            <input
              type="checkbox"
              checked={selected.includes(s)}
              onChange={() => toggle(s)}
              className="accent-blue-600 w-3.5 h-3.5"
            />
            <span className="text-sm text-slate-700">{s}</span>
          </label>
        ))}
      </div>
      {selected.length > 0 && (
        <div className="px-3 py-1.5 border-t border-slate-100 bg-blue-50">
          <p className="text-xs text-blue-700 font-medium">
            {selected.join(', ')}
          </p>
        </div>
      )}
    </div>
  )
}

// ── Owner type checkbox list ──────────────────────────────────────────────────
function OwnerTypeCheckboxes({ selected, onChange }) {
  function toggle(t) {
    onChange(
      selected.includes(t) ? selected.filter(x => x !== t) : [...selected, t]
    )
  }
  return (
    <div className="flex flex-wrap gap-2">
      {OWNER_TYPES.map(t => (
        <label
          key={t}
          className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg border text-xs font-medium cursor-pointer transition-colors ${
            selected.includes(t)
              ? 'bg-blue-600 text-white border-blue-600'
              : 'bg-white text-slate-600 border-slate-200 hover:border-slate-300'
          }`}
        >
          <input
            type="checkbox"
            checked={selected.includes(t)}
            onChange={() => toggle(t)}
            className="sr-only"
          />
          {t}
        </label>
      ))}
      {selected.length > 0 && (
        <button
          onClick={() => onChange([])}
          className="px-2.5 py-1 rounded-lg border border-slate-200 text-xs text-slate-400 hover:text-slate-600"
        >
          Clear
        </button>
      )}
    </div>
  )
}

// Steps: filters → preview → sending → done
const STEPS = ['filters', 'preview', 'sending', 'done']

export default function BulkSendModal({ onClose, onDone }) {
  const { tenantBrands, propertyStates } = useApp()

  // ── Filter state ───────────────────────────────────────────────────────────
  const [filterStates,     setFilterStates]     = useState([])       // multi-select
  const [filterTenant,     setFilterTenant]     = useState('')       // text search
  const [filterOwnerTypes, setFilterOwnerTypes] = useState([])       // multi-select checkboxes
  const [filterLeaseStart, setFilterLeaseStart] = useState('')       // optional
  const [filterLeaseEnd,   setFilterLeaseEnd]   = useState('')       // optional

  // ── Recipients state ───────────────────────────────────────────────────────
  const [recipients,    setRecipients]    = useState([])
  const [loadingRec,    setLoadingRec]    = useState(false)

  // ── Letter state ───────────────────────────────────────────────────────────
  const [message,       setMessage]       = useState(DEFAULT_TEMPLATE)
  const [cards,         setCards]         = useState([])
  const [fonts,         setFonts]         = useState([])
  const [selectedCard,  setSelectedCard]  = useState(null)
  const [selectedFont,  setSelectedFont]  = useState(null)
  const [loadingMeta,   setLoadingMeta]   = useState(false)

  // ── Send state ─────────────────────────────────────────────────────────────
  const [step,          setStep]          = useState('filters')
  const [sendResult,    setSendResult]    = useState(null)
  const [sending,       setSending]       = useState(false)
  const [sendError,     setSendError]     = useState(null)

  // Load cards/fonts when entering preview step
  useEffect(() => {
    if (step !== 'preview' || cards.length > 0) return
    setLoadingMeta(true)
    Promise.all([getHandwryttenCards(), getHandwryttenFonts()])
      .then(([cd, fd]) => {
        const cardList = Array.isArray(cd) ? cd : cd?.cards || cd?.data || []
        const fontList = Array.isArray(fd) ? fd : fd?.fonts || fd?.data || []
        setCards(cardList)
        setFonts(fontList)
        const defCard = cardList.find(c => (c.name || '').toLowerCase().includes('knox 1')) || cardList[0] || null
        const defFont = fontList.find(f =>
          (f.name || '').toLowerCase().includes('jokester') ||
          (f.name || '').toLowerCase().includes('jared')
        ) || fontList[0] || null
        setSelectedCard(defCard?.id ?? null)
        setSelectedFont(defFont?.id ?? null)
      })
      .catch(() => {})
      .finally(() => setLoadingMeta(false))
  }, [step, cards.length])

  // ── Build recipient list ───────────────────────────────────────────────────
  const buildRecipients = useCallback(async () => {
    setLoadingRec(true)
    try {
      // Fetch all properties (up to 5000) — we filter client-side for flexibility
      const { rows } = await getProperties({ limit: 5000, offset: 0 })

      let filtered = rows

      // State filter — skip if none selected
      if (filterStates.length > 0) {
        filtered = filtered.filter(p => filterStates.includes(p.state))
      }

      // Tenant filter — text search against tenant_brand_name
      if (filterTenant.trim()) {
        const q = filterTenant.trim().toLowerCase()
        filtered = filtered.filter(p =>
          (p.tenant_brand_name || '').toLowerCase().includes(q)
        )
      }

      // Owner type filter — skip if none selected (show all)
      if (filterOwnerTypes.length > 0) {
        filtered = filtered.filter(p =>
          filterOwnerTypes.includes(p.owner_type || 'Individual')
        )
      }

      // Lease expiration — completely optional; only apply if a date is set
      if (filterLeaseStart) {
        filtered = filtered.filter(p => p.lease_end && p.lease_end >= filterLeaseStart)
      }
      if (filterLeaseEnd) {
        filtered = filtered.filter(p => p.lease_end && p.lease_end <= filterLeaseEnd)
      }

      // Deduplicate by owner — one letter per unique owner (first property wins)
      // A valid recipient must have: owner_id + owner_address + owner_city + owner_state
      const seen = new Set()
      const list = []
      for (const p of filtered) {
        if (!p.owner_id) continue
        if (seen.has(p.owner_id)) continue
        if (!p.owner_address || !p.owner_city || !p.owner_state) continue
        seen.add(p.owner_id)
        list.push({
          contact_id:       p.owner_id,
          property_id:      p.id,
          name:             p.owner_name || 'Unknown',
          address:          p.owner_address,
          city:             p.owner_city,
          state:            p.owner_state,
          zip:              p.owner_zip || '',
          tenant:           p.tenant_brand_name || '',
          property_address: p.address,
          property_city:    p.city,
          property_state:   p.state,
          // for merge preview
          first_name:       p.owner_first_name || (p.owner_name || '').split(' ')[0] || '',
          owner_name:       p.owner_name,
        })
      }
      setRecipients(list)
    } catch (err) {
      console.error('Failed to build recipients:', err)
    } finally {
      setLoadingRec(false)
    }
  }, [filterStates, filterTenant, filterOwnerTypes, filterLeaseStart, filterLeaseEnd])

  // ── Send ───────────────────────────────────────────────────────────────────
  async function handleSend() {
    setStep('sending')
    setSending(true)
    setSendError(null)
    try {
      const result = await sendHandwryttenBulk({
        recipients: recipients.map(r => ({ contact_id: r.contact_id, property_id: r.property_id })),
        message,
        card_id: selectedCard,
        font:    selectedFont,
      })
      setSendResult(result)
      setStep('done')
      onDone?.()
    } catch (err) {
      setSendError(err.message)
      setStep('preview')
    } finally {
      setSending(false)
    }
  }

  const overLimit = message.length > CHAR_MAX

  // Active filter summary for display
  const activeFilterCount = [
    filterStates.length > 0,
    filterTenant.trim() !== '',
    filterOwnerTypes.length > 0,
    filterLeaseStart !== '' || filterLeaseEnd !== '',
  ].filter(Boolean).length

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl flex flex-col max-h-[90vh]">

        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
          <div className="flex items-center gap-2">
            <Mail className="w-5 h-5 text-blue-600" />
            <h2 className="text-base font-bold text-slate-900">Mail Campaign</h2>
          </div>
          <div className="flex items-center gap-3">
            <div className="hidden sm:flex items-center gap-1 text-xs text-slate-400">
              {['Filters', 'Preview', step === 'sending' ? 'Sending…' : 'Done'].map((label, i) => {
                const active = i === STEPS.indexOf(step) || (step === 'done' && i === 2) || (step === 'sending' && i === 2)
                const done   = STEPS.indexOf(step) > i
                return (
                  <span key={label} className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                    active ? 'bg-blue-100 text-blue-700' : done ? 'text-green-600' : 'text-slate-400'
                  }`}>{label}</span>
                )
              })}
            </div>
            <button onClick={onClose} className="w-8 h-8 rounded-lg flex items-center justify-center text-slate-400 hover:bg-slate-100">
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* ── STEP: FILTERS ────────────────────────────────────────────────── */}
        {step === 'filters' && (
          <>
            <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">
              <p className="text-sm text-slate-500">
                Narrow which property owners receive letters. All filters are optional — leave everything blank to include every owner with a valid mailing address.
              </p>

              {/* State multi-select */}
              <div>
                <label className="block text-xs font-semibold text-slate-600 uppercase tracking-wide mb-1.5">
                  State {filterStates.length > 0 && <span className="ml-1 text-blue-600 normal-case font-normal">({filterStates.length} selected)</span>}
                </label>
                <StateMultiSelect
                  allStates={propertyStates}
                  selected={filterStates}
                  onChange={setFilterStates}
                />
              </div>

              {/* Tenant text search */}
              <div>
                <label className="block text-xs font-semibold text-slate-600 uppercase tracking-wide mb-1.5">Tenant</label>
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400" />
                  <input
                    type="text"
                    value={filterTenant}
                    onChange={e => setFilterTenant(e.target.value)}
                    placeholder="e.g. McDonald's, Dollar General…"
                    className="w-full pl-9 pr-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
              </div>

              {/* Owner type checkboxes */}
              <div>
                <label className="block text-xs font-semibold text-slate-600 uppercase tracking-wide mb-1.5">
                  Owner Type {filterOwnerTypes.length > 0 && <span className="ml-1 text-blue-600 normal-case font-normal">(filtered)</span>}
                </label>
                <OwnerTypeCheckboxes selected={filterOwnerTypes} onChange={setFilterOwnerTypes} />
              </div>

              {/* Lease expiration — optional */}
              <div>
                <label className="block text-xs font-semibold text-slate-600 uppercase tracking-wide mb-1.5">
                  Lease Expiration <span className="ml-1 text-slate-400 normal-case font-normal">(optional)</span>
                </label>
                <div className="flex items-center gap-2">
                  <input
                    type="date"
                    value={filterLeaseStart}
                    onChange={e => setFilterLeaseStart(e.target.value)}
                    className="flex-1 text-sm border border-slate-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                  <span className="text-slate-400 text-sm shrink-0">to</span>
                  <input
                    type="date"
                    value={filterLeaseEnd}
                    onChange={e => setFilterLeaseEnd(e.target.value)}
                    className="flex-1 text-sm border border-slate-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                  {(filterLeaseStart || filterLeaseEnd) && (
                    <button
                      onClick={() => { setFilterLeaseStart(''); setFilterLeaseEnd('') }}
                      className="text-xs text-slate-400 hover:text-slate-600 shrink-0"
                    >Clear</button>
                  )}
                </div>
              </div>

              {activeFilterCount === 0 && (
                <p className="text-xs text-slate-400 bg-slate-50 rounded-xl px-3 py-2">
                  No filters selected — all owners with a mailing address on file will be included.
                </p>
              )}
            </div>

            <div className="flex items-center justify-between px-6 py-4 border-t border-slate-100">
              <button onClick={onClose} className="text-sm text-slate-500 hover:text-slate-700">Cancel</button>
              <Button
                onClick={async () => { await buildRecipients(); setStep('preview') }}
                disabled={loadingRec}
              >
                {loadingRec
                  ? <><Loader2 className="w-4 h-4 animate-spin" /> Loading…</>
                  : <>Preview Recipients <ChevronRight className="w-4 h-4" /></>
                }
              </Button>
            </div>
          </>
        )}

        {/* ── STEP: PREVIEW ────────────────────────────────────────────────── */}
        {step === 'preview' && (
          <>
            <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">

              {/* Recipient list */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <h3 className="text-sm font-semibold text-slate-800 flex items-center gap-1.5">
                    <Users className="w-4 h-4 text-slate-400" />
                    Recipients ({recipients.length})
                  </h3>
                  <span className="text-xs text-slate-500">
                    Est. cost: ${(recipients.length * COST_LOW).toFixed(0)}–${(recipients.length * COST_HIGH).toFixed(0)}
                  </span>
                </div>

                {recipients.length === 0 ? (
                  <div className="rounded-xl border border-slate-200 p-6 text-center">
                    <p className="text-sm text-slate-400">No owners with a complete mailing address match these filters.</p>
                    <button onClick={() => setStep('filters')} className="text-xs text-blue-600 hover:underline mt-2">
                      Adjust filters
                    </button>
                  </div>
                ) : (
                  <div className="rounded-xl border border-slate-200 divide-y divide-slate-100 max-h-48 overflow-y-auto">
                    {recipients.map((r, i) => (
                      <div key={i} className="flex items-center justify-between px-3 py-2">
                        <div className="min-w-0">
                          <p className="text-sm font-medium text-slate-800 truncate">{r.name}</p>
                          <p className="text-xs text-slate-400 truncate">
                            {[r.address, r.city, r.state].filter(Boolean).join(', ')}
                          </p>
                        </div>
                        {r.tenant && (
                          <span className="ml-2 shrink-0 text-xs font-semibold bg-blue-50 text-blue-700 px-2 py-0.5 rounded-full">
                            {r.tenant}
                          </span>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Message template */}
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="text-xs font-semibold text-slate-600 uppercase tracking-wide">Message Template</label>
                  <span className={`text-xs font-medium ${message.length > CHAR_MAX ? 'text-red-600' : 'text-slate-400'}`}>
                    {message.length}/{CHAR_MAX}
                  </span>
                </div>
                <textarea
                  value={message}
                  onChange={e => setMessage(e.target.value)}
                  rows={5}
                  className={`w-full px-3 py-2.5 text-sm border rounded-xl resize-none focus:outline-none focus:ring-2 focus:ring-blue-500 ${
                    overLimit ? 'border-red-300 bg-red-50' : 'border-slate-200'
                  }`}
                />
                <p className="text-xs text-slate-400 mt-1">
                  Merge fields: <code className="bg-slate-100 px-1 rounded">{'{first_name}'}</code>{' '}
                  <code className="bg-slate-100 px-1 rounded">{'{tenant}'}</code>{' '}
                  <code className="bg-slate-100 px-1 rounded">{'{city}'}</code>{' '}
                  <code className="bg-slate-100 px-1 rounded">{'{state}'}</code>
                </p>
                {recipients.length > 0 && (
                  <div className="mt-2 p-3 bg-amber-50 border border-amber-200 rounded-xl text-xs text-slate-700 leading-relaxed">
                    <span className="font-semibold text-slate-500 block mb-1">Preview (first recipient):</span>
                    {applyMerge(message, recipients[0], {
                      tenant_brand_name: recipients[0].tenant,
                      city:  recipients[0].property_city,
                      state: recipients[0].property_state,
                    })}
                  </div>
                )}
              </div>

              {/* Card/font selectors */}
              {loadingMeta ? (
                <div className="flex items-center gap-2 text-sm text-slate-400">
                  <Loader2 className="w-4 h-4 animate-spin" /> Loading cards…
                </div>
              ) : (
                <>
                  {cards.length > 0 && (
                    <div>
                      <label className="text-xs font-semibold text-slate-600 uppercase tracking-wide mb-2 block">Card Template</label>
                      <div className="flex gap-3 overflow-x-auto pb-2">
                        {cards.map(card => (
                          <button
                            key={card.id}
                            onClick={() => setSelectedCard(card.id)}
                            className={`shrink-0 rounded-xl border-2 overflow-hidden transition-all ${
                              selectedCard === card.id ? 'border-blue-500 shadow-md' : 'border-slate-200 hover:border-slate-300'
                            }`}
                          >
                            {(card.thumbnail || card.image_url || card.preview_url) ? (
                              <img src={card.thumbnail || card.image_url || card.preview_url} alt={card.name} className="w-24 h-16 object-cover" />
                            ) : (
                              <div className="w-24 h-16 bg-slate-100 flex items-center justify-center">
                                <span className="text-xs text-slate-400">No preview</span>
                              </div>
                            )}
                            <p className="text-xs text-center py-1 px-2 truncate max-w-[96px] text-slate-700 font-medium">{card.name}</p>
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                  {fonts.length > 0 && (
                    <div>
                      <label className="text-xs font-semibold text-slate-600 uppercase tracking-wide mb-1.5 block">Handwriting Font</label>
                      <select
                        value={selectedFont ?? ''}
                        onChange={e => setSelectedFont(e.target.value || null)}
                        className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                      >
                        <option value="">— Select font —</option>
                        {fonts.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}
                      </select>
                    </div>
                  )}
                </>
              )}

              {sendError && (
                <div className="flex items-start gap-2 text-sm text-red-700 bg-red-50 rounded-xl px-3 py-2.5">
                  <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
                  <span>{sendError}</span>
                </div>
              )}
            </div>

            <div className="flex items-center justify-between px-6 py-4 border-t border-slate-100">
              <button onClick={() => setStep('filters')} className="text-sm text-slate-500 hover:text-slate-700">← Back</button>
              <div className="flex items-center gap-3">
                <span className="text-xs text-slate-400">
                  {recipients.length} letters · est. ${(recipients.length * COST_LOW).toFixed(0)}–${(recipients.length * COST_HIGH).toFixed(0)}
                </span>
                <Button
                  onClick={handleSend}
                  disabled={recipients.length === 0 || overLimit}
                >
                  <Mail className="w-4 h-4" /> Send {recipients.length} Letter{recipients.length !== 1 ? 's' : ''}
                </Button>
              </div>
            </div>
          </>
        )}

        {/* ── STEP: SENDING ────────────────────────────────────────────────── */}
        {step === 'sending' && (
          <div className="flex-1 flex flex-col items-center justify-center py-16 px-6 gap-4">
            <Loader2 className="w-10 h-10 text-blue-500 animate-spin" />
            <p className="text-base font-semibold text-slate-800">Sending {recipients.length} letters…</p>
            <p className="text-sm text-slate-400 text-center">
              Please wait — this may take a moment for large batches.
            </p>
          </div>
        )}

        {/* ── STEP: DONE ───────────────────────────────────────────────────── */}
        {step === 'done' && sendResult && (
          <>
            <div className="flex-1 overflow-y-auto px-6 py-8">
              <div className="text-center mb-6">
                <CheckCircle className="w-12 h-12 text-green-500 mx-auto mb-3" />
                <h3 className="text-lg font-bold text-slate-900">Campaign Complete</h3>
                <p className="text-sm text-slate-500 mt-1">
                  {sendResult.sent} letter{sendResult.sent !== 1 ? 's' : ''} sent successfully
                  {sendResult.failed > 0 && `, ${sendResult.failed} failed`}.
                </p>
              </div>

              <div className="grid grid-cols-3 gap-3 mb-6">
                <div className="bg-green-50 rounded-xl p-4 text-center">
                  <p className="text-2xl font-bold text-green-700">{sendResult.sent}</p>
                  <p className="text-xs text-green-600 mt-0.5">Sent</p>
                </div>
                <div className="bg-slate-50 rounded-xl p-4 text-center">
                  <p className="text-2xl font-bold text-slate-700">{sendResult.total}</p>
                  <p className="text-xs text-slate-500 mt-0.5">Total</p>
                </div>
                <div className={`${sendResult.failed > 0 ? 'bg-red-50' : 'bg-slate-50'} rounded-xl p-4 text-center`}>
                  <p className={`text-2xl font-bold ${sendResult.failed > 0 ? 'text-red-600' : 'text-slate-400'}`}>
                    {sendResult.failed}
                  </p>
                  <p className={`text-xs mt-0.5 ${sendResult.failed > 0 ? 'text-red-500' : 'text-slate-400'}`}>Failed</p>
                </div>
              </div>

              {sendResult.failed > 0 && (
                <div className="rounded-xl border border-red-100 bg-red-50 p-4">
                  <p className="text-xs font-semibold text-red-700 mb-2">Failed sends:</p>
                  <div className="space-y-1 max-h-32 overflow-y-auto">
                    {sendResult.results
                      .filter(r => r.status === 'failed')
                      .map((r, i) => {
                        const rec = recipients.find(p => p.contact_id === r.contact_id)
                        return (
                          <p key={i} className="text-xs text-red-600">
                            {rec?.name || `Contact #${r.contact_id}`}: {r.error}
                          </p>
                        )
                      })
                    }
                  </div>
                </div>
              )}
            </div>
            <div className="flex justify-end px-6 py-4 border-t border-slate-100">
              <Button onClick={onClose}>Done</Button>
            </div>
          </>
        )}

      </div>
    </div>
  )
}
