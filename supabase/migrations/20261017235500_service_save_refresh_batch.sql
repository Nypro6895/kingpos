-- Keep service writes atomic, but rebuild their search projections once after
-- the entire parent/add-on batch, rather than after every intermediate write.
-- No trigger is disabled and no projection work is moved out of the transaction.
begin;
do $patch$
declare definition text; target regprocedure; routine text; anchor text;
begin
  foreach routine in array array['sync_explore_salon_documents','sync_explore_social_salons'] loop
    target := to_regprocedure('public.'||routine||'()');
    if target is null then continue; end if;
    definition := pg_get_functiondef(target);
    if position('-- owned-service-refresh-defer' in definition)=0 then
      anchor := E'\nBEGIN\n';
      if position(anchor in definition)=0 then raise exception 'Review service refresh trigger body: %',routine; end if;
      definition := replace(definition,anchor,anchor||
        E' -- owned-service-refresh-defer\n IF TG_TABLE_NAME=''services'' AND current_setting(''app.owned_service_refresh_deferred'',true)=''on'' THEN RETURN NULL; END IF;\n');
      execute definition;
    end if;
  end loop;
  target := 'public.save_owned_service_config_batch(uuid,jsonb)'::regprocedure;
  definition := pg_get_functiondef(target);
  if position('-- owned-service-refresh-batch' in definition)=0 then
    anchor := '  retained_assignments jsonb;';
    if position(anchor in definition)=0 then raise exception 'Review service save declarations.'; end if;
    definition := replace(definition,anchor,anchor||E'\n  previous_refresh_mode text;');
    anchor := '  perform pg_advisory_xact_lock(hashtextextended(''owned-service-config:''||p_salon_id::text,0));';
    if position(anchor in definition)=0 then raise exception 'Review service save lock ordering.'; end if;
    definition := replace(definition,anchor,
      E'  -- owned-service-refresh-batch\n'||
      E'  -- Match the rank -> source lock order used by booking/catalog readers.\n'||
      E'  if to_regprocedure(''public.explore_rank_enqueue(uuid[])'') is not null then\n    perform pg_advisory_xact_lock(126031,1);\n  end if;\n'||anchor||
      E'\n  previous_refresh_mode := current_setting(''app.owned_service_refresh_deferred'',true);\n  perform set_config(''app.owned_service_refresh_deferred'',''on'',true);');
    anchor := '  return jsonb_build_object(''ok'',true,''service_ids'',saved_ids);';
    if position(anchor in definition)=0 then raise exception 'Review service save return.'; end if;
    definition := replace(definition,anchor,
      E'  perform set_config(''app.owned_service_refresh_deferred'',''off'',true);\n'||
      E'  -- One normal statement fires both existing projection triggers on final data.\n'||
      E'  update public.services set name=name where salon_id=p_salon_id and id=any(saved_ids);\n'||
      E'  perform set_config(''app.owned_service_refresh_deferred'',coalesce(previous_refresh_mode,''''),true);\n'||anchor);
    execute definition;
  end if;
end;
$patch$;
-- Projection queries are scoped to this salon. Avoid generic cached plans and
-- JIT compilation competing with the short request budget for a small write.
alter function public.save_owned_service_config_batch(uuid,jsonb) set plan_cache_mode=force_custom_plan;
alter function public.save_owned_service_config_batch(uuid,jsonb) set jit=off;
notify pgrst,'reload schema';
commit;
