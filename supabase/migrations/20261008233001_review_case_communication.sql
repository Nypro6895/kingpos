begin;

-- The link is trusted database state. Browser-supplied support_context never grants access.
create table public.review_support_links (
 kind text not null check(kind in ('claim','post_report')),
 request_id uuid not null,
 report_id uuid not null unique references public.platform_reports(id) on delete cascade,
 primary key(kind,request_id)
);
alter table public.review_support_links enable row level security;
revoke all on public.review_support_links from public,anon,authenticated;
grant all on public.review_support_links to service_role;
alter table public.support_case_messages add column message_kind text not null default 'message'
 check(message_kind in ('message','decision','receipt','information'));
alter table public.support_case_messages add column client_request_id uuid unique;
alter table public.post_safety_cases add column public_response text;
alter table public.post_safety_decisions add column client_request_id uuid unique;
alter table public.post_safety_decisions add column client_action text, add column client_public_message text;
alter table public.business_claim_requests drop constraint business_claim_requests_status_check;
alter table public.business_claim_requests add constraint business_claim_requests_status_check
 check(status in ('otp_pending','waiting','needs_info','approved','rejected','expired'));
drop index public.business_claim_one_open_per_user;
create unique index business_claim_one_open_per_user on public.business_claim_requests(salon_id,applicant_user_id)
 where status in ('otp_pending','waiting','needs_info');

-- Preserve the installed ownership/security implementation, including entity-role upgrades.
-- Expand only its open-request predicates; phone confirmation must never bypass manual review.
do $$declare sig text; definition text; begin
 foreach sig in array array['complete_business_claim(uuid,uuid,text)','begin_business_claim(uuid,uuid,text)',
 'confirm_business_claim(uuid,uuid,text)','request_business_claim_support(uuid,text,jsonb)',
 'attach_business_claim_documents(uuid,uuid,jsonb)'] loop
 definition:=pg_get_functiondef(('public.'||sig)::regprocedure);
 definition:=replace(definition,'''otp_pending'',''waiting''','''otp_pending'',''waiting'',''needs_info''');
 if sig='begin_business_claim(uuid,uuid,text)' then
  definition:=replace(definition,'if r.status=''waiting'' then','if r.status in (''waiting'',''needs_info'') then');
 elsif sig='request_business_claim_support(uuid,text,jsonb)' then
  definition:=replace(definition,'if r.status=''waiting'' then','if r.status in (''waiting'',''needs_info'') then');
  definition:=replace(definition,'set support_reason=btrim(p_reason)','set status=''waiting'',support_reason=btrim(p_reason)');
 elsif sig='attach_business_claim_documents(uuid,uuid,jsonb)' then
  definition:=replace(definition,'r.status<>''waiting''','r.status not in (''waiting'',''needs_info'')');
 end if;
 execute definition;
 end loop;
end $$;

create function public.ensure_review_support_case(p_kind text,p_request uuid) returns uuid
language plpgsql security definer set search_path=public as $$
declare result uuid; recipient uuid; title text; category_value text; related_path text; initial_body text;
begin
 if p_kind not in ('claim','post_report') then raise exception 'Invalid review type.'; end if;
 perform pg_advisory_xact_lock(hashtextextended('review-support:'||p_kind||':'||p_request,0));
 select report_id into result from review_support_links where kind=p_kind and request_id=p_request;
 if found then return result; end if;
 if p_kind='claim' then
  select c.applicant_user_id,left('Ownership claim: '||l.name,200),'salon_access','/claim/'||c.salon_id,
   coalesce(c.support_reason,'Salon phone confirmation submitted for ownership review.')
  into recipient,title,category_value,related_path,initial_body from business_claim_requests c join locations l on l.id=c.salon_id where c.id=p_request;
 else
  select c.reporter_user_id,'Content report','review_dispute','/support',
   'Reported issue: '||replace(c.reason,'_',' ')
  into recipient,title,category_value,related_path,initial_body from post_safety_cases c where c.id=p_request and c.origin='user';
 end if;
 -- Anonymous reporters have no authenticated inbox; no account is fabricated for them.
 if recipient is null then return null; end if;
 insert into platform_reports(category,summary,description,source,reporter_user_id,status,support_context)
 values(category_value,title,initial_body,'user_support',recipient,'under_review',jsonb_build_object('path',related_path)) returning id into result;
 insert into review_support_links(kind,request_id,report_id) values(p_kind,p_request,result);
 insert into support_case_messages(report_id,actor_user_id,sender,body,message_kind)
 values(result,recipient,'user',initial_body,'receipt');
 return result;
