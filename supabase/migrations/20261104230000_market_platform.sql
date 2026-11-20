begin;

-- Independent from metadata-only registry approvals and first-party billing.
create schema market_platform;
revoke all on schema market_platform from public,anon,authenticated,service_role;
create table market_platform.settings(id boolean primary key default true check(id),enabled boolean not null default false);
insert into market_platform.settings values(true,false);
create table market_platform.organizations(
 id uuid primary key default gen_random_uuid(),owner_id uuid unique references public.users(id) on delete set null,
 name text not null check(char_length(name) between 2 and 100),created_at timestamptz not null default now()
);
create table market_platform.apps(
 id uuid primary key default gen_random_uuid(),organization_id uuid not null references market_platform.organizations(id),
 request_id uuid not null default gen_random_uuid(),active boolean not null default true,created_at timestamptz not null default now(),unique(organization_id,request_id)
);
create table market_platform.versions(
 id uuid primary key default gen_random_uuid(),app_id uuid not null references market_platform.apps(id),
 manifest jsonb not null,canonical text not null,sha256 text not null check(sha256 ~ '^[a-f0-9]{64}$'),
 version text not null,created_at timestamptz not null default now(),erased_at timestamptz,unique(app_id,version)
);
create table market_platform.reviews(
 version_id uuid primary key references market_platform.versions(id),decision text not null check(decision in ('approved','rejected')),
 reason text not null check(char_length(reason) between 3 and 1000),actor_id uuid references public.users(id) on delete set null,
 created_at timestamptz not null default now()
);
create table market_platform.installations(
 id uuid primary key default gen_random_uuid(),salon_id uuid not null references public.locations(id),
 app_id uuid not null references market_platform.apps(id),version_id uuid not null references market_platform.versions(id),
 consented_by uuid references public.users(id) on delete set null,scopes jsonb not null,
 state text not null check(state in ('active','revoked')),generation integer not null default 1,
 updated_at timestamptz not null default now(),unique(salon_id,app_id)
);
create table market_platform.tokens(
 id uuid primary key default gen_random_uuid(),installation_id uuid not null references market_platform.installations(id),
 token_hash text unique not null check(token_hash ~ '^[a-f0-9]{64}$'),generation integer not null,
 expires_at timestamptz not null,created_at timestamptz not null default now()
);
create table market_platform.refresh_grants(
 installation_id uuid primary key references market_platform.installations(id),token_hash text unique not null check(token_hash ~ '^[a-f0-9]{64}$'),
 generation integer not null,expires_at timestamptz not null
);
create table market_platform.events(
 id uuid primary key default gen_random_uuid(),actor_id uuid references public.users(id) on delete set null,
 kind text not null,object_id uuid not null,reason text check(reason is null or char_length(reason)<=1000),created_at timestamptz not null default now()
);
create table market_platform.sandboxes(
 id uuid primary key default gen_random_uuid(),version_id uuid not null references market_platform.versions(id),
 actor_id uuid references public.users(id) on delete cascade,token_hash text unique not null,
 expires_at timestamptz not null default now()+interval '24 hours',request_count integer not null default 0,
 last_request_at timestamptz,unique(actor_id,version_id)
);
create index market_platform_token_installation on market_platform.tokens(installation_id);
create index market_platform_event_time on market_platform.events(created_at desc);

create function market_platform.immutable() returns trigger language plpgsql set search_path=pg_catalog as $$
begin
 if tg_table_name='reviews' then
 if tg_op='UPDATE' and pg_trigger_depth()>1 and old.actor_id is not null and new.actor_id is null
 and not exists(select 1 from public.users where id=old.actor_id and status<>'deleted')
 and new.version_id=old.version_id and new.decision=old.decision and new.created_at=old.created_at then
  new.reason:='Review reason removed after account erasure.';return new;
 end if;
 elsif tg_table_name='versions' then
 if tg_op='UPDATE' and pg_trigger_depth()>1 and new.manifest='{}'::jsonb and new.canonical='' and new.erased_at is not null
 and old.erased_at is null and new.id=old.id and new.app_id=old.app_id and new.sha256=old.sha256 and new.version=old.version and new.created_at=old.created_at
 and not exists(select 1 from market_platform.apps a join market_platform.organizations o on o.id=a.organization_id join public.users u on u.id=o.owner_id where a.id=old.app_id and u.status<>'deleted') then return new; end if;
 end if;
 raise exception using errcode='42501',message='Immutable Market record.';
