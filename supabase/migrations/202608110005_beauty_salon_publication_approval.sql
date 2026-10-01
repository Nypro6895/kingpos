create table if not exists public.beauty_post_salon_publications (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.beauty_posts(id) on delete cascade,
  salon_id uuid not null references public.locations(id) on delete cascade,
  status text not null default 'pending',
  requested_by_user_id uuid not null references public.users(id) on delete cascade,
  responded_by_user_id uuid references public.users(id) on delete set null,
  requested_at timestamptz not null default now(),
  responded_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint beauty_post_salon_publications_status_check check (
    status in ('pending', 'approved', 'declined')
  ),
  constraint beauty_post_salon_publications_response_check check (
    (
      status = 'pending'
      and responded_at is null
      and responded_by_user_id is null
    )
    or (
      status in ('approved', 'declined')
      and responded_at is not null
      and responded_by_user_id is not null
    )
  ),
  unique (post_id, salon_id)
);

create index if not exists beauty_post_salon_publications_post_idx
on public.beauty_post_salon_publications(post_id);

create index if not exists beauty_post_salon_publications_salon_pending_idx
on public.beauty_post_salon_publications(salon_id, requested_at desc, id desc)
where status = 'pending';

create index if not exists beauty_post_salon_publications_salon_approved_idx
on public.beauty_post_salon_publications(salon_id, responded_at desc, post_id desc)
where status = 'approved';

create unique index if not exists app_notifications_beauty_publication_event_key_idx
on public.app_notifications(recipient_user_id, event_key)
where event_key is not null;

drop trigger if exists set_beauty_post_salon_publications_updated_at
on public.beauty_post_salon_publications;

create trigger set_beauty_post_salon_publications_updated_at
before update on public.beauty_post_salon_publications
for each row execute function public.set_updated_at();

alter table public.beauty_post_salon_publications enable row level security;

