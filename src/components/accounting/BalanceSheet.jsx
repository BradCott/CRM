// Balance Sheet — computed from the ledger transactions + investors table

function fmt$(n) {
  if (n === null || n === undefined) return '—'
  const abs = '$' + Math.abs(Math.round(n)).toLocaleString()
  if (n < 0) return `(${abs})`
  return abs
}

function Row({ label, value, bold, indent, color, note }) {
  return (
    <div className={`flex items-start justify-between py-1.5 ${indent ? 'pl-6' : ''}`}>
      <div>
        <span className={`text-sm ${bold ? 'font-semibold text-slate-900' : 'text-slate-600'}`}>{label}</span>
        {note && <p className="text-xs text-slate-400 italic mt-0.5">{note}</p>}
      </div>
      <span className={`text-sm tabular-nums shrink-0 ml-4 ${bold ? 'font-semibold' : ''} ${color || (bold ? 'text-slate-900' : 'text-slate-700')}`}>
        {typeof value === 'number' ? fmt$(value) : value}
      </span>
    </div>
  )
}

function Divider({ thick }) {
  return <div className={`${thick ? 'border-t-2 border-slate-300' : 'border-t border-slate-200'} my-2`} />
}

function SectionLabel({ children }) {
  return <p className="text-xs font-bold text-slate-400 uppercase tracking-wider mt-4 mb-1">{children}</p>
}

export default function BalanceSheet({ transactions, investors }) {
  const sum = txs => txs.reduce((s, t) => s + Number(t.amount), 0)

  // ── Real Property (at cost) ──────────────────────────────────────────────────
  const building = Math.abs(sum(transactions.filter(t => t.description === 'Building Value')))
  const land     = Math.abs(sum(transactions.filter(t => t.description === 'Land Value')))
  const totalRealEstate = building + land

  // ── Post-acquisition operational cash ────────────────────────────────────────
  // Includes: Rent, Mortgage payments, Repairs, Sales, Other — but NOT items sourced
  // from the settlement statement (those funded the acquisition, not ongoing operations).
  const opCash = sum(
    transactions.filter(t =>
      ['Rent', 'Mortgage', 'Repair', 'Sale'].includes(t.category) &&
      t.source !== 'Settlement Statement'
    )
  )
  const otherOp = sum(
    transactions.filter(t =>
      t.category === 'Other' &&
      t.source !== 'Settlement Statement'
    )
  )
  // Equity contributions from investors flow through as cash
  const equityContribCash = sum(transactions.filter(t => t.category === 'Equity Contribution'))

  const totalCash = opCash + otherOp + equityContribCash

  const totalAssets = totalRealEstate + totalCash

  // ── Liabilities ───────────────────────────────────────────────────────────────
  // Loan Proceeds = mortgage debt (excludes 1031 exchange which is equity, not debt)
  const loanBalance = sum(
    transactions.filter(t =>
      t.category === 'Loan' &&
      t.description !== '1031 Exchange Proceeds'
    )
  )
  const totalLiabilities = loanBalance

  // ── Equity ────────────────────────────────────────────────────────────────────
  // 1031 exchange proceeds funded the purchase — they're equity, not debt
  const exchange1031 = sum(transactions.filter(t => t.description === '1031 Exchange Proceeds'))

  // Acquisition credits (rent/insurance prorations credited at closing)
  const acquisitionCredits = sum(
    transactions.filter(t =>
      ['Rent', 'Other'].includes(t.category) &&
      t.source === 'Settlement Statement' &&
      Number(t.amount) > 0
    )
  )

  // Investor capital from the investors table
  const investedCapital = investors.reduce((s, i) => s + Number(i.contribution || 0), 0)

  // Retained earnings = residual (what's left after accounting for all known equity sources)
  const totalEquity = totalAssets - totalLiabilities
  const knownEquity = exchange1031 + acquisitionCredits + investedCapital
  const retainedEarnings = totalEquity - knownEquity

  const totalLE    = totalLiabilities + totalEquity
  const balanced   = Math.abs(totalAssets - totalLE) < 2

  const noData = totalRealEstate === 0 && totalLiabilities === 0

  if (noData) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-slate-400 gap-2">
        <p className="text-sm font-medium">No acquisition data yet</p>
        <p className="text-xs">Upload a settlement statement to generate a balance sheet</p>
      </div>
    )
  }

  return (
    <div className="max-w-lg mx-auto px-6 py-6">
      <h2 className="text-base font-bold text-slate-900 mb-1">Balance Sheet</h2>
      <p className="text-xs text-slate-400 mb-5">Snapshot based on recorded transactions</p>

      {/* ASSETS */}
      <SectionLabel>Assets</SectionLabel>

      {(building > 0 || land > 0) && (
        <>
          <Row label="Real Property" bold />
          {building > 0 && <Row label="Building (at cost)" value={building} indent />}
          {land     > 0 && <Row label="Land (at cost)"     value={land}     indent />}
          <Row label="Total Real Property" value={totalRealEstate} bold indent
            color="text-slate-900" />
          <Divider />
        </>
      )}

      <Row label="Cash & Cash Equivalents"
        value={totalCash}
        note="Operational cash flows since acquisition"
        color={totalCash >= 0 ? undefined : 'text-red-600'} />

      <Divider thick />
      <Row label="TOTAL ASSETS" value={totalAssets} bold
        color={totalAssets >= 0 ? 'text-emerald-700' : 'text-red-600'} />

      {/* LIABILITIES */}
      <SectionLabel>Liabilities</SectionLabel>

      {loanBalance > 0 && (
        <Row label="Mortgage Payable" value={loanBalance}
          note="Shown at original balance — actual outstanding balance is lower as principal is paid down" />
      )}
      {loanBalance === 0 && (
        <p className="text-sm text-slate-400 py-1.5">No mortgage recorded</p>
      )}

      <Divider thick />
      <Row label="TOTAL LIABILITIES" value={totalLiabilities} bold />

      {/* EQUITY */}
      <SectionLabel>Equity</SectionLabel>

      {exchange1031     > 0 && <Row label="1031 Exchange Proceeds"         value={exchange1031}       />}
      {acquisitionCredits > 0 && <Row label="Acquisition Credits (prorations)" value={acquisitionCredits} />}
      {investedCapital  > 0 && <Row label="Invested Capital"               value={investedCapital}    />}

      <Row label="Retained Earnings (Deficit)" value={retainedEarnings}
        color={retainedEarnings >= 0 ? 'text-emerald-700' : 'text-red-600'} />

      <Divider thick />
      <Row label="TOTAL EQUITY" value={totalEquity} bold
        color={totalEquity >= 0 ? 'text-emerald-700' : 'text-red-600'} />

      {/* Check */}
      <Divider thick />
      <Row label="TOTAL LIABILITIES + EQUITY" value={totalLE} bold />

      <div className="mt-2">
        {balanced ? (
          <p className="text-xs text-emerald-600 font-medium">✓ Balanced</p>
        ) : (
          <p className="text-xs text-amber-600">
            ⚠ Difference: {fmt$(Math.abs(totalAssets - totalLE))} — may reflect transactions not yet categorized
          </p>
        )}
      </div>
    </div>
  )
}
