import { Router }          from 'express'
import { randomUUID }      from 'node:crypto'
import bcrypt              from 'bcryptjs'
import { google }          from 'googleapis'
import db                  from '../db.js'
import { getOAuth2Client } from '../services/googleClient.js'
import { issueJWT, requireAuth, COOKIE_NAME, COOKIE_OPTIONS } from '../middleware/auth.js'

const router = Router()

// ── Helpers ───────────────────────────────────────────────────────────────────

function publicUser(u) {
  return { id: u.id, email: u.email, name: u.name, role: u.role, status: u.status }
}

function clientUrl(path) {
  if (process.env.RAILWAY_PUBLIC_DOMAIN) return path
  return `http://localhost:5173${path}`
}

function countUsers() {
  return db.prepare('SELECT COUNT(*) AS c FROM users').get().c
}

// ── Email/password login ──────────────────────────────────────────────────────

router.post('/login', async (req, res) => {
  const { email, password } = req.body
  if (!email || !password) return res.status(400).json({ error: 'Email and password are required.' })

  const user = db.prepare(
    `SELECT * FROM users WHERE LOWER(email) = LOWER(?) AND auth_provider = 'local' AND status = 'active'`
  ).get(email.trim())

  if (!user?.password_hash) return res.status(401).json({ error: 'Invalid email or password.' })

  const valid = await bcrypt.compare(password, user.password_hash)
  if (!valid) return res.status(401).json({ error: 'Invalid email or password.' })

  issueJWT(res, user)
  res.json({ ok: true, user: publicUser(user) })
})

// ── Logout ────────────────────────────────────────────────────────────────────

router.post('/logout', (_req, res) => {
  res.clearCookie(COOKIE_NAME, { ...COOKIE_OPTIONS, maxAge: 0 })
  res.json({ ok: true })
})

// ── Current user ──────────────────────────────────────────────────────────────

router.get('/me', requireAuth, (req, res) => {
  const user = db.prepare('SELECT id, email, name, role, status FROM users WHERE id = ?').get(req.user.sub)
  if (!user || user.status !== 'active') {
    res.clearCookie(COOKIE_NAME)
    return res.status(401).json({ error: 'Account not found or inactive.' })
  }
  res.json(user)
})

// ── Google OAuth — user LOGIN ─────────────────────────────────────────────────
// Uses the same OAuth2 client as Drive but with different scopes + state='login'

router.get('/google/login', (_req, res) => {
  const auth = getOAuth2Client()
  const url  = auth.generateAuthUrl({
    access_type: 'online',
    prompt:      'select_account',
    scope: [
      'openid',
      'https://www.googleapis.com/auth/userinfo.email',
      'https://www.googleapis.com/auth/userinfo.profile',
    ],
    state: 'login',
  })
  res.redirect(url)
})

// ── Google OAuth — signup (invite token or first-user bootstrap) ──────────────
// state = 'signup:TOKEN' for invited users, 'signup:' for first admin

router.get('/google/signup', (req, res) => {
  const token = req.query.token || ''   // invite token, may be empty for first user
  const auth  = getOAuth2Client()
  const url   = auth.generateAuthUrl({
    access_type: 'online',
    prompt:      'select_account',
    scope: [
      'openid',
      'https://www.googleapis.com/auth/userinfo.email',
      'https://www.googleapis.com/auth/userinfo.profile',
    ],
    state: `signup:${token}`,
  })
  res.redirect(url)
})

// ── Google OAuth — Drive integration (existing, unchanged) ────────────────────

const DRIVE_SCOPES = [
  'https://www.googleapis.com/auth/drive.readonly',
  'https://www.googleapis.com/auth/userinfo.email',
]

router.get('/google', (_req, res) => {
  const auth = getOAuth2Client()
  const url  = auth.generateAuthUrl({
    access_type: 'offline',
    prompt:      'consent',
    scope:       DRIVE_SCOPES,
  })
  res.redirect(url)
})

// ── Unified Google callback — handles both login and Drive ────────────────────

