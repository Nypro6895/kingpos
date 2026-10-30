begin;

-- Tips are counted separately from service receipts. NULL means not entered;
-- recorded zero is a real input. Legacy snapshots are retained as evidence.
alter table public.pos_daily_closings add column tip_input numeric(12,2) check(tip_input>=0);

create or replace function public.mark_owner_report_entered() returns trigger
language plpgsql security definer set search_path=pg_catalog as $$
begin
 if tg_op='INSERT' then new.owner_live_revision:=1;
 else new.owner_live_revision:=old.owner_live_revision+case when row(new.cash_amount,new.credit_card_amount,new.other_amount,new.tip_input,new.note,new.live_report_entered_at) is distinct from row(old.cash_amount,old.credit_card_amount,old.other_amount,old.tip_input,old.note,old.live_report_entered_at) then 1 else 0 end; end if;
 return new;
end;$$;

drop trigger payroll_live_daily_audit on public.pos_daily_closings;
create function public.guard_daily_report_input_write() returns trigger
language plpgsql security definer set search_path=pg_catalog as $$
declare salon uuid:=case when tg_op='DELETE' then old.salon_id else new.salon_id end;
begin
 if tg_op='UPDATE' and row(new.id,new.salon_id,new.report_date) is distinct from row(old.id,old.salon_id,old.report_date) then raise exception 'Daily Report scope cannot change' using errcode='42501'; end if;
 if public.payroll_live_is_owner(salon) then
   if tg_op='DELETE' then return old; end if; return new;
 end if;
 if tg_op<>'DELETE' and current_setting('reylumi.signed_closing_salon',true)=salon::text
   and new.report_date=(now() at time zone public.get_salon_business_timezone(salon))::date then return new; end if;
 raise exception 'Only the Owner can change Daily Report amounts' using errcode='42501';
end;$$;
create trigger guard_daily_report_input_write before insert or update or delete on public.pos_daily_closings for each row execute function public.guard_daily_report_input_write();

create or replace function public.owner_live_report_state(p_salon uuid,p_date date) returns jsonb
language sql stable security definer set search_path=pg_catalog as $$
 select jsonb_build_object('revision',coalesce(r.owner_live_revision,0),'reportDate',p_date,'locked',not public.payroll_live_is_owner(p_salon),
 'closingInputs',jsonb_build_object('approvedAt',r.approved_at,'closedAt',r.closed_at,'cashAmount',coalesce(r.cash_amount,0),
 'creditCardAmount',coalesce(r.credit_card_amount,0),'otherAmount',coalesce(r.other_amount,0),'tipInput',r.tip_input,
 'entered',r.live_report_entered_at is not null,'note',r.note,'status',coalesce(r.status,'draft')))
 from (select 1) anchor left join public.pos_daily_closings r on r.salon_id=p_salon and r.report_date=p_date;
$$;

