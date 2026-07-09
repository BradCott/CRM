import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { useAssistant } from '../../context/AssistantContext'
import { X, Upload, Loader2, CheckCircle, AlertCircle, AlertTriangle, Copy, Check, Users } from 'lucide-react'
import Button from '../ui/Button'
import { uploadSettlement, rebalanceSettlement, createTransactions, saveJournalEntry, getInvestors } from '../../api/client'

// ── Formatters ────────────────────────────────────────────────────────────────

const $fmt = v =>
  v != null && v !== '' && isFinite(Number(v)) && Number(v) !== 0
    ? '$' + Math.abs(Math.round(Number(v))).toLocaleString()
    : '—'

// ── Line-item treatments — how each settlement line is recorded ───────────────

const TREATMENTS = [
  'Purchase Price', 'Buyer Closing Cost', 'Seller Closing Cost', 'Seller Credit',
  'Loan', '1031 Exchange', 'Earnest Money', 'Cash to Close',
  'Tax Proration Credit', 'Rent Proration Credit', 'Insurance Credit', 'CAM Credit',
  'Buyer Taxes Paid', 'Ignore',
]

// Treatment → which roll-up field it aggregates into. (Seller Closing Cost / Ignore = excluded)
const TREATMENT_FIELD = {
  'Purchase Price':        'purchase_price',
  'Seller Credit':         'seller_closing_credit',
  'Buyer Closing Cost':    'total_closing_costs',
  'Buyer Taxes Paid':      'buyer_taxes_paid',
  'Loan':                  'loan_amount',
  '1031 Exchange':         'exchange_proceeds',
  'Earnest Money':         'earnest_money',
  'Cash to Close':         'cash_to_close',
  'Tax Proration Credit':  'tax_credits',
  'Rent Proration Credit': 'prorated_rent',
  'Insurance Credit':      'insurance_credit',
  'CAM Credit':            'cam_credit',
}

const MONEY_FIELD_KEYS = [
  'purchase_price', 'seller_closing_credit', 'total_closing_costs', 'buyer_taxes_paid',
  'loan_amount', 'exchange_proceeds', 'earnest_money', 'cash_to_close',
  'tax_credits', 'prorated_rent', 'insurance_credit', 'cam_credit',
  // specific fee fields are no longer separately booked — closing costs roll into total_closing_costs
  'loan_origination_fee', 'appraisal_fee', 'title_and_closing_fees', 'endorsements_fee',
  'recording_fees', 'survey_fee', 'environmental_fees', 'flood_determination_fee', 'acquisition_fee',
]

/** Recompute the roll-up money fields by summing line items per treatment. */
function deriveFields(baseFields, lineItems) {
  const money = Object.fromEntries(MONEY_FIELD_KEYS.map(k => [k, 0]))
  for (const li of lineItems) {
    const f = TREATMENT_FIELD[li.treatment]
    if (f) money[f] += Number(li.amount) || 0
  }
  return { ...baseFields, ...money }
}

/** Buyer-side reconciliation: does the cash-to-close implied by the lines match the statement's? */
function reconcile(fields) {
  const n = k => Number(fields?.[k]) || 0
  const netPP   = n('purchase_price') - n('seller_closing_credit')
  const credits = n('loan_amount') + n('exchange_proceeds') + n('earnest_money')
    + n('tax_credits') + n('prorated_rent') + n('insurance_credit') + n('cam_credit')
  const expectedCTC = netPP + n('total_closing_costs') + n('buyer_taxes_paid') - credits
  const statedCTC   = n('cash_to_close')
  const gap         = statedCTC - expectedCTC
  const match       = Math.abs(gap) < 2 || statedCTC === 0
  return { netPP, credits, expectedCTC, statedCTC, gap, match }
}

/** Build editable line items from the AI's rigid fields (fallback when the AI returns no line_items). */
function synthesizeLineItems(d) {
  const items = []
  const add = (description, amount, treatment) => { if (Number(amount)) items.push({ description, amount: Number(amount), treatment }) }
  add('Purchase Price / Total Consideration', d.purchase_price, 'Purchase Price')
  add('Seller Closing Credit', d.seller_closing_credit, 'Seller Credit')
  add('Loan Proceeds', d.loan_amount, 'Loan')
  add('1031 Exchange Proceeds', d.exchange_proceeds, '1031 Exchange')
  add('Earnest Money Deposit', d.earnest_money, 'Earnest Money')
  add('Loan Origination Fee', d.loan_origination_fee, 'Buyer Closing Cost')
  add('Appraisal Fee', d.appraisal_fee, 'Buyer Closing Cost')
  add('Title & Closing Fees', d.title_and_closing_fees, 'Buyer Closing Cost')
  add('Title Endorsements', d.endorsements_fee, 'Buyer Closing Cost')
  add('Recording Fees', d.recording_fees, 'Buyer Closing Cost')
  add('Survey Fee', d.survey_fee, 'Buyer Closing Cost')
  add('Environmental (Phase I/II)', d.environmental_fees, 'Buyer Closing Cost')
  add('Flood Determination', d.flood_determination_fee, 'Buyer Closing Cost')
  add('Acquisition / Consulting Fee', d.acquisition_fee, 'Buyer Closing Cost')
  const anyFee = ['loan_origination_fee','appraisal_fee','title_and_closing_fees','endorsements_fee','recording_fees','survey_fee','environmental_fees','flood_determination_fee','acquisition_fee'].some(k => Number(d[k]))
  if (!anyFee) add('Closing Costs (total)', d.total_closing_costs, 'Buyer Closing Cost')
  add('Buyer Taxes Paid at Closing', d.buyer_taxes_paid, 'Buyer Taxes Paid')
  add('Prorated Rent Credit', d.prorated_rent, 'Rent Proration Credit')
  add('Tax Proration Credit', d.tax_credits, 'Tax Proration Credit')
  add('Insurance Credit', d.insurance_credit, 'Insurance Credit')
  add('CAM / Maintenance Credit', d.cam_credit, 'CAM Credit')
  add('Cash to Close', d.cash_to_close, 'Cash to Close')
  for (const u of (d.uncertain_items || [])) add(u.description, u.amount, 'Buyer Closing Cost')
  return items
}

