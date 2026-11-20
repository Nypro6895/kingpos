begin;
-- Only new callers opt into salon-bound return URLs. Already reserved quotes
-- retain their complete provider payload when retrying an idempotent request.
create or replace function public.market_card_checkout_presentation() returns trigger
language plpgsql set search_path=public as $$
begin
 new.snapshot := new.snapshot || jsonb_build_object('checkout_ui_mode',
  case when current_setting('reylumi.checkout_ui_mode',true)='hosted' then 'hosted' else 'embedded' end);
 if current_setting('reylumi.market_target_return',true)='1' then
  new.snapshot := new.snapshot || jsonb_build_object('market_target_return_version',1);
 end if;
 return new;
end $$;
create function public.market_card_reserve_target(p_salon uuid,p_plugin text,p_external boolean default false,p_tax_return text default null) returns jsonb
language plpgsql security definer set search_path=public as $$
declare result jsonb;begin
 perform set_config('reylumi.market_target_return','1',true);
 if p_tax_return is not null then
  if p_plugin<>'tax-company' then raise exception 'Tax return is only available for Tax Company.';end if;
  result:=public.tax_card_reserve(p_salon,p_external,p_tax_return);
 elsif p_external then result:=public.market_card_reserve_safari(p_salon,p_plugin);
 else result:=public.market_card_reserve(p_salon,p_plugin);end if;
 perform set_config('reylumi.market_target_return','',true);
 return result;
end $$;
revoke all on function public.market_card_reserve_target(uuid,text,boolean,text) from public,anon;
grant execute on function public.market_card_reserve_target(uuid,text,boolean,text) to authenticated;
notify pgrst,'reload schema';
commit;
