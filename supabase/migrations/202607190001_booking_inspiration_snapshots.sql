create table if not exists public.booking_inspirations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  salon_id uuid not null references public.locations(id) on delete cascade,
  booking_id uuid not null references public.bookings(id) on delete cascade,
  booking_line_id uuid references public.booking_lines(id) on delete set null,
  source_type text not null default 'salon_profile_look',
  source_content_id uuid,
  source_salon_id uuid not null references public.locations(id) on delete restrict,
  source_media_asset_id uuid references public.salon_profile_media_assets(id) on delete set null,
  source_media_bucket text not null default 'salon-profile-media',
  source_media_path text,
  source_media_width integer,
  source_media_height integer,
  source_media_mime_type text,
  credited_staff_id uuid references public.staff(id) on delete set null,
  service_id uuid references public.services(id) on delete set null,
  source_title_snapshot text,
  source_caption_snapshot text,
  source_booking_note_snapshot text,
  service_name_snapshot text,
  credited_staff_name_snapshot text,
  salon_name_snapshot text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint booking_inspirations_source_type_check check (
    source_type in ('salon_profile_look')
  ),
  constraint booking_inspirations_source_media_bucket_check check (
    btrim(source_media_bucket) <> ''
  )
);

comment on table public.booking_inspirations is
  'Durable public content inspiration snapshots attached to customer bookings.';
comment on column public.booking_inspirations.source_content_id is
  'Untrusted public content id at booking time. Not a foreign key so historical snapshots survive source deletion.';
comment on column public.booking_inspirations.source_media_path is
  'Storage object path resolved through the salon profile media service, never a raw URL.';

create unique index if not exists booking_inspirations_booking_uidx
on public.booking_inspirations (booking_id);

create index if not exists booking_inspirations_source_idx
on public.booking_inspirations (source_type, source_content_id)
where source_content_id is not null;

create index if not exists booking_inspirations_salon_created_idx
on public.booking_inspirations (salon_id, created_at desc);

create index if not exists booking_inspirations_media_idx
on public.booking_inspirations (source_media_bucket, source_media_path)
where source_media_path is not null;

create index if not exists booking_inspirations_credited_staff_idx
on public.booking_inspirations (credited_staff_id, created_at desc)
where credited_staff_id is not null;

drop trigger if exists update_booking_inspirations_updated_at
on public.booking_inspirations;

create trigger update_booking_inspirations_updated_at
before update on public.booking_inspirations
for each row
execute function public.update_updated_at_column();

alter table public.booking_inspirations enable row level security;

drop policy if exists "Booking participants can view booking inspirations"
on public.booking_inspirations;

create policy "Booking participants can view booking inspirations"
on public.booking_inspirations
for select
to authenticated
using (public.current_user_can_view_booking(booking_id));

revoke all on public.booking_inspirations from anon;
grant select on public.booking_inspirations to authenticated;

