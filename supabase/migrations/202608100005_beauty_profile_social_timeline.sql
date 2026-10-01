insert into storage.buckets (
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types
)
values (
  'beauty-profile-media',
  'beauty-profile-media',
  true,
  15728640,
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

create table public.beauty_profiles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references public.users(id) on delete cascade,
  bio text,
  cover_media_path text,
  visibility text not null default 'public',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint beauty_profiles_visibility_check check (visibility in ('public', 'self')),
  constraint beauty_profiles_bio_length_check check (bio is null or length(bio) <= 500),
  constraint beauty_profiles_cover_media_path_check check (
    cover_media_path is null
    or cover_media_path ~* (
      '^' || user_id::text || '/beauty/cover/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}[.]webp$'
    )
  )
);

create table public.beauty_posts (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.beauty_profiles(id) on delete cascade,
  author_user_id uuid not null references public.users(id) on delete cascade,
  post_type text not null default 'regular',
  caption text,
  visibility text not null default 'public',
  moderation_status text not null default 'visible',
  edited_at timestamptz,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint beauty_posts_type_check check (post_type in ('regular', 'before_after')),
  constraint beauty_posts_visibility_check check (visibility in ('public', 'self')),
  constraint beauty_posts_moderation_status_check check (
    moderation_status in ('visible', 'hidden', 'reported', 'withdrawn')
  ),
  constraint beauty_posts_caption_length_check check (caption is null or length(caption) <= 2200)
);

create table public.beauty_post_media (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.beauty_posts(id) on delete cascade,
  role text not null default 'image',
  bucket text not null default 'beauty-profile-media',
  object_path text not null,
  display_order integer not null default 0,
  width integer,
  height integer,
  mime_type text,
  original_bytes bigint,
  created_at timestamptz not null default now(),
  constraint beauty_post_media_role_check check (role in ('image', 'before', 'after')),
  constraint beauty_post_media_bucket_check check (bucket = 'beauty-profile-media'),
  constraint beauty_post_media_dimensions_check check (
    (width is null or width > 0)
    and (height is null or height > 0)
  ),
  constraint beauty_post_media_bytes_check check (original_bytes is null or original_bytes >= 0),
  constraint beauty_post_media_mime_check check (
    mime_type is null or mime_type in ('image/jpeg', 'image/png', 'image/webp')
  ),
  unique (bucket, object_path),
  unique (post_id, role, display_order)
);

create table public.beauty_post_attributions (
  post_id uuid primary key references public.beauty_posts(id) on delete cascade,
  salon_id uuid not null references public.locations(id) on delete restrict,
  staff_id uuid references public.staff(id) on delete set null,
  source text not null default 'customer_claimed',
  created_at timestamptz not null default now(),
  constraint beauty_post_attributions_source_check check (
    source in ('customer_claimed', 'recent_visit_suggestion', 'staff_profile', 'salon_profile')
  )
);

create table public.beauty_post_verifications (
  post_id uuid primary key references public.beauty_posts(id) on delete cascade,
  state text not null default 'pending',
  method text not null default 'none',
  booking_id uuid references public.bookings(id) on delete set null,
  pos_ticket_id uuid references public.pos_tickets(id) on delete set null,
  customer_id uuid references public.customers(id) on delete set null,
  verified_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint beauty_post_verifications_state_check check (
    state in ('pending', 'verified', 'unverified', 'rejected')
  ),
  constraint beauty_post_verifications_method_check check (
    method in ('none', 'pos_ticket', 'completed_booking', 'booking_checkin')
  )
);

create table public.beauty_reward_policies (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  post_type text not null,
  verification_state text not null,
  reward_type text not null default 'reylumi_points',
  points_amount integer not null default 0,
  credit_amount numeric(12, 2),
  status text not null default 'active',
  starts_at timestamptz,
  ends_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint beauty_reward_policies_post_type_check check (post_type in ('regular', 'before_after')),
  constraint beauty_reward_policies_verification_check check (
    verification_state in ('pending', 'verified', 'unverified', 'rejected')
  ),
  constraint beauty_reward_policies_status_check check (status in ('active', 'inactive')),
  constraint beauty_reward_policies_points_check check (points_amount >= 0),
  constraint beauty_reward_policies_credit_check check (credit_amount is null or credit_amount >= 0)
);

create table public.beauty_reward_events (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.beauty_posts(id),
  user_id uuid not null references public.users(id) on delete cascade,
  salon_id uuid references public.locations(id) on delete set null,
  policy_id uuid references public.beauty_reward_policies(id) on delete set null,
  reward_type text not null default 'reylumi_points',
  points_amount integer not null default 0,
  credit_amount numeric(12, 2),
  status text not null default 'issued',
  reason text not null,
  idempotency_key text not null unique,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint beauty_reward_events_status_check check (
    status in ('issued', 'duplicate', 'voided', 'pending')
  ),
  constraint beauty_reward_events_points_check check (points_amount >= 0),
  constraint beauty_reward_events_credit_check check (credit_amount is null or credit_amount >= 0)
);

