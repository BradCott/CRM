// Today's Plays + dashboard command-center API
import { Router } from 'express'
import db from '../db.js'
import { generateSystemPlays, getSetting, setSetting } from '../services/playsEngine.js'

const router = Router()

// ── GET /plays — my queue ─────────────────────────────────────────────────────

router.get('/', (req, res) => {
  try { generateSystemPlays() } catch (e) { console.error('[plays] generate failed:', e.message) }

  const userId = Number(req.user.sub)
  const rows = db.prepare(`
    SELECT id, user_id, source, play_type, title, detail, route, priority, status, due_date, created_at
    FROM plays
    WHERE status IN ('open', 'suggested', 'snoozed')
      AND (user_id IS NULL OR user_id = ?)
      AND (snooze_until IS NULL OR snooze_until <= datetime('now') OR status != 'snoozed')
    ORDER BY
      CASE status WHEN 'open' THEN 0 WHEN 'snoozed' THEN 0 ELSE 1 END,
      priority DESC, due_date ASC, created_at DESC
    LIMIT 25
  `).all(userId)

  // Snoozed plays whose snooze expired flow back as open
  const visible = rows.filter(r => r.status !== 'snoozed' ||
    !r.snooze_until || r.snooze_until <= new Date().toISOString())

  res.json(visible)
})

// ── PATCH /plays/:id — done / dismissed / snoozed / accept suggested ──────────

router.patch('/:id', (req, res) => {
  const { status, snooze_days } = req.body
  const valid = ['open', 'done', 'dismissed', 'snoozed']
  if (!valid.includes(status)) return res.status(400).json({ error: `status must be one of: ${valid.join(', ')}` })

  if (status === 'snoozed') {
    const days = Number(snooze_days) || 1
    db.prepare(`
      UPDATE plays SET status = 'snoozed', snooze_until = datetime('now', '+' || ? || ' days') WHERE id = ?
    `).run(days, req.params.id)
  } else {
    db.prepare(`
      UPDATE plays SET status = ?, done_at = CASE WHEN ? = 'done' THEN datetime('now') ELSE done_at END,
        snooze_until = NULL
      WHERE id = ?
    `).run(status, status, req.params.id)
  }
  const row = db.prepare('SELECT * FROM plays WHERE id = ?').get(req.params.id)
  if (!row) return res.status(404).json({ error: 'Play not found' })
  res.json(row)
})

// ── POST /plays — manual play ─────────────────────────────────────────────────

router.post('/', (req, res) => {
  const { title, detail, route, due_date, for_everyone } = req.body
  if (!title?.trim()) return res.status(400).json({ error: 'title is required' })
  const r = db.prepare(`
    INSERT INTO plays (user_id, source, play_type, title, detail, route, priority, due_date)
    VALUES (?, 'manual', 'custom', ?, ?, ?, 50, ?)
  `).run(for_everyone ? null : Number(req.user.sub), title.trim(), detail || null, route || null, due_date || null)
  res.status(201).json(db.prepare('SELECT * FROM plays WHERE id = ?').get(r.lastInsertRowid))
})

// ── POST /plays/:id/claim ─────────────────────────────────────────────────────

router.post('/:id/claim', (req, res) => {
  db.prepare('UPDATE plays SET user_id = ? WHERE id = ?').run(Number(req.user.sub), req.params.id)
  res.json(db.prepare('SELECT * FROM plays WHERE id = ?').get(req.params.id))
})

// ── GET /plays/launcher — live counts for the action buttons ──────────────────

router.get('/launcher', (req, res) => {
  const { mail_due } = db.prepare(`
    SELECT COUNT(*) AS mail_due FROM people pe
    WHERE pe.role IN ('owner','owner_company') AND COALESCE(pe.do_not_contact, 0) = 0
      AND EXISTS (SELECT 1 FROM handwrytten_sends s WHERE s.contact_id = pe.id AND s.status = 'sent')
      AND (SELECT MAX(s.sent_at) FROM handwrytten_sends s WHERE s.contact_id = pe.id AND s.status = 'sent') < datetime('now', '-90 days')
  `).get()

  const { market_new } = db.prepare(`
    SELECT COUNT(*) AS market_new FROM properties
    WHERE COALESCE(is_portfolio, 0) = 0 AND created_at >= datetime('now', '-7 days')
  `).get()

  const { bills_due } = db.prepare(`
    SELECT COUNT(*) AS bills_due FROM property_bills
    WHERE paid_at IS NULL AND due_date <= date('now', '+7 days')
  `).get()

  res.json({ mail_due, market_new, bills_due })
})