create or replace function public.capture_booking_inspiration_snapshot(
  p_booking_id uuid,
  p_source_reference_type text,
  p_source_reference_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  booking_row public.bookings%rowtype;
  look_row record;
  media_row public.salon_profile_media_assets%rowtype;
  matching_line public.booking_lines%rowtype;
  source_type_value text;
begin
  source_type_value := nullif(btrim(coalesce(p_source_reference_type, '')), '');

  if source_type_value is null or p_source_reference_id is null then
    return;
  end if;

  if source_type_value <> 'salon_profile_look' then
    return;
  end if;

  select *
  into booking_row
  from public.bookings
  where bookings.id = p_booking_id;

  if booking_row.id is null then
    return;
  end if;

  select
    looks.id,
    looks.organization_id,
    looks.salon_id,
    looks.service_id,
    looks.recommended_staff_id,
    nullif(btrim(looks.title), '') as title,
    nullif(btrim(coalesce(looks.caption, looks.emotional_description, '')), '') as caption,
    nullif(btrim(looks.booking_note), '') as booking_note,
    nullif(btrim(looks.media_path), '') as media_path,
    looks.status,
    nullif(btrim(services.name), '') as service_name,
    nullif(btrim(credited_staff.display_name), '') as credited_staff_name,
    coalesce(nullif(btrim(settings.business_name), ''), locations.name) as salon_name
  into look_row
  from public.salon_profile_looks looks
  join public.locations
    on locations.id = looks.salon_id
    and locations.organization_id = looks.organization_id
  left join public.salon_settings settings
    on settings.salon_id = looks.salon_id
    and settings.organization_id = looks.organization_id
  left join public.services services
    on services.id = looks.service_id
    and services.salon_id = looks.salon_id
    and services.organization_id = looks.organization_id
  left join public.staff credited_staff
    on credited_staff.id = looks.recommended_staff_id
    and credited_staff.salon_id = looks.salon_id
    and credited_staff.organization_id = looks.organization_id
  where looks.id = p_source_reference_id
    and looks.organization_id = booking_row.organization_id
    and looks.salon_id = booking_row.salon_id
  limit 1;

  if look_row.id is null then
    return;
  end if;

  if look_row.media_path is not null then
    select *
    into media_row
    from public.salon_profile_media_assets assets
    where assets.bucket = 'salon-profile-media'
      and assets.object_path = look_row.media_path
      and assets.organization_id = booking_row.organization_id
      and assets.salon_id = booking_row.salon_id
    order by assets.created_at desc
    limit 1;
  end if;

  if look_row.service_id is not null then
    select *
    into matching_line
    from public.booking_lines lines
    where lines.booking_id = booking_row.id
      and lines.organization_id = booking_row.organization_id
      and lines.salon_id = booking_row.salon_id
      and lines.line_type = 'service'
      and lines.service_id = look_row.service_id
    order by lines.display_order, lines.created_at
    limit 1;
  end if;

  insert into public.booking_inspirations (
    organization_id,
    salon_id,
    booking_id,
    booking_line_id,
    source_type,
    source_content_id,
    source_salon_id,
    source_media_asset_id,
    source_media_bucket,
    source_media_path,
    source_media_width,
    source_media_height,
    source_media_mime_type,
    credited_staff_id,
    service_id,
    source_title_snapshot,
    source_caption_snapshot,
    source_booking_note_snapshot,
    service_name_snapshot,
    credited_staff_name_snapshot,
    salon_name_snapshot,
    metadata
  )
  values (
    booking_row.organization_id,
    booking_row.salon_id,
    booking_row.id,
    matching_line.id,
    'salon_profile_look',
    look_row.id,
    look_row.salon_id,
    media_row.id,
    coalesce(nullif(btrim(media_row.bucket), ''), 'salon-profile-media'),
    look_row.media_path,
    media_row.width,
    media_row.height,
    nullif(btrim(media_row.mime_type), ''),
    look_row.recommended_staff_id,
    look_row.service_id,
    look_row.title,
    look_row.caption,
    look_row.booking_note,
    look_row.service_name,
    look_row.credited_staff_name,
    look_row.salon_name,
    jsonb_build_object(
      'captured_by', 'create_public_booking',
      'source_status_at_booking', look_row.status,
      'selected_source_service_at_booking', matching_line.id is not null,
      'selected_service_changed', matching_line.id is null and look_row.service_id is not null
    )
  )
  on conflict (booking_id) do nothing;
end;
$$;

revoke all on function public.capture_booking_inspiration_snapshot(uuid, text, uuid)
from public, anon, authenticated;

do $$
declare
  function_definition text;
begin
  select pg_get_functiondef(
    'public.create_public_booking(uuid,timestamptz,timestamptz,text,text,text,text,text,text,text,text,uuid,jsonb)'::regprocedure
  )
  into function_definition;

  if function_definition is null then
    raise exception 'create_public_booking function is missing.';
  end if;

  if function_definition not like '%capture_booking_inspiration_snapshot%' then
    function_definition := replace(
      function_definition,
      E'  return jsonb_build_object(\n    ''ok'', true,',
      E'  perform public.capture_booking_inspiration_snapshot(\n    booking_id,\n    nullif(btrim(coalesce(p_source_reference_type, '''')), ''''),\n    p_source_reference_id\n  );\n\n  return jsonb_build_object(\n    ''ok'', true,'
    );
  end if;

  if function_definition not like '%capture_booking_inspiration_snapshot%' then
    raise exception 'create_public_booking inspiration snapshot patch failed.';
  end if;

  execute function_definition;
end;
$$;

do $$
declare
  function_definition text;
begin
  select pg_get_functiondef(
    'public.get_public_booking_context(uuid,timestamptz,timestamptz)'::regprocedure
  )
  into function_definition;

  if function_definition is null then
    raise exception 'get_public_booking_context function is missing.';
  end if;

  if function_definition not like '%''booking_note'', nullif(btrim(looks.booking_note), '''')%' then
    function_definition := replace(
      function_definition,
      $needle$        jsonb_build_object(
          'id', looks.id,
          'title', looks.title,
          'service_id', looks.service_id,
          'recommended_staff_id', looks.recommended_staff_id
        )
        order by looks.is_pinned desc, looks.published_at desc nulls last
      )
      from public.salon_profile_looks looks
      where looks.salon_id = target_salon_id$needle$,
      $replacement$        jsonb_build_object(
          'id', looks.id,
          'title', looks.title,
          'caption', nullif(btrim(coalesce(looks.caption, looks.emotional_description, '')), ''),
          'booking_note', nullif(btrim(looks.booking_note), ''),
          'media_path', nullif(btrim(looks.media_path), ''),
          'service_id', looks.service_id,
          'service_name', services.name,
          'recommended_staff_id', looks.recommended_staff_id,
          'recommended_staff_name', recommended_staff.display_name
        )
        order by looks.is_pinned desc, looks.published_at desc nulls last
      )
      from public.salon_profile_looks looks
      left join public.services services
        on services.id = looks.service_id
        and services.salon_id = looks.salon_id
        and services.organization_id = looks.organization_id
        and services.is_active = true
        and services.online_booking_enabled = true
      left join public.staff recommended_staff
        on recommended_staff.id = looks.recommended_staff_id
        and recommended_staff.salon_id = looks.salon_id
        and recommended_staff.organization_id = looks.organization_id
      where looks.salon_id = target_salon_id$replacement$
    );
  end if;

  if function_definition not like '%''booking_note'', nullif(btrim(looks.booking_note), '''')%'
    or function_definition not like '%recommended_staff.display_name%'
  then
    raise exception 'get_public_booking_context inspiration look patch failed.';
  end if;

  execute function_definition;
end;
$$;

create or replace function public.cleanup_salon_profile_media_assets(
  dry_run boolean default true,
  older_than interval default interval '7 days'
)
returns table (
  candidate_count bigint,
  candidate_bytes bigint,
  dry_run_result boolean
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if dry_run = false then
    update public.salon_profile_media_assets assets
    set
      status = 'deleted',
      deleted_at = coalesce(assets.deleted_at, now()),
      updated_at = now()
    where assets.status in ('pending', 'orphaned')
      and coalesce(assets.orphaned_at, assets.expires_at, assets.created_at) < now() - older_than
      and not exists (
        select 1
        from public.salon_settings settings
        where settings.public_profile_logo_path = assets.object_path
          or settings.public_profile_cover_path = assets.object_path
      )
      and not exists (
        select 1
        from public.salon_profile_looks looks
        where looks.media_path = assets.object_path
      )
      and not exists (
        select 1
        from public.salon_profile_updates updates
        where updates.media_path = assets.object_path
      )
      and not exists (
        select 1
        from public.staff staff
        where staff.public_profile_photo_path = assets.object_path
      )
      and not exists (
        select 1
        from public.booking_inspirations inspirations
        where inspirations.source_media_bucket = assets.bucket
          and inspirations.source_media_path = assets.object_path
      );
  end if;

  return query
  select
    count(*)::bigint,
    coalesce(sum(coalesce(assets.processed_bytes, assets.original_bytes, 0)), 0)::bigint,
    dry_run
  from public.salon_profile_media_assets assets
  where assets.status in ('pending', 'orphaned')
    and coalesce(assets.orphaned_at, assets.expires_at, assets.created_at) < now() - older_than
    and not exists (
      select 1
      from public.salon_settings settings
      where settings.public_profile_logo_path = assets.object_path
        or settings.public_profile_cover_path = assets.object_path
    )
    and not exists (
      select 1
      from public.salon_profile_looks looks
      where looks.media_path = assets.object_path
    )
    and not exists (
      select 1
      from public.salon_profile_updates updates
      where updates.media_path = assets.object_path
    )
    and not exists (
      select 1
      from public.staff staff
      where staff.public_profile_photo_path = assets.object_path
    )
    and not exists (
      select 1
      from public.booking_inspirations inspirations
      where inspirations.source_media_bucket = assets.bucket
        and inspirations.source_media_path = assets.object_path
    );
end;
$$;

grant execute on function public.cleanup_salon_profile_media_assets(boolean, interval)
to authenticated;

drop function if exists public.get_public_explore_inspiration(
  timestamptz,
  uuid,
  integer
);

create function public.get_public_explore_inspiration(
  p_cursor_published_at timestamptz default null,
  p_cursor_media_id uuid default null,
  p_page_size integer default 18
)
returns table (
  content_id uuid,
  content_type text,
  media_id uuid,
  salon_id uuid,
  salon_name text,
  salon_city text,
  salon_state text,
  salon_phone text,
  media_path text,
  image_width integer,
  image_height integer,
  aspect_ratio numeric,
  caption_excerpt text,
  service_name text,
  service_category text,
  published_at timestamptz,
  author_display_name text,
  author_is_anonymous boolean,
  booking_enabled boolean,
  bookable_service_id uuid,
  booking_href text
)
language sql
stable
security definer
set search_path = public, storage
as $$
  with params as (
    select greatest(1, least(coalesce(p_page_size, 18), 24)) as page_size
  ),
  look_items as (
    select
      looks.id as content_id,
      'look'::text as content_type,
      coalesce(assets.id, looks.id) as media_id,
      looks.salon_id,
      coalesce(nullif(btrim(settings.business_name), ''), locations.name) as salon_name,
      coalesce(nullif(btrim(settings.city), ''), locations.city) as salon_city,
      coalesce(nullif(btrim(settings.state), ''), locations.state) as salon_state,
      coalesce(nullif(btrim(settings.phone), ''), locations.phone) as salon_phone,
      looks.media_path,
      assets.width as image_width,
      assets.height as image_height,
      case
        when assets.width is not null and assets.height is not null and assets.height > 0
        then round((assets.width::numeric / assets.height::numeric), 4)
        else null::numeric
      end as aspect_ratio,
      nullif(
        left(
          btrim(coalesce(looks.caption, looks.emotional_description, '')),
          180
        ),
        ''
      ) as caption_excerpt,
      nullif(btrim(services.name), '') as service_name,
      nullif(btrim(services.category), '') as service_category,
      coalesce(looks.published_at, looks.created_at) as published_at,
      coalesce(
        author_staff.display_name,
        nullif(btrim(settings.business_name), ''),
        locations.name,
        'Salon team'
      ) as author_display_name,
      (author_staff.id is null) as author_is_anonymous,
      look_booking.service_id is not null as booking_enabled,
      look_booking.service_id as bookable_service_id,
      case
        when look_booking.service_id is not null
        then '/book/' || looks.salon_id::text || '?source=explore&inspiration=' || looks.id::text
        else null::text
      end as booking_href
    from public.salon_profile_looks looks
    join public.locations locations
      on locations.id = looks.salon_id
      and locations.organization_id = looks.organization_id
      and locations.status = 'active'
    join public.salon_settings settings
      on settings.salon_id = looks.salon_id
      and settings.organization_id = looks.organization_id
    left join public.salon_profile_media_assets assets
      on assets.bucket = 'salon-profile-media'
      and assets.object_path = looks.media_path
      and assets.organization_id = looks.organization_id
      and assets.salon_id = looks.salon_id
      and assets.attached_entity_type = 'look'
      and assets.attached_entity_id = looks.id
      and assets.purpose = 'look'
    join storage.objects storage_objects
      on storage_objects.bucket_id = coalesce(assets.bucket, 'salon-profile-media')
      and storage_objects.name = looks.media_path
    left join public.services services
      on services.id = looks.service_id
      and services.salon_id = looks.salon_id
      and services.organization_id = looks.organization_id
      and services.is_active = true
    left join public.staff author_staff
      on author_staff.id = looks.author_staff_id
      and author_staff.salon_id = looks.salon_id
      and public.staff_has_effective_public_profile(author_staff)
    left join lateral (
      select services.id as service_id
      from public.booking_settings booking_settings
      join public.services services
        on services.id = looks.service_id
        and services.salon_id = looks.salon_id
        and services.organization_id = looks.organization_id
        and services.is_active = true
        and services.online_booking_enabled = true
      where booking_settings.salon_id = looks.salon_id
        and booking_settings.organization_id = looks.organization_id
        and booking_settings.booking_enabled = true
        and booking_settings.online_booking_visible = true
        and exists (
          select 1
          from public.staff_service_assignments assignments
          join public.staff bookable_staff
            on bookable_staff.id = assignments.staff_id
            and bookable_staff.salon_id = assignments.salon_id
            and bookable_staff.organization_id = assignments.organization_id
            and bookable_staff.is_active = true
            and bookable_staff.public_profile_visible = true
            and bookable_staff.owner_public_enabled = true
            and bookable_staff.staff_public_consent_status = 'granted'
            and bookable_staff.online_booking_enabled = true
          where assignments.salon_id = looks.salon_id
            and assignments.organization_id = looks.organization_id
            and assignments.service_id = looks.service_id
            and assignments.is_active = true
            and assignments.online_bookable = true
        )
      limit 1
    ) look_booking on true
    where looks.status = 'published'
      and looks.media_path is not null
      and public.salon_profile_public_salon_exists(looks.salon_id)
      and (
        looks.media_path like looks.salon_id::text || '/looks/%'
        or (
          split_part(looks.media_path, '/', 2) = looks.salon_id::text
          and split_part(looks.media_path, '/', 3) = 'looks'
        )
      )
      and (
        assets.id is null
        or (
          assets.status = 'active'
          and assets.deleted_at is null
          and assets.quarantined_at is null
        )
      )
      and (
        coalesce(
          nullif(btrim(assets.mime_type), ''),
          nullif(btrim(storage_objects.metadata ->> 'mimetype'), '')
        ) in ('image/jpeg', 'image/png', 'image/webp')
        or lower(looks.media_path) like '%.jpg'
        or lower(looks.media_path) like '%.jpeg'
        or lower(looks.media_path) like '%.png'
        or lower(looks.media_path) like '%.webp'
      )
  ),
  update_items as (
    select
      updates.id as content_id,
      'update'::text as content_type,
      coalesce(assets.id, updates.id) as media_id,
      updates.salon_id,
      coalesce(nullif(btrim(settings.business_name), ''), locations.name) as salon_name,
      coalesce(nullif(btrim(settings.city), ''), locations.city) as salon_city,
      coalesce(nullif(btrim(settings.state), ''), locations.state) as salon_state,
      coalesce(nullif(btrim(settings.phone), ''), locations.phone) as salon_phone,
      updates.media_path,
      assets.width as image_width,
      assets.height as image_height,
      case
        when assets.width is not null and assets.height is not null and assets.height > 0
        then round((assets.width::numeric / assets.height::numeric), 4)
        else null::numeric
      end as aspect_ratio,
      nullif(
        left(
          btrim(coalesce(updates.caption, updates.summary, '')),
          180
        ),
        ''
      ) as caption_excerpt,
      nullif(btrim(services.name), '') as service_name,
      nullif(btrim(services.category), '') as service_category,
      coalesce(updates.published_at, updates.created_at) as published_at,
      coalesce(
        author_staff.display_name,
        nullif(btrim(settings.business_name), ''),
        locations.name,
        'Salon team'
      ) as author_display_name,
      (author_staff.id is null) as author_is_anonymous,
      false as booking_enabled,
      null::uuid as bookable_service_id,
      null::text as booking_href
    from public.salon_profile_updates updates
    join public.locations locations
      on locations.id = updates.salon_id
      and locations.organization_id = updates.organization_id
      and locations.status = 'active'
    join public.salon_settings settings
      on settings.salon_id = updates.salon_id
      and settings.organization_id = updates.organization_id
    left join public.salon_profile_media_assets assets
      on assets.bucket = 'salon-profile-media'
      and assets.object_path = updates.media_path
      and assets.organization_id = updates.organization_id
      and assets.salon_id = updates.salon_id
      and assets.attached_entity_type = 'update'
      and assets.attached_entity_id = updates.id
      and assets.purpose = 'update'
    join storage.objects storage_objects
      on storage_objects.bucket_id = coalesce(assets.bucket, 'salon-profile-media')
      and storage_objects.name = updates.media_path
    left join public.services services
      on services.id = updates.service_id
      and services.salon_id = updates.salon_id
      and services.organization_id = updates.organization_id
      and services.is_active = true
    left join public.staff author_staff
      on author_staff.id = updates.author_staff_id
      and author_staff.salon_id = updates.salon_id
      and public.staff_has_effective_public_profile(author_staff)
    where updates.status = 'published'
      and updates.media_path is not null
      and public.salon_profile_public_salon_exists(updates.salon_id)
      and updates.media_path like updates.salon_id::text || '/updates/%'
      and (
        assets.id is null
        or (
          assets.status = 'active'
          and assets.deleted_at is null
          and assets.quarantined_at is null
        )
      )
      and (
        coalesce(
          nullif(btrim(assets.mime_type), ''),
          nullif(btrim(storage_objects.metadata ->> 'mimetype'), '')
        ) in ('image/jpeg', 'image/png', 'image/webp')
        or lower(updates.media_path) like '%.jpg'
        or lower(updates.media_path) like '%.jpeg'
        or lower(updates.media_path) like '%.png'
        or lower(updates.media_path) like '%.webp'
      )
  ),
  combined as (
    select * from look_items
    union all
    select * from update_items
  ),
  deduped as (
    select distinct on (combined.media_id)
      combined.*
    from combined
    order by
      combined.media_id,
      combined.published_at desc,
      combined.content_id desc
  ),
  ranked as (
    select
      deduped.*,
      row_number() over (
        partition by deduped.salon_id
        order by deduped.published_at desc, deduped.media_id desc
      ) as salon_item_rank
    from deduped
  )
  select
    ranked.content_id,
    ranked.content_type,
    ranked.media_id,
    ranked.salon_id,
    ranked.salon_name,
    ranked.salon_city,
    ranked.salon_state,
    ranked.salon_phone,
    ranked.media_path,
    ranked.image_width,
    ranked.image_height,
    ranked.aspect_ratio,
    ranked.caption_excerpt,
    ranked.service_name,
    ranked.service_category,
    ranked.published_at,
    ranked.author_display_name,
    ranked.author_is_anonymous,
    ranked.booking_enabled,
    ranked.bookable_service_id,
    ranked.booking_href
  from ranked, params
  where (
      p_cursor_published_at is null
      or p_cursor_media_id is null
      or ranked.published_at < p_cursor_published_at
      or (
        ranked.published_at = p_cursor_published_at
        and ranked.media_id < p_cursor_media_id
      )
    )
    and (
      p_cursor_published_at is not null
      or ranked.salon_item_rank <= 3
    )
  order by
    ranked.published_at desc,
    ranked.media_id desc
  limit (select page_size + 1 from params);
$$;

comment on function public.get_public_explore_inspiration(
  timestamptz,
  uuid,
  integer
) is 'Public, cursor-paginated Explore inspiration feed from published salon profile looks and updates. Look booking links are emitted only when the mapped service is online-bookable and the salon booking page is enabled.';

revoke all on function public.get_public_explore_inspiration(
  timestamptz,
  uuid,
  integer
) from public;

grant execute on function public.get_public_explore_inspiration(
  timestamptz,
  uuid,
  integer
) to anon, authenticated;

create or replace function public.get_public_booking_by_manage_token(raw_token text)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((
    select jsonb_build_object(
      'ok', true,
      'booking',
      jsonb_build_object(
        'id', bookings.id,
        'salon_id', bookings.salon_id,
        'status', public.normalize_booking_status(bookings.status),
        'confirmation_status', bookings.confirmation_status,
        'source', bookings.source,
        'start_at', bookings.start_at,
        'end_at', bookings.end_at,
        'timezone', bookings.salon_timezone_snapshot,
        'public_notes', bookings.public_notes,
        'cancellation_reason', bookings.cancellation_reason,
        'cancelled_at', bookings.cancelled_at,
        'can_change',
          public.normalize_booking_status(bookings.status)
            not in ('completed', 'cancelled', 'no_show')
          and bookings.start_at > now(),
        'cancellation_window_minutes',
          coalesce(
            (bookings.cancellation_policy_snapshot
              ->> 'cancellation_window_minutes')::integer,
            1440
          )
      ),
      'salon',
      jsonb_build_object(
        'name',
          coalesce(nullif(btrim(salon_settings.business_name), ''), locations.name),
        'phone', coalesce(nullif(btrim(salon_settings.phone), ''), locations.phone),
        'address_line1',
          coalesce(
            nullif(btrim(salon_settings.address_line1), ''),
            locations.address_line1
          ),
        'city', coalesce(nullif(btrim(salon_settings.city), ''), locations.city),
        'state', coalesce(nullif(btrim(salon_settings.state), ''), locations.state),
        'timezone', bookings.salon_timezone_snapshot
      ),
      'customer',
      jsonb_build_object(
        'name', customers.name,
        'phone', customers.phone,
        'email', customers.email
      ),
      'inspiration',
      (
        select jsonb_build_object(
          'id', inspirations.id,
          'booking_id', inspirations.booking_id,
          'booking_line_id', inspirations.booking_line_id,
          'source_type', inspirations.source_type,
          'source_content_id', inspirations.source_content_id,
          'source_salon_id', inspirations.source_salon_id,
          'source_media_asset_id', inspirations.source_media_asset_id,
          'source_media_bucket', inspirations.source_media_bucket,
          'source_media_path', inspirations.source_media_path,
          'source_media_width', inspirations.source_media_width,
          'source_media_height', inspirations.source_media_height,
          'source_media_mime_type', inspirations.source_media_mime_type,
          'credited_staff_id', inspirations.credited_staff_id,
          'service_id', inspirations.service_id,
          'source_title_snapshot', inspirations.source_title_snapshot,
          'source_caption_snapshot', inspirations.source_caption_snapshot,
          'source_booking_note_snapshot', inspirations.source_booking_note_snapshot,
          'service_name_snapshot', inspirations.service_name_snapshot,
          'credited_staff_name_snapshot', inspirations.credited_staff_name_snapshot,
          'salon_name_snapshot', inspirations.salon_name_snapshot,
          'metadata', inspirations.metadata,
          'created_at', inspirations.created_at,
          'updated_at', inspirations.updated_at
        )
        from public.booking_inspirations inspirations
        where inspirations.booking_id = bookings.id
        limit 1
      ),
      'lines',
      coalesce((
        select jsonb_agg(
          jsonb_build_object(
            'id', booking_lines.id,
            'line_type', booking_lines.line_type,
            'parent_service_id', parent_lines.service_id,
            'service_id', booking_lines.service_id,
            'service_name', booking_lines.service_name_snapshot,
            'category', booking_lines.service_category_snapshot,
            'unit_price', booking_lines.unit_price,
            'duration_minutes', booking_lines.duration_minutes,
            'line_total', booking_lines.line_total,
            'scheduled_start_at', booking_lines.scheduled_start_at,
            'scheduled_end_at', booking_lines.scheduled_end_at,
            'staff_id', booking_lines.assigned_staff_id,
            'staff_name', staff.display_name,
            'staff_avatar_path',
              nullif(btrim(staff.public_profile_photo_path), '')
          )
          order by booking_lines.display_order
        )
        from public.booking_lines
        left join public.booking_lines parent_lines
          on parent_lines.id = booking_lines.parent_booking_line_id
          and parent_lines.booking_id = booking_lines.booking_id
        left join public.staff
          on staff.id = booking_lines.assigned_staff_id
        where booking_lines.booking_id = bookings.id
      ), '[]'::jsonb)
    )
    from public.bookings
    join public.locations
      on locations.id = bookings.salon_id
    left join public.salon_settings
      on salon_settings.salon_id = bookings.salon_id
      and salon_settings.organization_id = bookings.organization_id
    join public.customers
      on customers.id = bookings.customer_id
    where bookings.customer_cancellation_token_hash =
      public.public_booking_token_hash(raw_token)
    limit 1
  ), jsonb_build_object('ok', false, 'code', 'invalid_token'))
$$;

revoke all on function public.get_public_booking_by_manage_token(text) from public;
grant execute on function public.get_public_booking_by_manage_token(text)
to anon, authenticated;