create index beauty_posts_profile_timeline_idx
on public.beauty_posts(profile_id, created_at desc, id desc)
where deleted_at is null;

create index beauty_posts_author_idx
on public.beauty_posts(author_user_id, created_at desc)
where deleted_at is null;

create index beauty_profiles_public_cover_idx
on public.beauty_profiles(cover_media_path)
where cover_media_path is not null and visibility = 'public';

create index beauty_post_media_post_idx
on public.beauty_post_media(post_id, display_order, id);

create index beauty_post_attributions_salon_idx
on public.beauty_post_attributions(salon_id, created_at desc);

create index beauty_post_attributions_staff_idx
on public.beauty_post_attributions(staff_id, created_at desc)
where staff_id is not null;

create index beauty_reward_events_user_idx
on public.beauty_reward_events(user_id, created_at desc);

create index beauty_reward_events_post_issued_idx
on public.beauty_reward_events(post_id, created_at desc, id desc)
where status = 'issued';

create index beauty_pos_tickets_customer_closed_idx
on public.pos_tickets(customer_id, salon_id, (coalesce(closed_at, opened_at)) desc, id desc)
where status = 'closed' and customer_id is not null;

create index beauty_pos_ticket_items_staff_lookup_idx
on public.pos_ticket_items(pos_ticket_id, salon_id, assigned_staff_id)
where assigned_staff_id is not null and coalesce(is_removed, false) = false;

create index beauty_bookings_customer_visit_idx
on public.bookings(customer_user_id, salon_id, status, start_at desc, id desc)
where customer_user_id is not null
  and status in ('completed', 'checked_in', 'in_service');

create index beauty_booking_lines_staff_lookup_idx
on public.booking_lines(booking_id, salon_id, assigned_staff_id, performed_by_staff_id)
where line_status <> 'cancelled';

create trigger set_beauty_profiles_updated_at
before update on public.beauty_profiles
for each row execute function public.set_updated_at();

create trigger set_beauty_posts_updated_at
before update on public.beauty_posts
for each row execute function public.set_updated_at();

create trigger set_beauty_post_verifications_updated_at
before update on public.beauty_post_verifications
for each row execute function public.set_updated_at();

create trigger set_beauty_reward_policies_updated_at
before update on public.beauty_reward_policies
for each row execute function public.set_updated_at();

insert into public.beauty_reward_policies (
  code,
  post_type,
  verification_state,
  reward_type,
  points_amount,
  status,
  metadata
)
values (
  'verified_before_after_default',
  'before_after',
  'verified',
  'reylumi_points',
  25,
  'active',
  jsonb_build_object('description', 'Default server-controlled reward for a verified Before & After post.')
)
on conflict (code) do update
set points_amount = excluded.points_amount,
    status = excluded.status,
    updated_at = now();

create or replace function public.beauty_jsonb_positive_int(payload jsonb, field_name text)
returns integer
language sql
immutable
as $$
  select case
    when payload ? field_name and payload ->> field_name ~ '^[0-9]+$'
    then least((payload ->> field_name)::numeric, 2147483647)::integer
    else null
  end
$$;

create or replace function public.beauty_verification_window()
returns interval
language sql
stable
as $$
  with setting as (
    select nullif(current_setting('app.beauty_verification_window_days', true), '') as raw_value
  )
  select make_interval(days => case
    when raw_value ~ '^[0-9]+$'
    then greatest(1, least(raw_value::integer, 3650))
    else 180
  end)
  from setting
$$;

create or replace function public.beauty_public_post_exists(target_post_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.beauty_posts posts
    join public.beauty_profiles profiles on profiles.id = posts.profile_id
    where posts.id = target_post_id
      and posts.deleted_at is null
      and posts.visibility = 'public'
      and posts.moderation_status = 'visible'
      and profiles.visibility = 'public'
  )
$$;

create or replace function public.validate_beauty_post_attribution()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.staff_id is not null and not exists (
    select 1
    from public.staff
    where staff.id = new.staff_id
      and staff.salon_id = new.salon_id
      and staff.is_active = true
  ) then
    raise exception 'Beauty post staff attribution must belong to the selected salon.';
  end if;

  return new;
end;
$$;

create trigger validate_beauty_post_attribution_trigger
before insert or update on public.beauty_post_attributions
for each row execute function public.validate_beauty_post_attribution();

