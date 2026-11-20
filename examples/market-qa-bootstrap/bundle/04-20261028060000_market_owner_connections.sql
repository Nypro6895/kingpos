begin;
create table market_platform.app_credentials(
 app_id uuid primary key references market_platform.apps(id),secret_hash text not null check(secret_hash ~ '^[a-f0-9]{64}$'),
 generation integer not null default 1,updated_at timestamptz not null default now()
);
create table market_platform.authorization_codes(
 code_hash text primary key check(code_hash ~ '^[a-f0-9]{64}$'),installation_id uuid not null references market_platform.installations(id),
 app_id uuid not null references market_platform.apps(id),credential_generation integer not null,installation_generation integer not null,
 challenge text not null check(challenge ~ '^[A-Za-z0-9_-]{43}$'),expires_at timestamptz not null default now()+interval '60 seconds',consumed_at timestamptz
);
alter table market_platform.app_credentials enable row level security;
alter table market_platform.authorization_codes enable row level security;
revoke all on market_platform.app_credentials,market_platform.authorization_codes from public,anon,authenticated,service_role;

create function market_platform.connection_allowed(p_installation uuid) returns boolean language sql stable security definer set search_path=pg_catalog,market_platform as $$
 select exists(select 1 from installations i join public.locations l on l.id=i.salon_id and l.status='active'
 join public.users owner_user on owner_user.id=i.consented_by and owner_user.status='active'
 join versions v on v.id=i.version_id and v.erased_at is null join reviews r on r.version_id=v.id and r.decision='approved'
 join apps a on a.id=i.app_id and a.active join organizations o on o.id=a.organization_id
 join public.users publisher on publisher.id=o.owner_id and publisher.status='active'
 where i.id=p_installation and i.state='active' and coalesce(public.lifecycle_user_is_salon_owner(i.salon_id,i.consented_by,false),false)
 and market_platform.entitled(i.salon_id,i.version_id) and exists(select 1 from settings where id and enabled))
$$;
revoke all on function market_platform.connection_allowed(uuid) from public,anon,authenticated,service_role;

create function public.market_platform_owner_workspace(p_salon uuid) returns jsonb language plpgsql security definer set search_path=pg_catalog,market_platform as $$
declare actor uuid:=market_platform.actor(); salon_name text;
begin
 if not coalesce(public.lifecycle_user_is_salon_owner(p_salon,actor,false),false) then raise exception using errcode='42501',message='Active salon Owner access required.';end if;
 select name into salon_name from public.locations where id=p_salon and status='active' for share;
 if salon_name is null then raise exception using errcode='42501',message='Active salon required.';end if;
 return jsonb_build_object('salonId',p_salon,'salonName',salon_name,'observedAt',statement_timestamp(),
 'testPaymentsEnabled',(select commerce_test_enabled and commission_bps is not null from settings where id),
 'catalog',coalesce((select jsonb_agg(to_jsonb(v)||jsonb_build_object('publisher',o.name,'entitled',market_platform.entitled(p_salon,v.id),'connectionReady',exists(select 1 from app_credentials ac where ac.app_id=a.id)))
 from versions v join reviews r on r.version_id=v.id and r.decision='approved' join apps a on a.id=v.app_id and a.active
 join organizations o on o.id=a.organization_id join public.users u on u.id=o.owner_id and u.status='active' where v.erased_at is null),'[]'::jsonb),
 'installations',coalesce((select jsonb_agg(jsonb_build_object('id',i.id,'appId',i.app_id,'versionId',i.version_id,'state',i.state,'scopes',i.scopes,
 'usable',market_platform.connection_allowed(i.id),'connectionReady',exists(select 1 from app_credentials ac where ac.app_id=i.app_id))) from installations i where i.salon_id=p_salon),'[]'::jsonb));
end $$;

create function public.market_platform_rotate_client(p_app uuid,p_secret_hash text) returns boolean language plpgsql security definer set search_path=pg_catalog,market_platform as $$
declare actor uuid:=market_platform.actor();
begin
 perform 1 from apps a join organizations o on o.id=a.organization_id where a.id=p_app and o.owner_id=actor for update of a;
 if not found then raise exception using errcode='42501',message='Developer organization owner required.';end if;
 if p_secret_hash is null or p_secret_hash !~ '^[a-f0-9]{64}$' then raise exception using errcode='22023',message='Invalid client secret digest.';end if;
 insert into app_credentials(app_id,secret_hash) values(p_app,p_secret_hash) on conflict(app_id) do update set secret_hash=excluded.secret_hash,generation=app_credentials.generation+1,updated_at=now();
 update installations set generation=generation+1 where app_id=p_app;
 delete from tokens t using installations i where t.installation_id=i.id and i.app_id=p_app;
 delete from refresh_grants g using installations i where g.installation_id=i.id and i.app_id=p_app;
 delete from authorization_codes where app_id=p_app;
 insert into events(actor_id,kind,object_id) values(actor,'client_rotated',p_app);return true;
