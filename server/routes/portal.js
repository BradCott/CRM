// Investor Portal — a self-contained, isolated surface. Its own auth (Google
// Sign-In + email/password), its own session cookie, and every data query is
// hard-scoped to the logged-in investor. It shares NO auth with the CRM.
import { Router } from 'express'
import bcrypt from 'bcryptjs'
import crypto from 'node:crypto'
import { google } from 'googleapis'
import db from '../db.js'
import { issuePortalJWT, requirePortalAuth, PORTAL_COOKIE } from '../middleware/auth.js'

const router = Router()

const CLIENT_ID     = process.env.GOOGLE_CLIENT_ID
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET

function portalRedirectUri() {
  if (process.env.PORTAL_GOOGLE_REDIRECT_URI) return process.env.PORTAL_GOOGLE_REDIRECT_URI
  if (process.env.RAILWAY_PUBLIC_DOMAIN) return `https://${process.env.RAILWAY_PUBLIC_DOMAIN}/api/portal/auth/google/callback`
  return 'http://localhost:3001/api/portal/auth/google/callback'
}
function portalOAuth() {
  return new google.auth.OAuth2(CLIENT_ID, CLIENT_SECRET, portalRedirectUri())
}

const norm = (e) => String(e || '').trim().toLowerCase()

// Find an active-or-invited investor account by email (never disabled).
function findAccount(email) {
  return db.prepare(`SELECT * FROM investor_users WHERE email = ? AND status != 'disabled'`).get(norm(email))
}

function activateAndLogin(res, iu, { google_sub } = {}) {
  db.prepare(`
    UPDATE investor_users
    SET status = 'active', google_sub = COALESCE(?, google_sub),
        invite_token = NULL, invite_expires = NULL, last_login_at = datetime('now')
    WHERE id = ?
  `).run(google_sub || null, iu.id)
  issuePortalJWT(res, iu)
}

// ── Google Sign-In (full-page redirect flow) ──────────────────────────────────

router.get('/auth/google/start', (req, res) => {
  if (!CLIENT_ID || !CLIENT_SECRET) return res.status(500).send('Google sign-in is not configured.')
  const state = crypto.randomBytes(16).toString('hex')
  res.cookie('portal_oauth_state', state, { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax', maxAge: 10 * 60 * 1000 })
  const url = portalOAuth().generateAuthUrl({
    access_type: 'online',
    prompt: 'select_account',
    scope: ['openid', 'email', 'profile'],
    state,
  })
  res.redirect(url)
})

router.get('/auth/google/callback', async (req, res) => {
  const fail = (reason) => res.redirect(`/portal?error=${reason}`)
  try {
    const { code, state } = req.query
    if (!code) return fail('google')
    if (!state || state !== req.cookies?.portal_oauth_state) return fail('state')
    res.clearCookie('portal_oauth_state')

    const oAuth = portalOAuth()
    const { tokens } = await oAuth.getToken(String(code))
    oAuth.setCredentials(tokens)
    const { data } = await google.oauth2({ version: 'v2', auth: oAuth }).userinfo.get()
    const email = norm(data.email)
    if (!email) return fail('google')

    const iu = findAccount(email)
    if (!iu) return fail('not_invited')   // the email must be pre-invited — the security gate

    activateAndLogin(res, { ...iu, name: iu.name || data.name }, { google_sub: data.id })
    if (!iu.name && data.name) db.prepare(`UPDATE investor_users SET name = ? WHERE id = ?`).run(data.name, iu.id)
    res.redirect('/portal')
  } catch (e) {
    console.error('[portal] google callback:', e.message)
    return res.redirect('/portal?error=google')
  }
})

// ── Email / password ──────────────────────────────────────────────────────────

router.post('/auth/password', async (req, res) => {
  const { email, password } = req.body || {}
  const iu = findAccount(email)
  if (!iu || !iu.password_hash) return res.status(401).json({ error: 'Invalid email or password' })
  const ok = await bcrypt.compare(String(password || ''), iu.password_hash)
  if (!ok) return res.status(401).json({ error: 'Invalid email or password' })
  db.prepare(`UPDATE investor_users SET status='active', last_login_at=datetime('now') WHERE id=?`).run(iu.id)
  issuePortalJWT(res, iu)
  res.json({ ok: true })
})

// Invite-link lookup — the accept page shows who the invite is for.
router.get('/auth/invite/:token', (req, res) => {
  const iu = db.prepare(`SELECT email, name, invite_expires FROM investor_users WHERE invite_token = ?`).get(req.params.token)
  if (!iu) return res.status(404).json({ valid: false })
  if (iu.invite_expires && iu.invite_expires < new Date().toISOString()) return res.status(410).json({ valid: false, expired: true })
  res.json({ valid: true, email: iu.email, name: iu.name })
})

// Accept an invite by setting a password.
router.post('/auth/accept', async (req, res) => {
  const { token, password, name } = req.body || {}
  const iu = db.prepare(`SELECT * FROM investor_users WHERE invite_token = ?`).get(token)
  if (!iu) return res.status(404).json({ error: 'This invite link is invalid.' })
  if (iu.invite_expires && iu.invite_expires < new Date().toISOString()) return res.status(410).json({ error: 'This invite link has expired — ask Knox for a new one.' })
  if (!password || String(password).length < 8) return res.status(400).json({ error: 'Choose a password of at least 8 characters.' })

  const hash = await bcrypt.hash(String(password), 12)
  db.prepare(`
    UPDATE investor_users
    SET password_hash = ?, name = COALESCE(?, name), status = 'active',
        invite_token = NULL, invite_expires = NULL, last_login_at = datetime('now')
    WHERE id = ?
  `).run(hash, name?.trim() || null, iu.id)
  issuePortalJWT(res, { ...iu, name: name?.trim() || iu.name })
  res.json({ ok: true })
})

router.post('/logout', (req, res) => {
  res.clearCookie(PORTAL_COOKIE)
  res.json({ ok: true })
})

// ── Authenticated portal data (everything below is scoped to req.portal) ──────

router.get('/me', requirePortalAuth, (req, res) => {
  const inv = db.prepare(`SELECT id, name FROM investors WHERE id = ?`).get(req.portal.investorId)
  res.json({
    name: req.portal.name,
    email: req.portal.email,
    investor: inv ? { id: inv.id, name: inv.name } : null,
  })
})

export default router
