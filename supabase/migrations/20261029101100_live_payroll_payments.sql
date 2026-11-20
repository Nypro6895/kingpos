begin;

-- Actual payments are append-only facts of their original source period. No
-- calculated income or frozen payroll base is created by recording a payment.
create table public.payroll_live_recorded_payments (
 id uuid primary key default gen_random_uuid(),
 salon_id uuid not null references public.locations(id),staff_id uuid not null,
 period_start date not null,period_end date not null,cycle_type text not null,
 request_id uuid not null,actor_id uuid not null,revision bigint not null,
 cash_amount numeric(12,2) not null,check_amount numeric(12,2) not null,
 paid_at timestamptz not null,recorded_at timestamptz not null default clock_timestamp(),note text not null,
 unique(salon_id,request_id),unique(salon_id,period_start,period_end,revision),
 check(period_end>=period_start and cash_amount>=0 and check_amount>=0 and cash_amount+check_amount>0)
);
create index payroll_live_payment_staff_period on public.payroll_live_recorded_payments(salon_id,staff_id,period_start,period_end);
alter table public.payroll_live_recorded_payments enable row level security;
revoke all on public.payroll_live_recorded_payments from public,anon,authenticated;
grant select on public.payroll_live_recorded_payments to authenticated;

create function public.payroll_payment_can_read_all(p_salon uuid) returns boolean
language sql stable security definer set search_path=pg_catalog,public as $$
 select coalesce(public.payroll_live_is_owner(p_salon),false)
  or (coalesce(public.user_has_salon_permission(p_salon,array['payroll.view','payroll.manage','payroll.tax_company']),false)
   and (exists(select 1 from public.locations l join public.account_memberships m on m.account_id=l.account_id join public.roles r on r.id=m.role_id where l.id=p_salon and m.user_id=public.current_public_user_id() and m.status='active' and r.code<>'STAFF')
     or exists(select 1 from public.salon_memberships m join public.roles r on r.id=m.role_id where m.salon_id=p_salon and m.user_id=public.current_public_user_id() and m.status='active' and r.code<>'STAFF')))
 ;
$$;
revoke all on function public.payroll_payment_can_read_all(uuid) from public,anon;
grant execute on function public.payroll_payment_can_read_all(uuid) to authenticated;
create policy payroll_live_payment_read on public.payroll_live_recorded_payments for select to authenticated using(
 public.payroll_payment_can_read_all(salon_id) or staff_id=public.current_user_staff_id_for_salon(salon_id)
);
create function public.guard_payroll_live_payment() returns trigger language plpgsql set search_path=pg_catalog as $$
begin raise exception 'Recorded payroll payments are immutable'; end; $$;
create trigger payroll_live_payment_immutable before update or delete on public.payroll_live_recorded_payments for each row execute function public.guard_payroll_live_payment();

create function public.payroll_payment_period_cycle(p_salon uuid,p_start date,p_end date) returns text
language plpgsql stable security definer set search_path=pg_catalog,public as $$
declare cycle text; anchor date; scheduled record;
begin
 if p_start is null or p_end is null or p_end<p_start or p_end-p_start>366 then return null; end if;
 select b.cycle_type into cycle from public.payroll_period_bases b where b.salon_id=p_salon and b.period_start=p_start and b.period_end=p_end;
 if found then return cycle; end if;
 select p.cycle_type into cycle from public.payroll_live_recorded_payments p where p.salon_id=p_salon and p.period_start=p_start and p.period_end=p_end limit 1;
 if found then return cycle; end if;
 select coalesce(s.cycle_type,'monthly'),s.biweekly_anchor_date into cycle,anchor from public.locations l left join public.salon_payroll_settings s on s.salon_id=l.id where l.id=p_salon;
 if not found or cycle not in ('monthly','semi_monthly','biweekly') or (cycle='biweekly' and anchor is null) then return null; end if;
 select * into scheduled from public.payroll_calendar_period(p_start,cycle,anchor);
 if scheduled.start_date=p_start and scheduled.end_date=p_end then return cycle; end if;
 return null;
