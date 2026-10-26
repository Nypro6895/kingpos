begin;

alter table public.pos_daily_closings add column live_report_entered_at timestamptz;
alter table public.pos_daily_closings add column owner_live_revision bigint not null default 0;
-- Preserve already applied legacy cash corrections when switching to current
-- columns. Old snapshots and adjustment records themselves remain untouched.
with applied as (
  select salon_id,business_date,sum(cash_delta) cash,sum(credit_card_delta) card,sum(other_delta) other
  from public.pos_financial_adjustments group by salon_id,business_date
)
update public.pos_daily_closings c set
  cash_amount=coalesce(c.cash_amount_snapshot,c.cash_amount)+coalesce(a.cash,0),
  credit_card_amount=coalesce(c.credit_card_amount_snapshot,c.credit_card_amount)+coalesce(a.card,0),
  other_amount=coalesce(c.other_amount_snapshot,c.other_amount)+coalesce(a.other,0)
from applied a where a.salon_id=c.salon_id and a.business_date=c.report_date and c.snapshot_created_at is not null;
update public.pos_daily_closings c set note=(
  select r.requested_value_json->>'value' from public.pos_financial_correction_requests r
  where r.salon_id=c.salon_id and r.business_date=c.report_date and r.status='applied' and r.correction_type='note'
  order by r.requested_at desc,r.id desc limit 1
) where exists(select 1 from public.pos_financial_correction_requests r where r.salon_id=c.salon_id and r.business_date=c.report_date and r.status='applied' and r.correction_type='note');
update public.pos_daily_closings set live_report_entered_at=coalesce(closed_at,updated_at,created_at)
where cash_amount<>0 or credit_card_amount<>0 or other_amount<>0 or note is not null or closed_at is not null;

-- One current dataset. This table is an append-only audit, never a second balance.
create table public.payroll_live_change_history (
  id uuid primary key default gen_random_uuid(),
  salon_id uuid not null references public.locations(id) on delete cascade,
  staff_id uuid references public.staff(id) on delete cascade,
  source_table text not null,
  source_id uuid not null,
  period_start date not null,
  period_end date not null,
  before_values jsonb not null,
  after_values jsonb not null,
  actor_id uuid references public.users(id) on delete set null,
  created_at timestamptz not null default clock_timestamp()
);
create index payroll_live_history_scope on public.payroll_live_change_history(salon_id,period_start,period_end,created_at desc,id);
alter table public.payroll_live_change_history enable row level security;
revoke all on public.payroll_live_change_history from public,anon,authenticated;
grant select on public.payroll_live_change_history to authenticated;
create policy payroll_live_history_read on public.payroll_live_change_history for select to authenticated using (
  public.user_has_salon_permission(salon_id,array['payroll.view','payroll.manage'])
  or (staff_id is not null and staff_id=public.current_user_staff_id_for_salon(salon_id))
);

create function public.payroll_live_is_owner(p_salon uuid) returns boolean
language sql stable security definer set search_path=pg_catalog as $$
  select exists(select 1 from public.locations l
    join public.account_memberships m on m.account_id=l.account_id
    join public.roles r on r.id=m.role_id
    where l.id=p_salon and m.user_id=public.current_public_user_id()
      and m.status='active' and r.code='OWNER');
$$;
revoke all on function public.payroll_live_is_owner(uuid) from public,anon;
grant execute on function public.payroll_live_is_owner(uuid) to authenticated;

create function public.mark_owner_report_entered() returns trigger
language plpgsql security definer set search_path=pg_catalog as $$
begin
  if new.live_report_entered_at is null and public.payroll_live_is_owner(new.salon_id)
    and (new.cash_amount<>0 or new.credit_card_amount<>0 or new.other_amount<>0 or new.note is not null)
    then new.live_report_entered_at:=clock_timestamp(); end if;
  if tg_op='INSERT' then new.owner_live_revision:=1;
  else new.owner_live_revision:=old.owner_live_revision+case when row(new.cash_amount,new.credit_card_amount,new.other_amount,new.note,new.live_report_entered_at) is distinct from row(old.cash_amount,old.credit_card_amount,old.other_amount,old.note,old.live_report_entered_at) then 1 else 0 end; end if;
  return new;
end; $$;
revoke all on function public.mark_owner_report_entered() from public,anon,authenticated;
create trigger owner_report_entered before insert or update on public.pos_daily_closings for each row execute function public.mark_owner_report_entered();

