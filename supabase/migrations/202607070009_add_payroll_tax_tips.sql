alter table public.staff_payroll_settings
add column if not exists tax_tips boolean not null default false;
