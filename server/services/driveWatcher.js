import { google } from 'googleapis'
import { Readable } from 'node:stream'
import mammoth from 'mammoth'
import db from '../db.js'
import { getAuthedClient } from './googleClient.js'

const FOLDER_NAME = 'LOIs'

// Shared Drives ("Team Drives") are invisible to the Drive API unless every
// call opts in with these flags. Knox's "Knoxcre" drive is a Shared Drive, so
// without them the folder search and file listings silently return nothing.
const ALL_DRIVES = {
  supportsAllDrives:         true,
  includeItemsFromAllDrives: true,
  corpora:                   'allDrives',
}

export async function watchDrive() {
  const tokenRow = db.prepare(`SELECT * FROM oauth_tokens WHERE provider = 'google'`).get()
  if (!tokenRow?.access_token) return

  let auth
  try {
    auth = getAuthedClient(tokenRow)
  } catch (_) { return }

  const drive = google.drive({ version: 'v3', auth })

  // Find or cache the LOIs folder ID
  let folderId = tokenRow.drive_folder_id
  if (!folderId) {
    const res = await drive.files.list({
      q: `name = '${FOLDER_NAME}' and mimeType = 'application/vnd.google-apps.folder' and trashed = false`,
      fields: 'files(id, name)',
      ...ALL_DRIVES,
    })
    folderId = res.data.files?.[0]?.id || null
    if (folderId) {
      db.prepare(`UPDATE oauth_tokens SET drive_folder_id = ?, updated_at = datetime('now') WHERE provider = 'google'`).run(folderId)
    }
  }
  if (!folderId) {
    console.warn('[driveWatcher] LOIs folder not found in Drive (incl. shared drives)')
    return
  }

  // List files added since last check
  const lastCheck = tokenRow.last_drive_check
    ? new Date(tokenRow.last_drive_check).toISOString()
    : new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()

  const filesRes = await drive.files.list({
    q: `'${folderId}' in parents and trashed = false and createdTime > '${lastCheck}'`,
    fields: 'files(id, name, mimeType, createdTime)',
    orderBy: 'createdTime',
    ...ALL_DRIVES,
  })

  const files = filesRes.data.files || []
  if (files.length) console.log(`[driveWatcher] ${files.length} new file(s) in LOIs folder`)

  // Load already-processed file IDs
  let processed = []
  try { processed = JSON.parse(tokenRow.lois_processed || '[]') } catch (_) {}

  for (const file of files) {
    if (processed.includes(file.id)) continue

    try {
      const text = await extractText(drive, file)
      if (text) {
        await createDealFromLOI(file.name, text, file.id)
      }
      processed.push(file.id)
    } catch (err) {
      console.error(`[driveWatcher] Failed to process ${file.name}:`, err.message)
    }
  }

  db.prepare(`
    UPDATE oauth_tokens
    SET last_drive_check = datetime('now'),
        lois_processed   = ?,
        updated_at       = datetime('now')
    WHERE provider = 'google'
  `).run(JSON.stringify(processed.slice(-200)))
}

// ── Meeting Notes folder → Today's Plays ──────────────────────────────────────
// New doc dropped each Monday; parse action items + assignees into plays.

const NOTES_FOLDER_NAME = 'monday meetings'   // lives at Knoxcre/meetings/monday meetings

export async function watchMeetingNotes() {
  const tokenRow = db.prepare(`SELECT * FROM oauth_tokens WHERE provider = 'google'`).get()
  if (!tokenRow?.access_token) return

  let auth
  try { auth = getAuthedClient(tokenRow) } catch (_) { return }
  const drive = google.drive({ version: 'v3', auth })

  let folderId = tokenRow.notes_folder_id
  if (!folderId) {
    const res = await drive.files.list({
      q: `name = '${NOTES_FOLDER_NAME}' and mimeType = 'application/vnd.google-apps.folder' and trashed = false`,
      fields: 'files(id, name)',
      ...ALL_DRIVES,
    })
    folderId = res.data.files?.[0]?.id || null
    if (folderId) {
      db.prepare(`UPDATE oauth_tokens SET notes_folder_id = ?, updated_at = datetime('now') WHERE provider = 'google'`).run(folderId)
    }
  }
  if (!folderId) {
    console.warn(`[driveWatcher] "${NOTES_FOLDER_NAME}" folder not found in Drive (incl. shared drives)`)
    return
  }

  // Only docs created in the last 7 days — keeps the first run from parsing
  // months of old meeting notes into stale plays.
  const recentCutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()
  const filesRes = await drive.files.list({
    q: `'${folderId}' in parents and trashed = false and createdTime > '${recentCutoff}'`,
    fields: 'files(id, name, mimeType, createdTime)',
    orderBy: 'createdTime desc',
    pageSize: 10,
    ...ALL_DRIVES,
  })
  const files = filesRes.data.files || []

  let processed = []
  try { processed = JSON.parse(tokenRow.notes_processed || '[]') } catch (_) {}

  for (const file of files) {
    if (processed.includes(file.id)) continue
    try {
      const text = await extractText(drive, file)
      if (text && text.trim().length > 20) {
        const { parseMeetingNotesText } = await import('./playsEngine.js')
        await parseMeetingNotesText(file.name, text, file.id)
      }
      processed.push(file.id)
    } catch (err) {
      console.error(`[driveWatcher] Failed to process meeting notes ${file.name}:`, err.message)
    }
  }

  db.prepare(`
    UPDATE oauth_tokens SET notes_processed = ?, updated_at = datetime('now') WHERE provider = 'google'
  `).run(JSON.stringify(processed.slice(-100)))
}