create function public.audit_payroll_live_change() returns trigger
language plpgsql security definer set search_path=pg_catalog as $$
declare b jsonb:='{}'; a jsonb:='{}'; fields text[]; sid uuid; old_staff uuid; new_staff uuid;
  recipient_staff uuid; actor uuid:=public.current_public_user_id(); starts date; ends date;
  audit_id uuid; target_user uuid; own_before jsonb; own_after jsonb; record_id uuid;
begin
  if tg_op<>'INSERT' then b:=to_jsonb(old); end if;
  if tg_op<>'DELETE' then a:=to_jsonb(new); end if;
  sid:=coalesce((a->>'salon_id')::uuid,(b->>'salon_id')::uuid);
  record_id:=coalesce((a->>'id')::uuid,(b->>'id')::uuid);
  if tg_op='UPDATE' and a->>'salon_id' is distinct from b->>'salon_id' then raise exception 'Financial records cannot move between salons' using errcode='42501'; end if;
  if tg_op='UPDATE' and (a->>'id' is distinct from b->>'id'
    or tg_table_name='pos_daily_closings' and a->>'report_date' is distinct from b->>'report_date'
    or tg_table_name='payroll_period_staff_inputs' and (a->>'period_start' is distinct from b->>'period_start' or a->>'period_end' is distinct from b->>'period_end' or a->>'cycle_type' is distinct from b->>'cycle_type')) then raise exception 'Financial record scope cannot be changed in place' using errcode='42501'; end if;
  if tg_table_name='pos_daily_closings' then
    fields:=array['cash_amount','credit_card_amount','other_amount','note','live_report_entered_at'];
    starts:=coalesce((a->>'report_date')::date,(b->>'report_date')::date); ends:=starts;
  elsif tg_table_name='payroll_period_staff_inputs' then
    fields:=array['bonus_amount','check_number','note'];
    starts:=coalesce((a->>'period_start')::date,(b->>'period_start')::date);
    ends:=coalesce((a->>'period_end')::date,(b->>'period_end')::date);
  elsif tg_table_name='salon_payroll_settings' then
    fields:=array['cycle_type','biweekly_anchor_date']; starts:='0001-01-01';ends:='9999-12-31';
  elsif tg_table_name='staff_payroll_settings' then
    fields:=array['pay_type','commission_rate','fixed_pay_amount','check_rate','tax_rate','apply_tax_to_fixed_pay','tax_tips','tax_bonus','tip_payout_method','bonus_payout_method','cash_to_tax_company','tax_company_enabled','legal_name','effective_from','effective_to'];
    starts:=least(coalesce((a->>'effective_from')::date,(b->>'effective_from')::date),coalesce((b->>'effective_from')::date,(a->>'effective_from')::date));
    ends:=greatest(coalesce((a->>'effective_to')::date,'9999-12-31'::date),coalesce((b->>'effective_to')::date,'9999-12-31'::date));
  else
    fields:=array['service_total','tip_amount','work_date'];
    starts:=least(coalesce((a->>'work_date')::date,(b->>'work_date')::date),coalesce((b->>'work_date')::date,(a->>'work_date')::date));
    ends:=greatest(coalesce((a->>'work_date')::date,(b->>'work_date')::date),coalesce((b->>'work_date')::date,(a->>'work_date')::date));
  end if;
  -- Automatic legacy snapshot creation with no entered money is not an edit.
  if tg_table_name='pos_daily_closings' and tg_op='INSERT' and coalesce((a->>'cash_amount')::numeric,0)=0 and coalesce((a->>'credit_card_amount')::numeric,0)=0 and coalesce((a->>'other_amount')::numeric,0)=0 and a->>'note' is null and a->>'live_report_entered_at' is null then return new; end if;
  old_staff:=(b->>'staff_id')::uuid; new_staff:=(a->>'staff_id')::uuid;
  select coalesce(jsonb_object_agg(key,value),'{}') into b from jsonb_each(b) where key=any(fields);
  select coalesce(jsonb_object_agg(key,value),'{}') into a from jsonb_each(a) where key=any(fields);
  if a=b and old_staff is not distinct from new_staff then
    if tg_op='DELETE' then return old; else return new; end if;
  end if;
  -- New closed-ticket earnings are normal POS activity, not edits. Later edits
  -- are Owner-only; triggers run inside the same transaction as the money write.
  if tg_table_name='pos_ticket_staff_earnings' and tg_op='INSERT' and not public.payroll_live_is_owner(sid) then return new; end if;
  if not public.payroll_live_is_owner(sid) then raise exception 'Only the Owner can change financial amounts' using errcode='42501'; end if;
  for recipient_staff in select distinct x from unnest(array[old_staff,new_staff]) x where x is not null
    union select s.id from public.staff s where tg_table_name='salon_payroll_settings' and s.salon_id=sid and s.is_active loop
    own_before:=case when old_staff=recipient_staff or tg_table_name='salon_payroll_settings' then b else '{}'::jsonb end;
    own_after:=case when new_staff=recipient_staff or tg_table_name='salon_payroll_settings' then a else '{}'::jsonb end;
    insert into public.payroll_live_change_history(salon_id,staff_id,source_table,source_id,period_start,period_end,before_values,after_values,actor_id)
      values(sid,recipient_staff,tg_table_name,record_id,starts,ends,own_before,own_after,actor) returning id into audit_id;
    select s.account_user_id into target_user from public.staff s where s.id=recipient_staff and s.salon_id=sid and s.is_active;
    if target_user is not null then
      insert into public.app_notifications(account_id,salon_id,recipient_user_id,recipient_kind,notification_type,title,body,href,event_key)
      select l.account_id,sid,target_user,'staff','payroll_updated','Payroll updated',
        'Your payroll was updated. View the current amounts and change history.',
        case when tg_table_name='salon_payroll_settings' then '/staff/my-work?tab=payroll' else '/staff/my-work?tab=payroll&payPeriodStart='||starts::text end,
        'payroll-live:'||audit_id::text from public.locations l where l.id=sid;
    end if;
  end loop;
  if old_staff is null and new_staff is null and (tg_table_name<>'salon_payroll_settings' or not exists(select 1 from public.staff where salon_id=sid and is_active)) then
    insert into public.payroll_live_change_history(salon_id,source_table,source_id,period_start,period_end,before_values,after_values,actor_id)
      values(sid,tg_table_name,record_id,starts,ends,b,a,actor);
  end if;
  if tg_op='DELETE' then return old; else return new; end if;
