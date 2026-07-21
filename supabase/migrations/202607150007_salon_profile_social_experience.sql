alter table public.salon_profile_looks
add column if not exists caption text;

alter table public.salon_profile_updates
add column if not exists caption text;

alter table public.salon_profile_updates
add column if not exists media_path text;

comment on column public.salon_profile_looks.caption is
  'Customer-facing social caption for a salon look post.';

comment on column public.salon_profile_updates.caption is
  'Customer-facing social caption for a salon update post.';

comment on column public.salon_profile_updates.media_path is
  'Optional Storage path for an image attached to a salon update post.';

create table if not exists public.salon_profile_comments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  salon_id uuid not null references public.locations(id) on delete cascade,
  look_id uuid references public.salon_profile_looks(id) on delete cascade,
  update_id uuid references public.salon_profile_updates(id) on delete cascade,
  parent_comment_id uuid references public.salon_profile_comments(id) on delete cascade,
  author_user_id uuid references public.users(id) on delete set null,
  body text not null,
  is_salon_reply boolean not null default false,
  status text not null default 'visible',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint salon_profile_comments_one_target_check check (
    ((look_id is not null)::integer + (update_id is not null)::integer) = 1
  ),
  constraint salon_profile_comments_body_not_blank check (length(btrim(body)) > 0),
  constraint salon_profile_comments_status_check check (
    status in ('visible', 'hidden', 'deleted')
  )
);

create index if not exists salon_profile_comments_salon_created_idx
on public.salon_profile_comments(salon_id, created_at desc);

create index if not exists salon_profile_comments_look_created_idx
on public.salon_profile_comments(look_id, created_at asc)
where look_id is not null;

create index if not exists salon_profile_comments_update_created_idx
on public.salon_profile_comments(update_id, created_at asc)
where update_id is not null;

create index if not exists salon_profile_comments_parent_created_idx
on public.salon_profile_comments(parent_comment_id, created_at asc)
where parent_comment_id is not null;

create index if not exists salon_profile_comments_author_idx
on public.salon_profile_comments(author_user_id, created_at desc);

drop trigger if exists update_salon_profile_comments_updated_at
on public.salon_profile_comments;

create trigger update_salon_profile_comments_updated_at
before update on public.salon_profile_comments
for each row
execute function public.update_updated_at_column();

create or replace function public.validate_salon_profile_comment_scope()
returns trigger
language plpgsql
as $$
declare
  parent_row public.salon_profile_comments%rowtype;
  target_organization_id uuid;
  target_salon_id uuid;
begin
  if tg_op = 'UPDATE' and (
    new.organization_id is distinct from old.organization_id
    or new.salon_id is distinct from old.salon_id
    or new.look_id is distinct from old.look_id
    or new.update_id is distinct from old.update_id
    or new.parent_comment_id is distinct from old.parent_comment_id
    or new.author_user_id is distinct from old.author_user_id
    or new.is_salon_reply is distinct from old.is_salon_reply
  ) then
    raise exception 'Salon profile comment ownership and target cannot be changed.';
  end if;

  if new.look_id is not null then
    select looks.organization_id, looks.salon_id
    into target_organization_id, target_salon_id
    from public.salon_profile_looks looks
    where looks.id = new.look_id;
  else
    select updates.organization_id, updates.salon_id
    into target_organization_id, target_salon_id
    from public.salon_profile_updates updates
    where updates.id = new.update_id;
  end if;

  if target_organization_id is null or target_salon_id is null then
    raise exception 'Salon profile comment target does not exist.';
  end if;

  if new.organization_id is distinct from target_organization_id
    or new.salon_id is distinct from target_salon_id
  then
    raise exception 'Salon profile comment target must belong to the same salon.';
  end if;

  if new.parent_comment_id is not null then
    select *
    into parent_row
    from public.salon_profile_comments comments
    where comments.id = new.parent_comment_id;

    if parent_row.id is null then
      raise exception 'Parent comment does not exist.';
    end if;

    if parent_row.parent_comment_id is not null then
      raise exception 'Replies can only be one level deep.';
    end if;

    if parent_row.organization_id is distinct from new.organization_id
      or parent_row.salon_id is distinct from new.salon_id
      or parent_row.look_id is distinct from new.look_id
      or parent_row.update_id is distinct from new.update_id
    then
      raise exception 'Reply must target the same salon profile content.';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists validate_salon_profile_comment_scope
on public.salon_profile_comments;

