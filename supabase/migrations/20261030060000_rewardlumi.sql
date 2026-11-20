begin;
-- Rewards are salon discounts, never a payment tender or a global cash wallet.
create table public.reward_programs (
 salon_id uuid primary key references public.locations(id), enabled boolean not null default false,
 nearby boolean not null default false, rules jsonb not null default '{"spendCents":2000,"spendPoints":20,"welcomePoints":10,"firstBookingPoints":20,"visitPoints":0,"conversionPoints":30}',
 offers jsonb not null default '[{"id":"five-off","title":"$5 off","points":100,"valueCents":500,"minimumCents":4000}]',
 version integer not null default 1, updated_at timestamptz not null default now()
);
create table public.reward_members (
 salon_id uuid not null references public.locations(id), user_id uuid not null references public.users(id),
 joined_at timestamptz not null default now(), primary key(salon_id,user_id)
);
create table public.reward_ledger (
 id uuid primary key default gen_random_uuid(), salon_id uuid not null references public.locations(id), user_id uuid not null references public.users(id),
 delta integer not null, reason text not null, event_key text not null unique, ticket_id uuid references public.pos_tickets(id),
 created_at timestamptz not null default now()
);
create index reward_ledger_balance on public.reward_ledger(salon_id,user_id);
create table public.reward_conversions (
 booking_id uuid primary key references public.bookings(id), salon_id uuid not null references public.locations(id),
 post_id uuid not null references public.beauty_posts(id), author_id uuid not null references public.users(id),
 points integer not null check(points>=0), status text not null default 'pending' check(status in ('pending','earned','cancelled')),
 ticket_id uuid references public.pos_tickets(id), created_at timestamptz not null default now()
);
create table public.reward_requests (
 id uuid primary key default gen_random_uuid(), visit_id uuid not null unique references public.customer_visits(id),
 salon_id uuid not null references public.locations(id), user_id uuid not null references public.users(id),
 offer jsonb not null, status text not null check(status in ('requested','suggested','confirmed','redeemed','cancelled')),
 revision integer not null default 1, quote text, draft_token text, customer_consented boolean not null default false, ticket_id uuid unique references public.pos_tickets(id),
 expires_at timestamptz not null default now()+interval '12 hours', created_at timestamptz not null default now()
);
create table public.reward_ticket_rules (ticket_id uuid primary key references public.pos_tickets(id), rules jsonb not null);
create table public.reward_settlements (salon_id uuid not null references public.locations(id), request_id uuid not null, fingerprint text not null, result jsonb not null, primary key(salon_id,request_id));
-- Internal Reylumi promotion configuration; never exposed as Advertiser campaigns.
create table public.reward_internal_promotions (
 id uuid primary key default gen_random_uuid(), name text not null, starts_at timestamptz not null, ends_at timestamptz not null,
 template jsonb not null, status text not null default 'draft' check(status in ('draft','active','ended')), check(ends_at>starts_at)
);
create table public.reward_promotion_participants (
 promotion_id uuid not null references public.reward_internal_promotions(id), salon_id uuid not null references public.locations(id),
 confirmed_at timestamptz not null default now(), primary key(promotion_id,salon_id)
);
do $$ declare n text; begin foreach n in array array['reward_programs','reward_members','reward_ledger','reward_conversions','reward_requests','reward_ticket_rules','reward_internal_promotions','reward_promotion_participants'] loop
 execute format('alter table public.%I enable row level security',n);
 execute format('revoke all on table public.%I from anon,authenticated',n);
 end loop; end $$;
alter table public.reward_settlements enable row level security;
revoke all on table public.reward_settlements from anon,authenticated;

create function public.reward_lock(p_salon uuid,p_user uuid) returns void language sql security definer set search_path=public as $$
 select pg_advisory_xact_lock(hashtextextended('rewards:'||p_salon::text||':'||p_user::text,0)) $$;
create function public.reward_balance(p_salon uuid,p_user uuid) returns integer language sql stable security definer set search_path=public as $$
 select coalesce(sum(delta),0)::integer from reward_ledger where salon_id=p_salon and user_id=p_user $$;
create function public.reward_available(p_salon uuid,p_user uuid,p_except uuid default null) returns integer language sql stable security definer set search_path=public as $$
 select reward_balance(p_salon,p_user)-coalesce((select sum((offer->>'points')::integer) from reward_requests where salon_id=p_salon and user_id=p_user and status='confirmed' and expires_at>now() and id is distinct from p_except),0)::integer $$;
