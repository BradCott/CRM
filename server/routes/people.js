import { Router } from 'express'
import db from '../db.js'
import { normalizeName, matchPerson } from '../utils/normalize.js'

const router = Router()

const BASE_SELECT = `
  SELECT p.*,
    c.name AS company_name
  FROM people p
  LEFT JOIN people c ON c.id = p.company_id
`

const PEOPLE_SORT_MAP = { name: 'p.name', date_added: 'p.created_at', last_updated: 'p.updated_at' }

// Shared WHERE builder for the list + export endpoints.
function buildPeopleWhere(query) {
  const { search = '', role = '', sub_label = '', do_not_contact = '', owner_type = '' } = query
  const conditions = []
  const params = []

  if (search) {
    conditions.push(`(p.name LIKE ? OR p.email LIKE ? OR p.phone LIKE ? OR p.city LIKE ?)`)
    const q = `%${search}%`
    params.push(q, q, q, q)
  }
  if (role) { conditions.push(`p.role = ?`); params.push(role) }
  if (sub_label) { conditions.push(`p.sub_label = ?`); params.push(sub_label) }
  if (do_not_contact !== '') { conditions.push(`p.do_not_contact = ?`); params.push(parseInt(do_not_contact)) }
  if (owner_type === 'Individual') {
    conditions.push(`(p.owner_type = 'Individual' OR p.owner_type IS NULL)`)
  } else if (owner_type) {
    conditions.push(`p.owner_type = ?`)
    params.push(owner_type)
  }

  // Date-added / last-updated range filters (YYYY-MM-DD). "Before" is inclusive.
  const dateRanges = [
    ['addedAfter',    'p.created_at', '>='],
    ['addedBefore',   'p.created_at', '<'],
    ['updatedAfter',  'p.updated_at', '>='],
    ['updatedBefore', 'p.updated_at', '<'],
  ]
  for (const [key, col, op] of dateRanges) {
    const v = query[key]
    if (!v) continue
    if (op === '<') { conditions.push(`${col} < date(?, '+1 day')`); params.push(v) }
    else            { conditions.push(`${col} >= date(?)`);          params.push(v) }
  }

  return { where: conditions.length ? `WHERE ${conditions.join(' AND ')}` : '', params }
}

// GET /api/people?search=&role=&sub_label=&do_not_contact=&owner_type=&limit=50&offset=0
router.get('/', (req, res) => {
  const { limit = 50, offset = 0 } = req.query
  const { where, params } = buildPeopleWhere(req.query)

  const sortExpr  = PEOPLE_SORT_MAP[req.query.sortCol] || 'p.name'
  const direction = req.query.sortDir === 'desc' ? 'DESC' : 'ASC'
  const orderBy   = `ORDER BY ${sortExpr} ${direction}`

  const total = db.prepare(`SELECT COUNT(*) AS n FROM people p ${where}`).get(...params).n
  const rows  = db.prepare(`${BASE_SELECT} ${where} ${orderBy} LIMIT ? OFFSET ?`).all(...params, parseInt(limit), parseInt(offset))

  res.json({ total, rows })
})

// GET /api/people/export — CSV of all rows matching the current filters (no limit)
router.get('/export', (req, res) => {
  const { where, params } = buildPeopleWhere(req.query)
  const sortExpr  = PEOPLE_SORT_MAP[req.query.sortCol] || 'p.name'
  const direction = req.query.sortDir === 'desc' ? 'DESC' : 'ASC'

  const rows = db.prepare(`${BASE_SELECT} ${where} ORDER BY ${sortExpr} ${direction}`).all(...params)

  const esc = v => {
    if (v == null || v === '') return ''
    const s = String(v)
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }
  const d10 = v => (v ? String(v).slice(0, 10) : '')
  const ROLE_LABEL = { owner: 'Owner', owner_company: 'Owner Company', broker: 'Broker', tenant_contact: 'Tenant Contact' }

  const headers = [
    'Name','First Name','Last Name','Role','Owner Type','Company',
    'Phone','Mobile','Email','Address','City','State','ZIP','Do Not Contact',
    'Date Added','Last Updated','Notes',
  ]
  const csvRows = rows.map(r => [
    r.name, r.first_name, r.last_name, ROLE_LABEL[r.role] || r.role, r.owner_type, r.company_name,
    r.phone, r.mobile, r.email, r.address, r.city, r.state, r.zip, r.do_not_contact ? 'Yes' : 'No',
    d10(r.created_at), d10(r.updated_at), r.notes,
  ].map(esc).join(','))

  const csv = [headers.join(','), ...csvRows].join('\n')
  res.setHeader('Content-Type', 'text/csv')
  res.setHeader('Content-Disposition', `attachment; filename="people-${new Date().toISOString().slice(0,10)}.csv"`)
  res.send(csv)
})

