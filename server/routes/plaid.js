import { Router } from 'express'
import { createRequire } from 'node:module'
import db from '../db.js'
import { categorizeBatch } from '../utils/categorize.js'
import { matchMortgageSplit, markRowConsumed } from '../utils/amortization.js'
import { investorRosterWithAliases, matchInvestorWire } from '../services/investorMatch.js'

// plaid is CJS — use createRequire so it loads cleanly in an ESM project
const require = createRequire(import.meta.url)
const { Configuration, PlaidApi, PlaidEnvironments, Products, CountryCode } = require('plaid')

const router = Router()

// ── Plaid client factory ──────────────────────────────────────────────────────

function getClient() {
  const clientId = process.env.PLAID_CLIENT_ID
  const secret   = process.env.PLAID_SECRET
  const env      = process.env.PLAID_ENV || 'sandbox'

  if (!clientId || !secret) return null

  const config = new Configuration({
    basePath: PlaidEnvironments[env] ?? PlaidEnvironments.sandbox,
    baseOptions: {
      headers: {
        'PLAID-CLIENT-ID': clientId,
        'PLAID-SECRET':    secret,
      },
    },
  })
  return new PlaidApi(config)
}

function plaidErr(err) {
  return err?.response?.data?.error_message || err?.message || 'Plaid error'
}

// Choose the best description: Plaid's clean merchant_name for card/online
// purchases, but the raw bank text (t.name) for wires/ACH/transfers/loans/fees —
// where the enriched merchant guess is unreliable and the statement wording is
// what you reconcile against.
function bestDescription(t) {
  const channel = t.payment_channel // 'online' | 'in store' | 'other'
  const pfc = (t.personal_finance_category?.primary || '').toUpperCase()
  const transferish =
    channel === 'other' ||
    pfc.startsWith('TRANSFER') || pfc.startsWith('LOAN') ||
    pfc === 'BANK_FEES' || pfc.includes('WIRE')
  if (!transferish && t.merchant_name) return t.merchant_name
  return t.name || t.merchant_name || ''
}

// ── POST /plaid/link-token ────────────────────────────────────────────────────

router.post('/link-token', async (req, res) => {
  const client = getClient()
  if (!client) return res.status(503).json({
    error: 'Plaid is not configured. Add PLAID_CLIENT_ID, PLAID_SECRET, and PLAID_ENV to your environment variables.',
  })

  try {
    const response = await client.linkTokenCreate({
      user:          { client_user_id: String(req.user?.id || 'knox-user') },
      client_name:   'Knox Capital',
      products:      [Products.Transactions],
      country_codes: [CountryCode.Us],
      language:      'en',
      // Request the maximum history Plaid allows (default is only 90 days).
      // Actual amount returned depends on what the institution provides.
      transactions:  { days_requested: 730 },
    })
    res.json({ link_token: response.data.link_token })
  } catch (err) {
    console.error('[plaid] link-token:', plaidErr(err))
    res.status(500).json({ error: plaidErr(err) })
  }
})

// ── GET /plaid/status ─────────────────────────────────────────────────────────
// Reports which environment is active and whether the keys actually work, by
// doing a live link-token create. Turns Plaid's generic "try again later" into
// an actionable message (wrong env / mismatched secret / not configured).
router.get('/status', async (req, res) => {
  const env = process.env.PLAID_ENV || 'sandbox'
  const client = getClient()
  if (!client) {
    return res.json({ configured: false, env, ok: false, error: 'PLAID_CLIENT_ID / PLAID_SECRET are not set on the server.' })
  }
  try {
    await client.linkTokenCreate({
      user:          { client_user_id: String(req.user?.id || 'knox-user') },
      client_name:   'Knox Capital',
      products:      [Products.Transactions],
      country_codes: [CountryCode.Us],
      language:      'en',
    })
    res.json({ configured: true, env, ok: true })
  } catch (err) {
    res.json({ configured: true, env, ok: false, error: plaidErr(err) })
  }
})

// ── POST /plaid/exchange-token ────────────────────────────────────────────────

