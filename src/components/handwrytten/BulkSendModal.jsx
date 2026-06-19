import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { X, Mail, Loader2, CheckCircle, AlertCircle, ChevronRight, Users, Search, Ban, GitMerge, ExternalLink } from 'lucide-react'
import {
  getHandwryttenCards,
  getHandwryttenFonts,
  sendHandwryttenBulk,
  createHandwryttenDrip,
  getProperties,
  setPersonDNC,
  mergePeople,
} from '../../api/client'
import { useApp } from '../../context/AppContext'
import Button from '../ui/Button'
import PersonDetail from '../people/PersonDetail'

const DEFAULT_TEMPLATE =
  `{first_name}, Any chance you'd ever consider selling your {tenant} in {city}? ` +
  `I buy these around the country and figured it was worth reaching out directly. ` +
  `We're a small group, move quick, no brokers, no fluff. ` +
  `Even if you're just curious what it might be worth, I'm happy to run numbers. ` +
  `Call, text, or email anytime.`

const CHAR_MAX  = 500   // Handwrytten card limit (applies to the final, merged message + signature)
const SIG_SUFFIX = ' <sig:1427BC offset=1>'   // appended server-side to every letter
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
  const allSelected = selected.length === 0  // empty = "All"

  function toggle(s) {
    onChange(
      selected.includes(s) ? selected.filter(x => x !== s) : [...selected, s]
    )
  }

  return (
    <div className="border border-slate-200 rounded-xl overflow-hidden">
      <div className="flex items-center gap-2 px-3 py-2 border-b border-slate-100 bg-slate-50">
        {/* All toggle */}
        <label className="flex items-center gap-1.5 shrink-0 cursor-pointer">
          <input
            type="checkbox"
            checked={allSelected}
            onChange={() => onChange([])}
            className="accent-blue-600 w-3.5 h-3.5"
          />
          <span className={`text-xs font-semibold ${allSelected ? 'text-blue-700' : 'text-slate-500'}`}>All</span>
        </label>
        <span className="text-slate-200 shrink-0">|</span>
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

// ── Tenant combobox (searchable dropdown) ─────────────────────────────────────
function TenantCombobox({ tenantBrands, value, onChange }) {
  const [open, setOpen]   = useState(false)
  const [query, setQuery] = useState(value)
  const ref = useRef(null)

  // Close on outside click
  useEffect(() => {
    function handle(e) { if (ref.current && !ref.current.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', handle)
    return () => document.removeEventListener('mousedown', handle)
  }, [])

  // Keep local query in sync if parent clears value
  useEffect(() => { setQuery(value) }, [value])

  const filtered = tenantBrands.filter(t =>
    !query || t.name.toLowerCase().includes(query.toLowerCase())
  )

  function select(name) {
    setQuery(name); onChange(name); setOpen(false)
  }
  function handleInput(e) {
    setQuery(e.target.value); onChange(e.target.value); setOpen(true)
  }
  function clear() {
    setQuery(''); onChange(''); setOpen(false)
  }

  return (
    <div ref={ref} className="relative">
      <div className="relative flex items-center">
        <Search className="absolute left-3 w-3.5 h-3.5 text-slate-400 pointer-events-none" />
        <input
          type="text"
          value={query}
          onChange={handleInput}
          onFocus={() => setOpen(true)}
          placeholder="All tenants — type to search…"
          className="w-full pl-9 pr-8 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
        {query && (
          <button
            onClick={clear}
            className="absolute right-2.5 text-slate-400 hover:text-slate-600"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        )}
      </div>
      {open && (
        <div className="absolute z-20 mt-1 w-full bg-white border border-slate-200 rounded-xl shadow-lg max-h-52 overflow-y-auto">
          {/* "All tenants" option */}
          <button
            onMouseDown={e => e.preventDefault()}
            onClick={clear}
            className={`flex items-center w-full px-3 py-2 text-sm text-left hover:bg-slate-50 ${!query ? 'font-semibold text-blue-700 bg-blue-50' : 'text-slate-500'}`}
          >
            All tenants
          </button>
          {filtered.length === 0 ? (
            <p className="px-3 py-2 text-xs text-slate-400">No tenants match "{query}"</p>
          ) : (
            filtered.map(t => (
              <button
                key={t.id}
                onMouseDown={e => e.preventDefault()}
                onClick={() => select(t.name)}
                className={`flex items-center w-full px-3 py-2 text-sm text-left hover:bg-blue-50 hover:text-blue-800 ${
                  query === t.name ? 'bg-blue-50 text-blue-700 font-medium' : 'text-slate-700'
                }`}
              >
                {t.name}
              </button>
            ))
          )}
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
  const [breakdown,     setBreakdown]     = useState(null)   // diagnostic counts
  const [excluded,      setExcluded]      = useState(() => new Set()) // contact_ids skipped this round
  const [viewId,        setViewId]        = useState(null)   // open PersonDetail overlay
  const [dncBusy,       setDncBusy]       = useState(() => new Set())
  const [mergeMode,     setMergeMode]     = useState(false)
  const [mergeSel,      setMergeSel]      = useState(() => new Set())
  const [mergeKeep,     setMergeKeep]     = useState(null)   // chosen keeper during merge confirm
  const [merging,       setMerging]       = useState(false)

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

  // ── Drip (throttled send) state ──────────────────────────────────────────────
  const [sendMode,      setSendMode]      = useState('now')   // 'now' | 'drip'
  const [batchSize,     setBatchSize]     = useState(50)
  const [intervalDays,  setIntervalDays]  = useState(1)
  const [dripResult,    setDripResult]    = useState(null)

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
          (f.label || '').toLowerCase().includes('jokester') ||
          (f.label || '').toLowerCase().includes('jarrod') ||
          (f.label || '').toLowerCase().includes('jared')
        ) || fontList[0] || null
        setSelectedCard(defCard?.id ?? null)
        setSelectedFont(defFont?.label ?? null)
      })
      .catch(() => {})
      .finally(() => setLoadingMeta(false))
  }, [step, cards.length])

  // ── Build recipient list ───────────────────────────────────────────────────
  const buildRecipients = useCallback(async () => {
    setLoadingRec(true)
    try {
      // Fetch matching properties — paginate in batches to handle large datasets
      const BATCH = 2000
      const serverParams = { portfolio: '0', limit: BATCH, offset: 0 }
      if (filterTenant.trim()) serverParams.tenant = filterTenant.trim()

      const allRows = []
      while (true) {
        const { rows: batch, total } = await getProperties({ ...serverParams, offset: allRows.length })
        allRows.push(...batch)
        if (allRows.length >= total || batch.length === 0) break
      }

      let filtered = allRows

      // State filter — client-side (multi-select not supported server-side)
      if (filterStates.length > 0) {
        filtered = filtered.filter(p => filterStates.includes(p.state))
      }

      // Tenant was already filtered server-side above

      // Exclude properties flagged for ownership review
      const needsReviewCount = filtered.filter(p => p.needs_ownership_review).length
      filtered = filtered.filter(p => !p.needs_ownership_review)

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

      // ── Diagnostic breakdown ──────────────────────────────────────────────
      const totalFiltered  = filtered.length + needsReviewCount
      const noOwner        = filtered.filter(p => !p.owner_id).length
      const withOwner      = filtered.filter(p => !!p.owner_id)

      // Unique owners (dedup)
      const ownerFirstProp = {}
      for (const p of withOwner) {
        if (!ownerFirstProp[p.owner_id]) ownerFirstProp[p.owner_id] = p
      }
      const uniqueOwners    = Object.values(ownerFirstProp)
      const dedupRemoved    = withOwner.length - uniqueOwners.length
      const dncCount        = uniqueOwners.filter(p => p.owner_do_not_contact).length
      const withContact     = uniqueOwners.filter(p => !p.owner_do_not_contact)
      const noAddress       = withContact.filter(p => !p.owner_address || !p.owner_city || !p.owner_state).length
      const readyToSend     = withContact.length - noAddress

      setBreakdown({ totalFiltered, needsReviewCount, noOwner, dedupRemoved, dncCount, noAddress, readyToSend })

      // ── Build final list ──────────────────────────────────────────────────
      const seen = new Set()
      const list = []
      for (const p of filtered) {
        if (!p.owner_id) continue
        if (seen.has(p.owner_id)) continue
        if (p.owner_do_not_contact) continue   // never mail do-not-contact owners
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

  // Recipients actually getting mailed this round (excluded ones removed)
  const includedRecipients = useMemo(
    () => recipients.filter(r => !excluded.has(r.contact_id)),
    [recipients, excluded],
  )

  const toggleExcluded = (id) => setExcluded(prev => {
    const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n
  })

  async function markDNC(r) {
    setDncBusy(prev => new Set(prev).add(r.contact_id))
    try {
      await setPersonDNC(r.contact_id, true)
      // Drop them from the list entirely — DNC means never mail
      setRecipients(prev => prev.filter(x => x.contact_id !== r.contact_id))
    } catch (e) {
      alert(e.message)
    } finally {
      setDncBusy(prev => { const n = new Set(prev); n.delete(r.contact_id); return n })
    }
  }

  const toggleMergeSel = (id) => setMergeSel(prev => {
    const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n
  })

  async function doMerge() {
    if (!mergeKeep || mergeSel.size < 2) return
    setMerging(true)
    try {
      const mergeIds = [...mergeSel].filter(id => id !== mergeKeep)
      await mergePeople(mergeKeep, mergeIds)
      // Remove the merged-away rows from the list (the keeper stays)
      const removed = new Set(mergeIds)
      setRecipients(prev => prev.filter(r => !removed.has(r.contact_id)))
      setMergeSel(new Set()); setMergeKeep(null); setMergeMode(false)
    } catch (e) {
      alert(e.message)
    } finally {
      setMerging(false)
    }
  }

  // ── Send ───────────────────────────────────────────────────────────────────
  async function handleSend() {
    setStep('sending')
    setSending(true)
    setSendError(null)
    try {
      const result = await sendHandwryttenBulk({
        recipients: includedRecipients.map(r => ({ contact_id: r.contact_id, property_id: r.property_id })),
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

  async function handleScheduleDrip() {
    setSending(true)
    setSendError(null)
    try {
      const result = await createHandwryttenDrip({
        name:          filterTenant.trim() || (filterStates.length ? filterStates.join('/') : 'Mail campaign'),
        recipients:    includedRecipients.map(r => ({ contact_id: r.contact_id, property_id: r.property_id })),
        message,
        card_id:       selectedCard,
        font:          selectedFont,
        batch_size:    Math.max(1, parseInt(batchSize, 10) || 50),
        interval_days: Math.max(1, parseInt(intervalDays, 10) || 1),
        filters:       { states: filterStates, tenant: filterTenant, ownerTypes: filterOwnerTypes },
      })
      setDripResult(result)
      setStep('done')
      onDone?.()
    } catch (err) {
      setSendError(err.message)
      setStep('preview')
    } finally {
      setSending(false)
    }
  }

  // The real limit applies to the FINAL message: merge fields expanded + signature.
  // Compute the worst-case length across recipients so no single letter exceeds 500.
  const { finalMaxLen, overBy } = useMemo(() => {
    const sample = recipients.slice(0, 1000)
    const lengths = sample.length
      ? sample.map(r => applyMerge(message, r, {
          tenant_brand_name: r.tenant, city: r.property_city, state: r.property_state,
        }).length + SIG_SUFFIX.length)
      : [message.length + SIG_SUFFIX.length]
    const max = Math.max(...lengths)
    return { finalMaxLen: max, overBy: Math.max(0, max - CHAR_MAX) }
  }, [message, recipients])

  const overLimit = finalMaxLen > CHAR_MAX

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

              {/* Tenant searchable dropdown */}
              <div>
                <label className="block text-xs font-semibold text-slate-600 uppercase tracking-wide mb-1.5">
                  Tenant
                  {filterTenant && <span className="ml-1 text-blue-600 normal-case font-normal">({filterTenant})</span>}
                </label>
                <TenantCombobox
                  tenantBrands={tenantBrands}
                  value={filterTenant}
                  onChange={setFilterTenant}
                />
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

              {/* Diagnostic breakdown */}
              {breakdown && (
                <div className="rounded-xl border border-slate-200 overflow-hidden text-xs">
                  <div className="bg-slate-50 px-3 py-2 font-semibold text-slate-600 uppercase tracking-wide">
                    Recipient Breakdown
                  </div>
                  <div className="divide-y divide-slate-100">
                    <div className="flex justify-between items-center px-3 py-2">
                      <span className="text-slate-600">Properties matching filters</span>
                      <span className="font-bold text-slate-800">{breakdown.totalFiltered.toLocaleString()}</span>
                    </div>
                    {breakdown.needsReviewCount > 0 && (
                      <div className="flex justify-between items-center px-3 py-2 bg-amber-50">
                        <span className="text-amber-700">− Ownership needs review (recently sold)</span>
                        <span className="font-semibold text-amber-600">−{breakdown.needsReviewCount.toLocaleString()}</span>
                      </div>
                    )}
                    <div className="flex justify-between items-center px-3 py-2">
                      <span className="text-slate-500">− No owner linked in database</span>
                      <span className={`font-semibold ${breakdown.noOwner > 0 ? 'text-amber-600' : 'text-slate-400'}`}>
                        {breakdown.noOwner > 0 ? `−${breakdown.noOwner.toLocaleString()}` : '0'}
                      </span>
                    </div>
                    <div className="flex justify-between items-center px-3 py-2">
                      <span className="text-slate-500">− Same owner, multiple properties (deduped)</span>
                      <span className="font-semibold text-slate-400">
                        {breakdown.dedupRemoved > 0 ? `−${breakdown.dedupRemoved.toLocaleString()}` : '0'}
                      </span>
                    </div>
                    <div className="flex justify-between items-center px-3 py-2">
                      <span className="text-slate-500">− Owner on do-not-contact list</span>
                      <span className={`font-semibold ${breakdown.dncCount > 0 ? 'text-amber-600' : 'text-slate-400'}`}>
                        {breakdown.dncCount > 0 ? `−${breakdown.dncCount.toLocaleString()}` : '0'}
                      </span>
                    </div>
                    <div className="flex justify-between items-center px-3 py-2">
                      <span className="text-slate-500">− Owner missing mailing address</span>
                      <span className={`font-semibold ${breakdown.noAddress > 0 ? 'text-amber-600' : 'text-slate-400'}`}>
                        {breakdown.noAddress > 0 ? `−${breakdown.noAddress.toLocaleString()}` : '0'}
                      </span>
                    </div>
                    <div className="flex justify-between items-center px-3 py-2 bg-blue-50">
                      <span className="font-semibold text-blue-800">= Letters ready to send</span>
                      <span className="font-bold text-blue-700 text-sm">{breakdown.readyToSend.toLocaleString()}</span>
                    </div>
                  </div>
                </div>
              )}

              {/* Recipient list */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <h3 className="text-sm font-semibold text-slate-800 flex items-center gap-1.5">
                    <Users className="w-4 h-4 text-slate-400" />
                    Recipients
                    <span className="font-normal text-slate-400">
                      ({includedRecipients.length}{excluded.size > 0 ? ` of ${recipients.length}` : ''} mailing)
                    </span>
                  </h3>
                  <div className="flex items-center gap-3">
                    <span className="text-xs text-slate-500">
                      Est. cost: ${(includedRecipients.length * COST_LOW).toFixed(0)}–${(includedRecipients.length * COST_HIGH).toFixed(0)}
                    </span>
                    {recipients.length > 0 && (
                      <button
                        onClick={() => { setMergeMode(m => !m); setMergeSel(new Set()); setMergeKeep(null) }}
                        className={`flex items-center gap-1 text-xs font-medium px-2 py-1 rounded-lg border transition-colors ${
                          mergeMode ? 'bg-violet-50 text-violet-700 border-violet-200' : 'text-slate-500 border-slate-200 hover:bg-slate-50'
                        }`}
                      >
                        <GitMerge className="w-3.5 h-3.5" /> {mergeMode ? 'Done merging' : 'Merge duplicates'}
                      </button>
                    )}
                  </div>
                </div>

                {/* Merge action bar */}
                {mergeMode && mergeSel.size >= 2 && (
                  <div className="mb-2 rounded-xl border border-violet-200 bg-violet-50 px-3 py-2.5 text-xs">
                    <p className="font-semibold text-violet-800 mb-1.5">Merge {mergeSel.size} into one — keep:</p>
                    <div className="space-y-1 max-h-28 overflow-y-auto">
                      {recipients.filter(r => mergeSel.has(r.contact_id)).map(r => (
                        <label key={r.contact_id} className="flex items-center gap-2 cursor-pointer">
                          <input type="radio" name="mergeKeep" checked={mergeKeep === r.contact_id}
                            onChange={() => setMergeKeep(r.contact_id)} className="accent-violet-600" />
                          <span className="text-slate-700">{r.name}</span>
                        </label>
                      ))}
                    </div>
                    <div className="flex items-center gap-2 mt-2">
                      <Button size="sm" onClick={doMerge} disabled={!mergeKeep || merging}>
                        {merging ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Merging…</> : 'Merge'}
                      </Button>
                      <button onClick={() => { setMergeSel(new Set()); setMergeKeep(null) }} className="text-slate-500 hover:text-slate-700">Clear</button>
                    </div>
                    <p className="text-[11px] text-violet-600 mt-1.5">The others' properties, mail history & contacts move onto the kept record, then they're deleted.</p>
                  </div>
                )}

                {recipients.length === 0 ? (
                  <div className="rounded-xl border border-slate-200 p-6 text-center">
                    <p className="text-sm text-slate-400">No owners with a complete mailing address match these filters.</p>
                    <button onClick={() => setStep('filters')} className="text-xs text-blue-600 hover:underline mt-2">
                      Adjust filters
                    </button>
                  </div>
                ) : (
                  <div className="rounded-xl border border-slate-200 divide-y divide-slate-100 max-h-56 overflow-y-auto">
                    {recipients.map((r) => {
                      const isExcluded = excluded.has(r.contact_id)
                      const busy = dncBusy.has(r.contact_id)
                      return (
                      <div key={r.contact_id} className={`flex items-center gap-2 px-3 py-2 ${isExcluded ? 'opacity-40' : ''}`}>
                        {/* Include / merge-select checkbox */}
                        <input
                          type="checkbox"
                          checked={mergeMode ? mergeSel.has(r.contact_id) : !isExcluded}
                          onChange={() => mergeMode ? toggleMergeSel(r.contact_id) : toggleExcluded(r.contact_id)}
                          className={`w-4 h-4 rounded shrink-0 cursor-pointer ${mergeMode ? 'accent-violet-600' : 'accent-blue-600'}`}
                          title={mergeMode ? 'Select to merge' : 'Include in this mailing'}
                        />
                        <div className="min-w-0 flex-1">
                          <button
                            onClick={() => setViewId(r.contact_id)}
                            className="text-sm font-medium text-slate-800 truncate hover:text-blue-600 hover:underline flex items-center gap-1 max-w-full"
                            title="View full contact info"
                          >
                            <span className="truncate">{r.name}</span>
                            <ExternalLink className="w-3 h-3 text-slate-300 shrink-0" />
                          </button>
                          <p className="text-xs text-slate-400 truncate">
                            {[r.address, r.city, r.state].filter(Boolean).join(', ')}
                          </p>
                        </div>
                        {r.tenant && (
                          <span className="shrink-0 text-xs font-semibold bg-blue-50 text-blue-700 px-2 py-0.5 rounded-full">
                            {r.tenant}
                          </span>
                        )}
                        {!mergeMode && (
                          <button
                            onClick={() => markDNC(r)}
                            disabled={busy}
                            className="shrink-0 flex items-center gap-1 text-xs font-medium text-red-600 px-2 py-1 rounded-lg border border-red-200 hover:bg-red-50 transition-colors disabled:opacity-50"
                            title="Mark Do Not Contact — removes them from mailings permanently"
                          >
                            {busy ? <Loader2 className="w-3 h-3 animate-spin" /> : <Ban className="w-3 h-3" />} DNC
                          </button>
                        )}
                      </div>
                      )
                    })}
                  </div>
                )}
              </div>

              {/* Message template */}
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="text-xs font-semibold text-slate-600 uppercase tracking-wide">Message Template</label>
                  <span className={`text-xs font-medium ${overLimit ? 'text-red-600' : finalMaxLen > CHAR_MAX - 40 ? 'text-amber-600' : 'text-slate-400'}`}>
                    {finalMaxLen}/{CHAR_MAX} sent
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
                {overLimit ? (
                  <div className="mt-1.5 flex items-start gap-1.5 text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg px-2.5 py-1.5">
                    <AlertCircle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                    <span><span className="font-semibold">{overBy} character{overBy !== 1 ? 's' : ''} over the 500 limit.</span> This counts the longest letter once names, tenant, city and the signature are filled in. Trim about {overBy} characters to send.</span>
                  </div>
                ) : (
                  <p className="text-[11px] text-slate-400 mt-1">
                    Counts the longest letter with merge fields and signature filled in. Limit is 500 (Handwrytten card max).
                  </p>
                )}
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
                        {fonts.map(f => <option key={f.label ?? f.id} value={f.label}>{f.label}</option>)}
                      </select>
                    </div>
                  )}
                </>
              )}

              {/* Signature */}
              <div>
                <label className="text-xs font-semibold text-slate-600 uppercase tracking-wide mb-1.5 block">Signature (from)</label>
                <div className="px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm text-slate-700">
                  Brad Cottam
                </div>
                <p className="text-xs text-slate-400 mt-1">This is the name that appears as the sender on every letter.</p>
              </div>

              {/* Send mode: all-at-once vs throttled drip */}
              <div>
                <label className="text-xs font-semibold text-slate-600 uppercase tracking-wide mb-2 block">Sending</label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    onClick={() => setSendMode('now')}
                    className={`text-left rounded-xl border-2 px-3 py-2.5 transition-all ${
                      sendMode === 'now' ? 'border-blue-500 bg-blue-50' : 'border-slate-200 hover:border-slate-300'
                    }`}
                  >
                    <p className="text-sm font-semibold text-slate-800">Send all now</p>
                    <p className="text-xs text-slate-500">All {includedRecipients.length} go out today</p>
                  </button>
                  <button
                    onClick={() => setSendMode('drip')}
                    className={`text-left rounded-xl border-2 px-3 py-2.5 transition-all ${
                      sendMode === 'drip' ? 'border-blue-500 bg-blue-50' : 'border-slate-200 hover:border-slate-300'
                    }`}
                  >
                    <p className="text-sm font-semibold text-slate-800">Drip over time</p>
                    <p className="text-xs text-slate-500">Spread out automatically</p>
                  </button>
                </div>

                {sendMode === 'drip' && (
                  <div className="mt-3 rounded-xl border border-slate-200 bg-slate-50 px-3 py-3">
                    <div className="flex flex-wrap items-center gap-2 text-sm text-slate-700">
                      <span>Send</span>
                      <input
                        type="number" min="1" value={batchSize}
                        onChange={e => setBatchSize(e.target.value)}
                        className="w-16 text-sm text-center border border-slate-300 rounded-lg px-2 py-1 focus:outline-none focus:ring-2 focus:ring-blue-500"
                      />
                      <span>letter{batchSize == 1 ? '' : 's'} every</span>
                      <input
                        type="number" min="1" value={intervalDays}
                        onChange={e => setIntervalDays(e.target.value)}
                        className="w-16 text-sm text-center border border-slate-300 rounded-lg px-2 py-1 focus:outline-none focus:ring-2 focus:ring-blue-500"
                      />
                      <span>day{intervalDays == 1 ? '' : 's'} until complete.</span>
                    </div>
                    {includedRecipients.length > 0 && batchSize >= 1 && intervalDays >= 1 && (
                      <p className="text-xs text-slate-500 mt-2">
                        {includedRecipients.length} letters → ~{Math.ceil(includedRecipients.length / Math.max(1, batchSize))} batch{Math.ceil(includedRecipients.length / Math.max(1, batchSize)) !== 1 ? 'es' : ''} over about{' '}
                        <span className="font-semibold text-slate-700">
                          {(Math.ceil(includedRecipients.length / Math.max(1, batchSize)) - 1) * Math.max(1, intervalDays)} day{(Math.ceil(includedRecipients.length / Math.max(1, batchSize)) - 1) * Math.max(1, intervalDays) !== 1 ? 's' : ''}
                        </span>. First batch goes out immediately. Pause, resume, or cancel anytime from Campaigns.
                      </p>
                    )}
                  </div>
                )}
              </div>

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
                  {includedRecipients.length} letters · est. ${(includedRecipients.length * COST_LOW).toFixed(0)}–${(includedRecipients.length * COST_HIGH).toFixed(0)}
                </span>
                {sendMode === 'drip' ? (
                  <Button onClick={handleScheduleDrip} disabled={includedRecipients.length === 0 || overLimit || sending}>
                    {sending ? <><Loader2 className="w-4 h-4 animate-spin" /> Scheduling…</> : <><Mail className="w-4 h-4" /> Start Drip ({batchSize}/{intervalDays}d)</>}
                  </Button>
                ) : (
                  <Button onClick={handleSend} disabled={includedRecipients.length === 0 || overLimit}>
                    <Mail className="w-4 h-4" /> Send {includedRecipients.length} Letter{includedRecipients.length !== 1 ? 's' : ''}
                  </Button>
                )}
              </div>
            </div>
          </>
        )}

        {/* ── STEP: SENDING ────────────────────────────────────────────────── */}
        {step === 'sending' && (
          <div className="flex-1 flex flex-col items-center justify-center py-16 px-6 gap-4">
            <Loader2 className="w-10 h-10 text-blue-500 animate-spin" />
            <p className="text-base font-semibold text-slate-800">Sending {includedRecipients.length} letters…</p>
            <p className="text-sm text-slate-400 text-center">
              Please wait — this may take a moment for large batches.
            </p>
          </div>
        )}

        {/* ── STEP: DONE (drip scheduled) ──────────────────────────────────── */}
        {step === 'done' && dripResult && (
          <>
            <div className="flex-1 overflow-y-auto px-6 py-8 text-center">
              <CheckCircle className="w-12 h-12 text-green-500 mx-auto mb-3" />
              <h3 className="text-lg font-bold text-slate-900">Drip Campaign Started</h3>
              <p className="text-sm text-slate-500 mt-1 max-w-sm mx-auto">
                {dripResult.total.toLocaleString()} letters queued — sending {dripResult.batch_size} every {dripResult.interval_days} day{dripResult.interval_days !== 1 ? 's' : ''}.
                The first batch is going out now.
              </p>
              {dripResult.removed_dnc > 0 && (
                <p className="text-xs text-amber-600 mt-2">
                  {dripResult.removed_dnc} do-not-contact or duplicate recipient{dripResult.removed_dnc !== 1 ? 's were' : ' was'} skipped.
                </p>
              )}
              <p className="text-xs text-slate-400 mt-4">
                Track progress, pause, resume, or cancel from the Campaigns page.
              </p>
            </div>
            <div className="flex justify-end px-6 py-4 border-t border-slate-100">
              <Button onClick={onClose}>Done</Button>
            </div>
          </>
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

      {/* Full contact info — opens above the campaign modal */}
      {viewId && (
        <div className="fixed inset-0 z-[60]">
          <div className="absolute inset-0 bg-black/40" onClick={() => setViewId(null)} />
          <PersonDetail personId={viewId} onClose={() => setViewId(null)} onEdit={() => setViewId(null)} />
        </div>
      )}
    </div>
  )
}
