import { DatabaseSync } from 'node:sqlite'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { mkdirSync, existsSync, statSync } from 'node:fs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const DATA_DIR = join(__dirname, '..', 'data')
mkdirSync(DATA_DIR, { recursive: true })

const DB_PATH = join(DATA_DIR, 'crm.db')
const dbExists = existsSync(DB_PATH)
console.log(`[db] __dirname   : ${__dirname}`)
console.log(`[db] DATA_DIR    : ${DATA_DIR}`)
console.log(`[db] DB_PATH     : ${DB_PATH}`)
console.log(`[db] file exists : ${dbExists}${dbExists ? ` (${statSync(DB_PATH).size} bytes)` : ''}`)

const db = new DatabaseSync(DB_PATH)

db.exec(`PRAGMA journal_mode = WAL`)
db.exec(`PRAGMA foreign_keys = ON`)
db.exec(`PRAGMA synchronous = NORMAL`)

// node:sqlite's DatabaseSync has no better-sqlite3-style .transaction() helper.
// Polyfill it so `const run = db.transaction(fn); run(args)` works: wraps the
// call in BEGIN/COMMIT, rolling back on error.
if (typeof db.transaction !== 'function') {
  db.transaction = (fn) => (...args) => {
    db.exec('BEGIN')
    try {
      const result = fn(...args)
      db.exec('COMMIT')
      return result
    } catch (err) {
      try { db.exec('ROLLBACK') } catch (_) {}
      throw err
    }
  }
}

db.exec(`
  CREATE TABLE IF NOT EXISTS tenant_brands (
    id    INTEGER PRIMARY KEY AUTOINCREMENT,
    name  TEXT NOT NULL UNIQUE,
    sf_id TEXT UNIQUE
  );

  CREATE TABLE IF NOT EXISTS people (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    -- Identity
    name           TEXT NOT NULL,
    first_name     TEXT,
    last_name      TEXT,
    -- Role classification
    role           TEXT DEFAULT 'owner'
                   CHECK(role IN ('owner','owner_company','broker','tenant_contact')),
    sub_label      TEXT CHECK(sub_label IN ('buyer','seller') OR sub_label IS NULL),
    company_id     INTEGER REFERENCES people(id) ON DELETE SET NULL,
    -- Contact info
    phone          TEXT,
    phone2         TEXT,
    mobile         TEXT,
    email          TEXT,
    email2         TEXT,
    -- Primary address
    address        TEXT,
    city           TEXT,
    state          TEXT,
    zip            TEXT,
    -- Secondary address
    address2       TEXT,
    city2          TEXT,
    state2         TEXT,
    zip2           TEXT,
    -- Flags & meta
    do_not_contact INTEGER DEFAULT 0,
    notes          TEXT,
    sf_id          TEXT UNIQUE
  );

  CREATE INDEX IF NOT EXISTS idx_people_name ON people(name);
  CREATE INDEX IF NOT EXISTS idx_people_role ON people(role);
  CREATE INDEX IF NOT EXISTS idx_people_sf_id ON people(sf_id);
  CREATE INDEX IF NOT EXISTS idx_people_company ON people(company_id);

  CREATE TABLE IF NOT EXISTS properties (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    -- Location
    address           TEXT NOT NULL,
    city              TEXT,
    state             TEXT,
    zip               TEXT,
    -- Links
    tenant_brand_id   INTEGER REFERENCES tenant_brands(id) ON DELETE SET NULL,
    owner_id          INTEGER REFERENCES people(id) ON DELETE SET NULL,
    -- Building
    building_size     REAL,
    land_area         REAL,
    year_built        INTEGER,
    property_type     TEXT,
    construction_type TEXT,
    -- Lease
    lease_type        TEXT,
    lease_start       TEXT,
    lease_end         TEXT,
    annual_rent       REAL,
    rent_bumps        TEXT,
    renewal_options   TEXT,
    -- Financials
    noi               REAL,
    cap_rate          REAL,
    list_price        REAL,
    taxes             REAL,
    insurance         REAL,
    -- Systems
    roof_year         INTEGER,
    hvac_year         INTEGER,
    parking_lot       TEXT,
    -- Acquisition
    year_purchased    INTEGER,
    purchase_price    REAL,
    -- Meta
    notes             TEXT,
    sf_id             TEXT UNIQUE
  );

  CREATE INDEX IF NOT EXISTS idx_properties_address ON properties(address);
  CREATE INDEX IF NOT EXISTS idx_properties_state ON properties(state);
  CREATE INDEX IF NOT EXISTS idx_properties_tenant ON properties(tenant_brand_id);
  CREATE INDEX IF NOT EXISTS idx_properties_owner ON properties(owner_id);
  CREATE INDEX IF NOT EXISTS idx_properties_sf_id ON properties(sf_id);

  CREATE TABLE IF NOT EXISTS saved_searches (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    name       TEXT NOT NULL,
    filters    TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS deals (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    property_id    INTEGER REFERENCES properties(id) ON DELETE SET NULL,
    stage          TEXT NOT NULL DEFAULT 'lead',
    offer_price    REAL,
    close_date     TEXT,
    notes          TEXT
  );

  CREATE TABLE IF NOT EXISTS investors (
    id                      INTEGER PRIMARY KEY AUTOINCREMENT,
    name                    TEXT NOT NULL,
    type                    TEXT DEFAULT 'individual'
                            CHECK(type IN ('individual','company')),
    email                   TEXT,
    phone                   TEXT,
    address                 TEXT,
    city                    TEXT,
    state                   TEXT,
    zip                     TEXT,
    total_investments       REAL,
    preferred_tenant_brands TEXT,
    preferred_states        TEXT,
    min_deal_size           REAL,
    max_deal_size           REAL,
    notes                   TEXT,
    created_at              TEXT DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_investors_name  ON investors(name);
  CREATE INDEX IF NOT EXISTS idx_investors_type  ON investors(type);
  CREATE INDEX IF NOT EXISTS idx_investors_state ON investors(state);

  CREATE TABLE IF NOT EXISTS oauth_tokens (
    provider         TEXT PRIMARY KEY,
    access_token     TEXT,
    refresh_token    TEXT,
    expiry_date      INTEGER,
    email            TEXT,
    last_gmail_sync  TEXT,
    drive_folder_id  TEXT,
    last_drive_check TEXT,
    lois_processed   TEXT DEFAULT '[]',
    created_at       TEXT DEFAULT (datetime('now')),
    updated_at       TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS emails (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    person_id        INTEGER REFERENCES people(id) ON DELETE CASCADE,
    gmail_message_id TEXT UNIQUE,
    thread_id        TEXT,
    direction        TEXT CHECK(direction IN ('inbound','outbound','manual')),
    subject          TEXT,
    body_preview     TEXT,
    from_address     TEXT,
    to_address       TEXT,
    date             TEXT,
    is_manual        INTEGER DEFAULT 0,
    created_at       TEXT DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_emails_person ON emails(person_id);
  CREATE INDEX IF NOT EXISTS idx_emails_date   ON emails(date);
`)

