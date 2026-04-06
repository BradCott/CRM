import { google } from 'googleapis'
import db from '../db.js'
import { getAuthedClient } from './googleClient.js'

/**
 * Sync Gmail emails to CRM contacts.
 * Strategy: list all messages since last sync, fetch metadata headers,
 * match From/To against known contact emails, store new records.
 */
export async function syncGmail() {
  const tokenRow = db.prepare(`SELECT * FROM oauth_tokens WHERE provider = 'google'`).get()
  if (!tokenRow?.access_token) throw new Error('Google account not connected')

  const auth  = getAuthedClient(tokenRow)
  const gmail = google.gmail({ version: 'v1', auth })

  // Build date filter — sync from last sync date or 90 days back
  const since = tokenRow.last_gmail_sync
    ? new Date(tokenRow.last_gmail_sync)
    : new Date(Date.now() - 90 * 24 * 60 * 60 * 1000)

  const afterStr = `${since.getFullYear()}/${String(since.getMonth() + 1).padStart(2, '0')}/${String(since.getDate()).padStart(2, '0')}`
  const query    = `after:${afterStr}`

  // Build email→person_id map from all contacts
  const contacts = db.prepare(`SELECT id, email, email2 FROM people WHERE email IS NOT NULL OR email2 IS NOT NULL`).all()
  const emailMap = {}
  for (const c of contacts) {
    if (c.email)  emailMap[c.email.toLowerCase().trim()]  = c.id
    if (c.email2) emailMap[c.email2.toLowerCase().trim()] = c.id
  }
  if (Object.keys(emailMap).length === 0) return { synced: 0 }

  let pageToken = null
  let synced    = 0

  do {
    const listRes = await gmail.users.messages.list({
      userId: 'me',
      q: query,
      maxResults: 100,
      ...(pageToken ? { pageToken } : {}),
    })

    const messages = listRes.data.messages || []
    pageToken = listRes.data.nextPageToken || null

    for (const msg of messages) {
      // Skip if already stored
      const exists = db.prepare(`SELECT id FROM emails WHERE gmail_message_id = ?`).get(msg.id)
      if (exists) continue

      const detail = await gmail.users.messages.get({
        userId: 'me',
        id:     msg.id,
        format: 'metadata',
        metadataHeaders: ['From', 'To', 'Subject', 'Date'],
      })

      const headers = {}
      for (const h of (detail.data.payload?.headers || [])) {
        headers[h.name.toLowerCase()] = h.value
      }

      const fromAddr = extractEmail(headers['from'] || '')
      const toAddr   = extractEmail(headers['to']   || '')
      const subject  = headers['subject'] || '(no subject)'
      const date     = headers['date']    ? new Date(headers['date']).toISOString() : new Date().toISOString()
      const snippet  = detail.data.snippet || ''

      const personId = emailMap[fromAddr] ?? emailMap[toAddr] ?? null
      if (!personId) continue

      const direction = emailMap[fromAddr] ? 'inbound' : 'outbound'

      try {
        db.prepare(`
          INSERT OR IGNORE INTO emails
            (person_id, gmail_message_id, thread_id, direction, subject, body_preview, from_address, to_address, date)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(personId, msg.id, detail.data.threadId, direction, subject, snippet, headers['from'] || '', headers['to'] || '', date)
        synced++
      } catch (_) {}
    }
  } while (pageToken)

  // Update last sync timestamp
  db.prepare(`
    UPDATE oauth_tokens SET last_gmail_sync = datetime('now'), updated_at = datetime('now')
    WHERE provider = 'google'
  `).run()

  return { synced }
}

function extractEmail(str) {
  const m = str.match(/<([^>]+)>/) || str.match(/([^\s,]+@[^\s,]+)/)
  return m ? m[1].toLowerCase().trim() : str.toLowerCase().trim()
}