end; $$;
revoke all on function public.audit_payroll_live_change() from public,anon,authenticated;
create trigger payroll_live_input_audit after insert or update or delete on public.payroll_period_staff_inputs for each row execute function public.audit_payroll_live_change();
create trigger payroll_live_setting_audit after insert or update or delete on public.staff_payroll_settings for each row execute function public.audit_payroll_live_change();
create trigger payroll_live_schedule_audit after insert or update or delete on public.salon_payroll_settings for each row execute function public.audit_payroll_live_change();
create trigger payroll_live_daily_audit after insert or update or delete on public.pos_daily_closings for each row execute function public.audit_payroll_live_change();
create trigger payroll_live_earning_audit after insert or update or delete on public.pos_ticket_staff_earnings for each row execute function public.audit_payroll_live_change();

-- Owner Daily Report writes have their own safe retry receipt and revision guard.
create table public.owner_live_report_receipts (
  salon_id uuid not null references public.locations(id) on delete cascade,
  actor_id uuid not null references public.users(id) on delete cascade,
  request_id uuid not null,report_date date not null,payload jsonb not null,result jsonb not null,
  primary key(salon_id,actor_id,request_id)
);
alter table public.owner_live_report_receipts enable row level security;
revoke all on public.owner_live_report_receipts from public,anon,authenticated;

create function public.owner_live_report_state(p_salon uuid,p_date date) returns jsonb
language sql stable security definer set search_path=pg_catalog as $$
  select jsonb_build_object('revision',coalesce(r.owner_live_revision,0),'reportDate',p_date,'locked',not public.payroll_live_is_owner(p_salon),
    'closingInputs',jsonb_build_object('approvedAt',r.approved_at,'closedAt',r.closed_at,'cashAmount',coalesce(r.cash_amount,0),
      'creditCardAmount',coalesce(r.credit_card_amount,0),'otherAmount',coalesce(r.other_amount,0),'note',r.note,'status',coalesce(r.status,'draft')))
  from (select 1) anchor left join public.pos_daily_closings r on r.salon_id=p_salon and r.report_date=p_date;
$$;
revoke all on function public.owner_live_report_state(uuid,date) from public,anon,authenticated;
create function public.read_owner_live_daily_report(p_salon uuid,p_date date,p_request uuid default null) returns jsonb
language plpgsql stable security definer set search_path=pg_catalog as $$
declare actor uuid:=public.current_public_user_id(); receipt jsonb;
begin
  if actor is null or not public.user_has_salon_permission(p_salon,array['reports.view','payroll.view','payroll.manage']) then raise exception 'Not authorized' using errcode='42501'; end if;
  select result into receipt from public.owner_live_report_receipts where salon_id=p_salon and actor_id=actor and request_id=p_request and report_date=p_date;
  return jsonb_build_object('scope',p_salon::text||':user:'||actor::text,'current',public.owner_live_report_state(p_salon,p_date),'receipt',receipt);
