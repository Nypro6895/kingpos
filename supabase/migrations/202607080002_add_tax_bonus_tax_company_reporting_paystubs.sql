alter table public.staff_payroll_settings
add column if not exists tax_bonus boolean not null default false;

alter table public.payroll_staff_lines
add column if not exists tax_bonus_snapshot boolean not null default false;

alter table public.payroll_staff_lines
add column if not exists tax_tips_snapshot boolean not null default false;

alter table public.payroll_staff_lines
add column if not exists tax_company_reported_wage_gross numeric(12,2) not null default 0;

alter table public.payroll_staff_lines
add column if not exists tax_company_taxable_gross numeric(12,2) not null default 0;

update public.payroll_staff_lines
set tax_tips_snapshot = case
  when jsonb_typeof(settings_used_snapshot) = 'array'
    and settings_used_snapshot->0->>'taxTips' in ('true', 'false')
    then (settings_used_snapshot->0->>'taxTips')::boolean
  when jsonb_typeof(settings_used_snapshot) = 'object'
    and settings_used_snapshot->>'taxTips' in ('true', 'false')
    then (settings_used_snapshot->>'taxTips')::boolean
  else false
end
where tax_tips_snapshot = false;

update public.payroll_staff_lines
set tax_company_reported_wage_gross = case
  when cash_to_tax_company_snapshot then staff_commission_gross
  else check_gross
end
where tax_company_enabled_snapshot = true
  and tax_company_reported_wage_gross = 0;

update public.payroll_staff_lines
set tax_company_taxable_gross = round(
  (
    tax_company_reported_wage_gross
    + case when tax_tips_snapshot then tip_amount else 0 end
    + case when tax_bonus_snapshot then bonus_amount else 0 end
  )::numeric,
  2
)
where tax_company_enabled_snapshot = true
  and tax_company_taxable_gross = 0;

update public.payroll_staff_lines
set tax_company_enabled_snapshot = true
where (
    tax_rate_used > 0
    or tax_withheld <> 0
    or tax_tips_snapshot = true
    or tax_bonus_snapshot = true
    or cash_to_tax_company_snapshot = true
    or final_check_amount > 0
  )
  and (
    gross_sales <> 0
    or staff_commission_gross <> 0
    or tip_amount <> 0
    or bonus_amount <> 0
    or final_check_amount <> 0
    or final_cash_amount <> 0
    or tax_withheld <> 0
  );

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'payroll_staff_lines_tax_company_reported_amounts_check'
      and conrelid = 'public.payroll_staff_lines'::regclass
  ) then
    alter table public.payroll_staff_lines
    add constraint payroll_staff_lines_tax_company_reported_amounts_check check (
      tax_company_reported_wage_gross >= 0
      and tax_company_taxable_gross >= 0
    );
  end if;
end;
$$;

insert into storage.buckets (
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types
)
values (
  'payroll-paystubs',
  'payroll-paystubs',
  false,
  10485760,
  array[
    'application/pdf',
    'image/jpeg',
    'image/png',
    'image/webp'
  ]
)
on conflict (id) do update
set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "Payroll users can view paystub files"
on storage.objects;
create policy "Payroll users can view paystub files"
on storage.objects
for select
to authenticated
using (
  bucket_id = 'payroll-paystubs'
  and (storage.foldername(name))[1] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  and public.user_has_organization_permission(
    ((storage.foldername(name))[1])::uuid,
    array['payroll.manage', 'payroll.tax_company']::text[]
  )
);

drop policy if exists "Payroll users can upload paystub files"
on storage.objects;
create policy "Payroll users can upload paystub files"
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'payroll-paystubs'
  and (storage.foldername(name))[1] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  and public.user_has_organization_permission(
    ((storage.foldername(name))[1])::uuid,
    array['payroll.manage', 'payroll.tax_company']::text[]
  )
);

drop policy if exists "Payroll users can replace paystub files"
on storage.objects;
create policy "Payroll users can replace paystub files"
on storage.objects
for update
to authenticated
using (
  bucket_id = 'payroll-paystubs'
  and (storage.foldername(name))[1] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  and public.user_has_organization_permission(
    ((storage.foldername(name))[1])::uuid,
    array['payroll.manage', 'payroll.tax_company']::text[]
  )
)
with check (
  bucket_id = 'payroll-paystubs'
  and (storage.foldername(name))[1] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  and public.user_has_organization_permission(
    ((storage.foldername(name))[1])::uuid,
    array['payroll.manage', 'payroll.tax_company']::text[]
  )
);

drop policy if exists "Tax company users can insert paystubs"
on public.payroll_paystubs;
create policy "Tax company users can insert paystubs"
on public.payroll_paystubs
for insert
to authenticated
with check (
  public.user_has_organization_permission(
    organization_id,
    array['payroll.tax_company']::text[]
  )
  and uploaded_by = public.current_public_user_id()
  and exists (
    select 1
    from public.payroll_staff_lines
    where payroll_staff_lines.payroll_run_id = payroll_paystubs.payroll_run_id
      and payroll_staff_lines.staff_id = payroll_paystubs.staff_id
      and payroll_staff_lines.tax_company_enabled_snapshot = true
      and payroll_staff_lines.organization_id = payroll_paystubs.organization_id
      and payroll_staff_lines.salon_id = payroll_paystubs.salon_id
  )
);

drop policy if exists "Tax company users can update paystubs"
on public.payroll_paystubs;
create policy "Tax company users can update paystubs"
on public.payroll_paystubs
for update
to authenticated
using (
  public.user_has_organization_permission(
    organization_id,
    array['payroll.tax_company']::text[]
  )
  and exists (
    select 1
    from public.payroll_staff_lines
    where payroll_staff_lines.payroll_run_id = payroll_paystubs.payroll_run_id
      and payroll_staff_lines.staff_id = payroll_paystubs.staff_id
      and payroll_staff_lines.tax_company_enabled_snapshot = true
      and payroll_staff_lines.organization_id = payroll_paystubs.organization_id
      and payroll_staff_lines.salon_id = payroll_paystubs.salon_id
  )
)
with check (
  public.user_has_organization_permission(
    organization_id,
    array['payroll.tax_company']::text[]
  )
  and uploaded_by = public.current_public_user_id()
  and exists (
    select 1
    from public.payroll_staff_lines
    where payroll_staff_lines.payroll_run_id = payroll_paystubs.payroll_run_id
      and payroll_staff_lines.staff_id = payroll_paystubs.staff_id
      and payroll_staff_lines.tax_company_enabled_snapshot = true
      and payroll_staff_lines.organization_id = payroll_paystubs.organization_id
      and payroll_staff_lines.salon_id = payroll_paystubs.salon_id
  )
);
