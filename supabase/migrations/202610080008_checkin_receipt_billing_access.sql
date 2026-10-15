begin;
-- Subscription state and verified payment updates are server-only operations.
grant select, insert, update on public.checkin_receipt_subscriptions to service_role;
commit;
