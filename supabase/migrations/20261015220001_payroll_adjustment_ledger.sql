begin;
create table public.payroll_period_bases (
 id uuid primary key, input_id uuid not null unique references public.payroll_close_inputs(id) on delete cascade,
 salon_id uuid not null references public.locations(id) on delete cascade,
 period_start date not null,period_end date not null,cycle_type text not null,
 original_snapshot jsonb not null,engine_version text not null,created_at timestamptz not null default clock_timestamp(),
 unique(salon_id,period_start,period_end)
);
create table public.payroll_base_staff_lines (
 base_id uuid not null references public.payroll_period_bases(id) on delete cascade,
 salon_id uuid not null references public.locations(id) on delete cascade,
 staff_id uuid not null,original_line jsonb not null,primary key(base_id,staff_id)
);
create table public.payroll_owner_adjustments (
 id uuid primary key default gen_random_uuid(),base_id uuid not null references public.payroll_period_bases(id) on delete cascade,
 salon_id uuid not null references public.locations(id) on delete cascade,staff_id uuid not null,
 revision integer not null,request_id uuid not null,actor_id uuid not null,reason text not null,
 before_values jsonb not null,after_values jsonb not null,delta_amount numeric(12,2) not null,
 -- Optional bridge to the legacy history table, whose staff FK cascades on
 -- deletion. This immutable adjustment row is the durable audit record itself.
 audit_history_id uuid,created_at timestamptz not null default clock_timestamp(),
 unique(base_id,revision),unique(salon_id,request_id),check(length(btrim(reason)) between 3 and 1000)
);
create table public.payroll_recorded_payments (
 id uuid primary key default gen_random_uuid(),base_id uuid not null references public.payroll_period_bases(id) on delete cascade,
 salon_id uuid not null references public.locations(id) on delete cascade,staff_id uuid not null,
 request_id uuid not null,actor_id uuid not null,revision_at_payment integer not null,revision integer not null,
 cash_amount numeric(12,2) not null,check_amount numeric(12,2) not null,
 paid_at timestamptz not null,recorded_at timestamptz not null default clock_timestamp(),note text not null,
 unique(salon_id,request_id),unique(base_id,revision),check(cash_amount>=0 and check_amount>=0 and cash_amount+check_amount>0),check(length(btrim(note)) between 3 and 1000)
);
do $$declare t text;begin
 foreach t in array array['payroll_period_bases','payroll_base_staff_lines','payroll_owner_adjustments','payroll_recorded_payments'] loop
 execute format('alter table public.%I enable row level security',t);
 execute format('revoke all on public.%I from public,anon,authenticated,service_role',t);
 execute format('create trigger payroll_immutable_record before update or delete on public.%I for each row execute function public.payroll_immutable_record()',t);
 end loop;
end;$$;

create function public.payroll_adjustable_values(p_line jsonb)
returns jsonb language sql immutable set search_path=pg_catalog,public,pg_temp as $$
 select jsonb_build_object('final_cash_amount',coalesce((p_line->>'final_cash_amount')::numeric,0),
 'final_check_amount',coalesce((p_line->>'final_check_amount')::numeric,0),
 'tax_withheld',coalesce((p_line->>'tax_withheld')::numeric,0),
 'tax_company_taxable_gross',coalesce((p_line->>'tax_company_taxable_gross')::numeric,0),
 'tax_company_cash_amount',coalesce((p_line->>'tax_company_cash_amount')::numeric,0),
 'staff_legal_name_snapshot',p_line->'staff_legal_name_snapshot','check_number',p_line->'check_number');
$$;
revoke all on function public.payroll_adjustable_values(jsonb) from public,anon,authenticated,service_role;

create function public.create_payroll_owner_adjustment(p_base uuid,p_staff uuid,p_expected_revision integer,p_request uuid,p_values jsonb,p_reason text)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public,pg_temp as $$
declare base payroll_period_bases%rowtype; existing payroll_owner_adjustments%rowtype; original jsonb; previous jsonb; revised jsonb;
 actor uuid:=current_public_user_id(); revision integer; field text; amount numeric; entry_id uuid:=gen_random_uuid(); history_id uuid:=gen_random_uuid(); delta numeric; recipient uuid; created timestamptz:=clock_timestamp();
