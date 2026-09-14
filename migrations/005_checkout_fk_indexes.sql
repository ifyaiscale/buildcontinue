CREATE INDEX IF NOT EXISTS orders_brand_id_idx ON limitless.orders(brand_id);
CREATE INDEX IF NOT EXISTS personalization_access_sessions_personalization_id_idx ON limitless.personalization_access_sessions(personalization_id);
CREATE INDEX IF NOT EXISTS facejamas_asset_access_ref_idx ON public.facejamas_asset_access(ref);
