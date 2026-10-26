begin;
create function public.support_active_user() returns uuid language plpgsql stable security definer set search_path=public as $$
declare actor uuid:=current_public_user_id();
begin
 if actor is null or not exists(select 1 from users where id=actor and status='active') then raise exception 'Sign in with an active account to contact support.'; end if;
 return actor;
end;$$;
revoke all on function public.support_active_user() from public,anon,authenticated;
create or replace function public.submit_user_support_case(p_request_id uuid,p_category text,p_summary text,p_message text,p_context jsonb default '{}')
returns uuid language plpgsql security definer set search_path=public as $$
declare actor uuid:=support_active_user(); result uuid;
begin
 if actor is null or not exists(select 1 from users where id=actor and status='active') then raise exception 'Sign in to contact support.'; end if;
 if p_request_id is null or p_category not in ('booking','data_calculation','ticket','review_dispute','account','salon_access','moderation_appeal','app_issue','other') or p_summary is null or length(btrim(p_summary)) not between 3 and 200 or p_message is null or length(btrim(p_message)) not between 1 and 5000 or p_context is null or jsonb_typeof(p_context)<>'object' or octet_length(p_context::text)>4000 then raise exception 'Please check your request.'; end if;
 perform pg_advisory_xact_lock(hashtextextended('support:'||actor::text,0));
 select id into result from platform_reports where support_request_id=p_request_id and reporter_user_id=actor;
 if found then return result; end if;
 if (select count(*) from platform_reports where reporter_user_id=actor and source='user_support' and created_at>now()-interval '1 hour')>=5 then raise exception 'Too many requests. Please continue an existing conversation.'; end if;
 insert into platform_reports(category,summary,description,source,reporter_user_id,created_by_user_id,support_request_id,support_context)
 values(p_category,btrim(p_summary),btrim(p_message),'user_support',actor,actor,p_request_id,p_context) returning id into result;
 insert into support_case_messages(report_id,actor_user_id,sender,body) values(result,actor,'user',btrim(p_message));
 return result;
end;$$;
create or replace function public.get_support_conversation(p_report_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare r platform_reports; admin_view boolean:=false; messages jsonb;
begin
 select * into r from platform_reports where id=p_report_id and source in ('user_support','guest_support');
 if not found or support_active_user() is null then raise exception 'Request unavailable.'; end if;
 if r.reporter_user_id is distinct from support_active_user() then perform platform_admin_require_permission('admin.reports.read'); admin_view:=true; end if;
 select coalesce(jsonb_agg(jsonb_build_object('id',id,'sender',sender,'body',body,'created_at',created_at) order by created_at,id),'[]') into messages from support_case_messages where report_id=r.id;
 return jsonb_build_object('id',r.id,'reference',r.report_number,'summary',r.summary,'category',r.category,'status',r.status,'resolution',r.resolution,'context',r.support_context,'messages',messages,'attachments',(select coalesce(jsonb_agg(jsonb_build_object('id',id,'path',object_path,'name',file_name)),'[]') from support_case_attachments where report_id=r.id),'admin_view',admin_view);
end;$$;
create or replace function public.list_my_support_cases()
returns jsonb language plpgsql security definer set search_path=public as $$
begin
 if support_active_user() is null then raise exception 'Sign in to view your requests.'; end if;
 return (select coalesce(jsonb_agg(row_to_json(r)),'[]') from (select id,report_number as reference,summary,status,updated_at from platform_reports where reporter_user_id=support_active_user() and source='user_support' order by updated_at desc limit 100) r);
end;$$;
create or replace function public.send_support_case_message(p_report_id uuid,p_body text,p_reopen boolean default false)
returns void language plpgsql security definer set search_path=public as $$
declare r platform_reports; kind text;
begin
 select * into r from platform_reports where id=p_report_id and source in ('user_support','guest_support') for update;
 if not found or support_active_user() is null then raise exception 'Request unavailable.'; end if;
 if r.reporter_user_id=support_active_user() then kind:='user';
 else perform platform_admin_require_permission('admin.reports.update'); kind:='support'; end if;
 if p_body is null or length(btrim(p_body)) not between 1 and 5000 then raise exception 'Enter a message (maximum 5,000 characters).'; end if;
 if (select count(*) from support_case_messages where actor_user_id=support_active_user() and created_at>now()-interval '1 minute')>=10 then raise exception 'Please wait before sending another message.'; end if;
 if r.status in ('resolved','closed') and not p_reopen then raise exception 'Reopen this request to continue.'; end if;
 insert into support_case_messages(report_id,actor_user_id,sender,body) values(r.id,support_active_user(),kind,btrim(p_body));
 update platform_reports set updated_at=now(),status=case when kind='user' then 'under_review' else 'action_required' end,resolved_at=null,closed_at=null,resolution=case when p_reopen then null else resolution end where id=r.id;
end;$$;
create or replace function public.add_support_case_attachment(p_report_id uuid,p_path text,p_name text) returns void language plpgsql security definer set search_path=public as $$
declare r platform_reports;
begin
 select * into r from platform_reports where id=p_report_id and source in ('user_support','guest_support') for update;
 if not found or support_active_user() is null then raise exception 'Request unavailable.'; end if;
 if r.reporter_user_id is distinct from support_active_user() then perform platform_admin_require_permission('admin.reports.update'); end if;
 if p_path is null or p_path not like r.id::text||'/%' or p_name is null or length(p_name) not between 1 and 200 then raise exception 'Invalid attachment.'; end if;
 if (select count(*) from support_case_attachments where report_id=r.id)>=20 then raise exception 'Maximum 20 attachments per request.'; end if;
 insert into support_case_attachments(report_id,actor_user_id,object_path,file_name) values(r.id,support_active_user(),p_path,p_name);
end;$$;
commit;
