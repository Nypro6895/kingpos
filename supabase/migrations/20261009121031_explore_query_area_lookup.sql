-- Query intent probes use exact indexed names and a finite set of city/state
-- seeks. Never DISTINCT/group all salons in a city merely to recognize an area.
BEGIN;
CREATE INDEX IF NOT EXISTS explore_document_exact_name_seek_idx ON public.explore_salon_documents(salon_name_search,salon_id);
CREATE INDEX IF NOT EXISTS explore_document_city_id_seek_idx ON public.explore_salon_documents(city_search,state_code,salon_id);
CREATE FUNCTION public.get_public_explore_query_entities(p_query text,p_city_query text DEFAULT NULL,p_preferred_state text DEFAULT NULL,p_state_constraint text DEFAULT NULL,p_limit integer DEFAULT 8,p_original_query text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,extensions SET plan_cache_mode=force_custom_plan SET jit=off AS $$
DECLARE query_key text:=public.normalize_search_text(p_query); original_key text:=public.normalize_search_text(p_original_query);
 city_key text:=public.normalize_search_text(p_city_query); preferred text:=upper(btrim(coalesce(p_preferred_state,''))); constrained text:=upper(btrim(coalesce(p_state_constraint,'')));
 state_value text; states text[]; hit record; exact_name boolean:=false; original_name boolean:=false; areas jsonb:='[]'; result_limit integer:=least(8,greatest(1,coalesce(p_limit,8))); output_areas jsonb; has_more boolean:=false;
BEGIN
 IF length(coalesce(p_query,''))>160 OR length(coalesce(p_city_query,''))>160 OR length(coalesce(p_original_query,''))>160 THEN RAISE EXCEPTION 'Explore query text is too long' USING ERRCODE='22023'; END IF;
 IF constrained<>'' AND NOT(constrained=ANY(public.explore_search_state_codes())) THEN RAISE EXCEPTION 'Choose a supported state' USING ERRCODE='22023'; END IF;
 IF NOT(preferred=ANY(public.explore_search_state_codes())) THEN preferred:=''; END IF;
 IF query_key IS NOT NULL THEN
  SELECT EXISTS(SELECT 1 FROM(SELECT d.salon_id FROM explore_salon_documents d WHERE d.salon_name_search=query_key
   AND d.created_at<=now() AND(d.public_discovery_published_at IS NULL OR d.public_discovery_published_at<=now()) ORDER BY d.salon_id LIMIT 8) bounded
   WHERE public.salon_profile_public_salon_exists(bounded.salon_id)) INTO exact_name;
 END IF;
 IF original_key=query_key THEN original_name:=exact_name;
 ELSIF original_key IS NOT NULL THEN
  SELECT EXISTS(SELECT 1 FROM(SELECT d.salon_id FROM explore_salon_documents d WHERE d.salon_name_search=original_key
   AND d.created_at<=now() AND(d.public_discovery_published_at IS NULL OR d.public_discovery_published_at<=now()) ORDER BY d.salon_id LIMIT 8) bounded
   WHERE public.salon_profile_public_salon_exists(bounded.salon_id)) INTO original_name;
 END IF;
 IF city_key IS NOT NULL THEN
  IF constrained<>'' THEN states:=ARRAY[constrained];
  ELSE SELECT array_agg(code ORDER BY (code=preferred) DESC,code) INTO states FROM unnest(public.explore_search_state_codes()) code; states:=array_append(states,NULL); END IF;
  FOREACH state_value IN ARRAY states LOOP
   IF state_value IS NULL THEN
    SELECT bounded.city INTO hit FROM(SELECT d.salon_id,d.city FROM explore_salon_documents d WHERE d.city_search=city_key AND d.state_code IS NULL
     AND d.created_at<=now() AND(d.public_discovery_published_at IS NULL OR d.public_discovery_published_at<=now()) ORDER BY d.salon_id LIMIT 8) bounded
     WHERE public.salon_profile_public_salon_exists(bounded.salon_id) LIMIT 1;
   ELSE
    SELECT bounded.city INTO hit FROM(SELECT d.salon_id,d.city FROM explore_salon_documents d WHERE d.city_search=city_key AND d.state_code=state_value
     AND d.created_at<=now() AND(d.public_discovery_published_at IS NULL OR d.public_discovery_published_at<=now()) ORDER BY d.salon_id LIMIT 8) bounded
     WHERE public.salon_profile_public_salon_exists(bounded.salon_id) LIMIT 1;
   END IF;
   IF FOUND THEN areas:=areas||jsonb_build_array(jsonb_build_object('kind','city','city',hit.city,'stateCode',state_value,'label',CASE WHEN state_value IS NULL THEN hit.city ELSE hit.city||', '||state_value END)); END IF;
   IF jsonb_array_length(areas)>result_limit THEN has_more:=true; EXIT; END IF;
  END LOOP;
 END IF;
 SELECT coalesce(jsonb_agg(row.value),'[]') INTO output_areas FROM(SELECT value FROM jsonb_array_elements(areas) WITH ORDINALITY a(value,ordinality) ORDER BY ordinality LIMIT result_limit) row;
 RETURN jsonb_build_object('version',1,'exactSalonName',exact_name,'exactOriginalSalonName',original_name,'areaCandidates',output_areas,'moreAreaCandidates',has_more,
  'areaStatus',CASE WHEN jsonb_array_length(areas)=0 THEN 'none' WHEN jsonb_array_length(areas)=1 THEN 'unique' ELSE 'ambiguous' END);
END $$;
REVOKE ALL ON FUNCTION public.get_public_explore_query_entities(text,text,text,text,integer,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_public_explore_query_entities(text,text,text,text,integer,text) TO anon,authenticated,service_role;
COMMIT;
