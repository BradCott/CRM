// Shared mapping from parsed-document output → Portfolio `properties` column patch.
//
// Every document type (insurance, tax, lease, settlement, marketing package) runs
// its AI-parsed JSON through mapExtracted() to produce a normalized, whitelisted
// patch of property columns. The management routes use this for the review-and-
// confirm auto-fill flow: build a diff (current vs proposed), let the user pick
// which fields to apply, then write only whitelisted columns.

// Display metadata for each fillable property column. `type` drives formatting in
// the review modal (currency/number/date/text). Keep keys to real properties cols.
export const FIELD_META = {
  address:           { label: 'Address',            type: 'text' },
  city:              { label: 'City',               type: 'text' },
  state:             { label: 'State',              type: 'text' },
  zip:               { label: 'Zip',                type: 'text' },
  tenant_brand_id:   { label: 'Tenant',             type: 'tenant' },
  building_size:     { label: 'Building Size (SF)', type: 'number' },
  land_area:         { label: 'Land Area (acres)',  type: 'number' },
  year_built:        { label: 'Year Built',         type: 'number' },
  property_type:     { label: 'Property Type',      type: 'text' },
  construction_type: { label: 'Construction Type',  type: 'text' },
  lease_type:        { label: 'Lease Type',         type: 'text' },
  lease_start:       { label: 'Lease Start',        type: 'date' },
  lease_end:         { label: 'Lease End',          type: 'date' },
  annual_rent:       { label: 'Annual Rent',        type: 'currency' },
  rent_bumps:        { label: 'Rent Bumps',         type: 'text' },
  renewal_options:   { label: 'Renewal Options',    type: 'text' },
  noi:               { label: 'NOI',                type: 'currency' },
  cap_rate:          { label: 'Cap Rate',           type: 'number' },
  list_price:        { label: 'List Price',         type: 'currency' },
  taxes:             { label: 'Taxes',              type: 'currency' },
  insurance:         { label: 'Insurance',          type: 'currency' },
  purchase_price:    { label: 'Purchase Price',     type: 'currency' },
  close_date:        { label: 'Close Date',         type: 'date' },
  policy_number:     { label: 'Policy Number',      type: 'text' },
  insurance_exp:     { label: 'Insurance Expiry',   type: 'date' },
  ins_broker:        { label: 'Insurance Broker',   type: 'text' },
}

export const WHITELIST = new Set(Object.keys(FIELD_META))

// ── normalization helpers ──────────────────────────────────────────────────
function str(v) {
  if (v == null) return null
  const s = String(v).trim()
  return s ? s : null
}
function num(v) {
  if (v == null || v === '') return null
  const n = parseFloat(String(v).replace(/[^0-9.\-]/g, ''))
  return Number.isFinite(n) ? n : null
}
function int(v) {
  const n = num(v)
  return n == null ? null : Math.round(n)
}
function date(v) {
  const s = str(v)
  if (!s) return null
  // Already ISO-ish
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`
  const d = new Date(s)
  if (!Number.isNaN(d.getTime())) return d.toISOString().slice(0, 10)
  return s
}
// Land area from an OM comes as free-form text like "0.59 Acres" or
// "25,700 SF". Normalize to a numeric ACRES value (the unit the property form
// and detail panel use). Convert square-foot figures via 43,560 sf/acre.
function landAcres(v) {
  const n = num(v)
  if (n == null) return null
  const s = String(v).toLowerCase()
  if (/\bsf\b|sq\.?\s*ft|square f/.test(s)) return Math.round((n / 43560) * 100) / 100
  return n
}
// Lease base_rent comes as a free-form string like "$10,000/month" or
// "$120,000 per annum". Return an ANNUAL number.
function annualRent(v) {
  const n = num(v)
  if (n == null) return null
  const s = String(v).toLowerCase()
  if (/month|\/mo|per mo|monthly/.test(s)) return Math.round(n * 12)
  return Math.round(n)
}

// ── per-doc mappers ─────────────────────────────────────────────────────────
// Each returns { fields: {col: value}, tenantName?: string }. Null/blank values
// are dropped so we never propose overwriting with nothing.
function fromInsurance(d) {
  return {
    fields: {
      year_built:        int(d.year_built),
      construction_type: str(d.construction_type),
      insurance:         num(d.premium),
      policy_number:     str(d.policy_number),
      insurance_exp:     date(d.expiration_date),
      ins_broker:        str(d.agent_name),
    },
  }
}
function fromTax(d) {
  return { fields: { taxes: num(d.amount) } }
}
function fromLease(d) {
  const s = d?.summary || d || {}
  return {
    fields: {
      lease_type:      str(s.lease_type),
      lease_start:     date(s.commencement_date),
      lease_end:       date(s.expiration_date),
      annual_rent:     annualRent(s.base_rent),
      rent_bumps:      str(s.rent_escalations),
      renewal_options: str(s.renewal_options),
    },
    tenantName: str(s.tenant),
  }
}
function fromSettlement(d) {
  return {
    fields: {
      purchase_price: num(d.purchase_price),
      close_date:     date(d.settlement_date || d.close_date),
      address:        str(d.property_address),
      city:           str(d.property_city),
      state:          str(d.property_state),
      zip:            str(d.property_zip),
    },
  }
}
function fromMarketing(d) {
  return {
    fields: {
      address:           str(d.address),
      city:              str(d.city),
      state:             str(d.state),
      zip:               str(d.zip),
      building_size:     int(d.building_size),
      land_area:         landAcres(d.land_area),
      year_built:        int(d.year_built),
      property_type:     str(d.property_type),
      construction_type: str(d.construction_type),
      lease_type:        str(d.lease_type),
      lease_start:       date(d.lease_start),
      lease_end:         date(d.lease_end),
      annual_rent:       annualRent(d.annual_rent),
      rent_bumps:        str(d.rent_bumps),
      renewal_options:   str(d.renewal_options),
      noi:               num(d.noi),
      cap_rate:          num(d.cap_rate),
      list_price:        num(d.list_price),
    },
    tenantName: str(d.tenant),
  }
}

const MAPPERS = {
  insurance:  fromInsurance,
  tax:        fromTax,
  lease:      fromLease,
  settlement: fromSettlement,
  marketing:  fromMarketing,
}

// mapExtracted(docType, data) → { fields, tenantName } with only whitelisted,
// non-empty columns retained.
export function mapExtracted(docType, data) {
  const fn = MAPPERS[docType]
  if (!fn) throw new Error(`Unknown docType: ${docType}`)
  const { fields = {}, tenantName = null } = fn(data || {})
  const out = {}
  for (const [k, v] of Object.entries(fields)) {
    if (!WHITELIST.has(k)) continue
    if (v == null || v === '') continue
    out[k] = v
  }
  return { fields: out, tenantName: tenantName || null }
}