create function public.reward_join(p_salon uuid,p_user uuid) returns void language plpgsql security definer set search_path=public as $$
declare p reward_programs; inserted integer; begin
 select * into p from reward_programs where salon_id=p_salon and enabled; if not found or p_user is null then return; end if;
 perform reward_lock(p_salon,p_user);
 insert into reward_members(salon_id,user_id) values(p_salon,p_user) on conflict do nothing; get diagnostics inserted=row_count;
 if inserted>0 then insert into reward_ledger(salon_id,user_id,delta,reason,event_key) values(p_salon,p_user,(p.rules->>'welcomePoints')::integer,'Welcome','welcome:'||p_salon||':'||p_user) on conflict do nothing; end if;
end $$;

create function public.reward_view(p_salon uuid,p_user uuid,p_visit uuid default null) returns jsonb language plpgsql stable security definer set search_path=public as $$
declare p reward_programs; r reward_requests; held integer; begin
 select * into p from reward_programs where salon_id=p_salon;
 if p_visit is not null then select * into r from reward_requests where visit_id=p_visit and user_id=p_user; end if;
 held:=reward_balance(p_salon,p_user)-reward_available(p_salon,p_user);
 return jsonb_build_object('enabled',coalesce(p.enabled,false),'salonId',p_salon,'salonName',(select name from locations where id=p_salon),'visitId',p_visit,
 'available',greatest(0,reward_available(p_salon,p_user)),'reserved',held,
 'pending',coalesce((select sum(points) from reward_conversions where salon_id=p_salon and author_id=p_user and status='pending'),0),
 'offers',coalesce(p.offers,'[]'),'program',p.rules||jsonb_build_object('enabled',p.enabled,'nearby',p.nearby,'offers',p.offers),
 'request',case when r.id is null or (r.status<>'redeemed' and r.expires_at<=now()) then null else jsonb_build_object('id',r.id,'status',r.status,'title',r.offer->>'title','points',(r.offer->>'points')::integer,'valueCents',(r.offer->>'valueCents')::integer,'quote',r.quote,'revision',r.revision,'expires',r.expires_at) end,
 'history',coalesce((select jsonb_agg(x) from (select id,reason,delta,created_at as "at" from reward_ledger where salon_id=p_salon and user_id=p_user order by created_at desc,id limit 50)x),'[]'));
end $$;

-- Only authenticated owner can set terms. Limits protect all downstream arithmetic.
create function public.reward_owner(p_salon uuid,p_op text,p_args jsonb default '{}') returns jsonb language plpgsql security definer set search_path=public as $$
declare v jsonb; r jsonb; owner_offers jsonb; k text; n integer; begin
 if not coalesce(lifecycle_user_is_salon_owner(p_salon,current_public_user_id(),false),false) then raise exception 'Owner access required'; end if;
 insert into reward_programs(salon_id) values(p_salon) on conflict do nothing;
 if p_op='save' then
  v:=p_args->'program'; r:=v-array['enabled','nearby','offers']; owner_offers:=v->'offers';
  foreach k in array array['spendCents','spendPoints','welcomePoints','firstBookingPoints','visitPoints','conversionPoints'] loop
   if jsonb_typeof(r->k) is distinct from 'number' or not coalesce((r->>k)~'^\d+$',false) then raise exception 'Invalid earning rule'; end if;
   n:=(r->>k)::integer; if n<0 or n>100000 or (k='spendCents' and n<1) then raise exception 'Earning rule outside limits'; end if;
  end loop;
  if jsonb_typeof(owner_offers) is distinct from 'array' or jsonb_array_length(owner_offers)>20 then raise exception 'Invalid rewards'; end if;
  for v in select value from jsonb_array_elements(owner_offers) loop
   if coalesce(length(v->>'id'),0) not between 1 and 80 or coalesce(length(v->>'title'),0) not between 1 and 100
    or not coalesce((v->>'points')~'^[1-9]\d*$',false) or not coalesce((v->>'valueCents')~'^[1-9]\d*$',false) or not coalesce((v->>'minimumCents')~'^\d+$',false)
    or (v->>'points')::integer>100000 or (v->>'valueCents')::integer>100000 or (v->>'minimumCents')::integer>10000000 then raise exception 'Invalid reward offer'; end if;
   if nullif(v->>'serviceId','') is not null and not exists(select 1 from services where id=(v->>'serviceId')::uuid and salon_id=p_salon) then raise exception 'Service belongs to another salon'; end if;
  end loop;
  if (select count(*)<>count(distinct value->>'id') from jsonb_array_elements(owner_offers)) then raise exception 'Duplicate reward'; end if;
  update reward_programs set rules=r,offers=owner_offers,enabled=coalesce((p_args->'program'->>'enabled')::boolean,false),nearby=coalesce((p_args->'program'->>'nearby')::boolean,false),version=version+1,updated_at=now() where salon_id=p_salon;
 elsif p_op<>'load' then raise exception 'Unknown reward action'; end if;
 select rules||jsonb_build_object('enabled',enabled,'nearby',nearby,'offers',offers) into v from reward_programs where salon_id=p_salon;
 return jsonb_build_object('program',v,'members',(select count(*) from reward_members where salon_id=p_salon),
 'pendingConversions',(select count(*) from reward_conversions where salon_id=p_salon and status='pending'),'earnedConversions',(select count(*) from reward_conversions where salon_id=p_salon and status='earned'),
 'services',coalesce((select jsonb_agg(jsonb_build_object('id',id,'name',name,'price',base_price)) from services where salon_id=p_salon),'[]'));
