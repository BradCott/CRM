# Knox CRM — Claude connector & token API

The CRM exposes its **tasks**, **critical dates**, and **deals** to Claude so the
morning routine can read and update them without a browser. Two surfaces, one
shared bearer token:

- **REST** — `/api/tasks` and `/api/critical-dates` accept either the browser
  session cookie **or** `Authorization: Bearer <CLAUDE_API_KEY>`.
- **MCP** — `/mcp` (Streamable HTTP), bearer-token only, for use as a Claude
  custom connector or from Claude Code.

Every write made with the token is tagged `created_by` / `updated_by = claude`,
so it's clear in the UI what Claude changed.

## 1. Set the key (Railway)

The token lives **only** in an environment variable — never in code.

1. Railway → the CRM service → **Variables** → **New Variable**.
2. Name `CLAUDE_API_KEY`, value = a strong random string:
   ```bash
   openssl rand -hex 32
   ```
3. Save (Railway redeploys). Until it's set, `/mcp` returns `503` by design and
   the bearer path is disabled (cookie login still works).

## 2. Add the connector in claude.ai

**Settings → Connectors → Add custom connector**

- **URL:** `https://crm-production-f7d9.up.railway.app/mcp`
- **Auth:** if the dialog shows a **Request headers** section (beta), add header
  `Authorization` = `Bearer <your key>`. Save.
- If there's no Request headers field yet, the same token works from **Claude
  Code** via an MCP config; full OAuth is a possible follow-up.

## 3. Tools

| Tool | Purpose |
|---|---|
| `list_tasks` | List tasks (filters: status, owner_id, due_before, deal_id, property_id, priority, source, include_done) |
| `get_task` / `create_task` / `update_task` / `complete_task` | Task CRUD. `create_task` dedupes on `source_ref` (returns the existing open task) |
| `list_critical_dates` | Deal escrow + portfolio deadlines (filters: status, type, deal_id, property_id, window, include_done) |
| `complete_critical_date` | Complete a critical date by its composite id `entity_type:entity_id:kind:date` (also completes the linked task) |
| `list_deals` / `get_deal` | Active pipeline deals |

## Notes

- The database is on a Railway persistent volume (`crm-volume` at `/app/data`),
  so data survives redeploys.
- Critical dates are derived (not a table); their stable id is the composite key
  `entity_type:entity_id:kind:date`, which is also stored on generated tasks as
  `critical_date_id` for two-way completion sync.
