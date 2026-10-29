-- Social signals are advisory. Only an explicit human restriction can block publication.
-- Authentication, signed context, RLS, suspension and previous moderation decisions remain enforced.
begin;
set local lock_timeout='5s';
set local statement_timeout='30s';

create or replace function public.abuse_social_restriction(p_user_id uuid,p_device text,p_ip text,p_country text) returns jsonb
language sql stable security definer set search_path=public as $$
 select to_jsonb(r) from abuse_restrictions r where revoked_at is null and expires_at>now()
 and source<>'automatic'
 and ((scope='account' and identifier=p_user_id::text) or (scope='device' and identifier=p_device) or (scope='ip' and identifier=p_ip) or (scope='country' and identifier=p_country))
 order by case mode when 'deny' then 1 when 'cooldown' then 2 when 'challenge' then 3 when 'review' then 4 else 5 end,created_at desc limit 1;
$$;
revoke all on function public.abuse_social_restriction(uuid,text,text,text) from public,anon,authenticated;

-- Deduplicate advisory signals to avoid filling the admin queue on retries.
create or replace function public.record_social_safety_signal(p_action text,p_user_id uuid,p_device text,p_ip text,p_country text,p_reason text) returns boolean
language plpgsql security definer set search_path=public as $$
begin
 if p_action not in ('post','comment','report','media') or p_reason not in ('Automated request detected','Request rate exceeded','Posting rate exceeded','Safety detector unavailable') then raise exception 'Invalid social signal.'; end if;
 perform pg_advisory_xact_lock(hashtextextended(coalesce(p_user_id::text,p_device,'')||p_action||p_reason,84));
 if not exists(select 1 from abuse_events where user_id is not distinct from p_user_id and device_hash is not distinct from p_device and action=p_action and reason=p_reason and created_at>now()-interval '10 minutes') then
  insert into abuse_events(user_id,device_hash,ip_hash,country,action,reason,severity,details)
  values(p_user_id,p_device,p_ip,p_country,p_action,p_reason,'warning','{"monitorOnly":true}'::jsonb);
 end if;
 return true;
end; $$;
revoke all on function public.record_social_safety_signal(text,uuid,text,text,text,text) from public,anon,authenticated;
grant execute on function public.record_social_safety_signal(text,uuid,text,text,text,text) to service_role;

create or replace function public.abuse_preflight(p_action text,p_user_id uuid,p_device text,p_ip text,p_country text,p_subject text default null) returns jsonb
language plpgsql security definer set search_path=public as $$
declare restriction jsonb; passed boolean; allowed boolean:=true; challenge boolean:=false; message text; actor_limit integer; violations integer; policy_value jsonb;
begin
 if p_action not in ('post','comment','report','signup','login','recovery') or p_device!~'^[a-f0-9]{64}$' or (p_ip is not null and p_ip!~'^[a-f0-9]{64}$') then raise exception 'Invalid safety request.'; end if;
 select policy into policy_value from abuse_system_settings where id;
 restriction:=case when p_action in ('post','comment','report') then abuse_social_restriction(p_user_id,p_device,p_ip,p_country) else abuse_matching_restriction(p_user_id,p_device,p_ip,p_country) end;
 passed:=exists(select 1 from abuse_verification_passes where device_hash=p_device and ip_hash is not distinct from p_ip and expires_at>now());
 if restriction->>'mode'='deny' or (restriction->>'mode'='cooldown' and p_action not in ('login','recovery')) then return jsonb_build_object('allowed',false,'code','restricted','message','This action is temporarily restricted. Try again after '||(restriction->>'expires_at')||' or contact support.'); end if;
 if restriction->>'mode'='challenge' and not passed then challenge:=true; end if;

 -- Social volume is measured, never escalated into an automatic restriction.
 if p_action in ('post','comment','report') then
  if challenge then return jsonb_build_object('allowed',false,'code','security_check_required','challengeRequired',true,'message','Please complete the security check at /security-check, then try again.'); end if;
  actor_limit:=case p_action when 'comment' then 120 when 'post' then 30 else 30 end;
  if not abuse_take('device',p_device,'request_'||p_action,actor_limit,3600) then
   perform record_social_safety_signal(p_action,p_user_id,p_device,p_ip,p_country,'Request rate exceeded');
  end if;
  return jsonb_build_object('allowed',true,'monitorOnly',true);
 end if;
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

