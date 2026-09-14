CREATE TABLE IF NOT EXISTS public.facejamas_upload_receipts (
  ref text PRIMARY KEY CHECK (ref ~ '^pers_[0-9a-f-]{36}$'),
  proof_hash text NOT NULL CHECK (proof_hash ~ '^[0-9a-f]{64}$'),
  content_type text NOT NULL CHECK (content_type IN ('image/jpeg','image/png','image/webp')),
  size_bytes bigint NOT NULL CHECK (size_bytes > 0 AND size_bytes <= 10485760),
  sha256 text NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  attempt_id text,
  order_id text,
  attached_at timestamptz
);
CREATE INDEX IF NOT EXISTS facejamas_upload_receipts_attempt ON public.facejamas_upload_receipts(attempt_id) WHERE attempt_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS facejamas_upload_receipts_order ON public.facejamas_upload_receipts(order_id) WHERE order_id IS NOT NULL;
ALTER TABLE public.facejamas_upload_receipts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.facejamas_upload_receipts FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.facejamas_upload_receipts TO service_role;

CREATE TABLE IF NOT EXISTS public.facejamas_asset_access (
  token_hash text PRIMARY KEY CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  ref text NOT NULL REFERENCES public.facejamas_upload_receipts(ref) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.facejamas_asset_access ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.facejamas_asset_access FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.facejamas_asset_access TO service_role;

CREATE TABLE IF NOT EXISTS public.facejamas_upload_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  client_hash text NOT NULL CHECK (client_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS facejamas_upload_events_client_created ON public.facejamas_upload_events(client_hash, created_at DESC);
ALTER TABLE public.facejamas_upload_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.facejamas_upload_events FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, DELETE ON public.facejamas_upload_events TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.facejamas_upload_events_id_seq TO service_role;
