-- Shared, transactional safeguards: no per-process rate counters or client-trusted IPs.
create table public.abuse_system_settings (
 id boolean primary key default true check(id), signing_key text,
 require_signed_context boolean not null default false,
 enforce_signup_tickets boolean not null default false,
 email_delivery_ready boolean not null default false,
 policy jsonb not null default '{"new_account_days":7,"post_new_hour":3,"post_hour":10,"post_new_day":10,"post_day":50,"comment_new_window":10,"comment_window":30,"comment_new_day":40,"comment_day":200,"report_hour":10,"signup_device_hour":3,"signup_ip_hour":20}'
);
insert into public.abuse_system_settings(id) values(true);
create table public.abuse_counters (
 scope text not null, identifier text not null, action text not null, window_start timestamptz not null,
 count integer not null default 1, expires_at timestamptz not null,
 primary key(scope,identifier,action,window_start)
);
create index abuse_counters_expiry on public.abuse_counters(expires_at);
create table public.abuse_restrictions (
 id uuid primary key default gen_random_uuid(), scope text not null check(scope in ('account','device','ip','country')),
 identifier text not null, mode text not null check(mode in ('warn','challenge','cooldown','review','deny')),
 reason text not null check(length(btrim(reason)) between 3 and 1000), source text not null default 'admin',
 created_by uuid references public.users(id), created_at timestamptz not null default now(),
 expires_at timestamptz not null, revoked_at timestamptz, revoked_by uuid references public.users(id)
);
create index abuse_restrictions_lookup on public.abuse_restrictions(scope,identifier,expires_at) where revoked_at is null;
create table public.abuse_events (
 id uuid primary key default gen_random_uuid(), user_id uuid references public.users(id) on delete set null,
 device_hash text, ip_hash text, country text, action text not null, reason text not null,
 severity text not null default 'warning', source_type text, source_id uuid,
 details jsonb not null default '{}', created_at timestamptz not null default now()
);
create index abuse_events_queue on public.abuse_events(created_at desc);
create index abuse_events_actor on public.abuse_events(user_id,created_at desc);
create table public.abuse_audit (
 id uuid primary key default gen_random_uuid(), actor_user_id uuid references public.users(id),
 action text not null, subject_id uuid, reason text not null, details jsonb not null default '{}', created_at timestamptz not null default now()
);
create table public.abuse_fingerprints (
 kind text not null, hash text not null, user_id uuid not null references public.users(id) on delete cascade,
 source_type text not null, source_id uuid not null, created_at timestamptz not null default now(),
 primary key(kind,hash,source_type,source_id)
);
create index abuse_fingerprints_recent on public.abuse_fingerprints(kind,hash,created_at);
create table public.abuse_identity_reviews (
 auth_user_id uuid primary key references auth.users(id) on delete cascade,
 created_at timestamptz not null default now(), verified_at timestamptz, approved_by uuid references public.users(id)
);
create table public.abuse_signup_tickets (
 token uuid primary key default gen_random_uuid(), email_hash text not null, device_hash text not null, ip_hash text,
 expires_at timestamptz not null default now()+interval '10 minutes', consumed_at timestamptz
);
create table public.abuse_challenges (
 id uuid primary key, device_hash text not null, ip_hash text, answer_hash text not null,
 attempts integer not null default 0, expires_at timestamptz not null default now()+interval '5 minutes', completed_at timestamptz
);
create table public.abuse_verification_passes (
 device_hash text primary key, ip_hash text, expires_at timestamptz not null
);

do $$ declare tbl text; begin
 foreach tbl in array array['abuse_system_settings','abuse_counters','abuse_restrictions','abuse_events','abuse_audit','abuse_fingerprints','abuse_signup_tickets','abuse_identity_reviews','abuse_challenges','abuse_verification_passes'] loop
  execute format('alter table public.%I enable row level security',tbl);
  execute format('revoke all on public.%I from anon, authenticated',tbl);
  execute format('grant all on public.%I to service_role',tbl);
 end loop;
end; $$;

create function public.configure_abuse_security(p_key text,p_require_context boolean,p_signup_tickets boolean) returns void
language plpgsql security definer set search_path=public as $$
begin
 if length(p_key)<32 then raise exception 'Security key is required.'; end if;
 update abuse_system_settings set signing_key=p_key,require_signed_context=p_require_context,enforce_signup_tickets=p_signup_tickets where id;
end; $$;

