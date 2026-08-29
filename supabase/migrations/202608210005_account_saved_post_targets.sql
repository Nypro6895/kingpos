create table if not exists public.account_post_saves (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  source_type text not null,
  source_id uuid not null,
  created_at timestamptz not null default now(),
  constraint account_post_saves_source_type_check check (
    source_type in ('beauty_post', 'salon_profile_update')
  ),
  unique (user_id, source_type, source_id)
);

create index if not exists account_post_saves_user_created_idx
on public.account_post_saves(user_id, created_at desc);

alter table public.account_post_saves enable row level security;

drop policy if exists "account_post_saves_owner_read" on public.account_post_saves;
create policy "account_post_saves_owner_read" on public.account_post_saves
for select to authenticated
using (user_id = public.current_public_user_id());

drop policy if exists "account_post_saves_owner_write" on public.account_post_saves;
create policy "account_post_saves_owner_write" on public.account_post_saves
for all to authenticated
using (user_id = public.current_public_user_id())
with check (user_id = public.current_public_user_id());

create or replace function public.prepare_account_post_save()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.user_id is distinct from public.current_public_user_id() then
    raise exception 'Saved post user must be the current user.';
  end if;

  if new.source_type = 'beauty_post' then
    perform 1
    from public.beauty_posts posts
    join public.beauty_profiles profiles on profiles.id = posts.profile_id
    where posts.id = new.source_id
      and posts.deleted_at is null
      and posts.visibility = 'public'
      and posts.moderation_status = 'visible'
      and (
        profiles.visibility = 'public'
        or posts.author_user_id = public.current_public_user_id()
      )
      and exists (
        select 1
        from public.beauty_post_media media
        where media.post_id = posts.id
      );

    if not found then
      raise exception 'Public Beauty post was not found.';
    end if;

    return new;
  end if;

  if new.source_type = 'salon_profile_update' then
    perform 1
    from public.salon_profile_updates updates
    where updates.id = new.source_id
      and updates.status = 'published'
      and updates.media_path is not null
      and public.salon_profile_public_salon_exists(updates.salon_id);

    if not found then
      raise exception 'Published salon update was not found.';
    end if;

    return new;
  end if;

  raise exception 'Unsupported saved post type.';
end;
$$;

drop trigger if exists prepare_account_post_save on public.account_post_saves;
create trigger prepare_account_post_save
before insert or update on public.account_post_saves
for each row execute function public.prepare_account_post_save();

drop function if exists public.list_account_saved_posts(integer);
drop function if exists public.list_account_saved_posts(integer, integer, text, text);

