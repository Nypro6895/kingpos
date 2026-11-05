begin;
alter table market_platform.sandboxes add column connection_epoch bigint not null default 1;
create function market_platform.advance_sandbox_epoch() returns trigger language plpgsql set search_path=pg_catalog as $$begin new.connection_epoch:=old.connection_epoch+1;return new;end $$;
revoke all on function market_platform.advance_sandbox_epoch() from public,anon,authenticated,service_role;
create trigger market_advance_sandbox_epoch before update of token_hash on market_platform.sandboxes for each row execute function market_platform.advance_sandbox_epoch();
-- Test installations never reference a real salon or enter the Owner catalog.
create table market_platform.synthetic_connections(
 sandbox_id uuid primary key references market_platform.sandboxes(id) on delete cascade,
 sandbox_digest text not null,sandbox_epoch bigint not null,credential_generation integer not null,
 access_hash text unique,access_until timestamptz,refresh_hash text unique,refresh_until timestamptz
);
create table market_platform.synthetic_codes(
 code_hash text primary key check(code_hash ~ '^[a-f0-9]{64}$'),
 sandbox_id uuid not null references market_platform.sandboxes(id) on delete cascade,
 sandbox_digest text not null,sandbox_epoch bigint not null,credential_generation integer not null,
 challenge text not null check(challenge ~ '^[A-Za-z0-9_-]{43}$'),
 expires_at timestamptz not null default now()+interval '60 seconds',consumed_at timestamptz
);
create index market_synthetic_code_sandbox on market_platform.synthetic_codes(sandbox_id);
alter table market_platform.synthetic_connections enable row level security;
alter table market_platform.synthetic_codes enable row level security;
revoke all on market_platform.synthetic_connections,market_platform.synthetic_codes from public,anon,authenticated,service_role;

create function market_platform.synthetic_allowed(p_sandbox uuid) returns boolean language sql stable security definer set search_path=pg_catalog,market_platform as $$
 select exists(select 1 from sandboxes s join versions v on v.id=s.version_id and v.erased_at is null
 join apps a on a.id=v.app_id and a.active join organizations o on o.id=a.organization_id
 join public.users publisher on publisher.id=o.owner_id and publisher.status='active'
 join public.users tester on tester.id=s.actor_id and tester.status='active'
 where s.id=p_sandbox and s.expires_at>now() and s.request_count<1000
 and (o.owner_id=s.actor_id or exists(select 1 from market_private.reviewers r where r.user_id=s.actor_id and r.active))
 and exists(select 1 from settings where id and enabled))
$$;

alter function public.market_platform_sandbox(uuid,text) set schema market_platform;
alter function market_platform.market_platform_sandbox(uuid,text) rename to sandbox_base;
revoke all on function market_platform.sandbox_base(uuid,text) from public,anon,authenticated,service_role;
create function public.market_platform_sandbox(p_version uuid,p_token_hash text) returns jsonb language plpgsql security definer set search_path=pg_catalog,market_platform as $$
declare result jsonb:=sandbox_base(p_version,p_token_hash);
begin
 if not synthetic_allowed((result->>'id')::uuid) then raise exception using errcode='42501',message='This app or publisher is unavailable for testing.';end if;
 return result;
end $$;
revoke all on function public.market_platform_sandbox(uuid,text) from public,anon,authenticated,service_role;
grant execute on function public.market_platform_sandbox(uuid,text) to authenticated;

create function public.market_platform_sandbox_connection_start(p_version uuid) returns jsonb language plpgsql security definer set search_path=pg_catalog,market_platform as $$
declare actor uuid:=market_platform.actor();s sandboxes;v versions;
begin
 select * into s from sandboxes where actor_id=actor and version_id=p_version;
 if s.id is null or not synthetic_allowed(s.id) then raise exception using errcode='42501',message='Create or reset an available synthetic test salon first.';end if;
 select * into v from versions where id=s.version_id;
 if not exists(select 1 from app_credentials where app_id=v.app_id) then raise exception using errcode='42501',message='The developer must configure a confidential client first.';end if;
 return jsonb_build_object('launchUrl',v.manifest->>'launchUrl','clientId',v.app_id,'installationId',s.id,'versionId',v.id,'synthetic',true);
end $$;

