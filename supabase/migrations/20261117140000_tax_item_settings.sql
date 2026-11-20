-- Additive item rules. NULL means the previous payroll rule; no saved settings
-- or published monetary snapshots are rewritten by this migration.
alter table public.staff_payroll_settings
 add column show_check_to_tax_company boolean,
 add column show_cash_to_tax_company boolean,
 add column show_tip_to_tax_company boolean,
 add column show_bonus_to_tax_company boolean,
 add column tax_check boolean,
 add column tax_cash boolean,
 add column check_tax_rate numeric check(check_tax_rate between 0 and 100),
 add column cash_tax_rate numeric check(cash_tax_rate between 0 and 100),
 add column tip_tax_rate numeric check(tip_tax_rate between 0 and 100),
 add column bonus_tax_rate numeric check(bonus_tax_rate between 0 and 100);
alter table public.payroll_staff_lines add column tax_reporting_snapshot jsonb
 check(tax_reporting_snapshot is null or (jsonb_typeof(tax_reporting_snapshot)='object' and tax_reporting_snapshot->>'version'='1'));

create or replace function public.save_owner_live_payroll_setting(p_salon uuid,p_staff uuid,p_effective date,p_values jsonb,p_expected_id uuid,p_expected_updated_at timestamptz) returns jsonb
language plpgsql security definer set search_path=pg_catalog as $$
declare current_row public.staff_payroll_settings%rowtype; expected_row public.staff_payroll_settings%rowtype; v public.staff_payroll_settings%rowtype;
 inherited jsonb; supplied jsonb; rate numeric;
 item_fields text[]:=array['show_check_to_tax_company','show_cash_to_tax_company','show_tip_to_tax_company','show_bonus_to_tax_company','tax_check','tax_cash','check_tax_rate','cash_tax_rate','tip_tax_rate','bonus_tax_rate'];
 field text;
begin
 if not public.payroll_live_is_owner(p_salon) then raise exception 'Only the Owner can change payroll settings' using errcode='42501'; end if;
 if p_effective is null or p_values is null or not exists(select 1 from public.staff where id=p_staff and salon_id=p_salon) then raise exception 'Invalid payroll setting' using errcode='22023'; end if;
 v:=jsonb_populate_record(null::public.staff_payroll_settings,p_values);
 if jsonb_typeof(p_values->'fixed_pay_amount')<>'number' or (p_values->>'fixed_pay_amount')::numeric<>round((p_values->>'fixed_pay_amount')::numeric,2) then raise exception 'Use at most two decimals for fixed pay' using errcode='22023'; end if;
 if v.pay_type is null or v.pay_type not in ('fixed','commission') or v.tip_payout_method is null or v.tip_payout_method not in ('cash','check') or v.bonus_payout_method is null or v.bonus_payout_method not in ('cash','check')
 or v.commission_rate is null or v.commission_rate not between 0 and 100 or v.check_rate is null or v.check_rate not between 0 and 100 or v.tax_rate is null or v.tax_rate not between 0 and 100
 or v.fixed_pay_amount is null or v.fixed_pay_amount<0 or length(coalesce(v.legal_name,''))>200
 or v.apply_tax_to_fixed_pay is null or v.tax_tips is null or v.tax_bonus is null or v.cash_to_tax_company is null or v.tax_company_enabled is null then raise exception 'Invalid payroll setting values' using errcode='22023'; end if;
 foreach field in array item_fields loop
  if p_values ? field and p_values->field<>'null'::jsonb then
   if field like '%\_rate' escape '\' then
    if jsonb_typeof(p_values->field)<>'number' then raise exception 'Each item tax rate must be between 0 and 100.' using errcode='22023'; end if;
    rate:=(p_values->>field)::numeric;
    if rate not between 0 and 100 then raise exception 'Each item tax rate must be between 0 and 100.' using errcode='22023'; end if;
   elsif jsonb_typeof(p_values->field)<>'boolean' then raise exception 'Choose Show and Apply tax separately for each payroll item.' using errcode='22023'; end if;
  end if;
 end loop;
 perform pg_advisory_xact_lock(hashtextextended('payroll-setting:'||p_salon::text||p_staff::text,0));
 perform 1 from public.staff_payroll_settings where salon_id=p_salon and staff_id=p_staff for update;
 select * into current_row from public.staff_payroll_settings where salon_id=p_salon and staff_id=p_staff and effective_from=p_effective;
 if p_expected_id is not null then
  select * into expected_row from public.staff_payroll_settings where id=p_expected_id and salon_id=p_salon and staff_id=p_staff;
  if expected_row.id is null or expected_row.updated_at is distinct from p_expected_updated_at then raise exception 'Payroll settings changed on another screen. Reload before saving.' using errcode='PT409'; end if;
 elsif exists(select 1 from public.staff_payroll_settings where salon_id=p_salon and staff_id=p_staff) then
  raise exception 'Payroll settings changed on another screen. Reload before saving.' using errcode='PT409';
 end if;
 -- An old client that saves compensation must retain already-configured item
 -- rules. Explicit JSON null from the new form restores the legacy fallback.
 select to_jsonb(s) into inherited from public.staff_payroll_settings s where salon_id=p_salon and staff_id=p_staff and effective_from<=p_effective and (effective_to is null or effective_to>=p_effective) order by effective_from desc limit 1;
 select coalesce(jsonb_object_agg(key,value),'{}') into inherited from jsonb_each(coalesce(inherited,'{}')) where key=any(item_fields);
 select coalesce(jsonb_object_agg(key,value),'{}') into supplied from jsonb_each(p_values) where key=any(item_fields);
 v:=jsonb_populate_record(v,inherited||supplied);
 if current_row.id is not null then
  update public.staff_payroll_settings set apply_tax_to_fixed_pay=v.apply_tax_to_fixed_pay,bonus_payout_method=v.bonus_payout_method,cash_to_tax_company=v.cash_to_tax_company,check_rate=v.check_rate,commission_rate=v.commission_rate,fixed_pay_amount=v.fixed_pay_amount,legal_name=v.legal_name,pay_type=v.pay_type,tax_bonus=v.tax_bonus,tax_company_enabled=v.tax_company_enabled,tax_rate=v.tax_rate,tax_tips=v.tax_tips,tip_payout_method=v.tip_payout_method,
   show_check_to_tax_company=v.show_check_to_tax_company,show_cash_to_tax_company=v.show_cash_to_tax_company,show_tip_to_tax_company=v.show_tip_to_tax_company,show_bonus_to_tax_company=v.show_bonus_to_tax_company,tax_check=v.tax_check,tax_cash=v.tax_cash,check_tax_rate=v.check_tax_rate,cash_tax_rate=v.cash_tax_rate,tip_tax_rate=v.tip_tax_rate,bonus_tax_rate=v.bonus_tax_rate
  where id=current_row.id returning * into current_row;
 else
  update public.staff_payroll_settings set effective_to=p_effective-1 where salon_id=p_salon and staff_id=p_staff and effective_from<p_effective and (effective_to is null or effective_to>=p_effective);
  insert into public.staff_payroll_settings(salon_id,staff_id,effective_from,effective_to,apply_tax_to_fixed_pay,bonus_payout_method,cash_to_tax_company,check_rate,commission_rate,fixed_pay_amount,legal_name,pay_type,tax_bonus,tax_company_enabled,tax_rate,tax_tips,tip_payout_method,
   show_check_to_tax_company,show_cash_to_tax_company,show_tip_to_tax_company,show_bonus_to_tax_company,tax_check,tax_cash,check_tax_rate,cash_tax_rate,tip_tax_rate,bonus_tax_rate)
  values(p_salon,p_staff,p_effective,(select min(effective_from)-1 from public.staff_payroll_settings where salon_id=p_salon and staff_id=p_staff and effective_from>p_effective),v.apply_tax_to_fixed_pay,v.bonus_payout_method,v.cash_to_tax_company,v.check_rate,v.commission_rate,v.fixed_pay_amount,v.legal_name,v.pay_type,v.tax_bonus,v.tax_company_enabled,v.tax_rate,v.tax_tips,v.tip_payout_method,
   v.show_check_to_tax_company,v.show_cash_to_tax_company,v.show_tip_to_tax_company,v.show_bonus_to_tax_company,v.tax_check,v.tax_cash,v.check_tax_rate,v.cash_tax_rate,v.tip_tax_rate,v.bonus_tax_rate) returning * into current_row;
 end if;
 return to_jsonb(current_row);
