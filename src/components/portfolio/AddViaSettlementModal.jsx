import { useState, useRef } from 'react'
import {
  X, Upload, Loader2, CheckCircle, AlertCircle, FileText,
} from 'lucide-react'
import Button from '../ui/Button'
import { parseSettlementPdf } from '../../api/client'
import { useApp } from '../../context/AppContext'

const PROPERTY_TYPES = ['Retail', 'Net Lease', 'Industrial', 'Office', 'Medical', 'Restaurant', 'Auto', 'Other']
const LEASE_TYPES    = ['NNN', 'NN', 'N', 'Gross', 'Modified Gross', 'Ground Lease']

// ── Small field components ────────────────────────────────────────────────────

function LabeledInput({ label, hint, required, error, children }) {
  return (
    <div>
      <div className="flex items-baseline gap-1.5 mb-1">
        <label className="text-xs font-medium text-slate-600">{label}{required && <span className="text-red-500 ml-0.5">*</span>}</label>
        {hint && <span className="text-[10px] text-slate-400">{hint}</span>}
      </div>
      {children}
      {error && <p className="text-[10px] text-red-500 mt-0.5">{error}</p>}
    </div>
  )
}

function TInput({ value, onChange, placeholder, type = 'text', readOnly, className = '' }) {
  return (
    <input
      type={type}
      value={value ?? ''}
      onChange={onChange}
      placeholder={placeholder}
      readOnly={readOnly}
      className={`w-full rounded-lg border px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500 transition-colors ${
        readOnly ? 'bg-slate-50 border-slate-200 text-slate-500 cursor-default' : 'border-slate-300 bg-white hover:border-slate-400'
      } ${className}`}
    />
  )
}

