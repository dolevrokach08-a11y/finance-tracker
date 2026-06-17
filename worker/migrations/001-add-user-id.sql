-- Migration 001: add user_id + make dedup per-user.
--
-- WHY a full rebuild and not a plain ALTER: SQLite can ADD COLUMN, but it can't
-- drop the old `dedup_key UNIQUE` constraint or add `UNIQUE(user_id, dedup_key)`
-- in place. So we rebuild the table, backfilling user_id on existing rows.
--
-- BEFORE RUNNING: replace __YOUR_FIREBASE_UID__ below with your real Firebase uid.
--   Get it on the LIVE site (https://dolevrokach08-a11y.github.io/...) console:
--       firebase  → not global; instead run in the finance.html page console:
--       (the page keeps it in `currentUser`) →  copy(currentUser.uid)
--   or from any signed-in page: it's the same uid used in users/{uid} in Firestore.
--
-- Apply:
--   npx wrangler d1 execute finance-transactions --file=./migrations/001-add-user-id.sql --remote
--
-- NOTE: no explicit BEGIN/COMMIT — D1 rejects raw SQL transaction statements
-- (use a single batched file; D1 wraps it in an implicit transaction itself).

ALTER TABLE pending_transactions RENAME TO pending_transactions_old;

CREATE TABLE pending_transactions (
  id                 TEXT PRIMARY KEY,
  user_id            TEXT NOT NULL,
  source             TEXT NOT NULL DEFAULT 'max-scraper',
  card_account       TEXT NOT NULL,
  max_identifier     TEXT,
  dedup_key          TEXT NOT NULL,
  transaction_date   TEXT NOT NULL,
  processed_date     TEXT,
  original_amount    REAL NOT NULL,
  original_currency  TEXT NOT NULL DEFAULT 'ILS',
  charged_amount     REAL NOT NULL,
  charged_currency   TEXT NOT NULL DEFAULT 'ILS',
  description        TEXT,
  memo               TEXT,
  max_category       TEXT,
  suggested_category TEXT,
  confidence         REAL,
  raw_json           TEXT,
  status             TEXT NOT NULL DEFAULT 'pending',
  created_at         TEXT NOT NULL,
  approved_at        TEXT,
  final_category     TEXT,
  UNIQUE(user_id, dedup_key)
);

INSERT INTO pending_transactions
  (id, user_id, source, card_account, max_identifier, dedup_key, transaction_date, processed_date,
   original_amount, original_currency, charged_amount, charged_currency, description, memo,
   max_category, suggested_category, confidence, raw_json, status, created_at, approved_at, final_category)
SELECT
   id, 'FbjwzC2fnmg52CT4cKejy1jRke72', source, card_account, max_identifier, dedup_key, transaction_date, processed_date,
   original_amount, original_currency, charged_amount, charged_currency, description, memo,
   max_category, suggested_category, confidence, raw_json, status, created_at, approved_at, final_category
FROM pending_transactions_old;

DROP TABLE pending_transactions_old;

CREATE INDEX IF NOT EXISTS idx_pending_status   ON pending_transactions(status);
CREATE INDEX IF NOT EXISTS idx_pending_user     ON pending_transactions(user_id, status);
CREATE INDEX IF NOT EXISTS idx_pending_dedupkey ON pending_transactions(dedup_key);