create function public.write_daily_report_inputs(p_salon uuid,p_date date,p_values jsonb) returns void
language plpgsql security definer set search_path=pg_catalog as $$
declare field text; amount numeric; entered boolean; tip numeric; existing public.pos_daily_closings%rowtype;
begin
 if p_date is null or p_values is null or jsonb_typeof(p_values)<>'object' or not p_values ?& array['cashAmount','creditCardAmount','otherAmount','note']
 or p_values-array['cashAmount','creditCardAmount','otherAmount','note','tipInput','serviceEntered']<>'{}'::jsonb then raise exception 'Invalid report values' using errcode='22023'; end if;
 foreach field in array array['cashAmount','creditCardAmount','otherAmount'] loop
   if jsonb_typeof(p_values->field) is distinct from 'number' then raise exception 'Amounts must be numbers'; end if;
   amount:=(p_values->>field)::numeric;
   if amount<0 or amount>9999999999.99 or amount<>round(amount,2) then raise exception 'Use nonnegative amounts with at most two decimals'; end if;
 end loop;
 if jsonb_typeof(p_values->'note') not in ('string','null') or length(coalesce(p_values->>'note',''))>4000 then raise exception 'Invalid note'; end if;
 if p_values ? 'serviceEntered' and jsonb_typeof(p_values->'serviceEntered') is distinct from 'boolean' then raise exception 'Invalid entered state'; end if;
 select * into existing from public.pos_daily_closings where salon_id=p_salon and report_date=p_date;
 entered:=coalesce((p_values->>'serviceEntered')::boolean,true);
 if not entered and ((p_values->>'cashAmount')::numeric<>0 or (p_values->>'creditCardAmount')::numeric<>0 or (p_values->>'otherAmount')::numeric<>0) then raise exception 'Nonzero service amounts must be entered'; end if;
 if existing.id is null and not entered and coalesce(p_values->>'tipInput','')='' and nullif(btrim(p_values->>'note'),'') is null then return; end if;
 tip:=existing.tip_input;
 if p_values ? 'tipInput' then
   if jsonb_typeof(p_values->'tipInput') not in ('number','null') then raise exception 'Invalid tip input'; end if;
   tip:=(p_values->>'tipInput')::numeric;
   if tip<0 or tip>9999999999.99 or tip<>round(tip,2) then raise exception 'Use a valid tip input with at most two decimals'; end if;
 end if;
 if row(existing.cash_amount,existing.credit_card_amount,existing.other_amount,existing.tip_input,existing.note,existing.live_report_entered_at is not null)
   is not distinct from row((p_values->>'cashAmount')::numeric,(p_values->>'creditCardAmount')::numeric,(p_values->>'otherAmount')::numeric,tip,nullif(btrim(p_values->>'note'),''),entered) then return; end if;
 insert into public.pos_daily_closings(salon_id,report_date,cash_amount,credit_card_amount,other_amount,tip_input,note,created_by,updated_by,live_report_entered_at)
 values(p_salon,p_date,(p_values->>'cashAmount')::numeric,(p_values->>'creditCardAmount')::numeric,(p_values->>'otherAmount')::numeric,tip,nullif(btrim(p_values->>'note'),''),public.current_public_user_id(),public.current_public_user_id(),case when entered then clock_timestamp() end)
 on conflict(salon_id,report_date) do update set cash_amount=excluded.cash_amount,credit_card_amount=excluded.credit_card_amount,other_amount=excluded.other_amount,tip_input=excluded.tip_input,note=excluded.note,updated_by=excluded.updated_by,
 live_report_entered_at=case when entered then coalesce(public.pos_daily_closings.live_report_entered_at,excluded.live_report_entered_at) end;
end;$$;

create or replace function public.save_owner_live_daily_report(p_salon uuid,p_date date,p_request uuid,p_expected_revision integer,p_values jsonb) returns jsonb
language plpgsql security definer set search_path=pg_catalog as $$
declare actor uuid:=public.current_public_user_id(); previous public.owner_live_report_receipts%rowtype; payload jsonb; current_state jsonb;
begin
 if not public.payroll_live_is_owner(p_salon) then raise exception 'Only the Owner can change financial amounts' using errcode='42501'; end if;
 if p_request is null or p_expected_revision is null or p_expected_revision<0 then raise exception 'Reopen the report before saving'; end if;
 payload:=jsonb_build_object('date',p_date,'revision',p_expected_revision,'values',p_values);
 perform pg_advisory_xact_lock(hashtextextended('owner-report-request:'||p_salon::text||actor::text||p_request::text,0));
 select * into previous from public.owner_live_report_receipts where salon_id=p_salon and actor_id=actor and request_id=p_request;
 if found then
   if previous.payload<>payload then raise exception 'Request ID already used for different values'; end if;
   return jsonb_build_object('requestId',p_request,'receipt',previous.result,'current',public.owner_live_report_state(p_salon,p_date),'replayed',true);
 end if;
 perform pg_advisory_xact_lock(hashtextextended('pos-closing:'||p_salon::text||p_date::text,0));
 perform 1 from public.pos_daily_closings where salon_id=p_salon and report_date=p_date for update;
 current_state:=public.owner_live_report_state(p_salon,p_date);
 if (current_state->>'revision')::integer<>p_expected_revision then raise exception 'Report changed on another screen. Reload before saving.' using errcode='PT409'; end if;
 perform public.write_daily_report_inputs(p_salon,p_date,p_values);
 current_state:=public.owner_live_report_state(p_salon,p_date);
 insert into public.owner_live_report_receipts values(p_salon,actor,p_request,p_date,payload,current_state);
 return jsonb_build_object('requestId',p_request,'receipt',current_state,'current',current_state,'replayed',false);