create function public.market_platform_sandbox_authorize(p_installation uuid,p_client uuid,p_challenge text,p_code_hash text) returns jsonb language plpgsql security definer set search_path=pg_catalog,market_platform as $$
declare actor uuid:=market_platform.actor();s sandboxes;v versions;c app_credentials;
begin
 perform 1 from apps where id=p_client for share;
 select * into s from sandboxes where id=p_installation and actor_id=actor for update;
 if s.id is null or not synthetic_allowed(s.id) then raise exception using errcode='42501',message='Synthetic installation unavailable for this developer or reviewer.';end if;
 select * into v from versions where id=s.version_id;
 select * into c from app_credentials where app_id=p_client for share;
 if c.app_id is null or v.app_id<>p_client or p_challenge is null or p_challenge !~ '^[A-Za-z0-9_-]{43}$' or p_code_hash is null or p_code_hash !~ '^[a-f0-9]{64}$' then raise exception using errcode='22023',message='Invalid synthetic authorization request.';end if;
 delete from synthetic_codes where sandbox_id=s.id;
 insert into synthetic_codes(code_hash,sandbox_id,sandbox_digest,sandbox_epoch,credential_generation,challenge) values(p_code_hash,s.id,s.token_hash,s.connection_epoch,c.generation,p_challenge);
 return jsonb_build_object('launchUrl',v.manifest->>'launchUrl','synthetic',true);
end $$;

alter function public.market_platform_exchange_code(uuid,text,text,text,text,text) set schema market_platform;
alter function market_platform.market_platform_exchange_code(uuid,text,text,text,text,text) rename to exchange_owner_code;
revoke all on function market_platform.exchange_owner_code(uuid,text,text,text,text,text) from public,anon,authenticated,service_role;
create function public.market_platform_exchange_code(p_client uuid,p_client_secret text,p_code text,p_verifier text,p_access_hash text,p_refresh_hash text) returns jsonb language plpgsql security definer set search_path=pg_catalog,market_platform as $$
declare code synthetic_codes;s sandboxes;c app_credentials;v versions;digest text;challenge text;au timestamptz;ru timestamptz;
begin
 if p_code is null or p_code !~ '^rma_[A-Za-z0-9_-]{43}$' then raise exception using errcode='42501',message='Invalid authorization grant.';end if;
 digest:=encode(sha256(convert_to(p_code,'UTF8')),'hex');
 if not exists(select 1 from synthetic_codes where code_hash=digest) then return exchange_owner_code(p_client,p_client_secret,p_code,p_verifier,p_access_hash,p_refresh_hash);end if;
 if p_client_secret is null or p_client_secret !~ '^rmc_[A-Za-z0-9_-]{43}$' or p_verifier is null or p_verifier !~ '^[A-Za-z0-9._~-]{43,128}$' then raise exception using errcode='42501',message='Invalid synthetic grant.';end if;
 perform 1 from apps where id=p_client for share;
 select * into c from app_credentials where app_id=p_client and secret_hash=encode(sha256(convert_to(p_client_secret,'UTF8')),'hex') for share;
 select sb.* into s from sandboxes sb join synthetic_codes sc on sc.sandbox_id=sb.id where sc.code_hash=digest for update of sb;
 select * into code from synthetic_codes where code_hash=digest for update;
 select * into v from versions where id=s.version_id;
 challenge:=translate(rtrim(encode(sha256(convert_to(p_verifier,'UTF8')),'base64'),'='),'+/','-_');
 if c.app_id is null or v.app_id is distinct from p_client or code.code_hash is null or code.consumed_at is not null or code.expires_at<=now()
 or code.challenge is distinct from challenge or code.sandbox_digest is distinct from s.token_hash or code.sandbox_epoch is distinct from s.connection_epoch or code.credential_generation<>c.generation or not synthetic_allowed(s.id)
 then raise exception using errcode='42501',message='Synthetic authorization expired, used or revoked.';end if;
 if p_access_hash is null or p_access_hash !~ '^[a-f0-9]{64}$' or p_refresh_hash is null or p_refresh_hash !~ '^[a-f0-9]{64}$' or p_access_hash=p_refresh_hash then raise exception using errcode='22023',message='Invalid connection digest.';end if;
 au:=least(s.expires_at,now()+interval '15 minutes');ru:=s.expires_at;
 update synthetic_codes set consumed_at=now() where code_hash=digest;
 insert into synthetic_connections(sandbox_id,sandbox_digest,sandbox_epoch,credential_generation,access_hash,access_until,refresh_hash,refresh_until)
 values(s.id,s.token_hash,s.connection_epoch,c.generation,p_access_hash,au,p_refresh_hash,ru)
 on conflict(sandbox_id) do update set sandbox_digest=excluded.sandbox_digest,sandbox_epoch=excluded.sandbox_epoch,credential_generation=excluded.credential_generation,access_hash=excluded.access_hash,access_until=excluded.access_until,refresh_hash=excluded.refresh_hash,refresh_until=excluded.refresh_until;
 if not exists(select 1 from events where actor_id=s.actor_id and kind='synthetic_code_exchange_observed' and object_id=v.id) then
 insert into events(actor_id,kind,object_id) values(s.actor_id,'synthetic_code_exchange_observed',v.id);end if;
 return jsonb_build_object('accessExpiresAt',au,'refreshExpiresAt',ru,'installationId',s.id,'versionId',v.id,'salonId',s.id,'synthetic',true);