create function public.abuse_take(scope_value text,id_value text,action_value text,limit_value integer,window_seconds integer) returns boolean
language plpgsql security definer set search_path=public as $$
declare slot timestamptz; n integer;
begin
 if nullif(id_value,'') is null then return true; end if;
 slot:=to_timestamp(floor(extract(epoch from clock_timestamp())/window_seconds)*window_seconds);
 insert into abuse_counters(scope,identifier,action,window_start,count,expires_at)
 values(scope_value,id_value,action_value,slot,1,slot+make_interval(secs=>window_seconds))
 on conflict(scope,identifier,action,window_start) do update set count=abuse_counters.count+1 returning count into n;
 return n<=limit_value;
end; $$;

create function public.abuse_signed_context() returns jsonb
language plpgsql stable security definer set search_path=public as $$
declare hs jsonb; payload text; signature text; secret text; parts text[];
begin
 hs:=coalesce(nullif(current_setting('request.headers',true),'')::jsonb,'{}');
 payload:=hs->>'x-reylumi-safety'; signature:=hs->>'x-reylumi-safety-signature';
 select signing_key into secret from abuse_system_settings where id;
 if secret is null or payload is null or signature is null then return null; end if;
 parts:=string_to_array(payload,'|');
 if array_length(parts,1)<>4 or parts[1]!~'^[a-f0-9]{64}$' or (parts[2]<>'' and parts[2]!~'^[a-f0-9]{64}$') or (parts[3]<>'' and parts[3]!~'^[A-Z]{2}$') or parts[4]!~'^[0-9]{10,12}$' then return null; end if;
 if abs(extract(epoch from clock_timestamp())-parts[4]::bigint)>120 then return null; end if;
 if signature<>encode(extensions.hmac(payload,secret,'sha256'),'hex') then return null; end if;
 return jsonb_build_object('device',parts[1],'ip',nullif(parts[2],''),'country',nullif(parts[3],''));
end; $$;

create function public.abuse_matching_restriction(p_user_id uuid,p_device text,p_ip text,p_country text) returns jsonb
language sql stable security definer set search_path=public as $$
 select to_jsonb(r) from abuse_restrictions r where revoked_at is null and expires_at>now()
 and ((scope='account' and identifier=p_user_id::text) or (scope='device' and identifier=p_device) or (scope='ip' and identifier=p_ip) or (scope='country' and identifier=p_country))
 order by case mode when 'deny' then 1 when 'cooldown' then 2 when 'challenge' then 3 when 'review' then 4 else 5 end,created_at desc limit 1;
$$;

create function public.abuse_preflight(p_action text,p_user_id uuid,p_device text,p_ip text,p_country text,p_subject text default null) returns jsonb
language plpgsql security definer set search_path=public as $$
declare restriction jsonb; passed boolean; allowed boolean:=true; challenge boolean:=false; message text; actor_limit integer; violations integer; policy_value jsonb;
begin
 if p_action not in ('post','comment','report','signup','login','recovery') or p_device!~'^[a-f0-9]{64}$' or (p_ip is not null and p_ip!~'^[a-f0-9]{64}$') then raise exception 'Invalid safety request.'; end if;
 select policy into policy_value from abuse_system_settings where id;
 -- Every denial is committed in this separate service request, even if the content transaction later fails.
 restriction:=abuse_matching_restriction(p_user_id,p_device,p_ip,p_country);
 passed:=exists(select 1 from abuse_verification_passes where device_hash=p_device and ip_hash is not distinct from p_ip and expires_at>now());
 if restriction->>'mode'='deny' or (restriction->>'mode'='cooldown' and p_action not in ('login','recovery')) then return jsonb_build_object('allowed',false,'message','This action is temporarily restricted. Try again after '||(restriction->>'expires_at')||' or contact support.'); end if;
 if restriction->>'mode'='challenge' and not passed then challenge:=true; end if;
 actor_limit:=case p_action when 'signup' then (policy_value->>'signup_device_hour')::int when 'login' then 30 when 'recovery' then 5 when 'post' then 30 when 'comment' then 100 else 20 end;
 if not abuse_take('device',p_device,'request_'||p_action,actor_limit,3600) then allowed:=false; end if;
 if not abuse_take('ip',p_ip,'request_'||p_action,case p_action when 'signup' then (policy_value->>'signup_ip_hour')::int when 'login' then 200 when 'recovery' then 30 else actor_limit*10 end,3600) then allowed:=false; end if;
 if p_action in ('signup','recovery','login') and not abuse_take('subject',p_subject,'request_'||p_action,case when p_action='login' then 15 else 5 end,3600) then allowed:=false; end if;
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
  return jsonb_build_object('allowed',false,'message','Too many requests. Please wait before trying again.');
 end if;
 if challenge then return jsonb_build_object('allowed',false,'challengeRequired',true,'message','Please complete the security check at /security-check, then try again.'); end if;
 return jsonb_build_object('allowed',true,'warning',case when restriction->>'mode'='warn' then restriction->>'reason' else null end);
