begin;
insert into public.platform_admin_permissions(code,name,description,category) values
 ('admin.membership.read','Read Reylumi memberships','View plans, salon terms, credit and support.','membership'),
 ('admin.membership.configure','Configure Reylumi plans','Edit drafts and publish new commercial plan versions.','membership'),
 ('admin.membership.manage','Manage salon memberships','Grant terms, adjust credit and manage technical service.','membership') on conflict(code) do nothing;
insert into public.platform_admin_role_permissions(role_id,permission_id)
 select r.id,p.id from public.platform_admin_roles r cross join public.platform_admin_permissions p
 where (r.slug='platform_owner' and p.code like 'admin.membership.%')
 or (r.slug in ('operations_admin','support_agent','auditor') and p.code='admin.membership.read')
 on conflict(role_id,permission_id) do nothing;

create table public.reylumi_membership_plans (
 key text primary key check(key in ('essential','growth','premium')), revision integer not null default 1,
 config jsonb not null, published_version uuid, selling boolean not null default false,
 updated_at timestamptz not null default now()
);
create table public.reylumi_membership_versions (
 id uuid primary key default gen_random_uuid(), plan_key text not null references public.reylumi_membership_plans(key),
 config jsonb not null, created_by uuid not null references public.users(id), created_at timestamptz not null default now()
);
alter table public.reylumi_membership_plans add foreign key(published_version) references public.reylumi_membership_versions(id);
create table public.reylumi_membership_terms (
 id uuid primary key default gen_random_uuid(), salon_id uuid not null references public.locations(id),
 version_id uuid not null references public.reylumi_membership_versions(id),
 starts_at timestamptz not null, ends_at timestamptz not null, cancelled_at timestamptz,
 source text not null check(source in ('manual','gift','trial','paid_manual')),
 amount_cents integer not null check(amount_cents between 0 and 100000000),
 payment_method text check(payment_method in ('bank','cash','other')), payment_reference text,
 reason text not null check(length(btrim(reason)) between 3 and 1000), created_at timestamptz not null default now(),
 check(ends_at>starts_at), check(ends_at<=starts_at+interval '10 years'),
 check(source<>'paid_manual' or (payment_method is not null and length(btrim(payment_reference)) between 3 and 200))
);
create index on public.reylumi_membership_terms(salon_id,ends_at);
create table public.reylumi_membership_buckets (
 id uuid primary key default gen_random_uuid(), membership_id uuid not null references public.reylumi_membership_terms(id),
 resource text not null check(resource in ('sms','email','campaign','ai','setup','training','support')),
 starts_at timestamptz not null, ends_at timestamptz not null, amount integer not null check(amount>=0),
 unique(membership_id,resource,starts_at)
);
create table public.reylumi_membership_ledger (
 id bigint generated always as identity primary key, bucket_id uuid not null references public.reylumi_membership_buckets(id),
 delta integer not null check(delta<>0), reason text not null, request_id uuid not null unique,
 actor_user_id uuid references public.users(id), created_at timestamptz not null default now()
);
create table public.reylumi_membership_support (
 id uuid primary key default gen_random_uuid(), membership_id uuid not null references public.reylumi_membership_terms(id),
 kind text not null check(kind in ('setup','training','support')), subject text not null check(length(btrim(subject)) between 3 and 200),
 state text not null default 'requested' check(state in ('requested','assigned','scheduled','in_progress','completed','cancelled')),
 assignee text not null default '', scheduled_at timestamptz, minutes integer not null default 0 check(minutes between 0 and 100000),
 note text not null default '', revision integer not null default 1, created_at timestamptz not null default now()
);
create table public.reylumi_membership_events (
 id bigint generated always as identity primary key, membership_id uuid references public.reylumi_membership_terms(id),
 actor_user_id uuid not null references public.users(id), action text not null, reason text not null,
 details jsonb not null, request_id uuid not null unique, created_at timestamptz not null default now()
);

-- Defense in depth: no direct client writes/reads. Only permission-checked RPCs.
alter table public.reylumi_membership_plans enable row level security;
alter table public.reylumi_membership_versions enable row level security;
alter table public.reylumi_membership_terms enable row level security;
alter table public.reylumi_membership_buckets enable row level security;
alter table public.reylumi_membership_ledger enable row level security;
alter table public.reylumi_membership_support enable row level security;
alter table public.reylumi_membership_events enable row level security;
revoke all on public.reylumi_membership_plans,public.reylumi_membership_versions,public.reylumi_membership_terms,public.reylumi_membership_buckets,public.reylumi_membership_ledger,public.reylumi_membership_support,public.reylumi_membership_events from public,anon,authenticated;

