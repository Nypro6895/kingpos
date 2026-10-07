begin;
do $$ begin
 if exists(select 1 from pg_trigger where tgrelid='public.bookings'::regclass and tgname='enforce_booking_time_policy') then alter table public.bookings disable trigger enforce_booking_time_policy; end if;
end; $$;
do $test$
declare au uuid:=gen_random_uuid(); actor uuid:=gen_random_uuid(); bu uuid:=gen_random_uuid(); outsider uuid:=gen_random_uuid(); su uuid:=gen_random_uuid(); staff_user uuid:=gen_random_uuid();
 a uuid; salon uuid; customer uuid; staff_id uuid; booking uuid; visit uuid; ticket uuid; notice uuid; hidden uuid; foreign_notice uuid; payload jsonb; result uuid[]; n integer; rejected boolean; timestamp_at timestamptz:=now()-interval '1 hour'; first_id uuid; second_id uuid; profile_id uuid; post_id uuid; role_id uuid; manager_visit uuid; failed_ticket uuid;
begin
 insert into auth.users(id,email) values(au,'notifications-'||au||'@example.invalid'),(bu,'notifications-'||bu||'@example.invalid'),(su,'notifications-'||su||'@example.invalid');
 insert into users(id,auth_user_id,email) values(actor,au,'notifications-'||au||'@example.invalid'),(outsider,bu,'notifications-'||bu||'@example.invalid'),(staff_user,su,'notifications-'||su||'@example.invalid');
 insert into accounts(name,status) values('Notification QA','active') returning id into a;
 insert into locations(account_id,name,status) values(a,'Notification salon','active') returning id into salon;
 insert into customers(location_id,name,customer_user_id) values(salon,'QA client',actor) returning id into customer;
 insert into staff(salon_id,account_user_id,display_name,is_active) values(salon,staff_user,'QA staff',true) returning id into staff_id;
 insert into bookings(salon_id,customer_id,customer_user_id,staff_id,start_at,end_at,status,confirmation_status,salon_timezone_snapshot)
 values(salon,customer,actor,staff_id,now()+interval '12 hours',now()+interval '13 hours','confirmed','confirmed','America/Chicago') returning id into booking;

 insert into customer_visits(salon_id,customer_id,appointment_id,status,source) values(salon,customer,booking,'waiting','appointment') returning id into visit;
 if exists(select 1 from app_notifications where recipient_user_id=actor and notification_type='salon_check_in') then raise exception 'Customer check-in should default off'; end if;
 if not exists(select 1 from app_notifications where recipient_user_id=staff_user and notification_type='salon_check_in' and href='/notifications/visits/'||visit::text) then raise exception 'Assigned staff arrival notification missing'; end if;
 perform set_config('request.jwt.claim.sub',au::text,true);
 if get_notification_visit(visit) is null then raise exception 'Customer cannot see own visit'; end if;
 perform set_config('request.jwt.claim.sub',su::text,true);
 if get_notification_visit(visit) is null then raise exception 'Assigned staff cannot see visit'; end if;
 perform set_config('request.jwt.claim.sub',bu::text,true);
 if get_notification_visit(visit) is not null then raise exception 'Outsider can see visit'; end if;

 insert into pos_tickets(salon_id,customer_id,ticket_number,status) values(salon,customer,'QA-N','open') returning id into ticket;
 insert into pos_payments(salon_id,ticket_id,payment_method,amount) values(salon,ticket,'cash',40);
 update pos_tickets set status='closed',closed_at=now() where id=ticket;
 if (select count(*) from app_notifications where recipient_user_id=actor and notification_type='payment_receipt' and href='/activity/receipts/'||ticket::text)<>1 then raise exception 'Receipt missing'; end if;
 update pos_tickets set status='closed' where id=ticket;
 if (select count(*) from app_notifications where recipient_user_id=actor and notification_type='payment_receipt')<>1 then raise exception 'Receipt duplicated'; end if;
 if (select sum(amount) from pos_payments where ticket_id=ticket)<>40 then raise exception 'Notification changed payment'; end if;

 insert into notification_preferences(user_id,category,enabled) values(actor,'booking',false);
 insert into app_notifications(recipient_user_id,recipient_kind,notification_type,title,href) values(actor,'customer','booking_change','Muted','/my-bookings') returning id into notice;
 if notice is not null then raise exception 'Preference mute ignored'; end if;
 insert into app_notifications(recipient_user_id,recipient_kind,notification_type,title,href) values(actor,'customer','login_alert','Security','/settings/login-security') returning id into notice;
 insert into app_notifications(recipient_user_id,recipient_kind,notification_type,title,href) values(actor,'customer','post_comment_created','Visible','/explore') returning id into hidden;
 insert into app_notifications(recipient_user_id,recipient_kind,notification_type,title,href) values(outsider,'customer','post_comment_created','Foreign','/explore') returning id into foreign_notice;
 perform set_config('request.jwt.claim.sub',au::text,true);
 result:=mark_visible_notifications(array[notice,foreign_notice]);
 if result<>array[notice] then raise exception 'Mark visible did not isolate recipient'; end if;
 if (select read_at from app_notifications where id=hidden) is not null then raise exception 'Unseen notification marked read'; end if;
 if (select read_at from app_notifications where id=foreign_notice) is not null then raise exception 'Foreign notification marked read'; end if;
 payload:=notification_feed('staff',salon,null,false,null,null,10);
 if not exists(select 1 from jsonb_array_elements(payload->'items') i where i->>'id'=notice::text) then raise exception 'Security alert hidden in staff workspace'; end if;
 payload:=notification_feed('customer',null,null,true,null,null,10);
 if exists(select 1 from jsonb_array_elements(payload->'items') i where i->>'id'=notice::text) then raise exception 'Read item in unread feed'; end if;
 if exists(select 1 from jsonb_array_elements(payload->'items') i where i->>'id'=foreign_notice::text) then raise exception 'Foreign item in feed'; end if;

 insert into app_notifications(recipient_user_id,recipient_kind,notification_type,title,href,created_at) values(actor,'customer','post_comment_created','Same time 1','/explore',timestamp_at) returning id into first_id;
 insert into app_notifications(recipient_user_id,recipient_kind,notification_type,title,href,created_at) values(actor,'customer','post_comment_created','Same time 2','/explore',timestamp_at) returning id into second_id;
 payload:=notification_feed('customer',null,null,false,timestamp_at,greatest(first_id,second_id),10);
 if not exists(select 1 from jsonb_array_elements(payload->'items') i where i->>'id'=least(first_id,second_id)::text) then raise exception 'Cursor lost same-timestamp item'; end if;
 if exists(select 1 from jsonb_array_elements(payload->'items') i where i->>'id'=greatest(first_id,second_id)::text) then raise exception 'Cursor duplicate'; end if;

 -- Check-in appointments must not generate another reminder.
 n:=enqueue_notification_reminders(500);
 if exists(select 1 from app_notifications where booking_id=booking and notification_type='booking_reminder') then raise exception 'Checked-in booking reminder'; end if;
 update customer_visits set status='cancelled' where id=visit;
 n:=enqueue_notification_reminders(500);
 if not exists(select 1 from app_notifications where booking_id=booking and notification_type='booking_reminder') then raise exception 'Reminder missing'; end if;
 n:=enqueue_notification_reminders(500);
 if (select count(*) from app_notifications where booking_id=booking and notification_type='booking_reminder')<>1 then raise exception 'Reminder duplicate'; end if;
 if (select status from bookings where id=booking)<>'confirmed' then raise exception 'Reminder changed booking'; end if;
 if has_function_privilege('anon','public.notification_feed(text,uuid,uuid,boolean,timestamptz,uuid,integer)','execute') then raise exception 'Anonymous feed access'; end if;
 if has_function_privilege('authenticated','public.enqueue_notification_reminders(integer)','execute') then raise exception 'User can invoke reminder worker'; end if;


 -- Opt-in followed-post digest: public posts only, no self notification, once per day.
 insert into beauty_profiles(user_id,visibility) values(staff_user,'public') returning id into profile_id;
 insert into beauty_profile_follows(profile_id,user_id,created_at) values(profile_id,actor,now()-interval '3 hours');
 insert into notification_preferences(user_id,category,enabled,updated_at) values(actor,'following',true,now()-interval '2 hours');
 insert into beauty_posts(profile_id,author_user_id,caption,visibility,moderation_status,created_at) values(profile_id,staff_user,'Public QA update','public','visible',now()-interval '1 hour') returning id into post_id;
 n:=enqueue_following_notification_digest(500);
 if not exists(select 1 from app_notifications where recipient_user_id=actor and notification_type='followed_post_digest' and href='/explore/beauty/'||profile_id::text) then raise exception 'Followed digest missing'; end if;
 n:=enqueue_following_notification_digest(500);
 if (select count(*) from app_notifications where recipient_user_id=actor and notification_type='followed_post_digest')<>1 then raise exception 'Followed digest duplicated'; end if;
 if has_function_privilege('authenticated','public.enqueue_following_notification_digest(integer)','execute') then raise exception 'User can invoke following worker'; end if;

 -- Explicit mark all is scoped and preserves another user's rows.
 n:=mark_all_center_notifications('customer');
 if (notification_feed('customer')->>'unreadCount')::integer<>0 then raise exception 'Mark all left customer updates unread'; end if;
 if (select read_at from app_notifications where id=foreign_notice) is not null then raise exception 'Mark all touched another user'; end if;

 -- Notification insertion failures must never undo checkout.
 execute 'create function public.notification_qa_fail() returns trigger language plpgsql as $fn$ begin if new.notification_type=''payment_receipt'' then raise exception ''QA simulated notification failure''; end if; return new; end; $fn$';
 execute 'create trigger notification_qa_fail before insert on public.app_notifications for each row execute function public.notification_qa_fail()';
 insert into pos_tickets(salon_id,customer_id,ticket_number,status) values(salon,customer,'QA-FAIL','open') returning id into failed_ticket;
 insert into pos_payments(salon_id,ticket_id,payment_method,amount) values(salon,failed_ticket,'cash',25);
 update pos_tickets set status='closed',closed_at=now() where id=failed_ticket;
 if (select status from pos_tickets where id=failed_ticket)<>'closed' or (select sum(amount) from pos_payments where ticket_id=failed_ticket)<>25 then raise exception 'Notification failure rolled back checkout'; end if;
 execute 'drop trigger notification_qa_fail on public.app_notifications';
 execute 'drop function public.notification_qa_fail()';


 -- Manager arrivals are opt-in, and check-in keeps its existing state machine.
 insert into roles(account_id,name,code) values(a,'QA owner','OWNER') returning id into role_id;
 insert into account_memberships(account_id,user_id,role_id,status) values(a,outsider,role_id,'active');
 insert into notification_preferences(user_id,category,enabled) values(outsider,'check_in',true);
 insert into customer_visits(salon_id,customer_id,appointment_id,status,source) values(salon,customer,booking,'waiting','appointment') returning id into manager_visit;
 if not exists(select 1 from app_notifications where recipient_user_id=outsider and recipient_kind='owner_manager' and notification_type='salon_check_in' and href='/notifications/visits/'||manager_visit::text) then raise exception 'Opt-in manager arrival missing'; end if;
 if (select status from customer_visits where id=manager_visit)<>'waiting' then raise exception 'Notification changed check-in'; end if;

 -- Seen appointment requests remain actionable until business confirmation.
 update bookings set status='pending',confirmation_status='requested' where id=booking;
 insert into app_notifications(salon_id,recipient_user_id,recipient_kind,notification_type,booking_id,title,href) values(salon,staff_user,'staff','public_booking_created',booking,'Request','/staff/appointments') returning id into notice;
 perform set_config('request.jwt.claim.sub',su::text,true);
 perform mark_visible_notifications(array[notice]);
 if notification_booking_action_count('staff',salon)<>1 then raise exception 'Viewed request stopped needing action'; end if;
 update bookings set status='confirmed',confirmation_status='confirmed' where id=booking;
 if notification_booking_action_count('staff',salon)<>0 then raise exception 'Confirmed request still needs action'; end if;
 perform set_config('request.jwt.claim.sub',au::text,true);

 -- Exercise actual RLS, not postgres bypass.
 execute 'set local role authenticated';
 rejected:=false;
 begin insert into notification_preferences(user_id,category,enabled) values(outsider,'receipts',false); exception when insufficient_privilege then rejected:=true; end;
 if not rejected then raise exception 'Cross-user preference write allowed'; end if;
 result:=mark_visible_notifications(array[foreign_notice]);
 if cardinality(result)<>0 then raise exception 'Cross-user read mark allowed'; end if;
 execute 'reset role';
 raise notice 'PASS: read visibility, RLS, cursor ties, preferences, defaults, check-in permissions, receipt dedupe, payment preservation, reminder dedupe and booking preservation';
end;$test$;
rollback;