end; $$;

create function public.issue_abuse_signup_ticket(p_email_hash text,p_device text,p_ip text) returns uuid
language plpgsql security definer set search_path=public as $$
declare result uuid;
begin
 if p_email_hash!~'^[a-f0-9]{64}$' or p_device!~'^[a-f0-9]{64}$' then raise exception 'Invalid signup session.'; end if;
 insert into abuse_signup_tickets(email_hash,device_hash,ip_hash) values(p_email_hash,p_device,p_ip) returning token into result;
 return result;
end; $$;

create function public.abuse_guard_signup() returns trigger
language plpgsql security definer set search_path=public as $$
declare ticket abuse_signup_tickets; secret text; enforce boolean; token_value uuid;
begin
 select signing_key,enforce_signup_tickets into secret,enforce from abuse_system_settings where id;
 if not enforce or coalesce(new.raw_app_meta_data->>'provider','email')<>'email' then return new; end if;
 -- Admin-created accounts must use the same explicit server admission flow.
 begin token_value:=(new.raw_user_meta_data->>'abuse_signup_ticket')::uuid; exception when invalid_text_representation then raise exception 'Use the Reylumi signup page to create an account.'; end;
 select * into ticket from abuse_signup_tickets where token=token_value and consumed_at is null and expires_at>now() for update;
 if not found or ticket.email_hash<>encode(extensions.hmac('email:'||lower(btrim(new.email)),secret,'sha256'),'hex') then raise exception 'Use the Reylumi signup page to create an account.'; end if;
 if abuse_matching_restriction(null,ticket.device_hash,ticket.ip_hash,null)->>'mode' in ('deny','cooldown') then raise exception 'Account creation is temporarily restricted.'; end if;
 update abuse_signup_tickets set consumed_at=now() where token=token_value;
 return new;
end; $$;
create trigger abuse_guard_signup before insert on auth.users for each row execute function public.abuse_guard_signup();

-- Without an outbound email provider, fresh identities are reviewed rather than auto-trusted.
create function public.abuse_track_identity() returns trigger
language plpgsql security definer set search_path=public as $$
begin
 if tg_op='INSERT' and coalesce(new.raw_app_meta_data->>'provider','email')='email' then
  insert into abuse_identity_reviews(auth_user_id) values(new.id) on conflict do nothing;
 elsif tg_op='UPDATE' and old.email_confirmed_at is null and new.email_confirmed_at is not null and (select email_delivery_ready from abuse_system_settings where id) then
  update abuse_identity_reviews set verified_at=now() where auth_user_id=new.id;
 end if;
 return new;
end; $$;
create trigger abuse_track_identity after insert or update of email_confirmed_at on auth.users for each row execute function public.abuse_track_identity();

create function public.abuse_guard_actor(p_action text) returns jsonb
language plpgsql security definer set search_path=public as $$
declare uid uuid:=public.current_public_user_id(); context jsonb:=abuse_signed_context(); restriction jsonb; settings abuse_system_settings; user_row public.users; confirmed boolean; new_account boolean; hourly integer; daily integer;
begin
 select * into settings from abuse_system_settings where id;
 -- Service maintenance and moderation do not consume a user's social quota.
 if auth.role()='service_role' or public.platform_admin_has_permission('admin.reports.update') then return coalesce(context,'{}'); end if;
 if settings.require_signed_context and context is null then raise exception 'Please use Reylumi to perform this action.'; end if;
 if uid is null and p_action<>'report' then raise exception 'Sign in before posting.'; end if;
 if uid is not null then
  select * into user_row from public.users where id=uid;
  if user_row.status in ('suspended','deleted','pending_deletion') then raise exception 'Account is restricted.'; end if;
  if p_action in ('post','comment','media') then
   select email_confirmed_at is not null or phone_confirmed_at is not null into confirmed from auth.users where id=user_row.auth_user_id;
   if not coalesce(confirmed,false) and (settings.email_delivery_ready or not exists(select 1 from abuse_identity_reviews where auth_user_id=user_row.auth_user_id and verified_at is null)) then raise exception 'Confirm your email before posting or commenting.'; end if;
  end if;
  new_account:=user_row.created_at>now()-make_interval(days=>(settings.policy->>'new_account_days')::int);
 end if;
 restriction:=abuse_matching_restriction(uid,context->>'device',context->>'ip',context->>'country');
 if restriction->>'mode' in ('deny','cooldown') then raise exception 'Posting is temporarily restricted. Contact support or try again later.'; end if;
 if restriction->>'mode'='challenge' and not exists(select 1 from abuse_verification_passes where device_hash=context->>'device' and ip_hash is not distinct from context->>'ip' and expires_at>now()) then raise exception 'Please complete the security check at /security-check, then try again.'; end if;
 if p_action='media' then return coalesce(context,'{}')||jsonb_build_object('review',restriction->>'mode'='review'); end if;
 hourly:=case p_action when 'post' then (settings.policy->>case when new_account then 'post_new_hour' else 'post_hour' end)::int when 'comment' then (settings.policy->>case when new_account then 'comment_new_window' else 'comment_window' end)::int else (settings.policy->>'report_hour')::int end;
 daily:=case p_action when 'post' then (settings.policy->>case when new_account then 'post_new_day' else 'post_day' end)::int when 'comment' then (settings.policy->>case when new_account then 'comment_new_day' else 'comment_day' end)::int else 30 end;
 if not abuse_take('account',coalesce(uid::text,context->>'device'),p_action,hourly,case when p_action='comment' then 600 else 3600 end) or not abuse_take('account',coalesce(uid::text,context->>'device'),p_action||'_day',daily,86400) then raise exception 'You have reached the posting limit. Please wait before trying again.'; end if;
 if not abuse_take('device',context->>'device',p_action,hourly*3,3600) or not abuse_take('ip',context->>'ip',p_action,hourly*20,3600) then raise exception 'Too many requests from this device or network. Please try again later.'; end if;
 return coalesce(context,'{}')||jsonb_build_object('review',coalesce(restriction->>'mode'='review',false) or exists(select 1 from abuse_identity_reviews where auth_user_id=user_row.auth_user_id and verified_at is null));
