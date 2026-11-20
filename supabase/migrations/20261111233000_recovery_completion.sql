begin;
alter table public.account_recovery_requests add column if not exists admin_case_id uuid references public.platform_reports(id), add column if not exists secured_at timestamptz, add column if not exists reset_link_sent_at timestamptz, add column if not exists password_changed_at timestamptz, add column if not exists mfa_reset_at timestamptz, add column if not exists restored_at timestamptz;
create unique index recovery_admin_case_unique on public.account_recovery_requests(admin_case_id) where admin_case_id is not null;
create index recovery_active_auth_progress on public.account_recovery_requests(user_id) where password_changed_at is not null and status not in ('resolved','denied','cancelled');
create table public.recovery_contact_challenges(id uuid primary key,case_id uuid not null references public.platform_reports(id),user_id uuid not null references public.users(id),email text not null,token_digest text not null unique check(token_digest ~ '^[a-f0-9]{64}$'),expires_at timestamptz not null,verified_at timestamptz,revoked_at timestamptz,created_at timestamptz not null default now());
alter table public.recovery_contact_challenges enable row level security;
revoke all on public.recovery_contact_challenges from public,anon,authenticated;

create function public.recovery_contact_verified(p_case uuid) returns boolean language sql stable security definer set search_path=public as $$
 select exists(select 1 from recovery_contact_challenges c join platform_reports p on p.id=c.case_id where c.case_id=p_case and c.user_id=p.subject_user_id and c.email=lower(btrim(p.support_context->>'recovery_contact')) and c.revoked_at is null and c.verified_at>now()-interval '24 hours'); $$;
create function public.recovery_access_complete(p_case uuid) returns boolean language sql stable security definer set search_path=public as $$
 select exists(select 1 from account_recovery_requests r join platform_reports p on p.id=r.admin_case_id join users u on u.id=r.user_id join auth.users a on a.id=u.auth_user_id
 where p.id=p_case and u.status='active' and p.support_context->>'identity_verified'='true' and length(btrim(coalesce(p.support_context->>'verification_evidence','')))>=10 and recovery_contact_verified(p.id)
 and r.secured_at is not null and r.password_changed_at is not null and r.reset_link_sent_at is not null and a.last_sign_in_at>r.password_changed_at
 and lower(a.email)=lower(p.support_context->>'recovery_contact') and (r.mfa_reset_at is null or exists(select 1 from auth.mfa_factors f where f.user_id=a.id and f.status='verified' and f.created_at>=r.mfa_reset_at)));
$$;
create function public.refresh_recovery_progress(p_case uuid) returns void language plpgsql security definer set search_path=public as $$
declare r account_recovery_requests; p platform_reports; ready boolean; state jsonb;
begin
 select * into r from account_recovery_requests where admin_case_id=p_case; if not found then return; end if;
 select * into p from platform_reports where id=p_case; ready:=recovery_access_complete(p_case);
 state:=jsonb_build_object('identity_verified',coalesce(p.support_context->>'identity_verified'='true',false),'contact_verified',recovery_contact_verified(p_case),'secured',r.secured_at is not null,'reset_link_sent',r.reset_link_sent_at is not null,'password_changed',r.password_changed_at is not null,'access_restored',ready,'mfa_reenrollment_required',r.mfa_reset_at is not null);
 update platform_reports set support_context=support_context||jsonb_build_object('recovery_state',state,'recovery_request_id',r.id) where id=p_case and support_context->'recovery_state' is distinct from state;
 if ready and r.restored_at is null then update account_recovery_requests set restored_at=now() where id=r.id; end if;
end; $$;
create function public.bridge_recovery_request() returns trigger language plpgsql security definer set search_path=public as $$
declare c uuid;
begin
 if new.admin_case_id is not null then perform refresh_recovery_progress(new.admin_case_id); return new; end if;
 insert into platform_reports(subject_user_id,category,summary,description,source,priority,support_context)
 values(new.user_id,case when new.request_type='account_compromised' then 'account_takeover' else 'lost_access' end,'Account recovery',coalesce(nullif(new.details,''),'Account access help requested.'),'admin_user_security',coalesce(new.priority,'normal'),jsonb_build_object('admin_user_security',true,'recovery_request_id',new.id,'recovery_contact',coalesce(new.contact_email,''),'identity_verified',false,'contact_verified',false)) returning id into c;
 update account_recovery_requests set admin_case_id=c where id=new.id;
 perform refresh_recovery_progress(c); return new;