// GET /api/people/check-duplicate?name=&city=&state=&address=
router.get('/check-duplicate', (req, res) => {
  const { name = '', city = '', state = '', address = '' } = req.query
  const nameKey = normalizeName(name)
  if (!nameKey) return res.json({ confidence: 'none', matched: null, candidates: [] })

  const candidates = db.prepare(
    `SELECT id, name, city, state, address FROM people WHERE name_key = ?`
  ).all(nameKey)

  if (!candidates.length) return res.json({ confidence: 'none', matched: null, candidates: [] })

  const result = matchPerson(nameKey, city, state, address, candidates)
  res.json(result)
})

// GET /api/people/all — lightweight list for dropdowns (id + name + role only)
router.get('/all', (req, res) => {
  res.json(db.prepare(`SELECT id, name, role, company_id FROM people ORDER BY name`).all())
})

router.get('/:id', (req, res) => {
  const row = db.prepare(`${BASE_SELECT} WHERE p.id = ?`).get(req.params.id)
  if (!row) return res.status(404).json({ error: 'Not found' })

  // Attach linked properties
  const properties = db.prepare(`
    SELECT p.id, p.address, p.city, p.state, p.cap_rate, p.list_price,
      t.name AS tenant_brand_name
    FROM properties p
    LEFT JOIN tenant_brands t ON t.id = p.tenant_brand_id
    WHERE p.owner_id = ?
    ORDER BY p.address
  `).all(req.params.id)

  // If this is a company, attach contacts within it
  const contacts = db.prepare(`
    SELECT id, name, role, phone, mobile, email FROM people
    WHERE company_id = ?
    ORDER BY name
  `).all(req.params.id)

  res.json({ ...row, properties, contacts })
})

router.post('/', (req, res) => {
  const f = req.body
  if (!f.name) return res.status(400).json({ error: 'name is required' })
  const r = db.prepare(`
    INSERT INTO people
      (name,first_name,last_name,role,sub_label,company_id,phone,phone2,mobile,
       email,email2,address,city,state,zip,address2,city2,state2,zip2,
       do_not_contact,notes,sf_id,owner_type,name_key)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
  `).run(
    f.name, f.first_name||null, f.last_name||null,
    f.role||'owner', f.sub_label||null, f.company_id||null,
    f.phone||null, f.phone2||null, f.mobile||null,
    f.email||null, f.email2||null,
    f.address||null, f.city||null, f.state||null, f.zip||null,
    f.address2||null, f.city2||null, f.state2||null, f.zip2||null,
    f.do_not_contact ? 1 : 0, f.notes||null, f.sf_id||null,
    f.owner_type||'Individual',
    normalizeName(f.name)
  )
  res.status(201).json(db.prepare(`${BASE_SELECT} WHERE p.id = ?`).get(r.lastInsertRowid))
})