end; $$;

create function public.abuse_record_fingerprint(p_kind text,p_value text,p_user uuid,p_type text,p_id uuid) returns boolean
language plpgsql security definer set search_path=public as $$
declare hash_value text; other_accounts integer; same_account integer;
begin
 if nullif(p_value,'') is null or p_user is null then return false; end if;
 hash_value:=encode(extensions.digest(p_value,'sha256'),'hex');
 perform pg_advisory_xact_lock(hashtextextended(p_kind||':'||hash_value,83));
 insert into abuse_fingerprints(kind,hash,user_id,source_type,source_id) values(p_kind,hash_value,p_user,p_type,p_id) on conflict do nothing;
 select count(distinct user_id) filter(where user_id<>p_user),count(*) filter(where user_id=p_user and created_at>now()-interval '10 minutes') into other_accounts,same_account
 from abuse_fingerprints where kind=p_kind and hash=hash_value and created_at>now()-interval '1 hour';
 return case when p_kind in ('url','phone') then other_accounts>=5 else other_accounts>=2 or same_account>=3 end;
end; $$;

create function public.abuse_hold_post(p_type text,p_id uuid,p_author uuid,p_snapshot jsonb,p_reason text,p_context jsonb) returns void
language plpgsql security definer set search_path=public as $$
begin
 insert into post_safety_cases(source_type,source_id,origin,reason,content_snapshot,author_user_id)
 values(p_type,p_id,'automatic',p_reason,p_snapshot,p_author)
 on conflict(source_type,source_id) where origin='automatic' and status='pending' do nothing;
 insert into abuse_events(user_id,device_hash,ip_hash,country,action,reason,severity,source_type,source_id)
 values(p_author,p_context->>'device',p_context->>'ip',p_context->>'country','post',p_reason,'review',p_type,p_id);
end; $$;

