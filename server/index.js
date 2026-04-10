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

// ── Public routes (no auth required) ─────────────────────────────────────────
app.use('/api/auth', authRouter)

// ── All routes below require a valid session ──────────────────────────────────
app.use(requireAuth)

// ── Admin-only routes ─────────────────────────────────────────────────────────
app.use('/api/admin/users',   requireRole('admin'), usersRouter)

// ── Role-restricted routes (admin + full_agent only) ─────────────────────────
app.use('/api/accounting',    requireRole('admin', 'full_agent'), requireWrite, accountingRouter)
app.use('/api/investors',     requireRole('admin', 'full_agent'), requireWrite, investorsRouter)

// ── Standard data routes (all authenticated users can read; only admin can write) ─
app.use('/api/tenant-brands',    requireWrite, tenantBrandsRouter)
app.use('/api/people',           requireWrite, peopleRouter)
app.use('/api/properties',       requireWrite, propertiesRouter)
app.use('/api/deals',            requireWrite, dealsRouter)
app.use('/api/import',           requireRole('admin'), importRouter)
app.use('/api/reports',          reportsRouter)
app.use('/api/saved-searches',   requireWrite, savedSearchesRouter)
app.use('/api/portfolio-import', requireRole('admin'), portfolioImportRouter)
app.use('/api/dashboard',        dashboardRouter)
app.use('/api/emails',           requireWrite, emailsRouter)
app.use('/api/loi-import',       requireRole('admin'), loiImportRouter)

// ── Production: serve built React app ────────────────────────────────────────
const distPath = join(__dirname, '..', 'dist')
if (isProd && existsSync(distPath)) {
  app.use(express.static(distPath))
  app.use((_req, res) => res.sendFile(join(distPath, 'index.html')))
}

app.listen(PORT, '0.0.0.0', () => {
  console.log(`\n  CRM API  →  http://0.0.0.0:${PORT}  [${isProd ? 'production' : 'development'}]\n`)
  import('./services/driveWatcher.js').then(({ watchDrive }) => {
    watchDrive().catch(() => {})
    setInterval(() => watchDrive().catch(() => {}), 5 * 60 * 1000)
  })
})
