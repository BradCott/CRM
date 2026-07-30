import { useState, useEffect, useCallback } from 'react'
import { Scale, Loader2, CheckCircle2, RotateCcw, Info } from 'lucide-react'
import {
  getExpenseSettings, updateExpenseSetting,
  getInstallments, saveInstallment, fillInstallments,
  getReconciliations, getReconciliationSuggestions,
  saveReconciliation, postReconciliation, unpostReconciliation,
} from '../../api/client'
import { Input, Select } from '../ui/Input'
import Button from '../ui/Button'

const TYPES = [
  { id: 'tax',       label: 'Real Estate Taxes' },
  { id: 'insurance', label: 'Insurance' },
  { id: 'cam',       label: 'CAM' },
]
const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']

function money(n) {
  if (n == null || n === '') return '—'
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(n)
}
function num(v) { return v != null && v !== '' ? parseFloat(v) : null }

// Editable amount cell — keeps a local draft so typing is smooth, saves on blur.
function MonthCell({ label, value, onSave }) {
  const [draft, setDraft] = useState(value != null ? String(value) : '')
  useEffect(() => { setDraft(value != null ? String(value) : '') }, [value])
  return (
    <label className="flex flex-col gap-0.5">
      <span className="text-[11px] font-medium text-slate-400">{label}</span>
      <input
        type="number"
        inputMode="decimal"
        value={draft}
        placeholder="0"
        onChange={e => setDraft(e.target.value)}
        onBlur={() => {
          const v = draft === '' ? 0 : parseFloat(draft)
          if (Number.isNaN(v)) { setDraft(value != null ? String(value) : ''); return }
          if (v !== (value ?? 0)) onSave(v)
        }}
        className="w-full rounded-md border border-slate-200 bg-white px-1.5 py-1 text-xs text-right text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent hover:border-slate-300"
      />
    </label>
  )
}

