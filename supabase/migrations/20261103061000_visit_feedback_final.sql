begin;

-- Existing reviews and replies are preserved. Only new writes use the final flow.
alter table public.customer_visit_experiences
  add column visit_identity text,
  add column customer_resolved_at timestamptz;

create function public.visit_feedback_identity(p_ticket uuid) returns text
language sql stable security definer set search_path=public as $$
  select coalesce(
    (select 'visit:'||v.id::text from customer_visits v
      where v.salon_id=t.salon_id and v.customer_id=t.customer_id
        and (v.ticket_id=t.id or (t.source_booking_id is not null and v.appointment_id=t.source_booking_id))
      order by (v.ticket_id=t.id) desc,v.checked_in_at,v.id limit 1),
    'booking:'||t.source_booking_id::text,'ticket:'||t.id::text)
  from pos_tickets t where t.id=p_ticket;
$$;
revoke all on function public.visit_feedback_identity(uuid) from public,anon,authenticated;
create index visit_feedback_identity_lookup on public.customer_visit_experiences(salon_id,author_user_id,visit_identity);

-- Canonical customer consolidation may still remap customer_id; content stays frozen.
-- A database guard also protects against old app versions calling the old flow.
create function public.guard_final_visit_feedback() returns trigger
language plpgsql security definer set search_path=public as $$
declare actor uuid:=current_public_user_id();
begin
  if tg_op='INSERT' then
    new.visit_identity:=visit_feedback_identity(new.ticket_id);
    if new.visit_identity is null then raise exception 'Verified visit was not found.'; end if;
    perform pg_advisory_xact_lock(hashtextextended(new.author_user_id::text||':'||new.salon_id::text,0));
    if exists(select 1 from customer_visit_experiences e where e.author_user_id=new.author_user_id
      and e.salon_id=new.salon_id and (e.ticket_id=new.ticket_id
        or coalesce(e.visit_identity,visit_feedback_identity(e.ticket_id))=new.visit_identity
        or visit_feedback_identity(e.ticket_id)=new.visit_identity)) then
      raise exception 'An experience has already been shared for this visit.';
    end if;
    return new;
  end if;
  if (new.feedback_state,new.body,new.ticket_id,new.salon_id,new.author_user_id,
      new.created_at,new.edited_at,new.counts_toward_reputation,new.visit_identity)
    is distinct from
     (old.feedback_state,old.body,old.ticket_id,old.salon_id,old.author_user_id,
      old.created_at,old.edited_at,old.counts_toward_reputation,old.visit_identity) then
    raise exception 'Shared feedback cannot be edited.';
  end if;
  if (new.issue_status,new.customer_resolved_at) is distinct from (old.issue_status,old.customer_resolved_at) then
    if old.feedback_state<>'issue' or not exists(select 1 from visit_experience_replies where experience_id=old.id) then
      raise exception 'This issue cannot be updated.';
    end if;
    if new.issue_status='acknowledged' and old.issue_status='open'
      and new.customer_resolved_at is null
      and user_has_salon_permission(old.salon_id,array['salon_profile.content.manage']) then return new; end if;
    if new.issue_status='resolved' and actor=old.author_user_id and old.customer_resolved_at is null
      and new.customer_resolved_at=now() then return new; end if;
    raise exception 'Only the customer can confirm resolution.';
  end if;
  return new;
end $$;
revoke all on function public.guard_final_visit_feedback() from public,anon,authenticated;
create trigger guard_final_visit_feedback before insert or update on public.customer_visit_experiences
for each row execute function public.guard_final_visit_feedback();
revoke insert,update,delete on public.customer_visit_experiences from authenticated;

