-- Small public metadata reads while typing; never create search/feed sessions.
BEGIN;
CREATE INDEX IF NOT EXISTS explore_document_suggestion_name_idx ON public.explore_salon_documents(salon_name_search COLLATE "C",salon_id);
CREATE INDEX IF NOT EXISTS explore_document_suggestion_state_name_idx ON public.explore_salon_documents(state_code,salon_name_search COLLATE "C",salon_id);
CREATE TABLE public.explore_search_area_names (
 city_search text COLLATE "C" NOT NULL,state_code text NOT NULL,city text NOT NULL,
 PRIMARY KEY(city_search,state_code)
);
CREATE INDEX explore_search_area_state_prefix_idx ON public.explore_search_area_names(state_code,city_search);
ALTER TABLE public.explore_search_area_names ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.explore_search_area_names FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT,UPDATE,DELETE ON public.explore_search_area_names TO service_role;
-- This is a vocabulary of public city labels, not a live business count.
INSERT INTO public.explore_search_area_names(city_search,state_code,city)
SELECT city_search,state_code,min(city) FROM public.explore_salon_documents
WHERE city_search<>'' AND state_code=ANY(public.explore_search_state_codes()) GROUP BY city_search,state_code;
CREATE FUNCTION public.sync_explore_search_area_names() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_catalog AS $$
BEGIN
 INSERT INTO explore_search_area_names(city_search,state_code,city)
 SELECT city_search,state_code,min(city) FROM suggestion_new
 WHERE city_search<>'' AND state_code=ANY(public.explore_search_state_codes())
 GROUP BY city_search,state_code ORDER BY city_search,state_code ON CONFLICT DO NOTHING;
 RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION public.sync_explore_search_area_names() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER explore_search_area_insert AFTER INSERT ON public.explore_salon_documents
REFERENCING NEW TABLE AS suggestion_new FOR EACH STATEMENT EXECUTE FUNCTION public.sync_explore_search_area_names();
CREATE FUNCTION public.get_public_explore_search_suggestions(p_query text,p_category text DEFAULT NULL,p_city text DEFAULT NULL,p_state text DEFAULT NULL,p_limit integer DEFAULT 8)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,extensions SET plan_cache_mode=force_custom_plan SET jit=off AS $$
DECLARE q text:=coalesce(public.normalize_search_text(p_query),'');cat text:=coalesce(public.normalize_search_text(p_category),'');
 city_key text:=coalesce(public.normalize_search_text(p_city),'');state_key text:=upper(btrim(coalesce(p_state,'')));
 n integer:=least(8,greatest(1,coalesce(p_limit,8))); output jsonb;salons jsonb;areas jsonb;
BEGIN
 IF length(coalesce(p_query,''))>80 OR length(coalesce(p_category,''))>80 OR length(coalesce(p_city,''))>160 OR length(coalesce(p_state,''))>2 THEN RAISE EXCEPTION 'Invalid suggestion input' USING ERRCODE='22023'; END IF;
 IF length(q)<2 THEN RETURN '[]'::jsonb; END IF;
 IF state_key<>'' AND NOT state_key=ANY(public.explore_search_state_codes()) THEN RETURN '[]'::jsonb; END IF;
 IF cat='all' THEN cat:=''; END IF;
 -- Prefix selection reads at most32 candidate identities before live visibility
 -- checks. It is a suggestion list, not an exhaustive matching-results query.
 SELECT coalesce(jsonb_agg(jsonb_build_object('id',d.salon_id,'kind','salon','label',d.salon_name,
  'detail',concat_ws(', ',nullif(d.city,''),nullif(d.state_code,''))) ORDER BY d.salon_name_search COLLATE "C",d.salon_id),'[]') INTO salons
 FROM (SELECT d.* FROM (
  SELECT d.salon_id,d.salon_name,d.city,d.state_code,d.salon_name_search,d.city_search,d.service_category_search_text,d.created_at,d.public_discovery_published_at FROM explore_salon_documents d
  WHERE d.salon_name_search COLLATE "C">=q COLLATE "C" AND d.salon_name_search COLLATE "C"<(q||chr(1114111)) COLLATE "C"
   AND (state_key='' OR d.state_code=state_key)
  ORDER BY d.salon_name_search COLLATE "C",d.salon_id LIMIT 32
 ) d WHERE (city_key='' OR d.city_search=city_key) AND (cat='' OR d.service_category_search_text LIKE '%'||cat||'%')
  AND d.created_at<=now() AND(d.public_discovery_published_at IS NULL OR d.public_discovery_published_at<=now())
  AND public.salon_profile_public_salon_exists(d.salon_id)
 ORDER BY d.salon_name_search COLLATE "C",d.salon_id LIMIT least(5,n)) d;
 SELECT coalesce(jsonb_agg(jsonb_build_object('id','area:'||a.city_search||':'||a.state_code,'kind','area',
  'label',a.city||', '||a.state_code,'detail','Location') ORDER BY a.city_search,a.state_code),'[]') INTO areas
 FROM (SELECT a.* FROM explore_search_area_names a
  WHERE a.city_search>=q COLLATE "C" AND a.city_search<(q||chr(1114111)) COLLATE "C" AND (state_key='' OR a.state_code=state_key)
  ORDER BY a.city_search,a.state_code LIMIT 3) a;
 SELECT coalesce(jsonb_agg(x.value),'[]') INTO output FROM (SELECT value FROM jsonb_array_elements(salons||areas) WITH ORDINALITY e(value,ord) ORDER BY ord LIMIT n) x;
 RETURN output;
END $$;
REVOKE ALL ON FUNCTION public.get_public_explore_search_suggestions(text,text,text,text,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_public_explore_search_suggestions(text,text,text,text,integer) TO anon,authenticated,service_role;
NOTIFY pgrst,'reload schema';
COMMIT;