end $$;
create trigger market_version_immutable before update or delete on market_platform.versions for each row execute function market_platform.immutable();
create trigger market_review_immutable before update or delete on market_platform.reviews for each row execute function market_platform.immutable();

create function market_platform.actor() returns uuid language plpgsql security definer set search_path=pg_catalog,market_platform as $$
declare actor uuid;
begin
 perform 1 from settings where id and enabled for share;
 if not found then raise exception using errcode='42501',message='Market platform is unavailable.'; end if;
 select id into actor from public.users where id=public.current_public_user_id() and status='active' for share;
 if actor is null then raise exception using errcode='42501',message='Sign in with an active account.'; end if;
 return actor;
end $$;

-- Hosted apps run on the developer's HTTPS origin, never inside the POS.
-- Only a bounded JSON connection artifact is stored, not arbitrary archives.
create function market_platform.validate_manifest(p jsonb) returns jsonb language plpgsql immutable set search_path=pg_catalog as $$
declare k text; scope jsonb; uri text;
begin
 if p is null or jsonb_typeof(p)<>'object' or octet_length(p::text)>16384
 or (select count(*) from jsonb_object_keys(p))<>10
 or not p ?& array['schemaVersion','type','version','name','description','launchUrl','privacyUrl','supportUrl','scopes','price']
 or p->'schemaVersion'<>'1'::jsonb or p->>'type' is distinct from 'hosted-app' then
 raise exception using errcode='22023',message='Upload a supported hosted-app manifest (maximum 16 KiB).'; end if;
 foreach k in array array['version','name','description','launchUrl','privacyUrl','supportUrl'] loop
  if jsonb_typeof(p->k)<>'string' or p->>k<>btrim(p->>k) or (p->>k) ~ '[\x00-\x1f\x7f]' then
   raise exception using errcode='22023',message='Manifest fields must be plain trimmed text.'; end if;
 end loop;
 if jsonb_typeof(p->'price')<>'object' or (select count(*) from jsonb_object_keys(p->'price'))<>3
 or not (p->'price') ?& array['currency','amountCents','billing'] or p->'price'->>'currency' is distinct from 'usd' or p->'price'->>'billing' is distinct from 'one-time-version'
 or jsonb_typeof(p->'price'->'amountCents')<>'number' or p->'price'->>'amountCents' !~ '^(0|[1-9][0-9]{0,5})$' then
 raise exception using errcode='22023',message='Use a USD one-time version price from 0 to 999999 cents.'; end if;
 if (p->'price'->>'amountCents')::integer between 1 and 49 then raise exception using errcode='22023',message='Paid USD versions must cost at least 50 cents.'; end if;
 if char_length(p->>'name') not between 2 and 100 or char_length(p->>'description') not between 10 and 2000
 or char_length(p->>'version')>64 or p->>'version' !~ '^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$' then
 raise exception using errcode='22023',message='Check name, description and stable semantic version.'; end if;
 foreach k in array array['launchUrl','privacyUrl','supportUrl'] loop
  uri:=p->>k;
  -- No credentials, fragments, ports, IP literals, private hosts or callbacks.
  if char_length(uri)>2048 or uri !~ '^https://[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*\.[a-z]{2,63}(/[A-Za-z0-9._~!$&()*+,;=:@%/-]*)?$'
  or uri ~ '^https://[^/]*\.(localhost|local|internal|test|invalid|example)(/|$)' then
   raise exception using errcode='22023',message='Use public HTTPS URLs without credentials, queries or fragments.'; end if;
 end loop;
 if jsonb_typeof(p->'scopes')<>'array' or jsonb_array_length(p->'scopes')>1 then
 raise exception using errcode='22023',message='Unsupported API permissions.'; end if;
 for scope in select value from jsonb_array_elements(p->'scopes') loop
  if scope<>'"salon:identity:read"'::jsonb then raise exception using errcode='22023',message='Unsupported API permission.'; end if;
 end loop;
 return p;
end $$;

