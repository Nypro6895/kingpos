begin;

-- One committed business operation, with privacy-safe projections for each Staff.
-- History never participates in financial summation.
create table public.financial_input_events (
  id uuid primary key default gen_random_uuid(),
  salon_id uuid not null references public.locations(id),
  kind text not null check(kind in ('ticket','staff_day','daily_report','payroll_settings')),
  business_date date not null,
  source_id uuid,
  request_id uuid,
  before_values jsonb not null,
  after_values jsonb not null,
  note text not null default '',
  actor_id uuid references public.users(id) on delete set null,
  actor_name text not null,
  created_at timestamptz not null default clock_timestamp(),
  unique(salon_id,kind,request_id)
);
create index financial_input_events_date on public.financial_input_events(salon_id,business_date,created_at desc,id);
create index financial_input_events_activity on public.financial_input_events(salon_id,created_at desc,id);
create table public.financial_input_event_staff (
  event_id uuid not null references public.financial_input_events(id),
  salon_id uuid not null references public.locations(id),
  staff_id uuid not null,
  staff_name text not null,
  kind text not null,
  business_date date not null,
  before_values jsonb not null,
  after_values jsonb not null,
  note text not null,
  actor_name text not null,
  created_at timestamptz not null,
  primary key(event_id,staff_id)
);
create index financial_input_event_staff_scope on public.financial_input_event_staff(salon_id,staff_id,business_date,created_at desc);
create table public.financial_input_history_cutover (
  singleton boolean primary key default true check(singleton),
  cutover_at timestamptz not null default clock_timestamp()
);
insert into public.financial_input_history_cutover(singleton) values(true);

alter table public.financial_input_events enable row level security;
alter table public.financial_input_event_staff enable row level security;
alter table public.financial_input_history_cutover enable row level security;
revoke all on public.financial_input_events, public.financial_input_event_staff, public.financial_input_history_cutover from public,anon,authenticated;
grant select on public.financial_input_events,public.financial_input_event_staff,public.financial_input_history_cutover to authenticated;
create policy financial_input_cutover_read on public.financial_input_history_cutover for select to authenticated using(true);
create function public.financial_input_manager_can_read(p_salon uuid,p_kind text) returns boolean
language sql stable security definer set search_path=pg_catalog,public as $$
 select (
   exists(select 1 from public.locations l join public.account_memberships m on m.account_id=l.account_id join public.roles r on r.id=m.role_id
     where l.id=p_salon and m.user_id=public.current_public_user_id() and m.status='active' and r.code<>'STAFF')
   or exists(select 1 from public.salon_memberships m join public.roles r on r.id=m.role_id
     where m.salon_id=p_salon and m.user_id=public.current_public_user_id() and m.status='active' and r.code<>'STAFF')
 ) and (
   (p_kind='ticket' and public.user_has_salon_permission(p_salon,array['tickets.view','reports.view','payroll.view','payroll.manage']))
   or (p_kind in ('staff_day','daily_report') and public.user_has_salon_permission(p_salon,array['reports.view','payroll.view','payroll.manage']))
   or (p_kind='payroll_settings' and public.user_has_salon_permission(p_salon,array['payroll.view','payroll.manage']))
 );
$$;
revoke all on function public.financial_input_manager_can_read(uuid,text) from public,anon;
grant execute on function public.financial_input_manager_can_read(uuid,text) to authenticated;
create policy financial_input_owner_read on public.financial_input_events for select to authenticated using (
  public.payroll_live_is_owner(salon_id)
  or public.financial_input_manager_can_read(salon_id,kind)
);
create policy financial_input_staff_read on public.financial_input_event_staff for select to authenticated using (
  staff_id=public.current_user_staff_id_for_salon(salon_id)
  or public.payroll_live_is_owner(salon_id)
  or public.financial_input_manager_can_read(salon_id,kind)
);

create function public.guard_financial_input_history() returns trigger
language plpgsql set search_path=pg_catalog as $$
begin
  -- Permit only the referential cleanup performed while an actor account is
  -- erased. The captured business identity and every financial fact survive.
  if tg_table_name='financial_input_events' and tg_op='UPDATE' and pg_trigger_depth()>1
    and old.actor_id is not null and new.actor_id is null
    and (to_jsonb(old)-'actor_id')=(to_jsonb(new)-'actor_id')
    and not exists(select 1 from public.users where id=old.actor_id) then return new; end if;
  raise exception 'Financial history is immutable';
end; $$;
create trigger financial_input_events_immutable before update or delete on public.financial_input_events for each row execute function public.guard_financial_input_history();
create trigger financial_input_staff_immutable before update or delete on public.financial_input_event_staff for each row execute function public.guard_financial_input_history();