end $$;

create function public.market_platform_connection_start(p_salon uuid,p_installation uuid) returns jsonb language plpgsql security definer set search_path=pg_catalog,market_platform as $$
declare actor uuid:=market_platform.actor(); i installations; url text;
begin
 select * into i from installations where id=p_installation and salon_id=p_salon for share;
 if i.id is null or not coalesce(public.lifecycle_user_is_salon_owner(p_salon,actor,false),false) or not market_platform.connection_allowed(i.id) then raise exception using errcode='42501',message='This salon connection is unavailable.';end if;
 if not exists(select 1 from app_credentials where app_id=i.app_id) then raise exception using errcode='42501',message='The developer has not configured this app connection yet.';end if;
 select manifest->>'launchUrl' into url from versions where id=i.version_id;
 return jsonb_build_object('launchUrl',url,'clientId',i.app_id,'installationId',i.id,'versionId',i.version_id);
end $$;

create function public.market_platform_connection_owner_check(p_salon uuid,p_installation uuid) returns boolean language plpgsql security definer set search_path=pg_catalog,market_platform as $$
declare actor uuid:=market_platform.actor();
begin
 if not coalesce(public.lifecycle_user_is_salon_owner(p_salon,actor,false),false) or not exists(select 1 from public.locations where id=p_salon and status='active')
 or not exists(select 1 from installations where id=p_installation and salon_id=p_salon) then raise exception using errcode='42501',message='Installation does not belong to your active salon.';end if;return true;
end $$;

create function public.market_platform_authorize(p_salon uuid,p_installation uuid,p_client uuid,p_challenge text,p_code_hash text) returns jsonb language plpgsql security definer set search_path=pg_catalog,market_platform as $$
declare info jsonb; i installations; c app_credentials;
begin
 perform 1 from apps where id=p_client for share;
 info:=public.market_platform_connection_start(p_salon,p_installation);
 select * into i from installations where id=p_installation for update;
 select * into c from app_credentials where app_id=p_client for share;
 if c.app_id is null or i.app_id<>p_client or p_challenge is null or p_challenge !~ '^[A-Za-z0-9_-]{43}$' or p_code_hash is null or p_code_hash !~ '^[a-f0-9]{64}$' then raise exception using errcode='22023',message='Invalid authorization request.';end if;
 delete from authorization_codes where installation_id=i.id;
 insert into authorization_codes(code_hash,installation_id,app_id,credential_generation,installation_generation,challenge)
 values(p_code_hash,i.id,i.app_id,c.generation,i.generation,p_challenge);
 return info;
end $$;

create function public.market_platform_refresh_client(p_client uuid,p_client_secret text,p_refresh_token text,p_access_hash text,p_refresh_hash text) returns jsonb language plpgsql security definer set search_path=pg_catalog,market_platform as $$
begin
 if p_client_secret is null or p_client_secret !~ '^rmc_[A-Za-z0-9_-]{43}$' or p_refresh_token is null or p_refresh_token !~ '^rmr_[A-Za-z0-9_-]{43}$' then raise exception using errcode='42501',message='Invalid application connection.';end if;
 perform 1 from apps where id=p_client for share;
 perform 1 from app_credentials where app_id=p_client and secret_hash=encode(sha256(convert_to(p_client_secret,'UTF8')),'hex') for share;
 if not found or not exists(select 1 from refresh_grants g join installations i on i.id=g.installation_id where g.token_hash=encode(sha256(convert_to(p_refresh_token,'UTF8')),'hex') and i.app_id=p_client) then raise exception using errcode='42501',message='Invalid application connection.';end if;
 return public.market_platform_refresh(encode(sha256(convert_to(p_refresh_token,'UTF8')),'hex'),p_access_hash,p_refresh_hash);
end $$;

