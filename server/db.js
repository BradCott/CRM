import { DatabaseSync } from 'node:sqlite'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { mkdirSync } from 'node:fs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const DATA_DIR = join(__dirname, '..', 'data')
mkdirSync(DATA_DIR, { recursive: true })

const db = new DatabaseSync(join(DATA_DIR, 'crm.db'))

db.exec(`PRAGMA journal_mode = WAL`)
db.exec(`PRAGMA foreign_keys = ON`)
db.exec(`PRAGMA synchronous = NORMAL`)

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
]
for (const sql of migrations) {
  try { db.exec(sql) } catch (_) { /* column already exists — ignore */ }
}

// Ensure indexes on new columns exist (IF NOT EXISTS handles re-runs)
db.exec(`
  CREATE INDEX IF NOT EXISTS idx_properties_year_built      ON properties(year_built);
  CREATE INDEX IF NOT EXISTS idx_properties_year_purchased  ON properties(year_purchased);
`)

export default db
