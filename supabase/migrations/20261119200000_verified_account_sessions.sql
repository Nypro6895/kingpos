-- Bind app/device records to the session in the provider-verified JWT. No
-- credential, user draft, or provider session is deleted by this migration.
begin;

create schema if not exists reylumi_security;
revoke all on schema reylumi_security from public, anon, authenticated;

alter table public.account_login_sessions add column if not exists auth_session_id uuid;
create unique index if not exists account_login_sessions_auth_session_uidx
  on public.account_login_sessions(auth_session_id) where auth_session_id is not null;

create table if not exists reylumi_security.session_guard_configuration (
  id boolean primary key default true check(id),
  installed_at timestamptz not null default now(),
  previous_request_hook text
);
create table if not exists reylumi_security.denied_legacy_sessions (
  auth_session_id uuid primary key,
  auth_user_id uuid not null,
  denied_at timestamptz not null default now()
);
revoke all on all tables in schema reylumi_security from public, anon, authenticated;

-- An old unsigned device cookie cannot prove which provider session an old
-- revocation referred to. Only those ambiguous users' pre-existing sessions
-- require a fresh credential login. Other live sessions are adopted by their
-- authoritative provider ID, without trusting or resurrecting an old record.
insert into reylumi_security.denied_legacy_sessions(auth_session_id,auth_user_id)
select s.id,s.user_id from auth.sessions s
where not exists(select 1 from reylumi_security.session_guard_configuration)
  and exists(select 1 from public.account_login_sessions a
    where a.auth_user_id=s.user_id and a.auth_session_id is null and a.revoked_at is not null)
on conflict do nothing;

insert into public.account_login_sessions(
  id,user_id,auth_user_id,auth_session_id,device_label,user_agent,created_at,last_seen_at)
select s.id,u.id,s.user_id,s.id,'Existing signed-in device',
  left(coalesce(to_jsonb(s)->>'user_agent',''),700),
  coalesce((to_jsonb(s)->>'created_at')::timestamptz,now()),now()
from auth.sessions s join public.users u on u.auth_user_id=s.user_id
where not exists(select 1 from reylumi_security.session_guard_configuration)
  and not exists(select 1 from reylumi_security.denied_legacy_sessions d where d.auth_session_id=s.id)
  and u.status='active'
on conflict do nothing;

create or replace function public.reylumi_account_session_state() returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare uid uuid:=auth.uid(); sid uuid; row_data public.account_login_sessions;
begin
  begin sid:=nullif(auth.jwt()->>'session_id','')::uuid;
  exception when invalid_text_representation then return jsonb_build_object('allowed',false); end;
  if uid is null or sid is null then return jsonb_build_object('allowed',false); end if;
  if not exists(select 1 from auth.sessions s where s.id=sid and s.user_id=uid
    and (nullif(to_jsonb(s)->>'not_after','') is null or (to_jsonb(s)->>'not_after')::timestamptz>now()))
    or exists(select 1 from reylumi_security.denied_legacy_sessions d where d.auth_session_id=sid)
    or exists(select 1 from public.users u where u.auth_user_id=uid and u.status<>'active') then
    return jsonb_build_object('allowed',false);
  end if;
  select * into row_data from public.account_login_sessions a where a.auth_session_id=sid and a.auth_user_id=uid;
  if found and row_data.revoked_at is not null then return jsonb_build_object('allowed',false); end if;
  return jsonb_build_object('allowed',true,'session_id',coalesce(row_data.id,sid),'registered',row_data.id is not null);
end; $$;
revoke all on function public.reylumi_account_session_state() from public,anon;
grant execute on function public.reylumi_account_session_state() to authenticated,service_role;

create or replace function public.check_account_login_session() returns jsonb
language plpgsql security definer set search_path='' as $$
declare state jsonb; uid uuid:=auth.uid(); sid uuid; user_id uuid;
begin
  state:=public.reylumi_account_session_state();
  if state->>'allowed'<>'true' then return state; end if;
  sid:=(auth.jwt()->>'session_id')::uuid;
  select u.id into user_id from public.users u where u.auth_user_id=uid;
  if user_id is not null then
    insert into public.account_login_sessions(id,user_id,auth_user_id,auth_session_id,device_label)
    values(sid,user_id,uid,sid,'Signed-in device')
    on conflict do nothing;
  end if;
  -- A concurrent revocation is never undone by registration.
  return public.reylumi_account_session_state();
end; $$;
revoke all on function public.check_account_login_session() from public,anon;
grant execute on function public.check_account_login_session() to authenticated;

