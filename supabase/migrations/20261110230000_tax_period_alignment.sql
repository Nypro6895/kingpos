-- No stored statements or historical setting rows are rewritten.
create function public.payroll_setting_period_start(p_salon uuid,p_date date) returns date
language plpgsql stable security definer set search_path=public as $$
declare schedule salon_payroll_settings; anchor date; begin
 select * into schedule from salon_payroll_settings where salon_id=p_salon;
 if coalesce(schedule.cycle_type,'monthly')='monthly' then return date_trunc('month',p_date)::date;
 elsif schedule.cycle_type='semi_monthly' then return date_trunc('month',p_date)::date + case when extract(day from p_date)>15 then 15 else 0 end;
 elsif schedule.cycle_type='biweekly' then
 anchor:=schedule.biweekly_anchor_date;
 if anchor is null then raise exception 'Set the biweekly payroll start date first.'; end if;
 return anchor + floor((p_date-anchor)::numeric/14)::integer*14;
 end if;
 raise exception 'Choose a supported payroll schedule first.';
end $$;
revoke all on function public.payroll_setting_period_start(uuid,date) from public,anon,authenticated;

create function public.tax_whole_period_setting_guard() returns trigger language plpgsql security definer set search_path=public as $$
declare period_start date; begin
 if new.effective_to is not null and payroll_setting_period_start(new.salon_id,new.effective_to+1)<>new.effective_to+1 then raise exception 'Settings must end at a whole payroll period boundary.'; end if;
 -- Existing legacy starts may be closed at a valid boundary without rewriting history.
 if tg_op='UPDATE' and to_jsonb(new)-array['effective_to','updated_at'] = to_jsonb(old)-array['effective_to','updated_at'] then return new; end if;
 period_start:=payroll_setting_period_start(new.salon_id,new.effective_from);
 if new.effective_from is null or period_start<>new.effective_from then raise exception 'Settings must start with a whole payroll period (%). Choose this entire period or the next period.',period_start; end if;
 -- Also prevent a legacy scheduled row from silently splitting a newly selected period.
 if exists(select 1 from staff_payroll_settings s where s.salon_id=new.salon_id and s.staff_id=new.staff_id and s.id is distinct from new.id and s.effective_from>new.effective_from and payroll_setting_period_start(new.salon_id,s.effective_from)=period_start) then
 raise exception 'A legacy mid-period setting exists. Resolve its scheduled date before applying a whole-period replacement.'; end if;
 return new;
end $$;
revoke all on function public.tax_whole_period_setting_guard() from public,anon,authenticated;
create trigger tax_whole_period_settings before insert or update of effective_from,effective_to,tax_rate,tax_tips,tax_bonus,cash_to_tax_company,commission_rate,check_rate,pay_type,fixed_pay_amount,tip_payout_method,bonus_payout_method,apply_tax_to_fixed_pay on public.staff_payroll_settings for each row execute function public.tax_whole_period_setting_guard();

create function public.tax_setting_change_notice() returns trigger language plpgsql security definer set search_path=public as $$
begin
 if tg_op='UPDATE' and to_jsonb(new)-array['updated_at','effective_to'] = to_jsonb(old)-array['updated_at','effective_to'] then return new; end if;
 perform tax_event(new.salon_id,'payroll_settings_changed',new.staff_id,jsonb_build_object('effective_from',new.effective_from,'whole_period',true));
 return new;
end $$;
revoke all on function public.tax_setting_change_notice() from public,anon,authenticated;
create trigger tax_settings_notice after insert or update of effective_from,tax_rate,tax_tips,tax_bonus,cash_to_tax_company,commission_rate,check_rate,pay_type,fixed_pay_amount,tip_payout_method,bonus_payout_method,apply_tax_to_fixed_pay on public.staff_payroll_settings for each row execute function public.tax_setting_change_notice();

