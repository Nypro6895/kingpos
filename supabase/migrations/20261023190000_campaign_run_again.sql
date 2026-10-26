begin;

alter table public.owner_campaigns add column run_again_of uuid references public.owner_campaigns(id);
alter table public.owner_campaigns add column approved_content_snapshot jsonb;
alter table public.owner_campaigns add constraint campaign_run_again_different_id check (run_again_of is distinct from id);
create index campaign_run_again_history on public.owner_campaigns(run_again_of) where run_again_of is not null;

-- Keep approval attached to the actual post content, including separately stored
-- Beauty media. Timestamps and engagement counters are not creative changes.
create function public.campaign_content_snapshot_read(p_type text,p_source uuid,p_salon uuid)
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare item jsonb; media jsonb; source_table text;
begin
 source_table:=case when p_type='custom' then 'owner_campaign_creatives' else post_safety_table(p_type) end;
 if source_table is null then return null; end if;
 execute format('select to_jsonb(p) from public.%I p where id=$1',source_table) into item using p_source;
 if item is null or owner_campaign_post(p_type,p_source,p_salon) is null then return null; end if;
 item:=item-array['created_at','updated_at','edited_at','views','view_count','likes','like_count','comments','comment_count','save_count','is_pinned'];
 if p_type='beauty_post' then
  select coalesce(jsonb_agg(to_jsonb(m)-'created_at' order by m.display_order,m.role,m.id),'[]'::jsonb)
  into media from public.beauty_post_media m where m.post_id=p_source;
  item:=item||jsonb_build_object('campaign_media',media);
 end if;
 return item;
end $$;

