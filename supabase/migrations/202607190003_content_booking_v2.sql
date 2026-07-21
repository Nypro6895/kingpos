create table if not exists public.salon_profile_content_booking_configs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  salon_id uuid not null references public.locations(id) on delete cascade,
  source_type text not null,
  look_id uuid references public.salon_profile_looks(id) on delete cascade,
  update_id uuid references public.salon_profile_updates(id) on delete cascade,
  booking_cta_enabled boolean not null default true,
  primary_service_id uuid references public.services(id) on delete set null,
  credited_staff_id uuid references public.staff(id) on delete set null,
  booking_note text,
  created_by_user_id uuid references public.users(id) on delete set null,
  updated_by_user_id uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint salon_profile_content_booking_configs_source_check check (
    (
      source_type = 'salon_profile_look'
      and look_id is not null
      and update_id is null
    )
    or (
      source_type = 'salon_profile_update'
      and update_id is not null
      and look_id is null
    )
  )
);

comment on table public.salon_profile_content_booking_configs is
  'Canonical booking configuration for public salon profile content. Hashtags remain suggestions only.';

create unique index if not exists salon_profile_content_booking_configs_look_uidx
on public.salon_profile_content_booking_configs (look_id)
where look_id is not null;

create unique index if not exists salon_profile_content_booking_configs_update_uidx
on public.salon_profile_content_booking_configs (update_id)
where update_id is not null;

create index if not exists salon_profile_content_booking_configs_salon_idx
on public.salon_profile_content_booking_configs (salon_id, source_type, updated_at desc);

create index if not exists salon_profile_content_booking_configs_primary_service_idx
on public.salon_profile_content_booking_configs (primary_service_id)
where primary_service_id is not null;

create index if not exists salon_profile_content_booking_configs_staff_idx
on public.salon_profile_content_booking_configs (credited_staff_id)
where credited_staff_id is not null;

drop trigger if exists update_salon_profile_content_booking_configs_updated_at
on public.salon_profile_content_booking_configs;

create trigger update_salon_profile_content_booking_configs_updated_at
before update on public.salon_profile_content_booking_configs
for each row
execute function public.update_updated_at_column();

create or replace function public.validate_salon_profile_content_booking_config_scope()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_op = 'UPDATE' and (
    new.organization_id is distinct from old.organization_id
    or new.salon_id is distinct from old.salon_id
    or new.source_type is distinct from old.source_type
    or new.look_id is distinct from old.look_id
    or new.update_id is distinct from old.update_id
  ) then
    raise exception 'Content booking source ownership fields cannot be changed.';
  end if;

  if not exists (
    select 1
    from public.locations
    where locations.id = new.salon_id
      and locations.organization_id = new.organization_id
  ) then
    raise exception 'Content booking config salon must belong to the organization.';
  end if;

  if new.source_type = 'salon_profile_look' then
    if not exists (
      select 1
      from public.salon_profile_looks looks
      where looks.id = new.look_id
        and looks.organization_id = new.organization_id
        and looks.salon_id = new.salon_id
    ) then
      raise exception 'Content booking look must belong to the selected salon.';
    end if;
  elsif new.source_type = 'salon_profile_update' then
    if not exists (
      select 1
      from public.salon_profile_updates updates
      where updates.id = new.update_id
        and updates.organization_id = new.organization_id
        and updates.salon_id = new.salon_id
    ) then
      raise exception 'Content booking update must belong to the selected salon.';
    end if;
  else
    raise exception 'Unsupported content booking source type.';
  end if;

  if new.primary_service_id is not null and not exists (
    select 1
    from public.services
    where services.id = new.primary_service_id
      and services.organization_id = new.organization_id
      and services.salon_id = new.salon_id
  ) then
    raise exception 'Content booking primary service must belong to the salon.';
  end if;

  if new.credited_staff_id is not null and not exists (
    select 1
    from public.staff
    where staff.id = new.credited_staff_id
      and staff.organization_id = new.organization_id
      and staff.salon_id = new.salon_id
  ) then
    raise exception 'Content booking credited staff must belong to the salon.';
  end if;

  return new;
end;
$$;

drop trigger if exists validate_salon_profile_content_booking_config_scope
on public.salon_profile_content_booking_configs;

create trigger validate_salon_profile_content_booking_config_scope
before insert or update on public.salon_profile_content_booking_configs
for each row
execute function public.validate_salon_profile_content_booking_config_scope();