create function public.abuse_guard_content() returns trigger
language plpgsql security definer set search_path=public as $$
declare row_data jsonb:=to_jsonb(new); old_data jsonb; body text; normalized text; ctx jsonb; uid uuid; kind text; repeated boolean:=false; link text; phone_value text; reason text;
begin
 if tg_op='UPDATE' then
  old_data:=to_jsonb(old);
  if tg_table_name='salon_profile_comments' and old_data->>'status'='reported' and row_data->>'status' not in ('reported','deleted') and not public.platform_admin_has_permission('admin.reports.update') then
   new:=jsonb_populate_record(new,jsonb_build_object('status','reported'));
  end if;
  if row_data->>'media_path' is not distinct from old_data->>'media_path' and row_data->>'caption' is not distinct from old_data->>'caption' and row_data->>'title' is not distinct from old_data->>'title' and row_data->>'body' is not distinct from old_data->>'body' then return new; end if;
 end if;
 if tg_op='INSERT' and exists(select 1 from salon_profile_comments where id=new.id) and tg_table_name='salon_profile_comments' then return new; end if;
 ctx:=abuse_guard_actor(case when tg_table_name='salon_profile_comments' then 'comment' else 'post' end);
 uid:=coalesce((row_data->>'author_user_id')::uuid,(row_data->>'created_by_user_id')::uuid,public.current_public_user_id());
 kind:=case tg_table_name when 'beauty_posts' then 'beauty_post' when 'salon_profile_looks' then 'salon_profile_look' when 'salon_profile_updates' then 'salon_profile_update' else 'comment' end;
 body:=coalesce(row_data->>'body',coalesce(row_data->>'title','')||' '||coalesce(row_data->>'caption',''));
 normalized:=regexp_replace(lower(body),'[^[:alnum:]]+',' ','g');
 if length(btrim(normalized))>=20 then repeated:=abuse_record_fingerprint('text',btrim(normalized),uid,kind,new.id); end if;
 for link in select (regexp_matches(lower(body),'https?://[^[:space:]<>]+','g'))[1] loop
  repeated:=abuse_record_fingerprint('url',rtrim(link,'.,!?/'),uid,kind,new.id) or repeated;
 end loop;
 for phone_value in select (regexp_matches(body,'\+?[0-9][0-9 ()-]{7,}[0-9]','g'))[1] loop
  repeated:=abuse_record_fingerprint('phone',regexp_replace(phone_value,'[^0-9]','','g'),uid,kind,new.id) or repeated;
 end loop;
 if kind='comment' and exists(select 1 from post_safety_keywords where enabled and strpos(lower(body),lower(phrase))>0) then
  repeated:=true;
 end if;
 if repeated or coalesce((ctx->>'review')::boolean,false) then
  reason:=case when repeated then 'Repeated content or contact details' else 'Account requires moderation' end;
  if kind='comment' then
   new:=jsonb_populate_record(new,jsonb_build_object('status','reported'));
   insert into abuse_events(user_id,device_hash,ip_hash,country,action,reason,severity,source_type,source_id,details)
   values(uid,ctx->>'device',ctx->>'ip',ctx->>'country','comment',reason,'review',kind,new.id,jsonb_build_object('body',body));
  else
   new.safety_hold:=true;
   if kind='beauty_post' then new:=jsonb_populate_record(new,jsonb_build_object('visibility','self'));
   else new:=jsonb_populate_record(new,jsonb_build_object('status','draft')); end if;
   perform abuse_hold_post(kind,new.id,uid,row_data,reason,ctx);
  end if;
 end if;
 return new;
end; $$;
create trigger aa_abuse_guard before insert or update on public.beauty_posts for each row execute function public.abuse_guard_content();
create trigger aa_abuse_guard before insert or update on public.salon_profile_looks for each row execute function public.abuse_guard_content();
create trigger aa_abuse_guard before insert or update on public.salon_profile_updates for each row execute function public.abuse_guard_content();
create trigger aa_abuse_guard before insert or update on public.salon_profile_comments for each row execute function public.abuse_guard_content();

create function public.abuse_guard_image() returns trigger
language plpgsql security definer set search_path=public as $$
declare data jsonb:=to_jsonb(new); kind text; post_id uuid; post_data jsonb; path text; bucket text; fingerprint text; ctx jsonb:=abuse_signed_context(); uid uuid; tbl text;
begin
 if tg_table_name='beauty_post_media' then
  if tg_op='UPDATE' and new.object_path is not distinct from old.object_path and new.post_id is not distinct from old.post_id then return new; end if;
  perform abuse_guard_actor('media');
  kind:='beauty_post'; post_id:=new.post_id; path:=new.object_path; bucket:='beauty-profile-media';
 else
  kind:=case tg_table_name when 'salon_profile_looks' then 'salon_profile_look' else 'salon_profile_update' end;
  post_id:=new.id; path:=data->>'media_path'; bucket:='salon-profile-media';
  if tg_op='UPDATE' and path is not distinct from to_jsonb(old)->>'media_path' then return new; end if;
 end if;
 if path is null then return new; end if;
 select trim(both '"' from metadata->>'eTag') into fingerprint from storage.objects where bucket_id=bucket and name=path;
 if fingerprint is null then return new; end if;
 tbl:=post_safety_table(kind);
 execute format('select to_jsonb(p) from public.%I p where id=$1',tbl) into post_data using post_id;
 uid:=coalesce((post_data->>'author_user_id')::uuid,(post_data->>'created_by_user_id')::uuid);
 if abuse_record_fingerprint('image',fingerprint,uid,kind,post_id) then
  perform abuse_hold_post(kind,post_id,uid,post_data,'Repeated image',ctx);
  if kind='beauty_post' then update beauty_posts set safety_hold=true,visibility='self' where id=post_id;
  else execute format('update public.%I set safety_hold=true,status=''draft'' where id=$1',tbl) using post_id; end if;
 end if;
 return new;
end; $$;
create trigger abuse_image after insert or update on public.beauty_post_media for each row execute function public.abuse_guard_image();
create trigger abuse_image after insert or update on public.salon_profile_looks for each row execute function public.abuse_guard_image();
create trigger abuse_image after insert or update on public.salon_profile_updates for each row execute function public.abuse_guard_image();