-- Public RPCs always derive actor from the authenticated session.
create function public.market_platform_workspace() returns jsonb language plpgsql security definer set search_path=pg_catalog,market_platform as $$
declare actor uuid:=market_platform.actor(); org organizations; reviewer boolean;
begin
 select * into org from organizations where owner_id=actor;
 reviewer:=exists(select 1 from market_private.reviewers r where r.user_id=actor and r.active);
 return jsonb_build_object('organization',case when org.id is not null then to_jsonb(org) else null end,'reviewer',reviewer,
 'apps',coalesce((select jsonb_agg(jsonb_build_object('id',a.id,'active',a.active,'versions',coalesce((select jsonb_agg(to_jsonb(v)||jsonb_build_object('review',(select to_jsonb(r) from reviews r where r.version_id=v.id)) order by v.created_at desc) from versions v where v.app_id=a.id and v.erased_at is null),'[]'::jsonb))) from apps a where a.organization_id=org.id),'[]'::jsonb),
 'moderation',case when reviewer then coalesce((select jsonb_agg(jsonb_build_object('id',a.id,'active',a.active,'publisher',o.name)) from apps a join organizations o on o.id=a.organization_id),'[]'::jsonb) else '[]'::jsonb end,
 'sandboxes',coalesce((select jsonb_agg(jsonb_build_object('id',s.id,'version_id',s.version_id,'expires_at',s.expires_at,'request_count',s.request_count,'last_request_at',s.last_request_at)) from sandboxes s where s.actor_id=actor),'[]'::jsonb),
 'queue',case when reviewer then coalesce((select jsonb_agg(to_jsonb(v)||jsonb_build_object('publisher',o.name)) from versions v join apps a on a.id=v.app_id join organizations o on o.id=a.organization_id join public.users u on u.id=o.owner_id and u.status='active' where v.erased_at is null and o.owner_id is distinct from actor and not exists(select 1 from reviews r where r.version_id=v.id)),'[]'::jsonb) else '[]'::jsonb end,
 'salons',coalesce((select jsonb_agg(jsonb_build_object('id',l.id,'name',l.name)) from public.locations l where coalesce(public.lifecycle_user_is_salon_owner(l.id,actor,false),false)),'[]'::jsonb),
 'installations',coalesce((select jsonb_agg(to_jsonb(i)||jsonb_build_object('manifest',v.manifest)) from installations i join versions v on v.id=i.version_id where coalesce(public.lifecycle_user_is_salon_owner(i.salon_id,actor,false),false)),'[]'::jsonb),
 'catalog',coalesce((select jsonb_agg(to_jsonb(v)||jsonb_build_object('publisher',o.name)) from versions v join reviews r on r.version_id=v.id and r.decision='approved' join apps a on a.id=v.app_id and a.active join organizations o on o.id=a.organization_id join public.users u on u.id=o.owner_id and u.status='active' where v.erased_at is null),'[]'::jsonb));
end $$;

create function public.market_platform_sandbox(p_version uuid,p_token_hash text) returns jsonb language plpgsql security definer set search_path=pg_catalog,market_platform as $$
declare actor uuid:=market_platform.actor(); v versions; s sandboxes;
begin
 select * into v from versions where id=p_version;
 if v.id is null or not (exists(select 1 from apps a join organizations o on o.id=a.organization_id where a.id=v.app_id and o.owner_id=actor)
 or exists(select 1 from market_private.reviewers where user_id=actor and active)) then raise exception using errcode='42501',message='Developer or reviewer access required.'; end if;
 if p_token_hash is null or p_token_hash !~ '^[a-f0-9]{64}$' then raise exception using errcode='22023',message='Invalid token digest.'; end if;
 insert into sandboxes(version_id,actor_id,token_hash) values(v.id,actor,p_token_hash)
 on conflict(actor_id,version_id) do update set token_hash=excluded.token_hash,expires_at=now()+interval '24 hours',request_count=0,last_request_at=null returning * into s;
 return jsonb_build_object('id',s.id,'versionId',v.id,'expiresAt',s.expires_at,'synthetic',true);
end $$;

create function public.market_platform_register(p_name text) returns uuid language plpgsql security definer set search_path=pg_catalog,market_platform as $$
declare actor uuid:=market_platform.actor(); oid uuid;
begin
 if p_name is null or char_length(btrim(p_name)) not between 2 and 100 or p_name ~ '[\x00-\x1f\x7f]' then raise exception using errcode='22023',message='Enter an organization name (2–100 characters).'; end if;
 insert into organizations(owner_id,name) values(actor,btrim(p_name)) on conflict(owner_id) do nothing returning id into oid;
 if oid is null then select id into oid from organizations where owner_id=actor; end if;
 return oid;
