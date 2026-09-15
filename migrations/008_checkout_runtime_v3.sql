CREATE TABLE IF NOT EXISTS public.limitless_checkout_runtime_config (
  id text PRIMARY KEY CHECK (id = 'production'),
  payment_acceptance_enabled boolean NOT NULL DEFAULT false,
  public_payment_enabled boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO public.limitless_checkout_runtime_config (id, payment_acceptance_enabled, public_payment_enabled)
VALUES ('production', false, false)
ON CONFLICT (id) DO NOTHING;
ALTER TABLE public.limitless_checkout_runtime_config ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.limitless_checkout_runtime_config FROM PUBLIC, anon, authenticated;
GRANT SELECT, UPDATE ON public.limitless_checkout_runtime_config TO service_role;

CREATE TABLE IF NOT EXISTS public.limitless_checkout_rate_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  bucket text NOT NULL,
  client_hash text NOT NULL CHECK (client_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS limitless_checkout_rate_events_lookup
  ON public.limitless_checkout_rate_events (bucket, client_hash, created_at DESC);
ALTER TABLE public.limitless_checkout_rate_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.limitless_checkout_rate_events FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, DELETE ON public.limitless_checkout_rate_events TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.limitless_checkout_rate_events_id_seq TO service_role;

CREATE OR REPLACE FUNCTION public.limitless_checkout_brand_by_slug(p_slug text)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, limitless
AS $$
  SELECT b.data::jsonb FROM limitless.brands b WHERE b.slug = p_slug LIMIT 1
$$;

CREATE OR REPLACE FUNCTION public.limitless_checkout_brand_by_id(p_brand_id text)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, limitless
AS $$
  SELECT b.data::jsonb FROM limitless.brands b WHERE b.id = p_brand_id LIMIT 1
$$;

CREATE OR REPLACE FUNCTION public.limitless_checkout_payment_get(p_brand_id text, p_attempt_id text)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, limitless
AS $$
  SELECT p.data::jsonb FROM limitless.payment_attempts p
  WHERE p.brand_id = p_brand_id AND p.id = p_attempt_id LIMIT 1
$$;

CREATE OR REPLACE FUNCTION public.limitless_checkout_payment_get_by_key(p_brand_id text, p_key text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, limitless
AS $$
DECLARE
  v_attempt_id text;
  v_attempt jsonb;
BEGIN
  SELECT i.data::jsonb->>'id' INTO v_attempt_id
  FROM limitless.idempotency i
  WHERE i.key = 'payment:' || p_brand_id || ':' || p_key;
  IF v_attempt_id IS NULL THEN RETURN NULL; END IF;
  SELECT p.data::jsonb INTO v_attempt
  FROM limitless.payment_attempts p
  WHERE p.brand_id = p_brand_id AND p.id = v_attempt_id;
  RETURN v_attempt;
END;
$$;

CREATE OR REPLACE FUNCTION public.limitless_checkout_payment_prepare(
  p_brand_id text,
  p_key text,
  p_fingerprint text,
  p_attempt jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, limitless
AS $$
DECLARE
  v_key text := 'payment:' || p_brand_id || ':' || p_key;
  v_prior_fingerprint text;
  v_prior_data text;
  v_attempt_id text;
  v_existing jsonb;
BEGIN
  IF p_key !~ '^[A-Za-z0-9_-]{8,100}$' OR p_fingerprint !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'invalid_payment_prepare';
  END IF;
  IF p_attempt->>'brandId' IS DISTINCT FROM p_brand_id OR coalesce(p_attempt->>'id','') !~ '^attempt_[0-9a-f-]{36}$' THEN
    RAISE EXCEPTION 'invalid_payment_attempt';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(v_key, 0));
  SELECT i.fingerprint, i.data INTO v_prior_fingerprint, v_prior_data
  FROM limitless.idempotency i WHERE i.key = v_key FOR UPDATE;
  IF FOUND THEN
    IF v_prior_fingerprint IS DISTINCT FROM p_fingerprint THEN RAISE EXCEPTION 'payment_key_conflict'; END IF;
    BEGIN v_attempt_id := (v_prior_data::jsonb->>'id'); EXCEPTION WHEN OTHERS THEN RAISE EXCEPTION 'payment_key_corrupt'; END;
    SELECT p.data::jsonb INTO v_existing FROM limitless.payment_attempts p WHERE p.brand_id = p_brand_id AND p.id = v_attempt_id;
    IF v_existing IS NULL THEN RAISE EXCEPTION 'payment_attempt_missing'; END IF;
    RETURN v_existing;
  END IF;
  INSERT INTO limitless.payment_attempts (id, brand_id, data)
  VALUES (p_attempt->>'id', p_brand_id, p_attempt::text);
  INSERT INTO limitless.idempotency (key, fingerprint, data)
  VALUES (v_key, p_fingerprint, jsonb_build_object('id', p_attempt->>'id')::text);
  RETURN p_attempt;
END;
$$;

CREATE OR REPLACE FUNCTION public.limitless_checkout_payment_begin_draft(p_brand_id text, p_attempt_id text, p_now_ms bigint)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, limitless
AS $$
DECLARE v_attempt jsonb;
BEGIN
  SELECT p.data::jsonb INTO v_attempt FROM limitless.payment_attempts p
  WHERE p.brand_id=p_brand_id AND p.id=p_attempt_id FOR UPDATE;
  IF v_attempt IS NULL THEN RAISE EXCEPTION 'payment_attempt_missing'; END IF;
  IF v_attempt->>'state' <> 'prepared' OR coalesce((v_attempt->>'expiresAt')::bigint,0) <= p_now_ms THEN RAISE EXCEPTION 'draft_begin_conflict'; END IF;
  v_attempt := v_attempt || jsonb_build_object('state','draft_pending');
  UPDATE limitless.payment_attempts SET data=v_attempt::text WHERE brand_id=p_brand_id AND id=p_attempt_id;
  RETURN v_attempt;
END;
$$;

CREATE OR REPLACE FUNCTION public.limitless_checkout_payment_bind_draft(p_brand_id text, p_attempt_id text, p_draft_id text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, limitless
AS $$
DECLARE v_attempt jsonb;
BEGIN
  IF p_draft_id !~ '^gid://shopify/DraftOrder/[1-9][0-9]*$' THEN RAISE EXCEPTION 'invalid_draft_id'; END IF;
  SELECT p.data::jsonb INTO v_attempt FROM limitless.payment_attempts p WHERE p.brand_id=p_brand_id AND p.id=p_attempt_id FOR UPDATE;
  IF v_attempt IS NULL THEN RAISE EXCEPTION 'payment_attempt_missing'; END IF;
  IF v_attempt->>'draftId' = p_draft_id THEN RETURN v_attempt; END IF;
  IF v_attempt->>'state' <> 'draft_pending' OR v_attempt ? 'draftId' THEN RAISE EXCEPTION 'draft_bind_conflict'; END IF;
  v_attempt := v_attempt || jsonb_build_object('draftId',p_draft_id,'state','draft_ready');
  UPDATE limitless.payment_attempts SET data=v_attempt::text WHERE brand_id=p_brand_id AND id=p_attempt_id;
  RETURN v_attempt;
END;
$$;

CREATE OR REPLACE FUNCTION public.limitless_checkout_payment_bind_checkout(
  p_brand_id text,
  p_attempt_id text,
  p_checkout_id text,
  p_purchase_url text,
  p_now_ms bigint
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, limitless
AS $$
DECLARE v_attempt jsonb;
BEGIN
  IF p_checkout_id !~ '^ch_[A-Za-z0-9]+$' OR length(coalesce(p_purchase_url,'')) > 2000 THEN RAISE EXCEPTION 'invalid_checkout_id'; END IF;
  SELECT p.data::jsonb INTO v_attempt FROM limitless.payment_attempts p WHERE p.brand_id=p_brand_id AND p.id=p_attempt_id FOR UPDATE;
  IF v_attempt IS NULL THEN RAISE EXCEPTION 'payment_attempt_missing'; END IF;
  IF v_attempt->>'checkoutId' = p_checkout_id THEN RETURN v_attempt; END IF;
  IF v_attempt->>'state' <> 'draft_ready' OR coalesce((v_attempt->>'expiresAt')::bigint,0) <= p_now_ms THEN RAISE EXCEPTION 'checkout_bind_conflict'; END IF;
  v_attempt := v_attempt || jsonb_build_object('checkoutId',p_checkout_id,'purchaseUrl',p_purchase_url,'state','checkout_ready');
  UPDATE limitless.payment_attempts SET data=v_attempt::text WHERE brand_id=p_brand_id AND id=p_attempt_id;
  RETURN v_attempt;
END;
$$;

CREATE OR REPLACE FUNCTION public.limitless_checkout_payment_accept(
  p_brand_id text,
  p_attempt_id text,
  p_payment_id text,
  p_now_ms bigint
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, limitless
AS $$
DECLARE
  v_attempt jsonb;
  v_claim_key text;
  v_claim_data text;
  v_existing_id text;
BEGIN
  IF p_payment_id !~ '^pay_[A-Za-z0-9]+$' THEN RAISE EXCEPTION 'invalid_payment_id'; END IF;
  SELECT p.data::jsonb INTO v_attempt FROM limitless.payment_attempts p WHERE p.brand_id=p_brand_id AND p.id=p_attempt_id FOR UPDATE;
  IF v_attempt IS NULL THEN RAISE EXCEPTION 'payment_attempt_missing'; END IF;
  v_claim_key := 'whop-payment:' || coalesce(v_attempt->>'whopCompanyId','') || ':' || p_payment_id;
  PERFORM pg_advisory_xact_lock(hashtextextended(v_claim_key,0));
  SELECT i.data INTO v_claim_data FROM limitless.idempotency i WHERE i.key=v_claim_key FOR UPDATE;
  IF FOUND THEN
    BEGIN v_existing_id := v_claim_data::jsonb->>'id'; EXCEPTION WHEN OTHERS THEN RAISE EXCEPTION 'payment_claim_corrupt'; END;
    IF v_existing_id IS DISTINCT FROM p_attempt_id THEN RAISE EXCEPTION 'payment_already_claimed'; END IF;
  END IF;
  IF v_attempt->>'paymentId' = p_payment_id THEN RETURN v_attempt; END IF;
  IF NOT (v_attempt ? 'checkoutId') OR NOT (v_attempt ? 'draftId') THEN RAISE EXCEPTION 'payment_attempt_unbound'; END IF;
  IF v_claim_data IS NULL THEN
    INSERT INTO limitless.idempotency(key,fingerprint,data)
    VALUES(v_claim_key,coalesce(v_attempt->>'fingerprint',''),jsonb_build_object('id',p_attempt_id)::text);
  END IF;
  IF (v_attempt ? 'paymentId') OR v_attempt->>'state' <> 'checkout_ready' OR coalesce((v_attempt->>'expiresAt')::bigint,0) <= p_now_ms THEN
    v_attempt := v_attempt || jsonb_build_object('state','review','paymentId',coalesce(v_attempt->>'paymentId',p_payment_id));
  ELSE
    v_attempt := v_attempt || jsonb_build_object('state','paid','paymentId',p_payment_id);
  END IF;
  UPDATE limitless.payment_attempts SET data=v_attempt::text WHERE brand_id=p_brand_id AND id=p_attempt_id;
  RETURN v_attempt;
END;
$$;

CREATE OR REPLACE FUNCTION public.limitless_checkout_payment_claim_completion(
  p_brand_id text,
  p_attempt_id text,
  p_lease_token text,
  p_now_ms bigint
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, limitless
AS $$
DECLARE v_attempt jsonb; v_lease jsonb;
BEGIN
  IF p_lease_token !~ '^[0-9a-f-]{36}$' THEN RAISE EXCEPTION 'invalid_completion_lease'; END IF;
  SELECT p.data::jsonb INTO v_attempt FROM limitless.payment_attempts p WHERE p.brand_id=p_brand_id AND p.id=p_attempt_id FOR UPDATE;
  IF v_attempt IS NULL THEN RAISE EXCEPTION 'payment_attempt_missing'; END IF;
  IF v_attempt->>'state' <> 'paid' THEN RAISE EXCEPTION 'completion_state_conflict'; END IF;
  v_lease := v_attempt->'completionLease';
  IF v_lease IS NOT NULL AND coalesce((v_lease->>'expiresAt')::bigint,0) > p_now_ms THEN RAISE EXCEPTION 'completion_busy'; END IF;
  v_attempt := v_attempt || jsonb_build_object('completionLease',jsonb_build_object('token',p_lease_token,'expiresAt',p_now_ms+120000));
  UPDATE limitless.payment_attempts SET data=v_attempt::text WHERE brand_id=p_brand_id AND id=p_attempt_id;
  RETURN v_attempt;
END;
$$;

CREATE OR REPLACE FUNCTION public.limitless_checkout_payment_complete(
  p_brand_id text,
  p_attempt_id text,
  p_order_id text,
  p_lease_token text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, limitless
AS $$
DECLARE v_attempt jsonb;
BEGIN
  IF p_order_id !~ '^gid://shopify/Order/[1-9][0-9]*$' THEN RAISE EXCEPTION 'invalid_order_id'; END IF;
  SELECT p.data::jsonb INTO v_attempt FROM limitless.payment_attempts p WHERE p.brand_id=p_brand_id AND p.id=p_attempt_id FOR UPDATE;
  IF v_attempt IS NULL THEN RAISE EXCEPTION 'payment_attempt_missing'; END IF;
  IF v_attempt->>'orderId' = p_order_id THEN RETURN v_attempt; END IF;
  IF v_attempt->>'state' <> 'paid' OR (v_attempt ? 'orderId') THEN RAISE EXCEPTION 'completion_state_conflict'; END IF;
  IF coalesce(v_attempt->'completionLease'->>'token','') IS DISTINCT FROM p_lease_token THEN RAISE EXCEPTION 'completion_lease_changed'; END IF;
  v_attempt := (v_attempt || jsonb_build_object('orderId',p_order_id,'state','completed')) - 'completionLease';
  UPDATE limitless.payment_attempts SET data=v_attempt::text WHERE brand_id=p_brand_id AND id=p_attempt_id;
  RETURN v_attempt;
END;
$$;

CREATE OR REPLACE FUNCTION public.limitless_checkout_record_order(p_brand_id text, p_order_id text, p_order jsonb)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, limitless
AS $$
BEGIN
  IF p_order_id !~ '^gid://shopify/Order/[1-9][0-9]*$' THEN RAISE EXCEPTION 'invalid_order_id'; END IF;
  INSERT INTO limitless.orders(id,brand_id,data) VALUES(p_order_id,p_brand_id,p_order::text)
  ON CONFLICT(id) DO UPDATE SET data=excluded.data WHERE limitless.orders.brand_id=excluded.brand_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.limitless_checkout_claim_personalizations(p_brand_id text, p_refs text[], p_attempt_id text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, limitless
AS $$
DECLARE v_ref text; v_row public.facejamas_upload_receipts%rowtype; v_slug text;
BEGIN
  IF coalesce(array_length(p_refs,1),0)=0 THEN RETURN; END IF;
  SELECT b.slug INTO v_slug FROM limitless.brands b WHERE b.id=p_brand_id;
  IF v_slug IS DISTINCT FROM 'facejamas' THEN RAISE EXCEPTION 'personalization_brand_mismatch'; END IF;
  FOREACH v_ref IN ARRAY p_refs LOOP
    IF v_ref !~ '^pers_[0-9a-f-]{36}$' THEN RAISE EXCEPTION 'invalid_personalization_ref'; END IF;
    SELECT * INTO v_row FROM public.facejamas_upload_receipts WHERE ref=v_ref FOR UPDATE;
    IF NOT FOUND OR v_row.expires_at <= now() OR v_row.order_id IS NOT NULL OR v_row.source_deleted_at IS NOT NULL THEN RAISE EXCEPTION 'personalization_unavailable'; END IF;
    IF v_row.attempt_id IS NOT NULL AND v_row.attempt_id <> p_attempt_id THEN RAISE EXCEPTION 'personalization_already_claimed'; END IF;
    UPDATE public.facejamas_upload_receipts SET attempt_id=p_attempt_id, attached_at=coalesce(attached_at,now()) WHERE ref=v_ref;
  END LOOP;
END;
$$;

CREATE OR REPLACE FUNCTION public.limitless_checkout_finalize_personalizations(p_brand_id text, p_refs text[], p_attempt_id text, p_order_id text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, limitless
AS $$
DECLARE v_ref text; v_row public.facejamas_upload_receipts%rowtype; v_slug text;
BEGIN
  IF coalesce(array_length(p_refs,1),0)=0 THEN RETURN; END IF;
  SELECT b.slug INTO v_slug FROM limitless.brands b WHERE b.id=p_brand_id;
  IF v_slug IS DISTINCT FROM 'facejamas' THEN RAISE EXCEPTION 'personalization_brand_mismatch'; END IF;
  FOREACH v_ref IN ARRAY p_refs LOOP
    SELECT * INTO v_row FROM public.facejamas_upload_receipts WHERE ref=v_ref FOR UPDATE;
    IF NOT FOUND OR v_row.attempt_id IS DISTINCT FROM p_attempt_id OR v_row.source_deleted_at IS NOT NULL THEN RAISE EXCEPTION 'personalization_binding_conflict'; END IF;
    IF v_row.order_id IS NOT NULL AND v_row.order_id <> p_order_id THEN RAISE EXCEPTION 'personalization_order_conflict'; END IF;
    UPDATE public.facejamas_upload_receipts SET order_id=p_order_id, order_bound_at=coalesce(order_bound_at,now()) WHERE ref=v_ref;
  END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION public.limitless_checkout_brand_by_slug(text) FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.limitless_checkout_brand_by_id(text) FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.limitless_checkout_payment_get(text,text) FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.limitless_checkout_payment_get_by_key(text,text) FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.limitless_checkout_payment_prepare(text,text,text,jsonb) FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.limitless_checkout_payment_begin_draft(text,text,bigint) FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.limitless_checkout_payment_bind_draft(text,text,text) FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.limitless_checkout_payment_bind_checkout(text,text,text,text,bigint) FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.limitless_checkout_payment_accept(text,text,text,bigint) FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.limitless_checkout_payment_claim_completion(text,text,text,bigint) FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.limitless_checkout_payment_complete(text,text,text,text) FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.limitless_checkout_record_order(text,text,jsonb) FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.limitless_checkout_claim_personalizations(text,text[],text) FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.limitless_checkout_finalize_personalizations(text,text[],text,text) FROM public, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.limitless_checkout_brand_by_slug(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.limitless_checkout_brand_by_id(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.limitless_checkout_payment_get(text,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.limitless_checkout_payment_get_by_key(text,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.limitless_checkout_payment_prepare(text,text,text,jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.limitless_checkout_payment_begin_draft(text,text,bigint) TO service_role;
GRANT EXECUTE ON FUNCTION public.limitless_checkout_payment_bind_draft(text,text,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.limitless_checkout_payment_bind_checkout(text,text,text,text,bigint) TO service_role;
GRANT EXECUTE ON FUNCTION public.limitless_checkout_payment_accept(text,text,text,bigint) TO service_role;
GRANT EXECUTE ON FUNCTION public.limitless_checkout_payment_claim_completion(text,text,text,bigint) TO service_role;
GRANT EXECUTE ON FUNCTION public.limitless_checkout_payment_complete(text,text,text,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.limitless_checkout_record_order(text,text,jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.limitless_checkout_claim_personalizations(text,text[],text) TO service_role;
GRANT EXECUTE ON FUNCTION public.limitless_checkout_finalize_personalizations(text,text[],text,text) TO service_role;
