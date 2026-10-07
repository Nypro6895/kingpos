-- All fixture mutations roll back. Never print customer contact data.
begin;
do $$
declare fixture record; contacts jsonb; result jsonb;
begin
  if has_function_privilege('anon','public.get_assigned_booking_contacts(uuid[])','execute')
    or has_function_privilege('anon','public.report_assigned_booking_no_show(uuid,text,text)','execute') then raise exception 'Anonymous grant'; end if;
  select b.id,b.salon_id,b.customer_id,l.assigned_staff_id,u.auth_user_id into fixture
  from bookings b join booking_lines l on l.booking_id=b.id join staff s on s.id=l.assigned_staff_id join users u on u.id=s.account_user_id
  where s.is_active and u.auth_user_id is not null and l.line_status='scheduled' and b.status in ('scheduled','confirmed')
    and b.pos_ticket_id is null and not exists(select 1 from customer_visits v where v.appointment_id=b.id)
  limit 1;
  if fixture.id is null then raise exception 'No usable staff fixture'; end if;
  perform set_config('request.jwt.claim.sub','',true);
  begin perform get_assigned_booking_contacts(array[fixture.id]); raise exception 'Anonymous accepted'; exception when insufficient_privilege then null; end;
  perform set_config('request.jwt.claim.sub',fixture.auth_user_id::text,true);
  contacts:=get_assigned_booking_contacts(array[fixture.id,gen_random_uuid()]);
  if not contacts ? fixture.id::text then raise exception 'Own customer missing'; end if;
  if (contacts->fixture.id::text->>'customerName') is distinct from (select name from customers where id=fixture.customer_id)
    or (contacts->fixture.id::text->>'customerPhone') is distinct from (select phone from customers where id=fixture.customer_id) then raise exception 'Wrong contact'; end if;
  begin
    update staff set is_active=false where id=fixture.assigned_staff_id;
    if get_assigned_booking_contacts(array[fixture.id]) <> '{}'::jsonb then raise exception 'Inactive staff read accepted'; end if;
    raise exception using errcode='PZ001';
  exception when sqlstate 'PZ001' then null; end;
  begin
    update booking_lines set assigned_staff_id=null where booking_id=fixture.id;
    if get_assigned_booking_contacts(array[fixture.id]) <> '{}'::jsonb then raise exception 'Unassigned customer leaked'; end if;
    begin perform report_assigned_booking_no_show(fixture.id,'unexcused'); raise exception 'Unassigned mutation accepted'; exception when insufficient_privilege then null; end;
    raise exception using errcode='PZ001';
  exception when sqlstate 'PZ001' then null; end;
  begin
    alter table bookings disable trigger enforce_booking_time_policy;
    update bookings set status='confirmed',confirmation_status='confirmed',start_at=now()+interval '1 hour',end_at=now()+interval '2 hours' where id=fixture.id;
    alter table bookings enable trigger enforce_booking_time_policy;
    begin perform report_assigned_booking_no_show(fixture.id,'unexcused'); raise exception using errcode='PZ002'; exception when raise_exception then null; end;
    alter table bookings disable trigger enforce_booking_time_policy;
    update bookings set start_at=now()-interval '1 hour' where id=fixture.id;
    alter table bookings enable trigger enforce_booking_time_policy;
    begin perform report_assigned_booking_no_show(fixture.id,'excused',null); raise exception using errcode='PZ002'; exception when raise_exception then null; end;
    update bookings set status='checked_in' where id=fixture.id;
    begin perform report_assigned_booking_no_show(fixture.id,'unexcused'); raise exception using errcode='PZ002'; exception when raise_exception then null; end;
    update bookings set status='confirmed' where id=fixture.id;
    result:=report_assigned_booking_no_show(fixture.id,'unexcused','Test - rolled back');
    if result->>'ok'<>'true' or not exists(select 1 from bookings where id=fixture.id and status='no_show' and no_show_kind='unexcused' and no_show_by_user_id=current_public_user_id()) then raise exception 'No-show not persisted'; end if;
    if not exists(select 1 from booking_status_events where booking_id=fixture.id and event_type='staff_mark_no_show' and actor_staff_id=fixture.assigned_staff_id) then raise exception 'Missing audit event'; end if;
    begin perform report_assigned_booking_no_show(fixture.id,'unexcused'); raise exception using errcode='PZ002'; exception when raise_exception then null; end;
    update bookings set status='confirmed',confirmation_status='confirmed' where id=fixture.id;
    result:=report_assigned_booking_no_show(fixture.id,'excused','Customer called - test rolled back');
    if result->>'kind'<>'excused' or not exists(select 1 from bookings where id=fixture.id and no_show_kind='excused') then raise exception 'Excused classification failed'; end if;
    raise exception using errcode='PZ001';
  exception when sqlstate 'PZ001' then null; end;
end;$$;
select 'PASS: own contact, no unrelated contact, anonymous/unassigned guards, future/check-in/reason guards, no-show save and audit, duplicate guard' as result;
rollback;
