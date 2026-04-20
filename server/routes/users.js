/**
 * Admin-only user management routes.
 * All routes here are protected by requireAuth + requireRole('admin')
 * applied in server/index.js.
 */
import { Router }     from 'express'
import { randomUUID } from 'node:crypto'
import nodemailer     from 'nodemailer'
import db             from '../db.js'

const router = Router()

const VALID_ROLES = ['admin', 'full_agent', 'junior_agent']

// ── List all users ────────────────────────────────────────────────────────────

router.get('/', (_req, res) => {
  const users = db.prepare(`
    SELECT id, email, name, role, auth_provider, status, created_at
    FROM users
    ORDER BY created_at ASC
  `).all()
  res.json(users)
})

// ── Change a user's role ──────────────────────────────────────────────────────

router.patch('/:id/role', (req, res) => {
  const { role } = req.body
  if (!VALID_ROLES.includes(role)) {
    return res.status(400).json({ error: `Invalid role. Must be one of: ${VALID_ROLES.join(', ')}` })
  }
  // Prevent admins from demoting themselves
  if (Number(req.params.id) === req.user.sub && role !== 'admin') {
    return res.status(400).json({ error: 'You cannot change your own role.' })
  }

  const result = db.prepare('UPDATE users SET role = ? WHERE id = ?').run(role, req.params.id)
  if (result.changes === 0) return res.status(404).json({ error: 'User not found.' })

  const user = db.prepare('SELECT id, email, name, role, status FROM users WHERE id = ?').get(req.params.id)
  res.json(user)
})

// ── Activate / deactivate a user ──────────────────────────────────────────────

router.patch('/:id/status', (req, res) => {
  const { status } = req.body
  if (!['active', 'inactive'].includes(status)) {
    return res.status(400).json({ error: 'Status must be "active" or "inactive".' })
  }
  if (Number(req.params.id) === req.user.sub && status === 'inactive') {
    return res.status(400).json({ error: 'You cannot deactivate your own account.' })
  }

  const result = db.prepare('UPDATE users SET status = ? WHERE id = ?').run(status, req.params.id)
  if (result.changes === 0) return res.status(404).json({ error: 'User not found.' })

  const user = db.prepare('SELECT id, email, name, role, status FROM users WHERE id = ?').get(req.params.id)
  res.json(user)
})

// ── Send invitation ───────────────────────────────────────────────────────────

router.post('/invite', async (req, res) => {
  const { email, role } = req.body
  if (!email?.trim()) return res.status(400).json({ error: 'Email is required.' })
  if (!VALID_ROLES.includes(role)) {
    return res.status(400).json({ error: `Role must be one of: ${VALID_ROLES.join(', ')}` })
  }

  const normalizedEmail = email.trim().toLowerCase()

  // Check if user already exists
  const existing = db.prepare('SELECT id FROM users WHERE LOWER(email) = ?').get(normalizedEmail)
  if (existing) return res.status(409).json({ error: 'A user with this email already exists.' })

  // Check for pending invite
  const pending = db.prepare(
    `SELECT id FROM invitations WHERE LOWER(email) = ? AND accepted_at IS NULL`
  ).get(normalizedEmail)
  if (pending) {
    // Delete old and reissue
    db.prepare('DELETE FROM invitations WHERE id = ?').run(pending.id)
  }

  const token = randomUUID()
  try {
    db.prepare(`
      INSERT INTO invitations (email, role, token, invited_by)
      VALUES (?, ?, ?, ?)
    `).run(normalizedEmail, role, token, req.user.sub)
    console.log(`[auth] Invitation created for ${normalizedEmail} (${role}), token: ${token}`)
  } catch (err) {
    console.error('[auth] Failed to save invitation:', err.message)
    return res.status(500).json({ error: 'Failed to create invitation. Please try again.' })
  }

  const baseUrl = process.env.RAILWAY_PUBLIC_DOMAIN
    ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}`
    : 'http://localhost:5173'
  const signupUrl = `${baseUrl}/signup/${token}`

  // Try to send email if SMTP is configured
  let emailSent = false
  if (process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS) {
    try {
      const transporter = nodemailer.createTransport({
        host:   process.env.SMTP_HOST,
        port:   Number(process.env.SMTP_PORT) || 587,
        secure: process.env.SMTP_SECURE === 'true',
        auth:   { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
      })

      const inviter = db.prepare('SELECT name, email FROM users WHERE id = ?').get(req.user.sub)
      await transporter.sendMail({
        from:    process.env.SMTP_FROM || process.env.SMTP_USER,
        to:      normalizedEmail,
        subject: 'You have been invited to Knox CRM',
        html: `
          <p>Hi,</p>
          <p>${inviter?.name || 'An admin'} has invited you to join Knox CRM with the role of <strong>${role.replace('_', ' ')}</strong>.</p>
          <p><a href="${signupUrl}" style="background:#2563eb;color:#fff;padding:10px 20px;border-radius:6px;text-decoration:none;display:inline-block;">Accept Invitation</a></p>
          <p>Or copy this link: ${signupUrl}</p>
          <p>This invitation expires in 30 days.</p>
        `,
      })
      emailSent = true
      console.log(`[auth] Invitation email sent to ${normalizedEmail}`)
    } catch (err) {
      console.error('[auth] Failed to send invitation email:', err.message)
    }
  } else {
    console.log(`[auth] SMTP not configured. Invitation link for ${normalizedEmail}:\n  ${signupUrl}`)
  }

  res.status(201).json({ ok: true, signupUrl, emailSent })
})

export default router
