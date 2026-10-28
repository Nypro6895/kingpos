-- convert_booking_to_pos_ticket copies the booking description. The baseline
-- function already references this column, but the table definition omitted it.
-- Nullable and additive: preserve historical ticket values.
alter table public.pos_ticket_items
  add column if not exists service_description_snapshot text;

-- The old SECURITY DEFINER RPC trusted its caller's application checks. Enforce
-- the same booking.manage permission inside the database, before returning an
-- existing ticket, and lock the booking so repeated conversions cannot race.
do $migration$
declare
  definition text;
begin
  definition := replace(pg_get_functiondef('public.convert_booking_to_pos_ticket(uuid)'::regprocedure), E'\r\n', E'\n');
  if position('booking-pos-authority-v1' in definition) = 0 then
    if position(E'begin\n  select *\n  into booking_row' in definition) = 0
      or position(E'  limit 1;\n\n  if booking_row.id is null' in definition) = 0
      or position('  if booking_row.pos_ticket_id is not null then' in definition) = 0 then
      raise exception 'Booking conversion definition changed; review before applying this migration.';
    end if;
    definition := replace(definition, E'begin\n  select *\n  into booking_row', E'begin\n  -- booking-pos-authority-v1\n  if auth.uid() is null then\n    raise exception using errcode = ''42501'', message = ''Sign in required.'';\n  end if;\n\n  select *\n  into booking_row');
    definition := replace(definition, E'  limit 1;\n\n  if booking_row.id is null', E'  limit 1\n  for update;\n\n  if booking_row.id is null');
    definition := replace(definition, '  if booking_row.pos_ticket_id is not null then', E'  if not public.user_has_salon_permission(booking_row.salon_id, array[''booking.manage'']::text[]) then\n    raise exception using errcode = ''42501'', message = ''Booking management access required.'';\n  end if;\n\n  if booking_row.pos_ticket_id is not null then');
    execute definition;
  end if;
end;
$migration$;

revoke all on function public.convert_booking_to_pos_ticket(uuid) from public, anon;
grant execute on function public.convert_booking_to_pos_ticket(uuid) to authenticated;
