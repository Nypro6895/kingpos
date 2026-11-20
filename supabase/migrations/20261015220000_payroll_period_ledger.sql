-- Capture immutable period inputs before any later edit, then calculate/publish
-- asynchronously. No credentials, provider messages, payments or historical
-- reconstruction are performed by this migration.
begin;

create table public.payroll_close_state (
  salon_id uuid primary key references public.locations(id) on delete cascade,
  activated_at timestamptz not null default clock_timestamp(),
  period_start date not null, period_end date not null,
  cycle_type text not null check(cycle_type in ('monthly','semi_monthly','biweekly')),
  timezone_iana text not null,
  configuration_issue text,
  check(period_end >= period_start)
);
create table public.payroll_close_inputs (
  id uuid primary key default gen_random_uuid(),
  salon_id uuid not null references public.locations(id) on delete cascade,
  period_start date not null, period_end date not null,
  cycle_type text not null, timezone_iana text not null,
  closed_at timestamptz not null, captured_at timestamptz not null default clock_timestamp(),
  input_packet jsonb not null, input_sha256 text not null,
  unique(salon_id,period_start,period_end), check(period_end>=period_start)
);
create table public.payroll_close_jobs (
  input_id uuid primary key references public.payroll_close_inputs(id) on delete cascade,
  state text not null default 'pending' check(state in ('pending','working','complete','error')),
  lease_id uuid, leased_until timestamptz, attempts integer not null default 0,
  last_error text, completed_at timestamptz
);
alter table public.payroll_close_state enable row level security;
alter table public.payroll_close_inputs enable row level security;
alter table public.payroll_close_jobs enable row level security;
revoke all on public.payroll_close_state,public.payroll_close_inputs,public.payroll_close_jobs from public,anon,authenticated,service_role;

create function public.payroll_calendar_period(p_day date,p_cycle text,p_anchor date)
returns table(start_date date,end_date date) language plpgsql immutable set search_path=pg_catalog,public,pg_temp as $$
begin
 if p_cycle='monthly' then
   return query select date_trunc('month',p_day)::date,(date_trunc('month',p_day)+interval '1 month - 1 day')::date;
 elsif p_cycle='semi_monthly' then
   return query select (date_trunc('month',p_day)::date + case when extract(day from p_day)>15 then 15 else 0 end),
     case when extract(day from p_day)<=15 then date_trunc('month',p_day)::date+14 else (date_trunc('month',p_day)+interval '1 month - 1 day')::date end;
 elsif p_cycle='biweekly' and p_anchor is not null then
   return query select p_anchor+(floor((p_day-p_anchor)::numeric/14)::integer*14),p_anchor+(floor((p_day-p_anchor)::numeric/14)::integer*14)+13;
 else raise exception 'Set a valid payroll schedule before automatic closing.';
 end if;
end;$$;
revoke all on function public.payroll_calendar_period(date,text,date) from public,anon,authenticated;

