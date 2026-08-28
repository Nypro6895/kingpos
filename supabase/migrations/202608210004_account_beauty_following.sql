create table if not exists public.beauty_profile_follows (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.beauty_profiles(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (profile_id, user_id)
);

create index if not exists beauty_profile_follows_user_created_idx
on public.beauty_profile_follows(user_id, created_at desc);

create index if not exists beauty_profile_follows_profile_idx
on public.beauty_profile_follows(profile_id, created_at desc);

alter table public.beauty_profile_follows enable row level security;

drop policy if exists "beauty_profile_follows_owner_read" on public.beauty_profile_follows;
drop policy if exists "beauty_profile_follows_owner_write" on public.beauty_profile_follows;

create policy "beauty_profile_follows_owner_read" on public.beauty_profile_follows
for select to authenticated
using (user_id = public.current_public_user_id());

create policy "beauty_profile_follows_owner_write" on public.beauty_profile_follows
for all to authenticated
using (user_id = public.current_public_user_id())
with check (user_id = public.current_public_user_id());

create or replace function public.toggle_account_beauty_profile_follow(p_profile_id uuid)
returns boolean
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  actor_user_id uuid := public.current_public_user_id();
  deleted_follow_id uuid;
  target_profile record;
begin
  if actor_user_id is null then
    raise exception 'Sign in to follow Beauty profiles.';
  end if;

  if p_profile_id is null then
    raise exception 'Beauty profile is required.';
  end if;

  select
    profiles.id,
    profiles.user_id
  into target_profile
  from public.beauty_profiles profiles
  join public.users users on users.id = profiles.user_id
  where profiles.id = p_profile_id
    and profiles.visibility = 'public'
    and users.status = 'active'
  limit 1;

  if target_profile.id is null then
    raise exception 'That Beauty profile is not available.';
  end if;

  if target_profile.user_id = actor_user_id then
    raise exception 'You cannot follow your own Beauty profile.';
  end if;

  delete from public.beauty_profile_follows follows
  where follows.profile_id = p_profile_id
    and follows.user_id = actor_user_id
  returning follows.id into deleted_follow_id;

  if deleted_follow_id is not null then
    return false;
  end if;

  insert into public.beauty_profile_follows (profile_id, user_id)
  values (p_profile_id, actor_user_id)
  on conflict (profile_id, user_id) do nothing;

  return true;
end;
$$;

create or replace function public.list_account_following(
  p_filter text default 'all',
  p_query text default null,
  p_limit integer default 10,
  p_offset integer default 0
)
returns table (
  follow_id uuid,
  target_type text,
  target_id uuid,
  display_name text,
  secondary_text text,
  image_path text,
  image_url text,
  href text,
  followed_at timestamptz,
  total_count bigint
)
language sql
stable
security definer
set search_path = public
as $$
  with actor as (
    select public.current_public_user_id() as user_id
  ),
  normalized as (
    select
      case lower(coalesce(p_filter, 'all'))
        when 'shop' then 'shop'
        when 'beauty' then 'beauty'
        else 'all'
      end as filter_value,
      nullif(
        lower(btrim(regexp_replace(coalesce(p_query, ''), '\s+', ' ', 'g'))),
        ''
      ) as query_value,
      least(100, greatest(coalesce(p_limit, 10), 1)) as limit_value,
      greatest(coalesce(p_offset, 0), 0) as offset_value
  ),
  shop_items as (
    select
      follows.id as item_follow_id,
      'shop'::text as item_target_type,
      salons.id as item_target_id,
      coalesce(nullif(btrim(settings.business_name), ''), salons.name) as item_display_name,
      nullif(
        btrim(
          concat_ws(
            ', ',
            coalesce(nullif(btrim(settings.city), ''), salons.city),
            coalesce(nullif(btrim(settings.state), ''), salons.state)
          )
        ),
        ''
      ) as item_secondary_text,
      settings.public_profile_logo_path as item_image_path,
      null::text as item_image_url,
      '/explore/salons/' || salons.id::text as item_href,
      follows.created_at as item_followed_at
    from public.salon_profile_follows follows
    join public.locations salons on salons.id = follows.salon_id
    left join public.salon_settings settings on settings.salon_id = salons.id
    where follows.user_id = (select user_id from actor)
  ),
  beauty_items as (
    select
      follows.id as item_follow_id,
      'beauty'::text as item_target_type,
      profiles.id as item_target_id,
      coalesce(
        nullif(btrim(users.display_name), ''),
        nullif(btrim(concat_ws(' ', users.first_name, users.last_name)), ''),
        'Reylumi customer'
      ) as item_display_name,
      profiles.bio as item_secondary_text,
      profiles.cover_media_path as item_image_path,
      users.avatar_url as item_image_url,
      '/explore/beauty/' || profiles.id::text as item_href,
      follows.created_at as item_followed_at
    from public.beauty_profile_follows follows
    join public.beauty_profiles profiles on profiles.id = follows.profile_id
    join public.users users on users.id = profiles.user_id
    where follows.user_id = (select user_id from actor)
      and profiles.visibility = 'public'
      and users.status = 'active'
  ),
  combined as (
    select * from shop_items
    union all
    select * from beauty_items
  ),
  filtered as (
    select combined.*
    from combined
    cross join normalized
    where (normalized.filter_value = 'all' or combined.item_target_type = normalized.filter_value)
      and (
        normalized.query_value is null
        or lower(
          coalesce(combined.item_display_name, '') || ' ' ||
          coalesce(combined.item_secondary_text, '')
        ) like '%' || normalized.query_value || '%'
      )
  )
  select
    filtered.item_follow_id,
    filtered.item_target_type,
    filtered.item_target_id,
    filtered.item_display_name,
    filtered.item_secondary_text,
    filtered.item_image_path,
    filtered.item_image_url,
    filtered.item_href,
    filtered.item_followed_at,
    count(*) over () as total_count
  from filtered
  order by filtered.item_followed_at desc, filtered.item_display_name asc
  offset (select offset_value from normalized)
  limit (select limit_value from normalized)
$$;

create or replace function public.get_public_beauty_profile(p_profile_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  actor_user_id uuid := public.current_public_user_id();
  profile_record record;
begin
  select
    profiles.id,
    profiles.user_id,
    profiles.bio,
    profiles.cover_media_path,
    profiles.visibility,
    profiles.created_at,
    profiles.updated_at,
    coalesce(
      nullif(btrim(users.display_name), ''),
      nullif(btrim(concat_ws(' ', users.first_name, users.last_name)), ''),
      'Reylumi customer'
    ) as display_name,
    users.avatar_url
  into profile_record
  from public.beauty_profiles profiles
  join public.users users on users.id = profiles.user_id
  where profiles.id = p_profile_id
    and profiles.visibility = 'public'
    and users.status = 'active';

  if profile_record.id is null then
    return jsonb_build_object('ok', false, 'code', 'not_found', 'state', 'forbidden');
  end if;

  return jsonb_build_object(
    'ok', true,
    'state', 'public',
    'profile', jsonb_build_object(
      'id', profile_record.id,
      'bio', profile_record.bio,
      'coverMediaPath', profile_record.cover_media_path,
      'visibility', profile_record.visibility,
      'createdAt', profile_record.created_at,
      'updatedAt', profile_record.updated_at,
      'displayName', profile_record.display_name,
      'avatarUrl', profile_record.avatar_url,
      'access', 'public',
      'followerCount', (
        select count(*)
        from public.beauty_profile_follows follows
        where follows.profile_id = profile_record.id
      ),
      'isFollowing', (
        actor_user_id is not null
        and exists (
          select 1
          from public.beauty_profile_follows follows
          where follows.profile_id = profile_record.id
            and follows.user_id = actor_user_id
        )
      ),
      'isSelf', actor_user_id is not null and profile_record.user_id = actor_user_id
    )
  );
end;
$$;

grant select, insert, delete on table public.beauty_profile_follows to authenticated;

revoke all on function public.toggle_account_beauty_profile_follow(uuid) from public;
grant execute on function public.toggle_account_beauty_profile_follow(uuid) to authenticated;

revoke all on function public.list_account_following(text, text, integer, integer) from public;
grant execute on function public.list_account_following(text, text, integer, integer) to authenticated;

revoke all on function public.get_public_beauty_profile(uuid) from public;
grant execute on function public.get_public_beauty_profile(uuid) to anon, authenticated;
