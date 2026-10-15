-- Preserve the existing public OIDs and exact business/scoring schemas. Their
-- owner-only cores keep the installed evidence logic (including 940), while
-- public calls must supply a bounded set of currently published identities.
BEGIN;
CREATE OR REPLACE FUNCTION public.salon_profile_public_salon_exists(target_salon_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,extensions AS $$
 SELECT EXISTS(SELECT 1 FROM salon_settings settings JOIN locations salons ON salons.id=settings.salon_id
 WHERE settings.salon_id=target_salon_id AND settings.public_discovery_enabled AND salons.status='active'
 AND (salons.created_at IS NULL OR salons.created_at<=now())
 AND (settings.public_discovery_published_at IS NULL OR settings.public_discovery_published_at<=now()))
$$;

CREATE FUNCTION public.explore_canonical_salon_ids(p_ids uuid[]) RETURNS uuid[]
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
DECLARE ids uuid[];
BEGIN
 IF coalesce(cardinality(p_ids),0)=0 THEN RETURN '{}'::uuid[]; END IF;
 IF cardinality(p_ids)>100 THEN RAISE EXCEPTION 'At most 100 salon identities may be requested' USING ERRCODE='22023'; END IF;
 SELECT coalesce(array_agg(id ORDER BY id),'{}') INTO ids
 FROM(SELECT DISTINCT id FROM unnest(p_ids) id WHERE id IS NOT NULL) requested
 WHERE public.salon_profile_public_salon_exists(id);
 RETURN ids;
END $$;
CREATE FUNCTION public.explore_canonical_service_ids(p_ids uuid[]) RETURNS uuid[]
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
DECLARE ids uuid[];
BEGIN
 IF coalesce(cardinality(p_ids),0)=0 THEN RETURN '{}'::uuid[]; END IF;
 IF cardinality(p_ids)>100 THEN RAISE EXCEPTION 'At most 100 service identities may be requested' USING ERRCODE='22023'; END IF;
 SELECT coalesce(array_agg(s.id ORDER BY s.id),'{}') INTO ids
 FROM(SELECT DISTINCT id FROM unnest(p_ids) id WHERE id IS NOT NULL) requested JOIN services s ON s.id=requested.id
 WHERE s.is_active AND public.salon_profile_public_salon_exists(s.salon_id);
 RETURN ids;
END $$;
REVOKE ALL ON FUNCTION public.explore_canonical_salon_ids(uuid[]),public.explore_canonical_service_ids(uuid[]) FROM PUBLIC,anon,authenticated,service_role;

DO $migration$
DECLARE function_name text; core_name text; signature regprocedure; definition text; arguments text; result_schema text; input_name text; normalizer text;
BEGIN
 FOREACH function_name IN ARRAY ARRAY['get_public_explore_decision_signals','get_public_content_booking_options','get_public_salon_identity','get_public_explore_reputation_summaries','get_public_lumi_trust_signals','get_public_salon_service_prices'] LOOP
  signature:=to_regprocedure('public.'||function_name||'(uuid[])');
  IF signature IS NULL THEN RAISE EXCEPTION 'Required canonical function is missing: %',function_name; END IF;
  SELECT pg_get_functiondef(signature),pg_get_function_arguments(signature),pg_get_function_result(signature) INTO definition,arguments,result_schema;
  core_name:='_explore_core_'||function_name;
  -- Copy first, then replace the original function in place. A view or stored
  -- caller that already depends on the public OID must also see the boundary.
  definition:=replace(definition,'CREATE OR REPLACE FUNCTION public.'||function_name||'(','CREATE FUNCTION public.'||core_name||'(');
  EXECUTE definition;
  EXECUTE format('REVOKE ALL ON FUNCTION public.%I(uuid[]) FROM PUBLIC,anon,authenticated,service_role',core_name);
  input_name:=CASE WHEN function_name='get_public_salon_service_prices' THEN 'target_service_ids' ELSE 'target_salon_ids' END;
  normalizer:=CASE WHEN input_name='target_service_ids' THEN 'explore_canonical_service_ids' ELSE 'explore_canonical_salon_ids' END;
  EXECUTE format($wrapper$
   CREATE OR REPLACE FUNCTION public.%I(%s) RETURNS %s
   LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,extensions SET plan_cache_mode=force_custom_plan SET jit=off AS $body$
   DECLARE ids uuid[];
   BEGIN
    ids:=public.%I(%I);
    IF coalesce(cardinality(ids),0)=0 THEN RETURN; END IF;
    RETURN QUERY SELECT * FROM public.%I(ids);
   END $body$
  $wrapper$,function_name,arguments,result_schema,normalizer,input_name,core_name);
  EXECUTE format('REVOKE ALL ON FUNCTION public.%I(uuid[]) FROM PUBLIC',function_name);
  EXECUTE format('GRANT EXECUTE ON FUNCTION public.%I(uuid[]) TO anon,authenticated,service_role',function_name);
 END LOOP;
END $migration$;
COMMIT;
