// Full-data export / backup (admin only).
import { Router } from 'express'
import { join } from 'node:path'
import { createReadStream, statSync, unlink } from 'node:fs'
import db, { DATA_DIR } from '../db.js'

const router = Router()

const stamp = () => new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)

// GET /api/admin/backup — complete, restorable SQLite database file
router.get('/backup', (req, res) => {
  // VACUUM INTO writes a clean, consistent snapshot (safe even mid-write / WAL)
  const tmp = join(DATA_DIR, `backup-${Date.now()}.db`)
  try {
    db.exec(`VACUUM INTO '${tmp.replace(/'/g, "''")}'`)
  } catch (err) {
    console.error('[backup] VACUUM failed:', err.message)
    return res.status(500).json({ error: 'Could not create backup snapshot' })
  }

  res.setHeader('Content-Type', 'application/octet-stream')
  res.setHeader('Content-Disposition', `attachment; filename="knox-crm-backup-${stamp()}.db"`)
  try { res.setHeader('Content-Length', statSync(tmp).size) } catch {}

  const stream = createReadStream(tmp)
  stream.pipe(res)
  const cleanup = () => unlink(tmp, () => {})
  stream.on('close', cleanup)
  stream.on('error', () => { cleanup(); if (!res.headersSent) res.status(500).end() })
})

// GET /api/admin/export-json — every table dumped to one JSON file (human-readable)
router.get('/export-json', (req, res) => {
  try {
    const tables = db.prepare(`
      SELECT name FROM sqlite_master
      WHERE type = 'table' AND name NOT LIKE 'sqlite_%'
      ORDER BY name
    `).all().map(r => r.name)

    const out = { exported_at: new Date().toISOString(), tables: {} }
    for (const t of tables) {
      try { out.tables[t] = db.prepare(`SELECT * FROM "${t}"`).all() }
      catch (e) { out.tables[t] = { error: e.message } }
    }

    res.setHeader('Content-Type', 'application/json')
    res.setHeader('Content-Disposition', `attachment; filename="knox-crm-data-${stamp()}.json"`)
    res.send(JSON.stringify(out, null, 2))
  } catch (err) {
    console.error('[export-json]', err.message)
    res.status(500).json({ error: err.message })
  }
})

// GET /api/admin/backup/info — row counts per table (for the UI)
router.get('/backup/info', (req, res) => {
  const tables = db.prepare(`
    SELECT name FROM sqlite_master
    WHERE type = 'table' AND name NOT LIKE 'sqlite_%'
    ORDER BY name
  `).all().map(r => r.name)
  const counts = {}
  let totalRows = 0
  for (const t of tables) {
    try {
      const n = db.prepare(`SELECT COUNT(*) AS n FROM "${t}"`).get().n
      counts[t] = n
      totalRows += n
    } catch { counts[t] = null }
  }
  res.json({ tableCount: tables.length, totalRows, counts })
})

export default router