create or replace function public.list_account_saved_posts(
  p_limit integer default 100,
  p_offset integer default 0,
  p_query text default null,
  p_filter text default 'all'
)
returns table (
  saved_id uuid,
  source_type text,
  source_id uuid,
  look_id uuid,
  post_id uuid,
  profile_id uuid,
  salon_id uuid,
  salon_name text,
  author_name text,
  title text,
  caption text,
  media_path text,
  media_bucket text,
  published_at timestamptz,
  saved_at timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  with normalized as (
    select
      least(greatest(coalesce(p_limit, 100), 1), 100) as page_size,
      greatest(coalesce(p_offset, 0), 0) as page_offset,
      nullif(btrim(coalesce(p_query, '')), '') as query_text,
      case
        when p_filter in (
          'beauty_post',
          'salon_profile_look',
          'salon_profile_update'
        ) then p_filter
        else 'all'
      end as source_filter
  ),
  saved_rows as (
    select
      saves.id as saved_id,
      'salon_profile_look'::text as source_type,
      looks.id as source_id,
      looks.id as look_id,
      null::uuid as post_id,
      null::uuid as profile_id,
      looks.salon_id,
      salons.name as salon_name,
      coalesce(nullif(btrim(looks.author_display_name), ''), salons.name) as author_name,
      looks.title,
      looks.caption,
      looks.media_path,
      'salon-profile-media'::text as media_bucket,
      looks.published_at,
      saves.created_at as saved_at
    from public.salon_profile_look_saves saves
    join public.salon_profile_looks looks on looks.id = saves.look_id
    join public.locations salons on salons.id = looks.salon_id
    where saves.user_id = public.current_public_user_id()
      and looks.status = 'published'
      and looks.media_path is not null

    union all

    select
      saves.id as saved_id,
      'salon_profile_update'::text as source_type,
      updates.id as source_id,
      null::uuid as look_id,
      null::uuid as post_id,
      null::uuid as profile_id,
      updates.salon_id,
      salons.name as salon_name,
      coalesce(
        nullif(btrim(updates.author_display_name), ''),
        nullif(btrim(staff.display_name), ''),
        salons.name
      ) as author_name,
      updates.title,
      updates.caption,
      updates.media_path,
      'salon-profile-media'::text as media_bucket,
      updates.published_at,
      saves.created_at as saved_at
    from public.account_post_saves saves
    join public.salon_profile_updates updates on updates.id = saves.source_id
    join public.locations salons on salons.id = updates.salon_id
    left join public.staff staff on staff.id = updates.staff_id
    where saves.user_id = public.current_public_user_id()
      and saves.source_type = 'salon_profile_update'
      and updates.status = 'published'
      and updates.media_path is not null
      and public.salon_profile_public_salon_exists(updates.salon_id)

    union all

    select
      saves.id as saved_id,
      'beauty_post'::text as source_type,
      posts.id as source_id,
      null::uuid as look_id,
      posts.id as post_id,
      profiles.id as profile_id,
      attributions.salon_id,
      coalesce(nullif(btrim(settings.business_name), ''), salons.name) as salon_name,
      coalesce(
        nullif(btrim(users.display_name), ''),
        nullif(btrim(concat_ws(' ', users.first_name, users.last_name)), ''),
        'Reylumi customer'
      ) as author_name,
      case
        when posts.post_type = 'before_after' then 'Before & After'
        else 'Beauty moment'
      end as title,
      posts.caption,
      media.object_path as media_path,
      'beauty-profile-media'::text as media_bucket,
      posts.created_at as published_at,
      saves.created_at as saved_at
    from public.account_post_saves saves
    join public.beauty_posts posts on posts.id = saves.source_id
    join public.beauty_profiles profiles on profiles.id = posts.profile_id
    join public.users users on users.id = posts.author_user_id
    left join public.beauty_post_attributions attributions on attributions.post_id = posts.id
    left join public.locations salons on salons.id = attributions.salon_id
    left join public.salon_settings settings on settings.salon_id = attributions.salon_id
    left join lateral (
      select post_media.object_path
      from public.beauty_post_media post_media
      where post_media.post_id = posts.id
      order by
        case post_media.role when 'after' then 0 when 'image' then 1 else 2 end,
        post_media.display_order,
        post_media.created_at,
        post_media.id
      limit 1
    ) media on true
    where saves.user_id = public.current_public_user_id()
      and saves.source_type = 'beauty_post'
      and posts.deleted_at is null
      and posts.visibility = 'public'
      and posts.moderation_status = 'visible'
      and (
        profiles.visibility = 'public'
        or posts.author_user_id = public.current_public_user_id()
      )
      and media.object_path is not null
  )
  select
    saved_rows.saved_id,
    saved_rows.source_type,
    saved_rows.source_id,
    saved_rows.look_id,
    saved_rows.post_id,
    saved_rows.profile_id,
    saved_rows.salon_id,
    saved_rows.salon_name,
    saved_rows.author_name,
    saved_rows.title,
    saved_rows.caption,
    saved_rows.media_path,
    saved_rows.media_bucket,
    saved_rows.published_at,
    saved_rows.saved_at
  from saved_rows, normalized
  where (
      normalized.source_filter = 'all'
      or saved_rows.source_type = normalized.source_filter
    )
    and (
      normalized.query_text is null
      or concat_ws(
        ' ',
        saved_rows.salon_name,
        saved_rows.author_name,
        saved_rows.title,
        saved_rows.caption
      ) ilike '%' || normalized.query_text || '%'
    )
  order by saved_rows.saved_at desc, saved_rows.saved_id desc
  limit (select page_size from normalized)
  offset (select page_offset from normalized)
$$;

revoke all on function public.list_account_saved_posts(integer, integer, text, text) from public;
grant execute on function public.list_account_saved_posts(integer, integer, text, text) to authenticated;

grant select, insert, update, delete
on public.account_post_saves
to authenticated;
