begin;

-- Only the server may call this after validating its signed, short-lived delivery
-- ticket and binding it to the current visitor/account. A click never creates a
-- view, spends credits or relaxes any existing billable-view admission rule.
create function public.owner_campaign_click(p_id uuid,p_visitor text,p_area jsonb,p_viewer uuid default null,p_nonce uuid default null)
returns boolean language plpgsql security definer set search_path=public as $$
declare c public.owner_campaigns; sid uuid; accepted integer;
begin
 if p_visitor is null or p_visitor !~ '^[0-9a-f]{64}$' or p_nonce is null then return false; end if;
 select salon_id into sid from public.owner_campaigns where id=p_id;
 if sid is null then return false; end if;
 -- Match the wallet -> visitor -> campaign lock order used for view admission.
 perform 1 from public.campaign_wallets where salon_id=sid for update;
 perform pg_advisory_xact_lock(hashtextextended('campaign-visitor:'||p_visitor,0));
 select * into c from public.owner_campaigns where id=p_id for update;
 if not coalesce((select (config->>'enabled')::boolean from public.owner_campaign_settings where id),false)
  or not public.campaign_plugin_installed(sid) or c.approved_at is null or c.payment_reference is null
  or c.owner_paused_at is not null or c.starts_at is null or c.starts_at>now() or c.ends_at is null or c.ends_at<=now()
  or not (c.status='running' or (c.status='completed' and (c.views>=c.credit_view_limit or c.spent_cents>=c.total_price_cents)))
  or public.owner_campaign_post(c.source_type,c.source_id,sid) is null
  or not coalesce(public.lifecycle_user_is_salon_owner(sid,c.owner_id,false),false)
  or (p_viewer is not null and coalesce(public.lifecycle_user_is_salon_owner(sid,p_viewer,true),false))
  or not coalesce(public.owner_campaign_area_matches(c,p_area),false) then return false;
 end if;
 -- Retain the existing unique-click-per-visitor/campaign definition. Replays
 -- acknowledge the original click without extending its attribution window.
 if exists(select 1 from public.owner_campaign_events where campaign_id=p_id and visitor_hash=p_visitor and kind='click') then return true; end if;
 insert into public.owner_campaign_events(campaign_id,visitor_hash,day,kind,ordinal,nonce)
 values(p_id,p_visitor,(now() at time zone 'America/Chicago')::date,'click',1,p_nonce) on conflict do nothing;
 get diagnostics accepted=row_count;
 if accepted=0 then return false; end if;
 update public.owner_campaigns set clicks=clicks+1,updated_at=now() where id=p_id;
 if p_viewer is not null then
  insert into public.owner_campaign_attribution(user_id,source_type,source_id,campaign_id,clicked_at)
  values(p_viewer,c.source_type,c.source_id,p_id,now())
  on conflict(user_id,source_type,source_id) do update set campaign_id=excluded.campaign_id,clicked_at=excluded.clicked_at;
 end if;
 return true;
end $$;
revoke all on function public.owner_campaign_click(uuid,text,jsonb,uuid,uuid) from public,anon,authenticated;
grant execute on function public.owner_campaign_click(uuid,text,jsonb,uuid,uuid) to service_role;

-- Add a read-only reporting contract. Keep the original daily-results signature
-- compatible with older web/native clients. No accounting reconciliation on read.
create function public.owner_campaign_report(p_salon uuid,p_owner uuid,p_campaign uuid,p_days integer default 7)
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare c public.owner_campaigns; reason text; series jsonb; outcomes jsonb;
begin
 if not coalesce(public.lifecycle_user_is_salon_owner(p_salon,p_owner,false),false) then raise exception 'Owner access required.'; end if;
 if p_days is null or p_days not in (7,30,90) then raise exception 'Choose a valid result period.'; end if;
 select * into c from public.owner_campaigns where id=p_campaign and salon_id=p_salon;
 if c.id is null then raise exception 'Campaign not found.'; end if;
 reason:=case
  when c.status='awaiting_payment' then 'credits_needed'
  when c.status='pending_review' then 'in_review'
  when c.status='rejected' then 'rejected'
  when c.status='cancelled' then 'cancelled'
  when c.owner_paused_at is not null then 'owner_paused'
  when c.status='completed' then 'completed'
  when not coalesce((select (config->>'enabled')::boolean from public.owner_campaign_settings where id),false) then 'platform_disabled'
  when not public.campaign_plugin_installed(p_salon) then 'plugin_disabled'
  when public.owner_campaign_post(c.source_type,c.source_id,p_salon) is null then 'source_unavailable'
  when not coalesce(public.lifecycle_user_is_salon_owner(p_salon,c.owner_id,false),false) then 'owner_unavailable'
  when c.status='paused' then 'paused'
  when c.ends_at<=now() then 'period_ended'
  when c.spent_cents>=c.total_price_cents or c.views>=c.credit_view_limit then 'limit_reached'
  when c.starts_at>now() then 'scheduled'
  when c.approved_at is null or c.payment_reference is null or c.starts_at is null or c.ends_at is null then 'not_ready'
  else 'eligible' end;
 with activity as (
  select e.day,e.kind from public.owner_campaign_events e where e.campaign_id=p_campaign
  union all
  select (v.created_at at time zone 'America/Chicago')::date,v.kind from public.owner_campaign_conversions v where v.campaign_id=p_campaign
 ), daily as (
  select a.day,count(*) filter(where a.kind='view') as views,count(*) filter(where a.kind='click') as clicks,
   count(*) filter(where a.kind='like') as likes,count(*) filter(where a.kind='comment') as comments,count(*) filter(where a.kind='book') as bookings
  from activity a where a.day between (now() at time zone 'America/Chicago')::date-(p_days-1) and (now() at time zone 'America/Chicago')::date
  group by a.day
 ) select coalesce(jsonb_agg(to_jsonb(d) order by d.day),'[]'::jsonb) into series from daily d;
 -- These are current states of the original attribution evidence, not a claim
 -- that every appointment or every guest has been tracked.
 select jsonb_build_object('completed',count(*) filter(where b.status='completed'),
  'cancelled',count(*) filter(where b.status='cancelled'),
  'other',count(*) filter(where b.id is not null and b.status not in ('completed','cancelled')),
  'unavailable',count(*) filter(where b.id is null)) into outcomes
 from public.owner_campaign_conversions v left join public.bookings b
  on b.id=v.evidence_id and b.salon_id=p_salon and b.customer_user_id=v.user_id
 where v.campaign_id=p_campaign and v.kind='book';
 return jsonb_build_object('days',series,'deliveryReason',reason,'checkedAt',statement_timestamp(),
  'lastViewAt',(select max(created_at) from public.owner_campaign_events where campaign_id=p_campaign and kind='view'),
  'bookingOutcomes',outcomes);
end $$;
revoke all on function public.owner_campaign_report(uuid,uuid,uuid,integer) from public,anon,authenticated;
grant execute on function public.owner_campaign_report(uuid,uuid,uuid,integer) to service_role;
commit;