end $$;
revoke all on function public.ensure_review_support_case(text,uuid) from public,anon,authenticated;

create function public.review_support_message(p_report uuid,p_body text,p_kind text) returns void
language plpgsql security definer set search_path=public as $$
begin
 if p_report is null then return; end if;
 insert into support_case_messages(report_id,actor_user_id,sender,body,message_kind)
 values(p_report,current_public_user_id(),'support',p_body,p_kind);
end $$;
revoke all on function public.review_support_message(uuid,text,text) from public,anon,authenticated;

create function public.sync_claim_communication() returns trigger
language plpgsql security definer set search_path=public as $$
declare report uuid; body text; report_status text;
begin
 if tg_op='UPDATE' and new.status=old.status then
  if new.support_reason is distinct from old.support_reason and nullif(btrim(new.support_reason),'') is not null then
   report:=ensure_review_support_case('claim',new.id);
   insert into support_case_messages(report_id,actor_user_id,sender,body) values(report,new.applicant_user_id,'user',new.support_reason);
  end if;
  return new;
 end if;
 if new.status='otp_pending' then return new; end if;
 report:=ensure_review_support_case('claim',new.id);
 body:=case new.status
  when 'approved' then 'Your ownership claim is approved. You can now open salon management from the related claim page.'
  when 'rejected' then 'Your ownership claim was not approved. You may reply with new evidence to request reconsideration.'
  when 'needs_info' then 'More information is needed before we can decide your ownership claim.'
  when 'expired' then 'This ownership request is no longer active. It did not grant management access. Contact support if you still need help.'
  else 'Your ownership request has been received and is waiting for review.' end;
 if new.status in ('approved','rejected','needs_info') and nullif(btrim(new.review_reason),'') is not null then
  body:=body||E'\n\n'||new.review_reason;
 end if;
 report_status:=case new.status when 'needs_info' then 'action_required' when 'approved' then 'resolved' when 'rejected' then 'resolved' when 'expired' then 'closed' else 'under_review' end;
 update platform_reports set status=report_status,resolution=case when report_status in ('resolved','closed') then body else null end,
 resolved_at=case when report_status='resolved' then now() end,closed_at=case when report_status='closed' then now() end,updated_at=now() where id=report;
 perform review_support_message(report,body,case when new.status='waiting' then 'receipt' else 'decision' end);
 return new;
end $$;
create trigger sync_claim_communication after insert or update of status,support_reason on public.business_claim_requests for each row execute function public.sync_claim_communication();
revoke all on function public.sync_claim_communication() from public,anon,authenticated;

create function public.sync_post_report_communication() returns trigger
language plpgsql security definer set search_path=public as $$
declare report uuid; body text;
begin
 if new.origin<>'user' then return new; end if;
 if tg_op='UPDATE' and new.status=old.status then return new; end if;
 report:=ensure_review_support_case('post_report',new.id);
 if report is null then return new; end if;
 body:=case when new.status='pending' then 'Your content report has been received and is waiting for review.'
 when new.status='dismissed' then 'We reviewed your report and did not establish a policy violation. You may reply with additional evidence to request reconsideration.'
 else 'We reviewed your report and took action on the reported content.' end;
 if new.status<>'pending' and nullif(btrim(new.public_response),'') is not null then body:=body||E'\n\n'||new.public_response; end if;
 update platform_reports set status=case when new.status='pending' then 'under_review' else 'resolved' end,
 resolution=case when new.status<>'pending' then body end,resolved_at=case when new.status<>'pending' then now() end,updated_at=now() where id=report;
 perform review_support_message(report,body,case when new.status='pending' then 'receipt' else 'decision' end);
 return new;
