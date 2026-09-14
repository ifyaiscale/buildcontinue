ALTER TABLE public.facejamas_upload_receipts
  ADD COLUMN IF NOT EXISTS order_bound_at timestamptz,
  ADD COLUMN IF NOT EXISTS source_deleted_at timestamptz;
CREATE INDEX IF NOT EXISTS facejamas_upload_receipts_retention_idx
  ON public.facejamas_upload_receipts(order_bound_at)
  WHERE order_id IS NOT NULL AND source_deleted_at IS NULL;
