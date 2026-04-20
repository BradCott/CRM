/**
 * Weekly Property Management Report
 * Runs every Monday at 8:00 AM (server local time).
 * Sends an email summary of: overdue tasks, upcoming tasks, expiring insurance,
 * pending tax payments, and maintenance spend YTD.
 *
 * Required env vars (optional — report is skipped if not configured):
 *   SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_FROM, REPORT_TO
 */

import cron       from 'node-cron'
import nodemailer from 'nodemailer'
import db         from '../db.js'

function today() {
  return new Date().toISOString().slice(0, 10)
}

function addDays(dateStr, days) {
  const d = new Date(dateStr)
  d.setDate(d.getDate() + days)
  return d.toISOString().slice(0, 10)
}

function fmt(n) {
  if (n == null) return '—'
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(n)
}

function fmtDate(s) {
  if (!s) return '—'
  return new Date(s + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

function buildHtml(data) {
  const { overdue, upcoming, insurance, taxes, maintenance, properties } = data

  const propCount = properties.length
  const totalRent = properties.reduce((s, p) => s + (p.annual_rent || 0), 0)

  const taskRow = (t, highlight) => `
    <tr style="background:${highlight ? '#fef3c7' : '#fff'}">
      <td style="padding:6px 12px;border-bottom:1px solid #e2e8f0">${t.address}, ${t.city} ${t.state}</td>
      <td style="padding:6px 12px;border-bottom:1px solid #e2e8f0">${t.title}</td>
      <td style="padding:6px 12px;border-bottom:1px solid #e2e8f0;color:${highlight ? '#b45309' : '#374151'}">${fmtDate(t.due_date)}</td>
    </tr>`

  const insRow = i => `
    <tr>
      <td style="padding:6px 12px;border-bottom:1px solid #e2e8f0">${i.address}, ${i.city} ${i.state}</td>
      <td style="padding:6px 12px;border-bottom:1px solid #e2e8f0">${i.carrier || '—'}</td>
      <td style="padding:6px 12px;border-bottom:1px solid #e2e8f0">${i.policy_number || '—'}</td>
      <td style="padding:6px 12px;border-bottom:1px solid #e2e8f0;color:#b45309">${fmtDate(i.expiry_date)}</td>
    </tr>`

  const taxRow = t => `
    <tr>
      <td style="padding:6px 12px;border-bottom:1px solid #e2e8f0">${t.address}, ${t.city} ${t.state}</td>
      <td style="padding:6px 12px;border-bottom:1px solid #e2e8f0">${t.tax_year || '—'}</td>
      <td style="padding:6px 12px;border-bottom:1px solid #e2e8f0">${fmt(t.amount)}</td>
      <td style="padding:6px 12px;border-bottom:1px solid #e2e8f0;color:#b45309">${fmtDate(t.due_date)}</td>
    </tr>`

  const weekLabel = new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })

  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#f8fafc;margin:0;padding:24px">
  <div style="max-width:700px;margin:0 auto;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,.1)">

    <div style="background:#1e293b;padding:24px 32px">
      <h1 style="margin:0;color:#fff;font-size:20px;font-weight:700">Knox Portfolio — Weekly Report</h1>
      <p style="margin:4px 0 0;color:#94a3b8;font-size:13px">Week of ${weekLabel}</p>
    </div>

    <div style="padding:24px 32px">

      <!-- Summary stats -->
      <div style="display:flex;gap:16px;margin-bottom:24px">
        ${[
          ['Portfolio Properties', propCount],
          ['Annual Rent Total',    fmt(totalRent)],
          ['Overdue Tasks',        overdue.length],
          ['Maintenance YTD',      fmt(maintenance)],
        ].map(([label, val]) => `
        <div style="flex:1;background:#f1f5f9;border-radius:8px;padding:14px 16px">
          <p style="margin:0;font-size:11px;color:#64748b;text-transform:uppercase;letter-spacing:.05em">${label}</p>
          <p style="margin:4px 0 0;font-size:20px;font-weight:700;color:${label === 'Overdue Tasks' && val > 0 ? '#dc2626' : '#0f172a'}">${val}</p>
        </div>`).join('')}
      </div>

      ${overdue.length ? `
      <h2 style="font-size:14px;font-weight:600;color:#dc2626;margin:0 0 8px">⚠ Overdue Tasks (${overdue.length})</h2>
      <table style="width:100%;border-collapse:collapse;font-size:13px;margin-bottom:24px">
        <thead><tr style="background:#fef2f2">
          <th style="padding:8px 12px;text-align:left;font-weight:600;color:#7f1d1d">Property</th>
          <th style="padding:8px 12px;text-align:left;font-weight:600;color:#7f1d1d">Task</th>
          <th style="padding:8px 12px;text-align:left;font-weight:600;color:#7f1d1d">Was Due</th>
        </tr></thead>
        <tbody>${overdue.map(t => taskRow(t, true)).join('')}</tbody>
      </table>` : ''}

      ${upcoming.length ? `
      <h2 style="font-size:14px;font-weight:600;color:#0f172a;margin:0 0 8px">📋 Upcoming Tasks — Next 30 Days (${upcoming.length})</h2>
      <table style="width:100%;border-collapse:collapse;font-size:13px;margin-bottom:24px">
        <thead><tr style="background:#f8fafc">
          <th style="padding:8px 12px;text-align:left;font-weight:600;color:#374151">Property</th>
          <th style="padding:8px 12px;text-align:left;font-weight:600;color:#374151">Task</th>
          <th style="padding:8px 12px;text-align:left;font-weight:600;color:#374151">Due</th>
        </tr></thead>
        <tbody>${upcoming.map(t => taskRow(t, false)).join('')}</tbody>
      </table>` : ''}

      ${insurance.length ? `
      <h2 style="font-size:14px;font-weight:600;color:#0f172a;margin:0 0 8px">🛡 Insurance Expiring — Next 90 Days (${insurance.length})</h2>
      <table style="width:100%;border-collapse:collapse;font-size:13px;margin-bottom:24px">
        <thead><tr style="background:#f8fafc">
          <th style="padding:8px 12px;text-align:left;font-weight:600">Property</th>
          <th style="padding:8px 12px;text-align:left;font-weight:600">Carrier</th>
          <th style="padding:8px 12px;text-align:left;font-weight:600">Policy</th>
          <th style="padding:8px 12px;text-align:left;font-weight:600">Expires</th>
        </tr></thead>
        <tbody>${insurance.map(insRow).join('')}</tbody>
      </table>` : ''}

      ${taxes.length ? `
      <h2 style="font-size:14px;font-weight:600;color:#0f172a;margin:0 0 8px">🏛 Tax Payments Due — Next 90 Days (${taxes.length})</h2>
      <table style="width:100%;border-collapse:collapse;font-size:13px;margin-bottom:24px">
        <thead><tr style="background:#f8fafc">
          <th style="padding:8px 12px;text-align:left;font-weight:600">Property</th>
          <th style="padding:8px 12px;text-align:left;font-weight:600">Year</th>
          <th style="padding:8px 12px;text-align:left;font-weight:600">Amount</th>
          <th style="padding:8px 12px;text-align:left;font-weight:600">Due</th>
        </tr></thead>
        <tbody>${taxes.map(taxRow).join('')}</tbody>
      </table>` : ''}

      ${!overdue.length && !upcoming.length && !insurance.length && !taxes.length ? `
      <p style="color:#64748b;font-size:14px">✅ No outstanding tasks, expiring insurance, or upcoming tax payments this week.</p>
      ` : ''}

    </div>

    <div style="padding:16px 32px;background:#f8fafc;border-top:1px solid #e2e8f0">
      <p style="margin:0;font-size:12px;color:#94a3b8">Knox CRM — automated weekly report · <a href="https://app.knoxtransactions.com/management" style="color:#3b82f6">View management dashboard</a></p>
    </div>
  </div>
</body>
</html>`
}

async function sendWeeklyReport() {
  const {
    SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_FROM, REPORT_TO,
  } = process.env

  if (!SMTP_HOST || !SMTP_USER || !SMTP_PASS || !REPORT_TO) {
    console.log('[weeklyReport] SMTP not configured — skipping email report')
    return
  }

  console.log('[weeklyReport] building report…')

  const todayStr = today()
  const in30     = addDays(todayStr, 30)
  const in90     = addDays(todayStr, 90)

  const overdue = db.prepare(`
    SELECT pt.*, p.address, p.city, p.state
    FROM property_tasks pt JOIN properties p ON p.id = pt.property_id
    WHERE pt.completed_at IS NULL AND pt.due_date < ? ORDER BY pt.due_date
  `).all(todayStr)

  const upcoming = db.prepare(`
    SELECT pt.*, p.address, p.city, p.state
    FROM property_tasks pt JOIN properties p ON p.id = pt.property_id
    WHERE pt.completed_at IS NULL AND pt.due_date >= ? AND pt.due_date <= ? ORDER BY pt.due_date
  `).all(todayStr, in30)

  const insurance = db.prepare(`
    SELECT pi.*, p.address, p.city, p.state
    FROM property_insurance pi JOIN properties p ON p.id = pi.property_id
    WHERE pi.expiry_date IS NOT NULL AND pi.expiry_date >= ? AND pi.expiry_date <= ? ORDER BY pi.expiry_date
  `).all(todayStr, in90)

  const taxes = db.prepare(`
    SELECT pt.*, p.address, p.city, p.state
    FROM property_taxes pt JOIN properties p ON p.id = pt.property_id
    WHERE pt.paid_date IS NULL AND pt.due_date IS NOT NULL AND pt.due_date <= ? ORDER BY pt.due_date
  `).all(in90)

  const maint = db.prepare(`SELECT SUM(cost) AS total FROM property_maintenance WHERE date >= date('now','-365 days')`).get()

  const properties = db.prepare(`SELECT * FROM properties WHERE is_portfolio = 1`).all()

  const html = buildHtml({
    overdue, upcoming, insurance, taxes,
    maintenance: maint?.total || 0,
    properties,
  })

  const transport = nodemailer.createTransport({
    host: SMTP_HOST,
    port: parseInt(SMTP_PORT || '587', 10),
    secure: SMTP_PORT === '465',
    auth: { user: SMTP_USER, pass: SMTP_PASS },
  })

  const recipients = REPORT_TO.split(',').map(s => s.trim()).filter(Boolean)
  const week = new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })

  try {
    await transport.sendMail({
      from:    SMTP_FROM || SMTP_USER,
      to:      recipients.join(', '),
      subject: `Knox Portfolio — Weekly Report (${week})`,
      html,
    })
    console.log(`[weeklyReport] report sent to ${recipients.join(', ')}`)
  } catch (err) {
    console.error('[weeklyReport] send failed:', err.message)
  }
}

export function startWeeklyReport() {
  // Every Monday at 8:00 AM
  cron.schedule('0 8 * * 1', () => {
    console.log('[weeklyReport] cron fired — Monday 8am')
    sendWeeklyReport().catch(err => console.error('[weeklyReport] error:', err))
  })
  console.log('[weeklyReport] cron scheduled — Monday 8:00 AM')
}

export { sendWeeklyReport }
