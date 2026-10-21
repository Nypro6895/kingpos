-- Durable scheduling metadata only. Monetary changes remain in the existing
-- wallet-first, idempotent credit RPCs. Claims commit before any financial RPC.
begin;
create table public.campaign_credit_queue_progress (
  phase text not null check (phase in ('topup','fund','renew','close','pause_reminders')),
  item_id uuid not null,
  attempted_at timestamptz not null default '-infinity',
  last_run uuid,
  lease_token uuid,
  lease_until timestamptz,
  primary key (phase,item_id)
);
alter table public.campaign_credit_queue_progress enable row level security;
revoke all on public.campaign_credit_queue_progress from public,anon,authenticated;
grant select,insert,update,delete on public.campaign_credit_queue_progress to service_role;
create index campaign_credit_queue_attempt_idx on public.campaign_credit_queue_progress(phase,attempted_at,item_id);

-- The pause lifecycle migration extends this view with eligible reminders.
create view public.campaign_credit_queue_items as
  select 'topup'::text phase,w.salon_id item_id from public.campaign_wallets w
    where w.installed and w.auto_topup_enabled
  union all
  select 'fund',c.id from public.owner_campaigns c where c.status='awaiting_payment' and c.auto_fund
  union all
  select 'renew',c.id from public.owner_campaigns c
    where c.keep_running and c.status in ('running','completed') and c.ends_at<=now()
  union all
  select distinct 'close',c.salon_id from public.owner_campaigns c
    where c.status in ('running','paused') and c.ends_at<=now();
revoke all on public.campaign_credit_queue_items from public,anon,authenticated;
grant select on public.campaign_credit_queue_items to service_role;

create function public.campaign_credit_queue_claim(p_phase text,p_run uuid,p_limit integer default 1,p_seed boolean default true)
returns jsonb language plpgsql security definer set search_path=public as $$
declare result jsonb;
begin
  if p_phase not in ('topup','fund','renew','close','pause_reminders') or p_run is null
    or p_limit is null or p_limit<1 or p_limit>100 then
    raise exception 'Invalid campaign queue claim';
  end if;
  if p_seed then
    insert into public.campaign_credit_queue_progress(phase,item_id)
      select c.phase,c.item_id from public.campaign_credit_queue_items c where c.phase=p_phase
        and not exists(select 1 from public.campaign_credit_queue_progress q where q.phase=c.phase and q.item_id=c.item_id)
      order by c.phase,c.item_id on conflict do nothing;
  end if;
  with next_items as (
    select q.phase,q.item_id from public.campaign_credit_queue_progress q
    where q.phase=p_phase and q.last_run is distinct from p_run
      and (q.lease_until is null or q.lease_until<=clock_timestamp())
      and exists(select 1 from public.campaign_credit_queue_items c where c.phase=q.phase and c.item_id=q.item_id)
    order by q.attempted_at,q.item_id for update of q skip locked limit p_limit
  ), claimed as (
    update public.campaign_credit_queue_progress q
    set attempted_at=clock_timestamp(),last_run=p_run,lease_token=gen_random_uuid(),lease_until=clock_timestamp()+interval '5 minutes'
    from next_items n where q.phase=n.phase and q.item_id=n.item_id
    returning q.item_id,q.lease_token
  ) select coalesce(jsonb_agg(to_jsonb(c)),'[]'::jsonb) into result from claimed c;
  return jsonb_build_object('items',result,'pending',exists(
    select 1 from public.campaign_credit_queue_progress q
    where q.phase=p_phase and q.last_run is distinct from p_run
      and exists(select 1 from public.campaign_credit_queue_items c where c.phase=q.phase and c.item_id=q.item_id)
  ));
end $$;

create function public.campaign_credit_queue_finish(p_phase text,p_item uuid,p_token uuid)
returns boolean language plpgsql security definer set search_path=public as $$
declare touched integer;
begin
  -- A late worker must never release a newer worker's lease.
  update public.campaign_credit_queue_progress set lease_token=null,lease_until=null
    where phase=p_phase and item_id=p_item and lease_token=p_token;
  get diagnostics touched=row_count;
  return touched=1;
end $$;
revoke all on function public.campaign_credit_queue_claim(text,uuid,integer,boolean),public.campaign_credit_queue_finish(text,uuid,uuid) from public,anon,authenticated;
grant execute on function public.campaign_credit_queue_claim(text,uuid,integer,boolean),public.campaign_credit_queue_finish(text,uuid,uuid) to service_role;
commit;
