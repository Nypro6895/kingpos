-- Preserve all saved salon choices; align defaults for new settings only.
alter table public.booking_settings
  alter column same_day_booking_enabled set default false,
  alter column minimum_lead_time_minutes set default 120,
  alter column maximum_advance_window_days set default 60;

create or replace function public.assert_booking_time_policy(
  p_start timestamptz, p_end timestamptz, p_timezone text,
  p_same_day boolean, p_lead integer, p_advance integer, p_now timestamptz
) returns void language plpgsql immutable set search_path=public as $$
begin
  if p_start is null or p_end is null or not isfinite(p_start) or not isfinite(p_end) or p_end <= p_start then
    raise exception 'Choose a valid appointment time and duration.';
  end if;
  if p_start <= p_now then
    raise exception 'Choose a future appointment time. Past times cannot be booked.';
  end if;
  if not p_same_day and (p_start at time zone p_timezone)::date <= (p_now at time zone p_timezone)::date then
    raise exception 'Same-day booking is disabled. Choose tomorrow or a later date.';
  end if;
  if p_start < p_now + make_interval(mins=>greatest(0,p_lead)) then
    raise exception 'Allow at least % minutes before the appointment.', p_lead;
  end if;
  if p_start > p_now + greatest(1,p_advance)*interval '24 hours' then
    raise exception 'Appointments can be booked up to % days ahead.', p_advance;
  end if;
end; $$;
revoke all on function public.assert_booking_time_policy(timestamptz,timestamptz,text,boolean,integer,integer,timestamptz) from public, anon, authenticated;

create or replace function public.enforce_booking_time_policy()
returns trigger language plpgsql security definer set search_path=public as $$
declare settings public.booking_settings%rowtype; timezone text;
begin
  -- Status changes on old appointments remain possible. Only a new/moved start is validated.
  if TG_OP='UPDATE' and new.start_at is not distinct from old.start_at then return new; end if;
  select * into settings from public.booking_settings where salon_id=new.salon_id;
  timezone := coalesce(settings.timezone_iana, public.get_salon_business_timezone(new.salon_id), 'America/Chicago');
  perform public.assert_booking_time_policy(new.start_at,new.end_at,timezone,
    coalesce(settings.same_day_booking_enabled,false),coalesce(settings.minimum_lead_time_minutes,120),
    coalesce(settings.maximum_advance_window_days,60),statement_timestamp());
  return new;
end; $$;
revoke all on function public.enforce_booking_time_policy() from public, anon, authenticated;
drop trigger if exists enforce_booking_time_policy on public.bookings;
create trigger enforce_booking_time_policy before insert or update of start_at on public.bookings
for each row execute function public.enforce_booking_time_policy();

create or replace function public.get_pos_portable_booking_policy(p_key_id uuid,p_session_signature text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare salon uuid; settings public.booking_settings%rowtype;
begin
  salon := public.pos_portable_access_salon_id(p_key_id,p_session_signature);
  if salon is null or not public.pos_portable_access_has_capability(p_key_id,p_session_signature,'portable.book.view') then
    raise exception 'Not authorized';
  end if;
  select * into settings from public.booking_settings where salon_id=salon;
  return jsonb_build_object(
    'sameDayBookingEnabled',coalesce(settings.same_day_booking_enabled,false),
    'minimumLeadTimeMinutes',coalesce(settings.minimum_lead_time_minutes,120),
    'maximumAdvanceWindowDays',coalesce(settings.maximum_advance_window_days,60),
    'slotIntervalMinutes',coalesce(settings.slot_interval_minutes,15)
  );
end; $$;
revoke all on function public.get_pos_portable_booking_policy(uuid,text) from public;
grant execute on function public.get_pos_portable_booking_policy(uuid,text) to anon,authenticated;
notify pgrst,'reload schema';