end; $$;
create trigger bridge_recovery_request after insert on public.account_recovery_requests for each row execute function public.bridge_recovery_request();
create function public.bridge_admin_recovery_case() returns trigger language plpgsql security definer set search_path=public as $$
begin
 if new.subject_user_id is not null and new.category in ('lost_access','account_takeover') and (new.source='admin_user_security' or new.support_context->>'admin_user_security'='true') and not(new.support_context ? 'recovery_request_id') then
 insert into account_recovery_requests(user_id,request_type,status,priority,risk_level,contact_email,details,admin_case_id) values(new.subject_user_id,case when new.category='account_takeover' then 'account_compromised' else 'lost_access' end,'reviewing',new.priority,'unknown',nullif(new.support_context->>'recovery_contact',''),new.description,new.id) on conflict(admin_case_id) where admin_case_id is not null do nothing;
 end if; return new;
end; $$;
create trigger bridge_admin_recovery_case after insert on public.platform_reports for each row execute function public.bridge_admin_recovery_case();

create function public.admin_recovery_contact_begin(p_case uuid,p_request uuid,p_digest text,p_reason text) returns jsonb language plpgsql security definer set search_path=public as $$
declare p platform_reports; email text;
begin
 perform platform_admin_require_permission('admin.recovery.manage'); perform platform_admin_require_permission('admin.users.read_sensitive'); perform platform_admin_require_permission('admin.users.auth.manage'); perform platform_admin_normalize_reason(p_reason);
 select * into p from platform_reports where id=p_case for update;
 if p.id is null or p.subject_user_id=current_public_user_id() or p.category not in ('lost_access','account_takeover') or p.status not in ('new','under_review','action_required') or not(p.source='admin_user_security' or p.support_context->>'admin_user_security'='true') or not exists(select 1 from users where id=p.subject_user_id and status not in ('deleted','pending_deletion')) then raise exception 'Open an eligible recovery case for this user.'; end if;
 email:=lower(btrim(p.support_context->>'recovery_contact'));
 if email is null or email !~ '^[^[:space:]@<>]+@[^[:space:]@<>]+\.[^[:space:]@<>]+$' then raise exception 'Save a valid recovery contact email first.'; end if;
 if exists(select 1 from recovery_contact_challenges where id=p_request) then raise exception 'This verification request was already recorded. Review delivery before sending again.'; end if;
 if exists(select 1 from recovery_contact_challenges where case_id=p_case and created_at>now()-interval '60 seconds') then raise exception 'Wait 60 seconds before sending another verification link.'; end if;
 insert into recovery_contact_challenges(id,case_id,user_id,email,token_digest,expires_at) values(p_request,p_case,p.subject_user_id,email,p_digest,now()+interval '30 minutes');
 insert into platform_admin_audit_logs(actor_user_id,action,target_type,target_id,reason,metadata) values(current_public_user_id(),'recovery.contact_verification.requested','platform_report',p.id,p_reason,jsonb_build_object('request_id',p_request));
 return jsonb_build_object('email',email,'user_id',p.subject_user_id);
end; $$;
create function public.confirm_recovery_contact(p_digest text) returns boolean language plpgsql security definer set search_path=public as $$
declare c recovery_contact_challenges; p platform_reports;
begin
 select * into c from recovery_contact_challenges where token_digest=p_digest for update;
 if not found or c.verified_at is not null or c.revoked_at is not null or c.expires_at<=now() then return false; end if;
 select * into p from platform_reports where id=c.case_id for update;
 if not exists(select 1 from users where id=c.user_id and status not in ('deleted','pending_deletion')) or p.subject_user_id<>c.user_id or p.status not in ('new','under_review','action_required') or lower(btrim(p.support_context->>'recovery_contact')) is distinct from c.email then return false; end if;
 update recovery_contact_challenges set verified_at=now() where id=c.id;
 update platform_reports set support_context=support_context||jsonb_build_object('contact_verified',true),updated_at=now() where id=p.id;
 perform refresh_recovery_progress(p.id);
 return true;
