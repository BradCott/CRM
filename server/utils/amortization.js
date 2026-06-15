// Loan amortization — generate a schedule from loan terms and split bank
// mortgage payments into principal + interest using the stored schedule.
import db from '../db.js'

/**
 * Generate a standard fixed-rate amortization schedule from loan terms.
 * Returns { payment_amount, rows: [{ period, due_date, payment, principal, interest, balance }] }.
 */
export function generateSchedule({ original_principal, annual_rate, monthly_payment, first_payment, term_months }) {
  const P = Number(original_principal)
  const r = Number(annual_rate) / 100 / 12
  let n = Number(term_months) || 0
  if (!P || P <= 0) throw new Error('Original loan principal is required')
  if (!isFinite(r) || r < 0) throw new Error('A valid interest rate is required')

  // Derive payment if not given; derive term if not given
  let pay = Number(monthly_payment) || 0
  if (!pay) {
    if (!n) n = 360
    pay = r === 0 ? P / n : (P * r) / (1 - Math.pow(1 + r, -n))
  }
  if (!n) {
    // Estimate term from payment
    n = r === 0 ? Math.ceil(P / pay) : Math.ceil(Math.log(pay / (pay - P * r)) / Math.log(1 + r))
    if (!isFinite(n) || n <= 0 || n > 600) n = 360
  }

  const start = first_payment ? new Date(first_payment + 'T00:00:00') : new Date()
  const rows = []
  let balance = P
  for (let i = 1; i <= n && balance > 0.005; i++) {
    const interest = balance * r
    let principal = pay - interest
    if (principal > balance) principal = balance        // final payment
    balance -= principal
    const d = new Date(start.getFullYear(), start.getMonth() + (i - 1), start.getDate())
    rows.push({
      period: i,
      due_date: d.toISOString().slice(0, 10),
      payment: Math.round((principal + interest) * 100) / 100,
      principal: Math.round(principal * 100) / 100,
      interest: Math.round(interest * 100) / 100,
      balance: Math.round(Math.max(0, balance) * 100) / 100,
    })
  }
  return { payment_amount: Math.round(pay * 100) / 100, rows }
}

/**
 * For a synced bank transaction, find a matching amortization row and return
 * the principal/interest split. Returns null if no schedule matches.
 * Matches when the payment amount is within ~2% of a schedule's payment.
 */
export function matchMortgageSplit(propertyId, tx) {
  const amt = Math.abs(Number(tx.amount))
  if (!amt || Number(tx.amount) >= 0) return null   // only outgoing payments

  const schedules = db.prepare('SELECT * FROM loan_schedules WHERE property_id = ?').all(propertyId)
  for (const s of schedules) {
    const pay = Number(s.payment_amount)
    if (!pay) continue
    if (Math.abs(amt - pay) > Math.max(1, pay * 0.02)) continue   // not this loan's payment

    // Nearest unconsumed row by date
    const row = db.prepare(`
      SELECT * FROM loan_schedule_rows
      WHERE schedule_id = ? AND consumed = 0
      ORDER BY ABS(julianday(due_date) - julianday(?)) ASC
      LIMIT 1
    `).get(s.id, tx.date)
    if (!row) continue

    // Interest is the schedule's exact interest; principal absorbs any rounding
    // so the two lines always sum to the actual bank amount.
    const interestAmt  = -Math.abs(row.interest)
    const principalAmt = Number(tx.amount) - interestAmt
    return {
      scheduleId: s.id,
      rowId: row.id,
      lines: [
        { category: 'Mortgage Interest',  amount: Math.round(interestAmt * 100) / 100,  description: 'Mortgage interest' },
        { category: 'Mortgage Principal', amount: Math.round(principalAmt * 100) / 100, description: 'Mortgage principal' },
      ],
    }
  }
  return null
}

export function markRowConsumed(rowId) {
  db.prepare('UPDATE loan_schedule_rows SET consumed = 1 WHERE id = ?').run(rowId)
}
