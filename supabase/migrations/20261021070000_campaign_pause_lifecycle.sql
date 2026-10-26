begin;

-- Pause is an owner instruction, independent of the accounting period's status.
-- The existing expiry trigger still returns unused reserve at the scheduled end.
alter table public.owner_campaigns add column owner_paused_at timestamptz;
alter table public.owner_campaigns add column pause_episode_id uuid;
alter table public.owner_campaigns add column pause_origin text check (pause_origin in ('owner','legacy_unknown'));
alter table public.owner_campaigns add constraint owner_campaign_pause_episode
 check (owner_paused_at is null or (pause_episode_id is not null and pause_origin is not null));

-- updated_at is not a reliable historical pause timestamp. Protect existing
-- paused ads without inventing that timestamp or sending historical reminders.
update public.owner_campaigns set owner_paused_at=now(),pause_episode_id=gen_random_uuid(),pause_origin='legacy_unknown'
 where status='paused';

create table public.campaign_pause_reminders (
 campaign_id uuid not null references public.owner_campaigns(id) on delete cascade,
 episode_id uuid not null, milestone_hours integer not null check (milestone_hours in (24,168)),
 due_at timestamptz not null, processed_at timestamptz, cancelled_at timestamptz,
 notification_id uuid references public.app_notifications(id) on delete set null,
 primary key (campaign_id,episode_id,milestone_hours)
);
alter table public.campaign_pause_reminders enable row level security;
revoke all on public.campaign_pause_reminders from public,anon,authenticated;
grant select,insert,update on public.campaign_pause_reminders to service_role;
create index campaign_pause_due on public.campaign_pause_reminders(due_at,campaign_id)
 where processed_at is null and cancelled_at is null;

-- Use the existing Reminders preference and delivery filter. Other categories
-- and notification producers keep their established behavior.
do $$declare definition text; target text:='p_type=''booking_reminder''';
begin
 definition:=pg_get_functiondef('public.notification_category(text)'::regprocedure);
 if position(target in definition)=0 then raise exception 'Unexpected notification category definition'; end if;
 execute replace(definition,target,'p_type in (''booking_reminder'',''campaign_pause_reminder'')');
end $$;

create function public.campaign_pause_schedule() returns trigger
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
    or new.status<>'paused' or new.ends_at<=now() or new.archived_at is not null);
 return new;
end $$;
create trigger campaign_pause_schedule after update on public.owner_campaigns
 for each row execute function public.campaign_pause_schedule();

-- Legacy review/admin/service entry points may still attempt a status write.
-- Only an explicit, episode-checked Resume clears the owner's pause marker.
create function public.campaign_owner_pause_guard() returns trigger
language plpgsql security definer set search_path=public as $$
begin
 if new.status in ('cancelled','rejected') or new.archived_at is not null then new.owner_paused_at:=null; end if;
 if new.owner_paused_at is not null and new.status='running' then
  raise exception 'The owner must resume this paused campaign.';
 end if;
 return new;
end $$;
create trigger campaign_owner_pause_guard before insert or update on public.owner_campaigns
 for each row execute function public.campaign_owner_pause_guard();

-- Keep the established wallet -> campaign lock order. The internal renewal
-- implementation, prices, ledger keys, cap, nonce and admission math stay intact.
alter function public.campaign_credit_renew(uuid) rename to campaign_credit_renew_before_pause;
create function public.campaign_credit_renew(p_id uuid) returns boolean
language plpgsql security definer set search_path=public as $$
declare c public.owner_campaigns;
begin
 perform 1 from public.campaign_wallets where salon_id=(select salon_id from public.owner_campaigns where id=p_id) for update;
 select * into c from public.owner_campaigns where id=p_id for update;
 if c.owner_paused_at is not null then return false; end if;
 return public.campaign_credit_renew_before_pause(p_id);
end $$;

