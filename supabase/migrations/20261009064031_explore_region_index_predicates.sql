-- Keep positive region predicates indexable. NULL handling belongs only to
-- exclusions, so unmapped salons can remain eligible in a wider scope.
BEGIN;
SET LOCAL search_path=public,extensions;
CREATE OR REPLACE FUNCTION public.explore_search_region_predicate(p_region jsonb) RETURNS text
LANGUAGE plpgsql IMMUTABLE SET search_path=public,extensions AS $$
DECLARE predicate text:='true'; center text; lat double precision; lon double precision; radius double precision;
BEGIN
 CASE p_region->>'kind'
 WHEN 'state' THEN predicate:=format('d.state_code=%L',p_region->>'state');
 WHEN 'city' THEN
  predicate:=format('d.city_search=%L',p_region->>'city');
  IF nullif(p_region->>'state','') IS NOT NULL THEN predicate:=predicate||format(' AND d.state_code=%L',p_region->>'state'); END IF;
 WHEN 'postal' THEN predicate:=format('left(coalesce(d.postal_code,'''') ,5)=%L',p_region->>'postal');
 WHEN 'geo' THEN
  lat:=(p_region->>'latitude')::double precision; lon:=(p_region->>'longitude')::double precision; radius:=(p_region->>'radius')::double precision;
  center:=format('extensions.ll_to_earth(%L::float8,%L::float8)',lat,lon);
  predicate:=format('d.latitude BETWEEN -90 AND 90 AND d.longitude BETWEEN -180 AND 180 AND extensions.earth_box(%s,%L::float8) OPERATOR(extensions.@>) extensions.ll_to_earth(d.latitude,d.longitude) AND extensions.earth_distance(%s,extensions.ll_to_earth(d.latitude,d.longitude))<=%L::float8',center,radius,center,radius);
 WHEN 'other' THEN predicate:=format('(d.state_code IS NULL OR NOT(d.state_code=ANY(%L::text[])))',public.explore_search_state_codes());
 WHEN 'union' THEN predicate:='('||public.explore_search_region_predicate(p_region->'left')||') OR ('||public.explore_search_region_predicate(p_region->'right')||')';
 ELSE predicate:='true';
 END CASE;
 IF p_region ? 'exclude_region' THEN predicate:='('||predicate||') AND NOT(coalesce(('||public.explore_search_region_predicate(p_region->'exclude_region')||'),false))'; END IF;
 RETURN predicate;
END $$;
COMMIT;
