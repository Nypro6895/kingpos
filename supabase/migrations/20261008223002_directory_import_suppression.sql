-- A removed directory listing must survive future imports as a suppression record.
BEGIN;
CREATE TABLE public.salon_directory_suppressions (
 listing_id text PRIMARY KEY,
 identity_key text NOT NULL,
 suppressed_at timestamptz NOT NULL DEFAULT now(),
 reason text NOT NULL CHECK(reason IN ('hidden','removed'))
);
CREATE INDEX salon_directory_suppression_identity_idx ON public.salon_directory_suppressions(identity_key);
ALTER TABLE public.salon_directory_suppressions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.salon_directory_suppressions FROM PUBLIC, anon, authenticated;
GRANT SELECT,INSERT,UPDATE,DELETE ON public.salon_directory_suppressions TO service_role;
CREATE FUNCTION public.directory_import_identity(p_state text,p_city text,p_phone text,p_address text)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path=public AS $$
 SELECT upper(btrim(coalesce(p_state,'')))||'|'||coalesce(public.normalize_search_text(p_city),'')||'|'||regexp_replace(coalesce(p_phone,''),'[^0-9]','','g')||'|'||coalesce(public.normalize_search_text(p_address),'')
$$;
CREATE FUNCTION public.track_directory_import_suppression() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
 IF TG_TABLE_NAME='salon_directory_listings' THEN
  INSERT INTO public.salon_directory_suppressions(listing_id,identity_key,reason)
  SELECT OLD.listing_id,public.directory_import_identity(l.state,l.city,l.phone,l.address_line1),'removed'
  FROM public.locations l WHERE l.id=OLD.salon_id
  ON CONFLICT(listing_id) DO UPDATE SET reason='removed',suppressed_at=now();
 ELSIF TG_TABLE_NAME='locations' THEN
  INSERT INTO public.salon_directory_suppressions(listing_id,identity_key,reason)
  SELECT d.listing_id,public.directory_import_identity(OLD.state,OLD.city,OLD.phone,OLD.address_line1),'removed'
  FROM public.salon_directory_listings d WHERE d.salon_id=OLD.id
  ON CONFLICT(listing_id) DO UPDATE SET reason='removed',suppressed_at=now();
 ELSIF NOT NEW.public_discovery_enabled THEN
  INSERT INTO public.salon_directory_suppressions(listing_id,identity_key,reason)
  SELECT d.listing_id,public.directory_import_identity(l.state,l.city,l.phone,l.address_line1),'hidden'
  FROM public.salon_directory_listings d JOIN public.locations l ON l.id=d.salon_id WHERE d.salon_id=NEW.salon_id
  ON CONFLICT(listing_id) DO UPDATE SET reason='hidden',suppressed_at=now();
 ELSE
  -- Only an explicit re-publication of the existing salon clears a hide request.
  DELETE FROM public.salon_directory_suppressions s USING public.salon_directory_listings d
  WHERE s.listing_id=d.listing_id AND d.salon_id=NEW.salon_id AND s.reason='hidden';
 END IF;
 RETURN CASE WHEN TG_OP='DELETE' THEN OLD ELSE NEW END;
END $$;
CREATE TRIGGER directory_suppression_remove BEFORE DELETE ON public.salon_directory_listings FOR EACH ROW EXECUTE FUNCTION public.track_directory_import_suppression();
CREATE TRIGGER directory_suppression_location_remove BEFORE DELETE ON public.locations FOR EACH ROW EXECUTE FUNCTION public.track_directory_import_suppression();
CREATE TRIGGER directory_suppression_visibility AFTER UPDATE OF public_discovery_enabled ON public.salon_settings FOR EACH ROW WHEN(OLD.public_discovery_enabled IS DISTINCT FROM NEW.public_discovery_enabled) EXECUTE FUNCTION public.track_directory_import_suppression();
INSERT INTO public.salon_directory_suppressions(listing_id,identity_key,reason)
SELECT d.listing_id,public.directory_import_identity(l.state,l.city,l.phone,l.address_line1),'hidden'
FROM public.salon_directory_listings d JOIN public.locations l ON l.id=d.salon_id JOIN public.salon_settings s ON s.salon_id=l.id WHERE NOT s.public_discovery_enabled;
CREATE FUNCTION public.guard_directory_import_suppression() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
 IF EXISTS(SELECT 1 FROM public.salon_directory_suppressions s WHERE s.listing_id=NEW.listing_id OR s.identity_key=(SELECT public.directory_import_identity(l.state,l.city,l.phone,l.address_line1) FROM public.locations l WHERE l.id=NEW.salon_id)) THEN
  RAISE EXCEPTION 'Directory listing is suppressed; explicit restoration is required' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER directory_suppression_guard BEFORE INSERT ON public.salon_directory_listings FOR EACH ROW EXECUTE FUNCTION public.guard_directory_import_suppression();
REVOKE ALL ON FUNCTION public.track_directory_import_suppression(),public.guard_directory_import_suppression() FROM PUBLIC,anon,authenticated;
COMMENT ON TABLE public.salon_directory_suppressions IS 'Minimal import suppression ledger, independent of deleted salons. Never clear during bulk import. Explicit restoration requires a privileged workflow.';
COMMIT;
