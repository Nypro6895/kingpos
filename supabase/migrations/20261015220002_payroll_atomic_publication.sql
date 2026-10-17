begin;
create function public.publish_payroll_period_base(p_input uuid,p_lease uuid,p_input_sha256 text,p_result jsonb,p_engine_version text)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public,pg_temp as $$
declare source payroll_close_inputs%rowtype; job payroll_close_jobs%rowtype; base payroll_period_bases%rowtype; run_id uuid:=gen_random_uuid(); next_version integer; item jsonb; day jsonb; line_id uuid; field text; original_line jsonb; original_days jsonb; staff_exists boolean;
begin
 if auth.role() is distinct from 'service_role' then raise exception 'Worker authorization required.'; end if;
 select * into source from payroll_close_inputs where id=p_input;
 if not found or source.input_sha256 is distinct from p_input_sha256 then raise exception 'Frozen payroll input does not match.'; end if;
 perform pg_advisory_xact_lock(hashtextextended('payroll-close:'||source.salon_id::text,0));
 select * into base from payroll_period_bases where input_id=p_input;
 if found then return jsonb_build_object('baseId',base.id,'alreadyPublished',true); end if;
 select * into job from payroll_close_jobs where input_id=p_input for update;
 if job.input_id is null or p_lease is null or job.state<>'working' or job.lease_id is distinct from p_lease or job.leased_until is null or job.leased_until<clock_timestamp() then raise exception 'Payroll worker lease expired. Retry with a new lease.'; end if;
 if p_engine_version is null or length(p_engine_version) not between 1 and 80 or p_result is null or jsonb_typeof(p_result->'lines') is distinct from 'array' or jsonb_typeof(p_result->'settings_snapshot') is distinct from 'object' then raise exception 'Invalid payroll publication.'; end if;
 if exists(select 1 from payroll_period_bases b where b.salon_id=source.salon_id and daterange(b.period_start,b.period_end,'[]')&&daterange(source.period_start,source.period_end,'[]')) then raise exception 'Payroll base overlaps an existing period.'; end if;
 if (select count(*) from jsonb_array_elements(p_result->'lines'))<>(select count(distinct x.value->>'staff_id') from jsonb_array_elements(p_result->'lines') as x(value)) then raise exception 'Duplicate staff lines.'; end if;
 select coalesce(max(version),0)+1 into next_version from payroll_runs where salon_id=source.salon_id and period_start=source.period_start and period_end=source.period_end;
 insert into payroll_runs(id,salon_id,period_start,period_end,cycle_type,status,version,settings_snapshot,correction_snapshot,generated_at,printed_at)
 values(run_id,source.salon_id,source.period_start,source.period_end,source.cycle_type,'printed',next_version,p_result->'settings_snapshot',coalesce(p_result->'corrections','[]'),clock_timestamp(),clock_timestamp());
 insert into payroll_period_bases(id,input_id,salon_id,period_start,period_end,cycle_type,original_snapshot,engine_version)
 values(run_id,p_input,source.salon_id,source.period_start,source.period_end,source.cycle_type,p_result,p_engine_version);
 for item in select value from jsonb_array_elements(p_result->'lines') loop
   if not exists(select 1 from jsonb_array_elements(source.input_packet->'staffRows') s where s->>'id'=item->>'staff_id') then raise exception 'Publication includes staff outside the frozen input.'; end if;
   if round((item->>'final_cash_amount')::numeric+(item->>'final_check_amount')::numeric,2) is distinct from (item->>'final_staff_income')::numeric then raise exception 'Payroll split does not match final income.'; end if;
   foreach field in array array['final_cash_amount','final_check_amount','final_staff_income','gross_sales','staff_commission_gross','tax_withheld','tax_company_taxable_gross','tax_company_cash_amount'] loop
     if jsonb_typeof(item->field) is distinct from 'number' or (item->>field)::numeric<>round((item->>field)::numeric,2) or abs((item->>field)::numeric)>9999999999.99 then raise exception 'Invalid payroll amount in publication.'; end if;
   end loop;
   line_id:=gen_random_uuid();
   original_line:=to_jsonb(jsonb_populate_record(null::payroll_staff_lines,item||jsonb_build_object('id',line_id,'payroll_run_id',run_id,'salon_id',source.salon_id,'created_at',clock_timestamp(),'updated_at',clock_timestamp())));
   staff_exists:=exists(select 1 from staff s where s.id=(item->>'staff_id')::uuid and s.salon_id=source.salon_id);
   -- Historical JSON remains complete even if a source staff profile was deleted
   -- after capture. Legacy projection tables keep their existing FK lifecycle.
   if staff_exists then insert into payroll_staff_lines select (jsonb_populate_record(null::payroll_staff_lines,original_line)).*; end if;
   if jsonb_typeof(item->'dailyTotals') is distinct from 'array' then raise exception 'Payroll daily details are required.'; end if;
   original_days:='[]';
   for day in select value from jsonb_array_elements(item->'dailyTotals') loop
     if (day->>'business_date')::date not between source.period_start and source.period_end or day->>'staff_id' is distinct from item->>'staff_id' then raise exception 'Daily row is outside the payroll period or staff line.'; end if;
     day:=to_jsonb(jsonb_populate_record(null::payroll_staff_daily_totals,day||jsonb_build_object('id',gen_random_uuid(),'payroll_run_id',run_id,'salon_id',source.salon_id,'created_at',clock_timestamp(),'updated_at',clock_timestamp())));
     original_days:=original_days||jsonb_build_array(day);
     if staff_exists then insert into payroll_staff_daily_totals select (jsonb_populate_record(null::payroll_staff_daily_totals,day)).*; end if;
   end loop;
   if jsonb_typeof(item->'dailyIncome') is distinct from 'array' then raise exception 'Daily income allocation is required.'; end if;
   if (select count(*) from jsonb_array_elements(item->'dailyIncome'))<>(select count(distinct d->>'businessDate') from jsonb_array_elements(item->'dailyIncome') d) then raise exception 'Daily income dates must be present and unique.'; end if;
   for day in select value from jsonb_array_elements(item->'dailyIncome') loop
     if (day->>'businessDate')::date not between source.period_start and source.period_end then raise exception 'Daily income is outside the payroll period.'; end if;
     foreach field in array array['gross_sales','staff_commission_gross','shop_share','base_check_amount','base_cash_amount','cash_amount','check_gross','tax_withheld','check_net','tip_amount','tip_check_amount','tip_cash_amount','bonus_amount','bonus_check_amount','bonus_cash_amount','earned_amount','final_check_amount','final_cash_amount','final_staff_income','tax_company_reported_wage_gross','tax_company_taxable_gross','tax_company_check_amount','tax_company_cash_amount','fixed_pay_amount_used'] loop
       if jsonb_typeof(day->field) is distinct from 'number' or (day->>field)::numeric<>round((day->>field)::numeric,2) or abs((day->>field)::numeric)>9999999999.99 then raise exception 'Daily income amounts must use exact cents.'; end if;
     end loop;
   end loop;
   foreach field in array array['gross_sales','staff_commission_gross','shop_share','base_check_amount','base_cash_amount','cash_amount','check_gross','tax_withheld','check_net','tip_amount','tip_check_amount','tip_cash_amount','bonus_amount','bonus_check_amount','bonus_cash_amount','earned_amount','final_check_amount','final_cash_amount','final_staff_income','tax_company_reported_wage_gross','tax_company_taxable_gross','tax_company_check_amount','tax_company_cash_amount','fixed_pay_amount_used'] loop
     if (select coalesce(sum((d->>field)::numeric),0) from jsonb_array_elements(item->'dailyIncome') d) is distinct from coalesce((item->>field)::numeric,0) then raise exception 'Daily income does not reconcile with the original staff total.'; end if;
   end loop;
   insert into payroll_base_staff_lines(base_id,salon_id,staff_id,original_line)
   values(run_id,source.salon_id,(item->>'staff_id')::uuid,original_line||jsonb_build_object('dailyTotals',original_days,'dailyIncome',item->'dailyIncome'));
 end loop;
 update payroll_close_jobs set state='complete',completed_at=clock_timestamp(),leased_until=null,last_error=null where input_id=p_input;
 return jsonb_build_object('baseId',run_id,'alreadyPublished',false);
