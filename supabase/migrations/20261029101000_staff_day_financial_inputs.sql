begin;

-- Ticket inputs remain intact. A day correction is a cumulative difference,
-- so a later ticket edit still changes the effective gross/tip exactly once.
create table public.staff_day_financial_inputs (
  salon_id uuid not null references public.locations(id) on delete cascade,
  staff_id uuid not null references public.staff(id) on delete cascade,
  business_date date not null,
  service_delta numeric(12,2) not null default 0,
  tip_delta numeric(12,2) not null default 0,
  revision bigint not null default 0,
  primary key(salon_id,staff_id,business_date)
);
create table public.staff_day_financial_receipts (
  salon_id uuid not null references public.locations(id) on delete cascade,
  actor_id uuid not null,request_id uuid not null,payload jsonb not null,result jsonb not null,
  primary key(salon_id,actor_id,request_id)
);
create table public.payroll_setting_save_receipts (
  salon_id uuid not null references public.locations(id) on delete cascade,
  actor_id uuid not null,request_id uuid not null,payload jsonb not null,result jsonb not null,
  primary key(salon_id,actor_id,request_id)
);
alter table public.staff_day_financial_inputs enable row level security;
alter table public.staff_day_financial_receipts enable row level security;
alter table public.payroll_setting_save_receipts enable row level security;
revoke all on public.staff_day_financial_inputs,public.staff_day_financial_receipts,public.payroll_setting_save_receipts from public,anon,authenticated;

create function public.effective_staff_day_inputs_core(p_salon uuid,p_date date)
returns table(staff_id uuid,service_total numeric,tip_amount numeric)
language sql stable security definer set search_path=pg_catalog,public as $$
    with sources as (
      select e.staff_id,sum(e.service_total) service_total,sum(e.tip_amount) tip_amount
      from public.pos_ticket_staff_earnings e where e.salon_id=p_salon and e.work_date=p_date group by e.staff_id
    ), ids as (select s.staff_id from sources s union select d.staff_id from public.staff_day_financial_inputs d where d.salon_id=p_salon and d.business_date=p_date)
    select i.staff_id,coalesce(s.service_total,0)+coalesce(d.service_delta,0),coalesce(s.tip_amount,0)+coalesce(d.tip_delta,0)
    from ids i left join sources s on s.staff_id=i.staff_id left join public.staff_day_financial_inputs d on d.salon_id=p_salon and d.business_date=p_date and d.staff_id=i.staff_id
    ;
$$;
revoke all on function public.effective_staff_day_inputs_core(uuid,date) from public,anon,authenticated;

create function public.effective_staff_day_inputs(p_salon uuid,p_date date)
returns table(staff_id uuid,service_total numeric,tip_amount numeric)
language plpgsql stable security definer set search_path=pg_catalog,public as $$
declare all_staff boolean; own_staff uuid;
begin
  all_staff:=coalesce(public.payroll_live_is_owner(p_salon),false) or (
    coalesce(public.user_has_salon_permission(p_salon,array['reports.view','payroll.view','payroll.manage']),false)
    and (exists(select 1 from public.locations l join public.account_memberships m on m.account_id=l.account_id join public.roles r on r.id=m.role_id where l.id=p_salon and m.user_id=public.current_public_user_id() and m.status='active' and r.code<>'STAFF')
      or exists(select 1 from public.salon_memberships m join public.roles r on r.id=m.role_id where m.salon_id=p_salon and m.user_id=public.current_public_user_id() and m.status='active' and r.code<>'STAFF')));
  own_staff:=public.current_user_staff_id_for_salon(p_salon);
  if public.current_public_user_id() is null or (not all_staff and own_staff is null) then raise exception 'Not authorized' using errcode='42501'; end if;
  return query select e.staff_id,e.service_total,e.tip_amount from public.effective_staff_day_inputs_core(p_salon,p_date) e where all_staff or e.staff_id=own_staff;
end; $$;
revoke all on function public.effective_staff_day_inputs(uuid,date) from public,anon;
grant execute on function public.effective_staff_day_inputs(uuid,date) to authenticated;

create function public.effective_staff_day_inputs_range(p_salon uuid,p_start date,p_end date)
returns table(staff_id uuid,work_date date,service_total numeric,tip_amount numeric,tip_is_manual boolean)
language plpgsql stable security definer set search_path=pg_catalog,public as $$
begin
  if p_start is null or p_end is null or p_end<p_start or p_end-p_start>366 then raise exception 'Choose up to one year of staff inputs' using errcode='22023'; end if;
  return query select e.staff_id,d.day::date,e.service_total,e.tip_amount,
    exists(select 1 from public.pos_ticket_staff_earnings t where t.salon_id=p_salon and t.work_date=d.day::date and t.staff_id=e.staff_id and t.tip_is_manual)
    from generate_series(p_start::timestamp,p_end::timestamp,interval '1 day') d(day)
    cross join lateral public.effective_staff_day_inputs(p_salon,d.day::date) e;