create function public.record_financial_input_event(
  p_salon uuid,p_kind text,p_business_date date,p_source_id uuid,p_before jsonb,p_after jsonb,p_note text,
  p_staff_changes jsonb default '[]',p_request uuid default null,p_notify_staff boolean default true
) returns uuid language plpgsql security definer set search_path=pg_catalog,public as $$
declare ev public.financial_input_events%rowtype; actor uuid:=public.current_public_user_id();
  actor_label text; item jsonb; staff_key uuid; staff_label text; recipient uuid; link text;
begin
  if p_kind not in ('ticket','staff_day','daily_report','payroll_settings') or p_business_date is null
    or p_salon is null or jsonb_typeof(p_before)<>'object' or jsonb_typeof(p_after)<>'object'
    or jsonb_typeof(p_staff_changes)<>'array' then raise exception 'Invalid financial event'; end if;
  if p_request is not null then
    perform pg_advisory_xact_lock(hashtextextended(p_salon::text||':'||p_kind||':'||p_request::text,0));
    select * into ev from financial_input_events where salon_id=p_salon and kind=p_kind and request_id=p_request;
    if found then
      if ev.source_id is distinct from p_source_id or ev.after_values<>p_after or ev.note<>btrim(coalesce(p_note,'')) then
        raise exception 'This request belongs to a different financial event';
      end if;
      return ev.id;
    end if;
  end if;
  if p_before=p_after then return null; end if;
  select coalesce(nullif(btrim(u.display_name),''),'Owner') into actor_label from public.users u where u.id=actor;
  actor_label:=coalesce(actor_label,case when p_kind='ticket' then 'POS'
    when p_kind='daily_report' and current_setting('reylumi.signed_closing_salon',true)=p_salon::text then 'Portable POS'
    else 'System' end);
  insert into financial_input_events(salon_id,kind,business_date,source_id,request_id,before_values,after_values,note,actor_id,actor_name)
    values(p_salon,p_kind,p_business_date,p_source_id,p_request,p_before,p_after,btrim(coalesce(p_note,'')),actor,actor_label) returning * into ev;
  for item in select value from jsonb_array_elements(p_staff_changes) loop
    staff_key:=(item->>'staff_id')::uuid;
    select coalesce(nullif(s.display_name,''),'Staff'),s.account_user_id into staff_label,recipient
      from public.staff s where s.id=staff_key and s.salon_id=p_salon;
    if not found then raise exception 'Financial event Staff is outside the salon'; end if;
    if jsonb_typeof(item->'before_values')<>'object' or jsonb_typeof(item->'after_values')<>'object' then raise exception 'Invalid Staff event values'; end if;
    insert into financial_input_event_staff(event_id,salon_id,staff_id,staff_name,kind,business_date,before_values,after_values,note,actor_name,created_at)
      values(ev.id,p_salon,staff_key,staff_label,p_kind,p_business_date,item->'before_values',item->'after_values',ev.note,ev.actor_name,ev.created_at)
      on conflict(event_id,staff_id) do nothing;
    if p_notify_staff and recipient is not null then
      link:=case when p_kind='ticket' then '/staff/my-work?eventDate='||p_business_date::text||'#input-history'
        else '/staff/my-work?tab=payroll&payPeriodStart='||p_business_date::text||'#input-history' end;
      insert into public.app_notifications(account_id,salon_id,recipient_user_id,recipient_kind,notification_type,title,body,href,event_key)
        select l.account_id,p_salon,recipient,'staff','financial_input_updated',
          case p_kind when 'ticket' then 'Ticket updated' when 'staff_day' then 'Daily inputs updated' else 'Pay settings updated' end,
          'Business date '||p_business_date::text||'. View the recorded inputs and note.',link,'financial-input:'||ev.id::text||':'||staff_key::text
        from public.locations l where l.id=p_salon on conflict do nothing;
    end if;
  end loop;
  if p_kind='ticket' then
    insert into public.app_notifications(account_id,salon_id,recipient_user_id,recipient_kind,notification_type,title,body,href,event_key)
      select distinct l.account_id,p_salon,m.user_id,'owner_manager','financial_input_updated','Ticket updated',
        'Business date '||p_business_date::text||'. View the recorded inputs and note.',
        '/staff/today?eventDate='||p_business_date::text||'#input-history','financial-input-owner:'||ev.id::text||':'||m.user_id::text
      from public.locations l join public.account_memberships m on m.account_id=l.account_id
        join public.roles r on r.id=m.role_id
      where l.id=p_salon and m.status='active' and r.code='OWNER' on conflict do nothing;
  end if;
  return ev.id;
end; $$;
revoke all on function public.record_financial_input_event(uuid,text,date,uuid,jsonb,jsonb,text,jsonb,uuid,boolean) from public,anon,authenticated;
revoke all on function public.guard_financial_input_history() from public,anon,authenticated;