end $$;
create trigger sync_post_report_communication after insert or update of status on public.post_safety_cases for each row execute function public.sync_post_report_communication();
revoke all on function public.sync_post_report_communication() from public,anon,authenticated;

-- Mandatory service messages cannot be silently suppressed by social/team preferences.
create or replace function public.filter_notification_preference() returns trigger
language plpgsql security definer set search_path=public as $$
begin
 if new.notification_type in ('support_case','support_reply','review_receipt','review_decision','review_information') then return new; end if;
 if notification_category(new.notification_type)<>'security' and not notification_delivery_enabled(new.recipient_user_id,new.notification_type,new.recipient_kind) then return null; end if;
 return new;
end $$;

create or replace function public.notify_support_case_change() returns trigger
language plpgsql security definer set search_path=public as $$
begin
 if exists(select 1 from review_support_links where report_id=new.id) then return new; end if;
 if new.source='user_support' and ((new.status in ('resolved','closed','action_required') and new.status is distinct from old.status) or new.resolution is distinct from old.resolution) then
 insert into app_notifications(recipient_user_id,recipient_kind,notification_type,title,body,href,event_key)
 values(new.reporter_user_id,'customer','support_case',case when new.status='action_required' then 'Support needs more information' else 'Support request updated' end,
 new.report_number||': '||replace(new.status,'_',' '),'/support/'||new.id,'support-case:'||gen_random_uuid());
 end if;
 return new;
end $$;

create or replace function public.notify_support_reply() returns trigger
language plpgsql security definer set search_path=public as $$
declare r platform_reports; link review_support_links; title text; notification_type_value text;
begin
 select * into r from platform_reports where id=new.report_id;
 select * into link from review_support_links where report_id=r.id;
 if new.sender='support' then
 notification_type_value:=case new.message_kind when 'receipt' then 'review_receipt' when 'decision' then 'review_decision' when 'information' then 'review_information' else 'support_reply' end;
 title:=case new.message_kind when 'receipt' then 'Request received — waiting for review'
 when 'decision' then case when link.kind='claim' then
  case (select status from business_claim_requests where id=link.request_id) when 'approved' then 'Salon ownership claim approved' when 'rejected' then 'Salon ownership claim not approved' when 'needs_info' then 'Your ownership claim needs more information' when 'expired' then 'Ownership request is no longer active' else 'Ownership claim updated' end
 else 'Your content report has been reviewed' end
 when 'information' then 'Your report needs more information'
 else 'Support replied to your request' end;
 if r.reporter_user_id is not null then
 insert into app_notifications(recipient_user_id,recipient_kind,notification_type,title,body,href,event_key)
 values(r.reporter_user_id,'customer',notification_type_value,title,left(new.body,150),'/support/'||r.id,'support-message:'||new.id);
 end if;
 if new.message_kind='message' then
 insert into platform_admin_audit_logs(actor_user_id,action,target_type,target_id,reason,metadata)
 values(new.actor_user_id,'platform_admin.support_reply','platform_report',r.id,'Reply to support request',jsonb_build_object('message_id',new.id));
 end if;
 end if;
 return new;
end $$;

