begin;
-- Persist only request identity/hash, so losing the browser response does not
-- force the Owner to start another standalone payment. Cancellation leaves a
-- tombstone that also blocks an older request still finishing in another tab.
create table public.check_writer_creation_requests (
 id uuid primary key,salon_id uuid not null references public.locations(id),
 actor_id uuid not null references public.users(id),request_hash text,
 canceled_at timestamptz,created_at timestamptz not null default clock_timestamp()
);
alter table public.check_writer_creation_requests enable row level security;
revoke all on public.check_writer_creation_requests from public,anon,authenticated;
grant all on public.check_writer_creation_requests to service_role;
create function public.check_writer_reserve_creation(p_salon uuid,p_actor uuid,p_request uuid,p_hash text) returns void
language plpgsql security definer set search_path=pg_catalog,public as $$
declare r public.check_writer_creation_requests;
begin
 perform public.check_writer_assert(p_salon,p_actor,true);
 perform pg_advisory_xact_lock(hashtextextended('check-writer:'||p_salon,0));
 select * into r from public.check_writer_creation_requests where id=p_request for update;
 if r.id is not null then
 if r.salon_id<>p_salon or r.actor_id<>p_actor or r.canceled_at is not null or r.request_hash is distinct from p_hash then raise exception 'Creation request is canceled or changed. Recover its status before starting again.'; end if;
 else insert into public.check_writer_creation_requests(id,salon_id,actor_id,request_hash) values(p_request,p_salon,p_actor,p_hash); end if;
end $$;
create function public.check_writer_recover_creation(p_salon uuid,p_actor uuid,p_request uuid,p_cancel boolean default false) returns jsonb
language plpgsql security definer set search_path=pg_catalog,public as $$
declare r public.check_writer_creation_requests; b public.check_writer_batches; ids jsonb;
begin
 perform public.check_writer_assert(p_salon,p_actor,false);
 perform pg_advisory_xact_lock(hashtextextended('check-writer:'||p_salon,0));
 select * into b from public.check_writer_batches where id=p_request;
 if b.id is not null then
 if b.salon_id<>p_salon or b.actor_id<>p_actor then raise exception 'Request not found.'; end if;
 select jsonb_agg(id order by number) into ids from public.check_writer_checks where batch_id=p_request and salon_id=p_salon;
 return jsonb_build_object('status','created','ids',ids);
 end if;
 select * into r from public.check_writer_creation_requests where id=p_request for update;
 if r.id is not null and (r.salon_id<>p_salon or r.actor_id<>p_actor) then raise exception 'Request not found.'; end if;
 if p_cancel then
 insert into public.check_writer_creation_requests(id,salon_id,actor_id,canceled_at) values(p_request,p_salon,p_actor,clock_timestamp())
 on conflict(id) do update set canceled_at=coalesce(check_writer_creation_requests.canceled_at,clock_timestamp());
 return jsonb_build_object('status','canceled');
 end if;
 return jsonb_build_object('status',case when r.canceled_at is not null then 'canceled' else 'pending' end);
end $$;
revoke all on function public.check_writer_reserve_creation(uuid,uuid,uuid,text) from public,anon,authenticated;
revoke all on function public.check_writer_recover_creation(uuid,uuid,uuid,boolean) from public,anon,authenticated;
grant execute on function public.check_writer_reserve_creation(uuid,uuid,uuid,text) to service_role;
grant execute on function public.check_writer_recover_creation(uuid,uuid,uuid,boolean) to service_role;
do $$ declare definition text; anchor text; begin
 definition:=pg_get_functiondef('public.check_writer_issue(uuid,uuid,uuid,text,integer,jsonb)'::regprocedure);
 anchor:='select * into b from public.check_writer_batches where id=p_batch;';
 if position(anchor in definition)=0 then raise exception 'Review issuance before adding recovery protection.'; end if;
 definition:=replace(definition,anchor,
 'if exists(select 1 from public.check_writer_creation_requests r where r.id=p_batch and (r.salon_id<>p_salon or r.actor_id<>p_actor or r.canceled_at is not null or r.request_hash is distinct from p_hash)) then raise exception ''Creation request is canceled or changed. Recover its status before starting again.''; end if;'||E'\n'||anchor);
 execute definition;
end $$;
-- One authorized preparation covers the whole batch; no partial counters and
-- no second app print/download dispatch from the same output ticket.
create table public.check_writer_outputs (
 id uuid primary key, salon_id uuid not null references public.locations(id),
 actor_id uuid not null references public.users(id), check_ids uuid[] not null,
 created_at timestamptz not null default clock_timestamp(),
 dispatched_at timestamptz, method text check(method in ('print','download'))
);
alter table public.check_writer_outputs enable row level security;
revoke all on public.check_writer_outputs from public,anon,authenticated;
grant all on public.check_writer_outputs to service_role;