alter function public.campaign_credit_fund(uuid,uuid,uuid,boolean) rename to campaign_credit_fund_before_pause;
create function public.campaign_credit_fund(p_id uuid,p_salon uuid,p_owner uuid,p_keep boolean default false) returns text
language plpgsql security definer set search_path=public as $$
declare c public.owner_campaigns;
begin
 if not coalesce(public.lifecycle_user_is_salon_owner(p_salon,p_owner,false),false) or not public.campaign_plugin_installed(p_salon) then raise exception 'Add Campaigns in your owner workspace first.'; end if;
 perform 1 from public.campaign_wallets where salon_id=p_salon for update;
 select * into c from public.owner_campaigns where id=p_id and salon_id=p_salon for update;
 if c.id is null then raise exception 'Campaign not found.'; end if;
 if c.owner_paused_at is not null then return c.status; end if;
 return public.campaign_credit_fund_before_pause(p_id,p_salon,p_owner,p_keep);
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
  -- Retried Pause never creates another episode or postpones its reminders.
  if c.owner_paused_at is not null then return; end if;
  if c.status<>'running' then raise exception 'Only running campaigns can be paused.'; end if;
  update public.owner_campaigns set status='paused',owner_paused_at=now(),pause_episode_id=gen_random_uuid(),pause_origin='owner',updated_at=now() where id=p_id;
 elsif p_action='resume' and c.owner_paused_at is not null then
  -- A legacy client cannot accidentally replay Resume against a newer pause.
  raise exception 'Refresh this campaign before resuming its current pause.';
 elsif p_action='cancel' and c.owner_paused_at is not null then
  update public.owner_campaigns set status='cancelled',owner_paused_at=null,keep_running=false,updated_at=now() where id=p_id;
 else
  perform public.owner_campaign_change_original(p_id,p_salon,p_user,p_action);
 end if;
end $$;

-- The episode token makes a retry distinguishable from a later owner Pause.
create function public.owner_campaign_resume(p_id uuid,p_salon uuid,p_user uuid,p_episode uuid) returns void
language plpgsql security definer set search_path=public as $$
declare c public.owner_campaigns; active_count integer; max_count integer;
begin
 if not coalesce(public.lifecycle_user_is_salon_owner(p_salon,p_user,false),false) then raise exception 'Owner access required.'; end if;
 perform 1 from public.campaign_wallets where salon_id=p_salon for update;
 select * into c from public.owner_campaigns where id=p_id and salon_id=p_salon for update;
 if c.id is null then raise exception 'Campaign not found.'; end if;
 if p_episode is null or c.pause_episode_id is distinct from p_episode then raise exception 'This pause changed. Refresh before resuming.'; end if;
 if c.owner_paused_at is null and c.status in ('running','completed') then return; end if;
 if c.owner_paused_at is null or c.status not in ('paused','completed') or c.archived_at is not null then raise exception 'This campaign cannot be resumed.'; end if;
 if c.payment_reference is null or c.approved_at is null or not public.campaign_plugin_installed(p_salon)
    or not coalesce((select (config->>'enabled')::boolean from public.owner_campaign_settings where id),false)
    or public.owner_campaign_post(c.source_type,c.source_id,p_salon) is null then
  raise exception 'This campaign must have an available, approved source before it can resume.';
 end if;
 if c.ends_at>now() and c.status='paused' then
  update public.owner_campaigns set owner_paused_at=null where id=p_id;
  perform public.owner_campaign_change_original(p_id,p_salon,p_user,'resume');
  update public.owner_campaigns set owner_paused_at=null,updated_at=now() where id=p_id;
 elsif c.ends_at<=now() then
  select coalesce((config->>'maxCampaigns')::integer,5) into max_count from public.owner_campaign_settings where id;
  select count(*) into active_count from public.owner_campaigns where salon_id=p_salon and id<>p_id
   and status in ('awaiting_payment','pending_review','running','paused');
  if active_count>=max_count then raise exception 'Finish or cancel another campaign before starting a new period.'; end if;
  -- Settle the expired period through the existing release trigger. Any failed
  -- restart raises, atomically preserving the previous pause and wallet state.
  if c.status='paused' then update public.owner_campaigns set status='completed',updated_at=now() where id=p_id; end if;
  update public.owner_campaigns set keep_running=true,owner_paused_at=null where id=p_id;
  if not public.campaign_credit_renew_before_pause(p_id) then
   raise exception 'The campaign remains paused. Check available credits and its source before resuming.';
  end if;
  update public.owner_campaigns set owner_paused_at=null,keep_running=c.keep_running,updated_at=now() where id=p_id;
 else raise exception 'This campaign cannot be resumed.';
 end if;
