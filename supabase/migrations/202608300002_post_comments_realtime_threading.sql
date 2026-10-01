alter table public.salon_profile_comments
  add column if not exists root_comment_id uuid references public.salon_profile_comments(id) on delete cascade,
  add column if not exists reply_depth integer not null default 0;

with recursive comment_tree as (
  select
    comments.id,
    null::uuid as root_comment_id,
    0 as reply_depth
  from public.salon_profile_comments comments
  where comments.parent_comment_id is null

  union all

  select
    child_comments.id,
    coalesce(comment_tree.root_comment_id, comment_tree.id) as root_comment_id,
    comment_tree.reply_depth + 1 as reply_depth
  from public.salon_profile_comments child_comments
  join comment_tree on comment_tree.id = child_comments.parent_comment_id
  where comment_tree.reply_depth < 8
)
update public.salon_profile_comments comments
set
  root_comment_id = comment_tree.root_comment_id,
  reply_depth = comment_tree.reply_depth
from comment_tree
where comments.id = comment_tree.id;

alter table public.salon_profile_comments
  drop constraint if exists salon_profile_comments_thread_shape_check;

alter table public.salon_profile_comments
  add constraint salon_profile_comments_thread_shape_check
  check (
    (
      parent_comment_id is null
      and root_comment_id is null
      and reply_depth = 0
    )
    or (
      parent_comment_id is not null
      and root_comment_id is not null
      and root_comment_id <> id
      and reply_depth between 1 and 8
    )
  );

create index if not exists salon_profile_comments_root_thread_idx
on public.salon_profile_comments(root_comment_id, created_at asc, id asc)
where root_comment_id is not null and status in ('published', 'visible');

alter table public.salon_profile_comments replica identity full;
alter table public.app_notifications replica identity full;

do $$
begin
  if exists (
    select 1
    from pg_publication
    where pubname = 'supabase_realtime'
  ) then
    begin
      alter publication supabase_realtime add table public.salon_profile_comments;
    exception
      when duplicate_object then null;
    end;

    begin
      alter publication supabase_realtime add table public.app_notifications;
    exception
      when duplicate_object then null;
    end;
  end if;
end;
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

    if new.root_comment_id is distinct from old.root_comment_id
      or new.reply_depth is distinct from old.reply_depth
    then
      raise exception 'Comment thread cannot be changed.';
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

    if coalesce(parent_row.reply_depth, 0) >= 8 then
      raise exception 'Reply thread is too deep.';
    end if;

    if parent_row.look_id is distinct from new.look_id
      or parent_row.update_id is distinct from new.update_id
      or parent_row.beauty_post_id is distinct from new.beauty_post_id
    then
      raise exception 'Reply target does not belong to this post.';
    end if;

    new.root_comment_id := coalesce(parent_row.root_comment_id, parent_row.id);
    new.reply_depth := coalesce(parent_row.reply_depth, 0) + 1;
  elsif tg_op = 'INSERT' then
    new.root_comment_id := null;
    new.reply_depth := 0;
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
    select comments.id, comments.parent_comment_id, comments.root_comment_id
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
    or coalesce(target_comments.root_comment_id, target_comments.parent_comment_id) in (
      select visible_roots.id
      from visible_roots
    )
$$;

drop function if exists public.get_public_post_comments(text, uuid, integer, integer);

create function public.get_public_post_comments(
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
  root_comment_id uuid,
  reply_depth integer,
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
      paged_roots.id as root_sort_id,
      0 as thread_sort
    from paged_roots

    union all

    select
      replies.*,
      paged_roots.created_at as root_created_at,
      paged_roots.id as root_sort_id,
      1 as thread_sort
    from target_comments replies
    join paged_roots
      on coalesce(replies.root_comment_id, replies.parent_comment_id) = paged_roots.id
    where replies.id <> paged_roots.id
  ),
  totals as (
    select
      (
        select count(*)::bigint
        from target_comments counted_comments
        where counted_comments.parent_comment_id is null
          or coalesce(counted_comments.root_comment_id, counted_comments.parent_comment_id) in (
            select visible_roots.id
            from visible_roots
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
    result_rows.root_comment_id,
    result_rows.reply_depth,
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
    result_rows.root_sort_id desc,
    result_rows.thread_sort asc,
    result_rows.created_at asc,
    result_rows.id asc;
end;
$$;

drop function if exists public.get_public_salon_profile_comments(uuid);

create function public.get_public_salon_profile_comments(target_salon_id uuid)
returns table (
  id uuid,
  salon_id uuid,
  look_id uuid,
  update_id uuid,
  beauty_post_id uuid,
  parent_comment_id uuid,
  root_comment_id uuid,
  reply_depth integer,
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
    comments.root_comment_id,
    comments.reply_depth,
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
  order by
    coalesce(comments.root_comment_id, comments.id),
    comments.reply_depth,
    comments.created_at asc,
    comments.id asc
$$;

revoke all on function public.get_public_post_comments(text, uuid, integer, integer) from public;
revoke all on function public.get_public_salon_profile_comments(uuid) from public;

grant execute on function public.get_public_post_comments(text, uuid, integer, integer) to anon, authenticated;
grant execute on function public.get_public_salon_profile_comments(uuid) to anon, authenticated;
