BEGIN;
SELECT pg_advisory_xact_lock(1852796517, 1);

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

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'personalization-assets',
  'personalization-assets',
  false,
  10485760,
  ARRAY['image/jpeg','image/png','image/webp']::text[]
)
ON CONFLICT (id) DO UPDATE
SET public = false,
    file_size_limit = EXCLUDED.file_size_limit,
    allowed_mime_types = EXCLUDED.allowed_mime_types;

CREATE OR REPLACE FUNCTION public.consume_facejamas_upload_session(p_token_hash text)
RETURNS TABLE(session_id text, brand_id text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  RETURN QUERY
  UPDATE limitless.personalization_upload_sessions s
     SET consumed_at = now()
   WHERE s.token_hash = p_token_hash
     AND s.consumed_at IS NULL
     AND s.expires_at > now()
     AND EXISTS (
       SELECT 1 FROM limitless.brands b
        WHERE b.id = s.brand_id AND b.slug = 'facejamas'
     )
  RETURNING s.id, s.brand_id;
END;
$$;
REVOKE ALL ON FUNCTION public.consume_facejamas_upload_session(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.consume_facejamas_upload_session(text) TO service_role;

CREATE OR REPLACE FUNCTION public.record_facejamas_personalization(
  p_session_id text,
  p_personalization_id text,
  p_object_path text,
  p_content_type text,
  p_size_bytes bigint,
  p_sha256 text,
  p_expires_at timestamptz
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_brand_id text;
BEGIN
  SELECT s.brand_id INTO v_brand_id
    FROM limitless.personalization_upload_sessions s
    JOIN limitless.brands b ON b.id = s.brand_id
   WHERE s.id = p_session_id
     AND s.consumed_at IS NOT NULL
     AND b.slug = 'facejamas';
  IF v_brand_id IS NULL THEN
    RAISE EXCEPTION 'invalid personalization upload session';
  END IF;

  INSERT INTO limitless.personalizations (
    id, brand_id, upload_session_id, object_path, content_type,
    size_bytes, sha256, status, expires_at
  ) VALUES (
    p_personalization_id, v_brand_id, p_session_id, p_object_path,
    p_content_type, p_size_bytes, p_sha256, 'ready', p_expires_at
  );
  RETURN p_personalization_id;
END;
$$;
REVOKE ALL ON FUNCTION public.record_facejamas_personalization(text,text,text,text,bigint,text,timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_facejamas_personalization(text,text,text,text,bigint,text,timestamptz) TO service_role;

CREATE OR REPLACE FUNCTION public.consume_facejamas_asset_access(p_token_hash text)
RETURNS TABLE(personalization_id text, object_path text, content_type text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  RETURN QUERY
  WITH consumed AS (
    UPDATE limitless.personalization_access_sessions a
       SET consumed_at = now()
     WHERE a.token_hash = p_token_hash
       AND a.consumed_at IS NULL
       AND a.expires_at > now()
    RETURNING a.personalization_id
  )
  SELECT p.id, p.object_path, p.content_type
    FROM consumed c
    JOIN limitless.personalizations p ON p.id = c.personalization_id
    JOIN limitless.brands b ON b.id = p.brand_id
   WHERE b.slug = 'facejamas'
     AND p.status IN ('ready', 'attached');
END;
$$;
REVOKE ALL ON FUNCTION public.consume_facejamas_asset_access(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.consume_facejamas_asset_access(text) TO service_role;

INSERT INTO limitless.metadata (key, value) VALUES ('personalization_schema_version', '1')
ON CONFLICT (key) DO UPDATE SET value = excluded.value;
COMMIT;
