BEGIN;
ALTER FUNCTION public.search_public_explore_salons(text,text,text,double precision,double precision,integer,integer) RENAME TO search_public_explore_salons_ranked;
REVOKE ALL ON FUNCTION public.search_public_explore_salons_ranked(text,text,text,double precision,double precision,integer,integer) FROM PUBLIC,anon,authenticated;
CREATE INDEX explore_document_browse_idx ON public.explore_salon_documents(profile_completeness DESC,updated_at DESC,salon_id);
CREATE OR REPLACE FUNCTION public.search_public_explore_salons(p_query text DEFAULT NULL::text, p_category text DEFAULT NULL::text, p_location text DEFAULT NULL::text, p_latitude double precision DEFAULT NULL::double precision, p_longitude double precision DEFAULT NULL::double precision, p_page integer DEFAULT 1, p_page_size integer DEFAULT 12)
 RETURNS TABLE(salon_id uuid, salon_name text, phone text, address_line1 text, address_line2 text, city text, state text, postal_code text, country text, latitude double precision, longitude double precision, description text, active_service_count bigint, service_categories text[], service_names text[], cover_image_path text, latest_media_created_at timestamp with time zone, featured_service_category text, featured_service_name text, starting_price numeric, profile_completeness integer, has_public_profile boolean, is_new boolean, distance_miles double precision, match_type text, match_tier integer, relevance_score double precision, result_group text, total_count bigint, group_total_count bigint, best_match_count bigint, nearby_count bigint, recommended_count bigint)

 LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,extensions
AS $function$
BEGIN
 IF nullif(btrim(p_query),'') IS NULL AND nullif(btrim(p_category),'') IS NULL AND nullif(btrim(p_location),'') IS NULL AND NOT(coalesce(p_latitude BETWEEN -90 AND 90,false) AND coalesce(p_longitude BETWEEN -180 AND 180,false)) THEN
  RETURN QUERY
  WITH page AS (
   SELECT d.* FROM public.explore_salon_documents d
   ORDER BY d.profile_completeness DESC,d.updated_at DESC,d.salon_id
   LIMIT least(12,greatest(1,coalesce(p_page_size,12)))
   OFFSET (greatest(1,coalesce(p_page,1))::bigint-1)*least(12,greatest(1,coalesce(p_page_size,12)))
  ), totals AS (SELECT count(*) AS total FROM public.explore_salon_documents)
  SELECT p.salon_id,
p.salon_name,
p.phone,
p.address_line1,
p.address_line2,
p.city,
p.state,
p.postal_code,
p.country,
p.latitude,
p.longitude,
p.description,
p.active_service_count,
p.service_categories,
p.service_names,
p.cover_image_path,
p.latest_media_created_at,
p.featured_service_category,
p.featured_service_name,
p.starting_price,
p.profile_completeness,
p.has_public_profile,
(p.created_at >= now()-interval '30 days') AS is_new,
NULL::double precision AS distance_miles,
'recommended'::text AS match_type,
3 AS match_tier,
p.profile_completeness::double precision AS relevance_score,
'recommended'::text AS result_group,
c.total AS total_count,
c.total AS group_total_count,
0::bigint AS best_match_count,
0::bigint AS nearby_count,
c.total AS recommended_count FROM page p CROSS JOIN totals c
  ORDER BY p.profile_completeness DESC,p.updated_at DESC,p.salon_id;
 ELSE
  RETURN QUERY SELECT * FROM public.search_public_explore_salons_ranked(p_query,p_category,p_location,p_latitude,p_longitude,p_page,p_page_size);
 END IF;
END
$function$;
REVOKE ALL ON FUNCTION public.search_public_explore_salons(text,text,text,double precision,double precision,integer,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.search_public_explore_salons(text,text,text,double precision,double precision,integer,integer) TO anon,authenticated,service_role;
COMMIT;
