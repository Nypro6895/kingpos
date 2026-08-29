alter table public.salon_profile_comments
  add column if not exists beauty_post_id uuid references public.beauty_posts(id) on delete cascade,
  add column if not exists edited_at timestamptz;

alter table public.salon_profile_comments
  alter column salon_id drop not null;

update public.salon_profile_comments comments
set author_display_name = coalesce(
  nullif(btrim(users.display_name), ''),
  nullif(btrim(concat_ws(' ', users.first_name, users.last_name)), ''),
  comments.author_display_name
)
from public.users users
where comments.author_user_id = users.id
  and nullif(btrim(coalesce(comments.author_display_name, '')), '') is null;

alter table public.salon_profile_comments
  drop constraint if exists salon_profile_comments_status_check;

alter table public.salon_profile_comments
  add constraint salon_profile_comments_status_check
  check (status in ('published', 'visible', 'hidden', 'deleted', 'reported'));

alter table public.salon_profile_comments
  drop constraint if exists salon_profile_comments_one_target_check;

alter table public.salon_profile_comments
  add constraint salon_profile_comments_one_target_check
  check (
    (look_id is not null)::integer +
    (update_id is not null)::integer +
    (beauty_post_id is not null)::integer = 1
  );

alter table public.salon_profile_comments
  drop constraint if exists salon_profile_comments_profile_targets_have_salon_check;

alter table public.salon_profile_comments
  add constraint salon_profile_comments_profile_targets_have_salon_check
  check ((look_id is null and update_id is null) or salon_id is not null);

create index if not exists salon_profile_comments_look_thread_idx
on public.salon_profile_comments(look_id, parent_comment_id, created_at desc, id desc)
where look_id is not null and status in ('published', 'visible');

create index if not exists salon_profile_comments_update_thread_idx
on public.salon_profile_comments(update_id, parent_comment_id, created_at desc, id desc)
where update_id is not null and status in ('published', 'visible');

create index if not exists salon_profile_comments_beauty_thread_idx
on public.salon_profile_comments(beauty_post_id, parent_comment_id, created_at desc, id desc)
where beauty_post_id is not null and status in ('published', 'visible');

create index if not exists salon_profile_comments_author_idx
on public.salon_profile_comments(author_user_id, created_at desc)
where author_user_id is not null;

create index if not exists salon_profile_comments_parent_visible_idx
on public.salon_profile_comments(parent_comment_id, created_at asc, id asc)
where parent_comment_id is not null and status in ('published', 'visible');

do $$
begin
  if not exists (
    select 1
    from pg_indexes
    where schemaname = 'public'
      and tablename = 'app_notifications'
      and indexdef ilike '%unique%'
      and indexdef ilike '%recipient_user_id%'
      and indexdef ilike '%event_key%'
  ) then
    create unique index app_notifications_recipient_event_key_idx
    on public.app_notifications(recipient_user_id, event_key)
    where event_key is not null;
  end if;
end;
$$;

