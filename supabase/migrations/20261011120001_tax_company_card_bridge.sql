begin;
-- Extend the current card functions in place so their existing tax validation,
-- invoice reconciliation and authorization remain intact.
do $$
declare original text; updated text;
begin
 original:=pg_get_functiondef('public.market_card_reserve(uuid,text)'::regprocedure);
 updated:=replace(original,
   '''vietnamese-language'',''booking-policy'',''booking-deposit'',''checkin-receipt''',
   '''vietnamese-language'',''booking-policy'',''booking-deposit'',''checkin-receipt'',''tax-company''');
 if updated=original or position('elsif p_plugin=''booking-policy'' then' in updated)=0 then
   raise exception 'Card reservation changed; review Tax Company integration before applying.';
 end if;
 updated:=replace(updated,'elsif p_plugin=''booking-policy'' then',
   'elsif p_plugin=''tax-company'' then select stripe_subscription,paid_until,stripe_checkout into sub,until_time,checkout from tax_company_subscriptions where salon_id=p_salon for update;'||E'\n elsif p_plugin=''booking-policy'' then');
 execute updated;
 original:=pg_get_functiondef('public.market_card_apply(uuid,text,text,text,text,integer,integer,text,timestamptz,timestamptz)'::regprocedure);
 updated:=replace(original,'when ''booking-policy'' then ''booking_policy_subscriptions''',
   'when ''tax-company'' then ''tax_company_subscriptions'' when ''booking-policy'' then ''booking_policy_subscriptions''');
 if updated=original then raise exception 'Card reconciliation changed; review Tax Company integration before applying.'; end if;
 execute updated;
end $$;
commit;
