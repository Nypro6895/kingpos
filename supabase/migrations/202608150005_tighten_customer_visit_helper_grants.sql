revoke all on function public.customer_visit_first_name(text) from public;
revoke all on function public.customer_visit_first_name(text) from anon;
revoke all on function public.customer_visit_first_name(text) from authenticated;

revoke all on function public.customer_visit_public_payload(public.customer_visits, public.customers) from public;
revoke all on function public.customer_visit_public_payload(public.customer_visits, public.customers) from anon;
revoke all on function public.customer_visit_public_payload(public.customer_visits, public.customers) from authenticated;

revoke all on function public.customer_visit_normalize_booking_status(text) from public;
revoke all on function public.customer_visit_normalize_booking_status(text) from anon;
revoke all on function public.customer_visit_normalize_booking_status(text) from authenticated;

revoke all on function public.find_customer_visit_arrival_appointment(uuid, uuid) from public;
revoke all on function public.find_customer_visit_arrival_appointment(uuid, uuid) from anon;
revoke all on function public.find_customer_visit_arrival_appointment(uuid, uuid) from authenticated;

revoke all on function public.sync_customer_visit_booking_checked_in(uuid) from public;
revoke all on function public.sync_customer_visit_booking_checked_in(uuid) from anon;
revoke all on function public.sync_customer_visit_booking_checked_in(uuid) from authenticated;

revoke all on function public.create_or_reuse_customer_visit(uuid, uuid, text, uuid, jsonb) from public;
revoke all on function public.create_or_reuse_customer_visit(uuid, uuid, text, uuid, jsonb) from anon;
revoke all on function public.create_or_reuse_customer_visit(uuid, uuid, text, uuid, jsonb) from authenticated;

revoke all on function public.resolve_customer_display_submission(text, text, text, text) from public;
grant execute on function public.resolve_customer_display_submission(text, text, text, text) to anon, authenticated;

revoke all on function public.get_customer_visit_queue(uuid, integer) from public;
grant execute on function public.get_customer_visit_queue(uuid, integer) to authenticated;

revoke all on function public.select_customer_visit_for_live_draft(uuid, text) from public;
grant execute on function public.select_customer_visit_for_live_draft(uuid, text) to authenticated;

revoke all on function public.cancel_customer_visit(uuid, text) from public;
grant execute on function public.cancel_customer_visit(uuid, text) to authenticated;

revoke all on function public.complete_customer_visit_for_ticket(uuid, uuid, uuid, uuid) from public;
grant execute on function public.complete_customer_visit_for_ticket(uuid, uuid, uuid, uuid) to authenticated;
