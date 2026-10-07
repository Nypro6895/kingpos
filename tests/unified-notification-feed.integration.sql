begin;
do $$ begin
 if exists(select 1 from pg_trigger where tgrelid='public.bookings'::regclass and tgname='enforce_booking_time_policy') then alter table public.bookings disable trigger enforce_booking_time_policy; end if;
end; $$;
do $test$
declare au uuid:=gen_random_uuid(); actor uuid:=gen_random_uuid(); bu uuid:=gen_random_uuid(); outsider uuid:=gen_random_uuid();
 a uuid; salon uuid; customer uuid; staff_id uuid; assigned uuid; unassigned uuid; payload jsonb; amount integer;
begin
 insert into auth.users(id,email) values(au,'unified-'||au||'@example.invalid'),(bu,'unified-'||bu||'@example.invalid');
 insert into users(id,auth_user_id,email) values(actor,au,'unified-'||au||'@example.invalid'),(outsider,bu,'unified-'||bu||'@example.invalid');
 insert into accounts(name,status) values('Unified notification QA','active') returning id into a;
 insert into locations(account_id,name,status) values(a,'Unified salon','active') returning id into salon;
 insert into customers(location_id,name,customer_user_id) values(salon,'Mary',actor) returning id into customer;
 insert into staff(salon_id,account_user_id,display_name,is_active) values(salon,actor,'Staff QA',true) returning id into staff_id;
 insert into bookings(salon_id,customer_id,customer_user_id,staff_id,start_at,end_at,status,confirmation_status,salon_timezone_snapshot)
 values(salon,customer,actor,staff_id,now()+interval '12 hours',now()+interval '13 hours','pending','requested','America/Chicago') returning id into assigned;
 insert into bookings(salon_id,customer_id,start_at,end_at,status,confirmation_status,salon_timezone_snapshot)
 values(salon,customer,now()+interval '14 hours',now()+interval '15 hours','pending','requested','America/Chicago') returning id into unassigned;
 delete from app_notifications where recipient_user_id in (actor,outsider);
 insert into app_notifications(account_id,salon_id,recipient_user_id,recipient_kind,notification_type,booking_id,title,href) values
 (a,salon,actor,'customer','booking_reminder',assigned,'Customer notice','/my-bookings/'||assigned),
 (a,salon,actor,'owner_manager','public_booking_created',assigned,'Owner notice','/bookings'),
 (a,salon,actor,'staff','public_booking_created',assigned,'Assigned staff notice','/staff/appointments'),
 (a,salon,actor,'staff','public_booking_created',unassigned,'Unassigned staff notice','/staff/appointments'),
 (a,salon,outsider,'owner_manager','public_booking_created',assigned,'Other owner notice','/bookings');
 perform set_config('request.jwt.claim.sub',au::text,true);
 payload:=notification_feed('customer',null,null,false,null,null,10);
 if jsonb_array_length(payload->'items')<>3 or (payload->>'unreadCount')::integer<>3 then raise exception 'Unified feed must include all own roles and exclude unassigned staff'; end if;
 if not exists(select 1 from jsonb_array_elements(payload->'items') row where row->>'appointment_summary' like '%Mary%' and row->>'booking_actionable'='true') then raise exception 'Appointment details and actions missing'; end if;
 if notification_feed('staff',salon,a,false,null,null,10)<>payload then raise exception 'Workspace must not change feed'; end if;
 amount:=mark_all_center_notifications('customer');
 if amount<>3 then raise exception 'Mark all must span roles'; end if;
 if jsonb_array_length(notification_feed('owner_manager',salon,a,true,null,null,10)->'items')<>0 then raise exception 'Mark all left unread rows'; end if;
 perform set_config('request.jwt.claim.sub',bu::text,true);
 if jsonb_array_length(notification_feed('customer',null,null,false,null,null,10)->'items')<>1 then raise exception 'Recipient isolation failed'; end if;
end;
$test$;
rollback;
