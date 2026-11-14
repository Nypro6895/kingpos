begin;
-- Booking completion is the handoff to an open POS ticket, not a payment.
-- Patch the installed conversion so booking authority, row locking, Staff-day
-- serialization, item snapshots and the return signature are retained.
do $migration$
declare definition text;
begin
  definition := replace(pg_get_functiondef('public.convert_booking_to_pos_ticket(uuid)'::regprocedure), E'\r\n', E'\n');
  if position('booking-ticket-handoff-v1' in definition) > 0 then return; end if;
  if position('booking-pos-authority-v1' in definition) = 0
    or position('staff-day-input:' in definition) = 0
    or position('  select coalesce(max(ticket_sequence), 0) + 1' in definition) = 0
    or position(E'  set pos_ticket_id = new_ticket_id\n  where id = booking_row.id;' in definition) = 0 then
    raise exception 'Review installed booking conversion before applying ticket handoff migration.';
  end if;
  definition := replace(definition, '  select coalesce(max(ticket_sequence), 0) + 1', $guard$
  -- booking-ticket-handoff-v1: existing ticket returns above remain idempotent.
  if not public.salon_is_operational(booking_row.salon_id) then
    raise exception 'This salon is not active.';
  end if;
  if booking_row.start_at > now() then
    raise exception 'Create the ticket when the appointment starts.';
  end if;
  if booking_row.status not in ('scheduled','confirmed','checked_in','in_service')
    or booking_row.confirmation_status in ('requested','cancelled','declined') then
    raise exception 'Confirm this appointment before creating its ticket.';
  end if;
  select coalesce(max(ticket_sequence), 0) + 1$guard$);
  definition := replace(definition,
    E'  set pos_ticket_id = new_ticket_id\n  where id = booking_row.id;', $complete$
  set pos_ticket_id = new_ticket_id,
      status = 'completed',
      confirmation_status = 'confirmed',
      updated_by_user_id = public.current_public_user_id()
  where id = booking_row.id;

  insert into public.booking_status_events
    (salon_id, booking_id, event_type, old_status, new_status, actor_user_id, actor_source, metadata)
  values (booking_row.salon_id, booking_row.id, 'workspace_updated', booking_row.status,
    'completed', public.current_public_user_id(), 'manage',
    jsonb_build_object('reason','ticket_handoff','ticketId',new_ticket_id));$complete$);
  execute definition;
end;
$migration$;
revoke all on function public.convert_booking_to_pos_ticket(uuid) from public, anon;
grant execute on function public.convert_booking_to_pos_ticket(uuid) to authenticated;
commit;
