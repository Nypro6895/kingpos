alter table public.salon_settings
add column if not exists public_profile_tagline text;

alter table public.salon_settings
add column if not exists public_profile_story text;

alter table public.salon_settings
add column if not exists public_profile_logo_path text;

alter table public.salon_settings
add column if not exists public_profile_cover_path text;

comment on column public.salon_settings.public_profile_tagline is
  'Short public salon profile tagline shown on the public salon profile.';

comment on column public.salon_settings.public_profile_story is
  'Optional public salon story shown on the About tab.';

comment on column public.salon_settings.public_profile_logo_path is
  'Storage path for the public salon profile logo.';

comment on column public.salon_settings.public_profile_cover_path is
  'Storage path for the public salon profile cover image.';

insert into public.permissions (code, name, description, category, is_system)
values
  (
    'salon_profile.view',
    'View salon profile',
    'View salon public profile management.',
    'Salon Profile',
    true
  ),
  (
    'salon_profile.manage',
    'Manage salon profile',
    'Manage salon public profile identity and publication details.',
    'Salon Profile',
    true
  ),
  (
    'salon_profile.content.manage',
    'Manage salon profile content',
    'Create and manage public salon looks and updates.',
    'Salon Profile',
    true
  )
on conflict (code) do update
set
  name = excluded.name,
  description = excluded.description,
  category = excluded.category,
  is_system = excluded.is_system,
  updated_at = now();

insert into public.role_permissions (role_id, permission_id)
select roles.id, permissions.id
from public.roles
join public.permissions
  on permissions.code = any(
    case roles.code
      when 'OWNER' then array[
        'salon_profile.view',
        'salon_profile.manage',
        'salon_profile.content.manage'
      ]
      when 'MANAGER' then array[
        'salon_profile.view',
        'salon_profile.content.manage'
      ]
      when 'MARKETING' then array[
        'salon_profile.view',
        'salon_profile.content.manage'
      ]
      else array[]::text[]
    end
  )
on conflict do nothing;

insert into storage.buckets (
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types
)
values (
  'salon-profile-media',
  'salon-profile-media',
  true,
  8388608,
  array[
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

drop policy if exists "Public users can view salon profile media"
on storage.objects;
create policy "Public users can view salon profile media"
on storage.objects
for select
to anon, authenticated
using (bucket_id = 'salon-profile-media');

drop policy if exists "Salon profile users can upload media"
on storage.objects;
create policy "Salon profile users can upload media"
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'salon-profile-media'
  and (storage.foldername(name))[1] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  and public.user_has_organization_permission(
    ((storage.foldername(name))[1])::uuid,
    array['salon_profile.manage', 'salon_profile.content.manage']::text[]
  )
);

drop policy if exists "Salon profile users can replace media"
on storage.objects;
create policy "Salon profile users can replace media"
on storage.objects
for update
to authenticated
using (
  bucket_id = 'salon-profile-media'
  and (storage.foldername(name))[1] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  and public.user_has_organization_permission(
    ((storage.foldername(name))[1])::uuid,
    array['salon_profile.manage', 'salon_profile.content.manage']::text[]
  )
)
with check (
  bucket_id = 'salon-profile-media'
  and (storage.foldername(name))[1] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  and public.user_has_organization_permission(
    ((storage.foldername(name))[1])::uuid,
    array['salon_profile.manage', 'salon_profile.content.manage']::text[]
  )
);

drop policy if exists "Salon profile users can delete media"
on storage.objects;
create policy "Salon profile users can delete media"
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'salon-profile-media'
  and (storage.foldername(name))[1] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  and public.user_has_organization_permission(
    ((storage.foldername(name))[1])::uuid,
    array['salon_profile.manage', 'salon_profile.content.manage']::text[]
  )
);

