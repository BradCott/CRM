// App email sender. Railway blocks outbound SMTP, so we send through the
// connected Google account's Gmail API (HTTPS). Requires the gmail.send scope —
// reconnect Google in Settings to grant it.
import { google } from 'googleapis'
import db from '../db.js'
import { getAuthedClient } from './googleClient.js'

// RFC 2047 encode a header value if it has non-ASCII characters.
function encodeHeader(v) {
  return /[^\x00-\x7F]/.test(v) ? `=?UTF-8?B?${Buffer.from(v).toString('base64')}?=` : v
}

function buildRaw({ from, to, subject, text }) {
  const headers = []
  if (from) headers.push(`From: ${from}`)
  headers.push(`To: ${to}`)
  headers.push(`Subject: ${encodeHeader(subject || '')}`)
  headers.push('MIME-Version: 1.0')
  headers.push('Content-Type: text/plain; charset=UTF-8')
  const msg = headers.join('\r\n') + '\r\n\r\n' + (text || '')
  return Buffer.from(msg).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

/**
 * Send a plain-text email via the connected Google account.
 * `from` is optional (defaults to EMAIL_FROM, else the connected account itself).
 * Throws with a clear message if Google isn't connected / lacks the send scope.
 */
export async function sendMail({ to, subject, text, from }) {
  if (!to) throw new Error('No recipient')
  const tokenRow = db.prepare(`SELECT * FROM oauth_tokens WHERE provider = 'google'`).get()
  if (!tokenRow?.access_token) throw new Error('Google account not connected — connect it in Settings to send email.')

  const auth  = getAuthedClient(tokenRow)
  const gmail = google.gmail({ version: 'v1', auth })
  const raw   = buildRaw({ from: from || process.env.EMAIL_FROM || null, to, subject, text })
  try {
    await gmail.users.messages.send({ userId: 'me', requestBody: { raw } })
  } catch (e) {
    const msg = e?.errors?.[0]?.message || e.message || 'Gmail send failed'
    if (/insufficient|scope|permission/i.test(msg)) {
      throw new Error("Google needs 'send email' permission — reconnect your Google account in Settings.")
    }
    throw new Error(msg)
  }
}

export function isEmailConfigured() {
  const t = db.prepare(`SELECT access_token FROM oauth_tokens WHERE provider = 'google'`).get()
  return !!t?.access_token
}
