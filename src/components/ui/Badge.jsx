import { STAGE_COLORS } from '../../utils/constants'

export default function Badge({ color = 'slate', label }) {
  const c = STAGE_COLORS[color] || STAGE_COLORS.slate
  return (
    <span className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium ${c.bg} ${c.text}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${c.dot}`} />
      {label}
    </span>
  )
}