end $$;

-- A conversion is frozen against the original post author, salon and rule at booking time.
create function public.reward_capture_booking() returns trigger language plpgsql security definer set search_path=public as $$
declare author uuid; pts integer; begin
 if new.source_reference_type='beauty_post' and new.source_reference_id is not null then
  select b.author_user_id,(p.rules->>'conversionPoints')::integer into author,pts from beauty_posts b
   join beauty_post_attributions a on a.post_id=b.id and a.salon_id=new.salon_id
   join reward_programs p on p.salon_id=a.salon_id and p.enabled
   where b.id=new.source_reference_id and b.post_type='before_after' and b.deleted_at is null and b.moderation_status='visible' and b.visibility='public';
  if author is not null and pts>0 and author is distinct from new.customer_user_id and not exists(select 1 from customers where id=new.customer_id and customer_user_id=author) then
   perform reward_join(new.salon_id,author);
   insert into reward_conversions(booking_id,salon_id,post_id,author_id,points) values(new.id,new.salon_id,new.source_reference_id,author,pts) on conflict do nothing;
  end if;
 end if;
 if new.status in ('cancelled','no_show') then update reward_conversions set status='cancelled' where booking_id=new.id and status='pending'; end if;
 return new;
end $$;
create trigger reward_capture_booking after insert or update on public.bookings for each row execute function public.reward_capture_booking();

-- Same visit request shared by personal, paired display and cashier. Suggestion never spends points.
create function public.reward_request_command(p_visit uuid,p_op text,p_args jsonb,p_customer boolean) returns jsonb language plpgsql security definer set search_path=public as $$
declare v customer_visits; u uuid; p reward_programs; r reward_requests; o jsonb; begin
 select * into v from customer_visits where id=p_visit for update;
 select customer_user_id into u from customers where id=v.customer_id and location_id=v.salon_id;
 if v.id is null or u is null then raise exception 'Link a personal account to this check-in to use rewards'; end if;
 if v.status in ('completed','cancelled') then return jsonb_build_object('view',reward_view(v.salon_id,u,v.id)); end if;
 perform reward_join(v.salon_id,u); perform reward_lock(v.salon_id,u);
 select * into p from reward_programs where salon_id=v.salon_id;
 select * into r from reward_requests where visit_id=v.id for update;
 if p_op in ('request','suggest') then
  if p.salon_id is null then raise exception 'Reward program unavailable'; end if;
  select value into o from jsonb_array_elements(p.offers) where value->>'id'=p_args->>'offerId';
  if o is null then raise exception 'Reward unavailable'; end if;
  if reward_available(v.salon_id,u,r.id)<(o->>'points')::integer then raise exception 'Not enough available points'; end if;
  insert into reward_requests(visit_id,salon_id,user_id,offer,status) values(v.id,v.salon_id,u,o,case when p_customer then 'requested' else 'suggested' end)
   on conflict(visit_id) do update set offer=excluded.offer,status=excluded.status,quote=null,draft_token=null,customer_consented=false,expires_at=now()+interval '12 hours',revision=reward_requests.revision+1;
  if p_customer and coalesce((p_args->>'consent')::boolean,false) then update reward_requests set customer_consented=true where visit_id=v.id; end if;
 elsif p_op='cancel' then
  if r.status<>'redeemed' then update reward_requests set status='cancelled',revision=revision+1 where id=r.id; end if;
 elsif p_op='confirm' then
  if not p_customer then raise exception 'Customer confirmation required'; end if;
  if r.id is null or r.status not in ('requested','suggested') or r.expires_at<=now() or r.quote is null
   or (p_args->>'revision')::integer is distinct from r.revision or p_args->>'quote' is distinct from r.quote then raise exception 'Ticket changed. Review the current reward.'; end if;
  if reward_available(v.salon_id,u,r.id)<(r.offer->>'points')::integer then raise exception 'Points already reserved on another visit'; end if;
  update reward_requests set status='confirmed',revision=revision+1 where id=r.id;
 elsif p_op<>'load' then raise exception 'Unknown reward action'; end if;
 return jsonb_build_object('view',reward_view(v.salon_id,u,v.id));
