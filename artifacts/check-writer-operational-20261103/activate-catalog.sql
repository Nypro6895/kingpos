begin;
do $$
begin
 if (select count(*) from pg_tables where schemaname='public' and tablename like 'check_writer_%' and rowsecurity) <> 8 then
  raise exception 'Check Writer private schema is not ready';
 end if;
 if exists(select 1 from pg_proc where pronamespace='public'::regnamespace and proname like 'check_writer_%' and has_function_privilege('anon',oid,'execute')) then
  raise exception 'Anonymous Check Writer execution must remain denied';
 end if;
 if not exists(select 1 from public.market_billing_catalog where plugin_id='print-check' and publisher='Reylumi' and price_cents=490 and published) then
  raise exception 'Approved Check Writer catalog price/publisher mismatch';
 end if;
end $$;
update public.market_billing_catalog set fulfillment_ready=true,version=version+1 where plugin_id='print-check' and fulfillment_ready=false;
select jsonb_build_object('plugin',plugin_id,'priceCents',price_cents,'published',published,'fulfillmentReady',fulfillment_ready) as activation from public.market_billing_catalog where plugin_id='print-check';
commit;