// ── Journal entry builder ─────────────────────────────────────────────────────
//
// Structure (QuickBooks journal entry format):
//
// DEBITS
//   1. [Property Name]  — building asset  (totalBasis × buildingPct%)
//   2. Land             —                  (totalBasis × landPct%)
//   3. [Property Name]  — EMD funded outside LLC (if applicable)
//   4. [Property Name]  — checking acct, equity received (sum of investor contributions)
//
// CREDITS
//   1. MTG [Lender]                        — loan amount
//   2. Rental Income                       — prorated rent (if any)
//   3. Taxes & licenses:Property taxes     — tax proration credit (if any)
//   4. Insurance                           — insurance proration credit (if any)
//   5. Repairs & maintenance               — CAM / maintenance credit (if any)
//   6. Equity - [Investor Name]            — one line per investor (if any)
//   7. [Equity Account]                    — EMD funded outside LLC (if applicable)
//   8. [Property Name]                     — checking acct, cash out (ctc [+ em if inside LLC])
//
// Balance identity:
//   totalBasis = loan + exchange + rent + taxCr + insuranceCr + camCr + bankCashOut
//   where totalBasis = (pp - sellerCr) + closingCosts
//   Equity and EMD-outside-LLC lines are symmetric (debit = credit).

function buildJournal(f, buildingPct, landPct, investors = [], emdOutsideLLC = false, emdEquityAccount = '', propertyName = '') {
  const pp          = Number(f.purchase_price)        || 0
  const sellerCr    = Number(f.seller_closing_credit) || 0
  const closing     = Number(f.total_closing_costs)   || 0
  const loan        = Number(f.loan_amount)           || 0
  const ctc         = Number(f.cash_to_close)         || 0
  const em          = Number(f.earnest_money)         || 0
  const rent        = Number(f.prorated_rent)         || 0
  const taxCr       = Number(f.tax_credits)           || 0
  const insuranceCr = Number(f.insurance_credit)      || 0
  const camCr       = Number(f.cam_credit)            || 0
  const exchange    = Number(f.exchange_proceeds)     || 0
  const lender      = (f.lender_name || '').trim()

  // Account name: CRM property name takes priority over PDF-extracted address
  const addr = propertyName || (f.property_address || '').trim() || 'Property'

  // Net purchase price = total consideration − seller closing credit
  const netPP          = pp - sellerCr
  const totalCostBasis = netPP + closing

  const bPct = Math.max(0, Math.min(100, Number(buildingPct) || 90)) / 100
  const lPct = Math.max(0, Math.min(100, Number(landPct)     || 10)) / 100

  const buildingValue = totalCostBasis * bPct
  const landValue     = totalCostBasis * lPct

  const activeInvestors = (investors || []).filter(inv => Number(inv.contribution) > 0)
  const totalEquity = activeInvestors.reduce((s, inv) => s + Number(inv.contribution), 0)

  const mortgageAccount = lender ? `MTG ${lender}` : `MTG ${addr}`

  // EMD: if funded outside the LLC, it was personal money — show as DEBIT Building + CREDIT equity
  // If inside LLC, it was a normal cash outflow — include in the bank cash credit
  const emdEquity   = emdOutsideLLC ? em  : 0
  const bankCashOut = emdOutsideLLC ? ctc : (ctc + em)
  const equityAcct  = (emdEquityAccount || '').trim() || 'Equity - Contributor'

  // DEBITS
  const debits = [
    buildingValue > 0 && { account: addr,  amount: buildingValue, note: 'Building Asset' },
    landValue > 0     && { account: 'Land', amount: landValue },
    emdEquity > 0     && { account: addr,  amount: emdEquity,    note: 'EMD (funded outside LLC)' },
    totalEquity > 0   && { account: addr,  amount: totalEquity,  note: 'Checking — Equity Received' },
  ].filter(Boolean)

  // CREDITS
  const credits = [
    loan > 0         && { account: mortgageAccount,                   amount: loan },
    exchange > 0     && { account: '1031 Exchange Proceeds',          amount: exchange },
    rent > 0         && { account: 'Rental Income',                   amount: rent },
    taxCr > 0        && { account: 'Taxes & licenses:Property taxes', amount: taxCr },
    insuranceCr > 0  && { account: 'Insurance',                       amount: insuranceCr },
    camCr > 0        && { account: 'Repairs & maintenance',           amount: camCr },
    ...activeInvestors.map(inv => ({ account: `Equity - ${inv.name}`, amount: Number(inv.contribution) })),
    emdEquity > 0    && { account: equityAcct,                        amount: emdEquity },
    bankCashOut > 0  && { account: addr,                              amount: bankCashOut, note: 'Checking — Cash to Close' },
  ].filter(Boolean)

  const totalDebits  = debits.reduce((s, d) => s + d.amount, 0)
  const totalCredits = credits.reduce((s, c) => s + c.amount, 0)
  const diff = totalDebits - totalCredits

  return { debits, credits, totalDebits, totalCredits, diff, totalCostBasis, netPP, buildingValue, landValue }
}

// ── Clipboard copy (QuickBooks-pasteable table) ───────────────────────────────

function buildClipboardText(journal, fields, date, propertyName = '') {
  const addr = propertyName || (fields.property_address || '').trim()
  const COL  = 50
  const NUM  = 16
  const fmt  = n => (n != null ? '$' + Math.round(n).toLocaleString() : '')

  const rows = [
    ...journal.debits.map(d  => ({ account: d.account, debit: d.amount, credit: null })),
    ...journal.credits.map(c => ({ account: c.account, debit: null,     credit: c.amount })),
  ]

  return [
    'ACQUISITION JOURNAL ENTRY',
    date  ? `Date: ${date}`        : null,
    addr  ? `Property: ${addr}`    : null,
    '',
    `${'Account Name'.padEnd(COL)} ${'Debit'.padStart(NUM)} ${'Credit'.padStart(NUM)}`,
    '-'.repeat(COL + NUM * 2 + 2),
    ...rows.map(r =>
      `${r.account.padEnd(COL)} ${(r.debit  != null ? fmt(r.debit)  : '').padStart(NUM)} ${(r.credit != null ? fmt(r.credit) : '').padStart(NUM)}`
    ),
    '-'.repeat(COL + NUM * 2 + 2),
    `${'TOTALS'.padEnd(COL)} ${fmt(journal.totalDebits).padStart(NUM)} ${fmt(journal.totalCredits).padStart(NUM)}`,
    '',
    Math.abs(journal.diff) < 1
      ? 'Balanced: Yes'
      : `Difference: ${fmt(Math.abs(journal.diff))} (${journal.diff > 0 ? 'debits exceed credits' : 'credits exceed debits'})`,
  ].filter(l => l !== null).join('\n')
}

// ── Reconstructed settlement statement (review panel) ─────────────────────────
// Rebuilds the whole statement from every extracted line item, shows how each
// subtotal adds up, and reconciles cash-to-close so it's obvious what balances.