end $$;

create function public.reward_personal(p_op text,p_args jsonb default '{}') returns jsonb language plpgsql security definer set search_path=public as $$
declare u uuid:=current_public_user_id(); v customer_visits; s uuid; begin
 if u is null then raise exception 'Sign in required'; end if;
 if p_op='wallet' then
  return jsonb_build_object('cards',coalesce((select jsonb_agg(reward_view(salon_id,u)) from reward_members where user_id=u),'[]'));
 end if;
 select cv.* into v from customer_visits cv join customers c on c.id=cv.customer_id and c.customer_user_id=u where cv.id=(p_args->>'visitId')::uuid;
 if v.id is null then raise exception 'This visit does not belong to you'; end if;
 return reward_request_command(v.id,p_op,p_args,true);
end $$;

-- Canonical server quote excludes tip, discounts and staff identifiers from customer payload.
create function public.reward_quote(p_salon uuid,p_receipt jsonb,p_token text) returns jsonb language plpgsql security definer set search_path=public as $$
declare v customer_visits; r reward_requests; u uuid; sub numeric; disc numeric; eligible integer; q text; service_value integer; begin
 if nullif(p_receipt->>'customerId','') is null then return jsonb_build_object('view',null); end if;
 select * into v from customer_visits where salon_id=p_salon and customer_id=(p_receipt->>'customerId')::uuid and status in ('waiting','in_service','checkout')
  and (nullif(p_receipt->>'customerVisitId','') is null or id=(p_receipt->>'customerVisitId')::uuid) order by checked_in_at desc limit 1 for update;
 if v.id is null then return jsonb_build_object('view',null); end if;
 select customer_user_id into u from customers where id=v.customer_id and location_id=p_salon;
 if u is null then return jsonb_build_object('view',null); end if;
 perform reward_join(p_salon,u); perform reward_lock(p_salon,u);
 select coalesce(sum((x->>'total')::numeric),0) into sub from jsonb_array_elements(coalesce(p_receipt->'lines','[]')) x;
 if sub<0 or sub>1000000 then raise exception 'Invalid services total'; end if;
 disc:=greatest(0,coalesce((p_receipt->>'discountValue')::numeric,0));
 if p_receipt->>'discountType'='percentage' then disc:=round(sub*least(disc,100)/100,2); end if;
 eligible:=round(greatest(0,sub-disc)*100)::integer;
 q:=md5(jsonb_build_object('visit',v.id,'customer',v.customer_id,'lines',p_receipt->'lines','discount',disc,'eligible',eligible)::text);
 select * into r from reward_requests where visit_id=v.id for update;
 if r.id is not null and r.status in ('requested','suggested','confirmed') then
  if nullif(r.offer->>'serviceId','') is not null then
   select round(coalesce(sum((x->>'total')::numeric),0)*100)::integer into service_value from jsonb_array_elements(p_receipt->'lines') x where x->>'serviceId'=r.offer->>'serviceId';
  end if;
  if eligible<(r.offer->>'minimumCents')::integer or eligible<=(r.offer->>'valueCents')::integer or (service_value is not null and service_value<(r.offer->>'valueCents')::integer) then
   update reward_requests set quote=null,status=case when status='confirmed' then 'requested' else status end,customer_consented=case when status='confirmed' then false else customer_consented end,revision=revision+1 where id=r.id and (quote is not null or status='confirmed');
  elsif r.quote is distinct from q or r.draft_token is distinct from p_token then
   update reward_requests set quote=q,draft_token=p_token,status=case when status='confirmed' then 'requested' else status end,customer_consented=case when status='confirmed' then false else customer_consented end,revision=revision+1 where id=r.id;
   if r.quote is null and r.customer_consented and reward_available(p_salon,u,r.id)>=(r.offer->>'points')::integer then
    update reward_requests set status='confirmed' where id=r.id;
   end if;
  end if;
 end if;
 return jsonb_build_object('view',reward_view(p_salon,u,v.id)||jsonb_build_object('eligibleCents',eligible));
