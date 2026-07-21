alter table public.staff
add column if not exists public_profile_photo_path text;

alter table public.staff
add column if not exists public_bio text;

alter table public.staff
add column if not exists specialties text[] not null default '{}'::text[];

alter table public.staff
add column if not exists public_profile_visible boolean not null default true;

comment on column public.staff.public_profile_photo_path is
  'Storage path for the public staff profile avatar used on Salon Profile.';

comment on column public.staff.public_bio is
  'Short public staff biography shown on Salon Profile.';

comment on column public.staff.specialties is
  'Public staff specialties shown on Salon Profile.';

comment on column public.staff.public_profile_visible is
  'Controls whether this active staff profile appears on public Salon Profile.';

alter table public.salon_profile_looks
add column if not exists created_by_user_id uuid references public.users(id) on delete set null;

alter table public.salon_profile_looks
add column if not exists author_staff_id uuid references public.staff(id) on delete set null;

alter table public.salon_profile_looks
add column if not exists author_display_name text;

alter table public.salon_profile_looks
add column if not exists author_avatar_path text;

alter table public.salon_profile_updates
add column if not exists created_by_user_id uuid references public.users(id) on delete set null;

alter table public.salon_profile_updates
add column if not exists author_staff_id uuid references public.staff(id) on delete set null;

alter table public.salon_profile_updates
add column if not exists author_display_name text;

alter table public.salon_profile_updates
add column if not exists author_avatar_path text;

update public.salon_profile_looks
set created_by_user_id = author_user_id
where created_by_user_id is null
  and author_user_id is not null;

update public.salon_profile_updates
set created_by_user_id = author_user_id
where created_by_user_id is null
  and author_user_id is not null;

create index if not exists salon_profile_looks_author_staff_idx
on public.salon_profile_looks(salon_id, author_staff_id, published_at desc)
where author_staff_id is not null;

create index if not exists salon_profile_updates_author_staff_idx
on public.salon_profile_updates(salon_id, author_staff_id, published_at desc)
where author_staff_id is not null;

create table if not exists public.salon_profile_plan_catalog (
  id text primary key,
  name text not null,
  description text,
  is_default boolean not null default false,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint salon_profile_plan_catalog_name_not_blank check (length(btrim(name)) > 0)
);

create unique index if not exists salon_profile_plan_catalog_one_default_idx
on public.salon_profile_plan_catalog(is_default)
where is_default = true;

drop trigger if exists update_salon_profile_plan_catalog_updated_at
on public.salon_profile_plan_catalog;

create trigger update_salon_profile_plan_catalog_updated_at
before update on public.salon_profile_plan_catalog
for each row
execute function public.update_updated_at_column();

create table if not exists public.salon_profile_entitlement_definitions (
  code text primary key,
  name text not null,
  description text,
  value_type text not null default 'integer',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint salon_profile_entitlement_definitions_value_type_check check (
    value_type in ('boolean', 'integer', 'bytes')
  )
);

drop trigger if exists update_salon_profile_entitlement_definitions_updated_at
on public.salon_profile_entitlement_definitions;

create trigger update_salon_profile_entitlement_definitions_updated_at
before update on public.salon_profile_entitlement_definitions
for each row
execute function public.update_updated_at_column();

create table if not exists public.salon_profile_plan_entitlements (
  plan_id text not null references public.salon_profile_plan_catalog(id) on delete cascade,
  entitlement_code text not null references public.salon_profile_entitlement_definitions(code) on delete cascade,
  limit_value bigint not null,
  period text not null default 'none',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (plan_id, entitlement_code),
  constraint salon_profile_plan_entitlements_limit_nonnegative check (limit_value >= 0),
  constraint salon_profile_plan_entitlements_period_check check (
    period in ('none', 'day', 'month')
  )
);

drop trigger if exists update_salon_profile_plan_entitlements_updated_at
on public.salon_profile_plan_entitlements;

create trigger update_salon_profile_plan_entitlements_updated_at
before update on public.salon_profile_plan_entitlements
for each row
execute function public.update_updated_at_column();

create table if not exists public.salon_profile_subscriptions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  salon_id uuid not null references public.locations(id) on delete cascade,
  plan_id text not null references public.salon_profile_plan_catalog(id),
  status text not null default 'active',
  starts_at timestamptz not null default now(),
  ends_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint salon_profile_subscriptions_status_check check (
    status in ('active', 'cancelled', 'expired', 'trialing')
  ),
  constraint salon_profile_subscriptions_time_check check (
    ends_at is null or ends_at > starts_at
  )
);

create unique index if not exists salon_profile_subscriptions_one_active_idx
on public.salon_profile_subscriptions(salon_id)
where status in ('active', 'trialing')
  and ends_at is null;

create index if not exists salon_profile_subscriptions_org_idx
on public.salon_profile_subscriptions(organization_id, salon_id);

drop trigger if exists update_salon_profile_subscriptions_updated_at
on public.salon_profile_subscriptions;

create trigger update_salon_profile_subscriptions_updated_at
before update on public.salon_profile_subscriptions
for each row
execute function public.update_updated_at_column();

create table if not exists public.salon_profile_entitlement_overrides (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  salon_id uuid not null references public.locations(id) on delete cascade,
  entitlement_code text not null references public.salon_profile_entitlement_definitions(code) on delete cascade,
  limit_value bigint not null,
  period text not null default 'none',
  reason text,
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint salon_profile_entitlement_overrides_unique unique (salon_id, entitlement_code),
  constraint salon_profile_entitlement_overrides_limit_nonnegative check (limit_value >= 0),
  constraint salon_profile_entitlement_overrides_period_check check (
    period in ('none', 'day', 'month')
  )
);

create index if not exists salon_profile_entitlement_overrides_org_idx
on public.salon_profile_entitlement_overrides(organization_id, salon_id);

drop trigger if exists update_salon_profile_entitlement_overrides_updated_at
on public.salon_profile_entitlement_overrides;

create trigger update_salon_profile_entitlement_overrides_updated_at
before update on public.salon_profile_entitlement_overrides
for each row
execute function public.update_updated_at_column();

create table if not exists public.salon_profile_usage_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  salon_id uuid not null references public.locations(id) on delete cascade,
  event_type text not null,
  entity_type text,
  entity_id uuid,
  quantity integer not null default 1,
  idempotency_key text,
  occurred_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  constraint salon_profile_usage_events_quantity_positive check (quantity > 0)
);

create unique index if not exists salon_profile_usage_events_idempotency_idx
on public.salon_profile_usage_events(salon_id, idempotency_key)
where idempotency_key is not null;

create unique index if not exists salon_profile_usage_events_entity_idx
on public.salon_profile_usage_events(salon_id, event_type, entity_type, entity_id)
where entity_id is not null;

create index if not exists salon_profile_usage_events_period_idx
on public.salon_profile_usage_events(salon_id, event_type, occurred_at desc);

