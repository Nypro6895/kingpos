begin;
-- Notification-only preferences: no changes to booking, queue or financial writes.
create table if not exists public.notification_preferences (
 user_id uuid not null references public.users(id) on delete cascade,
 category text not null check(category in ('booking','reminders','receipts','check_in','comments','team','likes','following','marketing')),
 enabled boolean not null,
 updated_at timestamptz not null default now(), primary key(user_id,category)
);
alter table public.notification_preferences enable row level security;
revoke all on public.notification_preferences from public, anon, authenticated;
grant select, insert, update on public.notification_preferences to authenticated;
create policy notification_preferences_self on public.notification_preferences for all to authenticated
using(user_id=public.current_public_user_id()) with check(user_id=public.current_public_user_id());

create or replace function public.notification_category(p_type text) returns text
language sql immutable set search_path=public as $$
 select case when p_type='login_alert' or p_type like 'security_%' then 'security'
 when p_type='booking_reminder' then 'reminders' when p_type='payment_receipt' then 'receipts'
 when p_type='salon_check_in' then 'check_in' when p_type like '%booking%' then 'booking'
 when p_type like '%comment%' or p_type like '%reply%' then 'comments'
 when p_type like '%like%' or p_type like '%share%' then 'likes'
 when p_type like '%follow%' then 'following'
 when p_type like '%promotion%' or p_type like '%advert%' then 'marketing' else 'team' end;
$$;
create or replace function public.notification_delivery_enabled(p_user uuid,p_type text,p_kind text) returns boolean
language sql stable security definer set search_path=public as $$
 select coalesce((select enabled from notification_preferences where user_id=p_user and category=notification_category(p_type)),
 case when notification_category(p_type)='check_in' then p_kind='staff'
 else notification_category(p_type) not in ('likes','following','marketing') end);
$$;
revoke all on function public.notification_delivery_enabled(uuid,text,text) from public,anon,authenticated;
create or replace function public.filter_notification_preference() returns trigger
language plpgsql security definer set search_path=public as $$
begin
 -- Login alert preferences remain governed by the existing security producer.
 if notification_category(new.notification_type)<>'security' and not notification_delivery_enabled(new.recipient_user_id,new.notification_type,new.recipient_kind) then return null; end if;
 return new;
end;$$;
revoke all on function public.filter_notification_preference() from public,anon,authenticated;
create trigger notification_preference_delivery before insert on public.app_notifications
for each row execute function public.filter_notification_preference();

create index if not exists notifications_scope_created_idx on public.app_notifications(recipient_user_id,recipient_kind,salon_id,created_at desc,id desc);
create index if not exists notifications_account_created_idx on public.app_notifications(recipient_user_id,account_id,created_at desc,id desc);
create index if not exists notifications_unread_scope_idx on public.app_notifications(recipient_user_id,recipient_kind,salon_id) where read_at is null;

create or replace function public.notification_feed(p_kind text default 'customer',p_salon uuid default null,p_account uuid default null,p_unread boolean default false,p_before timestamptz default null,p_before_id uuid default null,p_limit integer default 10)
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare actor uuid:=current_public_user_id(); items jsonb; unread_count integer;
begin
 if actor is null then raise exception 'Not authorized'; end if;
 if p_kind not in ('customer','staff','owner_manager') or p_limit not between 1 and 51 or ((p_before is null)<>(p_before_id is null)) then raise exception 'Invalid query'; end if;
 select count(*) into unread_count from app_notifications n where n.recipient_user_id=actor and n.read_at is null and
 ((n.recipient_kind=p_kind and (p_salon is null or n.salon_id=p_salon) and (p_account is null or n.account_id=p_account)) or notification_category(n.notification_type)='security');
 select coalesce(jsonb_agg(to_jsonb(rows) order by rows.created_at desc,rows.id desc),'[]') into items from (
 select n.id,n.salon_id,n.recipient_kind,n.notification_type,n.booking_id,n.title,n.body,n.href,n.read_at,n.created_at
 from app_notifications n where n.recipient_user_id=actor and
 ((n.recipient_kind=p_kind and (p_salon is null or n.salon_id=p_salon) and (p_account is null or n.account_id=p_account)) or notification_category(n.notification_type)='security')
 and (not p_unread or n.read_at is null) and (p_before is null or (n.created_at,n.id)<(p_before,p_before_id))
 order by n.created_at desc,n.id desc limit p_limit) rows;
 return jsonb_build_object('items',items,'unreadCount',unread_count);
end;$$;
revoke all on function public.notification_feed(text,uuid,uuid,boolean,timestamptz,uuid,integer) from public,anon;
grant execute on function public.notification_feed(text,uuid,uuid,boolean,timestamptz,uuid,integer) to authenticated;

create or replace function public.mark_visible_notifications(p_ids uuid[]) returns uuid[]
language plpgsql security definer set search_path=public as $$
declare actor uuid:=current_public_user_id(); marked uuid[];
begin
 if actor is null then raise exception 'Not authorized'; end if;
 if coalesce(cardinality(p_ids),0)>50 then raise exception 'Too many notifications'; end if;
 with updated as (update app_notifications set read_at=now() where recipient_user_id=actor and id=any(p_ids) and read_at is null returning id)
 select coalesce(array_agg(id),'{}'::uuid[]) into marked from updated;
 return marked;
