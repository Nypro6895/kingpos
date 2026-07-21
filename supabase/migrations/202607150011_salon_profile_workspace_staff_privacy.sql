alter table public.staff
add column if not exists owner_public_enabled boolean not null default true,
add column if not exists staff_public_consent_status text not null default 'granted',
add column if not exists online_booking_enabled boolean not null default true,
add column if not exists profile_display_order integer not null default 0,
add column if not exists salon_profile_content_posting_enabled boolean not null default false;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'staff_public_consent_status_check'
      and conrelid = 'public.staff'::regclass
  ) then
    alter table public.staff
    add constraint staff_public_consent_status_check
    check (staff_public_consent_status in ('granted', 'not_requested', 'opted_out'));
  end if;
end;
$$;

update public.staff
set
  owner_public_enabled = coalesce(public_profile_visible, true),
  staff_public_consent_status = case
    when coalesce(public_profile_visible, true) then 'granted'
    else 'not_requested'
  end
where staff_public_consent_status = 'granted'
  and owner_public_enabled = true;

create index if not exists staff_public_team_order_idx
on public.staff(salon_id, profile_display_order, display_name)
where is_active = true;

create or replace function public.staff_has_effective_public_profile(staff_row public.staff)
returns boolean
language sql
stable
as $$
  select coalesce(staff_row.is_active, false)
    and coalesce(staff_row.owner_public_enabled, false)
    and staff_row.staff_public_consent_status = 'granted';
$$;

create or replace function public.current_user_is_active_staff_for_salon(target_salon_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.staff staff
    left join public.users current_account
      on current_account.id = public.current_public_user_id()
    where staff.salon_id = target_salon_id
      and staff.is_active = true
      and (
        staff.account_user_id = public.current_public_user_id()
        or staff.user_id = auth.uid()
        or staff.user_id = current_account.auth_user_id
      )
  );
$$;

create or replace function public.current_user_can_post_salon_profile_as_staff(target_salon_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.staff staff
    left join public.users current_account
      on current_account.id = public.current_public_user_id()
    where staff.salon_id = target_salon_id
      and staff.is_active = true
      and staff.salon_profile_content_posting_enabled = true
      and (
        staff.account_user_id = public.current_public_user_id()
        or staff.user_id = auth.uid()
        or staff.user_id = current_account.auth_user_id
      )
  );
$$;

grant execute on function public.staff_has_effective_public_profile(public.staff)
to anon, authenticated;
grant execute on function public.current_user_is_active_staff_for_salon(uuid)
to authenticated;
grant execute on function public.current_user_can_post_salon_profile_as_staff(uuid)
to authenticated;

drop policy if exists "Linked staff can view workplace salon settings"
on public.salon_settings;
create policy "Linked staff can view workplace salon settings"
on public.salon_settings
for select
to authenticated
using (public.current_user_is_active_staff_for_salon(salon_id));

drop policy if exists "Linked staff can view workplace services"
on public.services;
create policy "Linked staff can view workplace services"
on public.services
for select
to authenticated
using (public.current_user_is_active_staff_for_salon(salon_id));

drop policy if exists "Linked staff can view workplace team"
on public.staff;
create policy "Linked staff can view workplace team"
on public.staff
for select
to authenticated
using (public.current_user_is_active_staff_for_salon(salon_id));

drop policy if exists "Linked staff can view workplace profile looks"
on public.salon_profile_looks;
create policy "Linked staff can view workplace profile looks"
on public.salon_profile_looks
for select
to authenticated
using (public.current_user_is_active_staff_for_salon(salon_id));

drop policy if exists "Linked staff can view workplace profile updates"
on public.salon_profile_updates;
create policy "Linked staff can view workplace profile updates"
on public.salon_profile_updates
for select
to authenticated
using (public.current_user_is_active_staff_for_salon(salon_id));

drop policy if exists "Linked staff can create own salon profile looks"
on public.salon_profile_looks;
create policy "Linked staff can create own salon profile looks"
on public.salon_profile_looks
for insert
to authenticated
with check (
  author_user_id = public.current_public_user_id()
  and created_by_user_id = public.current_public_user_id()
  and public.current_user_can_post_salon_profile_as_staff(salon_id)
  and exists (
    select 1
    from public.staff staff
    left join public.users current_account
      on current_account.id = public.current_public_user_id()
    where staff.id = salon_profile_looks.author_staff_id
      and staff.organization_id = salon_profile_looks.organization_id
      and staff.salon_id = salon_profile_looks.salon_id
      and staff.is_active = true
      and staff.salon_profile_content_posting_enabled = true
      and (
        staff.account_user_id = public.current_public_user_id()
        or staff.user_id = auth.uid()
        or staff.user_id = current_account.auth_user_id
      )
  )
);

