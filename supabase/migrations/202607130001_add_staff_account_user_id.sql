-- Compatibility migration for staff account identity.
-- Target model:
--   auth.users -> public.users.auth_user_id -> public.staff.account_user_id
-- The legacy public.staff.user_id column is intentionally kept as an auth.users
-- reference during the transition window.

alter table public.staff
add column if not exists account_user_id uuid;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'staff_account_user_id_fkey'
      and conrelid = 'public.staff'::regclass
  ) then
    alter table public.staff
    add constraint staff_account_user_id_fkey
    foreign key (account_user_id)
    references public.users(id)
    on delete set null;
  end if;
end;
$$;

create index if not exists staff_account_user_id_idx
on public.staff(account_user_id)
where account_user_id is not null;

create index if not exists staff_organization_salon_account_user_id_idx
on public.staff(organization_id, salon_id, account_user_id)
where account_user_id is not null;

comment on column public.staff.account_user_id is
  'Compatibility account link to public.users.id. Prefer this over legacy staff.user_id, which still stores auth.users.id during migration.';

update public.staff as staff
set account_user_id = users.id
from public.users as users
where staff.account_user_id is null
  and staff.user_id is not null
  and users.auth_user_id = staff.user_id;

create or replace view public.staff_account_user_link_audit as
with mapped_staff as (
  select
    staff.id as staff_id,
    staff.organization_id,
    staff.salon_id,
    staff.user_id as legacy_auth_user_id,
    staff.account_user_id,
    users.id as mapped_account_user_id
  from public.staff as staff
  left join public.users as users
    on users.auth_user_id = staff.user_id
),
effective_links as (
  select
    mapped_staff.*,
    coalesce(
      mapped_staff.account_user_id,
      mapped_staff.mapped_account_user_id
    ) as effective_account_user_id
  from mapped_staff
),
duplicate_staff_accounts as (
  select
    organization_id,
    salon_id,
    effective_account_user_id,
    count(*) as staff_count,
    jsonb_agg(staff_id order by staff_id) as staff_ids
  from effective_links
  where effective_account_user_id is not null
  group by organization_id, salon_id, effective_account_user_id
  having count(*) > 1
),
duplicate_public_users as (
  select
    auth_user_id,
    count(*) as public_user_count,
    jsonb_agg(id order by id) as public_user_ids
  from public.users
  where auth_user_id is not null
  group by auth_user_id
  having count(*) > 1
)
select
  'null_user_link'::text as issue_code,
  mapped_staff.staff_id,
  mapped_staff.organization_id,
  mapped_staff.salon_id,
  mapped_staff.legacy_auth_user_id,
  mapped_staff.account_user_id,
  jsonb_build_object(
    'message',
    'staff has neither account_user_id nor legacy user_id'
  ) as details
from mapped_staff
where mapped_staff.account_user_id is null
  and mapped_staff.legacy_auth_user_id is null

union all

select
  'orphan_auth_user'::text as issue_code,
  mapped_staff.staff_id,
  mapped_staff.organization_id,
  mapped_staff.salon_id,
  mapped_staff.legacy_auth_user_id,
  mapped_staff.account_user_id,
  jsonb_build_object(
    'message',
    'legacy staff.user_id does not map to public.users.auth_user_id'
  ) as details
from mapped_staff
where mapped_staff.legacy_auth_user_id is not null
  and mapped_staff.mapped_account_user_id is null

union all

select
  'multiple_staff_same_account_in_salon'::text as issue_code,
  effective_links.staff_id,
  effective_links.organization_id,
  effective_links.salon_id,
  effective_links.legacy_auth_user_id,
  effective_links.effective_account_user_id as account_user_id,
  jsonb_build_object(
    'message',
    'multiple staff records resolve to the same account in one salon',
    'staff_count',
    duplicate_staff_accounts.staff_count,
    'staff_ids',
    duplicate_staff_accounts.staff_ids
  ) as details
from effective_links
join duplicate_staff_accounts
  on duplicate_staff_accounts.organization_id = effective_links.organization_id
  and duplicate_staff_accounts.salon_id = effective_links.salon_id
  and duplicate_staff_accounts.effective_account_user_id =
    effective_links.effective_account_user_id

union all

select
  'multiple_public_users_for_auth_user'::text as issue_code,
  null::uuid as staff_id,
  null::uuid as organization_id,
  null::uuid as salon_id,
  duplicate_public_users.auth_user_id as legacy_auth_user_id,
  null::uuid as account_user_id,
  jsonb_build_object(
    'message',
    'more than one public.users row maps to the same auth user',
    'public_user_count',
    duplicate_public_users.public_user_count,
    'public_user_ids',
    duplicate_public_users.public_user_ids
  ) as details
from duplicate_public_users;

comment on view public.staff_account_user_link_audit is
  'Read-only compatibility audit for staff account backfill conflicts. It reports null links, orphan legacy auth links, duplicate staff-account links in one salon, and duplicate public.users auth mappings.';

create or replace function public.current_auth_user_matches_staff(
  target_staff_id uuid,
  target_organization_id uuid,
  target_salon_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.staff
    left join public.users as account_user
      on account_user.id = staff.account_user_id
    where staff.id = target_staff_id
      and staff.organization_id = target_organization_id
      and staff.salon_id = target_salon_id
      and staff.is_active = true
      and (
        account_user.auth_user_id = auth.uid()
        or staff.user_id = auth.uid()
      )
  )