create or replace function public.find_beauty_visit_proof(
  p_user_id uuid,
  p_salon_id uuid,
  p_staff_id uuid default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  proof jsonb;
  window_start timestamptz := now() - public.beauty_verification_window();
begin
  if p_user_id is null or p_salon_id is null then
    return jsonb_build_object('state', 'pending', 'method', 'none');
  end if;

  select jsonb_build_object(
    'state', 'verified',
    'method', 'pos_ticket',
    'posTicketId', tickets.id,
    'customerId', customers.id,
    'occurredAt', coalesce(tickets.closed_at, tickets.opened_at)
  )
  into proof
  from public.pos_tickets tickets
  join public.customers customers on customers.id = tickets.customer_id
  where customers.customer_user_id = p_user_id
    and customers.location_id = tickets.salon_id
    and tickets.salon_id = p_salon_id
    and tickets.status = 'closed'
    and coalesce(tickets.closed_at, tickets.opened_at) >= window_start
    and (
      p_staff_id is null
      or exists (
        select 1
        from public.pos_ticket_items items
        where items.pos_ticket_id = tickets.id
          and items.salon_id = tickets.salon_id
          and items.assigned_staff_id = p_staff_id
          and coalesce(items.is_removed, false) = false
      )
    )
  order by coalesce(tickets.closed_at, tickets.opened_at) desc, tickets.id desc
  limit 1;

  if proof is not null then
    return proof;
  end if;

  select jsonb_build_object(
    'state', 'verified',
    'method', 'completed_booking',
    'bookingId', bookings.id,
    'customerId', bookings.customer_id,
    'occurredAt', bookings.start_at
  )
  into proof
  from public.bookings bookings
  where bookings.customer_user_id = p_user_id
    and bookings.salon_id = p_salon_id
    and bookings.status = 'completed'
    and bookings.start_at >= window_start
    and (
      p_staff_id is null
      or bookings.staff_id = p_staff_id
      or exists (
        select 1
        from public.booking_lines lines
        where lines.booking_id = bookings.id
          and lines.salon_id = bookings.salon_id
          and lines.line_status <> 'cancelled'
          and (
            lines.assigned_staff_id = p_staff_id
            or lines.performed_by_staff_id = p_staff_id
          )
      )
    )
  order by bookings.start_at desc, bookings.id desc
  limit 1;

  if proof is not null then
    return proof;
  end if;

  select jsonb_build_object(
    'state', 'verified',
    'method', 'booking_checkin',
    'bookingId', bookings.id,
    'customerId', bookings.customer_id,
    'occurredAt', bookings.start_at
  )
  into proof
  from public.bookings bookings
  where bookings.customer_user_id = p_user_id
    and bookings.salon_id = p_salon_id
    and bookings.status in ('checked_in', 'in_service')
    and bookings.start_at >= window_start
    and bookings.start_at <= now() + interval '1 day'
    and (
      p_staff_id is null
      or bookings.staff_id = p_staff_id
      or exists (
        select 1
        from public.booking_lines lines
        where lines.booking_id = bookings.id
          and lines.salon_id = bookings.salon_id
          and lines.line_status <> 'cancelled'
          and (
            lines.assigned_staff_id = p_staff_id
            or lines.performed_by_staff_id = p_staff_id
          )
      )
    )
  order by bookings.start_at desc, bookings.id desc
  limit 1;

  return coalesce(proof, jsonb_build_object('state', 'pending', 'method', 'none'));
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
  profile_id uuid;
  post_id uuid;
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
  verification_state text := 'pending';
  verification_method text := 'none';
  proof_booking_id uuid;
  proof_ticket_id uuid;
  proof_customer_id uuid;
  active_policy public.beauty_reward_policies%rowtype;
  reward_id uuid;
  reward_key text;
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
    select 1 from public.locations where id = p_salon_id and status = 'active'
  ) then
    return jsonb_build_object('ok', false, 'code', 'invalid_salon', 'message', 'Choose an active salon.');
  end if;

  if p_staff_id is not null and (
    p_salon_id is null
    or not exists (
      select 1
      from public.staff
      where id = p_staff_id
        and salon_id = p_salon_id
        and is_active = true
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
  returning id into profile_id;

  insert into public.beauty_posts (
    profile_id,
    author_user_id,
    post_type,
    caption,
    visibility
  )
  values (
    profile_id,
    actor_user_id,
    clean_post_type,
    clean_caption,
    clean_visibility
  )
  returning id into post_id;

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
      post_id,
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
      post_id,
      p_salon_id,
      p_staff_id,
      clean_attribution_source
    );
  end if;

  if clean_post_type = 'before_after' then
    proof := public.find_beauty_visit_proof(actor_user_id, p_salon_id, p_staff_id);
    verification_state := coalesce(proof ->> 'state', 'pending');
    verification_method := coalesce(proof ->> 'method', 'none');
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
      post_id,
      verification_state,
      verification_method,
      proof_booking_id,
      proof_ticket_id,
      proof_customer_id,
      case when verification_state = 'verified' then now() else null end,
      jsonb_build_object(
        'policy', 'server_visit_lookup',
        'windowDays', extract(day from public.beauty_verification_window())::integer
      )
    );

    if verification_state = 'verified' then
      select *
      into active_policy
      from public.beauty_reward_policies policies
      where policies.status = 'active'
        and policies.post_type = clean_post_type
        and policies.verification_state = verification_state
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
          verification_method,
          coalesce(proof_ticket_id::text, proof_booking_id::text, post_id::text)
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
          post_id,
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
            'verificationMethod', verification_method,
            'proofBookingId', proof_booking_id,
            'proofTicketId', proof_ticket_id
          )
        )
        on conflict (idempotency_key) do nothing
        returning id into reward_id;
      end if;
    end if;
  end if;

  return jsonb_build_object(
    'ok', true,
    'postId', post_id,
    'profileId', profile_id,
    'verificationState', verification_state,
    'verificationMethod', verification_method,
    'rewardIssued', reward_id is not null
  );
