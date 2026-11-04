begin;
-- Match authorize/exchange/refresh: acquire the app lock BEFORE any consent or
-- sandbox write. A suspend racing with consent cannot be undone by an upsert.
alter function public.market_platform_install(uuid,uuid,text,jsonb) set schema market_platform;
alter function market_platform.market_platform_install(uuid,uuid,text,jsonb) rename to install_before_app_fence;
revoke all on function market_platform.install_before_app_fence(uuid,uuid,text,jsonb) from public,anon,authenticated,service_role;
create function public.market_platform_install(p_salon uuid,p_version uuid,p_sha256 text,p_scopes jsonb) returns jsonb
language plpgsql security definer set search_path=pg_catalog,market_platform as $$
begin
 perform 1 from apps a join versions v on v.app_id=a.id where v.id=p_version for share of a;
 if not found then raise exception using errcode='42501',message='App version unavailable.';end if;
 return install_before_app_fence(p_salon,p_version,p_sha256,p_scopes);
end $$;
revoke all on function public.market_platform_install(uuid,uuid,text,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.market_platform_install(uuid,uuid,text,jsonb) to authenticated;

alter function public.market_platform_sandbox(uuid,text) set schema market_platform;
alter function market_platform.market_platform_sandbox(uuid,text) rename to sandbox_before_app_fence;
revoke all on function market_platform.sandbox_before_app_fence(uuid,text) from public,anon,authenticated,service_role;
create function public.market_platform_sandbox(p_version uuid,p_token_hash text) returns jsonb
language plpgsql security definer set search_path=pg_catalog,market_platform as $$
begin
 perform 1 from apps a join versions v on v.app_id=a.id where v.id=p_version for share of a;
 if not found then raise exception using errcode='42501',message='App version unavailable.';end if;
 return sandbox_before_app_fence(p_version,p_token_hash);
end $$;
revoke all on function public.market_platform_sandbox(uuid,text) from public,anon,authenticated,service_role;
grant execute on function public.market_platform_sandbox(uuid,text) to authenticated;
commit;
