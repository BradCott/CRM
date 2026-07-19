// App email sender. Railway blocks outbound SMTP, so we send through the
// connected Google account's Gmail API (HTTPS). Requires the gmail.send scope —
// reconnect Google in Settings to grant it. Supports text/html + attachments.
import { google } from 'googleapis'
import crypto from 'node:crypto'
import db from '../db.js'
import { getAuthedClient } from './googleClient.js'

const enc = (v) => /[^\x00-\x7F]/.test(v) ? `=?UTF-8?B?${Buffer.from(v).toString('base64')}?=` : v
const b64 = (buf) => buf.toString('base64').replace(/(.{76})/g, '$1\r\n')
const urlB64 = (s) => Buffer.from(s).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')

function buildRaw({ from, to, cc, replyTo, subject, text, html, attachments = [] }) {
  const headers = []
  if (from) headers.push(`From: ${from}`)
  headers.push(`To: ${to}`)
  if (cc) headers.push(`Cc: ${cc}`)
  if (replyTo) headers.push(`Reply-To: ${replyTo}`)
  headers.push(`Subject: ${enc(subject || '')}`)
  headers.push('MIME-Version: 1.0')

  const bodyType = html ? 'text/html' : 'text/plain'
  const body     = html || text || ''

  let mime
  if (attachments.length) {
    const boundary = 'kx_' + crypto.randomBytes(12).toString('hex')
    headers.push(`Content-Type: multipart/mixed; boundary="${boundary}"`)
    const parts = [
      `--${boundary}\r\nContent-Type: ${bodyType}; charset=UTF-8\r\nContent-Transfer-Encoding: base64\r\n\r\n${b64(Buffer.from(body))}`,
    ]
    for (const a of attachments) {
      const name = (a.filename || 'attachment').replace(/"/g, '')
      parts.push(`--${boundary}\r\nContent-Type: ${a.contentType || 'application/octet-stream'}; name="${name}"\r\nContent-Disposition: attachment; filename="${name}"\r\nContent-Transfer-Encoding: base64\r\n\r\n${b64(a.content)}`)
    }
    mime = headers.join('\r\n') + '\r\n\r\n' + parts.join('\r\n') + `\r\n--${boundary}--`
  } else {
    headers.push(`Content-Type: ${bodyType}; charset=UTF-8`)
    headers.push('Content-Transfer-Encoding: base64')
    mime = headers.join('\r\n') + '\r\n\r\n' + b64(Buffer.from(body))
  }
  return urlB64(mime)
}

/**
 * Send an email via the connected Google account. `from` is optional (defaults
 * to EMAIL_FROM, else the connected account). Throws a clear message if Google
 * isn't connected or lacks the send scope.
 */
export async function sendMail({ to, cc, replyTo, subject, text, html, from, attachments }) {
  if (!to) throw new Error('No recipient')
  const tokenRow = db.prepare(`SELECT * FROM oauth_tokens WHERE provider = 'google'`).get()
  if (!tokenRow?.access_token) throw new Error('Google account not connected — connect it in Settings to send email.')

  const auth  = getAuthedClient(tokenRow)
  const gmail = google.gmail({ version: 'v1', auth })
  const raw   = buildRaw({ from: from || process.env.EMAIL_FROM || null, to, cc, replyTo, subject, text, html, attachments: attachments || [] })
  try {
    await gmail.users.messages.send({ userId: 'me', requestBody: { raw } })
  } catch (e) {
    const msg = e?.errors?.[0]?.message || e?.response?.data?.error?.message || e.message || 'Gmail send failed'
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
