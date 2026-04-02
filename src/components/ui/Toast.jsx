import { CheckCircle, AlertCircle } from 'lucide-react'

export default function Toast({ message, type = 'success' }) {
  return (
    <div className={`fixed bottom-6 right-6 z-[100] flex items-center gap-3 px-4 py-3 rounded-xl shadow-lg text-sm font-medium animate-[slideUp_0.2s_ease-out] ${
      type === 'success' ? 'bg-slate-900 text-white' : 'bg-red-600 text-white'
    }`}>
      {type === 'success'
        ? <CheckCircle className="w-4 h-4 text-green-400 shrink-0" />
        : <AlertCircle className="w-4 h-4 text-white shrink-0" />
      }
      {message}
    </div>
  )
}