$$;

comment on function public.current_auth_user_matches_staff(uuid, uuid, uuid) is
  'Compatibility staff self-access check. Prefers staff.account_user_id -> public.users.auth_user_id and falls back to legacy staff.user_id -> auth.users.id.';

create or replace function public.current_auth_staff_matches_workday(
  target_staff_id uuid,
  target_organization_id uuid,
  target_salon_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    public.current_auth_user_matches_staff(
      target_staff_id,
      target_organization_id,
      target_salon_id
    )
    or exists (
      select 1
      from public.staff
      where staff.id = target_staff_id
        and staff.organization_id = target_organization_id
        and staff.salon_id = target_salon_id
        and staff.is_active = true
        and staff.email is not null
        and lower(staff.email) = lower(coalesce(auth.jwt() ->> 'email', ''))
    )
$$;

comment on function public.current_auth_staff_matches_workday(uuid, uuid, uuid) is
  'Workday self-access compatibility check. Uses account_user_id/legacy user_id first and keeps the old email fallback temporarily for existing workday behavior.';

drop policy if exists "Payroll viewers can view staff payroll settings"
on public.staff_payroll_settings;
create policy "Payroll viewers can view staff payroll settings"
on public.staff_payroll_settings
for select
to authenticated
using (
  public.user_has_organization_permission(
    organization_id,
    array['payroll.view', 'payroll.manage', 'payroll.tax_company']::text[]
  )
  or public.current_auth_user_matches_staff(
    staff_id,
    organization_id,
    salon_id
  )
);

drop policy if exists "Payroll viewers can view salon payroll runs"
on public.payroll_runs;
create policy "Payroll viewers can view salon payroll runs"
on public.payroll_runs
for select
to authenticated
using (
  public.user_has_organization_permission(
    organization_id,
    array['payroll.view', 'payroll.manage', 'payroll.tax_company']::text[]
  )
  or exists (
    select 1
    from public.payroll_staff_lines
    where payroll_staff_lines.payroll_run_id = payroll_runs.id
      and public.current_auth_user_matches_staff(
        payroll_staff_lines.staff_id,
        payroll_runs.organization_id,
        payroll_runs.salon_id
      )
  )
);

drop policy if exists "Payroll viewers can view salon payroll staff lines"
on public.payroll_staff_lines;
create policy "Payroll viewers can view salon payroll staff lines"
on public.payroll_staff_lines
for select
to authenticated
using (
  public.user_has_organization_permission(
    organization_id,
    array['payroll.view', 'payroll.manage']::text[]
  )
  or (
    tax_company_enabled_snapshot = true
    and public.user_has_organization_permission(
      organization_id,
      array['payroll.tax_company']::text[]
    )
  )
  or public.current_auth_user_matches_staff(
    staff_id,
    organization_id,
    salon_id
  )
);

drop policy if exists "Payroll viewers can view salon payroll daily totals"
on public.payroll_staff_daily_totals;
create policy "Payroll viewers can view salon payroll daily totals"
on public.payroll_staff_daily_totals
for select
to authenticated
using (
  public.user_has_organization_permission(
    organization_id,
    array['payroll.view', 'payroll.manage']::text[]
  )
  or public.current_auth_user_matches_staff(
    staff_id,
    organization_id,
    salon_id
  )
);

drop policy if exists "Payroll viewers can view salon paystubs"
on public.payroll_paystubs;
create policy "Payroll viewers can view salon paystubs"
on public.payroll_paystubs
for select
to authenticated
using (
  public.user_has_organization_permission(
    organization_id,
    array['payroll.view', 'payroll.manage']::text[]
  )
  or (
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
    )
  )
  or public.current_auth_user_matches_staff(
    staff_id,
    organization_id,
    salon_id
  )
);

drop policy if exists "Payroll viewers can view period staff inputs"
on public.payroll_period_staff_inputs;
create policy "Payroll viewers can view period staff inputs"
on public.payroll_period_staff_inputs
for select
to authenticated
using (
  public.user_has_organization_permission(
    organization_id,
    array['payroll.view', 'payroll.manage', 'payroll.tax_company']::text[]
  )
  or public.current_auth_user_matches_staff(
    staff_id,
    organization_id,
    salon_id
  )
);

do $$
begin
  if to_regclass('public.payroll_period_staff_input_history') is not null then
    drop policy if exists "Payroll viewers can view period staff input history"
    on public.payroll_period_staff_input_history;

    create policy "Payroll viewers can view period staff input history"
    on public.payroll_period_staff_input_history
    for select
    to authenticated
    using (
      public.user_has_organization_permission(
        organization_id,
        array['payroll.view', 'payroll.manage', 'payroll.tax_company']::text[]
      )
      or public.current_auth_user_matches_staff(
        staff_id,
        organization_id,
        salon_id
      )
    );
  end if;
end;
$$;

drop policy if exists "Linked staff can view own POS staff earnings"
on public.pos_ticket_staff_earnings;
create policy "Linked staff can view own POS staff earnings"
on public.pos_ticket_staff_earnings
for select
to authenticated
using (
  public.current_auth_user_matches_staff(
    staff_id,
    organization_id,
    salon_id
  )
);
