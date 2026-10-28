-- Compose only existing anonymous-readable metadata routines. No private rows,
-- identity inputs, permissions or business writes are introduced by this wrapper.
create or replace function public.get_public_explore_card_metadata_v1(target_salon_ids uuid[])
returns jsonb language plpgsql stable security invoker set search_path=public,pg_temp as $$
declare ids uuid[]; services uuid[]; fn text; payload jsonb; responses jsonb := '{}'::jsonb;
begin
  if coalesce(cardinality(target_salon_ids),0)>100 then raise exception 'Too many salons' using errcode='22023'; end if;
  ids:=array(select distinct x from unnest(coalesce(target_salon_ids,'{}'::uuid[])) x where x is not null order by x);
  foreach fn in array array['get_public_explore_decision_signals','get_public_lumi_trust_signals','get_public_salon_identity','get_public_explore_reputation_summaries','get_public_salon_operating_status_inputs'] loop
    begin
      if cardinality(ids)=0 then payload:='[]'::jsonb;
      else execute format('select coalesce(jsonb_agg(to_jsonb(r)),''[]''::jsonb) from public.%I($1) r',fn) into payload using ids; end if;
      responses:=responses||jsonb_build_object(fn,jsonb_build_object('data',payload,'error',null));
    exception when others then
      responses:=responses||jsonb_build_object(fn,jsonb_build_object('data',null,'error',jsonb_build_object('code',sqlstate,'message','Public metadata unavailable')));
    end;
  end loop;
  services:=array(select distinct (x->>'bookable_service_id')::uuid from jsonb_array_elements(case when jsonb_typeof(responses->'get_public_explore_decision_signals'->'data')='array' then responses->'get_public_explore_decision_signals'->'data' else '[]'::jsonb end) x where x->>'bookable_service_id' is not null);
  begin
    if cardinality(services)=0 then payload:='[]'::jsonb;
    else select coalesce(jsonb_agg(to_jsonb(r)),'[]'::jsonb) into payload from public.get_public_salon_service_prices(services) r; end if;
    responses:=responses||jsonb_build_object('get_public_salon_service_prices',jsonb_build_object('data',payload,'error',null));
  exception when others then
    responses:=responses||jsonb_build_object('get_public_salon_service_prices',jsonb_build_object('data',null,'error',jsonb_build_object('code',sqlstate,'message','Public prices unavailable')));
  end;
  return jsonb_build_object('version',1,'salonIds',to_jsonb(ids),'serviceIds',to_jsonb(services),'responses',responses);
end $$;
revoke all on function public.get_public_explore_card_metadata_v1(uuid[]) from public;
grant execute on function public.get_public_explore_card_metadata_v1(uuid[]) to anon,authenticated,service_role;
