// Today's Plays engine — generates per-user action items from three feeds:
//  1. system rules (deadlines, stale deals, bills, leases, mail follow-ups)
//  2. Monday meeting notes from Google Drive (see driveWatcher.watchMeetingNotes)
//  3. morning Gmail digest (suggested plays, user accepts/dismisses)
import { google } from 'googleapis'
import db from '../db.js'
import { getAuthedClient } from './googleClient.js'

// ── Helpers ───────────────────────────────────────────────────────────────────

function getSetting(key, fallback = null) {
  const row = db.prepare('SELECT value FROM app_settings WHERE key = ?').get(key)
  return row ? row.value : fallback
}

function setSetting(key, value) {
  db.prepare(`
    INSERT INTO app_settings (key, value) VALUES (?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `).run(key, String(value))
}

export { getSetting, setSetting }

/** Insert a play unless its dedupe_key already exists (in any status). */
const insertPlay = db.prepare(`
  INSERT OR IGNORE INTO plays (user_id, source, play_type, title, detail, route, priority, status, due_date, dedupe_key)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`)

function addPlay({ user_id = null, source = 'system', play_type, title, detail = null, route = null, priority = 0, status = 'open', due_date = null, dedupe_key }) {
  insertPlay.run(user_id, source, play_type, title, detail, route, priority, status, due_date, dedupe_key)
}

// ── 1. System rules ───────────────────────────────────────────────────────────