end $$;

create function public.reward_pos(p_salon uuid,p_op text,p_args jsonb default '{}',p_key uuid default null,p_signature text default null) returns jsonb language plpgsql security definer set search_path=public as $$
declare allowed boolean; v customer_visits; begin
 allowed:=coalesce(user_has_salon_permission(p_salon,array['tickets.create','tickets.manage']),false) or coalesce(pos_portable_access_salon_id(p_key,p_signature)=p_salon and pos_portable_access_has_capability(p_key,p_signature,'portable.pos.use'),false);
 if not allowed then raise exception 'POS access required'; end if;
 if p_op='quote' then return reward_quote(p_salon,p_args->'receipt',p_args->>'token'); end if;
 select * into v from customer_visits where id=(p_args->>'visitId')::uuid and salon_id=p_salon;
 if v.id is null then raise exception 'Check-in belongs to another salon'; end if;
 if p_op='confirm' then raise exception 'Use the customer screen or personal account to confirm'; end if;
 return reward_request_command(v.id,p_op,p_args,false);
end $$;

create function public.reward_display(p_token text,p_op text,p_args jsonb default '{}') returns jsonb language plpgsql security definer set search_path=public as $$
declare d pos_live_drafts; v customer_visits; cid uuid; begin
 select * into d from pos_live_drafts where token=p_token and status='draft' and updated_at>now()-interval '24 hours';
 if d.id is null then raise exception 'Display session expired'; end if;
 cid:=nullif(d.customer->>'id','')::uuid;
 select * into v from customer_visits where salon_id=d.salon_id and status in ('waiting','in_service','checkout')
  and (id=nullif(p_args->>'visitId','')::uuid or (p_args->>'visitId' is null and customer_id=cid))
  and (customer_id=cid or origin_metadata->>'token'=p_token) order by checked_in_at desc limit 1;
 if v.id is null then return jsonb_build_object('view',null); end if;
 return reward_request_command(v.id,p_op,p_args,true);
end $$;

-- Receipt wrappers apply the confirmed discount INSIDE the existing transaction.
-- Gift Card calls these same cores and therefore sees a discounted receipt first.
create function public.reward_prepare_receipt(p_salon uuid,p_receipt jsonb) returns jsonb language plpgsql security definer set search_path=public as $$
declare r reward_requests; v customer_visits; view jsonb; sub numeric; disc numeric; token text; begin
 select * into v from customer_visits where salon_id=p_salon and customer_id=nullif(p_receipt->>'customerId','')::uuid and status in ('waiting','in_service','checkout')
  and (nullif(p_receipt->>'customerVisitId','') is null or id=(p_receipt->>'customerVisitId')::uuid) order by checked_in_at desc limit 1 for update;
 if v.id is null then
  if coalesce(p_receipt->>'rewardQuote',p_receipt->>'_rewardQuote') is not null then raise exception 'Reward visit changed. Refresh before payment'; end if;
  return p_receipt;
 end if;
 select * into r from reward_requests where visit_id=v.id;
 if r.status<>'confirmed' or r.id is null then
  if coalesce(p_receipt->>'rewardQuote',p_receipt->>'_rewardQuote',nullif(current_setting('reylumi.reward_quote',true),'')) is not null then raise exception 'Reward changed. Refresh before payment'; end if;
  return p_receipt;
 end if;
 if coalesce(p_receipt->>'rewardQuote',p_receipt->>'_rewardQuote',nullif(current_setting('reylumi.reward_quote',true),'')) is distinct from r.quote then raise exception 'Reward changed. Refresh the total before collecting payment'; end if;
 token:=coalesce(p_receipt->>'liveDraftToken',r.draft_token);
 perform reward_quote(p_salon,p_receipt,token);
 select * into r from reward_requests where visit_id=v.id for update;
 if r.status<>'confirmed' or r.expires_at<=now() or r.quote is null then raise exception 'Reward needs customer confirmation again'; end if;
 if reward_available(p_salon,r.user_id,r.id)<(r.offer->>'points')::integer then raise exception 'Not enough points'; end if;
 select coalesce(sum((x->>'total')::numeric),0) into sub from jsonb_array_elements(p_receipt->'lines')x;
 disc:=greatest(0,coalesce((p_receipt->>'discountValue')::numeric,0));
 if p_receipt->>'discountType'='percentage' then disc:=round(sub*least(disc,100)/100,2); end if;
 return p_receipt||jsonb_build_object('customerVisitId',v.id,'discountType','fixed_amount','discountValue',disc+(r.offer->>'valueCents')::numeric/100,'rewardRequestId',r.id);
