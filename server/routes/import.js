import { Router } from 'express'
import multer from 'multer'
import { parse } from 'csv-parse/sync'
import db from '../db.js'

const router = Router()
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 100 * 1024 * 1024 } })

// Column indices in the Salesforce report
const COL = {
  TENANT_FULL:  0,  // "CVS - 3506 N Lecanto Hwy"
  TENANT_BRAND: 1,  // "CVS"
  PROP_ADDR:    2,
  PROP_CITY:    3,
  PROP_STATE:   4,
  PROP_ZIP:     5,
  FIRST_NAME:   6,
  LAST_NAME:    7,
  ACCT_NAME:    8,
  PRIM_STREET:  9,
  PRIM_CITY:    10,
  PRIM_STATE:   11,
  PRIM_ZIP:     12,
  EMAIL:        13,
  EMAIL2:       14,
  SEC_STREET:   15,
  SEC_CITY:     16,
  SEC_STATE:    17,
  SEC_ZIP:      18,
  MOBILE:       19,
  PHONE2:       20,
  PHONE:        21,
  ACCT_SF_ID:   22,
  TENANT_SF_ID: 23,
  DO_NOT_MAIL:  24,
  RECORD_TYPE:  25, // "Person Account" or "Business Account"
  PROP_NOTES:   26,
  ACCT_NOTES:   27,
  ACCT_TYPE:    28, // Principal, Franchisee, Broker, Buyer, Seller
}

function mapRole(recordType, acctType) {
  if (recordType === 'Person Account') return 'owner'
  // Business account — check type
  const t = (acctType || '').toLowerCase()
  if (t === 'broker') return 'broker'
  return 'owner_company'
}

function mapSubLabel(acctType) {
  const t = (acctType || '').toLowerCase()
  if (t === 'buyer') return 'buyer'
  if (t === 'seller') return 'seller'
  return null
}

