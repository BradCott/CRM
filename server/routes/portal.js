// Investor Portal — a self-contained, isolated surface. Its own auth (Google
// Sign-In + email/password), its own session cookie, and every data query is
// hard-scoped to the logged-in investor. It shares NO auth with the CRM.
import { Router } from 'express'
import multer from 'multer'
import bcrypt from 'bcryptjs'
import crypto from 'node:crypto'
import { join } from 'node:path'
import { mkdirSync, writeFileSync, createReadStream, existsSync, unlink } from 'node:fs'
import { google } from 'googleapis'
import db, { DATA_DIR } from '../db.js'
import { issuePortalJWT, requirePortalAuth, PORTAL_COOKIE } from '../middleware/auth.js'

const router = Router()
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 30 * 1024 * 1024 } })
const DOCS_DIR = join(DATA_DIR, 'investor-docs')

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

// ── Brute-force protection for password login ─────────────────────────────────
const loginAttempts = new Map()   // ip -> { count, resetAt }
const MAX_ATTEMPTS  = 10
const WINDOW_MS     = 15 * 60 * 1000
function isRateLimited(ip) {
  const now = Date.now()
  const rec = loginAttempts.get(ip)
  if (!rec || rec.resetAt < now) { loginAttempts.set(ip, { count: 1, resetAt: now + WINDOW_MS }); return false }
  rec.count++
  return rec.count > MAX_ATTEMPTS
}
function clearAttempts(ip) { loginAttempts.delete(ip) }

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
    if (!data.verified_email) return fail('unverified')   // only trust Google-verified emails

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
  const ip = req.ip || req.socket?.remoteAddress || 'unknown'
  if (isRateLimited(ip)) return res.status(429).json({ error: 'Too many sign-in attempts. Please wait a few minutes and try again.' })

  const { email, password } = req.body || {}
  const iu = findAccount(email)
  if (!iu || !iu.password_hash) return res.status(401).json({ error: 'Invalid email or password' })
  const ok = await bcrypt.compare(String(password || ''), iu.password_hash)
  if (!ok) return res.status(401).json({ error: 'Invalid email or password' })
  clearAttempts(ip)
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

// Simple-interest preferred-return accrual (mirrors investors.js calcPrefReturn).
function calcPref(link) {
  const rate = Number(link.preferred_return_rate) || 0
  const contribution = Number(link.contribution) || 0
  if (!rate || !link.created_at) return 0
  const days = (Date.now() - new Date(link.created_at.replace(' ', 'T') + 'Z').getTime()) / 86_400_000
  return contribution * (rate / 100) * (days / 365)
}

// The investor's whole portfolio in one call — summary + holdings + distributions.
// EVERY query is scoped to req.portal.investorId; no other investor's data is
// reachable from here.
router.get('/portfolio', requirePortalAuth, (req, res) => {
  const invId = req.portal.investorId
  const inv   = db.prepare(`SELECT id, name FROM investors WHERE id = ?`).get(invId)

  const links = db.prepare(`
    SELECT ipl.id, ipl.property_id, ipl.contribution, ipl.ownership_percentage, ipl.preferred_return_rate, ipl.created_at,
           p.address, p.city, p.state, tb.name AS tenant_brand
    FROM investor_property_links ipl
    JOIN properties p ON p.id = ipl.property_id
    LEFT JOIN tenant_brands tb ON tb.id = p.tenant_brand_id
    WHERE ipl.investor_id = ?
    ORDER BY ipl.created_at DESC
  `).all(invId)

  const distByProp = {}
  for (const d of db.prepare(`SELECT property_id, COALESCE(SUM(amount),0) AS s FROM investor_distributions WHERE investor_id = ? GROUP BY property_id`).all(invId)) {
    distByProp[d.property_id] = d.s
  }

  const holdings = links.map(l => {
    const received = distByProp[l.property_id] || 0
    const accrued  = calcPref(l)
    return {
      id: l.id,
      property: { address: l.address, city: l.city, state: l.state, tenant_brand: l.tenant_brand },
      contribution: l.contribution,
      ownership_percentage: l.ownership_percentage,
      preferred_return_rate: l.preferred_return_rate,
      distributions_received: received,
      accrued_preferred_return: accrued,
      net_preferred_return_owed: Math.max(0, accrued - received),
    }
  })

  const distributions = db.prepare(`
    SELECT d.id, d.amount, d.distribution_date AS date, d.distribution_type AS type, d.notes,
           p.address, p.city, p.state
    FROM investor_distributions d
    LEFT JOIN properties p ON p.id = d.property_id
    WHERE d.investor_id = ?
    ORDER BY d.distribution_date DESC, d.id DESC
  `).all(invId).map(r => ({
    id: r.id, amount: r.amount, date: r.date, type: r.type, notes: r.notes,
    property: r.address ? { address: r.address, city: r.city, state: r.state } : null,
  }))

  const summary = {
    investor: inv?.name || req.portal.name,
    total_invested:      links.reduce((s, l) => s + (Number(l.contribution) || 0), 0),
    num_properties:      links.length,
    total_distributions: distributions.reduce((s, d) => s + (Number(d.amount) || 0), 0),
    net_preferred_return_owed: holdings.reduce((s, h) => s + h.net_preferred_return_owed, 0),
  }

  res.json({ summary, holdings, distributions })
})