create table if not exists public.salon_profile_looks (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  salon_id uuid not null references public.locations(id) on delete cascade,
  author_user_id uuid references public.users(id) on delete set null,
  service_id uuid references public.services(id) on delete set null,
  recommended_staff_id uuid references public.staff(id) on delete set null,
  title text not null,
  emotional_description text,
  why_love_it text,
  mood text,
  duration_minutes integer,
  starting_price numeric(10,2),
  palette text[] not null default '{}'::text[],
  badge text,
  media_path text,
  booking_note text,
  is_pinned boolean not null default false,
  status text not null default 'draft',
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint salon_profile_looks_title_not_blank check (length(btrim(title)) > 0),
  constraint salon_profile_looks_duration_positive check (
    duration_minutes is null or duration_minutes > 0
  ),
  constraint salon_profile_looks_starting_price_nonnegative check (
    starting_price is null or starting_price >= 0
  ),
  constraint salon_profile_looks_palette_limit check (
    array_length(palette, 1) is null or array_length(palette, 1) <= 6
  ),
  constraint salon_profile_looks_status_check check (
    status in ('draft', 'published', 'archived')
  )
);

create index if not exists salon_profile_looks_workspace_idx
on public.salon_profile_looks(organization_id, salon_id, created_at desc);

create index if not exists salon_profile_looks_public_idx
on public.salon_profile_looks(salon_id, status, published_at desc)
where status = 'published';

create index if not exists salon_profile_looks_public_pinned_idx
on public.salon_profile_looks(salon_id, is_pinned, published_at desc)
where status = 'published';

create index if not exists salon_profile_looks_mood_idx
on public.salon_profile_looks(salon_id, mood)
where status = 'published';

drop trigger if exists update_salon_profile_looks_updated_at
on public.salon_profile_looks;

create trigger update_salon_profile_looks_updated_at
before update on public.salon_profile_looks
for each row
execute function public.update_updated_at_column();

create or replace function public.validate_salon_profile_look_scope()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'UPDATE' and (
    new.organization_id is distinct from old.organization_id
    or new.salon_id is distinct from old.salon_id
  ) then
    raise exception 'Salon profile look organization and salon cannot be changed.';
  end if;

  if not exists (
    select 1
    from public.locations
    where locations.id = new.salon_id
      and locations.organization_id = new.organization_id
  ) then
    raise exception 'Salon profile look salon must belong to the organization.';
  end if;

  if new.service_id is not null and not exists (
    select 1
    from public.services
    where services.id = new.service_id
      and services.organization_id = new.organization_id
      and services.salon_id = new.salon_id
  ) then
    raise exception 'Salon profile look service must belong to the salon.';
  end if;

  if new.recommended_staff_id is not null and not exists (
    select 1
    from public.staff
    where staff.id = new.recommended_staff_id
      and staff.organization_id = new.organization_id
      and staff.salon_id = new.salon_id
  ) then
    raise exception 'Salon profile look staff must belong to the salon.';
  end if;

  if new.status = 'published' and new.published_at is null then
    new.published_at := now();
  end if;

  return new;
end;
$$;

drop trigger if exists validate_salon_profile_look_scope
on public.salon_profile_looks;

create trigger validate_salon_profile_look_scope
before insert or update on public.salon_profile_looks
for each row
execute function public.validate_salon_profile_look_scope();

create table if not exists public.salon_profile_updates (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  salon_id uuid not null references public.locations(id) on delete cascade,
  author_user_id uuid references public.users(id) on delete set null,
  service_id uuid references public.services(id) on delete set null,
  staff_id uuid references public.staff(id) on delete set null,
  update_type text not null,
  title text not null,
  summary text,
  starts_at timestamptz,
  ends_at timestamptz,
  cta_label text,
  status text not null default 'draft',
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint salon_profile_updates_title_not_blank check (length(btrim(title)) > 0),
  constraint salon_profile_updates_type_check check (
    update_type in (
      'last_minute_opening',
      'fresh_from_studio',
      'announcement',
      'new_artist',
      'seasonal_offer'
    )
  ),
  constraint salon_profile_updates_status_check check (
    status in ('draft', 'published', 'archived')
  ),
  constraint salon_profile_updates_time_check check (
    starts_at is null or ends_at is null or ends_at > starts_at
  )
);

create index if not exists salon_profile_updates_workspace_idx
on public.salon_profile_updates(organization_id, salon_id, created_at desc);

create index if not exists salon_profile_updates_public_idx
on public.salon_profile_updates(salon_id, status, published_at desc)
where status = 'published';

drop trigger if exists update_salon_profile_updates_updated_at
on public.salon_profile_updates;

