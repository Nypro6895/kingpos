alter table public.salon_payroll_settings
drop constraint if exists salon_payroll_settings_cycle_type_check;

alter table public.salon_payroll_settings
add constraint salon_payroll_settings_cycle_type_check check (
  cycle_type in ('monthly', 'semi_monthly', 'biweekly')
);

alter table public.payroll_runs
drop constraint if exists payroll_runs_cycle_type_check;

alter table public.payroll_runs
add constraint payroll_runs_cycle_type_check check (
  cycle_type in ('monthly', 'semi_monthly', 'biweekly', 'custom')
);

alter table public.payroll_period_staff_inputs
drop constraint if exists payroll_period_staff_inputs_cycle_type_check;

alter table public.payroll_period_staff_inputs
add constraint payroll_period_staff_inputs_cycle_type_check check (
  cycle_type in ('monthly', 'semi_monthly', 'biweekly', 'custom')
);
