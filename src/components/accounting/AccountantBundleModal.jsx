// Accountant Bundle — one Excel workbook (Ledger, Balance Sheet, P&L, Cash Flow,
// Schedule E, Depreciation, 1099 vendors) that you download and/or email straight
// to the CPA from your connected Google account.
import { useState, useEffect, useRef } from 'react'
import { X, Loader2, Download, Send, FileSpreadsheet, CheckCircle, AlertTriangle, FileText, Upload, Paperclip } from 'lucide-react'
import Button from '../ui/Button'
import { downloadBundle, bundleBase64, bundleFilename } from '../../utils/accountingExport'
import { emailAccountantBundle, getSettlementDocs, uploadSettlementDoc, settlementDocFileUrl, getCapitalAccounts } from '../../api/client'
import SendFromPicker from './SendFromPicker'

const SHEETS = ['Ledger', 'Balance Sheet', 'P&L', 'Cash Flow', 'Schedule E', 'Depreciation', 'Vendors (1099)', 'Capital Accounts']

export default function AccountantBundleModal({ property, transactions = [], investors = [], onClose }) {
  const addr = property?.address || 'this property'
  const [to, setTo]           = useState('')
  const [cc, setCc]           = useState('')
  const [account, setAccount] = useState('')
  const [subject, setSubject] = useState(`Accountant package — ${addr}`)
  const [body, setBody]       = useState(
    `Hi,\n\nAttached is the full accounting package for ${addr} — ledger, balance sheet, P&L, cash flow, Schedule E, depreciation schedule, 1099 vendor summary, and a per-investor capital accounts schedule (contributions & distributions).\n\nLet me know if you need anything else.\n\nThanks,\nBrad`)
  const [sending, setSending] = useState(false)
  const [sent, setSent]       = useState(false)
  const [error, setError]     = useState(null)

  const [caps, setCaps]             = useState([])     // per-investor capital accounts
  const [docs, setDocs]             = useState(null)   // stored settlement PDFs
  const [includeSettlements, setIncludeSettlements] = useState(true)
  const [uploadingKind, setUploadingKind] = useState(null)
  const buyInputRef  = useRef(null)
  const saleInputRef = useRef(null)

  const loadDocs = () => {
    getSettlementDocs(property.id).then(setDocs).catch(() => setDocs([]))
  }
  useEffect(() => {
    loadDocs()
    getCapitalAccounts(property.id).then(r => setCaps(Array.isArray(r) ? r : [])).catch(() => setCaps([]))
    /* eslint-disable-next-line */
  }, [property.id])

  const buyDoc  = (docs || []).find(d => d.kind === 'buy'  && d.has_file)
  const saleDoc = (docs || []).find(d => d.kind === 'sale' && d.has_file)

  const uploadKind = async (kind, file) => {
    if (!file) return
    setUploadingKind(kind); setError(null)
    try { await uploadSettlementDoc(property.id, kind, file); loadDocs() }
    catch (e) { setError(e.message || 'Upload failed') }
    finally { setUploadingKind(null) }
  }

  const download = () => {
    try { downloadBundle(property, transactions, investors, caps) }
    catch (e) { setError(e.message || 'Could not build the file') }
  }

  const send = async () => {
    if (!to.trim()) { setError("Enter the accountant's email"); return }
    if (!window.confirm(`Email the accountant package for ${addr} to ${to}?`)) return
    setSending(true); setError(null)
    try {
      const attachment_base64 = bundleBase64(property, transactions, investors, caps)
      await emailAccountantBundle(property.id, {
        to: to.trim(), cc: cc.trim() || undefined, account: account || undefined,
        subject, body, filename: bundleFilename(property), attachment_base64,
        include_settlements: includeSettlements,
      })
      setSent(true)
    } catch (e) {
      setError(e.message || 'Send failed')
    } finally {
      setSending(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg max-h-[90vh] flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100 shrink-0">
          <div className="flex items-center gap-2">
            <FileSpreadsheet className="w-5 h-5 text-emerald-600" />
            <h3 className="text-base font-semibold text-slate-900">Accountant Bundle</h3>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600"><X className="w-5 h-5" /></button>
        </div>

        {sent ? (
          <div className="px-5 py-10 flex flex-col items-center gap-3 text-center">
            <CheckCircle className="w-10 h-10 text-emerald-500" />
            <p className="text-lg font-semibold text-slate-900">Package sent</p>
            <p className="text-sm text-slate-500">The accountant bundle for {addr} was emailed to {to}.</p>
            <Button onClick={onClose} className="mt-2">Done</Button>
          </div>
        ) : (
          <div className="px-5 py-4 space-y-4 overflow-y-auto">
            <div className="bg-slate-50 rounded-lg px-3 py-2.5">
              <p className="text-xs font-medium text-slate-500 mb-1.5">Included in the workbook</p>
              <div className="flex flex-wrap gap-1.5">
                {SHEETS.map(s => <span key={s} className="text-xs bg-white border border-slate-200 rounded px-2 py-0.5 text-slate-600">{s}</span>)}
              </div>
            </div>

            <div className="border border-slate-200 rounded-lg px-3 py-2.5">
              <label className="flex items-center gap-2 mb-2 cursor-pointer">
                <input type="checkbox" checked={includeSettlements} onChange={e => setIncludeSettlements(e.target.checked)}
                  className="rounded border-slate-300 text-emerald-600 focus:ring-emerald-400" />
                <span className="text-xs font-medium text-slate-600 flex items-center gap-1.5">
                  <Paperclip className="w-3.5 h-3.5 text-slate-400" /> Attach settlement statements (PDF)
                </span>
              </label>
              {docs === null ? (
                <p className="text-xs text-slate-400 flex items-center gap-1.5"><Loader2 className="w-3.5 h-3.5 animate-spin" /> Checking for stored statements…</p>
              ) : (
                <div className="space-y-1.5">
                  {[{ kind: 'buy', label: 'Buy settlement', doc: buyDoc, ref: buyInputRef },
                    { kind: 'sale', label: 'Sale settlement', doc: saleDoc, ref: saleInputRef }].map(({ kind, label, doc, ref }) => (
                    <div key={kind} className="flex items-center justify-between gap-2 text-xs">
                      <span className="flex items-center gap-1.5 min-w-0">
                        <FileText className={`w-3.5 h-3.5 shrink-0 ${doc ? 'text-emerald-600' : 'text-slate-300'}`} />
                        <span className="text-slate-500">{label}:</span>
                        {doc ? (
                          <a href={settlementDocFileUrl(property.id, doc.id)} target="_blank" rel="noreferrer"
                            className="text-emerald-700 hover:underline truncate">{doc.file_name || 'on file'}</a>
                        ) : (
                          <span className="text-slate-400 italic">not on file</span>
                        )}
                      </span>
                      <button onClick={() => ref.current?.click()} disabled={uploadingKind === kind}
                        className="inline-flex items-center gap-1 text-slate-500 hover:text-slate-700 shrink-0">
                        {uploadingKind === kind ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Upload className="w-3.5 h-3.5" />}
                        {doc ? 'Replace' : 'Upload'}
                      </button>
                      <input ref={ref} type="file" accept="application/pdf,.pdf" className="hidden"
                        onChange={e => { uploadKind(kind, e.target.files?.[0]); e.target.value = '' }} />
                    </div>
                  ))}
                  <p className="text-[11px] text-slate-400 pt-0.5">Statements uploaded when you recorded the buy/sale are attached automatically.</p>
                </div>
              )}
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-slate-500 mb-1">To (accountant)</label>
                <input value={to} onChange={e => setTo(e.target.value)} type="email" placeholder="cpa@firm.com"
                  className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-emerald-400" />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-500 mb-1">Cc (optional)</label>
                <input value={cc} onChange={e => setCc(e.target.value)} type="email" placeholder=""
                  className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-emerald-400" />
              </div>
            </div>

            <SendFromPicker value={account} onChange={setAccount} />

            <div>
              <label className="block text-xs font-medium text-slate-500 mb-1">Subject</label>
              <input value={subject} onChange={e => setSubject(e.target.value)}
                className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-emerald-400" />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-500 mb-1">Message</label>
              <textarea value={body} onChange={e => setBody(e.target.value)} rows={6}
                className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-emerald-400 resize-y" />
            </div>

            {error && <p className="text-sm text-red-600 flex items-center gap-1.5"><AlertTriangle className="w-4 h-4" /> {error}</p>}

            <div className="flex items-center justify-between gap-2 pt-1">
              <button onClick={download} className="inline-flex items-center gap-1.5 text-sm font-medium text-slate-600 border border-slate-200 rounded-lg px-3 py-2 hover:bg-slate-50">
                <Download className="w-4 h-4" /> Download package
              </button>
              <Button onClick={send} disabled={sending || !to.trim()}>
                {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />} Send to accountant
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
