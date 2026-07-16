// Automated database backups. Writes a clean, consistent snapshot of the SQLite
// DB once a day (plus one shortly after boot) and keeps the most recent N.
// VACUUM INTO is safe to run mid-write (WAL-aware). Snapshots live on the same
// Railway volume as the DB — this protects against logical damage (a bad
// migration, an accidental mass delete: just restore yesterday's file). It does
// NOT protect against losing the volume itself; an offsite copy is a future add.
import { join } from 'node:path'
import { mkdirSync, readdirSync, unlinkSync } from 'node:fs'
import db, { DATA_DIR } from '../db.js'

const BACKUP_DIR = join(DATA_DIR, 'backups')
const KEEP        = 14   // retain ~2 weeks of daily snapshots

export function runBackup() {
  try {
    mkdirSync(BACKUP_DIR, { recursive: true })
    const day  = new Date().toISOString().slice(0, 10)         // YYYY-MM-DD
    const file = join(BACKUP_DIR, `knox-crm-${day}.db`)

    // VACUUM INTO fails if the target exists, so replace any same-day snapshot.
    try { unlinkSync(file) } catch (_) {}
    db.exec(`VACUUM INTO '${file.replace(/'/g, "''")}'`)

    // Prune to the most recent KEEP (filenames sort chronologically by date).
    const snaps = readdirSync(BACKUP_DIR).filter(f => /^knox-crm-.*\.db$/.test(f)).sort()
    while (snaps.length > KEEP) {
      const old = snaps.shift()
      try { unlinkSync(join(BACKUP_DIR, old)) } catch (_) {}
    }
    console.log(`[backup] snapshot written: ${file} (${snaps.length} kept)`)
  } catch (err) {
    console.error('[backup] failed:', err.message)
  }
}

export function startBackupEngine() {
  import('node-cron').then(({ default: cron }) => {
    cron.schedule('30 3 * * *', () => runBackup())   // 3:30 AM daily
    console.log('[backup] engine scheduled — daily 3:30 AM')
    setTimeout(() => runBackup(), 60_000)            // one snapshot shortly after boot
  }).catch(err => console.warn('[backup] could not start:', err.message))
}
