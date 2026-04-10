import { useEffect, useState } from 'react'
import { X, Pencil, Phone, Mail, MapPin, FileText, Building2, AlertCircle, User, TrendingUp, Send, ChevronDown, ChevronUp, Trash2 } from 'lucide-react'
import { getPerson, getEmails, createEmail, deleteEmail } from '../../api/client'
import Button from '../ui/Button'
import Avatar from '../ui/Avatar'

const ROLE_LABELS = {
  owner:          'Owner',
  owner_company:  'Owner Company',
  broker:         'Broker',
  tenant_contact: 'Tenant Contact',
}
const ROLE_COLORS = {
  owner:          'bg-blue-50 text-blue-700',
  owner_company:  'bg-violet-50 text-violet-700',
  broker:         'bg-amber-50 text-amber-700',
  tenant_contact: 'bg-slate-100 text-slate-600',
}

function fmt$(v) {
  if (!v && v !== 0) return null
  if (v >= 1_000_000) return `$${(v / 1_000_000).toFixed(2)}M`
  return `$${Number(v).toLocaleString()}`
}

export default function PersonDetail({ personId, onClose, onEdit }) {
  const [data, setData]         = useState(null)
  const [emails, setEmails]     = useState([])
  const [expandedEmail, setExpandedEmail] = useState(null)
  const [logOpen, setLogOpen]   = useState(false)
  const [logForm, setLogForm]   = useState({ subject: '', body_preview: '', direction: 'outbound', date: new Date().toISOString().slice(0, 10) })
  const [saving, setSaving]     = useState(false)

  useEffect(() => {
    if (!personId) return
    setData(null)
    setEmails([])
    setLogOpen(false)
    setExpandedEmail(null)
    getPerson(personId).then(setData).catch(console.error)
    getEmails(personId).then(setEmails).catch(() => {})
  }, [personId])

  async function handleLogEmail(e) {
    e.preventDefault()
    setSaving(true)
    try {
      await createEmail({ ...logForm, person_id: personId, date: new Date(logForm.date).toISOString() })
      const updated = await getEmails(personId)
      setEmails(updated)
      setLogOpen(false)
      setLogForm({ subject: '', body_preview: '', direction: 'outbound', date: new Date().toISOString().slice(0, 10) })
    } catch (_) {}
    setSaving(false)
  }

  async function handleDeleteEmail(id) {
    if (!confirm('Delete this email log?')) return
    try {
      await deleteEmail(id)
      setEmails(prev => prev.filter(e => e.id !== id))
    } catch (_) {}
  }

  if (!data) return (
    <div className="fixed inset-y-0 right-0 w-[460px] bg-white border-l border-slate-200 shadow-2xl z-40 flex items-center justify-center">
      <div className="w-5 h-5 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
    </div>
  )

  const isPerson = ['owner', 'broker', 'tenant_contact'].includes(data.role)
  const avatarContact = isPerson
    ? { firstName: data.first_name || data.name.split(' ')[0], lastName: data.last_name || data.name.split(' ').slice(1).join(' ') }
    : { firstName: data.name.charAt(0), lastName: '' }

  return (
    <div className="fixed inset-y-0 right-0 w-[460px] bg-white border-l border-slate-200 shadow-2xl z-40 flex flex-col">

      {/* ── Header ──────────────────────────────────────────────── */}
      <div className="px-6 pt-5 pb-4 border-b border-slate-100 shrink-0">
        <div className="flex items-start gap-3">
          <Avatar contact={avatarContact} size="lg" />
          <div className="flex-1 min-w-0">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <h2 className="text-base font-bold text-slate-900 leading-snug">{data.name}</h2>
                <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                  <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${ROLE_COLORS[data.role]}`}>
                    {ROLE_LABELS[data.role]}
                  </span>
                  {data.owner_type && data.owner_type !== 'Individual' && (
                    <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${
                      data.owner_type === 'LLC'         ? 'bg-purple-50 text-purple-700' :
                      data.owner_type === 'Institution' ? 'bg-teal-50 text-teal-700' :
                      'bg-slate-100 text-slate-600'
                    }`}>{data.owner_type}</span>
                  )}
                  {data.sub_label && (
                    <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 capitalize">
                      {data.sub_label}
                    </span>
                  )}
                  {data.do_not_contact ? (
                    <span className="flex items-center gap-1 text-xs font-semibold text-red-700 bg-red-50 px-2 py-0.5 rounded-full">
                      <AlertCircle className="w-3 h-3" /> Do Not Contact
                    </span>
                  ) : null}
                </div>
                {data.company_name && (
                  <p className="text-xs text-slate-500 mt-1">@ {data.company_name}</p>
                )}
              </div>
              <div className="flex items-center gap-1 shrink-0">
                <Button variant="ghost" size="sm" onClick={onEdit}>
                  <Pencil className="w-3.5 h-3.5 mr-1" /> Edit
                </Button>
                <button onClick={onClose} className="w-8 h-8 rounded-lg flex items-center justify-center text-slate-400 hover:bg-slate-100">
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ── Body ────────────────────────────────────────────────── */}
      <div className="flex-1 overflow-y-auto">

        {/* Owner type */}
        <Section icon={User} title="Classification">
          <div className="flex items-center gap-3">
            <span className="text-xs text-slate-400 w-20 shrink-0">Owner type</span>
            <span className={`text-xs font-semibold px-2.5 py-1 rounded-full ${
              data.owner_type === 'LLC'         ? 'bg-purple-50 text-purple-700' :
              data.owner_type === 'Institution' ? 'bg-teal-50 text-teal-700' :
              'bg-slate-100 text-slate-600'
            }`}>{data.owner_type || 'Individual'}</span>
          </div>
        </Section>

        {/* Contact info */}
        <Section icon={Phone} title="Contact Info">
          <div className="space-y-2.5">
            {data.phone  && <ContactRow icon={Phone} label="Phone"   value={data.phone}  href={`tel:${data.phone}`} />}
            {data.mobile && <ContactRow icon={Phone} label="Mobile"  value={data.mobile} href={`tel:${data.mobile}`} />}
            {data.phone2 && <ContactRow icon={Phone} label="Phone 2" value={data.phone2} href={`tel:${data.phone2}`} />}
            {data.email  && <ContactRow icon={Mail}  label="Email"   value={data.email}  href={`mailto:${data.email}`} />}
            {data.email2 && <ContactRow icon={Mail}  label="Email 2" value={data.email2} href={`mailto:${data.email2}`} />}
            {!data.phone && !data.mobile && !data.phone2 && !data.email && !data.email2 && (
              <p className="text-sm text-slate-400 italic">No contact info on file</p>
            )}
          </div>
        </Section>

        {/* Primary address */}
        {data.address && (
          <Section icon={MapPin} title="Mailing Address">
            <Grid2>
              <Field label="Street" value={data.address} wide />
              <Field label="City"   value={data.city} />
              <Field label="State"  value={data.state} />
              <Field label="ZIP"    value={data.zip} />
            </Grid2>
          </Section>
        )}

        {/* Secondary address */}
        {data.address2 && (
          <Section icon={MapPin} title="Alt / Secondary Address">
            <Grid2>
              <Field label="Street" value={data.address2} wide />
              <Field label="City"   value={data.city2} />
              <Field label="State"  value={data.state2} />
              <Field label="ZIP"    value={data.zip2} />
            </Grid2>
          </Section>
        )}

        {/* Notes */}
        {data.notes && (
          <Section icon={FileText} title="Notes">
            <p className="text-sm text-slate-700 leading-relaxed whitespace-pre-line">{data.notes}</p>
          </Section>
        )}

        {/* Contacts within this company */}
        {data.contacts?.length > 0 && (
          <Section icon={User} title={`Contacts (${data.contacts.length})`}>
            <div className="space-y-1.5">
              {data.contacts.map(c => (
                <div key={c.id} className="flex items-start justify-between p-3 bg-slate-50 rounded-xl border border-slate-100">
                  <div>
                    <p className="text-sm font-semibold text-slate-800">{c.name}</p>
                    {c.phone   && <p className="text-xs text-slate-500 mt-0.5"><span className="font-medium">Ph:</span> {c.phone}</p>}
                    {c.mobile  && <p className="text-xs text-slate-500"><span className="font-medium">Mobile:</span> {c.mobile}</p>}
                    {c.email   && <a href={`mailto:${c.email}`} className="text-xs text-blue-600 hover:underline">{c.email}</a>}
                  </div>
                  <span className={`text-xs px-2 py-0.5 rounded-full shrink-0 ml-2 mt-0.5 ${ROLE_COLORS[c.role] || 'bg-slate-100 text-slate-600'}`}>
                    {ROLE_LABELS[c.role] || c.role}
                  </span>
                </div>
              ))}
            </div>
          </Section>
        )}

        {/* Properties owned */}
        {data.properties?.length > 0 && (
          <Section icon={Building2} title={`Properties (${data.properties.length})`}>
            <div className="space-y-2">
              {data.properties.map(p => (
                <div key={p.id} className="flex items-start justify-between gap-2 p-3 bg-slate-50 rounded-xl border border-slate-100">
                  <div className="min-w-0">
                    {p.tenant_brand_name && (
                      <span className="text-xs font-semibold text-blue-700 bg-blue-50 px-2 py-0.5 rounded-full">
                        {p.tenant_brand_name}
                      </span>
                    )}
                    <p className="text-sm font-medium text-slate-800 mt-1 leading-snug">{p.address}</p>
                    {(p.city || p.state) && (
                      <p className="text-xs text-slate-500">{[p.city, p.state].filter(Boolean).join(', ')}</p>
                    )}
                  </div>
                  <div className="text-right shrink-0">
                    {p.cap_rate && <p className="text-sm font-bold text-emerald-700">{p.cap_rate}% cap</p>}
                    {p.list_price && <p className="text-xs text-slate-500">{fmt$(p.list_price)}</p>}
                  </div>
                </div>
              ))}
            </div>
          </Section>
        )}

        {/* Email History */}
        <Section icon={Mail} title={`Email History${emails.length > 0 ? ` (${emails.length})` : ''}`}>
          <div className="space-y-2">
            {emails.length === 0 && (
              <p className="text-sm text-slate-400 italic">No email history</p>
            )}
            {emails.map(em => {
              const isExpanded = expandedEmail === em.id
              return (
                <div key={em.id} className="rounded-xl border border-slate-100 group">
                  {/* Header row — click to expand/collapse */}
                  <button
                    onClick={() => setExpandedEmail(isExpanded ? null : em.id)}
                    className={`w-full text-left p-3 flex items-start justify-between gap-2 rounded-xl transition-colors ${
                      isExpanded ? 'bg-white' : 'bg-slate-50 hover:bg-slate-100'
                    }`}
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className={`text-xs font-medium px-1.5 py-0.5 rounded shrink-0 ${
                          em.direction === 'inbound'  ? 'bg-blue-50 text-blue-600' :
                          em.direction === 'outbound' ? 'bg-emerald-50 text-emerald-600' :
                          'bg-slate-100 text-slate-500'
                        }`}>
                          {em.direction === 'inbound' ? 'Received' : em.direction === 'outbound' ? 'Sent' : 'Manual'}
                        </span>
                        <span className="text-xs text-slate-400 shrink-0">{fmtEmailDate(em.date)}</span>
                      </div>
                      <p className="text-sm font-medium text-slate-800 mt-1 truncate">{em.subject || '(no subject)'}</p>
                      {!isExpanded && em.body_preview && (
                        <p className="text-xs text-slate-500 mt-0.5 line-clamp-1">{em.body_preview}</p>
                      )}
                    </div>
                    <div className="flex items-center gap-1 shrink-0 mt-0.5">
                      {em.is_manual && (
                        <span
                          role="button"
                          onClick={(e) => { e.stopPropagation(); handleDeleteEmail(em.id) }}
                          className="opacity-0 group-hover:opacity-100 transition-opacity w-6 h-6 flex items-center justify-center text-slate-300 hover:text-red-500"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </span>
                      )}
                      {isExpanded
                        ? <ChevronUp className="w-3.5 h-3.5 text-slate-400" />
                        : <ChevronDown className="w-3.5 h-3.5 text-slate-400" />
                      }
                    </div>
                  </button>

                  {/* Expanded body */}
                  {isExpanded && (
                    <div className="px-3 pb-3 pt-2 border-t border-slate-100 bg-white rounded-b-xl">
                      <div className="space-y-0.5 mb-2">
                        {em.from_address && (
                          <p className="text-xs text-slate-500">
                            <span className="font-semibold">From:</span> {em.from_address}
                          </p>
                        )}
                        {em.to_address && (
                          <p className="text-xs text-slate-500">
                            <span className="font-semibold">To:</span> {em.to_address}
                          </p>
                        )}
                      </div>
                      {em.body_preview ? (
                        <div className="max-h-72 overflow-y-auto">
                          <p className="text-sm text-slate-700 whitespace-pre-wrap leading-relaxed">{em.body_preview}</p>
                        </div>
                      ) : (
                        <p className="text-xs text-slate-400 italic">No body content captured</p>
                      )}
                    </div>
                  )}
                </div>
              )
            })}

            {/* Log email button / form */}
            <button
              onClick={() => setLogOpen(v => !v)}
              className="flex items-center gap-1.5 text-xs text-blue-600 hover:text-blue-800 mt-1"
            >
              {logOpen ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
              Log an email
            </button>

            {logOpen && (
              <form onSubmit={handleLogEmail} className="space-y-2 pt-1">
                <div className="grid grid-cols-2 gap-2">
                  <select
                    value={logForm.direction}
                    onChange={e => setLogForm(f => ({ ...f, direction: e.target.value }))}
                    className="col-span-1 text-xs border border-slate-200 rounded-lg px-2 py-1.5 bg-white"
                  >
                    <option value="outbound">Sent</option>
                    <option value="inbound">Received</option>
                  </select>
                  <input
                    type="date"
                    value={logForm.date}
                    onChange={e => setLogForm(f => ({ ...f, date: e.target.value }))}
                    className="col-span-1 text-xs border border-slate-200 rounded-lg px-2 py-1.5"
                  />
                </div>
                <input
                  type="text"
                  placeholder="Subject"
                  value={logForm.subject}
                  onChange={e => setLogForm(f => ({ ...f, subject: e.target.value }))}
                  className="w-full text-xs border border-slate-200 rounded-lg px-2 py-1.5"
                />
                <textarea
                  placeholder="Notes / summary (optional)"
                  value={logForm.body_preview}
                  onChange={e => setLogForm(f => ({ ...f, body_preview: e.target.value }))}
                  rows={2}
                  className="w-full text-xs border border-slate-200 rounded-lg px-2 py-1.5 resize-none"
                />
                <div className="flex gap-2">
                  <button
                    type="submit"
                    disabled={saving}
                    className="flex items-center gap-1.5 text-xs bg-blue-600 text-white px-3 py-1.5 rounded-lg hover:bg-blue-700 disabled:opacity-50"
                  >
                    <Send className="w-3 h-3" /> {saving ? 'Saving...' : 'Save'}
                  </button>
                  <button
                    type="button"
                    onClick={() => setLogOpen(false)}
                    className="text-xs text-slate-500 hover:text-slate-700 px-2"
                  >
                    Cancel
                  </button>
                </div>
              </form>
            )}
          </div>
        </Section>

        <div className="h-8" />
      </div>
    </div>
  )
}