export function generateSystemPlays() {
  // Throttle: at most once per 15 minutes
  const last = getSetting('plays_last_generated')
  if (last && Date.now() - new Date(last).getTime() < 15 * 60 * 1000) return
  setSetting('plays_last_generated', new Date().toISOString())

  const today = new Date().toISOString().slice(0, 10)

  // DD deadlines within 7 days on active deals
  const ddDeals = db.prepare(`
    SELECT d.id, d.assigned_to, d.dd_deadline, COALESCE(d.address, p.address, d.title, 'Deal') AS label
    FROM deals d LEFT JOIN properties p ON p.id = d.property_id
    WHERE d.dd_deadline IS NOT NULL
      AND d.stage NOT IN ('Closed', 'Dropped')
      AND (d.status IS NULL OR d.status = 'active')
      AND d.dd_deadline <= date('now', '+7 days')
  `).all()
  for (const d of ddDeals) {
    const overdue = d.dd_deadline < today
    addPlay({
      user_id: d.assigned_to, play_type: 'deal',
      title: `DD ${overdue ? 'PASSED' : 'ends'} ${d.dd_deadline} — ${d.label}`,
      route: '/pipeline', priority: overdue ? 100 : 90, due_date: d.dd_deadline,
      dedupe_key: `dd:${d.id}:${d.dd_deadline}`,
    })
  }

  // Closing dates within 7 days
  const closing = db.prepare(`
    SELECT d.id, d.assigned_to, d.close_date, COALESCE(d.address, p.address, d.title, 'Deal') AS label
    FROM deals d LEFT JOIN properties p ON p.id = d.property_id
    WHERE d.close_date IS NOT NULL
      AND d.stage NOT IN ('Closed', 'Dropped')
      AND (d.status IS NULL OR d.status = 'active')
      AND d.close_date <= date('now', '+7 days')
  `).all()
  for (const d of closing) {
    addPlay({
      user_id: d.assigned_to, play_type: 'deal',
      title: `Closing ${d.close_date} — ${d.label}`,
      route: '/pipeline', priority: 95, due_date: d.close_date,
      dedupe_key: `close:${d.id}:${d.close_date}`,
    })
  }

  // Stale deals — untouched for 14+ days (falls back to created_at)
  const stale = db.prepare(`
    SELECT d.id, d.assigned_to, d.stage, COALESCE(d.address, p.address, d.title, 'Deal') AS label,
           COALESCE(d.updated_at, d.created_at) AS last_touch
    FROM deals d LEFT JOIN properties p ON p.id = d.property_id
    WHERE d.stage NOT IN ('Closed', 'Dropped')
      AND (d.status IS NULL OR d.status = 'active')
      AND COALESCE(d.updated_at, d.created_at) IS NOT NULL
      AND COALESCE(d.updated_at, d.created_at) < datetime('now', '-14 days')
  `).all()
  for (const d of stale) {
    // Weekly dedupe window so a nudged-but-ignored deal resurfaces
    const week = new Date().toISOString().slice(0, 10).slice(0, 8) + 'wk' + Math.ceil(new Date().getDate() / 7)
    addPlay({
      user_id: d.assigned_to, play_type: 'stale',
      title: `${d.label} untouched since ${String(d.last_touch).slice(0, 10)} (${d.stage})`,
      route: '/pipeline', priority: 40,
      dedupe_key: `stale:${d.id}:${week}`,
    })
  }

  // Bills due within 7 days or overdue
  const bills = db.prepare(`
    SELECT b.id, b.payee, b.amount, b.due_date, b.property_id, p.address
    FROM property_bills b JOIN properties p ON p.id = b.property_id
    WHERE b.paid_at IS NULL AND b.due_date <= date('now', '+7 days')
  `).all()
  for (const b of bills) {
    const overdue = b.due_date < today
    addPlay({
      play_type: 'bill',
      title: `${overdue ? 'OVERDUE: ' : ''}${b.payee} — $${Math.round(b.amount).toLocaleString()} due ${b.due_date}`,
      detail: b.address,
      route: `/accounting/${b.property_id}`, priority: overdue ? 85 : 70, due_date: b.due_date,
      dedupe_key: `bill:${b.id}`,
    })
  }

  // Insurance expiring within 30 days, unpaid
  const insurance = db.prepare(`
    SELECT pi.id, pi.carrier, pi.expiry_date, pi.property_id, p.address
    FROM property_insurance pi JOIN properties p ON p.id = pi.property_id
    WHERE pi.paid_status = 'unpaid' AND pi.expiry_date IS NOT NULL
      AND pi.expiry_date <= date('now', '+30 days')
  `).all()
  for (const i of insurance) {
    addPlay({
      play_type: 'task',
      title: `Insurance expiring ${i.expiry_date} — ${i.carrier || 'policy'}`,
      detail: i.address,
      route: `/management/${i.property_id}?tab=insurance`, priority: 60, due_date: i.expiry_date,
      dedupe_key: `ins:${i.id}:${i.expiry_date}`,
    })
  }

  // Property tasks due within 7 days
  const tasks = db.prepare(`
    SELECT pt.id, pt.title, pt.due_date, pt.property_id, p.address
    FROM property_tasks pt JOIN properties p ON p.id = pt.property_id
    WHERE pt.completed_at IS NULL AND pt.due_date IS NOT NULL
      AND pt.due_date <= date('now', '+7 days')
  `).all()
  for (const t of tasks) {
    addPlay({
      play_type: 'task',
      title: t.title, detail: t.address,
      route: `/management/${t.property_id}`, priority: 65, due_date: t.due_date,
      dedupe_key: `task:${t.id}:${t.due_date}`,
    })
  }

  // Portfolio leases under 12 months — one play per property
  const leases = db.prepare(`
    SELECT p.id, p.address, p.lease_end, t.name AS tenant
    FROM properties p LEFT JOIN tenant_brands t ON t.id = p.tenant_brand_id
    WHERE p.is_portfolio = 1 AND p.lease_end IS NOT NULL
      AND p.lease_end > date('now') AND p.lease_end <= date('now', '+12 months')
  `).all()
  for (const l of leases) {
    addPlay({
      play_type: 'lease',
      title: `Lease expires ${l.lease_end} — ${l.tenant || l.address}`,
      detail: l.address,
      route: `/management/${l.id}`, priority: 55, due_date: l.lease_end,
      dedupe_key: `lease:${l.id}:${l.lease_end}`,
    })
  }

  // Mail follow-ups — aggregate plays (per-owner would flood the queue)
  const month = new Date().toISOString().slice(0, 7)
  const { mail_due } = db.prepare(`
    SELECT COUNT(*) AS mail_due FROM people pe
    WHERE pe.role IN ('owner','owner_company') AND COALESCE(pe.do_not_contact, 0) = 0
      AND EXISTS (SELECT 1 FROM handwrytten_sends s WHERE s.contact_id = pe.id AND s.status = 'sent')
      AND (SELECT MAX(s.sent_at) FROM handwrytten_sends s WHERE s.contact_id = pe.id AND s.status = 'sent') < datetime('now', '-90 days')
  `).get()
  if (mail_due > 0) {
    addPlay({
      play_type: 'mail',
      title: `${mail_due} owner${mail_due !== 1 ? 's' : ''} due for follow-up mail (90+ days since last letter)`,
      route: '/campaigns', priority: 50,
      dedupe_key: `maildue:${month}`,
    })
  }

  // HOT: market properties with lease ending within 18 months whose owner has never been mailed
  const { hot } = db.prepare(`
    SELECT COUNT(*) AS hot FROM properties p
    JOIN people pe ON pe.id = p.owner_id
    WHERE COALESCE(p.is_portfolio, 0) = 0
      AND p.lease_end IS NOT NULL AND p.lease_end > date('now')
      AND p.lease_end <= date('now', '+18 months')
      AND COALESCE(pe.do_not_contact, 0) = 0
      AND NOT EXISTS (SELECT 1 FROM handwrytten_sends s WHERE s.contact_id = pe.id)
  `).get()
  if (hot > 0) {
    addPlay({
      play_type: 'hot',
      title: `${hot} market propert${hot !== 1 ? 'ies' : 'y'} with lease < 18 mo — owner never mailed`,
      detail: 'Lease coming due often means a motivated seller',
      route: '/properties', priority: 75,
      dedupe_key: `hot:${month}`,
    })
  }

  // Sweep: auto-complete open system plays whose underlying item resolved
  db.prepare(`
    UPDATE plays SET status = 'done', done_at = datetime('now')
    WHERE status = 'open' AND source = 'system' AND dedupe_key LIKE 'bill:%'
      AND CAST(substr(dedupe_key, 6) AS INTEGER) IN (SELECT id FROM property_bills WHERE paid_at IS NOT NULL)
  `).run()
  db.prepare(`
    UPDATE plays SET status = 'done', done_at = datetime('now')
    WHERE status = 'open' AND source = 'system'
      AND (dedupe_key LIKE 'dd:%' OR dedupe_key LIKE 'close:%' OR dedupe_key LIKE 'stale:%')
      AND CAST(substr(dedupe_key, instr(dedupe_key, ':') + 1) AS INTEGER) IN
        (SELECT id FROM deals WHERE stage IN ('Closed', 'Dropped') OR status = 'dropped')
  `).run()
}

