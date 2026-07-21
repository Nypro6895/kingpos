alter table public.staff_payroll_settings
add column if not exists cash_to_tax_company boolean not null default false;

alter table public.staff_payroll_settings
add column if not exists tip_payout_method text not null default 'cash';

alter table public.staff_payroll_settings
add column if not exists bonus_payout_method text not null default 'check';

update public.staff_payroll_settings
set cash_to_tax_company = false
where tax_company_enabled = false
  and cash_to_tax_company = true;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'staff_payroll_settings_tip_payout_method_check'
      and conrelid = 'public.staff_payroll_settings'::regclass
  ) then
    alter table public.staff_payroll_settings
    add constraint staff_payroll_settings_tip_payout_method_check check (
      tip_payout_method in ('check', 'cash')
    );
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'staff_payroll_settings_bonus_payout_method_check'
      and conrelid = 'public.staff_payroll_settings'::regclass
  ) then
    alter table public.staff_payroll_settings
    add constraint staff_payroll_settings_bonus_payout_method_check check (
      bonus_payout_method in ('check', 'cash')
    );
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'staff_payroll_settings_cash_tax_requires_tax_company_check'
      and conrelid = 'public.staff_payroll_settings'::regclass
  ) then
    alter table public.staff_payroll_settings
    add constraint staff_payroll_settings_cash_tax_requires_tax_company_check check (
      tax_company_enabled or cash_to_tax_company = false
    );
  end if;
end;
$$;

alter table public.payroll_staff_lines
add column if not exists earned_amount numeric(12,2) not null default 0;

alter table public.payroll_staff_lines
add column if not exists base_check_amount numeric(12,2) not null default 0;

alter table public.payroll_staff_lines
add column if not exists base_cash_amount numeric(12,2) not null default 0;

alter table public.payroll_staff_lines
add column if not exists tip_check_amount numeric(12,2) not null default 0;

alter table public.payroll_staff_lines
add column if not exists tip_cash_amount numeric(12,2) not null default 0;

alter table public.payroll_staff_lines
add column if not exists bonus_check_amount numeric(12,2) not null default 0;

alter table public.payroll_staff_lines
add column if not exists bonus_cash_amount numeric(12,2) not null default 0;

alter table public.payroll_staff_lines
add column if not exists final_check_amount numeric(12,2) not null default 0;

alter table public.payroll_staff_lines
add column if not exists final_cash_amount numeric(12,2) not null default 0;

alter table public.payroll_staff_lines
add column if not exists cash_to_tax_company_snapshot boolean not null default false;

alter table public.payroll_staff_lines
add column if not exists tip_payout_method_snapshot text not null default 'cash';

alter table public.payroll_staff_lines
add column if not exists bonus_payout_method_snapshot text not null default 'check';

alter table public.payroll_staff_lines
add column if not exists tax_company_check_amount numeric(12,2) not null default 0;

alter table public.payroll_staff_lines
add column if not exists tax_company_cash_amount numeric(12,2) not null default 0;

update public.payroll_staff_lines
set
  earned_amount = round((staff_commission_gross + tip_amount + bonus_amount)::numeric, 2),
  base_check_amount = check_net,
  base_cash_amount = cash_amount,
  tip_check_amount = 0,
  tip_cash_amount = tip_amount,
  bonus_check_amount = bonus_amount,
  bonus_cash_amount = 0,
  final_check_amount = round((check_net + bonus_amount)::numeric, 2),
  final_cash_amount = round((cash_amount + tip_amount)::numeric, 2),
  cash_to_tax_company_snapshot = false,
  tip_payout_method_snapshot = 'cash',
  bonus_payout_method_snapshot = 'check',
  tax_company_check_amount = case
    when tax_company_enabled_snapshot then round((check_net + bonus_amount)::numeric, 2)
    else 0
  end,
  tax_company_cash_amount = 0
where earned_amount = 0
  and base_check_amount = 0
  and base_cash_amount = 0
  and tip_check_amount = 0
  and tip_cash_amount = 0
  and bonus_check_amount = 0
  and bonus_cash_amount = 0
  and final_check_amount = 0
  and final_cash_amount = 0
  and tax_company_check_amount = 0
  and tax_company_cash_amount = 0;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'payroll_staff_lines_tip_payout_method_snapshot_check'
      and conrelid = 'public.payroll_staff_lines'::regclass
  ) then
    alter table public.payroll_staff_lines
    add constraint payroll_staff_lines_tip_payout_method_snapshot_check check (
      tip_payout_method_snapshot in ('check', 'cash')
    );
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'payroll_staff_lines_bonus_payout_method_snapshot_check'
      and conrelid = 'public.payroll_staff_lines'::regclass
  ) then
    alter table public.payroll_staff_lines
    add constraint payroll_staff_lines_bonus_payout_method_snapshot_check check (
      bonus_payout_method_snapshot in ('check', 'cash')
    );
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'payroll_staff_lines_payout_amounts_nonnegative_check'
      and conrelid = 'public.payroll_staff_lines'::regclass
  ) then
    alter table public.payroll_staff_lines
    add constraint payroll_staff_lines_payout_amounts_nonnegative_check check (
      earned_amount >= 0
      and base_cash_amount >= 0
      and tip_check_amount >= 0
      and tip_cash_amount >= 0
      and bonus_check_amount >= 0
      and bonus_cash_amount >= 0
      and final_cash_amount >= 0
      and tax_company_cash_amount >= 0
    );
  end if;
end;
$$;