create function public.payroll_capture_packet(p_salon uuid,p_start date,p_end date,p_cycle text,p_timezone text)
returns jsonb language sql stable security definer set search_path=pg_catalog,public,pg_temp as $$
 select jsonb_build_object(
   'version',1,'salonId',l.id,'accountId',l.account_id,
   'period',jsonb_build_object('startDate',p_start,'endDate',p_end,'cycleType',p_cycle,'preset','custom','label',p_start::text||' – '||p_end::text),
   'timezone',p_timezone,
   'staffRows',coalesce((select jsonb_agg(to_jsonb(s) order by s.id) from staff s where s.salon_id=p_salon),'[]'),
   'staffSettings',coalesce((select jsonb_agg(to_jsonb(s) order by s.effective_from desc,s.created_at desc,s.id) from staff_payroll_settings s where s.salon_id=p_salon),'[]'),
   'earnings',coalesce((select jsonb_agg(to_jsonb(e) order by e.work_date,e.staff_id,e.ticket_id) from pos_ticket_staff_earnings e where e.salon_id=p_salon and e.work_date between p_start and p_end),'[]'),
   'financialAdjustments',coalesce((select jsonb_agg(to_jsonb(a) order by a.created_at,a.id) from pos_financial_adjustments a where a.salon_id=p_salon and a.business_date between p_start and p_end),'[]'),
   'financialRequests',coalesce((select jsonb_agg(to_jsonb(r) order by r.requested_at,r.id) from pos_financial_correction_requests r where r.salon_id=p_salon and r.business_date between p_start and p_end),'[]'),
   'periodInputs',coalesce((select jsonb_agg(to_jsonb(i) order by i.staff_id) from payroll_period_staff_inputs i where i.salon_id=p_salon and i.period_start=p_start and i.period_end=p_end and i.cycle_type=p_cycle),'[]'),
   'inputHistory',coalesce((select jsonb_agg(to_jsonb(h) order by h.created_at,h.id) from payroll_period_staff_input_history h where h.salon_id=p_salon and h.period_start=p_start and h.period_end=p_end and h.cycle_type=p_cycle),'[]'),
   'ticketAdjustments',coalesce((select jsonb_agg(to_jsonb(a)||jsonb_build_object('ticketNumber',t.ticket_number,'businessDate',(t.opened_at at time zone p_timezone)::date) order by a.created_at,a.id) from pos_ticket_adjustments a join pos_tickets t on t.id=a.ticket_id where a.salon_id=p_salon and t.opened_at >= (p_start::timestamp at time zone p_timezone) and t.opened_at < ((p_end+1)::timestamp at time zone p_timezone)),'[]'),
   'closingRows',coalesce((select jsonb_agg(to_jsonb(c) order by c.report_date) from pos_daily_closings c where c.salon_id=p_salon and c.report_date between p_start and p_end),'[]')
 ) from locations l where l.id=p_salon;
$$;
revoke all on function public.payroll_capture_packet(uuid,date,date,text,text) from public,anon,authenticated,service_role;

create function public.payroll_ensure_close_state(p_salon uuid,p_now timestamptz default clock_timestamp())
returns void language plpgsql security definer set search_path=pg_catalog,public,pg_temp as $$
declare cycle text; anchor date; zone text; period record;
begin
 if exists(select 1 from payroll_close_state where salon_id=p_salon) then return; end if;
 if not exists(select 1 from locations where id=p_salon) then return; end if;
 select coalesce(s.cycle_type,'monthly'),s.biweekly_anchor_date into cycle,anchor from locations l left join salon_payroll_settings s on s.salon_id=l.id where l.id=p_salon;
 if cycle not in ('monthly','semi_monthly','biweekly') or (cycle='biweekly' and anchor is null) then return; end if;
 zone:=get_salon_business_timezone(p_salon);
 select * into period from payroll_calendar_period((p_now at time zone zone)::date,cycle,anchor);
 insert into payroll_close_state(salon_id,activated_at,period_start,period_end,cycle_type,timezone_iana)
 values(p_salon,p_now,period.start_date,period.end_date,cycle,zone) on conflict do nothing;
end;$$;
revoke all on function public.payroll_ensure_close_state(uuid,timestamptz) from public,anon,authenticated,service_role;

create function public.payroll_capture_due_inputs(p_salon uuid,p_now timestamptz default clock_timestamp())
returns integer language plpgsql security definer set search_path=pg_catalog,public,pg_temp as $$
declare state payroll_close_state%rowtype; packet jsonb; input_id uuid; captured integer:=0; next_period record; cycle text; anchor date; zone text;
begin
 -- All relevant BEFORE triggers take the same transaction lock before changing
 -- source rows. The first later mutation captures the still-unchanged old input.
 perform pg_advisory_xact_lock(hashtextextended('payroll-close:'||p_salon::text,0));
 if not exists(select 1 from locations where id=p_salon) then return 0; end if;
 perform payroll_ensure_close_state(p_salon,p_now);
 select * into state from payroll_close_state where salon_id=p_salon for update;
 if not found or state.configuration_issue is not null then return 0; end if;
 while ((state.period_end+1)::timestamp at time zone state.timezone_iana)<=p_now loop
   packet:=payroll_capture_packet(p_salon,state.period_start,state.period_end,state.cycle_type,state.timezone_iana);
   insert into payroll_close_inputs(salon_id,period_start,period_end,cycle_type,timezone_iana,closed_at,input_packet,input_sha256)
   values(p_salon,state.period_start,state.period_end,state.cycle_type,state.timezone_iana,(state.period_end+1)::timestamp at time zone state.timezone_iana,packet,encode(sha256(convert_to(packet::text,'UTF8')),'hex'))
   on conflict(salon_id,period_start,period_end) do nothing returning id into input_id;
   if input_id is not null then insert into payroll_close_jobs(input_id) values(input_id); captured:=captured+1; end if;
   select coalesce(s.cycle_type,'monthly'),s.biweekly_anchor_date into cycle,anchor from locations l left join salon_payroll_settings s on s.salon_id=l.id where l.id=p_salon;
   if cycle not in ('monthly','semi_monthly','biweekly') or (cycle='biweekly' and anchor is null) then
     update payroll_close_state set configuration_issue='Payroll schedule needs review before the next automatic close.' where salon_id=p_salon; return captured;
   end if;
   select * into next_period from payroll_calendar_period(state.period_end+1,cycle,anchor);
   if next_period.start_date<>state.period_end+1 then
     update payroll_close_state set configuration_issue='The changed schedule overlaps the previous period. Owner review is required; no historical base will be reconstructed.' where salon_id=p_salon; return captured;
   end if;
   zone:=get_salon_business_timezone(p_salon);
   update payroll_close_state set period_start=next_period.start_date,period_end=next_period.end_date,cycle_type=cycle,timezone_iana=zone where salon_id=p_salon returning * into state;
 end loop;
 return captured;
