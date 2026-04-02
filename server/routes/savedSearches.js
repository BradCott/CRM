import { Router } from 'express'
import db from '../db.js'

const router = Router()

router.get('/', (req, res) => {
  res.json(db.prepare(`SELECT * FROM saved_searches ORDER BY name`).all())
})

router.post('/', (req, res) => {
  const { name, filters } = req.body
  if (!name) return res.status(400).json({ error: 'name is required' })
  const r = db.prepare(
    `INSERT INTO saved_searches (name, filters) VALUES (?, ?)`
  ).run(name, JSON.stringify(filters))
  res.status(201).json(db.prepare(`SELECT * FROM saved_searches WHERE id = ?`).get(r.lastInsertRowid))
})

router.delete('/:id', (req, res) => {
  db.prepare(`DELETE FROM saved_searches WHERE id = ?`).run(req.params.id)
  res.status(204).end()
})

export default router
