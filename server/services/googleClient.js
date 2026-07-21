import { google } from 'googleapis'
import db from '../db.js'

const CLIENT_ID     = process.env.GOOGLE_CLIENT_ID
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET

if (!CLIENT_ID || !CLIENT_SECRET) {
  throw new Error('GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET must be set in environment variables')
}

export function getRedirectUri() {
  // Explicit override — set GOOGLE_REDIRECT_URI in Railway variables to lock this down
  if (process.env.GOOGLE_REDIRECT_URI) {
    return process.env.GOOGLE_REDIRECT_URI
  }
  if (process.env.RAILWAY_PUBLIC_DOMAIN) {
    return `https://${process.env.RAILWAY_PUBLIC_DOMAIN}/api/auth/google/callback`
  }
  return 'http://localhost:3001/api/auth/google/callback'
}

export function getOAuth2Client() {
  return new google.auth.OAuth2(CLIENT_ID, CLIENT_SECRET, getRedirectUri())
}

export function getAuthedClient(tokenRow) {
  const auth = getOAuth2Client()
  auth.setCredentials({
    access_token:  tokenRow.access_token,
    refresh_token: tokenRow.refresh_token,
    expiry_date:   tokenRow.expiry_date,
  })
  // Persist refreshed access tokens automatically, back to whichever row this
  // came from (e.g. 'google' for Drive/sync, 'google_send' for the send mailbox).
  const provider = tokenRow.provider || 'google'
  auth.on('tokens', (tokens) => {
    try {
      db.prepare(`
        UPDATE oauth_tokens
        SET access_token = ?,
            expiry_date  = ?,
            updated_at   = datetime('now')
        WHERE provider = ?
      `).run(tokens.access_token ?? tokenRow.access_token, tokens.expiry_date ?? tokenRow.expiry_date, provider)
    } catch (_) {}
  })
  return auth
}