end; $$;
revoke all on function public.read_owner_live_daily_report(uuid,date,uuid) from public,anon;
grant execute on function public.read_owner_live_daily_report(uuid,date,uuid) to authenticated;
create function public.save_owner_live_daily_report(p_salon uuid,p_date date,p_request uuid,p_expected_revision integer,p_values jsonb) returns jsonb
language plpgsql security definer set search_path=pg_catalog as $$
declare actor uuid:=public.current_public_user_id(); previous public.owner_live_report_receipts%rowtype; payload jsonb; current_state jsonb; field text; amount numeric;
begin
  if not public.payroll_live_is_owner(p_salon) then raise exception 'Only the Owner can change financial amounts' using errcode='42501'; end if;
  if p_date is null or p_request is null or p_expected_revision is null or p_expected_revision<0 then raise exception 'Reopen the report before saving' using errcode='22023'; end if;
  if p_values is null or jsonb_typeof(p_values)<>'object' or not p_values ?& array['cashAmount','creditCardAmount','otherAmount','note'] or p_values-array['cashAmount','creditCardAmount','otherAmount','note']<>'{}'::jsonb then raise exception 'Invalid report values' using errcode='22023'; end if;
  foreach field in array array['cashAmount','creditCardAmount','otherAmount'] loop
    if jsonb_typeof(p_values->field)<>'number' then raise exception 'Amounts must be numbers' using errcode='22023'; end if;
    amount:=(p_values->>field)::numeric;
    if amount<0 or amount>9999999999.99 or amount<>round(amount,2) then raise exception 'Use nonnegative amounts with at most two decimals' using errcode='22023'; end if;
  end loop;
  if jsonb_typeof(p_values->'note') not in ('string','null') or length(coalesce(p_values->>'note',''))>4000 then raise exception 'Invalid note' using errcode='22023'; end if;
  payload:=jsonb_build_object('date',p_date,'revision',p_expected_revision,'values',p_values);
  perform pg_advisory_xact_lock(hashtextextended('owner-report-request:'||p_salon::text||actor::text||p_request::text,0));
  select * into previous from public.owner_live_report_receipts where salon_id=p_salon and actor_id=actor and request_id=p_request;
  if found then
    if previous.payload<>payload then raise exception 'Request ID already used for different values' using errcode='22023'; end if;
    return jsonb_build_object('requestId',p_request,'receipt',previous.result,'current',public.owner_live_report_state(p_salon,p_date),'replayed',true);
  end if;
  perform pg_advisory_xact_lock(hashtextextended('pos-closing:'||p_salon::text||p_date::text,0));
  perform 1 from public.pos_daily_closings where salon_id=p_salon and report_date=p_date for update;
  current_state:=public.owner_live_report_state(p_salon,p_date);
  if (current_state->>'revision')::integer<>p_expected_revision then raise exception 'Report changed on another screen. Reload before saving.' using errcode='PT409'; end if;
  if current_state->'closingInputs'->'cashAmount' is distinct from p_values->'cashAmount'
    or current_state->'closingInputs'->'creditCardAmount' is distinct from p_values->'creditCardAmount'
    or current_state->'closingInputs'->'otherAmount' is distinct from p_values->'otherAmount'
    or current_state->'closingInputs'->>'note' is distinct from nullif(btrim(p_values->>'note'),'')
    or exists(select 1 from public.pos_daily_closings where salon_id=p_salon and report_date=p_date and live_report_entered_at is null)
    or not exists(select 1 from public.pos_daily_closings where salon_id=p_salon and report_date=p_date) then
    insert into public.pos_daily_closings(salon_id,report_date,cash_amount,credit_card_amount,other_amount,note,created_by,updated_by,live_report_entered_at)
      values(p_salon,p_date,(p_values->>'cashAmount')::numeric,(p_values->>'creditCardAmount')::numeric,(p_values->>'otherAmount')::numeric,nullif(btrim(p_values->>'note'),''),actor,actor,clock_timestamp())
    on conflict(salon_id,report_date) do update set cash_amount=excluded.cash_amount,credit_card_amount=excluded.credit_card_amount,other_amount=excluded.other_amount,note=excluded.note,updated_by=excluded.updated_by,live_report_entered_at=coalesce(public.pos_daily_closings.live_report_entered_at,excluded.live_report_entered_at);
  end if;
  current_state:=public.owner_live_report_state(p_salon,p_date);
  insert into public.owner_live_report_receipts values(p_salon,actor,p_request,p_date,payload,current_state);
  return jsonb_build_object('requestId',p_request,'receipt',current_state,'current',current_state,'replayed',false);
