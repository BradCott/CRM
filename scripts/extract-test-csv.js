#!/usr/bin/env node
/**
 * Extracts ~200 rows from a Salesforce CRM report CSV.
 * Ensures a healthy mix of Person Accounts and Business Accounts,
 * with variety across tenant brands and states within each group.
 *
 * Usage:
 *   node scripts/extract-test-csv.js path/to/full-report.csv [output.csv]
 */

import { readFileSync, writeFileSync } from 'node:fs'
import { parse } from 'csv-parse/sync'

const [,, inputPath, outputPath = 'test-200.csv'] = process.argv

if (!inputPath) {
  console.error('Usage: node scripts/extract-test-csv.js <input.csv> [output.csv]')
  process.exit(1)
}

const raw = readFileSync(inputPath, 'utf8')
const cleaned = raw.replace(/^\uFEFF/, '')

const records = parse(cleaned, { skip_empty_lines: true })
if (records.length < 2) {
  console.error('CSV appears empty or header-only')
  process.exit(1)
}

const [header, ...dataRows] = records

// Column indices (matches import.js COL mapping)
const TENANT_COL      = 1   // Tenant Brand
const STATE_COL       = 4   // Property State
const RECORD_TYPE_COL = 25  // "Person Account" or "Business Account"
const ACCT_NAME_COL   = 8   // Account Name

// Split by account type
const personRows   = dataRows.filter(r => (r[RECORD_TYPE_COL] || '').trim() === 'Person Account')
const businessRows = dataRows.filter(r => (r[RECORD_TYPE_COL] || '').trim() !== 'Person Account')

console.log(`Source: ${dataRows.length} total rows`)
console.log(`  Person Accounts:   ${personRows.length}`)
console.log(`  Business Accounts: ${businessRows.length}`)

// Round-robin across tenant×state buckets to maximize variety
function pickWithVariety(rows, target) {
  const buckets = new Map()
  for (const row of rows) {
    const key = `${row[TENANT_COL] || ''}|${row[STATE_COL] || ''}`
    if (!buckets.has(key)) buckets.set(key, [])
    buckets.get(key).push(row)
  }
  const picked = []
  const bucketList = [...buckets.values()]
  let i = 0
  while (picked.length < target && bucketList.some(b => b.length > 0)) {
    const bucket = bucketList[i % bucketList.length]
    if (bucket.length > 0) picked.push(bucket.shift())
    i++
  }
  return picked
}

// Aim for ~50% person / 50% business, adjusted if one group is small
const TARGET = 200
const targetPerson   = Math.min(Math.round(TARGET * 0.5), personRows.length)
const targetBusiness = Math.min(TARGET - targetPerson, businessRows.length)

const pickedPersons   = pickWithVariety(personRows, targetPerson)
const pickedBusiness  = pickWithVariety(businessRows, targetBusiness)

// Interleave so the file isn't all-persons then all-businesses
const result = []
const maxLen = Math.max(pickedPersons.length, pickedBusiness.length)
for (let i = 0; i < maxLen; i++) {
  if (i < pickedPersons.length)  result.push(pickedPersons[i])
  if (i < pickedBusiness.length) result.push(pickedBusiness[i])
}

// Serialize back to CSV
function esc(v) {
  if (v == null) return ''
  const s = String(v)
  return s.includes(',') || s.includes('"') || s.includes('\n')
    ? `"${s.replace(/"/g, '""')}"`
    : s
}

const lines = [header, ...result].map(row => row.map(esc).join(','))
writeFileSync(outputPath, lines.join('\n'), 'utf8')

// Stats
const tenants = new Set(result.map(r => r[TENANT_COL]).filter(Boolean))
const states  = new Set(result.map(r => r[STATE_COL]).filter(Boolean))
const pCount  = result.filter(r => (r[RECORD_TYPE_COL]||'').trim() === 'Person Account').length
const bCount  = result.length - pCount

console.log(`\n✓ Wrote ${result.length} rows to ${outputPath}`)
console.log(`  Person Accounts:   ${pCount}`)
console.log(`  Business Accounts: ${bCount}`)
console.log(`  Tenant brands: ${tenants.size}  (${[...tenants].slice(0,8).join(', ')}${tenants.size > 8 ? '…' : ''})`)
console.log(`  States: ${states.size}  (${[...states].sort().join(', ')})`)