const money = v => {
  const n = Number(v) || 0
  const s = '$' + Math.abs(Math.round(n)).toLocaleString()
  return n < 0 ? `(${s})` : s
}

// [field key, label, hover explanation]
const CLOSING_COST_ITEMS = [
  ['loan_origination_fee',    'Loan Origination Fee',        'Lender fee / points to originate the mortgage'],
  ['appraisal_fee',           'Appraisal Fee',               'Property valuation ordered by the lender'],
  ['title_and_closing_fees',  'Title & Closing Fees',        'Title insurance, escrow, settlement, closing, notary, wire, doc prep'],
  ['endorsements_fee',        'Title Endorsements',          'ALTA / zoning and other title policy endorsements'],
  ['recording_fees',          'Recording Fees',              'County fees to record the deed and mortgage'],
  ['survey_fee',              'Survey Fee',                  'Boundary / ALTA survey'],
  ['environmental_fees',      'Environmental (Phase I/II)',  'Phase I ESA, PCA, or other environmental reports'],
  ['flood_determination_fee', 'Flood Determination',         'Flood zone certification'],
  ['acquisition_fee',         'Acquisition Fee',             'Fee paid to Knox Capital at closing'],
]

const CREDIT_ITEMS = [
  ['loan_amount',        'Loan Proceeds',          'New mortgage from the lender — reduces cash needed'],
  ['exchange_proceeds',  '1031 Exchange Proceeds', 'Funds from a Qualified Intermediary applied to the purchase'],
  ['earnest_money',      'Earnest Money (already paid)', 'Deposit paid before closing — credited against cash to close'],
  ['prorated_rent',      'Prorated Rent Credit',   "Seller's rent owed to you for the closing month"],
  ['tax_credits',        'Tax Proration Credit',   "Seller's share of unpaid property taxes, credited to you"],
  ['insurance_credit',   'Insurance Credit',       'Insurance escrow / proration credited to you'],
  ['cam_credit',         'CAM / Maintenance Credit', 'CAM or reserve credit from the seller'],
]

function StmtRow({ label, hint, value, sub, strong, indent, sign }) {
  const n = Number(value) || 0
  return (
    <div className={`flex items-start justify-between py-1.5 ${indent ? 'pl-4' : ''} ${strong ? 'border-t border-slate-200 mt-0.5' : 'border-b border-slate-100'}`}>
      <div className="flex items-center gap-1.5 min-w-0">
        <span className={`text-xs ${strong ? 'font-semibold text-slate-800' : 'text-slate-600'}`}>{label}</span>
        {hint && (
          <span className="group relative inline-flex">
            <AlertCircle className="w-3 h-3 text-slate-300 hover:text-slate-500 cursor-help shrink-0" />
            <span className="pointer-events-none absolute left-1/2 -translate-x-1/2 bottom-full mb-1 w-52 px-2.5 py-1.5 rounded-lg bg-slate-800 text-white text-[10px] leading-snug opacity-0 group-hover:opacity-100 transition-opacity z-20 shadow-lg">
              {hint}
            </span>
          </span>
        )}
      </div>
      <span className={`text-xs tabular-nums shrink-0 ml-3 ${strong ? 'font-bold text-slate-900' : 'text-slate-700'}`}>
        {sign === '-' ? `(${money(value).replace(/[()]/g, '')})` : money(value)}
        {sub && <span className="block text-[10px] text-slate-400 font-normal">{sub}</span>}
      </span>
    </div>
  )
}

const TREATMENT_ORDER = [
  'Purchase Price', 'Seller Credit', 'Buyer Closing Cost', 'Buyer Taxes Paid',
  'Loan', '1031 Exchange', 'Earnest Money', 'Tax Proration Credit',
  'Rent Proration Credit', 'Insurance Credit', 'CAM Credit', 'Cash to Close',
  'Seller Closing Cost', 'Ignore',
]

function ReconstructedStatement({ lineItems, fields }) {
  const n = k => Number(fields[k]) || 0

  const groups = TREATMENT_ORDER
    .map(t => ({ t, lines: lineItems.filter(li => li.treatment === t) }))
    .filter(g => g.lines.length)
  const subtotal = lines => lines.reduce((s, l) => s + (Number(l.amount) || 0), 0)

  const { netPP, credits, expectedCTC, statedCTC, gap: ctcGap, match: ctcMatch } = reconcile(fields)

  return (
    <div className="border border-slate-200 rounded-xl overflow-hidden">
      <div className="px-4 py-2.5 bg-slate-800 text-white">
        <p className="text-xs font-semibold uppercase tracking-wide">Reconstructed Settlement Statement</p>
        <p className="text-[10px] text-slate-300 mt-0.5">Every line, grouped by how it's being recorded. Edit any line above to change how it's grouped here. Review only.</p>
      </div>

      <div className="px-4 py-3 grid md:grid-cols-2 gap-x-6">
        <div>
          {groups.map(g => (
            <div key={g.t} className="mb-2">
              <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-0.5">{g.t}</p>
              {g.lines.map((l, i) => (
                <StmtRow key={i} label={l.description} value={l.amount} indent />
              ))}
              {g.lines.length > 1 && <StmtRow label={`${g.t} subtotal`} value={subtotal(g.lines)} strong />}
            </div>
          ))}
        </div>

        {/* Cash to close reconciliation */}
        <div>
          <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">Cash to Close — reconciliation</p>
          <StmtRow label="Net Purchase Price" hint="Purchase price minus any seller credit" value={netPP} indent />
          <StmtRow label="+ Total Closing Costs (buyer)" value={n('total_closing_costs')} indent />
          {n('buyer_taxes_paid') !== 0 && <StmtRow label="+ Buyer Taxes Paid at Closing" value={n('buyer_taxes_paid')} indent />}
          <StmtRow label="− Loan, exchange, earnest & prorations" hint="Everything that reduces the cash you bring to closing" value={credits} sign="-" indent />
          <StmtRow label="Expected Cash to Close" value={expectedCTC} strong />
          <div className={`mt-1.5 flex items-start gap-1.5 px-2 py-1.5 rounded-lg text-[11px] ${ctcMatch ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'}`}>
            {statedCTC === 0
              ? <><AlertCircle className="w-3 h-3 shrink-0 mt-0.5" /> No "Cash to Close" line — expected about {money(expectedCTC)}. Add or fix a line above.</>
              : ctcMatch
                ? <><Check className="w-3 h-3 shrink-0 mt-0.5" /> Balances — matches the statement's cash to close ({money(statedCTC)})</>
                : <><AlertTriangle className="w-3 h-3 shrink-0 mt-0.5" /> Off by {money(Math.abs(ctcGap))}: statement says {money(statedCTC)}, the lines add up to {money(expectedCTC)}. Re-check a line's amount or treatment above.</>
            }
          </div>
        </div>
      </div>
    </div>
  )
}

