-- Restrict notification producers to authorized booking flows.
-- Keep the owner action RPC available, but authorize its actual authenticated
-- caller against the booking's salon/assignment. Never trust p_actor_user_id.
begin;

do $guard$
declare definition text; anchor text := '  booking_local_date := to_char(';
begin
  definition := pg_get_functiondef('public.notify_booking_change(uuid,text,uuid,uuid[],uuid[])'::regprocedure);
  if position('-- booking-notification-actor-guard' in definition)=0 then
    if (length(definition)-length(replace(definition,anchor,'')))/length(anchor)<>1 then
      raise exception 'Unexpected notify_booking_change definition; review required';
    end if;
    definition := replace(definition,anchor,$code$
  -- booking-notification-actor-guard
  if not coalesce(public.user_has_salon_permission(booking_notice.salon_id,array['booking.manage']),false)
    and not coalesce(public.current_user_has_booking_assignment(booking_notice.id,booking_notice.salon_id),false) then
    raise exception 'Booking notification access denied' using errcode='42501';
  end if;
  booking_local_date := to_char($code$);
    execute definition;
  end if;
end;
$guard$;
revoke all on function public.notify_booking_change(uuid,text,uuid,uuid[],uuid[]) from public,anon;
grant execute on function public.notify_booking_change(uuid,text,uuid,uuid[],uuid[]) to authenticated;

-- Creation notices are emitted only inside the authorized SECURITY DEFINER
-- booking creation path. No application client calls this helper directly.
revoke all on function public.notify_public_booking_created(uuid) from public,anon,authenticated;

notify pgrst, 'reload schema';
commit;
