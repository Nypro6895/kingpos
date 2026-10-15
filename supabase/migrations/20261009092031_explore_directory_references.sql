-- Old directory URLs and saved keys resolve only current public documents.
BEGIN;
CREATE INDEX IF NOT EXISTS explore_reference_favorites_cursor_idx ON public.explore_reference_favorites(user_id,created_at DESC,item_key DESC);
CREATE FUNCTION public.get_public_explore_directory_references(p_listing_ids text[])
RETURNS TABLE(listing_id text,salon_id uuid,salon_name text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public SET jit=off AS $$
BEGIN
 IF coalesce(cardinality(p_listing_ids),0)>40 OR EXISTS(SELECT 1 FROM unnest(p_listing_ids) id WHERE id IS NULL OR length(id) NOT BETWEEN 1 AND 170) THEN
  RAISE EXCEPTION 'Too many or invalid directory references' USING ERRCODE='22023';
 END IF;
 RETURN QUERY
 SELECT listing.listing_id,d.salon_id,d.salon_name
 FROM (SELECT DISTINCT id FROM unnest(p_listing_ids) id) requested
 JOIN public.salon_directory_listings listing ON listing.listing_id=requested.id
 JOIN public.explore_salon_documents d ON d.salon_id=listing.salon_id
 WHERE d.created_at<=now() AND (d.public_discovery_published_at IS NULL OR d.public_discovery_published_at<=now())
  AND public.salon_profile_public_salon_exists(d.salon_id);
END $$;
REVOKE ALL ON FUNCTION public.get_public_explore_directory_references(text[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_public_explore_directory_references(text[]) TO anon,authenticated,service_role;
COMMIT;