drop policy if exists "Linked staff can create own salon profile updates"
on public.salon_profile_updates;
create policy "Linked staff can create own salon profile updates"
on public.salon_profile_updates
for insert
to authenticated
with check (
  author_user_id = public.current_public_user_id()
  and created_by_user_id = public.current_public_user_id()
  and public.current_user_can_post_salon_profile_as_staff(salon_id)
  and exists (
    select 1
    from public.staff staff
    left join public.users current_account
      on current_account.id = public.current_public_user_id()
    where staff.id = salon_profile_updates.author_staff_id
      and staff.organization_id = salon_profile_updates.organization_id
      and staff.salon_id = salon_profile_updates.salon_id
      and staff.is_active = true
      and staff.salon_profile_content_posting_enabled = true
      and (
        staff.account_user_id = public.current_public_user_id()
        or staff.user_id = auth.uid()
        or staff.user_id = current_account.auth_user_id
      )
  )
);

drop policy if exists "Linked staff can reserve own salon profile content media"
on public.salon_profile_media_assets;
create policy "Linked staff can reserve own salon profile content media"
on public.salon_profile_media_assets
for insert
to authenticated
with check (
  upload_intent = 'content'
  and purpose in ('look', 'update')
  and uploaded_by_user_id = public.current_public_user_id()
  and public.current_user_can_post_salon_profile_as_staff(salon_id)
);

drop policy if exists "Linked staff can update own salon profile content media"
on public.salon_profile_media_assets;
create policy "Linked staff can update own salon profile content media"
on public.salon_profile_media_assets
for update
to authenticated
using (
  upload_intent = 'content'
  and purpose in ('look', 'update')
  and uploaded_by_user_id = public.current_public_user_id()
  and public.current_user_can_post_salon_profile_as_staff(salon_id)
)
with check (
  upload_intent = 'content'
  and purpose in ('look', 'update')
  and uploaded_by_user_id = public.current_public_user_id()
  and public.current_user_can_post_salon_profile_as_staff(salon_id)
);

create or replace function public.user_can_manage_salon_profile_media(
  object_name text,
  permission_codes text[]
)
returns boolean
language plpgsql
stable
security definer
set search_path = public, storage
as $$
declare
  folder_parts text[];
  first_part text;
  required_permissions text[];
  second_part text;
  target_organization_id uuid;
  target_salon_id uuid;
  target_staff_id uuid;
begin
  if object_name is null or object_name = '' then
    return false;
  end if;

  if object_name like '/%' or object_name like '%..%' or object_name like '%\%' then
    return false;
  end if;

  folder_parts := storage.foldername(object_name);
  first_part := folder_parts[1];
  second_part := folder_parts[2];

  if first_part is null or first_part !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    return false;
  end if;

  if second_part = 'profile' then
    target_salon_id := first_part::uuid;
    required_permissions := array['salon_profile.manage']::text[];
  elsif second_part in ('looks', 'updates') then
    target_salon_id := first_part::uuid;
    required_permissions := array['salon_profile.manage', 'salon_profile.content.manage']::text[];
  elsif second_part = 'staff'
    and folder_parts[3] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    and folder_parts[4] = 'avatar'
  then
    target_salon_id := first_part::uuid;
    target_staff_id := folder_parts[3]::uuid;
    required_permissions := array['staff.manage']::text[];
  elsif second_part = 'reviews' then
    target_salon_id := first_part::uuid;
    required_permissions := array[]::text[];
  elsif second_part is not null
    and second_part ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    and folder_parts[3] = 'identity' then
    target_salon_id := second_part::uuid;
    required_permissions := array['salon_profile.manage']::text[];
  elsif second_part is not null
    and second_part ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    and folder_parts[3] = 'looks' then
    target_salon_id := second_part::uuid;
    required_permissions := array['salon_profile.manage', 'salon_profile.content.manage']::text[];
  else
    return false;
  end if;

  select locations.organization_id
  into target_organization_id
  from public.locations
  where locations.id = target_salon_id;

  if target_organization_id is null then
    return false;
  end if;

  if target_staff_id is not null
    and public.current_auth_user_matches_staff(
      target_staff_id,
      target_organization_id,
      target_salon_id
    )
  then
    return true;
  end if;

  if second_part in ('looks', 'updates')
    and public.current_user_can_post_salon_profile_as_staff(target_salon_id)
  then
    return true;
  end if;

  return public.user_has_organization_permission(
    target_organization_id,
    coalesce(nullif(required_permissions, array[]::text[]), permission_codes)
  );
end;
$$;

