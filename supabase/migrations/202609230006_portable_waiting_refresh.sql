-- Lightweight queue reads never reload the POS workspace.
create or replace function public.get_pos_portable_waiting_queue(p_key_id uuid,p_session_signature text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare salon uuid; result jsonb;
begin
  salon := public.pos_portable_access_salon_id(p_key_id,p_session_signature);
  if salon is null or not public.pos_portable_access_has_capability(p_key_id,p_session_signature,'portable.pos.use') then raise exception 'Not authorized'; end if;
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'appointmentId', queue.appointment_id,
        'appointmentStartAt', queue.appointment_start_at,
        'assignedStaffId', queue.assigned_staff_id,
        'assignedStaffName', queue.assigned_staff_name,
        'checkedInAt', queue.checked_in_at,
        'customerId', queue.customer_id,
        'customerName', queue.customer_name,
        'customerPhone', queue.customer_phone,
        'id', queue.id,
        'requestedServices', queue.requested_services,
        'salonId', queue.salon_id,
        'serviceLabel', queue.service_label,
        'source', queue.source,
        'status', queue.status,
        'ticketId', queue.ticket_id
      )
      order by queue.checked_in_at, queue.id
    ),
    '[]'::jsonb
  )
  into result
  from public.customer_visit_queue_rows(salon, 100) queue;
  return result;
end; $$;
revoke all on function public.get_pos_portable_waiting_queue(uuid,text) from public;
grant execute on function public.get_pos_portable_waiting_queue(uuid,text) to anon,authenticated;

-- Existing PIN validation and attendance lock run before this reconciliation.
-- A repeated check-in must not add another attendance event or alter turns.
do $migration$
declare definition text;
begin
  definition := pg_get_functiondef('public.replay_pos_portable_attendance_event(uuid,text,uuid,text,text,timestamptz)'::regprocedure);
  if position('raise exception ''Staff is already checked in.'';' in definition)=0 then raise exception 'Attendance implementation changed'; end if;
  definition := replace(definition, 'raise exception ''Staff is already checked in.'';',
    'return jsonb_build_object(''checkInSequence'',workday_row.check_in_sequence,''checkInAt'',workday_row.check_in_at,''queueTurnCount'',workday_row.queue_turn_count,''staffId'',p_staff_id,''status'',workday_row.status,''today'',target_today,''reconciled'',true);');
  execute definition;
end;
$migration$;
notify pgrst,'reload schema';
