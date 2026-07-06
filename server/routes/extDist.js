import { Router } from 'express'
import { readFile } from 'node:fs/promises'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import JSZip from 'jszip'
import { packCrx, getCrxIdentity } from '../utils/crx.js'

// Public (no-auth) self-hosted update endpoints for Google Workspace managed
// install. Chrome's updater fetches these unauthenticated, so they must be
// public — and the packaged extension contains NO secret (the CRM URL + key are
// delivered separately via managed policy / chrome.storage.managed).
const router = Router()
const __dirname = dirname(fileURLToPath(import.meta.url))
const EXT_DIR = join(__dirname, '..', '..', 'extension')
const FILES = ['manifest.json', 'content.js', 'content.css', 'popup.html', 'popup.js', 'config.js', 'schema.json']

function privateKeyPem() {
  const b64 = process.env.CRX_PRIVATE_KEY
  return b64 ? Buffer.from(b64, 'base64').toString('utf8') : null
}
async function buildZip() {
  const zip = new JSZip()
  for (const n of FILES) zip.file(n, await readFile(join(EXT_DIR, n)))
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' })
}
async function manifestVersion() {
  return JSON.parse(await readFile(join(EXT_DIR, 'manifest.json'), 'utf8')).version
}
function baseUrl(req) {
  const proto = (req.headers['x-forwarded-proto'] || req.protocol || 'https').split(',')[0]
  return `${proto}://${req.get('host')}`
}

// The signed extension package.
router.get('/knox-crm.crx', async (req, res) => {
  const pem = privateKeyPem()
  if (!pem) return res.status(503).send('CRX signing key not configured (set CRX_PRIVATE_KEY).')
  try {
    const crx = packCrx(await buildZip(), pem)
    res.setHeader('Content-Type', 'application/x-chrome-extension')
    res.setHeader('Content-Disposition', 'attachment; filename="knox-crm.crx"')
    res.send(crx)
  } catch (err) {
    res.status(500).send(`pack error: ${err.message}`)
  }
})

// The update manifest Chrome polls.
router.get('/updates.xml', async (req, res) => {
  const pem = privateKeyPem()
  if (!pem) return res.status(503).send('CRX signing key not configured (set CRX_PRIVATE_KEY).')
  const { id } = getCrxIdentity(pem)
  const version = await manifestVersion()
  const crxUrl = `${baseUrl(req)}/ext-dist/knox-crm.crx`
  res.setHeader('Content-Type', 'application/xml')
  res.send(
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<gupdate xmlns="http://www.google.com/update2/response" protocol="2.0">\n` +
    `  <app appid="${id}">\n` +
    `    <updatecheck codebase="${crxUrl}" version="${version}" />\n` +
    `  </app>\n` +
    `</gupdate>\n`,
  )
})

export default router