create or replace function public.tax_workspace_data(p_salon uuid) returns jsonb language plpgsql stable security definer set search_path=public as $$
begin
 perform tax_actor();
 if not tax_can_work(p_salon) then raise exception 'This salon connection is inactive.'; end if;
 return jsonb_build_object(
 'people',coalesce((select jsonb_agg(jsonb_build_object('id',s.id,'name',s.display_name) order by s.display_name) from staff s where s.salon_id=p_salon),'[]'::jsonb),
 'salon',(select jsonb_build_object('id',id,'name',name,'phone',phone,'city',city,'state',state,'address_line1',address_line1) from locations where id=p_salon),
 'runs',coalesce((select jsonb_agg(jsonb_build_object('id',r.id,'period_start',r.period_start,'period_end',r.period_end,'version',r.version,'status',r.status,'cycle_type',r.cycle_type) order by r.period_start desc,r.version desc) from payroll_runs r where r.salon_id=p_salon and r.status in ('printed','paid')),'[]'::jsonb),
 'lines',coalesce((select jsonb_agg(jsonb_build_object('id',l.id,'run_id',l.payroll_run_id,'staff_id',l.staff_id,'name',l.staff_display_name_snapshot,'legal_name',l.staff_legal_name_snapshot,
 'reported_wage',l.tax_company_reported_wage_gross,'reported_gross',l.tax_company_taxable_gross,'mixed_settings',l.is_mixed_rate,'tax',l.tax_withheld,'actual_check',l.final_check_amount,'wage_check_net',l.base_check_amount,
 'cash_reported',case when l.cash_to_tax_company_snapshot or (l.tax_tips_snapshot and l.tip_payout_method_snapshot='cash') or (l.tax_bonus_snapshot and l.bonus_payout_method_snapshot='cash') then l.tax_company_cash_amount else null end,
 'tip',case when l.tax_tips_snapshot then case when l.tax_company_taxable_gross-l.tax_company_reported_wage_gross-(case when l.tax_bonus_snapshot then l.bonus_amount else 0 end)>=0 then l.tax_company_taxable_gross-l.tax_company_reported_wage_gross-(case when l.tax_bonus_snapshot then l.bonus_amount else 0 end) else null end else null end,'tip_method',case when l.tax_tips_snapshot then case when l.is_mixed_rate then 'historical settings' else l.tip_payout_method_snapshot end else null end,
 'bonus',case when l.tax_bonus_snapshot then l.bonus_amount else null end,'bonus_method',case when l.tax_bonus_snapshot then l.bonus_payout_method_snapshot else null end,'tax_rate',case when l.is_mixed_rate then null else l.tax_rate_used end,
 'work_status',coalesce(w.status,'pending'),'work_version',coalesce(w.version,0))) from payroll_staff_lines l
 join payroll_runs r on r.id=l.payroll_run_id and r.salon_id=l.salon_id
 left join tax_work_items w on w.payroll_run_id=l.payroll_run_id and w.staff_id=l.staff_id
 where l.salon_id=p_salon and r.status in ('printed','paid') and (l.tax_company_enabled_snapshot or l.final_check_amount<>0 or l.tax_company_taxable_gross>0 or l.tax_withheld>0)),'[]'::jsonb),
 'documents',coalesce((select jsonb_agg(to_jsonb(d)-'path'-'bucket' order by d.created_at desc) from tax_documents d where d.salon_id=p_salon and d.owner_deleted_at is null),'[]'::jsonb),
 'messages',coalesce((select jsonb_agg(to_jsonb(m) order by m.created_at) from tax_messages m where m.salon_id=p_salon),'[]'::jsonb),
 'receipts',coalesce((select jsonb_agg(to_jsonb(c) order by c.receipt_date desc) from tax_receipts c where c.salon_id=p_salon),'[]'::jsonb),
 'events',coalesce((select jsonb_agg(to_jsonb(e) order by e.created_at desc) from (select * from tax_events where salon_id=p_salon order by created_at desc limit 200) e),'[]'::jsonb));
end $$;


create or replace function public.tax_businesses() returns jsonb language sql stable security definer set search_path=public as $$
 with connected as (select l.id,l.name,l.city,l.state from tax_company_connections c join locations l on l.id=c.salon_id where c.user_id=current_public_user_id() and tax_company_has_access(l.id)),
 latest as (select distinct on (r.salon_id,r.period_start,r.period_end) r.* from payroll_runs r join connected c on c.id=r.salon_id where r.status in ('printed','paid') order by r.salon_id,r.period_start,r.period_end,r.version desc),
 actionable as (select l.salon_id,l.staff_id,l.payroll_run_id,coalesce(w.status,'pending') status from payroll_staff_lines l join latest r on r.id=l.payroll_run_id left join tax_work_items w on w.payroll_run_id=l.payroll_run_id and w.staff_id=l.staff_id
 where l.tax_company_enabled_snapshot or l.final_check_amount<>0 or l.tax_company_taxable_gross>0 or l.tax_withheld>0)
 select coalesce(jsonb_agg(jsonb_build_object('id',c.id,'name',c.name,'city',c.city,'state',c.state,'active',true,
 'pending_count',(select count(*) from actionable a where a.salon_id=c.id and not exists(select 1 from tax_documents d where d.salon_id=a.salon_id and d.staff_id=a.staff_id and d.payroll_run_id=a.payroll_run_id and d.kind='paystub' and d.archived_at is null and d.owner_deleted_at is null)),
 'missing_paystubs',(select count(*) from actionable a where a.salon_id=c.id and not exists(select 1 from tax_documents d where d.salon_id=a.salon_id and d.staff_id=a.staff_id and d.payroll_run_id=a.payroll_run_id and d.kind='paystub' and d.archived_at is null and d.owner_deleted_at is null))) order by c.name),'[]'::jsonb) from connected c;
$$;


notify pgrst,'reload schema';