end;$$;
revoke all on function public.payroll_capture_due_inputs(uuid,timestamptz) from public,anon,authenticated,service_role;

create function public.payroll_capture_before_source_change()
returns trigger language plpgsql security definer set search_path=pg_catalog,public,pg_temp as $$
declare old_salon uuid; new_salon uuid;
begin
 if tg_op<>'INSERT' then old_salon:=(to_jsonb(old)->>'salon_id')::uuid; end if;
 if tg_op<>'DELETE' then new_salon:=(to_jsonb(new)->>'salon_id')::uuid; end if;
 -- Stable ordering also covers the unusual case of moving a row between salons.
 if old_salon is not null and new_salon is not null and old_salon<>new_salon then
   perform payroll_capture_due_inputs(least(old_salon,new_salon)); perform payroll_capture_due_inputs(greatest(old_salon,new_salon));
 elsif coalesce(old_salon,new_salon) is not null then perform payroll_capture_due_inputs(coalesce(old_salon,new_salon)); end if;
 return case when tg_op='DELETE' then old else new end;
end;$$;
revoke all on function public.payroll_capture_before_source_change() from public,anon,authenticated,service_role;

create function public.payroll_reconfigure_open_period()
returns trigger language plpgsql security definer set search_path=pg_catalog,public,pg_temp as $$
declare salon uuid:=new.salon_id; state payroll_close_state%rowtype; period record; cycle text; anchor date; zone text; day date;
begin
 if tg_op='UPDATE' and (
   (tg_table_name='booking_settings' and to_jsonb(new)->'timezone_iana' is not distinct from to_jsonb(old)->'timezone_iana') or
   (tg_table_name='salon_payroll_settings' and to_jsonb(new)->'cycle_type' is not distinct from to_jsonb(old)->'cycle_type' and to_jsonb(new)->'biweekly_anchor_date' is not distinct from to_jsonb(old)->'biweekly_anchor_date')
 ) then return new; end if;
 perform pg_advisory_xact_lock(hashtextextended('payroll-close:'||salon::text,0));
 perform payroll_ensure_close_state(salon);
 select * into state from payroll_close_state where salon_id=salon for update;
 select coalesce(s.cycle_type,'monthly'),s.biweekly_anchor_date into cycle,anchor from locations l left join salon_payroll_settings s on s.salon_id=l.id where l.id=salon;
 if cycle='biweekly' and anchor is null then return new; end if;
 zone:=get_salon_business_timezone(salon);day:=(clock_timestamp() at time zone zone)::date;
 select * into period from payroll_calendar_period(day,cycle,anchor);
 if exists(select 1 from payroll_close_inputs i where i.salon_id=salon and daterange(i.period_start,i.period_end,'[]')&&daterange(period.start_date,period.end_date,'[]')) then
   raise exception 'This schedule overlaps a closed payroll period. Review the transition before changing it.';
 end if;
 if state.period_start is not null and period.start_date<>state.period_start and (
   exists(select 1 from pos_ticket_staff_earnings e where e.salon_id=salon and e.work_date between state.period_start and state.period_end) or
   exists(select 1 from staff_payroll_settings s where s.salon_id=salon and s.pay_type='fixed' and s.effective_from<=state.period_end and coalesce(s.effective_to,state.period_end)>=state.period_start) or
   exists(select 1 from payroll_period_staff_inputs i where i.salon_id=salon and i.period_start=state.period_start and i.period_end=state.period_end)
 ) then raise exception 'The open period already has payroll data. Review the schedule transition instead of moving those earnings to a different period.'; end if;
 if state.period_start is not null and period.start_date>state.period_end then raise exception 'Wait for the current payroll period to close before changing its timezone or schedule.'; end if;
 update payroll_close_state set period_start=period.start_date,period_end=period.end_date,cycle_type=cycle,timezone_iana=zone,configuration_issue=null where salon_id=salon;
 return new;
