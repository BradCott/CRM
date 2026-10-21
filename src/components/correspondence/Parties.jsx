// Deal/property parties — contacts (from People) with a role. Reusable on the
// deal page and property pages.
import { useState, useEffect, useCallback, useRef } from 'react'
import { Users, Plus, X, Loader2, Mail, Phone } from 'lucide-react'
import { getDealParties, addDealParty, removeDealParty, getAllPeople } from '../../api/client'

const ROLES = [
  'listing broker', 'buyer broker', 'title', 'lender', 'attorney',
  'tenant contact', 'contractor', 'property manager',
]

export default function Parties({ dealId, propertyId }) {
  const [parties, setParties] = useState([])
  const [people, setPeople]   = useState([])
  const [loading, setLoad]    = useState(true)
  const [adding, setAdding]   = useState(false)
  const [q, setQ]             = useState('')
  const [picked, setPicked]   = useState(null)
  const [role, setRole]       = useState(ROLES[0])
  const [open, setOpen]       = useState(false)
  const ref = useRef(null)

  const params = dealId ? { deal_id: dealId } : propertyId ? { property_id: propertyId } : null

  const load = useCallback(() => {
    if (!params) { setLoad(false); return }
    getDealParties(params).then(setParties).catch(console.error).finally(() => setLoad(false))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dealId, propertyId])
  useEffect(() => { load() }, [load])
  useEffect(() => { getAllPeople().then(setPeople).catch(() => {}) }, [])
  useEffect(() => {
    const h = e => { if (ref.current && !ref.current.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', h); return () => document.removeEventListener('mousedown', h)
  }, [])

  const matches = q.trim()
    ? people.filter(p => `${p.name || ''} ${p.email || ''}`.toLowerCase().includes(q.trim().toLowerCase())).slice(0, 8)
    : []

  async function add() {
    if (!picked || !params) return
    const party = await addDealParty({ ...params, person_id: picked.id, role })
    // addDealParty returns the raw row; refetch for the joined name/email
    setParties(prev => [...prev, { ...party, person_name: picked.name, person_email: picked.email }])
    setPicked(null); setQ(''); setAdding(false)
  }
  async function remove(id) {
    await removeDealParty(id)
    setParties(prev => prev.filter(p => p.id !== id))
  }

  return (
    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
      <div className="flex items-center justify-between px-5 py-3.5 border-b border-slate-100">
        <div className="flex items-center gap-2">
          <Users className="w-4 h-4 text-slate-400" />
          <h2 className="text-sm font-bold text-slate-800">Parties</h2>
          <span className="text-xs text-slate-400">{parties.length}</span>
        </div>
        <button onClick={() => setAdding(a => !a)} className="p-1 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100"><Plus className="w-4 h-4" /></button>
      </div>

      {adding && (
        <div className="px-5 py-3 border-b border-slate-100 bg-slate-50 flex items-center gap-2 flex-wrap">
          <div className="relative flex-1 min-w-[160px]" ref={ref}>
            <input
              value={picked ? picked.name : q}
              onChange={e => { setPicked(null); setQ(e.target.value); setOpen(true) }}
              onFocus={() => setOpen(true)}
              placeholder="Search contacts…"
              className="w-full text-sm border border-slate-200 rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-300" />
            {open && matches.length > 0 && !picked && (
              <div className="absolute left-0 top-full mt-1 z-20 bg-white border border-slate-200 rounded-lg shadow-lg py-1 w-full max-h-52 overflow-y-auto">
                {matches.map(p => (
                  <button key={p.id} onClick={() => { setPicked(p); setOpen(false) }}
                    className="w-full text-left px-3 py-1.5 hover:bg-slate-50">
                    <span className="text-sm text-slate-800">{p.name}</span>
                    {p.email && <span className="text-xs text-slate-400 ml-1">{p.email}</span>}
                  </button>
                ))}
              </div>
            )}
          </div>
          <select value={role} onChange={e => setRole(e.target.value)} className="text-sm border border-slate-200 rounded-lg px-2 py-1.5 capitalize">
            {ROLES.map(r => <option key={r} value={r}>{r}</option>)}
          </select>
          <button onClick={add} disabled={!picked} className="text-xs font-semibold text-white bg-blue-600 px-3 py-1.5 rounded-lg hover:bg-blue-700 disabled:opacity-40">Add</button>
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-8"><Loader2 className="w-5 h-5 text-slate-400 animate-spin" /></div>
      ) : parties.length === 0 ? (
        <p className="px-5 py-6 text-sm text-slate-400 text-center">No parties yet.</p>
      ) : (
        <ul className="divide-y divide-slate-50">
          {parties.map(p => (
            <li key={p.id} className="flex items-center gap-3 px-5 py-2.5 group">
              <div className="min-w-0 flex-1">
                <p className="text-sm text-slate-800 truncate">{p.person_name}</p>
                <div className="flex items-center gap-3 text-[11px] text-slate-400">
                  {p.person_email && <span className="inline-flex items-center gap-1 truncate"><Mail className="w-3 h-3" />{p.person_email}</span>}
                  {p.person_phone && <span className="inline-flex items-center gap-1"><Phone className="w-3 h-3" />{p.person_phone}</span>}
                </div>
              </div>
              {p.role && <span className="text-[11px] font-medium text-slate-600 bg-slate-100 px-2 py-0.5 rounded-full capitalize shrink-0">{p.role}</span>}
              <button onClick={() => remove(p.id)} className="p-1 rounded text-slate-300 hover:text-red-500 opacity-0 group-hover:opacity-100 shrink-0"><X className="w-3.5 h-3.5" /></button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
