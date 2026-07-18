-- Canonical Services configuration.
-- Adds an explicit online-booking service state, permission-scoped service
-- mutations, atomic configuration saves, and cycle-safe add-on links.

alter table public.services
add column if not exists online_booking_enabled boolean not null default false;

update public.services
set online_booking_enabled = true
where services.is_active = true
  and services.online_booking_enabled = false
  and exists (
    select 1
    from public.staff_service_assignments assignments
    where assignments.organization_id = services.organization_id
      and assignments.salon_id = services.salon_id
      and assignments.service_id = services.id
      and assignments.is_active = true
      and assignments.online_bookable = true
  );

create or replace function public.enforce_service_online_booking_state()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.is_active is not true then
    new.online_booking_enabled := false;
  end if;

  return new;
end;
$$;

drop trigger if exists enforce_service_online_booking_state
on public.services;

create trigger enforce_service_online_booking_state
before insert or update of is_active, online_booking_enabled
on public.services
for each row
execute function public.enforce_service_online_booking_state();

alter table public.services
drop constraint if exists services_online_booking_requires_active;

alter table public.services
add constraint services_online_booking_requires_active
check (is_active or online_booking_enabled is false);

create index if not exists services_salon_online_booking_idx
on public.services(salon_id, online_booking_enabled)
where is_active = true;

drop policy if exists "Organization members can view salon services"
on public.services;

create policy "Authorized users can view salon services"
on public.services
for select
to authenticated
using (
  public.user_has_organization_permission(
    organization_id,
    array['services.view', 'services.manage']::text[]
  )
  and exists (
    select 1
    from public.locations
    where locations.id = services.salon_id
      and locations.organization_id = services.organization_id
  )
);

drop policy if exists "Organization members can create salon services"
on public.services;

create policy "Authorized users can create salon services"
on public.services
for insert
to authenticated
with check (
  public.user_has_organization_permission(
    organization_id,
    array['services.manage']::text[]
  )
  and exists (
    select 1
    from public.locations
    where locations.id = services.salon_id
      and locations.organization_id = services.organization_id
  )
);

drop policy if exists "Authorized users can update salon services"
on public.services;

create policy "Authorized users can update salon services"
on public.services
for update
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
  and exists (
    select 1
    from public.locations
    where locations.id = services.salon_id
      and locations.organization_id = services.organization_id
  )
);

revoke insert, update, delete on table public.services from anon;
revoke delete on table public.services from authenticated;
grant select, insert, update on table public.services to authenticated;

create or replace function public.prevent_service_add_on_cycle()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  creates_cycle boolean;
begin
  if new.is_active is not true then
    return new;
  end if;

  if new.parent_service_id = new.add_on_service_id then
    raise exception 'A service cannot be its own booking add-on.';
  end if;

  with recursive reachable(service_id, path) as (
    select
      links.add_on_service_id,
      array[links.parent_service_id, links.add_on_service_id]::uuid[]
    from public.service_add_on_links links
    where links.organization_id = new.organization_id
      and links.salon_id = new.salon_id
      and links.parent_service_id = new.add_on_service_id
      and links.is_active = true
      and (tg_op = 'INSERT' or links.id <> new.id)

    union all

    select
      links.add_on_service_id,
      reachable.path || links.add_on_service_id
    from reachable
    join public.service_add_on_links links
      on links.organization_id = new.organization_id
      and links.salon_id = new.salon_id
      and links.parent_service_id = reachable.service_id
      and links.is_active = true
      and (tg_op = 'INSERT' or links.id <> new.id)
    where not links.add_on_service_id = any(reachable.path)
  )
  select exists (
    select 1
    from reachable
    where reachable.service_id = new.parent_service_id
  )
  into creates_cycle;

  if creates_cycle then
    raise exception 'Booking add-ons cannot create a circular relationship.';
  end if;

  return new;
end;
$$;

drop trigger if exists prevent_service_add_on_cycle
on public.service_add_on_links;

create trigger prevent_service_add_on_cycle
before insert or update of parent_service_id, add_on_service_id, is_active
on public.service_add_on_links
for each row
execute function public.prevent_service_add_on_cycle();

