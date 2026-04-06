import { google } from 'googleapis'
import db from '../db.js'

const CLIENT_ID     = process.env.GOOGLE_CLIENT_ID
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET

if (!CLIENT_ID || !CLIENT_SECRET) {
  throw new Error('GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET must be set in environment variables')
}

export function getRedirectUri() {
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
  // Persist refreshed access tokens automatically
  auth.on('tokens', (tokens) => {
    try {
      db.prepare(`
        UPDATE oauth_tokens
        SET access_token = ?,
            expiry_date  = ?,
            updated_at   = datetime('now')
        WHERE provider = 'google'
      `).run(tokens.access_token ?? tokenRow.access_token, tokens.expiry_date ?? tokenRow.expiry_date)
    } catch (_) {}
  })
  return auth
}