// ── Migrations ────────────────────────────────────────────────────────────────
// Add new columns to existing tables without dropping data.
// Each ALTER TABLE is wrapped in try/catch so re-running is safe
// ("duplicate column name" errors are swallowed).
const migrations = [
  `ALTER TABLE properties ADD COLUMN year_purchased    INTEGER`,
  `ALTER TABLE properties ADD COLUMN purchase_price    REAL`,
  `ALTER TABLE properties ADD COLUMN is_portfolio      INTEGER DEFAULT 0`,
  // Portfolio financial fields
  `ALTER TABLE properties ADD COLUMN estimated_value   REAL`,
  `ALTER TABLE properties ADD COLUMN expense           REAL`,
  `ALTER TABLE properties ADD COLUMN interest_rate     REAL`,
  `ALTER TABLE properties ADD COLUMN maturity_date     TEXT`,
  `ALTER TABLE properties ADD COLUMN total_debt_pmt    REAL`,
  `ALTER TABLE properties ADD COLUMN interest_pmt      REAL`,
  `ALTER TABLE properties ADD COLUMN principal_pmt     REAL`,
  `ALTER TABLE properties ADD COLUMN rtd_ratio         REAL`,
  `ALTER TABLE properties ADD COLUMN outstanding_debt  REAL`,
  `ALTER TABLE properties ADD COLUMN bank              TEXT`,
  `ALTER TABLE properties ADD COLUMN store_number      TEXT`,
  `ALTER TABLE properties ADD COLUMN store_manager     TEXT`,
  `ALTER TABLE properties ADD COLUMN district_manager  TEXT`,
  `ALTER TABLE properties ADD COLUMN qb_account        TEXT`,
  `ALTER TABLE properties ADD COLUMN ins_broker        TEXT`,
  `ALTER TABLE properties ADD COLUMN policy_number     TEXT`,
  `ALTER TABLE properties ADD COLUMN account_number    TEXT`,
  `ALTER TABLE properties ADD COLUMN insurance_exp     TEXT`,
  `ALTER TABLE properties ADD COLUMN fee_pct           REAL DEFAULT 2.0`,
  `ALTER TABLE properties ADD COLUMN listing_status    TEXT`,
  `ALTER TABLE properties ADD COLUMN fee_amount        REAL`,
  `ALTER TABLE properties ADD COLUMN dd_end_date       TEXT`,
  `ALTER TABLE properties ADD COLUMN close_date        TEXT`,
  `ALTER TABLE people ADD COLUMN owner_type TEXT DEFAULT 'Individual'`,
  `ALTER TABLE deals ADD COLUMN title              TEXT`,
  `ALTER TABLE deals ADD COLUMN source             TEXT DEFAULT 'manual'`,
  `ALTER TABLE deals ADD COLUMN purchase_price     REAL`,
  `ALTER TABLE deals ADD COLUMN address            TEXT`,
  `ALTER TABLE deals ADD COLUMN city               TEXT`,
  `ALTER TABLE deals ADD COLUMN state              TEXT`,
  `ALTER TABLE deals ADD COLUMN tenant             TEXT`,
  `ALTER TABLE deals ADD COLUMN cap_rate           REAL`,
  `ALTER TABLE deals ADD COLUMN due_diligence_days INTEGER`,
  `ALTER TABLE deals ADD COLUMN dd_deadline        TEXT`,
  `ALTER TABLE deals ADD COLUMN earnest_money      REAL`,
  `ALTER TABLE deals ADD COLUMN status             TEXT DEFAULT 'active'`,
  // Investor profile enhancements
  `ALTER TABLE investors ADD COLUMN entity_type          TEXT DEFAULT 'Individual'`,
  `ALTER TABLE investors ADD COLUMN tax_id               TEXT`,
  `ALTER TABLE investors ADD COLUMN accreditation_status TEXT DEFAULT 'Accredited'`,
  `ALTER TABLE investors ADD COLUMN is_incomplete        INTEGER DEFAULT 0`,
  // Insurance paid status
  `ALTER TABLE property_insurance ADD COLUMN paid_status TEXT NOT NULL DEFAULT 'unpaid'`,
  `ALTER TABLE property_insurance ADD COLUMN paid_date   TEXT`,
  // Insurance reimbursed status
  `ALTER TABLE property_insurance ADD COLUMN reimbursed_status TEXT NOT NULL DEFAULT 'unreimbursed'`,
  `ALTER TABLE property_insurance ADD COLUMN reimbursed_date   TEXT`,
  // Task priority
  `ALTER TABLE property_tasks ADD COLUMN priority TEXT NOT NULL DEFAULT 'normal'`,
  // Deal timestamps (for activity feed).
  // SQLite rejects expression defaults (datetime('now')) in ALTER TABLE ADD COLUMN,
  // so use no default — existing rows get NULL, new rows need explicit value.
  `ALTER TABLE deals ADD COLUMN created_at TEXT`,
  // Property geocoordinates for portfolio map
  `ALTER TABLE properties ADD COLUMN lat REAL`,
  `ALTER TABLE properties ADD COLUMN lng REAL`,
  // Ownership review flag — set by recent-sales upload
  `ALTER TABLE properties ADD COLUMN needs_ownership_review INTEGER DEFAULT 0`,
  // Operators / franchisees — brand-agnostic (Flynn, Sun Holdings, etc. span many
  // brands). "Corporate" is an explicit operator meaning the brand's own corporate
  // entity, interpreted per-property alongside the tenant brand.
  `CREATE TABLE IF NOT EXISTS operators (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    name         TEXT NOT NULL UNIQUE,
    is_corporate INTEGER DEFAULT 0,
    created_at   TEXT DEFAULT (datetime('now'))
  )`,
  `ALTER TABLE properties ADD COLUMN operator_id INTEGER REFERENCES operators(id) ON DELETE SET NULL`,
  `INSERT OR IGNORE INTO operators (name, is_corporate) VALUES ('Corporate', 1), ('Flynn', 0), ('Sun Holdings', 0)`,
  `CREATE INDEX IF NOT EXISTS idx_prop_operator ON properties(operator_id)`,
  // Cached Google Drive folder for the property (the "Brand - City, State" folder
  // under Knox CRE) so "Find Drive Docs" lists the right folder, not a global search.
  `ALTER TABLE properties ADD COLUMN drive_folder_id   TEXT`,
  `ALTER TABLE properties ADD COLUMN drive_folder_name TEXT`,
  // Persisted settlement-statement snapshot (parsed fields + line items + splits)
  // so the accounting page can show how the acquisition was recorded and re-edit it.
  `CREATE TABLE IF NOT EXISTS property_settlements (
    property_id INTEGER PRIMARY KEY REFERENCES properties(id) ON DELETE CASCADE,
    data        TEXT NOT NULL,
    updated_at  TEXT DEFAULT (datetime('now'))
  )`,
  // Name/address match keys for duplicate detection
  `ALTER TABLE people     ADD COLUMN name_key TEXT`,
  `ALTER TABLE properties ADD COLUMN addr_key TEXT`,
  `CREATE INDEX IF NOT EXISTS idx_people_name_key ON people(name_key)`,
  `CREATE INDEX IF NOT EXISTS idx_prop_addr_key   ON properties(addr_key)`,
  // QuickBooks-style accounting: reconciliation + vendor/payee tracking
  `ALTER TABLE accounting_transactions ADD COLUMN reconciled INTEGER DEFAULT 0`,
  `ALTER TABLE accounting_transactions ADD COLUMN vendor TEXT`,
  // Budget vs Actual — annual budget per property per category
  `CREATE TABLE IF NOT EXISTS property_budgets (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    property_id INTEGER NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
    year        INTEGER NOT NULL,
    category    TEXT NOT NULL,
    amount      REAL NOT NULL DEFAULT 0,
    created_at  TEXT DEFAULT (datetime('now')),
    UNIQUE(property_id, year, category)
  )`,
  `CREATE INDEX IF NOT EXISTS idx_budget_property ON property_budgets(property_id, year)`,
  // Accounts payable — bills with due dates
  `CREATE TABLE IF NOT EXISTS property_bills (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    property_id INTEGER NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
    payee       TEXT NOT NULL,
    description TEXT,
    category    TEXT NOT NULL DEFAULT 'Other',
    amount      REAL NOT NULL,
    due_date    TEXT NOT NULL,
    paid_at     TEXT,
    paid_tx_id  INTEGER,
    created_at  TEXT DEFAULT (datetime('now'))
  )`,
  `CREATE INDEX IF NOT EXISTS idx_bills_property ON property_bills(property_id)`,
  `CREATE INDEX IF NOT EXISTS idx_bills_due      ON property_bills(due_date)`,
  // Today's Plays engine + per-user assignment + broker tracking
  `ALTER TABLE deals ADD COLUMN assigned_to       INTEGER REFERENCES users(id)`,
  `ALTER TABLE deals ADD COLUMN broker_id         INTEGER REFERENCES people(id)`,
  `ALTER TABLE deals ADD COLUMN broker_commission REAL`,
  `ALTER TABLE deals ADD COLUMN updated_at        TEXT`,
  `ALTER TABLE oauth_tokens ADD COLUMN notes_folder_id  TEXT`,
  `ALTER TABLE oauth_tokens ADD COLUMN notes_processed  TEXT`,
  `CREATE TABLE IF NOT EXISTS plays (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id      INTEGER REFERENCES users(id) ON DELETE CASCADE,
    source       TEXT NOT NULL DEFAULT 'system',
    play_type    TEXT,
    title        TEXT NOT NULL,
    detail       TEXT,
    route        TEXT,
    priority     INTEGER DEFAULT 0,
    status       TEXT NOT NULL DEFAULT 'open',
    snooze_until TEXT,
    due_date     TEXT,
    dedupe_key   TEXT,
    created_at   TEXT DEFAULT (datetime('now')),
    done_at      TEXT
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_plays_dedupe ON plays(dedupe_key) WHERE dedupe_key IS NOT NULL`,
  `CREATE INDEX IF NOT EXISTS idx_plays_user_status ON plays(user_id, status)`,
  `CREATE TABLE IF NOT EXISTS app_settings (
    key   TEXT PRIMARY KEY,
    value TEXT
  )`,
  // Drive-imported LOIs were created with an invalid 'lead' stage that maps to
  // no pipeline column — flip them to 'loi' so they actually appear on the board.
  `UPDATE deals SET stage = 'loi' WHERE source = 'drive_loi' AND stage = 'lead'`,
  // Learned categorization rules for bank/Plaid transactions
  `CREATE TABLE IF NOT EXISTS transaction_rules (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    merchant_key TEXT NOT NULL UNIQUE,
    category     TEXT NOT NULL,
    hit_count    INTEGER DEFAULT 1,
    last_used    TEXT DEFAULT (datetime('now')),
    created_at   TEXT DEFAULT (datetime('now'))
  )`,
  // QuickBooks-style review workflow: bank-synced transactions land as
  // 'needs_review' (excluded from the books) until the user records them.
  // Existing rows default to 'recorded' so the books are unchanged.
  `ALTER TABLE accounting_transactions ADD COLUMN review_status TEXT DEFAULT 'recorded'`,
  `ALTER TABLE accounting_transactions ADD COLUMN external_id   TEXT`,
  `CREATE INDEX IF NOT EXISTS idx_tx_review ON accounting_transactions(property_id, review_status)`,
  // Charge-type registry — user-defined categories on top of the built-ins
  `CREATE TABLE IF NOT EXISTS custom_categories (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    name       TEXT NOT NULL UNIQUE,
    kind       TEXT NOT NULL DEFAULT 'expense',
    created_at TEXT DEFAULT (datetime('now'))
  )`,
  // Transaction splits — child lines grouped under a shared id
  `ALTER TABLE accounting_transactions ADD COLUMN split_group TEXT`,
  // Loan amortization schedules — auto-split mortgage payments into principal/interest
  `CREATE TABLE IF NOT EXISTS loan_schedules (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    property_id    INTEGER NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
    name           TEXT,
    original_principal REAL,
    annual_rate    REAL,
    payment_amount REAL,
    first_payment  TEXT,
    term_months    INTEGER,
    created_at     TEXT DEFAULT (datetime('now'))
  )`,
  `CREATE TABLE IF NOT EXISTS loan_schedule_rows (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    schedule_id INTEGER NOT NULL REFERENCES loan_schedules(id) ON DELETE CASCADE,
    period      INTEGER,
    due_date    TEXT,
    payment     REAL,
    principal   REAL,
    interest    REAL,
    balance     REAL,
    consumed    INTEGER DEFAULT 0
  )`,
  `CREATE INDEX IF NOT EXISTS idx_sched_property ON loan_schedules(property_id)`,
  `CREATE INDEX IF NOT EXISTS idx_sched_rows ON loan_schedule_rows(schedule_id, due_date)`,

  // ── "Date added" / "last updated" tracking on people + properties ───────────
  // Columns added without a default (SQLite forbids expression defaults in ALTER
  // ADD COLUMN). Existing rows are backfilled once; new rows + every update are
  // auto-stamped by triggers below, so no insert/update route needs to change.
  `ALTER TABLE people     ADD COLUMN created_at TEXT`,
  `ALTER TABLE people     ADD COLUMN updated_at TEXT`,
  `ALTER TABLE properties ADD COLUMN created_at TEXT`,
  `ALTER TABLE properties ADD COLUMN updated_at TEXT`,
  `UPDATE people     SET created_at = datetime('now'), updated_at = datetime('now') WHERE created_at IS NULL`,
  `UPDATE properties SET created_at = datetime('now'), updated_at = datetime('now') WHERE created_at IS NULL`,
  `CREATE INDEX IF NOT EXISTS idx_people_created     ON people(created_at)`,
  `CREATE INDEX IF NOT EXISTS idx_people_updated     ON people(updated_at)`,
  `CREATE INDEX IF NOT EXISTS idx_properties_created ON properties(created_at)`,
  `CREATE INDEX IF NOT EXISTS idx_properties_updated ON properties(updated_at)`,
  // Stamp created_at/updated_at on insert when not supplied.
  `CREATE TRIGGER IF NOT EXISTS people_stamp_insert AFTER INSERT ON people
     BEGIN
       UPDATE people SET created_at = COALESCE(NEW.created_at, datetime('now')),
                         updated_at = COALESCE(NEW.updated_at, datetime('now'))
       WHERE id = NEW.id;
     END`,
  `CREATE TRIGGER IF NOT EXISTS properties_stamp_insert AFTER INSERT ON properties
     BEGIN
       UPDATE properties SET created_at = COALESCE(NEW.created_at, datetime('now')),
                             updated_at = COALESCE(NEW.updated_at, datetime('now'))
       WHERE id = NEW.id;
     END`,
  // Bump updated_at on every update (recursive_triggers is OFF, so the inner
  // UPDATE here does not re-fire the trigger).
  `CREATE TRIGGER IF NOT EXISTS people_stamp_update AFTER UPDATE ON people
     BEGIN
       UPDATE people SET updated_at = datetime('now') WHERE id = NEW.id;
     END`,
  `CREATE TRIGGER IF NOT EXISTS properties_stamp_update AFTER UPDATE ON properties
     BEGIN
       UPDATE properties SET updated_at = datetime('now') WHERE id = NEW.id;
     END`,

  // Attribute an equity-contribution transaction to an investor (capital accounts)
  `ALTER TABLE accounting_transactions ADD COLUMN investor_id INTEGER REFERENCES investors(id) ON DELETE SET NULL`,
  `CREATE INDEX IF NOT EXISTS idx_acct_investor ON accounting_transactions(investor_id)`,

  // ── Investor contacts (people under a company/trust investor) ───────────────
  `CREATE TABLE IF NOT EXISTS investor_contacts (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    investor_id INTEGER NOT NULL REFERENCES investors(id) ON DELETE CASCADE,
    name        TEXT NOT NULL,
    email       TEXT,
    phone       TEXT,
    title       TEXT,
    created_at  TEXT DEFAULT (datetime('now'))
  )`,
  `CREATE INDEX IF NOT EXISTS idx_investor_contacts ON investor_contacts(investor_id)`,

  // ── Opening balances (Advanced Accounting beta) ─────────────────────────────
  // Per-property starting point so books can begin mid-life without entering full
  // history. Purely additive — only used when the advanced-accounting flag is on.
  `CREATE TABLE IF NOT EXISTS property_opening_balances (
    property_id       INTEGER PRIMARY KEY REFERENCES properties(id) ON DELETE CASCADE,
    as_of_date        TEXT,
    cash              REAL DEFAULT 0,
    real_estate       REAL DEFAULT 0,
    loan_balance      REAL DEFAULT 0,
    invested_capital  REAL DEFAULT 0,
    retained_earnings REAL DEFAULT 0,
    notes             TEXT,
    updated_at        TEXT DEFAULT (datetime('now'))
  )`,

  // ── Tenant RE contacts ──────────────────────────────────────────────────────
  // People with role='tenant_contact' represent a tenant's real-estate team
  // (e.g. Sherwin Williams' RE dept). They link to a tenant_brand and carry
  // job roles + a territory. Multi-value fields are stored as JSON arrays.
  `ALTER TABLE people ADD COLUMN tenant_brand_id   INTEGER REFERENCES tenant_brands(id) ON DELETE SET NULL`,
  `ALTER TABLE people ADD COLUMN title             TEXT`,
  `ALTER TABLE people ADD COLUMN tenant_roles      TEXT`,   // JSON array of role labels
  `ALTER TABLE people ADD COLUMN territory_states  TEXT`,   // JSON array of 2-letter state codes
  `ALTER TABLE people ADD COLUMN territory_regions TEXT`,   // JSON array of region labels
  `CREATE INDEX IF NOT EXISTS idx_people_tenant_brand ON people(tenant_brand_id)`,

  // Extensible list of tenant-contact job roles (Lease Admin, Estoppel, …).
  `CREATE TABLE IF NOT EXISTS tenant_role_types (
    id     INTEGER PRIMARY KEY AUTOINCREMENT,
    label  TEXT UNIQUE NOT NULL,
    sort   INTEGER DEFAULT 0,
    active INTEGER DEFAULT 1
  )`,
  `INSERT OR IGNORE INTO tenant_role_types (label, sort) VALUES
    ('Lease Admin', 1),
    ('Lease Negotiator', 2),
    ('Accounting', 3),
    ('CAM', 4),
    ('Estoppel', 5),
    ('Other', 99)`,

  // Manual link from a property cap-table row to a global investor profile
  // (overrides the automatic name match).
  `ALTER TABLE property_investors ADD COLUMN investor_id INTEGER REFERENCES investors(id) ON DELETE SET NULL`,

  // QuickBooks-style "match": a bank transaction reconciled against something
  // already in the books (e.g. the settlement statement) — review_status='matched',
  // excluded from financials (which filter review_status='recorded').
  `ALTER TABLE accounting_transactions ADD COLUMN matched_note TEXT`,
  `ALTER TABLE accounting_transactions ADD COLUMN matched_to_id INTEGER`,

  // Mail campaign response tracking + timed mailing suppression
  `ALTER TABLE handwrytten_sends ADD COLUMN responded_at     TEXT`,
  `ALTER TABLE handwrytten_sends ADD COLUMN response_channel TEXT`,   // 'email' | 'manual'
  `ALTER TABLE people ADD COLUMN mail_pause_until  TEXT`,             // YYYY-MM-DD; '2999-12-31' = forever
  `ALTER TABLE people ADD COLUMN mail_pause_reason TEXT`,
  `CREATE INDEX IF NOT EXISTS idx_hw_sends_responded ON handwrytten_sends(responded_at)`,
  // Link a campaign row back to the drip that produced it, so each drip batch can
  // appear in the campaigns table like a one-shot bulk send.
  `ALTER TABLE handwrytten_campaigns ADD COLUMN drip_id INTEGER`,
  `CREATE INDEX IF NOT EXISTS idx_hw_campaigns_drip ON handwrytten_campaigns(drip_id)`,
  // "Ready to re-mail" queue — set when the update-only importer corrects an
  // address, cleared once a mail campaign goes out to that property.
  `ALTER TABLE properties ADD COLUMN remail_ready INTEGER DEFAULT 0`,
  `CREATE INDEX IF NOT EXISTS idx_prop_remail ON properties(remail_ready)`,
  // AI lease abstract — one current lease per property. `abstract` is the JSON
  // (summary + tenant/landlord responsibility matrix); the source PDF lives on
  // the data volume at file_path.
  `CREATE TABLE IF NOT EXISTS property_leases (
    property_id INTEGER PRIMARY KEY REFERENCES properties(id) ON DELETE CASCADE,
    file_name   TEXT,
    file_path   TEXT,
    abstract    TEXT,
    model       TEXT,
    created_at  TEXT DEFAULT (datetime('now')),
    updated_at  TEXT
  )`,
  // Async abstraction: upload returns immediately as 'processing' and the AI runs
  // in the background, so a long call on a big PDF never times out the request.
  `ALTER TABLE property_leases ADD COLUMN status TEXT DEFAULT 'done'`,
  `ALTER TABLE property_leases ADD COLUMN error  TEXT`,
  // Property management dashboard fields.
  `ALTER TABLE properties ADD COLUMN store_phone          TEXT`,
  `ALTER TABLE properties ADD COLUMN estimated_sales      REAL`,
  `ALTER TABLE properties ADD COLUMN estimated_sales_date TEXT`,
  `ALTER TABLE properties ADD COLUMN photo_path           TEXT`,
  // Tenant reimbursement tracking on taxes (insurance already has it).
  `ALTER TABLE property_taxes ADD COLUMN reimbursed_status TEXT NOT NULL DEFAULT 'unreimbursed'`,
  `ALTER TABLE property_taxes ADD COLUMN reimbursed_date   TEXT`,
  // Individual lease documents (base lease + amendments/exhibits). The combined
  // abstract in property_leases is regenerated across all of a property's docs.
  `CREATE TABLE IF NOT EXISTS lease_documents (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    property_id INTEGER NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
    file_name   TEXT,
    file_path   TEXT,
    doc_type    TEXT DEFAULT 'Lease',
    uploaded_at TEXT DEFAULT (datetime('now'))
  )`,
  `CREATE INDEX IF NOT EXISTS idx_lease_docs ON lease_documents(property_id)`,
  // Investor portal accounts — a SEPARATE auth system from CRM users. Each row
  // is hard-linked to one investor and can only ever see that investor's data.
  `CREATE TABLE IF NOT EXISTS investor_users (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    investor_id    INTEGER NOT NULL REFERENCES investors(id) ON DELETE CASCADE,
    email          TEXT NOT NULL UNIQUE,
    name           TEXT,
    google_sub     TEXT,
    password_hash  TEXT,
    status         TEXT NOT NULL DEFAULT 'invited',
    invite_token   TEXT,
    invite_expires TEXT,
    created_at     TEXT DEFAULT (datetime('now')),
    last_login_at  TEXT
  )`,
  `CREATE INDEX IF NOT EXISTS idx_investor_users_email ON investor_users(email)`,
  `CREATE INDEX IF NOT EXISTS idx_investor_users_token ON investor_users(invite_token)`,
]