end;$$;
revoke all on function public.mark_visible_notifications(uuid[]) from public,anon;
grant execute on function public.mark_visible_notifications(uuid[]) to authenticated;

-- A checkout receipt is emitted once, only after the ticket transitions to closed.
create or replace function public.notify_checkout_receipt() returns trigger
language plpgsql security definer set search_path=public as $$
declare customer_user uuid; salon_name text; account uuid;
begin
 if new.status<>'closed' or (tg_op='UPDATE' and old.status='closed') then return new; end if;
 select c.customer_user_id into customer_user from customers c where c.id=new.customer_id and c.location_id=new.salon_id;
 if customer_user is null then return new; end if;
 select name,account_id into salon_name,account from locations where id=new.salon_id;
 insert into app_notifications(account_id,salon_id,recipient_user_id,recipient_kind,notification_type,title,body,href,event_key)
 values(account,new.salon_id,customer_user,'customer','payment_receipt','Your receipt is ready',
 'View your services and payment details from '||salon_name||'.','/activity/receipts/'||new.id::text,'receipt:'||new.id::text||':'||customer_user::text)
 on conflict (recipient_user_id,event_key) where event_key is not null do nothing;
 return new;
exception when others then
 -- An ancillary notification must never roll back a successful checkout.
 raise warning 'Checkout notification failed for ticket %, SQLSTATE %',new.id,SQLSTATE; return new;
end;$$;
revoke all on function public.notify_checkout_receipt() from public,anon,authenticated;
create trigger notification_checkout_receipt after insert or update of status on public.pos_tickets for each row execute function public.notify_checkout_receipt();

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
 return new;
exception when others then raise warning 'Check-in notification failed for visit %, SQLSTATE %',new.id,SQLSTATE; return new;
end;$$;
revoke all on function public.notify_salon_check_in() from public,anon,authenticated;
create trigger notification_salon_check_in after insert on public.customer_visits for each row execute function public.notify_salon_check_in();

create or replace function public.get_notification_visit(p_id uuid) returns jsonb
language plpgsql stable security definer set search_path=public as $$
declare actor uuid:=current_public_user_id(); payload jsonb;
begin
 if actor is null then return null; end if;
 select jsonb_build_object('id',v.id,'salonName',l.name,'salonPhone',l.phone,'status',v.status,'checkedInAt',v.checked_in_at,'bookingId',case when c.customer_user_id=actor then v.appointment_id else null end,'isCustomer',c.customer_user_id=actor)
 into payload from customer_visits v join customers c on c.id=v.customer_id and c.location_id=v.salon_id join locations l on l.id=v.salon_id
 where v.id=p_id and (c.customer_user_id=actor or user_has_salon_permission(v.salon_id,array['tickets.view']) or exists(
 select 1 from staff s join bookings b on b.id=v.appointment_id and b.salon_id=v.salon_id where s.salon_id=v.salon_id and s.is_active and coalesce(s.account_user_id,s.user_id)=actor
 and (b.staff_id=s.id or exists(select 1 from booking_lines bl where bl.booking_id=b.id and bl.assigned_staff_id=s.id))));
 return payload;
end;$$;
revoke all on function public.get_notification_visit(uuid) from public,anon;
grant execute on function public.get_notification_visit(uuid) to authenticated;

-- Called by the existing booking-message worker; bounded and idempotent.
create or replace function public.enqueue_notification_reminders(p_limit integer default 100) returns integer
language plpgsql security definer set search_path=public as $$
declare added integer;
begin
 with inserted as (
 insert into app_notifications(account_id,salon_id,recipient_user_id,recipient_kind,notification_type,booking_id,title,body,href,event_key)
 select l.account_id,b.salon_id,b.customer_user_id,'customer','booking_reminder',b.id,'Your appointment is coming up',
 l.name||' · '||to_char(b.start_at at time zone b.salon_timezone_snapshot,'Mon DD, HH12:MI AM')||' ('||b.salon_timezone_snapshot||'). View your appointment or manage changes.',
 '/my-bookings/'||b.id::text,'reminder:'||b.id::text||':'||extract(epoch from b.start_at)::text||':'||b.customer_user_id::text
 from bookings b join locations l on l.id=b.salon_id where b.customer_user_id is not null and b.start_at>now() and b.start_at<=now()+interval '24 hours'
 and (b.status='confirmed' or (b.status='scheduled' and b.confirmation_status='confirmed'))
 and not exists(select 1 from customer_visits v where v.appointment_id=b.id and v.status in ('waiting','in_service','checkout','completed'))
 and notification_delivery_enabled(b.customer_user_id,'booking_reminder','customer')
 and not exists(select 1 from app_notifications n where n.recipient_user_id=b.customer_user_id and n.event_key='reminder:'||b.id::text||':'||extract(epoch from b.start_at)::text||':'||b.customer_user_id::text)
 order by b.start_at,b.id limit least(greatest(p_limit,1),500)
 on conflict (recipient_user_id,event_key) where event_key is not null do nothing returning id)
 select count(*) into added from inserted;
 return added;
end;$$;
revoke all on function public.enqueue_notification_reminders(integer) from public,anon,authenticated;
grant execute on function public.enqueue_notification_reminders(integer) to service_role;
notify pgrst,'reload schema';
commit;