exception
  when unique_violation then
    return jsonb_build_object('ok', false, 'code', 'duplicate_media_or_reward', 'message', 'This upload or reward was already used.');
  when others then
    return jsonb_build_object('ok', false, 'code', 'database_error', 'message', SQLERRM);
end;
$$;

create or replace function public.update_beauty_post_caption(
  p_post_id uuid,
  p_caption text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  actor_user_id uuid := public.current_public_user_id();
  clean_caption text := nullif(btrim(coalesce(p_caption, '')), '');
begin
  if actor_user_id is null then
    return jsonb_build_object('ok', false, 'code', 'sign_in_required');
  end if;

  if length(coalesce(clean_caption, '')) > 2200 then
    return jsonb_build_object('ok', false, 'code', 'caption_too_long');
  end if;

  update public.beauty_posts
  set caption = clean_caption,
      edited_at = now()
  where id = p_post_id
    and author_user_id = actor_user_id
    and deleted_at is null;

  if not found then
    return jsonb_build_object('ok', false, 'code', 'not_found');
  end if;

  return jsonb_build_object('ok', true);
end;
$$;

create or replace function public.delete_beauty_post(p_post_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  actor_user_id uuid := public.current_public_user_id();
  media_paths text[];
begin
  if actor_user_id is null then
    return jsonb_build_object('ok', false, 'code', 'sign_in_required');
  end if;

  select coalesce(array_agg(media.object_path order by media.display_order, media.id), array[]::text[])
  into media_paths
  from public.beauty_posts posts
  join public.beauty_post_media media on media.post_id = posts.id
  where posts.id = p_post_id
    and posts.author_user_id = actor_user_id
    and posts.deleted_at is null;

  update public.beauty_posts
  set deleted_at = now()
  where id = p_post_id
    and author_user_id = actor_user_id
    and deleted_at is null;

  if not found then
    return jsonb_build_object('ok', false, 'code', 'not_found');
  end if;

  return jsonb_build_object(
    'ok', true,
    'mediaPaths', to_jsonb(media_paths)
  );
end;
$$;

create or replace function public.list_beauty_timeline(
  p_profile_id uuid,
  p_cursor_created_at timestamptz default null,
  p_cursor_post_id uuid default null,
  p_page_size integer default 12
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  actor_user_id uuid := public.current_public_user_id();
  clean_page_size integer := greatest(1, least(coalesce(p_page_size, 12), 24));
  profile_row public.beauty_profiles%rowtype;
  fetched_ids uuid[];
  page_ids uuid[];
  fetched_count integer := 0;
  cursor_created_at timestamptz;
  cursor_post_id uuid;
  items jsonb := '[]'::jsonb;
begin
  select *
  into profile_row
  from public.beauty_profiles
  where id = p_profile_id;

  if profile_row.id is null then
    return jsonb_build_object('ok', false, 'code', 'not_found', 'items', '[]'::jsonb);
  end if;

  if profile_row.visibility <> 'public' and profile_row.user_id is distinct from actor_user_id then
    return jsonb_build_object('ok', false, 'code', 'not_found', 'items', '[]'::jsonb);
  end if;

  if p_cursor_created_at is not null and p_cursor_post_id is null then
    return jsonb_build_object('ok', false, 'code', 'invalid_cursor', 'items', '[]'::jsonb);
  end if;

  select coalesce(array_agg(id order by created_at desc, id desc), array[]::uuid[])
  into fetched_ids
  from (
    select posts.id, posts.created_at
    from public.beauty_posts posts
    where posts.profile_id = profile_row.id
      and posts.deleted_at is null
      and posts.moderation_status = 'visible'
      and (
        posts.visibility = 'public'
        or posts.author_user_id = actor_user_id
      )
      and (
        p_cursor_created_at is null
        or posts.created_at < p_cursor_created_at
        or (
          posts.created_at = p_cursor_created_at
          and (p_cursor_post_id is null or posts.id < p_cursor_post_id)
        )
      )
    order by posts.created_at desc, posts.id desc
    limit clean_page_size + 1
  ) ordered_posts;

  fetched_count := coalesce(array_length(fetched_ids, 1), 0);

  if fetched_count = 0 then
    return jsonb_build_object(
      'ok', true,
      'items', '[]'::jsonb,
      'hasMore', false,
      'nextCursor', null
    );
  end if;

  page_ids := fetched_ids[1:clean_page_size];

  with page_posts as (
    select
      posts.id,
      posts.profile_id,
      posts.post_type,
      posts.caption,
      posts.visibility,
      posts.created_at,
      posts.updated_at,
      posts.edited_at,
      profiles.id as author_profile_id,
      coalesce(
        nullif(btrim(users.display_name), ''),
        nullif(btrim(concat_ws(' ', users.first_name, users.last_name)), ''),
        'Reylumi customer'
      ) as author_display_name,
      users.avatar_url as author_avatar_url
    from public.beauty_posts posts
    join public.beauty_profiles profiles on profiles.id = posts.profile_id
    join public.users users on users.id = posts.author_user_id
    where posts.id = any(coalesce(page_ids, array[]::uuid[]))
  ),
  media_by_post as (
    select
      media.post_id,
      jsonb_agg(
        jsonb_build_object(
          'id', media.id,
          'role', media.role,
          'bucket', media.bucket,
          'objectPath', media.object_path,
          'displayOrder', media.display_order,
          'width', media.width,
          'height', media.height,
          'mimeType', media.mime_type
        )
        order by media.display_order, media.created_at, media.id
      ) as media
    from public.beauty_post_media media
    join page_posts on page_posts.id = media.post_id
    group by media.post_id
  ),
  attribution_by_post as (
    select
      attributions.post_id,
      jsonb_build_object(
        'salonId', salons.id,
        'salonName', coalesce(nullif(btrim(settings.business_name), ''), salons.name),
        'staffId', staff.id,
        'staffName', staff.display_name,
        'source', attributions.source
      ) as attribution
    from public.beauty_post_attributions attributions
    join page_posts on page_posts.id = attributions.post_id
    join public.locations salons on salons.id = attributions.salon_id
    left join public.salon_settings settings on settings.salon_id = salons.id
    left join public.staff staff on staff.id = attributions.staff_id
  ),
  verification_by_post as (
    select
      verifications.post_id,
      jsonb_build_object(
        'state', verifications.state,
        'method', verifications.method,
        'verifiedAt', verifications.verified_at
      ) as verification
    from public.beauty_post_verifications verifications
    join page_posts on page_posts.id = verifications.post_id
  ),
  reward_ranked as (
    select
      rewards.*,
      row_number() over (
        partition by rewards.post_id
        order by rewards.created_at desc, rewards.id desc
      ) as reward_rank
    from public.beauty_reward_events rewards
    join page_posts on page_posts.id = rewards.post_id
    where rewards.status = 'issued'
  ),
  reward_by_post as (
    select
      rewards.post_id,
      jsonb_build_object(
        'status', rewards.status,
        'rewardType', rewards.reward_type,
        'pointsAmount', rewards.points_amount,
        'creditAmount', rewards.credit_amount,
        'createdAt', rewards.created_at
      ) as reward
    from reward_ranked rewards
    where rewards.reward_rank = 1
  )
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', page_posts.id,
        'profileId', page_posts.profile_id,
        'type', page_posts.post_type,
        'caption', page_posts.caption,
        'visibility', page_posts.visibility,
        'createdAt', page_posts.created_at,
        'updatedAt', page_posts.updated_at,
        'editedAt', page_posts.edited_at,
        'author', jsonb_build_object(
          'profileId', page_posts.author_profile_id,
          'displayName', page_posts.author_display_name,
          'avatarUrl', page_posts.author_avatar_url
        ),
        'media', coalesce(media_by_post.media, '[]'::jsonb),
        'attribution', attribution_by_post.attribution,
        'verification', verification_by_post.verification,
        'reward', reward_by_post.reward
      )
      order by page_posts.created_at desc, page_posts.id desc
    ),
    '[]'::jsonb
  )
  into items
  from page_posts
  left join media_by_post on media_by_post.post_id = page_posts.id
  left join attribution_by_post on attribution_by_post.post_id = page_posts.id
  left join verification_by_post on verification_by_post.post_id = page_posts.id
  left join reward_by_post on reward_by_post.post_id = page_posts.id;

  if fetched_count > clean_page_size then
    select posts.created_at, posts.id
    into cursor_created_at, cursor_post_id
    from public.beauty_posts posts
    where posts.id = page_ids[clean_page_size]
    limit 1;
  end if;

  return jsonb_build_object(
    'ok', true,
    'items', items,
    'hasMore', fetched_count > clean_page_size,
    'nextCursor', case
      when fetched_count > clean_page_size and cursor_created_at is not null
      then jsonb_build_object('createdAt', cursor_created_at, 'postId', cursor_post_id)
      else null
    end
  );
