import { Router } from 'express'
import multer from 'multer'

const router = Router()
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } })

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
      parsed = await parsePDFWithAI(buffer, apiKey)
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
      parsed = await parseTextWithAI(text, apiKey)
    }

    console.log('[loi-import] Parsed result:', JSON.stringify(parsed, null, 2))
    return res.json({ ok: true, parsed })
  } catch (err) {
    console.error('[loi-import] Error:', err)
    return res.status(500).json({ error: err.message })
  }
})

// ── Anthropic API helpers ─────────────────────────────────────────────────────

const EXTRACT_PROMPT = `You are extracting structured data from a commercial real estate Letter of Intent (LOI). Extract the following fields and return ONLY a valid JSON object. Use null for any field not found.

Fields:
- purchase_price: number (total purchase price in dollars, no commas — e.g. 1500000)
- close_date: string (closing date in YYYY-MM-DD format)
- tenant: string (tenant or brand name occupying the property, e.g. "Starbucks", "Dollar General")
- buyer: string (buyer/purchaser name or entity)
- seller: string (seller/vendor name or entity)
- earnest_money: number (earnest money deposit in dollars)
- due_diligence_days: number (due diligence/inspection period in days)
- closing_period_days: number (days from contract execution to closing)
- cap_rate: number (cap rate as a percentage, e.g. 5.5 for 5.5%)
- address: string (street address only, no city/state — e.g. "123 Main St")
- city: string (city where the property is located)
- state: string (2-letter US state abbreviation, e.g. "TX")
- title_company: string (title company name)
- listing_broker: string (listing broker / seller's broker name or firm)
- buyer_broker: string (buyer's broker or representative name or firm)

Return only the JSON object, no markdown, no explanation.`

async function parsePDFWithAI(buffer, apiKey) {
  const b64 = buffer.toString('base64')
  console.log(`[loi-import] Sending PDF to Claude as native document (${b64.length} base64 chars)`)

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 1024,
      messages: [{
        role: 'user',
        content: [
          {
            type: 'document',
            source: { type: 'base64', media_type: 'application/pdf', data: b64 },
          },
          {
            type: 'text',
            text: EXTRACT_PROMPT,
          },
        ],
      }],
    }),
  })

  console.log(`[loi-import] Anthropic API status: ${response.status}`)
  return handleAPIResponse(response)
}

async function parseTextWithAI(text, apiKey) {
  const truncated = text.length > 12000 ? text.slice(0, 12000) + '\n[truncated]' : text

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 1024,
      messages: [{
        role: 'user',
        content: `${EXTRACT_PROMPT}\n\nDocument text:\n${truncated}`,
      }],
    }),
  })

  console.log(`[loi-import] Anthropic API status: ${response.status}`)
  return handleAPIResponse(response)
}

async function handleAPIResponse(response) {
  if (!response.ok) {
    const err = await response.json().catch(() => ({}))
    console.error('[loi-import] Anthropic error body:', JSON.stringify(err))
    throw new Error(err.error?.message || `Anthropic API error ${response.status}`)
  }

  const data = await response.json()
  const content = data.content?.[0]?.text || ''
  console.log('[loi-import] Anthropic raw response:', content)

  const jsonStr = content.replace(/```(?:json)?/g, '').trim()
  const jsonMatch = jsonStr.match(/\{[\s\S]*\}/)
  if (!jsonMatch) throw new Error('Model did not return a JSON object')

  const raw = JSON.parse(jsonMatch[0])

  return {
    purchase_price:      toNum(raw.purchase_price),
    close_date:          toDate(raw.close_date),
    tenant:              toStr(raw.tenant),
    buyer:               toStr(raw.buyer),
    seller:              toStr(raw.seller),
    earnest_money:       toNum(raw.earnest_money),
    due_diligence_days:  toInt(raw.due_diligence_days),
    closing_period_days: toInt(raw.closing_period_days),
    cap_rate:            toNum(raw.cap_rate),
    address:             toStr(raw.address),
    city:                toStr(raw.city),
    state:               toStr(raw.state),
    title_company:       toStr(raw.title_company),
    listing_broker:      toStr(raw.listing_broker),
    buyer_broker:        toStr(raw.buyer_broker),
  }
}

// ── Type sanitizers ───────────────────────────────────────────────────────────

function toNum(v) {
  if (v === null || v === undefined) return null
  const n = typeof v === 'string' ? parseFloat(v.replace(/[$,]/g, '')) : Number(v)
  return isFinite(n) && n > 0 ? Math.round(n * 100) / 100 : null
}

function toInt(v) {
  if (v === null || v === undefined) return null
  const n = parseInt(v, 10)
  return isFinite(n) && n > 0 ? n : null
}

function toStr(v) {
  if (!v || typeof v !== 'string') return null
  const s = v.trim()
  return s.length > 0 && s.toLowerCase() !== 'null' && s.toLowerCase() !== 'n/a' ? s : null
}

function toDate(v) {
  if (!v || typeof v !== 'string') return null
  const d = new Date(v)
  if (isNaN(d) || d.getFullYear() < 2000) return null
  return d.toISOString().slice(0, 10)
}

export default router
