import { google } from 'googleapis'
import { Readable } from 'node:stream'
import mammoth from 'mammoth'
import db from '../db.js'
import { getAuthedClient } from './googleClient.js'
import { parseLOIText } from './loiParser.js'

const FOLDER_NAME = 'LOIs'

// Shared Drives ("Team Drives") are invisible to the Drive API unless every
// call opts in with these flags. Knox's "Knoxcre" drive is a Shared Drive, so
// without them the folder search and file listings silently return nothing.
const ALL_DRIVES = {
  supportsAllDrives:         true,
  includeItemsFromAllDrives: true,
  corpora:                   'allDrives',
}

// Resolve the LOIs folder, preferring one that actually lives under "Knox CRE"
// (there can be more than one folder named "LOIs" in the account/shared drives).
async function resolveLoiFolderId(drive) {
  const res = await drive.files.list({
    q: `name = '${FOLDER_NAME}' and mimeType = 'application/vnd.google-apps.folder' and trashed = false`,
    fields: 'files(id, name, parents, driveId)',
    ...ALL_DRIVES,
  })
  const candidates = res.data.files || []
  if (candidates.length === 0) return null
  if (candidates.length === 1) return candidates[0].id

  // Multiple "LOIs" folders — pick the one whose parent is the Knox CRE folder.
  for (const c of candidates) {
    const parentId = c.parents?.[0]
    if (!parentId) continue
    try {
      const parent = await drive.files.get({ fileId: parentId, fields: 'name', supportsAllDrives: true })
      if (/knox\s*cre/i.test(parent.data.name || '')) {
        console.log(`[driveWatcher] picked LOIs folder under "${parent.data.name}"`)
        return c.id
      }
    } catch (_) {}
  }
  console.warn(`[driveWatcher] ${candidates.length} "LOIs" folders found, none clearly under "Knox CRE" — using the first. Pin the exact folder in Settings if this is wrong.`)
  return candidates[0].id
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
    folderId = await resolveLoiFolderId(drive)
    if (folderId) {
      db.prepare(`UPDATE oauth_tokens SET drive_folder_id = ?, updated_at = datetime('now') WHERE provider = 'google'`).run(folderId)
    }
  }
  if (!folderId) {
    console.warn('[driveWatcher] LOIs folder not found in Drive (incl. shared drives)')
    return
  }

  // List the folder's files. We DON'T filter by createdTime: Drive's createdTime
  // is when a doc was created, not when it was moved into LOIs — so an LOI drafted
  // elsewhere and later filed here would be silently skipped. Instead we list the
  // current contents and rely on the processed-id list (+ deal title dedupe) for
  // idempotency, so nothing is ever missed regardless of how it got into the folder.
  const filesRes = await drive.files.list({
    q: `'${folderId}' in parents and trashed = false`,
    fields: 'files(id, name, mimeType, createdTime, modifiedTime)',
    orderBy: 'modifiedTime desc',
    pageSize: 100,
    ...ALL_DRIVES,
  })

  const files = filesRes.data.files || []
  console.log(`[driveWatcher] LOIs folder has ${files.length} file(s)`)

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
  const title = filename.replace(/\.[^.]+$/, '').trim()

  // Dedupe — don't recreate a deal we already imported from this LOI
  const existing = db.prepare(
    `SELECT id FROM deals WHERE source = 'drive_loi' AND title = ?`
  ).get(title)
  if (existing) {
    console.log(`[driveWatcher] LOI "${title}" already imported (deal ${existing.id}) — skipping`)
    return
  }

  // Parse with the same AI extractor the manual upload uses; fall back to a
  // basic price regex if the API key is missing or the call fails.
  let f = {}
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (apiKey) {
    try {
      f = await parseLOIText(text, apiKey)
    } catch (err) {
      console.error(`[driveWatcher] AI parse failed for "${title}":`, err.message)
    }
  }

  if (f.purchase_price == null) {
    const priceMatch = text.match(/\$[\d,]+(?:\.\d+)?(?:\s*[Mm]illion)?|\d+(?:\.\d+)?\s*[Mm]illion/i)
    if (priceMatch) {
      const raw = priceMatch[0].replace(/[$,\s]/g, '')
      f.purchase_price = /million/i.test(raw) ? parseFloat(raw) * 1_000_000 : parseFloat(raw)
    }
  }

  // Link to a market property by exact address if we can
  let propertyId = null
  if (f.address) {
    const prop = db.prepare(
      `SELECT id FROM properties WHERE LOWER(TRIM(address)) = LOWER(TRIM(?)) LIMIT 1`
    ).get(f.address)
    if (prop) propertyId = prop.id
  }

  // Estimate a DD deadline from today + due-diligence days (best guess for visibility)
  let ddDeadline = null
  if (f.due_diligence_days) {
    ddDeadline = new Date(Date.now() + f.due_diligence_days * 86_400_000).toISOString().slice(0, 10)
  }

  const r = db.prepare(`
    INSERT INTO deals
      (title, property_id, stage, purchase_price, offer_price, close_date,
       address, city, state, tenant, cap_rate, due_diligence_days, dd_deadline,
       earnest_money, source, notes, created_at, updated_at)
    VALUES (?, ?, 'loi', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'drive_loi', ?, datetime('now'), datetime('now'))
  `).run(
    title, propertyId,
    f.purchase_price ?? null, f.purchase_price ?? null, f.close_date ?? null,
    f.address ?? null, f.city ?? null, f.state ?? null, f.tenant ?? null,
    f.cap_rate ?? null, f.due_diligence_days ?? null, ddDeadline,
    f.earnest_money ?? null,
    `Auto-created from Google Drive LOI: ${filename}`
  )
  console.log(`[driveWatcher] Created LOI deal ${r.lastInsertRowid}: "${title}"`)
}