// ── Document vault (investor-scoped) ──────────────────────────────────────────

router.get('/documents', requirePortalAuth, (req, res) => {
  const rows = db.prepare(`
    SELECT id, file_name, mime, size, category, direction, notes, created_at
    FROM investor_documents WHERE investor_id = ? ORDER BY created_at DESC
  `).all(req.portal.investorId)
  res.json({ documents: rows })
})

router.get('/documents/:id/file', requirePortalAuth, (req, res) => {
  const d = db.prepare(`SELECT file_name, file_path, mime FROM investor_documents WHERE id = ? AND investor_id = ?`).get(req.params.id, req.portal.investorId)
  if (!d || !d.file_path || !existsSync(d.file_path)) return res.status(404).json({ error: 'Document not found' })
  res.setHeader('Content-Type', d.mime || 'application/octet-stream')
  res.setHeader('X-Content-Type-Options', 'nosniff')
  res.setHeader('Content-Disposition', `attachment; filename="${(d.file_name || 'document').replace(/"/g, '')}"`)
  createReadStream(d.file_path).pipe(res)
})

router.post('/documents', requirePortalAuth, upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' })
  const invId = req.portal.investorId
  const dir   = join(DOCS_DIR, String(invId))
  try { mkdirSync(dir, { recursive: true }) } catch (_) {}
  const safe  = (req.file.originalname || 'document').replace(/[^\w.\-]+/g, '_')
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
  const filePath = join(dir, `${stamp}-${safe}`)
  try { writeFileSync(filePath, req.file.buffer) } catch (e) { return res.status(500).json({ error: `Could not save file: ${e.message}` }) }
  db.prepare(`INSERT INTO investor_documents (investor_id, file_name, file_path, mime, size, category, direction) VALUES (?, ?, ?, ?, ?, ?, 'from_investor')`)
    .run(invId, req.file.originalname || safe, filePath, req.file.mimetype || null, req.file.size || null, String(req.body?.category || 'Other').slice(0, 40))
  res.json({ ok: true })
})

// Investors may remove only their OWN uploads, never Knox-shared documents.
router.delete('/documents/:id', requirePortalAuth, (req, res) => {
  const d = db.prepare(`SELECT file_path, direction FROM investor_documents WHERE id = ? AND investor_id = ?`).get(req.params.id, req.portal.investorId)
  if (!d) return res.status(404).json({ error: 'Document not found' })
  if (d.direction !== 'from_investor') return res.status(403).json({ error: 'You can only remove documents you uploaded.' })
  if (d.file_path) { try { unlink(d.file_path, () => {}) } catch (_) {} }
  db.prepare(`DELETE FROM investor_documents WHERE id = ?`).run(req.params.id)
  res.json({ ok: true })
})

export default router