create or replace function public.abuse_guard_actor(p_action text) returns jsonb
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
 restriction:=abuse_social_restriction(uid,context->>'device',context->>'ip',context->>'country');
 if restriction->>'mode' in ('deny','cooldown') then raise exception 'Posting is temporarily restricted. Contact support or try again later.'; end if;
 if restriction->>'mode'='challenge' and not exists(select 1 from abuse_verification_passes where device_hash=context->>'device' and ip_hash is not distinct from context->>'ip' and expires_at>now()) then raise exception 'Please complete the security check at /security-check, then try again.'; end if;
 if p_action='media' then return coalesce(context,'{}')||jsonb_build_object('review',restriction->>'mode'='review'); end if;
 hourly:=case p_action when 'post' then (settings.policy->>case when new_account then 'post_new_hour' else 'post_hour' end)::int when 'comment' then (settings.policy->>case when new_account then 'comment_new_window' else 'comment_window' end)::int else (settings.policy->>'report_hour')::int end;
 daily:=case p_action when 'post' then (settings.policy->>case when new_account then 'post_new_day' else 'post_day' end)::int when 'comment' then (settings.policy->>case when new_account then 'comment_new_day' else 'comment_day' end)::int else 30 end;
 if not abuse_take('account',coalesce(uid::text,context->>'device'),p_action,hourly,case when p_action='comment' then 600 else 3600 end) or not abuse_take('account',coalesce(uid::text,context->>'device'),p_action||'_day',daily,86400) then perform record_social_safety_signal(p_action,uid,context->>'device',context->>'ip',context->>'country','Posting rate exceeded'); end if;
 if not abuse_take('device',context->>'device',p_action,hourly*3,3600) or not abuse_take('ip',context->>'ip',p_action,hourly*20,3600) then perform record_social_safety_signal(p_action,uid,context->>'device',context->>'ip',context->>'country','Posting rate exceeded'); end if;
 return coalesce(context,'{}')||jsonb_build_object('review',coalesce(restriction->>'mode'='review',false));
end; $$;

create or replace function public.record_abuse_bot_event(p_action text,p_user_id uuid,p_device text,p_ip text,p_country text) returns boolean
language plpgsql security definer set search_path=public as $$
begin
 if p_action in ('post','comment','report') then
  return record_social_safety_signal(p_action,p_user_id,p_device,p_ip,p_country,'Automated request detected');
 end if;
 if exists(select 1 from abuse_verification_passes where device_hash=p_device and ip_hash is not distinct from p_ip and expires_at>now()) then return true; end if;
 insert into abuse_events(user_id,device_hash,ip_hash,country,action,reason,severity) values(p_user_id,p_device,p_ip,p_country,p_action,'Automated request detected','challenge');
 if not exists(select 1 from abuse_restrictions where scope='device' and identifier=p_device and mode='challenge' and revoked_at is null and expires_at>now()) then
  insert into abuse_restrictions(scope,identifier,mode,reason,source,expires_at) values('device',p_device,'challenge','Complete a security check before continuing','automatic',now()+interval '1 hour');
 end if;
 return false;
end; $$;

create or replace function public.abuse_guard_content() returns trigger
language plpgsql security definer set search_path=public as $$
declare row_data jsonb:=to_jsonb(new); old_data jsonb; body text; normalized text; ctx jsonb; uid uuid; kind text; repeated boolean:=false; link text; phone_value text; reason text;
begin
 if TG_OP = 'UPDATE' and public.is_account_erasure_write((to_jsonb(NEW)->>'author_user_id')::uuid) then return NEW; end if;
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
 if repeated and not coalesce((ctx->>'review')::boolean,false) then
  insert into abuse_events(user_id,device_hash,ip_hash,country,action,reason,severity,source_type,source_id,details)
  values(uid,ctx->>'device',ctx->>'ip',ctx->>'country',case when kind='comment' then 'comment' else 'post' end,'Repeated content or contact details','warning',kind,new.id,jsonb_build_object('monitorOnly',true));
 end if;
 if coalesce((ctx->>'review')::boolean,false) then
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