end; $$;
revoke all on function public.payroll_payment_period_cycle(uuid,date,date) from public,anon,authenticated;

-- Keep the old read contract for existing clients, but Staff is always restricted
-- to its uniquely linked active profile, even if its role has payroll permission.
alter function public.read_payroll_period_ledger(uuid,date,date) rename to read_payroll_period_ledger_before_live_payments;
revoke all on function public.read_payroll_period_ledger_before_live_payments(uuid,date,date) from public,anon,authenticated,service_role;
create function public.read_payroll_period_ledger(p_salon uuid,p_start date,p_end date) returns jsonb
language plpgsql stable security definer set search_path=pg_catalog,public as $$
declare result jsonb; own_staff uuid; all_staff boolean; external_tax boolean; payments jsonb; additions integer;
begin
 all_staff:=public.payroll_payment_can_read_all(p_salon);own_staff:=public.current_user_staff_id_for_salon(p_salon);
 external_tax:=coalesce(public.tax_company_has_access(p_salon),false) and own_staff is null and not all_staff;
 if public.current_public_user_id() is null or (not all_staff and own_staff is null and not external_tax) then raise exception 'Payroll access is not available' using errcode='42501'; end if;
 result:=public.read_payroll_period_ledger_before_live_payments(p_salon,p_start,p_end);
 -- Preserve the pre-existing legacy read contract without exposing newly
 -- recorded private live-period receipts through a Tax Company connection.
 if external_tax then return result||jsonb_build_object('canAdjust',false); end if;
 if not all_staff then
  result:=result||jsonb_build_object(
   'lines',coalesce((select jsonb_agg(v) from jsonb_array_elements(coalesce(result->'lines','[]')) v where v->>'staff_id'=own_staff::text),'[]'),
   'adjustments',coalesce((select jsonb_agg(v) from jsonb_array_elements(coalesce(result->'adjustments','[]')) v where v->>'staff_id'=own_staff::text),'[]'),
   'payments',coalesce((select jsonb_agg(v) from jsonb_array_elements(coalesce(result->'payments','[]')) v where v->>'staff_id'=own_staff::text),'[]'),
   'shopDailyRows','[]'::jsonb,
   'legacyPaidHistory',coalesce((select jsonb_agg(v) from jsonb_array_elements(coalesce(result->'legacyPaidHistory','[]')) v where exists(select 1 from public.payroll_staff_lines l where l.payroll_run_id=(v->>'runId')::uuid and l.staff_id=own_staff)),'[]'));
 end if;
 select coalesce(jsonb_agg(to_jsonb(p)||jsonb_build_object('revision_at_payment',p.revision-1) order by p.paid_at,p.recorded_at,p.id),'[]') into payments from public.payroll_live_recorded_payments p where p.salon_id=p_salon and p.period_start=p_start and p.period_end=p_end and (all_staff or p.staff_id=own_staff);
 select count(*) into additions from public.payroll_live_recorded_payments p where p.salon_id=p_salon and p.period_start=p_start and p.period_end=p_end;
 return result||jsonb_build_object('canAdjust',false,'payments',coalesce(result->'payments','[]')||payments,'revision',coalesce((result->>'revision')::integer,0)+additions);
end; $$;
revoke all on function public.read_payroll_period_ledger(uuid,date,date) from public,anon;
grant execute on function public.read_payroll_period_ledger(uuid,date,date) to authenticated;