end;$$;

create function public.daily_input_reconciliation_values(p_salon uuid,p_date date) returns jsonb
language plpgsql stable security definer set search_path=pg_catalog as $$
declare gross numeric; tips numeric; discount numeric; actual numeric; closing public.pos_daily_closings%rowtype;
begin
 select coalesce(sum(service_total),0),coalesce(sum(tip_amount),0) into gross,tips from public.effective_staff_day_inputs_core(p_salon,p_date);
 select coalesce(sum(case when t.discount_type='percentage' then least(x.subtotal,round(x.subtotal*t.discount_value/100,2)) else least(x.subtotal,greatest(0,t.discount_value)) end),0) into discount
 from public.pos_tickets t cross join lateral (select coalesce(sum(case when exists(select 1 from public.pos_ticket_item_turn_parts p where p.ticket_item_id=i.id) then (select sum(p.amount) from public.pos_ticket_item_turn_parts p where p.ticket_item_id=i.id) else i.line_total end),0) subtotal from public.pos_ticket_items i where i.pos_ticket_id=t.id and not coalesce(i.is_removed,false)) x
 where t.salon_id=p_salon and t.status='closed' and (t.opened_at at time zone public.get_salon_business_timezone(p_salon))::date=p_date;
 select * into closing from public.pos_daily_closings where salon_id=p_salon and report_date=p_date;
 actual:=round(coalesce(closing.cash_amount,0)+coalesce(closing.credit_card_amount,0)+coalesce(closing.other_amount,0),2);
 return jsonb_build_object('businessDate',p_date,'grossService',gross,'discount',discount,'expectedService',round(gross-discount,2),'expectedTip',tips,
 'actualService',case when closing.live_report_entered_at is not null then actual end,'actualTip',closing.tip_input,
 'staffInputs',coalesce((select jsonb_agg(jsonb_build_object('staff_id',s.id,'staff_name',s.display_name,'service_total',coalesce(e.service_total,0),'tip_amount',coalesce(e.tip_amount,0)) order by s.display_name,s.id) from public.staff s left join public.effective_staff_day_inputs_core(p_salon,p_date) e on s.id=e.staff_id where s.salon_id=p_salon and (s.is_active or e.staff_id is not null)),'[]'::jsonb),
 'serviceDifference',case when closing.live_report_entered_at is not null then round(actual-(gross-discount),2) end,
 'tipDifference',case when closing.tip_input is not null then round(closing.tip_input-tips,2) end,
 'closingInputs',jsonb_build_object('cashAmount',coalesce(closing.cash_amount,0),'creditCardAmount',coalesce(closing.credit_card_amount,0),'otherAmount',coalesce(closing.other_amount,0),'tipInput',closing.tip_input,'entered',closing.live_report_entered_at is not null,'note',closing.note,'status',coalesce(closing.status,'draft')));
end;$$;

create function public.get_daily_input_reconciliation(p_salon uuid,p_date date,p_key uuid default null,p_signature text default null) returns jsonb
language plpgsql stable security definer set search_path=pg_catalog as $$
begin
 if p_date is null or p_salon is null then raise exception 'Report salon and date are required' using errcode='22023'; end if;
 if p_key is not null then
   if public.pos_portable_access_salon_id(p_key,p_signature) is distinct from p_salon or not public.pos_portable_access_has_capability(p_key,p_signature,'portable.report.view') or p_date<>(now() at time zone public.get_salon_business_timezone(p_salon))::date then raise exception 'Portable Report is available for today only' using errcode='42501'; end if;
 elsif not public.payroll_live_is_owner(p_salon) and not (public.user_has_salon_permission(p_salon,array['reports.view','payroll.view','payroll.manage','tickets.view','tickets.manage']) and (
 exists(select 1 from public.account_memberships m join public.roles r on r.id=m.role_id join public.locations l on l.account_id=m.account_id where l.id=p_salon and m.user_id=public.current_public_user_id() and m.status='active' and r.code<>'STAFF')
 or exists(select 1 from public.salon_memberships m join public.roles r on r.id=m.role_id where m.salon_id=p_salon and m.user_id=public.current_public_user_id() and m.status='active' and r.code<>'STAFF')
 )) then raise exception 'Report access required' using errcode='42501'; end if;
 return public.daily_input_reconciliation_values(p_salon,p_date);