create function public.review_business_claim_with_message(p_request uuid,p_decision text,p_reason text,p_internal_note text default null)
returns void language plpgsql security definer set search_path=public as $$
declare r business_claim_requests; actor uuid:=support_active_user();
begin
 perform platform_admin_require_permission('admin.locations.update_status');
 if p_decision is null or p_decision not in ('approved','rejected','needs_info') or length(btrim(coalesce(p_reason,''))) not between 3 and 1000 or length(coalesce(p_internal_note,''))>2000 then raise exception 'Choose a decision and enter a user-facing explanation (3–1000 characters).'; end if;
 perform 1 from accounts where id=(select l.account_id from locations l join business_claim_requests c on c.salon_id=l.id where c.id=p_request) for update;
 perform 1 from locations where id=(select salon_id from business_claim_requests where id=p_request) for update;
 select * into r from business_claim_requests where id=p_request for update;
 if not found or r.status not in ('waiting','needs_info') then raise exception 'Request is no longer waiting for review.'; end if;
 if p_decision='needs_info' and r.status='needs_info' then raise exception 'Information has already been requested. Continue the existing conversation.'; end if;
 if p_decision='approved' then perform complete_business_claim(r.id,actor,btrim(p_reason));
 else
 update business_claim_requests set status=p_decision,reviewed_at=now(),reviewed_by=actor,review_reason=btrim(p_reason) where id=r.id;
 insert into business_claim_events(request_id,actor_user_id,event,reason) values(r.id,actor,p_decision,btrim(p_reason));
 end if;
 if nullif(btrim(p_internal_note),'') is not null then
 insert into platform_admin_audit_logs(actor_user_id,action,target_type,target_id,reason,metadata)
 values(actor,'platform_admin.claim_internal_note','business_claim_request',r.id,btrim(p_internal_note),'{}');
 end if;
end $$;
revoke all on function public.review_business_claim_with_message(uuid,text,text,text) from public,anon;
grant execute on function public.review_business_claim_with_message(uuid,text,text,text) to authenticated;
create or replace function public.review_business_claim(p_request uuid,p_decision text,p_reason text) returns void
language plpgsql security definer set search_path=public as $$
begin perform review_business_claim_with_message(p_request,p_decision,p_reason,null); end $$;

create function public.review_post_safety_with_message(p_case_id uuid,p_action text,p_reason text,p_public_message text default null,p_request_id uuid default null) returns jsonb
language plpgsql security definer set search_path=public as $$
declare c post_safety_cases; report uuid; previous post_safety_decisions; previous_ids uuid[]; result jsonb;
begin
 perform platform_admin_require_permission('admin.reports.update');
 perform support_active_user();
 if p_request_id is not null then
  perform pg_advisory_xact_lock(hashtextextended('post-review:'||p_request_id,0));
  select * into previous from post_safety_decisions where client_request_id=p_request_id;
  if found then
   if previous.case_id<>p_case_id or previous.actor_user_id is distinct from current_public_user_id() or previous.client_action is distinct from p_action or previous.reason is distinct from btrim(p_reason) or previous.client_public_message is distinct from nullif(btrim(p_public_message),'') then raise exception 'This review request has already been used.'; end if;
   return jsonb_build_object('ok',true);
  end if;
 end if;
 if length(btrim(coalesce(p_reason,''))) not between 3 and 2000 or length(coalesce(p_public_message,''))>2000 then raise exception 'Enter a valid review explanation.'; end if;
 select * into c from post_safety_cases where id=p_case_id for update;
 if not found or c.status<>'pending' then raise exception 'Case is no longer pending.'; end if;
 if p_action='request_info' then
  if c.reporter_user_id is null then raise exception 'This reporter has no authenticated inbox.'; end if;
  if length(btrim(coalesce(p_public_message,'')))<3 then raise exception 'Explain which information the reporter should provide.'; end if;
  report:=ensure_review_support_case('post_report',c.id);
  update platform_reports set status='action_required',updated_at=now() where id=report;
  perform review_support_message(report,btrim(p_public_message),'information');
  insert into post_safety_decisions(case_id,actor_user_id,action,reason,client_request_id,client_action,client_public_message) values(c.id,current_public_user_id(),'request_info',btrim(p_reason),p_request_id,p_action,nullif(btrim(p_public_message),''));
  return jsonb_build_object('ok',true);
 end if;
 if p_action in ('keep_public','delete','block') and c.origin='user' and length(btrim(coalesce(p_public_message,'')))<3 then raise exception 'Enter an explanation for the reporter.'; end if;
 -- Bulk content removal also resolves other reporters: only the reviewed case gets the custom explanation.
 update post_safety_cases set public_response=nullif(btrim(p_public_message),'') where id=c.id;
 previous_ids:=array(select id from post_safety_decisions where case_id=c.id);
 result:=admin_review_post_safety(c.id,p_action,btrim(p_reason));
 update post_safety_decisions set client_request_id=p_request_id,client_action=p_action,client_public_message=nullif(btrim(p_public_message),'')
 where case_id=c.id and id<>all(previous_ids);
 return result;