create or replace function public.abuse_guard_image() returns trigger
language plpgsql security definer set search_path=public as $$
declare data jsonb:=to_jsonb(new); kind text; post_id uuid; post_data jsonb; path text; bucket text; fingerprint text; ctx jsonb:=abuse_signed_context(); uid uuid; tbl text;
begin
 if TG_OP = 'UPDATE' and public.is_account_erasure_write((to_jsonb(NEW)->>'author_user_id')::uuid) then return NEW; end if;
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
  insert into abuse_events(user_id,device_hash,ip_hash,country,action,reason,severity,source_type,source_id,details)
  values(uid,ctx->>'device',ctx->>'ip',ctx->>'country','media','Repeated image','warning',kind,post_id,'{"monitorOnly":true}'::jsonb);
 end if;
 return new;
end; $$;

create or replace function public.post_safety_scan() returns trigger
language plpgsql security definer set search_path=public as $$
declare row_data jsonb:=to_jsonb(new); old_data jsonb; content text; matches text[]; kind text; original_state text;
begin
 if TG_OP = 'UPDATE' and public.is_account_erasure_write((to_jsonb(NEW)->>'author_user_id')::uuid) then return NEW; end if;
 if tg_op='UPDATE' then
  old_data:=to_jsonb(old);
  if row_data->>'caption' is not distinct from old_data->>'caption' and row_data->>'title' is not distinct from old_data->>'title' then
   -- Authors cannot bypass an existing hold by changing publication flags.
   if old.safety_hold and not public.platform_admin_has_permission('admin.reports.update') then
    new.safety_hold:=true;
    if tg_table_name='beauty_posts' then new:=jsonb_populate_record(new,jsonb_build_object('visibility','self'));
    else new:=jsonb_populate_record(new,jsonb_build_object('status','draft')); end if;
   end if;
   return new;
  end if;
 end if;
 content:=lower(coalesce(row_data->>'title','')||' '||coalesce(row_data->>'caption',''));
 select array_agg(phrase) into matches from public.post_safety_keywords
 where enabled and strpos(content,lower(phrase))>0;
 if matches is null then
  -- An edit never releases a hold; an administrator must approve it.
  if tg_op='UPDATE' and old.safety_hold then
   new.safety_hold:=true;
   if tg_table_name='beauty_posts' then new:=jsonb_populate_record(new,jsonb_build_object('visibility','self'));
   else new:=jsonb_populate_record(new,jsonb_build_object('status','draft')); end if;
  end if;
  return new;
 end if;
 kind:=case tg_table_name when 'beauty_posts' then 'beauty_post' when 'salon_profile_looks' then 'salon_profile_look' else 'salon_profile_update' end;
 original_state:=case when tg_table_name='beauty_posts' then row_data->>'visibility' else row_data->>'status' end;
 -- A keyword match opens an admin review case without changing publication.
 -- Existing holds, including human decisions, are never released by an edit.
 if tg_op='UPDATE' and old.safety_hold then
  new.safety_hold:=true;
  if tg_table_name='beauty_posts' then new:=jsonb_populate_record(new,jsonb_build_object('visibility','self'));
  else new:=jsonb_populate_record(new,jsonb_build_object('status','draft')); end if;
 end if;
 insert into public.post_safety_cases(source_type,source_id,origin,reason,matched_keywords,content_snapshot,author_user_id)
 values(kind,new.id,'automatic','Keyword match',matches,row_data,(row_data->>'author_user_id')::uuid)
 on conflict(source_type,source_id) where origin='automatic' and status='pending'
 do update set matched_keywords=excluded.matched_keywords,
 content_snapshot=excluded.content_snapshot || jsonb_build_object(
 'visibility',post_safety_cases.content_snapshot->>'visibility','status',post_safety_cases.content_snapshot->>'status');
 return new;
end; $$;

create or replace function public.get_abuse_notice(p_user_id uuid,p_device text,p_ip text,p_country text) returns jsonb
language sql stable security definer set search_path=public as $$
 select coalesce(case when r is null then '{}'::jsonb when r->>'mode'='challenge' and exists(select 1 from abuse_verification_passes where device_hash=p_device and ip_hash is not distinct from p_ip and expires_at>now()) then '{}'::jsonb else jsonb_build_object('mode',r->>'mode','reason',r->>'reason','expiresAt',r->>'expires_at') end,'{}'::jsonb)
 from (select abuse_social_restriction(p_user_id,p_device,p_ip,p_country) r) active;
$$;
commit;
