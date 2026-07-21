-- A service/add-on pair is a durable soft-state record. Full pair uniqueness
-- makes retries and reactivation idempotent while preserving inactive links.

drop index if exists public.service_add_on_links_unique_active_idx;

create unique index service_add_on_links_unique_pair_idx
on public.service_add_on_links(
  salon_id,
  parent_service_id,
  add_on_service_id
);
