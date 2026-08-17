drop policy if exists "staff_member_read_linked_locations" on public.locations;

create policy "staff_member_read_linked_locations" on public.locations
for select to authenticated
using (
  status = 'active'
  and exists (
    select 1
    from public.staff linked_staff
    where linked_staff.salon_id = locations.id
      and linked_staff.account_user_id = public.current_public_user_id()
      and linked_staff.is_active = true
  )
);

drop policy if exists "staff_member_read_linked_accounts" on public.accounts;

create policy "staff_member_read_linked_accounts" on public.accounts
for select to authenticated
using (
  status = 'active'
  and exists (
    select 1
    from public.locations linked_location
    join public.staff linked_staff
      on linked_staff.salon_id = linked_location.id
    where linked_location.account_id = accounts.id
      and linked_location.status = 'active'
      and linked_staff.account_user_id = public.current_public_user_id()
      and linked_staff.is_active = true
  )
);
