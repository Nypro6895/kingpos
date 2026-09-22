alter table public.salon_settings
add column if not exists operating_timezone_iana text not null default 'America/Chicago';

alter table public.salon_settings
drop constraint if exists salon_settings_operating_timezone_iana_not_blank;

alter table public.salon_settings
add constraint salon_settings_operating_timezone_iana_not_blank
check (length(btrim(operating_timezone_iana)) > 0);

create table if not exists public.salon_operating_hours (
  id uuid primary key default gen_random_uuid(),
  salon_id uuid not null references public.locations(id) on delete cascade,
  day_of_week integer not null check (day_of_week between 0 and 6),
  opens_at_local time not null,
  closes_at_local time not null,
  sort_order integer not null default 0,
  is_active boolean not null default true,
  created_by_user_id uuid references public.users(id) on delete set null,
  updated_by_user_id uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint salon_operating_hours_nonzero_window
    check (opens_at_local <> closes_at_local)
);

create index if not exists salon_operating_hours_active_lookup_idx
on public.salon_operating_hours (salon_id, day_of_week, sort_order)
where is_active = true;

drop trigger if exists set_salon_operating_hours_updated_at
on public.salon_operating_hours;

create trigger set_salon_operating_hours_updated_at
before update on public.salon_operating_hours
for each row execute function public.set_updated_at();

create table if not exists public.salon_special_hours (
  id uuid primary key default gen_random_uuid(),
  salon_id uuid not null references public.locations(id) on delete cascade,
  local_date date not null,
  status text not null check (status in ('closed', 'custom_hours')),
  opens_at_local time,
  closes_at_local time,
  reason text,
  is_active boolean not null default true,
  created_by_user_id uuid references public.users(id) on delete set null,
  updated_by_user_id uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint salon_special_hours_status_times
    check (
      (
        status = 'closed'
        and opens_at_local is null
        and closes_at_local is null
      )
      or (
        status = 'custom_hours'
        and opens_at_local is not null
        and closes_at_local is not null
        and opens_at_local <> closes_at_local
      )
    )
);

create unique index if not exists salon_special_hours_one_active_date_idx
on public.salon_special_hours (salon_id, local_date)
where is_active = true;

create index if not exists salon_special_hours_active_lookup_idx
on public.salon_special_hours (salon_id, local_date)
where is_active = true;

drop trigger if exists set_salon_special_hours_updated_at
on public.salon_special_hours;

create trigger set_salon_special_hours_updated_at
before update on public.salon_special_hours
for each row execute function public.set_updated_at();

alter table public.salon_operating_hours enable row level security;
alter table public.salon_special_hours enable row level security;

drop policy if exists "public_read_published_salon_operating_hours"
on public.salon_operating_hours;

create policy "public_read_published_salon_operating_hours"
on public.salon_operating_hours
for select to anon, authenticated
using (
  is_active = true
  and exists (
    select 1
    from public.salon_settings settings
    where settings.salon_id = salon_operating_hours.salon_id
      and settings.public_discovery_enabled = true
  )
);

drop policy if exists "salon_member_read_operating_hours"
on public.salon_operating_hours;

create policy "salon_member_read_operating_hours"
on public.salon_operating_hours
for select to authenticated
using (
  public.user_has_salon_permission(
    salon_id,
    array['salon_settings.view', 'salon_settings.manage']::text[]
  )
);

drop policy if exists "salon_manager_write_operating_hours"
on public.salon_operating_hours;

create policy "salon_manager_write_operating_hours"
on public.salon_operating_hours
for all to authenticated
using (public.user_has_salon_permission(salon_id, array['salon_settings.manage']::text[]))
with check (public.user_has_salon_permission(salon_id, array['salon_settings.manage']::text[]));

drop policy if exists "public_read_published_salon_special_hours"
on public.salon_special_hours;

create policy "public_read_published_salon_special_hours"
on public.salon_special_hours
for select to anon, authenticated
using (
  is_active = true
  and exists (
    select 1
    from public.salon_settings settings
    where settings.salon_id = salon_special_hours.salon_id
      and settings.public_discovery_enabled = true
  )
);

drop policy if exists "salon_member_read_special_hours"
on public.salon_special_hours;

create policy "salon_member_read_special_hours"
on public.salon_special_hours
for select to authenticated
using (
  public.user_has_salon_permission(
    salon_id,
    array['salon_settings.view', 'salon_settings.manage']::text[]
  )
);

drop policy if exists "salon_manager_write_special_hours"
on public.salon_special_hours;

create policy "salon_manager_write_special_hours"
on public.salon_special_hours
for all to authenticated
using (public.user_has_salon_permission(salon_id, array['salon_settings.manage']::text[]))
with check (public.user_has_salon_permission(salon_id, array['salon_settings.manage']::text[]));

create or replace function public.get_public_salon_operating_status_inputs(
  target_salon_ids uuid[]
)
returns table (
  salon_id uuid,
  lifecycle_status text,
  timezone_iana text,
  weekly_hours jsonb,
  special_hours jsonb
)
language sql
stable
security definer
set search_path = public
as $$
  select
    salons.id as salon_id,
    public.normalize_salon_lifecycle_status(salons.status) as lifecycle_status,
    coalesce(
      nullif(btrim(settings.operating_timezone_iana), ''),
      'America/Chicago'
    ) as timezone_iana,
    coalesce(
      (
        select jsonb_agg(
          jsonb_build_object(
            'id', hours.id,
            'dayOfWeek', hours.day_of_week,
            'opensAt', to_char(hours.opens_at_local, 'HH24:MI'),
            'closesAt', to_char(hours.closes_at_local, 'HH24:MI'),
            'sortOrder', hours.sort_order
          )
          order by hours.day_of_week, hours.sort_order, hours.opens_at_local
        )
        from public.salon_operating_hours hours
        where hours.salon_id = salons.id
          and hours.is_active = true
      ),
      '[]'::jsonb
    ) as weekly_hours,
    coalesce(
      (
        select jsonb_agg(
          jsonb_build_object(
            'id', special.id,
            'localDate', special.local_date::text,
            'status', special.status,
            'opensAt', case
              when special.opens_at_local is null then null
              else to_char(special.opens_at_local, 'HH24:MI')
            end,
            'closesAt', case
              when special.closes_at_local is null then null
              else to_char(special.closes_at_local, 'HH24:MI')
            end,
            'reason', special.reason
          )
          order by special.local_date
        )
        from public.salon_special_hours special
        where special.salon_id = salons.id
          and special.is_active = true
          and special.local_date between
            ((now() at time zone coalesce(nullif(btrim(settings.operating_timezone_iana), ''), 'America/Chicago'))::date - 1)
            and
            ((now() at time zone coalesce(nullif(btrim(settings.operating_timezone_iana), ''), 'America/Chicago'))::date + 30)
      ),
      '[]'::jsonb
    ) as special_hours
  from public.locations salons
  join public.salon_settings settings on settings.salon_id = salons.id
  where target_salon_ids is not null
    and cardinality(target_salon_ids) between 1 and 50
    and salons.id = any(target_salon_ids)
    and settings.public_discovery_enabled = true
    and public.normalize_salon_lifecycle_status(salons.status) in ('active', 'permanently_closed')
$$;

revoke all on function public.get_public_salon_operating_status_inputs(uuid[]) from public;
grant execute on function public.get_public_salon_operating_status_inputs(uuid[]) to anon, authenticated;