end $$;

alter function public.market_platform_refresh_client(uuid,text,text,text,text) set schema market_platform;
alter function market_platform.market_platform_refresh_client(uuid,text,text,text,text) rename to refresh_owner_client;
revoke all on function market_platform.refresh_owner_client(uuid,text,text,text,text) from public,anon,authenticated,service_role;
create function public.market_platform_refresh_client(p_client uuid,p_client_secret text,p_refresh_token text,p_access_hash text,p_refresh_hash text) returns jsonb language plpgsql security definer set search_path=pg_catalog,market_platform as $$
declare g synthetic_connections;s sandboxes;c app_credentials;v versions;digest text;au timestamptz;
begin
 if p_refresh_token is null or p_refresh_token !~ '^rmr_[A-Za-z0-9_-]{43}$' then raise exception using errcode='42501',message='Invalid application connection.';end if;
 digest:=encode(sha256(convert_to(p_refresh_token,'UTF8')),'hex');
 if not exists(select 1 from synthetic_connections where refresh_hash=digest) then return refresh_owner_client(p_client,p_client_secret,p_refresh_token,p_access_hash,p_refresh_hash);end if;
 if p_client_secret is null or p_client_secret !~ '^rmc_[A-Za-z0-9_-]{43}$' then raise exception using errcode='42501',message='Invalid application credentials.';end if;
 perform 1 from apps where id=p_client for share;
 select * into c from app_credentials where app_id=p_client and secret_hash=encode(sha256(convert_to(p_client_secret,'UTF8')),'hex') for share;
 select sb.* into s from sandboxes sb join synthetic_connections sc on sc.sandbox_id=sb.id where sc.refresh_hash=digest for update of sb;
 select * into g from synthetic_connections where refresh_hash=digest for update;
 select * into v from versions where id=s.version_id;
 if c.app_id is null or v.app_id is distinct from p_client or g.sandbox_id is null or g.refresh_until<=now() or g.sandbox_digest is distinct from s.token_hash or g.sandbox_epoch is distinct from s.connection_epoch or g.credential_generation<>c.generation or not synthetic_allowed(s.id)
 then raise exception using errcode='42501',message='Synthetic refresh expired or revoked.';end if;
 if p_access_hash is null or p_access_hash !~ '^[a-f0-9]{64}$' or p_refresh_hash is null or p_refresh_hash !~ '^[a-f0-9]{64}$' or p_access_hash=p_refresh_hash or p_refresh_hash=digest then raise exception using errcode='22023',message='Invalid connection digest.';end if;
 au:=least(g.refresh_until,now()+interval '15 minutes');
 update synthetic_connections set access_hash=p_access_hash,access_until=au,refresh_hash=p_refresh_hash where sandbox_id=s.id;
 return jsonb_build_object('accessExpiresAt',au,'refreshExpiresAt',g.refresh_until,'installationId',s.id,'versionId',v.id,'salonId',s.id,'synthetic',true);
end $$;

create function market_platform.synthetic_authority(p_hash text,p_group text) returns jsonb language plpgsql security definer set search_path=pg_catalog,market_platform as $$
declare s sandboxes;g synthetic_connections;v versions;
begin
 select sb.* into s from sandboxes sb join synthetic_connections sc on sc.sandbox_id=sb.id where sc.access_hash=p_hash for update of sb;
 select * into g from synthetic_connections where access_hash=p_hash;
 select * into v from versions where id=s.version_id;
 if s.id is null or p_group is null or p_group not in ('identity','profile','services','media','content') or g.access_until<=now() or g.sandbox_digest is distinct from s.token_hash or g.sandbox_epoch is distinct from s.connection_epoch
 or not exists(select 1 from app_credentials c where c.app_id=v.app_id and c.generation=g.credential_generation)
 or not synthetic_allowed(s.id) or not (v.manifest->'scopes' ? ('salon:'||p_group||':read')) then raise exception using errcode='42501',message='Synthetic token expired, revoked or lacks permission.';end if;
 update sandboxes set request_count=request_count+1,last_request_at=now() where id=s.id;
 if p_group<>'identity' then insert into sandbox_group_usage(sandbox_id,group_name,request_count,last_request_at) values(s.id,p_group,1,now()) on conflict(sandbox_id,group_name) do update set request_count=sandbox_group_usage.request_count+1,last_request_at=now();end if;
 return jsonb_build_object('salonId',s.id,'installationId',s.id,'versionId',s.version_id,'synthetic',true);