begin
 select * into base from payroll_period_bases where id=p_base;
 if actor is null or not found or not lifecycle_user_is_salon_owner(base.salon_id,actor,true) then raise exception 'Only the current salon Owner can adjust payroll.'; end if;
 perform 1 from payroll_period_bases where id=p_base for update;
 if p_request is null or p_expected_revision is null or p_values is null or jsonb_typeof(p_values)<>'object' or p_reason is null or length(btrim(p_reason)) not between 3 and 1000 then raise exception 'A request ID, revision, amounts and adjustment reason are required.'; end if;
 select * into existing from payroll_owner_adjustments where salon_id=base.salon_id and request_id=p_request;
 if found then
   if existing.base_id<>p_base or existing.staff_id<>p_staff or existing.actor_id<>actor or existing.reason<>btrim(p_reason) or existing.after_values<>p_values then raise exception 'This request ID belongs to a different adjustment.'; end if;
   return to_jsonb(existing);
 end if;
 select coalesce(max(r.revision),0) into revision from (select a.revision from payroll_owner_adjustments a where a.base_id=p_base union all select p.revision from payroll_recorded_payments p where p.base_id=p_base) r;
 if revision<>p_expected_revision then raise exception 'Payroll changed. Reload and review the current amounts before adjusting.'; end if;
 select original_line into original from payroll_base_staff_lines where base_id=p_base and staff_id=p_staff;
 if not found then raise exception 'Staff is not part of this payroll base.'; end if;
 select a.after_values into previous from payroll_owner_adjustments a where a.base_id=p_base and a.staff_id=p_staff order by a.revision desc limit 1;
 previous:=coalesce(previous,payroll_adjustable_values(original));revised:=p_values;
 if (select array_agg(key order by key) from jsonb_object_keys(revised)key) is distinct from (select array_agg(key order by key) from jsonb_object_keys(previous)key) then raise exception 'Invalid adjustment fields.'; end if;
 foreach field in array array['final_cash_amount','final_check_amount','tax_withheld','tax_company_taxable_gross','tax_company_cash_amount'] loop
   if jsonb_typeof(revised->field)<>'number' then raise exception 'Payroll amounts must be numeric.'; end if;
   amount:=(revised->>field)::numeric;
   if amount<>round(amount,2) or abs(amount)>9999999999.99 then raise exception 'Payroll amounts must use cents within the supported range.'; end if;
 end loop;
 foreach field in array array['staff_legal_name_snapshot','check_number'] loop
   if jsonb_typeof(revised->field) not in ('null','string') or length(coalesce(revised->>field,''))>200 then raise exception 'Invalid payroll identity field.'; end if;
 end loop;
 if revised=previous then raise exception 'No payroll change to record.'; end if;
 delta:=((revised->>'final_cash_amount')::numeric+(revised->>'final_check_amount')::numeric)-((previous->>'final_cash_amount')::numeric+(previous->>'final_check_amount')::numeric);
 if exists(select 1 from public.staff s where s.id=p_staff and s.salon_id=base.salon_id) then
 insert into payroll_period_staff_input_history(id,salon_id,staff_id,payroll_run_id,period_start,period_end,cycle_type,change_type,field_changes,previous_value_json,new_value_json,created_by,created_at)
 values(history_id,base.salon_id,p_staff,base.id,base.period_start,base.period_end,base.cycle_type,'owner_adjustment',
 jsonb_build_object('adjustment',jsonb_build_object('previous',previous,'current',revised),'reason',jsonb_build_object('previous',null,'current',btrim(p_reason))),previous,revised,actor,created);
 else history_id:=null; end if;
 insert into payroll_owner_adjustments(id,base_id,salon_id,staff_id,revision,request_id,actor_id,reason,before_values,after_values,delta_amount,audit_history_id,created_at)
 values(entry_id,p_base,base.salon_id,p_staff,revision+1,p_request,actor,btrim(p_reason),previous,revised,delta,history_id,created) returning * into existing;
 select coalesce(s.account_user_id,u.id) into recipient from staff s left join users u on u.auth_user_id=s.user_id and u.status='active' where s.id=p_staff and s.salon_id=base.salon_id and s.is_active;
 if recipient is not null then
   insert into app_notifications(account_id,salon_id,recipient_user_id,recipient_kind,notification_type,title,body,href,event_key)
   values((select account_id from locations where id=base.salon_id),base.salon_id,recipient,'staff','payroll_adjusted','Your payroll was adjusted',
     base.period_start::text||' to '||base.period_end::text||': '||case when delta>0 then '+' else '' end||delta::text||' USD. Open My Pay for the reason and adjustment history.',
     '/staff/my-work?tab=payroll&payPeriodStart='||base.period_start::text,'payroll-adjustment:'||entry_id::text) on conflict do nothing;
 end if;
 return to_jsonb(existing);
