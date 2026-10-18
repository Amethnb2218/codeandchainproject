// SENTABAKH LITE — schema SQLite (node:sqlite)
export const SCHEMA_SQL = `
PRAGMA journal_mode=WAL;
PRAGMA foreign_keys=ON;

CREATE TABLE IF NOT EXISTS orders (
  id TEXT PRIMARY KEY,
  status TEXT NOT NULL,
  amount_sats INTEGER NOT NULL,
  amount_fcfa INTEGER,
  description TEXT NOT NULL,
  seller_label TEXT NOT NULL,
  beneficiary_name TEXT NOT NULL,
  beneficiary_phone_hint TEXT,
  type TEXT NOT NULL DEFAULT 'delivery',
  -- FLUX (graphe valide): VENDEUR choisit QR (boutique, 10s, pas de code) ou LIEN WhatsApp (livraison, sequestre + CODE 6ch)
  -- Seul VENDEUR+ADMIN ont un compte; CLIENT et LIVREUR jamais de compte
  flow TEXT NOT NULL DEFAULT 'delivery' CHECK(flow IN ('qr','link','delivery')),
  demo_mode INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS quotes (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  amount_fcfa INTEGER NOT NULL,
  amount_sats INTEGER NOT NULL,
  btc_price_xof TEXT NOT NULL,
  source TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  status TEXT NOT NULL,
  created_at TEXT NOT NULL
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

-- Code de remise hors-ligne : le client confirme la réception → reçoit un code à 6 chiffres à dicter au livreur → le livreur le dicte au vendeur → le vendeur le saisit pour libérer le versement. Aucune app livreur requise.
CREATE TABLE IF NOT EXISTS delivery_codes (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  code_hash TEXT NOT NULL,
  code_hint TEXT NOT NULL,
  code_plain TEXT,
  status TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  verified_at TEXT,
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
CREATE INDEX IF NOT EXISTS idx_delivery_codes_order ON delivery_codes(order_id);
`;
