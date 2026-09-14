DROP FUNCTION IF EXISTS public.consume_facejamas_upload_session(text);
DROP FUNCTION IF EXISTS public.record_facejamas_personalization(text,text,text,text,bigint,text,timestamptz);
DROP FUNCTION IF EXISTS public.consume_facejamas_asset_access(text);
DROP TABLE IF EXISTS limitless.personalization_access_sessions;
DROP TABLE IF EXISTS limitless.personalizations;
DROP TABLE IF EXISTS limitless.personalization_upload_events;
DROP TABLE IF EXISTS limitless.personalization_upload_sessions;
DELETE FROM limitless.metadata WHERE key = 'personalization_schema_version';