end $$;
create function public.reward_finish_receipt(p_salon uuid,p_receipt jsonb,p_result jsonb) returns void language plpgsql security definer set search_path=public as $$
declare r reward_requests; tid uuid:=nullif(p_result->>'ticketId','')::uuid; begin
 if tid is null then return; end if;
 insert into reward_ticket_rules(ticket_id,rules) select tid,rules from reward_programs where salon_id=p_salon and enabled on conflict do nothing;
 if p_receipt->>'rewardRequestId' is null then return; end if;
 select * into r from reward_requests where id=(p_receipt->>'rewardRequestId')::uuid and salon_id=p_salon for update;
 if r.status='redeemed' and r.ticket_id=tid then return; end if;
 if r.status<>'confirmed' then raise exception 'Reward is not confirmed'; end if;
 insert into reward_ledger(salon_id,user_id,delta,reason,event_key,ticket_id) values(p_salon,r.user_id,-(r.offer->>'points')::integer,'Reward used','redeem:'||r.id,tid);
 update reward_requests set status='redeemed',ticket_id=tid,revision=revision+1 where id=r.id;
end $$;
alter function public.submit_owner_workspace_receipt_core(uuid,text,jsonb,date) rename to submit_owner_workspace_receipt_without_rewards;
create function public.submit_owner_workspace_receipt_core(p_key_id uuid,p_session_signature text,p_receipt jsonb,p_work_date date default current_date) returns jsonb language plpgsql security definer set search_path=public as $$
declare payload jsonb; result jsonb; begin payload:=reward_prepare_receipt(p_key_id,p_receipt); result:=submit_owner_workspace_receipt_without_rewards(p_key_id,p_session_signature,payload,p_work_date); perform reward_finish_receipt(p_key_id,payload,result); return result; end $$;
alter function public.submit_pos_portable_receipt(uuid,text,jsonb,date) rename to submit_pos_portable_receipt_without_rewards;
create function public.submit_pos_portable_receipt(p_key_id uuid,p_session_signature text,p_receipt jsonb,p_work_date date default current_date) returns jsonb language plpgsql security definer set search_path=public as $$
declare salon uuid; payload jsonb; result jsonb; begin
 salon:=pos_portable_access_salon_id(p_key_id,p_session_signature);
 if salon is null or not coalesce(pos_portable_access_has_capability(p_key_id,p_session_signature,'portable.pos.use'),false) then raise exception 'POS access required'; end if;
 payload:=reward_prepare_receipt(salon,p_receipt); result:=submit_pos_portable_receipt_without_rewards(p_key_id,p_session_signature,payload,p_work_date); perform reward_finish_receipt(salon,payload,result); return result;
end $$;
revoke all on function public.submit_owner_workspace_receipt_core(uuid,text,jsonb,date),public.submit_owner_workspace_receipt_without_rewards(uuid,text,jsonb,date),public.submit_pos_portable_receipt_without_rewards(uuid,text,jsonb,date) from public,anon,authenticated;
revoke all on function public.submit_pos_portable_receipt(uuid,text,jsonb,date) from public;
grant execute on function public.submit_pos_portable_receipt(uuid,text,jsonb,date) to anon,authenticated;