create function public.market_platform_exchange_code(p_client uuid,p_client_secret text,p_code text,p_verifier text,p_access_hash text,p_refresh_hash text) returns jsonb language plpgsql security definer set search_path=pg_catalog,market_platform as $$
declare c app_credentials; code authorization_codes; i installations; access_until timestamptz:=now()+interval '15 minutes'; refresh_until timestamptz:=now()+interval '30 days'; code_digest text; verifier_challenge text;
begin
 if p_client_secret is null or p_client_secret !~ '^rmc_[A-Za-z0-9_-]{43}$' or p_code is null or p_code !~ '^rma_[A-Za-z0-9_-]{43}$' or p_verifier is null or p_verifier !~ '^[A-Za-z0-9._~-]{43,128}$' then raise exception using errcode='42501',message='Invalid authorization grant.';end if;
 code_digest:=encode(sha256(convert_to(p_code,'UTF8')),'hex');
 verifier_challenge:=translate(rtrim(encode(sha256(convert_to(p_verifier,'UTF8')),'base64'),'='),'+/','-_');
 perform 1 from apps where id=p_client for share;
 select * into c from app_credentials where app_id=p_client and secret_hash=encode(sha256(convert_to(p_client_secret,'UTF8')),'hex') for share;
 if c.app_id is null then raise exception using errcode='42501',message='Invalid application credentials.';end if;
 select ins.* into i from installations ins join authorization_codes ac on ac.installation_id=ins.id where ac.code_hash=code_digest for update of ins;
 select * into code from authorization_codes where code_hash=code_digest and app_id=p_client for update;
 if code.code_hash is null or code.consumed_at is not null or code.expires_at<=now() or code.challenge is distinct from verifier_challenge
 or code.credential_generation<>c.generation or code.installation_generation<>i.generation or not market_platform.connection_allowed(i.id) then raise exception using errcode='42501',message='Authorization expired, used or revoked.';end if;
 if p_access_hash is null or p_access_hash !~ '^[a-f0-9]{64}$' or p_refresh_hash is null or p_refresh_hash !~ '^[a-f0-9]{64}$' or p_access_hash=p_refresh_hash then raise exception using errcode='22023',message='Invalid connection digest.';end if;
 update authorization_codes set consumed_at=now() where code_hash=code_digest;
 delete from tokens where installation_id=i.id;delete from refresh_grants where installation_id=i.id;
 insert into tokens(installation_id,token_hash,generation,expires_at) values(i.id,p_access_hash,i.generation,access_until);
 insert into refresh_grants(installation_id,token_hash,generation,expires_at) values(i.id,p_refresh_hash,i.generation,refresh_until);
 return jsonb_build_object('accessExpiresAt',access_until,'refreshExpiresAt',refresh_until,'installationId',i.id,'versionId',i.version_id,'salonId',i.salon_id);
end $$;

-- A stored digest is not a credential accepted by the public RPC boundary.
alter function public.market_platform_runtime(text) set schema market_platform;
alter function market_platform.market_platform_runtime(text) rename to runtime_digest;
revoke all on function market_platform.runtime_digest(text) from public,anon,authenticated,service_role;
create function public.market_platform_runtime(p_token text) returns jsonb language plpgsql security definer set search_path=pg_catalog,market_platform as $$
begin
 if p_token is null or p_token !~ '^rmp_[A-Za-z0-9_-]{43}$' then raise exception using errcode='42501',message='Token invalid.';end if;
 return market_platform.runtime_digest(encode(sha256(convert_to(p_token,'UTF8')),'hex'));
end $$;
revoke all on function public.market_platform_runtime(text) from public,anon,authenticated,service_role;
grant execute on function public.market_platform_runtime(text) to anon,authenticated;

do $$declare f record;begin
 for f in select p.oid::regprocedure signature,p.proname name from pg_proc p join pg_namespace n on n.oid=p.pronamespace
 where n.nspname='public' and p.proname in ('market_platform_owner_workspace','market_platform_rotate_client','market_platform_connection_start','market_platform_connection_owner_check','market_platform_authorize','market_platform_exchange_code','market_platform_refresh_client') loop
 execute format('revoke all on function %s from public,anon,authenticated,service_role',f.signature);
 execute format('grant execute on function %s to authenticated',f.signature);
 if f.name in ('market_platform_exchange_code','market_platform_refresh_client') then execute format('grant execute on function %s to anon',f.signature);end if;
 end loop;
end $$;
revoke all on function public.market_platform_refresh(text,text,text),public.market_platform_issue_connection(uuid,text,text),public.market_platform_issue_token(uuid,text) from public,anon,authenticated,service_role;
commit;
