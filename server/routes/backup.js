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

// GET /api/admin/export-excel — multi-sheet workbook of all data, with a
// "Properties + Owners" sheet that joins every property to its owner.
router.get('/export-excel', async (req, res) => {
  try {
    const ExcelJS = (await import('exceljs')).default
    const wb = new ExcelJS.Workbook()
    wb.creator = 'Knox CRM'
    wb.created = new Date()

    const addSheet = (name, rows) => {
      // Excel sheet names: max 31 chars, no []:*?/\
      const safe = name.replace(/[[\]:*?/\\]/g, ' ').slice(0, 31) || 'Sheet'
      const ws = wb.addWorksheet(safe, { views: [{ state: 'frozen', ySplit: 1 }] })
      if (!rows.length) { ws.addRow(['(no records)']); return }
      const headers = Object.keys(rows[0])
      ws.columns = headers.map(h => ({
        header: h, key: h,
        width: Math.min(40, Math.max(12, h.length + 2)),
      }))
      ws.getRow(1).font = { bold: true }
      ws.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEFF4FB' } }
      for (const r of rows) ws.addRow(r)
    }

    // 1) Properties joined to their owners (LEFT JOIN → every property included)
    const propsWithOwners = db.prepare(`
      SELECT
        p.id, p.address, p.city, p.state, p.zip,
        t.name AS tenant_brand,
        o.name   AS owner_name,
        o.address AS owner_address, o.city AS owner_city, o.state AS owner_state, o.zip AS owner_zip,
        o.phone  AS owner_phone, o.mobile AS owner_mobile, o.email AS owner_email,
        o.do_not_contact AS owner_do_not_contact,
        p.property_type, p.building_size, p.land_area, p.year_built,
        p.lease_type, p.lease_start, p.lease_end, p.annual_rent,
        p.noi, p.cap_rate, p.list_price, p.taxes, p.insurance,
        p.year_purchased, p.purchase_price, p.notes
      FROM properties p
      LEFT JOIN tenant_brands t ON t.id = p.tenant_brand_id
      LEFT JOIN people o        ON o.id = p.owner_id
      ORDER BY p.state, p.city, p.address
    `).all()
    addSheet('Properties + Owners', propsWithOwners)

    // 2) Everyone (owners, brokers, contacts)
    addSheet('People', db.prepare(`SELECT * FROM people ORDER BY name`).all())

    // 3) Every remaining table, raw — so the workbook is a complete backup
    const tables = db.prepare(`
      SELECT name FROM sqlite_master
      WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT IN ('properties','people')
      ORDER BY name
    `).all().map(r => r.name)
    for (const t of tables) {
      try { addSheet(t, db.prepare(`SELECT * FROM "${t}"`).all()) } catch (_) {}
    }

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
    res.setHeader('Content-Disposition', `attachment; filename="knox-crm-data-${stamp()}.xlsx"`)
    await wb.xlsx.write(res)
    res.end()
  } catch (err) {
    console.error('[export-excel]', err.message)
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
