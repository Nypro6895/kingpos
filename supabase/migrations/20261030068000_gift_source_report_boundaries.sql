-- Gift funding/redemptions are source disclosures. The current day report's
-- service and tip reconciliation remains authoritative and independent.
begin;
create or replace function public.get_pos_portable_report_data(p_key_id uuid,p_session_signature text,p_report_date date default current_date)
returns jsonb language plpgsql security definer set search_path=public as $$
declare result jsonb; flow jsonb; salon uuid;
begin
 salon:=pos_portable_access_salon_id(p_key_id,p_session_signature);
 if salon is null or not coalesce(pos_portable_access_has_capability(p_key_id,p_session_signature,'portable.report.view'),false) then return null; end if;
 result:=gift_card_report_before_gifts(p_key_id,p_session_signature,p_report_date);
 if result is null then return null; end if;
 flow:=gift_card_day_cashflow(salon,p_report_date,null,p_key_id,p_session_signature);
 return jsonb_set(result,'{totals}',(result->'totals')||jsonb_build_object(
  'giftCardSales',(flow->>'counterSales')::numeric/100,
  'giftCardRedeemed',(flow->>'redeemed')::numeric/100,
  'giftCardSalesCount',(flow->>'counterSalesCount')::bigint,
  'giftCardRedeemedCount',(flow->>'redeemedCount')::bigint,
  'giftCardSource','gift_card'));
end $$;
revoke all on function public.get_pos_portable_report_data(uuid,text,date) from public;
grant execute on function public.get_pos_portable_report_data(uuid,text,date) to anon,authenticated;
commit;
