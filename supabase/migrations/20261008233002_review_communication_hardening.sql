begin;
-- A request waiting on evidence is still a competing ownership claim. Phone possession
-- must not auto-approve another applicant while that review is active.
do $$declare definition text; begin
 definition:=pg_get_functiondef('public.confirm_business_claim(uuid,uuid,text)'::regprocedure);
 definition:=replace(definition,'(status=''waiting'' or status=''otp_pending'' and expires_at>now())',
 '(status in (''waiting'',''needs_info'') or status=''otp_pending'' and expires_at>now())');
 execute definition;

 -- Histories remain readable after the original salon/content request is removed.
 definition:=pg_get_functiondef('public.get_support_conversation(uuid)'::regprocedure);
 definition:=replace(definition,'(select status from business_claim_requests where id=link.request_id)',
 'coalesce((select status from business_claim_requests where id=link.request_id),''unavailable'')');
 definition:=replace(definition,'(select status from post_safety_cases where id=link.request_id)',
 'coalesce((select status from post_safety_cases where id=link.request_id),''unavailable'')');
 execute definition;
end $$;

create or replace function public.notify_support_case_change() returns trigger
language plpgsql security definer set search_path=public as $$
begin
 if exists(select 1 from review_support_links where report_id=new.id) then return new; end if;
 -- The reply producer already emitted the service notification in this transaction.
 if new.status='action_required' and exists(select 1 from support_case_messages where report_id=new.id and sender='support' and created_at=now()) then return new; end if;
 if new.source='user_support' and ((new.status in ('resolved','closed','action_required') and new.status is distinct from old.status) or new.resolution is distinct from old.resolution) then
 insert into app_notifications(recipient_user_id,recipient_kind,notification_type,title,body,href,event_key)
 values(new.reporter_user_id,'customer','support_case',case when new.status='action_required' then 'Support needs more information' else 'Support request updated' end,
 new.report_number||': '||replace(new.status,'_',' '),'/support/'||new.id,'support-case:'||gen_random_uuid());
 end if;
 return new;
end $$;
notify pgrst,'reload schema';
commit;
