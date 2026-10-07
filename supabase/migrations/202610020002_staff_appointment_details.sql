begin;

-- Return only contact fields for bookings assigned to the signed-in staff.
-- Do not broaden customers RLS or grant access to the salon customer directory.
create or replace function public.get_assigned_booking_contacts(p_booking_ids uuid[])
returns jsonb language plpgsql security definer set search_path=public as $$
declare result jsonb;
begin
  if current_public_user_id() is null then raise exception 'Sign in required' using errcode='42501'; end if;
  select coalesce(jsonb_object_agg(b.id::text, jsonb_build_object(
    'customerName', c.name, 'customerPhone', c.phone,
    'noShowCount', jsonb_array_length(booking_no_show_history(b.salon_id,b.id)),
    'noShowReason', b.no_show_reason
  )), '{}'::jsonb) into result
  from bookings b join customers c on c.id=b.customer_id and c.location_id=b.salon_id
  where b.id=any(p_booking_ids) and exists (
    select 1 from booking_lines l where l.booking_id=b.id and l.salon_id=b.salon_id
    and l.assigned_staff_id=current_user_staff_id_for_salon(b.salon_id)
  );
  return result;
end;$$;
revoke all on function public.get_assigned_booking_contacts(uuid[]) from public,anon;
grant execute on function public.get_assigned_booking_contacts(uuid[]) to authenticated;

create or replace function public.report_assigned_booking_no_show(p_booking_id uuid,p_kind text,p_reason text default null)
returns jsonb language plpgsql security definer set search_path=public as $$
declare b bookings%rowtype; staff_id uuid; actor uuid:=current_public_user_id(); reason text:=nullif(btrim(p_reason),'');
begin
  if actor is null then raise exception 'Sign in required' using errcode='42501'; end if;
  select * into b from bookings where id=p_booking_id for update;
  staff_id:=current_user_staff_id_for_salon(b.salon_id);
  if b.id is null or staff_id is null or not exists (
    select 1 from booking_lines l where l.booking_id=b.id and l.salon_id=b.salon_id
    and l.assigned_staff_id=staff_id and l.line_status not in ('cancelled','skipped')
  ) then raise exception 'This appointment is not assigned to you' using errcode='42501'; end if;
  if not salon_is_operational(b.salon_id) then raise exception 'This salon is not active'; end if;
  if p_kind is null or p_kind not in ('unexcused','excused') then raise exception 'Choose a no-show classification'; end if;
  if p_kind='excused' and reason is null then raise exception 'Add the reason provided by the customer'; end if;
  if length(reason)>1000 then raise exception 'Keep the note under 1,000 characters'; end if;
  if b.status not in ('confirmed','scheduled') or b.confirmation_status<>'confirmed'
    or b.pos_ticket_id is not null or b.start_at>now()
    or exists(select 1 from booking_lines l where l.booking_id=b.id and l.line_status in ('in_service','in_progress','completed'))
    or exists(select 1 from customer_visits v where v.appointment_id=b.id and v.status not in ('cancelled','no_show'))
  then raise exception 'Only a confirmed appointment whose time has arrived, without check-in or a POS ticket, can be reported as no-show'; end if;
  update bookings set status='no_show',confirmation_status='cancelled',no_show_kind=p_kind,
    no_show_at=now(),no_show_by_user_id=actor,no_show_reason=reason,updated_by_user_id=actor where id=b.id;
  insert into booking_status_events(salon_id,booking_id,event_type,old_status,new_status,actor_user_id,actor_staff_id,actor_source,metadata)
  values(b.salon_id,b.id,'staff_mark_no_show',b.status,'no_show',actor,staff_id,'staff',jsonb_build_object('newKind',p_kind));
  return jsonb_build_object('ok',true,'kind',p_kind);
end;$$;
revoke all on function public.report_assigned_booking_no_show(uuid,text,text) from public,anon;
grant execute on function public.report_assigned_booking_no_show(uuid,text,text) to authenticated;
commit;