end $$;
revoke all on function public.review_post_safety_with_message(uuid,text,text,text,uuid) from public,anon;
grant execute on function public.review_post_safety_with_message(uuid,text,text,text,uuid) to authenticated;

-- User replies re-enter the ownership queue; they never award memberships.
create function public.sync_review_user_reply() returns trigger
language plpgsql security definer set search_path=public as $$
declare link review_support_links; c business_claim_requests;
begin
 if new.sender<>'user' or new.message_kind<>'message' then return new; end if;
 select * into link from review_support_links where report_id=new.report_id;
 if link.kind='claim' then
  -- Match the ownership grant's account -> location -> request lock order.
  perform 1 from accounts where id=(select l.account_id from locations l join business_claim_requests bc on bc.salon_id=l.id where bc.id=link.request_id) for update;
  perform 1 from locations where id=(select salon_id from business_claim_requests where id=link.request_id) for update;
  select * into c from business_claim_requests where id=link.request_id for update;
  if c.status in ('needs_info','rejected') then
   if exists(select 1 from business_claim_requests where salon_id=c.salon_id and applicant_user_id=c.applicant_user_id and id<>c.id and status in ('otp_pending','waiting','needs_info')) then raise exception 'You already have another active claim. Continue that request.'; end if;
   update business_claim_requests set status='waiting',review_reason=null where id=c.id;
   insert into business_claim_events(request_id,actor_user_id,event) values(c.id,new.actor_user_id,'information_submitted');
  end if;
 end if;
 return new;
end $$;
create trigger sync_review_user_reply after insert on public.support_case_messages for each row execute function public.sync_review_user_reply();
revoke all on function public.sync_review_user_reply() from public,anon,authenticated;

-- Expose only a private conversation link, never the internal audit.
create function public.get_review_support_link(p_kind text,p_request uuid) returns uuid
language plpgsql stable security definer set search_path=public as $$
declare actor uuid:=support_active_user(); result uuid; owner uuid;
begin
 if p_kind='claim' then
 select applicant_user_id into owner from business_claim_requests where id=p_request;
 if owner is distinct from actor then perform platform_admin_require_permission('admin.locations.read'); end if;
 elsif p_kind='post_report' then
 select reporter_user_id into owner from post_safety_cases where id=p_request;
 if owner is distinct from actor then perform platform_admin_require_permission('admin.reports.read'); end if;
 else raise exception 'Invalid review type.'; end if;
 select report_id into result from review_support_links where kind=p_kind and request_id=p_request;
 return result;
end $$;
revoke all on function public.get_review_support_link(text,uuid) from public,anon;
grant execute on function public.get_review_support_link(text,uuid) to authenticated;

