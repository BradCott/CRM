// Correspondence REST API — deal/property timeline, email links, parties, the
// unmatched queue, and get_deal_context. Thin layer over services/correspondence.js.
// Mounted at /api with PER-ROUTE auth (bearerOrSession) so it can share the /api
// prefix with the other routers without intercepting their requests.
import { Router } from 'express'
import { bearerOrSession } from '../middleware/auth.js'
import {
  logActivity, listActivity, linkEmailThread, getThreadLink, listParties, addParty,
  removeParty, addUnmatched, listUnmatched, assignUnmatched, getDealContext,
} from '../services/correspondence.js'

const router = Router()
const auth = bearerOrSession

function actorOf(req) {
  if (req.apiClient) return req.apiClient
  const name = (req.user?.name || '').trim()
  if (name) return name.split(/\s+/)[0].toLowerCase()
  return (req.user?.email || '').split('@')[0].toLowerCase() || 'user'
}

// ── Deal activity timeline ────────────────────────────────────────────────────
router.get('/deal-activity', auth, (req, res) => {
  const { deal_id, property_id, since, type, limit } = req.query
  res.json(listActivity({ deal_id, property_id, since, type, limit }))
})
router.post('/deal-activity', auth, (req, res) => {
  const r = logActivity(req.body || {}, actorOf(req))
  if (r.error) return res.status(400).json({ error: r.error })
  res.status(r.deduped ? 200 : 201).json(r.deduped ? { ...r.entry, deduped: true } : r.entry)
})

// ── Email thread links ────────────────────────────────────────────────────────
router.get('/email-links', auth, (req, res) => {
  const { thread_id } = req.query
  if (!thread_id) return res.status(400).json({ error: 'thread_id is required' })
  res.json(getThreadLink(thread_id))
})
router.post('/email-links', auth, (req, res) => {
  const r = linkEmailThread(req.body || {}, actorOf(req))
  if (r.error) return res.status(400).json({ error: r.error })
  res.status(201).json(r.link)
})

// ── Parties ───────────────────────────────────────────────────────────────────
router.get('/deal-parties', auth, (req, res) => {
  res.json(listParties({ deal_id: req.query.deal_id, property_id: req.query.property_id }))
})
router.post('/deal-parties', auth, (req, res) => {
  const r = addParty(req.body || {})
  if (r.error) return res.status(400).json({ error: r.error })
  res.status(201).json(r.party)
})
router.delete('/deal-parties/:id', auth, (req, res) => {
  const r = removeParty(req.params.id)
  res.status(r.removed ? 204 : 404).end()
})

// ── Unmatched queue ───────────────────────────────────────────────────────────
router.get('/correspondence/unmatched', auth, (req, res) => {
  res.json(listUnmatched(req.query.status || 'pending'))
})
router.post('/correspondence/unmatched', auth, (req, res) => {
  const r = addUnmatched(req.body || {}, actorOf(req))
  res.status(r.deduped ? 200 : 201).json(r.deduped ? { ...r.entry, deduped: true } : r.entry)
})
router.patch('/correspondence/unmatched/:id', auth, (req, res) => {
  const r = assignUnmatched(req.params.id, req.body || {}, actorOf(req))
  if (r.notFound) return res.status(404).json({ error: 'Not found' })
  if (r.error)    return res.status(400).json({ error: r.error })
  res.json(r)
})

// ── Aggregated deal/property context ──────────────────────────────────────────
router.get('/deal-context', auth, (req, res) => {
  const r = getDealContext({ deal_id: req.query.deal_id, property_id: req.query.property_id, name: req.query.name })
  if (r.error) return res.status(404).json({ error: r.error })
  res.json(r)
})

export default router
