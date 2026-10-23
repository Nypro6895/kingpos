begin;

-- Read only the context needed for a report queue, in bounded batches. No contact
-- addresses, private notes, or storage URLs are exposed by this endpoint.
create function public.get_admin_report_previews(p_report_ids uuid[]) returns jsonb
language plpgsql stable security definer set search_path=public as $$
begin
 perform platform_admin_require_permission('admin.reports.read');
 if coalesce(cardinality(p_report_ids),0)>200 then raise exception 'Invalid report batch size.'; end if;
 return coalesce((select jsonb_object_agg(r.id,jsonb_build_object(
  'description',r.description,'context_path',r.support_context->>'path','report_number',r.report_number,
  'assigned_name',owner_user.display_name,'assigned_membership_id',r.assigned_membership_id,
  'reporter_name',u.display_name,'guest_name',g.customer_name,'inbox_thread_id',g.id,
  'customer_message',cm.body,'customer_message_at',cm.created_at,
  'support_message',sm.body,'support_message_at',sm.created_at,'support_message_kind',sm.message_kind,
  'resolved_by',resolver.display_name,'closed_by',closer.display_name,
  'review',case when c.id is not null then jsonb_build_object('kind','post_report','id',c.id,'status',c.status,'origin',c.origin,'reason',c.reason,'title',c.content_snapshot->>'title','caption',c.content_snapshot->>'caption','source_type',c.source_type,'source_id',c.source_id)
    when l.kind='claim' then jsonb_build_object('kind','claim','id',l.request_id,'status',claim.status) else null end
 )) from platform_reports r
 left join users u on u.id=r.reporter_user_id
 left join platform_admin_memberships membership on membership.id=r.assigned_membership_id
 left join users owner_user on owner_user.id=membership.user_id
 left join users resolver on resolver.id=r.resolved_by_user_id
 left join users closer on closer.id=r.closed_by_user_id
 left join support_inbox_threads g on g.platform_report_id=r.id
 left join review_support_links l on l.report_id=r.id
 left join business_claim_requests claim on l.kind='claim' and claim.id=l.request_id
 left join lateral (select s.* from post_safety_cases s where (l.kind='post_report' and s.id=l.request_id) or s.platform_report_id=r.id order by s.created_at desc,s.id limit 1) c on true
 left join lateral (select m.body,m.created_at from support_case_messages m where m.report_id=r.id and m.sender='user' and m.message_kind='message' order by m.created_at desc,m.id desc limit 1) cm on true
 left join lateral (select m.body,m.created_at,m.message_kind from support_case_messages m where m.report_id=r.id and m.sender='support' and m.message_kind<>'receipt' order by m.created_at desc,m.id desc limit 1) sm on true
 where r.id=any(p_report_ids)), '{}'::jsonb);
end $$;
revoke all on function public.get_admin_report_previews(uuid[]) from public,anon;
grant execute on function public.get_admin_report_previews(uuid[]) to authenticated;

-- A generic support resolution must not declare a pending linked review complete.
-- The existing review triggers still work: their underlying decision is written
-- before they synchronize the support case.
create function public.guard_linked_report_resolution() returns trigger
language plpgsql security definer set search_path=public as $$
begin
 if new.status not in ('resolved','closed') or new.status is not distinct from old.status then return new; end if;
 if exists(select 1 from post_safety_cases c left join review_support_links l on l.kind='post_report' and l.request_id=c.id
   where (c.platform_report_id=new.id or l.report_id=new.id) and c.status='pending') then
  raise exception 'This report must be decided in the content review before it can be resolved or closed.';
 end if;
 if exists(select 1 from review_support_links l join business_claim_requests c on c.id=l.request_id and l.kind='claim'
   where l.report_id=new.id and c.status in ('otp_pending','waiting','needs_info')) then
  raise exception 'This report must be decided in the ownership review before it can be resolved or closed.';
 end if;
 return new;
end $$;
revoke all on function public.guard_linked_report_resolution() from public,anon,authenticated;
create trigger guard_linked_report_resolution before update of status on public.platform_reports for each row execute function public.guard_linked_report_resolution();
commit;