end;
$$;

create or replace function public.get_beauty_recent_visit_candidates(p_limit integer default 8)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  with actor as (
    select public.current_public_user_id() as user_id
  ),
  candidates as (
    select
      1 as priority,
      'receipt'::text as source,
      tickets.id as source_id,
      coalesce(tickets.closed_at, tickets.opened_at) as occurred_at,
      salons.id as salon_id,
      coalesce(nullif(btrim(settings.business_name), ''), salons.name) as salon_name,
      ticket_staff.id as staff_id,
      ticket_staff.display_name as staff_name
    from actor
    join public.customers customers on customers.customer_user_id = actor.user_id
    join public.pos_tickets tickets
      on tickets.customer_id = customers.id
     and tickets.salon_id = customers.location_id
    join public.locations salons on salons.id = tickets.salon_id
    left join public.salon_settings settings on settings.salon_id = salons.id
    left join lateral (
      select staff.id, staff.display_name
      from public.pos_ticket_items items
      join public.staff staff on staff.id = items.assigned_staff_id
      where items.pos_ticket_id = tickets.id
        and items.salon_id = tickets.salon_id
        and coalesce(items.is_removed, false) = false
      order by items.created_at desc, items.id desc
      limit 1
    ) ticket_staff on true
    where actor.user_id is not null
      and tickets.status = 'closed'
      and coalesce(tickets.closed_at, tickets.opened_at) >= now() - public.beauty_verification_window()

    union all

    select
      2 as priority,
      'booking'::text as source,
      bookings.id as source_id,
      bookings.start_at as occurred_at,
      salons.id as salon_id,
      coalesce(nullif(btrim(settings.business_name), ''), salons.name) as salon_name,
      coalesce(booking_staff.id, line_staff.id) as staff_id,
      coalesce(booking_staff.display_name, line_staff.display_name) as staff_name
    from actor
    join public.bookings bookings on bookings.customer_user_id = actor.user_id
    join public.locations salons on salons.id = bookings.salon_id
    left join public.salon_settings settings on settings.salon_id = salons.id
    left join public.staff booking_staff on booking_staff.id = bookings.staff_id
    left join lateral (
      select staff.id, staff.display_name
      from public.booking_lines lines
      join public.staff staff on staff.id = coalesce(lines.performed_by_staff_id, lines.assigned_staff_id)
      where lines.booking_id = bookings.id
        and lines.salon_id = bookings.salon_id
        and lines.line_status <> 'cancelled'
      order by lines.display_order, lines.created_at, lines.id
      limit 1
    ) line_staff on true
    where actor.user_id is not null
      and bookings.status = 'completed'
      and bookings.start_at >= now() - public.beauty_verification_window()

    union all

    select
      3 as priority,
      'check_in'::text as source,
      bookings.id as source_id,
      bookings.start_at as occurred_at,
      salons.id as salon_id,
      coalesce(nullif(btrim(settings.business_name), ''), salons.name) as salon_name,
      coalesce(booking_staff.id, line_staff.id) as staff_id,
      coalesce(booking_staff.display_name, line_staff.display_name) as staff_name
    from actor
    join public.bookings bookings on bookings.customer_user_id = actor.user_id
    join public.locations salons on salons.id = bookings.salon_id
    left join public.salon_settings settings on settings.salon_id = salons.id
    left join public.staff booking_staff on booking_staff.id = bookings.staff_id
    left join lateral (
      select staff.id, staff.display_name
      from public.booking_lines lines
      join public.staff staff on staff.id = coalesce(lines.performed_by_staff_id, lines.assigned_staff_id)
      where lines.booking_id = bookings.id
        and lines.salon_id = bookings.salon_id
        and lines.line_status <> 'cancelled'
      order by lines.display_order, lines.created_at, lines.id
      limit 1
    ) line_staff on true
    where actor.user_id is not null
      and bookings.status in ('checked_in', 'in_service')
      and bookings.start_at >= now() - public.beauty_verification_window()
      and bookings.start_at <= now() + interval '1 day'
  ),
  ordered as (
    select *
    from candidates
    order by priority asc, occurred_at desc, source_id desc
    limit greatest(1, least(coalesce(p_limit, 8), 12))
  )
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'visitKey', md5(source || ':' || source_id::text || ':' || coalesce((select user_id from actor)::text, '')),
        'source', source,
        'occurredAt', occurred_at,
        'salonId', salon_id,
        'salonName', salon_name,
        'staffId', staff_id,
        'staffName', staff_name
      )
      order by priority asc, occurred_at desc, source_id desc
    ),
    '[]'::jsonb
  )
  from ordered
