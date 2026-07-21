alter table public.staff_workdays
drop constraint if exists staff_workdays_status_check;

alter table public.staff_workdays
add constraint staff_workdays_status_check check (
  status in (
    'not_checked_in',
    'checked_in',
    'working',
    'break',
    'unavailable',
    'checked_out'
  )
);

create policy "Organization owners can view salon staff workdays"
on public.staff_workdays
for select
to authenticated
using (
  public.user_is_organization_owner_member(organization_id)
  and exists (
    select 1
    from public.locations
    where locations.id = staff_workdays.salon_id
      and locations.organization_id = staff_workdays.organization_id
  )
);
