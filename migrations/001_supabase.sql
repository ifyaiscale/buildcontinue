BEGIN;
SELECT pg_advisory_xact_lock(1852796517, 1);

CREATE SCHEMA IF NOT EXISTS limitless;
REVOKE ALL ON SCHEMA limitless FROM PUBLIC, anon, authenticated;

CREATE TABLE IF NOT EXISTS limitless.brands (
  id text PRIMARY KEY,
  slug text UNIQUE NOT NULL,
  data text NOT NULL,
  sequence bigint GENERATED ALWAYS AS IDENTITY
);
CREATE TABLE IF NOT EXISTS limitless.orders (
  id text PRIMARY KEY,
  brand_id text NOT NULL REFERENCES limitless.brands(id),
  data text NOT NULL,
  sequence bigint GENERATED ALWAYS AS IDENTITY
);
CREATE TABLE IF NOT EXISTS limitless.activity (
  id text PRIMARY KEY,
  data text NOT NULL,
  sequence bigint GENERATED ALWAYS AS IDENTITY
);
CREATE TABLE IF NOT EXISTS limitless.credentials (
  brand_id text NOT NULL REFERENCES limitless.brands(id),
  provider text NOT NULL CHECK (provider IN ('shopify', 'whop')),
  data text NOT NULL,
  PRIMARY KEY (brand_id, provider)
);
CREATE TABLE IF NOT EXISTS limitless.idempotency (
  key text PRIMARY KEY,
  fingerprint text NOT NULL,
  data text NOT NULL
);
CREATE TABLE IF NOT EXISTS limitless.metadata (
  key text PRIMARY KEY,
  value text NOT NULL
);

ALTER TABLE limitless.brands ENABLE ROW LEVEL SECURITY;
ALTER TABLE limitless.orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE limitless.activity ENABLE ROW LEVEL SECURITY;
ALTER TABLE limitless.credentials ENABLE ROW LEVEL SECURITY;
ALTER TABLE limitless.idempotency ENABLE ROW LEVEL SECURITY;
ALTER TABLE limitless.metadata ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON ALL TABLES IN SCHEMA limitless FROM PUBLIC, anon, authenticated;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA limitless FROM PUBLIC, anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA limitless REVOKE ALL ON TABLES FROM PUBLIC, anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA limitless REVOKE ALL ON SEQUENCES FROM PUBLIC, anon, authenticated;

INSERT INTO limitless.metadata (key, value) VALUES ('schema_version', '1')
ON CONFLICT (key) DO NOTHING;
COMMIT;