end;$$;
revoke all on function public.payroll_reconfigure_open_period() from public,anon,authenticated,service_role;
create trigger payroll_reconfigure_open_period after insert or update on public.salon_payroll_settings for each row execute function public.payroll_reconfigure_open_period();
create trigger payroll_reconfigure_open_period after insert or update on public.booking_settings for each row execute function public.payroll_reconfigure_open_period();

create function public.payroll_immutable_record()
returns trigger language plpgsql security definer set search_path=pg_catalog,public,pg_temp as $$
begin
 -- Preserve the existing explicit salon-erasure cascade; ordinary edits and
 -- standalone deletes cannot rewrite financial history.
 if tg_op='DELETE' and not exists(select 1 from locations where id=old.salon_id) then return old; end if;
 raise exception 'Payroll history is immutable. Record a new adjustment instead.';
end;$$;
revoke all on function public.payroll_immutable_record() from public,anon,authenticated,service_role;
create trigger payroll_immutable_record before update or delete on public.payroll_close_inputs for each row execute function public.payroll_immutable_record();

-- Freeze before parent ticket changes too, not only before derived earnings.
do $$declare t text; begin
 foreach t in array array['staff','staff_payroll_settings','salon_payroll_settings','payroll_period_staff_inputs','payroll_period_staff_input_history','pos_ticket_staff_earnings','pos_financial_adjustments','pos_financial_correction_requests','pos_ticket_adjustments','pos_daily_closings','pos_tickets','pos_ticket_items','pos_payments','booking_settings'] loop
   execute format('create trigger aa_payroll_capture_before_source_change before insert or update or delete on public.%I for each row execute function public.payroll_capture_before_source_change()',t);
 end loop;
end;$$;

-- Activation covers the currently open period, never earlier missing periods.
do $$declare salon uuid; begin for salon in select id from public.locations loop perform public.payroll_ensure_close_state(salon); end loop; end;$$;

create function public.claim_payroll_close_jobs(p_limit integer default 10)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public,pg_temp as $$
declare salon uuid; result jsonb;
begin
 if auth.role() is distinct from 'service_role' then raise exception 'Worker authorization required.'; end if;
 if p_limit is null or p_limit not between 1 and 50 then raise exception 'Invalid batch size.'; end if;
 for salon in select id from locations where status='active' order by id loop perform payroll_capture_due_inputs(salon); end loop;
 with picked as (select input_id from payroll_close_jobs where state='pending' or (state in ('error','working') and leased_until<clock_timestamp()) order by input_id for update skip locked limit p_limit),
 claimed as (update payroll_close_jobs j set state='working',lease_id=gen_random_uuid(),leased_until=clock_timestamp()+interval '10 minutes',attempts=attempts+1,last_error=null from picked p where j.input_id=p.input_id returning j.input_id,j.lease_id)
 select coalesce(jsonb_agg(jsonb_build_object('inputId',i.id,'leaseId',c.lease_id,'inputSha256',i.input_sha256,'closedAt',i.closed_at,'capturedAt',i.captured_at,'packet',i.input_packet)),'[]') into result from claimed c join payroll_close_inputs i on i.id=c.input_id;
 return result;
end;$$;
revoke all on function public.claim_payroll_close_jobs(integer) from public,anon,authenticated;
grant execute on function public.claim_payroll_close_jobs(integer) to service_role;

commit;
