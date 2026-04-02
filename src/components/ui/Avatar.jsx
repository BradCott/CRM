import { getInitials, getAvatarColor, getFullName } from '../../utils/formatters'

export default function Avatar({ contact, size = 'md' }) {
  const name = getFullName(contact)
  const initials = getInitials(contact?.firstName, contact?.lastName)
  const color = getAvatarColor(name)

  const sizeClasses = {
    sm: 'w-7 h-7 text-xs',
    md: 'w-9 h-9 text-sm',
    lg: 'w-12 h-12 text-base',
  }[size] || 'w-9 h-9 text-sm'

  return (
    <div className={`${sizeClasses} ${color} rounded-full flex items-center justify-center text-white font-semibold shrink-0`}>
      {initials}
    </div>
  )
}
