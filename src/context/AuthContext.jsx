import { createContext, useContext, useState, useEffect, useCallback } from 'react'

const AuthContext = createContext(null)

// Role hierarchy
export const ROLES = {
  admin:        'admin',
  full_agent:   'full_agent',
  junior_agent: 'junior_agent',
}

// Pages each role can access (route path prefix)
const ROLE_ACCESS = {
  admin:        ['*'],  // everything
  full_agent:   ['/dashboard', '/people', '/properties', '/portfolio', '/accounting', '/investors', '/pipeline', '/reports', '/management', '/campaigns'],
  junior_agent: ['/dashboard', '/people', '/properties', '/pipeline', '/reports'],
}

export function AuthProvider({ children }) {
  const [user, setUser]       = useState(null)
  const [loading, setLoading] = useState(true)

  const fetchMe = useCallback(async () => {
    try {
      const res = await fetch('/api/auth/me', { credentials: 'include' })
      if (res.ok) {
        setUser(await res.json())
      } else {
        setUser(null)
      }
    } catch {
      setUser(null)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { fetchMe() }, [fetchMe])

  const login = useCallback((userData) => {
    setUser(userData)
  }, [])

  const logout = useCallback(async () => {
    try {
      await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' })
    } catch {}
    setUser(null)
  }, [])

  const refreshUser = fetchMe

  return (
    <AuthContext.Provider value={{ user, loading, login, logout, refreshUser }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}

/** Returns true if the current user can edit data (admin only). */
export function useCanEdit() {
  const { user } = useAuth()
  return user?.role === 'admin'
}

/** Returns true if the current user can access the given path. */
export function useCanAccess(path) {
  const { user } = useAuth()
  if (!user) return false
  const allowed = ROLE_ACCESS[user.role] || []
  if (allowed.includes('*')) return true
  return allowed.some(p => path === p || path.startsWith(p + '/'))
}

export { ROLE_ACCESS }