function TSelect({ value, onChange, children }) {
  return (
    <select
      value={value ?? ''}
      onChange={onChange}
      className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500 transition-colors hover:border-slate-400"
    >
      {children}
    </select>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

export default function AddViaSettlementModal({ onSave, onClose }) {
  const { tenantBrands, allPeople: owners } = useApp()
  const inputRef = useRef()
  const [step, setStep]     = useState('upload') // upload | parsing | form | saving
  const [error, setError]   = useState(null)
  const [dragOver, setDragOver] = useState(false)
  const [errors, setErrors] = useState({})

  // What the AI pulled from the PDF (shown as read-only hints)
  const [extracted, setExtracted] = useState(null)

  // Editable form — seeded from extracted data after parsing
  const [form, setForm] = useState({
    address: '', city: '', state: '', zip: '',
    purchase_price: '', close_date: '',
    tenant_brand_id: '', owner_name: '',
    lease_type: '', lease_start: '', lease_end: '',
    annual_rent: '', noi: '', cap_rate: '',
    building_size: '', year_built: '', property_type: '',
    notes: '',
  })

  const setF = key => e => setForm(f => ({ ...f, [key]: typeof e === 'string' ? e : e.target.value }))

  async function handleFile(file) {
    if (!file) return
    setStep('parsing')
    setError(null)
    try {
      const data = await parseSettlementPdf(file)
      setExtracted(data)
      // Seed the form with everything the AI found
      setForm(prev => ({
        ...prev,
        address:        data.property_address  || '',
        city:           data.property_city     || '',
        state:          data.property_state    || '',
        zip:            data.property_zip      || '',
        purchase_price: data.purchase_price    ? String(Math.round(data.purchase_price)) : '',
        close_date:     data.settlement_date   || '',
      }))
      setStep('form')
    } catch (err) {
      setError(err.message)
      setStep('upload')
    }
  }

  function validate() {
    const e = {}
    if (!form.address.trim()) e.address = 'Required'
    if (!form.city.trim())    e.city    = 'Required'
    if (!form.state.trim())   e.state   = 'Required'
    return e
  }

  async function handleSave() {
    const e = validate()
    if (Object.keys(e).length) { setErrors(e); return }
    setStep('saving')
    setError(null)
    try {
      const payload = {
        address:        form.address.trim(),
        city:           form.city.trim(),
        state:          form.state.trim(),
        zip:            form.zip.trim() || null,
        purchase_price: form.purchase_price !== '' ? parseFloat(form.purchase_price) : null,
        close_date:     form.close_date   || null,
        tenant_brand_id: form.tenant_brand_id !== '' ? parseInt(form.tenant_brand_id, 10) : null,
        owner_name:     form.owner_name   || null,
        lease_type:     form.lease_type   || null,
        lease_start:    form.lease_start  || null,
        lease_end:      form.lease_end    || null,
        annual_rent:    form.annual_rent  !== '' ? parseFloat(form.annual_rent)  : null,
        noi:            form.noi          !== '' ? parseFloat(form.noi)          : null,
        cap_rate:       form.cap_rate     !== '' ? parseFloat(form.cap_rate)     : null,
        building_size:  form.building_size !== '' ? parseFloat(form.building_size) : null,
        year_built:     form.year_built   !== '' ? parseFloat(form.year_built)   : null,
        property_type:  form.property_type || null,
        notes:          form.notes        || null,
      }
      await onSave(payload)
      onClose()
    } catch (err) {
      setError(err.message)
      setStep('form')
    }
  }

  // ── Upload / Parsing step ───────────────────────────────────────────────────

  if (step === 'upload' || step === 'parsing') {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40">
        <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md flex flex-col">
          <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
            <div>
              <h2 className="text-base font-semibold text-slate-900">Add via Settlement Statement</h2>
              <p className="text-xs text-slate-500 mt-0.5">
                {step === 'parsing' ? 'AI is reading your settlement statement…' : 'Upload the closing PDF to pre-fill property details'}
              </p>
            </div>
            <button onClick={onClose} className="text-slate-400 hover:text-slate-600"><X className="w-5 h-5" /></button>
          </div>

          <div className="px-6 py-6">
            {error && (
              <div className="mb-4 flex items-start gap-2 px-4 py-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
                <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />{error}
              </div>
            )}
            <div
              className={`border-2 border-dashed rounded-xl p-12 text-center transition-all ${
                step === 'parsing'
                  ? 'border-blue-300 bg-blue-50/50 cursor-default'
                  : dragOver
                    ? 'border-blue-400 bg-blue-50 cursor-copy'
                    : 'border-slate-300 hover:border-blue-300 hover:bg-blue-50/40 cursor-pointer'
              }`}
              onClick={() => step === 'upload' && inputRef.current?.click()}
              onDragOver={e => { e.preventDefault(); if (step === 'upload') setDragOver(true) }}
              onDragLeave={e => { e.preventDefault(); setDragOver(false) }}
              onDrop={e => {
                e.preventDefault(); setDragOver(false)
                if (step !== 'upload') return
                const file = e.dataTransfer.files[0]
                if (file) handleFile(file)
              }}
            >
              <input ref={inputRef} type="file" accept=".pdf" className="hidden"
                onChange={e => handleFile(e.target.files[0])} />
              {step === 'parsing' ? (
                <>
                  <Loader2 className="w-10 h-10 mx-auto mb-3 text-blue-400 animate-spin" />
                  <p className="text-sm font-medium text-slate-700">Reading settlement statement…</p>
                  <p className="text-xs text-slate-400 mt-1">Extracting address, price, date…</p>
                </>
              ) : (
                <>
                  <FileText className={`w-10 h-10 mx-auto mb-3 ${dragOver ? 'text-blue-400' : 'text-slate-300'}`} />
                  <p className="text-sm font-medium text-slate-700">{dragOver ? 'Release to upload' : 'Drop PDF or click to browse'}</p>
                  <p className="text-xs text-slate-400 mt-1">First American Title or HUD-1 format</p>
                </>
              )}
            </div>
          </div>

          <div className="shrink-0 flex justify-end px-6 py-4 border-t border-slate-100 bg-slate-50 rounded-b-2xl">
            <button onClick={onClose} className="text-sm text-slate-400 hover:text-slate-600">Cancel</button>
          </div>
        </div>
      </div>
    )
  }

  // ── Form step ───────────────────────────────────────────────────────────────

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-3xl max-h-[92vh] flex flex-col">

        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 shrink-0">
          <div>
            <h2 className="text-base font-semibold text-slate-900">Add via Settlement Statement</h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Pre-filled from settlement PDF — complete the remaining details below
            </p>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600"><X className="w-5 h-5" /></button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-6 py-5">
          {error && (
            <div className="mb-4 flex items-start gap-2 px-4 py-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
              <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />{error}
            </div>
          )}

          <div className="grid grid-cols-2 gap-x-8 gap-y-5">

            {/* ── LEFT: From settlement (pre-filled, editable) ── */}
            <div className="space-y-4">
              <div>
                <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-3 flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full bg-blue-400 inline-block" />
                  From Settlement PDF
                </p>

                <div className="space-y-3">
                  <LabeledInput label="Street Address" required error={errors.address}>
                    <TInput value={form.address} onChange={setF('address')} placeholder="123 Main St" />
                  </LabeledInput>

                  <div className="grid grid-cols-3 gap-2">
                    <div className="col-span-1">
                      <LabeledInput label="City" required error={errors.city}>
                        <TInput value={form.city} onChange={setF('city')} placeholder="Nashville" />
                      </LabeledInput>
                    </div>
                    <LabeledInput label="State" required error={errors.state}>
                      <TInput value={form.state} onChange={setF('state')} placeholder="TN" maxLength={2} />
                    </LabeledInput>
                    <LabeledInput label="ZIP">
                      <TInput value={form.zip} onChange={setF('zip')} placeholder="37201" />
                    </LabeledInput>
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    <LabeledInput label="Purchase Price ($)">
                      <TInput type="number" value={form.purchase_price} onChange={setF('purchase_price')} placeholder="1800000" />
                    </LabeledInput>
                    <LabeledInput label="Close Date">
                      <TInput type="date" value={form.close_date} onChange={setF('close_date')} />
                    </LabeledInput>
                  </div>

                  {extracted?.lender_name && (
                    <LabeledInput label="Lender" hint="(from settlement — for reference)">
                      <TInput value={extracted.lender_name} readOnly />
                    </LabeledInput>
                  )}
                </div>
              </div>
            </div>

            {/* ── RIGHT: CRM-specific details (manual) ── */}
            <div className="space-y-4">
              <div>
                <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-3 flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full bg-emerald-400 inline-block" />
                  Complete the Record
                </p>

                <div className="space-y-3">
                  <div className="grid grid-cols-2 gap-2">
                    <LabeledInput label="Tenant Brand">
                      <TSelect value={form.tenant_brand_id} onChange={setF('tenant_brand_id')}>
                        <option value="">— None —</option>
                        {[...tenantBrands].sort((a,b)=>a.name.localeCompare(b.name)).map(t => (
                          <option key={t.id} value={t.id}>{t.name}</option>
                        ))}
                      </TSelect>
                    </LabeledInput>
                    <LabeledInput label="Property Type">
                      <TSelect value={form.property_type} onChange={setF('property_type')}>
                        <option value="">— Select —</option>
                        {PROPERTY_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                      </TSelect>
                    </LabeledInput>
                  </div>

                  <LabeledInput label="Owner / Entity">
                    <input
                      list="owner-suggestions-settlement"
                      type="text"
                      value={form.owner_name}
                      onChange={setF('owner_name')}
                      placeholder="e.g. KC SW Crossett LLC"
                      className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500 transition-colors hover:border-slate-400"
                    />
                    <datalist id="owner-suggestions-settlement">
                      {[...owners].sort((a,b)=>a.name.localeCompare(b.name)).map(o => (
                        <option key={o.id} value={o.name} />
                      ))}
                    </datalist>
                  </LabeledInput>

                  <div className="grid grid-cols-3 gap-2">
                    <LabeledInput label="Lease Type">
                      <TSelect value={form.lease_type} onChange={setF('lease_type')}>
                        <option value="">—</option>
                        {LEASE_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                      </TSelect>
                    </LabeledInput>
                    <LabeledInput label="Lease Start">
                      <TInput type="date" value={form.lease_start} onChange={setF('lease_start')} />
                    </LabeledInput>
                    <LabeledInput label="Lease End">
                      <TInput type="date" value={form.lease_end} onChange={setF('lease_end')} />
                    </LabeledInput>
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    <LabeledInput label="Annual Rent ($)">
                      <TInput type="number" value={form.annual_rent} onChange={setF('annual_rent')} placeholder="120000" />
                    </LabeledInput>
                    <LabeledInput label="NOI ($)">
                      <TInput type="number" value={form.noi} onChange={setF('noi')} placeholder="115000" />
                    </LabeledInput>
                  </div>

                  <div className="grid grid-cols-3 gap-2">
                    <LabeledInput label="Cap Rate (%)" hint="e.g. 5.75">
                      <TInput type="number" step="0.01" value={form.cap_rate} onChange={setF('cap_rate')} placeholder="5.75" />
                    </LabeledInput>
                    <LabeledInput label="Bldg Size (sf)">
                      <TInput type="number" value={form.building_size} onChange={setF('building_size')} placeholder="8500" />
                    </LabeledInput>
                    <LabeledInput label="Year Built">
                      <TInput type="number" value={form.year_built} onChange={setF('year_built')} placeholder="2005" />
                    </LabeledInput>
                  </div>

                  <LabeledInput label="Notes">
                    <textarea
                      value={form.notes}
                      onChange={setF('notes')}
                      placeholder="Any relevant notes…"
                      rows={2}
                      className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500 transition-colors hover:border-slate-400 resize-none"
                    />
                  </LabeledInput>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="shrink-0 flex items-center justify-between px-6 py-4 border-t border-slate-100 bg-slate-50 rounded-b-2xl">
          <button onClick={() => setStep('upload')} className="text-sm text-slate-400 hover:text-slate-600">
            ← Upload different PDF
          </button>
          <div className="flex items-center gap-3">
            <button onClick={onClose} className="text-sm text-slate-400 hover:text-slate-600">Cancel</button>
            <Button onClick={handleSave} disabled={step === 'saving'}>
              {step === 'saving'
                ? <><Loader2 className="w-4 h-4 animate-spin" /> Saving…</>
                : <><CheckCircle className="w-4 h-4" /> Add to Portfolio</>
              }
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}
