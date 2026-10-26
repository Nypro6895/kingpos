begin;

-- Only leave an expired running period for renewal while its source remains
-- eligible for campaign_credit_renew. Otherwise the existing terminal-status
-- trigger returns unused reserve; prices, spend, renewal intent and pause
-- behavior are unchanged.
create or replace function public.campaign_credit_close_expired(p_salon uuid)
returns void language plpgsql security definer set search_path=public as $$
begin
 perform 1 from public.campaign_wallets where salon_id=p_salon for update;
 update public.owner_campaigns c
 set status='completed',updated_at=now()
 where c.salon_id=p_salon and c.status in ('running','paused') and c.ends_at<=now()
 and not (
  c.keep_running and c.status='running'
  and public.campaign_plugin_installed(p_salon)
  and coalesce((select (config->>'enabled')::boolean from public.owner_campaign_settings where id),false)
  and public.owner_campaign_post(c.source_type,c.source_id,c.salon_id) is not null
 );
end $$;

revoke all on function public.campaign_credit_close_expired(uuid) from public,anon,authenticated;
grant execute on function public.campaign_credit_close_expired(uuid) to service_role;

commit;
