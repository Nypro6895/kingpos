begin;
create or replace function public.mark_all_center_notifications(p_kind text,p_salon uuid default null,p_account uuid default null) returns integer
language plpgsql security definer set search_path=public as $$
declare actor uuid:=current_public_user_id(); amount integer;
begin
 if actor is null or p_kind not in ('customer','staff','owner_manager') then raise exception 'Not authorized'; end if;
 update app_notifications n set read_at=now() where n.recipient_user_id=actor and n.read_at is null and
 ((n.recipient_kind=p_kind and (p_salon is null or n.salon_id=p_salon) and (p_account is null or n.account_id=p_account)) or notification_category(n.notification_type)='security');
 get diagnostics amount=row_count; return amount;
end;$$;
revoke all on function public.mark_all_center_notifications(text,uuid,uuid) from public,anon;
grant execute on function public.mark_all_center_notifications(text,uuid,uuid) to authenticated;
create or replace function public.notification_booking_action_count(p_kind text,p_salon uuid default null,p_account uuid default null) returns integer
language sql stable security definer set search_path=public as $$
 select count(distinct b.id)::integer from app_notifications n join bookings b on b.id=n.booking_id
 where n.recipient_user_id=current_public_user_id() and n.recipient_kind=p_kind and (p_salon is null or n.salon_id=p_salon) and (p_account is null or n.account_id=p_account)
 and n.notification_type='public_booking_created' and b.status in ('pending','scheduled') and b.confirmation_status is distinct from 'confirmed';
$$;
revoke all on function public.notification_booking_action_count(text,uuid,uuid) from public,anon;
grant execute on function public.notification_booking_action_count(text,uuid,uuid) to authenticated;
-- Schedule only when the deployment has pg_cron loaded; the existing worker also enqueues reminders.
do $$ begin
 if position('pg_cron' in current_setting('shared_preload_libraries'))>0 then
  create extension if not exists pg_cron;
  if not exists(select 1 from cron.job where jobname='kingpos-notification-reminders') then
   perform cron.schedule('kingpos-notification-reminders','*/10 * * * *','select public.enqueue_notification_reminders(100);');
  end if;
 else raise warning 'pg_cron unavailable: run the authenticated booking-message worker every 10 minutes for appointment reminders.';
 end if;
end;$$;
notify pgrst,'reload schema';
commit;
