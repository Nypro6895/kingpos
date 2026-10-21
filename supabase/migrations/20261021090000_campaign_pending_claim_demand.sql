begin;

-- A pending automatic order is only an intent. Recheck its current wallet
-- demand under the existing wallet -> order locks before claiming it. An order
-- already processing may represent an unknown payment outcome and must retain
-- the established retry/settlement path with the same order and provider key.
do $$
declare
 definition text;
 target text:=' update public.campaign_credit_orders set status=''processing'' where id=p_order;';
 guard text:=$guard$
 if o.status='pending' and w.available_credits>w.threshold_credits
  and not exists(select 1 from public.owner_campaigns a where a.salon_id=w.salon_id and a.owner_id=o.owner_id
   and a.owner_paused_at is null and a.auto_fund and a.status='awaiting_payment' and a.total_price_cents>w.available_credits)
  and not exists(select 1 from public.owner_campaigns c where c.salon_id=w.salon_id
   and c.owner_paused_at is null and c.keep_running and c.status in ('running','completed') and c.ends_at<=now()
   and c.daily_price_cents*c.days>w.available_credits) then return null; end if;
$guard$;
begin
 definition:=pg_get_functiondef('public.campaign_credit_claim_before_workspace(uuid)'::regprocedure);
 if position(target in definition)=0
  or (length(definition)-length(replace(definition,target,'')))<>length(target)
  or position('select * into w from public.campaign_wallets where salon_id=(select salon_id from public.campaign_credit_orders where id=p_order) for update;' in definition)=0
  or position('select * into o from public.campaign_credit_orders where id=p_order for update;' in definition)=0
  or position('if o.status=''pending'' and w.available_credits>w.threshold_credits' in definition)>0 then
  raise exception 'Unexpected Campaign credit claim definition';
 end if;
 -- These demand predicates deliberately match the current order-creation
 -- rules, including the existing daily-price x days renewal estimate. This
 -- migration does not change rates, ceilings, payment consent or monthly caps.
 execute replace(definition,target,guard||target);
end $$;

-- Function identity, signature, security attributes and grants are retained by
-- CREATE OR REPLACE. The existing outer payment-block wrapper is untouched.
notify pgrst,'reload schema';
commit;
