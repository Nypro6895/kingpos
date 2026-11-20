-- User administration drawer: guarded identity jobs, memberships and recovery cases.
begin;
insert into public.platform_admin_permissions(code,name,description,category,is_system) values
 ('admin.users.create','Create users','Create and invite authentication users.','Users',true),
 ('admin.users.auth.manage','Manage user authentication','Recovery email, password delivery and MFA administration.','Users',true)
on conflict(code) do nothing;
insert into public.platform_admin_role_permissions(role_id,permission_id)
select r.id,p.id from platform_admin_roles r cross join platform_admin_permissions p
where (r.slug='platform_owner' and p.code in ('admin.users.create','admin.users.auth.manage'))
 or (r.slug='operations_admin' and p.code='admin.users.auth.manage') on conflict do nothing;

alter table public.platform_reports add column if not exists support_context jsonb not null default '{}';
create table public.admin_user_identity_jobs(
 id uuid primary key, actor_user_id uuid not null references users(id), user_id uuid references users(id),
 operation text not null, email text, payload jsonb not null default '{}', reason text not null,
 status text not null default 'pending' check(status in ('pending','accepted','failed','unknown')),
 result_user_id uuid references users(id), created_at timestamptz not null default now(), completed_at timestamptz
);
alter table public.admin_user_identity_jobs enable row level security;
revoke all on public.admin_user_identity_jobs from public,anon,authenticated;

-- All recovery verification is persisted with evidence, never trusted from a client checkbox.
create function public.admin_user_verified_case(p_user_id uuid,p_case_id uuid) returns void
language plpgsql security definer set search_path=public as $$
begin
 if p_case_id is null or not exists(select 1 from platform_reports where id=p_case_id and subject_user_id=p_user_id
 and (source='admin_user_security' or support_context->>'admin_user_security'='true') and status in ('new','under_review','action_required')
 and support_context->>'identity_verified'='true' and support_context->>'contact_verified'='true'
 and length(coalesce(support_context->>'verification_evidence',''))>=10) then
 raise exception 'Use an open, verified recovery case before changing email or MFA.'; end if;
end;$$;
revoke all on function public.admin_user_verified_case(uuid,uuid) from public,anon,authenticated;

