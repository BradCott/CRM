import jwt from 'jsonwebtoken'

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

/** Require a valid JWT cookie. Sets req.user = { sub, email, name, role }. */
export function requireAuth(req, res, next) {
  const token = req.cookies?.[COOKIE_NAME]
  if (!token) return res.status(401).json({ error: 'Not authenticated' })

  try {
    req.user = jwt.verify(token, JWT_SECRET)
    next()
  } catch {
    res.clearCookie(COOKIE_NAME)
    return res.status(401).json({ error: 'Session expired — please log in again' })
  }
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
