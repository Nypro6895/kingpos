-- Additive indexes for salon-scoped operational report range queries.
create index if not exists pos_ticket_staff_earnings_salon_work_date_staff_idx
on public.pos_ticket_staff_earnings (salon_id, work_date, staff_id);

create index if not exists pos_payments_salon_ticket_method_idx
on public.pos_payments (salon_id, ticket_id, payment_method);

create index if not exists pos_ticket_items_active_report_lookup_idx
on public.pos_ticket_items (salon_id, pos_ticket_id, service_id, assigned_staff_id)
where coalesce(is_removed, false) = false;

create index if not exists customers_location_created_at_idx
on public.customers (location_id, created_at);