create function public.check_writer_prepare_output(p_salon uuid,p_actor uuid,p_output uuid,p_ids uuid[],p_expected jsonb,p_reason text) returns void
language plpgsql security definer set search_path=pg_catalog,public as $$
declare c public.check_writer_checks; n integer;
begin
 perform public.check_writer_assert(p_salon,p_actor,true);
 if p_output is null or p_ids is null or cardinality(p_ids) not between 1 and 100
 or exists(select 1 from unnest(p_ids) id group by id having count(*)>1)
 or coalesce(length(p_reason),0)>500 then raise exception 'Invalid output request.'; end if;
 perform pg_advisory_xact_lock(hashtextextended('check-writer:'||p_salon,0));
 if exists(select 1 from public.check_writer_outputs where id=p_output) then raise exception 'Output request already used. Review History before printing again.'; end if;
 select count(*) into n from public.check_writer_checks where salon_id=p_salon and id=any(p_ids);
 if n<>cardinality(p_ids) then raise exception 'Checks could not load.'; end if;
 for c in select * from public.check_writer_checks where salon_id=p_salon and id=any(p_ids) order by number for update loop
 if c.status<>'issued' then raise exception 'Void checks cannot be printed.'; end if;
 if (p_expected->>c.id::text)::integer is distinct from c.delivery_count then raise exception 'Output changed. Review History before printing again.'; end if;
 if c.delivery_count>0 and coalesce(length(trim(p_reason)),0)=0 then raise exception 'Enter a reason to print again.'; end if;
 end loop;
 insert into public.check_writer_outputs(id,salon_id,actor_id,check_ids) values(p_output,p_salon,p_actor,p_ids);
 update public.check_writer_checks set delivery_count=delivery_count+1 where salon_id=p_salon and id=any(p_ids);
 insert into public.check_writer_events(salon_id,check_id,actor_id,action,reason)
 select p_salon,id,p_actor,'pdf_prepared',p_reason from unnest(p_ids) id;
end $$;

create function public.check_writer_dispatch_output(p_salon uuid,p_actor uuid,p_output uuid,p_method text) returns void
language plpgsql security definer set search_path=pg_catalog,public as $$
declare o public.check_writer_outputs;
begin
 perform public.check_writer_assert(p_salon,p_actor,true);
 if p_method not in ('print','download') or p_method is null then raise exception 'Invalid output method.'; end if;
 perform pg_advisory_xact_lock(hashtextextended('check-writer:'||p_salon,0));
 select * into o from public.check_writer_outputs where id=p_output and salon_id=p_salon and actor_id=p_actor for update;
 if o.id is null or o.dispatched_at is not null or o.created_at<clock_timestamp()-interval '5 minutes' then raise exception 'Output is used or expired. Prepare a new output from History.'; end if;
 if exists(select 1 from public.check_writer_checks where salon_id=p_salon and id=any(o.check_ids) and status<>'issued') then raise exception 'Void checks cannot be printed.'; end if;
 update public.check_writer_outputs set dispatched_at=clock_timestamp(),method=p_method where id=o.id;
 insert into public.check_writer_events(salon_id,check_id,actor_id,action)
 select p_salon,id,p_actor,p_method||'_dispatched' from unnest(o.check_ids) id;
end $$;
revoke all on function public.check_writer_prepare_output(uuid,uuid,uuid,uuid[],jsonb,text) from public,anon,authenticated;
revoke all on function public.check_writer_dispatch_output(uuid,uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.check_writer_prepare_output(uuid,uuid,uuid,uuid[],jsonb,text) to service_role;
grant execute on function public.check_writer_dispatch_output(uuid,uuid,uuid,text) to service_role;

-- Harden nullable reason handling. Recording a previous physical print result
-- remains possible after expiry; only preparing a new negotiable PDF needs pay.
do $$ declare definition text; begin
 definition:=pg_get_functiondef('public.check_writer_event(uuid,uuid,uuid,text,text)'::regprocedure);
 definition:=replace(definition,'p_action<>''void''','p_action=''pdf_prepared''');
 definition:=replace(definition,'length(trim(p_reason)) not between 1 and 500','coalesce(length(trim(p_reason)),0) not between 1 and 500');
 execute definition;
end $$;

-- A provider-verified canceled subscription must not permanently block a later
-- subscription. Never clear active, past-due, unknown or merely refunded links.
do $$ declare definition text; anchor text; begin
 definition:=pg_get_functiondef('public.market_card_reserve(uuid,text)'::regprocedure);
 anchor:='select public_config into cfg from platform_payment_settings where id;';
 if position(anchor in definition)=0 then raise exception 'Review current card reservation before adding Check Writer renewal.'; end if;
 definition:=replace(definition,anchor,
 'if p_plugin=''print-check'' then
 update public.check_writer_subscriptions cw_sub set stripe_subscription=null,stripe_checkout=null,updated_at=now()
 where cw_sub.salon_id=p_salon and (cw_sub.paid_until is null or cw_sub.paid_until<=now())
 and exists(select 1 from public.market_card_purchases cw_purchase where cw_purchase.salon_id=p_salon and cw_purchase.plugin_id=''print-check'' and cw_purchase.subscription_id=cw_sub.stripe_subscription and cw_purchase.status=''canceled'' and cw_purchase.synced_at is not null);
 end if;'||E'\n'||anchor);
 execute definition;
end $$;

-- Owner explicitly approved USD 4.90/month per salon on 2026-10-28.
update public.market_billing_catalog set name='Check Writer',publisher='Reylumi',price_cents=490,
 published=true,fulfillment_ready=true,version=version+1 where plugin_id='print-check';
commit;
