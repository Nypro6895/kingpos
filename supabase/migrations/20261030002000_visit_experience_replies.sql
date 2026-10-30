begin;

-- Replies and workflow are separate from customer sentiment and Truth evidence.
create table public.visit_experience_replies (
 id uuid primary key default gen_random_uuid(),
 experience_id uuid not null unique references public.customer_visit_experiences(id) on delete cascade,
 author_user_id uuid not null references public.users(id),
 request_id uuid not null unique,
 body text not null check(length(btrim(body)) between 1 and 1000),
 created_at timestamptz not null default now()
);
create table public.visit_experience_history (
 id uuid primary key default gen_random_uuid(),
 experience_id uuid not null references public.customer_visit_experiences(id) on delete cascade,
 actor_user_id uuid references public.users(id),
 feedback_state text not null,
 body text,
 issue_status text not null,
 created_at timestamptz not null default now()
);
create index visit_experience_history_order on public.visit_experience_history(experience_id,created_at,id);
alter table public.visit_experience_replies enable row level security;
alter table public.visit_experience_history enable row level security;
revoke all on public.visit_experience_replies,public.visit_experience_history from public,anon,authenticated;

create function public.record_visit_experience_history() returns trigger
language plpgsql security definer set search_path=public as $$
begin
 if tg_op='UPDATE' and (new.feedback_state,new.body,new.issue_status) is not distinct from (old.feedback_state,old.body,old.issue_status) then return new; end if;
 if tg_op='UPDATE' and not exists(select 1 from visit_experience_history where experience_id=new.id) then
  insert into visit_experience_history(experience_id,actor_user_id,feedback_state,body,issue_status,created_at)
  values(old.id,old.author_user_id,old.feedback_state,old.body,old.issue_status,old.updated_at);
 end if;
 insert into visit_experience_history(experience_id,actor_user_id,feedback_state,body,issue_status)
 values(new.id,current_public_user_id(),new.feedback_state,new.body,new.issue_status);
 return new;
end $$;
revoke all on function public.record_visit_experience_history() from public,anon,authenticated;
create trigger visit_experience_history after insert or update on public.customer_visit_experiences
 for each row execute function public.record_visit_experience_history();

create function public.reply_to_visit_experience(p_experience uuid,p_salon uuid,p_body text,p_request uuid) returns uuid
language plpgsql security definer set search_path=public as $$
declare actor uuid:=current_public_user_id(); e customer_visit_experiences; r visit_experience_replies; account uuid;
begin
 if actor is null or not user_has_salon_permission(p_salon,array['salon_profile.content.manage']) then raise exception 'Not authorized'; end if;
 if p_request is null or p_body is null or length(btrim(p_body)) not between 1 and 1000 then raise exception 'Write a reply between 1 and 1000 characters.'; end if;
 select * into e from customer_visit_experiences where id=p_experience and salon_id=p_salon for update;
 if e.id is null then raise exception 'Experience not found.'; end if;
 if social_users_blocked(actor,e.author_user_id) then raise exception 'This interaction is unavailable.'; end if;
 select * into r from visit_experience_replies where request_id=p_request or experience_id=e.id;
 if r.id is not null then
  if r.request_id=p_request and r.experience_id=e.id and r.author_user_id=actor and r.body=btrim(p_body) then return r.id; end if;
  raise exception 'A salon reply already exists. Refresh to read it.';
 end if;
 insert into visit_experience_replies(experience_id,author_user_id,request_id,body) values(e.id,actor,p_request,btrim(p_body)) returning * into r;
 update customer_visit_experiences set issue_status='acknowledged' where id=e.id and feedback_state='issue' and issue_status='open';
 select account_id into account from locations where id=p_salon;
 insert into app_notifications(account_id,salon_id,recipient_user_id,recipient_kind,notification_type,title,body,href,event_key)
 values(account,p_salon,e.author_user_id,'customer','visit_experience_reply','The salon replied to your experience',
 'Read the salon reply in My Reviews.','/more/reviews?experience='||e.id::text,'visit-experience-reply:'||r.id::text)
 on conflict (recipient_user_id,event_key) where event_key is not null do nothing;
 return r.id;