$$;

create or replace function public.search_beauty_attribution_salons(
  p_query text default '',
  p_limit integer default 8
)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  with normalized as (
    select nullif(btrim(coalesce(p_query, '')), '') as query_text,
           greatest(1, least(coalesce(p_limit, 8), 12)) as clean_limit
  ),
  salon_rows as (
    select
      salons.id,
      coalesce(nullif(btrim(settings.business_name), ''), salons.name) as name,
      coalesce(settings.city, salons.city) as city,
      coalesce(settings.state, salons.state) as state
    from normalized
    join public.locations salons on salons.status = 'active'
    left join public.salon_settings settings on settings.salon_id = salons.id
    where public.salon_profile_public_salon_exists(salons.id)
      and (
        normalized.query_text is null
        or coalesce(settings.business_name, salons.name) ilike '%' || normalized.query_text || '%'
        or coalesce(settings.city, salons.city, '') ilike '%' || normalized.query_text || '%'
      )
    order by
      case when normalized.query_text is not null and coalesce(settings.business_name, salons.name) ilike normalized.query_text || '%' then 0 else 1 end,
      coalesce(settings.business_name, salons.name)
    limit (select clean_limit from normalized)
  )
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'salonId', salon_rows.id,
        'salonName', salon_rows.name,
        'city', salon_rows.city,
        'state', salon_rows.state,
        'staff', coalesce((
          select jsonb_agg(
            jsonb_build_object(
              'staffId', staff.id,
              'staffName', staff.display_name
            )
            order by staff.profile_display_order, staff.display_name
          )
          from public.staff staff
          where staff.salon_id = salon_rows.id
            and staff.is_active = true
            and (
              staff.public_profile_visible = true
              or public.user_can_manage_salon(salon_rows.id)
            )
        ), '[]'::jsonb)
      )
      order by salon_rows.name
    ),
    '[]'::jsonb
  )
  from salon_rows