export default function ReconciliationSection({ propertyId }) {
  const currentYear = new Date().getFullYear()
  const [year, setYear]           = useState(currentYear)
  const [loading, setLoading]     = useState(true)
  const [settings, setSettings]   = useState({})           // { type: settingRow }
  const [installments, setInstallments] = useState({ tax: {}, insurance: {}, cam: {} }) // { type: { month: row } }
  const [recon, setRecon]         = useState({ tax: null, insurance: null, cam: null }) // { type: reconRow }
  const [suggest, setSuggest]     = useState({ tax: null, insurance: null, cam: null }) // suggested actual from paid records
  const [actualDraft, setActualDraft] = useState({ tax: '', insurance: '', cam: '' })   // editable actual-recoverable input
  const [busy, setBusy]           = useState(null)         // `${action}:${type}` while a POST is in flight

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [s, ins, rec, sug] = await Promise.all([
        getExpenseSettings(propertyId),
        getInstallments(propertyId, { year }),
        getReconciliations(propertyId, { year }),
        getReconciliationSuggestions(propertyId, { year }),
      ])
      const nextSettings = {}
      for (const row of s) nextSettings[row.expense_type] = row
      const nextInstall = { tax: {}, insurance: {}, cam: {} }
      for (const r of ins) nextInstall[r.expense_type][r.month] = r
      const nextRecon = { tax: null, insurance: null, cam: null }
      for (const r of rec) nextRecon[r.expense_type] = r
      // Prefill each actual-recoverable input with the saved value, else the
      // suggestion from paid records. Not persisted until the user blurs/posts.
      const nextSuggest = { tax: null, insurance: null, cam: null }
      const nextDraft   = { tax: '', insurance: '', cam: '' }
      for (const t of ['tax', 'insurance', 'cam']) {
        nextSuggest[t] = sug?.[t] ?? null
        const base = nextRecon[t]?.actual_recoverable != null ? nextRecon[t].actual_recoverable : nextSuggest[t]
        nextDraft[t] = base != null ? String(base) : ''
      }
      setSettings(nextSettings)
      setInstallments(nextInstall)
      setRecon(nextRecon)
      setSuggest(nextSuggest)
      setActualDraft(nextDraft)
    } finally {
      setLoading(false)
    }
  }, [propertyId, year])

  useEffect(() => { load() }, [load])

  const settingFor = (type) => settings[type] || { expense_type: type, method: 'direct', monthly_estimate: null }
  const collectedOf = (type) =>
    Object.values(installments[type] || {}).reduce((s, r) => s + (Number(r.amount) || 0), 0)

  async function patchSetting(type, patch) {
    const base = settingFor(type)
    const saved = await updateExpenseSetting(propertyId, type, { ...base, ...patch })
    setSettings(prev => ({ ...prev, [type]: saved }))
  }

  async function saveMonth(type, month, amount) {
    const saved = await saveInstallment(propertyId, { expense_type: type, year, month, amount })
    setInstallments(prev => ({ ...prev, [type]: { ...prev[type], [month]: saved } }))
    // Keep any draft reconciliation's collected/true-up in sync locally.
    setRecon(prev => {
      const r = prev[type]
      if (!r || r.status === 'posted') return prev
      const collected = Object.values({ ...installments[type], [month]: saved })
        .reduce((s, x) => s + (Number(x.amount) || 0), 0)
      const trueUp = r.actual_recoverable != null ? Number(r.actual_recoverable) - collected : null
      return { ...prev, [type]: { ...r, total_collected: collected, true_up_amount: trueUp } }
    })
  }

  // Fill the 12 monthly cells from the flat rate. mode 'empty' only fills blanks
  // (auto-fill when a rate is entered); 'all' overwrites every manual cell.
  async function applyFlatRate(type, amount, mode) {
    if (amount == null || Number.isNaN(amount)) return
    const rows = await fillInstallments(propertyId, { expense_type: type, year, amount, mode })
    const byMonth = {}
    for (const r of rows) byMonth[r.month] = r
    setInstallments(prev => ({ ...prev, [type]: byMonth }))
    const collected = Object.values(byMonth).reduce((s, x) => s + (Number(x.amount) || 0), 0)
    setRecon(prev => {
      const r = prev[type]
      if (!r || r.status === 'posted') return prev
      const trueUp = r.actual_recoverable != null ? Number(r.actual_recoverable) - collected : null
      return { ...prev, [type]: { ...r, total_collected: collected, true_up_amount: trueUp } }
    })
  }

  async function saveActual(type, value) {
    const saved = await saveReconciliation(propertyId, {
      expense_type: type, year, actual_recoverable: value,
      notes: recon[type]?.notes ?? null,
    })
    setRecon(prev => ({ ...prev, [type]: saved }))
    return saved
  }

  async function doPost(type) {
    const draftStr = actualDraft[type] ?? ''
    const eff = draftStr !== '' ? parseFloat(draftStr) : null
    if (eff == null || Number.isNaN(eff)) return
    setBusy(`post:${type}`)
    try {
      // Persist the (possibly prefilled-but-never-blurred) value before posting.
      let row = recon[type]
      if (!row?.id || Number(row.actual_recoverable) !== eff) row = await saveActual(type, eff)
      const { reconciliation } = await postReconciliation(row.id)
      setRecon(prev => ({ ...prev, [type]: reconciliation }))
    } finally { setBusy(null) }
  }

  async function doUnpost(type) {
    const r = recon[type]
    if (!r?.id) return
    setBusy(`unpost:${type}`)
    try {
      const reconciliation = await unpostReconciliation(r.id)
      setRecon(prev => ({ ...prev, [type]: reconciliation }))
    } finally { setBusy(null) }
  }

  const years = []
  for (let y = currentYear + 1; y >= currentYear - 3; y--) years.push(y)

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-slate-700">
          <Scale className="w-4 h-4 text-slate-400" /> Reimbursement Method & Reconciliation
        </h2>
        <div className="w-32">
          <Select value={year} onChange={e => setYear(parseInt(e.target.value, 10))}>
            {years.map(y => <option key={y} value={y}>{y}</option>)}
          </Select>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center h-40">
          <Loader2 className="w-5 h-5 animate-spin text-slate-400" />
        </div>
      ) : (
        <div className="space-y-4">
          {TYPES.map(({ id, label }) => {
            const setting   = settingFor(id)
            const isInstall = setting.method === 'installments'
            const collected = collectedOf(id)
            const r          = recon[id]
            const posted     = r?.status === 'posted'
            const savedActual = r?.actual_recoverable != null ? Number(r.actual_recoverable) : null
            const suggestion = suggest[id]
            const draftStr   = posted ? (savedActual != null ? String(savedActual) : '') : (actualDraft[id] ?? '')
            const effActual  = draftStr !== '' ? parseFloat(draftStr) : null
            const collectedVal = posted ? Number(r.total_collected) : collected
            const trueUp     = effActual != null ? effActual - collectedVal : null

            return (
              <div key={id} className="rounded-xl border border-slate-200 bg-white p-4 space-y-3">
                {/* Header row: type + method toggle */}
                <div className="flex items-center justify-between gap-3">
                  <h3 className="text-sm font-semibold text-slate-800">{label}</h3>
                  <div className="flex rounded-lg bg-slate-100 p-0.5 text-xs font-medium">
                    {['direct', 'installments'].map(m => (
                      <button
                        key={m}
                        onClick={() => patchSetting(id, { method: m })}
                        className={`px-3 py-1 rounded-md capitalize transition-colors ${
                          setting.method === m ? 'bg-white text-blue-700 shadow-sm' : 'text-slate-500 hover:text-slate-700'
                        }`}
                      >
                        {m === 'direct' ? 'Direct' : 'Installments'}
                      </button>
                    ))}
                  </div>
                </div>

                {id === 'tax' && (
                  <label className="flex items-start gap-2 text-xs text-slate-600 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={!!setting.tax_arrears}
                      onChange={e => patchSetting(id, { tax_arrears: e.target.checked })}
                      className="mt-0.5 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                    />
                    <span>
                      Taxes paid in arrears
                      {setting.tax_arrears
                        ? ` — reconciling ${year} pulls the ${year - 1} tax bill.`
                        : ''}
                    </span>
                  </label>
                )}

                {!isInstall ? (
                  <p className="flex items-start gap-1.5 text-xs text-slate-500">
                    <Info className="w-3.5 h-3.5 mt-px shrink-0 text-slate-400" />
                    Billed in full once the {label.toLowerCase()} bill is paid — tracked on the Reimbursements
                    tab. No monthly installments or year-end true-up.
                  </p>
                ) : (
                  <div className="space-y-4">
                    {/* Monthly rate — tenants pay a flat amount all year, so this
                        auto-fills the 12 cells below (blank months only). */}
                    <div className="flex items-end gap-3">
                      <div className="w-48">
                        <Input
                          label="Monthly rate"
                          type="number"
                          value={setting.monthly_estimate ?? ''}
                          placeholder="0"
                          onChange={e => setSettings(prev => ({
                            ...prev, [id]: { ...settingFor(id), monthly_estimate: e.target.value },
                          }))}
                          onBlur={async e => {
                            const v = num(e.target.value)
                            await patchSetting(id, { monthly_estimate: v })
                            if (v != null) applyFlatRate(id, v, 'empty')
                          }}
                        />
                      </div>
                      {setting.monthly_estimate != null && setting.monthly_estimate !== '' && (
                        <button
                          type="button"
                          onClick={() => applyFlatRate(id, Number(setting.monthly_estimate), 'all')}
                          className="mb-0.5 rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-medium text-slate-600 hover:border-blue-400 hover:text-blue-700 transition-colors"
                        >
                          Apply to all 12 months
                        </button>
                      )}
                    </div>

                    {/* Monthly ledger */}
                    <div>
                      <div className="grid grid-cols-6 gap-2">
                        {MONTHS.map((mLabel, i) => (
                          <MonthCell
                            key={mLabel}
                            label={mLabel}
                            value={installments[id]?.[i + 1]?.amount ?? null}
                            onSave={(v) => saveMonth(id, i + 1, v)}
                          />
                        ))}
                      </div>
                      <div className="mt-2 flex items-center justify-between text-xs">
                        <span className="text-slate-400">
                          Projected: {money(setting.monthly_estimate != null ? Number(setting.monthly_estimate) * 12 : null)}
                        </span>
                        <span className="font-medium text-slate-600">
                          Collected {year}: <span className="text-slate-900">{money(collected)}</span>
                        </span>
                      </div>
                    </div>

                    {/* Reconciliation */}
                    <div className="rounded-lg bg-slate-50 p-3 space-y-3">
                      <div className="grid grid-cols-3 gap-3 items-end">
                        <Input
                          label="Actual recoverable"
                          type="number"
                          value={draftStr}
                          placeholder="0"
                          disabled={posted}
                          onChange={e => setActualDraft(prev => ({ ...prev, [id]: e.target.value }))}
                          onBlur={e => { if (!posted) saveActual(id, num(e.target.value)) }}
                        />
                        <div className="flex flex-col gap-1">
                          <span className="text-sm font-medium text-slate-700">Collected</span>
                          <div className="px-3 py-2 text-sm text-slate-700">{money(collectedVal)}</div>
                        </div>
                        <div className="flex flex-col gap-1">
                          <span className="text-sm font-medium text-slate-700">True-up</span>
                          <div className={`px-3 py-2 text-sm font-semibold ${
                            trueUp == null ? 'text-slate-400'
                              : trueUp > 0.005 ? 'text-amber-600'
                              : trueUp < -0.005 ? 'text-emerald-600' : 'text-slate-700'
                          }`}>
                            {trueUp == null ? '—'
                              : trueUp > 0.005 ? `${money(trueUp)} owed`
                              : trueUp < -0.005 ? `${money(-trueUp)} credit` : 'Even'}
                          </div>
                        </div>
                      </div>

                      {!posted && suggestion != null && (
                        <p className="text-xs text-slate-500">
                          Paid {label.toLowerCase()} on file:{' '}
                          <span className="font-medium text-slate-700">{money(suggestion)}</span>
                          {Math.abs((effActual ?? NaN) - suggestion) < 0.005 ? (
                            <span className="ml-2 text-emerald-600">✓ prefilled</span>
                          ) : (
                            <button
                              type="button"
                              onClick={() => { setActualDraft(prev => ({ ...prev, [id]: String(suggestion) })); saveActual(id, suggestion) }}
                              className="ml-2 text-blue-600 hover:underline"
                            >
                              Use this amount
                            </button>
                          )}
                        </p>
                      )}

                      <div className="flex items-center justify-between">
                        {posted ? (
                          <span className="flex items-center gap-1.5 text-xs font-medium text-emerald-700">
                            <CheckCircle2 className="w-3.5 h-3.5" />
                            Posted{r.reimbursement_id ? ' — true-up added to Reimbursements' : ' — no balance owed'}
                          </span>
                        ) : (
                          <span className="text-xs text-slate-400">
                            {effActual == null ? 'Enter the actual recoverable amount to reconcile' : 'Draft — not yet posted'}
                          </span>
                        )}
                        {posted ? (
                          <Button
                            variant="secondary"
                            onClick={() => doUnpost(id)}
                            disabled={busy === `unpost:${id}`}
                          >
                            <RotateCcw className="w-3.5 h-3.5 mr-1" />
                            {busy === `unpost:${id}` ? 'Reverting…' : 'Unpost'}
                          </Button>
                        ) : (
                          <Button
                            onClick={() => doPost(id)}
                            disabled={effActual == null || busy === `post:${id}`}
                          >
                            {busy === `post:${id}` ? 'Posting…' : 'Post reconciliation'}
                          </Button>
                        )}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
