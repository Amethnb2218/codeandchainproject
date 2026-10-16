// SENTABAKH LITE — schema SQLite (node:sqlite)
export const SCHEMA_SQL = `
PRAGMA journal_mode=WAL;
PRAGMA foreign_keys=ON;

CREATE TABLE IF NOT EXISTS orders (
  id TEXT PRIMARY KEY,
  status TEXT NOT NULL,
  amount_sats INTEGER NOT NULL,
  description TEXT NOT NULL,
  seller_label TEXT NOT NULL,
  beneficiary_name TEXT NOT NULL,
  beneficiary_phone_hint TEXT,
  demo_mode INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS lightning_invoices (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  bitnob_invoice_id TEXT,
  bolt11 TEXT,
  amount_sats INTEGER NOT NULL,
  status TEXT NOT NULL,
  reference TEXT NOT NULL UNIQUE,
  expires_at TEXT,
  paid_at TEXT,
  raw_json TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS trading_quotes (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  quote_id TEXT,
  base_currency TEXT NOT NULL,
  quote_currency TEXT NOT NULL,
  side TEXT NOT NULL,
  quantity TEXT NOT NULL,
  price TEXT,
  expires_at TEXT,
  status TEXT NOT NULL,
  raw_json TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS trading_orders (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  bitnob_order_id TEXT,
  quote_id TEXT,
  status TEXT NOT NULL,
  reference TEXT NOT NULL UNIQUE,
  raw_json TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS payout_quotes (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  bitnob_quote_id TEXT,
  from_asset TEXT NOT NULL,
  to_currency TEXT NOT NULL,
  country TEXT NOT NULL,
  amount_base_units TEXT NOT NULL,
  status TEXT NOT NULL,
  raw_json TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS payouts (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  bitnob_payout_id TEXT,
  quote_id TEXT NOT NULL,
  status TEXT NOT NULL,
  reference TEXT NOT NULL UNIQUE,
  beneficiary_json TEXT NOT NULL,
  raw_json TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS delivery_proofs (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  note TEXT NOT NULL,
  image_url TEXT,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS webhook_events (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  bitnob_event_id TEXT,
  dedup_key TEXT NOT NULL UNIQUE,
  signature_valid INTEGER NOT NULL,
  raw_body TEXT NOT NULL,
  processed_at TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS order_transitions (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  from_status TEXT NOT NULL,
  to_status TEXT NOT NULL,
  actor TEXT NOT NULL,
  reason TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);
CREATE INDEX IF NOT EXISTS idx_invoices_order ON lightning_invoices(order_id);
CREATE INDEX IF NOT EXISTS idx_payouts_order ON payouts(order_id);
CREATE INDEX IF NOT EXISTS idx_proofs_order ON delivery_proofs(order_id);
`;