end;$$;

-- Keep direct Portable readers on the same service/tip formula and today's
-- scope, including callers outside the current React transport.
alter function public.get_pos_portable_report_data(uuid,text,date) rename to get_pos_portable_report_before_independent_tips;
revoke all on function public.get_pos_portable_report_before_independent_tips(uuid,text,date) from public,anon,authenticated;
create function public.get_pos_portable_report_data(p_key_id uuid,p_session_signature text,p_report_date date default current_date) returns jsonb
language plpgsql security definer set search_path=pg_catalog as $$
declare salon uuid; original jsonb; facts jsonb;
begin
 salon:=public.pos_portable_access_salon_id(p_key_id,p_session_signature);
 facts:=public.get_daily_input_reconciliation(salon,p_report_date,p_key_id,p_session_signature);
 original:=public.get_pos_portable_report_before_independent_tips(p_key_id,p_session_signature,p_report_date);
 return original||jsonb_build_object('closingInputs',facts->'closingInputs','lock',jsonb_build_object('isLocked',false,'status',facts->'closingInputs'->>'status'),
 'totals',coalesce(original->'totals','{}')||jsonb_build_object('expectedTotal',facts->'expectedService','expectedTip',facts->'expectedTip','tips',facts->'expectedTip',
 'actualTotal',facts->'actualService','difference',facts->'serviceDifference','serviceDifference',facts->'serviceDifference','tipDifference',facts->'tipDifference'));
end;$$;
revoke all on function public.get_pos_portable_report_data(uuid,text,date) from public,anon,authenticated;
grant execute on function public.get_pos_portable_report_data(uuid,text,date) to anon,authenticated;

create function public.save_pos_workspace_report_closing_v2(p_key uuid,p_signature text,p_date date,p_values jsonb,p_expected jsonb) returns jsonb
language plpgsql security definer set search_path=pg_catalog as $$
declare salon uuid; current_values jsonb; previous_scope text:=current_setting('reylumi.signed_closing_salon',true);
begin
 salon:=public.pos_portable_access_salon_id(p_key,p_signature);
 if salon is null or p_date is null or not public.pos_portable_access_has_capability(p_key,p_signature,'portable.report.view') or p_date<>(now() at time zone public.get_salon_business_timezone(salon))::date then raise exception 'Portable Report is available for today only' using errcode='42501'; end if;
 perform pg_advisory_xact_lock(hashtextextended('pos-closing:'||salon::text||p_date::text,0));
 perform 1 from public.pos_daily_closings where salon_id=salon and report_date=p_date for update;
 current_values:=public.daily_input_reconciliation_values(salon,p_date)->'closingInputs';
 if p_expected is null or current_values is distinct from p_expected then raise exception 'Closing amounts changed on another screen. Review the latest amounts before saving.' using errcode='PT409'; end if;
 perform set_config('reylumi.signed_closing_salon',salon::text,true);
 perform public.write_daily_report_inputs(salon,p_date,p_values);
 perform set_config('reylumi.signed_closing_salon',coalesce(previous_scope,''),true);
 return public.daily_input_reconciliation_values(salon,p_date);
end;$$;

