import { X, Mail, Phone, Briefcase, FileText, Building2 } from 'lucide-react'
import Avatar from '../ui/Avatar'
import Button from '../ui/Button'
import { getFullName } from '../../utils/formatters'

export default function ContactDetail({ contact, onClose, onEdit }) {
  if (!contact) return null

  const fields = [
    { icon: Mail,      label: 'Email',   value: contact.email,      href: `mailto:${contact.email}` },
    { icon: Phone,     label: 'Phone',   value: contact.phone,      href: `tel:${contact.phone}` },
    { icon: Briefcase, label: 'Title',   value: contact.title },
    { icon: Building2, label: 'Owner',   value: contact.owner_name },
  ]

  return (
    <div className="fixed inset-y-0 right-0 w-96 bg-white border-l border-slate-200 shadow-2xl z-40 flex flex-col">
      <div className="flex items-start justify-between px-6 pt-6 pb-4 border-b border-slate-100">
        <div className="flex items-center gap-3">
          <Avatar contact={{ firstName: contact.first_name, lastName: contact.last_name }} size="lg" />
          <div>
            <h2 className="text-base font-semibold text-slate-900">{getFullName({ firstName: contact.first_name, lastName: contact.last_name })}</h2>
            {contact.title && <p className="text-sm text-slate-500">{contact.title}</p>}
          </div>
        </div>
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="sm" onClick={onEdit}>Edit</Button>
          <button onClick={onClose} className="w-8 h-8 rounded-lg flex items-center justify-center text-slate-400 hover:bg-slate-100">
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-6 py-4 space-y-3">
        {fields.map(({ icon: Icon, label, value, href }) =>
          value ? (
            <div key={label} className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-lg bg-slate-100 flex items-center justify-center shrink-0">
                <Icon className="w-4 h-4 text-slate-500" />
              </div>
              <div className="min-w-0">
                <p className="text-xs text-slate-400">{label}</p>
                {href
                  ? <a href={href} className="text-sm text-blue-600 hover:underline truncate block">{value}</a>
                  : <p className="text-sm text-slate-800 truncate">{value}</p>
                }
              </div>
            </div>
          ) : null
        )}
        {contact.notes && (
          <div className="flex items-start gap-3">
            <div className="w-8 h-8 rounded-lg bg-slate-100 flex items-center justify-center shrink-0 mt-0.5">
              <FileText className="w-4 h-4 text-slate-500" />
            </div>
            <div>
              <p className="text-xs text-slate-400 mb-0.5">Notes</p>
              <p className="text-sm text-slate-700 leading-relaxed">{contact.notes}</p>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
