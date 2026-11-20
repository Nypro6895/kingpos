begin;

-- Owner Pause freezes the remaining funded period. Its unused reservation is
-- unavailable to other campaigns until explicit Resume or terminal Cancel.
-- Run this guard before campaign_credit_release, including stale expiry writes
-- from older service/create paths. No wallet or historical ledger is rewritten.
alter trigger campaign_owner_pause_guard on public.owner_campaigns
 rename to campaign_00_owner_pause_guard;
create or replace function public.campaign_owner_pause_guard() returns trigger
language plpgsql security definer set search_path=public as $$
begin
 if tg_op='UPDATE' and old.owner_paused_at is not null and old.status<>'completed' and new.status='completed' and new.archived_at is null then
  new.status:='paused';
  new.owner_paused_at:=old.owner_paused_at;
  new.pause_episode_id:=old.pause_episode_id;
  new.pause_origin:=old.pause_origin;
 end if;
 if new.status in ('cancelled','rejected') or new.archived_at is not null then new.owner_paused_at:=null; end if;
 if new.owner_paused_at is not null and new.status='running' then
  raise exception 'The owner must resume this paused campaign.';
 end if;
 return new;
end $$;

create or replace function public.campaign_credit_close_expired(p_salon uuid)
returns void language plpgsql security definer set search_path=public as $$
begin
 perform 1 from public.campaign_wallets where salon_id=p_salon for update;
 update public.owner_campaigns c set status='completed',updated_at=now()
 where c.salon_id=p_salon and c.status in ('running','paused') and c.owner_paused_at is null and c.ends_at<=now()
 and not (
  c.keep_running and c.status='running'
  and public.campaign_plugin_installed(p_salon)
  and coalesce((select (config->>'enabled')::boolean from public.owner_campaign_settings where id),false)
  and public.owner_campaign_post(c.source_type,c.source_id,c.salon_id) is not null
 );
end $$;

-- Creation also expires older rows. Keep a held Pause in the existing active
-- campaign limit/unique-source rules instead of releasing it as a side effect.
do $$declare definition text; target text:='status in (''running'',''paused'') and ends_at<=now()';
begin
 definition:=pg_get_functiondef('public.owner_campaign_create_original(uuid,uuid,uuid,text,uuid,text,text,text,text,text,integer,integer)'::regprocedure);
 if (length(definition)-length(replace(definition,target,'')))/length(target)<>1 then
  raise exception 'Unexpected original Campaign creation expiry definition';
 end if;
 execute replace(definition,target,'status in (''running'',''paused'') and owner_paused_at is null and ends_at<=now()');
end $$;

create or replace function public.owner_campaign_change(p_id uuid,p_salon uuid,p_user uuid,p_action text) returns void
language plpgsql security definer set search_path=public as $$
declare c public.owner_campaigns;
begin
 if not coalesce(public.lifecycle_user_is_salon_owner(p_salon,p_user,false),false) then raise exception 'Owner access required.'; end if;
 perform 1 from public.campaign_wallets where salon_id=p_salon for update;
 select * into c from public.owner_campaigns where id=p_id and salon_id=p_salon for update;
 if c.id is null then raise exception 'Campaign not found.'; end if;
 if p_action='pause' then
  if c.owner_paused_at is not null then return; end if;
  if c.status<>'running' or c.ends_at is null or c.ends_at<=now() then
   raise exception 'Only a running campaign within its current period can be paused.';
  end if;
  update public.owner_campaigns set status='paused',owner_paused_at=now(),pause_episode_id=gen_random_uuid(),pause_origin='owner',updated_at=now() where id=p_id;
 elsif p_action='resume' and c.owner_paused_at is not null then
  raise exception 'Refresh this campaign before resuming its current pause.';
 elsif p_action='cancel' and c.status='cancelled' then
  return; -- A retry never returns the same unused credits twice.
 elsif p_action='cancel' and (c.owner_paused_at is not null or c.status in ('awaiting_payment','pending_review','running','paused')) then
  update public.owner_campaigns set status='cancelled',owner_paused_at=null,keep_running=false,updated_at=now() where id=p_id;
 else
  perform public.owner_campaign_change_original(p_id,p_salon,p_user,p_action);
 end if;
end $$;