create or replace function public.post_comment_target_is_public(
  p_look_id uuid,
  p_update_id uuid,
  p_beauty_post_id uuid,
  p_salon_id uuid default null
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select case
    when p_look_id is not null then exists (
      select 1
      from public.salon_profile_looks looks
      where looks.id = p_look_id
        and (p_salon_id is null or looks.salon_id = p_salon_id)
        and looks.status = 'published'
        and public.salon_profile_public_salon_exists(looks.salon_id)
    )
    when p_update_id is not null then exists (
      select 1
      from public.salon_profile_updates updates
      where updates.id = p_update_id
        and (p_salon_id is null or updates.salon_id = p_salon_id)
        and updates.status = 'published'
        and public.salon_profile_public_salon_exists(updates.salon_id)
    )
    when p_beauty_post_id is not null then public.beauty_public_post_exists(p_beauty_post_id)
    else false
  end
$$;

create or replace function public.validate_unified_post_comment()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  parent_row public.salon_profile_comments%rowtype;
  target_salon_id uuid;
  target_changed boolean := true;
begin
  new.body := nullif(btrim(coalesce(new.body, '')), '');

  if new.body is null then
    raise exception 'Write a comment before posting.';
  end if;

  if length(new.body) > 1000 then
    raise exception 'Keep comments under 1000 characters.';
  end if;

  if new.status not in ('published', 'visible', 'hidden', 'deleted', 'reported') then
    raise exception 'Comment status is not valid.';
  end if;

  if tg_op = 'UPDATE' then
    target_changed :=
      new.look_id is distinct from old.look_id
      or new.update_id is distinct from old.update_id
      or new.beauty_post_id is distinct from old.beauty_post_id;

    if target_changed then
      raise exception 'Comment target cannot be changed.';
    end if;

    if new.author_user_id is distinct from old.author_user_id then
      raise exception 'Comment author cannot be changed.';
    end if;

    if new.parent_comment_id is distinct from old.parent_comment_id then
      raise exception 'Comment parent cannot be changed.';
    end if;

    if new.is_salon_reply is distinct from old.is_salon_reply then
      raise exception 'Comment reply identity cannot be changed.';
    end if;
  end if;

  if num_nonnulls(new.look_id, new.update_id, new.beauty_post_id) <> 1 then
    raise exception 'Choose one post to comment on.';
  end if;

  if tg_op = 'INSERT' then
    if new.look_id is not null then
      select looks.salon_id
      into target_salon_id
      from public.salon_profile_looks looks
      where looks.id = new.look_id
        and looks.status = 'published'
        and public.salon_profile_public_salon_exists(looks.salon_id)
      limit 1;

      if target_salon_id is null then
        raise exception 'That post is not available for public comments.';
      end if;

      new.salon_id := target_salon_id;
    elsif new.update_id is not null then
      select updates.salon_id
      into target_salon_id
      from public.salon_profile_updates updates
      where updates.id = new.update_id
        and updates.status = 'published'
        and public.salon_profile_public_salon_exists(updates.salon_id)
      limit 1;

      if target_salon_id is null then
        raise exception 'That post is not available for public comments.';
      end if;

      new.salon_id := target_salon_id;
    else
      if not public.beauty_public_post_exists(new.beauty_post_id) then
        raise exception 'That Beauty post is not available for public comments.';
      end if;

      select attributions.salon_id
      into target_salon_id
      from public.beauty_post_attributions attributions
      where attributions.post_id = new.beauty_post_id
      order by attributions.created_at desc
      limit 1;

      new.salon_id := target_salon_id;
    end if;
  end if;

  if new.parent_comment_id is not null then
    select *
    into parent_row
    from public.salon_profile_comments parent
    where parent.id = new.parent_comment_id
      and parent.status in ('published', 'visible')
    limit 1;

    if parent_row.id is null then
      raise exception 'Reply target is not available.';
    end if;

    if parent_row.parent_comment_id is not null then
      raise exception 'Replies can only be one level deep.';
    end if;

    if parent_row.look_id is distinct from new.look_id
      or parent_row.update_id is distinct from new.update_id
      or parent_row.beauty_post_id is distinct from new.beauty_post_id
    then
      raise exception 'Reply target does not belong to this post.';
    end if;
  end if;

  if new.is_salon_reply = true
    and (
      new.salon_id is null
      or not public.user_has_salon_permission(
        new.salon_id,
        array['salon_profile.manage', 'salon_profile.content.manage']::text[]
      )
    )
  then
    raise exception 'You do not have permission to reply as this salon.';
  end if;

  if nullif(btrim(coalesce(new.author_display_name, '')), '') is null
    and new.author_user_id is not null
  then
    select coalesce(
      nullif(btrim(users.display_name), ''),
      nullif(btrim(concat_ws(' ', users.first_name, users.last_name)), ''),
      'Reylumi customer'
    )
    into new.author_display_name
    from public.users users
    where users.id = new.author_user_id
    limit 1;
  end if;

  if tg_op = 'UPDATE' and new.body is distinct from old.body then
    new.edited_at := now();
  end if;

  return new;
end;
$$;

drop trigger if exists validate_unified_post_comment_trigger
on public.salon_profile_comments;

create trigger validate_unified_post_comment_trigger
before insert or update on public.salon_profile_comments
for each row execute function public.validate_unified_post_comment();

create or replace function public.count_public_post_comments(
  p_target_type text,
  p_target_id uuid
)
returns bigint
language sql
stable
security definer
set search_path = public
as $$
  with target_comments as (
    select comments.id, comments.parent_comment_id
    from public.salon_profile_comments comments
    where comments.status in ('published', 'visible')
      and (
        (
          p_target_type = 'salon_profile_look'
          and comments.look_id = p_target_id
          and public.post_comment_target_is_public(comments.look_id, null, null, comments.salon_id)
        )
        or (
          p_target_type = 'salon_profile_update'
          and comments.update_id = p_target_id
          and public.post_comment_target_is_public(null, comments.update_id, null, comments.salon_id)
        )
        or (
          p_target_type = 'beauty_post'
          and comments.beauty_post_id = p_target_id
          and public.post_comment_target_is_public(null, null, comments.beauty_post_id, comments.salon_id)
        )
      )
  ),
  visible_roots as (
    select target_comments.id
    from target_comments
    where target_comments.parent_comment_id is null
  )
  select count(*)::bigint
  from target_comments
  where target_comments.parent_comment_id is null
    or exists (
      select 1
      from visible_roots roots
      where roots.id = target_comments.parent_comment_id
    )
$$;

create or replace function public.get_public_post_comments(
  p_target_type text,
  p_target_id uuid,
  p_offset integer default 0,
  p_limit integer default 12
)
returns table (
  id uuid,
  salon_id uuid,
  look_id uuid,
  update_id uuid,
  beauty_post_id uuid,
  parent_comment_id uuid,
  author_user_id uuid,
  author_display_name text,
  body text,
  is_salon_reply boolean,
  created_at timestamptz,
  updated_at timestamptz,
  edited_at timestamptz,
  total_count bigint,
  root_count bigint
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  clean_offset integer := greatest(0, coalesce(p_offset, 0));
  clean_limit integer := greatest(1, least(coalesce(p_limit, 12), 24));
begin
  return query
  with target_comments as (
    select comments.*
    from public.salon_profile_comments comments
    where comments.status in ('published', 'visible')
      and (
        (
          p_target_type = 'salon_profile_look'
          and comments.look_id = p_target_id
          and public.post_comment_target_is_public(comments.look_id, null, null, comments.salon_id)
        )
        or (
          p_target_type = 'salon_profile_update'
          and comments.update_id = p_target_id
          and public.post_comment_target_is_public(null, comments.update_id, null, comments.salon_id)
        )
        or (
          p_target_type = 'beauty_post'
          and comments.beauty_post_id = p_target_id
          and public.post_comment_target_is_public(null, null, comments.beauty_post_id, comments.salon_id)
        )
      )
  ),
  visible_roots as (
    select target_comments.*
    from target_comments
    where target_comments.parent_comment_id is null
  ),
  paged_roots as (
    select visible_roots.*
    from visible_roots
    order by visible_roots.created_at desc, visible_roots.id desc
    offset clean_offset
    limit clean_limit
  ),
  result_rows as (
    select
      paged_roots.*,
      paged_roots.created_at as root_created_at,
      paged_roots.id as root_id,
      0 as depth
    from paged_roots

    union all

    select
      replies.*,
      paged_roots.created_at as root_created_at,
      paged_roots.id as root_id,
      1 as depth
    from target_comments replies
    join paged_roots on paged_roots.id = replies.parent_comment_id
  ),
  totals as (
    select
      (
        select count(*)::bigint
        from target_comments counted_comments
        where counted_comments.parent_comment_id is null
          or exists (
            select 1
            from visible_roots roots
            where roots.id = counted_comments.parent_comment_id
          )
      ) as total_count,
      (select count(*)::bigint from visible_roots) as root_count
  )
  select
    result_rows.id,
    result_rows.salon_id,
    result_rows.look_id,
    result_rows.update_id,
    result_rows.beauty_post_id,
    result_rows.parent_comment_id,
    result_rows.author_user_id,
    coalesce(nullif(btrim(result_rows.author_display_name), ''), 'Reylumi customer') as author_display_name,
    result_rows.body,
    result_rows.is_salon_reply,
    result_rows.created_at,
    result_rows.updated_at,
    result_rows.edited_at,
    totals.total_count,
    totals.root_count
  from result_rows
  cross join totals
  order by
    result_rows.root_created_at desc,
    result_rows.root_id desc,
    result_rows.depth asc,
    result_rows.created_at asc,
    result_rows.id asc;
end;
$$;

drop function if exists public.get_public_salon_profile_comments(uuid);

create or replace function public.get_public_salon_profile_comments(target_salon_id uuid)
returns table (
  id uuid,
  salon_id uuid,
  look_id uuid,
  update_id uuid,
  beauty_post_id uuid,
  parent_comment_id uuid,
  author_user_id uuid,
  author_display_name text,
  body text,
  is_salon_reply boolean,
  created_at timestamptz,
  updated_at timestamptz,
  edited_at timestamptz
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
    comments.beauty_post_id,
    comments.parent_comment_id,
    comments.author_user_id,
    coalesce(nullif(btrim(comments.author_display_name), ''), 'Reylumi customer') as author_display_name,
    comments.body,
    comments.is_salon_reply,
    comments.created_at,
    comments.updated_at,
    comments.edited_at
  from public.salon_profile_comments comments
  where comments.salon_id = target_salon_id
    and comments.status in ('visible', 'published')
    and (
      public.post_comment_target_is_public(comments.look_id, comments.update_id, null, target_salon_id)
      or public.post_comment_target_is_public(null, null, comments.beauty_post_id, target_salon_id)
    )
  order by comments.created_at asc, comments.id asc
$$;

create or replace function public.get_public_salon_profile_looks(target_salon_id uuid)
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
  published_at timestamptz,
  author_user_id uuid,
  author_display_name text,
  author_avatar_path text,
  author_staff_id uuid,
  recommended_staff_id uuid,
  recommended_staff_name text,
  service_id uuid,
  service_name text,
  save_count bigint,
  comment_count bigint,
  is_saved boolean,
  hashtags text[]
)
language sql
stable
security definer
set search_path = public
as $$
  select
    looks.id,
    looks.title,
    looks.caption,
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
    looks.published_at,
    looks.author_user_id,
    looks.author_display_name,
    looks.author_avatar_path,
    looks.author_staff_id,
    looks.recommended_staff_id,
    recommended_staff.display_name,
    looks.service_id,
    services.name,
    (
      select count(*)
      from public.salon_profile_look_saves saves
      where saves.look_id = looks.id
    ),
    public.count_public_post_comments('salon_profile_look', looks.id),
    false,
    '{}'::text[]
  from public.salon_profile_looks looks
  left join public.staff recommended_staff on recommended_staff.id = looks.recommended_staff_id
  left join public.services services on services.id = looks.service_id
  where looks.salon_id = target_salon_id
    and looks.status = 'published'
    and public.salon_profile_public_salon_exists(target_salon_id)
  order by looks.is_pinned desc, looks.published_at desc nulls last
$$;

create or replace function public.get_public_salon_profile_updates(target_salon_id uuid)
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
  published_at timestamptz,
  author_user_id uuid,
  author_display_name text,
  author_avatar_path text,
  author_staff_id uuid,
  service_id uuid,
  service_name text,
  staff_id uuid,
  staff_name text,
  comment_count bigint,
  hashtags text[]
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
    updates.caption,
    updates.summary,
    updates.media_path,
    updates.starts_at,
    updates.ends_at,
    updates.cta_label,
    updates.published_at,
    updates.author_user_id,
    updates.author_display_name,
    updates.author_avatar_path,
    updates.author_staff_id,
    updates.service_id,
    services.name,
    updates.staff_id,
    staff.display_name,
    public.count_public_post_comments('salon_profile_update', updates.id),
    '{}'::text[]
  from public.salon_profile_updates updates
  left join public.services services on services.id = updates.service_id
  left join public.staff staff on staff.id = updates.staff_id
  where updates.salon_id = target_salon_id
    and updates.status = 'published'
    and public.salon_profile_public_salon_exists(target_salon_id)
  order by updates.published_at desc nulls last
$$;

create or replace function public.notify_post_comment_created(target_comment_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  comment_row record;
  actor_name text;
  target_account_id uuid;
  target_author_user_id uuid;
  target_href text;
  target_kind text;
  target_label text;
  target_salon_id uuid;
  target_staff_author_user_id uuid;
  target_title text;
begin
  select
    comments.*,
    parent_comments.author_user_id as parent_author_user_id,
    coalesce(
      nullif(btrim(actor.display_name), ''),
      nullif(btrim(concat_ws(' ', actor.first_name, actor.last_name)), ''),
      nullif(btrim(comments.author_display_name), ''),
      'Someone'
    ) as actor_display_name
  into comment_row
  from public.salon_profile_comments comments
  left join public.salon_profile_comments parent_comments
    on parent_comments.id = comments.parent_comment_id
  left join public.users actor on actor.id = comments.author_user_id
  where comments.id = target_comment_id
  limit 1;

  if comment_row.id is null
    or comment_row.author_user_id is null
    or comment_row.status not in ('published', 'visible')
  then
    return;
  end if;

  actor_name := comment_row.actor_display_name;

  if comment_row.look_id is not null then
    target_kind := 'salon_profile_look';
    target_label := 'look';

    select
      looks.salon_id,
      salons.account_id,
      looks.author_user_id,
      author_staff.account_user_id,
      coalesce(nullif(btrim(looks.title), ''), 'this look'),
      '/explore/salons/' || looks.salon_id::text ||
        '?comment=' || comment_row.id::text ||
        '#look-' || looks.id::text
    into
      target_salon_id,
      target_account_id,
      target_author_user_id,
      target_staff_author_user_id,
      target_title,
      target_href
    from public.salon_profile_looks looks
    join public.locations salons on salons.id = looks.salon_id
    left join public.staff author_staff on author_staff.id = looks.author_staff_id
    where looks.id = comment_row.look_id
    limit 1;
  elsif comment_row.update_id is not null then
    target_kind := 'salon_profile_update';
    target_label := 'update';

    select
      updates.salon_id,
      salons.account_id,
      updates.author_user_id,
      author_staff.account_user_id,
      coalesce(nullif(btrim(updates.title), ''), 'this update'),
      '/explore/salons/' || updates.salon_id::text ||
        '?comment=' || comment_row.id::text ||
        '#update-' || updates.id::text
    into
      target_salon_id,
      target_account_id,
      target_author_user_id,
      target_staff_author_user_id,
      target_title,
      target_href
    from public.salon_profile_updates updates
    join public.locations salons on salons.id = updates.salon_id
    left join public.staff author_staff on author_staff.id = updates.author_staff_id
    where updates.id = comment_row.update_id
    limit 1;
  elsif comment_row.beauty_post_id is not null then
    target_kind := 'beauty_post';
    target_label := 'Beauty post';

    select
      attributions.salon_id,
      salons.account_id,
      posts.author_user_id,
      null::uuid,
      coalesce(nullif(left(btrim(posts.caption), 80), ''), 'this Beauty post'),
      '/explore/beauty/' || posts.profile_id::text ||
        '/posts/' || posts.id::text ||
        '?comment=' || comment_row.id::text ||
        '#comments'
    into
      target_salon_id,
      target_account_id,
      target_author_user_id,
      target_staff_author_user_id,
      target_title,
      target_href
    from public.beauty_posts posts
    left join public.beauty_post_attributions attributions
      on attributions.post_id = posts.id
    left join public.locations salons on salons.id = attributions.salon_id
    where posts.id = comment_row.beauty_post_id
    order by attributions.created_at desc nulls last
    limit 1;
  end if;

  if target_href is null then
    return;
  end if;

  insert into public.app_notifications (
    account_id,
    salon_id,
    recipient_user_id,
    recipient_kind,
    notification_type,
    title,
    body,
    href,
    event_key
  )
  with raw_candidates as (
    select
      comment_row.parent_author_user_id as recipient_user_id,
      null::text as forced_kind,
      1 as priority,
      'New reply to your comment' as notification_title,
      actor_name || ' replied on ' || target_title || '.' as notification_body
    where comment_row.parent_author_user_id is not null
      and comment_row.parent_author_user_id <> comment_row.author_user_id

    union all

    select
      target_author_user_id,
      case when target_kind = 'beauty_post' then 'customer' else null end,
      2,
      'New comment on your post',
      actor_name || ' commented on your ' || target_label || '.'
    where target_author_user_id is not null
      and target_author_user_id <> comment_row.author_user_id

    union all

    select
      target_staff_author_user_id,
      'staff',
      2,
      'New comment on your post',
      actor_name || ' commented on your ' || target_label || '.'
    where target_staff_author_user_id is not null
      and target_staff_author_user_id <> comment_row.author_user_id

    union all

    select
      memberships.user_id,
      'owner_manager',
      3,
      'New comment on Salon Profile',
      actor_name || ' commented on ' || target_title || '.'
    from public.account_memberships memberships
    join public.roles roles on roles.id = memberships.role_id
    left join public.role_permissions role_permissions
      on role_permissions.role_id = roles.id
    left join public.permissions permissions
      on permissions.id = role_permissions.permission_id
    where target_account_id is not null
      and target_salon_id is not null
      and memberships.account_id = target_account_id
      and memberships.status = 'active'
      and memberships.user_id <> comment_row.author_user_id
      and (
        roles.code = 'OWNER'
        or permissions.code in ('salon_profile.manage', 'salon_profile.content.manage')
      )
    group by memberships.user_id
  ),
  ranked_candidates as (
    select distinct on (raw_candidates.recipient_user_id)
      raw_candidates.recipient_user_id,
      raw_candidates.forced_kind,
      raw_candidates.notification_title,
      raw_candidates.notification_body,
      raw_candidates.priority
    from raw_candidates
    where raw_candidates.recipient_user_id is not null
      and raw_candidates.recipient_user_id <> comment_row.author_user_id
    order by raw_candidates.recipient_user_id, raw_candidates.priority asc
  ),
  typed_candidates as (
    select
      ranked_candidates.recipient_user_id,
      coalesce(
        ranked_candidates.forced_kind,
        case
          when target_salon_id is not null and exists (
            select 1
            from public.staff staff
            where staff.salon_id = target_salon_id
              and staff.account_user_id = ranked_candidates.recipient_user_id
              and staff.is_active = true
          ) then 'staff'
          when target_account_id is not null and exists (
            select 1
            from public.account_memberships memberships
            join public.roles roles on roles.id = memberships.role_id
            left join public.role_permissions role_permissions
              on role_permissions.role_id = roles.id
            left join public.permissions permissions
              on permissions.id = role_permissions.permission_id
            where memberships.account_id = target_account_id
              and memberships.user_id = ranked_candidates.recipient_user_id
              and memberships.status = 'active'
              and (
                roles.code = 'OWNER'
                or permissions.code in ('salon_profile.manage', 'salon_profile.content.manage')
              )
          ) then 'owner_manager'
          else 'customer'
        end
      ) as recipient_kind,
      ranked_candidates.notification_title,
      ranked_candidates.notification_body
    from ranked_candidates
  )
  select
    case
      when typed_candidates.recipient_kind = 'customer' then null
      else target_account_id
    end,
    target_salon_id,
    typed_candidates.recipient_user_id,
    typed_candidates.recipient_kind,
    'post_comment_created',
    typed_candidates.notification_title,
    typed_candidates.notification_body,
    target_href,
    'post_comment_created:' || comment_row.id::text || ':' || typed_candidates.recipient_user_id::text
  from typed_candidates
  on conflict (recipient_user_id, event_key) where event_key is not null do nothing;
end;
$$;

create or replace function public.notify_post_comment_created_trigger()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.notify_post_comment_created(new.id);
  return new;
end;
$$;

drop trigger if exists notify_post_comment_created_trigger
on public.salon_profile_comments;

create trigger notify_post_comment_created_trigger
after insert on public.salon_profile_comments
for each row execute function public.notify_post_comment_created_trigger();

drop policy if exists "public_read_visible_comments" on public.salon_profile_comments;
drop policy if exists "authenticated_create_own_comments" on public.salon_profile_comments;
drop policy if exists "comment_owner_or_manager_update_comments" on public.salon_profile_comments;

create policy "public_read_visible_comments" on public.salon_profile_comments
for select to anon, authenticated
using (
  status in ('visible', 'published')
  and public.post_comment_target_is_public(look_id, update_id, beauty_post_id, salon_id)
);

create policy "authenticated_create_own_comments" on public.salon_profile_comments
for insert to authenticated
with check (
  author_user_id = public.current_public_user_id()
  and status in ('visible', 'published')
  and public.post_comment_target_is_public(look_id, update_id, beauty_post_id, salon_id)
  and (
    is_salon_reply = false
    or (
      salon_id is not null
      and public.user_has_salon_permission(
        salon_id,
        array['salon_profile.manage', 'salon_profile.content.manage']::text[]
      )
    )
  )
);

create policy "comment_owner_or_manager_update_comments" on public.salon_profile_comments
for update to authenticated
using (
  author_user_id = public.current_public_user_id()
  or (
    salon_id is not null
    and public.user_has_salon_permission(
      salon_id,
      array['salon_profile.manage', 'salon_profile.content.manage']::text[]
    )
  )
)
with check (
  author_user_id = public.current_public_user_id()
  or (
    salon_id is not null
    and public.user_has_salon_permission(
      salon_id,
      array['salon_profile.manage', 'salon_profile.content.manage']::text[]
    )
  )
);

revoke all on function public.post_comment_target_is_public(uuid, uuid, uuid, uuid) from public;
revoke all on function public.validate_unified_post_comment() from public;
revoke all on function public.count_public_post_comments(text, uuid) from public;
revoke all on function public.get_public_post_comments(text, uuid, integer, integer) from public;
revoke all on function public.get_public_salon_profile_comments(uuid) from public;
revoke all on function public.notify_post_comment_created(uuid) from public;
revoke all on function public.notify_post_comment_created_trigger() from public;

grant execute on function public.post_comment_target_is_public(uuid, uuid, uuid, uuid) to anon, authenticated;
grant execute on function public.count_public_post_comments(text, uuid) to anon, authenticated;
grant execute on function public.get_public_post_comments(text, uuid, integer, integer) to anon, authenticated;
grant execute on function public.get_public_salon_profile_comments(uuid) to anon, authenticated;