end; $$;
revoke all on function public.save_owner_live_daily_report(uuid,date,uuid,integer,jsonb) from public,anon;
grant execute on function public.save_owner_live_daily_report(uuid,date,uuid,integer,jsonb) to authenticated;

create function public.save_owner_live_payroll_input(p_salon uuid,p_staff uuid,p_start date,p_end date,p_cycle text,p_values jsonb,p_expected jsonb) returns jsonb
language plpgsql security definer set search_path=pg_catalog as $$
declare current_row public.payroll_period_staff_inputs%rowtype; expected jsonb; desired jsonb; amount numeric;
begin
  if not public.payroll_live_is_owner(p_salon) then raise exception 'Only the Owner can change payroll' using errcode='42501'; end if;
  if p_start is null or p_end is null or p_end<p_start or p_cycle is null or p_cycle not in ('monthly','semi_monthly','biweekly','custom') or not exists(select 1 from public.staff where id=p_staff and salon_id=p_salon) then raise exception 'Invalid payroll period or staff' using errcode='22023'; end if;
  if p_values is null or p_expected is null or not p_values ?& array['bonus_amount','check_number','note'] or jsonb_typeof(p_values->'bonus_amount')<>'number' then raise exception 'Invalid payroll input' using errcode='22023'; end if;
  amount:=(p_values->>'bonus_amount')::numeric;
  if amount<0 or amount>9999999999.99 or round(amount,2)<>amount or length(coalesce(p_values->>'note',''))>4000 or length(coalesce(p_values->>'check_number',''))>100 then raise exception 'Invalid payroll input' using errcode='22023'; end if;
  perform pg_advisory_xact_lock(hashtextextended('payroll-input:'||p_salon::text||p_staff::text||p_start::text||p_end::text||p_cycle,0));
  select * into current_row from public.payroll_period_staff_inputs where salon_id=p_salon and staff_id=p_staff and period_start=p_start and period_end=p_end and cycle_type=p_cycle for update;
  expected:=jsonb_build_object('bonus_amount',coalesce(current_row.bonus_amount,0),'check_number',current_row.check_number,'note',current_row.note);
  desired:=jsonb_build_object('bonus_amount',amount,'check_number',nullif(btrim(p_values->>'check_number'),''),'note',nullif(btrim(p_values->>'note'),''));
  if desired=expected then return to_jsonb(current_row); end if;
  if expected<>p_expected then raise exception 'Payroll changed on another screen. Reload before saving.' using errcode='PT409'; end if;
  if current_row.id is not null then
    update public.payroll_period_staff_inputs set bonus_amount=amount,check_number=desired->>'check_number',note=desired->>'note',updated_by=public.current_public_user_id() where id=current_row.id returning * into current_row;
  else
    insert into public.payroll_period_staff_inputs(salon_id,staff_id,period_start,period_end,cycle_type,bonus_amount,check_number,note,updated_by) values(p_salon,p_staff,p_start,p_end,p_cycle,amount,desired->>'check_number',desired->>'note',public.current_public_user_id()) returning * into current_row;
  end if;
  return to_jsonb(current_row);
end; $$;
revoke all on function public.save_owner_live_payroll_input(uuid,uuid,date,date,text,jsonb,jsonb) from public,anon;
grant execute on function public.save_owner_live_payroll_input(uuid,uuid,date,date,text,jsonb,jsonb) to authenticated;

