begin;
-- Classification belongs to the required case-detail response, not to an
-- optional evidence/conversation transport that may fail independently.
do $patch$ declare d text; marker text:='''source'', report_row.source,';begin
 d:=pg_get_functiondef('public.get_platform_admin_report_detail(uuid)'::regprocedure);
 if strpos(d,'''social_content_report''')=0 then
  if strpos(d,marker)=0 then raise exception 'Review admin case-detail shape before adding report classification.';end if;
  execute replace(d,marker,marker||E'\n      ''social_content_report'', coalesce(report_row.source=''user_support'' and report_row.support_context->>''module''=''social_content_report'',false),');
 end if;
end $patch$;
-- Case-bound lookup only: never accept an arbitrary customer/salon/content ID
-- from the moderator client, and never impersonate the customer's workspace.
create or replace function public.get_admin_social_report_evidence(p_report_id uuid) returns jsonb
language plpgsql stable security definer set search_path=public as $$
declare report public.platform_reports%rowtype; kind text; target uuid;
 content_id uuid; parent_id uuid; salon uuid; body text;
begin
 perform public.platform_admin_require_permission('admin.reports.read');
 -- Reuse the existing case access boundary (including any future case scoping).
 perform public.get_platform_admin_report_detail(p_report_id);
 select * into report from public.platform_reports where id=p_report_id;
 if report.id is null then raise exception 'Report not found.'; end if;
 if report.source is distinct from 'user_support' or report.support_context->>'module' is distinct from 'social_content_report' then return null; end if;
 if report.reporter_user_id is null or report.created_by_user_id is distinct from report.reporter_user_id then
  return jsonb_build_object('status','unavailable'); end if;
 kind:=report.support_context->>'content_type';
 if coalesce(report.support_context->>'content_id','') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
  return jsonb_build_object('status','unavailable'); end if;
 target:=(report.support_context->>'content_id')::uuid;
 if kind='comment' then
  select c.id,coalesce(c.look_id,c.update_id,c.beauty_post_id),c.salon_id,c.body into content_id,parent_id,salon,body
  from salon_profile_comments c where c.id=target and c.status='published'
   and public.post_comment_target_is_public(c.look_id,c.update_id,c.beauty_post_id,c.salon_id);
 elsif kind in ('review','experience','review_reply','experience_reply') then
  if kind='review' then
   select r.id,r.id,r.salon_id,r.body into content_id,parent_id,salon,body from salon_profile_reviews r
   where r.id=target and r.moderation_status='visible' and public.salon_profile_public_salon_exists(r.salon_id);
  elsif kind='experience' then
   select e.id,e.id,e.salon_id,e.body into content_id,parent_id,salon,body from customer_visit_experiences e
   where e.id=target and public.salon_profile_public_salon_exists(e.salon_id);
  elsif kind='review_reply' then
   select r.id,e.id,e.salon_id,r.body into content_id,parent_id,salon,body from salon_profile_review_replies r
   join salon_profile_reviews e on e.id=r.review_id where r.id=target and r.moderation_status='visible'
    and e.moderation_status='visible' and public.salon_profile_public_salon_exists(e.salon_id);
  else
   select r.id,e.id,e.salon_id,r.body into content_id,parent_id,salon,body from visit_experience_replies r
   join customer_visit_experiences e on e.id=r.experience_id where r.id=target and public.salon_profile_public_salon_exists(e.salon_id);
  end if;
 elsif kind='own_review_reply' then
  -- Legacy reports reference the parent review, not the reply. Resolve the same
  -- first visible reply as the customer's history, constrained to the reporter.
  select r.id,e.id,e.salon_id,r.body into content_id,parent_id,salon,body from salon_profile_reviews e
  join salon_profile_review_replies r on r.review_id=e.id where e.id=target and e.author_user_id=report.reporter_user_id
   and e.moderation_status='visible' and r.moderation_status='visible' order by r.created_at,r.id limit 1;
 elsif kind='own_experience_reply' then
  select r.id,e.id,e.salon_id,r.body into content_id,parent_id,salon,body from customer_visit_experiences e
  join visit_experience_replies r on r.experience_id=e.id where e.id=target and e.author_user_id=report.reporter_user_id;
 end if;
 if content_id is null then return jsonb_build_object('status','unavailable'); end if;
 return jsonb_build_object('status','available','kind',kind,'contentId',content_id,'parentId',parent_id,'salonId',salon,'body',body);
end $$;
revoke all on function public.get_admin_social_report_evidence(uuid) from public,anon,service_role;
grant execute on function public.get_admin_social_report_evidence(uuid) to authenticated;
notify pgrst,'reload schema';
commit;
