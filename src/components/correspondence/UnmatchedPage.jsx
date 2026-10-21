// /correspondence/unmatched — review queue of emails Claude couldn't confidently
// match to a deal/property. Assign to a deal/property (creates the thread link +
// timeline entry) or ignore.
import { useState, useEffect, useCallback, useRef } from 'react'
import { Inbox, Loader2, X, Mail } from 'lucide-react'
import { getUnmatched, assignUnmatched, getDeals, getAllProperties } from '../../api/client'

export default function UnmatchedPage() {
  const [items, setItems] = useState([])
  const [loading, setLoad] = useState(true)
  const [links, setLinks] = useState([])
  const [busy, setBusy]   = useState(null)

  const load = useCallback(() => {
    getUnmatched('pending').then(setItems).catch(console.error).finally(() => setLoad(false))
  }, [])
  useEffect(() => { load() }, [load])
  useEffect(() => {
    Promise.all([getDeals().catch(() => []), getAllProperties().catch(() => [])]).then(([deals, props]) => {
      const mk = (type, id, label, parts) => ({ type, id, label, search: parts.filter(Boolean).join(' ').toLowerCase() })
      setLinks([
        ...deals.map(d => mk('deal', d.id, d.address || d.title || d.tenant || `Deal #${d.id}`, [d.address, d.city, d.state, d.tenant, d.tenant_brand_name, d.title])),
        ...props.map(p => mk('property', p.id, p.address || p.display_name || `Property #${p.id}`, [p.address, p.city, p.state, p.display_name, p.tenant_brand_name])),
      ])
    })
  }, [])

  async function assign(id, link) {
    setBusy(id)
    try {
      await assignUnmatched(id, link.type === 'deal' ? { deal_id: link.id } : { property_id: link.id })
      setItems(prev => prev.filter(i => i.id !== id))
    } catch (e) { console.error(e) } finally { setBusy(null) }
  }
  async function ignore(id) {
    setBusy(id)
    try { await assignUnmatched(id, { ignore: true }); setItems(prev => prev.filter(i => i.id !== id)) }
    catch (e) { console.error(e) } finally { setBusy(null) }
  }

  return (
    <div className="flex-1 overflow-y-auto bg-slate-50">
      <div className="max-w-4xl mx-auto px-6 py-6 space-y-4">
        <div className="flex items-center gap-2.5">
          <Inbox className="w-6 h-6 text-blue-600" />
          <h1 className="text-xl font-bold text-slate-900">Unmatched correspondence</h1>
          <span className="text-sm text-slate-400">{items.length} to review</span>
        </div>
        <p className="text-sm text-slate-500">Emails Claude couldn't confidently match to a deal or property. Assign one to create the thread link and a timeline entry, or ignore it.</p>

        {loading ? (
          <div className="flex items-center justify-center py-20"><Loader2 className="w-6 h-6 text-slate-400 animate-spin" /></div>
        ) : items.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 gap-2">
            <Inbox className="w-8 h-8 text-emerald-500" />
            <p className="text-sm font-medium text-slate-700">Nothing to review</p>
            <p className="text-xs text-slate-400">All correspondence is matched.</p>
          </div>
        ) : (
          <ul className="space-y-3">
            {items.map(it => (
              <li key={it.id} className="bg-white rounded-2xl border border-slate-200 shadow-sm p-4">
                <div className="flex items-start gap-3">
                  <span className="w-8 h-8 rounded-full bg-sky-50 text-sky-600 flex items-center justify-center shrink-0"><Mail className="w-4 h-4" /></span>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-slate-900 truncate">{it.subject || it.summary || '(no subject)'}</p>
                    {it.summary && it.subject && <p className="text-xs text-slate-500 mt-0.5">{it.summary}</p>}
                    <p className="text-[11px] text-slate-400 mt-0.5">{it.from_address}{it.occurred_at ? ` · ${new Date(it.occurred_at).toLocaleDateString()}` : ''}</p>
                  </div>
                  <button onClick={() => ignore(it.id)} disabled={busy === it.id}
                    className="text-xs text-slate-400 hover:text-red-500 flex items-center gap-1 shrink-0"><X className="w-3.5 h-3.5" /> Ignore</button>
                </div>
                <div className="mt-3 pt-3 border-t border-slate-100">
                  <AssignPicker links={links} busy={busy === it.id} onAssign={link => assign(it.id, link)} />
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}

function AssignPicker({ links, onAssign, busy }) {
  const [q, setQ] = useState('')
  const [open, setOpen] = useState(false)
  const ref = useRef(null)
  useEffect(() => {
    const h = e => { if (ref.current && !ref.current.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', h); return () => document.removeEventListener('mousedown', h)
  }, [])
  const qq = q.trim().toLowerCase()
  const matches = (qq ? links.filter(l => l.search.includes(qq)) : links).slice(0, 8)
  return (
    <div className="relative flex items-center gap-2" ref={ref}>
      <span className="text-xs text-slate-500">Assign to</span>
      <input value={q} onChange={e => { setQ(e.target.value); setOpen(true) }} onFocus={() => setOpen(true)}
        disabled={busy} placeholder="deal or property…"
        className="flex-1 text-sm border border-slate-200 rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-300" />
      {busy && <Loader2 className="w-4 h-4 text-slate-400 animate-spin" />}
      {open && matches.length > 0 && (
        <div className="absolute left-16 top-full mt-1 z-20 bg-white border border-slate-200 rounded-lg shadow-lg py-1 w-72 max-h-56 overflow-y-auto">
          {matches.map(l => (
            <button key={`${l.type}-${l.id}`} onClick={() => { setOpen(false); onAssign(l) }}
              className="w-full text-left px-3 py-1.5 hover:bg-slate-50 flex items-center gap-2">
              <span className={`text-[9px] font-bold px-1 py-0.5 rounded shrink-0 ${l.type === 'deal' ? 'bg-blue-100 text-blue-700' : 'bg-emerald-100 text-emerald-700'}`}>{l.type === 'deal' ? 'DEAL' : 'PROP'}</span>
              <span className="truncate">{l.label}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