// ── Claude JSON helper ────────────────────────────────────────────────────────

async function claudeJson(prompt) {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY is not set')
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 2048,
      messages: [{ role: 'user', content: prompt }],
    }),
  })
  if (!response.ok) {
    const err = await response.json().catch(() => ({}))
    throw new Error(err.error?.message || `Anthropic API error ${response.status}`)
  }
  const data = await response.json()
  const text = (data.content?.[0]?.text || '').replace(/```(?:json)?/g, '').trim()
  const match = text.match(/\{[\s\S]*\}/)
  if (!match) throw new Error('Claude did not return valid JSON')
  return JSON.parse(match[0])
}

/** Match a first name ("Brad", "Cole") to a CRM user id. */
function matchUser(name) {
  if (!name) return null
  const n = String(name).trim().toLowerCase()
  if (!n || n === 'everyone' || n === 'team') return null
  const users = db.prepare(`SELECT id, name, email FROM users WHERE status = 'active'`).all()
  for (const u of users) {
    const uname = (u.name || '').toLowerCase()
    if (uname === n || uname.startsWith(n + ' ') || uname.split(' ')[0] === n) return u.id
    if ((u.email || '').toLowerCase().startsWith(n)) return u.id
  }
  return null
}

// ── 2. Meeting notes → plays ──────────────────────────────────────────────────

const NOTES_PROMPT = `You are extracting action items from a real estate investment team's weekly meeting notes.

Return ONLY a valid JSON object:
{
  "items": [
    { "assignee": "first name or null", "task": "short imperative action", "context": "deal/property name mentioned, or null" }
  ]
}

Rules:
- Extract concrete action items only — things someone needs to DO (call, send, review, order, follow up, negotiate)
- "assignee": the first name of who owns it if stated or clearly implied; null if unassigned
- "task": rewrite as a short imperative sentence (max 12 words)
- "context": the property address, tenant brand, or deal name it relates to, or null
- Skip status updates, FYIs, and decisions already made
- Max 15 items
- Return ONLY the JSON object`

export async function parseMeetingNotesText(filename, text, fileId) {
  const result = await claudeJson(`${NOTES_PROMPT}\n\nMeeting notes:\n\n${text.slice(0, 12000)}`)
  const items = Array.isArray(result.items) ? result.items : []
  let created = 0
  items.forEach((item, i) => {
    if (!item.task) return
    const userId = matchUser(item.assignee)
    addPlay({
      user_id: userId, source: 'notes', play_type: 'notes',
      title: item.task,
      detail: [item.context, `From meeting notes: ${filename}`].filter(Boolean).join(' · '),
      priority: 80,
      dedupe_key: `notes:${fileId}:${i}`,
    })
    created++
  })
  console.log(`[plays] meeting notes "${filename}": ${created} plays created`)
  return created
}

// ── 3. Morning email digest → suggested plays ─────────────────────────────────

const EMAIL_PROMPT = `You are triaging overnight emails for a real estate investor. For each email decide if it needs an action from the recipient.

Return ONLY a valid JSON object:
{
  "items": [
    { "subject": "the email subject", "from_name": "sender name", "task": "short imperative action", "urgent": true/false }
  ]
}

Rules:
- Only include emails that genuinely need a reply or action (questions, requests, documents to review, deadlines)
- Skip newsletters, confirmations, receipts, automated notifications, FYI-only emails
- "task": what the recipient should do, max 12 words (e.g. "Reply to Marcus about the PSA redlines")
- Max 5 items — pick the most important
- If nothing needs action, return { "items": [] }
- Return ONLY the JSON object`

export async function runMorningDigest() {
  const tokenRow = db.prepare(`SELECT * FROM oauth_tokens WHERE provider = 'google'`).get()
  if (!tokenRow?.access_token) return

  let auth
  try { auth = getAuthedClient(tokenRow) } catch { return }
  const gmail = google.gmail({ version: 'v1', auth })

  // Known CRM contacts (brokers, owners, attorneys — anyone with an email)
  const contacts = db.prepare(`SELECT id, name, email, email2 FROM people WHERE email IS NOT NULL OR email2 IS NOT NULL`).all()
  const emailMap = new Map()
  for (const c of contacts) {
    if (c.email)  emailMap.set(c.email.toLowerCase().trim(), c)
    if (c.email2) emailMap.set(c.email2.toLowerCase().trim(), c)
  }
  if (emailMap.size === 0) return

  const listRes = await gmail.users.messages.list({ userId: 'me', q: 'newer_than:1d in:inbox', maxResults: 50 })
  const messages = listRes.data.messages || []
  if (!messages.length) return

  // Suggested plays go to the first admin (the connected Google account's owner)
  const admin = db.prepare(`SELECT id FROM users WHERE role = 'admin' AND status = 'active' ORDER BY id LIMIT 1`).get()

  const candidates = []
  for (const msg of messages) {
    // Skip if already turned into a play
    const exists = db.prepare(`SELECT id FROM plays WHERE dedupe_key = ?`).get(`email:${msg.id}`)
    if (exists) continue
    const detail = await gmail.users.messages.get({
      userId: 'me', id: msg.id, format: 'metadata',
      metadataHeaders: ['From', 'Subject', 'Date'],
    })
    const headers = {}
    for (const h of detail.data.payload?.headers || []) headers[h.name] = h.value
    const fromEmail = (headers.From?.match(/<([^>]+)>/)?.[1] || headers.From || '').toLowerCase().trim()
    const contact = emailMap.get(fromEmail)
    if (!contact) continue   // only emails from known CRM contacts
    candidates.push({
      id: msg.id,
      from: contact.name,
      subject: headers.Subject || '(no subject)',
      snippet: detail.data.snippet || '',
    })
  }
  if (!candidates.length) return

  const block = candidates.map((c, i) =>
    `[${i}] From: ${c.from} | Subject: ${c.subject}\nPreview: ${c.snippet}`
  ).join('\n\n')

  let result
  try {
    result = await claudeJson(`${EMAIL_PROMPT}\n\nEmails:\n\n${block}`)
  } catch (e) {
    console.error('[plays] email digest failed:', e.message)
    return
  }

  let created = 0
  for (const item of result.items || []) {
    if (!item.task) continue
    // Find the candidate this refers to (match by subject)
    const cand = candidates.find(c => c.subject === item.subject) || candidates[0]
    addPlay({
      user_id: admin?.id ?? null, source: 'email', play_type: 'email',
      title: item.task,
      detail: `Email from ${item.from_name || cand.from}: "${cand.subject}"`,
      priority: item.urgent ? 85 : 45,
      status: 'suggested',
      dedupe_key: `email:${cand.id}`,
    })
    created++
  }
  console.log(`[plays] morning digest: ${candidates.length} emails screened, ${created} plays suggested`)
}
