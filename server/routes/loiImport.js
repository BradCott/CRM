import { Router } from 'express'
import multer from 'multer'
import db from '../db.js'
import { diagnoseDrive, watchDrive, watchMeetingNotes } from '../services/driveWatcher.js'
import { parseLOIPdf, parseLOIText } from '../services/loiParser.js'

const router = Router()
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } })

// GET /api/loi-import/diagnose — live check of the Drive watcher (admin)
router.get('/diagnose', async (_req, res) => {
  try {
    res.json(await diagnoseDrive())
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// POST /api/loi-import/run — force a watcher pass now and report what it did.
// ?reset=1 re-scans the last 7 days from scratch (dedupe by title prevents
// duplicate deals) — use it to recover an LOI that was marked processed but
// never produced a visible deal.
router.post('/run', async (req, res) => {
  try {
    const before = db.prepare(`SELECT COUNT(*) AS n FROM deals WHERE source = 'drive_loi'`).get().n
    if (req.query.reset) {
      db.prepare(`
        UPDATE oauth_tokens
        SET last_drive_check = NULL, lois_processed = NULL,
            notes_processed = NULL, updated_at = datetime('now')
        WHERE provider = 'google'
      `).run()
    }
    await watchDrive()
    await watchMeetingNotes()
    const after = db.prepare(`SELECT COUNT(*) AS n FROM deals WHERE source = 'drive_loi'`).get().n
    res.json({ ok: true, dealsCreated: after - before, ...(await diagnoseDrive()) })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// POST /api/loi-import
router.post('/', upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' })

  const { originalname, buffer } = req.file
  const ext = originalname.split('.').pop().toLowerCase()
  console.log(`[loi-import] File received: ${originalname} (${buffer.length} bytes, ext: ${ext})`)

  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) return res.status(500).json({ error: 'ANTHROPIC_API_KEY is not set' })

  try {
    let parsed

    if (ext === 'pdf') {
      // Send PDF directly to Claude — works for scanned PDFs too
      parsed = await parseLOIPdf(buffer, apiKey)
    } else {
      // Extract text first, then send as text
      let text = ''
      if (ext === 'docx') {
        const { default: mammoth } = await import('mammoth')
        const result = await mammoth.extractRawText({ buffer })
        text = result.value
        console.log(`[loi-import] mammoth extracted ${text.length} chars`)
      } else if (ext === 'txt') {
        text = buffer.toString('utf8')
        console.log(`[loi-import] txt extracted ${text.length} chars`)
      } else {
        return res.status(400).json({ error: 'Unsupported file type. Please upload a .docx, .pdf, or .txt file.' })
      }
      console.log('[loi-import] Text preview:', text.slice(0, 300))
      parsed = await parseLOIText(text, apiKey)
    }

    console.log('[loi-import] Parsed result:', JSON.stringify(parsed, null, 2))
    return res.json({ ok: true, parsed })
  } catch (err) {
    console.error('[loi-import] Error:', err)
    return res.status(500).json({ error: err.message })
  }
})

export default router
