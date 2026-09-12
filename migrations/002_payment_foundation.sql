BEGIN;
SELECT pg_advisory_xact_lock(1852796517, 1);

CREATE TABLE IF NOT EXISTS limitless.payment_attempts (
  id text PRIMARY KEY,
  brand_id text NOT NULL REFERENCES limitless.brands(id),
  data text NOT NULL,
  sequence bigint GENERATED ALWAYS AS IDENTITY
);
CREATE INDEX IF NOT EXISTS payment_attempts_brand_sequence
  ON limitless.payment_attempts (brand_id, sequence DESC);

CREATE TABLE IF NOT EXISTS limitless.webhook_events (
  id text PRIMARY KEY,
  brand_id text NOT NULL REFERENCES limitless.brands(id),
  data text NOT NULL,
  sequence bigint GENERATED ALWAYS AS IDENTITY
);
CREATE INDEX IF NOT EXISTS webhook_events_brand_sequence
  ON limitless.webhook_events (brand_id, sequence DESC);

ALTER TABLE limitless.payment_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE limitless.webhook_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON limitless.payment_attempts, limitless.webhook_events FROM PUBLIC, anon, authenticated;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA limitless FROM PUBLIC, anon, authenticated;

INSERT INTO limitless.metadata (key, value) VALUES ('schema_version', '2')
ON CONFLICT (key) DO UPDATE SET value = excluded.value;
COMMIT;