end $$;
revoke all on function public.reply_to_visit_experience(uuid,uuid,text,uuid) from public,anon;
grant execute on function public.reply_to_visit_experience(uuid,uuid,text,uuid) to authenticated;

create function public.set_visit_experience_status(p_experience uuid,p_salon uuid,p_status text) returns void
language plpgsql security definer set search_path=public as $$
declare actor uuid:=current_public_user_id(); e customer_visit_experiences; account uuid;
begin
 if actor is null or not user_has_salon_permission(p_salon,array['salon_profile.content.manage']) then raise exception 'Not authorized'; end if;
 if p_status is null or p_status not in ('acknowledged','resolved') then raise exception 'Invalid issue status.'; end if;
 select * into e from customer_visit_experiences where id=p_experience and salon_id=p_salon for update;
 if e.id is null or e.feedback_state<>'issue' then raise exception 'Issue not found.'; end if;
 if social_users_blocked(actor,e.author_user_id) then raise exception 'This interaction is unavailable.'; end if;
 if not exists(select 1 from visit_experience_replies where experience_id=e.id) then raise exception 'Reply to the customer before changing the issue status.'; end if;
 if e.issue_status=p_status then return; end if;
 -- Never set feedback_state, body, author or historical reputation flags here.
 update customer_visit_experiences set issue_status=p_status where id=e.id;
 select account_id into account from locations where id=p_salon;
 insert into app_notifications(account_id,salon_id,recipient_user_id,recipient_kind,notification_type,title,body,href,event_key)
 values(account,p_salon,e.author_user_id,'customer','visit_experience_reply','The salon updated your issue',
 'Your original feedback remains unchanged. View the salon update in My Reviews.','/more/reviews?experience='||e.id::text,
 'visit-experience-status:'||e.id::text||':'||p_status||':'||(select count(*) from visit_experience_history where experience_id=e.id)::text)
 on conflict (recipient_user_id,event_key) where event_key is not null do nothing;
end $$;
revoke all on function public.set_visit_experience_status(uuid,uuid,text) from public,anon;
grant execute on function public.set_visit_experience_status(uuid,uuid,text) to authenticated;

-- Preserve the current public projection, history verification, block filtering,
-- legacy moderation and limits. Only enrich the existing verified-visit branch.
do $patch$
declare d text; projection regprocedure;
begin
 projection:=coalesce(to_regprocedure('public.get_public_salon_profile_experiences_before_blocks(uuid)'),to_regprocedure('public.get_public_salon_profile_experiences(uuid)'));
 d:=pg_get_functiondef(projection);
 if strpos(d,'null::uuid AS reply_id')=0 and strpos(d,'null::uuid as reply_id')=0 then raise exception 'Review projection changed; inspect before applying.'; end if;
 d:=replace(replace(d,'null::uuid AS reply_id','visit_reply.id AS reply_id'),'null::uuid as reply_id','visit_reply.id as reply_id');
 d:=replace(replace(d,'null::text AS reply_body','visit_reply.body AS reply_body'),'null::text as reply_body','visit_reply.body as reply_body');
 d:=replace(replace(d,'null::timestamp with time zone AS reply_created_at','visit_reply.created_at AS reply_created_at'),'null::timestamptz as reply_created_at','visit_reply.created_at as reply_created_at');
 -- pg_get_functiondef preserves SQL source text (both historical styles covered).
 if strpos(d,'left join public.users users on users.id = experiences.author_user_id')=0 then raise exception 'Review joins changed; inspect before applying.'; end if;
 d:=replace(d,'left join public.users users on users.id = experiences.author_user_id',
 'left join public.users users on users.id = experiences.author_user_id left join public.visit_experience_replies visit_reply on visit_reply.experience_id=experiences.id and not public.social_users_blocked(public.current_public_user_id(),visit_reply.author_user_id)');
 execute d;
end $patch$;