alter function public.record_customer_visit_experience(uuid,text,text) rename to record_customer_visit_experience_before_final;
revoke all on function public.record_customer_visit_experience_before_final(uuid,text,text) from public,anon,authenticated;
create function public.record_customer_visit_experience(p_ticket_id uuid,p_feedback_state text,p_body text default null)
returns jsonb language plpgsql security definer set search_path=public as $$
declare actor uuid:=current_public_user_id(); t pos_tickets; e customer_visit_experiences; result jsonb;
begin
  if actor is null then return jsonb_build_object('ok',false,'message','Sign in to share this experience.'); end if;
  if p_feedback_state is null or p_feedback_state not in ('good','issue') then
    return jsonb_build_object('ok',false,'message','Choose how your visit went.'); end if;
  if length(btrim(coalesce(p_body,'')))>1000 then
    return jsonb_build_object('ok',false,'message','Keep experience details under 1000 characters.'); end if;
  select tickets.* into t from pos_tickets tickets join customers c
    on c.id=tickets.customer_id and c.location_id=tickets.salon_id and c.customer_user_id=actor
    where tickets.id=p_ticket_id and tickets.status='closed';
  if t.id is null then return jsonb_build_object('ok',false,'message','Verified visit was not found.'); end if;
  perform pg_advisory_xact_lock(hashtextextended(actor::text||':'||t.salon_id::text,0));
  select * into e from customer_visit_experiences x where x.author_user_id=actor and x.salon_id=t.salon_id
    and (x.ticket_id=t.id or coalesce(x.visit_identity,visit_feedback_identity(x.ticket_id))=visit_feedback_identity(t.id)
      or visit_feedback_identity(x.ticket_id)=visit_feedback_identity(t.id)) order by x.created_at,x.id limit 1;
  if e.id is not null then
    -- Identical retry succeeds without changing the record, audit or notifications.
    if e.feedback_state=p_feedback_state and coalesce(e.body,'')=btrim(coalesce(p_body,'')) then
      return jsonb_build_object('ok',true,'experienceId',e.id,'salonId',e.salon_id,'ticketId',e.ticket_id,
        'feedbackState',e.feedback_state,'countsTowardReputation',e.counts_toward_reputation);
    end if;
    return jsonb_build_object('ok',false,'experienceId',e.id,'message','An experience has already been shared for this visit.');
  end if;
  result:=record_customer_visit_experience_before_final(p_ticket_id,p_feedback_state,p_body);
  if result->>'ok'='true' then
    select * into e from customer_visit_experiences where ticket_id=p_ticket_id and author_user_id=actor;
    result:=result||jsonb_build_object('experienceId',e.id);
  end if;
  return result;
end $$;
revoke all on function public.record_customer_visit_experience(uuid,text,text) from public,anon;
grant execute on function public.record_customer_visit_experience(uuid,text,text) to authenticated;

-- Keep the existing list/receipt payload contract and enrich it with the exact review link.
alter function public.customer_visit_verified_visit_payload(public.pos_tickets,public.customers)
rename to customer_visit_verified_visit_payload_before_final;
revoke all on function public.customer_visit_verified_visit_payload_before_final(public.pos_tickets,public.customers) from public,anon,authenticated;
create function public.customer_visit_verified_visit_payload(p_ticket public.pos_tickets,p_customer public.customers)
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare payload jsonb; e customer_visit_experiences;
begin
  payload:=customer_visit_verified_visit_payload_before_final(p_ticket,p_customer);
  if payload is null then return null; end if;
  select * into e from customer_visit_experiences x where x.author_user_id=p_customer.customer_user_id
    and x.salon_id=p_ticket.salon_id and (x.ticket_id=p_ticket.id
      or coalesce(x.visit_identity,visit_feedback_identity(x.ticket_id))=visit_feedback_identity(p_ticket.id)
      or visit_feedback_identity(x.ticket_id)=visit_feedback_identity(p_ticket.id)) order by x.created_at,x.id limit 1;
  return payload||jsonb_build_object('experienceId',e.id,'experienceState',e.feedback_state,
    'experienceBody',e.body,'experienceCreatedAt',e.created_at);
