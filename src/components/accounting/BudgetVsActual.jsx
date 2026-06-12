// Budget vs Actual — annual budget per category with variance tracking
import { useState, useEffect, useCallback } from 'react'
import { Loader2, Save } from 'lucide-react'
import Button from '../ui/Button'
import { getBudget, saveBudget } from '../../api/client'
import { EXPENSE_CATEGORIES, expenseLabel } from '../../utils/accounting'

function fmt$(n) {
  if (n === null || n === undefined) return '—'
  const abs = '$' + Math.abs(Math.round(n)).toLocaleString()
  return n < 0 ? `(${abs})` : abs
}

// Budgetable rows: rent income + every expense category
const BUDGET_ROWS = [
  { category: 'Rent', label: 'Rental Income', type: 'income' },
  ...EXPENSE_CATEGORIES.map(c => ({ category: c, label: expenseLabel(c), type: 'expense' })),
]

export default function BudgetVsActual({ propertyId, transactions }) {
  const currentYear = new Date().getFullYear()
  const [year, setYear]       = useState(currentYear)
  const [budgets, setBudgets] = useState({})   // category → amount (string for inputs)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving]   = useState(false)
  const [saved, setSaved]     = useState(false)
  const [error, setError]     = useState(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await getBudget(propertyId, year)
      const map = {}
      for (const b of res.budgets) map[b.category] = String(b.amount)
      setBudgets(map)
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }, [propertyId, year])

  useEffect(() => { load() }, [load])

  // Actuals for the selected year
  const inYear = transactions.filter(t => t.date.startsWith(String(year)))
  const actualFor = (row) => {
    if (row.type === 'income') {
      return inYear.filter(t => t.category === row.category && Number(t.amount) > 0)
        .reduce((s, t) => s + Number(t.amount), 0)
    }
    return inYear.filter(t => t.category === row.category && Number(t.amount) < 0 && t.source !== 'Settlement Statement')
      .reduce((s, t) => s + Math.abs(Number(t.amount)), 0)
  }

  async function handleSave() {
    setSaving(true)
    setError(null)
    try {
      await saveBudget(propertyId, year, Object.entries(budgets).map(([category, amount]) => ({
        category, amount: parseFloat(amount) || 0,
      })))
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    } catch (e) {
      setError(e.message)
    } finally {
      setSaving(false)
    }
  }

  const rows = BUDGET_ROWS.map(row => {
    const budget = parseFloat(budgets[row.category]) || 0
    const actual = actualFor(row)
    const variance = row.type === 'income' ? actual - budget : budget - actual
    return { ...row, budget, actual, variance, pctUsed: budget > 0 ? (actual / budget) * 100 : null }
  }).filter(r => r.budget > 0 || r.actual > 0 || ['Rent', 'Mortgage', 'Repair', 'Insurance', 'Property Tax'].includes(r.category))

  const totals = rows.reduce((acc, r) => {
    if (r.type === 'income') { acc.incomeBudget += r.budget; acc.incomeActual += r.actual }
    else                     { acc.expenseBudget += r.budget; acc.expenseActual += r.actual }
    return acc
  }, { incomeBudget: 0, incomeActual: 0, expenseBudget: 0, expenseActual: 0 })

  if (loading) return (
    <div className="flex items-center justify-center py-16">
      <Loader2 className="w-5 h-5 text-slate-400 animate-spin" />
    </div>
  )

  return (
    <div className="max-w-3xl mx-auto px-6 py-6">
      <div className="flex items-start justify-between mb-4">
        <div>
          <h2 className="text-base font-bold text-slate-900">Budget vs Actual</h2>
          <p className="text-xs text-slate-400">Annual budget for {year} — enter amounts and save</p>
        </div>
        <div className="flex items-center gap-2">
          <select
            value={year}
            onChange={e => setYear(Number(e.target.value))}
            className="text-sm border border-slate-200 rounded-lg px-3 py-1.5 bg-white focus:outline-none focus:ring-2 focus:ring-blue-400"
          >
            {[currentYear + 1, currentYear, currentYear - 1, currentYear - 2].map(y =>
              <option key={y} value={y}>{y}</option>
            )}
          </select>
          <Button onClick={handleSave} disabled={saving}>
            {saving
              ? <><Loader2 className="w-4 h-4 animate-spin" /> Saving…</>
              : saved ? '✓ Saved' : <><Save className="w-4 h-4" /> Save Budget</>
            }
          </Button>
        </div>
      </div>

      {error && (
        <div className="mb-4 px-4 py-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">{error}</div>
      )}

      <table className="w-full text-sm border-collapse">
        <thead>
          <tr className="bg-slate-50 border-y border-slate-200">
            <th className="px-4 py-2.5 text-xs font-semibold text-slate-500 uppercase tracking-wide text-left">Category</th>
            <th className="px-3 py-2.5 text-xs font-semibold text-slate-500 uppercase tracking-wide text-right w-36">Budget</th>
            <th className="px-3 py-2.5 text-xs font-semibold text-slate-500 uppercase tracking-wide text-right">Actual ({year})</th>
            <th className="px-3 py-2.5 text-xs font-semibold text-slate-500 uppercase tracking-wide text-right">Variance</th>
            <th className="px-4 py-2.5 text-xs font-semibold text-slate-500 uppercase tracking-wide text-right">% Used</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(row => (
            <tr key={row.category} className={`border-b border-slate-100 ${row.type === 'income' ? 'bg-emerald-50/30' : ''}`}>
              <td className="px-4 py-2.5 text-slate-700 font-medium">{row.label}</td>
              <td className="px-3 py-2">
                <input
                  type="number"
                  min="0"
                  placeholder="0"
                  value={budgets[row.category] ?? ''}
                  onChange={e => setBudgets(prev => ({ ...prev, [row.category]: e.target.value }))}
                  className="w-32 text-right text-sm border border-slate-200 rounded-lg px-2 py-1.5 tabular-nums focus:outline-none focus:ring-2 focus:ring-blue-400"
                />
              </td>
              <td className={`px-3 py-2.5 text-right tabular-nums font-medium ${row.type === 'income' ? 'text-emerald-700' : 'text-slate-700'}`}>
                {fmt$(row.actual)}
              </td>
              <td className={`px-3 py-2.5 text-right tabular-nums font-semibold ${
                row.budget === 0 ? 'text-slate-300' : row.variance >= 0 ? 'text-emerald-600' : 'text-red-600'
              }`}>
                {row.budget === 0 ? '—' : fmt$(row.variance)}
              </td>
              <td className="px-4 py-2.5 text-right">
                {row.pctUsed != null ? (
                  <div className="flex items-center justify-end gap-2">
                    <div className="w-16 h-1.5 bg-slate-100 rounded-full overflow-hidden">
                      <div
                        className={`h-full rounded-full ${
                          row.type === 'income'
                            ? 'bg-emerald-500'
                            : row.pctUsed > 100 ? 'bg-red-500' : row.pctUsed > 80 ? 'bg-amber-400' : 'bg-blue-500'
                        }`}
                        style={{ width: `${Math.min(100, row.pctUsed)}%` }}
                      />
                    </div>
                    <span className={`text-xs tabular-nums w-10 ${row.type === 'expense' && row.pctUsed > 100 ? 'text-red-600 font-semibold' : 'text-slate-500'}`}>
                      {Math.round(row.pctUsed)}%
                    </span>
                  </div>
                ) : <span className="text-xs text-slate-300">—</span>}
              </td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="border-t-2 border-slate-300 bg-slate-50">
            <td className="px-4 py-2.5 text-xs font-bold text-slate-500 uppercase tracking-wide">Net (Income − Expenses)</td>
            <td className="px-3 py-2.5 text-right tabular-nums font-bold text-slate-900 pr-4">
              {fmt$(totals.incomeBudget - totals.expenseBudget)}
            </td>
            <td className={`px-3 py-2.5 text-right tabular-nums font-bold ${totals.incomeActual - totals.expenseActual >= 0 ? 'text-emerald-700' : 'text-red-600'}`}>
              {fmt$(totals.incomeActual - totals.expenseActual)}
            </td>
            <td colSpan={2} />
          </tr>
        </tfoot>
      </table>

      <p className="mt-3 text-xs text-slate-400 italic">
        Income variance = actual − budget (over is good). Expense variance = budget − actual (under is good).
        Settlement-statement entries are excluded from actuals.
      </p>
    </div>
  )
}