-- Preserve the older explicit new-period path only for historical rows which
-- had already completed and returned their reservation before this migration.
-- Those credits may have been spent elsewhere; never pretend they remain held.
alter function public.owner_campaign_resume(uuid,uuid,uuid,uuid) rename to owner_campaign_resume_before_reserve_hold;
create function public.owner_campaign_resume(p_id uuid,p_salon uuid,p_user uuid,p_episode uuid) returns void
language plpgsql security definer set search_path=public as $$
declare c public.owner_campaigns; restored_end timestamptz;
begin
 if not coalesce(public.lifecycle_user_is_salon_owner(p_salon,p_user,false),false) then raise exception 'Owner access required.'; end if;
 perform 1 from public.campaign_wallets where salon_id=p_salon for update;
 select * into c from public.owner_campaigns where id=p_id and salon_id=p_salon for update;
 if c.id is null then raise exception 'Campaign not found.'; end if;
 if p_episode is null or c.pause_episode_id is distinct from p_episode then raise exception 'This pause changed. Refresh before resuming.'; end if;
 if c.owner_paused_at is null and c.status in ('running','completed') then return; end if;
 if c.owner_paused_at is null or c.archived_at is not null then raise exception 'This campaign cannot be resumed.'; end if;
 if c.status='completed' then
  if c.reserved_credits-c.spent_cents-c.released_credits>0 then
   raise exception 'This campaign has an unsettled completed period. Refresh before starting another period.';
  end if;
  perform public.owner_campaign_resume_before_reserve_hold(p_id,p_salon,p_user,p_episode);
  return;
 end if;
 if c.status<>'paused' then raise exception 'This campaign cannot be resumed.'; end if;
 if c.payment_reference is null or c.approved_at is null or not public.campaign_plugin_installed(p_salon)
    or not coalesce((select (config->>'enabled')::boolean from public.owner_campaign_settings where id),false)
    or public.owner_campaign_post(c.source_type,c.source_id,p_salon) is null then
  raise exception 'This campaign must have an available, approved source before it can resume.';
 end if;
 if c.ends_at is null or c.ends_at<=c.owner_paused_at then
  raise exception 'This paused period has no remaining scheduled time. Cancel it to return its unused credits.';
 end if;
 -- starts_at and all usage/cap counters remain unchanged: no new pacing window,
 -- impression entitlement, credit reservation, release, or purchase is created.
 restored_end:=c.ends_at+greatest(interval '0 seconds',now()-c.owner_paused_at);
 update public.owner_campaigns set status='running',owner_paused_at=null,ends_at=restored_end,updated_at=now() where id=p_id;
end $$;
revoke all on function public.owner_campaign_resume_before_reserve_hold(uuid,uuid,uuid,uuid) from public,anon,authenticated,service_role;
revoke all on function public.owner_campaign_resume(uuid,uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.owner_campaign_resume(uuid,uuid,uuid,uuid) to service_role;

create or replace function public.campaign_pause_schedule() returns trigger
language plpgsql security definer set search_path=public as $$
begin
 if new.owner_paused_at is not null and new.pause_origin='owner'
    and (old.pause_episode_id is distinct from new.pause_episode_id) then
  insert into public.campaign_pause_reminders(campaign_id,episode_id,milestone_hours,due_at)
   select new.id,new.pause_episode_id,h,new.owner_paused_at+make_interval(hours=>h) from unnest(array[24,168]) h
   on conflict do nothing;
 end if;
 update public.campaign_pause_reminders set cancelled_at=now()
  where campaign_id=new.id and processed_at is null and cancelled_at is null
   and (episode_id is distinct from new.pause_episode_id or new.owner_paused_at is null
    or new.status<>'paused' or new.archived_at is not null);
 return new;
end $$;

-- Keep the actual recipient/preference/dedupe implementation. A frozen period's
-- old ends_at is no longer the end of its pause episode or reminder lifecycle.
do $$declare definition text; target text:=' or c.ends_at is null or c.ends_at<=now()';
begin
 definition:=pg_get_functiondef('public.campaign_pause_reminder(uuid)'::regprocedure);
 if (length(definition)-length(replace(definition,target,'')))/length(target)<>1 then
  raise exception 'Unexpected Campaign pause reminder expiry definition';
 end if;
 execute replace(definition,target,'');
end $$;

create or replace view public.campaign_credit_queue_items as
 select 'topup'::text phase,w.salon_id item_id from public.campaign_wallets w where w.installed and w.auto_topup_enabled
 union all
 select 'fund',c.id from public.owner_campaigns c where c.status='awaiting_payment' and c.auto_fund and c.owner_paused_at is null
 union all
 select 'renew',c.id from public.owner_campaigns c where c.keep_running and c.status in ('running','completed') and c.ends_at<=now() and c.owner_paused_at is null
 union all
 select distinct 'close',c.salon_id from public.owner_campaigns c where c.status in ('running','paused') and c.owner_paused_at is null and c.ends_at<=now()
 union all
 select distinct 'pause_reminders',c.id from public.owner_campaigns c join public.campaign_pause_reminders r on r.campaign_id=c.id and r.episode_id=c.pause_episode_id
 where c.owner_paused_at is not null and c.status='paused' and c.archived_at is null
 and r.due_at<=now() and r.processed_at is null and r.cancelled_at is null;
revoke all on public.campaign_credit_queue_items from public,anon,authenticated;
grant select on public.campaign_credit_queue_items to service_role;

notify pgrst,'reload schema';
commit;