end $$;

create function public.market_platform_submit(p_app uuid,p_manifest jsonb,p_request uuid default null) returns jsonb language plpgsql security definer set search_path=pg_catalog,market_platform as $$
declare actor uuid:=market_platform.actor(); oid uuid; aid uuid; v versions; checked_manifest jsonb:=market_platform.validate_manifest(p_manifest);
begin
 select id into oid from organizations where owner_id=actor for update;
 if oid is null then raise exception using errcode='42501',message='Register your developer organization first.'; end if;
 if p_app is null then
  if p_request is null then raise exception using errcode='22023',message='A submission request ID is required.'; end if;
  select id into aid from apps where organization_id=oid and request_id=p_request;
  if aid is null then
  if (select count(*) from apps where organization_id=oid)>=50 then raise exception using errcode='22023',message='Organization app limit reached.'; end if;
  insert into apps(organization_id,request_id) values(oid,p_request) returning id into aid;
  end if;
 else
  select id into aid from apps where id=p_app and organization_id=oid for update;
  if aid is null then raise exception using errcode='42501',message='App is unavailable.'; end if;
 end if;
 select * into v from versions where app_id=aid and version=checked_manifest->>'version';
 if v.id is not null then
  if v.manifest<>checked_manifest then raise exception using errcode='PT409',message='Version is immutable. Submit a new version.'; end if;
  return to_jsonb(v);
 end if;
 if (select count(*) from versions where app_id=aid)>=100 then raise exception using errcode='22023',message='App version limit reached.'; end if;
 insert into versions(app_id,manifest,canonical,sha256,version) values(aid,checked_manifest,checked_manifest::text,encode(sha256(convert_to(checked_manifest::text,'UTF8')),'hex'),checked_manifest->>'version') returning * into v;
 insert into events(actor_id,kind,object_id) values(actor,'submitted',v.id);
 return to_jsonb(v);
end $$;

create function public.market_platform_review(p_version uuid,p_sha256 text,p_decision text,p_reason text) returns jsonb language plpgsql security definer set search_path=pg_catalog,market_platform as $$
declare actor uuid:=market_platform.actor(); v versions; r reviews;
begin
 if not exists(select 1 from market_private.reviewers where user_id=actor and active) then raise exception using errcode='42501',message='Reviewer access required.'; end if;
 select * into v from versions where id=p_version for update;
 if v.id is null or v.sha256 is distinct from p_sha256 then raise exception using errcode='PT409',message='Reload the exact submitted artifact.'; end if;
 if exists(select 1 from apps a join organizations o on o.id=a.organization_id where a.id=v.app_id and o.owner_id=actor) then raise exception using errcode='42501',message='Independent review required.'; end if;
 if p_decision is null or p_decision not in ('approved','rejected') or p_reason is null or char_length(btrim(p_reason)) not between 3 and 1000 then raise exception using errcode='22023',message='Choose a decision and provide a reason.'; end if;
 select * into r from reviews where version_id=v.id;
 if r.version_id is not null then
  if r.decision<>p_decision or r.reason<>btrim(p_reason) or r.actor_id is distinct from actor then raise exception using errcode='PT409',message='Review already recorded.'; end if;
  return to_jsonb(r);
 end if;
 insert into reviews(version_id,decision,reason,actor_id) values(v.id,p_decision,btrim(p_reason),actor) returning * into r;
 insert into events(actor_id,kind,object_id) values(actor,p_decision,v.id);
 return to_jsonb(r);
end $$;

create function market_platform.entitled(p_salon uuid,p_version uuid) returns boolean language sql stable security definer set search_path=pg_catalog,market_platform as $$
 select exists(select 1 from versions where id=p_version and (manifest->'price'->>'amountCents')::integer=0)
