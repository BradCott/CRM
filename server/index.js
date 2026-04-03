import express from 'express'
import cors from 'cors'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { existsSync } from 'node:fs'
import tenantBrandsRouter from './routes/tenantBrands.js'
import peopleRouter from './routes/people.js'
import propertiesRouter from './routes/properties.js'
import dealsRouter from './routes/deals.js'
import importRouter from './routes/import.js'
import reportsRouter from './routes/reports.js'
import savedSearchesRouter from './routes/savedSearches.js'
import portfolioImportRouter from './routes/portfolioImport.js'

// Initialize DB schema
import './db.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const app  = express()
const PORT = process.env.PORT || 3001
const isProd = process.env.NODE_ENV === 'production'

app.use(cors())
app.use(express.json())

// API routes
app.use('/api/tenant-brands',    tenantBrandsRouter)
app.use('/api/people',           peopleRouter)
app.use('/api/properties',       propertiesRouter)
app.use('/api/deals',            dealsRouter)
app.use('/api/import',           importRouter)
app.use('/api/reports',          reportsRouter)
app.use('/api/saved-searches',   savedSearchesRouter)
app.use('/api/portfolio-import', portfolioImportRouter)

// In production, serve the built React app and handle SPA routing
const distPath = join(__dirname, '..', 'dist')
if (isProd && existsSync(distPath)) {
  app.use(express.static(distPath))
  app.get('/{*path}', (_req, res) => res.sendFile(join(distPath, 'index.html')))
}

app.listen(PORT, () => {
  console.log(`\n  CRM API  →  http://localhost:${PORT}  [${isProd ? 'production' : 'development'}]\n`)
})