-- Storage and other providers can evaluate RLS without PostgREST. A restrictive
-- policy composes with (and cannot widen) each existing permissive policy.
-- The SELECT initplan computes the stable decision once per SQL statement.
do $$
declare target record;
begin
  for target in select n.nspname,c.relname from pg_class c
    join pg_namespace n on n.oid=c.relnamespace
    where n.nspname in ('public','storage') and c.relkind in ('r','p') and c.relrowsecurity
  loop
    execute format('drop policy if exists reylumi_active_account_session on %I.%I',target.nspname,target.relname);
    execute format('create policy reylumi_active_account_session on %I.%I as restrictive for all to authenticated
      using ((select (public.reylumi_account_session_state()->>''allowed'')::boolean))
      with check ((select (public.reylumi_account_session_state()->>''allowed'')::boolean))',target.nspname,target.relname);
  end loop;
end; $$;

-- Old code's upsert cleared revoked_at. Patch only the known original contract
-- and abort on an unexpected provider/project definition rather than guessing.
do $$
declare definition text;
begin
  select pg_get_functiondef('public.record_account_login_session(uuid,text,text,text,text,text,text,text,text,text,text)'::regprocedure) into definition;
  definition:=replace(definition,E'\r\n',E'\n');
  if position('actor_auth_session_id' in definition)=0 then
    if position('actor_auth_user_id uuid := auth.uid();' in definition)=0
      or position('revoked_at = null,' in definition)=0 then
      raise exception 'Unexpected record_account_login_session definition; integrate session binding explicitly.';
    end if;
    definition:=replace(definition,'actor_auth_user_id uuid := auth.uid();',
      'actor_auth_user_id uuid := auth.uid(); actor_auth_session_id uuid := (auth.jwt()->>''session_id'')::uuid; canonical_id uuid;');
    definition:=replace(definition,'  insert into public.account_security_preferences (user_id)',
      '  if public.reylumi_account_session_state()->>''allowed'' <> ''true'' then raise exception ''Session expired. Sign in again.'' using errcode=''PT401''; end if;
  select id into canonical_id from public.account_login_sessions where auth_session_id=actor_auth_session_id and auth_user_id=actor_auth_user_id;
  if canonical_id is not null then p_session_id:=canonical_id; end if;
  insert into public.account_security_preferences (user_id)');
    definition:=replace(definition,'    auth_user_id,
    device_label,','    auth_user_id,
    auth_session_id,
    device_label,');
    definition:=replace(definition,'    actor_auth_user_id,
    safe_device_label,','    actor_auth_user_id,
    actor_auth_session_id,
    safe_device_label,');
    definition:=replace(definition,'      revoked_at = null,
      revoked_by_user_id = null,','      auth_session_id = excluded.auth_session_id,');
    definition:=replace(definition,'where account_login_sessions.user_id = actor_user_id;',
      'where account_login_sessions.user_id = actor_user_id and account_login_sessions.revoked_at is null
    and (account_login_sessions.auth_session_id is null or account_login_sessions.auth_session_id=actor_auth_session_id);
  if not found then raise exception ''Session cannot be reused. Sign in again.'' using errcode=''PT401''; end if;');
    if position('revoked_at = null,' in definition)>0
      or position('    auth_session_id,' in definition)=0
      or position('account_login_sessions.auth_session_id=actor_auth_session_id' in definition)=0 then
      raise exception 'Session binding patch did not match the expected login function.';
    end if;
    execute definition;
  end if;
end; $$;

-- The browser cannot create/rebind a record or reverse a revocation using the
-- direct table API. Device trust remains editable through its existing action.
revoke insert,update,delete on public.account_login_sessions from public,anon,authenticated;
grant update(trusted_at) on public.account_login_sessions to authenticated;

create or replace function public.reylumi_revoke_bound_session() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  if old.auth_session_id is not null and new.auth_session_id is distinct from old.auth_session_id then
    raise exception 'Session identity cannot be changed.';
  end if;
  if old.revoked_at is not null and new.revoked_at is distinct from old.revoked_at then
    raise exception 'A revoked session cannot be restored.';
  end if;
  if old.revoked_at is null and new.revoked_at is not null and old.auth_session_id is not null then
    insert into reylumi_security.denied_legacy_sessions(auth_session_id,auth_user_id)
    values(old.auth_session_id,old.auth_user_id) on conflict do nothing;
    delete from auth.refresh_tokens where session_id=old.auth_session_id;
    delete from auth.sessions where id=old.auth_session_id and user_id=old.auth_user_id;
  end if;
  return new;
end; $$;
revoke all on function public.reylumi_revoke_bound_session() from public,anon,authenticated;
drop trigger if exists reylumi_revoke_bound_session on public.account_login_sessions;
create trigger reylumi_revoke_bound_session before update on public.account_login_sessions
for each row execute function public.reylumi_revoke_bound_session();

create or replace function public.revoke_account_login_session(p_session_id uuid default null,p_scope text default 'one') returns integer
language plpgsql security definer set search_path='' as $$
declare state jsonb; actor uuid; sid uuid; affected integer;
begin
  state:=public.check_account_login_session();
  if state->>'allowed'<>'true' then raise exception 'Session expired. Sign in again.' using errcode='PT401'; end if;
  select u.id into actor from public.users u where u.auth_user_id=auth.uid();
  sid:=(auth.jwt()->>'session_id')::uuid;
  if actor is null or p_scope not in ('one','others','all') then raise exception 'Invalid session request.'; end if;
  if p_scope='one' and not exists(select 1 from public.account_login_sessions a
    where a.id=p_session_id and a.user_id=actor and a.auth_session_id is not null) then
    raise exception 'This legacy device cannot be identified. Use Log out all devices.';
  end if;
  update public.account_login_sessions a set revoked_at=now(),revoked_by_user_id=actor
    where a.user_id=actor and a.revoked_at is null
      and (p_scope='all' or (p_scope='one' and a.id=p_session_id)
        or (p_scope='others' and a.auth_session_id is distinct from sid));
  get diagnostics affected=row_count;
  if p_scope in ('all','others') then
    delete from auth.refresh_tokens where session_id in(select s.id from auth.sessions s
      where s.user_id=auth.uid() and (p_scope='all' or s.id<>sid));
    delete from auth.sessions s where s.user_id=auth.uid() and (p_scope='all' or s.id<>sid);
  end if;
  -- Audit inside the authorized transaction: the just-revoked credential
  -- correctly cannot make a second HTTP call to record its own logout.
  insert into public.account_login_activity(user_id,login_session_id,activity_type,metadata,
    device_label,browser_name,os_name,device_type,location_label)
  select actor,a.id,
    case when p_scope='all' then 'all_sessions_logged_out'
      when p_scope='one' and p_session_id=(state->>'session_id')::uuid then 'session_logged_out'
      else 'session_revoked' end,
    jsonb_build_object('scope',p_scope,'session_id',p_session_id,'revoked_count',affected),
    a.device_label,a.browser_name,a.os_name,a.device_type,a.location_label
  from public.account_login_sessions a where a.id=(state->>'session_id')::uuid;
  return affected;
end; $$;
revoke all on function public.revoke_account_login_session(uuid,text) from public,anon;
grant execute on function public.revoke_account_login_session(uuid,text) to authenticated;

-- PostgREST runs this before both table/RLS access and SECURITY DEFINER RPCs.
-- Keep an existing database-configured provider hook and invoke it with its
-- original caller privileges. A deployment preflight must also inventory any
-- external/pre-config override; postflight must prove the effective hook ran.
do $$
declare previous text; qualified text; previous_oid regprocedure;
begin
  if not exists(select 1 from reylumi_security.session_guard_configuration) then
    select substring(setting from length('pgrst.db_pre_request=')+1) into previous
    from pg_db_role_setting r cross join lateral unnest(r.setconfig) setting
    where r.setrole=(select oid from pg_roles where rolname='authenticator')
      and r.setdatabase in (0,(select oid from pg_database where datname=current_database()))
      and setting like 'pgrst.db_pre_request=%'
    order by (r.setdatabase<>0) desc limit 1;
    previous:=coalesce(nullif(previous,''),nullif(current_setting('pgrst.db_pre_request',true),''));
    if previous is not null then
      previous_oid:=to_regprocedure(previous||'()');
      if previous_oid is null or previous='public.reylumi_request_guard' then
        raise exception 'Cannot safely preserve the configured pre-request hook.';
      end if;
      select format('%I.%I',n.nspname,p.proname) into qualified from pg_proc p
        join pg_namespace n on n.oid=p.pronamespace where p.oid=previous_oid;
    end if;
    insert into reylumi_security.session_guard_configuration(id,previous_request_hook) values(true,qualified);
  end if;
end; $$;

create or replace function public.reylumi_previous_request_hook() returns text
language sql stable security definer set search_path='' as $$
  select previous_request_hook from reylumi_security.session_guard_configuration where id
$$;
revoke all on function public.reylumi_previous_request_hook() from public;
grant execute on function public.reylumi_previous_request_hook() to anon,authenticated,service_role;

create or replace function public.reylumi_request_guard() returns void
language plpgsql set search_path='' as $$
declare previous text:=public.reylumi_previous_request_hook(); state jsonb;
begin
  if previous is not null then execute 'select '||previous||'()'; end if;
  if auth.role()='authenticated' then
    state:=public.reylumi_account_session_state();
    if state->>'allowed'<>'true' then raise exception 'Session expired. Sign in again.' using errcode='PT401'; end if;
  end if;
end; $$;
revoke all on function public.reylumi_request_guard() from public;
grant execute on function public.reylumi_request_guard() to anon,authenticated,service_role;

do $$ begin
  if not exists(select 1 from pg_roles where rolname='authenticator') then
    raise exception 'PostgREST authenticator role is required for the session guard.';
  end if;
  execute format('alter role authenticator in database %I set pgrst.db_pre_request=%L',current_database(),'public.reylumi_request_guard');
end; $$;
notify pgrst,'reload config';
notify pgrst,'reload schema';
commit;
