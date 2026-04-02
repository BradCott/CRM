import { useState, useMemo } from 'react'
import { UserPlus, ChevronUp, ChevronDown, MoreHorizontal, Pencil, Trash2, Users, Loader2 } from 'lucide-react'
import { useApp } from '../../context/AppContext'
import TopBar from '../layout/TopBar'
import Button from '../ui/Button'
import Avatar from '../ui/Avatar'
import Modal from '../ui/Modal'
import ConfirmDialog from '../ui/ConfirmDialog'
import EmptyState from '../ui/EmptyState'
import ContactForm from './ContactForm'
import ContactDetail from './ContactDetail'
import { getFullName } from '../../utils/formatters'

export default function ContactsPage() {
  const { contacts, addContact, editContact, removeContact, loading } = useApp()
  const [search, setSearch]             = useState('')
  const [sortKey, setSortKey]           = useState('last_name')
  const [sortDir, setSortDir]           = useState('asc')
  const [showForm, setShowForm]         = useState(false)
  const [editTarget, setEditTarget]     = useState(null)
  const [deleteTarget, setDeleteTarget] = useState(null)
  const [detailContact, setDetailContact] = useState(null)
  const [openMenu, setOpenMenu]         = useState(null)

  const filtered = useMemo(() => {
    const q = search.toLowerCase()
    return contacts
      .filter(c => !q ||
        getFullName({ firstName: c.first_name, lastName: c.last_name }).toLowerCase().includes(q) ||
        c.email?.toLowerCase().includes(q) ||
        c.owner_name?.toLowerCase().includes(q) ||
        c.title?.toLowerCase().includes(q)
      )
      .sort((a, b) => {
        let av = '', bv = ''
        if (sortKey === 'name') { av = getFullName({ firstName: a.first_name, lastName: a.last_name }); bv = getFullName({ firstName: b.first_name, lastName: b.last_name }) }
        else { av = a[sortKey] || ''; bv = b[sortKey] || '' }
        const cmp = String(av).localeCompare(String(bv))
        return sortDir === 'asc' ? cmp : -cmp
      })
  }, [contacts, search, sortKey, sortDir])

  const handleSort = (key) => {
    if (sortKey === key) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortKey(key); setSortDir('asc') }
  }

  const SortIcon = ({ col }) => sortKey === col
    ? (sortDir === 'asc' ? <ChevronUp className="w-3.5 h-3.5 text-blue-500" /> : <ChevronDown className="w-3.5 h-3.5 text-blue-500" />)
    : <ChevronUp className="w-3.5 h-3.5 text-slate-300" />

  const Th = ({ col, label }) => (
    <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wide cursor-pointer hover:text-slate-700 select-none" onClick={() => handleSort(col)}>
      <div className="flex items-center gap-1">{label}<SortIcon col={col} /></div>
    </th>
  )

  const handleSave = async (data) => {
    if (editTarget) await editContact(editTarget.id, data)
    else await addContact(data)
  }

  if (loading) return (
    <div className="flex-1 flex items-center justify-center">
      <Loader2 className="w-6 h-6 text-slate-400 animate-spin" />
    </div>
  )

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <TopBar
        title={`Contacts${contacts.length > 0 ? ` (${contacts.length})` : ''}`}
        onSearch={setSearch}
        searchPlaceholder="Search contacts…"
        actions={
          <Button onClick={() => { setEditTarget(null); setShowForm(true) }}>
            <UserPlus className="w-4 h-4" /> New contact
          </Button>
        }
      />

      <div className="flex-1 overflow-auto p-6 scrollbar-thin">
        {contacts.length === 0 ? (
          <EmptyState icon={Users} title="No contacts yet" description="Import from Salesforce or add contacts manually." action="New contact" onAction={() => setShowForm(true)} />
        ) : filtered.length === 0 ? (
          <EmptyState icon={Users} title="No results" description={`No contacts match "${search}"`} />
        ) : (
          <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 border-b border-slate-200">
                <tr>
                  <Th col="name" label="Name" />
                  <Th col="title" label="Title" />
                  <Th col="owner_name" label="Owner / Company" />
                  <Th col="email" label="Email" />
                  <Th col="phone" label="Phone" />
                  <th className="w-12" />
                </tr>
              </thead>
              <tbody>
                {filtered.map((c, i) => (
                  <tr
                    key={c.id}
                    className={`border-b border-slate-100 last:border-0 hover:bg-blue-50/40 transition-colors cursor-pointer ${i % 2 === 0 ? 'bg-white' : 'bg-slate-50/50'}`}
                    onClick={() => setDetailContact(c)}
                  >
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        <Avatar contact={{ firstName: c.first_name, lastName: c.last_name }} size="sm" />
                        <span className="font-medium text-slate-900">{getFullName({ firstName: c.first_name, lastName: c.last_name })}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-slate-600">{c.title || <span className="text-slate-300">—</span>}</td>
                    <td className="px-4 py-3 text-slate-600">{c.owner_name || <span className="text-slate-300">—</span>}</td>
                    <td className="px-4 py-3">
                      {c.email
                        ? <a href={`mailto:${c.email}`} className="text-blue-600 hover:underline" onClick={e => e.stopPropagation()}>{c.email}</a>
                        : <span className="text-slate-300">—</span>
                      }
                    </td>
                    <td className="px-4 py-3 text-slate-600">{c.phone || <span className="text-slate-300">—</span>}</td>
                    <td className="px-4 py-3" onClick={e => e.stopPropagation()}>
                      <div className="relative">
                        <button className="w-8 h-8 rounded-lg flex items-center justify-center text-slate-400 hover:bg-slate-100" onClick={() => setOpenMenu(openMenu === c.id ? null : c.id)}>
                          <MoreHorizontal className="w-4 h-4" />
                        </button>
                        {openMenu === c.id && (
                          <div className="absolute right-0 top-9 w-40 bg-white border border-slate-200 rounded-xl shadow-lg z-10 py-1 text-sm">
                            <button className="flex items-center gap-2 w-full px-3 py-2 text-slate-700 hover:bg-slate-50" onClick={() => { setEditTarget(c); setShowForm(true); setOpenMenu(null) }}>
                              <Pencil className="w-3.5 h-3.5" /> Edit
                            </button>
                            <button className="flex items-center gap-2 w-full px-3 py-2 text-red-600 hover:bg-red-50" onClick={() => { setDeleteTarget(c); setOpenMenu(null) }}>
                              <Trash2 className="w-3.5 h-3.5" /> Delete
                            </button>
                          </div>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <Modal isOpen={showForm} onClose={() => { setShowForm(false); setEditTarget(null) }} title={editTarget ? 'Edit contact' : 'New contact'}>
        <ContactForm contact={editTarget} onSave={handleSave} onClose={() => { setShowForm(false); setEditTarget(null) }} />
      </Modal>

      <ConfirmDialog
        isOpen={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={() => removeContact(deleteTarget.id)}
        title="Delete contact?"
        message={`"${deleteTarget ? getFullName({ firstName: deleteTarget.first_name, lastName: deleteTarget.last_name }) : ''}" will be permanently deleted.`}
      />

      {detailContact && (
        <>
          <div className="fixed inset-0 z-30" onClick={() => setDetailContact(null)} />
          <ContactDetail
            contact={contacts.find(c => c.id === detailContact.id) || detailContact}
            onClose={() => setDetailContact(null)}
            onEdit={() => { setEditTarget(detailContact); setShowForm(true); setDetailContact(null) }}
          />
        </>
      )}
      {openMenu && <div className="fixed inset-0 z-0" onClick={() => setOpenMenu(null)} />}
    </div>
  )
}
