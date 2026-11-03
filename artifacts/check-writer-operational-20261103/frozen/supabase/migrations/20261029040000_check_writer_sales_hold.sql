begin;
-- Keep the approved price, but do not open paid sales merely by merging code.
-- Release coordinator may enable fulfillment only after recorded acceptance and
-- explicit go-live authorization. Runtime sales gate also defaults closed.
update public.market_billing_catalog
set price_cents=490,fulfillment_ready=false,version=version+1
where plugin_id='print-check';
commit;
