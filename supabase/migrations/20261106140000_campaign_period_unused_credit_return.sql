begin;

-- A finished period always settles, even when another period was requested.
-- The existing terminal-state trigger returns reserved - spent - released once.
-- Owner Pause freezes a funded period; it is not a completed run.
create or replace function public.campaign_credit_close_expired(p_salon uuid)
returns void language plpgsql security definer set search_path=public as $$
begin
 perform 1 from public.campaign_wallets where salon_id=p_salon for update;
 update public.owner_campaigns c set status='completed',updated_at=now()
 where c.salon_id=p_salon and c.status in ('running','paused')
 and c.owner_paused_at is null and c.ends_at<=now();
end $$;

revoke all on function public.campaign_credit_close_expired(uuid) from public,anon,authenticated;
grant execute on function public.campaign_credit_close_expired(uuid) to service_role;

commit;
