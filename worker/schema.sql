-- D1 migration for Max transaction ingestion
-- Apply:  npx wrangler d1 execute finance-transactions --file=./schema.sql --remote
--
-- Schema reflects the real israeli-bank-scrapers Max transaction shape
-- (validated 2026-06-16), not the theoretical one from the handoff doc.

CREATE TABLE IF NOT EXISTS pending_transactions (
  id                 TEXT PRIMARY KEY,            -- UUID, generated on ingest
  source             TEXT NOT NULL DEFAULT 'max-scraper',
  card_account       TEXT NOT NULL,               -- which Max card (e.g. '2426')

  -- Dedup. `max_identifier` is unreliable on its own (some txns have none,
  -- and the scraper suffixes _N on reused ids), so the real idempotency key
  -- is a composite hash. INSERT OR IGNORE on dedup_key makes re-scrapes safe.
  max_identifier     TEXT,                        -- scraper identifier, when present
  dedup_key          TEXT NOT NULL UNIQUE,        -- card|date|charged_amount|description (normalized)

  -- Amounts: original vs charged (FX handled by Max).
  transaction_date   TEXT NOT NULL,               -- ISO 8601, txn date
  processed_date     TEXT,                         -- ISO 8601, billing/charge date
  original_amount    REAL NOT NULL,
  original_currency  TEXT NOT NULL DEFAULT 'ILS',
  charged_amount     REAL NOT NULL,
  charged_currency   TEXT NOT NULL DEFAULT 'ILS',

  description        TEXT,                          -- merchant, as returned by Max
  memo              TEXT,
  max_category      TEXT,                          -- Max's own category (built-in)
  suggested_category TEXT,                         -- mapped to the app's categories
  confidence        REAL,                          -- 0.0–1.0 for the mapping

  raw_json          TEXT,                          -- full original txn, for debugging
  status            TEXT NOT NULL DEFAULT 'pending', -- pending | approved | rejected | imported
  created_at        TEXT NOT NULL,
  approved_at       TEXT,
  final_category    TEXT                           -- what the user chose in the end
);

CREATE INDEX IF NOT EXISTS idx_pending_status   ON pending_transactions(status);
CREATE INDEX IF NOT EXISTS idx_pending_dedupkey ON pending_transactions(dedup_key);
