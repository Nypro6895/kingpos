begin;
create or replace function public.notify_salon_check_in() returns trigger
language plpgsql security definer set search_path=public as $$
declare customer_user uuid; salon_name text; account uuid; customer_name text;
begin
 if new.status<>'waiting' then return new; end if;
 select c.customer_user_id,c.name into customer_user,customer_name from customers c where c.id=new.customer_id and c.location_id=new.salon_id;
 select name,account_id into salon_name,account from locations where id=new.salon_id;
 if customer_user is not null then
 insert into app_notifications(account_id,salon_id,recipient_user_id,recipient_kind,notification_type,title,body,href,event_key)
 values(account,new.salon_id,customer_user,'customer','salon_check_in','You are checked in',
 'Your arrival at '||salon_name||' has been recorded. View your visit status.','/notifications/visits/'||new.id::text,'check-in:'||new.id::text||':'||customer_user::text)
 on conflict (recipient_user_id,event_key) where event_key is not null do nothing;
 end if;
 -- Assigned staff only: no broadcast of customer arrivals to unrelated staff.
 insert into app_notifications(account_id,salon_id,recipient_user_id,recipient_kind,notification_type,title,body,href,event_key)
 select account,new.salon_id,x.user_id,'staff','salon_check_in','Your client has arrived',
 coalesce(customer_name,'Your client')||' checked in at '||salon_name||'.','/notifications/visits/'||new.id::text,'check-in:'||new.id::text||':'||x.user_id::text
 from (select distinct coalesce(s.account_user_id,s.user_id) user_id from staff s
 join bookings b on b.id=new.appointment_id and b.salon_id=new.salon_id
 where s.salon_id=new.salon_id and s.is_active and coalesce(s.account_user_id,s.user_id) is not null
 and (b.staff_id=s.id or exists(select 1 from booking_lines l where l.booking_id=b.id and l.assigned_staff_id=s.id))) x
 where x.user_id is distinct from customer_user
 on conflict (recipient_user_id,event_key) where event_key is not null do nothing;
 -- Managers can opt in to arrival alerts; the default stays Off.
 insert into app_notifications(account_id,salon_id,recipient_user_id,recipient_kind,notification_type,title,body,href,event_key)
 select account,new.salon_id,m.user_id,'owner_manager','salon_check_in','A client has arrived',
 coalesce(customer_name,'A client')||' checked in at '||salon_name||'.','/notifications/visits/'||new.id::text,'check-in-manager:'||new.id::text||':'||m.user_id::text
 from account_memberships m join roles r on r.id=m.role_id where m.account_id=account and m.status='active'
 and (r.code='OWNER' or exists(select 1 from role_permissions rp join permissions p on p.id=rp.permission_id where rp.role_id=r.id and p.code in ('tickets.view','tickets.manage')))
 and notification_delivery_enabled(m.user_id,'salon_check_in','owner_manager')
 on conflict (recipient_user_id,event_key) where event_key is not null do nothing;
 return new;
exception when others then raise warning 'Check-in notification failed for visit %, SQLSTATE %',new.id,SQLSTATE; return new;
end;$$;
revoke all on function public.notify_salon_check_in() from public,anon,authenticated;

create or replace function public.get_notification_visit(p_id uuid) returns jsonb
language plpgsql stable security definer set search_path=public as $$
declare actor uuid:=current_public_user_id(); payload jsonb;
begin
 if actor is null then return null; end if;
 select jsonb_build_object('id',v.id,'salonName',l.name,'salonPhone',l.phone,'timezone',coalesce((select to_jsonb(settings)->>'operating_timezone_iana' from salon_settings settings where salon_id=v.salon_id),'America/Chicago'),'status',v.status,'checkedInAt',v.checked_in_at,'bookingId',case when c.customer_user_id=actor then v.appointment_id else null end,'isCustomer',c.customer_user_id=actor)
 into payload from customer_visits v join customers c on c.id=v.customer_id and c.location_id=v.salon_id join locations l on l.id=v.salon_id
 where v.id=p_id and (c.customer_user_id=actor or user_has_salon_permission(v.salon_id,array['tickets.view','tickets.manage']) or exists(
 select 1 from staff s join bookings b on b.id=v.appointment_id and b.salon_id=v.salon_id where s.salon_id=v.salon_id and s.is_active and coalesce(s.account_user_id,s.user_id)=actor
 and (b.staff_id=s.id or exists(select 1 from booking_lines bl where bl.booking_id=b.id and bl.assigned_staff_id=s.id))));
 return payload;
end;$$;
revoke all on function public.get_notification_visit(uuid) from public,anon;
grant execute on function public.get_notification_visit(uuid) to authenticated;

-- Opt-in digest, one notification per followed profile per day. No writes to posts/follows.
create or replace function public.enqueue_following_notification_digest(p_limit integer default 100) returns integer
language plpgsql security definer set search_path=public as $$
declare amount integer;
begin
 with candidates as (
 select f.user_id,f.profile_id,u.display_name,max(p.created_at) newest,count(*) total
 from beauty_profile_follows f join notification_preferences pref on pref.user_id=f.user_id and pref.category='following' and pref.enabled
 join beauty_profiles profile on profile.id=f.profile_id and profile.visibility='public'
 join users u on u.id=profile.user_id
 join beauty_posts p on p.profile_id=profile.id and p.visibility='public' and p.moderation_status='visible' and p.deleted_at is null
 where f.user_id<>profile.user_id and p.created_at>greatest(now()-interval '24 hours',pref.updated_at,f.created_at)
 and p.created_at>coalesce((select max(n.created_at) from app_notifications n where n.recipient_user_id=f.user_id and n.notification_type='followed_post_digest' and n.event_key like 'following:'||f.profile_id::text||':%'),now()-interval '24 hours')
 and not exists(select 1 from app_notifications n where n.recipient_user_id=f.user_id and n.event_key='following:'||f.profile_id::text||':'||to_char(now() at time zone 'UTC','YYYY-MM-DD'))
 group by f.user_id,f.profile_id,u.display_name order by max(p.created_at) desc limit least(greatest(p_limit,1),500)
 ), inserted as (
 insert into app_notifications(recipient_user_id,recipient_kind,notification_type,title,body,href,event_key)
 select user_id,'customer','followed_post_digest','New posts from someone you follow',coalesce(display_name,'Someone you follow')||' shared '||total::text||' new post(s).',
 '/explore/beauty/'||profile_id::text,'following:'||profile_id::text||':'||to_char(now() at time zone 'UTC','YYYY-MM-DD') from candidates
 on conflict (recipient_user_id,event_key) where event_key is not null do nothing returning id)
 select count(*) into amount from inserted; return amount;
end;$$;
revoke all on function public.enqueue_following_notification_digest(integer) from public,anon,authenticated;
grant execute on function public.enqueue_following_notification_digest(integer) to service_role;
do $$ declare job_id bigint; begin
 if exists(select 1 from pg_extension where extname='pg_cron') then
 select jobid into job_id from cron.job where jobname='kingpos-notification-reminders';
 if job_id is not null then perform cron.alter_job(job_id,command:='select public.enqueue_notification_reminders(100); select public.enqueue_following_notification_digest(100);'); end if;
 end if;
end;$$;
notify pgrst,'reload schema';
commit;