function fmtEmailDate(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
}

/* ── Sub-components ─────────────────────────────────────────── */

function Section({ icon: Icon, title, children }) {
  return (
    <div className="px-6 py-4 border-t border-slate-100">
      <div className="flex items-center gap-2 mb-3">
        <Icon className="w-3.5 h-3.5 text-slate-400" />
        <p className="text-xs font-semibold text-slate-400 uppercase tracking-widest">{title}</p>
      </div>
      {children}
    </div>
  )
}

function Grid2({ children }) {
  return <div className="grid grid-cols-2 gap-x-6 gap-y-3">{children}</div>
}

function Field({ label, value, wide }) {
  return (
    <div className={wide ? 'col-span-2' : ''}>
      <p className="text-xs text-slate-400 mb-0.5">{label}</p>
      {value
        ? <p className="text-sm font-medium text-slate-800">{value}</p>
        : <p className="text-sm text-slate-300">—</p>
      }
    </div>
  )
}

function ContactRow({ icon: Icon, label, value, href }) {
  return (
    <div className="flex items-center gap-3">
      <div className="w-7 h-7 rounded-lg bg-slate-100 flex items-center justify-center shrink-0">
        <Icon className="w-3.5 h-3.5 text-slate-500" />
      </div>
      <div className="min-w-0">
        <p className="text-xs text-slate-400">{label}</p>
        {href
          ? <a href={href} className="text-sm text-blue-600 hover:underline truncate block">{value}</a>
          : <p className="text-sm text-slate-800 truncate">{value}</p>
        }
      </div>
    </div>
  )
}
