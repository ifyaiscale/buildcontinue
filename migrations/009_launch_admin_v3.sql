BEGIN;

CREATE OR REPLACE FUNCTION public.limitless_launch_metadata_get(p_key text)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO pg_catalog, public, limitless
AS $$
  SELECT value FROM limitless.metadata WHERE key = p_key LIMIT 1
$$;

CREATE OR REPLACE FUNCTION public.limitless_launch_update_support(p_brand_id text, p_email text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO pg_catalog, public, limitless
AS $$
DECLARE v_data jsonb;
BEGIN
  IF length(trim(coalesce(p_email,''))) < 3
     OR length(trim(p_email)) > 254
     OR trim(p_email) !~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$' THEN
    RAISE EXCEPTION 'invalid_support_email';
  END IF;
  SELECT data::jsonb INTO v_data FROM limitless.brands WHERE id = p_brand_id FOR UPDATE;
  IF v_data IS NULL THEN RAISE EXCEPTION 'brand_not_found'; END IF;
  v_data := jsonb_set(v_data, '{supportEmail}', to_jsonb(lower(trim(p_email))), true);
  UPDATE limitless.brands SET data = v_data::text WHERE id = p_brand_id;
  RETURN v_data;
END;
$$;

CREATE OR REPLACE FUNCTION public.limitless_launch_policy_commit(
  p_brand_id text,
  p_checkout_experience jsonb,
  p_metadata_key text,
  p_record jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO pg_catalog, public, limitless
AS $$
DECLARE v_data jsonb;
BEGIN
  IF p_metadata_key <> 'launch_policy_approval:' || p_record->>'brandId' IS DISTINCT FROM p_brand_id THEN
    RAISE EXCEPTION 'invalid_policy_record';
  END IF;
  SELECT data::jsonb INTO v_data FROM limitless.brands WHERE id = p_brand_id FOR UPDATE;
  IF v_data IS NULL THEN RAISE EXCEPTION 'brand_not_found'; END IF;
  v_data := jsonb_set(v_data, '{checkoutExperience}', p_checkout_experience, true);
  UPDATE limitless.brands SET data = v_data::text WHERE id = p_brand_id;
  INSERT INTO limitless.metadata(key, value)
  VALUES(p_metadata_key || p_brand_id, p_record::text)
  ON CONFLICT(key) DO UPDATE SET value = excluded.value;
  RETURN v_data;
END;
$$;

CREATE OR REPLACE FUNCTION public.limitless_launch_acceptance_commit(p_brand_id text, p_record jsonb)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO pg_catalog, public, limitless
AS $$
BEGIN
  IF p_record->>'brandId' IS DISTINCT FROM p_brand_id THEN
    RAISE EXCEPTION 'invalid_acceptance_record';
  END IF;
  INSERT INTO limitless.metadata(key, value)
  VALUES('launch_acceptance:' || p_brand_id, p_record::text)
  ON CONFLICT(key) DO UPDATE SET value = excluded.value;
END;
$$;

CREATE OR REPLACE FUNCTION public.limitless_launch_activate_brand(p_brand_id text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO pg_catalog, public, limitless
AS $$
DECLARE v_data jsonb;
BEGIN
  SELECT data::jsonb INTO v_data FROM limitless.brands WHERE id = p_brand_id FOR UPDATE;
  IF v_data IS NULL THEN RAISE EXCEPTION 'brand_not_found'; END IF;
  v_data := jsonb_set(jsonb_set(v_data, '{status}', '"live"'::jsonb, true), '{mode}', '"live"'::jsonb, true);
  UPDATE limitless.brands SET data = v_data::text WHERE id = p_brand_id;
  RETURN v_data;
END;
$$;

REVOKE ALL ON FUNCTION public.limitless_launch_metadata_get(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.limitless_launch_update_support(text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.limitless_launch_policy_commit(text, jsonb, text, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.limitless_launch_acceptance_commit(text, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.limitless_launch_activate_brand(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.limitless_launch_metadata_get(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.limitless_launch_update_support(text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.limitless_launch_policy_commit(text, jsonb, text, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.limitless_launch_acceptance_commit(text, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.limitless_launch_activate_brand(text) TO service_role;

COMMIT;
