-- MFA enrollment must restrict data access, not only the login form. Keep
-- pending Auth challenge/verify outside this application-data admission gate.
-- No provider factor/session, application row, cookie, owner or grant changes.
begin;

do $$
begin
 if not exists(select 1 from pg_catalog.pg_proc p
  where p.oid=pg_catalog.to_regprocedure('public.reylumi_account_session_state()')
   and p.prorettype='jsonb'::regtype and p.pronargs=0 and p.prosecdef and p.provolatile='s'
   and p.proconfig=array['search_path=""']::text[]
   and encode(sha256(convert_to(replace(p.prosrc,chr(13),''),'UTF8')),'hex')=
    '391d035ed1793f28268c7db0e98089f19d8a02ec03452fb1af83543eeb827b1e') then
  raise exception 'Unexpected verified-session admission definition; integrate MFA enforcement explicitly.';
 end if;
end $$;

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
  -- Read current verified enrollment, including factors enabled after an old
  -- AAL1 JWT was issued. Assurance comes only from the provider-verified JWT;
  -- a higher session-row AAL or an app/device cookie cannot upgrade that JWT.
  if exists(select 1 from auth.mfa_factors f where f.user_id=uid and f.status='verified')
    and coalesce(auth.jwt()->>'aal','')<>'aal2' then
    return jsonb_build_object('allowed',false,'mfa_required',true);
  end if;
  return jsonb_build_object('allowed',true,'session_id',coalesce(row_data.id,sid),'registered',row_data.id is not null);
end; $$;

-- CREATE OR REPLACE retains the reviewed owner and EXECUTE ACL. Existing
-- PostgREST pre-request and restrictive table/Storage policies call this same
-- function, so Cookie, Bearer and direct data access share this decision.
commit;
