import jwt from 'jsonwebtoken'
import crypto from 'node:crypto'

export const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-change-in-production'

if (!process.env.JWT_SECRET) {
  console.warn('[auth] WARNING: JWT_SECRET not set — using insecure default. Set JWT_SECRET in .env for production.')
}

export const COOKIE_NAME = 'knox_token'
export const COOKIE_OPTIONS = {
  httpOnly: true,
  secure:   process.env.NODE_ENV === 'production',
  sameSite: 'lax',
  maxAge:   7 * 24 * 60 * 60 * 1000, // 7 days
}

export function issueJWT(res, user) {
  const token = jwt.sign(
    { sub: user.id, email: user.email, name: user.name, role: user.role },
    JWT_SECRET,
    { expiresIn: '7d' }
  )
  res.cookie(COOKIE_NAME, token, COOKIE_OPTIONS)
  return token
}

// ── Investor portal auth ──────────────────────────────────────────────────────
// A SEPARATE cookie + token kind from the CRM. A portal session can never be used
// against CRM endpoints (different cookie name + `kind` check), and CRM sessions
// can never be used against the portal. This is the isolation boundary.
export const PORTAL_COOKIE = 'knox_portal'
// Portal tokens are signed with a DISTINCT secret so a portal JWT can never
// verify against the CRM (and vice versa) even if it lands in the wrong cookie.
const PORTAL_JWT_SECRET = process.env.PORTAL_JWT_SECRET || `${JWT_SECRET}::investor-portal`

export function issuePortalJWT(res, iu) {
  const token = jwt.sign(
    { kind: 'portal', iu: iu.id, inv: iu.investor_id, email: iu.email, name: iu.name },
    PORTAL_JWT_SECRET,
    { expiresIn: '7d' }
  )
  res.cookie(PORTAL_COOKIE, token, COOKIE_OPTIONS)
  return token
}

/** Require a valid portal session. Sets req.portal = { investorUserId, investorId, email, name }. */
export function requirePortalAuth(req, res, next) {
  const token = req.cookies?.[PORTAL_COOKIE]
  if (!token) return res.status(401).json({ error: 'Not authenticated' })
  try {
    const p = jwt.verify(token, PORTAL_JWT_SECRET)
    if (p.kind !== 'portal') throw new Error('wrong token kind')
    req.portal = { investorUserId: p.iu, investorId: p.inv, email: p.email, name: p.name }
    next()
  } catch {
    res.clearCookie(PORTAL_COOKIE)
    return res.status(401).json({ error: 'Session expired — please sign in again' })
  }
}

/** Require a valid JWT cookie. Sets req.user = { sub, email, name, role }. */
export function requireAuth(req, res, next) {
  const token = req.cookies?.[COOKIE_NAME]
  if (!token) return res.status(401).json({ error: 'Not authenticated' })

  try {
    const payload = jwt.verify(token, JWT_SECRET)
    // A portal token must never be honored as a CRM session.
    if (payload.kind === 'portal') { res.clearCookie(COOKIE_NAME); return res.status(401).json({ error: 'Invalid session' }) }
    req.user = payload
    next()
  } catch {
    res.clearCookie(COOKIE_NAME)
    return res.status(401).json({ error: 'Session expired — please log in again' })
  }
}

// ── Browser-extension auth ────────────────────────────────────────────────────
// The Gmail extension can't send the httpOnly login cookie cross-site, so its
// endpoints authenticate with a shared secret sent in the `x-crm-key` header.
export const EXTENSION_API_KEY = process.env.EXTENSION_API_KEY || 'dev-ext-key'

if (!process.env.EXTENSION_API_KEY) {
  console.warn('[auth] WARNING: EXTENSION_API_KEY not set — using insecure default. Set EXTENSION_API_KEY in .env for the Gmail extension.')
}

/** Require a valid extension API key in the x-crm-key header. */
export function requireExtKey(req, res, next) {
  const key = req.get('x-crm-key') || ''
  if (key && key === EXTENSION_API_KEY) return next()
  return res.status(401).json({ ok: false, error: 'Invalid or missing CRM key' })
}

// ── Claude bearer-token auth (REST token API + MCP connector) ─────────────────
// Claude (claude.ai custom connector, or Claude Code) authenticates headlessly
// with `Authorization: Bearer <CLAUDE_API_KEY>`. This is an ADDITIONAL path on
// top of the browser session cookie — never a replacement. The key lives only in
// a Railway env var; if it is unset the token path is disabled (cookie-only).
export const CLAUDE_API_KEY = process.env.CLAUDE_API_KEY || ''

if (!process.env.CLAUDE_API_KEY) {
  console.warn('[auth] CLAUDE_API_KEY not set — the Claude token API + MCP connector are disabled until you set it.')
}

function timingSafeEqual(a, b) {
  const ba = Buffer.from(String(a)), bb = Buffer.from(String(b))
  if (ba.length !== bb.length) return false
  return crypto.timingSafeEqual(ba, bb)
}

/**
 * True if the request carries a valid Claude key. Two accepted forms:
 *  - `Authorization: Bearer <CLAUDE_API_KEY>` (Claude Code / direct API clients)
 *  - `X-Api-Key: <CLAUDE_API_KEY>` (claude.ai custom connectors reserve the
 *    Authorization header for their OAuth flow, so the connector sends the raw
 *    key in X-Api-Key instead).
 */
export function hasClaudeToken(req) {
  if (!CLAUDE_API_KEY) return false
  const m = (req.get('authorization') || '').match(/^Bearer\s+(.+)$/i)
  if (m && timingSafeEqual(m[1], CLAUDE_API_KEY)) return true
  const xk = req.get('x-api-key') || ''
  if (xk && timingSafeEqual(xk, CLAUDE_API_KEY)) return true
  return false
}

/**
 * Accept EITHER a valid Claude bearer token OR a browser session cookie.
 * A token request runs as a synthetic 'claude' admin so writes are tagged
 * created_by/updated_by = 'claude'. Used for /api/tasks, /api/critical-dates, /mcp.
 */
export function bearerOrSession(req, res, next) {
  if (hasClaudeToken(req)) {
    req.apiClient = 'claude'
    req.user = { sub: null, email: 'claude@knoxcre.com', name: 'Claude', role: 'admin' }
    return next()
  }
  return requireAuth(req, res, next)
}

/** Require a valid Claude bearer token (no cookie fallback). For the MCP endpoint. */
export function requireClaudeToken(req, res, next) {
  if (!CLAUDE_API_KEY) return res.status(503).json({ error: 'MCP connector not configured' })
  if (hasClaudeToken(req)) {
    req.apiClient = 'claude'
    req.user = { sub: null, email: 'claude@knoxcre.com', name: 'Claude', role: 'admin' }
    return next()
  }
  return res.status(401).json({ error: 'Invalid or missing bearer token' })
}

/** Require one of the given roles. Must be used after requireAuth. */
export function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'Not authenticated' })
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ error: 'You do not have permission to access this resource.' })
    }
    next()
  }
}

/**
 * Allow GET/HEAD/OPTIONS for any authenticated user.
 * Block POST/PUT/PATCH/DELETE for non-admins.
 */
export function requireWrite(req, res, next) {
  if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) {
    if (!req.user || req.user.role !== 'admin') {
      return res.status(403).json({ error: 'You do not have permission to modify data.' })
    }
  }
  next()
}