// ── Mail engine stats ─────────────────────────────────────────────────────────

router.get('/mail-stats', (req, res) => {
  const target = Number(getSetting('mail_monthly_target', 500))

  const { sent_this_month } = db.prepare(`
    SELECT COUNT(*) AS sent_this_month FROM handwrytten_sends
    WHERE status = 'sent' AND strftime('%Y-%m', sent_at) = strftime('%Y-%m', 'now')
  `).get()

  // Breakdown by who sent it (Brad vs Cole, etc.) this month
  const by_user = db.prepare(`
    SELECT COALESCE(u.name, 'Unassigned') AS name, COUNT(*) AS count
    FROM handwrytten_sends s
    LEFT JOIN users u ON u.id = s.sent_by_user_id
    WHERE s.status = 'sent' AND strftime('%Y-%m', s.sent_at) = strftime('%Y-%m', 'now')
    GROUP BY s.sent_by_user_id
    ORDER BY count DESC
  `).all()

  const { due_followup } = db.prepare(`
    SELECT COUNT(*) AS due_followup FROM people pe
    WHERE pe.role IN ('owner','owner_company') AND COALESCE(pe.do_not_contact, 0) = 0
      AND EXISTS (SELECT 1 FROM handwrytten_sends s WHERE s.contact_id = pe.id AND s.status = 'sent')
      AND (SELECT MAX(s.sent_at) FROM handwrytten_sends s WHERE s.contact_id = pe.id AND s.status = 'sent') < datetime('now', '-90 days')
  `).get()

  const { never_touched } = db.prepare(`
    SELECT COUNT(*) AS never_touched FROM people pe
    WHERE pe.role IN ('owner','owner_company') AND COALESCE(pe.do_not_contact, 0) = 0
      AND NOT EXISTS (SELECT 1 FROM handwrytten_sends s WHERE s.contact_id = pe.id)
  `).get()

  res.json({ target, sent_this_month, due_followup, never_touched, by_user })
})

router.put('/mail-target', (req, res) => {
  const target = Number(req.body.target)
  if (!isFinite(target) || target < 1) return res.status(400).json({ error: 'Invalid target' })
  setSetting('mail_monthly_target', target)
  res.json({ target })
})

// ── Broker leaderboard ────────────────────────────────────────────────────────

router.get('/brokers/leaderboard', (req, res) => {
  const months = Number(req.query.months) || null   // null = all time

  const dateFilter = months
    ? `AND COALESCE(d.close_date, d.updated_at, d.created_at) >= datetime('now', '-${months} months')`
    : ''

  const rows = db.prepare(`
    SELECT pe.id AS broker_id, pe.name AS broker_name,
           COUNT(d.id) AS deals_closed,
           COALESCE(SUM(d.broker_commission), 0) AS total_paid
    FROM deals d
    JOIN people pe ON pe.id = d.broker_id
    WHERE d.stage = 'Closed' AND d.broker_id IS NOT NULL
      ${dateFilter}
    GROUP BY pe.id
    ORDER BY total_paid DESC, deals_closed DESC
    LIMIT 10
  `).all()

  const missing = db.prepare(`
    SELECT d.id, COALESCE(d.address, p.address, d.title, 'Deal') AS label,
           COALESCE(d.purchase_price, d.offer_price) AS price, d.close_date
    FROM deals d LEFT JOIN properties p ON p.id = d.property_id
    WHERE d.stage = 'Closed' AND d.broker_id IS NULL
    ORDER BY d.close_date DESC
    LIMIT 20
  `).all()

  res.json({ leaderboard: rows, missing })
})

// ── PATCH /plays/brokers/deals/:id — assign broker + commission ───────────────

router.patch('/brokers/deals/:id', (req, res) => {
  if (req.user.role === 'junior_agent') return res.status(403).json({ error: 'Not permitted' })
  const { broker_id, broker_commission } = req.body
  if (!broker_id) return res.status(400).json({ error: 'broker_id is required' })

  const broker = db.prepare(`SELECT id FROM people WHERE id = ?`).get(broker_id)
  if (!broker) return res.status(404).json({ error: 'Broker not found' })

  db.prepare(`
    UPDATE deals SET broker_id = ?, broker_commission = ? WHERE id = ?
  `).run(broker_id, broker_commission != null ? Math.abs(parseFloat(broker_commission)) : null, req.params.id)

  res.json(db.prepare('SELECT * FROM deals WHERE id = ?').get(req.params.id))
})

export default router