create table if not exists public.salon_profile_content_booking_services (
  id uuid primary key default gen_random_uuid(),
  config_id uuid not null references public.salon_profile_content_booking_configs(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  salon_id uuid not null references public.locations(id) on delete cascade,
  service_id uuid not null references public.services(id) on delete cascade,
  parent_service_id uuid references public.services(id) on delete cascade,
  service_role text not null default 'additional_service',
  display_order integer not null default 0,
  created_at timestamptz not null default now(),
  constraint salon_profile_content_booking_services_role_check check (
    service_role in ('additional_service', 'add_on')
  ),
  constraint salon_profile_content_booking_services_parent_check check (
    (
      service_role = 'additional_service'
      and parent_service_id is null
    )
    or (
      service_role = 'add_on'
      and parent_service_id is not null
    )
  ),
  constraint salon_profile_content_booking_services_no_self_parent check (
    parent_service_id is null or parent_service_id <> service_id
  )
);

create unique index if not exists salon_profile_content_booking_services_unique_idx
on public.salon_profile_content_booking_services (config_id, service_id);

create index if not exists salon_profile_content_booking_services_config_idx
on public.salon_profile_content_booking_services (config_id, display_order);

create index if not exists salon_profile_content_booking_services_service_idx
on public.salon_profile_content_booking_services (service_id);

create or replace function public.validate_salon_profile_content_booking_service_scope()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  config_row public.salon_profile_content_booking_configs%rowtype;
begin
  select *
  into config_row
  from public.salon_profile_content_booking_configs
  where id = new.config_id;

  if config_row.id is null then
    raise exception 'Content booking service requires an existing config.';
  end if;

  if new.organization_id is distinct from config_row.organization_id
    or new.salon_id is distinct from config_row.salon_id
  then
    raise exception 'Content booking service ownership must match the config.';
  end if;

  if not exists (
    select 1
    from public.services
    where services.id = new.service_id
      and services.organization_id = new.organization_id
      and services.salon_id = new.salon_id
  ) then
    raise exception 'Content booking service must belong to the salon.';
  end if;

  if new.parent_service_id is not null and not exists (
    select 1
    from public.services
    where services.id = new.parent_service_id
      and services.organization_id = new.organization_id
      and services.salon_id = new.salon_id
  ) then
    raise exception 'Content booking add-on parent must belong to the salon.';
  end if;

  if new.service_role = 'add_on' and not exists (
    select 1
    from public.service_add_on_links links
    where links.salon_id = new.salon_id
      and links.parent_service_id = new.parent_service_id
      and links.add_on_service_id = new.service_id
  ) then
    raise exception 'Content booking add-on must use an existing service add-on relationship.';
  end if;

  return new;
end;
$$;

drop trigger if exists validate_salon_profile_content_booking_service_scope
on public.salon_profile_content_booking_services;

create trigger validate_salon_profile_content_booking_service_scope
before insert or update on public.salon_profile_content_booking_services
for each row
execute function public.validate_salon_profile_content_booking_service_scope();

alter table public.salon_profile_content_booking_configs enable row level security;
alter table public.salon_profile_content_booking_services enable row level security;

drop policy if exists "Content managers can view content booking configs"
on public.salon_profile_content_booking_configs;
create policy "Content managers can view content booking configs"
on public.salon_profile_content_booking_configs
for select
to authenticated
using (
  public.user_has_organization_permission(
    organization_id,
    array['salon_profile.manage', 'salon_profile.content.manage']::text[]
  )
);

drop policy if exists "Content managers can manage content booking configs"
on public.salon_profile_content_booking_configs;
create policy "Content managers can manage content booking configs"
on public.salon_profile_content_booking_configs
for all
to authenticated
using (
  public.user_has_organization_permission(
    organization_id,
    array['salon_profile.manage', 'salon_profile.content.manage']::text[]
  )
)
with check (
  public.user_has_organization_permission(
    organization_id,
    array['salon_profile.manage', 'salon_profile.content.manage']::text[]
  )
);

drop policy if exists "Content managers can view content booking services"
on public.salon_profile_content_booking_services;
create policy "Content managers can view content booking services"
on public.salon_profile_content_booking_services
for select
to authenticated
using (
  public.user_has_organization_permission(
    organization_id,
    array['salon_profile.manage', 'salon_profile.content.manage']::text[]
  )
);

drop policy if exists "Content managers can manage content booking services"
on public.salon_profile_content_booking_services;
create policy "Content managers can manage content booking services"
on public.salon_profile_content_booking_services
for all
to authenticated
using (
  public.user_has_organization_permission(
    organization_id,
    array['salon_profile.manage', 'salon_profile.content.manage']::text[]
  )
)
with check (
  public.user_has_organization_permission(
    organization_id,
    array['salon_profile.manage', 'salon_profile.content.manage']::text[]
  )
);

revoke all on public.salon_profile_content_booking_configs from anon;
revoke all on public.salon_profile_content_booking_services from anon;
grant select, insert, update, delete on public.salon_profile_content_booking_configs to authenticated;
grant select, insert, update, delete on public.salon_profile_content_booking_services to authenticated;

insert into public.salon_profile_content_booking_configs (
  organization_id,
  salon_id,
  source_type,
  look_id,
  booking_cta_enabled,
  primary_service_id,
  credited_staff_id,
  booking_note,
  created_by_user_id,
  updated_by_user_id,
  created_at,
  updated_at
)
select
  looks.organization_id,
  looks.salon_id,
  'salon_profile_look',
  looks.id,
  true,
  looks.service_id,
  looks.recommended_staff_id,
  nullif(btrim(looks.booking_note), ''),
  looks.created_by_user_id,
  looks.created_by_user_id,
  looks.created_at,
  looks.updated_at
from public.salon_profile_looks looks
where looks.service_id is not null
  or looks.recommended_staff_id is not null
  or nullif(btrim(coalesce(looks.booking_note, '')), '') is not null
on conflict do nothing;

insert into public.salon_profile_content_booking_configs (
  organization_id,
  salon_id,
  source_type,
  update_id,
  booking_cta_enabled,
  primary_service_id,
  credited_staff_id,
  created_by_user_id,
  updated_by_user_id,
  created_at,
  updated_at
)
select
  updates.organization_id,
  updates.salon_id,
  'salon_profile_update',
  updates.id,
  true,
  updates.service_id,
  updates.staff_id,
  updates.created_by_user_id,
  updates.created_by_user_id,
  updates.created_at,
  updates.updated_at
from public.salon_profile_updates updates
where updates.service_id is not null
  or updates.staff_id is not null
on conflict do nothing;

create or replace function public.save_salon_profile_content_booking_config(
  p_source_type text,
  p_content_id uuid,
  p_booking_cta_enabled boolean default true,
  p_primary_service_id uuid default null,
  p_credited_staff_id uuid default null,
  p_additional_service_ids uuid[] default '{}'::uuid[],
  p_booking_note text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  actor_staff_id uuid;
  can_manage boolean;
  content_author_staff_id uuid;
  content_created_by_user_id uuid;
  content_look_id uuid;
  content_update_id uuid;
  normalized_additional_ids uuid[];
  organization_id_value uuid;
  primary_is_add_on_only boolean;
  saved_config_id uuid;
  service_id_value uuid;
  service_index integer := 0;
  salon_id_value uuid;
begin
  if auth.uid() is null then
    raise exception 'Sign in before saving booking setup.';
  end if;

  if p_source_type = 'salon_profile_look' then
    select
      looks.organization_id,
      looks.salon_id,
      looks.author_staff_id,
      looks.created_by_user_id,
      looks.id,
      null::uuid
    into
      organization_id_value,
      salon_id_value,
      content_author_staff_id,
      content_created_by_user_id,
      content_look_id,
      content_update_id
    from public.salon_profile_looks looks
    where looks.id = p_content_id;
  elsif p_source_type = 'salon_profile_update' then
    select
      updates.organization_id,
      updates.salon_id,
      updates.author_staff_id,
      updates.created_by_user_id,
      null::uuid,
      updates.id
    into
      organization_id_value,
      salon_id_value,
      content_author_staff_id,
      content_created_by_user_id,
      content_look_id,
      content_update_id
    from public.salon_profile_updates updates
    where updates.id = p_content_id;
  else
    raise exception 'Unsupported content booking source type.';
  end if;

  if organization_id_value is null or salon_id_value is null then
    raise exception 'Content was not found.';
  end if;

  can_manage := public.user_has_organization_permission(
    organization_id_value,
    array['salon_profile.manage', 'salon_profile.content.manage']::text[]
  );

  select staff.id
  into actor_staff_id
  from public.staff
  where staff.organization_id = organization_id_value
    and staff.salon_id = salon_id_value
    and staff.is_active = true
    and staff.salon_profile_content_posting_enabled = true
    and public.current_auth_user_matches_staff(
      staff.id,
      staff.organization_id,
      staff.salon_id
    )
  order by staff.created_at asc
  limit 1;

  if not can_manage and actor_staff_id is null then
    raise exception 'You do not have permission to manage booking setup for this content.';
  end if;

  if not can_manage and content_author_staff_id is distinct from actor_staff_id then
    raise exception 'You can only manage booking setup for your own posts.';
  end if;

  if not can_manage
    and p_credited_staff_id is not null
    and p_credited_staff_id is distinct from actor_staff_id
  then
    raise exception 'You can only credit yourself as the professional.';
  end if;

  if p_primary_service_id is not null then
    if not exists (
      select 1
      from public.services
      where services.id = p_primary_service_id
        and services.organization_id = organization_id_value
        and services.salon_id = salon_id_value
        and services.is_active = true
        and services.online_booking_enabled = true
    ) then
      raise exception 'Choose an active online service from this salon.';
    end if;

    select exists (
      select 1
      from public.service_add_on_links links
      where links.salon_id = salon_id_value
        and links.add_on_service_id = p_primary_service_id
        and links.is_active = true
    )
    into primary_is_add_on_only;

    if primary_is_add_on_only then
      raise exception 'Choose a primary service, not an add-on-only service.';
    end if;
  end if;

  if p_credited_staff_id is not null and not exists (
    select 1
    from public.staff
    where staff.id = p_credited_staff_id
      and staff.organization_id = organization_id_value
      and staff.salon_id = salon_id_value
      and staff.is_active = true
  ) then
    raise exception 'Choose an active professional from this salon.';
  end if;

  select coalesce(array_agg(distinct raw_id order by raw_id), '{}'::uuid[])
  into normalized_additional_ids
  from unnest(coalesce(p_additional_service_ids, '{}'::uuid[])) as selected(raw_id)
  where raw_id is not null
    and raw_id is distinct from p_primary_service_id;

  if coalesce(array_length(normalized_additional_ids, 1), 0) > 8 then
    raise exception 'Choose no more than 8 additional services.';
  end if;

  if exists (
    select 1
    from unnest(normalized_additional_ids) selected(service_id)
    left join public.services
      on services.id = selected.service_id
      and services.organization_id = organization_id_value
      and services.salon_id = salon_id_value
      and services.is_active = true
      and services.online_booking_enabled = true
    where services.id is null
  ) then
    raise exception 'Additional services must be active online services from this salon.';
  end if;

  if exists (
    select 1
    from unnest(normalized_additional_ids) selected(service_id)
    where exists (
      select 1
      from public.service_add_on_links links
      where links.salon_id = salon_id_value
        and links.add_on_service_id = selected.service_id
        and links.is_active = true
    )
    and not exists (
      select 1
      from public.service_add_on_links links
      where links.salon_id = salon_id_value
        and links.parent_service_id = p_primary_service_id
        and links.add_on_service_id = selected.service_id
        and links.is_active = true
    )
  ) then
    raise exception 'Add-ons must be linked to the selected primary service.';
  end if;

  select configs.id
  into saved_config_id
  from public.salon_profile_content_booking_configs configs
  where (
    p_source_type = 'salon_profile_look'
    and configs.look_id = content_look_id
  )
  or (
    p_source_type = 'salon_profile_update'
    and configs.update_id = content_update_id
  )
  limit 1;

  if saved_config_id is null then
    insert into public.salon_profile_content_booking_configs (
      organization_id,
      salon_id,
      source_type,
      look_id,
      update_id,
      booking_cta_enabled,
      primary_service_id,
      credited_staff_id,
      booking_note,
      created_by_user_id,
      updated_by_user_id
    )
    values (
      organization_id_value,
      salon_id_value,
      p_source_type,
      content_look_id,
      content_update_id,
      coalesce(p_booking_cta_enabled, false),
      p_primary_service_id,
      p_credited_staff_id,
      nullif(btrim(coalesce(p_booking_note, '')), ''),
      content_created_by_user_id,
      (select users.id from public.users where users.auth_user_id = auth.uid() limit 1)
    )
    returning id into saved_config_id;
  else
    update public.salon_profile_content_booking_configs
    set
      booking_cta_enabled = coalesce(p_booking_cta_enabled, false),
      primary_service_id = p_primary_service_id,
      credited_staff_id = p_credited_staff_id,
      booking_note = nullif(btrim(coalesce(p_booking_note, '')), ''),
      updated_by_user_id = (
        select users.id from public.users where users.auth_user_id = auth.uid() limit 1
      )
    where id = saved_config_id;
  end if;

  delete from public.salon_profile_content_booking_services
  where config_id = saved_config_id;

  foreach service_id_value in array normalized_additional_ids loop
    service_index := service_index + 1;

    insert into public.salon_profile_content_booking_services (
      config_id,
      organization_id,
      salon_id,
      service_id,
      parent_service_id,
      service_role,
      display_order
    )
    values (
      saved_config_id,
      organization_id_value,
      salon_id_value,
      service_id_value,
      case
        when exists (
          select 1
          from public.service_add_on_links links
          where links.salon_id = salon_id_value
            and links.parent_service_id = p_primary_service_id
            and links.add_on_service_id = service_id_value
            and links.is_active = true
        )
        then p_primary_service_id
        else null
      end,
      case
        when exists (
          select 1
          from public.service_add_on_links links
          where links.salon_id = salon_id_value
            and links.parent_service_id = p_primary_service_id
            and links.add_on_service_id = service_id_value
            and links.is_active = true
        )
        then 'add_on'
        else 'additional_service'
      end,
      service_index
    );
  end loop;

  if p_source_type = 'salon_profile_look' then
    update public.salon_profile_looks
    set
      service_id = p_primary_service_id,
      recommended_staff_id = p_credited_staff_id,
      booking_note = nullif(btrim(coalesce(p_booking_note, '')), '')
    where id = content_look_id;
  elsif p_source_type = 'salon_profile_update' then
    update public.salon_profile_updates
    set
      service_id = p_primary_service_id,
      staff_id = p_credited_staff_id
    where id = content_update_id;
  end if;

  return saved_config_id;
end;
$$;

revoke all on function public.save_salon_profile_content_booking_config(
  text,
  uuid,
  boolean,
  uuid,
  uuid,
  uuid[],
  text
) from public, anon;

grant execute on function public.save_salon_profile_content_booking_config(
  text,
  uuid,
  boolean,
  uuid,
  uuid,
  uuid[],
  text
) to authenticated;

create or replace function public.get_public_content_booking_options(
  target_salon_ids uuid[] default null
)
returns table (
  source_type text,
  content_type text,
  content_id uuid,
  organization_id uuid,
  salon_id uuid,
  booking_cta_enabled boolean,
  booking_enabled boolean,
  booking_href text,
  cta_label text,
  readiness_state text,
  readiness_message text,
  primary_service_id uuid,
  primary_service_name text,
  primary_service_base_price numeric,
  primary_service_duration_minutes integer,
  credited_staff_id uuid,
  credited_staff_name text,
  title text,
  caption text,
  booking_note text,
  media_path text,
  additional_services jsonb,
  add_ons jsonb
)
language sql
stable
security definer
set search_path = public
as $$
  with requested_salons as (
    select target_salon_ids as ids
  ),
  sources as (
    select
      'salon_profile_look'::text as source_type,
      'look'::text as content_type,
      looks.id as content_id,
      looks.organization_id,
      looks.salon_id,
      looks.service_id as legacy_service_id,
      looks.recommended_staff_id as legacy_staff_id,
      looks.title,
      nullif(btrim(coalesce(looks.caption, looks.emotional_description, '')), '') as caption,
      nullif(btrim(looks.booking_note), '') as booking_note,
      looks.media_path,
      looks.published_at
    from public.salon_profile_looks looks
    cross join requested_salons
    where looks.status = 'published'
      and public.salon_profile_public_salon_exists(looks.salon_id)
      and (
        requested_salons.ids is null
        or cardinality(requested_salons.ids) = 0
        or looks.salon_id = any(requested_salons.ids)
      )

    union all

    select
      'salon_profile_update'::text as source_type,
      'update'::text as content_type,
      updates.id as content_id,
      updates.organization_id,
      updates.salon_id,
      updates.service_id as legacy_service_id,
      updates.staff_id as legacy_staff_id,
      updates.title,
      nullif(btrim(coalesce(updates.caption, updates.summary, '')), '') as caption,
      null::text as booking_note,
      updates.media_path,
      updates.published_at
    from public.salon_profile_updates updates
    cross join requested_salons
    where updates.status = 'published'
      and public.salon_profile_public_salon_exists(updates.salon_id)
      and (
        requested_salons.ids is null
        or cardinality(requested_salons.ids) = 0
        or updates.salon_id = any(requested_salons.ids)
      )
  ),
  configured as (
    select
      sources.*,
      configs.id as config_id,
      coalesce(configs.booking_cta_enabled, true) as booking_cta_enabled,
      coalesce(configs.primary_service_id, sources.legacy_service_id) as effective_primary_service_id,
      coalesce(configs.credited_staff_id, sources.legacy_staff_id) as effective_credited_staff_id,
      coalesce(nullif(btrim(configs.booking_note), ''), sources.booking_note) as effective_booking_note
    from sources
    left join public.salon_profile_content_booking_configs configs
      on configs.source_type = sources.source_type
      and (
        (sources.source_type = 'salon_profile_look' and configs.look_id = sources.content_id)
        or (sources.source_type = 'salon_profile_update' and configs.update_id = sources.content_id)
      )
  ),
  enriched as (
    select
      configured.*,
      settings.booking_enabled as salon_booking_enabled,
      settings.online_booking_visible,
      primary_services.id as primary_service_id,
      primary_services.name as primary_service_name,
      primary_services.base_price as primary_service_base_price,
      primary_services.duration_minutes as primary_service_duration_minutes,
      primary_services.is_active as primary_service_active,
      primary_services.online_booking_enabled as primary_service_online,
      exists (
        select 1
        from public.service_add_on_links links
        where links.salon_id = configured.salon_id
          and links.add_on_service_id = configured.effective_primary_service_id
          and links.is_active = true
      ) as primary_is_add_on_only,
      credited_staff.id as credited_staff_id,
      credited_staff.display_name as credited_staff_name,
      credited_staff.is_active as credited_staff_active,
      credited_staff.public_profile_visible as credited_staff_public_visible,
      credited_staff.owner_public_enabled as credited_staff_owner_public,
      credited_staff.online_booking_enabled as credited_staff_online
    from configured
    left join public.booking_settings settings
      on settings.salon_id = configured.salon_id
      and settings.organization_id = configured.organization_id
    left join public.services primary_services
      on primary_services.id = configured.effective_primary_service_id
      and primary_services.organization_id = configured.organization_id
      and primary_services.salon_id = configured.salon_id
    left join public.staff credited_staff
      on credited_staff.id = configured.effective_credited_staff_id
      and credited_staff.organization_id = configured.organization_id
      and credited_staff.salon_id = configured.salon_id
  ),
  service_items as (
    select
      enriched.source_type,
      enriched.content_id,
      coalesce(
        jsonb_agg(
          jsonb_build_object(
            'service_id', services.id,
            'service_name', services.name,
            'base_price', services.base_price,
            'duration_minutes', services.duration_minutes,
            'service_role', items.service_role,
            'parent_service_id', items.parent_service_id,
            'display_order', items.display_order,
            'eligible',
              services.is_active = true
              and services.online_booking_enabled = true
              and (
                (
                  items.service_role = 'additional_service'
                  and not exists (
                    select 1
                    from public.service_add_on_links add_on_only
                    where add_on_only.salon_id = items.salon_id
                      and add_on_only.add_on_service_id = items.service_id
                      and add_on_only.is_active = true
                  )
                )
                or (
                  items.service_role = 'add_on'
                  and exists (
                    select 1
                    from public.service_add_on_links add_on_links
                    where add_on_links.salon_id = items.salon_id
                      and add_on_links.parent_service_id = items.parent_service_id
                      and add_on_links.add_on_service_id = items.service_id
                      and add_on_links.is_active = true
                  )
                )
              )
          )
          order by items.display_order, services.name
        ) filter (where items.id is not null),
        '[]'::jsonb
      ) as items_json
    from enriched
    left join public.salon_profile_content_booking_services items
      on items.config_id = enriched.config_id
    left join public.services
      on services.id = items.service_id
      and services.organization_id = items.organization_id
      and services.salon_id = items.salon_id
    group by enriched.source_type, enriched.content_id
  ),
  readiness as (
    select
      enriched.*,
      coalesce(service_items.items_json, '[]'::jsonb) as items_json,
      (
        enriched.primary_service_id is not null
        and enriched.primary_service_active = true
        and enriched.primary_service_online = true
        and enriched.primary_is_add_on_only = false
      ) as primary_valid,
      (
        enriched.credited_staff_id is not null
        and enriched.credited_staff_active = true
        and enriched.credited_staff_public_visible = true
        and enriched.credited_staff_owner_public = true
        and enriched.credited_staff_online = true
      ) as staff_public_valid,
      not exists (
        select 1
        from jsonb_array_elements(coalesce(service_items.items_json, '[]'::jsonb)) as item(value)
        where coalesce((item.value ->> 'eligible')::boolean, false) = false
      ) as additional_items_valid
    from enriched
    left join service_items
      on service_items.source_type = enriched.source_type
      and service_items.content_id = enriched.content_id
  ),
  final_rows as (
    select
      readiness.*,
      (
        readiness.staff_public_valid
        and (
          readiness.primary_service_id is null
          or exists (
            select 1
            from public.staff_service_assignments assignments
            where assignments.organization_id = readiness.organization_id
              and assignments.salon_id = readiness.salon_id
              and assignments.staff_id = readiness.credited_staff_id
              and assignments.service_id = readiness.primary_service_id
              and assignments.is_active = true
              and assignments.online_bookable = true
          )
        )
        and not exists (
          select 1
          from jsonb_array_elements(readiness.items_json) as item(value)
          where item.value ->> 'service_role' = 'additional_service'
            and not exists (
              select 1
              from public.staff_service_assignments assignments
              where assignments.organization_id = readiness.organization_id
                and assignments.salon_id = readiness.salon_id
                and assignments.staff_id = readiness.credited_staff_id
                and assignments.service_id = nullif(item.value ->> 'service_id', '')::uuid
                and assignments.is_active = true
                and assignments.online_bookable = true
            )
        )
      ) as staff_services_valid
    from readiness
  )
  select
    final_rows.source_type,
    final_rows.content_type,
    final_rows.content_id,
    final_rows.organization_id,
    final_rows.salon_id,
    final_rows.booking_cta_enabled,
    (
      final_rows.booking_cta_enabled = true
      and coalesce(final_rows.salon_booking_enabled, false) = true
      and coalesce(final_rows.online_booking_visible, false) = true
    ) as booking_enabled,
    case
      when final_rows.booking_cta_enabled = true
        and coalesce(final_rows.salon_booking_enabled, false) = true
        and coalesce(final_rows.online_booking_visible, false) = true
      then
        '/book/'
        || final_rows.salon_id::text
        || '?source=explore&inspiration='
        || final_rows.content_id::text
      else null
    end as booking_href,
    case
      when final_rows.primary_valid or final_rows.staff_public_valid then 'Book this look'
      else 'Book with this inspiration'
    end as cta_label,
    case
      when final_rows.primary_service_id is not null and final_rows.primary_valid = false then 'invalid'
      when final_rows.additional_items_valid = false then 'invalid'
      when final_rows.primary_valid and final_rows.staff_services_valid then 'quick_ready'
      when final_rows.primary_valid then 'service_ready'
      when final_rows.primary_service_id is null and final_rows.staff_public_valid then 'professional_ready'
      else 'inspiration_only'
    end as readiness_state,
    case
      when final_rows.primary_service_id is not null and final_rows.primary_valid = false
        then 'The original service for this look is no longer available. Choose another service to continue.'
      when final_rows.additional_items_valid = false
        then 'One of the mapped services is no longer available. Choose services to continue.'
      when final_rows.primary_valid and final_rows.credited_staff_id is not null and final_rows.staff_services_valid = false
        then 'The original professional is unavailable. Choose another professional.'
      when final_rows.primary_valid and final_rows.staff_services_valid
        then 'Ready for Quick Book.'
      when final_rows.primary_valid
        then 'Choose a professional to continue.'
      when final_rows.primary_service_id is null and final_rows.staff_public_valid
        then 'Choose a service to continue.'
      else 'Choose services and a professional. We will keep this inspiration attached.'
    end as readiness_message,
    final_rows.primary_service_id,
    final_rows.primary_service_name,
    final_rows.primary_service_base_price,
    final_rows.primary_service_duration_minutes,
    final_rows.credited_staff_id,
    final_rows.credited_staff_name,
    final_rows.title,
    final_rows.caption,
    final_rows.effective_booking_note,
    final_rows.media_path,
    coalesce(
      (
        select jsonb_agg(item.value order by (item.value ->> 'display_order')::integer)
        from jsonb_array_elements(final_rows.items_json) as item(value)
        where item.value ->> 'service_role' = 'additional_service'
      ),
      '[]'::jsonb
    ) as additional_services,
    coalesce(
      (
        select jsonb_agg(item.value order by (item.value ->> 'display_order')::integer)
        from jsonb_array_elements(final_rows.items_json) as item(value)
        where item.value ->> 'service_role' = 'add_on'
      ),
      '[]'::jsonb
    ) as add_ons
  from final_rows
  order by final_rows.published_at desc nulls last, final_rows.content_id desc;
$$;

revoke all on function public.get_public_content_booking_options(uuid[])
from public;

grant execute on function public.get_public_content_booking_options(uuid[])
to anon, authenticated;

drop function if exists public.get_public_content_booking_options(uuid);
create function public.get_public_content_booking_options(target_salon_id uuid)
returns table (
  source_type text,
  content_type text,
  content_id uuid,
  organization_id uuid,
  salon_id uuid,
  booking_cta_enabled boolean,
  booking_enabled boolean,
  booking_href text,
  cta_label text,
  readiness_state text,
  readiness_message text,
  primary_service_id uuid,
  primary_service_name text,
  primary_service_base_price numeric,
  primary_service_duration_minutes integer,
  credited_staff_id uuid,
  credited_staff_name text,
  title text,
  caption text,
  booking_note text,
  media_path text,
  additional_services jsonb,
  add_ons jsonb
)
language sql
stable
security definer
set search_path = public
as $$
  select *
  from public.get_public_content_booking_options(array[target_salon_id]::uuid[]);
$$;

revoke all on function public.get_public_content_booking_options(uuid)
from public;

grant execute on function public.get_public_content_booking_options(uuid)
to anon, authenticated;

alter table public.booking_inspirations
drop constraint if exists booking_inspirations_source_type_check;

alter table public.booking_inspirations
add constraint booking_inspirations_source_type_check check (
  source_type in ('salon_profile_look', 'salon_profile_update')
);

create or replace function public.capture_booking_inspiration_snapshot(
  p_booking_id uuid,
  p_source_reference_type text,
  p_source_reference_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  asset_height integer;
  asset_id uuid;
  asset_mime_type text;
  asset_width integer;
  booking_row record;
  effective_booking_note text;
  effective_service_id uuid;
  effective_staff_id uuid;
  matching_line_id uuid;
  source_config_id uuid;
  source_row record;
begin
  if p_booking_id is null
    or p_source_reference_id is null
    or nullif(btrim(coalesce(p_source_reference_type, '')), '') is null
  then
    return;
  end if;

  if p_source_reference_type not in ('salon_profile_look', 'salon_profile_update') then
    return;
  end if;

  select *
  into booking_row
  from public.bookings
  where id = p_booking_id;

  if booking_row.id is null then
    return;
  end if;

  if p_source_reference_type = 'salon_profile_look' then
    select
      looks.id,
      looks.organization_id,
      looks.salon_id,
      looks.status,
      looks.title,
      nullif(btrim(coalesce(looks.caption, looks.emotional_description, '')), '') as caption,
      nullif(btrim(looks.booking_note), '') as booking_note,
      looks.media_path,
      looks.service_id as legacy_service_id,
      looks.recommended_staff_id as legacy_staff_id,
      services.name as legacy_service_name,
      staff.display_name as legacy_staff_name,
      locations.name as salon_name
    into source_row
    from public.salon_profile_looks looks
    join public.locations
      on locations.id = looks.salon_id
      and locations.organization_id = looks.organization_id
    left join public.services
      on services.id = looks.service_id
      and services.organization_id = looks.organization_id
      and services.salon_id = looks.salon_id
    left join public.staff
      on staff.id = looks.recommended_staff_id
      and staff.organization_id = looks.organization_id
      and staff.salon_id = looks.salon_id
    where looks.id = p_source_reference_id;
  else
    select
      updates.id,
      updates.organization_id,
      updates.salon_id,
      updates.status,
      updates.title,
      nullif(btrim(coalesce(updates.caption, updates.summary, '')), '') as caption,
      null::text as booking_note,
      updates.media_path,
      updates.service_id as legacy_service_id,
      updates.staff_id as legacy_staff_id,
      services.name as legacy_service_name,
      staff.display_name as legacy_staff_name,
      locations.name as salon_name
    into source_row
    from public.salon_profile_updates updates
    join public.locations
      on locations.id = updates.salon_id
      and locations.organization_id = updates.organization_id
    left join public.services
      on services.id = updates.service_id
      and services.organization_id = updates.organization_id
      and services.salon_id = updates.salon_id
    left join public.staff
      on staff.id = updates.staff_id
      and staff.organization_id = updates.organization_id
      and staff.salon_id = updates.salon_id
    where updates.id = p_source_reference_id;
  end if;

  if source_row.id is null
    or source_row.organization_id <> booking_row.organization_id
    or source_row.salon_id <> booking_row.salon_id
  then
    return;
  end if;

  select
    configs.id,
    coalesce(configs.primary_service_id, source_row.legacy_service_id) as effective_service_id,
    coalesce(configs.credited_staff_id, source_row.legacy_staff_id) as effective_staff_id,
    coalesce(configs.booking_note, source_row.booking_note) as effective_booking_note
  into
    source_config_id,
    effective_service_id,
    effective_staff_id,
    effective_booking_note
  from public.salon_profile_content_booking_configs configs
  where configs.source_type = p_source_reference_type
    and (
      (p_source_reference_type = 'salon_profile_look' and configs.look_id = source_row.id)
      or (p_source_reference_type = 'salon_profile_update' and configs.update_id = source_row.id)
    )
  limit 1;

  if source_config_id is null then
    effective_service_id := source_row.legacy_service_id;
    effective_staff_id := source_row.legacy_staff_id;
    effective_booking_note := source_row.booking_note;
  end if;

  if source_row.media_path is not null then
    select
      assets.id,
      assets.width,
      assets.height,
      assets.mime_type
    into
      asset_id,
      asset_width,
      asset_height,
      asset_mime_type
    from public.salon_profile_media_assets assets
    where assets.bucket = 'salon-profile-media'
      and assets.object_path = source_row.media_path
      and assets.organization_id = source_row.organization_id
      and assets.salon_id = source_row.salon_id
    order by assets.updated_at desc
    limit 1;
  end if;

  if effective_service_id is not null then
    select lines.id
    into matching_line_id
    from public.booking_lines lines
    where lines.booking_id = booking_row.id
      and lines.service_id = effective_service_id
    order by lines.display_order asc
    limit 1;
  end if;

  insert into public.booking_inspirations (
    organization_id,
    salon_id,
    booking_id,
    booking_line_id,
    source_type,
    source_content_id,
    source_salon_id,
    source_media_asset_id,
    source_media_bucket,
    source_media_path,
    source_media_width,
    source_media_height,
    source_media_mime_type,
    credited_staff_id,
    service_id,
    source_title_snapshot,
    source_caption_snapshot,
    source_booking_note_snapshot,
    service_name_snapshot,
    credited_staff_name_snapshot,
    salon_name_snapshot,
    metadata
  )
  values (
    booking_row.organization_id,
    booking_row.salon_id,
    booking_row.id,
    matching_line_id,
    p_source_reference_type,
    source_row.id,
    source_row.salon_id,
    asset_id,
    'salon-profile-media',
    source_row.media_path,
    asset_width,
    asset_height,
    asset_mime_type,
    effective_staff_id,
    effective_service_id,
    source_row.title,
    source_row.caption,
    effective_booking_note,
    coalesce(
      (
        select services.name
        from public.services
        where services.id = effective_service_id
      ),
      source_row.legacy_service_name
    ),
    coalesce(
      (
        select staff.display_name
        from public.staff
        where staff.id = effective_staff_id
      ),
      source_row.legacy_staff_name
    ),
    source_row.salon_name,
    jsonb_build_object(
      'source_status_at_booking', source_row.status,
      'source_config_id', source_config_id,
      'source_content_type',
        case
          when p_source_reference_type = 'salon_profile_look' then 'look'
          else 'update'
        end,
      'mapped_additional_services',
        coalesce(
          (
            select jsonb_agg(
              jsonb_build_object(
                'service_id', items.service_id,
                'service_role', items.service_role,
                'parent_service_id', items.parent_service_id,
                'display_order', items.display_order,
                'service_name', services.name
              )
              order by items.display_order
            )
            from public.salon_profile_content_booking_services items
            join public.services
              on services.id = items.service_id
            where items.config_id = source_config_id
          ),
          '[]'::jsonb
        ),
      'final_booking_lines',
        coalesce(
          (
            select jsonb_agg(
              jsonb_build_object(
                'booking_line_id', lines.id,
                'service_id', lines.service_id,
                'service_name', lines.service_name_snapshot,
                'assigned_staff_id', lines.assigned_staff_id,
                'staff_name', staff.display_name,
                'line_type', lines.line_type,
                'parent_booking_line_id', lines.parent_booking_line_id,
                'display_order', lines.display_order
              )
              order by lines.display_order
            )
            from public.booking_lines lines
            left join public.staff
              on staff.id = lines.assigned_staff_id
            where lines.booking_id = booking_row.id
          ),
          '[]'::jsonb
        ),
      'selected_service_changed',
        matching_line_id is null and effective_service_id is not null
    )
  )
  on conflict (booking_id) do update
  set
    booking_line_id = excluded.booking_line_id,
    source_type = excluded.source_type,
    source_content_id = excluded.source_content_id,
    source_salon_id = excluded.source_salon_id,
    source_media_asset_id = excluded.source_media_asset_id,
    source_media_bucket = excluded.source_media_bucket,
    source_media_path = excluded.source_media_path,
    source_media_width = excluded.source_media_width,
    source_media_height = excluded.source_media_height,
    source_media_mime_type = excluded.source_media_mime_type,
    credited_staff_id = excluded.credited_staff_id,
    service_id = excluded.service_id,
    source_title_snapshot = excluded.source_title_snapshot,
    source_caption_snapshot = excluded.source_caption_snapshot,
    source_booking_note_snapshot = excluded.source_booking_note_snapshot,
    service_name_snapshot = excluded.service_name_snapshot,
    credited_staff_name_snapshot = excluded.credited_staff_name_snapshot,
    salon_name_snapshot = excluded.salon_name_snapshot,
    metadata = excluded.metadata,
    updated_at = now();
end;
$$;

revoke all on function public.capture_booking_inspiration_snapshot(uuid, text, uuid)
from public, anon, authenticated;

notify pgrst, 'reload schema';