end;$$;
revoke all on function public.create_payroll_owner_adjustment(uuid,uuid,integer,uuid,jsonb,text) from public,anon;
grant execute on function public.create_payroll_owner_adjustment(uuid,uuid,integer,uuid,jsonb,text) to authenticated;

create function public.record_payroll_payment(p_base uuid,p_staff uuid,p_expected_revision integer,p_request uuid,p_cash numeric,p_check numeric,p_paid_at timestamptz,p_note text)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public,pg_temp as $$
declare base payroll_period_bases%rowtype; actor uuid:=current_public_user_id(); revision integer; payment payroll_recorded_payments%rowtype;
begin
 select * into base from payroll_period_bases where id=p_base;
 if actor is null or not found or not lifecycle_user_is_salon_owner(base.salon_id,actor,true) then raise exception 'Only the current salon Owner can record payroll payment.'; end if;
 perform 1 from payroll_period_bases where id=p_base for update;
 if p_request is null or p_expected_revision is null or p_cash is null or p_check is null or abs(p_cash)>9999999999.99 or abs(p_check)>9999999999.99 or p_cash<0 or p_check<0 or p_cash+p_check<=0 or p_cash<>round(p_cash,2) or p_check<>round(p_check,2) or p_paid_at is null or p_paid_at>clock_timestamp() or p_note is null or length(btrim(p_note)) not between 3 and 1000 then raise exception 'Enter the actual cash/check amounts, payment date and note.'; end if;
 select * into payment from payroll_recorded_payments where salon_id=base.salon_id and request_id=p_request;
 if found then
   if payment.base_id<>p_base or payment.staff_id<>p_staff or payment.actor_id<>actor or payment.cash_amount<>p_cash or payment.check_amount<>p_check or payment.paid_at<>p_paid_at or payment.note<>btrim(p_note) then raise exception 'This request ID belongs to a different payment.'; end if;
   return to_jsonb(payment);
 end if;
 select coalesce(max(r.revision),0) into revision from (select a.revision from payroll_owner_adjustments a where a.base_id=p_base union all select p.revision from payroll_recorded_payments p where p.base_id=p_base) r;
 if revision<>p_expected_revision then raise exception 'Payroll changed. Reload and verify the actual payment before recording it.'; end if;
 if not exists(select 1 from payroll_base_staff_lines where base_id=p_base and staff_id=p_staff) then raise exception 'Staff is not part of this payroll base.'; end if;
 insert into payroll_recorded_payments(base_id,salon_id,staff_id,request_id,actor_id,revision_at_payment,revision,cash_amount,check_amount,paid_at,note)
 values(p_base,base.salon_id,p_staff,p_request,actor,revision,revision+1,p_cash,p_check,p_paid_at,btrim(p_note)) returning * into payment;
 return to_jsonb(payment);
end;$$;
revoke all on function public.record_payroll_payment(uuid,uuid,integer,uuid,numeric,numeric,timestamptz,text) from public,anon;
grant execute on function public.record_payroll_payment(uuid,uuid,integer,uuid,numeric,numeric,timestamptz,text) to authenticated;