-- Deferred settlement sees the final ticket, items, payments and completed visit together.
create function public.reward_reconcile_ticket(p_ticket uuid) returns void language plpgsql security definer set search_path=public as $$
declare t pos_tickets; settle_rules jsonb; u uuid; sub numeric; disc numeric; net numeric; paid numeric; target integer; old integer; c reward_conversions; completed boolean; reason_key text; first_tid uuid; redemption reward_requests;
begin
 select * into t from pos_tickets where id=p_ticket; if t.id is null then return; end if;
 select customer_user_id into u from customers where id=t.customer_id and location_id=t.salon_id;
 select tr.rules into settle_rules from reward_ticket_rules tr where ticket_id=t.id;
 if settle_rules is null then
  select p.rules into settle_rules from reward_programs p where p.salon_id=t.salon_id and p.enabled and t.created_at>=p.updated_at;
  if settle_rules is not null then insert into reward_ticket_rules(ticket_id,rules) values(t.id,settle_rules) on conflict do nothing; end if;
 end if;
 select coalesce(sum(line_total),0) into sub from pos_ticket_items where pos_ticket_id=t.id and not is_removed;
 disc:=case when t.discount_type='percentage' then round(sub*least(t.discount_value,100)/100,2) else least(sub,t.discount_value) end;
 net:=greatest(0,sub-disc);
 select coalesce(sum(amount),0) into paid from pos_payments where ticket_id=t.id;
 completed:=t.status='closed' and exists(select 1 from customer_visits where ticket_id=t.id and status='completed') and paid>=round(net+round(net*t.tax_rate/100,2)+case when t.tip_type='percentage' then round((net+round(net*t.tax_rate/100,2))*t.tip_value/100,2) else t.tip_value end,2);
 if u is not null and settle_rules is not null then
  perform reward_join(t.salon_id,u); perform reward_lock(t.salon_id,u);
  target:=case when completed then floor(net*100/(settle_rules->>'spendCents')::integer)::integer*(settle_rules->>'spendPoints')::integer+(settle_rules->>'visitPoints')::integer else 0 end;
  -- First booking bonus is selected once, then maintained on that same ticket.
  select ticket_id into first_tid from reward_ledger where salon_id=t.salon_id and user_id=u and reason='First paid booking' order by created_at,id limit 1;
  if completed and t.source_booking_id is not null and (first_tid is null or first_tid=t.id) then
   insert into reward_ledger(salon_id,user_id,delta,reason,event_key,ticket_id) values(t.salon_id,u,(settle_rules->>'firstBookingPoints')::integer,'First paid booking','first-booking:'||t.salon_id||':'||u,t.id) on conflict do nothing;
   first_tid:=t.id;
  end if;
  select coalesce(sum(delta),0)::integer into old from reward_ledger where ticket_id=t.id and user_id=u and reason='Paid visit';
  if old<>target then insert into reward_ledger(salon_id,user_id,delta,reason,event_key,ticket_id) values(t.salon_id,u,target-old,'Paid visit','ticket:'||t.id||':'||gen_random_uuid(),t.id); end if;
  if first_tid=t.id then
   select coalesce(sum(delta),0)::integer into old from reward_ledger where ticket_id=t.id and user_id=u and reason in ('First paid booking','First booking adjustment');
   target:=case when completed then (settle_rules->>'firstBookingPoints')::integer else 0 end;
   if old<>target then insert into reward_ledger(salon_id,user_id,delta,reason,event_key,ticket_id) values(t.salon_id,u,target-old,'First booking adjustment','first-adjust:'||gen_random_uuid(),t.id); end if;
  end if;
 end if;
 for c in select rc.* from reward_conversions rc join customer_visits v on v.appointment_id=rc.booking_id where v.ticket_id=t.id loop
  perform reward_lock(c.salon_id,c.author_id);
  target:=case when completed and c.author_id is distinct from u then c.points else 0 end;
  select coalesce(sum(delta),0)::integer into old from reward_ledger where event_key like 'conversion:'||c.booking_id||':%';
  if old<>target then insert into reward_ledger(salon_id,user_id,delta,reason,event_key,ticket_id) values(c.salon_id,c.author_id,target-old,'Before & After booking','conversion:'||c.booking_id||':'||gen_random_uuid(),t.id); end if;
  update reward_conversions set status=case when target>0 then 'earned' when t.status in ('voided','cancelled') then 'cancelled' else 'pending' end,ticket_id=t.id where booking_id=c.booking_id;
 end loop;
 for redemption in select * from reward_requests where ticket_id=t.id and status='redeemed' loop
  perform reward_lock(redemption.salon_id,redemption.user_id);
  target:=case when t.status in ('voided','cancelled') or paid<=0 then 0 else -(redemption.offer->>'points')::integer end;
  select coalesce(sum(delta),0)::integer into old from reward_ledger where event_key='redeem:'||redemption.id or event_key='redeem-return:'||redemption.id or event_key like 'redeem-adjust:'||redemption.id||':%';
  if old<>target then insert into reward_ledger(salon_id,user_id,delta,reason,event_key,ticket_id) values(redemption.salon_id,redemption.user_id,target-old,case when target=0 then 'Reward returned' else 'Reward adjustment' end,'redeem-adjust:'||redemption.id||':'||gen_random_uuid(),t.id); end if;
 end loop;
