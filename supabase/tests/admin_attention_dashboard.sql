-- Rollback-only verification; leaves accounts, salons and attention records unchanged.
begin;
do $$
declare actor_auth uuid; target uuid; overview jsonb; before_count integer; after_count integer;
begin
 select u.auth_user_id into actor_auth from public.users u join public.platform_admin_memberships m on m.user_id=u.id
 join public.platform_admin_roles r on r.id=m.role_id where r.slug='platform_owner' and m.status='active' and u.status='active' and u.auth_user_id is not null limit 1;
 if actor_auth is null then raise exception 'An active platform owner is required for this integration check.'; end if;
 perform set_config('request.jwt.claim.sub',actor_auth::text,true);
 perform set_config('request.jwt.claims',jsonb_build_object('sub',actor_auth,'role','authenticated')::text,true);
 overview:=public.get_platform_admin_new_accounts();
 if jsonb_array_length(overview->'users')>3 or jsonb_array_length(overview->'salons')>3 then raise exception 'Recent lists exceed three records.'; end if;
 if (overview->>'users_today')::integer<>(select count(*) from public.users where (created_at at time zone 'America/Chicago')::date=(now() at time zone 'America/Chicago')::date) then raise exception 'Today account count is incorrect.'; end if;
 select id into target from public.users order by created_at desc limit 1;
 select count(*) into before_count from public.platform_admin_audit_logs where target_id=target and action='attention.marked';
 perform public.set_platform_admin_attention('user',target,true,'Rollback-only attention verification');
 if not exists(select 1 from public.platform_admin_attention where target_type='user' and target_id=target) then raise exception 'Mark was not persisted.'; end if;
 perform public.set_platform_admin_attention('user',target,true,'Rollback-only idempotency verification');
 if (select count(*) from public.platform_admin_attention where target_type='user' and target_id=target)<>1 then raise exception 'Duplicate mark created.'; end if;
 if (public.list_platform_admin_attention(1,'user')->>'total')::integer<1 then raise exception 'Attention list omitted the mark.'; end if;
 perform public.set_platform_admin_attention('user',target,false,'Rollback-only removal verification');
 if exists(select 1 from public.platform_admin_attention where target_type='user' and target_id=target) then raise exception 'Unmark did not remove the mark.'; end if;
 select count(*) into after_count from public.platform_admin_audit_logs where target_id=target and action='attention.marked';
 if after_count<>before_count+2 then raise exception 'Attention audit events missing.'; end if;
 perform public.get_platform_admin_account_activity(target);
 perform set_config('request.jwt.claim.sub','',true);
 perform set_config('request.jwt.claims','{}',true);
 begin perform public.get_platform_admin_new_accounts(); raise exception 'Unauthenticated read accepted'; exception when others then if SQLERRM='Unauthenticated read accepted' then raise; end if; end;
 begin perform public.set_platform_admin_attention('user',target,true,'Must be rejected'); raise exception 'Unauthenticated mutation accepted'; exception when others then if SQLERRM='Unauthenticated mutation accepted' then raise; end if; end;
end;$$;
rollback;