-- Stable case identity, immutable revisions. These are Owner reports, never pay.
create table public.daily_reconciliation_cases (
 id uuid primary key default gen_random_uuid(),salon_id uuid not null references public.locations(id) on delete cascade,business_date date not null,
 revision integer not null default 0,status text not null check(status in ('missing','short','over','mixed','resolved')),latest_values jsonb not null,updated_at timestamptz not null default clock_timestamp(),unique(salon_id,business_date)
);
create table public.daily_reconciliation_revisions (
 case_id uuid not null references public.daily_reconciliation_cases(id) on delete cascade,revision integer not null,values jsonb not null,created_at timestamptz not null default clock_timestamp(),primary key(case_id,revision)
);
create function public.guard_daily_reconciliation_revision() returns trigger language plpgsql set search_path=pg_catalog as $$begin raise exception 'Daily reconciliation revisions are immutable'; end;$$;
create trigger daily_reconciliation_revision_immutable before update or delete on public.daily_reconciliation_revisions for each row execute function public.guard_daily_reconciliation_revision();
revoke all on function public.guard_daily_reconciliation_revision() from public,anon,authenticated;
create table public.daily_reconciliation_checks(salon_id uuid not null references public.locations(id) on delete cascade,business_date date not null,checked_at timestamptz not null,primary key(salon_id,business_date));
alter table public.daily_reconciliation_checks enable row level security;
revoke all on public.daily_reconciliation_checks from public,anon,authenticated;
alter table public.daily_reconciliation_cases enable row level security;
alter table public.daily_reconciliation_revisions enable row level security;
revoke all on public.daily_reconciliation_cases,public.daily_reconciliation_revisions from public,anon,authenticated;
grant select on public.daily_reconciliation_cases,public.daily_reconciliation_revisions to authenticated;
create policy daily_cases_owner_read on public.daily_reconciliation_cases for select to authenticated using(public.payroll_live_is_owner(salon_id));
create policy daily_revisions_owner_read on public.daily_reconciliation_revisions for select to authenticated using(exists(select 1 from public.daily_reconciliation_cases c where c.id=case_id and public.payroll_live_is_owner(c.salon_id)));

create function public.reconcile_daily_inputs(p_salon uuid,p_date date) returns uuid
language plpgsql security definer set search_path=pg_catalog as $$
declare facts jsonb; existing public.daily_reconciliation_cases%rowtype; service_diff numeric; tip_diff numeric; state text; case_id uuid;
begin
 if p_date>=(now() at time zone public.get_salon_business_timezone(p_salon))::date then return null; end if;
 perform pg_advisory_xact_lock(hashtextextended('daily-reconciliation:'||p_salon::text||p_date::text,0));
 facts:=public.daily_input_reconciliation_values(p_salon,p_date);
 select * into existing from public.daily_reconciliation_cases where salon_id=p_salon and business_date=p_date for update;
 if existing.id is null and not exists(select 1 from public.pos_tickets where salon_id=p_salon and status='closed' and (opened_at at time zone public.get_salon_business_timezone(p_salon))::date=p_date) and not exists(select 1 from public.pos_daily_closings where salon_id=p_salon and report_date=p_date) and not exists(select 1 from public.staff_day_financial_inputs where salon_id=p_salon and business_date=p_date) then return null; end if;
 service_diff:=(facts->>'serviceDifference')::numeric; tip_diff:=(facts->>'tipDifference')::numeric;
 state:=case when service_diff is null or tip_diff is null then 'missing' when service_diff=0 and tip_diff=0 then 'resolved' when service_diff<0 and tip_diff>0 or service_diff>0 and tip_diff<0 then 'mixed' when service_diff<0 or tip_diff<0 then 'short' else 'over' end;
 if existing.id is null and state='resolved' then return null; end if;
 -- The roster is display evidence, not a second source of money. A renamed or
 -- newly active zero-activity Staff must not create a reconciliation revision.
 if existing.id is not null and existing.latest_values-'staffInputs'=facts-'staffInputs' then return existing.id; end if;
 insert into public.daily_reconciliation_cases(salon_id,business_date,revision,status,latest_values) values(p_salon,p_date,1,state,facts)
 on conflict(salon_id,business_date) do update set revision=public.daily_reconciliation_cases.revision+1,status=excluded.status,latest_values=excluded.latest_values,updated_at=clock_timestamp()
 returning id into case_id;
 insert into public.daily_reconciliation_revisions(case_id,revision,values) select id,revision,latest_values from public.daily_reconciliation_cases where id=case_id;
 return case_id;
end;$$;

create function public.audit_daily_report_inputs() returns trigger
language plpgsql security definer set search_path=pg_catalog as $$
declare b jsonb:='{}'; a jsonb:='{}'; salon uuid:=case when tg_op='DELETE' then old.salon_id else new.salon_id end; day date:=case when tg_op='DELETE' then old.report_date else new.report_date end; source uuid:=case when tg_op='DELETE' then old.id else new.id end;
begin
 if tg_op<>'INSERT' then b:=jsonb_build_object('cash_amount',old.cash_amount,'credit_card_amount',old.credit_card_amount,'other_amount',old.other_amount,'tip_input',old.tip_input,'entered',old.live_report_entered_at is not null,'note',old.note); end if;
 if tg_op<>'DELETE' then a:=jsonb_build_object('cash_amount',new.cash_amount,'credit_card_amount',new.credit_card_amount,'other_amount',new.other_amount,'tip_input',new.tip_input,'entered',new.live_report_entered_at is not null,'note',new.note); end if;
 if a is distinct from b then
   perform public.record_financial_input_event(salon,'daily_report',day,source,b,a,'Daily Report inputs updated','[]'::jsonb,null,false);
   perform public.reconcile_daily_inputs(salon,day);
 end if;
 if tg_op='DELETE' then return old; end if; return new;