end $$;
create function public.reward_ticket_changed() returns trigger language plpgsql security definer set search_path=public as $$
declare tid uuid; begin
 if tg_table_name='pos_tickets' then tid:=coalesce(new.id,old.id);
 elsif tg_table_name='pos_ticket_items' then tid:=coalesce(new.pos_ticket_id,old.pos_ticket_id);
 else tid:=coalesce(new.ticket_id,old.ticket_id); end if;
 if tid is not null then perform reward_reconcile_ticket(tid); end if; return null;
end $$;
create function public.reward_submit_owner(p_salon uuid,p_request uuid,p_receipt jsonb) returns jsonb language plpgsql security definer set search_path=public as $$
declare prior reward_settlements; result jsonb; fingerprint text:=md5(p_receipt::text); begin
 if not coalesce(user_has_salon_permission(p_salon,array['tickets.create','tickets.manage']),false) or not salon_is_operational(p_salon) then raise exception 'POS access required'; end if;
 if p_request is null then raise exception 'Checkout identity required'; end if;
 perform pg_advisory_xact_lock(hashtextextended('reward-checkout:'||p_salon||':'||p_request,0));
 select * into prior from reward_settlements where salon_id=p_salon and request_id=p_request;
 if prior.request_id is not null then if prior.fingerprint<>fingerprint then raise exception 'Checkout changed after payment'; end if; return prior.result; end if;
 if nullif(p_receipt->>'sourceBookingId','') is not null then raise exception 'Use Portable POS for appointment checkout'; end if;
 result:=submit_owner_workspace_receipt_core(p_salon,null,p_receipt,get_salon_business_date(p_salon));
 insert into reward_settlements values(p_salon,p_request,fingerprint,result); return result;
end $$;
create constraint trigger reward_ticket_settled after insert or update on public.pos_tickets deferrable initially deferred for each row execute function reward_ticket_changed();
create constraint trigger reward_payment_settled after insert or update or delete on public.pos_payments deferrable initially deferred for each row execute function reward_ticket_changed();
create constraint trigger reward_item_settled after insert or update or delete on public.pos_ticket_items deferrable initially deferred for each row execute function reward_ticket_changed();
create constraint trigger reward_visit_settled after insert or update on public.customer_visits deferrable initially deferred for each row execute function reward_ticket_changed();
create function public.reward_ticket_identity_guard() returns trigger language plpgsql security definer set search_path=public as $$
begin
 if new.customer_id is distinct from old.customer_id and old.status='closed' and exists(select 1 from reward_ledger where ticket_id=old.id) then raise exception 'Void the reward ticket before changing its customer'; end if;
 if new.status='closed' and exists(select 1 from reward_requests r where r.ticket_id=new.id and r.status='redeemed' and r.user_id is distinct from (select customer_user_id from customers where id=new.customer_id)) then raise exception 'The redeemed reward belongs to the original customer'; end if;
 return new;
end $$;
create trigger reward_ticket_identity_guard before update on public.pos_tickets for each row execute function reward_ticket_identity_guard();

-- Legacy upload-only Beauty rewards remain historical, never become spendable balances.
update public.beauty_reward_policies set status='inactive',updated_at=now() where code='verified_before_after_default';
-- Revoke every private helper (Postgres defaults would otherwise expose SECURITY DEFINER functions).
do $$ declare f record; begin for f in select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname like 'reward_%' loop execute format('revoke all on function %s from public,anon,authenticated',f.sig); end loop; end $$;
grant execute on function public.reward_owner(uuid,text,jsonb),public.reward_personal(text,jsonb) to authenticated;
grant execute on function public.reward_submit_owner(uuid,uuid,jsonb) to authenticated;
grant execute on function public.reward_pos(uuid,text,jsonb,uuid,text),public.reward_display(text,text,jsonb) to anon,authenticated;
commit;