create trigger validate_salon_profile_comment_scope
before insert or update on public.salon_profile_comments
for each row
execute function public.validate_salon_profile_comment_scope();

create table if not exists public.salon_profile_booking_requests (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  salon_id uuid not null references public.locations(id) on delete cascade,
  customer_user_id uuid not null references public.users(id) on delete cascade,
  look_id uuid references public.salon_profile_looks(id) on delete set null,
  service_id uuid references public.services(id) on delete set null,
  staff_id uuid references public.staff(id) on delete set null,
  requested_start_at timestamptz,
  private_note text,
  status text not null default 'requested',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint salon_profile_booking_requests_status_check check (
    status in ('requested', 'approved', 'declined', 'cancelled')
  )
);

create index if not exists salon_profile_booking_requests_salon_created_idx
on public.salon_profile_booking_requests(salon_id, created_at desc);

create index if not exists salon_profile_booking_requests_customer_idx
on public.salon_profile_booking_requests(customer_user_id, created_at desc);

create index if not exists salon_profile_booking_requests_status_idx
on public.salon_profile_booking_requests(salon_id, status, created_at desc);

drop trigger if exists update_salon_profile_booking_requests_updated_at
on public.salon_profile_booking_requests;

create trigger update_salon_profile_booking_requests_updated_at
before update on public.salon_profile_booking_requests
for each row
execute function public.update_updated_at_column();

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

  if new.staff_id is not null and not exists (
    select 1
    from public.staff staff
    where staff.id = new.staff_id
      and staff.organization_id = new.organization_id
      and staff.salon_id = new.salon_id
      and staff.is_active = true
  ) then
    raise exception 'Booking request staff must be active for this salon.';
  end if;

  if new.requested_start_at is not null and new.requested_start_at <= now() then
    raise exception 'Requested booking time must be in the future.';
  end if;

  return new;
end;
$$;

drop trigger if exists validate_salon_profile_booking_request_scope
on public.salon_profile_booking_requests;

create trigger validate_salon_profile_booking_request_scope
before insert or update on public.salon_profile_booking_requests
for each row
execute function public.validate_salon_profile_booking_request_scope();

alter table public.salon_profile_comments enable row level security;
alter table public.salon_profile_booking_requests enable row level security;

drop policy if exists "Public users can view visible salon profile comments"
on public.salon_profile_comments;
create policy "Public users can view visible salon profile comments"
on public.salon_profile_comments
for select
to anon, authenticated
using (
  status = 'visible'
  and public.salon_profile_public_salon_exists(salon_id)
  and (
    (
      look_id is not null
      and exists (
        select 1
        from public.salon_profile_looks looks
        where looks.id = salon_profile_comments.look_id
          and looks.organization_id = salon_profile_comments.organization_id
          and looks.salon_id = salon_profile_comments.salon_id
          and looks.status = 'published'
      )
    )
    or (
      update_id is not null
      and exists (
        select 1
        from public.salon_profile_updates updates
        where updates.id = salon_profile_comments.update_id
          and updates.organization_id = salon_profile_comments.organization_id
          and updates.salon_id = salon_profile_comments.salon_id
          and updates.status = 'published'
      )
    )
  )
);

drop policy if exists "Authenticated users can create salon profile comments"
on public.salon_profile_comments;
create policy "Authenticated users can create salon profile comments"
on public.salon_profile_comments
for insert
to authenticated
with check (
  author_user_id = public.current_public_user_id()
  and status = 'visible'
  and public.salon_profile_public_salon_exists(salon_id)
  and (
    is_salon_reply = false
    or public.user_has_organization_permission(
      organization_id,
      array['salon_profile.manage', 'salon_profile.content.manage']::text[]
    )
  )
  and (
    (
      look_id is not null
      and exists (
        select 1
        from public.salon_profile_looks looks
        where looks.id = salon_profile_comments.look_id
          and looks.organization_id = salon_profile_comments.organization_id
          and looks.salon_id = salon_profile_comments.salon_id
          and looks.status = 'published'
      )
    )
    or (
      update_id is not null
      and exists (
        select 1
        from public.salon_profile_updates updates
        where updates.id = salon_profile_comments.update_id
          and updates.organization_id = salon_profile_comments.organization_id
          and updates.salon_id = salon_profile_comments.salon_id
          and updates.status = 'published'
      )
    )
  )
);