end;$$;
revoke all on function public.publish_payroll_period_base(uuid,uuid,text,jsonb,text) from public,anon,authenticated;
grant execute on function public.publish_payroll_period_base(uuid,uuid,text,jsonb,text) to service_role;

create function public.fail_payroll_close_job(p_input uuid,p_lease uuid)
returns void language plpgsql security definer set search_path=pg_catalog,public,pg_temp as $$
begin
 if auth.role() is distinct from 'service_role' then raise exception 'Worker authorization required.'; end if;
 update payroll_close_jobs set state='error',leased_until=clock_timestamp()+interval '5 minutes',last_error='Payroll calculation or publication needs retry.' where input_id=p_input and state='working' and lease_id=p_lease;
end;$$;
revoke all on function public.fail_payroll_close_job(uuid,uuid) from public,anon,authenticated;
grant execute on function public.fail_payroll_close_job(uuid,uuid) to service_role;

create function public.payroll_require_owner_write()
returns trigger language plpgsql security definer set search_path=pg_catalog,public,pg_temp as $$
declare salon uuid:=coalesce((to_jsonb(new)->>'salon_id')::uuid,(to_jsonb(old)->>'salon_id')::uuid);
begin
 if tg_op='DELETE' and not exists(select 1 from locations where id=salon) then return old; end if;
 if auth.role() in ('authenticated','anon') and not coalesce(lifecycle_user_is_salon_owner(salon,current_public_user_id(),true),false) then raise exception 'Only the current salon Owner can change payroll.'; end if;
 if tg_table_name='payroll_period_staff_inputs' and exists(select 1 from payroll_close_inputs i where i.salon_id=salon and i.period_start=coalesce((to_jsonb(new)->>'period_start')::date,(to_jsonb(old)->>'period_start')::date) and i.period_end=coalesce((to_jsonb(new)->>'period_end')::date,(to_jsonb(old)->>'period_end')::date)) and auth.role()='authenticated' then
   raise exception 'This payroll period is closed. Use an Owner adjustment with a reason.';
 end if;
 return case when tg_op='DELETE' then old else new end;
