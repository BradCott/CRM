import { Router } from 'express'
import { google } from 'googleapis'
import db from '../db.js'
import { getOAuth2Client } from '../services/googleClient.js'

const router = Router()

const SCOPES = [
  'https://www.googleapis.com/auth/drive.readonly',
  'https://www.googleapis.com/auth/userinfo.email',
]

// GET /api/auth/google — initiate OAuth flow
router.get('/google', (_req, res) => {
  const auth = getOAuth2Client()
  const url  = auth.generateAuthUrl({
    access_type: 'offline',
    prompt:      'consent',
    scope:       SCOPES,
  })
  res.redirect(url)
})

// GET /api/auth/google/callback — OAuth callback
router.get('/google/callback', async (req, res) => {
  const { code, error } = req.query
  if (error || !code) {
    return res.redirect(clientUrl('/settings?google=error'))
  }

  try {
    const auth = getOAuth2Client()
    const { tokens } = await auth.getToken(code)
    auth.setCredentials(tokens)

    // Get user's email
    const oauth2 = google.oauth2({ version: 'v2', auth })
    const userInfo = await oauth2.userinfo.get()
    const email = userInfo.data.email

    // Upsert token row
    db.prepare(`
      INSERT INTO oauth_tokens (provider, access_token, refresh_token, expiry_date, email, updated_at)
      VALUES ('google', ?, ?, ?, ?, datetime('now'))
      ON CONFLICT(provider) DO UPDATE SET
        access_token  = excluded.access_token,
        refresh_token = COALESCE(excluded.refresh_token, refresh_token),
        expiry_date   = excluded.expiry_date,
        email         = excluded.email,
        updated_at    = datetime('now')
    `).run(tokens.access_token, tokens.refresh_token ?? null, tokens.expiry_date ?? null, email)

    res.redirect(clientUrl('/settings?google=connected'))
  } catch (err) {
    console.error('[auth] OAuth callback error:', err)
    res.redirect(clientUrl('/settings?google=error'))
  }
})

// GET /api/auth/google/status
router.get('/google/status', (_req, res) => {
  const row = db.prepare(`SELECT email, last_drive_check, drive_folder_id FROM oauth_tokens WHERE provider = 'google'`).get()
  if (!row) return res.json({ connected: false })
  res.json({
    connected:        true,
    email:            row.email,
    lastDriveCheck:   row.last_drive_check,
    driveFolderFound: !!row.drive_folder_id,
  })
})

// DELETE /api/auth/google — disconnect
router.delete('/google', (_req, res) => {
  try {
    const row = db.prepare(`SELECT access_token FROM oauth_tokens WHERE provider = 'google'`).get()
    if (row?.access_token) {
      // Attempt to revoke token (fire and forget)
      const auth = getOAuth2Client()
      auth.revokeToken(row.access_token).catch(() => {})
    }
    db.prepare(`DELETE FROM oauth_tokens WHERE provider = 'google'`).run()
    res.json({ ok: true })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

function clientUrl(path) {
  if (process.env.RAILWAY_PUBLIC_DOMAIN) {
    return path // same origin in production
  }
  return `http://localhost:5173${path}`
}

export default router