create or replace function public.notify_beauty_salon_publication_request(target_publication_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  request_row record;
begin
  select
    publications.id as publication_id,
    publications.post_id,
    publications.salon_id,
    publications.status,
    salons.account_id,
    coalesce(nullif(btrim(settings.business_name), ''), salons.name) as salon_name,
    coalesce(
      nullif(btrim(users.display_name), ''),
      nullif(btrim(concat_ws(' ', users.first_name, users.last_name)), ''),
      'A Reylumi customer'
    ) as customer_name
  into request_row
  from public.beauty_post_salon_publications publications
  join public.beauty_posts posts on posts.id = publications.post_id
  join public.users users on users.id = posts.author_user_id
  join public.locations salons on salons.id = publications.salon_id
  left join public.salon_settings settings on settings.salon_id = salons.id
  where publications.id = target_publication_id
    and publications.status = 'pending'
    and posts.deleted_at is null
    and posts.post_type = 'before_after';

  if not found then
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
  select
    request_row.account_id,
    request_row.salon_id,
    memberships.user_id,
    'owner_manager',
    'beauty_salon_publication_request',
    'Client transformation needs approval',
    request_row.customer_name || ' tagged ' || request_row.salon_name || ' in a Before & After.',
    '/salon-profile/client-transformations',
    'beauty_salon_publication_request:' || request_row.post_id::text || ':' || memberships.user_id::text
  from public.account_memberships memberships
  join public.roles roles on roles.id = memberships.role_id
  left join public.role_permissions role_permissions on role_permissions.role_id = roles.id
  left join public.permissions permissions on permissions.id = role_permissions.permission_id
  where memberships.account_id = request_row.account_id
    and memberships.status = 'active'
    and (
      roles.code = 'OWNER'
      or permissions.code in ('salon_profile.manage', 'salon_profile.content.manage')
    )
  group by memberships.user_id
  on conflict (recipient_user_id, event_key) where event_key is not null do update
  set account_id = excluded.account_id,
      salon_id = excluded.salon_id,
      recipient_kind = excluded.recipient_kind,
      notification_type = excluded.notification_type,
      title = excluded.title,
      body = excluded.body,
      href = excluded.href,
      read_at = null,
      updated_at = now();
end;
$$;

create or replace function public.create_beauty_post(
  p_post_type text,
  p_caption text default null,
  p_visibility text default 'public',
  p_media jsonb default '[]'::jsonb,
  p_salon_id uuid default null,
  p_staff_id uuid default null,
  p_attribution_source text default 'customer_claimed'
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  actor_user_id uuid := public.current_public_user_id();
  clean_caption text := nullif(btrim(coalesce(p_caption, '')), '');
  clean_media jsonb := coalesce(p_media, '[]'::jsonb);
  clean_post_type text := case when p_post_type = 'before_after' then 'before_after' else 'regular' end;
  clean_visibility text := 'public';
  clean_attribution_source text := case
    when p_attribution_source in ('customer_claimed', 'recent_visit_suggestion', 'staff_profile', 'salon_profile')
    then p_attribution_source
    else 'customer_claimed'
  end;
  created_profile_id uuid;
  created_post_id uuid;
  media_count integer;
  before_count integer;
  after_count integer;
  image_count integer;
  media_entry jsonb;
  media_role text;
  media_path text;
  media_mime text;
  media_order integer := 0;
  media_width integer;
  media_height integer;
  media_bytes integer;
  proof jsonb;
  derived_verification_state text := 'pending';
  derived_verification_method text := 'none';
  proof_booking_id uuid;
  proof_ticket_id uuid;
  proof_customer_id uuid;
  active_policy public.beauty_reward_policies%rowtype;
  issued_reward_id uuid;
  reward_key text;
  salon_publication_id uuid;
  salon_publication_status text := null;
begin
  if actor_user_id is null then
    return jsonb_build_object('ok', false, 'code', 'sign_in_required', 'message', 'Sign in before posting.');
  end if;

  if length(coalesce(clean_caption, '')) > 2200 then
    return jsonb_build_object('ok', false, 'code', 'caption_too_long', 'message', 'Caption is too long.');
  end if;

  if jsonb_typeof(clean_media) <> 'array' then
    return jsonb_build_object('ok', false, 'code', 'invalid_media', 'message', 'Media payload is invalid.');
  end if;

  media_count := jsonb_array_length(clean_media);

  select count(*)::integer into before_count
  from jsonb_array_elements(clean_media) entry
  where entry ->> 'role' = 'before';

  select count(*)::integer into after_count
  from jsonb_array_elements(clean_media) entry
  where entry ->> 'role' = 'after';

  select count(*)::integer into image_count
  from jsonb_array_elements(clean_media) entry
  where entry ->> 'role' = 'image';

  if clean_post_type = 'regular' and clean_caption is null and media_count = 0 then
    return jsonb_build_object('ok', false, 'code', 'empty_post', 'message', 'Write a caption or add a photo before posting.');
  end if;

  if clean_post_type = 'regular' and media_count > 4 then
    return jsonb_build_object('ok', false, 'code', 'too_many_media', 'message', 'Add up to four photos.');
  end if;

  if clean_post_type = 'regular' and (before_count > 0 or after_count > 0) then
    return jsonb_build_object('ok', false, 'code', 'invalid_media_role', 'message', 'Before and after images require a Before & After post.');
  end if;

  if clean_post_type = 'before_after' then
    if p_salon_id is null then
      return jsonb_build_object('ok', false, 'code', 'salon_required', 'message', 'Choose the salon for this Before & After.');
    end if;

    if media_count <> 2 or before_count <> 1 or after_count <> 1 or image_count > 0 then
      return jsonb_build_object('ok', false, 'code', 'before_after_media_required', 'message', 'Add one before image and one after image.');
    end if;
  end if;

  if p_salon_id is not null and not exists (
    select 1
    from public.locations salons
    where salons.id = p_salon_id
      and salons.status = 'active'
  ) then
    return jsonb_build_object('ok', false, 'code', 'invalid_salon', 'message', 'Choose an active salon.');
  end if;

  if p_staff_id is not null and (
    p_salon_id is null
    or not exists (
      select 1
      from public.staff staff_members
      where staff_members.id = p_staff_id
        and staff_members.salon_id = p_salon_id
        and staff_members.is_active = true
    )
  ) then
    return jsonb_build_object('ok', false, 'code', 'invalid_staff', 'message', 'Choose an active professional from that salon.');
  end if;

  for media_entry in select value from jsonb_array_elements(clean_media) as media(value)
  loop
    media_role := nullif(btrim(coalesce(media_entry ->> 'role', '')), '');
    media_path := nullif(btrim(coalesce(media_entry ->> 'objectPath', media_entry ->> 'object_path', '')), '');
    media_mime := nullif(btrim(coalesce(media_entry ->> 'mimeType', media_entry ->> 'mime_type', '')), '');

    if media_role not in ('image', 'before', 'after') then
      return jsonb_build_object('ok', false, 'code', 'invalid_media_role', 'message', 'Media role is invalid.');
    end if;

    if clean_post_type = 'regular' and media_role <> 'image' then
      return jsonb_build_object('ok', false, 'code', 'invalid_media_role', 'message', 'Regular posts only accept photo media.');
    end if;

    if media_path is null
      or not starts_with(media_path, actor_user_id::text || '/beauty/')
      or position(chr(92) in media_path) > 0
      or position('..' in media_path) > 0
      or position('://' in media_path) > 0
      or media_path not like '%.webp'
    then
      return jsonb_build_object('ok', false, 'code', 'invalid_media_path', 'message', 'Uploaded image path is not valid.');
    end if;

    if media_mime is not null and media_mime not in ('image/jpeg', 'image/png', 'image/webp') then
      return jsonb_build_object('ok', false, 'code', 'invalid_media_type', 'message', 'Uploaded image type is not allowed.');
    end if;
  end loop;

  insert into public.beauty_profiles (user_id)
  values (actor_user_id)
  on conflict (user_id) do update
  set updated_at = public.beauty_profiles.updated_at
  returning id into created_profile_id;

  insert into public.beauty_posts (
    profile_id,
    author_user_id,
    post_type,
    caption,
    visibility
  )
  values (
    created_profile_id,
    actor_user_id,
    clean_post_type,
    clean_caption,
    clean_visibility
  )
  returning id into created_post_id;

  for media_entry in select value from jsonb_array_elements(clean_media) as media(value)
  loop
    media_order := media_order + 1;
    media_role := nullif(btrim(coalesce(media_entry ->> 'role', '')), '');
    media_path := nullif(btrim(coalesce(media_entry ->> 'objectPath', media_entry ->> 'object_path', '')), '');
    media_mime := nullif(btrim(coalesce(media_entry ->> 'mimeType', media_entry ->> 'mime_type', '')), '');
    media_width := public.beauty_jsonb_positive_int(media_entry, 'width');
    media_height := public.beauty_jsonb_positive_int(media_entry, 'height');
    media_bytes := coalesce(
      public.beauty_jsonb_positive_int(media_entry, 'bytes'),
      public.beauty_jsonb_positive_int(media_entry, 'originalBytes'),
      public.beauty_jsonb_positive_int(media_entry, 'original_bytes')
    );

    insert into public.beauty_post_media (
      post_id,
      role,
      object_path,
      display_order,
      width,
      height,
      mime_type,
      original_bytes
    )
    values (
      created_post_id,
      media_role,
      media_path,
      media_order,
      media_width,
      media_height,
      media_mime,
      media_bytes
    );
  end loop;

  if p_salon_id is not null then
    insert into public.beauty_post_attributions (
      post_id,
      salon_id,
      staff_id,
      source
    )
    values (
      created_post_id,
      p_salon_id,
      p_staff_id,
      clean_attribution_source
    );
  end if;

  if clean_post_type = 'before_after' then
    proof := public.find_beauty_visit_proof(actor_user_id, p_salon_id, p_staff_id);
    derived_verification_state := coalesce(proof ->> 'state', 'pending');
    derived_verification_method := coalesce(proof ->> 'method', 'none');
    proof_booking_id := nullif(coalesce(proof ->> 'bookingId', ''), '')::uuid;
    proof_ticket_id := nullif(coalesce(proof ->> 'posTicketId', ''), '')::uuid;
    proof_customer_id := nullif(coalesce(proof ->> 'customerId', ''), '')::uuid;

    insert into public.beauty_post_verifications (
      post_id,
      state,
      method,
      booking_id,
      pos_ticket_id,
      customer_id,
      verified_at,
      metadata
    )
    values (
      created_post_id,
      derived_verification_state,
      derived_verification_method,
      proof_booking_id,
      proof_ticket_id,
      proof_customer_id,
      case when derived_verification_state = 'verified' then now() else null end,
      jsonb_build_object(
        'policy', 'server_visit_lookup',
        'windowDays', extract(day from public.beauty_verification_window())::integer
      )
    );

    if derived_verification_state = 'verified' then
      select policies.*
      into active_policy
      from public.beauty_reward_policies policies
      where policies.status = 'active'
        and policies.post_type = clean_post_type
        and policies.verification_state = derived_verification_state
        and (policies.starts_at is null or policies.starts_at <= now())
        and (policies.ends_at is null or policies.ends_at > now())
      order by policies.created_at desc, policies.id desc
      limit 1;

      if active_policy.id is not null then
        reward_key := concat_ws(
          ':',
          'beauty_reward',
          active_policy.code,
          actor_user_id::text,
          derived_verification_method,
          coalesce(proof_ticket_id::text, proof_booking_id::text, created_post_id::text)
        );

        insert into public.beauty_reward_events (
          post_id,
          user_id,
          salon_id,
          policy_id,
          reward_type,
          points_amount,
          credit_amount,
          status,
          reason,
          idempotency_key,
          metadata
        )
        values (
          created_post_id,
          actor_user_id,
          p_salon_id,
          active_policy.id,
          active_policy.reward_type,
          active_policy.points_amount,
          active_policy.credit_amount,
          'issued',
          'verified_before_after',
          reward_key,
          jsonb_build_object(
            'verificationMethod', derived_verification_method,
            'proofBookingId', proof_booking_id,
            'proofTicketId', proof_ticket_id
          )
        )
        on conflict (idempotency_key) do nothing
        returning id into issued_reward_id;
      end if;
    end if;

    insert into public.beauty_post_salon_publications (
      post_id,
      salon_id,
      requested_by_user_id,
      status
    )
    values (
      created_post_id,
      p_salon_id,
      actor_user_id,
      'pending'
    )
    on conflict (post_id, salon_id) do nothing
    returning id, status into salon_publication_id, salon_publication_status;

    if salon_publication_id is not null then
      perform public.notify_beauty_salon_publication_request(salon_publication_id);
    end if;
  end if;

  return jsonb_build_object(
    'ok', true,
    'postId', created_post_id,
    'profileId', created_profile_id,
    'verificationState', derived_verification_state,
    'verificationMethod', derived_verification_method,
    'rewardIssued', issued_reward_id is not null,
    'salonPublicationId', salon_publication_id,
    'salonPublicationStatus', salon_publication_status
  );
exception
  when unique_violation then
    return jsonb_build_object('ok', false, 'code', 'duplicate_media_or_reward', 'message', 'This upload or reward was already used.');
  when others then
    return jsonb_build_object('ok', false, 'code', 'database_error', 'message', SQLERRM);
end;
$$;

create or replace function public.get_my_beauty_salon_publication_statuses(
  p_post_ids uuid[] default array[]::uuid[]
)
returns table (
  post_id uuid,
  publication_id uuid,
  status text,
  requested_at timestamptz,
  responded_at timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select
    publications.post_id,
    publications.id as publication_id,
    publications.status,
    publications.requested_at,
    publications.responded_at
  from public.beauty_post_salon_publications publications
  join public.beauty_posts posts on posts.id = publications.post_id
  where posts.author_user_id = public.current_public_user_id()
    and publications.post_id = any(coalesce(p_post_ids, array[]::uuid[]))
  order by publications.requested_at desc, publications.id desc
$$;

create or replace function public.list_my_beauty_salon_publication_requests(
  target_salon_id uuid,
  p_limit integer default 24
)
returns table (
  publication_id uuid,
  post_id uuid,
  salon_id uuid,
  status text,
  requested_at timestamptz,
  responded_at timestamptz,
  post_created_at timestamptz,
  caption text,
  author_display_name text,
  author_avatar_url text,
  staff_id uuid,
  staff_name text,
  verification_state text,
  media jsonb
)
language sql
stable
security definer
set search_path = public
as $$
  with authorized as (
    select
      public.current_public_user_id() is not null
      and public.user_has_salon_permission(
        target_salon_id,
        array['salon_profile.content.manage']::text[]
      ) as can_review
  ),
  pending_publications as (
    select publications.*
    from public.beauty_post_salon_publications publications
    cross join authorized
    where authorized.can_review
      and publications.salon_id = target_salon_id
      and publications.status = 'pending'
    order by publications.requested_at desc, publications.id desc
    limit greatest(1, least(coalesce(p_limit, 24), 48))
  )
  select
    pending_publications.id as publication_id,
    posts.id as post_id,
    pending_publications.salon_id,
    pending_publications.status,
    pending_publications.requested_at,
    pending_publications.responded_at,
    posts.created_at as post_created_at,
    posts.caption,
    coalesce(
      nullif(btrim(users.display_name), ''),
      nullif(btrim(concat_ws(' ', users.first_name, users.last_name)), ''),
      'Reylumi customer'
    ) as author_display_name,
    users.avatar_url as author_avatar_url,
    staff.id as staff_id,
    staff.display_name as staff_name,
    verifications.state as verification_state,
    coalesce(
      (
        select jsonb_agg(
          jsonb_build_object(
            'id', media.id,
            'role', media.role,
            'objectPath', media.object_path,
            'displayOrder', media.display_order,
            'width', media.width,
            'height', media.height,
            'mimeType', media.mime_type
          )
          order by media.display_order, media.created_at, media.id
        )
        from public.beauty_post_media media
        where media.post_id = posts.id
      ),
      '[]'::jsonb
    ) as media
  from pending_publications
  join public.beauty_posts posts on posts.id = pending_publications.post_id
  join public.users users on users.id = posts.author_user_id
  left join public.beauty_post_attributions attributions
    on attributions.post_id = posts.id
   and attributions.salon_id = pending_publications.salon_id
  left join public.staff staff on staff.id = attributions.staff_id
  left join public.beauty_post_verifications verifications on verifications.post_id = posts.id
  where posts.deleted_at is null
    and posts.post_type = 'before_after'
  order by pending_publications.requested_at desc, pending_publications.id desc
$$;

create or replace function public.count_my_beauty_salon_publication_requests(target_salon_id uuid)
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select case
    when public.current_public_user_id() is null then 0
    when not public.user_has_salon_permission(
      target_salon_id,
      array['salon_profile.content.manage']::text[]
    ) then 0
    else (
      select count(*)::integer
      from public.beauty_post_salon_publications publications
      join public.beauty_posts posts on posts.id = publications.post_id
      where publications.salon_id = target_salon_id
        and publications.status = 'pending'
        and posts.deleted_at is null
        and posts.post_type = 'before_after'
    )
  end
$$;

create or replace function public.respond_to_beauty_salon_publication_request(
  p_publication_id uuid,
  p_response text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  actor_user_id uuid := public.current_public_user_id();
  clean_response text := case
    when p_response = 'approved' then 'approved'
    when p_response = 'declined' then 'declined'
    else null
  end;
  request_row public.beauty_post_salon_publications%rowtype;
begin
  if actor_user_id is null then
    return jsonb_build_object('ok', false, 'code', 'sign_in_required');
  end if;

  if clean_response is null then
    return jsonb_build_object('ok', false, 'code', 'invalid_response');
  end if;

  select *
  into request_row
  from public.beauty_post_salon_publications publications
  where publications.id = p_publication_id
  for update;

  if request_row.id is null then
    return jsonb_build_object('ok', false, 'code', 'not_found');
  end if;

  if not public.user_has_salon_permission(
    request_row.salon_id,
    array['salon_profile.content.manage']::text[]
  ) then
    return jsonb_build_object('ok', false, 'code', 'forbidden');
  end if;

  if request_row.status <> 'pending' then
    return jsonb_build_object(
      'ok', true,
      'publicationId', request_row.id,
      'postId', request_row.post_id,
      'salonId', request_row.salon_id,
      'status', request_row.status,
      'idempotent', true
    );
  end if;

  update public.beauty_post_salon_publications
  set status = clean_response,
      responded_at = now(),
      responded_by_user_id = actor_user_id
  where id = request_row.id
    and status = 'pending'
  returning * into request_row;

  update public.app_notifications
  set read_at = coalesce(read_at, now()),
      updated_at = now()
  where salon_id = request_row.salon_id
    and notification_type = 'beauty_salon_publication_request'
    and event_key like 'beauty_salon_publication_request:' || request_row.post_id::text || ':%';

  return jsonb_build_object(
    'ok', true,
    'publicationId', request_row.id,
    'postId', request_row.post_id,
    'salonId', request_row.salon_id,
    'status', request_row.status,
    'idempotent', false
  );
end;
$$;

create or replace function public.get_public_salon_profile_beauty_posts(
  target_salon_id uuid,
  p_limit integer default 6
)
returns table (
  publication_id uuid,
  post_id uuid,
  profile_id uuid,
  post_type text,
  caption text,
  created_at timestamptz,
  approved_at timestamptz,
  author_display_name text,
  author_avatar_url text,
  staff_id uuid,
  staff_name text,
  verification_state text,
  media jsonb
)
language sql
stable
security definer
set search_path = public
as $$
  select
    publications.id as publication_id,
    posts.id as post_id,
    posts.profile_id,
    posts.post_type,
    posts.caption,
    posts.created_at,
    publications.responded_at as approved_at,
    coalesce(
      nullif(btrim(users.display_name), ''),
      nullif(btrim(concat_ws(' ', users.first_name, users.last_name)), ''),
      'Reylumi customer'
    ) as author_display_name,
    users.avatar_url as author_avatar_url,
    staff.id as staff_id,
    staff.display_name as staff_name,
    verifications.state as verification_state,
    coalesce(
      (
        select jsonb_agg(
          jsonb_build_object(
            'id', media.id,
            'role', media.role,
            'objectPath', media.object_path,
            'displayOrder', media.display_order,
            'width', media.width,
            'height', media.height,
            'mimeType', media.mime_type
          )
          order by media.display_order, media.created_at, media.id
        )
        from public.beauty_post_media media
        where media.post_id = posts.id
      ),
      '[]'::jsonb
    ) as media
  from public.beauty_post_salon_publications publications
  join public.beauty_posts posts on posts.id = publications.post_id
  join public.beauty_profiles profiles on profiles.id = posts.profile_id
  join public.users users on users.id = posts.author_user_id
  left join public.beauty_post_attributions attributions
    on attributions.post_id = posts.id
   and attributions.salon_id = publications.salon_id
  left join public.staff staff on staff.id = attributions.staff_id
  left join public.beauty_post_verifications verifications on verifications.post_id = posts.id
  where publications.salon_id = target_salon_id
    and publications.status = 'approved'
    and public.salon_profile_public_salon_exists(target_salon_id)
    and posts.deleted_at is null
    and posts.visibility = 'public'
    and posts.moderation_status = 'visible'
    and posts.post_type = 'before_after'
    and profiles.visibility = 'public'
    and exists (
      select 1
      from public.beauty_post_media media
      where media.post_id = posts.id
    )
  order by publications.responded_at desc, posts.created_at desc, posts.id desc
  limit greatest(1, least(coalesce(p_limit, 6), 12))
$$;

revoke all on function public.notify_beauty_salon_publication_request(uuid) from public;
revoke all on function public.create_beauty_post(text, text, text, jsonb, uuid, uuid, text) from public;
revoke all on function public.get_my_beauty_salon_publication_statuses(uuid[]) from public;
revoke all on function public.list_my_beauty_salon_publication_requests(uuid, integer) from public;
revoke all on function public.count_my_beauty_salon_publication_requests(uuid) from public;
revoke all on function public.respond_to_beauty_salon_publication_request(uuid, text) from public;
revoke all on function public.get_public_salon_profile_beauty_posts(uuid, integer) from public;

grant execute on function public.create_beauty_post(text, text, text, jsonb, uuid, uuid, text) to authenticated;
grant execute on function public.get_my_beauty_salon_publication_statuses(uuid[]) to authenticated;
grant execute on function public.list_my_beauty_salon_publication_requests(uuid, integer) to authenticated;
grant execute on function public.count_my_beauty_salon_publication_requests(uuid) to authenticated;
grant execute on function public.respond_to_beauty_salon_publication_request(uuid, text) to authenticated;
grant execute on function public.get_public_salon_profile_beauty_posts(uuid, integer) to anon, authenticated;