// ── Editable line-item table — change how every settlement line is recorded ───

function LineItemsEditor({ lineItems, setLineItems }) {
  const update = (i, field, val) => setLineItems(prev => prev.map((li, j) =>
    j === i ? { ...li, [field]: field === 'amount' ? (val === '' ? '' : Number(val)) : val } : li))
  const remove = i => setLineItems(prev => prev.filter((_, j) => j !== i))
  const add = () => setLineItems(prev => [...prev, { description: '', amount: '', treatment: 'Buyer Closing Cost' }])

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <div>
          <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Line Items</h3>
          <p className="text-[11px] text-slate-400">The AI guessed how to record each line — change any of them. Everything rolls up automatically.</p>
        </div>
        <button onClick={add} className="text-xs font-medium text-blue-600 hover:text-blue-800 border border-blue-200 hover:bg-blue-50 rounded-lg px-2.5 py-1.5 transition-colors">+ Add line</button>
      </div>

      <div className="border border-slate-200 rounded-xl overflow-hidden">
        <table className="w-full text-xs border-collapse">
          <thead>
            <tr className="bg-slate-50 border-b border-slate-200">
              <th className="text-left px-3 py-2 font-semibold text-slate-500 uppercase tracking-wide">Description</th>
              <th className="text-right px-3 py-2 font-semibold text-slate-500 uppercase tracking-wide w-28">Amount</th>
              <th className="text-left px-3 py-2 font-semibold text-slate-500 uppercase tracking-wide w-44">Record as</th>
              <th className="w-8" />
            </tr>
          </thead>
          <tbody>
            {lineItems.length === 0 && (
              <tr><td colSpan={4} className="px-3 py-4 text-center text-slate-400">No line items — click "Add line" to enter them.</td></tr>
            )}
            {lineItems.map((li, i) => {
              const excluded = li.treatment === 'Seller Closing Cost' || li.treatment === 'Ignore'
              return (
                <tr key={i} className={`border-b border-slate-100 ${excluded ? 'opacity-50' : ''}`}>
                  <td className="px-2 py-1.5">
                    <input type="text" value={li.description}
                      onChange={e => update(i, 'description', e.target.value)}
                      placeholder="Line description"
                      className="w-full text-xs border border-transparent hover:border-slate-200 focus:border-blue-300 rounded px-2 py-1 outline-none focus:ring-2 focus:ring-blue-200" />
                  </td>
                  <td className="px-2 py-1.5">
                    <input type="number" value={li.amount}
                      onChange={e => update(i, 'amount', e.target.value)}
                      className="w-full text-xs text-right tabular-nums border border-transparent hover:border-slate-200 focus:border-blue-300 rounded px-2 py-1 outline-none focus:ring-2 focus:ring-blue-200" />
                  </td>
                  <td className="px-2 py-1.5">
                    <select value={li.treatment}
                      onChange={e => update(i, 'treatment', e.target.value)}
                      className="w-full text-xs border border-slate-200 rounded px-1.5 py-1 bg-white outline-none focus:ring-2 focus:ring-blue-300">
                      {TREATMENTS.map(t => <option key={t} value={t}>{t}</option>)}
                    </select>
                  </td>
                  <td className="px-1 py-1.5 text-center">
                    <button onClick={() => remove(i)} className="text-slate-300 hover:text-red-500"><X className="w-3.5 h-3.5" /></button>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      <p className="text-[10px] text-slate-400 mt-1.5">
        "Buyer Closing Cost" capitalizes into your cost basis. "Seller Closing Cost" and "Ignore" are left out of your books.
      </p>
    </div>
  )
}

// ── Uncertain items — category map + helpers ──────────────────────────────────

const FIELD_MAP = {
  'Loan Amount':       'loan_amount',
  'Buyer Closing Costs':  'total_closing_costs',
  'Seller Closing Costs': null,
  '1031 Exchange':     'exchange_proceeds',
  'Cash to Close':     'cash_to_close',
  'Earnest Money':     'earnest_money',
  'Seller Credit':     'seller_closing_credit',
  'Prorated Rent':     'prorated_rent',
  'Tax Proration':     'tax_credits',
  'Insurance Credit':  'insurance_credit',
  'CAM Credit':        'cam_credit',
  'Ignore':            null,
}

/** Returns true if the item description looks like a broker/agent commission. */
function isBrokerFee(description) {
  if (!description) return false
  const d = description.toLowerCase()
  return d.includes('commission') || d.includes('broker') || d.includes('realty') || d.includes('agent fee')
}

/** Map AI suggestion + description text to one of the FIELD_MAP keys. */
function guessCategory(suggestion, description) {
  if (isBrokerFee(description)) return 'Seller Closing Costs'
  const s = `${suggestion || ''} ${description || ''}`.toLowerCase()
  if (!s.trim()) return 'Buyer Closing Costs'
  if (s.includes('1031') || s.includes('exchange') || s.includes('intermediary') || s.includes('qi deposit')) return '1031 Exchange'
  if (s.includes('loan') || s.includes('mortgage') || s.includes('principal')) return 'Loan Amount'
  if (s.includes('earnest'))                                                     return 'Earnest Money'
  if (s.includes('seller') && s.includes('credit'))                            return 'Seller Credit'
  if (s.includes('rent'))                                                        return 'Prorated Rent'
  if (s.includes('insurance'))                                                   return 'Insurance Credit'
  if (s.includes('cam') || s.includes('maintenance'))                          return 'CAM Credit'
  if (s.includes('proration') || (s.includes('tax') && s.includes('credit')))  return 'Tax Proration'
  if (s.includes('cash') && s.includes('clos'))                                return 'Cash to Close'
  // Fee-like line items → buyer closing cost (the common case for flagged items)
  if (/closing cost|\bfee\b|phase|environmental|survey|title|recording|appraisal|endorsement|travel|inspection|escrow|flood|settlement charge|notary|wire|courier|search|exam|abstract/.test(s))
    return 'Buyer Closing Costs'
  return 'Buyer Closing Costs'
}

/** A single uncertain-item row. */
function UncertainItem({ item, onAssign }) {
  const [selection, setSelection] = useState(() => guessCategory(item.suggestion, item.description))
  const brokerFee = isBrokerFee(item.description)

  return (
    <div className="bg-white border border-amber-100 rounded-lg px-3 py-2.5">
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-baseline gap-2 flex-wrap">
            <span className="text-sm font-medium text-slate-800">{item.description}</span>
            <span className="text-sm font-bold text-slate-900 tabular-nums">{$fmt(item.amount)}</span>
          </div>
          {item.suggestion && (
            <p className="text-xs text-amber-700 mt-0.5">
              AI guess: <span className="font-medium">{item.suggestion}</span>
            </p>
          )}
          {item.reason && (
            <p className="text-xs text-slate-400 mt-0.5 italic">{item.reason}</p>
          )}
        </div>
        <div className="flex flex-col items-end gap-1.5 shrink-0 mt-0.5">
          <div className="flex items-center gap-2">
            <select
              value={selection}
              onChange={e => setSelection(e.target.value)}
              className="text-xs border border-slate-200 rounded px-2 py-1 outline-none focus:ring-2 focus:ring-amber-300 bg-white text-slate-700"
            >
              {Object.keys(FIELD_MAP).map(cat => (
                <option key={cat} value={cat}>{cat}</option>
              ))}
            </select>
            <button
              onClick={() => onAssign(selection, item.amount)}
              className="text-xs px-3 py-1 bg-amber-500 text-white rounded-lg hover:bg-amber-600 active:bg-amber-700 font-semibold transition-colors whitespace-nowrap"
            >
              Assign
            </button>
          </div>
          {brokerFee && (
            <p className="text-xs text-slate-500 max-w-xs text-right">
              <span className="font-medium text-slate-600">Note:</span>{' '}
              If you are the buyer this is typically a seller expense and can be ignored.
            </p>
          )}
        </div>
      </div>
    </div>
  )
}

/** Yellow review panel for uncertain items. */
function UncertainItemsPanel({ items, onAssign }) {
  if (!items || items.length === 0) return null
  return (
    <div className="px-4 py-3 bg-amber-50 border border-amber-200 rounded-xl space-y-2">
      <div className="flex items-start gap-2 mb-1">
        <AlertTriangle className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" />
        <div>
          <span className="text-sm font-semibold text-amber-800">
            {items.length} item{items.length !== 1 ? 's' : ''} flagged for review
          </span>
          <p className="text-xs text-amber-700 mt-0.5">
            Assign each item — most flagged fees (Phase I, travel, survey, etc.) are <span className="font-medium">Buyer Closing Costs</span>. Use Seller Closing Costs or Ignore for items that aren't yours.
          </p>
        </div>
      </div>
      {items.map((item, idx) => (
        <UncertainItem
          key={`${item.description}-${item.amount}-${idx}`}
          item={item}
          onAssign={(category, amount) => onAssign(idx, category, amount)}
        />
      ))}
    </div>
  )
}

// ── Field components ──────────────────────────────────────────────────────────

function Field({ label, value, onChange, hint }) {
  return (
    <div className="flex items-center justify-between py-1.5 border-b border-slate-100 last:border-0">
      <div className="shrink-0 mr-3">
        <span className="text-xs text-slate-500">{label}</span>
        {hint && <p className="text-[10px] text-slate-400">{hint}</p>}
      </div>
      <div className="flex items-center gap-1">
        <span className="text-xs text-slate-400">$</span>
        <input
          type="number" min="0"
          value={value ?? ''}
          onChange={e => onChange(e.target.value === '' ? null : Number(e.target.value))}
          className="w-32 text-right text-sm font-medium text-slate-900 border border-slate-200 rounded px-2 py-0.5 outline-none focus:ring-2 focus:ring-blue-300 tabular-nums"
          placeholder="—"
        />
      </div>
    </div>
  )
}

function TextField({ label, value, onChange, hint }) {
  return (
    <div className="flex items-center justify-between py-1.5 border-b border-slate-100 last:border-0">
      <div className="shrink-0 mr-3">
        <span className="text-xs text-slate-500">{label}</span>
        {hint && <p className="text-[10px] text-slate-400">{hint}</p>}
      </div>
      <input
        type="text"
        value={value ?? ''}
        onChange={e => onChange(e.target.value || null)}
        className="w-40 text-right text-sm font-medium text-slate-900 border border-slate-200 rounded px-2 py-0.5 outline-none focus:ring-2 focus:ring-blue-300"
        placeholder="—"
      />
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

export default function SettlementUpload({ propertyId, property, onSaved, onClose }) {
  const inputRef = useRef()
  const [step, setStep]               = useState('upload')
  const [error, setError]             = useState(null)
  const [fields, setFields]           = useState(null)
  const [buildingPct, setBuildingPct] = useState(90)
  const [landPct, setLandPct]         = useState(10)
  const [copied, setCopied]           = useState(false)
  const [dragOver, setDragOver]       = useState(false)
  const [investors, setInvestors]     = useState([])
  const [lineItems, setLineItems]     = useState([])
  const [emdOutsideLLC, setEmdOutsideLLC]   = useState(false)
  const [emdEquityAccount, setEmdEquityAccount] = useState('')
  const [file, setFile]               = useState(null)      // kept so we can re-send for AI rebalance
  const [rebalancing, setRebalancing] = useState(false)
  const [suggestion, setSuggestion]   = useState(null)      // { reconciles, explanation, changes, line_items }

  // CRM property name used as QuickBooks account name
  const propertyName = property?.address || ''

  const setField = useCallback((key, val) => setFields(prev => ({ ...prev, [key]: val })), [])

  // Roll-up money fields are derived from the editable line items
  const derived = useMemo(() => fields ? deriveFields(fields, lineItems) : null, [fields, lineItems])

  useEffect(() => {
    getInvestors(propertyId)
      .then(data => setInvestors(Array.isArray(data) ? data : []))
      .catch(() => setInvestors([]))
  }, [propertyId])

  // Feed the parsed settlement statement to the copilot so it can advise on it
  const { setAssistantContext } = useAssistant()
  useEffect(() => {
    if (!fields) { setAssistantContext(''); return }
    const items = lineItems.length
      ? lineItems.map(li => `  - "${li.description}" $${li.amount} → recorded as ${li.treatment}`).join('\n')
      : '(none)'
    setAssistantContext(
      `The user is reviewing a parsed SETTLEMENT STATEMENT for property "${propertyName}".\n` +
      `Line items (each can be re-assigned by the user):\n${items}`
    )
    return () => setAssistantContext('')
  }, [fields, lineItems, propertyName, setAssistantContext])

  async function handleFile(file) {
    if (!file) return
    setFile(file)
    setSuggestion(null)
    setStep('parsing')
    setError(null)
    try {
      const data = await uploadSettlement(propertyId, file)
      setFields({ ...data, depreciation_expense: 0 })
      setLineItems(Array.isArray(data.line_items) && data.line_items.length
        ? data.line_items
        : synthesizeLineItems(data))
      setStep('review')
    } catch (err) {
      setError(err.message)
      setStep('upload')
    }
  }

  // Buyer-side reconciliation on the current (edited) line items
  const rec       = derived ? reconcile(derived) : null
  const balanced  = rec ? rec.match : true

  async function handleRebalance() {
    if (!file || !rec) return
    setRebalancing(true)
    setError(null)
    setSuggestion(null)
    try {
      const r = await rebalanceSettlement(propertyId, file, {
        line_items:    lineItems,
        cash_to_close: rec.statedCTC,
        expected:      rec.expectedCTC,
        gap:           rec.gap,
      })
      setSuggestion(r)
    } catch (err) {
      setError(err.message)
    } finally {
      setRebalancing(false)
    }
  }

  function applySuggestion() {
    if (suggestion?.line_items?.length) setLineItems(suggestion.line_items)
    setSuggestion(null)
  }

  const sellerCr       = derived ? (Number(derived.seller_closing_credit) || 0) : 0
  const pp             = derived ? (Number(derived.purchase_price)        || 0) : 0
  const netPurchasePrice = pp - sellerCr
  const totalCostBasis   = derived
    ? netPurchasePrice + (Number(derived.total_closing_costs) || 0)
    : 0

  const journal = derived
    ? buildJournal(derived, buildingPct, landPct, investors, emdOutsideLLC, emdEquityAccount, propertyName)
    : null

  async function handleSave() {
    if (!derived) return
    setStep('saving')
    setError(null)
    try {
      const date    = fields.settlement_date || new Date().toISOString().slice(0, 10)
      const cb      = totalCostBasis
      const bPct    = (Number(buildingPct) || 90) / 100
      const lPct    = (Number(landPct)     || 10) / 100

      // Closing costs are capitalized into the building/land basis (cb already
      // includes total_closing_costs); financing, prorations and cash post separately.
      const txs = [
        cb > 0                            && { description: 'Building Value',          category: 'Purchase', amount: -(cb * bPct) },
        cb > 0                            && { description: 'Land Value',              category: 'Purchase', amount: -(cb * lPct) },
        derived.loan_amount               && { description: 'Loan Proceeds',           category: 'Loan',     amount:  Number(derived.loan_amount) },
        derived.exchange_proceeds         && { description: '1031 Exchange Proceeds',  category: 'Loan',     amount:  Number(derived.exchange_proceeds) },
        derived.earnest_money             && { description: 'Earnest Money Deposit',   category: 'Purchase', amount: -Number(derived.earnest_money) },
        derived.cash_to_close             && { description: 'Cash to Close',           category: 'Purchase', amount: -Number(derived.cash_to_close) },
        derived.buyer_taxes_paid          && { description: 'Property Taxes Paid at Closing', category: 'Purchase', amount: -Number(derived.buyer_taxes_paid) },
        derived.prorated_rent             && { description: 'Prorated Rent Credit',    category: 'Rent',     amount:  Number(derived.prorated_rent) },
        derived.tax_credits               && { description: 'Property Tax Proration',  category: 'Other',    amount:  Number(derived.tax_credits) },
        derived.insurance_credit          && { description: 'Insurance Proration Credit', category: 'Other', amount:  Number(derived.insurance_credit) },
        derived.cam_credit                && { description: 'CAM / Maintenance Credit', category: 'Other',   amount:  Number(derived.cam_credit) },
      ].filter(Boolean).map(t => ({ ...t, date, source: 'Settlement Statement' }))

      if (txs.length > 0) await createTransactions(propertyId, txs)

      await saveJournalEntry(propertyId, {
        entry_type: 'acquisition',
        entry_date: date,
        label:      propertyName || fields.property_address || 'Acquisition',
        content:    buildClipboardText(journal, derived, date, propertyName),
      })

      onSaved()
      onClose()
    } catch (err) {
      setError(err.message)
      setStep('review')
    }
  }

  function handleCopy() {
    if (!journal || !derived) return
    navigator.clipboard.writeText(buildClipboardText(journal, derived, fields.settlement_date, propertyName)).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-5xl max-h-[92vh] flex flex-col">

        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 shrink-0">
          <div>
            <h2 className="text-base font-semibold text-slate-900">Settlement Statement</h2>
            <p className="text-xs text-slate-500 mt-0.5">
              {step === 'upload'  && 'Upload a PDF — supports First American Title and HUD-1 formats'}
              {step === 'parsing' && 'AI is reading your settlement statement…'}
              {step === 'review'  && 'Review extracted fields and journal entry before saving'}
              {step === 'saving'  && 'Saving to ledger…'}
            </p>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-6 py-5">
          {error && (
            <div className="mb-4 flex items-start gap-2 px-4 py-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
              <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
              {error}
            </div>
          )}

          {/* ── Upload / Parsing ── */}
          {(step === 'upload' || step === 'parsing') && (
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
                  <p className="text-xs text-slate-400 mt-1">This may take a few seconds</p>
                </>
              ) : (
                <>
                  <Upload className={`w-10 h-10 mx-auto mb-3 ${dragOver ? 'text-blue-400' : 'text-slate-300'}`} />
                  <p className="text-sm font-medium text-slate-700">{dragOver ? 'Release to upload' : 'Drop PDF or click to browse'}</p>
                  <p className="text-xs text-slate-400 mt-1">First American Title or HUD-1 format</p>
                </>
              )}
            </div>
          )}

          {/* ── Review ── */}
          {(step === 'review' || step === 'saving') && fields && (
            <div className="space-y-5">

              {/* Property / date banner */}
              {(propertyName || fields.property_address || fields.settlement_date) && (
                <div className="px-4 py-3 bg-slate-50 rounded-lg text-sm text-slate-600">
                  {(propertyName || fields.property_address) && (
                    <span className="font-medium text-slate-800">{propertyName || fields.property_address}</span>
                  )}
                  {fields.settlement_date && (
                    <span className="ml-3 text-slate-400">
                      · Closed {new Date(fields.settlement_date + 'T00:00:00').toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' })}
                    </span>
                  )}
                </div>
              )}

              {/* Uncertain items review panel */}
              {/* Editable line items — the heart of the review */}
              <LineItemsEditor lineItems={lineItems} setLineItems={setLineItems} />

              <div className="grid grid-cols-2 gap-6">

                {/* ── LEFT: Extracted Fields ── */}
                <div className="space-y-4">

                  {/* Derived summary — rolls up from the line items above */}
                  <div>
                    <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">Summary (from line items)</h3>
                    <div className="bg-slate-50 rounded-xl px-4 py-2">
                      <div className="flex items-center justify-between py-1.5 border-b border-slate-100">
                        <span className="text-xs text-slate-500">Net Purchase Price</span>
                        <span className="text-sm font-medium text-slate-700 tabular-nums">{$fmt(netPurchasePrice)}</span>
                      </div>
                      <div className="flex items-center justify-between py-1.5 border-b border-slate-100">
                        <span className="text-xs text-slate-500">Total Closing Costs (buyer)</span>
                        <span className="text-sm font-medium text-slate-700 tabular-nums">{$fmt(derived?.total_closing_costs)}</span>
                      </div>
                      <div className="flex items-center justify-between py-1.5 border-b border-slate-100">
                        <span className="text-xs text-slate-500">Loan Amount</span>
                        <span className="text-sm font-medium text-slate-700 tabular-nums">{$fmt(derived?.loan_amount)}</span>
                      </div>
                      <div className="flex items-center justify-between py-1.5">
                        <span className="text-xs text-slate-500">Cash to Close</span>
                        <span className="text-sm font-medium text-slate-700 tabular-nums">{$fmt(derived?.cash_to_close)}</span>
                      </div>
                      <div className="flex items-center justify-between py-2 border-t-2 border-slate-200 mt-0.5">
                        <span className="text-xs font-semibold text-slate-700">Total Cost Basis</span>
                        <span className="text-sm font-bold text-slate-900 tabular-nums">{$fmt(totalCostBasis)}</span>
                      </div>
                    </div>
                    <div className="mt-2">
                      <TextField label="Lender Name" value={fields.lender_name} onChange={v => setField('lender_name', v)} hint="QuickBooks mortgage liability account" />
                    </div>
                  </div>

                  {/* EMD source */}
                  <div>
                    <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">EMD Source</h3>
                    <div className="bg-slate-50 rounded-xl px-4 py-3 space-y-2">
                      <label className="flex items-center gap-2.5 cursor-pointer select-none">
                        <div
                          onClick={() => setEmdOutsideLLC(v => !v)}
                          className={`w-9 h-5 rounded-full transition-colors shrink-0 ${emdOutsideLLC ? 'bg-blue-500' : 'bg-slate-300'}`}
                        >
                          <div className={`w-4 h-4 bg-white rounded-full shadow mt-0.5 transition-transform ${emdOutsideLLC ? 'translate-x-4.5' : 'translate-x-0.5'}`} />
                        </div>
                        <span className="text-xs text-slate-700">EMD was funded outside the LLC</span>
                      </label>
                      {emdOutsideLLC && (
                        <div className="pt-1">
                          <p className="text-[10px] text-slate-500 mb-1.5">
                            Adds DEBIT Building + CREDIT equity for the EMD amount — removes EMD from bank cash credit.
                          </p>
                          <div className="flex items-center justify-between">
                            <span className="text-xs text-slate-500 shrink-0 mr-3">Equity Account</span>
                            <input
                              type="text"
                              value={emdEquityAccount}
                              onChange={e => setEmdEquityAccount(e.target.value)}
                              placeholder="e.g. Equity - Brad Cottam"
                              className="flex-1 text-right text-xs border border-slate-200 rounded px-2 py-1 outline-none focus:ring-2 focus:ring-blue-300"
                            />
                          </div>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Building / Land Split */}
                  <div>
                    <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">Building / Land Split</h3>
                    <div className="bg-slate-50 rounded-xl px-4 py-2">
                      <div className="flex items-center justify-between py-1.5 border-b border-slate-100">
                        <span className="text-xs text-slate-500">Building %</span>
                        <div className="flex items-center gap-2">
                          <input
                            type="number" min="0" max="100"
                            value={buildingPct}
                            onChange={e => { const v = Math.max(0, Math.min(100, Number(e.target.value))); setBuildingPct(v); setLandPct(100 - v) }}
                            className="w-16 text-right text-sm font-medium border border-slate-200 rounded px-2 py-0.5 outline-none focus:ring-2 focus:ring-blue-300"
                          />
                          <span className="text-xs text-slate-400">%</span>
                          <span className="text-xs font-medium text-slate-600 tabular-nums w-24 text-right">{$fmt(totalCostBasis * buildingPct / 100)}</span>
                        </div>
                      </div>
                      <div className="flex items-center justify-between py-1.5">
                        <span className="text-xs text-slate-500">Land %</span>
                        <div className="flex items-center gap-2">
                          <input
                            type="number" min="0" max="100"
                            value={landPct}
                            onChange={e => { const v = Math.max(0, Math.min(100, Number(e.target.value))); setLandPct(v); setBuildingPct(100 - v) }}
                            className="w-16 text-right text-sm font-medium border border-slate-200 rounded px-2 py-0.5 outline-none focus:ring-2 focus:ring-blue-300"
                          />
                          <span className="text-xs text-slate-400">%</span>
                          <span className="text-xs font-medium text-slate-600 tabular-nums w-24 text-right">{$fmt(totalCostBasis * landPct / 100)}</span>
                        </div>
                      </div>
                      {(buildingPct + landPct) !== 100 && (
                        <p className="text-xs text-amber-600 pt-1.5 border-t border-slate-100 mt-0.5">
                          ⚠ Percentages must add to 100%
                        </p>
                      )}
                    </div>
                  </div>

                  {/* Investors indicator */}
                  {investors.length > 0 ? (
                    <div className="flex items-center gap-2 px-3 py-2 bg-emerald-50 border border-emerald-200 rounded-lg text-xs text-emerald-700">
                      <Users className="w-3.5 h-3.5 shrink-0" />
                      <span>
                        <span className="font-semibold">{investors.length} investor{investors.length !== 1 ? 's' : ''} loaded</span>
                        {' — equity lines included in journal entry'}
                      </span>
                    </div>
                  ) : (
                    <div className="flex items-center gap-2 px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-xs text-slate-400">
                      <Users className="w-3.5 h-3.5 shrink-0" />
                      <span>No investors uploaded — equity lines will be omitted</span>
                    </div>
                  )}
                </div>

                {/* ── RIGHT: Journal Entry ── */}
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wide">QuickBooks Journal Entry</h3>
                    <button
                      onClick={handleCopy}
                      className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border border-slate-200 hover:bg-slate-50 text-slate-600 transition-colors"
                    >
                      {copied ? <Check className="w-3.5 h-3.5 text-emerald-500" /> : <Copy className="w-3.5 h-3.5" />}
                      {copied ? 'Copied!' : 'Copy'}
                    </button>
                  </div>

                  {journal && (
                    <div className="border border-slate-200 rounded-xl overflow-hidden text-xs">
                      <table className="w-full border-collapse">
                        <thead>
                          <tr className="bg-slate-50 border-b border-slate-200">
                            <th className="text-left px-3 py-2 font-semibold text-slate-500 uppercase tracking-wide">Account Name</th>
                            <th className="text-right px-3 py-2 font-semibold text-slate-500 uppercase tracking-wide w-24">Debit</th>
                            <th className="text-right px-3 py-2 font-semibold text-slate-500 uppercase tracking-wide w-24">Credit</th>
                          </tr>
                        </thead>
                        <tbody>
                          {journal.debits.map((d, i) => (
                            <tr key={`d${i}`} className="border-b border-slate-100">
                              <td className="px-3 py-1.5">
                                <span className="text-slate-800 font-medium">{d.account}</span>
                                {d.note && <span className="ml-1.5 text-slate-400 text-[10px] font-normal">({d.note})</span>}
                              </td>
                              <td className="px-3 py-1.5 text-right text-slate-900 font-medium tabular-nums">{$fmt(d.amount)}</td>
                              <td className="px-3 py-1.5 text-right text-slate-300">—</td>
                            </tr>
                          ))}
                          {journal.credits.map((c, i) => (
                            <tr key={`c${i}`} className="border-b border-slate-100 bg-slate-50/50">
                              <td className="px-3 py-1.5 pl-5">
                                <span className="text-slate-700">{c.account}</span>
                                {c.note && <span className="ml-1.5 text-slate-400 text-[10px]">({c.note})</span>}
                              </td>
                              <td className="px-3 py-1.5 text-right text-slate-300">—</td>
                              <td className="px-3 py-1.5 text-right text-slate-900 font-medium tabular-nums">{$fmt(c.amount)}</td>
                            </tr>
                          ))}
                        </tbody>
                        <tfoot>
                          <tr className="border-t-2 border-slate-300 bg-slate-50">
                            <td className="px-3 py-2 font-semibold text-slate-700 text-xs">Totals</td>
                            <td className="px-3 py-2 text-right font-bold text-slate-900 tabular-nums">{$fmt(journal.totalDebits)}</td>
                            <td className="px-3 py-2 text-right font-bold text-slate-900 tabular-nums">{$fmt(journal.totalCredits)}</td>
                          </tr>
                          <tr>
                            <td colSpan={3} className={`px-3 py-2 text-center text-xs font-semibold ${Math.abs(journal.diff) < 1 ? 'text-emerald-600 bg-emerald-50' : 'text-red-600 bg-red-50'}`}>
                              {Math.abs(journal.diff) < 1
                                ? '✓ Balanced'
                                : journal.diff > 0
                                  ? `⚠ Debits exceed credits by ${$fmt(journal.diff)} — check a credit field`
                                  : `⚠ Credits exceed debits by ${$fmt(Math.abs(journal.diff))} — check a debit field`
                              }
                            </td>
                          </tr>
                        </tfoot>
                      </table>
                    </div>
                  )}
                </div>
              </div>
              {/* AI rebalance — offered whenever the buyer side doesn't reconcile */}
              {step === 'review' && !balanced && (
                <div className="border border-amber-200 bg-amber-50/60 rounded-xl px-4 py-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-start gap-2 text-xs text-amber-800">
                      <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                      <span>
                        The buyer side is off by <span className="font-semibold">{money(Math.abs(rec.gap))}</span>. Let the AI re-read the
                        statement and suggest fixes to make it balance.
                      </span>
                    </div>
                    <Button variant="secondary" onClick={handleRebalance} disabled={rebalancing || !file}>
                      {rebalancing
                        ? <><Loader2 className="w-4 h-4 animate-spin" /> Reviewing…</>
                        : <>Review &amp; rebalance with AI</>}
                    </Button>
                  </div>

                  {suggestion && (
                    <div className="mt-3 border-t border-amber-200 pt-3">
                      <div className="flex items-center gap-1.5 mb-1.5">
                        {suggestion.reconciles
                          ? <CheckCircle className="w-4 h-4 text-emerald-600" />
                          : <AlertCircle className="w-4 h-4 text-amber-600" />}
                        <p className="text-xs font-semibold text-slate-700">
                          {suggestion.reconciles ? 'Suggested changes to balance' : 'Best effort — may still not balance'}
                        </p>
                      </div>
                      {suggestion.explanation && (
                        <p className="text-xs text-slate-600 mb-2">{suggestion.explanation}</p>
                      )}
                      {suggestion.changes?.length > 0 && (
                        <ul className="space-y-1 mb-3">
                          {suggestion.changes.map((c, i) => (
                            <li key={i} className="text-[11px] text-slate-600 flex gap-1.5">
                              <span className="text-amber-500 shrink-0">•</span>
                              <span>
                                <span className="font-medium text-slate-700">{c.description || c.action}</span>
                                {c.from && c.to && <span className="text-slate-400"> — {c.from} → <span className="text-slate-700">{c.to}</span></span>}
                                {c.reason && <span className="text-slate-400"> ({c.reason})</span>}
                              </span>
                            </li>
                          ))}
                        </ul>
                      )}
                      <div className="flex items-center gap-2">
                        <Button variant="primary" onClick={applySuggestion} disabled={!suggestion.line_items?.length}>
                          <Check className="w-4 h-4" /> Apply changes
                        </Button>
                        <button onClick={() => setSuggestion(null)} className="text-xs text-slate-500 hover:text-slate-700 px-2 py-1">
                          Dismiss
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Reconstructed settlement statement — full width, review only */}
              <ReconstructedStatement lineItems={lineItems} fields={derived} />
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="shrink-0 flex items-center justify-between px-6 py-4 border-t border-slate-100 bg-slate-50 rounded-b-2xl">
          <button onClick={onClose} className="text-sm text-slate-400 hover:text-slate-600">Cancel</button>
          {(step === 'review' || step === 'saving') && (
            <Button onClick={handleSave} disabled={!fields || step === 'saving'}>
              {step === 'saving' ? (
                <><Loader2 className="w-4 h-4 animate-spin" /> Saving…</>
              ) : (
                <><CheckCircle className="w-4 h-4" /> Save to Ledger</>
              )}
            </Button>
          )}
        </div>
      </div>
    </div>
  )
}