end $$;
revoke all on function public.customer_visit_verified_visit_payload(public.pos_tickets,public.customers) from public,anon,authenticated;

-- Salon status controls are retired, including for older clients.
create or replace function public.set_visit_experience_status(p_experience uuid,p_salon uuid,p_status text)
returns void language plpgsql security definer set search_path=public as $$
begin raise exception 'Only the customer can confirm resolution.'; end $$;

create function public.resolve_my_visit_experience(p_experience uuid) returns void
language plpgsql security definer set search_path=public as $$
declare actor uuid:=current_public_user_id(); e customer_visit_experiences;
begin
  if actor is null then raise exception 'Sign in required.'; end if;
  select * into e from customer_visit_experiences where id=p_experience and author_user_id=actor for update;
  if e.id is null or e.feedback_state<>'issue' then raise exception 'Issue not found.'; end if;
  if e.customer_resolved_at is not null then return; end if;
  if not exists(select 1 from visit_experience_replies r where r.experience_id=e.id
    and not social_users_blocked(actor,r.author_user_id)) then raise exception 'Read the salon reply before confirming resolution.'; end if;
  update customer_visit_experiences set issue_status='resolved',customer_resolved_at=now() where id=e.id;
end $$;
revoke all on function public.resolve_my_visit_experience(uuid) from public,anon;
grant execute on function public.resolve_my_visit_experience(uuid) to authenticated;

alter function public.get_my_visit_experiences(integer,integer,uuid) rename to get_my_visit_experiences_before_final;
revoke all on function public.get_my_visit_experiences_before_final(integer,integer,uuid) from public,anon,authenticated;
create function public.get_my_visit_experiences(p_limit integer default 11,p_offset integer default 0,p_experience uuid default null)
returns jsonb language sql stable security definer set search_path=public as $$
  select coalesce(jsonb_agg(item||jsonb_build_object('customer_resolved_at',e.customer_resolved_at) order by ordinal),'[]'::jsonb)
  from jsonb_array_elements(get_my_visit_experiences_before_final(p_limit,p_offset,p_experience)) with ordinality as x(item,ordinal)
  left join customer_visit_experiences e on e.id=(item->>'id')::uuid and e.author_user_id=current_public_user_id();
$$;
revoke all on function public.get_my_visit_experiences(integer,integer,uuid) from public,anon;
grant execute on function public.get_my_visit_experiences(integer,integer,uuid) to authenticated;

-- Reuse the existing trigger/preferences pipeline for BOTH good and issue feedback.
-- No email, SMS, conversation or repeated review prompts are introduced.
create or replace function public.notify_visit_experience_issue() returns trigger
language plpgsql security definer set search_path=public as $$
declare account uuid;
begin
  if tg_op<>'INSERT' then return new; end if;
  select account_id into account from locations where id=new.salon_id;
  insert into app_notifications(account_id,salon_id,recipient_user_id,recipient_kind,notification_type,title,body,href,event_key)
  select account,new.salon_id,m.user_id,'owner_manager','visit_experience_issue',
    case when new.feedback_state='issue' then 'A customer shared a concern' else 'A customer shared a good experience' end,
    'Read the customer experience and reply as the salon.','/salon-profile#customer-experiences','visit-feedback-shared:'||new.id::text
  from (select sm.user_id,sm.role_id from salon_memberships sm where sm.salon_id=new.salon_id and sm.status='active'
    union select am.user_id,am.role_id from account_memberships am where am.account_id=account and am.status='active') m
  join roles role on role.id=m.role_id
  where (upper(role.code)='OWNER' or exists(select 1 from role_permissions rp join permissions p on p.id=rp.permission_id
    where rp.role_id=m.role_id and p.code='salon_profile.content.manage'))
    and m.user_id<>new.author_user_id and not social_users_blocked(m.user_id,new.author_user_id)
  on conflict (recipient_user_id,event_key) where event_key is not null do nothing;
  return new;
end $$;

notify pgrst,'reload schema';
commit;