$$;
create function public.market_platform_install(p_salon uuid,p_version uuid,p_sha256 text,p_scopes jsonb) returns jsonb language plpgsql security definer set search_path=pg_catalog,market_platform as $$
declare actor uuid:=market_platform.actor(); v versions; i installations;
begin
 if not coalesce(public.lifecycle_user_is_salon_owner(p_salon,actor,false),false) then raise exception using errcode='42501',message='Active salon owner access required.'; end if;
 if not exists(select 1 from public.locations where id=p_salon and status='active' for share) then raise exception using errcode='42501',message='Active salon required.'; end if;
 select * into v from versions where id=p_version for share;
 if v.id is null or v.sha256 is distinct from p_sha256 or v.manifest->'scopes' is distinct from p_scopes
 or not exists(select 1 from reviews r where r.version_id=v.id and r.decision='approved')
 or not exists(select 1 from apps a join organizations o on o.id=a.organization_id join public.users u on u.id=o.owner_id and u.status='active' where a.id=v.app_id and a.active) then
 raise exception using errcode='PT409',message='Review this exact approved version and its permissions before installing.'; end if;
 if not market_platform.entitled(p_salon,v.id) then
  raise exception using errcode='42501',message='Paid versions require verified payment entitlement.';
 end if;
 select * into i from installations where salon_id=p_salon and app_id=v.app_id for update;
 if i.id is not null and i.state='active' and i.version_id=v.id and i.consented_by=actor and i.scopes=p_scopes then return to_jsonb(i); end if;
 insert into installations(salon_id,app_id,version_id,consented_by,scopes,state) values(p_salon,v.app_id,v.id,actor,p_scopes,'active')
 on conflict(salon_id,app_id) do update set version_id=excluded.version_id,consented_by=excluded.consented_by,scopes=excluded.scopes,state='active',generation=installations.generation+1,updated_at=now()
 returning * into i;
 insert into events(actor_id,kind,object_id) values(actor,'consented',i.id);
 return to_jsonb(i);
end $$;

create function public.market_platform_revoke(p_installation uuid) returns boolean language plpgsql security definer set search_path=pg_catalog,market_platform as $$
declare actor uuid:=market_platform.actor(); i installations;
begin
 select * into i from installations where id=p_installation for update;
 if i.id is null or not coalesce(public.lifecycle_user_is_salon_owner(i.salon_id,actor,false),false) then raise exception using errcode='42501',message='Active salon owner access required.'; end if;
 if i.state='revoked' then return true; end if;
 update installations set state='revoked',generation=generation+1,updated_at=now() where id=i.id;
 delete from tokens where installation_id=i.id;
 delete from refresh_grants where installation_id=i.id;
 insert into events(actor_id,kind,object_id) values(actor,'revoked',i.id);
 return true;
end $$;

-- Hash-only persistence. Clear tokens are generated in the authenticated web
-- action, shown once, short-lived, and never placed in URLs or event logs.
create function public.market_platform_issue_token(p_installation uuid,p_token_hash text) returns timestamptz language plpgsql security definer set search_path=pg_catalog,market_platform as $$
declare actor uuid:=market_platform.actor(); i installations; until_at timestamptz:=now()+interval '15 minutes';
begin
 select * into i from installations where id=p_installation and state='active' for update;
 if i.id is null or not coalesce(public.lifecycle_user_is_salon_owner(i.salon_id,actor,false),false) then raise exception using errcode='42501',message='Active installation owner required.'; end if;
 if not exists(select 1 from public.locations where id=i.salon_id and status='active') then raise exception using errcode='42501',message='Active salon required.'; end if;
 if p_token_hash is null or p_token_hash !~ '^[a-f0-9]{64}$' then raise exception using errcode='22023',message='Invalid token digest.'; end if;
 delete from tokens where installation_id=i.id;
 delete from refresh_grants where installation_id=i.id;
 insert into tokens(installation_id,token_hash,generation,expires_at) values(i.id,p_token_hash,i.generation,until_at);
 return until_at;
end $$;

create function public.market_platform_issue_connection(p_installation uuid,p_access_hash text,p_refresh_hash text) returns jsonb language plpgsql security definer set search_path=pg_catalog,market_platform as $$
declare until_at timestamptz; i installations; refresh_until timestamptz:=now()+interval '30 days';
begin
 if p_refresh_hash is null or p_refresh_hash !~ '^[a-f0-9]{64}$' or p_refresh_hash=p_access_hash then raise exception using errcode='22023',message='Invalid refresh digest.'; end if;
 until_at:=public.market_platform_issue_token(p_installation,p_access_hash);
 select * into i from installations where id=p_installation for update;
 insert into refresh_grants(installation_id,token_hash,generation,expires_at) values(i.id,p_refresh_hash,i.generation,refresh_until);
 return jsonb_build_object('accessExpiresAt',until_at,'refreshExpiresAt',refresh_until);