insert into public.salon_profile_plan_catalog (id, name, description, is_default, is_active)
values (
  'grandfathered',
  'Grandfathered',
  'Backward-compatible default limits for existing salons.',
  true,
  true
)
on conflict (id) do update
set
  name = excluded.name,
  description = excluded.description,
  is_default = excluded.is_default,
  is_active = excluded.is_active,
  updated_at = now();

insert into public.salon_profile_entitlement_definitions (code, name, description, value_type)
values
  ('posts_per_day', 'Posts per day', 'Published Salon Profile posts allowed per UTC day.', 'integer'),
  ('posts_per_month', 'Posts per month', 'Published Salon Profile posts allowed per UTC month.', 'integer'),
  ('storage_bytes', 'Storage bytes', 'Processed Salon Profile media storage allowed.', 'bytes'),
  ('max_media_per_post', 'Max media per post', 'Maximum media attachments per Salon Profile post.', 'integer'),
  ('review_media_enabled', 'Review media enabled', 'Whether customer review media is enabled.', 'boolean'),
  ('verified_business_enabled', 'Verified business enabled', 'Whether verified business profile features are enabled.', 'boolean'),
  ('staff_portfolio_enabled', 'Staff portfolio enabled', 'Whether staff public portfolio features are enabled.', 'boolean')
on conflict (code) do update
set
  name = excluded.name,
  description = excluded.description,
  value_type = excluded.value_type,
  updated_at = now();

insert into public.salon_profile_plan_entitlements (
  plan_id,
  entitlement_code,
  limit_value,
  period
)
values
  ('grandfathered', 'posts_per_day', 1000, 'day'),
  ('grandfathered', 'posts_per_month', 30000, 'month'),
  ('grandfathered', 'storage_bytes', 107374182400, 'none'),
  ('grandfathered', 'max_media_per_post', 1, 'none'),
  ('grandfathered', 'review_media_enabled', 0, 'none'),
  ('grandfathered', 'verified_business_enabled', 1, 'none'),
  ('grandfathered', 'staff_portfolio_enabled', 1, 'none')
on conflict (plan_id, entitlement_code) do update
set
  limit_value = excluded.limit_value,
  period = excluded.period,
  updated_at = now();

drop function if exists public.get_salon_profile_entitlement_limit(uuid, text);
create function public.get_salon_profile_entitlement_limit(
  target_salon_id uuid,
  entitlement_key text
)
returns bigint
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  active_plan_id text;
  resolved_limit bigint;
begin
  select overrides.limit_value
  into resolved_limit
  from public.salon_profile_entitlement_overrides overrides
  where overrides.salon_id = target_salon_id
    and overrides.entitlement_code = entitlement_key
    and (overrides.expires_at is null or overrides.expires_at > now())
  limit 1;

  if resolved_limit is not null then
    return resolved_limit;
  end if;

  select subscriptions.plan_id
  into active_plan_id
  from public.salon_profile_subscriptions subscriptions
  where subscriptions.salon_id = target_salon_id
    and subscriptions.status in ('active', 'trialing')
    and (subscriptions.ends_at is null or subscriptions.ends_at > now())
  order by subscriptions.starts_at desc
  limit 1;

  if active_plan_id is null then
    select plans.id
    into active_plan_id
    from public.salon_profile_plan_catalog plans
    where plans.is_default = true
      and plans.is_active = true
    limit 1;
  end if;

  select entitlements.limit_value
  into resolved_limit
  from public.salon_profile_plan_entitlements entitlements
  where entitlements.plan_id = active_plan_id
    and entitlements.entitlement_code = entitlement_key
  limit 1;

  return coalesce(resolved_limit, 9223372036854775807);
end;
$$;

grant execute on function public.get_salon_profile_entitlement_limit(uuid, text)
to anon, authenticated;

