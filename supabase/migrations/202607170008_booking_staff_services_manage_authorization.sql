drop policy if exists "Booking managers can manage staff service assignments"
on public.staff_service_assignments;

create policy "Service managers can manage booking staff assignments"
on public.staff_service_assignments
for all
to authenticated
using (
  public.user_has_organization_permission(
    organization_id,
    array['services.manage']::text[]
  )
)
with check (
  public.user_has_organization_permission(
    organization_id,
    array['services.manage']::text[]
  )
);

do $$
declare
  function_definition text;
  function_signature regprocedure;
begin
  foreach function_signature in array array[
    'public.save_staff_service_assignment_batch(uuid,uuid,jsonb)'::regprocedure,
    'public.save_service_staff_assignment_batch(uuid,uuid,jsonb)'::regprocedure
  ]
  loop
    select pg_get_functiondef(function_signature)
    into function_definition;

    function_definition := replace(
      function_definition,
      'array[''booking.manage'', ''staff.manage'', ''services.manage'']::text[]',
      'array[''services.manage'']::text[]'
    );
    function_definition := replace(
      function_definition,
      'Missing booking setup management permission.',
      'Missing required permission: services.manage'
    );

    if function_definition not like '%array[''services.manage'']::text[]%'
      or function_definition like '%array[''booking.manage'', ''staff.manage''%'
    then
      raise exception 'Booking staff assignment authorization patch failed.';
    end if;

    execute function_definition;
  end loop;
end;
$$;

revoke all on function public.save_staff_service_assignment_batch(
  uuid,
  uuid,
  jsonb
) from public, anon;
revoke all on function public.save_service_staff_assignment_batch(
  uuid,
  uuid,
  jsonb
) from public, anon;

grant execute on function public.save_staff_service_assignment_batch(
  uuid,
  uuid,
  jsonb
) to authenticated;
grant execute on function public.save_service_staff_assignment_batch(
  uuid,
  uuid,
  jsonb
) to authenticated;