-- The public report RPC also enforces signed requests and server-derived guest identity.
alter function public.post_safety_action(text,uuid,text,jsonb) rename to post_safety_action_unchecked;
revoke all on function public.post_safety_action_unchecked(text,uuid,text,jsonb) from anon,authenticated;
create function public.post_safety_action(p_type text,p_id uuid,p_action text,p_payload jsonb default '{}') returns jsonb
language plpgsql security definer set search_path=public as $$
declare ctx jsonb; identifier text;
begin
 if p_action='report' then
  ctx:=abuse_guard_actor('report');
  identifier:=ctx->>'device';
  if identifier is not null then p_payload:=p_payload||jsonb_build_object('guestId',substr(identifier,1,32)::uuid::text); end if;
 end if;
 return post_safety_action_unchecked(p_type,p_id,p_action,p_payload);
end; $$;
revoke all on function public.post_safety_action(text,uuid,text,jsonb) from public;
grant execute on function public.post_safety_action(text,uuid,text,jsonb) to anon,authenticated;

create function public.create_abuse_challenge(p_id uuid,p_device text,p_ip text,p_answer_hash text) returns boolean
language plpgsql security definer set search_path=public as $$
begin
 if not abuse_take('device',p_device,'challenge_create',10,3600) or not abuse_take('ip',p_ip,'challenge_create',100,3600) then return false; end if;
 insert into abuse_challenges(id,device_hash,ip_hash,answer_hash) values(p_id,p_device,p_ip,p_answer_hash);
 return true;
end; $$;
create function public.verify_abuse_challenge(p_id uuid,p_device text,p_ip text,p_answer_hash text) returns boolean
language plpgsql security definer set search_path=public as $$
declare challenge abuse_challenges;
begin
 select * into challenge from abuse_challenges where id=p_id for update;
 if not found or challenge.completed_at is not null or challenge.expires_at<now() or challenge.attempts>=5 or challenge.device_hash<>p_device or challenge.ip_hash is distinct from p_ip then return false; end if;
 if not abuse_take('device',p_device,'challenge_verify',50,3600) then return false; end if;
 update abuse_challenges set attempts=attempts+1 where id=p_id;
 if challenge.answer_hash<>p_answer_hash then return false; end if;
 update abuse_challenges set completed_at=now() where id=p_id;
 insert into abuse_verification_passes(device_hash,ip_hash,expires_at) values(p_device,p_ip,now()+interval '15 minutes')
 on conflict(device_hash) do update set ip_hash=excluded.ip_hash,expires_at=excluded.expires_at;
 return true;
end; $$;

create function public.get_admin_abuse_dashboard() returns jsonb
language plpgsql stable security definer set search_path=public as $$
begin
 if not platform_admin_has_permission('admin.reports.read') then raise exception 'Permission denied.'; end if;
 return jsonb_build_object('events',(select coalesce(jsonb_agg(to_jsonb(e)),'[]') from (select * from abuse_events order by created_at desc limit 100) e),
 'restrictions',(select coalesce(jsonb_agg(to_jsonb(r)),'[]') from (select * from abuse_restrictions where revoked_at is null and expires_at>now() order by created_at desc limit 100) r),
 'identities',(select coalesce(jsonb_agg(jsonb_build_object('id',u.id,'email',u.email,'display_name',u.display_name,'created_at',r.created_at)),'[]') from abuse_identity_reviews r join users u on u.auth_user_id=r.auth_user_id where r.verified_at is null),
 'emailDeliveryReady',(select email_delivery_ready from abuse_system_settings where id),
 'audit',(select coalesce(jsonb_agg(to_jsonb(a)),'[]') from (select * from abuse_audit order by created_at desc limit 50) a),
 'policy',(select policy from abuse_system_settings where id));
end; $$;
create function public.admin_abuse_restriction(p_scope text,p_identifier text,p_mode text,p_hours integer,p_reason text) returns uuid
language plpgsql security definer set search_path=public as $$
declare result uuid;
begin
 if not platform_admin_has_permission('admin.users.suspend') then raise exception 'Permission denied.'; end if;
 if p_scope not in ('account','device','ip','country') or p_mode not in ('warn','challenge','cooldown','review','deny') or p_hours not between 1 and 720 or length(btrim(p_reason)) not between 3 and 1000 then raise exception 'Invalid restriction.'; end if;
 if (p_scope in ('device','ip') and p_identifier!~'^[a-f0-9]{64}$') or (p_scope='country' and p_identifier!~'^[A-Z]{2}$') or (p_scope='account' and not exists(select 1 from users where id::text=p_identifier)) then raise exception 'Invalid restriction target.'; end if;
 if p_scope='account' and p_identifier=current_public_user_id()::text then raise exception 'You cannot restrict your own account.'; end if;
 insert into abuse_restrictions(scope,identifier,mode,reason,created_by,expires_at) values(p_scope,p_identifier,p_mode,btrim(p_reason),current_public_user_id(),now()+make_interval(hours=>p_hours)) returning id into result;
 insert into abuse_audit(actor_user_id,action,subject_id,reason,details) values(current_public_user_id(),'restriction_created',result,p_reason,jsonb_build_object('scope',p_scope,'mode',p_mode,'hours',p_hours));
 return result;