// ── Auth — users and invitations ─────────────────────────────────────────────
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    email         TEXT UNIQUE NOT NULL,
    name          TEXT,
    role          TEXT NOT NULL DEFAULT 'junior_agent'
                  CHECK(role IN ('admin','full_agent','junior_agent')),
    auth_provider TEXT NOT NULL DEFAULT 'local'
                  CHECK(auth_provider IN ('local','google')),
    google_id     TEXT UNIQUE,
    password_hash TEXT,
    status        TEXT NOT NULL DEFAULT 'active'
                  CHECK(status IN ('active','inactive')),
    created_at    TEXT DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_users_email     ON users(email);
  CREATE INDEX IF NOT EXISTS idx_users_google_id ON users(google_id);

  CREATE TABLE IF NOT EXISTS invitations (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    email       TEXT NOT NULL,
    role        TEXT NOT NULL DEFAULT 'junior_agent',
    token       TEXT UNIQUE NOT NULL,
    invited_by  INTEGER REFERENCES users(id),
    created_at  TEXT DEFAULT (datetime('now')),
    accepted_at TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_invitations_token ON invitations(token);
`)

// ── Accounting ────────────────────────────────────────────────────────────────
db.exec(`
  CREATE TABLE IF NOT EXISTS accounting_transactions (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    property_id INTEGER NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
    date        TEXT NOT NULL,
    description TEXT NOT NULL,
    category    TEXT NOT NULL,
    amount      REAL NOT NULL,
    source      TEXT NOT NULL DEFAULT 'Manual',
    created_at  TEXT DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_acct_property ON accounting_transactions(property_id);
  CREATE INDEX IF NOT EXISTS idx_acct_date     ON accounting_transactions(date);

  CREATE TABLE IF NOT EXISTS property_investors (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    property_id      INTEGER NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
    name             TEXT NOT NULL,
    address          TEXT,
    contribution     REAL NOT NULL,
    percentage       REAL,
    class            TEXT,
    preferred_return REAL,
    created_at       TEXT DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_prop_investors_property ON property_investors(property_id);

  CREATE TABLE IF NOT EXISTS property_journal_entries (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    property_id INTEGER NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
    entry_type  TEXT NOT NULL DEFAULT 'acquisition',
    entry_date  TEXT,
    label       TEXT,
    content     TEXT NOT NULL,
    created_at  TEXT DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_journal_property ON property_journal_entries(property_id);

  CREATE TABLE IF NOT EXISTS investor_property_links (
    id                    INTEGER PRIMARY KEY AUTOINCREMENT,
    investor_id           INTEGER NOT NULL REFERENCES investors(id) ON DELETE CASCADE,
    property_id           INTEGER NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
    contribution          REAL NOT NULL DEFAULT 0,
    ownership_percentage  REAL,
    preferred_return_rate REAL,
    created_at            TEXT DEFAULT (datetime('now')),
    UNIQUE(investor_id, property_id)
  );
  CREATE INDEX IF NOT EXISTS idx_ipl_investor ON investor_property_links(investor_id);
  CREATE INDEX IF NOT EXISTS idx_ipl_property ON investor_property_links(property_id);

  CREATE TABLE IF NOT EXISTS investor_distributions (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    investor_id       INTEGER NOT NULL REFERENCES investors(id) ON DELETE CASCADE,
    property_id       INTEGER REFERENCES properties(id) ON DELETE SET NULL,
    amount            REAL NOT NULL,
    distribution_date TEXT NOT NULL,
    distribution_type TEXT NOT NULL DEFAULT 'Preferred Return'
                      CHECK(distribution_type IN ('Preferred Return','Principal','Profit')),
    notes             TEXT,
    created_at        TEXT DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_dist_investor ON investor_distributions(investor_id);
  CREATE INDEX IF NOT EXISTS idx_dist_property ON investor_distributions(property_id);
  CREATE INDEX IF NOT EXISTS idx_dist_date     ON investor_distributions(distribution_date);

  CREATE TABLE IF NOT EXISTS bank_connections (
    id                 INTEGER PRIMARY KEY AUTOINCREMENT,
    property_id        INTEGER NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
    plaid_item_id      TEXT NOT NULL,
    plaid_access_token TEXT NOT NULL,
    plaid_account_id   TEXT NOT NULL DEFAULT '',
    account_name       TEXT,
    account_mask       TEXT,
    institution_name   TEXT,
    cursor             TEXT,
    last_synced_at     TEXT,
    created_at         TEXT DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_bank_conn_property ON bank_connections(property_id);
`)
for (const sql of migrations) {
  try { db.exec(sql) } catch (_) { /* column already exists — ignore */ }
}

// ── Property Management ───────────────────────────────────────────────────────
db.exec(`
  CREATE TABLE IF NOT EXISTS property_tasks (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    property_id INTEGER NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
    title       TEXT NOT NULL,
    task_type   TEXT NOT NULL DEFAULT 'other'
                CHECK(task_type IN ('inspection','insurance','tax','lease','maintenance','other')),
    due_date    TEXT,
    completed_at TEXT,
    recurs      TEXT DEFAULT 'none'
                CHECK(recurs IN ('none','monthly','quarterly','annually')),
    notes       TEXT,
    created_at  TEXT DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_tasks_property ON property_tasks(property_id);
  CREATE INDEX IF NOT EXISTS idx_tasks_due      ON property_tasks(due_date);

  CREATE TABLE IF NOT EXISTS property_insurance (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    property_id      INTEGER NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
    carrier          TEXT,
    policy_number    TEXT,
    premium          REAL,
    coverage_amount  REAL,
    deductible       REAL,
    effective_date   TEXT,
    expiry_date      TEXT,
    auto_renewal     INTEGER DEFAULT 0,
    agent_name       TEXT,
    agent_phone      TEXT,
    agent_email      TEXT,
    notes            TEXT,
    created_at       TEXT DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_insurance_property ON property_insurance(property_id);
  CREATE INDEX IF NOT EXISTS idx_insurance_expiry   ON property_insurance(expiry_date);

  CREATE TABLE IF NOT EXISTS property_taxes (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    property_id       INTEGER NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
    tax_year          INTEGER,
    due_date          TEXT,
    amount            REAL,
    paid_date         TEXT,
    paid_amount       REAL,
    parcel_number     TEXT,
    taxing_authority  TEXT,
    notes             TEXT,
    created_at        TEXT DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_taxes_property ON property_taxes(property_id);
  CREATE INDEX IF NOT EXISTS idx_taxes_due      ON property_taxes(due_date);

  CREATE TABLE IF NOT EXISTS property_maintenance (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    property_id    INTEGER NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
    date           TEXT NOT NULL,
    vendor         TEXT,
    description    TEXT NOT NULL,
    category       TEXT DEFAULT 'Other'
                   CHECK(category IN ('HVAC','Roof','Plumbing','Electrical','Landscaping','Parking Lot','General','Other')),
    cost           REAL,
    invoice_number TEXT,
    notes          TEXT,
    created_at     TEXT DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_maint_property ON property_maintenance(property_id);
  CREATE INDEX IF NOT EXISTS idx_maint_date     ON property_maintenance(date);

  CREATE TABLE IF NOT EXISTS property_contacts (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    property_id INTEGER NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
    name        TEXT NOT NULL,
    role        TEXT DEFAULT 'Other'
                CHECK(role IN ('Property Manager','Contractor','Electrician','Plumber','HVAC','Landscaper','Insurance Agent','Attorney','Accountant','Other')),
    company     TEXT,
    phone       TEXT,
    email       TEXT,
    notes       TEXT,
    created_at  TEXT DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_contacts_property ON property_contacts(property_id);
`)

// ── One-time: seed default management tasks for existing portfolio properties ─
// Runs every startup but only inserts for properties that still have 0 tasks,
// so it is safe to re-run after all tasks have been created.
try {
  const uninitialised = db.prepare(`
    SELECT p.id FROM properties p
    LEFT JOIN property_tasks pt ON pt.property_id = p.id
    WHERE p.is_portfolio = 1
    GROUP BY p.id
    HAVING COUNT(pt.id) = 0
  `).all()

  if (uninitialised.length > 0) {
    const _today = new Date()
    const _addDays = (n) => {
      const d = new Date(_today)
      d.setDate(d.getDate() + n)
      return d.toISOString().slice(0, 10)
    }
    const _year  = _today.getFullYear()
    const _dec31 = `${_year}-12-31`

    const _stmt = db.prepare(
      `INSERT INTO property_tasks (property_id, title, task_type, due_date, recurs, notes) VALUES (?,?,?,?,?,?)`
    )
    for (const { id } of uninitialised) {
      _stmt.run(id, 'Set up entity as new owner in tenant system', 'other',      _addDays(7),   'none',      null)
      _stmt.run(id, 'Upload insurance policy',                     'insurance',  _addDays(7),   'none',      null)
      _stmt.run(id, 'Set up tax account',                          'tax',        _addDays(7),   'none',      null)
      _stmt.run(id, 'Quarterly manager check-in',                  'other',      _addDays(90),  'quarterly', null)
      _stmt.run(id, 'COI from tenant',                             'other',      _addDays(365), 'annually',  null)
      _stmt.run(id, 'Rent escalation review',                      'lease',      _addDays(365), 'annually',  null)
      _stmt.run(id, 'Year-end CAM reconciliation',                 'other',      _dec31,        'annually',  null)
    }
    console.log(`[db] Seeded default tasks for ${uninitialised.length} existing portfolio properties`)
  }
} catch (e) {
  console.warn('[db] default task migration skipped:', e.message)
}

// ── One-time: auto-link existing pipeline deals to market properties by address ─
// Runs every startup but only touches deals that are still unlinked, so it is safe.
try {
  const unlinked = db.prepare(`
    SELECT id, address FROM deals
    WHERE property_id IS NULL
      AND address IS NOT NULL AND TRIM(address) != ''
      AND (status IS NULL OR status = 'active')
  `).all()

  if (unlinked.length > 0) {
    const findStmt = db.prepare(
      `SELECT id FROM properties WHERE LOWER(TRIM(address)) = LOWER(TRIM(?))`
    )
    const linkStmt = db.prepare(`UPDATE deals SET property_id = ? WHERE id = ?`)
    let matched = 0
    for (const deal of unlinked) {
      const prop = findStmt.get(deal.address)
      if (prop) {
        linkStmt.run(prop.id, deal.id)
        matched++
      }
    }
    console.log(`[db] Auto-link scan: ${unlinked.length} unlinked deal(s) checked, ${matched} matched to market properties`)
  }
} catch (e) {
  console.warn('[db] Auto-link scan failed:', e.message)
}

// ── Handwrytten ───────────────────────────────────────────────────────────────
db.exec(`
  CREATE TABLE IF NOT EXISTS handwrytten_campaigns (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    message_template TEXT NOT NULL,
    card_id          TEXT,
    font             TEXT,
    filters          TEXT,
    sent_by_user_id  INTEGER REFERENCES users(id) ON DELETE SET NULL,
    sent_at          TEXT DEFAULT (datetime('now')),
    total_count      INTEGER DEFAULT 0,
    sent_count       INTEGER DEFAULT 0,
    failed_count     INTEGER DEFAULT 0,
    status           TEXT NOT NULL DEFAULT 'sending'
                     CHECK(status IN ('sending','complete','partial','failed'))
  );
  CREATE INDEX IF NOT EXISTS idx_hw_campaigns_sent_at ON handwrytten_campaigns(sent_at);

  CREATE TABLE IF NOT EXISTS handwrytten_sends (
    id                   INTEGER PRIMARY KEY AUTOINCREMENT,
    contact_id           INTEGER REFERENCES people(id) ON DELETE SET NULL,
    property_id          INTEGER REFERENCES properties(id) ON DELETE SET NULL,
    campaign_id          INTEGER REFERENCES handwrytten_campaigns(id) ON DELETE SET NULL,
    message              TEXT NOT NULL,
    card_id              TEXT,
    font                 TEXT,
    sent_by_user_id      INTEGER REFERENCES users(id) ON DELETE SET NULL,
    sent_at              TEXT DEFAULT (datetime('now')),
    handwrytten_order_id TEXT,
    status               TEXT NOT NULL DEFAULT 'pending'
                         CHECK(status IN ('pending','sent','failed')),
    error_message        TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_hw_sends_contact  ON handwrytten_sends(contact_id);
  CREATE INDEX IF NOT EXISTS idx_hw_sends_campaign ON handwrytten_sends(campaign_id);
  CREATE INDEX IF NOT EXISTS idx_hw_sends_sent_at  ON handwrytten_sends(sent_at);

  -- Drip campaigns: throttled mail sends ("X letters every N days until done")
  CREATE TABLE IF NOT EXISTS handwrytten_drips (
    id                 INTEGER PRIMARY KEY AUTOINCREMENT,
    name               TEXT,
    message_template   TEXT NOT NULL,
    card_id            TEXT,
    font               TEXT,
    filters            TEXT,                       -- JSON snapshot of the audience filter (display only)
    batch_size         INTEGER NOT NULL DEFAULT 50,
    interval_days      INTEGER NOT NULL DEFAULT 1,
    send_hour          INTEGER NOT NULL DEFAULT 9, -- hour of day (UTC) batches fire
    status             TEXT NOT NULL DEFAULT 'active'
                       CHECK(status IN ('active','paused','complete','cancelled')),
    total_count        INTEGER DEFAULT 0,
    sent_count         INTEGER DEFAULT 0,
    failed_count       INTEGER DEFAULT 0,
    next_run_at        TEXT,                        -- ISO datetime the next batch is due
    last_run_at        TEXT,
    created_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    created_at         TEXT DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_hw_drips_status ON handwrytten_drips(status);

  -- Per-recipient queue for a drip. Rows are consumed in batches by the engine.
  CREATE TABLE IF NOT EXISTS handwrytten_drip_queue (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    drip_id       INTEGER NOT NULL REFERENCES handwrytten_drips(id) ON DELETE CASCADE,
    contact_id    INTEGER REFERENCES people(id)     ON DELETE CASCADE,
    property_id   INTEGER REFERENCES properties(id) ON DELETE SET NULL,
    position      INTEGER,
    status        TEXT NOT NULL DEFAULT 'queued'
                  CHECK(status IN ('queued','sent','failed','skipped')),
    send_id       INTEGER REFERENCES handwrytten_sends(id) ON DELETE SET NULL,
    error_message TEXT,
    processed_at  TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_hw_dq_drip   ON handwrytten_drip_queue(drip_id, status);
  CREATE INDEX IF NOT EXISTS idx_hw_dq_status ON handwrytten_drip_queue(status);
`)

// Auto-tag existing owners whose name suggests LLC/entity type
db.exec(`
  UPDATE people SET owner_type = 'LLC'
  WHERE (owner_type IS NULL OR owner_type = 'Individual')
    AND (
      name LIKE '%LLC%'   OR name LIKE '%LP%'    OR name LIKE '%L.P.%'  OR
      name LIKE '%Trust%' OR name LIKE '%Holdings%' OR
      name LIKE '%Partners%' OR name LIKE '%Group%'
    )
`)

// Ensure indexes on new columns exist (IF NOT EXISTS handles re-runs)
db.exec(`
  CREATE INDEX IF NOT EXISTS idx_properties_year_built      ON properties(year_built);
  CREATE INDEX IF NOT EXISTS idx_properties_year_purchased  ON properties(year_purchased);
`)

export { DB_PATH, DATA_DIR }
export default db
