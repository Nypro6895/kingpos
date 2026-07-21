-- Harden Phase 4.5 booking setup RPC grants. These owner/staff management
-- functions must not be directly executable by anon.

revoke all on function public.save_staff_service_assignment_batch(uuid, uuid, jsonb) from anon;
revoke all on function public.save_service_staff_assignment_batch(uuid, uuid, jsonb) from anon;
revoke all on function public.save_staff_weekly_availability(uuid, uuid, jsonb) from anon;
revoke all on function public.create_staff_time_block(uuid, uuid, text, timestamptz, timestamptz, text, text, boolean) from anon;
revoke all on function public.cancel_staff_time_block(uuid, uuid) from anon;

grant execute on function public.save_staff_service_assignment_batch(uuid, uuid, jsonb) to authenticated;
grant execute on function public.save_service_staff_assignment_batch(uuid, uuid, jsonb) to authenticated;
grant execute on function public.save_staff_weekly_availability(uuid, uuid, jsonb) to authenticated;
grant execute on function public.create_staff_time_block(uuid, uuid, text, timestamptz, timestamptz, text, text, boolean) to authenticated;
grant execute on function public.cancel_staff_time_block(uuid, uuid) to authenticated;