end; $$;
revoke all on function public.effective_staff_day_inputs_range(uuid,date,date) from public,anon;
grant execute on function public.effective_staff_day_inputs_range(uuid,date,date) to authenticated;

create function public.read_staff_day_financial_input(p_salon uuid,p_staff uuid,p_date date) returns jsonb
language plpgsql stable security definer set search_path=pg_catalog,public as $$
declare amounts record; version bigint;
begin
  if not public.payroll_live_is_owner(p_salon) then raise exception 'Only the Owner can edit staff day inputs' using errcode='42501'; end if;
  if not exists(select 1 from public.staff where id=p_staff and salon_id=p_salon) then raise exception 'Staff is outside this salon' using errcode='22023'; end if;
  select * into amounts from public.effective_staff_day_inputs(p_salon,p_date) e where e.staff_id=p_staff;
  select revision into version from public.staff_day_financial_inputs where salon_id=p_salon and staff_id=p_staff and business_date=p_date;
  return jsonb_build_object('revision',coalesce(version,0),'service_total',coalesce(amounts.service_total,0),'tip_amount',coalesce(amounts.tip_amount,0));
end; $$;
revoke all on function public.read_staff_day_financial_input(uuid,uuid,date) from public,anon;
grant execute on function public.read_staff_day_financial_input(uuid,uuid,date) to authenticated;

create function public.save_staff_day_financial_input(p_salon uuid,p_staff uuid,p_date date,p_request uuid,p_revision bigint,p_expected_service numeric,p_expected_tip numeric,p_service numeric,p_tip numeric,p_note text) returns jsonb
language plpgsql security definer set search_path=pg_catalog,public as $$
declare actor uuid:=public.current_public_user_id(); previous public.staff_day_financial_receipts%rowtype; payload jsonb; current_state jsonb; before_values jsonb; after_values jsonb; event_id uuid; result jsonb;
begin
  if not public.payroll_live_is_owner(p_salon) then raise exception 'Only the Owner can edit staff day inputs' using errcode='42501'; end if;
  if p_date is null or p_date>public.get_salon_business_date(p_salon) or p_request is null or p_revision is null or p_revision<0
    or p_service is null or p_tip is null or p_service<0 or p_tip<0 or p_service>9999999999.99 or p_tip>9999999999.99
    or p_service<>round(p_service,2) or p_tip<>round(p_tip,2) or p_expected_service is null or p_expected_tip is null
    or p_expected_service<>round(p_expected_service,2) or p_expected_tip<>round(p_expected_tip,2)
    or p_note is null or length(btrim(p_note)) not between 3 and 1000 then raise exception 'Enter valid gross service, tip, business date and a note' using errcode='22023'; end if;
  payload:=jsonb_build_object('staff',p_staff,'date',p_date,'revision',p_revision,'expectedService',p_expected_service,'expectedTip',p_expected_tip,'service',p_service,'tip',p_tip,'note',btrim(p_note));
  perform pg_advisory_xact_lock(hashtextextended('staff-day-request:'||p_salon::text||actor::text||p_request::text,0));
  select * into previous from public.staff_day_financial_receipts where salon_id=p_salon and actor_id=actor and request_id=p_request;
  if found then
    if previous.payload<>payload then raise exception 'Request ID already used for different values' using errcode='22023'; end if;
    return previous.result;
  end if;
  perform pg_advisory_xact_lock(hashtextextended('staff-day-input:'||p_salon::text||':'||p_date::text,0));
  current_state:=public.read_staff_day_financial_input(p_salon,p_staff,p_date);
  if (current_state->>'revision')::bigint<>p_revision or (current_state->>'service_total')::numeric<>p_expected_service or (current_state->>'tip_amount')::numeric<>p_expected_tip then raise exception 'Staff day changed. Reload before saving.' using errcode='PT409'; end if;
  before_values:=jsonb_build_object('service_total',p_expected_service,'tip_amount',p_expected_tip);
  after_values:=jsonb_build_object('service_total',p_service,'tip_amount',p_tip);
  if before_values<>after_values then
    insert into public.staff_day_financial_inputs(salon_id,staff_id,business_date,service_delta,tip_delta,revision)
    values(p_salon,p_staff,p_date,p_service-p_expected_service,p_tip-p_expected_tip,1)
    on conflict(salon_id,staff_id,business_date) do update set service_delta=staff_day_financial_inputs.service_delta+excluded.service_delta,tip_delta=staff_day_financial_inputs.tip_delta+excluded.tip_delta,revision=staff_day_financial_inputs.revision+1;
    event_id:=public.record_financial_input_event(p_salon,'staff_day',p_date,p_staff,before_values,after_values,btrim(p_note),jsonb_build_array(jsonb_build_object('staff_id',p_staff,'before_values',before_values,'after_values',after_values)),p_request,true);
    if to_regprocedure('public.reconcile_daily_inputs(uuid,date)') is not null then
      execute 'select public.reconcile_daily_inputs($1,$2)' using p_salon,p_date;
    end if;
  end if;
  result:=jsonb_build_object('changed',before_values<>after_values,'eventId',event_id,'current',public.read_staff_day_financial_input(p_salon,p_staff,p_date));
  insert into public.staff_day_financial_receipts values(p_salon,actor,p_request,payload,result);
  return result;