-- Empty commercial values, zero allowances, unpublished. No invented price or promise.
insert into public.reylumi_membership_plans(key,config)
select k,jsonb_build_object('name',initcap(k),'tagline',case k when 'essential' then 'Every Reylumi plugin. Pay for what you use.' when 'growth' then 'More service credit. More help for your team.' else 'A closer partnership for your business.' end,
 'description','All released Reylumi plugins for one salon, while your membership is active.','badge',case when k='growth' then 'Recommended' else '' end,
 'monthly_cents',null,'annual_cents',null,'currency','USD','payment_methods',jsonb_build_array('bank'),'benefits','[]'::jsonb,
 'support_description','Support scope and appointment allowance to be confirmed.','response_target','',
 'future_features','New Reylumi plugins are included when officially released while your membership is active. Usage-based services remain subject to your allowance.',
 'early_access',k<>'essential','allowances',(select jsonb_object_agg(r,jsonb_build_object('amount',0,'period',case when r in ('setup','training') then 'term' else 'month' end,'rollover',0,'overage_cents',null)) from unnest(array['sms','email','campaign','ai','setup','training','support'])r))
from unnest(array['essential','growth','premium'])k;

create function public.reylumi_membership_validate(c jsonb) returns void language plpgsql set search_path=public as $$
declare k text; a jsonb; v text;
begin
 if c is null or jsonb_typeof(c)<>'object' or length(c::text)>30000 then raise exception 'Invalid plan configuration';end if;
 foreach k in array array['name','tagline','description','badge','support_description','response_target','future_features'] loop
  if jsonb_typeof(c->k) is distinct from 'string' or length(c->>k)>4000 then raise exception 'Invalid plan text: %',k;end if;
 end loop;
 if length(btrim(c->>'name')) not between 2 and 80 or length(c->>'tagline')>200 or length(c->>'badge')>60 or length(c->>'response_target')>200 or c->>'currency' is distinct from 'USD' or jsonb_typeof(c->'early_access') is distinct from 'boolean' then raise exception 'Invalid plan name, currency or early access';end if;
 foreach k in array array['monthly_cents','annual_cents'] loop
  if not(c ? k) or (c->k<>'null'::jsonb and (jsonb_typeof(c->k)<>'number' or (c->>k)!~'^\d{1,9}$' or (c->>k)::bigint>100000000)) then raise exception 'Invalid price';end if;
 end loop;
 if jsonb_typeof(c->'payment_methods') is distinct from 'array' then raise exception 'Invalid payment methods';end if;
 if jsonb_array_length(c->'payment_methods')>3 then raise exception 'Invalid payment methods';end if;
 for v in select jsonb_array_elements_text(c->'payment_methods') loop if v not in ('bank','cash','other') then raise exception 'Invalid payment method';end if;end loop;
 if jsonb_typeof(c->'benefits') is distinct from 'array' then raise exception 'Invalid benefits';end if;
 if jsonb_array_length(c->'benefits')>30 then raise exception 'Invalid benefits count';end if;
 for a in select value from jsonb_array_elements(c->'benefits') loop if jsonb_typeof(a)<>'string' or length(a#>>'{}') not between 1 and 500 then raise exception 'Invalid benefit';end if;end loop;
 foreach k in array array['sms','email','campaign','ai','setup','training','support'] loop
  a:=c->'allowances'->k;
  if a is null or jsonb_typeof(a)<>'object' or coalesce(a->>'period','') not in ('month','term') then raise exception 'Invalid allowance period';end if;
  foreach v in array array['amount','rollover'] loop
   if jsonb_typeof(a->v) is distinct from 'number' or (a->>v)!~'^\d{1,8}$' or (a->>v)::bigint>10000000 then raise exception 'Invalid allowance amount';end if;
  end loop;
  if (a->>'period'='term' and (a->>'rollover')::integer<>0) then raise exception 'Term allowances cannot roll over';end if;
  if not(a?'overage_cents') or (a->'overage_cents'<>'null'::jsonb and (jsonb_typeof(a->'overage_cents')<>'number' or (a->>'overage_cents')!~'^\d{1,9}$' or (a->>'overage_cents')::bigint>100000000)) then raise exception 'Invalid overage price';end if;
 end loop;
end $$;
revoke all on function public.reylumi_membership_validate(jsonb) from public,anon,authenticated;

create function public.reylumi_membership_term_rows() returns setof jsonb language sql stable security definer set search_path=public as $$
 select to_jsonb(t)||jsonb_build_object('salon_name',l.name,'plan_key',v.plan_key,'config',v.config,'effective_status',case when t.cancelled_at is not null then 'cancelled' when t.starts_at>now() then 'scheduled' when t.ends_at<=now() then 'expired' else 'active' end)
 from reylumi_membership_terms t join locations l on l.id=t.salon_id join reylumi_membership_versions v on v.id=t.version_id
$$;
revoke all on function public.reylumi_membership_term_rows() from public,anon,authenticated;

-- Membership-month buckets anchored to the original start, not the previous month's
-- truncated end. All elapsed periods are materialized so rollover stays deterministic.
create function public.reylumi_membership_sync(p_id uuid) returns void language plpgsql security definer set search_path=public as $$
declare t reylumi_membership_terms; c jsonb; r text; a jsonb; s timestamptz; e timestamptz; i integer; carry integer; previous_balance bigint; b uuid;
begin
 perform set_config('TimeZone','UTC',true);
 select * into t from reylumi_membership_terms where id=p_id for update;
 if not found then raise exception 'Membership not found';end if;
 if t.starts_at>now() or t.cancelled_at is not null then return;end if;
 select config into c from reylumi_membership_versions where id=t.version_id;
 foreach r in array array['sms','email','campaign','ai','setup','training','support'] loop
  a:=c->'allowances'->r;i:=0;carry:=0;
  loop
   s:=t.starts_at+make_interval(months=>i);
   exit when s>=t.ends_at or s>now();
   e:=case when a->>'period'='term' then t.ends_at else least(t.ends_at,t.starts_at+make_interval(months=>i+1)) end;
   select id into b from reylumi_membership_buckets where membership_id=t.id and resource=r and starts_at=s;
   if b is null then
    insert into reylumi_membership_buckets(membership_id,resource,starts_at,ends_at,amount)
    values(t.id,r,s,e,(a->>'amount')::integer+carry) returning id into b;
   end if;
   select bk.amount+coalesce(sum(le.delta),0) into previous_balance from reylumi_membership_buckets bk left join reylumi_membership_ledger le on le.bucket_id=bk.id where bk.id=b group by bk.id;
   carry:=least(greatest(previous_balance,0),(a->>'rollover')::integer);
   exit when a->>'period'='term';i:=i+1;
  end loop;
 end loop;
end $$;
revoke all on function public.reylumi_membership_sync(uuid) from public,anon,authenticated;

create function public.reylumi_membership_public() returns jsonb language sql stable security definer set search_path=public as $$
 select coalesce(jsonb_agg(jsonb_build_object('key',p.key,'config',v.config,'selling',p.selling) order by case p.key when 'essential' then 1 when 'growth' then 2 else 3 end),'[]'::jsonb)
 from reylumi_membership_plans p join reylumi_membership_versions v on v.id=p.published_version
$$;
revoke all on function public.reylumi_membership_public() from public;
grant execute on function public.reylumi_membership_public() to anon,authenticated;

create function public.reylumi_membership_workspace(p_query text default '',p_status text default 'all',p_page integer default 1) returns jsonb language plpgsql stable security definer set search_path=public as $$
declare result jsonb;
begin
 perform platform_admin_require_permission('admin.membership.read');
 if length(coalesce(p_query,''))>100 or p_status is null or p_status not in ('all','active','scheduled','expired','cancelled','expiring') or p_page is null or p_page not between 1 and 100000 then raise exception 'Invalid membership filters';end if;
 with rows as (select x from reylumi_membership_term_rows() x where (coalesce(p_query,'')='' or x->>'salon_name' ilike '%'||p_query||'%' or x->>'salon_id'=p_query) and (p_status='all' or x->>'effective_status'=p_status or (p_status='expiring' and x->>'effective_status'='active' and (x->>'ends_at')::timestamptz<now()+interval '14 days'))),
 page as(select x from rows order by (x->>'created_at')::timestamptz desc,x->>'id' offset (p_page-1)*25 limit 25)
 select jsonb_build_object('memberships',coalesce((select jsonb_agg(x) from page),'[]'::jsonb),'total',(select count(*) from rows)) into result;
 return result||jsonb_build_object(
 'plans',(select jsonb_agg(to_jsonb(p)||jsonb_build_object('published_config',v.config) order by case p.key when 'essential' then 1 when 'growth' then 2 else 3 end) from reylumi_membership_plans p left join reylumi_membership_versions v on v.id=p.published_version),
 'events',coalesce((select jsonb_agg(x order by x.id desc) from (select * from reylumi_membership_events order by id desc limit 60)x),'[]'::jsonb),
 'support',coalesce((select jsonb_agg(to_jsonb(x)||jsonb_build_object('salon_name',l.name) order by x.created_at desc) from (select * from reylumi_membership_support where state not in ('completed','cancelled') order by created_at desc limit 100)x join reylumi_membership_terms t on t.id=x.membership_id join locations l on l.id=t.salon_id),'[]'::jsonb),
 'due',(select count(*) from reylumi_membership_terms where cancelled_at is null and starts_at<=now() and ends_at>now() and ends_at<now()+interval '14 days'));
end $$;
revoke all on function public.reylumi_membership_workspace(text,text,integer) from public,anon;
grant execute on function public.reylumi_membership_workspace(text,text,integer) to authenticated;

create function public.reylumi_membership_detail(p_id uuid) returns jsonb language plpgsql security definer set search_path=public as $$
declare result jsonb;
begin
 perform platform_admin_require_permission('admin.membership.read');
 perform reylumi_membership_sync(p_id);
 select jsonb_build_object('membership',x,'balances',coalesce((select jsonb_agg(jsonb_build_object('resource',b.resource,'amount',b.amount,'balance',b.amount+coalesce((select sum(delta) from reylumi_membership_ledger where bucket_id=b.id),0),'starts_at',b.starts_at,'ends_at',b.ends_at)) from reylumi_membership_buckets b where b.membership_id=p_id and b.starts_at<=now() and b.ends_at>now() and x->>'effective_status'='active'),'[]'::jsonb),
 'events',coalesce((select jsonb_agg(e order by e.id desc) from (select * from reylumi_membership_events where membership_id=p_id order by id desc limit 100)e),'[]'::jsonb),
 'support',coalesce((select jsonb_agg(to_jsonb(s)||jsonb_build_object('salon_name',x->>'salon_name') order by s.created_at desc) from reylumi_membership_support s where membership_id=p_id),'[]'::jsonb)) into result from reylumi_membership_term_rows() x where x->>'id'=p_id::text;
 if result is null then raise exception 'Membership not found';end if;return result;
end $$;
revoke all on function public.reylumi_membership_detail(uuid) from public,anon;
grant execute on function public.reylumi_membership_detail(uuid) to authenticated;

create function public.reylumi_membership_salons(p_query text) returns jsonb language plpgsql stable security definer set search_path=public as $$
begin
 perform platform_admin_require_permission('admin.membership.read');
 if length(btrim(coalesce(p_query,'')))<2 then return '[]';end if;
 if length(p_query)>100 then raise exception 'Invalid search';end if;
 return (select coalesce(jsonb_agg(x),'[]'::jsonb) from (select id,name,case when platform_admin_has_permission('admin.users.read_sensitive') then phone end phone,city,status from locations where status='active' and (name ilike '%'||p_query||'%' or id::text=p_query or (platform_admin_has_permission('admin.users.read_sensitive') and phone ilike '%'||p_query||'%')) order by name,id limit 20)x);
end $$;
revoke all on function public.reylumi_membership_salons(text) from public,anon;
grant execute on function public.reylumi_membership_salons(text) to authenticated;

create function public.reylumi_membership_activity(p_kind text,p_query text default '',p_status text default 'open',p_page integer default 1) returns jsonb language plpgsql stable security definer set search_path=public as $$
declare result jsonb;
begin
 perform platform_admin_require_permission('admin.membership.read');
 if p_kind is null or p_kind not in ('history','support') or length(coalesce(p_query,''))>100 or p_page is null or p_page not between 1 and 100000 or p_status is null or p_status not in ('open','all','requested','assigned','scheduled','in_progress','completed','cancelled') then raise exception 'Invalid activity filters';end if;
 if p_kind='history' then
  with rows as (select to_jsonb(e)||jsonb_build_object('salon_name',l.name) x,e.id from reylumi_membership_events e left join reylumi_membership_terms t on t.id=e.membership_id left join locations l on l.id=t.salon_id where coalesce(p_query,'')='' or e.reason ilike '%'||p_query||'%' or e.action ilike '%'||p_query||'%' or l.name ilike '%'||p_query||'%'),
  page as(select x from rows order by id desc offset (p_page-1)*25 limit 25)
  select jsonb_build_object('items',coalesce((select jsonb_agg(x) from page),'[]'::jsonb),'total',(select count(*) from rows)) into result;
 else
  with rows as (select to_jsonb(s)||jsonb_build_object('salon_name',l.name) x,s.created_at,s.id from reylumi_membership_support s join reylumi_membership_terms t on t.id=s.membership_id join locations l on l.id=t.salon_id where (p_status='all' or (p_status='open' and s.state not in ('completed','cancelled')) or s.state=p_status) and (coalesce(p_query,'')='' or s.subject ilike '%'||p_query||'%' or l.name ilike '%'||p_query||'%' or s.assignee ilike '%'||p_query||'%')),
  page as(select x from rows order by created_at desc,id desc offset (p_page-1)*25 limit 25)
  select jsonb_build_object('items',coalesce((select jsonb_agg(x) from page),'[]'::jsonb),'total',(select count(*) from rows)) into result;
 end if;return result;
end $$;
revoke all on function public.reylumi_membership_activity(text,text,text,integer) from public,anon;
grant execute on function public.reylumi_membership_activity(text,text,text,integer) to authenticated;

-- One atomic, idempotent command surface. Data access remains on caller's auth;
-- no service-role shortcut, no external payments or recurring-charge cancellation.
create function public.reylumi_membership_command(p jsonb) returns jsonb language plpgsql security definer set search_path=public as $$
declare actor uuid; req uuid; act text; why text; result jsonb; pl reylumi_membership_plans; t reylumi_membership_terms; v reylumi_membership_versions;
 target uuid; sid uuid; s timestamptz; e timestamptz; price integer; delta integer; b reylumi_membership_buckets; balance bigint; ticket reylumi_membership_support; new_state text;
begin
 act:=p->>'action';
 perform set_config('TimeZone','UTC',true);
 select actor_user_id into actor from platform_admin_require_permission(case when act in ('save_plan','publish_plan','set_selling') then 'admin.membership.configure' else 'admin.membership.manage' end);
 req:=(p->>'request_id')::uuid;why:=btrim(coalesce(p->>'reason',''));
 if req is null or length(why) not between 3 and 1000 or length(p::text)>40000 then raise exception 'Invalid request or reason';end if;
 perform pg_advisory_xact_lock(hashtextextended(req::text,0));
 select details into result from reylumi_membership_events where request_id=req and actor_user_id=actor and action=act;
 if found then
  if result->'input' is distinct from p-'request_id' then raise exception 'This request ID was already used with different values';end if;
  return result-'input';
 end if;
 if act in ('save_plan','publish_plan','set_selling') then
  select * into pl from reylumi_membership_plans where key=p->>'key' for update;
  if not found then raise exception 'Plan not found';end if;
  if pl.revision is distinct from (p->>'revision')::integer then raise exception 'This plan changed. Reload before saving.';end if;
  if act='save_plan' then
   perform reylumi_membership_validate(p->'config');
   update reylumi_membership_plans set config=p->'config',revision=revision+1,updated_at=now() where key=pl.key;
  elsif act='publish_plan' then
   if p ? 'config' then
    perform reylumi_membership_validate(p->'config');
    pl.config:=p->'config';
    update reylumi_membership_plans set config=pl.config where key=pl.key;
   end if;
   perform reylumi_membership_validate(pl.config);
   insert into reylumi_membership_versions(plan_key,config,created_by) values(pl.key,pl.config,actor) returning * into v;
   update reylumi_membership_plans set published_version=v.id,revision=revision+1,updated_at=now() where key=pl.key;
  else
   if jsonb_typeof(p->'selling') is distinct from 'boolean' then raise exception 'Invalid selling state';end if;
   if (p->>'selling')::boolean and pl.published_version is null then raise exception 'Publish this plan before opening enrollment';end if;
   update reylumi_membership_plans set selling=(p->>'selling')::boolean,revision=revision+1,updated_at=now() where key=pl.key;
  end if;
  result:=jsonb_build_object('plan',pl.key);
 elsif act='grant' then
  sid:=(p->>'salon_id')::uuid;
  perform 1 from locations where id=sid and status='active' for update;
  if not found then raise exception 'This salon is not active';end if;
  select * into pl from reylumi_membership_plans where key=p->>'key' for share;
  if pl.published_version is null or not pl.selling then raise exception 'This plan is not open for enrollment';end if;
  if pl.published_version::text is distinct from p->>'version_id' then raise exception 'This plan changed. Reload the latest benefits.';end if;
  select * into v from reylumi_membership_versions where id=pl.published_version;
  s:=(p->>'starts_at')::timestamptz;
  if (p->>'months') is null or (p->>'months')!~'^\d{1,3}$' or (p->>'months')::integer not between 1 and 120 or s is null or s<now()-interval '1 day' or s>now()+interval '2 years' then raise exception 'Invalid start or duration';end if;
  e:=s+make_interval(months=>(p->>'months')::integer);
  if p->>'source' is null or p->>'source' not in ('manual','gift','trial','paid_manual') then raise exception 'Invalid grant source';end if;
  if p->>'replace_id' is not null then
   select * into t from reylumi_membership_terms where id=(p->>'replace_id')::uuid and salon_id=sid for update;
   if not found or t.cancelled_at is not null or t.starts_at>now() or t.ends_at<=now() or s>now()+interval '5 minutes' then raise exception 'This existing term cannot be replaced. Reload or schedule at its end.';end if;
   -- Replacement starts now. Older bucket ranges never extend membership rights.
   s:=now();e:=s+make_interval(months=>(p->>'months')::integer);
   update reylumi_membership_terms set cancelled_at=now() where id=t.id;
  end if;
  if exists(select 1 from reylumi_membership_terms where salon_id=sid and cancelled_at is null and starts_at<e and ends_at>s) then raise exception 'This salon already has an overlapping term. Renew at its end or explicitly replace the active term.';end if;
  price:=0;
  if p->>'source'='paid_manual' then
   if not (v.config->'payment_methods' ? (p->>'payment_method')) or length(btrim(coalesce(p->>'payment_reference',''))) not between 3 and 200 or (p->>'amount_cents') is null or (p->>'amount_cents')!~'^\d{1,9}$' or (p->>'amount_cents')::bigint>100000000 then raise exception 'Invalid payment method, reference or received amount';end if;
   price:=(p->>'amount_cents')::integer;
  end if;
  insert into reylumi_membership_terms(salon_id,version_id,starts_at,ends_at,source,amount_cents,payment_method,payment_reference,reason)
   values(sid,v.id,s,e,p->>'source',price,case when p->>'source'='paid_manual' then p->>'payment_method' end,case when p->>'source'='paid_manual' then btrim(p->>'payment_reference') end,why) returning id into target;
  result:=jsonb_build_object('membership_id',target,'replaced_id',p->>'replace_id');
 elsif act='cancel' then
  select * into t from reylumi_membership_terms where id=(p->>'membership_id')::uuid for update;
  if not found or t.cancelled_at is not null then raise exception 'This membership is no longer available to end';end if;
  target:=t.id;update reylumi_membership_terms set cancelled_at=now() where id=t.id;
  result:=jsonb_build_object('membership_id',target);
 elsif act='adjust_credit' then
  target:=(p->>'membership_id')::uuid;perform reylumi_membership_sync(target);
  select * into t from reylumi_membership_terms where id=target for update;
  if t.cancelled_at is not null or t.starts_at>now() or t.ends_at<=now() then raise exception 'This membership is not active';end if;
  if (p->>'delta') is null or (p->>'delta')!~'^-?\d{1,8}$' or abs((p->>'delta')::bigint)>10000000 or (p->>'delta')::integer=0 then raise exception 'Invalid credit adjustment';end if;
  delta:=(p->>'delta')::integer;
  select * into b from reylumi_membership_buckets where membership_id=target and resource=p->>'resource' and starts_at<=now() and ends_at>now() for update;
  if not found then raise exception 'This credit period is not available';end if;
  select b.amount+coalesce(sum(le.delta),0) into balance from reylumi_membership_ledger le where le.bucket_id=b.id;
  if balance+delta<0 or balance+delta>20000000 then raise exception 'Invalid resulting credit balance';end if;
  insert into reylumi_membership_ledger(bucket_id,delta,reason,request_id,actor_user_id) values(b.id,delta,why,req,actor);
  result:=jsonb_build_object('membership_id',target,'resource',b.resource,'delta',delta,'balance',balance+delta);
 elsif act='create_support' then
  target:=(p->>'membership_id')::uuid;
  select * into t from reylumi_membership_terms where id=target for update;
  if not found or t.cancelled_at is not null or t.starts_at>now() or t.ends_at<=now() then raise exception 'This membership is not active';end if;
  insert into reylumi_membership_support(membership_id,kind,subject) values(target,p->>'kind',btrim(p->>'subject')) returning * into ticket;
  result:=jsonb_build_object('membership_id',target,'support_id',ticket.id);
 elsif act='update_support' then
  -- Same lock order as adjustment/detail: term, then ticket, then bucket.
  select membership_id into target from reylumi_membership_support where id=(p->>'support_id')::uuid;
  perform reylumi_membership_sync(target);
  select * into t from reylumi_membership_terms where id=target for update;
  select * into ticket from reylumi_membership_support where id=(p->>'support_id')::uuid for update;
  if not found or ticket.state in ('completed','cancelled') or ticket.revision is distinct from (p->>'revision')::integer then raise exception 'This service request changed or is closed. Reload.';end if;
  new_state:=p->>'state';
  if new_state is null or new_state not in ('requested','assigned','scheduled','in_progress','completed','cancelled') or length(coalesce(p->>'assignee',''))>120 or length(coalesce(p->>'note',''))>2000 then raise exception 'Invalid service update';end if;
  if new_state in ('assigned','scheduled','in_progress','completed') and length(btrim(coalesce(p->>'assignee','')))<2 then raise exception 'Assigned technician is required';end if;
  if new_state='scheduled' and nullif(p->>'scheduled_at','') is null then raise exception 'Appointment time is required';end if;
  delta:=0;
  if new_state='completed' then
   if t.cancelled_at is not null or t.starts_at>now() or t.ends_at<=now() then raise exception 'This membership is not active. Record an out-of-term service separately.';end if;
   if (p->>'minutes') is null or (p->>'minutes')!~'^\d{1,6}$' or (p->>'minutes')::integer not between 1 and 100000 then raise exception 'Invalid service minutes';end if;
   delta:=(p->>'minutes')::integer;
   select * into b from reylumi_membership_buckets where membership_id=target and resource=ticket.kind and starts_at<=now() and ends_at>now() for update;
   select b.amount+coalesce(sum(le.delta),0) into balance from reylumi_membership_ledger le where le.bucket_id=b.id;
   if b.id is null or balance<delta then raise exception 'This service exceeds the remaining minutes. Approve extra credit before completion.';end if;
   insert into reylumi_membership_ledger(bucket_id,delta,reason,request_id,actor_user_id) values(b.id,-delta,why,req,actor);
  end if;
  update reylumi_membership_support set state=new_state,assignee=btrim(coalesce(p->>'assignee','')),scheduled_at=nullif(p->>'scheduled_at','')::timestamptz,minutes=delta,note=coalesce(p->>'note',''),revision=revision+1 where id=ticket.id;
  result:=jsonb_build_object('membership_id',target,'support_id',ticket.id,'state',new_state,'minutes',delta);
 else raise exception 'Invalid membership action';end if;
 insert into reylumi_membership_events(membership_id,actor_user_id,action,reason,details,request_id) values(target,actor,act,why,result||jsonb_build_object('input',p-'request_id'),req);
 insert into platform_admin_audit_logs(actor_user_id,action,target_type,target_id,reason,after_data) values(actor,'membership.'||act,'system',target,why,result);
 return result;
end $$;
revoke all on function public.reylumi_membership_command(jsonb) from public,anon;
grant execute on function public.reylumi_membership_command(jsonb) to authenticated;
commit;