end $$;
-- Retain the logical save/notice wrapper as the only authenticated entry point.
revoke all on function public.save_owner_live_payroll_setting(uuid,uuid,date,jsonb,uuid,timestamptz) from public,anon,authenticated;

-- Extend existing auditing and notices without replacing their authorization,
-- immutable history, staff-recipient scoping or concurrency mechanisms.
do $$ declare definition text; original text:='''cash_to_tax_company'',''tax_company_enabled'''; extended text:='''cash_to_tax_company'',''tax_company_enabled'',''show_check_to_tax_company'',''show_cash_to_tax_company'',''show_tip_to_tax_company'',''show_bonus_to_tax_company'',''tax_check'',''tax_cash'',''check_tax_rate'',''cash_tax_rate'',''tip_tax_rate'',''bonus_tax_rate'''; begin
 definition:=pg_get_functiondef('public.audit_payroll_live_change()'::regprocedure);
 if position(original in definition)=0 then raise exception 'Payroll audit field list requires integration review.'; end if;
 execute replace(definition,original,extended);
 if to_regprocedure('public.financial_input_notice_summary(text,jsonb,jsonb,boolean,text)') is not null then
  definition:=pg_get_functiondef('public.financial_input_notice_summary(text,jsonb,jsonb,boolean,text)'::regprocedure);
  if position(original in definition)>0 then execute replace(definition,original,extended); end if;
 end if;
end $$;
drop trigger tax_whole_period_settings on public.staff_payroll_settings;
create trigger tax_whole_period_settings before insert or update of effective_from,effective_to,tax_rate,tax_tips,tax_bonus,cash_to_tax_company,commission_rate,check_rate,pay_type,fixed_pay_amount,tip_payout_method,bonus_payout_method,apply_tax_to_fixed_pay,show_check_to_tax_company,show_cash_to_tax_company,show_tip_to_tax_company,show_bonus_to_tax_company,tax_check,tax_cash,check_tax_rate,cash_tax_rate,tip_tax_rate,bonus_tax_rate on public.staff_payroll_settings for each row execute function public.tax_whole_period_setting_guard();
drop trigger tax_settings_notice on public.staff_payroll_settings;
create trigger tax_settings_notice after insert or update of effective_from,tax_rate,tax_tips,tax_bonus,cash_to_tax_company,commission_rate,check_rate,pay_type,fixed_pay_amount,tip_payout_method,bonus_payout_method,apply_tax_to_fixed_pay,show_check_to_tax_company,show_cash_to_tax_company,show_tip_to_tax_company,show_bonus_to_tax_company,tax_check,tax_cash,check_tax_rate,cash_tax_rate,tip_tax_rate,bonus_tax_rate on public.staff_payroll_settings for each row execute function public.tax_setting_change_notice();
notify pgrst,'reload schema';