create table if not exists public.salon_profile_media_assets (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  salon_id uuid not null references public.locations(id) on delete cascade,
  uploaded_by_user_id uuid references public.users(id) on delete set null,
  bucket text not null default 'salon-profile-media',
  object_path text not null,
  purpose text not null,
  mime_type text,
  original_bytes bigint,
  processed_bytes bigint,
  width integer,
  height integer,
  checksum text,
  status text not null default 'pending',
  attached_entity_type text,
  attached_entity_id uuid,
  upload_intent text,
  expires_at timestamptz not null default (now() + interval '1 day'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  attached_at timestamptz,
  orphaned_at timestamptz,
  deleted_at timestamptz,
  quarantined_at timestamptz,
  constraint salon_profile_media_assets_unique_path unique (bucket, object_path),
  constraint salon_profile_media_assets_status_check check (
    status in ('pending', 'active', 'orphaned', 'deleted', 'quarantined')
  ),
  constraint salon_profile_media_assets_purpose_check check (
    purpose in ('cover', 'logo', 'look', 'update', 'review', 'staff_avatar')
  ),
  constraint salon_profile_media_assets_upload_intent_check check (
    upload_intent is null or upload_intent in ('content', 'identity', 'review', 'staff')
  ),
  constraint salon_profile_media_assets_bytes_nonnegative check (
    (original_bytes is null or original_bytes >= 0)
    and (processed_bytes is null or processed_bytes >= 0)
  ),
  constraint salon_profile_media_assets_dimensions_positive check (
    (width is null or width > 0)
    and (height is null or height > 0)
  )
);

create index if not exists salon_profile_media_assets_salon_status_idx
on public.salon_profile_media_assets(salon_id, status, created_at desc);

create index if not exists salon_profile_media_assets_attached_idx
on public.salon_profile_media_assets(attached_entity_type, attached_entity_id)
where attached_entity_id is not null;

drop trigger if exists update_salon_profile_media_assets_updated_at
on public.salon_profile_media_assets;

create trigger update_salon_profile_media_assets_updated_at
before update on public.salon_profile_media_assets
for each row
execute function public.update_updated_at_column();

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

  return public.user_has_organization_permission(
    target_organization_id,
    coalesce(nullif(required_permissions, array[]::text[]), permission_codes)
  );
end;
$$;

grant execute on function public.user_can_manage_salon_profile_media(text, text[])
to authenticated;

drop function if exists public.get_salon_profile_media_usage(uuid);
create function public.get_salon_profile_media_usage(target_salon_id uuid)
returns table (
  used_bytes bigint,
  asset_count bigint,
  orphan_bytes bigint,
  storage_quota_bytes bigint,
  remaining_bytes bigint
)
language sql
stable
security definer
set search_path = public
as $$
  select
    coalesce(sum(coalesce(processed_bytes, original_bytes, 0)) filter (
      where status in ('active', 'pending')
    ), 0)::bigint as used_bytes,
    count(*) filter (where status in ('active', 'pending'))::bigint as asset_count,
    coalesce(sum(coalesce(processed_bytes, original_bytes, 0)) filter (
      where status = 'orphaned'
    ), 0)::bigint as orphan_bytes,
    public.get_salon_profile_entitlement_limit(target_salon_id, 'storage_bytes') as storage_quota_bytes,
    greatest(
      public.get_salon_profile_entitlement_limit(target_salon_id, 'storage_bytes')
      - coalesce(sum(coalesce(processed_bytes, original_bytes, 0)) filter (
        where status in ('active', 'pending')
      ), 0)::bigint,
      0
    )::bigint as remaining_bytes
  from public.salon_profile_media_assets
  where salon_id = target_salon_id;
$$;

grant execute on function public.get_salon_profile_media_usage(uuid)
to authenticated;

drop function if exists public.cleanup_salon_profile_media_assets(boolean, interval);
create function public.cleanup_salon_profile_media_assets(
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
    );
end;
$$;

grant execute on function public.cleanup_salon_profile_media_assets(boolean, interval)
to authenticated;

create table if not exists public.salon_profile_hashtags (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  display_name text not null,
  created_at timestamptz not null default now(),
  constraint salon_profile_hashtags_slug_check check (
    slug ~ '^[[:alnum:]_]{2,48}$'
  )
);

create table if not exists public.salon_profile_look_hashtags (
  look_id uuid not null references public.salon_profile_looks(id) on delete cascade,
  hashtag_id uuid not null references public.salon_profile_hashtags(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  salon_id uuid not null references public.locations(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (look_id, hashtag_id)
);

create index if not exists salon_profile_look_hashtags_tag_idx
on public.salon_profile_look_hashtags(hashtag_id, salon_id);

create table if not exists public.salon_profile_update_hashtags (
  update_id uuid not null references public.salon_profile_updates(id) on delete cascade,
  hashtag_id uuid not null references public.salon_profile_hashtags(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  salon_id uuid not null references public.locations(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (update_id, hashtag_id)
);

create index if not exists salon_profile_update_hashtags_tag_idx
on public.salon_profile_update_hashtags(hashtag_id, salon_id);

drop function if exists public.normalize_salon_profile_hashtag(text);
create function public.normalize_salon_profile_hashtag(raw_tag text)
returns text
language sql
immutable
as $$
  select nullif(
    left(
      regexp_replace(
        lower(
          trim(
            both '_'
            from regexp_replace(
              trim(leading '#' from btrim(coalesce(raw_tag, ''))),
              '[^[:alnum:]_]+',
              '_',
              'g'
            )
          )
        ),
        '_+',
        '_',
        'g'
      ),
      48
    ),
    ''
  )
$$;

create table if not exists public.salon_profile_reviews (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  salon_id uuid not null references public.locations(id) on delete cascade,
  author_user_id uuid not null references public.users(id) on delete cascade,
  rating integer not null,
  title text,
  body text not null,
  verified_booking_id uuid references public.bookings(id) on delete set null,
  verification_status text not null default 'unverified',
  moderation_status text not null default 'visible',
  moderation_reason text,
  edited_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint salon_profile_reviews_rating_check check (rating between 1 and 5),
  constraint salon_profile_reviews_body_not_blank check (length(btrim(body)) > 0),
  constraint salon_profile_reviews_verification_status_check check (
    verification_status in ('verified', 'unverified')
  ),
  constraint salon_profile_reviews_moderation_status_check check (
    moderation_status in ('visible', 'hidden', 'reported', 'withdrawn')
  )
);

create unique index if not exists salon_profile_reviews_one_active_user_review_idx
on public.salon_profile_reviews(salon_id, author_user_id)
where moderation_status in ('visible', 'reported');

create index if not exists salon_profile_reviews_public_idx
on public.salon_profile_reviews(salon_id, moderation_status, created_at desc);

create table if not exists public.salon_profile_review_replies (
  id uuid primary key default gen_random_uuid(),
  review_id uuid not null references public.salon_profile_reviews(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  salon_id uuid not null references public.locations(id) on delete cascade,
  author_user_id uuid not null references public.users(id) on delete cascade,
  body text not null,
  moderation_status text not null default 'visible',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint salon_profile_review_replies_body_not_blank check (length(btrim(body)) > 0),
  constraint salon_profile_review_replies_status_check check (
    moderation_status in ('visible', 'hidden', 'withdrawn')
  )
);

create unique index if not exists salon_profile_review_replies_one_visible_idx
on public.salon_profile_review_replies(review_id)
where moderation_status = 'visible';

alter table public.bookings
add column if not exists customer_user_id uuid references public.users(id) on delete set null;

create index if not exists bookings_customer_user_id_idx
on public.bookings(customer_user_id)
where customer_user_id is not null;

drop function if exists public.salon_profile_user_is_affiliated(uuid);
create function public.salon_profile_user_is_affiliated(target_salon_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.locations locations
    where locations.id = target_salon_id
      and public.user_has_organization_permission(
        locations.organization_id,
        array[
          'salon_profile.manage',
          'salon_profile.content.manage',
          'staff.manage'
        ]::text[]
      )
  )
  or exists (
    select 1
    from public.staff staff
    left join public.users account_user
      on account_user.id = staff.account_user_id
    left join public.users current_account
      on current_account.id = public.current_public_user_id()
    where staff.salon_id = target_salon_id
      and staff.is_active = true
      and (
        staff.account_user_id = public.current_public_user_id()
        or account_user.auth_user_id = auth.uid()
        or staff.user_id = auth.uid()
        or staff.user_id = current_account.auth_user_id
      )
  )
$$;

grant execute on function public.salon_profile_user_is_affiliated(uuid)
to authenticated;

drop function if exists public.validate_salon_profile_review();
create function public.validate_salon_profile_review()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  booking_row public.bookings%rowtype;
begin
  if tg_op = 'UPDATE' and (
    new.organization_id is distinct from old.organization_id
    or new.salon_id is distinct from old.salon_id
    or new.author_user_id is distinct from old.author_user_id
    or new.verified_booking_id is distinct from old.verified_booking_id
  ) then
    raise exception 'Review ownership, salon, and verification booking cannot be changed.';
  end if;

  if tg_op = 'INSERT' and new.author_user_id is distinct from public.current_public_user_id() then
    raise exception 'Review author must be the current user.';
  end if;

  if public.salon_profile_user_is_affiliated(new.salon_id) then
    raise exception 'Owners and staff cannot review their own salon.';
  end if;

  if not exists (
    select 1
    from public.locations locations
    where locations.id = new.salon_id
      and locations.organization_id = new.organization_id
  ) then
    raise exception 'Review salon must belong to the review organization.';
  end if;

  if new.verified_booking_id is not null then
    select *
    into booking_row
    from public.bookings bookings
    where bookings.id = new.verified_booking_id;

    if booking_row.id is null
      or booking_row.salon_id is distinct from new.salon_id
      or booking_row.organization_id is distinct from new.organization_id
      or booking_row.customer_user_id is distinct from new.author_user_id
      or booking_row.status <> 'completed'
    then
      raise exception 'Verified reviews require a completed booking linked to your account.';
    end if;

    new.verification_status := 'verified';
  else
    new.verification_status := 'unverified';
  end if;

  if tg_op = 'UPDATE' and (
    new.rating is distinct from old.rating
    or new.title is distinct from old.title
    or new.body is distinct from old.body
  ) then
    new.edited_at := now();
  end if;

  return new;
end;
$$;

drop trigger if exists validate_salon_profile_review
on public.salon_profile_reviews;

create trigger validate_salon_profile_review
before insert or update on public.salon_profile_reviews
for each row
execute function public.validate_salon_profile_review();

drop trigger if exists update_salon_profile_reviews_updated_at
on public.salon_profile_reviews;

create trigger update_salon_profile_reviews_updated_at
before update on public.salon_profile_reviews
for each row
execute function public.update_updated_at_column();

drop function if exists public.validate_salon_profile_review_reply();
create function public.validate_salon_profile_review_reply()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  review_row public.salon_profile_reviews%rowtype;
begin
  if tg_op = 'UPDATE' and (
    new.review_id is distinct from old.review_id
    or new.organization_id is distinct from old.organization_id
    or new.salon_id is distinct from old.salon_id
    or new.author_user_id is distinct from old.author_user_id
  ) then
    raise exception 'Review reply ownership and target cannot be changed.';
  end if;

  select *
  into review_row
  from public.salon_profile_reviews reviews
  where reviews.id = new.review_id;

  if review_row.id is null
    or review_row.organization_id is distinct from new.organization_id
    or review_row.salon_id is distinct from new.salon_id
  then
    raise exception 'Review reply must target a review from the same salon.';
  end if;

  if tg_op = 'INSERT'
    and not public.user_has_organization_permission(
      new.organization_id,
      array['salon_profile.manage', 'salon_profile.content.manage']::text[]
    )
  then
    raise exception 'Only salon profile managers can reply to reviews.';
  end if;

  return new;
end;
$$;

drop trigger if exists validate_salon_profile_review_reply
on public.salon_profile_review_replies;

create trigger validate_salon_profile_review_reply
before insert or update on public.salon_profile_review_replies
for each row
execute function public.validate_salon_profile_review_reply();

drop trigger if exists update_salon_profile_review_replies_updated_at
on public.salon_profile_review_replies;

create trigger update_salon_profile_review_replies_updated_at
before update on public.salon_profile_review_replies
for each row
execute function public.update_updated_at_column();

drop function if exists public.enforce_salon_profile_post_quota();
create function public.enforce_salon_profile_post_quota()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  day_limit bigint;
  month_limit bigint;
  day_count bigint;
  month_count bigint;
  entity_label text;
begin
  if new.status <> 'published'
    or (tg_op = 'UPDATE' and old.status = 'published')
  then
    return new;
  end if;

  perform pg_advisory_xact_lock(hashtextextended(new.salon_id::text, 4242));

  day_limit := public.get_salon_profile_entitlement_limit(new.salon_id, 'posts_per_day');
  month_limit := public.get_salon_profile_entitlement_limit(new.salon_id, 'posts_per_month');

  select coalesce(sum(quantity), 0)::bigint
  into day_count
  from public.salon_profile_usage_events events
  where events.salon_id = new.salon_id
    and events.event_type = 'post_published'
    and events.occurred_at >= date_trunc('day', timezone('utc', now())) at time zone 'utc';

  select coalesce(sum(quantity), 0)::bigint
  into month_count
  from public.salon_profile_usage_events events
  where events.salon_id = new.salon_id
    and events.event_type = 'post_published'
    and events.occurred_at >= date_trunc('month', timezone('utc', now())) at time zone 'utc';

  if day_count >= day_limit then
    raise exception 'Daily Salon Profile post limit reached.';
  end if;

  if month_count >= month_limit then
    raise exception 'Monthly Salon Profile post limit reached.';
  end if;

  entity_label := case tg_table_name
    when 'salon_profile_looks' then 'look'
    when 'salon_profile_updates' then 'update'
    else tg_table_name
  end;

  insert into public.salon_profile_usage_events (
    organization_id,
    salon_id,
    event_type,
    entity_type,
    entity_id,
    quantity,
    idempotency_key
  )
  values (
    new.organization_id,
    new.salon_id,
    'post_published',
    entity_label,
    new.id,
    1,
    'post_published:' || entity_label || ':' || new.id::text
  )
  on conflict do nothing;

  return new;
end;
$$;

drop trigger if exists enforce_salon_profile_look_quota
on public.salon_profile_looks;

create trigger enforce_salon_profile_look_quota
before insert or update of status on public.salon_profile_looks
for each row
execute function public.enforce_salon_profile_post_quota();

drop trigger if exists enforce_salon_profile_update_quota
on public.salon_profile_updates;

create trigger enforce_salon_profile_update_quota
before insert or update of status on public.salon_profile_updates
for each row
execute function public.enforce_salon_profile_post_quota();

drop function if exists public.get_salon_profile_quota_usage(uuid);
create function public.get_salon_profile_quota_usage(target_salon_id uuid)
returns table (
  posts_used_today bigint,
  posts_limit_today bigint,
  posts_used_month bigint,
  posts_limit_month bigint,
  storage_used_bytes bigint,
  storage_quota_bytes bigint,
  storage_remaining_bytes bigint
)
language sql
stable
security definer
set search_path = public
as $$
  select
    (
      select coalesce(sum(events.quantity), 0)::bigint
      from public.salon_profile_usage_events events
      where events.salon_id = target_salon_id
        and events.event_type = 'post_published'
        and events.occurred_at >= date_trunc('day', timezone('utc', now())) at time zone 'utc'
    ) as posts_used_today,
    public.get_salon_profile_entitlement_limit(target_salon_id, 'posts_per_day') as posts_limit_today,
    (
      select coalesce(sum(events.quantity), 0)::bigint
      from public.salon_profile_usage_events events
      where events.salon_id = target_salon_id
        and events.event_type = 'post_published'
        and events.occurred_at >= date_trunc('month', timezone('utc', now())) at time zone 'utc'
    ) as posts_used_month,
    public.get_salon_profile_entitlement_limit(target_salon_id, 'posts_per_month') as posts_limit_month,
    usage.used_bytes as storage_used_bytes,
    usage.storage_quota_bytes,
    usage.remaining_bytes as storage_remaining_bytes
  from public.get_salon_profile_media_usage(target_salon_id) usage;
$$;

grant execute on function public.get_salon_profile_quota_usage(uuid)
to authenticated;

create or replace function public.validate_salon_profile_look_scope()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'UPDATE' and (
    new.organization_id is distinct from old.organization_id
    or new.salon_id is distinct from old.salon_id
  ) then
    raise exception 'Salon profile look organization and salon cannot be changed.';
  end if;

  if not exists (
    select 1
    from public.locations
    where locations.id = new.salon_id
      and locations.organization_id = new.organization_id
  ) then
    raise exception 'Salon profile look salon must belong to the organization.';
  end if;

  if new.service_id is not null and not exists (
    select 1
    from public.services
    where services.id = new.service_id
      and services.organization_id = new.organization_id
      and services.salon_id = new.salon_id
  ) then
    raise exception 'Salon profile look service must belong to the salon.';
  end if;

  if new.recommended_staff_id is not null and not exists (
    select 1
    from public.staff
    where staff.id = new.recommended_staff_id
      and staff.organization_id = new.organization_id
      and staff.salon_id = new.salon_id
  ) then
    raise exception 'Salon profile look staff must belong to the salon.';
  end if;

  if new.author_staff_id is not null and not exists (
    select 1
    from public.staff
    where staff.id = new.author_staff_id
      and staff.organization_id = new.organization_id
      and staff.salon_id = new.salon_id
  ) then
    raise exception 'Salon profile look author staff must belong to the salon.';
  end if;

  if new.created_by_user_id is null then
    new.created_by_user_id := new.author_user_id;
  end if;

  if new.status = 'published' and new.published_at is null then
    new.published_at := now();
  end if;

  return new;
end;
$$;

create or replace function public.validate_salon_profile_update_scope()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'UPDATE' and (
    new.organization_id is distinct from old.organization_id
    or new.salon_id is distinct from old.salon_id
  ) then
    raise exception 'Salon profile update organization and salon cannot be changed.';
  end if;

  if not exists (
    select 1
    from public.locations
    where locations.id = new.salon_id
      and locations.organization_id = new.organization_id
  ) then
    raise exception 'Salon profile update salon must belong to the organization.';
  end if;

  if new.service_id is not null and not exists (
    select 1
    from public.services
    where services.id = new.service_id
      and services.organization_id = new.organization_id
      and services.salon_id = new.salon_id
  ) then
    raise exception 'Salon profile update service must belong to the salon.';
  end if;

  if new.staff_id is not null and not exists (
    select 1
    from public.staff
    where staff.id = new.staff_id
      and staff.organization_id = new.organization_id
      and staff.salon_id = new.salon_id
  ) then
    raise exception 'Salon profile update staff must belong to the salon.';
  end if;

  if new.author_staff_id is not null and not exists (
    select 1
    from public.staff
    where staff.id = new.author_staff_id
      and staff.organization_id = new.organization_id
      and staff.salon_id = new.salon_id
  ) then
    raise exception 'Salon profile update author staff must belong to the salon.';
  end if;

  if new.created_by_user_id is null then
    new.created_by_user_id := new.author_user_id;
  end if;

  if new.status = 'published' and new.published_at is null then
    new.published_at := now();
  end if;

  return new;
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
    (
      select count(*)::bigint
      from public.salon_profile_looks looks
      where looks.salon_id = staff.salon_id
        and looks.author_staff_id = staff.id
        and looks.status = 'published'
    ) as portfolio_count
  from public.staff
  where staff.salon_id = target_salon_id
    and staff.is_active = true
    and staff.public_profile_visible = true
    and public.salon_profile_public_salon_exists(target_salon_id)
  order by staff.display_name asc;
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
    coalesce(recommended_staff.id, author_staff.id) as recommended_staff_id,
    coalesce(recommended_staff.display_name, author_staff.display_name) as recommended_staff_name,
    author_staff.id as author_staff_id,
    coalesce(
      nullif(btrim(looks.author_display_name), ''),
      author_staff.display_name,
      nullif(btrim(settings.business_name), ''),
      locations.name
    ) as author_display_name,
    coalesce(
      nullif(btrim(author_staff.public_profile_photo_path), ''),
      nullif(btrim(looks.author_avatar_path), '')
    ) as author_avatar_path,
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
  left join public.staff recommended_staff
    on recommended_staff.id = looks.recommended_staff_id
    and recommended_staff.salon_id = looks.salon_id
    and recommended_staff.is_active = true
  left join public.staff author_staff
    on author_staff.id = looks.author_staff_id
    and author_staff.salon_id = looks.salon_id
    and author_staff.is_active = true
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
    coalesce(update_staff.id, author_staff.id) as staff_id,
    coalesce(update_staff.display_name, author_staff.display_name) as staff_name,
    author_staff.id as author_staff_id,
    coalesce(
      nullif(btrim(updates.author_display_name), ''),
      author_staff.display_name,
      nullif(btrim(settings.business_name), ''),
      locations.name
    ) as author_display_name,
    coalesce(
      nullif(btrim(author_staff.public_profile_photo_path), ''),
      nullif(btrim(updates.author_avatar_path), '')
    ) as author_avatar_path,
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
  left join public.staff update_staff
    on update_staff.id = updates.staff_id
    and update_staff.salon_id = updates.salon_id
    and update_staff.is_active = true
  left join public.staff author_staff
    on author_staff.id = updates.author_staff_id
    and author_staff.salon_id = updates.salon_id
    and author_staff.is_active = true
  where updates.salon_id = target_salon_id
    and updates.status = 'published'
    and public.salon_profile_public_salon_exists(target_salon_id)
  order by
    updates.published_at desc nulls last,
    updates.created_at desc
  limit 24;
$$;

drop function if exists public.get_public_salon_profile_review_summary(uuid);
create function public.get_public_salon_profile_review_summary(target_salon_id uuid)
returns table (
  average_rating numeric,
  review_count bigint,
  verified_count bigint,
  rating_5_count bigint,
  rating_4_count bigint,
  rating_3_count bigint,
  rating_2_count bigint,
  rating_1_count bigint
)
language sql
stable
security definer
set search_path = public
as $$
  select
    round(avg(reviews.rating)::numeric, 2) as average_rating,
    count(*)::bigint as review_count,
    count(*) filter (where reviews.verification_status = 'verified')::bigint as verified_count,
    count(*) filter (where reviews.rating = 5)::bigint as rating_5_count,
    count(*) filter (where reviews.rating = 4)::bigint as rating_4_count,
    count(*) filter (where reviews.rating = 3)::bigint as rating_3_count,
    count(*) filter (where reviews.rating = 2)::bigint as rating_2_count,
    count(*) filter (where reviews.rating = 1)::bigint as rating_1_count
  from public.salon_profile_reviews reviews
  where reviews.salon_id = target_salon_id
    and reviews.moderation_status = 'visible'
    and public.salon_profile_public_salon_exists(target_salon_id);
$$;

drop function if exists public.get_public_salon_profile_reviews(uuid);
create function public.get_public_salon_profile_reviews(target_salon_id uuid)
returns table (
  id uuid,
  salon_id uuid,
  author_user_id uuid,
  author_display_name text,
  rating integer,
  title text,
  body text,
  verification_status text,
  verified_booking_id uuid,
  edited_at timestamptz,
  created_at timestamptz,
  updated_at timestamptz,
  reply_id uuid,
  reply_body text,
  reply_created_at timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select
    reviews.id,
    reviews.salon_id,
    reviews.author_user_id,
    coalesce(nullif(btrim(users.display_name), ''), 'KingPOS customer') as author_display_name,
    reviews.rating,
    nullif(btrim(reviews.title), '') as title,
    reviews.body,
    reviews.verification_status,
    reviews.verified_booking_id,
    reviews.edited_at,
    reviews.created_at,
    reviews.updated_at,
    replies.id as reply_id,
    replies.body as reply_body,
    replies.created_at as reply_created_at
  from public.salon_profile_reviews reviews
  left join public.users users
    on users.id = reviews.author_user_id
  left join public.salon_profile_review_replies replies
    on replies.review_id = reviews.id
    and replies.moderation_status = 'visible'
  where reviews.salon_id = target_salon_id
    and reviews.moderation_status = 'visible'
    and public.salon_profile_public_salon_exists(target_salon_id)
  order by
    case when reviews.verification_status = 'verified' then 0 else 1 end,
    reviews.created_at desc
  limit 50;
$$;

drop function if exists public.get_public_salon_profile_hashtag_salon_ids(text);
create function public.get_public_salon_profile_hashtag_salon_ids(search_tag text)
returns table (
  salon_id uuid,
  match_count bigint
)
language sql
stable
security definer
set search_path = public
as $$
  with normalized as (
    select public.normalize_salon_profile_hashtag(search_tag) as slug
  ),
  matches as (
    select rel.salon_id
    from public.salon_profile_look_hashtags rel
    join public.salon_profile_hashtags tags
      on tags.id = rel.hashtag_id
    join public.salon_profile_looks looks
      on looks.id = rel.look_id
    cross join normalized
    where tags.slug = normalized.slug
      and looks.status = 'published'
      and public.salon_profile_public_salon_exists(rel.salon_id)

    union all

    select rel.salon_id
    from public.salon_profile_update_hashtags rel
    join public.salon_profile_hashtags tags
      on tags.id = rel.hashtag_id
    join public.salon_profile_updates updates
      on updates.id = rel.update_id
    cross join normalized
    where tags.slug = normalized.slug
      and updates.status = 'published'
      and public.salon_profile_public_salon_exists(rel.salon_id)
  )
  select
    matches.salon_id,
    count(*)::bigint as match_count
  from matches
  group by matches.salon_id
  order by match_count desc, matches.salon_id asc;
$$;

drop function if exists public.search_public_explore_salons(
  text,
  text,
  text,
  double precision,
  double precision,
  integer,
  integer
);

create function public.search_public_explore_salons(
  p_query text default null,
  p_location text default null,
  p_category text default null,
  p_latitude double precision default null,
  p_longitude double precision default null,
  p_page integer default 1,
  p_page_size integer default 12
)
returns table (
  salon_id uuid,
  salon_name text,
  phone text,
  address_line1 text,
  address_line2 text,
  city text,
  state text,
  postal_code text,
  country text,
  description text,
  latitude double precision,
  longitude double precision,
  active_service_count integer,
  service_categories text[],
  service_names text[],
  profile_completeness integer,
  has_public_profile boolean,
  cover_image_path text,
  latest_media_created_at timestamptz,
  featured_service_name text,
  featured_service_category text,
  starting_price numeric,
  result_group text,
  match_type text,
  relevance_score integer,
  match_tier integer,
  distance_miles double precision,
  is_new boolean,
  group_total_count bigint,
  best_match_count bigint,
  nearby_count bigint,
  recommended_count bigint,
  total_count bigint
)
language sql
stable
security definer
set search_path = public
as $$
  with params as (
    select
      public.explore_normalize_text(p_query) as query_text,
      public.explore_normalize_text(p_category) as category_text,
      public.normalize_salon_profile_hashtag(p_query) as hashtag_slug
  ),
  base_results as (
    select
      results.salon_id,
      results.salon_name,
      results.phone,
      results.address_line1,
      results.address_line2,
      results.city,
      results.state,
      results.postal_code,
      results.country,
      results.description,
      results.latitude,
      results.longitude,
      results.active_service_count,
      results.service_categories,
      results.service_names,
      results.profile_completeness,
      public.salon_profile_public_salon_exists(results.salon_id) as has_public_profile,
      media.media_path as cover_image_path,
      media.media_created_at as latest_media_created_at,
      featured.featured_service_name,
      featured.featured_service_category,
      price.starting_price,
      results.result_group,
      results.match_type,
      results.relevance_score,
      results.match_tier,
      results.distance_miles,
      results.is_new,
      results.group_total_count,
      results.best_match_count,
      results.nearby_count,
      results.recommended_count,
      results.total_count
    from public.search_public_explore_salons_v2(
      p_query,
      public.explore_abbreviate_location_state(p_location),
      p_category,
      p_latitude,
      p_longitude,
      p_page,
      p_page_size
    ) as results
    cross join params
    left join lateral public.get_public_explore_salon_card_media(results.salon_id) media
      on true
    left join lateral (
      select
        nullif(btrim(services.name), '') as featured_service_name,
        nullif(btrim(services.category), '') as featured_service_category
      from public.services services
      where services.salon_id = results.salon_id
        and services.is_active = true
        and nullif(btrim(services.name), '') is not null
      order by
        case
          when params.category_text <> ''
            and public.explore_normalize_text(services.category) = params.category_text
          then 1
          when params.query_text <> ''
            and public.explore_normalize_text(services.name) = params.query_text
          then 2
          when params.query_text <> ''
            and public.explore_normalize_text(services.category) = params.query_text
          then 3
          when params.query_text <> ''
            and length(params.query_text) >= 3
            and public.explore_normalize_text(services.name) like '%' || params.query_text || '%'
          then 4
          when params.query_text <> ''
            and length(params.query_text) >= 3
            and public.explore_normalize_text(services.category) like '%' || params.query_text || '%'
          then 5
          else 6
        end,
        nullif(services.base_price, 0::numeric) asc nulls last,
        services.name asc
      limit 1
    ) featured on true
    left join lateral (
      select min(nullif(services.base_price, 0::numeric)) as starting_price
      from public.services services
      where services.salon_id = results.salon_id
        and services.is_active = true
    ) price on true
  ),
  hashtag_matches as (
    select
      tagged.salon_id,
      tagged.match_count
    from params
    join public.get_public_salon_profile_hashtag_salon_ids(params.hashtag_slug) tagged
      on params.hashtag_slug is not null
  ),
  hashtag_results as (
    select
      l.id as salon_id,
      coalesce(nullif(btrim(ss.business_name), ''), l.name) as salon_name,
      coalesce(nullif(btrim(ss.phone), ''), l.phone) as phone,
      coalesce(nullif(btrim(ss.address_line1), ''), l.address_line1) as address_line1,
      coalesce(nullif(btrim(ss.address_line2), ''), l.address_line2) as address_line2,
      coalesce(nullif(btrim(ss.city), ''), l.city) as city,
      coalesce(nullif(btrim(ss.state), ''), l.state) as state,
      coalesce(nullif(btrim(ss.postal_code), ''), l.postal_code) as postal_code,
      coalesce(nullif(btrim(ss.country), ''), l.country) as country,
      nullif(btrim(ss.business_description), '') as description,
      l.latitude,
      l.longitude,
      (
        select count(*)::integer
        from public.services services
        where services.salon_id = l.id
          and services.is_active = true
      ) as active_service_count,
      coalesce(
        (
          select array_agg(distinct nullif(btrim(services.category), ''))
          from public.services services
          where services.salon_id = l.id
            and services.is_active = true
            and nullif(btrim(services.category), '') is not null
        ),
        '{}'::text[]
      ) as service_categories,
      coalesce(
        (
          select array_agg(distinct nullif(btrim(services.name), ''))
          from public.services services
          where services.salon_id = l.id
            and services.is_active = true
            and nullif(btrim(services.name), '') is not null
        ),
        '{}'::text[]
      ) as service_names,
      100::integer as profile_completeness,
      true as has_public_profile,
      media.media_path as cover_image_path,
      media.media_created_at as latest_media_created_at,
      featured.featured_service_name,
      featured.featured_service_category,
      price.starting_price,
      'best_match'::text as result_group,
      'hashtag'::text as match_type,
      least(1000, 900 + hashtag_matches.match_count::integer) as relevance_score,
      1::integer as match_tier,
      null::double precision as distance_miles,
      false as is_new,
      count(*) over ()::bigint as group_total_count,
      count(*) over ()::bigint as best_match_count,
      0::bigint as nearby_count,
      0::bigint as recommended_count,
      count(*) over ()::bigint as total_count
    from hashtag_matches
    join public.locations l
      on l.id = hashtag_matches.salon_id
    join public.salon_settings ss
      on ss.salon_id = l.id
      and ss.organization_id = l.organization_id
    left join lateral public.get_public_explore_salon_card_media(l.id) media
      on true
    left join lateral (
      select
        nullif(btrim(services.name), '') as featured_service_name,
        nullif(btrim(services.category), '') as featured_service_category
      from public.services services
      where services.salon_id = l.id
        and services.is_active = true
        and nullif(btrim(services.name), '') is not null
      order by nullif(services.base_price, 0::numeric) asc nulls last, services.name asc
      limit 1
    ) featured on true
    left join lateral (
      select min(nullif(services.base_price, 0::numeric)) as starting_price
      from public.services services
      where services.salon_id = l.id
        and services.is_active = true
    ) price on true
    where public.salon_profile_public_salon_exists(l.id)
      and not exists (
        select 1
        from base_results base
        where base.salon_id = l.id
      )
  ),
  combined as (
    select * from hashtag_results
    union all
    select * from base_results
  )
  select *
  from combined
  order by
    match_tier asc,
    relevance_score desc,
    salon_name asc
  limit greatest(1, least(coalesce(p_page_size, 12), 12))
  offset (greatest(1, coalesce(p_page, 1)) - 1) * greatest(1, least(coalesce(p_page_size, 12), 12));
$$;

alter table public.salon_profile_media_assets enable row level security;
alter table public.salon_profile_plan_catalog enable row level security;
alter table public.salon_profile_entitlement_definitions enable row level security;
alter table public.salon_profile_plan_entitlements enable row level security;
alter table public.salon_profile_subscriptions enable row level security;
alter table public.salon_profile_entitlement_overrides enable row level security;
alter table public.salon_profile_usage_events enable row level security;
alter table public.salon_profile_hashtags enable row level security;
alter table public.salon_profile_look_hashtags enable row level security;
alter table public.salon_profile_update_hashtags enable row level security;
alter table public.salon_profile_reviews enable row level security;
alter table public.salon_profile_review_replies enable row level security;

drop policy if exists "Linked staff can update own public profile"
on public.staff;
create policy "Linked staff can update own public profile"
on public.staff
for update
to authenticated
using (
  public.current_auth_user_matches_staff(id, organization_id, salon_id)
)
with check (
  public.current_auth_user_matches_staff(id, organization_id, salon_id)
);

drop policy if exists "Public can view salon profile hashtag catalog"
on public.salon_profile_hashtags;
create policy "Public can view salon profile hashtag catalog"
on public.salon_profile_hashtags
for select
to anon, authenticated
using (true);

drop policy if exists "Salon profile managers can manage hashtag catalog"
on public.salon_profile_hashtags;
create policy "Salon profile managers can manage hashtag catalog"
on public.salon_profile_hashtags
for all
to authenticated
using (true)
with check (true);

drop policy if exists "Public can view published look hashtags"
on public.salon_profile_look_hashtags;
create policy "Public can view published look hashtags"
on public.salon_profile_look_hashtags
for select
to anon, authenticated
using (
  exists (
    select 1
    from public.salon_profile_looks looks
    where looks.id = salon_profile_look_hashtags.look_id
      and looks.status = 'published'
      and public.salon_profile_public_salon_exists(looks.salon_id)
  )
);

drop policy if exists "Managers can manage look hashtags"
on public.salon_profile_look_hashtags;
create policy "Managers can manage look hashtags"
on public.salon_profile_look_hashtags
for all
to authenticated
using (
  public.user_has_organization_permission(
    organization_id,
    array['salon_profile.content.manage']::text[]
  )
)
with check (
  public.user_has_organization_permission(
    organization_id,
    array['salon_profile.content.manage']::text[]
  )
);

drop policy if exists "Public can view published update hashtags"
on public.salon_profile_update_hashtags;
create policy "Public can view published update hashtags"
on public.salon_profile_update_hashtags
for select
to anon, authenticated
using (
  exists (
    select 1
    from public.salon_profile_updates updates
    where updates.id = salon_profile_update_hashtags.update_id
      and updates.status = 'published'
      and public.salon_profile_public_salon_exists(updates.salon_id)
  )
);

drop policy if exists "Managers can manage update hashtags"
on public.salon_profile_update_hashtags;
create policy "Managers can manage update hashtags"
on public.salon_profile_update_hashtags
for all
to authenticated
using (
  public.user_has_organization_permission(
    organization_id,
    array['salon_profile.content.manage']::text[]
  )
)
with check (
  public.user_has_organization_permission(
    organization_id,
    array['salon_profile.content.manage']::text[]
  )
);

drop policy if exists "Salon profile managers can view media assets"
on public.salon_profile_media_assets;
create policy "Salon profile managers can view media assets"
on public.salon_profile_media_assets
for select
to authenticated
using (
  public.user_has_organization_permission(
    organization_id,
    array['salon_profile.manage', 'salon_profile.content.manage', 'staff.manage']::text[]
  )
  or uploaded_by_user_id = public.current_public_user_id()
);

drop policy if exists "Salon profile managers can create media assets"
on public.salon_profile_media_assets;
create policy "Salon profile managers can create media assets"
on public.salon_profile_media_assets
for insert
to authenticated
with check (
  uploaded_by_user_id = public.current_public_user_id()
  and public.user_has_organization_permission(
    organization_id,
    array['salon_profile.manage', 'salon_profile.content.manage', 'staff.manage']::text[]
  )
);

drop policy if exists "Salon profile managers can update media assets"
on public.salon_profile_media_assets;
create policy "Salon profile managers can update media assets"
on public.salon_profile_media_assets
for update
to authenticated
using (
  public.user_has_organization_permission(
    organization_id,
    array['salon_profile.manage', 'salon_profile.content.manage', 'staff.manage']::text[]
  )
  or uploaded_by_user_id = public.current_public_user_id()
)
with check (
  public.user_has_organization_permission(
    organization_id,
    array['salon_profile.manage', 'salon_profile.content.manage', 'staff.manage']::text[]
  )
  or uploaded_by_user_id = public.current_public_user_id()
);

drop policy if exists "Managers can view salon profile plans"
on public.salon_profile_plan_catalog;
create policy "Managers can view salon profile plans"
on public.salon_profile_plan_catalog
for select
to authenticated
using (true);

drop policy if exists "Managers can view salon profile entitlements"
on public.salon_profile_entitlement_definitions;
create policy "Managers can view salon profile entitlements"
on public.salon_profile_entitlement_definitions
for select
to authenticated
using (true);

drop policy if exists "Managers can view plan entitlement values"
on public.salon_profile_plan_entitlements;
create policy "Managers can view plan entitlement values"
on public.salon_profile_plan_entitlements
for select
to authenticated
using (true);

drop policy if exists "Managers can view salon subscriptions"
on public.salon_profile_subscriptions;
create policy "Managers can view salon subscriptions"
on public.salon_profile_subscriptions
for select
to authenticated
using (
  public.user_has_organization_permission(
    organization_id,
    array['salon_profile.manage']::text[]
  )
);

drop policy if exists "Managers can view salon entitlement overrides"
on public.salon_profile_entitlement_overrides;
create policy "Managers can view salon entitlement overrides"
on public.salon_profile_entitlement_overrides
for select
to authenticated
using (
  public.user_has_organization_permission(
    organization_id,
    array['salon_profile.manage']::text[]
  )
);

drop policy if exists "Managers can view salon usage events"
on public.salon_profile_usage_events;
create policy "Managers can view salon usage events"
on public.salon_profile_usage_events
for select
to authenticated
using (
  public.user_has_organization_permission(
    organization_id,
    array['salon_profile.manage', 'salon_profile.content.manage']::text[]
  )
);

drop policy if exists "Public users can view visible salon reviews"
on public.salon_profile_reviews;
create policy "Public users can view visible salon reviews"
on public.salon_profile_reviews
for select
to anon, authenticated
using (
  moderation_status = 'visible'
  and public.salon_profile_public_salon_exists(salon_id)
);

drop policy if exists "Authenticated users can create salon reviews"
on public.salon_profile_reviews;
create policy "Authenticated users can create salon reviews"
on public.salon_profile_reviews
for insert
to authenticated
with check (
  author_user_id = public.current_public_user_id()
  and moderation_status = 'visible'
  and public.salon_profile_public_salon_exists(salon_id)
  and not public.salon_profile_user_is_affiliated(salon_id)
);

drop policy if exists "Users can update their own salon reviews"
on public.salon_profile_reviews;
create policy "Users can update their own salon reviews"
on public.salon_profile_reviews
for update
to authenticated
using (
  author_user_id = public.current_public_user_id()
  and moderation_status in ('visible', 'reported')
)
with check (
  author_user_id = public.current_public_user_id()
  and moderation_status in ('visible', 'withdrawn')
);

drop policy if exists "Managers can moderate salon reviews"
on public.salon_profile_reviews;
create policy "Managers can moderate salon reviews"
on public.salon_profile_reviews
for update
to authenticated
using (
  public.user_has_organization_permission(
    organization_id,
    array['salon_profile.manage']::text[]
  )
)
with check (
  public.user_has_organization_permission(
    organization_id,
    array['salon_profile.manage']::text[]
  )
);

drop policy if exists "Public users can view visible review replies"
on public.salon_profile_review_replies;
create policy "Public users can view visible review replies"
on public.salon_profile_review_replies
for select
to anon, authenticated
using (
  moderation_status = 'visible'
  and public.salon_profile_public_salon_exists(salon_id)
);

drop policy if exists "Managers can create review replies"
on public.salon_profile_review_replies;
create policy "Managers can create review replies"
on public.salon_profile_review_replies
for insert
to authenticated
with check (
  author_user_id = public.current_public_user_id()
  and moderation_status = 'visible'
  and public.user_has_organization_permission(
    organization_id,
    array['salon_profile.manage', 'salon_profile.content.manage']::text[]
  )
);

drop policy if exists "Managers can update review replies"
on public.salon_profile_review_replies;
create policy "Managers can update review replies"
on public.salon_profile_review_replies
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

grant select, insert, update on public.salon_profile_media_assets to authenticated;
grant select on public.salon_profile_plan_catalog to authenticated;
grant select on public.salon_profile_entitlement_definitions to authenticated;
grant select on public.salon_profile_plan_entitlements to authenticated;
grant select on public.salon_profile_subscriptions to authenticated;
grant select on public.salon_profile_entitlement_overrides to authenticated;
grant select on public.salon_profile_usage_events to authenticated;
grant select on public.salon_profile_hashtags to anon, authenticated;
grant insert, update on public.salon_profile_hashtags to authenticated;
grant select on public.salon_profile_look_hashtags to anon, authenticated;
grant insert, update, delete on public.salon_profile_look_hashtags to authenticated;
grant select on public.salon_profile_update_hashtags to anon, authenticated;
grant insert, update, delete on public.salon_profile_update_hashtags to authenticated;
grant select on public.salon_profile_reviews to anon, authenticated;
grant insert, update on public.salon_profile_reviews to authenticated;
grant select on public.salon_profile_review_replies to anon, authenticated;
grant insert, update on public.salon_profile_review_replies to authenticated;

revoke all on function public.get_public_salon_profile_staff(uuid) from public;
grant execute on function public.get_public_salon_profile_staff(uuid) to anon, authenticated;

revoke all on function public.get_public_salon_profile_looks(uuid) from public;
grant execute on function public.get_public_salon_profile_looks(uuid) to anon, authenticated;

revoke all on function public.get_public_salon_profile_updates(uuid) from public;
grant execute on function public.get_public_salon_profile_updates(uuid) to anon, authenticated;

revoke all on function public.get_public_salon_profile_review_summary(uuid) from public;
grant execute on function public.get_public_salon_profile_review_summary(uuid) to anon, authenticated;

revoke all on function public.get_public_salon_profile_reviews(uuid) from public;
grant execute on function public.get_public_salon_profile_reviews(uuid) to anon, authenticated;

revoke all on function public.get_public_salon_profile_hashtag_salon_ids(text) from public;
grant execute on function public.get_public_salon_profile_hashtag_salon_ids(text) to anon, authenticated;

revoke all on function public.search_public_explore_salons(
  text,
  text,
  text,
  double precision,
  double precision,
  integer,
  integer
) from public;

grant execute on function public.search_public_explore_salons(
  text,
  text,
  text,
  double precision,
  double precision,
  integer,
  integer
) to anon, authenticated;