create function public.campaign_content_snapshot(p_type text,p_source uuid,p_salon uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare source_table text;
begin
 source_table:=case when p_type='custom' then 'owner_campaign_creatives' else post_safety_table(p_type) end;
 if source_table is null then return null; end if;
 execute format('select 1 from public.%I where id=$1 for share',source_table) using p_source;
 return campaign_content_snapshot_read(p_type,p_source,p_salon);
end $$;

-- The same approval/content rule is used before creation, delayed reservation,
-- automatic purchase intent and processing claim. Reading demand never starts
-- a campaign or reserves credits, and ordinary new campaigns remain unchanged.
create function public.campaign_run_again_source_eligible(p_previous uuid,p_salon uuid,p_type text,p_source uuid,p_snapshot jsonb)
returns boolean language sql stable security definer set search_path=public as $$
 select exists(select 1 from public.owner_campaigns previous where previous.id=p_previous and previous.salon_id=p_salon
  and previous.approved_at is not null and previous.ends_at<=now()
  and previous.status in ('completed','running','paused')
  and not (previous.status in ('running','paused') and previous.keep_running)
  and to_jsonb(previous)->>'owner_paused_at' is null and to_jsonb(previous)->>'archived_at' is null
  and previous.source_type=p_type and previous.source_id=p_source
  and previous.approved_content_snapshot is not null and previous.approved_content_snapshot=p_snapshot
  and public.campaign_content_snapshot_read(p_type,p_source,p_salon)=p_snapshot);
$$;

create function public.campaign_run_again_funding_eligible(p_id uuid)
returns boolean language sql stable security definer set search_path=public as $$
 select coalesce((select c.run_again_of is null or public.campaign_run_again_source_eligible(
  c.run_again_of,c.salon_id,c.source_type,c.source_id,c.approved_content_snapshot)
  from public.owner_campaigns c where c.id=p_id),false);
$$;

do $$ declare definition text; target text:='and a.total_price_cents>w.available_credits'; begin
 if to_regprocedure('public.campaign_credit_has_active_demand(uuid,uuid)') is not null then
  definition:=pg_get_functiondef('public.campaign_credit_has_active_demand(uuid,uuid)'::regprocedure);
  if (length(definition)-length(replace(definition,target,'')))/length(target)<>1 then raise exception 'Campaign active demand source changed; review migration.'; end if;
  execute replace(definition,target,target||' and public.campaign_run_again_funding_eligible(a.id)');
 end if;
end $$;

-- Existing custom ads are write-once. Existing salon posts have an enforced
-- updated_at trigger, so only content last changed before approval is reusable.
-- Legacy Beauty media has no modification timestamp; require a fresh reviewed
-- campaign rather than inventing historical approval evidence for that content.
do $$ declare c owner_campaigns; item jsonb; changed_at timestamptz; begin
 for c in select * from owner_campaigns where approved_at is not null and source_type<>'beauty_post' loop
  item:=owner_campaign_post(c.source_type,c.source_id,c.salon_id);
  changed_at:=case when c.source_type='custom' then nullif(item->>'created_at','')::timestamptz else nullif(item->>'updated_at','')::timestamptz end;
  if changed_at is not null and changed_at<=c.approved_at
   and c.title=left(coalesce(nullif(item->>'title',''),nullif(item->>'caption',''),'Your post'),120) then
   update owner_campaigns set approved_content_snapshot=campaign_content_snapshot(c.source_type,c.source_id,c.salon_id) where id=c.id;
  end if;
 end loop;
end $$;

create function public.campaign_capture_approved_content() returns trigger
language plpgsql security definer set search_path=public as $$
begin
 if new.run_again_of is null and old.approved_at is null and new.approved_at is not null then
  new.approved_content_snapshot:=campaign_content_snapshot(new.source_type,new.source_id,new.salon_id);
  if new.approved_content_snapshot is null then raise exception 'Post is no longer available.'; end if;
 end if;
 return new;
end $$;
create trigger campaign_capture_approved_content before update of approved_at on public.owner_campaigns
for each row execute function public.campaign_capture_approved_content();

-- The existing funding RPC still owns wallet locks, reservations, ledger keys
-- and retries. Transform its status before any review-notice trigger can run;
-- this also covers funding later from the credit scheduler or Add credits flow.
create function public.campaign_start_approved_run_again() returns trigger
language plpgsql security definer set search_path=public as $$
declare previous owner_campaigns; current_content jsonb;
begin
 if new.run_again_of is not null and old.status='awaiting_payment' and new.status='pending_review' then
  -- Funding already holds the salon wallet and this new campaign. Hold its
  -- historical parent while checking approval, including against direct writes.
  select * into previous from owner_campaigns where id=new.run_again_of and salon_id=new.salon_id for share;
  current_content:=campaign_content_snapshot(new.source_type,new.source_id,new.salon_id);
  if not campaign_run_again_source_eligible(previous.id,new.salon_id,new.source_type,new.source_id,new.approved_content_snapshot)
   or current_content is distinct from new.approved_content_snapshot
   or not coalesce(lifecycle_user_is_salon_owner(new.salon_id,new.owner_id,false),false) then
   raise exception 'This ad content changed or is no longer available. Create a new campaign for review.';
  end if;
  new.status:='running';
  new.approved_at:=previous.approved_at;
  new.starts_at:=now();
  new.ends_at:=now()+make_interval(days=>new.days);
 end if;
 return new;
end $$;
create trigger campaign_start_approved_run_again before update of status on public.owner_campaigns
for each row execute function public.campaign_start_approved_run_again();

-- Report the final trigger-adjusted status to every existing funding caller.
do $$ declare definition text; funding_function regprocedure; target text:='return ''pending_review'';'; begin
 -- Newer production preserves owner-held pauses in a public wrapper. Change
 -- only the underlying accounting return and retain that wrapper and its ACL.
 funding_function:=coalesce(to_regprocedure('public.campaign_credit_fund_before_pause(uuid,uuid,uuid,boolean)'),to_regprocedure('public.campaign_credit_fund(uuid,uuid,uuid,boolean)'));
 definition:=pg_get_functiondef(funding_function);
 if definition is null or (length(definition)-length(replace(definition,target,'')))/length(target)<>1 then raise exception 'Campaign funding source changed; review migration.'; end if;
 execute replace(definition,'return ''pending_review'';','return (select status from public.owner_campaigns where id=p_id);');
end $$;

create function public.campaign_run_again(p_expected bigint,p_id uuid,p_salon uuid,p_user uuid,p_previous uuid,p_days integer,p_limit integer)
returns uuid language plpgsql security definer set search_path=public as $$
declare previous owner_campaigns; existing owner_campaigns; current_content jsonb; cid uuid;
begin
 if not coalesce(lifecycle_user_is_salon_owner(p_salon,p_user,false),false) then raise exception 'Owner access required.'; end if;
 if p_id is null or p_previous is null or p_id=p_previous then raise exception 'Reopen the ad and try again.'; end if;
 -- Match normal creation lock order, including its shared pricing-version lock.
 perform 1 from owner_campaign_settings where id for share;
 perform 1 from campaign_wallets where salon_id=p_salon for update;
 perform pg_advisory_xact_lock(hashtextextended('campaign:'||p_salon::text,0));
 select * into existing from owner_campaigns where id=p_id;
 if existing.id is not null then
  if existing.salon_id is distinct from p_salon or existing.owner_id is distinct from p_user or existing.run_again_of is distinct from p_previous then
   raise exception 'Reopen the ad and try again.';
  end if;
  perform campaign_credit_fund(p_id,p_salon,p_user,existing.keep_running);
  return p_id;
 end if;
 select * into previous from owner_campaigns where id=p_previous and salon_id=p_salon for update;
 if previous.id is null or previous.approved_at is null or previous.ends_at is null or previous.ends_at>now()
  or to_jsonb(previous)->>'owner_paused_at' is not null or to_jsonb(previous)->>'archived_at' is not null
  or previous.status not in ('completed','running','paused')
  or (previous.status in ('running','paused') and previous.keep_running) then
  raise exception 'Only an approved campaign whose dates have expired can run again.';
 end if;
 current_content:=campaign_content_snapshot(previous.source_type,previous.source_id,p_salon);
 if not campaign_run_again_source_eligible(previous.id,p_salon,previous.source_type,previous.source_id,current_content) then
  raise exception 'This ad content changed or its approval cannot be verified. Create a new campaign for review.';
 end if;
 if p_days is null or p_limit is null then raise exception 'Choose a valid duration and credit limit.'; end if;
 cid:=campaign_create_versioned(p_expected,p_id,p_salon,p_user,previous.source_type,previous.source_id,
  previous.area,previous.location,previous.country,previous.state,previous.city,previous.daily_views,
  p_days,p_limit,previous.keep_running,
  (select auto_topup_enabled and not payment_blocked from campaign_wallets where salon_id=p_salon));
 update owner_campaigns set title=previous.title,run_again_of=previous.id,
  approved_content_snapshot=previous.approved_content_snapshot where id=cid;
 perform campaign_credit_fund(cid,p_salon,p_user,previous.keep_running);
 return cid;
end $$;

revoke all on function public.campaign_content_snapshot(text,uuid,uuid),public.campaign_content_snapshot_read(text,uuid,uuid),
 public.campaign_run_again_source_eligible(uuid,uuid,text,uuid,jsonb),public.campaign_run_again_funding_eligible(uuid),public.campaign_capture_approved_content(),
 public.campaign_start_approved_run_again(),public.campaign_run_again(bigint,uuid,uuid,uuid,uuid,integer,integer) from public,anon,authenticated;
grant execute on function public.campaign_run_again(bigint,uuid,uuid,uuid,uuid,integer,integer) to service_role;
commit;