end; $$;
create function public.admin_revoke_abuse_restriction(p_id uuid,p_reason text) returns void
language plpgsql security definer set search_path=public as $$
begin
 if not platform_admin_has_permission('admin.users.suspend') then raise exception 'Permission denied.'; end if;
 if length(btrim(p_reason))<3 then raise exception 'A reason is required.'; end if;
 update abuse_restrictions set revoked_at=now(),revoked_by=current_public_user_id() where id=p_id and revoked_at is null;
 if not found then raise exception 'Restriction not found.'; end if;
 insert into abuse_audit(actor_user_id,action,subject_id,reason) values(current_public_user_id(),'restriction_revoked',p_id,p_reason);
end; $$;
create function public.admin_abuse_policy(p_policy jsonb,p_reason text) returns void
language plpgsql security definer set search_path=public as $$
declare pair record; original jsonb;
begin
 if not platform_admin_has_permission('admin.users.suspend') then raise exception 'Permission denied.'; end if;
 if length(btrim(p_reason))<3 then raise exception 'A reason is required.'; end if;
 select policy into original from abuse_system_settings where id;
 for pair in select * from jsonb_each_text(p_policy) loop
  if not original ? pair.key or pair.value!~'^[0-9]+$' or pair.value::int not between 1 and 1000 then raise exception 'Invalid limit.'; end if;
 end loop;
 update abuse_system_settings set policy=policy||p_policy where id;
 insert into abuse_audit(actor_user_id,action,reason,details) values(current_public_user_id(),'policy_updated',p_reason,p_policy);
end; $$;
create function public.admin_review_spam_comment(p_event_id uuid,p_allow boolean,p_reason text) returns void
language plpgsql security definer set search_path=public as $$
declare event abuse_events;
begin
 if not platform_admin_has_permission('admin.reports.update') then raise exception 'Permission denied.'; end if;
 if length(btrim(p_reason))<3 then raise exception 'A reason is required.'; end if;
 select * into event from abuse_events where id=p_event_id and source_type='comment' for update;
 if not found or event.details ? 'reviewed_at' then raise exception 'Comment is no longer awaiting review.'; end if;
 update salon_profile_comments set status=case when p_allow then 'visible' else 'deleted' end where id=event.source_id and status='reported';
 if not found then raise exception 'Comment is no longer awaiting review.'; end if;
 update abuse_events set details=details||jsonb_build_object('reviewed_at',now(),'resolution',p_reason,'allowed',p_allow) where id=p_event_id;
 insert into abuse_audit(actor_user_id,action,subject_id,reason) values(current_public_user_id(),case when p_allow then 'comment_allowed' else 'comment_deleted' end,event.source_id,p_reason);
end; $$;

-- Bounded retention for pseudonymous network/device signals. Run daily via Vercel Cron.
create function public.cleanup_abuse_data() returns void
language plpgsql security definer set search_path=public as $$
begin
 delete from abuse_restrictions where expires_at<now()-interval '30 days';
 delete from abuse_counters where expires_at<now()-interval '1 day';
 delete from abuse_fingerprints where created_at<now()-interval '7 days';
 delete from abuse_challenges where expires_at<now()-interval '1 day';
 delete from abuse_verification_passes where expires_at<now();
 delete from abuse_signup_tickets where expires_at<now()-interval '1 day';
 update abuse_events set device_hash=null,ip_hash=null where created_at<now()-interval '30 days' and (device_hash is not null or ip_hash is not null);
end; $$;

-- Internal helpers are inaccessible to public API callers.
do $$ declare fn record; begin
 for fn in select oid::regprocedure as signature from pg_proc where pronamespace='public'::regnamespace and (proname like 'abuse_%' or proname in ('configure_abuse_security','issue_abuse_signup_ticket','create_abuse_challenge','verify_abuse_challenge','get_admin_abuse_dashboard','admin_abuse_restriction','admin_revoke_abuse_restriction','admin_abuse_policy','admin_review_spam_comment','cleanup_abuse_data')) loop
  execute format('revoke all on function %s from public,anon,authenticated',fn.signature);
 end loop;
