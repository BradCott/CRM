// On-demand Google Drive lookup — find the RIGHT property folder and list its docs.
// Knox files each property under "Knox CRE / Current Properties / <Brand> - <City>, <State>"
// (e.g. "Goodyear - Reynoldburg OH"), with nested subfolders (Escrow, PSA, dd…).
// So we match the property to its folder by brand + city, then list it recursively —
// rather than a global keyword search (which returned unrelated files).
import { google } from 'googleapis'
import db from '../db.js'
import { getAuthedClient } from './googleClient.js'

// Shared Drives are invisible to the Drive API unless every call opts in.
const ALL_DRIVES = {
  supportsAllDrives:         true,
  includeItemsFromAllDrives: true,
  corpora:                   'allDrives',
}
const FOLDER_MIME = 'application/vnd.google-apps.folder'
const esc = (s) => String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'")
const norm = (s) => (s || '').toLowerCase().replace(/[^a-z0-9]/g, '')

function getDrive() {
  const tokenRow = db.prepare(`SELECT * FROM oauth_tokens WHERE provider = 'google'`).get()
  if (!tokenRow?.access_token) return null
  try { return google.drive({ version: 'v3', auth: getAuthedClient(tokenRow) }) }
  catch { return null }
}

// Download a Drive file's bytes (exporting Google-native docs to a real format)
// so the browser can hand it straight to the accounting importers.
export async function fetchDriveFile(fileId) {
  const drive = getDrive()
  if (!drive) throw new Error('No Google account is connected')
  const meta = await drive.files.get({ fileId, fields: 'id, name, mimeType', supportsAllDrives: true })
  let { name, mimeType } = meta.data
  const EXPORT = {
    'application/vnd.google-apps.spreadsheet':  { mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', ext: '.xlsx' },
    'application/vnd.google-apps.document':     { mime: 'application/pdf', ext: '.pdf' },
    'application/vnd.google-apps.presentation': { mime: 'application/pdf', ext: '.pdf' },
  }
  if (EXPORT[mimeType]) {
    const ex = EXPORT[mimeType]
    const res = await drive.files.export({ fileId, mimeType: ex.mime }, { responseType: 'arraybuffer' })
    if (!name.toLowerCase().endsWith(ex.ext)) name += ex.ext
    return { buffer: Buffer.from(res.data), name, mimeType: ex.mime }
  }
  const res = await drive.files.get({ fileId, alt: 'media', supportsAllDrives: true }, { responseType: 'arraybuffer' })
  return { buffer: Buffer.from(res.data), name, mimeType }
}

// ── Global keyword search (fallback when no property folder is found) ──────────
export async function searchDriveDocs(terms, { limit = 40 } = {}) {
  const drive = getDrive()
  if (!drive) return { connected: false, files: [] }

  const cleaned = [...new Set(terms.map(t => (t || '').trim()).filter(t => t.length >= 3))]
  const byId = new Map()
  for (const term of cleaned) {
    const e = esc(term)
    try {
      const res = await drive.files.list({
        q: `(name contains '${e}' or fullText contains '${e}') and trashed = false and mimeType != '${FOLDER_MIME}'`,
        fields: 'files(id, name, mimeType, webViewLink, iconLink, modifiedTime)',
        orderBy: 'modifiedTime desc', pageSize: 25, ...ALL_DRIVES,
      })
      for (const f of res.data.files || []) if (!byId.has(f.id)) byId.set(f.id, f)
    } catch (err) { console.warn('[driveSearch] term failed:', term, err.message) }
  }
  const files = [...byId.values()].sort((a, b) => (b.modifiedTime || '').localeCompare(a.modifiedTime || '')).slice(0, limit)
  return { connected: true, files }
}

// ── Find the property's folder by name (Brand + City), tolerant of typos ───────
async function findPropertyFolder(drive, p) {
  const brand = norm(p.brand)
  const city  = norm(p.city)
  const state = norm(p.state)
  // Search folders by the most distinctive token we have (brand, else city).
  const searchToken = (p.brand || p.city || '').trim()
  if (searchToken.length < 3) return null

  let candidates = []
  try {
    const res = await drive.files.list({
      q: `mimeType = '${FOLDER_MIME}' and trashed = false and name contains '${esc(searchToken)}'`,
      fields: 'files(id, name, webViewLink, parents)',
      pageSize: 100, ...ALL_DRIVES,
    })
    candidates = res.data.files || []
  } catch (err) { console.warn('[driveSearch] folder search failed:', err.message); return null }

  // Score: city is the disambiguator (many "Goodyear" folders, one per city).
  const score = (name) => {
    const n = norm(name)
    let s = 0
    if (brand && n.includes(brand)) s += 2
    if (city && city.length >= 4 && n.includes(city.slice(0, 5))) s += 3
    if (state && n.includes(state)) s += 1
    return s
  }
  const ranked = candidates
    .map(f => ({ ...f, score: score(f.name) }))
    .sort((a, b) => b.score - a.score)

  const best = ranked[0]
  // Require a city (or a strong brand-only) match so we don't grab a random folder.
  if (best && best.score >= 3) return best
  if (best && best.score >= 2 && ranked.length === 1) return best
  return null
}

// ── List a folder's files recursively (files first, then descend subfolders) ───
async function listFolderRecursive(drive, folderId, { maxDepth = 4, cap = 200 } = {}) {
  const out = []
  async function walk(id, prefix, depth) {
    if (depth > maxDepth || out.length >= cap) return
    let res
    try {
      res = await drive.files.list({
        q: `'${id}' in parents and trashed = false`,
        fields: 'files(id, name, mimeType, webViewLink, iconLink, modifiedTime)',
        orderBy: 'folder,name', pageSize: 200, ...ALL_DRIVES,
      })
    } catch { return }
    const items = res.data.files || []
    const folders = items.filter(f => f.mimeType === FOLDER_MIME)
    for (const f of items) {
      if (f.mimeType === FOLDER_MIME) continue
      out.push({ ...f, folderPath: prefix })
      if (out.length >= cap) return
    }
    for (const sub of folders) {
      if (out.length >= cap) return
      await walk(sub.id, prefix ? `${prefix} / ${sub.name}` : sub.name, depth + 1)
    }
  }
  await walk(folderId, '', 0)
  return out
}

/**
 * Find the property's Drive folder and list its documents. Caches the folder id
 * on the property so subsequent lookups are instant. Pass { rematch:true } to
 * force a fresh folder search. Falls back to a keyword search if no folder found.
 */
export async function searchDriveForProperty(propertyId, { rematch = false } = {}) {
  const drive = getDrive()
  if (!drive) return { connected: false, files: [] }

  const p = db.prepare(`
    SELECT pr.address, pr.city, pr.state, pr.store_number, pr.drive_folder_id, pr.drive_folder_name,
           tb.name AS brand
    FROM properties pr
    LEFT JOIN tenant_brands tb ON tb.id = pr.tenant_brand_id
    WHERE pr.id = ?
  `).get(propertyId)
  if (!p) return { connected: true, files: [], folder: null }

  // Resolve the folder: cached → else auto-match by brand + city.
  let folder = null
  if (p.drive_folder_id && !rematch) {
    folder = { id: p.drive_folder_id, name: p.drive_folder_name, webViewLink: `https://drive.google.com/drive/folders/${p.drive_folder_id}` }
  } else {
    const match = await findPropertyFolder(drive, p)
    if (match) {
      folder = { id: match.id, name: match.name, webViewLink: match.webViewLink }
      try {
        db.prepare('UPDATE properties SET drive_folder_id = ?, drive_folder_name = ? WHERE id = ?')
          .run(match.id, match.name, propertyId)
      } catch { /* non-fatal */ }
    }
  }

  if (folder) {
    const files = await listFolderRecursive(drive, folder.id)
    files.sort((a, b) => (b.modifiedTime || '').localeCompare(a.modifiedTime || ''))
    return { connected: true, folder, files, matched: 'folder' }
  }

  // No folder — fall back to the old keyword search so it's never worse than before.
  const terms = []
  if (p.brand && p.city) terms.push(`${p.brand} ${p.city}`)
  else if (p.address) terms.push(p.address)
  const out = await searchDriveDocs(terms)
  return { ...out, folder: null, matched: 'keyword', terms }
}