end $$;

create function public.market_platform_refresh(p_current_hash text,p_access_hash text,p_refresh_hash text) returns jsonb language plpgsql security definer set search_path=pg_catalog,market_platform as $$
declare g refresh_grants; i installations; until_at timestamptz:=now()+interval '15 minutes';
begin
 if not exists(select 1 from settings where id and enabled) then raise exception using errcode='42501',message='Runtime unavailable.'; end if;
 if p_current_hash is null or p_current_hash !~ '^[a-f0-9]{64}$' or p_access_hash is null or p_access_hash !~ '^[a-f0-9]{64}$'
 or p_refresh_hash is null or p_refresh_hash !~ '^[a-f0-9]{64}$' or p_current_hash=p_refresh_hash or p_access_hash=p_refresh_hash then raise exception using errcode='22023',message='Invalid refresh request.'; end if;
 select ins.* into i from installations ins join refresh_grants rg on rg.installation_id=ins.id where rg.token_hash=p_current_hash for update of ins;
 select * into g from refresh_grants where installation_id=i.id and token_hash=p_current_hash for update;
 if g.installation_id is null or g.expires_at<=now() or g.generation<>i.generation or i.state<>'active'
 or not exists(select 1 from public.users u where u.id=i.consented_by and u.status='active')
 or not coalesce(public.lifecycle_user_is_salon_owner(i.salon_id,i.consented_by,false),false)
 or not exists(select 1 from public.locations where id=i.salon_id and status='active') or not market_platform.entitled(i.salon_id,i.version_id)
 or not exists(select 1 from versions v join reviews r on r.version_id=v.id and r.decision='approved' join apps a on a.id=v.app_id and a.active join organizations o on o.id=a.organization_id join public.users u on u.id=o.owner_id and u.status='active' where v.id=i.version_id)
 then raise exception using errcode='42501',message='Connection expired or revoked. Ask the salon owner to reconnect.'; end if;
 update refresh_grants set token_hash=p_refresh_hash where installation_id=i.id;
 delete from tokens where installation_id=i.id;
 insert into tokens(installation_id,token_hash,generation,expires_at) values(i.id,p_access_hash,i.generation,until_at);
 return jsonb_build_object('accessExpiresAt',until_at,'refreshExpiresAt',g.expires_at);
end $$;

-- The sole runtime resource exposes only consented salon identity, never
-- customers, staff, tickets, financial records, or caller-selected salon IDs.
create function public.market_platform_runtime(p_token_hash text) returns jsonb language plpgsql security definer set search_path=pg_catalog,market_platform as $$
declare i installations; result jsonb; sandbox sandboxes;
begin
 if not exists(select 1 from settings where id and enabled) then raise exception using errcode='42501',message='Runtime unavailable.'; end if;
 select s.* into sandbox from sandboxes s join public.users u on u.id=s.actor_id and u.status='active' join versions v on v.id=s.version_id
 where s.token_hash=p_token_hash and s.expires_at>now() and s.request_count<1000 and v.manifest->'scopes' @> '["salon:identity:read"]'::jsonb
 and (exists(select 1 from apps a join organizations o on o.id=a.organization_id where a.id=v.app_id and o.owner_id=u.id)
 or exists(select 1 from market_private.reviewers r where r.user_id=u.id and r.active)) for update of s;
 if sandbox.id is not null then
  update sandboxes set request_count=request_count+1,last_request_at=now() where id=sandbox.id;
  return jsonb_build_object('id',sandbox.id,'name','Synthetic Test Salon','installationId',sandbox.id,'versionId',sandbox.version_id,'synthetic',true);
 end if;
 select ins.* into i from tokens t join installations ins on ins.id=t.installation_id and ins.generation=t.generation and ins.state='active'
 join public.users u on u.id=ins.consented_by and u.status='active'
 where t.token_hash=p_token_hash and t.expires_at>now() and coalesce(public.lifecycle_user_is_salon_owner(ins.salon_id,u.id,false),false) for share of t,ins,u;
 if i.id is null or not i.scopes @> '["salon:identity:read"]'::jsonb or not market_platform.entitled(i.salon_id,i.version_id)
 or not exists(select 1 from versions v join reviews r on r.version_id=v.id and r.decision='approved' join apps a on a.id=v.app_id and a.active join organizations o on o.id=a.organization_id join public.users u on u.id=o.owner_id and u.status='active' where v.id=i.version_id) then
 raise exception using errcode='42501',message='Token is expired, revoked or lacks permission.'; end if;
 select jsonb_build_object('id',l.id,'name',l.name,'installationId',i.id,'versionId',i.version_id) into result from public.locations l where l.id=i.salon_id and l.status='active';
 if result is null then raise exception using errcode='42501',message='Active salon required.'; end if;
 return result;