drop policy if exists "Users can update their own salon profile comments"
on public.salon_profile_comments;
create policy "Users can update their own salon profile comments"
on public.salon_profile_comments
for update
to authenticated
using (
  author_user_id = public.current_public_user_id()
  and is_salon_reply = false
  and status = 'visible'
)
with check (
  author_user_id = public.current_public_user_id()
  and is_salon_reply = false
  and status in ('visible', 'deleted')
);

drop policy if exists "Salon profile managers can moderate comments"
on public.salon_profile_comments;
create policy "Salon profile managers can moderate comments"
on public.salon_profile_comments
for update
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

drop policy if exists "Booking request participants can view requests"
on public.salon_profile_booking_requests;
create policy "Booking request participants can view requests"
on public.salon_profile_booking_requests
for select
to authenticated
using (
  customer_user_id = public.current_public_user_id()
  or public.user_has_organization_permission(
    organization_id,
    array['booking.view', 'booking.manage', 'salon_profile.manage']::text[]
  )
);

drop policy if exists "Authenticated customers can create public booking requests"
on public.salon_profile_booking_requests;
create policy "Authenticated customers can create public booking requests"
on public.salon_profile_booking_requests
for insert
to authenticated
with check (
  customer_user_id = public.current_public_user_id()
  and status = 'requested'
  and public.salon_profile_public_salon_exists(salon_id)
);

drop policy if exists "Booking managers can update public booking requests"
on public.salon_profile_booking_requests;
create policy "Booking managers can update public booking requests"
on public.salon_profile_booking_requests
for update
to authenticated
using (
  public.user_has_organization_permission(
    organization_id,
    array['booking.manage']::text[]
  )
)
with check (
  public.user_has_organization_permission(
    organization_id,
    array['booking.manage']::text[]
  )
);

grant select on public.salon_profile_comments to anon, authenticated;
grant insert, update on public.salon_profile_comments to authenticated;

grant select, insert, update on public.salon_profile_booking_requests to authenticated;

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
    staff.id as recommended_staff_id,
    staff.display_name as recommended_staff_name,
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
    staff.id as staff_id,
    staff.display_name as staff_name,
    updates.published_at,
    (
      select count(*)::bigint
      from public.salon_profile_comments comments
      where comments.update_id = updates.id
        and comments.status = 'visible'
    ) as comment_count
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
  limit 24;
$$;

drop function if exists public.get_public_salon_profile_comments(uuid);
create function public.get_public_salon_profile_comments(target_salon_id uuid)
returns table (
  id uuid,
  salon_id uuid,
  look_id uuid,
  update_id uuid,
  parent_comment_id uuid,
  author_user_id uuid,
  author_display_name text,
  body text,
  is_salon_reply boolean,
  created_at timestamptz,
  updated_at timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select
    comments.id,
    comments.salon_id,
    comments.look_id,
    comments.update_id,
    comments.parent_comment_id,
    comments.author_user_id,
    case
      when comments.is_salon_reply then coalesce(
        nullif(btrim(settings.business_name), ''),
        locations.name,
        'Salon'
      )
      else coalesce(nullif(btrim(users.display_name), ''), 'KingPOS customer')
    end as author_display_name,
    comments.body,
    comments.is_salon_reply,
    comments.created_at,
    comments.updated_at
  from public.salon_profile_comments comments
  join public.locations locations
    on locations.id = comments.salon_id
  left join public.salon_settings settings
    on settings.salon_id = locations.id
    and settings.organization_id = locations.organization_id
  left join public.users users
    on users.id = comments.author_user_id
  where comments.salon_id = target_salon_id
    and comments.status = 'visible'
    and public.salon_profile_public_salon_exists(target_salon_id)
    and (
      (
        comments.look_id is not null
        and exists (
          select 1
          from public.salon_profile_looks looks
          where looks.id = comments.look_id
            and looks.salon_id = target_salon_id
            and looks.status = 'published'
        )
      )
      or (
        comments.update_id is not null
        and exists (
          select 1
          from public.salon_profile_updates updates
          where updates.id = comments.update_id
            and updates.salon_id = target_salon_id
            and updates.status = 'published'
        )
      )
    )
  order by comments.created_at asc;
$$;

revoke all on function public.get_public_salon_profile_looks(uuid) from public;
grant execute on function public.get_public_salon_profile_looks(uuid) to anon, authenticated;

revoke all on function public.get_public_salon_profile_updates(uuid) from public;
grant execute on function public.get_public_salon_profile_updates(uuid) to anon, authenticated;

revoke all on function public.get_public_salon_profile_comments(uuid) from public;
grant execute on function public.get_public_salon_profile_comments(uuid) to anon, authenticated;
