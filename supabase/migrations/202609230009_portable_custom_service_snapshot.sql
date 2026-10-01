-- Preserve custom service names in receipt history, not only in line notes.
-- Patch the installed receipt implementation so later attendance/earnings rules
-- and authorization checks are retained unchanged.
do $migration$
declare definition text;
begin
  definition := pg_get_functiondef('public.submit_pos_portable_receipt(uuid,text,jsonb,date)'::regprocedure);
  if position('portable_custom_service_snapshot_v1' in definition) > 0 then return; end if;
  if position(E'      service_id,\n      unit_price' in definition) = 0
    or position(E'      service_uuid,\n      line_total' in definition) = 0 then
    raise exception 'Portable receipt item insert changed; review custom service snapshot patch';
  end if;
  definition := replace(definition, E'      service_id,\n      unit_price',
    E'      service_id,\n      service_name_snapshot,\n      unit_price');
  definition := replace(definition, E'      service_uuid,\n      line_total',
    E'      service_uuid,\n      -- portable_custom_service_snapshot_v1\n      case when service_uuid is null then coalesce(left(nullif(btrim(line_item ->> ''serviceLabel''), ''''), 100), ''Service'')\n        else (select name from public.services where id = service_uuid and salon_id = target_salon_id) end,\n      line_total');
  execute definition;
end;
$migration$;
notify pgrst, 'reload schema';