end; $$;
create function public.admin_secure_recovery(p_case uuid,p_reason text) returns void language plpgsql security definer set search_path=public as $$
declare p platform_reports;
begin
 perform platform_admin_require_permission('admin.recovery.manage'); perform platform_admin_normalize_reason(p_reason);
 select * into p from platform_reports where id=p_case for update;
 if p.id is null or p.subject_user_id=current_public_user_id() or p.status not in ('new','under_review','action_required') or not exists(select 1 from account_recovery_requests where admin_case_id=p_case) then raise exception 'Verify the account owner in an open recovery case first.'; end if;
 perform admin_user_revoke_sessions(p.subject_user_id,null,p_reason);
 update account_recovery_requests set secured_at=now() where admin_case_id=p_case;
 perform refresh_recovery_progress(p_case);
end; $$;
create function public.guard_recovery_identity_job() returns trigger language plpgsql security definer set search_path=public as $$
declare c uuid; r account_recovery_requests;
begin
 if new.operation in ('email_change','verify_email','reset_mfa') or (new.operation='password_reset' and nullif(new.payload->>'case_id','') is not null) then
 c:=nullif(new.payload->>'case_id','')::uuid;
 select * into r from account_recovery_requests where admin_case_id=c and user_id=new.user_id;
 if r.id is null or r.status in ('denied','cancelled','resolved') or not recovery_contact_verified(c) or r.secured_at is null then raise exception 'Verify the recovery email by link and secure the account before changing authentication.'; end if;
 end if;
 -- A normal password reset must never target a different authentication identity.
 if new.operation='password_reset' and new.email is not null and lower(new.email) is distinct from lower((select email from users where id=new.user_id)) then raise exception 'Password reset must use this account email.'; end if;
 return new;
end; $$;
create trigger guard_recovery_identity_job before insert on public.admin_user_identity_jobs for each row execute function public.guard_recovery_identity_job();
create function public.track_recovery_identity_job() returns trigger language plpgsql security definer set search_path=public as $$
declare c uuid;
begin
 c:=nullif(new.payload->>'case_id','')::uuid;
 if c is not null and new.status='accepted' and old.status is distinct from new.status then
 update account_recovery_requests set reset_link_sent_at=case when new.operation='password_reset' then now() else reset_link_sent_at end,mfa_reset_at=case when new.operation='reset_mfa' then new.created_at else mfa_reset_at end,restored_at=null where admin_case_id=c and user_id=new.user_id;
 perform refresh_recovery_progress(c);
 end if; return new;
end; $$;
create trigger track_recovery_identity_job after update on public.admin_user_identity_jobs for each row execute function public.track_recovery_identity_job();
create function public.record_recovery_password_change(p_auth_id uuid) returns void language plpgsql security definer set search_path=public as $$
declare c record;
begin
 delete from auth.refresh_tokens where session_id in(select id from auth.sessions where user_id=p_auth_id);
 delete from auth.sessions where user_id=p_auth_id;
 for c in select r.id,r.admin_case_id,r.user_id from account_recovery_requests r join platform_reports p on p.id=r.admin_case_id join users u on u.id=r.user_id join auth.users a on a.id=u.auth_user_id where a.id=p_auth_id and r.reset_link_sent_at is not null and r.status not in ('denied','cancelled','resolved') and lower(a.email)=lower(p.support_context->>'recovery_contact') and recovery_contact_verified(p.id) loop
 update account_recovery_requests set password_changed_at=now(),restored_at=null where id=c.id;
 perform refresh_recovery_progress(c.admin_case_id);
 end loop;
end; $$;
create function public.refresh_recovery_after_auth() returns trigger language plpgsql security definer set search_path=public as $$
declare c record; target uuid;
begin
 if tg_table_name='users' then target:=new.id; else target:=new.user_id; end if;
 for c in select r.admin_case_id from account_recovery_requests r join users u on u.id=r.user_id where u.auth_user_id=target and r.password_changed_at is not null and r.status not in ('resolved','denied','cancelled') loop perform refresh_recovery_progress(c.admin_case_id); end loop;
 return new;
