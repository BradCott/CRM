import { Router } from 'express'
import db from '../db.js'

const router = Router()

const BASE_SELECT = `
  SELECT p.*,
    c.name AS company_name
  FROM people p
  LEFT JOIN people c ON c.id = p.company_id
`

// GET /api/people?search=&role=&sub_label=&do_not_contact=&owner_type=&limit=50&offset=0
router.get('/', (req, res) => {
  const {
    search = '',
    role = '',
    sub_label = '',
    do_not_contact = '',
    owner_type = '',
    limit = 50,
    offset = 0,
  } = req.query

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

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''

  const total = db.prepare(`SELECT COUNT(*) AS n FROM people p ${where}`).get(...params).n
  const rows  = db.prepare(`${BASE_SELECT} ${where} ORDER BY p.name LIMIT ? OFFSET ?`).all(...params, parseInt(limit), parseInt(offset))

  res.json({ total, rows })
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
       do_not_contact,notes,sf_id,owner_type)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
  `).run(
    f.name, f.first_name||null, f.last_name||null,
    f.role||'owner', f.sub_label||null, f.company_id||null,
    f.phone||null, f.phone2||null, f.mobile||null,
    f.email||null, f.email2||null,
    f.address||null, f.city||null, f.state||null, f.zip||null,
    f.address2||null, f.city2||null, f.state2||null, f.zip2||null,
    f.do_not_contact ? 1 : 0, f.notes||null, f.sf_id||null,
    f.owner_type||'Individual'
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
      do_not_contact=?,notes=?,sf_id=?,owner_type=?
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
    req.params.id
  )
  res.json(db.prepare(`${BASE_SELECT} WHERE p.id = ?`).get(req.params.id))
})

router.delete('/:id', (req, res) => {
  db.prepare('DELETE FROM people WHERE id = ?').run(req.params.id)
  res.status(204).end()
})

export default router
