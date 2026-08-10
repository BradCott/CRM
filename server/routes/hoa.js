import { Router } from 'express'
import db from '../db.js'

const router = Router()

// GET /api/hoa/registrations — return all registrations sorted by lot
router.get('/registrations', (_req, res) => {
  const rows = db.prepare(`SELECT * FROM hoa_registrations ORDER BY lot_number`).all()
  res.json({ success: true, registrations: rows.map(r => ({
    lot:        r.lot_number,
    firstName:  r.first_name,
    lastName:   r.last_name,
    email:      r.email,
    phone:      r.phone,
    firstName2: r.first_name2,
    lastName2:  r.last_name2,
    email2:     r.email2,
    phone2:     r.phone2,
    years:      r.years_at_address,
    kids:       r.kids,
    support:    r.support,
  })) })
})

// POST /api/hoa/register — insert or update a registration by lot number
router.post('/register', (req, res) => {
  const { lot, firstName, lastName, email, phone,
          firstName2, lastName2, email2, phone2,
          years, kids, support } = req.body

  if (!lot || !firstName || !lastName || !email) {
    return res.status(400).json({ error: 'lot, firstName, lastName, email are required' })
  }

  db.prepare(`
    INSERT INTO hoa_registrations
      (lot_number, first_name, last_name, email, phone,
       first_name2, last_name2, email2, phone2,
       years_at_address, kids, support)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(lot_number) DO UPDATE SET
      first_name       = excluded.first_name,
      last_name        = excluded.last_name,
      email            = excluded.email,
      phone            = excluded.phone,
      first_name2      = excluded.first_name2,
      last_name2       = excluded.last_name2,
      email2           = excluded.email2,
      phone2           = excluded.phone2,
      years_at_address = excluded.years_at_address,
      kids             = excluded.kids,
      support          = excluded.support,
      updated_at       = CURRENT_TIMESTAMP
  `).run(
    Number(lot),
    firstName, lastName, email, phone || null,
    firstName2 || null, lastName2 || null, email2 || null, phone2 || null,
    years || null, kids || null, support || null
  )

  res.json({ success: true })
})

export default router
