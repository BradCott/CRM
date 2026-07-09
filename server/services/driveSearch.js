// On-demand Google Drive search — find documents relevant to a property.
// Reuses the shared Knox Google account + Drive readonly scope already wired up
// for the LOI/meeting-notes watchers.
import { google } from 'googleapis'
import db from '../db.js'
import { getAuthedClient } from './googleClient.js'

// Shared Drives are invisible to the Drive API unless every call opts in.
const ALL_DRIVES = {
  supportsAllDrives:         true,
  includeItemsFromAllDrives: true,
  corpora:                   'allDrives',
}

// Escape a term for embedding in a Drive `q` string (single-quoted literals).
const esc = (s) => String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'")

/**
 * Search Drive (My Drive + shared drives) for files whose name or full text
 * contains any of the given terms. Returns deduped files newest-first.
 */
export async function searchDriveDocs(terms, { limit = 40 } = {}) {
  const tokenRow = db.prepare(`SELECT * FROM oauth_tokens WHERE provider = 'google'`).get()
  if (!tokenRow?.access_token) return { connected: false, files: [] }

  let auth
  try { auth = getAuthedClient(tokenRow) } catch { return { connected: false, files: [] } }
  const drive = google.drive({ version: 'v3', auth })

  const cleaned = [...new Set(terms.map(t => (t || '').trim()).filter(t => t.length >= 3))]
  const byId = new Map()

  for (const term of cleaned) {
    const e = esc(term)
    try {
      const res = await drive.files.list({
        q: `(name contains '${e}' or fullText contains '${e}') and trashed = false and mimeType != 'application/vnd.google-apps.folder'`,
        fields: 'files(id, name, mimeType, webViewLink, iconLink, modifiedTime, size)',
        orderBy: 'modifiedTime desc',
        pageSize: 25,
        ...ALL_DRIVES,
      })
      for (const f of res.data.files || []) {
        if (!byId.has(f.id)) byId.set(f.id, { ...f, matchedTerm: term })
      }
    } catch (err) {
      // One bad term shouldn't sink the whole search.
      console.warn('[driveSearch] term failed:', term, err.message)
    }
  }

  const files = [...byId.values()]
    .sort((a, b) => (b.modifiedTime || '').localeCompare(a.modifiedTime || ''))
    .slice(0, limit)
  return { connected: true, files }
}

/** Build the search terms for a property, then search Drive. */
export async function searchDriveForProperty(propertyId) {
  const p = db.prepare(`
    SELECT pr.address, pr.city, pr.state, pr.store_number, tb.name AS brand
    FROM properties pr
    LEFT JOIN tenant_brands tb ON tb.id = pr.tenant_brand_id
    WHERE pr.id = ?
  `).get(propertyId)
  if (!p) return { connected: true, files: [], terms: [] }

  const terms = []
  if (p.address) terms.push(p.address)                       // "123 Main St"
  if (p.brand && p.city) terms.push(`${p.brand} ${p.city}`)  // "Advance Auto Parts Knoxville"
  else if (p.brand) terms.push(p.brand)
  if (p.store_number) terms.push(String(p.store_number))

  const out = await searchDriveDocs(terms)
  return { ...out, terms }
}