create trigger update_salon_profile_updates_updated_at
before update on public.salon_profile_updates
for each row
execute function public.update_updated_at_column();

create or replace function public.validate_salon_profile_update_scope()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'UPDATE' and (
    new.organization_id is distinct from old.organization_id
    or new.salon_id is distinct from old.salon_id
  ) then
    raise exception 'Salon profile update organization and salon cannot be changed.';
  end if;

  if not exists (
    select 1
    from public.locations
    where locations.id = new.salon_id
      and locations.organization_id = new.organization_id
  ) then
    raise exception 'Salon profile update salon must belong to the organization.';
  end if;

  if new.service_id is not null and not exists (
    select 1
    from public.services
    where services.id = new.service_id
      and services.organization_id = new.organization_id
      and services.salon_id = new.salon_id
  ) then
    raise exception 'Salon profile update service must belong to the salon.';
  end if;

  if new.staff_id is not null and not exists (
    select 1
    from public.staff
    where staff.id = new.staff_id
      and staff.organization_id = new.organization_id
      and staff.salon_id = new.salon_id
  ) then
    raise exception 'Salon profile update staff must belong to the salon.';
  end if;

  if new.status = 'published' and new.published_at is null then
    new.published_at := now();
  end if;

  return new;
end;
$$;

drop trigger if exists validate_salon_profile_update_scope
on public.salon_profile_updates;

create trigger validate_salon_profile_update_scope
before insert or update on public.salon_profile_updates
for each row
execute function public.validate_salon_profile_update_scope();

