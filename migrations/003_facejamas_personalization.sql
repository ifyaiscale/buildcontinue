CREATE TABLE IF NOT EXISTS limitless.personalization_upload_sessions (
  id text PRIMARY KEY,
  brand_id text NOT NULL REFERENCES limitless.brands(id),
  token_hash text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  sequence bigint GENERATED ALWAYS AS IDENTITY
);
CREATE INDEX IF NOT EXISTS personalization_upload_sessions_brand_sequence
  ON limitless.personalization_upload_sessions (brand_id, sequence DESC);
CREATE INDEX IF NOT EXISTS personalization_upload_sessions_expiry
  ON limitless.personalization_upload_sessions (expires_at)
  WHERE consumed_at IS NULL;

CREATE TABLE IF NOT EXISTS limitless.personalizations (
  id text PRIMARY KEY,
  brand_id text NOT NULL REFERENCES limitless.brands(id),
  upload_session_id text NOT NULL UNIQUE REFERENCES limitless.personalization_upload_sessions(id),
  object_path text NOT NULL UNIQUE,
  content_type text NOT NULL CHECK (content_type IN ('image/jpeg', 'image/png', 'image/webp')),
  size_bytes bigint NOT NULL CHECK (size_bytes > 0 AND size_bytes <= 10485760),
  sha256 text NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  status text NOT NULL DEFAULT 'ready' CHECK (status IN ('ready', 'attached', 'expired', 'deleted')),
  attempt_id text,
  order_id text,
  expires_at timestamptz NOT NULL,
  attached_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  sequence bigint GENERATED ALWAYS AS IDENTITY
);
CREATE INDEX IF NOT EXISTS personalizations_brand_sequence
  ON limitless.personalizations (brand_id, sequence DESC);
CREATE INDEX IF NOT EXISTS personalizations_cleanup
  ON limitless.personalizations (expires_at, status);

CREATE TABLE IF NOT EXISTS limitless.personalization_access_sessions (
  id text PRIMARY KEY,
  personalization_id text NOT NULL REFERENCES limitless.personalizations(id),
  token_hash text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  sequence bigint GENERATED ALWAYS AS IDENTITY
);
CREATE INDEX IF NOT EXISTS personalization_access_sessions_expiry
  ON limitless.personalization_access_sessions (expires_at)
  WHERE consumed_at IS NULL;

ALTER TABLE limitless.personalization_upload_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE limitless.personalizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE limitless.personalization_access_sessions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON limitless.personalization_upload_sessions, limitless.personalizations, limitless.personalization_access_sessions FROM PUBLIC, anon, authenticated;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA limitless FROM PUBLIC, anon, authenticated;

INSERT INTO limitless.metadata (key, value)
VALUES ('personalization_schema_version', '1')
ON CONFLICT (key) DO UPDATE SET value = excluded.value;
