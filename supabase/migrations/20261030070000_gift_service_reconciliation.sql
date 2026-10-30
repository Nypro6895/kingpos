-- Use the service portion of authoritative Gift redemption as its own discount
-- source. Never subtract Gift-funded tips or add Gift purchases to service cash.
begin;
create function public.gift_card_day_service_discount(p_salon uuid,p_date date,p_before timestamptz default null) returns numeric
language sql stable security definer set search_path=pg_catalog,public as $$
 select coalesce(sum(least(greatest(0,facts.service_subtotal-case when t.discount_type='percentage' then round(facts.service_subtotal*least(t.discount_value,100)/100,2) else least(facts.service_subtotal,t.discount_value) end),gift.redeemed/100.0)),0)
 from public.pos_tickets t
 cross join lateral(select coalesce(sum(i.line_total),0) service_subtotal from public.pos_ticket_items i where i.pos_ticket_id=t.id and not i.is_removed and i.source_kind is distinct from 'gift_card_sale') facts
 cross join lateral(select coalesce(sum(-l.delta),0) redeemed from public.gift_card_ledger l where l.ticket_id=t.id and l.salon_id=t.salon_id and l.kind='redeem') gift
 where t.salon_id=p_salon and t.status='closed' and (t.opened_at at time zone public.get_salon_business_timezone(p_salon))::date=p_date and (p_before is null or t.closed_at<=p_before)
$$;
revoke all on function public.gift_card_day_service_discount(uuid,date,timestamptz) from public,anon,authenticated,service_role;
alter function public.daily_input_reconciliation_values(uuid,date) rename to daily_input_reconciliation_before_gift_sources;
revoke all on function public.daily_input_reconciliation_before_gift_sources(uuid,date) from public,anon,authenticated,service_role;
create function public.daily_input_reconciliation_values(p_salon uuid,p_date date) returns jsonb
language plpgsql stable security definer set search_path=pg_catalog,public as $$
declare facts jsonb; reduction numeric; expected numeric;
begin
 facts:=public.daily_input_reconciliation_before_gift_sources(p_salon,p_date);
 reduction:=public.gift_card_day_service_discount(p_salon,p_date);
 expected:=round((facts->>'expectedService')::numeric-reduction,2);
 return facts||jsonb_build_object('giftServiceDiscount',reduction,'expectedService',expected,
  'serviceDifference',case when facts->>'actualService' is null then null else round((facts->>'actualService')::numeric-expected,2) end);
end $$;
revoke all on function public.daily_input_reconciliation_values(uuid,date) from public,anon,authenticated,service_role;

alter function public.gift_card_day_cashflow(uuid,date,timestamptz,uuid,text) rename to gift_card_day_cashflow_before_service_split;
revoke all on function public.gift_card_day_cashflow_before_service_split(uuid,date,timestamptz,uuid,text) from public,anon,authenticated,service_role;
create function public.gift_card_day_cashflow(p_salon uuid,p_date date,p_before timestamptz default null,p_key uuid default null,p_signature text default null) returns jsonb
language plpgsql stable security definer set search_path=pg_catalog,public as $$
declare flow jsonb; service_cents bigint;
begin
 -- Original reader validates owner/report permission or signed Portable scope.
 flow:=public.gift_card_day_cashflow_before_service_split(p_salon,p_date,p_before,p_key,p_signature);
 service_cents:=round(public.gift_card_day_service_discount(p_salon,p_date,p_before)*100);
 return flow||jsonb_build_object('serviceRedeemed',service_cents,'tipRedeemed',greatest(0,(flow->>'redeemed')::bigint-service_cents));
end $$;
revoke all on function public.gift_card_day_cashflow(uuid,date,timestamptz,uuid,text) from public;
grant execute on function public.gift_card_day_cashflow(uuid,date,timestamptz,uuid,text) to anon,authenticated;
commit;
