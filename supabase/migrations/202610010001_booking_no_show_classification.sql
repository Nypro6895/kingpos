begin;
alter table public.bookings add column no_show_kind text check (no_show_kind in ('unexcused','excused'));
comment on column public.bookings.no_show_kind is 'Explicit classification independent of notes. NULL means legacy/unclassified.';
create index bookings_unexcused_customer_history on public.bookings(salon_id,customer_id,start_at desc) where status='no_show' and no_show_kind='unexcused';
create index bookings_unexcused_account_history on public.bookings(salon_id,customer_user_id,start_at desc) where status='no_show' and no_show_kind='unexcused';
create function public.booking_no_show_history(p_salon uuid,p_booking uuid)
returns jsonb language sql security definer set search_path=public as $$
 select coalesce(jsonb_agg(jsonb_build_object('id',h.id,'startAt',h.start_at,
 'timezone',coalesce(h.salon_timezone_snapshot,'America/Chicago'),'note',h.no_show_reason,
 'services',coalesce((select jsonb_agg(l.service_name_snapshot order by l.display_order) from booking_lines l where l.booking_id=h.id and l.line_type='service'),'[]'::jsonb)) order by h.start_at desc),'[]'::jsonb)
 from bookings b join bookings h on h.salon_id=b.salon_id and h.id<>b.id
 and ((b.customer_id is not null and h.customer_id=b.customer_id) or (b.customer_user_id is not null and h.customer_user_id=b.customer_user_id))
 where b.id=p_booking and b.salon_id=p_salon and h.status='no_show' and h.no_show_kind='unexcused';