create function public.save_owner_live_payroll_setting(p_salon uuid,p_staff uuid,p_effective date,p_values jsonb,p_expected_id uuid,p_expected_updated_at timestamptz) returns jsonb
language plpgsql security definer set search_path=pg_catalog as $$
declare current_row public.staff_payroll_settings%rowtype; expected_row public.staff_payroll_settings%rowtype; v public.staff_payroll_settings%rowtype;
begin
  if not public.payroll_live_is_owner(p_salon) then raise exception 'Only the Owner can change payroll settings' using errcode='42501'; end if;
  if p_effective is null or p_values is null or not exists(select 1 from public.staff where id=p_staff and salon_id=p_salon) then raise exception 'Invalid payroll setting' using errcode='22023'; end if;
  v:=jsonb_populate_record(null::public.staff_payroll_settings,p_values);
  if jsonb_typeof(p_values->'fixed_pay_amount')<>'number' or (p_values->>'fixed_pay_amount')::numeric<>round((p_values->>'fixed_pay_amount')::numeric,2) then raise exception 'Use at most two decimals for fixed pay' using errcode='22023'; end if;
  if v.pay_type is null or v.pay_type not in ('fixed','commission') or v.tip_payout_method is null or v.tip_payout_method not in ('cash','check') or v.bonus_payout_method is null or v.bonus_payout_method not in ('cash','check')
    or v.commission_rate is null or v.commission_rate not between 0 and 100 or v.check_rate is null or v.check_rate not between 0 and 100 or v.tax_rate is null or v.tax_rate not between 0 and 100
    or v.fixed_pay_amount is null or v.fixed_pay_amount<0 or length(coalesce(v.legal_name,''))>200
    or v.apply_tax_to_fixed_pay is null or v.tax_tips is null or v.tax_bonus is null or v.cash_to_tax_company is null or v.tax_company_enabled is null then raise exception 'Invalid payroll setting values' using errcode='22023'; end if;
  perform pg_advisory_xact_lock(hashtextextended('payroll-setting:'||p_salon::text||p_staff::text,0));
  perform 1 from public.staff_payroll_settings where salon_id=p_salon and staff_id=p_staff for update;
  select * into current_row from public.staff_payroll_settings where salon_id=p_salon and staff_id=p_staff and effective_from=p_effective;
  if p_expected_id is not null then
    select * into expected_row from public.staff_payroll_settings where id=p_expected_id and salon_id=p_salon and staff_id=p_staff;
    if expected_row.id is null or expected_row.updated_at is distinct from p_expected_updated_at then raise exception 'Payroll settings changed on another screen. Reload before saving.' using errcode='PT409'; end if;
  elsif exists(select 1 from public.staff_payroll_settings where salon_id=p_salon and staff_id=p_staff) then
    raise exception 'Payroll settings changed on another screen. Reload before saving.' using errcode='PT409';
  end if;
  if current_row.id is not null then
    update public.staff_payroll_settings set apply_tax_to_fixed_pay=v.apply_tax_to_fixed_pay,bonus_payout_method=v.bonus_payout_method,cash_to_tax_company=v.cash_to_tax_company,check_rate=v.check_rate,commission_rate=v.commission_rate,fixed_pay_amount=v.fixed_pay_amount,legal_name=v.legal_name,pay_type=v.pay_type,tax_bonus=v.tax_bonus,tax_company_enabled=v.tax_company_enabled,tax_rate=v.tax_rate,tax_tips=v.tax_tips,tip_payout_method=v.tip_payout_method where id=current_row.id returning * into current_row;
  else
    update public.staff_payroll_settings set effective_to=p_effective-1 where salon_id=p_salon and staff_id=p_staff and effective_from<p_effective and (effective_to is null or effective_to>=p_effective);
    insert into public.staff_payroll_settings(salon_id,staff_id,effective_from,effective_to,apply_tax_to_fixed_pay,bonus_payout_method,cash_to_tax_company,check_rate,commission_rate,fixed_pay_amount,legal_name,pay_type,tax_bonus,tax_company_enabled,tax_rate,tax_tips,tip_payout_method)
      values(p_salon,p_staff,p_effective,(select min(effective_from)-1 from public.staff_payroll_settings where salon_id=p_salon and staff_id=p_staff and effective_from>p_effective),v.apply_tax_to_fixed_pay,v.bonus_payout_method,v.cash_to_tax_company,v.check_rate,v.commission_rate,v.fixed_pay_amount,v.legal_name,v.pay_type,v.tax_bonus,v.tax_company_enabled,v.tax_rate,v.tax_tips,v.tip_payout_method) returning * into current_row;
  end if;
  return to_jsonb(current_row);
end; $$;
revoke all on function public.save_owner_live_payroll_setting(uuid,uuid,date,jsonb,uuid,timestamptz) from public,anon;
grant execute on function public.save_owner_live_payroll_setting(uuid,uuid,date,jsonb,uuid,timestamptz) to authenticated;
do $$begin
  if exists(select 1 from pg_catalog.pg_publication where pubname='supabase_realtime') then
    alter publication supabase_realtime add table public.payroll_live_change_history;
  end if;
end;$$;
commit;
