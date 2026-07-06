alter table public.staff_workdays
drop constraint if exists staff_workdays_status_check;

alter table public.staff_workdays
add constraint staff_workdays_status_check check (
  status in ('not_checked_in', 'checked_in', 'working', 'checked_out')
);

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
  select exists (
    select 1
    from public.staff
    where staff.id = target_staff_id
      and staff.organization_id = target_organization_id
      and staff.salon_id = target_salon_id
      and staff.is_active = true
      and (
        staff.user_id = auth.uid()
        or (
          staff.email is not null
          and lower(staff.email) = lower(coalesce(auth.jwt() ->> 'email', ''))
        )
      )
  )
$$;

drop policy if exists "Organization members can view salon staff workdays"
on public.staff_workdays;
create policy "Linked staff can view own salon workdays"
on public.staff_workdays
for select
to authenticated
using (
  public.user_belongs_to_organization(organization_id)
  and public.current_auth_staff_matches_workday(
    staff_id,
    organization_id,
    salon_id
  )
);

drop policy if exists "Organization members can create salon staff workdays"
on public.staff_workdays;
create policy "Linked staff can create own salon workdays"
on public.staff_workdays
for insert
to authenticated
with check (
  public.user_belongs_to_organization(organization_id)
  and public.current_auth_staff_matches_workday(
    staff_id,
    organization_id,
    salon_id
  )
);

drop policy if exists "Organization members can update salon staff workdays"
on public.staff_workdays;
create policy "Linked staff can update own salon workdays"
on public.staff_workdays
for update
to authenticated
using (
  public.user_belongs_to_organization(organization_id)
  and public.current_auth_staff_matches_workday(
    staff_id,
    organization_id,
    salon_id
  )
)
with check (
  public.user_belongs_to_organization(organization_id)
  and public.current_auth_staff_matches_workday(
    staff_id,
    organization_id,
    salon_id
  )
);