end $$;

-- Both selectors reject paused intent even if a stale service writer has left
-- a contradictory status. Admission rechecks it under the accounting locks.
do $$declare definition text; signature text; target text:='c.status=''running''';
begin
 foreach signature in array array['public.owner_campaign_candidates(jsonb,text,uuid)',
  'public.owner_campaign_search_candidates(jsonb,text,uuid,text,text,text)'] loop
  definition:=pg_get_functiondef(signature::regprocedure);
  if position(target in definition)=0 then raise exception 'Unexpected Campaign selection definition: %',signature; end if;
  execute replace(definition,target,target||' and c.owner_paused_at is null');
 end loop;
 definition:=pg_get_functiondef('public.campaign_credit_order_before_workspace(uuid,uuid,integer,boolean)'::regprocedure);
 target:='c.keep_running and c.status in (''running'',''completed'')';
 if position(target in definition)=0 then raise exception 'Unexpected Campaign top-up demand definition'; end if;
 -- Exclude paused campaign renewal demand; retain separately consented wallet
 -- low-balance top-ups and other campaigns' demand without changing amounts.
 execute replace(definition,target,'c.owner_paused_at is null and '||target);
 definition:=pg_get_functiondef('public.campaign_credit_order_before_workspace(uuid,uuid,integer,boolean)'::regprocedure);
 target:='a.auto_fund and a.status=''awaiting_payment''';
 if position(target in definition)=0 then raise exception 'Unexpected Campaign auto-fund demand definition'; end if;
 execute replace(definition,target,'a.owner_paused_at is null and '||target);
end $$;

alter function public.owner_campaign_admit(uuid,text,text,jsonb,uuid,uuid) rename to owner_campaign_admit_before_pause;
create function public.owner_campaign_admit(p_id uuid,p_visitor text,p_kind text,p_area jsonb,p_viewer uuid default null,p_nonce uuid default null) returns boolean
language plpgsql security definer set search_path=public as $$
declare c public.owner_campaigns;
begin
 perform 1 from public.campaign_wallets where salon_id=(select salon_id from public.owner_campaigns where id=p_id) for update;
 select * into c from public.owner_campaigns where id=p_id for update;
 if c.owner_paused_at is not null then return false; end if;
 return public.owner_campaign_admit_before_pause(p_id,p_visitor,p_kind,p_area,p_viewer,p_nonce);
end $$;

-- An administrator must not impersonate an owner's Resume instruction through
-- the older administrative wrapper. Other existing admin controls are retained.
do $$declare definition text; target text:='elsif p_action=''resume'' then';
begin
 definition:=pg_get_functiondef('public.admin_manage_campaign(uuid,timestamptz,text,text,text,text)'::regprocedure);
 if position(target in definition)=0 then raise exception 'Unexpected admin campaign resume definition'; end if;
 execute replace(definition,target,target||E'\n  if c.owner_paused_at is not null then raise exception ''The owner must resume this paused campaign.''; end if;');
end $$;