end; $$;
revoke all on function public.save_staff_day_financial_input(uuid,uuid,date,uuid,bigint,numeric,numeric,numeric,numeric,text) from public,anon;
grant execute on function public.save_staff_day_financial_input(uuid,uuid,date,uuid,bigint,numeric,numeric,numeric,numeric,text) to authenticated;

-- Wrap the existing effective-date validator/optimistic guard. One configuration
-- action gets one event, even when it closes an old interval and inserts a new one.
create function public.save_owner_payroll_setting_with_notice(p_salon uuid,p_staff uuid,p_effective date,p_values jsonb,p_expected_id uuid,p_expected_updated_at timestamptz,p_request uuid,p_notify_staff boolean default false) returns jsonb
language plpgsql security definer set search_path=pg_catalog,public as $$
declare actor uuid:=public.current_public_user_id(); previous public.payroll_setting_save_receipts%rowtype; payload jsonb; before_values jsonb; after_values jsonb; saved jsonb;
begin
  if not public.payroll_live_is_owner(p_salon) then raise exception 'Only the Owner can change payroll settings' using errcode='42501'; end if;
  if p_request is null or p_notify_staff is null then raise exception 'Reopen payroll settings before saving' using errcode='22023'; end if;
  payload:=jsonb_build_object('staff',p_staff,'effective',p_effective,'values',p_values,'expectedId',p_expected_id,'expectedAt',p_expected_updated_at,'notify',p_notify_staff);
  perform pg_advisory_xact_lock(hashtextextended('payroll-setting-request:'||p_salon::text||actor::text||p_request::text,0));
  select * into previous from public.payroll_setting_save_receipts where salon_id=p_salon and actor_id=actor and request_id=p_request;
  if found then
    if previous.payload<>payload then raise exception 'Request ID already used for different settings' using errcode='22023'; end if;
    return previous.result;
  end if;
  perform pg_advisory_xact_lock(hashtextextended('payroll-setting:'||p_salon::text||p_staff::text,0));
  select to_jsonb(s)-array['id','salon_id','staff_id','created_at','updated_at'] into before_values from public.staff_payroll_settings s where s.id=p_expected_id and s.salon_id=p_salon and s.staff_id=p_staff;
  saved:=public.save_owner_live_payroll_setting(p_salon,p_staff,p_effective,p_values,p_expected_id,p_expected_updated_at);
  after_values:=saved-array['id','salon_id','staff_id','created_at','updated_at'];
  if coalesce(before_values,'{}')<>after_values then
    perform public.record_financial_input_event(p_salon,'payroll_settings',p_effective,(saved->>'id')::uuid,coalesce(before_values,'{}'),after_values,'Payroll settings updated',jsonb_build_array(jsonb_build_object('staff_id',p_staff,'before_values',coalesce(before_values,'{}'),'after_values',after_values)),p_request,p_notify_staff);
  end if;
  insert into public.payroll_setting_save_receipts values(p_salon,actor,p_request,payload,saved);
  return saved;
end; $$;
revoke all on function public.save_owner_payroll_setting_with_notice(uuid,uuid,date,jsonb,uuid,timestamptz,uuid,boolean) from public,anon;
grant execute on function public.save_owner_payroll_setting_with_notice(uuid,uuid,date,jsonb,uuid,timestamptz,uuid,boolean) to authenticated;

-- All settings writes go through the logical save wrapper. Its definer context
-- can call the old validator, while a direct client cannot bypass event/notice.
revoke all on function public.save_owner_live_payroll_setting(uuid,uuid,date,jsonb,uuid,timestamptz) from public,anon,authenticated;
create function public.guard_payroll_setting_direct_write() returns trigger
language plpgsql set search_path=pg_catalog as $$
begin
 if current_user in ('authenticated','anon') then raise exception 'Save payroll settings through the Owner settings form' using errcode='42501'; end if;
 if tg_op='DELETE' then return old; end if;return new;
end; $$;
create trigger payroll_setting_logical_save_only before insert or update or delete on public.staff_payroll_settings for each row execute function public.guard_payroll_setting_direct_write();

-- Retain historical bases, adjustments and actual payment records as evidence.
-- Old clients must not turn calculated payroll outputs into manual inputs.
create or replace function public.create_payroll_owner_adjustment(p_base uuid,p_staff uuid,p_expected_revision integer,p_request uuid,p_values jsonb,p_reason text)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
begin
  raise exception 'Commission, tax, cash, check and take-home amounts are calculated. Edit staff gross/tip inputs or effective pay settings.' using errcode='42501';
end; $$;
revoke all on function public.create_payroll_owner_adjustment(uuid,uuid,integer,uuid,jsonb,text) from public,anon,authenticated;
commit;
