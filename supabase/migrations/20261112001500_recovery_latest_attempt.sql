begin;
-- Completion belongs to the latest delivered reset and the latest containment.
create or replace function public.recovery_access_complete(p_case uuid) returns boolean language sql stable security definer set search_path=public as $$
 select exists(select 1 from account_recovery_requests r join platform_reports p on p.id=r.admin_case_id join users u on u.id=r.user_id join auth.users a on a.id=u.auth_user_id
 where p.id=p_case and u.status='active' and p.support_context->>'identity_verified'='true' and length(btrim(coalesce(p.support_context->>'verification_evidence','')))>=10 and recovery_contact_verified(p.id)
 and r.secured_at is not null and r.password_changed_at is not null and r.reset_link_sent_at is not null and r.password_changed_at>=r.reset_link_sent_at and a.last_sign_in_at>greatest(r.password_changed_at,r.secured_at,r.mfa_reset_at)
 and lower(a.email)=lower(p.support_context->>'recovery_contact') and (r.mfa_reset_at is null or exists(select 1 from auth.mfa_factors f where f.user_id=a.id and f.status='verified' and f.created_at>=r.mfa_reset_at)));
$$;
create or replace function public.track_recovery_identity_job() returns trigger language plpgsql security definer set search_path=public as $$
declare c uuid;
begin
 c:=nullif(new.payload->>'case_id','')::uuid;
 if c is not null and new.status='accepted' and old.status is distinct from new.status then
 update account_recovery_requests set reset_link_sent_at=case when new.operation='password_reset' then now() else reset_link_sent_at end,mfa_reset_at=case when new.operation='reset_mfa' then new.created_at else mfa_reset_at end,password_changed_at=case when new.operation='password_reset' then null else password_changed_at end,restored_at=null where admin_case_id=c and user_id=new.user_id;
 perform refresh_recovery_progress(c);
 end if; return new;
end; $$;
commit;