end;$$;
create trigger audit_daily_report_inputs after insert or update or delete on public.pos_daily_closings for each row execute function public.audit_daily_report_inputs();

-- Historical delta requests remain readable evidence. New edits use the
-- authorized Staff/day and Daily Report input commands, never raw deltas.
revoke insert,update,delete on public.pos_financial_adjustments,public.pos_financial_correction_requests from public,anon,authenticated;
create function public.guard_legacy_financial_correction_write() returns trigger
language plpgsql set search_path=pg_catalog as $$
begin
 if current_user in ('anon','authenticated') then raise exception 'Use Staff daily inputs or Daily Report to preserve financial history' using errcode='42501'; end if;
 if tg_op='DELETE' then return old; end if; return new;
end;$$;
revoke all on function public.guard_legacy_financial_correction_write() from public,anon,authenticated;
create trigger legacy_financial_adjustment_command_boundary before insert or update or delete on public.pos_financial_adjustments for each row execute function public.guard_legacy_financial_correction_write();
create trigger legacy_financial_request_command_boundary before insert or update or delete on public.pos_financial_correction_requests for each row execute function public.guard_legacy_financial_correction_write();

create function public.reconcile_closed_business_days(p_limit integer default 200) returns integer
language plpgsql security definer set search_path=pg_catalog as $$
declare target record; count_done integer:=0;
begin
 for target in select dates.salon_id,dates.business_date from (
   select salon_id,(opened_at at time zone public.get_salon_business_timezone(salon_id))::date business_date from public.pos_tickets where status='closed'
   union select salon_id,report_date from public.pos_daily_closings
   union select salon_id,business_date from public.staff_day_financial_inputs
   union select salon_id,business_date from public.daily_reconciliation_cases
 ) dates left join public.daily_reconciliation_checks checks using(salon_id,business_date) where dates.business_date<(now() at time zone public.get_salon_business_timezone(dates.salon_id))::date order by checks.checked_at nulls first,dates.business_date desc,dates.salon_id limit greatest(1,least(p_limit,1000)) loop
   perform public.reconcile_daily_inputs(target.salon_id,target.business_date);count_done:=count_done+1;
   insert into public.daily_reconciliation_checks values(target.salon_id,target.business_date,clock_timestamp()) on conflict(salon_id,business_date) do update set checked_at=excluded.checked_at;
 end loop;
 return count_done;
end;$$;

revoke all on function public.guard_daily_report_input_write(),public.write_daily_report_inputs(uuid,date,jsonb),public.daily_input_reconciliation_values(uuid,date),public.reconcile_daily_inputs(uuid,date),public.audit_daily_report_inputs(),public.reconcile_closed_business_days(integer) from public,anon,authenticated;
revoke all on function public.get_daily_input_reconciliation(uuid,date,uuid,text),public.save_pos_workspace_report_closing_v2(uuid,text,date,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.get_daily_input_reconciliation(uuid,date,uuid,text),public.save_pos_workspace_report_closing_v2(uuid,text,date,jsonb,jsonb) to anon,authenticated;
grant execute on function public.reconcile_closed_business_days(integer) to service_role;

-- Database scheduling avoids mutating GET requests. Catch up after missed runs.
do $$begin
 if exists(select 1 from pg_extension where extname='pg_cron') then
   if not exists(select 1 from cron.job where jobname='reylumi-daily-input-reconciliation') then perform cron.schedule('reylumi-daily-input-reconciliation','*/10 * * * *','select public.reconcile_closed_business_days(200);'); end if;
 else raise warning 'Daily input reconciliation requires pg_cron or the service-authenticated POST worker.'; end if;
end;$$;
commit;
