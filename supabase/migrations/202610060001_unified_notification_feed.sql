begin;
-- Recipient identity is shared across workspaces. Never broadcast salon rows to staff.
create or replace function public.notification_visible_to_actor(n public.app_notifications) returns boolean
language sql stable security definer set search_path=public as $$
 select n.recipient_user_id=current_public_user_id() and (
 n.recipient_kind<>'staff' or n.booking_id is null or exists (
 select 1 from bookings b join staff s on s.salon_id=b.salon_id
 where b.id=n.booking_id and s.is_active and coalesce(s.account_user_id,s.user_id)=current_public_user_id()
 and (b.staff_id=s.id or exists(select 1 from booking_lines bl where bl.booking_id=b.id and bl.assigned_staff_id=s.id))));
$$;
revoke all on function public.notification_visible_to_actor(public.app_notifications) from public,anon;
grant execute on function public.notification_visible_to_actor(public.app_notifications) to authenticated;
create or replace function public.notification_feed(p_kind text default 'customer',p_salon uuid default null,p_account uuid default null,p_unread boolean default false,p_before timestamptz default null,p_before_id uuid default null,p_limit integer default 10)
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare actor uuid:=current_public_user_id(); items jsonb; unread_count integer;
begin
 if actor is null then raise exception 'Not authorized'; end if;
 if p_kind not in ('customer','staff','owner_manager') or p_limit not between 1 and 51 or ((p_before is null)<>(p_before_id is null)) then raise exception 'Invalid query'; end if;
 select count(*) into unread_count from app_notifications n where n.recipient_user_id=actor and n.read_at is null and
 public.notification_visible_to_actor(n);
 select coalesce(jsonb_agg(to_jsonb(rows) order by rows.created_at desc,rows.id desc),'[]') into items from (
 select n.id,n.event_key,n.salon_id,n.recipient_kind,n.notification_type,n.booking_id,n.title,n.body,n.href,n.read_at,n.created_at,b.updated_at as booking_updated_at,
 (n.recipient_kind in ('owner_manager','staff') and b.status in ('pending','scheduled') and b.confirmation_status is distinct from 'confirmed') as booking_actionable,
 case when b.id is not null then 'Appointment ' || to_char(b.start_at at time zone b.salon_timezone_snapshot,'HH12:MI AM Mon DD') || ' - ' || coalesce((select string_agg(bl.service_name_snapshot,', ' order by bl.display_order) from booking_lines bl where bl.booking_id=b.id),'Service') || ' - Customer ' || coalesce(c.name,'Customer') end as appointment_summary
 from app_notifications n left join bookings b on b.id=n.booking_id left join customers c on c.id=b.customer_id where n.recipient_user_id=actor and
 public.notification_visible_to_actor(n)
 and (not p_unread or n.read_at is null) and (p_before is null or (n.created_at,n.id)<(p_before,p_before_id))
 order by n.created_at desc,n.id desc limit p_limit) rows;
 return jsonb_build_object('items',items,'unreadCount',unread_count);
end;$$;
revoke all on function public.notification_feed(text,uuid,uuid,boolean,timestamptz,uuid,integer) from public,anon;
grant execute on function public.notification_feed(text,uuid,uuid,boolean,timestamptz,uuid,integer) to authenticated;

create or replace function public.mark_all_center_notifications(p_kind text,p_salon uuid default null,p_account uuid default null) returns integer
language plpgsql security definer set search_path=public as $$
declare actor uuid:=current_public_user_id(); amount integer;
begin
 if actor is null or p_kind not in ('customer','staff','owner_manager') then raise exception 'Not authorized'; end if;
 update app_notifications n set read_at=now() where n.recipient_user_id=actor and n.read_at is null and
 public.notification_visible_to_actor(n);
 get diagnostics amount=row_count; return amount;
end;$$;
revoke all on function public.mark_all_center_notifications(text,uuid,uuid) from public,anon;
grant execute on function public.mark_all_center_notifications(text,uuid,uuid) to authenticated;
create or replace function public.notification_booking_action_count(p_kind text,p_salon uuid default null,p_account uuid default null) returns integer
language sql stable security definer set search_path=public as $$
 select count(distinct b.id)::integer from app_notifications n join bookings b on b.id=n.booking_id
 where n.recipient_user_id=current_public_user_id() and public.notification_visible_to_actor(n)
 and n.notification_type='public_booking_created' and b.status in ('pending','scheduled') and b.confirmation_status is distinct from 'confirmed';
$$;
revoke all on function public.notification_booking_action_count(text,uuid,uuid) from public,anon;
grant execute on function public.notification_booking_action_count(text,uuid,uuid) to authenticated;

notify pgrst,'reload schema';
commit;
