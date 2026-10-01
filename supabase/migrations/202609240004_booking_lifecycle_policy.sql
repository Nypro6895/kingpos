create or replace function public.enforce_booking_lifecycle_policy()
returns trigger language plpgsql security definer set search_path=public as $$
declare settings booking_settings%rowtype;
begin
 select * into settings from booking_settings where salon_id=new.salon_id;
 if TG_OP='INSERT' then
   -- Until a verified payment flow supplies a payment state, required payments
   -- cannot silently become a not-required appointment through another client.
   if (coalesce(settings.payment_required_enabled,false) or coalesce(settings.deposit_required_enabled,false))
      and new.payment_status='not_required' then
     raise exception 'This salon requires payment or a deposit. Contact the salon to complete payment before booking.';
   end if;
   if new.cancellation_policy_snapshot='{}'::jsonb then
     new.cancellation_policy_snapshot:=jsonb_build_object('cancellationWindowMinutes',coalesce(settings.cancellation_window_minutes,1440),
       'lateCancellationPolicy',coalesce(settings.late_cancellation_policy,'{}'::jsonb),'noShowPolicy',coalesce(settings.no_show_policy,'{}'::jsonb));
   end if;
 end if;
 if new.status='no_show' and new.start_at>statement_timestamp() then
   raise exception 'An appointment cannot be marked no-show before its scheduled start.';
 end if;
 return new;
end; $$;
revoke all on function public.enforce_booking_lifecycle_policy() from public,anon,authenticated;
create trigger enforce_booking_lifecycle_policy before insert or update of status on public.bookings
for each row execute function public.enforce_booking_lifecycle_policy();

create or replace function public.cancel_public_booking_by_manage_token(raw_token text,p_reason text default null)
returns jsonb language plpgsql security definer set search_path=public as $$
declare booking_row bookings%rowtype; notice integer;
begin
 select * into booking_row from bookings where customer_cancellation_token_hash=raw_token limit 1 for update;
 if booking_row.id is null then return jsonb_build_object('ok',false,'code','invalid_token'); end if;
 if booking_row.status not in ('pending','confirmed','scheduled') then return jsonb_build_object('ok',false,'code','not_changeable'); end if;
 notice:=coalesce((booking_row.cancellation_policy_snapshot->>'cancellationWindowMinutes')::integer,
   (select cancellation_window_minutes from booking_settings where salon_id=booking_row.salon_id),1440);
 if booking_row.start_at<=statement_timestamp()+make_interval(mins=>greatest(notice,0)) then
   return jsonb_build_object('ok',false,'code','cancellation_window_closed','message','The online cancellation window has closed. Please contact the salon.');
 end if;
 update bookings set status='cancelled',cancellation_reason=nullif(trim(coalesce(p_reason,'')),''),cancelled_at=now() where id=booking_row.id;
 update booking_lines set line_status='cancelled' where booking_id=booking_row.id;
 insert into booking_status_events(salon_id,booking_id,event_type,old_status,new_status,actor_source)
 values(booking_row.salon_id,booking_row.id,'booking_cancelled',booking_row.status,'cancelled','public');
 return jsonb_build_object('ok',true,'booking_id',booking_row.id);
end; $$;
notify pgrst,'reload schema';
