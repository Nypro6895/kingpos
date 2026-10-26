begin;
-- Freeze the checkout presentation when the quote is first reserved. Old
-- reservations remain embedded so Stripe idempotency keys keep their payload.
create function public.market_card_checkout_presentation() returns trigger
language plpgsql set search_path=public as $$
begin
 new.snapshot := new.snapshot || jsonb_build_object('checkout_ui_mode',
   case when current_setting('reylumi.checkout_ui_mode',true)='hosted' then 'hosted' else 'embedded' end);
 return new;
end $$;
create trigger market_card_checkout_presentation before insert on public.market_card_purchases
for each row execute function public.market_card_checkout_presentation();

create function public.market_card_reserve_safari(p_salon uuid,p_plugin text) returns jsonb
language plpgsql security definer set search_path=public as $$
declare result jsonb;
begin
 perform set_config('reylumi.checkout_ui_mode','hosted',true);
 result := public.market_card_reserve(p_salon,p_plugin);
 perform set_config('reylumi.checkout_ui_mode','',true);
 return result;
end $$;
revoke all on function public.market_card_checkout_presentation() from public,anon,authenticated;
revoke all on function public.market_card_reserve_safari(uuid,text) from public,anon;
grant execute on function public.market_card_reserve_safari(uuid,text) to authenticated;
commit;
