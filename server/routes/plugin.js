import { Router } from 'express'
import { readFile } from 'node:fs/promises'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import JSZip from 'jszip'
import { EXTENSION_API_KEY } from '../middleware/auth.js'

const router = Router()
const __dirname = dirname(fileURLToPath(import.meta.url))
const EXT_DIR = join(__dirname, '..', '..', 'extension')

// Files shipped in the download. config.js is generated (baked with URL + key).
const STATIC_FILES = ['manifest.json', 'content.js', 'content.css', 'popup.html', 'popup.js']

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