async function extractText(drive, file) {
  // Google Docs → export as plain text
  if (file.mimeType === 'application/vnd.google-apps.document') {
    const res = await drive.files.export(
      { fileId: file.id, mimeType: 'text/plain', supportsAllDrives: true },
      { responseType: 'text' }
    )
    return res.data
  }

  // .docx → mammoth
  if (file.mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
    const res = await drive.files.get(
      { fileId: file.id, alt: 'media', supportsAllDrives: true },
      { responseType: 'arraybuffer' }
    )
    const buffer = Buffer.from(res.data)
    const result = await mammoth.extractRawText({ buffer })
    return result.value
  }

  // .txt
  if (file.mimeType === 'text/plain') {
    const res = await drive.files.get(
      { fileId: file.id, alt: 'media', supportsAllDrives: true },
      { responseType: 'text' }
    )
    return res.data
  }

  return null
}

// ── Diagnostics — run live and report each step so the UI can show what's wrong ──

export async function diagnoseDrive() {
  const tokenRow = db.prepare(`SELECT * FROM oauth_tokens WHERE provider = 'google'`).get()
  if (!tokenRow?.access_token) {
    return { connected: false, step: 'auth', message: 'No Google account connected.' }
  }

  let auth
  try { auth = getAuthedClient(tokenRow) }
  catch (e) { return { connected: false, step: 'auth', message: `Auth client failed: ${e.message}` } }

  const drive = google.drive({ version: 'v3', auth })
  const out = { connected: true, email: tokenRow.email, folders: {} }

  for (const [key, name] of [['LOIs', FOLDER_NAME], ['notes', NOTES_FOLDER_NAME]]) {
    const entry = { name }
    try {
      const res = await drive.files.list({
        q: `name = '${name}' and mimeType = 'application/vnd.google-apps.folder' and trashed = false`,
        fields: 'files(id, name, driveId)',
        ...ALL_DRIVES,
      })
      const folder = res.data.files?.[0]
      if (!folder) {
        entry.found = false
        entry.message = `No folder named "${name}" visible to ${tokenRow.email} (searched My Drive + shared drives).`
      } else {
        entry.found = true
        entry.folderId = folder.id
        entry.inSharedDrive = !!folder.driveId
        const filesRes = await drive.files.list({
          q: `'${folder.id}' in parents and trashed = false`,
          fields: 'files(id, name, mimeType, createdTime)',
          orderBy: 'createdTime desc',
          pageSize: 10,
          ...ALL_DRIVES,
        })
        const files = filesRes.data.files || []
        entry.fileCount = files.length
        entry.recentFiles = files.slice(0, 5).map(f => ({ name: f.name, created: f.createdTime }))
        entry.message = files.length
          ? `Found ${files.length} file(s).`
          : 'Folder found but it is empty.'
      }
    } catch (e) {
      entry.found = false
      entry.error = e.message
      entry.message = `Drive API error: ${e.message}`
    }
    out.folders[key] = entry
  }

  return out
}

async function createDealFromLOI(filename, text, fileId) {
  // Extract price from text (e.g. "$1,200,000" or "1.2M")
  let offerPrice = null
  const priceMatch = text.match(/\$[\d,]+(?:\.\d+)?(?:\s*[Mm]illion)?|\d+(?:\.\d+)?\s*[Mm]illion/i)
  if (priceMatch) {
    const raw = priceMatch[0].replace(/[$,\s]/g, '')
    if (/million/i.test(raw)) {
      offerPrice = parseFloat(raw) * 1_000_000
    } else {
      offerPrice = parseFloat(raw)
    }
  }

  // Use filename (without extension) as deal title
  const title = filename.replace(/\.[^.]+$/, '').trim()

  // Check for a matching property by address keywords
  let propertyId = null
  const addressMatch = text.match(/\d+\s+[A-Za-z0-9\s]+(?:St|Ave|Blvd|Dr|Rd|Way|Lane|Ln|Ct|Court|Pkwy|Parkway|Hwy|Highway)[.,\s]/i)
  if (addressMatch) {
    const addr = addressMatch[0].trim().replace(/[,.]$/, '')
    const prop = db.prepare(`SELECT id FROM properties WHERE address LIKE ? LIMIT 1`).get(`%${addr.split(' ').slice(0, 3).join('%')}%`)
    if (prop) propertyId = prop.id
  }

  db.prepare(`
    INSERT INTO deals (title, property_id, stage, offer_price, source, notes)
    VALUES (?, ?, 'lead', ?, 'drive_loi', ?)
  `).run(title, propertyId, offerPrice, `Auto-created from Google Drive LOI: ${filename}`)
}