end $$;

alter function market_platform.runtime_digest(text) rename to runtime_digest_legacy;
create function market_platform.runtime_digest(p_token_hash text) returns jsonb language plpgsql security definer set search_path=pg_catalog,market_platform as $$
declare a jsonb;
begin
 if exists(select 1 from synthetic_connections where access_hash=p_token_hash) then
 a:=synthetic_authority(p_token_hash,'identity');return a||jsonb_build_object('id',a->'salonId','name','Synthetic Test Salon');end if;
 if exists(select 1 from sandboxes where token_hash=p_token_hash and not synthetic_allowed(id)) then raise exception using errcode='42501',message='Synthetic salon unavailable.';end if;
 return runtime_digest_legacy(p_token_hash);
end $$;
alter function market_platform.publication_authority(text,text) rename to publication_authority_legacy;
create function market_platform.publication_authority(p_token text,p_group text) returns jsonb language plpgsql security definer set search_path=pg_catalog,market_platform as $$
declare digest text;
begin
 if p_token is null or p_token !~ '^rmp_[A-Za-z0-9_-]{43}$' then raise exception using errcode='42501',message='Invalid published-data grant.';end if;
 digest:=encode(sha256(convert_to(p_token,'UTF8')),'hex');
 if exists(select 1 from synthetic_connections where access_hash=digest) then return synthetic_authority(digest,p_group);end if;
 return publication_authority_legacy(p_token,p_group);
end $$;

do $$declare f record;begin
 for f in select p.oid::regprocedure signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='market_platform' and p.proname in ('synthetic_allowed','synthetic_authority','runtime_digest','runtime_digest_legacy','publication_authority','publication_authority_legacy') loop execute format('revoke all on function %s from public,anon,authenticated,service_role',f.signature);end loop;
end $$;
revoke all on function public.market_platform_sandbox_connection_start(uuid),public.market_platform_sandbox_authorize(uuid,uuid,text,text),public.market_platform_exchange_code(uuid,text,text,text,text,text),public.market_platform_refresh_client(uuid,text,text,text,text) from public,anon,authenticated,service_role;
grant execute on function public.market_platform_sandbox_connection_start(uuid),public.market_platform_sandbox_authorize(uuid,uuid,text,text) to authenticated;
grant execute on function public.market_platform_exchange_code(uuid,text,text,text,text,text),public.market_platform_refresh_client(uuid,text,text,text,text) to anon,authenticated;

-- A fixed generated image exercises the scoped image gateway without a storage
-- bucket, real salon asset, external fetch or private storage credential.
alter function public.market_platform_published_group(text,text) set schema market_platform;
alter function market_platform.market_platform_published_group(text,text) rename to published_group_base;
revoke all on function market_platform.published_group_base(text,text) from public,anon,authenticated,service_role;
create function public.market_platform_published_group(p_token text,p_group text) returns jsonb language plpgsql security definer set search_path=pg_catalog,market_platform as $$
declare result jsonb:=published_group_base(p_token,p_group);
begin
 if p_group='media' and result->>'synthetic'='true' then result:=jsonb_set(result,'{data,images}','[{"assetId":"00000000-0000-4000-8000-000000000003","label":"Synthetic color sample; not a salon photo","caption":"Generated test color; no salon photo or private metadata","role":"gallery","rights":"owner"}]'::jsonb);end if;
 return result;
end $$;
revoke all on function public.market_platform_published_group(text,text) from public,anon,authenticated,service_role;
grant execute on function public.market_platform_published_group(text,text) to anon,authenticated;
alter function public.market_platform_developer_tools() set schema market_platform;
alter function market_platform.market_platform_developer_tools() rename to developer_tools_base;
revoke all on function market_platform.developer_tools_base() from public,anon,authenticated,service_role;
create function public.market_platform_developer_tools() returns jsonb language plpgsql security definer set search_path=pg_catalog,market_platform as $$
declare result jsonb:=developer_tools_base();actor uuid:=market_platform.actor();
begin
 return jsonb_set(result,'{readiness}',coalesce((select jsonb_agg(jsonb_set(report,'{checks}',(report->'checks')||jsonb_build_array(jsonb_build_object('name','Synthetic code exchange recorded (history)','passed',exists(select 1 from events e where e.actor_id=actor and e.kind='synthetic_code_exchange_observed' and e.object_id=(report->>'versionId')::uuid))))) from jsonb_array_elements(result->'readiness') report),'[]'::jsonb));
end $$;
revoke all on function public.market_platform_developer_tools() from public,anon,authenticated,service_role;
grant execute on function public.market_platform_developer_tools() to authenticated;
commit;