create function public.read_live_payroll_recorded_facts(p_salon uuid,p_start date,p_end date) returns jsonb
language plpgsql stable security definer set search_path=pg_catalog,public as $$
declare cycle text; periods jsonb;
begin
 if p_start is null or p_end is null or p_end<p_start or p_end-p_start>366 then raise exception 'Choose a report range of up to one year'; end if;
 if public.current_public_user_id() is null or (not public.payroll_payment_can_read_all(p_salon) and public.current_user_staff_id_for_salon(p_salon) is null) then raise exception 'Live payroll payment access is not available' using errcode='42501'; end if;
 perform public.read_payroll_period_ledger(p_salon,p_start,p_end);
 cycle:=public.payroll_payment_period_cycle(p_salon,p_start,p_end);
 with sources as (
  select b.period_start,b.period_end,b.cycle_type::text from public.payroll_period_bases b where b.salon_id=p_salon and b.period_start<=p_end and b.period_end>=p_start
  union select p.period_start,p.period_end,p.cycle_type from public.payroll_live_recorded_payments p where p.salon_id=p_salon and p.period_start<=p_end and p.period_end>=p_start
  union select p_start,p_end,cycle where cycle is not null
 ) select coalesce(jsonb_agg(public.read_payroll_period_ledger(p_salon,s.period_start,s.period_end)||jsonb_build_object('sourcePeriod',jsonb_build_object('start',s.period_start,'end',s.period_end,'cycle',s.cycle_type)) order by s.period_start,s.period_end),'[]') into periods from sources s;
 return jsonb_build_object('periods',periods,'selection',jsonb_build_object('start',p_start,'end',p_end,'exact',cycle is not null));
end; $$;
revoke all on function public.read_live_payroll_recorded_facts(uuid,date,date) from public,anon;
grant execute on function public.read_live_payroll_recorded_facts(uuid,date,date) to authenticated;