end $$;

create function public.market_platform_moderate(p_app uuid,p_active boolean,p_reason text) returns boolean language plpgsql security definer set search_path=pg_catalog,market_platform as $$
declare actor uuid:=market_platform.actor(); owner_id uuid;
begin
 select o.owner_id into owner_id from apps a join organizations o on o.id=a.organization_id where a.id=p_app for update of a;
 if owner_id is null or p_active is null or p_reason is null or char_length(btrim(p_reason)) not between 3 and 1000 then raise exception using errcode='22023',message='Choose an app and provide a reason.'; end if;
 if not ((owner_id=actor and not p_active) or (owner_id<>actor and exists(select 1 from market_private.reviewers where user_id=actor and active))) then raise exception using errcode='42501',message='Independent reviewer access required to restore an app.'; end if;
 update apps set active=p_active where id=p_app;
 insert into events(actor_id,kind,object_id,reason) values(actor,case when p_active then 'app_restored' else 'app_suspended' end,p_app,btrim(p_reason));
 return true;
end $$;

create function market_platform.erase_organization() returns trigger language plpgsql security definer set search_path=pg_catalog,market_platform as $$
begin
 if new.owner_id is null or exists(select 1 from public.users where id=new.owner_id and status='deleted') then
  if new.name<>'Deleted developer' then update organizations set name='Deleted developer' where id=new.id;end if;
  update apps set active=false where organization_id=new.id;
  update versions v set manifest='{}',canonical='',erased_at=now() from apps a where a.id=v.app_id and a.organization_id=new.id and v.erased_at is null;
 end if;return new;
end $$;
create trigger market_organization_erasure after update of owner_id,name on market_platform.organizations for each row execute function market_platform.erase_organization();
create function market_platform.erase_user() returns trigger language plpgsql security definer set search_path=pg_catalog,market_platform as $$
begin
 if tg_op='DELETE' then update events set reason=null where actor_id=old.id;return old;end if;
 if new.status='deleted' and old.status is distinct from new.status then
  update organizations set name='Deleted developer' where owner_id=new.id;
  update reviews set actor_id=null where actor_id=new.id;
  delete from sandboxes where actor_id=new.id;
  update events set reason=null where actor_id=new.id;
 end if;return new;
end $$;
create trigger market_user_erasure after update of status on public.users for each row execute function market_platform.erase_user();
create trigger market_user_physical_erasure before delete on public.users for each row execute function market_platform.erase_user();

do $$declare t text; f record; begin
 foreach t in array array['settings','organizations','apps','versions','reviews','installations','tokens','refresh_grants','events','sandboxes'] loop
  execute format('alter table market_platform.%I enable row level security',t);
  execute format('revoke all on market_platform.%I from public,anon,authenticated,service_role',t);
 end loop;
 for f in select p.oid::regprocedure signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='market_platform' loop execute format('revoke all on function %s from public,anon,authenticated,service_role',f.signature); end loop;
 for f in select p.oid::regprocedure signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname like 'market_platform_%' loop
  execute format('revoke all on function %s from public,anon,authenticated,service_role',f.signature);
  execute format('grant execute on function %s to authenticated',f.signature);
 end loop;
end $$;
-- Runtime needs no account cookie: authorization is the bounded bearer token.
grant execute on function public.market_platform_runtime(text) to anon;
grant execute on function public.market_platform_refresh(text,text,text) to anon;
commit;

