begin;
create table public.platform_twilio_settings (
 id boolean primary key default true check(id),
 encrypted_config text not null,
 public_config jsonb not null check(jsonb_typeof(public_config)='object'),
 updated_at timestamptz not null default now(),
 updated_by uuid references public.users(id)
);
alter table public.platform_twilio_settings enable row level security;
revoke all on public.platform_twilio_settings from public,anon,authenticated;
grant select on public.platform_twilio_settings to service_role;
create function public.save_platform_twilio_settings(p_actor uuid,p_encrypted text,p_public jsonb) returns void
language plpgsql security definer set search_path=public as $$
declare previous jsonb;
begin
 if not exists(select 1 from platform_admin_memberships m join platform_admin_roles r on r.id=m.role_id join users u on u.id=m.user_id where m.user_id=p_actor and m.status='active' and r.slug='platform_owner' and u.status='active') then raise exception 'Platform owner access required.'; end if;
 perform pg_advisory_xact_lock(hashtextextended('platform_twilio_settings',0));
 select public_config into previous from platform_twilio_settings where id;
 if exists(select 1 from business_claim_requests where status='otp_pending' and expires_at>now()) and (previous->>'accountSid' is distinct from p_public->>'accountSid' or previous->>'verifyServiceSid' is distinct from p_public->>'verifyServiceSid') then raise exception 'Wait for current claim codes to expire before changing the account or Verify service.'; end if;
 if length(p_encrypted)<40 or p_public ? 'token' or p_public ? 'authToken' then raise exception 'Invalid encrypted configuration.'; end if;
 insert into platform_twilio_settings(id,encrypted_config,public_config,updated_by) values(true,p_encrypted,p_public,p_actor)
 on conflict(id) do update set encrypted_config=excluded.encrypted_config,public_config=excluded.public_config,updated_by=p_actor,updated_at=now();
 insert into platform_admin_audit_logs(actor_user_id,action,target_type,before_data,after_data) values(p_actor,'twilio.settings.update','system',previous,p_public);
end $$;
revoke all on function public.save_platform_twilio_settings(uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.save_platform_twilio_settings(uuid,text,jsonb) to service_role;
commit;
