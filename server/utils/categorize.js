// Transaction categorization — learned rules first, then AI, then regex.
// Rules are learned every time the user approves a category on bank import,
// so corrections stick: fix "Home Depot" → Repair once and it's remembered.
import db from '../db.js'

// Valid categories a bank/Plaid transaction can map to
export const BANK_CATEGORIES = [
  'Rent', 'Mortgage', 'Repair', 'Insurance', 'Property Tax', 'Utilities',
  'Management Fees', 'Legal & Professional', 'Advertising', 'Supplies',
  'Travel', 'Commissions', 'Cleaning & Maintenance', 'HOA / CAM',
  'Equity Contribution', 'Sale', 'Other',
]

const NOISE = /\b(POS|PURCHASE|DEBIT|CREDIT|CARD|CHECKCARD|CHECK|ACH|RECURRING|PAYMENT|PMT|ONLINE|WEB|MOBILE|AUTOPAY|AUTH|REF|ID|TRANSACTION|XX+|X\d+)\b/gi

/** Reduce a bank description to a stable merchant key for rule matching. */
export function merchantKey(description) {
  if (!description) return ''
  let s = description.toUpperCase()
    .replace(/#\S+/g, ' ')          // store numbers (#6504)
    .replace(/\d+/g, ' ')           // any digits
    .replace(/[^A-Z\s&]/g, ' ')     // punctuation
    .replace(NOISE, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  // First 3 meaningful tokens — enough to identify the merchant, drops trailing city/state
  return s.split(' ').filter(Boolean).slice(0, 3).join(' ')
}

/** Regex fallback — same logic as the client guesser, server-side. */
export function regexGuess(description, amount = -1) {
  const d = (description || '').toLowerCase()
  if (Number(amount) > 0) {
    if (/rent|lease|tenant/.test(d)) return 'Rent'
    return 'Other'
  }
  if (/mortgage|\bmtg\b|home loan|loan pmt|escrow/.test(d))                   return 'Mortgage'
  if (/insurance|policy|premium|geico|allstate|state farm|travelers/.test(d)) return 'Insurance'
  if (/property tax|county tax|tax collector|treasurer|assessor/.test(d))     return 'Property Tax'
  if (/electric|water|sewer|utility|utilities|power|energy|internet|comcast|xfinity|\bgas\b/.test(d)) return 'Utilities'
  if (/management|prop mgmt|property mgmt/.test(d))                           return 'Management Fees'
  if (/attorney|legal|cpa|accounting|bookkeep|law firm/.test(d))              return 'Legal & Professional'
  if (/repair|maintenance|plumb|hvac|roof|contractor|hardware|home depot|lowes|ace hardware/.test(d)) return 'Repair'
  if (/landscap|lawn|cleaning|janitorial|pest|snow/.test(d))                  return 'Cleaning & Maintenance'
  if (/hoa|cam charge|association/.test(d))                                   return 'HOA / CAM'
  return 'Other'
}

/** Map Plaid's personal-finance category to ours as a weak hint. */
function plaidHint(plaidCategory) {
  const c = (plaidCategory || '').toUpperCase()
  if (c.includes('RENT'))                          return 'Rent'
  if (c.includes('MORTGAGE') || c.includes('LOAN')) return 'Mortgage'
  if (c.includes('INSURANCE'))                     return 'Insurance'
  if (c.includes('UTILITIES') || c.includes('UTILITY')) return 'Utilities'
  if (c.includes('TAX'))                           return 'Property Tax'
  if (c.includes('HOME_IMPROVEMENT') || c.includes('HARDWARE')) return 'Repair'
  return null
}

/** Look up learned rules for a set of merchant keys. Returns Map<key, category>. */
export function lookupRules(keys) {
  const map = new Map()
  if (!keys.length) return map
  const uniq = [...new Set(keys.filter(Boolean))]
  const placeholders = uniq.map(() => '?').join(',')
  const rows = db.prepare(
    `SELECT merchant_key, category FROM transaction_rules WHERE merchant_key IN (${placeholders})`
  ).all(...uniq)
  for (const r of rows) map.set(r.merchant_key, r.category)
  return map
}

/** Record approved categorizations as rules (upsert, bumping hit_count). */
export function learnRules(items) {
  const upsert = db.prepare(`
    INSERT INTO transaction_rules (merchant_key, category, hit_count, last_used)
    VALUES (?, ?, 1, datetime('now'))
    ON CONFLICT(merchant_key) DO UPDATE SET
      category  = excluded.category,
      hit_count = hit_count + 1,
      last_used = datetime('now')
  `)
  let learned = 0
  for (const it of items) {
    const key = merchantKey(it.description)
    if (!key || !BANK_CATEGORIES.includes(it.category)) continue
    // Don't learn the catch-all — "Other" carries no signal
    if (it.category === 'Other') continue
    upsert.run(key, it.category)
    learned++
  }
  return learned
}

/** Batch-categorize unknowns with Claude. Returns array aligned to input. */
export async function aiCategorize(items, apiKey) {
  if (!items.length) return []
  const list = items.map((t, i) =>
    `${i}. "${t.description}" | ${Number(t.amount) >= 0 ? 'deposit' : 'payment'}${t.plaid_category ? ` | bank tag: ${t.plaid_category}` : ''}`
  ).join('\n')

  const prompt = `You are categorizing real estate bank transactions. Choose the single best category for each from this exact list:
${BANK_CATEGORIES.join(', ')}

Rules: deposits that look like rent → Rent. Loan/mortgage payments → Mortgage. Use the most specific expense category. If genuinely unclear, use Other.

Transactions:
${list}

Return ONLY a JSON array of objects, one per transaction in order: [{"i":0,"category":"..."}]`

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 1024,
      messages: [{ role: 'user', content: prompt }],
    }),
  })
  if (!response.ok) throw new Error(`Anthropic API error ${response.status}`)
  const data = await response.json()
  const text = (data.content?.[0]?.text || '').replace(/```(?:json)?/g, '').trim()
  const match = text.match(/\[[\s\S]*\]/)
  if (!match) throw new Error('AI did not return a JSON array')
  const parsed = JSON.parse(match[0])
  const out = new Array(items.length).fill(null)
  for (const r of parsed) {
    if (typeof r.i === 'number' && BANK_CATEGORIES.includes(r.category)) out[r.i] = r.category
  }
  return out
}

/**
 * Categorize a batch: rules → AI → plaid hint → regex.
 * Returns [{ category, source }] aligned to input order.
 */
export async function categorizeBatch(transactions, apiKey) {
  const keys = transactions.map(t => merchantKey(t.description))
  const rules = lookupRules(keys)

  const result = new Array(transactions.length).fill(null)
  const needAI = []

  transactions.forEach((t, i) => {
    const ruleCat = rules.get(keys[i])
    if (ruleCat) {
      result[i] = { category: ruleCat, source: 'rule' }
    } else {
      needAI.push(i)
    }
  })

  if (needAI.length && apiKey) {
    try {
      const aiItems = needAI.map(i => transactions[i])
      const aiCats = await aiCategorize(aiItems, apiKey)
      needAI.forEach((origIdx, k) => {
        if (aiCats[k]) result[origIdx] = { category: aiCats[k], source: 'ai' }
      })
    } catch (e) {
      console.error('[categorize] AI batch failed:', e.message)
    }
  }

  // Anything still unresolved → plaid hint, then regex
  transactions.forEach((t, i) => {
    if (!result[i]) {
      const hint = plaidHint(t.plaid_category)
      result[i] = hint
        ? { category: hint, source: 'guess' }
        : { category: regexGuess(t.description, t.amount), source: 'guess' }
    }
  })

  return result
}