end;$$;
revoke all on function public.payroll_require_owner_write() from public,anon,authenticated,service_role;
do $$declare t text;begin foreach t in array array['staff_payroll_settings','salon_payroll_settings','payroll_period_staff_inputs'] loop
 execute format('create trigger ab_payroll_require_owner_write before insert or update or delete on public.%I for each row execute function public.payroll_require_owner_write()',t);
end loop;end;$$;

create function public.payroll_protect_published_rows()
returns trigger language plpgsql security definer set search_path=pg_catalog,public,pg_temp as $$
declare row_data jsonb:=case when tg_op='DELETE' then to_jsonb(old) else to_jsonb(new) end; run_id uuid;
begin
 if tg_op='DELETE' and (not exists(select 1 from locations where id=(row_data->>'salon_id')::uuid)
   or (tg_table_name<>'payroll_runs' and not exists(select 1 from staff where id=(row_data->>'staff_id')::uuid))) then return old; end if;
 if auth.role() in ('authenticated','anon') then raise exception 'Payroll snapshots are published automatically. Use the Owner adjustment or payment action.'; end if;
 run_id:=case when tg_table_name='payroll_runs' then (row_data->>'id')::uuid else (row_data->>'payroll_run_id')::uuid end;
 if tg_op in ('UPDATE','DELETE') and exists(select 1 from payroll_period_bases where id=run_id) and exists(select 1 from locations where id=(row_data->>'salon_id')::uuid) then raise exception 'The original payroll snapshot cannot be rewritten.'; end if;
 return case when tg_op='DELETE' then old else new end;
end;$$;
revoke all on function public.payroll_protect_published_rows() from public,anon,authenticated,service_role;
do $$declare t text;begin foreach t in array array['payroll_runs','payroll_staff_lines','payroll_staff_daily_totals'] loop
 execute format('create trigger payroll_protect_published_rows before insert or update or delete on public.%I for each row execute function public.payroll_protect_published_rows()',t);
end loop;end;$$;
commit;
