import { google } from 'googleapis'
import { Readable } from 'node:stream'
import mammoth from 'mammoth'
import db from '../db.js'
import { getAuthedClient } from './googleClient.js'

const FOLDER_NAME = 'LOIs'

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
    })
    folderId = res.data.files?.[0]?.id || null
    if (folderId) {
      db.prepare(`UPDATE oauth_tokens SET drive_folder_id = ?, updated_at = datetime('now') WHERE provider = 'google'`).run(folderId)
    }
  }
  if (!folderId) return

  // List files added since last check
  const lastCheck = tokenRow.last_drive_check
    ? new Date(tokenRow.last_drive_check).toISOString()
    : new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()

  const filesRes = await drive.files.list({
    q: `'${folderId}' in parents and trashed = false and createdTime > '${lastCheck}'`,
    fields: 'files(id, name, mimeType, createdTime)',
    orderBy: 'createdTime',
  })

  const files = filesRes.data.files || []

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

async function extractText(drive, file) {
  // Google Docs → export as plain text
  if (file.mimeType === 'application/vnd.google-apps.document') {
    const res = await drive.files.export({ fileId: file.id, mimeType: 'text/plain' }, { responseType: 'text' })
    return res.data
  }

  // .docx → mammoth
  if (file.mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
    const res = await drive.files.get({ fileId: file.id, alt: 'media' }, { responseType: 'arraybuffer' })
    const buffer = Buffer.from(res.data)
    const result = await mammoth.extractRawText({ buffer })
    return result.value
  }

  // .txt
  if (file.mimeType === 'text/plain') {
    const res = await drive.files.get({ fileId: file.id, alt: 'media' }, { responseType: 'text' })
    return res.data
  }

  return null
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