router.get('/google/callback', async (req, res) => {
  const { code, state, error } = req.query
  const isLogin  = state === 'login'
  const isSignup = typeof state === 'string' && state.startsWith('signup:')
  const inviteToken = isSignup ? state.slice('signup:'.length) : null

  // Determine where to redirect on error
  function errorRedirect(code) {
    if (isSignup) {
      const base = inviteToken ? `/signup/${inviteToken}` : '/signup'
      return res.redirect(clientUrl(`${base}?error=${code}`))
    }
    if (isLogin) return res.redirect(clientUrl(`/login?error=${code}`))
    return res.redirect(clientUrl('/settings?google=error'))
  }

  if (error || !code) return errorRedirect('google_cancelled')

  try {
    const auth = getOAuth2Client()
    const { tokens } = await auth.getToken(code)
    auth.setCredentials(tokens)

    const oauth2   = google.oauth2({ version: 'v2', auth })
    const userInfo = await oauth2.userinfo.get()
    const { email, name, id: googleId } = userInfo.data

    if (isSignup) {
      // ── Google signup — invited user OR first admin ───────────────────────────
      if (inviteToken) {
        // Invited user flow
        const inv = db.prepare(`SELECT * FROM invitations WHERE token = ?`).get(inviteToken)
        if (!inv)            return errorRedirect('invite_invalid')
        if (inv.accepted_at) return errorRedirect('invite_used')

        // Email must match the invitation (case-insensitive)
        if (email.toLowerCase() !== inv.email.toLowerCase()) {
          return errorRedirect('google_email_mismatch')
        }

        // Create the user
        const r = db.prepare(`
          INSERT INTO users (email, name, role, auth_provider, google_id, status)
          VALUES (?, ?, ?, 'google', ?, 'active')
        `).run(email.toLowerCase(), name || email, inv.role, googleId)
        const user = db.prepare('SELECT * FROM users WHERE id = ?').get(r.lastInsertRowid)

        db.prepare(`UPDATE invitations SET accepted_at = datetime('now') WHERE token = ?`).run(inviteToken)
        console.log(`[auth] Google signup accepted invite: ${email} (${inv.role})`)

        issueJWT(res, user)
        return res.redirect(clientUrl('/dashboard'))
      } else {
        // First-user bootstrap
        if (countUsers() !== 0) return errorRedirect('signup_not_allowed')

        const r = db.prepare(`
          INSERT INTO users (email, name, role, auth_provider, google_id, status)
          VALUES (?, ?, 'admin', 'google', ?, 'active')
        `).run(email.toLowerCase(), name || email, googleId)
        const user = db.prepare('SELECT * FROM users WHERE id = ?').get(r.lastInsertRowid)
        console.log(`[auth] First admin created via Google signup: ${email}`)

        issueJWT(res, user)
        return res.redirect(clientUrl('/dashboard'))
      }
    }

    if (isLogin) {
      // ── User login via Google ────────────────────────────────────────────────
      let user = db.prepare(
        `SELECT * FROM users WHERE google_id = ? OR (LOWER(email) = LOWER(?) AND auth_provider = 'google')`
      ).get(googleId, email)

      if (!user) {
        if (countUsers() === 0) {
          // First ever user → auto-create as admin
          const r = db.prepare(`
            INSERT INTO users (email, name, role, auth_provider, google_id, status)
            VALUES (?, ?, 'admin', 'google', ?, 'active')
          `).run(email.toLowerCase(), name || email, googleId)
          user = db.prepare('SELECT * FROM users WHERE id = ?').get(r.lastInsertRowid)
          console.log(`[auth] First user created as admin: ${email}`)
        } else {
          return res.redirect(clientUrl('/login?error=no_account'))
        }
      }

      if (user.status !== 'active') {
        return res.redirect(clientUrl('/login?error=inactive'))
      }

      // Keep google_id and name up to date
      db.prepare(`
        UPDATE users SET google_id = COALESCE(google_id, ?), name = COALESCE(name, ?), auth_provider = 'google' WHERE id = ?
      `).run(googleId, name || null, user.id)

      issueJWT(res, user)
      return res.redirect(clientUrl('/dashboard'))
    }

    // ── Drive OAuth (existing behaviour) ──────────────────────────────────────
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
    console.error('[auth] Google callback error:', err)
    if (req.query.state === 'login') {
      return res.redirect(clientUrl('/login?error=google_failed'))
    }
    res.redirect(clientUrl('/settings?google=error'))
  }
})

// ── Existing Drive status / disconnect routes ─────────────────────────────────

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

router.delete('/google', (_req, res) => {
  try {
    const row = db.prepare(`SELECT access_token FROM oauth_tokens WHERE provider = 'google'`).get()
    if (row?.access_token) {
      const auth = getOAuth2Client()
      auth.revokeToken(row.access_token).catch(() => {})
    }
    db.prepare(`DELETE FROM oauth_tokens WHERE provider = 'google'`).run()
    res.json({ ok: true })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// ── Invite: check token ───────────────────────────────────────────────────────

router.get('/invite/:token', (req, res) => {
  const inv = db.prepare(
    `SELECT id, email, role, accepted_at FROM invitations WHERE token = ?`
  ).get(req.params.token)

  if (!inv)             return res.status(404).json({ error: 'Invitation not found.' })
  if (inv.accepted_at)  return res.status(410).json({ error: 'This invitation has already been used.' })

  res.json({ email: inv.email, role: inv.role })
})

// ── Signup: accept invite ─────────────────────────────────────────────────────

router.post('/signup', async (req, res) => {
  const { token, name, password } = req.body

  // Allow first-ever user to sign up without an invite
  const firstUser = countUsers() === 0

  if (!firstUser && !token) {
    return res.status(403).json({ error: 'An invitation token is required.' })
  }

  if (!name?.trim() || !password) {
    return res.status(400).json({ error: 'Name and password are required.' })
  }
  if (password.length < 8) {
    return res.status(400).json({ error: 'Password must be at least 8 characters.' })
  }

  let email, role

  if (firstUser && !token) {
    // Bootstrap: first user provides their own email
    email = req.body.email?.trim().toLowerCase()
    role  = 'admin'
    if (!email) return res.status(400).json({ error: 'Email is required.' })
  } else {
    const inv = db.prepare(`SELECT * FROM invitations WHERE token = ?`).get(token)
    if (!inv)            return res.status(404).json({ error: 'Invitation not found.' })
    if (inv.accepted_at) return res.status(410).json({ error: 'This invitation has already been used.' })
    email = inv.email.toLowerCase()
    role  = inv.role
  }

  const existing = db.prepare('SELECT id FROM users WHERE LOWER(email) = ?').get(email)
  if (existing) return res.status(409).json({ error: 'An account with this email already exists.' })

  const password_hash = await bcrypt.hash(password, 12)
  const r = db.prepare(`
    INSERT INTO users (email, name, role, auth_provider, password_hash, status)
    VALUES (?, ?, ?, 'local', ?, 'active')
  `).run(email, name.trim(), role, password_hash)

  if (token) {
    db.prepare(`UPDATE invitations SET accepted_at = datetime('now') WHERE token = ?`).run(token)
  }

  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(r.lastInsertRowid)
  issueJWT(res, user)
  res.status(201).json({ ok: true, user: publicUser(user) })
})

export default router
