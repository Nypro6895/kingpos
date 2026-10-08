begin;
do $$
declare owner_auth uuid; owner_id uuid; target uuid; saved jsonb; updated_stamp timestamptz; result jsonb;
begin
 select u.auth_user_id,u.id into owner_auth,owner_id from users u join platform_admin_memberships m on m.user_id=u.id join platform_admin_roles r on r.id=m.role_id
 where r.slug='platform_owner' and m.status='active' and u.status='active' and u.auth_user_id is not null limit 1;
 if owner_auth is null then raise exception 'Active platform owner required for verification.'; end if;
 perform set_config('request.jwt.claim.sub',owner_auth::text,true);
 perform set_config('request.jwt.claims',jsonb_build_object('sub',owner_auth,'role','authenticated')::text,true);
 select id into target from users order by created_at desc limit 1;
 saved:=save_platform_admin_followup('user',target,'Rollback-only follow-up check',owner_id,now()-interval '1 hour',null);
 if saved->>'assigned_user_id'<>owner_id::text or saved->>'due_at' is null then raise exception 'Assignment or due date not saved.'; end if;
 updated_stamp:=(saved->>'updated_at')::timestamptz;
 result:=get_platform_admin_dashboard_followups();
 if (result->>'overdue')::integer<1 or (result->>'due_today')::integer<1 then raise exception 'Overdue follow-up missing.'; end if;
 if jsonb_array_length(result->'items')>3 then raise exception 'Dashboard follow-up limit exceeded.'; end if;
 perform save_platform_admin_followup('user',target,'Rollback-only updated reason',owner_id,now()+interval '3 days',updated_stamp);
 begin
 perform save_platform_admin_followup('user',target,'Must reject stale edits',owner_id,now(),updated_stamp);
 raise exception 'Stale update accepted'; exception when others then if SQLERRM='Stale update accepted' then raise; end if; end;
 if not exists(select 1 from platform_admin_audit_logs where target_id=target and action='followup.saved') then raise exception 'Follow-up audit missing.'; end if;
 perform get_platform_admin_delivery_health();
 perform get_platform_admin_followup_assignees();
 perform set_platform_admin_attention('user',target,false,'Rollback-only review completed');
 if get_platform_admin_followup('user',target) is not null then raise exception 'Reviewed follow-up still active.'; end if;
 perform set_config('request.jwt.claim.sub','',true); perform set_config('request.jwt.claims','{}',true);
 begin perform save_platform_admin_followup('user',target,'Unauthenticated request',null,null,null); raise exception 'Unauthenticated request accepted'; exception when others then if SQLERRM='Unauthenticated request accepted' then raise; end if; end;
end;$$;
rollback;