create function public.admin_user_identity_begin(p_request_id uuid,p_user_id uuid,p_operation text,p_email text,p_payload jsonb,p_reason text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare actor uuid; target users; previous admin_user_identity_jobs; auth_id uuid; reason text; key text;
begin
 perform platform_admin_require_permission(case when p_operation in ('create','invite') then 'admin.users.create' else 'admin.users.auth.manage' end);
 actor:=current_public_user_id(); reason:=platform_admin_normalize_reason(p_reason);
 if p_request_id is null or p_payload is null or jsonb_typeof(p_payload)<>'object' or octet_length(p_payload::text)>4000
 or p_operation not in ('create','invite','resend_invite','cancel_invite','password_reset','email_change','verify_email','reset_mfa') then raise exception 'Invalid identity operation.'; end if;
 if p_email is not null and (length(p_email)>254 or p_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$') then raise exception 'Invalid email.'; end if;
 perform pg_advisory_xact_lock(hashtextextended('identity-request:'||p_request_id,0));
 select * into previous from admin_user_identity_jobs where id=p_request_id;
 if found then
 if previous.actor_user_id<>actor or previous.operation<>p_operation or previous.user_id is distinct from p_user_id
 or previous.email is distinct from p_email or previous.payload<>p_payload then raise exception 'Invalid request reuse.'; end if;
 return jsonb_build_object('status',previous.status,'user_id',previous.result_user_id,'repeat',true); end if;
 if p_operation in ('create','invite') then
 if p_payload-array['display_name','first_name','last_name']<>'{}'::jsonb then raise exception 'Invalid identity fields.'; end if;
 if p_user_id is not null or p_email is null then raise exception 'Invalid new user request.'; end if;
 if exists(select 1 from users where lower(email)=lower(p_email) and status<>'deleted')
 or exists(select 1 from auth.users where lower(email)=lower(p_email)) then raise exception 'This email already belongs to an account. Open that user instead.'; end if;
 key:=lower(p_email);
 else
 if p_payload-array['case_id']<>'{}'::jsonb then raise exception 'Invalid identity fields.'; end if;
 perform platform_admin_require_permission('admin.users.read_sensitive');
 select * into target from users where id=p_user_id for update;
 if target.id is null or target.auth_user_id is null then raise exception 'This user has no authentication identity.'; end if;
 if target.id=actor then raise exception 'Use account settings to change your own authentication.'; end if;
 if target.status in ('deleted','pending_deletion') then raise exception 'This account cannot change authentication during deletion.'; end if;
 auth_id:=target.auth_user_id; key:=target.id::text;
 if p_operation='cancel_invite' then perform platform_admin_require_permission('admin.recovery.manage'); end if;
 if p_operation in ('email_change','verify_email','reset_mfa') then
 perform platform_admin_require_permission('admin.recovery.manage');
 perform admin_user_verified_case(p_user_id,(p_payload->>'case_id')::uuid); end if;
 if p_operation in ('email_change','verify_email') and lower(coalesce(p_email,target.email)) is distinct from lower((select support_context->>'recovery_contact' from platform_reports where id=(p_payload->>'case_id')::uuid)) then
 raise exception 'The email must match the independently verified recovery contact.'; end if;
 if p_operation='email_change' and (p_email is null or exists(select 1 from auth.users where id<>auth_id and lower(email)=lower(p_email))) then raise exception 'Invalid or already registered email.'; end if;
 if p_operation='password_reset' and exists(select 1 from platform_reports where subject_user_id=target.id and (source='admin_user_security' or support_context->>'admin_user_security'='true')
 and category='account_takeover' and status not in ('resolved','closed')) then
 perform admin_user_verified_case(p_user_id,(p_payload->>'case_id')::uuid);
 if lower(target.email) is distinct from lower((select support_context->>'recovery_contact' from platform_reports where id=(p_payload->>'case_id')::uuid)) then
 raise exception 'Use the verified recovery email before sending a password reset for a takeover case.'; end if;
 end if;
 if p_operation in ('resend_invite','cancel_invite') and not exists(select 1 from auth.users where id=auth_id and invited_at is not null and last_sign_in_at is null and email_confirmed_at is null) then raise exception 'This invitation is no longer pending.'; end if;
 end if;
 perform pg_advisory_xact_lock(hashtextextended('identity-target:'||key,0));
 if exists(select 1 from admin_user_identity_jobs where coalesce(user_id::text,lower(email))=key and status in ('pending','unknown')) then
 raise exception 'This identity has an unresolved operation. Review its outcome before retrying.'; end if;
 if exists(select 1 from admin_user_identity_jobs where coalesce(user_id::text,lower(email))=key and created_at>now()-interval '60 seconds') then raise exception 'Please wait 60 seconds before another identity action.'; end if;
 insert into admin_user_identity_jobs(id,actor_user_id,user_id,operation,email,payload,reason) values(p_request_id,actor,p_user_id,p_operation,p_email,p_payload,reason);
 insert into platform_admin_audit_logs(actor_user_id,action,target_type,target_id,reason,metadata)
 values(actor,'platform_admin.identity.'||p_operation||'.requested','platform_admin_user',p_user_id,reason,jsonb_build_object('request_id',p_request_id,'case_id',p_payload->>'case_id'));
 return jsonb_build_object('status','pending','auth_user_id',auth_id,'email',target.email,'repeat',false);
end;$$;

-- Only the trusted server may complete an Auth API job. No credentials or links are stored.
create function public.admin_user_identity_finish(p_request_id uuid,p_status text,p_auth_user_id uuid default null)
returns jsonb language plpgsql security definer set search_path=public as $$
declare job admin_user_identity_jobs; auth_row auth.users; result_id uuid;
begin
 select * into job from admin_user_identity_jobs where id=p_request_id for update;
 if job.id is null or p_status not in ('accepted','failed','unknown') then raise exception 'Invalid identity outcome.'; end if;
 if job.status<>'pending' then return jsonb_build_object('user_id',job.result_user_id,'status',job.status); end if;
 result_id:=job.user_id;
 if p_status='accepted' or (job.operation in ('create','invite') and p_auth_user_id is not null) then
 select * into auth_row from auth.users where id=p_auth_user_id;
 if auth_row.id is null then raise exception 'Authentication identity not found.'; end if;
 if job.operation in ('create','invite') then
 if lower(auth_row.email)<>lower(job.email) then raise exception 'Invalid authentication result.'; end if;
 insert into users(auth_user_id,email,display_name,first_name,last_name,status)
 values(auth_row.id,auth_row.email,coalesce(nullif(job.payload->>'display_name',''),auth_row.email),nullif(job.payload->>'first_name',''),nullif(job.payload->>'last_name',''),'active')
 on conflict(auth_user_id) do update set email=excluded.email returning id into result_id;
 else
 if not exists(select 1 from users where id=job.user_id and auth_user_id=auth_row.id) then raise exception 'Invalid authentication result.'; end if;
 if job.operation in ('email_change','verify_email') then update users set email=auth_row.email where id=job.user_id; end if;
 if job.operation='cancel_invite' then update users set status='inactive' where id=job.user_id; end if;
 if job.operation='resend_invite' then update users set status='active' where id=job.user_id; end if;
 end if;
 end if;
 update admin_user_identity_jobs set status=p_status,result_user_id=result_id,completed_at=now() where id=job.id;
 insert into platform_admin_audit_logs(actor_user_id,action,target_type,target_id,reason,metadata)
 values(job.actor_user_id,'platform_admin.identity.'||job.operation||'.'||p_status,'platform_admin_user',result_id,job.reason,jsonb_build_object('request_id',job.id,'case_id',job.payload->>'case_id'));
 return jsonb_build_object('user_id',result_id,'status',p_status);
end;$$;
revoke all on function public.admin_user_identity_finish(uuid,text,uuid) from public,anon,authenticated;
grant execute on function public.admin_user_identity_finish(uuid,text,uuid) to service_role;

create function public.admin_user_profile_save(p_user_id uuid,p_profile jsonb,p_expected timestamptz,p_reason text)
returns void language plpgsql security definer set search_path=public as $$
declare actor uuid; before_row users; lang text; zone text;
begin
 perform platform_admin_require_permission('admin.users.update'); actor:=current_public_user_id();
 perform platform_admin_normalize_reason(p_reason);
 if p_profile is null or p_profile-array['display_name','first_name','last_name','phone','language','timezone']<>'{}'::jsonb then raise exception 'Invalid profile fields.'; end if;
 select * into before_row from users where id=p_user_id for update;
 if before_row.id is null or before_row.status='deleted' then raise exception 'This profile cannot be updated.'; end if;
 if p_expected is null or before_row.updated_at<>p_expected then raise exception 'This profile changed. Refresh before saving.'; end if;
 lang:=p_profile->>'language'; zone:=p_profile->>'timezone';
 if lang not in ('en','vi','es','fr') or not exists(select 1 from pg_timezone_names where name=zone) then raise exception 'Invalid language or timezone.'; end if;
 if greatest(length(coalesce(p_profile->>'display_name','')),length(coalesce(p_profile->>'first_name','')),length(coalesce(p_profile->>'last_name','')))>150 or length(coalesce(p_profile->>'phone',''))>40 then raise exception 'Invalid profile field length.'; end if;
 if p_profile ? 'phone' then perform platform_admin_require_permission('admin.users.read_sensitive'); end if;
 update users set display_name=nullif(btrim(p_profile->>'display_name'),''),first_name=nullif(btrim(p_profile->>'first_name'),''),last_name=nullif(btrim(p_profile->>'last_name'),''),
 phone=case when p_profile ? 'phone' then nullif(btrim(p_profile->>'phone'),'') else phone end,language=lang,timezone=zone where id=p_user_id;
 insert into platform_admin_audit_logs(actor_user_id,action,target_type,target_id,reason,before_data,after_data)
 values(actor,'platform_admin.user_profile.updated','platform_admin_user',p_user_id,p_reason,
 jsonb_build_object('display_name',before_row.display_name,'language',before_row.language,'timezone',before_row.timezone),p_profile-'phone');
end;$$;

-- Native authentication sessions, not just the application's device history.
create function public.admin_user_revoke_sessions(p_user_id uuid,p_session_id uuid,p_reason text)
returns integer language plpgsql security definer set search_path=public as $$
declare actor uuid; target_auth uuid; amount integer;
begin
 perform platform_admin_require_permission('admin.recovery.manage'); actor:=current_public_user_id();
 perform platform_admin_normalize_reason(p_reason);
 if actor=p_user_id then raise exception 'Use account settings for your own sessions.'; end if;
 select auth_user_id into target_auth from users where id=p_user_id for update;
 if target_auth is null then raise exception 'Authentication user not found.'; end if;
 if p_session_id is not null and not exists(select 1 from auth.sessions where id=p_session_id and user_id=target_auth) then raise exception 'This session is no longer active.'; end if;
 delete from auth.refresh_tokens where session_id in(select id from auth.sessions where user_id=target_auth and (p_session_id is null or id=p_session_id));
 delete from auth.sessions where user_id=target_auth and (p_session_id is null or id=p_session_id);
 get diagnostics amount=row_count;
 if p_session_id is null then
 update account_login_sessions set revoked_at=now(),revoked_by_user_id=actor where user_id=p_user_id and revoked_at is null;
 delete from account_trusted_devices where user_id=p_user_id;
 end if;
 insert into platform_admin_audit_logs(actor_user_id,action,target_type,target_id,reason,metadata)
 values(actor,'platform_admin.auth_sessions.revoked','platform_admin_user',p_user_id,p_reason,jsonb_build_object('session_id',p_session_id,'session_count',amount));
 return amount;
end;$$;

create function public.admin_user_membership_save(p_user_id uuid,p_scope text,p_entity_id uuid,p_role text,p_status text,p_remove boolean,p_reason text)
returns void language plpgsql security definer set search_path=public as $$
declare actor uuid; business uuid; membership uuid; old_role text; new_role uuid;
begin
 perform platform_admin_require_permission('admin.users.memberships.manage'); actor:=current_public_user_id();
 perform platform_admin_normalize_reason(p_reason);
 if actor=p_user_id then raise exception 'You cannot change your own memberships here.'; end if;
 if p_scope not in ('business','salon') or p_role not in ('MANAGER','STAFF') or p_status not in ('active','inactive','suspended') or p_remove is null then raise exception 'Invalid membership change.'; end if;
 perform 1 from users where id=p_user_id and status not in ('pending_deletion','deleted') for update;
 if not found then raise exception 'This account cannot change memberships.'; end if;
 perform pg_advisory_xact_lock(hashtextextended('membership:'||p_scope||p_entity_id,0));
 if p_scope='business' then
 select id into business from accounts where id=p_entity_id and status='active';
 select m.id,r.code into membership,old_role from account_memberships m left join roles r on r.id=m.role_id where m.account_id=p_entity_id and m.user_id=p_user_id for update of m;
 else
 select account_id into business from locations where id=p_entity_id and status='active';
 select m.id,r.code into membership,old_role from salon_memberships m left join roles r on r.id=m.role_id where m.salon_id=p_entity_id and m.user_id=p_user_id for update of m;
 end if;
 if business is null then raise exception 'Active business or salon not found.'; end if;
 if upper(coalesce(old_role,''))='OWNER' then raise exception 'Use Transfer ownership to change an owner membership.'; end if;
 select id into new_role from roles where account_id=business and code=p_role;
 if new_role is null then raise exception 'Role not found for this business.'; end if;
 if p_remove then
 if membership is null then raise exception 'Membership not found.'; end if;
 if p_scope='business' then delete from account_memberships where id=membership; else delete from salon_memberships where id=membership; end if;
 elsif p_scope='business' then
 insert into account_memberships(account_id,user_id,role_id,status,joined_at) values(business,p_user_id,new_role,p_status,now()) on conflict(account_id,user_id) do update set role_id=excluded.role_id,status=excluded.status;
 else
 insert into salon_memberships(account_id,salon_id,user_id,role_id,status,joined_at) values(business,p_entity_id,p_user_id,new_role,p_status,now()) on conflict(salon_id,user_id) do update set role_id=excluded.role_id,status=excluded.status;
 end if;
 insert into platform_admin_audit_logs(actor_user_id,action,target_type,target_id,reason,metadata)
 values(actor,'platform_admin.membership.'||case when p_remove then 'removed' else 'saved' end,'platform_admin_user',p_user_id,p_reason,jsonb_build_object('scope',p_scope,'entity_id',p_entity_id,'role',p_role,'status',p_status));
end;$$;

create function public.admin_user_transfer_owner(p_user_id uuid,p_recipient uuid,p_scope text,p_entity_id uuid,p_case_id uuid,p_reason text)
returns void language plpgsql security definer set search_path=public as $$
declare business uuid; owner_role uuid; actor uuid;
begin
 perform platform_admin_require_permission('admin.users.memberships.manage');
 perform platform_admin_require_permission('admin.team.manage');
 actor:=current_public_user_id(); perform platform_admin_normalize_reason(p_reason);
 if p_user_id=p_recipient or p_recipient=actor or p_scope not in ('business','salon') then raise exception 'Invalid ownership transfer.'; end if;
 perform admin_user_verified_case(p_user_id,p_case_id);
 if not exists(select 1 from platform_reports where id=p_case_id and support_context->>'ownership_verified'='true') then raise exception 'Confirm business ownership in the verified recovery case before transfer.'; end if;
 -- Stable locking order prevents two transfers from deadlocking on recipient users.
 perform 1 from users where id in(p_user_id,p_recipient) order by id for update;
 if not exists(select 1 from users where id=p_recipient and status='active') or not exists(select 1 from users where id=p_user_id and status not in ('deleted','pending_deletion')) then raise exception 'Only eligible accounts can transfer ownership.'; end if;
 if p_scope='business' then select id into business from accounts where id=p_entity_id;
 else select account_id into business from locations where id=p_entity_id; end if;
 if business is null then raise exception 'Business or salon not found.'; end if;
 -- Serialize account-wide and salon transfers together.
 perform pg_advisory_xact_lock(hashtextextended('owner-transfer:'||business,0));
 select id into owner_role from roles where account_id=business and code='OWNER';
 if owner_role is null then raise exception 'Owner role not found.'; end if;
 if p_scope='business' then
 perform 1 from account_memberships where account_id=business and user_id=p_user_id and role_id=owner_role and status='active' for update;
 if not found then raise exception 'This user is not an active business owner.'; end if;
 insert into account_memberships(account_id,user_id,role_id,status,joined_at) values(business,p_recipient,owner_role,'active',now()) on conflict(account_id,user_id) do update set role_id=excluded.role_id,status='active';
 update account_memberships set status='inactive' where account_id=business and user_id=p_user_id;
 -- Preserve the recipient's access at each salon before removing the previous owner's direct ownership.
 insert into salon_memberships(account_id,salon_id,user_id,role_id,status,joined_at)
 select business,salon_id,p_recipient,owner_role,'active',now() from salon_memberships where account_id=business and user_id=p_user_id and role_id=owner_role and status='active'
 on conflict(salon_id,user_id) do update set role_id=excluded.role_id,status='active';
 update salon_memberships set status='inactive' where account_id=business and user_id=p_user_id and role_id=owner_role;
 else
 if exists(select 1 from account_memberships where account_id=business and user_id=p_user_id and role_id=owner_role and status='active') then raise exception 'Transfer business ownership first; business owners retain access to every salon.'; end if;
 perform 1 from salon_memberships where salon_id=p_entity_id and user_id=p_user_id and role_id=owner_role and status='active' for update;
 if not found then raise exception 'This user is not an active salon owner.'; end if;
 insert into salon_memberships(account_id,salon_id,user_id,role_id,status,joined_at) values(business,p_entity_id,p_recipient,owner_role,'active',now()) on conflict(salon_id,user_id) do update set role_id=excluded.role_id,status='active';
 update salon_memberships set status='inactive' where salon_id=p_entity_id and user_id=p_user_id;
 end if;
 insert into platform_admin_audit_logs(actor_user_id,action,target_type,target_id,reason,metadata)
 values(actor,'platform_admin.ownership.transferred','platform_admin_user',p_user_id,p_reason,jsonb_build_object('recipient',p_recipient,'scope',p_scope,'entity_id',p_entity_id,'case_id',p_case_id));
end;$$;

create function public.admin_user_case_save(p_user_id uuid,p_request_id uuid,p_case_id uuid,p_data jsonb,p_reason text)
returns uuid language plpgsql security definer set search_path=public as $$
declare actor uuid; result uuid; previous platform_reports; assignee uuid; category text; evidence text;
begin
 perform platform_admin_require_permission(case when p_case_id is null then 'admin.reports.create' else 'admin.reports.update' end);
 perform platform_admin_require_permission('admin.recovery.manage'); actor:=current_public_user_id();
 perform platform_admin_require_permission('admin.users.read_sensitive');
 perform platform_admin_normalize_reason(p_reason);
 if p_request_id is null or p_data is null or jsonb_typeof(p_data)<>'object' or octet_length(p_data::text)>16000 then raise exception 'Invalid support case.'; end if;
 if p_data-array['category','description','priority','assigned_membership_id','recovery_contact','verification_evidence','status','resolution','expected_updated_at','identity_verified','contact_verified','ownership_verified','suspend','revoke','attachments']<>'{}'::jsonb then raise exception 'Invalid case fields.'; end if;
 category:=p_data->>'category'; assignee:=nullif(p_data->>'assigned_membership_id','')::uuid;
 if category not in ('lost_access','account_takeover','ownership','other') or length(coalesce(p_data->>'description','')) not between 3 and 5000
 or p_data->>'priority' not in ('low','normal','high','urgent') then raise exception 'Invalid case details.'; end if;
 if p_data->>'recovery_contact' is not null and length(p_data->>'recovery_contact')>254 then raise exception 'Invalid recovery contact.'; end if;
 evidence:=coalesce(p_data->>'verification_evidence','');
 if p_data ? 'attachments' then
 if jsonb_typeof(p_data->'attachments')<>'array' then raise exception 'Invalid evidence attachments.'; end if;
 if jsonb_array_length(p_data->'attachments')>15 or exists(select 1 from jsonb_array_elements(p_data->'attachments') a where jsonb_typeof(a)<>'object' or a-array['path','name']<>'{}'::jsonb or length(coalesce(a->>'name','')) not between 1 and 150 or left(coalesce(a->>'path',''),37)<>p_user_id::text||'/' or not exists(select 1 from storage.objects o where o.bucket_id='admin-user-evidence' and o.name=a->>'path')) then raise exception 'Evidence must be uploaded for this user.'; end if;
 end if;
 if (p_data->>'identity_verified'='true' or p_data->>'contact_verified'='true' or p_data->>'ownership_verified'='true') and length(btrim(evidence))<10 then raise exception 'Verification evidence must be recorded before confirming ownership or recovery contact.'; end if;
 if assignee is not null and p_case_id is null then
 perform platform_admin_require_permission('admin.reports.assign');
 if not exists(select 1 from platform_admin_memberships where id=assignee and status='active') then raise exception 'Assigned admin is not active.'; end if; end if;
 perform 1 from users where id=p_user_id for update;
 if not found then raise exception 'User not found.'; end if;
 perform pg_advisory_xact_lock(hashtextextended('user-case:'||p_user_id,0));
 if p_case_id is null then
 select id into result from platform_reports where subject_user_id=p_user_id and (source='admin_user_security' or support_context->>'admin_user_security'='true') and support_context->>'request_id'=p_request_id::text;
 if result is not null then return result; end if;
 if exists(select 1 from platform_reports r where r.subject_user_id=p_user_id and (r.source='admin_user_security' or r.support_context->>'admin_user_security'='true') and r.category=p_data->>'category' and r.status not in ('resolved','closed')) then raise exception 'This user already has an open case of this type. Open it and add information.'; end if;
 insert into platform_reports(category,summary,description,source,subject_user_id,priority,assigned_membership_id,created_by_user_id,support_context)
 values(category,left(replace(category,'_',' ')||': '||coalesce((select display_name from users where id=p_user_id),p_user_id::text),200),p_data->>'description','admin_user_security',p_user_id,p_data->>'priority',assignee,actor,
 (p_data-'assigned_membership_id'-'priority'-'description')||jsonb_build_object('request_id',p_request_id,'verified_by',actor,'verified_at',now())) returning id into result;
 else
 select * into previous from platform_reports where id=p_case_id and subject_user_id=p_user_id and (source='admin_user_security' or support_context->>'admin_user_security'='true') for update;
 if previous.id is null then raise exception 'Related recovery case not found.'; end if;
 if previous.assigned_membership_id is distinct from assignee then
 perform platform_admin_require_permission('admin.reports.assign');
 if assignee is not null and not exists(select 1 from platform_admin_memberships where id=assignee and status='active') then raise exception 'Assigned admin is not active.'; end if;
 end if;
 if previous.updated_at is distinct from (p_data->>'expected_updated_at')::timestamptz then raise exception 'This case changed. Refresh before saving.'; end if;
 if p_data->>'status' not in ('new','under_review','action_required','resolved','closed') then raise exception 'Invalid case status.'; end if;
 if p_data->>'status' in ('resolved','closed') then perform platform_admin_require_permission('admin.reports.resolve'); end if;
 update platform_reports set description=p_data->>'description',priority=p_data->>'priority',assigned_membership_id=assignee,status=p_data->>'status',
 resolution=case when p_data->>'status' in ('resolved','closed') then platform_admin_normalize_reason(p_data->>'resolution') else null end,
 resolved_at=case when p_data->>'status'='resolved' then now() else null end,closed_at=case when p_data->>'status'='closed' then now() else null end,
 support_context=previous.support_context||(p_data-'expected_updated_at'-'assigned_membership_id'-'priority'-'description'-'status'-'resolution')||jsonb_build_object('verified_by',actor,'verified_at',now()),updated_at=now() where id=previous.id;
 result:=previous.id;
 end if;
 if p_data->>'suspend'='true' then perform admin_set_user_access(p_user_id,p_reason,true); end if;
 if p_data->>'revoke'='true' or p_data->>'suspend'='true' then perform admin_user_revoke_sessions(p_user_id,null,p_reason); end if;
 insert into platform_admin_audit_logs(actor_user_id,action,target_type,target_id,reason,metadata)
 values(actor,'platform_admin.user_case.'||case when p_case_id is null then 'created' else 'updated' end,'platform_admin_user',p_user_id,p_reason,jsonb_build_object('case_id',result));
 return result;
end;$$;

create function public.admin_user_workspace(p_user_id uuid)
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare result jsonb; target_auth uuid; sensitive boolean;
begin
 perform platform_admin_require_permission('admin.users.read');
 result:=get_platform_admin_user_detail(p_user_id); sensitive:=platform_admin_has_permission('admin.users.read_sensitive');
 select auth_user_id into target_auth from users where id=p_user_id;
 return result||jsonb_build_object(
 'authentication',case when sensitive and platform_admin_has_permission('admin.recovery.read') then
 (select jsonb_build_object('email_confirmed_at',email_confirmed_at,'invited_at',invited_at,'last_sign_in_at',last_sign_in_at,'banned_until',banned_until,
 'factors',(select coalesce(jsonb_agg(jsonb_build_object('id',f.id,'factor_type',f.factor_type,'status',f.status)),'[]') from auth.mfa_factors f where f.user_id=u.id)) from auth.users u where u.id=target_auth) else null end,
 'sessions',case when platform_admin_has_permission('admin.recovery.read') then
 (select coalesce(jsonb_agg(jsonb_build_object('id',id,'created_at',created_at,'updated_at',updated_at,'user_agent',agent)),'[]') from (select id,created_at,updated_at,to_jsonb(native)->>'user_agent' as agent from auth.sessions native where user_id=target_auth order by created_at desc limit 50) s) else '[]'::jsonb end,
 'identity_jobs',case when sensitive and platform_admin_has_permission('admin.recovery.read') then
 (select coalesce(jsonb_agg(jsonb_build_object('id',id,'operation',operation,'status',status,'created_at',created_at)),'[]') from (select * from admin_user_identity_jobs where user_id=p_user_id or result_user_id=p_user_id order by created_at desc limit 10) j) else '[]'::jsonb end,
 'cases',case when platform_admin_has_permission('admin.reports.read') then
 (select coalesce(jsonb_agg(jsonb_build_object('id',id,'reference',report_number,'category',category,'summary',summary,'description',description,'status',status,'priority',priority,'assigned_membership_id',assigned_membership_id,'resolution',resolution,'updated_at',updated_at,'created_at',created_at,'context',case when sensitive then support_context else support_context-'recovery_contact'-'verification_evidence'-'attachments' end)),'[]') from (select * from platform_reports where subject_user_id=p_user_id and (source='admin_user_security' or support_context->>'admin_user_security'='true') order by updated_at desc limit 30) c) else '[]'::jsonb end,
 'assignees',case when platform_admin_has_permission('admin.reports.assign') then
 (select coalesce(jsonb_agg(jsonb_build_object('id',m.id,'name',coalesce(u.display_name,r.name))),'[]') from platform_admin_memberships m join users u on u.id=m.user_id join platform_admin_roles r on r.id=m.role_id where m.status='active' and u.status='active') else '[]'::jsonb end);
end;$$;

revoke all on function public.admin_user_identity_begin(uuid,uuid,text,text,jsonb,text),public.admin_user_profile_save(uuid,jsonb,timestamptz,text),public.admin_user_revoke_sessions(uuid,uuid,text),public.admin_user_membership_save(uuid,text,uuid,text,text,boolean,text),public.admin_user_transfer_owner(uuid,uuid,text,uuid,uuid,text),public.admin_user_case_save(uuid,uuid,uuid,jsonb,text),public.admin_user_workspace(uuid) from public,anon;
grant execute on function public.admin_user_identity_begin(uuid,uuid,text,text,jsonb,text),public.admin_user_profile_save(uuid,jsonb,timestamptz,text),public.admin_user_revoke_sessions(uuid,uuid,text),public.admin_user_membership_save(uuid,text,uuid,text,text,boolean,text),public.admin_user_transfer_owner(uuid,uuid,text,uuid,uuid,text),public.admin_user_case_save(uuid,uuid,uuid,jsonb,text),public.admin_user_workspace(uuid) to authenticated;
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values('admin-user-evidence','admin-user-evidence',false,8388608,array['application/pdf','image/png','image/jpeg']) on conflict(id) do nothing;
-- Suspension and deletion revoke actual Auth sessions regardless of entry point.
create function public.admin_user_status_revoke() returns trigger language plpgsql security definer set search_path=public as $$
begin
 if new.status is distinct from old.status and new.status in ('suspended','inactive','pending_deletion','deleted') and old.auth_user_id is not null then
 delete from auth.refresh_tokens where session_id in(select id from auth.sessions where user_id=old.auth_user_id);
 delete from auth.sessions where user_id=old.auth_user_id;
 update account_login_sessions set revoked_at=now(),revoked_by_user_id=current_public_user_id() where user_id=new.id and revoked_at is null;
 delete from account_trusted_devices where user_id=new.id;
 end if;
 return new;
end;$$;
revoke all on function public.admin_user_status_revoke() from public,anon,authenticated;
create trigger admin_user_status_revoke after update of status on public.users for each row execute function public.admin_user_status_revoke();

create function public.admin_user_export_selected(p_ids uuid[]) returns jsonb language plpgsql stable security definer set search_path=public as $$
declare sensitive boolean;
begin
 perform platform_admin_require_permission('admin.users.read');sensitive:=platform_admin_has_permission('admin.users.read_sensitive');
 if p_ids is null or cardinality(p_ids) not between 1 and 100 then raise exception 'Select between 1 and 100 users.'; end if;
 return (select coalesce(jsonb_agg(jsonb_build_object('id',u.id,'display_name',u.display_name,'email',case when sensitive then u.email else null end,'phone',case when sensitive then u.phone else null end,'status',u.status,'created_at',u.created_at,'last_login_at',u.last_login_at,
 'roles',(select coalesce(jsonb_agg(distinct r.code),'[]') from account_memberships m join roles r on r.id=m.role_id where m.user_id=u.id and m.status='active'),
 'businesses',(select coalesce(jsonb_agg(jsonb_build_object('name',a.name)),'[]') from accounts a where exists(select 1 from account_memberships m where m.account_id=a.id and m.user_id=u.id and m.status='active'))) order by u.created_at desc,u.id),'[]') from users u where u.id=any(p_ids));
end;$$;
revoke all on function public.admin_user_export_selected(uuid[]) from public,anon;
grant execute on function public.admin_user_export_selected(uuid[]) to authenticated;

-- An owner records an inspected provider outcome; this does not repeat an external action.
create function public.admin_user_identity_review(p_user_id uuid,p_job_id uuid,p_outcome text,p_reason text) returns void
language plpgsql security definer set search_path=public as $$
declare job admin_user_identity_jobs; actor uuid;
begin
 perform platform_admin_require_permission('admin.team.manage');perform platform_admin_require_permission('admin.users.auth.manage');
 actor:=current_public_user_id();perform platform_admin_normalize_reason(p_reason);
 if p_outcome not in ('accepted','failed') or length(btrim(p_reason))<10 then raise exception 'Record the provider evidence and outcome.'; end if;
 select * into job from admin_user_identity_jobs where id=p_job_id and (user_id=p_user_id or result_user_id=p_user_id) for update;
 if job.id is null or job.status not in ('pending','unknown') then raise exception 'This operation does not need outcome review.'; end if;
 if job.status='pending' and job.created_at>now()-interval '5 minutes' then raise exception 'This operation is still processing. Wait before reviewing.'; end if;
  if job.operation='email_change' then
 if (exists(select 1 from users u join auth.users a on a.id=u.auth_user_id where u.id=p_user_id and lower(a.email)=lower(job.email))) is distinct from (p_outcome='accepted') then raise exception 'The selected outcome does not match the authentication email.'; end if;
 if p_outcome='accepted' then update users set email=(select email from auth.users where id=users.auth_user_id) where id=p_user_id; end if;
 elsif job.operation='verify_email' then
 if (exists(select 1 from users u join auth.users a on a.id=u.auth_user_id where u.id=p_user_id and a.email_confirmed_at is not null)) is distinct from (p_outcome='accepted') then raise exception 'The selected outcome does not match email verification.'; end if;
 elsif job.operation='reset_mfa' then
 if (not exists(select 1 from auth.mfa_factors where user_id=(select auth_user_id from users where id=p_user_id))) is distinct from (p_outcome='accepted') then raise exception 'The selected outcome does not match the MFA factors.'; end if;
 elsif job.operation='cancel_invite' then
 if (exists(select 1 from users u join auth.users a on a.id=u.auth_user_id where u.id=p_user_id and a.banned_until>now())) is distinct from (p_outcome='accepted') then raise exception 'The selected outcome does not match invitation cancellation.'; end if;
 if p_outcome='accepted' then update users set status='inactive' where id=p_user_id; end if;
 elsif job.operation='create' then
 if not exists(select 1 from users where id=p_user_id and lower(email)=lower(job.email)) or p_outcome<>'accepted' then raise exception 'Review the created identity with a platform owner.'; end if;
 end if;
 if p_outcome='accepted' and job.operation in ('email_change','reset_mfa','cancel_invite') then
 delete from auth.refresh_tokens where session_id in (select id from auth.sessions where user_id=(select auth_user_id from users where id=p_user_id));
 delete from auth.sessions where user_id=(select auth_user_id from users where id=p_user_id);
 update account_login_sessions set revoked_at=now(),revoked_by_user_id=actor where user_id=p_user_id and revoked_at is null;
 delete from account_trusted_devices where user_id=p_user_id;
 end if;
 update admin_user_identity_jobs set status=p_outcome,completed_at=now() where id=job.id;
 insert into platform_admin_audit_logs(actor_user_id,action,target_type,target_id,reason,metadata)
 values(actor,'platform_admin.identity.outcome_reviewed','platform_admin_user',p_user_id,p_reason,jsonb_build_object('job_id',job.id,'outcome',p_outcome));
end;$$;
revoke all on function public.admin_user_identity_review(uuid,uuid,text,text) from public,anon;
grant execute on function public.admin_user_identity_review(uuid,uuid,text,text) to authenticated;
create function public.admin_user_case_link(p_user_id uuid,p_report_id uuid,p_category text,p_reason text) returns uuid
language plpgsql security definer set search_path=public as $$
declare report platform_reports;
begin
 perform platform_admin_require_permission('admin.reports.update');perform platform_admin_require_permission('admin.reports.read');perform platform_admin_require_permission('admin.recovery.manage');perform platform_admin_require_permission('admin.users.read_sensitive');
 perform platform_admin_normalize_reason(p_reason);
 if p_category not in ('lost_access','account_takeover','ownership','other') then raise exception 'Invalid case type.'; end if;
 perform 1 from users where id=p_user_id for update;
 if not found then raise exception 'User not found.'; end if;
 perform pg_advisory_xact_lock(hashtextextended('user-case:'||p_user_id,0));
 select * into report from platform_reports where id=p_report_id for update;
 if report.id is null or (report.subject_user_id is distinct from p_user_id and report.reporter_user_id is distinct from p_user_id) then raise exception 'Only a case already related to this user can be linked.'; end if;
 if report.subject_organization_id is not null or report.subject_location_id is not null or (report.subject_user_id is not null and report.subject_user_id<>p_user_id) then raise exception 'This case has a different primary subject.'; end if;
 if report.status in ('resolved','closed') then raise exception 'Only open cases can be linked.'; end if;
 if exists(select 1 from platform_reports r where r.subject_user_id=p_user_id and r.id<>report.id and (r.source='admin_user_security' or r.support_context->>'admin_user_security'='true') and r.category=p_category and r.status not in ('resolved','closed')) then raise exception 'This user already has an open recovery case of this type.'; end if;
 update platform_reports set subject_user_id=p_user_id,category=p_category,support_context=support_context||jsonb_build_object('admin_user_security',true,'original_category',report.category),updated_at=now() where id=report.id;
 insert into platform_admin_audit_logs(actor_user_id,action,target_type,target_id,reason,metadata)
 values(current_public_user_id(),'platform_admin.user_case.linked','platform_admin_user',p_user_id,p_reason,jsonb_build_object('case_id',report.id));
 return report.id;
end;$$;
revoke all on function public.admin_user_case_link(uuid,uuid,text,text) from public,anon;
grant execute on function public.admin_user_case_link(uuid,uuid,text,text) to authenticated;
notify pgrst,'reload schema';
commit;



