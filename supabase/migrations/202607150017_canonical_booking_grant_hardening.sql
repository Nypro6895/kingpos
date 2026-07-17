-- Canonical Booking Foundation grant hardening.
-- Migration 016 is already applied on hosted development. This additive repair
-- narrows canonical booking access to the RLS/policy surface intended by the
-- booking domain, without changing existing business data.

revoke all privileges on table public.bookings from anon;
revoke all privileges on table public.booking_settings from anon;
revoke all privileges on table public.staff_service_assignments from anon;
revoke all privileges on table public.staff_availability_rules from anon;
revoke all privileges on table public.staff_time_blocks from anon;
revoke all privileges on table public.booking_lines from anon;
revoke all privileges on table public.booking_status_events from anon;

revoke delete, truncate, references, trigger on table public.bookings from authenticated;
revoke delete, truncate, references, trigger on table public.booking_settings from authenticated;
revoke delete, truncate, references, trigger on table public.staff_service_assignments from authenticated;
revoke delete, truncate, references, trigger on table public.staff_availability_rules from authenticated;
revoke delete, truncate, references, trigger on table public.staff_time_blocks from authenticated;
revoke delete, truncate, references, trigger on table public.booking_lines from authenticated;
revoke delete, truncate, references, trigger, update on table public.booking_status_events from authenticated;

grant select, insert, update on table public.bookings to authenticated;
grant select, insert, update on table public.booking_settings to authenticated;
grant select, insert, update on table public.staff_service_assignments to authenticated;
grant select, insert, update on table public.staff_availability_rules to authenticated;
grant select, insert, update on table public.staff_time_blocks to authenticated;
grant select, insert, update on table public.booking_lines to authenticated;
grant select, insert on table public.booking_status_events to authenticated;

revoke all on function public.normalize_booking_status(text) from public, anon;
grant execute on function public.normalize_booking_status(text) to authenticated;

revoke all on function public.booking_status_blocks_slot(text) from public, anon;
grant execute on function public.booking_status_blocks_slot(text) to authenticated;

revoke all on function public.current_user_can_view_booking(uuid) from public, anon;
grant execute on function public.current_user_can_view_booking(uuid) to authenticated;

revoke all on function public.current_user_can_view_booking_line(uuid) from public, anon;
grant execute on function public.current_user_can_view_booking_line(uuid) to authenticated;

revoke all on function public.create_canonical_booking(
  uuid,
  uuid,
  uuid,
  timestamptz,
  timestamptz,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  jsonb,
  text,
  text
) from public, anon;
grant execute on function public.create_canonical_booking(
  uuid,
  uuid,
  uuid,
  timestamptz,
  timestamptz,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  jsonb,
  text,
  text
) to authenticated;
