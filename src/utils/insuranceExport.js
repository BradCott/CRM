// Portfolio insurance master export → styled .xlsx, plus the shared status helper
// used by both the export and the on-screen table.
import XLSX from 'xlsx-js-style'

export function parseDate(s) {
  if (!s) return null
  const mdy = String(s).match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/)
  if (mdy) { const d = new Date(Number(mdy[3]), Number(mdy[1]) - 1, Number(mdy[2]), 12); return isNaN(d) ? null : d }
  const d = new Date(String(s).length === 10 ? s + 'T12:00:00' : s)
  return isNaN(d) ? null : d
}
export function daysUntil(s) {
  const d = parseDate(s)
  if (!d) return null
  const today = new Date(); today.setHours(12, 0, 0, 0)
  return Math.round((d - today) / 86400000)
}
function fmtDate(s) { const d = parseDate(s); return d ? d.toLocaleDateString('en-US', { year: 'numeric', month: '2-digit', day: '2-digit' }) : '' }
export function noteVal(notes, key) {
  if (!notes) return ''
  const line = String(notes).split('\n').find(l => l.startsWith(key + ': '))
  return line ? line.slice(key.length + 2).trim() : ''
}

// One row → a status the whole portfolio can be scanned by.
export function insuranceStatus(row) {
  if (row._missing) return row.tenant_carries ? { label: 'Tenant-Covered', tone: 'blue' } : { label: 'No Policy', tone: 'red' }
  const d = daysUntil(row.expiry_date)
  if (d == null) return { label: 'No Expiry Date', tone: 'amber' }
  if (d < 0) return { label: 'Expired', tone: 'red' }
  if (d <= 60) return { label: 'Expiring Soon', tone: 'amber' }
  return { label: 'Active', tone: 'green' }
}

const HEADERS = [
  'Property', 'City', 'State', 'Tenant', 'Named Insured', 'Carrier', 'Policy Number',
  'Premium', 'Coverage', 'Deductible', 'Effective', 'Expiration', 'Days Until Exp.',
  'Status', 'Carried By', 'Auto-Renewal', 'Paid', 'Reimbursed', 'Agent', 'Agent Phone', 'Notes',
]
const WIDTHS = [30, 15, 7, 18, 22, 18, 20, 12, 12, 11, 12, 12, 13, 15, 18, 12, 9, 13, 18, 15, 45]

const HEADER_STYLE = { font: { bold: true, color: { rgb: 'FFFFFF' } }, fill: { fgColor: { rgb: '1E293B' } }, alignment: { horizontal: 'left', vertical: 'center' } }
const STATUS_FILL = { 'No Policy': 'FEE2E2', 'Expired': 'FEE2E2', 'Expiring Soon': 'FEF3C7', 'No Expiry Date': 'FEF3C7', 'Active': 'DCFCE7', 'Tenant-Covered': 'DBEAFE' }
const STATUS_FONT = { 'No Policy': '991B1B', 'Expired': '991B1B', 'Expiring Soon': '92400E', 'No Expiry Date': '92400E', 'Active': '166534', 'Tenant-Covered': '1E40AF' }

export function exportInsuranceXlsx(rows) {
  const body = rows.map(r => {
    const st = insuranceStatus(r).label
    const d = daysUntil(r.expiry_date)
    return [
      r.property_address || '', r.property_city || '', r.property_state || '',
      r.tenant_name || '', noteVal(r.notes, 'Named Insured'),
      r._missing ? '' : (r.carrier || ''), r._missing ? '' : (r.policy_number || ''),
      r.premium != null && r.premium !== '' ? Number(r.premium) : '',
      r.coverage_amount != null && r.coverage_amount !== '' ? Number(r.coverage_amount) : '',
      r.deductible != null && r.deductible !== '' ? Number(r.deductible) : '',
      fmtDate(r.effective_date), fmtDate(r.expiry_date), d == null ? '' : d,
      st, r.carried_by || '', r._missing ? '' : (r.auto_renewal ? 'Yes' : 'No'),
      r._missing ? '' : (r.paid_status === 'paid' ? 'Paid' : 'Unpaid'),
      r._missing ? '' : (r.reimbursed_status === 'reimbursed' ? 'Reimbursed' : 'Unreimbursed'),
      r.agent_name || '', r.agent_phone || '', String(r.notes || '').replace(/\n/g, ' | '),
    ]
  })

  const aoa = [HEADERS, ...body]
  const ws = XLSX.utils.aoa_to_sheet(aoa)

  // Header styling
  for (let c = 0; c < HEADERS.length; c++) {
    const cell = ws[XLSX.utils.encode_cell({ r: 0, c })]
    if (cell) cell.s = HEADER_STYLE
  }
  // Currency format for premium/coverage/deductible + colored Status cells
  for (let i = 0; i < body.length; i++) {
    const r = i + 1
    for (const c of [7, 8, 9]) {
      const cell = ws[XLSX.utils.encode_cell({ r, c })]
      if (cell && typeof cell.v === 'number') cell.z = '$#,##0'
    }
    const statusCell = ws[XLSX.utils.encode_cell({ r, c: 13 })]
    const label = body[i][13]
    if (statusCell && STATUS_FILL[label]) {
      statusCell.s = { font: { bold: true, color: { rgb: STATUS_FONT[label] } }, fill: { fgColor: { rgb: STATUS_FILL[label] } } }
    }
  }
  ws['!cols'] = WIDTHS.map(w => ({ wch: w }))
  ws['!autofilter'] = { ref: XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: aoa.length - 1, c: HEADERS.length - 1 } }) }
  ws['!freeze'] = { xSplit: 0, ySplit: 1, topLeftCell: 'A2', activePane: 'bottomLeft', state: 'frozen' }

  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'Insurance')
  const stamp = new Date().toISOString().slice(0, 10)
  XLSX.writeFile(wb, `Knox_Insurance_Master_${stamp}.xlsx`)
}