$$;
revoke all on function public.booking_no_show_history(uuid,uuid) from public,anon,authenticated;
create function public.get_booking_no_show_history(p_booking uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare salon uuid;
begin
 select salon_id into salon from bookings where id=p_booking;
 if salon is null or not user_has_salon_permission(salon,array['booking.manage']::text[]) then raise exception 'Not authorized'; end if;
 return booking_no_show_history(salon,p_booking);
end;$$;
revoke all on function public.get_booking_no_show_history(uuid) from public,anon;
grant execute on function public.get_booking_no_show_history(uuid) to authenticated;
do $copy$
declare definition text;
begin
 definition:=pg_get_functiondef('public.save_pos_workspace_booking(uuid,timestamptz,jsonb)'::regprocedure);
 execute replace(definition,'FUNCTION public.save_pos_workspace_booking(', 'FUNCTION public.save_pos_workspace_booking_before_no_show(');
 definition:=pg_get_functiondef('public.manage_pos_portable_booking(uuid,text,uuid,text,jsonb)'::regprocedure);
 execute replace(definition,'FUNCTION public.manage_pos_portable_booking(', 'FUNCTION public.manage_pos_portable_booking_before_no_show(');
end;$copy$;
revoke all on function public.save_pos_workspace_booking_before_no_show(uuid,timestamptz,jsonb) from public,anon,authenticated;
revoke all on function public.manage_pos_portable_booking_before_no_show(uuid,text,uuid,text,jsonb) from public,anon,authenticated;
create or replace function public.save_pos_workspace_booking(p_booking uuid,p_expected timestamptz,p_changes jsonb)
returns uuid language plpgsql security definer set search_path=public as $$
declare b bookings%rowtype; command text:=p_changes->>'command'; kind text; result uuid; actor uuid:=current_public_user_id();
begin
 select * into b from bookings where id=p_booking for update;
 if b.id is null or actor is null or not user_has_salon_permission(b.salon_id,array['booking.manage']::text[]) then raise exception 'Not authorized'; end if;
 if not salon_is_operational(b.salon_id) then raise exception 'This salon is not active.'; end if;
 if p_expected is null or b.updated_at is distinct from p_expected then raise exception 'This appointment changed on another screen. Review the latest appointment before saving.'; end if;
 if command='confirm' and jsonb_array_length(booking_no_show_history(b.salon_id,b.id))>0 and coalesce(p_changes->>'acknowledge_no_show','false')<>'true' then raise exception 'Review this customer no-show history before confirming.'; end if;
 if command in ('mark_no_show','mark_no_show_excused') then
 kind:=case when command='mark_no_show_excused' then 'excused' else 'unexcused' end;
 if b.status='no_show' then
 if p_changes ? 'lines' or p_changes ? 'assignments' or p_changes ? 'start_at' then raise exception 'Only no-show classification can be changed here.'; end if;
 update bookings set no_show_kind=kind,no_show_reason=coalesce(nullif(btrim(p_changes->>'reason'),''),no_show_reason),updated_by_user_id=actor where id=b.id;
 insert into booking_status_events(salon_id,booking_id,event_type,old_status,new_status,actor_user_id,actor_source,metadata)
 values(b.salon_id,b.id,'no_show_classification_changed','no_show','no_show',actor,'manage',jsonb_build_object('oldKind',b.no_show_kind,'newKind',kind));
 return b.id;
 end if;
 result:=save_pos_workspace_booking_before_no_show(p_booking,p_expected,p_changes||jsonb_build_object('command','mark_no_show'));
 update bookings set no_show_kind=kind where id=result;
 insert into booking_status_events(salon_id,booking_id,event_type,old_status,new_status,actor_user_id,actor_source,metadata)
 values(b.salon_id,b.id,'no_show_classified','no_show','no_show',actor,'manage',jsonb_build_object('newKind',kind));
 return result;
 end if;
 return save_pos_workspace_booking_before_no_show(p_booking,p_expected,p_changes);
end;$$;
create or replace function public.manage_pos_portable_booking(p_key_id uuid,p_session_signature text,p_booking_id uuid,p_action text,p_payload jsonb default '{}')
returns jsonb language plpgsql security definer set search_path=public as $$
declare salon uuid; b bookings%rowtype; history jsonb; kind text; result jsonb;
begin
 salon:=pos_portable_access_salon_id(p_key_id,p_session_signature);
 if salon is null or not pos_portable_access_has_capability(p_key_id,p_session_signature,'portable.book.view') then raise exception 'Not authorized'; end if;
 select * into b from bookings where id=p_booking_id and salon_id=salon for update;
 if b.id is null then raise exception 'Appointment not found in this salon'; end if;
 if p_action='confirm' then
 if not pos_portable_access_has_capability(p_key_id,p_session_signature,'portable.book.create') then raise exception 'Device cannot confirm appointments'; end if;
 history:=booking_no_show_history(salon,b.id);
 if jsonb_array_length(history)>0 and coalesce(p_payload->>'acknowledgeNoShow','false')<>'true' then return jsonb_build_object('requiresNoShowReview',true,'noShowHistory',history); end if;
 end if;
 if p_action in ('mark_no_show','mark_no_show_excused') then
 if not pos_portable_access_has_capability(p_key_id,p_session_signature,'portable.book.cancel') then raise exception 'Device cannot mark no-show'; end if;
 if not salon_is_operational(salon) then raise exception 'This salon is not active.'; end if;
 if nullif(p_payload->>'updatedAt','') is null or (p_payload->>'updatedAt')::timestamptz is distinct from b.updated_at then raise exception 'This appointment changed on another device. Reopen it and try again.'; end if;
 if b.pos_ticket_id is not null or b.status not in ('scheduled','confirmed','no_show') then raise exception 'Only a confirmed appointment without a ticket can be marked no-show here.'; end if;
 kind:=case when p_action='mark_no_show_excused' then 'excused' else 'unexcused' end;
 update bookings set status='no_show',confirmation_status='cancelled',no_show_kind=kind,no_show_at=coalesce(no_show_at,now()),no_show_reason=coalesce(nullif(btrim(p_payload->>'reason'),''),no_show_reason) where id=b.id;
 insert into booking_status_events(salon_id,booking_id,event_type,old_status,new_status,actor_source,metadata)
 values(salon,b.id,case when b.status='no_show' then 'no_show_classification_changed' else 'portable_mark_no_show' end,b.status,'no_show','pos',jsonb_build_object('keyId',p_key_id,'oldKind',b.no_show_kind,'newKind',kind));
 result:=portable_booking_json(salon,b.id);
 else
 result:=manage_pos_portable_booking_before_no_show(p_key_id,p_session_signature,p_booking_id,p_action,p_payload);
 end if;
 return result||(select jsonb_build_object('noShowKind',no_show_kind,'noShowNote',no_show_reason) from bookings where id=b.id);
end;$$;
-- The calendar loader merges this detail helper into every appointment.
do $copy_json$
declare definition text;
begin
 definition:=pg_get_functiondef('public.portable_booking_json(uuid,uuid)'::regprocedure);
 execute replace(definition,'FUNCTION public.portable_booking_json(', 'FUNCTION public.portable_booking_json_before_no_show(');
end;$copy_json$;
revoke all on function public.portable_booking_json_before_no_show(uuid,uuid) from public,anon,authenticated;
create or replace function public.portable_booking_json(p_salon uuid,p_booking uuid)
returns jsonb language sql security definer set search_path=public as $$
 select portable_booking_json_before_no_show(p_salon,p_booking)||jsonb_build_object('noShowKind',b.no_show_kind,'noShowNote',b.no_show_reason,
 'noShowCount',jsonb_array_length(booking_no_show_history(p_salon,p_booking)))
 from bookings b where b.salon_id=p_salon and b.id=p_booking;
$$;
create function public.get_booking_no_show_counts(p_booking_ids uuid[])
returns jsonb language plpgsql security definer set search_path=public as $$
declare b record; result jsonb:='{}';
begin
 for b in select id,salon_id from bookings where id=any(p_booking_ids) loop
 if not user_has_salon_permission(b.salon_id,array['booking.view']::text[]) then raise exception 'Not authorized'; end if;
 result:=result||jsonb_build_object(b.id::text,jsonb_array_length(booking_no_show_history(b.salon_id,b.id)));
 end loop;
 return result;
end;$$;
revoke all on function public.get_booking_no_show_counts(uuid[]) from public,anon;
grant execute on function public.get_booking_no_show_counts(uuid[]) to authenticated;
-- Keep no-shows in the portable history/list so classification can be corrected.
do $portable_list$
declare definition text;
begin
 definition:=pg_get_functiondef('public.get_pos_portable_book_data_before_service_staff(uuid,text,date)'::regprocedure);
 definition:=replace(definition, 'bookings.status not in (''cancelled'', ''no_show'')', 'bookings.status <> ''cancelled''');
 execute definition;
end;$portable_list$;
do $activity$
declare definition text;
begin
 definition:=pg_get_functiondef('public.get_customer_activity(integer)'::regprocedure);
 definition:=replace(definition,'''status'', bookings.status,','''status'', bookings.status, ''noShowKind'', bookings.no_show_kind,');
 execute definition;
end;$activity$;
-- Staff confirmation uses the same explicit review without granting manager access.
do $copy_staff$
declare definition text;
begin
 definition:=pg_get_functiondef('public.confirm_assigned_booking(uuid)'::regprocedure);
 execute replace(definition,'FUNCTION public.confirm_assigned_booking(', 'FUNCTION public.confirm_assigned_booking_before_no_show(');
end;$copy_staff$;
revoke all on function public.confirm_assigned_booking_before_no_show(uuid) from public,anon,authenticated;
create function public.confirm_assigned_booking_with_review(p_booking_id uuid,p_acknowledge_no_show boolean default false)
returns jsonb language plpgsql security definer set search_path=public as $$
declare b bookings%rowtype; staff uuid; history jsonb;
begin
 if current_public_user_id() is null then return jsonb_build_object('ok',false,'code','sign_in_required'); end if;
 select * into b from bookings where id=p_booking_id for update;
 if b.id is null then return jsonb_build_object('ok',false,'code','not_found'); end if;
 staff:=current_user_staff_id_for_salon(b.salon_id);
 if staff is null or not exists(select 1 from booking_lines where booking_id=b.id and salon_id=b.salon_id and assigned_staff_id=staff and line_status not in ('cancelled','skipped')) then return jsonb_build_object('ok',false,'code','forbidden'); end if;
 if b.status in ('pending','scheduled','confirmed') and (b.status<>'confirmed' or b.confirmation_status<>'confirmed') then
 history:=booking_no_show_history(b.salon_id,b.id);
 if jsonb_array_length(history)>0 and not coalesce(p_acknowledge_no_show,false) then return jsonb_build_object('ok',false,'code','no_show_review_required','noShowHistory',history); end if;
 end if;
 return confirm_assigned_booking_before_no_show(p_booking_id);
end;$$;
revoke all on function public.confirm_assigned_booking_with_review(uuid,boolean) from public,anon;
grant execute on function public.confirm_assigned_booking_with_review(uuid,boolean) to authenticated;
create or replace function public.confirm_assigned_booking(p_booking_id uuid)
returns jsonb language sql security definer set search_path=public as $$
 select confirm_assigned_booking_with_review(p_booking_id,false);
$$;
-- CREATE OR REPLACE retains the old function owner, while copied helpers use
-- the migration role. Allow the trusted definer owners to call private helpers.
-- Browser roles remain unable to call these helpers directly.
do $definer_grants$
declare owners text;
begin
 select string_agg(format('%I',role_name),',') into owners from (
   select distinct pg_get_userbyid(proowner) as role_name from pg_proc
   where oid in ('public.save_pos_workspace_booking(uuid,timestamptz,jsonb)'::regprocedure,
     'public.manage_pos_portable_booking(uuid,text,uuid,text,jsonb)'::regprocedure,
     'public.portable_booking_json(uuid,uuid)'::regprocedure,
     'public.get_booking_no_show_counts(uuid[])'::regprocedure,
     'public.get_booking_no_show_history(uuid)'::regprocedure,
     'public.confirm_assigned_booking(uuid)'::regprocedure,
     'public.confirm_assigned_booking_with_review(uuid,boolean)'::regprocedure)
 ) roles;
 execute 'grant execute on function public.booking_no_show_history(uuid,uuid), public.save_pos_workspace_booking_before_no_show(uuid,timestamptz,jsonb), public.manage_pos_portable_booking_before_no_show(uuid,text,uuid,text,jsonb), public.portable_booking_json_before_no_show(uuid,uuid), public.confirm_assigned_booking_before_no_show(uuid), public.confirm_assigned_booking_with_review(uuid,boolean) to '||owners;
end;$definer_grants$;
notify pgrst,'reload schema';
commit;