router.put('/:id', (req, res) => {
  const f = req.body
  if (!f.name) return res.status(400).json({ error: 'name is required' })
  db.prepare(`
    UPDATE people SET
      name=?,first_name=?,last_name=?,role=?,sub_label=?,company_id=?,
      phone=?,phone2=?,mobile=?,email=?,email2=?,
      address=?,city=?,state=?,zip=?,
      address2=?,city2=?,state2=?,zip2=?,
      do_not_contact=?,notes=?,sf_id=?,owner_type=?,name_key=?
    WHERE id=?
  `).run(
    f.name, f.first_name||null, f.last_name||null,
    f.role||'owner', f.sub_label||null, f.company_id||null,
    f.phone||null, f.phone2||null, f.mobile||null,
    f.email||null, f.email2||null,
    f.address||null, f.city||null, f.state||null, f.zip||null,
    f.address2||null, f.city2||null, f.state2||null, f.zip2||null,
    f.do_not_contact ? 1 : 0, f.notes||null, f.sf_id||null,
    f.owner_type||'Individual',
    normalizeName(f.name),
    req.params.id
  )
  res.json(db.prepare(`${BASE_SELECT} WHERE p.id = ?`).get(req.params.id))
})

// Lightweight do-not-contact toggle (avoids sending the whole record)
router.patch('/:id/dnc', (req, res) => {
  const val = req.body?.do_not_contact ? 1 : 0
  db.prepare('UPDATE people SET do_not_contact = ? WHERE id = ?').run(val, req.params.id)
  const row = db.prepare('SELECT id, name, do_not_contact FROM people WHERE id = ?').get(req.params.id)
  if (!row) return res.status(404).json({ error: 'Not found' })
  res.json(row)
})

router.delete('/:id', (req, res) => {
  db.prepare('DELETE FROM people WHERE id = ?').run(req.params.id)
  res.status(204).end()
})

// POST /api/people/merge — consolidate duplicate entities into one.
// Body: { keep_id, merge_ids: [] }. Reassigns every reference (owned properties,
// company contacts, broker on deals, mail sends, drip queue, emails) from the
// duplicates onto keep_id, then deletes the duplicates.
router.post('/merge', (req, res) => {
  const keep = Number(req.body?.keep_id)
  const ids  = (Array.isArray(req.body?.merge_ids) ? req.body.merge_ids : [])
    .map(Number).filter(n => n && n !== keep)
  if (!keep || ids.length === 0) return res.status(400).json({ error: 'keep_id and a non-empty merge_ids are required' })
  if (!db.prepare('SELECT 1 FROM people WHERE id = ?').get(keep)) return res.status(404).json({ error: 'keep_id not found' })

  const ph = ids.map(() => '?').join(',')
  const reassign = [
    `UPDATE properties            SET owner_id   = ? WHERE owner_id   IN (${ph})`,
    `UPDATE people                SET company_id = ? WHERE company_id IN (${ph})`,
    `UPDATE deals                 SET broker_id  = ? WHERE broker_id  IN (${ph})`,
    `UPDATE handwrytten_sends     SET contact_id = ? WHERE contact_id IN (${ph})`,
    `UPDATE handwrytten_drip_queue SET contact_id = ? WHERE contact_id IN (${ph})`,
    `UPDATE emails                SET person_id  = ? WHERE person_id  IN (${ph})`,
  ]
  const run = db.transaction(() => {
    for (const sql of reassign) {
      try { db.prepare(sql).run(keep, ...ids) } catch (_) { /* table/col may not exist on older installs */ }
    }
    db.prepare(`DELETE FROM people WHERE id IN (${ph})`).run(...ids)
  })
  run()

  const properties_under_keep = db.prepare('SELECT COUNT(*) AS n FROM properties WHERE owner_id = ?').get(keep).n
  res.json({ keep_id: keep, merged: ids.length, properties_under_keep })
})

// POST /api/people/bulk-delete — { ids: [] }
router.post('/bulk-delete', (req, res) => {
  const ids = Array.isArray(req.body?.ids) ? req.body.ids.map(Number).filter(Boolean) : []
  if (!ids.length) return res.status(400).json({ error: 'ids array required' })
  const del = db.prepare('DELETE FROM people WHERE id = ?')
  const run = db.transaction((arr) => { for (const id of arr) del.run(id) })
  run(ids)
  res.json({ deleted: ids.length })
})

export default router