create function public.read_payroll_period_ledger(p_salon uuid,p_start date,p_end date)
returns jsonb language plpgsql stable security definer set search_path=pg_catalog,public,pg_temp as $$
declare actor uuid:=current_public_user_id(); all_staff boolean; own_staff uuid; base payroll_period_bases%rowtype; state payroll_close_state%rowtype; result jsonb;
begin
 if actor is null then raise exception 'Sign in to view payroll.'; end if;
 all_staff:=coalesce(user_has_salon_permission(p_salon,array['payroll.view','payroll.manage','payroll.tax_company']),false) or coalesce(tax_company_has_access(p_salon),false);
 if not all_staff then
   select case when count(*)=1 then min(s.id::text)::uuid else null end into own_staff from staff s
   where s.salon_id=p_salon and s.is_active and (s.account_user_id=actor or (s.account_user_id is null and s.user_id=auth.uid()));
   if own_staff is null then raise exception 'Payroll access is not available.'; end if;
 end if;
 select * into base from payroll_period_bases where salon_id=p_salon and period_start=p_start and period_end=p_end;
 if not found then
   select * into state from payroll_close_state where salon_id=p_salon;
   return jsonb_build_object('state',case when exists(select 1 from payroll_close_inputs where salon_id=p_salon and period_start=p_start and period_end=p_end) then 'processing' when state.configuration_issue is not null or state.salon_id is null then 'schedule_review' when p_start=state.period_start and p_end=state.period_end then case when state.period_end<(clock_timestamp() at time zone state.timezone_iana)::date then 'processing' else 'open' end when p_end<(clock_timestamp() at time zone state.timezone_iana)::date then 'legacy_review' else 'range' end,'configurationIssue',state.configuration_issue,'canAdjust',false,'base',null,'lines','[]'::jsonb,'adjustments','[]'::jsonb,'payments','[]'::jsonb,'revision',0);
 end if;
 return jsonb_build_object('state','closed','canAdjust',lifecycle_user_is_salon_owner(p_salon,actor,true),
 'base',jsonb_build_object('id',base.id,'periodStart',base.period_start,'periodEnd',base.period_end,'cycleType',base.cycle_type,'createdAt',base.created_at,'engineVersion',base.engine_version),
 'shopDailyRows',case when all_staff then coalesce(base.original_snapshot->'settings_snapshot'->'shopDailyRows','[]') else '[]'::jsonb end,
 'lines',coalesce((select jsonb_agg(l.original_line order by l.staff_id) from payroll_base_staff_lines l where l.base_id=base.id and (all_staff or l.staff_id=own_staff)),'[]'),
 'adjustments',coalesce((select jsonb_agg(to_jsonb(a) order by a.revision) from payroll_owner_adjustments a where a.base_id=base.id and (all_staff or a.staff_id=own_staff)),'[]'),
 'payments',coalesce((select jsonb_agg(to_jsonb(p) order by p.paid_at,p.recorded_at,p.id) from payroll_recorded_payments p where p.base_id=base.id and (all_staff or p.staff_id=own_staff)),'[]'),
 'revision',(select coalesce(max(r.revision),0) from (select a.revision from payroll_owner_adjustments a where a.base_id=base.id and (all_staff or a.staff_id=own_staff) union all select p.revision from payroll_recorded_payments p where p.base_id=base.id and (all_staff or p.staff_id=own_staff)) r),
 'legacyPaidHistory',coalesce((select jsonb_agg(jsonb_build_object('runId',r.id,'version',r.version,'paidAt',r.paid_at)) from payroll_runs r where r.salon_id=p_salon and r.period_start=p_start and r.period_end=p_end and r.status='paid' and r.id<>base.id and (all_staff or exists(select 1 from payroll_staff_lines l where l.payroll_run_id=r.id and l.staff_id=own_staff))),'[]'));
end;$$;
revoke all on function public.read_payroll_period_ledger(uuid,date,date) from public,anon;
grant execute on function public.read_payroll_period_ledger(uuid,date,date) to authenticated;

create function public.read_payroll_range_ledgers(p_salon uuid,p_start date,p_end date)
returns jsonb language plpgsql stable security definer set search_path=pg_catalog,public,pg_temp as $$
declare result jsonb; current_period jsonb;
begin
 if p_start is null or p_end is null or p_end<p_start or p_end-p_start>366 then raise exception 'Choose a report range of up to one year.'; end if;
 -- Authorize before reading even empty or future ranges.
 perform read_payroll_period_ledger(p_salon,p_start,p_end);
 select coalesce(jsonb_agg(read_payroll_period_ledger(p_salon,b.period_start,b.period_end) order by b.period_start),'[]') into result
 from payroll_period_bases b where b.salon_id=p_salon and b.period_start<=p_end and b.period_end>=p_start;
 select jsonb_build_object('start',s.period_start,'end',s.period_end,'cycle',s.cycle_type) into current_period from payroll_close_state s where s.salon_id=p_salon and s.configuration_issue is null
   and s.period_end>=(clock_timestamp() at time zone s.timezone_iana)::date and s.period_start<=p_end and s.period_end>=p_start;
 return jsonb_build_object('periods',result,'current',current_period,'pending',exists(
   select 1 from payroll_close_inputs i where i.salon_id=p_salon and i.period_start<=p_end and i.period_end>=p_start
   and not exists(select 1 from payroll_period_bases b where b.input_id=i.id)));
end;$$;
revoke all on function public.read_payroll_range_ledgers(uuid,date,date) from public,anon;
grant execute on function public.read_payroll_range_ledgers(uuid,date,date) to authenticated;
commit;