end; $$;
create trigger refresh_recovery_after_signin after update of last_sign_in_at on auth.users for each row execute function public.refresh_recovery_after_auth();
create trigger refresh_recovery_after_mfa after update of status on auth.mfa_factors for each row execute function public.refresh_recovery_after_auth();
create function public.guard_recovery_case_close() returns trigger language plpgsql security definer set search_path=public as $$
declare r account_recovery_requests;
begin
 select * into r from account_recovery_requests where admin_case_id=new.id;
 if found and new.status in ('resolved','closed') and old.status is distinct from new.status and r.status not in ('denied','cancelled') and not recovery_access_complete(new.id) then raise exception 'Recovery is not complete. Confirm a new password, successful sign-in and MFA re-enrollment when required, or deny the recovery with a reason.'; end if;
 return new;
end; $$;
create trigger guard_recovery_case_close before update of status on public.platform_reports for each row execute function public.guard_recovery_case_close();
create function public.guard_recovery_request_status() returns trigger language plpgsql security definer set search_path=public as $$
begin
 if new.status is distinct from old.status and new.status in ('denied','cancelled') then update recovery_contact_challenges set revoked_at=now() where case_id=new.admin_case_id and revoked_at is null; end if;
 if new.status is distinct from old.status and new.status in ('approved','resolved') then
 if new.admin_case_id is null or not recovery_contact_verified(new.admin_case_id) or not exists(select 1 from platform_reports where id=new.admin_case_id and support_context->>'identity_verified'='true' and length(btrim(coalesce(support_context->>'verification_evidence','')))>=10) then raise exception 'Verify the owner and recovery email in the linked Users case first.'; end if;
 if new.status='resolved' and not recovery_access_complete(new.admin_case_id) then raise exception 'The customer has not completed secure account recovery.'; end if;
 end if; return new;
end; $$;
create trigger guard_recovery_request_status before update of status on public.account_recovery_requests for each row execute function public.guard_recovery_request_status();
create function public.admin_deny_recovery(p_case uuid,p_reason text) returns void language plpgsql security definer set search_path=public as $$
begin
 perform platform_admin_require_permission('admin.recovery.manage'); perform platform_admin_require_permission('admin.reports.resolve'); perform platform_admin_normalize_reason(p_reason);
 if not exists(select 1 from platform_reports where id=p_case and subject_user_id<>current_public_user_id() and status in ('new','under_review','action_required')) then raise exception 'Open recovery case required.'; end if;
 update recovery_contact_challenges set revoked_at=now() where case_id=p_case and revoked_at is null;
 update account_recovery_requests set status='denied',resolution_summary=p_reason where admin_case_id=p_case;
 if not found then raise exception 'Recovery request not found.'; end if;
 update platform_reports set status='closed',resolution=p_reason,closed_at=now(),updated_at=now() where id=p_case;
 insert into platform_admin_audit_logs(actor_user_id,action,target_type,target_id,reason) values(current_public_user_id(),'recovery.denied','platform_report',p_case,p_reason);
end; $$;
create function public.admin_link_support_recovery(p_user uuid,p_thread uuid,p_reason text) returns uuid language plpgsql security definer set search_path=public as $$
declare c uuid;
begin
 perform platform_admin_require_permission('admin.recovery.manage'); perform platform_admin_require_permission('admin.users.read_sensitive'); perform platform_admin_require_permission('admin.inbox.manage'); perform platform_admin_require_permission('admin.reports.update'); perform platform_admin_normalize_reason(p_reason);
 if p_user=current_public_user_id() or not exists(select 1 from users where id=p_user and status not in ('deleted','pending_deletion')) then raise exception 'Eligible user required.'; end if;
 select platform_report_id into c from support_inbox_threads where id=p_thread for update;
 if c is null or exists(select 1 from platform_reports where id=c and (status in ('resolved','closed') or (subject_user_id is not null and subject_user_id<>p_user))) then raise exception 'Open support request unavailable or linked to another user.'; end if;
 update platform_reports set subject_user_id=p_user,category='lost_access',support_context=support_context||jsonb_build_object('admin_user_security',true),updated_at=now() where id=c;
 insert into account_recovery_requests(user_id,request_type,status,priority,risk_level,admin_case_id,details) values(p_user,'lost_access','reviewing','normal','unknown',c,'Linked from guest support by an authorized admin.') on conflict(admin_case_id) where admin_case_id is not null do nothing;
 insert into platform_admin_audit_logs(actor_user_id,action,target_type,target_id,reason) values(current_public_user_id(),'recovery.support_linked','platform_report',c,p_reason);
 return c;