drop function if exists public.get_public_salon_profile_staff(uuid);
create function public.get_public_salon_profile_staff(target_salon_id uuid)
returns table (
  id uuid,
  display_name text,
  job_title text,
  avatar_path text,
  bio text,
  specialties text[],
  online_booking_enabled boolean,
  portfolio_count bigint
)
language sql
stable
security definer
set search_path = public
as $$
  select
    staff.id,
    staff.display_name,
    staff.job_title,
    nullif(btrim(staff.public_profile_photo_path), '') as avatar_path,
    nullif(btrim(staff.public_bio), '') as bio,
    coalesce(staff.specialties, '{}'::text[]) as specialties,
    coalesce(staff.online_booking_enabled, false) as online_booking_enabled,
    (
      select count(*)::bigint
      from public.salon_profile_looks looks
      where looks.salon_id = staff.salon_id
        and looks.author_staff_id = staff.id
        and looks.status = 'published'
    ) as portfolio_count
  from public.staff
  where staff.salon_id = target_salon_id
    and public.staff_has_effective_public_profile(staff)
    and public.salon_profile_public_salon_exists(target_salon_id)
  order by staff.profile_display_order asc, staff.display_name asc;
$$;

drop function if exists public.get_public_salon_profile_looks(uuid);
create function public.get_public_salon_profile_looks(target_salon_id uuid)
returns table (
  id uuid,
  title text,
  caption text,
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
  author_staff_id uuid,
  author_display_name text,
  author_avatar_path text,
  hashtags text[],
  published_at timestamptz,
  save_count bigint,
  comment_count bigint,
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
    nullif(btrim(coalesce(looks.caption, looks.emotional_description, '')), '') as caption,
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
    coalesce(
      bookable_recommended_staff.id,
      case when coalesce(author_staff.online_booking_enabled, false) then author_staff.id end
    ) as recommended_staff_id,
    coalesce(
      bookable_recommended_staff.display_name,
      case when coalesce(author_staff.online_booking_enabled, false) then author_staff.display_name end
    ) as recommended_staff_name,
    author_staff.id as author_staff_id,
    coalesce(
      author_staff.display_name,
      nullif(btrim(settings.business_name), ''),
      locations.name,
      'Salon team'
    ) as author_display_name,
    nullif(btrim(author_staff.public_profile_photo_path), '') as author_avatar_path,
    coalesce(
      (
        select array_agg(tags.slug order by tags.slug)
        from public.salon_profile_look_hashtags rel
        join public.salon_profile_hashtags tags
          on tags.id = rel.hashtag_id
        where rel.look_id = looks.id
      ),
      '{}'::text[]
    ) as hashtags,
    looks.published_at,
    (
      select count(*)::bigint
      from public.salon_profile_look_saves saves
      where saves.look_id = looks.id
    ) as save_count,
    (
      select count(*)::bigint
      from public.salon_profile_comments comments
      where comments.look_id = looks.id
        and comments.status = 'visible'
    ) as comment_count,
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
  join public.locations locations
    on locations.id = looks.salon_id
  left join public.salon_settings settings
    on settings.salon_id = looks.salon_id
    and settings.organization_id = looks.organization_id
  left join public.services
    on services.id = looks.service_id
    and services.salon_id = looks.salon_id
  left join public.staff bookable_recommended_staff
    on bookable_recommended_staff.id = looks.recommended_staff_id
    and bookable_recommended_staff.salon_id = looks.salon_id
    and public.staff_has_effective_public_profile(bookable_recommended_staff)
    and bookable_recommended_staff.online_booking_enabled = true
  left join public.staff author_staff
    on author_staff.id = looks.author_staff_id
    and author_staff.salon_id = looks.salon_id
    and public.staff_has_effective_public_profile(author_staff)
  where looks.salon_id = target_salon_id
    and looks.status = 'published'
    and public.salon_profile_public_salon_exists(target_salon_id)
  order by
    looks.is_pinned desc,
    looks.published_at desc nulls last,
    looks.created_at desc
  limit 24;
$$;

drop function if exists public.get_public_salon_profile_updates(uuid);
create function public.get_public_salon_profile_updates(target_salon_id uuid)
returns table (
  id uuid,
  update_type text,
  title text,
  caption text,
  summary text,
  media_path text,
  starts_at timestamptz,
  ends_at timestamptz,
  cta_label text,
  service_id uuid,
  service_name text,
  staff_id uuid,
  staff_name text,
  author_staff_id uuid,
  author_display_name text,
  author_avatar_path text,
  hashtags text[],
  published_at timestamptz,
  comment_count bigint
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
    nullif(btrim(coalesce(updates.caption, updates.summary, '')), '') as caption,
    updates.summary,
    updates.media_path,
    updates.starts_at,
    updates.ends_at,
    updates.cta_label,
    services.id as service_id,
    services.name as service_name,
    bookable_update_staff.id as staff_id,
    bookable_update_staff.display_name as staff_name,
    author_staff.id as author_staff_id,
    coalesce(
      author_staff.display_name,
      nullif(btrim(settings.business_name), ''),
      locations.name,
      'Salon team'
    ) as author_display_name,
    nullif(btrim(author_staff.public_profile_photo_path), '') as author_avatar_path,
    coalesce(
      (
        select array_agg(tags.slug order by tags.slug)
        from public.salon_profile_update_hashtags rel
        join public.salon_profile_hashtags tags
          on tags.id = rel.hashtag_id
        where rel.update_id = updates.id
      ),
      '{}'::text[]
    ) as hashtags,
    updates.published_at,
    (
      select count(*)::bigint
      from public.salon_profile_comments comments
      where comments.update_id = updates.id
        and comments.status = 'visible'
    ) as comment_count
  from public.salon_profile_updates updates
  join public.locations locations
    on locations.id = updates.salon_id
  left join public.salon_settings settings
    on settings.salon_id = updates.salon_id
    and settings.organization_id = updates.organization_id
  left join public.services
    on services.id = updates.service_id
    and services.salon_id = updates.salon_id
  left join public.staff bookable_update_staff
    on bookable_update_staff.id = updates.staff_id
    and bookable_update_staff.salon_id = updates.salon_id
    and public.staff_has_effective_public_profile(bookable_update_staff)
    and bookable_update_staff.online_booking_enabled = true
  left join public.staff author_staff
    on author_staff.id = updates.author_staff_id
    and author_staff.salon_id = updates.salon_id
    and public.staff_has_effective_public_profile(author_staff)
  where updates.salon_id = target_salon_id
    and updates.status = 'published'
    and public.salon_profile_public_salon_exists(target_salon_id)
  order by
    updates.published_at desc nulls last,
    updates.created_at desc
  limit 24;
$$;

create or replace function public.validate_salon_profile_booking_request_scope()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'UPDATE' and (
    new.organization_id is distinct from old.organization_id
    or new.salon_id is distinct from old.salon_id
    or new.customer_user_id is distinct from old.customer_user_id
    or new.look_id is distinct from old.look_id
    or new.service_id is distinct from old.service_id
    or new.staff_id is distinct from old.staff_id
  ) then
    raise exception 'Booking request ownership and context cannot be changed.';
  end if;

  if tg_op = 'INSERT' and new.status <> 'requested' then
    raise exception 'Customer booking requests must start as requested.';
  end if;

  if not exists (
    select 1
    from public.locations locations
    where locations.id = new.salon_id
      and locations.organization_id = new.organization_id
      and locations.status = 'active'
  ) then
    raise exception 'Booking request salon must be active and belong to the organization.';
  end if;

  if new.look_id is not null and not exists (
    select 1
    from public.salon_profile_looks looks
    where looks.id = new.look_id
      and looks.organization_id = new.organization_id
      and looks.salon_id = new.salon_id
      and looks.status = 'published'
  ) then
    raise exception 'Booking request look must be published for this salon.';
  end if;

  if new.service_id is not null and not exists (
    select 1
    from public.services services
    where services.id = new.service_id
      and services.organization_id = new.organization_id
      and services.salon_id = new.salon_id
      and services.is_active = true
  ) then
    raise exception 'Booking request service must be active for this salon.';
  end if;

  if (tg_op = 'INSERT' or new.staff_id is distinct from old.staff_id)
    and new.staff_id is not null
    and not exists (
      select 1
      from public.staff staff
      where staff.id = new.staff_id
        and staff.organization_id = new.organization_id
        and staff.salon_id = new.salon_id
        and public.staff_has_effective_public_profile(staff)
        and staff.online_booking_enabled = true
    )
  then
    raise exception 'Booking request staff must be publicly bookable for this salon.';
  end if;

  if new.requested_start_at is not null and new.requested_start_at <= now() then
    raise exception 'Requested booking time must be in the future.';
  end if;

  return new;
end;
$$;

revoke all on function public.get_public_salon_profile_staff(uuid) from public;
grant execute on function public.get_public_salon_profile_staff(uuid) to anon, authenticated;

revoke all on function public.get_public_salon_profile_looks(uuid) from public;
grant execute on function public.get_public_salon_profile_looks(uuid) to anon, authenticated;

revoke all on function public.get_public_salon_profile_updates(uuid) from public;
grant execute on function public.get_public_salon_profile_updates(uuid) to anon, authenticated;
