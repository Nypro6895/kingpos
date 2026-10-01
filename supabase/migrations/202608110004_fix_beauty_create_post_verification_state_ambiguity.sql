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
  end if;

  return jsonb_build_object(
    'ok', true,
    'postId', created_post_id,
    'profileId', created_profile_id,
    'verificationState', derived_verification_state,
    'verificationMethod', derived_verification_method,
    'rewardIssued', issued_reward_id is not null
  );
exception
  when unique_violation then
    return jsonb_build_object('ok', false, 'code', 'duplicate_media_or_reward', 'message', 'This upload or reward was already used.');
  when others then
    return jsonb_build_object('ok', false, 'code', 'database_error', 'message', SQLERRM);
end;
$$;

revoke all on function public.create_beauty_post(text, text, text, jsonb, uuid, uuid, text) from public;
grant execute on function public.create_beauty_post(text, text, text, jsonb, uuid, uuid, text) to authenticated;
