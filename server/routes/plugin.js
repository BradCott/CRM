import { Router } from 'express'
import { readFile } from 'node:fs/promises'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'
import JSZip from 'jszip'
import { EXTENSION_API_KEY } from '../middleware/auth.js'

const router = Router()
const __dirname = dirname(fileURLToPath(import.meta.url))
const EXT_DIR = join(__dirname, '..', '..', 'extension')

// Files shipped in the download. config.js is generated (baked with URL + key).
const STATIC_FILES = ['manifest.json', 'content.js', 'content.css', 'popup.html', 'popup.js', 'schema.json']

function crmBaseUrl(req) {
  const proto = (req.headers['x-forwarded-proto'] || req.protocol || 'https').split(',')[0]
  return `${proto}://${req.get('host')}`
}

async function extVersion() {
  try { return JSON.parse(await readFile(join(EXT_DIR, 'manifest.json'), 'utf8')).version } catch { return null }
}

// GET /api/plugin/info — version + whether the download will be pre-configured.
router.get('/info', async (_req, res) => {
  res.json({ version: await extVersion(), keyConfigured: !!EXTENSION_API_KEY })
})

// Chrome extension ID = a-p mapping of the first 128 bits of SHA256(public key).
function idFromManifestKey(keyB64) {
  const der = Buffer.from(keyB64, 'base64')
  const h = createHash('sha256').update(der).digest()
  return [...h.subarray(0, 16)].map(b => String.fromCharCode(97 + (b >> 4)) + String.fromCharCode(97 + (b & 0xf))).join('')
}

// GET /api/plugin/managed — admin-only: everything needed to force-install the
// extension org-wide via the Google Admin console.
router.get('/managed', async (req, res) => {
  if (req.user?.role !== 'admin') return res.status(403).json({ error: 'Admins only' })
  try {
    const man = JSON.parse(await readFile(join(EXT_DIR, 'manifest.json'), 'utf8'))
    const base = crmBaseUrl(req)
    res.json({
      extensionId: man.key ? idFromManifestKey(man.key) : null,
      version: man.version,
      updateUrl: `${base}/ext-dist/updates.xml`,
      crxUrl: `${base}/ext-dist/knox-crm.crx`,
      crmUrl: base,
      crmKey: EXTENSION_API_KEY,
      signingConfigured: !!process.env.CRX_PRIVATE_KEY,
    })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// GET /api/plugin/download — zip of the extension, pre-baked with this CRM's
// URL + key so the recipient just loads it (no manual popup setup).
router.get('/download', async (req, res) => {
  try {
    const zip = new JSZip()
    const folder = zip.folder('knox-crm-extension')

    for (const name of STATIC_FILES) {
      folder.file(name, await readFile(join(EXT_DIR, name)))
    }
    // Bake the caller's CRM URL + key into config.js.
    const cfg = `// Auto-generated on download — pre-configured for this CRM.\n` +
      `var KNOX_CFG = ${JSON.stringify({ url: crmBaseUrl(req), key: EXTENSION_API_KEY })}\n`
    folder.file('config.js', cfg)

    const buf = await zip.generateAsync({ type: 'nodebuffer' })
    res.setHeader('Content-Type', 'application/zip')
    res.setHeader('Content-Disposition', 'attachment; filename="knox-crm-extension.zip"')
    res.send(buf)
  } catch (err) {
    res.status(500).json({ error: `Could not build the extension package: ${err.message}` })
  }
})

export default router