end; $$;
-- Expose only permission-checked admin calls. Public confirmation/password tracking use the trusted server.
revoke all on function public.recovery_contact_verified(uuid),public.recovery_access_complete(uuid),public.refresh_recovery_progress(uuid),public.bridge_recovery_request(),public.bridge_admin_recovery_case(),public.guard_recovery_identity_job(),public.track_recovery_identity_job(),public.refresh_recovery_after_auth(),public.guard_recovery_case_close(),public.guard_recovery_request_status(),public.admin_recovery_contact_begin(uuid,uuid,text,text),public.confirm_recovery_contact(text),public.admin_secure_recovery(uuid,text),public.record_recovery_password_change(uuid),public.admin_deny_recovery(uuid,text),public.admin_link_support_recovery(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.admin_recovery_contact_begin(uuid,uuid,text,text),public.admin_secure_recovery(uuid,text),public.admin_deny_recovery(uuid,text),public.admin_link_support_recovery(uuid,uuid,text) to authenticated;
grant execute on function public.confirm_recovery_contact(text),public.record_recovery_password_change(uuid) to service_role;
-- Backfill open requests without altering existing verification decisions or account credentials.
do $$ declare r record; c uuid; begin for r in select * from account_recovery_requests where admin_case_id is null and status not in ('resolved','denied','cancelled') loop
 insert into platform_reports(subject_user_id,category,summary,description,source,priority,support_context) values(r.user_id,case when r.request_type='account_compromised' then 'account_takeover' else 'lost_access' end,'Account recovery',coalesce(nullif(r.details,''),'Account access help requested.'),'admin_user_security',coalesce(r.priority,'normal'),jsonb_build_object('admin_user_security',true,'recovery_request_id',r.id,'recovery_contact',coalesce(r.contact_email,''),'identity_verified',false,'contact_verified',false)) returning id into c;
 update account_recovery_requests set admin_case_id=c where id=r.id; perform refresh_recovery_progress(c);
 end loop; end; $$;

create function public.sync_recovery_case_progress() returns trigger language plpgsql security definer set search_path=public as $$
begin
 if new.status in ('resolved','closed') and old.status is distinct from new.status then
 update account_recovery_requests set status='resolved',resolution_summary=new.resolution,resolved_at=now() where admin_case_id=new.id and status not in ('denied','cancelled','resolved');
 end if;
 if new.support_context->>'recovery_contact' is distinct from old.support_context->>'recovery_contact' then
 update recovery_contact_challenges set revoked_at=now() where case_id=new.id and revoked_at is null;
 update account_recovery_requests set contact_email=nullif(new.support_context->>'recovery_contact',''),reset_link_sent_at=null,password_changed_at=null,restored_at=null where admin_case_id=new.id;
 end if;
 if new.support_context->>'identity_verified' is distinct from old.support_context->>'identity_verified' or new.support_context->>'contact_verified' is distinct from old.support_context->>'contact_verified' or new.support_context->>'verification_evidence' is distinct from old.support_context->>'verification_evidence' or new.support_context->>'recovery_contact' is distinct from old.support_context->>'recovery_contact' then perform refresh_recovery_progress(new.id); end if;
 return new;
end; $$;
create trigger sync_recovery_case_progress after update on public.platform_reports for each row execute function public.sync_recovery_case_progress();
revoke all on function public.sync_recovery_case_progress() from public,anon,authenticated;
create or replace function public.account_recovery_support_secure_account(p_request_id uuid,p_note text) returns jsonb language plpgsql security definer set search_path=public as $$
declare c uuid;
begin
 if not public.account_recovery_current_user_can_manage_support() then raise exception 'Recovery support permission required.'; end if;
 select admin_case_id into c from account_recovery_requests where id=p_request_id;
 if c is null then raise exception 'Linked recovery case unavailable.'; end if;
 perform admin_secure_recovery(c,coalesce(nullif(btrim(p_note),''),'Secure account during recovery review'));
 return jsonb_build_object('secured',true);
end; $$;

create function public.recovery_reset_session_valid(p_auth_id uuid,p_session_id uuid) returns boolean language sql stable security definer set search_path=public as $$
 select exists(select 1 from auth.sessions where user_id=p_auth_id and id=p_session_id);
$$;
revoke all on function public.recovery_reset_session_valid(uuid,uuid) from public,anon,authenticated;
grant execute on function public.recovery_reset_session_valid(uuid,uuid) to service_role;

commit;
