import { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'

export default function Modal({ isOpen, onClose, title, children, size = 'md' }) {
  const overlayRef = useRef(null)

  useEffect(() => {
    if (!isOpen) return
    const prev = document.activeElement
    const el = overlayRef.current
    if (el) {
      const focusable = el.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])')
      if (focusable.length) focusable[0].focus()
    }
    const onKey = (e) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('keydown', onKey)
      prev?.focus()
    }
  }, [isOpen, onClose])

  if (!isOpen) return null

  const widths = { sm: 'max-w-sm', md: 'max-w-lg', lg: 'max-w-2xl' }

  return createPortal(
    <div
      ref={overlayRef}
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" />
      <div className={`relative w-full ${widths[size]} bg-white rounded-2xl shadow-2xl flex flex-col max-h-[90vh]`}>
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200">
          <h2 className="text-base font-semibold text-slate-900">{title}</h2>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-lg flex items-center justify-center text-slate-400 hover:bg-slate-100 hover:text-slate-600 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
        {/* Body */}
        <div className="overflow-y-auto flex-1">
          {children}
        </div>
      </div>
    </div>,
    document.body
  )
}