-- Own reviews are actor-scoped in the database, including unpublished salons.
-- No caller-supplied user ID, and no direct table grants.
create function public.get_my_visit_experiences(p_limit integer default 11,p_offset integer default 0,p_experience uuid default null) returns jsonb
language plpgsql stable security definer set search_path=public as $$
declare actor uuid:=current_public_user_id(); payload jsonb;
begin
 if actor is null then raise exception 'Sign in required.'; end if;
 if p_limit not between 1 and 51 or p_offset not between 0 and 10000 or p_limit is null or p_offset is null then raise exception 'Invalid page.'; end if;
 select coalesce(jsonb_agg(to_jsonb(rows) order by rows.created_at desc,rows.id desc),'[]'::jsonb) into payload from (
  select e.id,e.salon_id,coalesce(nullif(s.business_name,''),l.name) as salon_name,e.ticket_id,e.feedback_state,e.body,e.issue_status,
   e.edited_at,e.created_at,e.updated_at,r.body as reply_body,r.created_at as reply_created_at,
   exists(select 1 from pos_tickets t join customers c on c.id=t.customer_id and c.location_id=t.salon_id where t.id=e.ticket_id and t.status='closed' and t.salon_id=e.salon_id and c.customer_user_id=actor) as verified,
   salon_profile_public_salon_exists(e.salon_id) as salon_public,'experience'::text as source
  from customer_visit_experiences e join locations l on l.id=e.salon_id left join salon_settings s on s.salon_id=e.salon_id
  left join visit_experience_replies r on r.experience_id=e.id and not social_users_blocked(actor,r.author_user_id)
  where e.author_user_id=actor and (p_experience is null or e.id=p_experience)
  union all
  select v.id,v.salon_id,coalesce(nullif(s.business_name,''),l.name),null::uuid,null::text,v.body,null::text,
   v.edited_at,v.created_at,v.updated_at,r.body,r.created_at,v.verification_status='verified',
   salon_profile_public_salon_exists(v.salon_id),'legacy_review'::text
  from salon_profile_reviews v join locations l on l.id=v.salon_id left join salon_settings s on s.salon_id=v.salon_id
  left join lateral (select rr.body,rr.created_at from salon_profile_review_replies rr where rr.review_id=v.id and rr.moderation_status='visible' and not social_users_blocked(actor,rr.author_user_id) order by rr.created_at,rr.id limit 1) r on true
  where v.author_user_id=actor and v.moderation_status='visible' and (p_experience is null or v.id=p_experience)
  order by created_at desc,id desc limit p_limit offset p_offset
 ) rows;
 return payload;
end $$;
revoke all on function public.get_my_visit_experiences(integer,integer,uuid) from public,anon;
grant execute on function public.get_my_visit_experiences(integer,integer,uuid) to authenticated;

-- In-app only. Respect existing notification preferences; do not enqueue SMS/email.
create function public.notify_visit_experience_issue() returns trigger
language plpgsql security definer set search_path=public as $$
declare account uuid;
begin
 if new.feedback_state<>'issue' then return new; end if;
 if tg_op='UPDATE' and (new.feedback_state,new.body) is not distinct from (old.feedback_state,old.body) then return new; end if;
 select account_id into account from locations where id=new.salon_id;
 insert into app_notifications(account_id,salon_id,recipient_user_id,recipient_kind,notification_type,title,body,href,event_key)
 select account,new.salon_id,m.user_id,'owner_manager','visit_experience_issue','A customer shared a concern',
 'Read the verified-visit feedback and reply as the salon.','/salon-profile#customer-experiences',
 'visit-experience-issue:'||new.id::text||':'||(select count(*) from visit_experience_history where experience_id=new.id)::text
 from (
  select sm.user_id,sm.role_id from salon_memberships sm where sm.salon_id=new.salon_id and sm.status='active'
  union select am.user_id,am.role_id from account_memberships am where am.account_id=account and am.status='active'
 ) m join roles role on role.id=m.role_id
 where (upper(role.code)='OWNER' or exists(select 1 from role_permissions rp join permissions p on p.id=rp.permission_id where rp.role_id=m.role_id and p.code='salon_profile.content.manage'))
 and m.user_id<>new.author_user_id and not social_users_blocked(m.user_id,new.author_user_id)
 on conflict (recipient_user_id,event_key) where event_key is not null do nothing;
 return new;
end $$;
revoke all on function public.notify_visit_experience_issue() from public,anon,authenticated;
-- Trigger name sorts after history so notification deduplication uses its revision.
create trigger zz_notify_visit_experience_issue after insert or update on public.customer_visit_experiences for each row execute function public.notify_visit_experience_issue();

notify pgrst,'reload schema';
commit;