end; $$;
grant execute on function public.configure_abuse_security(text,boolean,boolean),public.abuse_preflight(text,uuid,text,text,text,text),public.issue_abuse_signup_ticket(text,text,text),public.create_abuse_challenge(uuid,text,text,text),public.verify_abuse_challenge(uuid,text,text,text),public.cleanup_abuse_data() to service_role;
grant execute on function public.get_admin_abuse_dashboard(),public.admin_abuse_restriction(text,text,text,integer,text),public.admin_revoke_abuse_restriction(uuid,text),public.admin_abuse_policy(jsonb,text),public.admin_review_spam_comment(uuid,boolean,text) to authenticated;

-- Held comments remain available to their author while public comment RPCs exclude them.
drop policy if exists authenticated_create_own_comments on public.salon_profile_comments;
create policy authenticated_create_own_comments on public.salon_profile_comments for insert to authenticated
with check(author_user_id=public.current_public_user_id() and status in ('visible','published','reported')
 and public.post_comment_target_is_public(look_id,update_id,beauty_post_id,salon_id)
 and (is_salon_reply=false or (salon_id is not null and public.user_has_salon_permission(salon_id,array['salon_profile.manage','salon_profile.content.manage']::text[]))));
create policy author_read_held_comments on public.salon_profile_comments for select to authenticated
using(author_user_id=public.current_public_user_id() and status='reported');

create function public.get_abuse_notice(p_user_id uuid,p_device text,p_ip text,p_country text) returns jsonb
language sql stable security definer set search_path=public as $$
 select coalesce((select case when r is not null then jsonb_build_object('mode',r->>'mode','reason',r->>'reason','expiresAt',r->>'expires_at') when exists(select 1 from abuse_identity_reviews ar join users u on u.auth_user_id=ar.auth_user_id where u.id=p_user_id and ar.verified_at is null) then jsonb_build_object('mode','review') else '{}'::jsonb end from (select abuse_matching_restriction(p_user_id,p_device,p_ip,p_country) r) result),'{}');
$$;
revoke all on function public.get_abuse_notice(uuid,text,text,text) from public,anon,authenticated;
grant execute on function public.get_abuse_notice(uuid,text,text,text) to service_role;

create function public.admin_approve_abuse_identity(p_user_id uuid,p_reason text) returns void
language plpgsql security definer set search_path=public as $$
begin
 if not platform_admin_has_permission('admin.users.suspend') then raise exception 'Permission denied.'; end if;
 if length(btrim(p_reason))<3 then raise exception 'A reason is required.'; end if;
 update abuse_identity_reviews set verified_at=now(),approved_by=current_public_user_id()
 where auth_user_id=(select auth_user_id from users where id=p_user_id) and verified_at is null;
 if not found then raise exception 'Identity is no longer pending review.'; end if;
 insert into abuse_audit(actor_user_id,action,subject_id,reason) values(current_public_user_id(),'identity_approved',p_user_id,p_reason);
end; $$;
revoke all on function public.admin_approve_abuse_identity(uuid,text) from public,anon;
grant execute on function public.admin_approve_abuse_identity(uuid,text) to authenticated;
create function public.configure_abuse_email_verification(p_ready boolean) returns void
language sql security definer set search_path=public as $$update abuse_system_settings set email_delivery_ready=p_ready where id$$;
revoke all on function public.configure_abuse_email_verification(boolean) from public,anon,authenticated;
grant execute on function public.configure_abuse_email_verification(boolean) to service_role;

-- A human may recover from a false positive using the WAF and device-bound challenge.
create function public.record_abuse_bot_event(p_action text,p_user_id uuid,p_device text,p_ip text,p_country text) returns boolean
language plpgsql security definer set search_path=public as $$
begin
 if exists(select 1 from abuse_verification_passes where device_hash=p_device and ip_hash is not distinct from p_ip and expires_at>now()) then return true; end if;
 insert into abuse_events(user_id,device_hash,ip_hash,country,action,reason,severity) values(p_user_id,p_device,p_ip,p_country,p_action,'Automated request detected','challenge');
 if not exists(select 1 from abuse_restrictions where scope='device' and identifier=p_device and mode='challenge' and revoked_at is null and expires_at>now()) then
  insert into abuse_restrictions(scope,identifier,mode,reason,source,expires_at) values('device',p_device,'challenge','Complete a security check before continuing','automatic',now()+interval '1 hour');
 end if;
 return false;
end; $$;
revoke all on function public.record_abuse_bot_event(text,uuid,text,text,text) from public,anon,authenticated;
grant execute on function public.record_abuse_bot_event(text,uuid,text,text,text) to service_role;
