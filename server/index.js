import express          from 'express'
import cors             from 'cors'
import cookieParser     from 'cookie-parser'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { existsSync }    from 'node:fs'

import tenantBrandsRouter   from './routes/tenantBrands.js'
import peopleRouter         from './routes/people.js'
import propertiesRouter     from './routes/properties.js'
import dealsRouter          from './routes/deals.js'
import importRouter         from './routes/import.js'
import reportsRouter        from './routes/reports.js'
import savedSearchesRouter  from './routes/savedSearches.js'
import portfolioImportRouter from './routes/portfolioImport.js'
import investorsRouter      from './routes/investors.js'
import dashboardRouter      from './routes/dashboard.js'
import authRouter           from './routes/auth.js'
import emailsRouter         from './routes/emails.js'
import loiImportRouter      from './routes/loiImport.js'
import accountingRouter     from './routes/accounting.js'
import usersRouter          from './routes/users.js'
import managementRouter     from './routes/management.js'
import handwryttenRouter   from './routes/handwrytten.js'

import { requireAuth, requireWrite, requireRole } from './middleware/auth.js'

// Initialize DB schema (also runs migrations)
import './db.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const app  = express()
const PORT = process.env.PORT || 3001
const isProd = process.env.NODE_ENV === 'production'

app.use(cors({ origin: true, credentials: true }))
app.use(express.json())
app.use(cookieParser())

// ── Production: serve built React app for all non-API routes ──────────────────
// Must be before API routes so the SPA loads for unauthenticated users.
// The React app handles auth redirects client-side.
const distPath = join(__dirname, '..', 'dist')
if (isProd && existsSync(distPath)) {
  app.use(express.static(distPath))
}

// ── Public API routes (no auth required) ─────────────────────────────────────
app.use('/api/auth', authRouter)

// ── Protected API routes (requireAuth applied per-route, not globally) ────────
// Admin-only
app.use('/api/admin/users',      requireAuth, requireRole('admin'), usersRouter)

// Admin + full_agent only
app.use('/api/accounting',       requireAuth, requireRole('admin', 'full_agent'), requireWrite, accountingRouter)
app.use('/api/investors',        requireAuth, requireRole('admin', 'full_agent'), requireWrite, investorsRouter)

// All authenticated users can read; only admin can write
app.use('/api/tenant-brands',    requireAuth, requireWrite, tenantBrandsRouter)
app.use('/api/people',           requireAuth, requireWrite, peopleRouter)
app.use('/api/properties',       requireAuth, requireWrite, propertiesRouter)
app.use('/api/deals',            requireAuth, requireWrite, dealsRouter)
app.use('/api/reports',          requireAuth, reportsRouter)
app.use('/api/saved-searches',   requireAuth, requireWrite, savedSearchesRouter)
app.use('/api/dashboard',        requireAuth, dashboardRouter)
app.use('/api/emails',           requireAuth, requireWrite, emailsRouter)

// Property management — admin + full_agent
app.use('/api/management',       requireAuth, requireRole('admin', 'full_agent'), managementRouter)

// Handwrytten — admin + full_agent
app.use('/api/handwrytten',      requireAuth, requireRole('admin', 'full_agent'), handwryttenRouter)

// Admin-only write routes
app.use('/api/import',           requireAuth, requireRole('admin'), importRouter)
app.use('/api/portfolio-import', requireAuth, requireRole('admin'), portfolioImportRouter)
app.use('/api/loi-import',       requireAuth, requireRole('admin'), loiImportRouter)

// ── SPA fallback: serve index.html for all remaining routes ──────────────────
// Handles client-side routing (React Router) — must be last.
if (isProd && existsSync(distPath)) {
  app.use((_req, res) => res.sendFile(join(distPath, 'index.html')))
}

app.listen(PORT, '0.0.0.0', () => {
  console.log(`\n  CRM API  →  http://0.0.0.0:${PORT}  [${isProd ? 'production' : 'development'}]\n`)
  import('./services/driveWatcher.js').then(({ watchDrive }) => {
    watchDrive().catch(() => {})
    setInterval(() => watchDrive().catch(() => {}), 5 * 60 * 1000)
  })
  import('./services/weeklyReport.js').then(({ startWeeklyReport }) => {
    startWeeklyReport()
  }).catch(err => console.warn('[weeklyReport] could not start:', err.message))
})