router.post('/exchange-token', async (req, res) => {
  const client = getClient()
  if (!client) return res.status(503).json({ error: 'Plaid not configured' })

  const { public_token, property_id, account_id, account_name, account_mask, institution_name } = req.body
  if (!public_token || !property_id) return res.status(400).json({ error: 'public_token and property_id required' })

  try {
    const { data } = await client.itemPublicTokenExchange({ public_token })
    const r = db.prepare(`
      INSERT INTO bank_connections
        (property_id, plaid_item_id, plaid_access_token, plaid_account_id, account_name, account_mask, institution_name)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(property_id, data.item_id, data.access_token, account_id || '', account_name || 'Account', account_mask || '', institution_name || '')

    res.status(201).json({
      id: r.lastInsertRowid,
      property_id: Number(property_id),
      account_name: account_name || 'Account',
      account_mask: account_mask || '',
      institution_name: institution_name || '',
      last_synced_at: null,
    })
  } catch (err) {
    console.error('[plaid] exchange-token:', plaidErr(err))
    res.status(500).json({ error: plaidErr(err) })
  }
})

// ── GET /plaid/:propertyId/connections ───────────────────────────────────────

router.get('/:propertyId/connections', (req, res) => {
  const rows = db.prepare(`
    SELECT id, property_id, plaid_account_id, account_name, account_mask, institution_name, last_synced_at, created_at
    FROM bank_connections
    WHERE property_id = ?
    ORDER BY created_at ASC
  `).all(req.params.propertyId)
  res.json(rows)
})

// ── GET /plaid/:propertyId/balance ────────────────────────────────────────────
// Live balance of the property's linked account(s) — used to auto-fill the
// opening cash field. Sums the current balance across all linked accounts.
router.get('/:propertyId/balance', async (req, res) => {
  const client = getClient()
  if (!client) return res.status(503).json({ error: 'Plaid not configured' })

  const conns = db.prepare('SELECT * FROM bank_connections WHERE property_id = ?').all(req.params.propertyId)
  if (!conns.length) return res.status(404).json({ error: 'No bank account linked to this property' })

  try {
    let total = 0
    const accounts = []
    for (const conn of conns) {
      const { data } = await client.accountsBalanceGet({ access_token: conn.plaid_access_token })
      // Restrict to the specific linked account when one was chosen at link time
      const matching = (data.accounts || []).filter(a => !conn.plaid_account_id || a.account_id === conn.plaid_account_id)
      for (const a of matching) {
        const bal = a.balances?.current ?? a.balances?.available ?? 0
        total += Number(bal) || 0
        accounts.push({
          name: a.name || conn.account_name,
          mask: a.mask || conn.account_mask,
          balance: Number(bal) || 0,
        })
      }
    }
    res.json({ total, as_of: new Date().toISOString().slice(0, 10), accounts })
  } catch (err) {
    console.error('[plaid] balance:', plaidErr(err))
    res.status(500).json({ error: plaidErr(err) })
  }
})

// ── POST /plaid/connections/:id/sync ─────────────────────────────────────────

router.post('/connections/:id/sync', async (req, res) => {
  const client = getClient()
  if (!client) return res.status(503).json({ error: 'Plaid not configured' })

  const conn = db.prepare('SELECT * FROM bank_connections WHERE id = ?').get(req.params.id)
  if (!conn) return res.status(404).json({ error: 'Connection not found' })

  try {
    let cursor  = conn.cursor || undefined
    let added   = []
    let hasMore = true

    // Page through all new transactions since last cursor
    while (hasMore) {
      const { data } = await client.transactionsSync({
        access_token: conn.plaid_access_token,
        cursor,
        options: { include_personal_finance_category: true },
      })
      added   = added.concat(data.added)
      cursor  = data.next_cursor
      hasMore = data.has_more
    }

    // Persist new cursor + timestamp
    db.prepare(`UPDATE bank_connections SET cursor = ?, last_synced_at = datetime('now') WHERE id = ?`)
      .run(cursor, conn.id)

    // Filter to just this account and normalize.
    // Plaid sign convention: positive = money leaving account (debit), negative = deposit (credit)
    // Our convention:        positive = money in,  negative = money out  → negate Plaid amounts
    const transactions = added
      .filter(t => !conn.plaid_account_id || t.account_id === conn.plaid_account_id)
      .map(t => ({
        plaid_transaction_id: t.transaction_id,
        date:        t.date,
        description: bestDescription(t),   // clean merchant for purchases, raw bank text for wires/transfers
        amount:      -Number(t.amount),
        plaid_category: t.personal_finance_category?.primary || (t.category?.[0] ?? ''),
      }))

    // Auto-categorize (learned rules → AI → regex) then insert as 'needs_review'.
    // Dedupe by Plaid transaction id so re-syncs never double-import.
    let suggestions = []
    try {
      suggestions = await categorizeBatch(transactions, process.env.ANTHROPIC_API_KEY)
    } catch (e) {
      console.error('[plaid] categorize failed:', e.message)
    }

    const existsStmt = db.prepare(
      `SELECT 1 FROM accounting_transactions WHERE property_id = ? AND external_id = ?`
    )
    const insertStmt = db.prepare(`
      INSERT INTO accounting_transactions
        (property_id, date, description, category, amount, source, review_status, external_id, investor_id)
      VALUES (?, ?, ?, ?, ?, 'Bank Statement', 'needs_review', ?, ?)
    `)
    // Roster for detecting investor wires (deposits from a known investor → equity)
    const roster = investorRosterWithAliases()
    const insertSplit = db.prepare(`
      INSERT INTO accounting_transactions
        (property_id, date, description, category, amount, source, review_status, external_id, split_group)
      VALUES (?, ?, ?, ?, ?, 'Bank Statement', 'needs_review', ?, ?)
    `)

    let inserted = 0, skipped = 0, autoSplit = 0
    transactions.forEach((t, i) => {
      if (existsStmt.get(conn.property_id, t.plaid_transaction_id)) { skipped++; return }

      // Auto-split mortgage payments into principal + interest from the amortization schedule
      const split = matchMortgageSplit(conn.property_id, t)
      if (split) {
        const group = `amort-${t.plaid_transaction_id}`
        split.lines.forEach((line, j) => {
          insertSplit.run(
            conn.property_id, t.date, `${t.description} — ${line.description}`,
            line.category, line.amount, j === 0 ? t.plaid_transaction_id : null, group
          )
        })
        markRowConsumed(split.rowId)
        inserted += split.lines.length
        autoSplit++
        return
      }

      let category = suggestions[i]?.category || 'Other'
      let investorId = null
      // Money-in from a recognized investor → tag as Equity Contribution + attribute
      if (Number(t.amount) > 0) {
        const m = matchInvestorWire(t.description, roster)
        if (m && m.score >= 0.9) { category = 'Equity Contribution'; investorId = m.investor_id }
      }
      insertStmt.run(conn.property_id, t.date, t.description, category, t.amount, t.plaid_transaction_id, investorId)
      inserted++
    })

    const { needs_review } = db.prepare(
      `SELECT COUNT(*) AS needs_review FROM accounting_transactions WHERE property_id = ? AND review_status = 'needs_review'`
    ).get(conn.property_id)

    console.log(`[plaid] sync connection ${conn.id}: ${inserted} new, ${skipped} dupes, ${autoSplit} auto-split, ${needs_review} awaiting review`)
    res.json({ count: inserted, skipped, needs_review, autoSplit })
  } catch (err) {
    console.error('[plaid] sync:', plaidErr(err))
    res.status(500).json({ error: plaidErr(err) })
  }
})

// ── DELETE /plaid/connections/:id ─────────────────────────────────────────────

router.delete('/connections/:id', async (req, res) => {
  const conn = db.prepare('SELECT * FROM bank_connections WHERE id = ?').get(req.params.id)
  if (!conn) return res.status(404).json({ error: 'Not found' })

  // Best-effort: tell Plaid to remove the item (non-fatal if it fails)
  const client = getClient()
  if (client) {
    try { await client.itemRemove({ access_token: conn.plaid_access_token }) }
    catch (e) { console.warn('[plaid] itemRemove failed (non-fatal):', e.message) }
  }

  db.prepare('DELETE FROM bank_connections WHERE id = ?').run(req.params.id)
  res.status(204).end()
})

export default router
