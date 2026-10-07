-- Run after 202610020001 using supabase db query --linked --file tests/staff-booking-preferences.sql.
-- Requires an existing active staff account and booking. All test writes roll back.
begin;
do $$
declare actor record; before_others jsonb; after_others jsonb; response jsonb; b uuid; inserted uuid;
begin
  if has_function_privilege('anon', 'public.own_staff_booking_preferences(uuid,boolean,boolean)', 'execute') then raise exception 'Anonymous access'; end if;
  perform set_config('request.jwt.claim.sub', '', true);
  begin
    perform public.own_staff_booking_preferences(gen_random_uuid(), true, true);
    raise exception 'Anonymous request accepted';
  exception when insufficient_privilege then null; end;
  select s.id, s.salon_id, s.account_user_id, u.auth_user_id into actor from public.staff s join public.users u on u.id=s.account_user_id where s.is_active and u.auth_user_id is not null limit 1;
  if actor.id is null then raise exception 'No staff fixture available'; end if;
  select jsonb_agg(jsonb_build_array(id,online_booking_enabled,booking_notifications_enabled) order by id) into before_others from public.staff where id<>actor.id;
  perform set_config('request.jwt.claim.sub', actor.auth_user_id::text, true);
  response := public.own_staff_booking_preferences(actor.salon_id, false, false);
  if response->>'online' <> 'false' or response->>'notifications' <> 'false' then raise exception 'Off did not persist'; end if;
  response := public.own_staff_booking_preferences(actor.salon_id);
  if response->>'notifications' <> 'false' then raise exception 'Read did not persist'; end if;
  response := public.own_staff_booking_preferences(actor.salon_id, true, null);
  if response->>'online' <> 'true' or response->>'notifications' <> 'false' then raise exception 'Independent preferences failed'; end if;
  begin
    perform public.own_staff_booking_preferences(gen_random_uuid(), true, true);
    raise exception 'Unrelated salon accepted';
  exception when insufficient_privilege then null; end;
  select jsonb_agg(jsonb_build_array(id,online_booking_enabled,booking_notifications_enabled) order by id) into after_others from public.staff where id<>actor.id;
  if before_others is distinct from after_others then raise exception 'Other staff modified'; end if;
  select id into b from public.bookings where salon_id=actor.salon_id limit 1;
  if b is null then raise exception 'No booking fixture available'; end if;
  insert into public.app_notifications(salon_id,recipient_user_id,recipient_kind,notification_type,booking_id,title,href) values(actor.salon_id,actor.account_user_id,'staff','booking_change',b,'Preference test','/staff/appointments') returning id into inserted;
  if inserted is not null then raise exception 'Muted notification inserted'; end if;
  insert into public.app_notifications(salon_id,recipient_user_id,recipient_kind,notification_type,booking_id,title,href) values(actor.salon_id,actor.account_user_id,'customer','booking_change',b,'Preference test','/my-bookings') returning id into inserted;
  if inserted is null then raise exception 'Customer notification suppressed'; end if;
  perform public.own_staff_booking_preferences(actor.salon_id, null, true);
  insert into public.app_notifications(salon_id,recipient_user_id,recipient_kind,notification_type,booking_id,title,href) values(actor.salon_id,actor.account_user_id,'staff','booking_change',b,'Preference test','/staff/appointments') returning id into inserted;
  if inserted is null then raise exception 'Enabled notification suppressed'; end if;
end $$;
rollback;
select 'PASS: self scope, cross-salon denial, independent toggles, staff notification mute, customer preservation; all changes rolled back' as result;