-- Retain earlier raw audits. Explicit operation writers now own ticket/closing
-- events and delivery; rebuilding earning rows must never create notifications.
create or replace function public.audit_payroll_live_change() returns trigger
language plpgsql security definer set search_path=pg_catalog,public as $$
declare b jsonb:='{}'; a jsonb:='{}'; fields text[]; sid uuid; old_staff uuid; new_staff uuid;
  recipient_staff uuid; starts date; ends date; record_id uuid; audit_id uuid;
begin
  if tg_table_name in ('pos_ticket_staff_earnings','pos_daily_closings') then
    if tg_op='DELETE' then return old; else return new; end if;
  end if;
  if tg_op<>'INSERT' then b:=to_jsonb(old); end if;
  if tg_op<>'DELETE' then a:=to_jsonb(new); end if;
  sid:=coalesce((a->>'salon_id')::uuid,(b->>'salon_id')::uuid);
  record_id:=coalesce((a->>'id')::uuid,(b->>'id')::uuid);
  if tg_op='UPDATE' and (a->>'salon_id' is distinct from b->>'salon_id' or a->>'id' is distinct from b->>'id') then
    raise exception 'Financial record scope cannot change'; end if;
  if tg_table_name='payroll_period_staff_inputs' then
    if tg_op='UPDATE' and (a->>'period_start' is distinct from b->>'period_start' or a->>'period_end' is distinct from b->>'period_end' or a->>'cycle_type' is distinct from b->>'cycle_type') then raise exception 'Financial record scope cannot change'; end if;
    fields:=array['bonus_amount','check_number','note'];
    starts:=coalesce((a->>'period_start')::date,(b->>'period_start')::date);ends:=coalesce((a->>'period_end')::date,(b->>'period_end')::date);
  elsif tg_table_name='salon_payroll_settings' then
    fields:=array['cycle_type','biweekly_anchor_date'];starts:='0001-01-01';ends:='9999-12-31';
  else
    fields:=array['pay_type','commission_rate','fixed_pay_amount','check_rate','tax_rate','apply_tax_to_fixed_pay','tax_tips','tax_bonus','tip_payout_method','bonus_payout_method','cash_to_tax_company','tax_company_enabled','legal_name','effective_from','effective_to'];
    starts:=least(coalesce((a->>'effective_from')::date,(b->>'effective_from')::date),coalesce((b->>'effective_from')::date,(a->>'effective_from')::date));
    ends:=greatest(coalesce((a->>'effective_to')::date,'9999-12-31'::date),coalesce((b->>'effective_to')::date,'9999-12-31'::date));
  end if;
  old_staff:=(b->>'staff_id')::uuid;new_staff:=(a->>'staff_id')::uuid;
  select coalesce(jsonb_object_agg(key,value),'{}') into b from jsonb_each(b) where key=any(fields);
  select coalesce(jsonb_object_agg(key,value),'{}') into a from jsonb_each(a) where key=any(fields);
  if a=b and old_staff is not distinct from new_staff then if tg_op='DELETE' then return old; else return new; end if; end if;
  if not public.payroll_live_is_owner(sid) then raise exception 'Only the Owner can change financial inputs' using errcode='42501'; end if;
  for recipient_staff in select distinct x from unnest(array[old_staff,new_staff]) x where x is not null loop
    insert into public.payroll_live_change_history(salon_id,staff_id,staff_snapshot,source_table,source_id,period_start,period_end,before_values,after_values,actor_id)
      values(sid,recipient_staff,(select jsonb_build_object('id',s.id,'displayName',s.display_name) from public.staff s where s.id=recipient_staff),tg_table_name,record_id,starts,ends,
      case when old_staff=recipient_staff then b else '{}' end,case when new_staff=recipient_staff then a else '{}' end,public.current_public_user_id()) returning id into audit_id;
    -- Existing period bonus inputs remain a logical save; keep their notification
    -- without restoring row-level ticket or automatic settings delivery.
    if tg_table_name='payroll_period_staff_inputs' and b->'bonus_amount' is distinct from a->'bonus_amount' then
      insert into public.app_notifications(account_id,salon_id,recipient_user_id,recipient_kind,notification_type,title,body,href,event_key)
        select l.account_id,sid,s.account_user_id,'staff','financial_input_updated','Payroll inputs updated',
          'Your period inputs changed. View the recorded values and note.',
          '/staff/my-work?tab=payroll&payPeriodStart='||starts::text||'#input-history','period-input:'||audit_id::text
        from public.locations l join public.staff s on s.salon_id=l.id where l.id=sid and s.id=recipient_staff and s.account_user_id is not null on conflict do nothing;
    end if;
  end loop;
  if old_staff is null and new_staff is null then
    insert into public.payroll_live_change_history(salon_id,source_table,source_id,period_start,period_end,before_values,after_values,actor_id)
      values(sid,tg_table_name,record_id,starts,ends,b,a,public.current_public_user_id());
  end if;
  if tg_op='DELETE' then return old; else return new; end if;
end; $$;

commit;