create table if not exists public.salon_profile_look_saves (
  id uuid primary key default gen_random_uuid(),
  look_id uuid not null references public.salon_profile_looks(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  constraint salon_profile_look_saves_unique unique (look_id, user_id)
);

create index if not exists salon_profile_look_saves_user_idx
on public.salon_profile_look_saves(user_id, created_at desc);

create index if not exists salon_profile_look_saves_look_idx
on public.salon_profile_look_saves(look_id);

create table if not exists public.salon_profile_follows (
  id uuid primary key default gen_random_uuid(),
  salon_id uuid not null references public.locations(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  constraint salon_profile_follows_unique unique (salon_id, user_id)
);

create index if not exists salon_profile_follows_user_idx
on public.salon_profile_follows(user_id, created_at desc);

create index if not exists salon_profile_follows_salon_idx
on public.salon_profile_follows(salon_id);

create or replace function public.salon_profile_public_salon_exists(
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
    from public.locations l
    join public.salon_settings ss
      on ss.salon_id = l.id
      and ss.organization_id = l.organization_id
    where l.id = target_salon_id
      and l.status = 'active'
      and ss.public_discovery_enabled = true
      and length(btrim(coalesce(ss.business_name, l.name, ''))) > 0
      and length(btrim(coalesce(ss.phone, l.phone, ''))) > 0
      and length(btrim(coalesce(ss.address_line1, l.address_line1, ''))) > 0
      and length(btrim(coalesce(ss.city, l.city, ''))) > 0
      and length(btrim(coalesce(ss.state, l.state, ''))) > 0
      and length(btrim(coalesce(ss.postal_code, l.postal_code, ''))) > 0
      and length(btrim(coalesce(ss.business_description, ''))) > 0
      and exists (
        select 1
        from public.services s
        where s.salon_id = l.id
          and s.organization_id = l.organization_id
          and s.is_active = true
      )
  )
$$;

alter table public.salon_profile_looks enable row level security;
alter table public.salon_profile_updates enable row level security;
alter table public.salon_profile_look_saves enable row level security;
alter table public.salon_profile_follows enable row level security;

drop policy if exists "Organization profile users can view looks"
on public.salon_profile_looks;
create policy "Organization profile users can view looks"
on public.salon_profile_looks
for select
to authenticated
using (public.user_belongs_to_organization(organization_id));

drop policy if exists "Profile content users can create looks"
on public.salon_profile_looks;
create policy "Profile content users can create looks"
on public.salon_profile_looks
for insert
to authenticated
with check (
  public.user_has_organization_permission(
    organization_id,
    array['salon_profile.content.manage']::text[]
  )
  and author_user_id = public.current_public_user_id()
);

drop policy if exists "Profile content users can update looks"
on public.salon_profile_looks;
create policy "Profile content users can update looks"
on public.salon_profile_looks
for update
to authenticated
using (
  public.user_has_organization_permission(
    organization_id,
    array['salon_profile.content.manage']::text[]
  )
)
with check (
  public.user_has_organization_permission(
    organization_id,
    array['salon_profile.content.manage']::text[]
  )
);

drop policy if exists "Profile content users can delete looks"
on public.salon_profile_looks;
create policy "Profile content users can delete looks"
on public.salon_profile_looks
for delete
to authenticated
using (
  public.user_has_organization_permission(
    organization_id,
    array['salon_profile.content.manage']::text[]
  )
);

drop policy if exists "Organization profile users can view updates"
on public.salon_profile_updates;
create policy "Organization profile users can view updates"
on public.salon_profile_updates
for select
to authenticated
using (public.user_belongs_to_organization(organization_id));

drop policy if exists "Profile content users can create updates"
on public.salon_profile_updates;
create policy "Profile content users can create updates"
on public.salon_profile_updates
for insert
to authenticated
with check (
  public.user_has_organization_permission(
    organization_id,
    array['salon_profile.content.manage']::text[]
  )
  and author_user_id = public.current_public_user_id()
);

drop policy if exists "Profile content users can update updates"
on public.salon_profile_updates;
create policy "Profile content users can update updates"
on public.salon_profile_updates
for update
to authenticated
using (
  public.user_has_organization_permission(
    organization_id,
    array['salon_profile.content.manage']::text[]
  )
)
with check (
  public.user_has_organization_permission(
    organization_id,
    array['salon_profile.content.manage']::text[]
  )
);

drop policy if exists "Profile content users can delete updates"
on public.salon_profile_updates;
create policy "Profile content users can delete updates"
on public.salon_profile_updates
for delete
to authenticated
using (
  public.user_has_organization_permission(
    organization_id,
    array['salon_profile.content.manage']::text[]
  )
);

drop policy if exists "Users can view their own look saves"
on public.salon_profile_look_saves;
create policy "Users can view their own look saves"
on public.salon_profile_look_saves
for select
to authenticated
using (user_id = public.current_public_user_id());

drop policy if exists "Users can save published looks"
on public.salon_profile_look_saves;
create policy "Users can save published looks"
on public.salon_profile_look_saves
for insert
to authenticated
with check (
  user_id = public.current_public_user_id()
  and exists (
    select 1
    from public.salon_profile_looks looks
    where looks.id = salon_profile_look_saves.look_id
      and looks.status = 'published'
      and public.salon_profile_public_salon_exists(looks.salon_id)
  )
);

drop policy if exists "Users can remove their own look saves"
on public.salon_profile_look_saves;
create policy "Users can remove their own look saves"
on public.salon_profile_look_saves
for delete
to authenticated
using (user_id = public.current_public_user_id());

drop policy if exists "Users can view their own follows"
on public.salon_profile_follows;
create policy "Users can view their own follows"
on public.salon_profile_follows
for select
to authenticated
using (user_id = public.current_public_user_id());

drop policy if exists "Users can follow public salons"
on public.salon_profile_follows;
create policy "Users can follow public salons"
on public.salon_profile_follows
for insert
to authenticated
with check (
  user_id = public.current_public_user_id()
  and public.salon_profile_public_salon_exists(salon_id)
);

drop policy if exists "Users can remove their own follows"
on public.salon_profile_follows;
create policy "Users can remove their own follows"
on public.salon_profile_follows
for delete
to authenticated
using (user_id = public.current_public_user_id());

drop function if exists public.get_public_salon_profile(uuid);
create function public.get_public_salon_profile(target_salon_id uuid)
returns table (
  organization_id uuid,
  salon_id uuid,
  salon_name text,
  tagline text,
  description text,
  story text,
  phone text,
  email text,
  website text,
  address_line1 text,
  address_line2 text,
  city text,
  state text,
  postal_code text,
  country text,
  logo_path text,
  cover_path text,
  public_discovery_published_at timestamptz,
  active_service_count integer,
  service_categories text[],
  service_names text[],
  follower_count bigint,
  is_following boolean
)
language sql
stable
security definer
set search_path = public
as $$
  select
    l.organization_id,
    l.id as salon_id,
    coalesce(nullif(btrim(ss.business_name), ''), l.name) as salon_name,
    nullif(btrim(ss.public_profile_tagline), '') as tagline,
    nullif(btrim(ss.business_description), '') as description,
    nullif(btrim(ss.public_profile_story), '') as story,
    coalesce(nullif(btrim(ss.phone), ''), l.phone) as phone,
    nullif(btrim(ss.email), '') as email,
    nullif(btrim(ss.website), '') as website,
    coalesce(nullif(btrim(ss.address_line1), ''), l.address_line1) as address_line1,
    coalesce(nullif(btrim(ss.address_line2), ''), l.address_line2) as address_line2,
    coalesce(nullif(btrim(ss.city), ''), l.city) as city,
    coalesce(nullif(btrim(ss.state), ''), l.state) as state,
    coalesce(nullif(btrim(ss.postal_code), ''), l.postal_code) as postal_code,
    coalesce(nullif(btrim(ss.country), ''), l.country) as country,
    nullif(btrim(ss.public_profile_logo_path), '') as logo_path,
    nullif(btrim(ss.public_profile_cover_path), '') as cover_path,
    ss.public_discovery_published_at,
    count(distinct s.id)::integer as active_service_count,
    coalesce(
      array_agg(distinct nullif(btrim(s.category), ''))
        filter (where nullif(btrim(s.category), '') is not null),
      '{}'::text[]
    ) as service_categories,
    coalesce(
      array_agg(distinct nullif(btrim(s.name), ''))
        filter (where nullif(btrim(s.name), '') is not null),
      '{}'::text[]
    ) as service_names,
    (
      select count(*)::bigint
      from public.salon_profile_follows follows
      where follows.salon_id = l.id
    ) as follower_count,
    (
      public.current_public_user_id() is not null
      and exists (
        select 1
        from public.salon_profile_follows follows
        where follows.salon_id = l.id
          and follows.user_id = public.current_public_user_id()
      )
    ) as is_following
  from public.locations l
  join public.salon_settings ss
    on ss.salon_id = l.id
    and ss.organization_id = l.organization_id
  join public.services s
    on s.salon_id = l.id
    and s.organization_id = l.organization_id
    and s.is_active = true
  where l.id = target_salon_id
    and public.salon_profile_public_salon_exists(l.id)
  group by
    l.organization_id,
    l.id,
    l.name,
    l.phone,
    l.address_line1,
    l.address_line2,
    l.city,
    l.state,
    l.postal_code,
    l.country,
    ss.business_name,
    ss.public_profile_tagline,
    ss.business_description,
    ss.public_profile_story,
    ss.phone,
    ss.email,
    ss.website,
    ss.address_line1,
    ss.address_line2,
    ss.city,
    ss.state,
    ss.postal_code,
    ss.country,
    ss.public_profile_logo_path,
    ss.public_profile_cover_path,
    ss.public_discovery_published_at;
$$;

drop function if exists public.get_public_salon_profile_services(uuid);
create function public.get_public_salon_profile_services(target_salon_id uuid)
returns table (
  id uuid,
  name text,
  category text,
  base_price numeric,
  duration_minutes integer,
  description text
)
language sql
stable
security definer
set search_path = public
as $$
  select
    services.id,
    services.name,
    services.category,
    services.base_price,
    services.duration_minutes,
    services.description
  from public.services
  where services.salon_id = target_salon_id
    and services.is_active = true
    and public.salon_profile_public_salon_exists(target_salon_id)
  order by
    services.category asc nulls last,
    services.name asc;
$$;

drop function if exists public.get_public_salon_profile_staff(uuid);
create function public.get_public_salon_profile_staff(target_salon_id uuid)
returns table (
  id uuid,
  display_name text,
  job_title text
)
language sql
stable
security definer
set search_path = public
as $$
  select
    staff.id,
    staff.display_name,
    staff.job_title
  from public.staff
  where staff.salon_id = target_salon_id
    and staff.is_active = true
    and public.salon_profile_public_salon_exists(target_salon_id)
  order by staff.display_name asc;
$$;

drop function if exists public.get_public_salon_profile_looks(uuid);
create function public.get_public_salon_profile_looks(target_salon_id uuid)
returns table (
  id uuid,
  title text,
  emotional_description text,
  why_love_it text,
  mood text,
  duration_minutes integer,
  starting_price numeric,
  palette text[],
  badge text,
  media_path text,
  booking_note text,
  is_pinned boolean,
  service_id uuid,
  service_name text,
  recommended_staff_id uuid,
  recommended_staff_name text,
  published_at timestamptz,
  save_count bigint,
  is_saved boolean
)
language sql
stable
security definer
set search_path = public
as $$
  select
    looks.id,
    looks.title,
    looks.emotional_description,
    looks.why_love_it,
    looks.mood,
    looks.duration_minutes,
    looks.starting_price,
    looks.palette,
    looks.badge,
    looks.media_path,
    looks.booking_note,
    looks.is_pinned,
    services.id as service_id,
    services.name as service_name,
    staff.id as recommended_staff_id,
    staff.display_name as recommended_staff_name,
    looks.published_at,
    (
      select count(*)::bigint
      from public.salon_profile_look_saves saves
      where saves.look_id = looks.id
    ) as save_count,
    (
      public.current_public_user_id() is not null
      and exists (
        select 1
        from public.salon_profile_look_saves saves
        where saves.look_id = looks.id
          and saves.user_id = public.current_public_user_id()
      )
    ) as is_saved
  from public.salon_profile_looks looks
  left join public.services
    on services.id = looks.service_id
    and services.salon_id = looks.salon_id
  left join public.staff
    on staff.id = looks.recommended_staff_id
    and staff.salon_id = looks.salon_id
    and staff.is_active = true
  where looks.salon_id = target_salon_id
    and looks.status = 'published'
    and public.salon_profile_public_salon_exists(target_salon_id)
  order by
    looks.is_pinned desc,
    looks.published_at desc nulls last,
    looks.created_at desc;
$$;

drop function if exists public.get_public_salon_profile_updates(uuid);
create function public.get_public_salon_profile_updates(target_salon_id uuid)
returns table (
  id uuid,
  update_type text,
  title text,
  summary text,
  starts_at timestamptz,
  ends_at timestamptz,
  cta_label text,
  service_id uuid,
  service_name text,
  staff_id uuid,
  staff_name text,
  published_at timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select
    updates.id,
    updates.update_type,
    updates.title,
    updates.summary,
    updates.starts_at,
    updates.ends_at,
    updates.cta_label,
    services.id as service_id,
    services.name as service_name,
    staff.id as staff_id,
    staff.display_name as staff_name,
    updates.published_at
  from public.salon_profile_updates updates
  left join public.services
    on services.id = updates.service_id
    and services.salon_id = updates.salon_id
  left join public.staff
    on staff.id = updates.staff_id
    and staff.salon_id = updates.salon_id
    and staff.is_active = true
  where updates.salon_id = target_salon_id
    and updates.status = 'published'
    and public.salon_profile_public_salon_exists(target_salon_id)
  order by
    updates.published_at desc nulls last,
    updates.created_at desc
  limit 3;
$$;

revoke all on function public.salon_profile_public_salon_exists(uuid) from public;
grant execute on function public.salon_profile_public_salon_exists(uuid) to anon, authenticated;

revoke all on function public.get_public_salon_profile(uuid) from public;
grant execute on function public.get_public_salon_profile(uuid) to anon, authenticated;

revoke all on function public.get_public_salon_profile_services(uuid) from public;
grant execute on function public.get_public_salon_profile_services(uuid) to anon, authenticated;

revoke all on function public.get_public_salon_profile_staff(uuid) from public;
grant execute on function public.get_public_salon_profile_staff(uuid) to anon, authenticated;

revoke all on function public.get_public_salon_profile_looks(uuid) from public;
grant execute on function public.get_public_salon_profile_looks(uuid) to anon, authenticated;

revoke all on function public.get_public_salon_profile_updates(uuid) from public;
grant execute on function public.get_public_salon_profile_updates(uuid) to anon, authenticated;