// POST /api/import/salesforce — main full import
router.post('/salesforce', upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' })

  let records
  try {
    records = parse(req.file.buffer.toString('utf8'), {
      columns: false,
      skip_empty_lines: true,
      trim: true,
      bom: true,
      from_line: 2, // skip header row
      relax_column_count: true,
    })
  } catch (e) {
    return res.status(400).json({ error: `CSV parse error: ${e.message}` })
  }

  // Prepared statements
  const upsertBrand = db.prepare(`
    INSERT INTO tenant_brands (name) VALUES (?)
    ON CONFLICT(name) DO NOTHING
  `)
  const getBrand = db.prepare(`SELECT id FROM tenant_brands WHERE name = ?`)

  const upsertPerson = db.prepare(`
    INSERT INTO people
      (name,first_name,last_name,role,sub_label,phone,phone2,mobile,
       email,email2,address,city,state,zip,address2,city2,state2,zip2,
       do_not_contact,notes,sf_id)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(sf_id) DO UPDATE SET
      name=excluded.name, first_name=excluded.first_name, last_name=excluded.last_name,
      role=excluded.role, sub_label=excluded.sub_label,
      phone=excluded.phone, phone2=excluded.phone2, mobile=excluded.mobile,
      email=excluded.email, email2=excluded.email2,
      address=excluded.address, city=excluded.city, state=excluded.state, zip=excluded.zip,
      address2=excluded.address2, city2=excluded.city2, state2=excluded.state2, zip2=excluded.zip2,
      do_not_contact=excluded.do_not_contact, notes=excluded.notes
  `)
  const getPerson = db.prepare(`SELECT id FROM people WHERE sf_id = ?`)

  const upsertProp = db.prepare(`
    INSERT INTO properties (address,city,state,zip,tenant_brand_id,owner_id,notes,sf_id)
    VALUES (?,?,?,?,?,?,?,?)
    ON CONFLICT(sf_id) DO UPDATE SET
      address=excluded.address, city=excluded.city, state=excluded.state, zip=excluded.zip,
      tenant_brand_id=excluded.tenant_brand_id, owner_id=excluded.owner_id,
      notes=CASE WHEN excluded.notes IS NOT NULL AND excluded.notes != '' THEN excluded.notes ELSE properties.notes END
  `)

  let imported = 0, skipped = 0, errors = []

  // Wrap everything in a single transaction — critical for 28k rows
  db.exec('BEGIN')
  try {
    for (const r of records) {
      if (!r[COL.TENANT_SF_ID]) { skipped++; continue }

      const tenantBrand = (r[COL.TENANT_BRAND] || '').trim()
      const acctSfId    = (r[COL.ACCT_SF_ID] || '').trim()
      const propSfId    = (r[COL.TENANT_SF_ID] || '').trim()
      const recordType  = (r[COL.RECORD_TYPE] || '').trim()
      const acctType    = (r[COL.ACCT_TYPE] || '').trim()
      const firstName   = (r[COL.FIRST_NAME] || '').trim()
      const lastName    = (r[COL.LAST_NAME] || '').trim()
      const acctName    = (r[COL.ACCT_NAME] || '').trim()

      // Derive name
      const isPerson = recordType === 'Person Account'
      const name = isPerson
        ? [firstName, lastName].filter(Boolean).join(' ') || acctName
        : acctName

      if (!name) { skipped++; continue }

      // 1. Upsert tenant brand
      let brandId = null
      if (tenantBrand) {
        upsertBrand.run(tenantBrand)
        brandId = getBrand.get(tenantBrand)?.id || null
      }

      // 2. Upsert person/company
      let ownerId = null
      if (acctSfId) {
        upsertPerson.run(
          name, firstName || null, lastName || null,
          mapRole(recordType, acctType),
          mapSubLabel(acctType),
          r[COL.PHONE]  || null,
          r[COL.PHONE2] || null,
          r[COL.MOBILE] || null,
          r[COL.EMAIL]  || null,
          r[COL.EMAIL2] || null,
          r[COL.PRIM_STREET] || null,
          r[COL.PRIM_CITY]   || null,
          r[COL.PRIM_STATE]  || null,
          r[COL.PRIM_ZIP]    || null,
          r[COL.SEC_STREET]  || null,
          r[COL.SEC_CITY]    || null,
          r[COL.SEC_STATE]   || null,
          r[COL.SEC_ZIP]     || null,
          r[COL.DO_NOT_MAIL] === '1' ? 1 : 0,
          r[COL.ACCT_NOTES]  || null,
          acctSfId
        )
        ownerId = getPerson.get(acctSfId)?.id || null
      }

      // 3. Upsert property
      const addr  = (r[COL.PROP_ADDR]  || '').trim()
      const city  = (r[COL.PROP_CITY]  || '').trim()
      const state = (r[COL.PROP_STATE] || '').trim()
      const zip   = (r[COL.PROP_ZIP]   || '').trim()
      const notes = (r[COL.PROP_NOTES] || '').trim()

      if (addr) {
        upsertProp.run(addr, city || null, state || null, zip || null, brandId, ownerId, notes || null, propSfId)
        imported++
      } else {
        skipped++
      }
    }
    db.exec('COMMIT')
  } catch (e) {
    db.exec('ROLLBACK')
    return res.status(500).json({ error: e.message })
  }

  res.json({
    imported,
    skipped,
    total: records.length,
    errors,
    stats: {
      tenant_brands: db.prepare('SELECT COUNT(*) AS n FROM tenant_brands').get().n,
      people:        db.prepare('SELECT COUNT(*) AS n FROM people').get().n,
      properties:    db.prepare('SELECT COUNT(*) AS n FROM properties').get().n,
    }
  })
})

// Stats endpoint
router.get('/stats', (req, res) => {
  res.json({
    tenant_brands: db.prepare('SELECT COUNT(*) AS n FROM tenant_brands').get().n,
    people:        db.prepare('SELECT COUNT(*) AS n FROM people').get().n,
    properties:    db.prepare('SELECT COUNT(*) AS n FROM properties').get().n,
    deals:         db.prepare('SELECT COUNT(*) AS n FROM deals').get().n,
  })
})

export default router