$$;

alter table public.beauty_profiles enable row level security;
alter table public.beauty_posts enable row level security;
alter table public.beauty_post_media enable row level security;
alter table public.beauty_post_attributions enable row level security;
alter table public.beauty_post_verifications enable row level security;
alter table public.beauty_reward_policies enable row level security;
alter table public.beauty_reward_events enable row level security;

create policy "beauty_profiles_owner_read" on public.beauty_profiles
for select to authenticated
using (user_id = public.current_public_user_id());

create policy "beauty_profiles_owner_insert" on public.beauty_profiles
for insert to authenticated
with check (user_id = public.current_public_user_id());

create policy "beauty_profiles_owner_update" on public.beauty_profiles
for update to authenticated
using (user_id = public.current_public_user_id())
with check (user_id = public.current_public_user_id());

create policy "beauty_posts_public_or_owner_read" on public.beauty_posts
for select to anon, authenticated
using (
  (
    visibility = 'public'
    and moderation_status = 'visible'
    and deleted_at is null
    and exists (
      select 1
      from public.beauty_profiles profiles
      where profiles.id = beauty_posts.profile_id
        and profiles.visibility = 'public'
    )
  )
  or author_user_id = public.current_public_user_id()
);

create policy "beauty_post_media_public_or_owner_read" on public.beauty_post_media
for select to anon, authenticated
using (
  public.beauty_public_post_exists(post_id)
  or exists (
    select 1
    from public.beauty_posts posts
    where posts.id = beauty_post_media.post_id
      and posts.author_user_id = public.current_public_user_id()
  )
);

create policy "beauty_post_attributions_public_or_owner_read" on public.beauty_post_attributions
for select to anon, authenticated
using (
  public.beauty_public_post_exists(post_id)
  or exists (
    select 1
    from public.beauty_posts posts
    where posts.id = beauty_post_attributions.post_id
      and posts.author_user_id = public.current_public_user_id()
  )
);