create or replace function public.save_service_config_batch(
  p_salon_id uuid,
  p_configs jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  actor_user_id uuid;
  add_on_ids uuid[];
  add_on_service_id_value uuid;
  base_price_value numeric(10,2);
  booking_staff_ids uuid[];
  category_value text;
  config_item jsonb;
  description_value text;
  duration_minutes_value integer;
  existing_service boolean;
  is_active_value boolean;
  location_organization_id uuid;
  name_value text;
  normalized_configs jsonb := '[]'::jsonb;
  online_booking_enabled_value boolean;
  result_service_ids uuid[] := array[]::uuid[];
  seen_service_ids uuid[] := array[]::uuid[];
  service_id_value uuid;
  staff_id_value uuid;
begin
  actor_user_id := public.current_public_user_id();

  if actor_user_id is null then
    raise exception 'Sign in before managing services.';
  end if;

  select locations.organization_id
  into location_organization_id
  from public.locations
  where locations.id = p_salon_id;

  if location_organization_id is null then
    raise exception 'Salon was not found.';
  end if;

  if not public.user_has_organization_permission(
    location_organization_id,
    array['services.manage']::text[]
  ) then
    raise exception 'Missing required permission: services.manage';
  end if;

  if jsonb_typeof(coalesce(p_configs, '[]'::jsonb)) <> 'array'
    or jsonb_array_length(coalesce(p_configs, '[]'::jsonb)) = 0
  then
    raise exception 'Service configurations must be a non-empty array.';
  end if;

  if jsonb_array_length(p_configs) > 100 then
    raise exception 'A maximum of 100 service configurations can be saved at once.';
  end if;

  for config_item in
    select value
    from jsonb_array_elements(p_configs)
  loop
    if jsonb_typeof(config_item) <> 'object' then
      raise exception 'Every service configuration must be an object.';
    end if;

    service_id_value := nullif(config_item ->> 'service_id', '')::uuid;
    existing_service := service_id_value is not null;

    if service_id_value is null then
      service_id_value := gen_random_uuid();
    end if;

    if service_id_value = any(seen_service_ids) then
      raise exception 'Duplicate service configuration row.';
    end if;

    seen_service_ids := array_append(seen_service_ids, service_id_value);
    name_value := btrim(coalesce(config_item ->> 'name', ''));
    category_value := nullif(btrim(coalesce(config_item ->> 'category', '')), '');
    description_value :=
      nullif(btrim(coalesce(config_item ->> 'description', '')), '');
    base_price_value := nullif(config_item ->> 'base_price', '')::numeric;
    duration_minutes_value :=
      nullif(config_item ->> 'duration_minutes', '')::integer;
    is_active_value := coalesce((config_item ->> 'is_active')::boolean, true);
    online_booking_enabled_value :=
      is_active_value
      and coalesce(
        (config_item ->> 'online_booking_enabled')::boolean,
        false
      );

    if existing_service and not exists (
      select 1
      from public.services
      where services.id = service_id_value
        and services.organization_id = location_organization_id
        and services.salon_id = p_salon_id
    ) then
      raise exception 'Service % was not found in this salon.', service_id_value;
    end if;

    if length(name_value) = 0 or length(name_value) > 120 then
      raise exception 'Service % has an invalid name.', service_id_value;
    end if;

    if category_value is not null and length(category_value) > 80 then
      raise exception 'Service % category is too long.', service_id_value;
    end if;

    if description_value is not null and length(description_value) > 2000 then
      raise exception 'Service % description is too long.', service_id_value;
    end if;

    if base_price_value is null or base_price_value < 0 then
      raise exception 'Service % price must be zero or greater.', service_id_value;
    end if;

    if duration_minutes_value is null
      or duration_minutes_value < 1
      or duration_minutes_value > 1440
    then
      raise exception 'Service % duration must be between 1 and 1440 minutes.',
        service_id_value;
    end if;

    if jsonb_typeof(coalesce(config_item -> 'booking_staff_ids', '[]'::jsonb))
      <> 'array'
    then
      raise exception 'Service % booking staff must be an array.', service_id_value;
    end if;

    if jsonb_typeof(coalesce(config_item -> 'add_on_service_ids', '[]'::jsonb))
      <> 'array'
    then
      raise exception 'Service % booking add-ons must be an array.', service_id_value;
    end if;

    normalized_configs := normalized_configs || jsonb_build_array(
      jsonb_build_object(
        'service_id', service_id_value,
        'name', name_value,
        'category', category_value,
        'description', description_value,
        'base_price', base_price_value,
        'duration_minutes', duration_minutes_value,
        'is_active', is_active_value,
        'online_booking_enabled', online_booking_enabled_value,
        'booking_staff_ids',
          coalesce(config_item -> 'booking_staff_ids', '[]'::jsonb),
        'add_on_service_ids',
          coalesce(config_item -> 'add_on_service_ids', '[]'::jsonb)
      )
    );
  end loop;

  for config_item in
    select value
    from jsonb_array_elements(normalized_configs)
  loop
    service_id_value := (config_item ->> 'service_id')::uuid;
    is_active_value := (config_item ->> 'is_active')::boolean;

    select coalesce(array_agg(ids.value::uuid), array[]::uuid[])
    into booking_staff_ids
    from jsonb_array_elements_text(config_item -> 'booking_staff_ids') ids(value);

    select coalesce(array_agg(ids.value::uuid), array[]::uuid[])
    into add_on_ids
    from jsonb_array_elements_text(config_item -> 'add_on_service_ids') ids(value);

    if exists (
      select 1
      from unnest(booking_staff_ids) values_table(id)
      group by values_table.id
      having count(*) > 1
    ) then
      raise exception 'Service % contains duplicate booking staff.', service_id_value;
    end if;

    if exists (
      select 1
      from unnest(add_on_ids) values_table(id)
      group by values_table.id
      having count(*) > 1
    ) then
      raise exception 'Service % contains duplicate booking add-ons.', service_id_value;
    end if;

    if service_id_value = any(add_on_ids) then
      raise exception 'A service cannot be its own booking add-on.';
    end if;

    if exists (
      select 1
      from unnest(booking_staff_ids) selected_staff(id)
      left join public.staff
        on staff.id = selected_staff.id
        and staff.organization_id = location_organization_id
        and staff.salon_id = p_salon_id
      where staff.id is null
    ) then
      raise exception 'Service % contains booking staff from another salon.',
        service_id_value;
    end if;

    if exists (
      select 1
      from unnest(booking_staff_ids) selected_staff(id)
      join public.staff
        on staff.id = selected_staff.id
        and staff.organization_id = location_organization_id
        and staff.salon_id = p_salon_id
      where staff.is_active is not true
        and not exists (
          select 1
          from public.staff_service_assignments assignments
          where assignments.organization_id = location_organization_id
            and assignments.salon_id = p_salon_id
            and assignments.service_id = service_id_value
            and assignments.staff_id = selected_staff.id
            and assignments.is_active = true
            and assignments.online_bookable = true
        )
    ) then
      raise exception 'Inactive staff cannot be newly selected for service %.',
        service_id_value;
    end if;

    if is_active_value is not true and exists (
      select 1
      from unnest(booking_staff_ids) selected_staff(id)
      where not exists (
        select 1
        from public.staff_service_assignments assignments
        where assignments.organization_id = location_organization_id
          and assignments.salon_id = p_salon_id
          and assignments.service_id = service_id_value
          and assignments.staff_id = selected_staff.id
          and assignments.is_active = true
          and assignments.online_bookable = true
      )
    ) then
      raise exception 'Booking staff cannot be newly selected for an inactive service.';
    end if;

    if exists (
      select 1
      from unnest(add_on_ids) selected_add_on(id)
      left join public.services candidate
        on candidate.id = selected_add_on.id
        and candidate.organization_id = location_organization_id
        and candidate.salon_id = p_salon_id
      where candidate.id is null
    ) then
      raise exception 'Service % contains a booking add-on from another salon.',
        service_id_value;
    end if;

    if exists (
      select 1
      from unnest(add_on_ids) selected_add_on(id)
      join public.services candidate
        on candidate.id = selected_add_on.id
        and candidate.organization_id = location_organization_id
        and candidate.salon_id = p_salon_id
      where coalesce(
        (
          select (batch_candidate ->> 'is_active')::boolean
          from jsonb_array_elements(normalized_configs) batch_candidate
          where (batch_candidate ->> 'service_id')::uuid = selected_add_on.id
          limit 1
        ),
        candidate.is_active
      ) is not true
        and not exists (
          select 1
          from public.service_add_on_links links
          where links.organization_id = location_organization_id
            and links.salon_id = p_salon_id
            and links.parent_service_id = service_id_value
            and links.add_on_service_id = selected_add_on.id
            and links.is_active = true
        )
    ) then
      raise exception 'Inactive services cannot be newly selected as booking add-ons.';
    end if;
  end loop;

  for config_item in
    select value
    from jsonb_array_elements(normalized_configs)
  loop
    service_id_value := (config_item ->> 'service_id')::uuid;
    name_value := config_item ->> 'name';
    category_value := nullif(config_item ->> 'category', '');
    description_value := nullif(config_item ->> 'description', '');
    base_price_value := (config_item ->> 'base_price')::numeric;
    duration_minutes_value := (config_item ->> 'duration_minutes')::integer;
    is_active_value := (config_item ->> 'is_active')::boolean;
    online_booking_enabled_value :=
      (config_item ->> 'online_booking_enabled')::boolean;

    select coalesce(array_agg(ids.value::uuid), array[]::uuid[])
    into booking_staff_ids
    from jsonb_array_elements_text(config_item -> 'booking_staff_ids') ids(value);

    select coalesce(array_agg(ids.value::uuid), array[]::uuid[])
    into add_on_ids
    from jsonb_array_elements_text(config_item -> 'add_on_service_ids') ids(value);

    insert into public.services (
      id,
      organization_id,
      salon_id,
      name,
      category,
      description,
      base_price,
      duration_minutes,
      is_active,
      online_booking_enabled
    )
    values (
      service_id_value,
      location_organization_id,
      p_salon_id,
      name_value,
      category_value,
      description_value,
      base_price_value,
      duration_minutes_value,
      is_active_value,
      online_booking_enabled_value
    )
    on conflict (id)
    do update set
      name = excluded.name,
      category = excluded.category,
      description = excluded.description,
      base_price = excluded.base_price,
      duration_minutes = excluded.duration_minutes,
      is_active = excluded.is_active,
      online_booking_enabled = excluded.online_booking_enabled,
      updated_at = now();

    update public.staff_service_assignments
    set
      is_active = false,
      online_bookable = false,
      updated_at = now(),
      updated_by_user_id = actor_user_id
    where staff_service_assignments.organization_id = location_organization_id
      and staff_service_assignments.salon_id = p_salon_id
      and staff_service_assignments.service_id = service_id_value
      and not (staff_service_assignments.staff_id = any(booking_staff_ids))
      and (
        staff_service_assignments.is_active = true
        or staff_service_assignments.online_bookable = true
      );

    if is_active_value then
      foreach staff_id_value in array booking_staff_ids
      loop
        if exists (
          select 1
          from public.staff
          where staff.id = staff_id_value
            and staff.organization_id = location_organization_id
            and staff.salon_id = p_salon_id
            and staff.is_active = true
        ) then
          insert into public.staff_service_assignments (
            organization_id,
            salon_id,
            staff_id,
            service_id,
            is_active,
            online_bookable,
            created_by_user_id,
            updated_by_user_id
          )
          values (
            location_organization_id,
            p_salon_id,
            staff_id_value,
            service_id_value,
            true,
            true,
            actor_user_id,
            actor_user_id
          )
          on conflict (salon_id, staff_id, service_id)
          do update set
            is_active = true,
            online_bookable = true,
            updated_at = now(),
            updated_by_user_id = actor_user_id;
        end if;
      end loop;
    end if;

    update public.service_add_on_links
    set
      is_active = false,
      updated_at = now()
    where service_add_on_links.organization_id = location_organization_id
      and service_add_on_links.salon_id = p_salon_id
      and service_add_on_links.parent_service_id = service_id_value
      and not (service_add_on_links.add_on_service_id = any(add_on_ids))
      and service_add_on_links.is_active = true;

    for add_on_service_id_value in
      select selected.id
      from unnest(add_on_ids) with ordinality selected(id, position)
      order by selected.position
    loop
      insert into public.service_add_on_links (
        organization_id,
        salon_id,
        parent_service_id,
        add_on_service_id,
        is_active,
        display_order
      )
      values (
        location_organization_id,
        p_salon_id,
        service_id_value,
        add_on_service_id_value,
        true,
        array_position(add_on_ids, add_on_service_id_value) - 1
      )
      on conflict (salon_id, parent_service_id, add_on_service_id)
      do update set
        is_active = true,
        display_order = excluded.display_order,
        updated_at = now();
    end loop;

    result_service_ids := array_append(result_service_ids, service_id_value);
  end loop;

  return jsonb_build_object(
    'ok', true,
    'changed_count', cardinality(result_service_ids),
    'service_ids', to_jsonb(result_service_ids)
  );
end;
$$;

comment on function public.save_service_config_batch(uuid, jsonb)
is 'Atomically saves service details, active/online state, booking staff, and booking add-ons for one salon.';

revoke all on function public.save_service_config_batch(uuid, jsonb)
from public;
revoke all on function public.save_service_config_batch(uuid, jsonb)
from anon;
grant execute on function public.save_service_config_batch(uuid, jsonb)
to authenticated;