create function public.record_live_payroll_payment(p_salon uuid,p_staff uuid,p_start date,p_end date,p_request uuid,p_expected_revision integer,p_cash numeric,p_check numeric,p_paid_at timestamptz,p_note text) returns jsonb
language plpgsql security definer set search_path=pg_catalog,public as $$
declare actor uuid:=public.current_public_user_id(); cycle text; previous public.payroll_live_recorded_payments%rowtype; legacy public.payroll_recorded_payments%rowtype; original public.payroll_period_bases%rowtype; version integer; live_count integer;
begin
 if not coalesce(public.payroll_live_is_owner(p_salon),false) then raise exception 'Only the current salon Owner can record payroll payment' using errcode='42501'; end if;
 if p_staff is null or p_start is null or p_end is null or p_request is null or p_expected_revision is null or p_expected_revision<0 or p_cash is null or p_check is null or abs(p_cash)>9999999999.99 or abs(p_check)>9999999999.99 or p_cash<0 or p_check<0 or p_cash+p_check<=0 or p_cash<>round(p_cash,2) or p_check<>round(p_check,2) or p_paid_at is null or not isfinite(p_paid_at) or p_paid_at>clock_timestamp() or p_note is null or length(btrim(p_note)) not between 3 and 1000 then raise exception 'Enter the actual cash/check amounts, payment date and note' using errcode='22023'; end if;
 perform pg_advisory_xact_lock(hashtextextended('payroll-payment-request:'||p_salon::text||':'||p_request::text,0));
 select * into previous from public.payroll_live_recorded_payments p where p.salon_id=p_salon and p.request_id=p_request;
 if found then
  if previous.staff_id<>p_staff or previous.period_start<>p_start or previous.period_end<>p_end or previous.actor_id<>actor or previous.cash_amount<>p_cash or previous.check_amount<>p_check or previous.paid_at<>p_paid_at or previous.note<>btrim(p_note) then raise exception 'This request ID belongs to a different payment' using errcode='22023'; end if;
  return to_jsonb(previous);
 end if;
 select * into legacy from public.payroll_recorded_payments p where p.salon_id=p_salon and p.request_id=p_request;
 if found then
  select * into original from public.payroll_period_bases b where b.id=legacy.base_id;
  if original.period_start<>p_start or original.period_end<>p_end or legacy.staff_id<>p_staff or legacy.actor_id<>actor or legacy.cash_amount<>p_cash or legacy.check_amount<>p_check or legacy.paid_at<>p_paid_at or legacy.note<>btrim(p_note) then raise exception 'This request ID belongs to a different payment' using errcode='22023'; end if;
  return to_jsonb(legacy);
 end if;
 perform pg_advisory_xact_lock(hashtextextended('payroll-payment-staff:'||p_salon::text||':'||p_staff::text,0));
 perform pg_advisory_xact_lock(hashtextextended('payroll-payment-period:'||p_salon::text||':'||p_start::text||':'||p_end::text,0));
 cycle:=public.payroll_payment_period_cycle(p_salon,p_start,p_end);
 if cycle is null then raise exception 'Select the complete original pay period before recording payment' using errcode='22023'; end if;
 if not exists(select 1 from public.staff s where s.id=p_staff and s.salon_id=p_salon) then raise exception 'Staff is outside this salon' using errcode='42501'; end if;
 if exists(select 1 from public.payroll_live_recorded_payments p where p.salon_id=p_salon and p.staff_id=p_staff and p.period_start<=p_end and p.period_end>=p_start and (p.period_start<>p_start or p.period_end<>p_end))
  or exists(select 1 from public.payroll_recorded_payments p join public.payroll_period_bases b on b.id=p.base_id where b.salon_id=p_salon and p.staff_id=p_staff and b.period_start<=p_end and b.period_end>=p_start and (b.period_start<>p_start or b.period_end<>p_end)) then
  raise exception 'Record this payment against the original period already used for this Staff. Overlapping payments are not prorated' using errcode='22023';
 end if;
 select coalesce(max(r.revision),0) into version from (
  select a.revision from public.payroll_owner_adjustments a join public.payroll_period_bases b on b.id=a.base_id where b.salon_id=p_salon and b.period_start=p_start and b.period_end=p_end
  union all select p.revision from public.payroll_recorded_payments p join public.payroll_period_bases b on b.id=p.base_id where b.salon_id=p_salon and b.period_start=p_start and b.period_end=p_end
 ) r;
 select count(*) into live_count from public.payroll_live_recorded_payments p where p.salon_id=p_salon and p.period_start=p_start and p.period_end=p_end;
 version:=version+live_count;
 if version<>p_expected_revision then raise exception 'Payroll payments changed. Reload and verify the actual payment before recording it' using errcode='40001'; end if;
 insert into public.payroll_live_recorded_payments(salon_id,staff_id,period_start,period_end,cycle_type,request_id,actor_id,revision,cash_amount,check_amount,paid_at,note)
 values(p_salon,p_staff,p_start,p_end,cycle,p_request,actor,version+1,p_cash,p_check,p_paid_at,btrim(p_note)) returning * into previous;
 return to_jsonb(previous);
end; $$;
revoke all on function public.record_live_payroll_payment(uuid,uuid,date,date,uuid,integer,numeric,numeric,timestamptz,text) from public,anon;
grant execute on function public.record_live_payroll_payment(uuid,uuid,date,date,uuid,integer,numeric,numeric,timestamptz,text) to authenticated;

-- Existing payment clients share the same request identity and period lock.
create or replace function public.record_payroll_payment(p_base uuid,p_staff uuid,p_expected_revision integer,p_request uuid,p_cash numeric,p_check numeric,p_paid_at timestamptz,p_note text) returns jsonb
language plpgsql security definer set search_path=pg_catalog,public as $$
declare original public.payroll_period_bases%rowtype;
begin
 select * into original from public.payroll_period_bases where id=p_base;
 if not found then raise exception 'Select the original payroll period before recording payment' using errcode='22023'; end if;
 return public.record_live_payroll_payment(original.salon_id,p_staff,original.period_start,original.period_end,p_request,p_expected_revision,p_cash,p_check,p_paid_at,p_note);
end; $$;
commit;
