begin;
alter table public.checkin_receipt_subscriptions
 add column checkout_reference uuid not null default gen_random_uuid();
-- Live subscription status is reconciled from Stripe; missing paid access
-- alone must never be interpreted as cancellation.
commit;
