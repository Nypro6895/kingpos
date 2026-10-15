-- CAPTCHA/input retries consume request budgets, not the completed-account quota.
-- Keep the existing RPC signatures so the previous web release remains compatible.
begin;

-- Wait for old signup transactions before seeding their completed-account usage.
-- Lock in the same order as Auth inserts and their ticket-consuming trigger.
lock table auth.users in share row exclusive mode;
lock table public.abuse_signup_tickets in share row exclusive mode;

insert into public.abuse_counters(scope, identifier, action, window_start, count, expires_at)
select identity.scope, identity.identifier, 'signup_created', hourly.slot,
       count(*)::integer, hourly.slot + interval '1 hour'
from public.abuse_signup_tickets ticket
cross join lateral (select to_timestamp(floor(extract(epoch from ticket.consumed_at) / 3600) * 3600) as slot) hourly
cross join lateral (values ('device', ticket.device_hash), ('ip', ticket.ip_hash), ('subject', ticket.email_hash)) identity(scope, identifier)
where ticket.consumed_at is not null
  and hourly.slot + interval '1 hour' > now()
  and nullif(identity.identifier, '') is not null
group by identity.scope, identity.identifier, hourly.slot
on conflict(scope, identifier, action, window_start) do update
set count = greatest(abuse_counters.count, excluded.count), expires_at = excluded.expires_at;

create or replace function public.abuse_preflight(p_action text,p_user_id uuid,p_device text,p_ip text,p_country text,p_subject text default null) returns jsonb
language plpgsql security definer set search_path=public as $$
declare restriction jsonb; passed boolean; allowed boolean:=true; challenge boolean:=false; message text; actor_limit integer; violations integer; policy_value jsonb;
begin
 if p_action not in ('post','comment','report','signup','login','recovery') or p_device!~'^[a-f0-9]{64}$' or (p_ip is not null and p_ip!~'^[a-f0-9]{64}$') then raise exception 'Invalid safety request.'; end if;
 select policy into policy_value from abuse_system_settings where id;
 restriction:=abuse_matching_restriction(p_user_id,p_device,p_ip,p_country);
 passed:=exists(select 1 from abuse_verification_passes where device_hash=p_device and ip_hash is not distinct from p_ip and expires_at>now());
 if restriction->>'mode'='deny' or (restriction->>'mode'='cooldown' and p_action not in ('login','recovery')) then return jsonb_build_object('allowed',false,'code','restricted','message','This action is temporarily restricted. Try again after '||(restriction->>'expires_at')||' or contact support.'); end if;
 if restriction->>'mode'='challenge' and not passed then challenge:=true; end if;

 -- Signup retries are still bounded independently of successful account creation.
 -- Keep the existing request counters, including their history before this migration.
 actor_limit:=case p_action when 'signup' then 30 when 'login' then 30 when 'recovery' then 5 when 'post' then 30 when 'comment' then 100 else 20 end;
 if not abuse_take('device',p_device,'request_'||p_action,actor_limit,3600) then allowed:=false; end if;
 if not abuse_take('ip',p_ip,'request_'||p_action,case p_action when 'signup' then 200 when 'login' then 200 when 'recovery' then 30 else actor_limit*10 end,3600) then allowed:=false; end if;
 if p_action in ('signup','recovery','login') and not abuse_take('subject',p_subject,'request_'||p_action,case when p_action in ('login','signup') then 15 else 5 end,3600) then allowed:=false; end if;
 if p_user_id is not null and not abuse_take('account',p_user_id::text,'request_'||p_action,actor_limit,3600) then allowed:=false; end if;
 if p_action='signup' and not passed and exists(select 1 from abuse_counters where scope='device' and identifier=p_device and action='request_signup' and expires_at>now() and count>=2) then challenge:=true; end if;
 if not allowed then
  insert into abuse_events(user_id,device_hash,ip_hash,country,action,reason,severity) values(p_user_id,p_device,p_ip,p_country,p_action,'Request rate exceeded','warning');
  if p_user_id is not null then
   select count(*) into violations from abuse_events where user_id=p_user_id and reason='Request rate exceeded' and created_at>now()-interval '1 day';
   if violations in (3,6,12) then
    insert into abuse_restrictions(scope,identifier,mode,reason,source,expires_at)
    values('account',p_user_id::text,case when violations=6 then 'review' else 'cooldown' end,'Repeated request rate violations','automatic',now()+case when violations>=6 then interval '1 day' else interval '15 minutes' end);
   end if;
  end if;
  return jsonb_build_object('allowed',false,'code','rate_limited','message','Too many requests. Please wait before trying again.');
 end if;

 -- Give a useful error before Auth; the trigger below is the atomic authority.
 if p_action='signup' and exists(
  select 1 from abuse_counters where action='signup_created' and expires_at>now()
  and ((scope='device' and identifier=p_device and count >= (policy_value->>'signup_device_hour')::int)
    or (scope='ip' and identifier=p_ip and count >= (policy_value->>'signup_ip_hour')::int)
    or (scope='subject' and identifier=p_subject and count >= 5))
 ) then
  return jsonb_build_object('allowed',false,'code','rate_limited','message','Account creation limit reached. Please try again later.');
 end if;
 if challenge then return jsonb_build_object('allowed',false,'code','security_check_required','challengeRequired',true,'message','Please complete the security check at /security-check, then try again.'); end if;
 return jsonb_build_object('allowed',true,'warning',case when restriction->>'mode'='warn' then restriction->>'reason' else null end);
end; $$;

create or replace function public.abuse_guard_signup() returns trigger
language plpgsql security definer set search_path=public as $$
declare ticket abuse_signup_tickets; secret text; enforce boolean; token_value uuid; policy_value jsonb;
begin
 select signing_key,enforce_signup_tickets,policy into secret,enforce,policy_value from abuse_system_settings where id;
 if not enforce or coalesce(new.raw_app_meta_data->>'provider','email')<>'email' then return new; end if;
 begin token_value:=(new.raw_user_meta_data->>'abuse_signup_ticket')::uuid; exception when invalid_text_representation then raise exception 'Use the Reylumi signup page to create an account.'; end;
 select * into ticket from abuse_signup_tickets where token=token_value and consumed_at is null and expires_at>now() for update;
 if not found or ticket.email_hash<>encode(extensions.hmac('email:'||lower(btrim(new.email)),secret,'sha256'),'hex') then raise exception 'Use the Reylumi signup page to create an account.'; end if;
 if abuse_matching_restriction(null,ticket.device_hash,ticket.ip_hash,null)->>'mode' in ('deny','cooldown') then raise exception 'Account creation is temporarily restricted.'; end if;

 -- ON CONFLICT counters serialize simultaneous signups. If Auth rejects this
 -- insert, both these charges and ticket consumption roll back with it.
 if not abuse_take('device',ticket.device_hash,'signup_created',(policy_value->>'signup_device_hour')::int,3600)
    or not abuse_take('ip',ticket.ip_hash,'signup_created',(policy_value->>'signup_ip_hour')::int,3600)
    or not abuse_take('subject',ticket.email_hash,'signup_created',5,3600) then
  raise exception 'Account creation limit reached. Please try again later.';
 end if;
 update abuse_signup_tickets set consumed_at=now() where token=token_value;
 return new;
end; $$;

-- CREATE OR REPLACE preserves existing ownership and ACLs. No public grant is added;
-- preflight/ticket RPCs remain service-only and trigger invocation remains automatic.
commit;
