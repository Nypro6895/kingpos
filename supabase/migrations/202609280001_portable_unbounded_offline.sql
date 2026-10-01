-- A durable offline command does not expire because connectivity took >30 days.
-- Keep authorization, original business date, deduplication and conflict rules.
begin;
do $migration$
declare definition text; target regprocedure; needle text;
begin
  foreach target in array array[
    'public.replay_pos_portable_operation(uuid,text,uuid,text,timestamptz,jsonb)'::regprocedure,
    'public.replay_pos_owner_operation(uuid,uuid,timestamptz,jsonb)'::regprocedure
  ] loop
    definition := pg_get_functiondef(target);
    needle := case when position('or p_occurred_at < now()-interval ''30 days''' in definition)>0
      then 'or p_occurred_at < now()-interval ''30 days'''
      else 'or p_occurred_at<now()-interval ''30 days''' end;
    if position(needle in definition)=0 then
      if position('or not isfinite(p_occurred_at)' in definition)>0 then continue; end if;
      raise exception 'Operation time validation changed: %',target;
    end if;
    definition := replace(definition,needle,'or not isfinite(p_occurred_at)');
    execute definition;
  end loop;
end;
$migration$;
notify pgrst,'reload schema';
commit;
