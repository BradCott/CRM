import express from 'express'
import cors from 'cors'
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

const app = express()
const PORT = 3001

app.use(cors({ origin: ['http://localhost:5173', 'http://localhost:4173'] }))
app.use(express.json())

app.use('/api/tenant-brands',   tenantBrandsRouter)
app.use('/api/people',          peopleRouter)
app.use('/api/properties',      propertiesRouter)
app.use('/api/deals',           dealsRouter)
app.use('/api/import',          importRouter)
app.use('/api/reports',         reportsRouter)
app.use('/api/saved-searches',  savedSearchesRouter)
app.use('/api/portfolio-import', portfolioImportRouter)

app.listen(PORT, () => {
  console.log(`\n  CRM API  →  http://localhost:${PORT}\n`)
})