create policy "beauty_post_verifications_owner_read" on public.beauty_post_verifications
for select to authenticated
using (
  exists (
    select 1
    from public.beauty_posts posts
    where posts.id = beauty_post_verifications.post_id
      and posts.author_user_id = public.current_public_user_id()
  )
);

create policy "beauty_reward_policies_authenticated_read" on public.beauty_reward_policies
for select to authenticated
using (status = 'active');

create policy "beauty_reward_events_owner_read" on public.beauty_reward_events
for select to authenticated
using (user_id = public.current_public_user_id());

create policy "public_read_active_beauty_media_objects" on storage.objects
for select to anon, authenticated
using (
  bucket_id = 'beauty-profile-media'
  and (
    split_part(name, '/', 1) = public.current_public_user_id()::text
    or exists (
      select 1
      from public.beauty_post_media media
      join public.beauty_posts posts on posts.id = media.post_id
      join public.beauty_profiles profiles on profiles.id = posts.profile_id
      where media.bucket = storage.objects.bucket_id
        and media.object_path = storage.objects.name
        and posts.deleted_at is null
        and posts.visibility = 'public'
        and posts.moderation_status = 'visible'
        and profiles.visibility = 'public'
    )
    or exists (
      select 1
      from public.beauty_profiles profiles
      where profiles.cover_media_path = storage.objects.name
        and profiles.visibility = 'public'
    )
  )
);

create policy "beauty_users_insert_own_media_objects" on storage.objects
for insert to authenticated
with check (
  bucket_id = 'beauty-profile-media'
  and (storage.foldername(name))[1] = public.current_public_user_id()::text
  and (storage.foldername(name))[2] = 'beauty'
  and (storage.foldername(name))[3] in ('image', 'before', 'after', 'cover')
  and array_length(storage.foldername(name), 1) = 3
  and name like '%.webp'
);

create policy "beauty_users_update_own_media_objects" on storage.objects
for update to authenticated
using (
  bucket_id = 'beauty-profile-media'
  and (storage.foldername(name))[1] = public.current_public_user_id()::text
  and (storage.foldername(name))[2] = 'beauty'
  and (storage.foldername(name))[3] in ('image', 'before', 'after', 'cover')
  and array_length(storage.foldername(name), 1) = 3
)
with check (
  bucket_id = 'beauty-profile-media'
  and (storage.foldername(name))[1] = public.current_public_user_id()::text
  and (storage.foldername(name))[2] = 'beauty'
  and (storage.foldername(name))[3] in ('image', 'before', 'after', 'cover')
  and array_length(storage.foldername(name), 1) = 3
  and name like '%.webp'
);

create policy "beauty_users_delete_own_media_objects" on storage.objects
for delete to authenticated
using (
  bucket_id = 'beauty-profile-media'
  and (storage.foldername(name))[1] = public.current_public_user_id()::text
  and (storage.foldername(name))[2] = 'beauty'
  and (storage.foldername(name))[3] in ('image', 'before', 'after', 'cover')
  and array_length(storage.foldername(name), 1) = 3
);

grant select, insert, update on table public.beauty_profiles to authenticated;
revoke all on function public.beauty_jsonb_positive_int(jsonb, text) from public;
revoke all on function public.beauty_verification_window() from public;
revoke all on function public.beauty_public_post_exists(uuid) from public;
revoke all on function public.validate_beauty_post_attribution() from public;
revoke all on function public.find_beauty_visit_proof(uuid, uuid, uuid) from public;
revoke all on function public.create_beauty_post(text, text, text, jsonb, uuid, uuid, text) from public;
revoke all on function public.update_beauty_post_caption(uuid, text) from public;
revoke all on function public.delete_beauty_post(uuid) from public;
revoke all on function public.list_beauty_timeline(uuid, timestamptz, uuid, integer) from public;
revoke all on function public.get_beauty_recent_visit_candidates(integer) from public;
revoke all on function public.search_beauty_attribution_salons(text, integer) from public;
grant execute on function public.beauty_public_post_exists(uuid) to anon, authenticated;
grant execute on function public.create_beauty_post(text, text, text, jsonb, uuid, uuid, text) to authenticated;
grant execute on function public.update_beauty_post_caption(uuid, text) to authenticated;
grant execute on function public.delete_beauty_post(uuid) to authenticated;
grant execute on function public.list_beauty_timeline(uuid, timestamptz, uuid, integer) to anon, authenticated;
grant execute on function public.get_beauty_recent_visit_candidates(integer) to authenticated;
grant execute on function public.search_beauty_attribution_salons(text, integer) to authenticated;