create function public.campaign_pause_reminder(p_id uuid) returns integer
language plpgsql security definer set search_path=public as $$
declare c public.owner_campaigns; reminder public.campaign_pause_reminders; notice uuid; emitted integer:=0;
begin
 -- Serialize against Resume, Pause, expiry settlement and cancellation before
 -- inspecting eligibility. Notification insertion and dedupe commit together.
 perform 1 from public.campaign_wallets where salon_id=(select salon_id from public.owner_campaigns where id=p_id) for update;
 select * into c from public.owner_campaigns where id=p_id for update;
 if c.id is null then return 0; end if;
 if c.owner_paused_at is null or c.status<>'paused' or c.ends_at is null or c.ends_at<=now() or c.archived_at is not null then
  update public.campaign_pause_reminders set cancelled_at=now() where campaign_id=p_id and processed_at is null and cancelled_at is null;
  return 0;
 end if;
 for reminder in select * from public.campaign_pause_reminders where campaign_id=p_id and episode_id=c.pause_episode_id
   and due_at<=now() and processed_at is null and cancelled_at is null order by milestone_hours for update loop
  notice:=null;
  if coalesce(public.lifecycle_user_is_salon_owner(c.salon_id,c.owner_id,false),false) then
   insert into public.app_notifications(account_id,salon_id,recipient_user_id,recipient_kind,notification_type,title,body,href,event_key)
   select l.account_id,c.salon_id,c.owner_id,'owner_manager','campaign_pause_reminder','Your campaign is still paused',
    case reminder.milestone_hours when 24 then 'Your campaign has been paused for 24 hours. It stays paused until you choose Resume.'
     else 'Your campaign has been paused for 7 days. It stays paused until you choose Resume.' end,
    '/campaigns?campaign='||c.id,'campaign-pause:'||c.id||':'||c.pause_episode_id||':'||reminder.milestone_hours||':'||c.owner_id
   from public.locations l where l.id=c.salon_id
   on conflict(recipient_user_id,event_key) where event_key is not null do nothing returning id into notice;
  end if;
  -- A notification preference or lost owner access can suppress insertion.
  -- Record the processed milestone, so worker retries cannot create a catch-up.
  update public.campaign_pause_reminders set processed_at=now(),notification_id=notice
   where campaign_id=p_id and episode_id=reminder.episode_id and milestone_hours=reminder.milestone_hours;
  if notice is not null then emitted:=emitted+1; end if;
 end loop;
 return emitted;
end $$;

create or replace view public.campaign_credit_queue_items as
 select 'topup'::text phase,w.salon_id item_id from public.campaign_wallets w where w.installed and w.auto_topup_enabled
 union all
 select 'fund',c.id from public.owner_campaigns c where c.status='awaiting_payment' and c.auto_fund and c.owner_paused_at is null
 union all
 select 'renew',c.id from public.owner_campaigns c where c.keep_running and c.status in ('running','completed') and c.ends_at<=now() and c.owner_paused_at is null
 union all
 select distinct 'close',c.salon_id from public.owner_campaigns c where c.status in ('running','paused') and c.ends_at<=now()
 union all
 select distinct 'pause_reminders',c.id from public.owner_campaigns c join public.campaign_pause_reminders r on r.campaign_id=c.id and r.episode_id=c.pause_episode_id
 where c.owner_paused_at is not null and c.status='paused' and c.ends_at>now() and c.archived_at is null
 and r.due_at<=now() and r.processed_at is null and r.cancelled_at is null;
revoke all on public.campaign_credit_queue_items from public,anon,authenticated;
grant select on public.campaign_credit_queue_items to service_role;
revoke all on function public.campaign_credit_renew_before_pause(uuid),public.campaign_credit_fund_before_pause(uuid,uuid,uuid,boolean),public.owner_campaign_admit_before_pause(uuid,text,text,jsonb,uuid,uuid),public.campaign_pause_schedule(),public.campaign_owner_pause_guard() from public,anon,authenticated,service_role;
revoke all on function public.owner_campaign_change(uuid,uuid,uuid,text),public.owner_campaign_resume(uuid,uuid,uuid,uuid),public.campaign_credit_renew(uuid),public.campaign_credit_fund(uuid,uuid,uuid,boolean),public.campaign_pause_reminder(uuid),public.owner_campaign_admit(uuid,text,text,jsonb,uuid,uuid) from public,anon,authenticated;
grant execute on function public.owner_campaign_change(uuid,uuid,uuid,text),public.owner_campaign_resume(uuid,uuid,uuid,uuid),public.campaign_credit_renew(uuid),public.campaign_credit_fund(uuid,uuid,uuid,boolean),public.campaign_pause_reminder(uuid),public.owner_campaign_admit(uuid,text,text,jsonb,uuid,uuid) to service_role;

notify pgrst,'reload schema';
commit;