-- Claims reviewers use ownership permissions; reporters use report permissions.
create or replace function public.get_support_conversation(p_report_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare r platform_reports; link review_support_links; actor uuid:=support_active_user(); admin_view boolean:=false;
begin
 select * into r from platform_reports where id=p_report_id and source in ('user_support','guest_support');
 if not found then raise exception 'Request unavailable.'; end if;
 select * into link from review_support_links where report_id=r.id;
 if r.reporter_user_id is distinct from actor then
  perform platform_admin_require_permission(case when link.kind='claim' then 'admin.locations.read' else 'admin.reports.read' end); admin_view:=true;
 end if;
 return jsonb_build_object('id',r.id,'reference',r.report_number,'summary',r.summary,'category',r.category,'status',r.status,'resolution',r.resolution,'context',r.support_context,
 'messages',(select coalesce(jsonb_agg(jsonb_build_object('id',id,'sender',sender,'body',body,'created_at',created_at) order by created_at,id),'[]') from support_case_messages where report_id=r.id),
 'attachments',(select coalesce(jsonb_agg(jsonb_build_object('id',id,'path',object_path,'name',file_name)),'[]') from support_case_attachments where report_id=r.id),
 'admin_view',admin_view,'can_reply',not admin_view or platform_admin_has_permission(case when link.kind='claim' then 'admin.locations.update_status' else 'admin.reports.update' end),
 'review',case when link.kind is not null then jsonb_build_object('kind',link.kind,'id',link.request_id,'status',case when link.kind='claim' then (select status from business_claim_requests where id=link.request_id) else (select status from post_safety_cases where id=link.request_id) end) end);
end $$;

create or replace function public.send_support_case_message(p_report_id uuid,p_body text,p_reopen boolean default false)
returns void language plpgsql security definer set search_path=public as $$
declare r platform_reports; link review_support_links; kind text; actor uuid:=support_active_user(); message_id uuid;
begin
 select * into link from review_support_links where report_id=p_report_id;
 -- Lock before the report, matching admin decisions and avoiding cross-request deadlocks.
 if link.kind='claim' then
  perform 1 from accounts where id=(select l.account_id from locations l join business_claim_requests bc on bc.salon_id=l.id where bc.id=link.request_id) for update;
  perform 1 from locations where id=(select salon_id from business_claim_requests where id=link.request_id) for update;
  perform 1 from business_claim_requests where id=link.request_id for update;
 end if;
 select * into r from platform_reports where id=p_report_id and source in ('user_support','guest_support') for update;
 if not found then raise exception 'Request unavailable.'; end if;
 if r.reporter_user_id=actor then kind:='user';
 else perform platform_admin_require_permission(case when link.kind='claim' then 'admin.locations.update_status' else 'admin.reports.update' end); kind:='support'; end if;
 if p_body is null or length(btrim(p_body)) not between 1 and 5000 then raise exception 'Enter a message (maximum 5,000 characters).'; end if;
 if (select count(*) from support_case_messages where actor_user_id=actor and message_kind='message' and created_at>now()-interval '1 minute')>=10 then raise exception 'Please wait before sending another message.'; end if;
 if r.status in ('resolved','closed') and not p_reopen then raise exception 'Reopen this request to continue.'; end if;
 -- Expired and approved ownership remain final; a support reply cannot award/revoke access.
 insert into support_case_messages(report_id,actor_user_id,sender,body) values(r.id,actor,kind,btrim(p_body)) returning id into message_id;
 perform set_config('review.inserted_message',message_id::text,true);
 update platform_reports set updated_at=now(),status=case when kind='user' then 'under_review' else 'action_required' end,resolved_at=null,closed_at=null,resolution=case when p_reopen then null else resolution end where id=r.id;
end $$;

-- Existing requests gain persistent histories without retroactive inbox spam.
do $$declare definition text; begin
 definition:=pg_get_functiondef('public.add_support_case_attachment(uuid,text,text)'::regprocedure);
 definition:=replace(definition,'platform_admin_require_permission(''admin.reports.update'')',
 'platform_admin_require_permission(case when exists(select 1 from review_support_links where report_id=r.id and kind=''claim'') then ''admin.locations.update_status'' else ''admin.reports.update'' end)');
 execute definition;
end $$;

do $$declare c record; report uuid; body text; begin
 for c in select id,status from business_claim_requests where status<>'otp_pending' loop
  report:=ensure_review_support_case('claim',c.id);
  body:=case c.status when 'approved' then 'Ownership claim approved.' when 'rejected' then 'Ownership claim not approved. Open the related claim page to view the decision.' when 'expired' then 'This ownership request is no longer active.' else null end;
  update platform_reports set status=case c.status when 'approved' then 'resolved' when 'rejected' then 'resolved' when 'expired' then 'closed' else 'under_review' end,resolution=body where id=report;
 end loop;
 for c in select id,status from post_safety_cases where origin='user' and reporter_user_id is not null loop
  report:=ensure_review_support_case('post_report',c.id);
  body:=case when c.status='pending' then null when c.status='dismissed' then 'We reviewed your report and did not establish a policy violation.' else 'We reviewed your report and took action on the reported content.' end;
  update platform_reports set status=case when c.status='pending' then 'under_review' else 'resolved' end,resolution=body where id=report;
 end loop;
end $$;

-- Attach the conversation ID to the existing private claim response.
do $$declare definition text; begin
 definition:=pg_get_functiondef('public.get_business_claim_requests(uuid)'::regprocedure);
 definition:=replace(definition,'''salon_name'',l.name', '''support_report_id'',(select report_id from review_support_links where kind=''claim'' and request_id=r.id),''salon_name'',l.name');
 execute definition;
end $$;

create function public.send_support_case_message_once(p_report_id uuid,p_body text,p_request_id uuid,p_reopen boolean default false)
returns void language plpgsql security definer set search_path=public as $$
declare actor uuid:=support_active_user(); previous support_case_messages; message uuid;
begin
 if p_request_id is null then raise exception 'A message request ID is required.'; end if;
 perform pg_advisory_xact_lock(hashtextextended('support-message:'||p_request_id,0));
 select * into previous from support_case_messages where client_request_id=p_request_id;
 if found then
  if previous.actor_user_id is distinct from actor or previous.report_id<>p_report_id or previous.body is distinct from btrim(p_body) then raise exception 'This message request has already been used.'; end if;
  return;
 end if;
 perform send_support_case_message(p_report_id,p_body,p_reopen);
 message:=current_setting('review.inserted_message')::uuid;
 update support_case_messages set client_request_id=p_request_id where id=message;
end $$;
revoke all on function public.send_support_case_message_once(uuid,text,uuid,boolean) from public,anon;
grant execute on function public.send_support_case_message_once(uuid,text,uuid,boolean) to authenticated;

create function public.reopen_content_report_review(p_case_id uuid) returns void
language plpgsql security definer set search_path=public as $$
declare c post_safety_cases; report uuid;
begin
 perform platform_admin_require_permission('admin.reports.update'); perform support_active_user();
 select * into c from post_safety_cases where id=p_case_id for update;
 if not found or c.origin<>'user' or c.status='pending' then raise exception 'This content report cannot be reopened.'; end if;
 report:=ensure_review_support_case('post_report',c.id);
 if not exists(select 1 from platform_reports where id=report and status='under_review') then raise exception 'The reporter must first submit a reconsideration request.'; end if;
 update post_safety_cases set status='pending',public_response=null,reviewed_at=null where id=c.id;
 update platform_reports set status='under_review',resolved_at=null,closed_at=null where id=c.platform_report_id;
 insert into post_safety_decisions(case_id,actor_user_id,action,reason) values(c.id,current_public_user_id(),'reopened','Reopened to review additional reporter evidence.');
end $$;
revoke all on function public.reopen_content_report_review(uuid) from public,anon;
grant execute on function public.reopen_content_report_review(uuid) to authenticated;

create function public.get_my_post_report_conversation(p_type text,p_id uuid) returns uuid
language sql stable security definer set search_path=public as $$
 select l.report_id from post_safety_cases c join review_support_links l on l.kind='post_report' and l.request_id=c.id
 where c.origin='user' and c.source_type=p_type and c.source_id=p_id and c.reporter_user_id=current_public_user_id()
 order by c.created_at desc limit 1;
$$;
revoke all on function public.get_my_post_report_conversation(text,uuid) from public,anon;
grant execute on function public.get_my_post_report_conversation(text,uuid) to authenticated;

notify pgrst,'reload schema';
commit;
