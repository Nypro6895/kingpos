create extension if not exists unaccent with schema extensions;

create or replace function public.normalize_search_text(p_value text)
returns text
language sql
immutable
set search_path = public, extensions
as $$
  select nullif(
    btrim(
      regexp_replace(
        regexp_replace(
          lower(extensions.unaccent(coalesce(p_value, ''))),
          '[^[:alnum:]]+',
          ' ',
          'g'
        ),
        '\s+',
        ' ',
        'g'
      )
    ),
    ''
  )
$$;

create or replace function public.search_text_has_all_tokens(
  p_haystack text,
  p_tokens text[]
)
returns boolean
language sql
immutable
set search_path = public
as $$
  select coalesce(cardinality(p_tokens), 0) = 0
    or not exists (
      select 1
      from unnest(p_tokens) as tokens(token)
      where nullif(tokens.token, '') is not null
        and position(tokens.token in coalesce(p_haystack, '')) = 0
    )
$$;

create index if not exists locations_search_name_trgm_idx
on public.locations
using gin ((public.normalize_search_text(name)) extensions.gin_trgm_ops)
where status = 'active';

create index if not exists locations_search_city_state_postal_trgm_idx
on public.locations
using gin ((public.normalize_search_text(coalesce(city, '') || ' ' || coalesce(state, '') || ' ' || coalesce(postal_code, ''))) extensions.gin_trgm_ops)
where status = 'active';

create index if not exists salon_settings_search_business_name_trgm_idx
on public.salon_settings
using gin ((public.normalize_search_text(business_name)) extensions.gin_trgm_ops)
where public_discovery_enabled = true;

create index if not exists salon_settings_search_location_trgm_idx
on public.salon_settings
using gin ((public.normalize_search_text(coalesce(city, '') || ' ' || coalesce(state, '') || ' ' || coalesce(postal_code, ''))) extensions.gin_trgm_ops)
where public_discovery_enabled = true;

create index if not exists services_search_name_trgm_idx
on public.services
using gin ((public.normalize_search_text(name)) extensions.gin_trgm_ops)
where is_active = true;

create index if not exists services_search_category_trgm_idx
on public.services
using gin ((public.normalize_search_text(category)) extensions.gin_trgm_ops)
where is_active = true and category is not null;

create index if not exists services_search_document_trgm_idx
on public.services
using gin ((public.normalize_search_text(coalesce(name, '') || ' ' || coalesce(category, '') || ' ' || coalesce(description, ''))) extensions.gin_trgm_ops)
where is_active = true;

create index if not exists customers_location_status_created_at_idx
on public.customers(location_id, status, created_at desc);

create index if not exists customers_search_name_trgm_idx
on public.customers
using gin ((public.normalize_search_text(name)) extensions.gin_trgm_ops)
where status = 'active';

create index if not exists customers_search_email_trgm_idx
on public.customers
using gin ((public.normalize_search_text(email)) extensions.gin_trgm_ops)
where status = 'active' and email is not null;

create index if not exists customers_search_phone_digits_trgm_idx
on public.customers
using gin ((regexp_replace(coalesce(phone, ''), '\D', '', 'g')) extensions.gin_trgm_ops)
where status = 'active' and phone is not null;

create index if not exists users_search_email_lower_idx
on public.users(lower(email))
where email is not null;

create index if not exists users_search_phone_normalized_idx
on public.users(public.normalize_customer_claim_phone(phone))
where phone is not null;

create or replace function public.search_salon_customers(
  p_salon_id uuid,
  p_query text default null,
  p_limit integer default 10,
  p_offset integer default 0,
  p_status text default 'active'
)
returns table (
  id uuid,
  location_id uuid,
  customer_user_id uuid,
  name text,
  phone text,
  email text,
  notes text,
  staff_notes text,
  internal_notes text,
  source text,
  status text,
  created_by_user_id uuid,
  updated_by_user_id uuid,
  created_at timestamptz,
  updated_at timestamptz,
  search_rank double precision,
  total_count bigint
)
language sql
stable
security definer
set search_path = public, extensions
as $$
  with normalized as (
    select
      nullif(btrim(coalesce(p_query, '')), '') as raw_query,
      lower(nullif(btrim(coalesce(p_query, '')), '')) as raw_query_lower,
      public.normalize_search_text(p_query) as query_text,
      case
        when public.normalize_search_text(p_query) is null then '{}'::text[]
        else regexp_split_to_array(public.normalize_search_text(p_query), '\s+')
      end as query_tokens,
      nullif(regexp_replace(coalesce(p_query, ''), '\D', '', 'g'), '') as phone_digits,
      public.normalize_customer_claim_phone(p_query) as normalized_phone,
      least(100, greatest(1, coalesce(p_limit, 10))) as page_size,
      greatest(0, coalesce(p_offset, 0)) as page_offset,
      case when p_status in ('active', 'inactive') then p_status else null end as status_filter
  ),
  base as (
    select
      customers.*,
      public.normalize_search_text(customers.name) as name_search,
      public.normalize_search_text(customers.email) as email_search,
      lower(coalesce(customers.email, '')) as email_lower,
      regexp_replace(coalesce(customers.phone, ''), '\D', '', 'g') as phone_digits_search,
      public.normalize_customer_claim_phone(customers.phone) as normalized_phone_search
    from public.customers
    cross join normalized
    where customers.location_id = p_salon_id
      and (
        normalized.status_filter is null
        or customers.status = normalized.status_filter
      )
  ),
  scored as (
    select
      base.*,
      greatest(
        case
          when normalized.normalized_phone is not null
            and base.normalized_phone_search = normalized.normalized_phone
          then 130 else 0
        end,
        case
          when normalized.phone_digits is not null
            and length(normalized.phone_digits) >= 4
            and base.phone_digits_search like '%' || normalized.phone_digits || '%'
          then 105 else 0
        end,
        case
          when normalized.raw_query_lower is not null
            and base.email_lower = normalized.raw_query_lower
          then 120 else 0
        end,
        case
          when normalized.raw_query_lower is not null
            and base.email_lower like normalized.raw_query_lower || '%'
          then 95 else 0
        end,
        case
          when normalized.query_text is not null
            and base.name_search = normalized.query_text
          then 110 else 0
        end,
        case
          when normalized.query_text is not null
            and base.name_search like normalized.query_text || '%'
          then 90 else 0
        end,
        case
          when normalized.query_text is not null
            and (
              base.name_search like '%' || normalized.query_text || '%'
              or base.email_search like '%' || normalized.query_text || '%'
            )
          then 70 else 0
        end,
        case
          when normalized.query_text is not null
            and public.search_text_has_all_tokens(
              concat_ws(' ', base.name_search, base.email_search),
              normalized.query_tokens
            )
          then 62 else 0
        end,
        case
          when normalized.query_text is not null
            and greatest(
              extensions.word_similarity(normalized.query_text, coalesce(base.name_search, '')),
              extensions.similarity(normalized.query_text, coalesce(base.name_search, ''))
            ) >= 0.45
          then 48 else 0
        end
      )::double precision as search_rank
    from base
    cross join normalized
  ),
  filtered as (
    select scored.*
    from scored
    cross join normalized
    where normalized.raw_query is null
      or scored.search_rank > 0
  ),
  counted as (
    select filtered.*, count(*) over () as total_count
    from filtered
  )
  select
    counted.id,
    counted.location_id,
    counted.customer_user_id,
    counted.name,
    counted.phone,
    counted.email,
    counted.notes,
    counted.staff_notes,
    counted.internal_notes,
    counted.source,
    counted.status,
    counted.created_by_user_id,
    counted.updated_by_user_id,
    counted.created_at,
    counted.updated_at,
    counted.search_rank,
    counted.total_count
  from counted
  cross join normalized
  order by
    case when normalized.raw_query is null then 0 else counted.search_rank end desc,
    counted.created_at desc,
    counted.id desc
  limit (select page_size from normalized)
  offset (select page_offset from normalized)
$$;

grant execute on function public.search_salon_customers(uuid, text, integer, integer, text)
to authenticated;

create or replace function public.search_public_explore_salons(
  p_query text default null,
  p_category text default null,
  p_location text default null,
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
  latitude double precision,
  longitude double precision,
  description text,
  active_service_count bigint,
  service_categories text[],
  service_names text[],
  cover_image_path text,
  latest_media_created_at timestamptz,
  featured_service_category text,
  featured_service_name text,
  starting_price numeric,
  profile_completeness integer,
  has_public_profile boolean,
  is_new boolean,
  distance_miles double precision,
  match_type text,
  match_tier integer,
  relevance_score double precision,
  result_group text,
  total_count bigint,
  group_total_count bigint,
  best_match_count bigint,
  nearby_count bigint,
  recommended_count bigint
)
language sql
stable
security definer
set search_path = public, extensions
as $$
  with normalized as (
    select
      nullif(btrim(p_query), '') as raw_query,
      public.normalize_search_text(p_query) as query_text,
      case
        when public.normalize_search_text(p_query) is null then '{}'::text[]
        else regexp_split_to_array(public.normalize_search_text(p_query), '\s+')
      end as query_tokens,
      nullif(btrim(p_category), '') as raw_category,
      public.normalize_search_text(p_category) as category_text,
      case
        when public.normalize_search_text(p_category) is null then '{}'::text[]
        else regexp_split_to_array(public.normalize_search_text(p_category), '\s+')
      end as category_tokens,
      nullif(btrim(p_location), '') as raw_location,
      public.normalize_search_text(p_location) as location_text,
      case
        when public.normalize_search_text(p_location) is null then '{}'::text[]
        else regexp_split_to_array(public.normalize_search_text(p_location), '\s+')
      end as location_tokens,
      case when p_latitude between -90 and 90 then p_latitude else null end as latitude_value,
      case when p_longitude between -180 and 180 then p_longitude else null end as longitude_value,
      greatest(1, coalesce(p_page, 1)) as page_value,
      least(12, greatest(1, coalesce(p_page_size, 12))) as page_size_value
  ),
  active_services as (
    select
      services.salon_id,
      services.name,
      services.category,
      services.description,
      services.base_price,
      services.online_booking_enabled
    from public.services
    where services.is_active = true
  ),
  service_rollups_raw as (
    select
      active_services.salon_id,
      count(*)::bigint as active_service_count,
      array_agg(distinct active_services.category)
        filter (where nullif(active_services.category, '') is not null) as service_categories,
      array_agg(active_services.name order by active_services.name)
        filter (where nullif(active_services.name, '') is not null) as service_names_all,
      min(active_services.base_price) as starting_price,
      public.normalize_search_text(
        string_agg(
          concat_ws(
            ' ',
            active_services.name,
            active_services.category,
            active_services.description
          ),
          ' '
        )
      ) as service_search_text,
      public.normalize_search_text(string_agg(active_services.category, ' ')) as service_category_search_text
    from active_services
    group by active_services.salon_id
  ),
  service_rollups as (
    select
      service_rollups_raw.salon_id,
      service_rollups_raw.active_service_count,
      coalesce(service_rollups_raw.service_categories, '{}'::text[]) as service_categories,
      coalesce(service_rollups_raw.service_names_all[1:8], '{}'::text[]) as service_names,
      service_rollups_raw.starting_price,
      service_rollups_raw.service_search_text,
      service_rollups_raw.service_category_search_text
    from service_rollups_raw
  ),
  featured_services as (
    select salon_id, category, name
    from (
      select
        active_services.salon_id,
        active_services.category,
        active_services.name,
        row_number() over (
          partition by active_services.salon_id
          order by active_services.name
        ) as row_number
      from active_services
      where active_services.online_booking_enabled = true
    ) ranked
    where ranked.row_number = 1
  ),
  public_salons as (
    select
      salons.id as salon_id,
      coalesce(nullif(settings.business_name, ''), salons.name) as salon_name,
      coalesce(settings.phone, salons.phone) as phone,
      coalesce(settings.address_line1, salons.address_line1) as address_line1,
      coalesce(settings.address_line2, salons.address_line2) as address_line2,
      coalesce(settings.city, salons.city) as city,
      coalesce(settings.state, salons.state) as state,
      coalesce(settings.postal_code, salons.postal_code) as postal_code,
      coalesce(settings.country, salons.country) as country,
      salons.latitude,
      salons.longitude,
      settings.business_description as description,
      (
        case when settings.public_discovery_enabled then 20 else 0 end
        + case when nullif(settings.business_description, '') is not null then 20 else 0 end
        + case when nullif(settings.public_profile_cover_path, '') is not null then 20 else 0 end
        + case when coalesce(service_rollups.active_service_count, 0) > 0 then 20 else 0 end
        + case when coalesce(booking_settings.booking_enabled, false) then 20 else 0 end
      )::integer as profile_completeness,
      coalesce(service_rollups.active_service_count, 0)::bigint as active_service_count,
      coalesce(service_rollups.service_categories, '{}'::text[]) as service_categories,
      coalesce(service_rollups.service_names, '{}'::text[]) as service_names,
      coalesce(
        nullif(settings.public_profile_cover_path, ''),
        (
          select media.object_path
          from public.salon_profile_media_assets media
          where media.salon_id = salons.id
            and media.status = 'active'
            and media.deleted_at is null
            and media.purpose in ('cover', 'look', 'update')
          order by case when media.purpose = 'cover' then 0 else 1 end, media.created_at desc
          limit 1
        )
      ) as cover_image_path,
      (
        select max(media.created_at)
        from public.salon_profile_media_assets media
        where media.salon_id = salons.id
          and media.status = 'active'
          and media.deleted_at is null
      ) as latest_media_created_at,
      featured_services.category as featured_service_category,
      featured_services.name as featured_service_name,
      service_rollups.starting_price,
      true as has_public_profile,
      (salons.created_at >= now() - interval '30 days') as is_new,
      salons.created_at,
      salons.updated_at,
      public.normalize_search_text(coalesce(nullif(settings.business_name, ''), salons.name)) as salon_name_search,
      public.normalize_search_text(settings.business_description) as description_search,
      public.normalize_search_text(
        concat_ws(
          ' ',
          coalesce(nullif(settings.business_name, ''), salons.name),
          salons.name,
          settings.business_description,
          service_rollups.service_search_text
        )
      ) as search_document,
      public.normalize_search_text(
        concat_ws(
          ' ',
          coalesce(settings.city, salons.city),
          coalesce(settings.state, salons.state),
          coalesce(settings.postal_code, salons.postal_code),
          coalesce(settings.address_line1, salons.address_line1)
        )
      ) as location_search_text,
      service_rollups.service_search_text,
      service_rollups.service_category_search_text
    from public.locations salons
    cross join normalized
    join public.salon_settings settings on settings.salon_id = salons.id
    left join public.booking_settings on booking_settings.salon_id = salons.id
    left join service_rollups on service_rollups.salon_id = salons.id
    left join featured_services on featured_services.salon_id = salons.id
    where salons.status = 'active'
      and settings.public_discovery_enabled = true
      and (
        normalized.category_text is null
        or coalesce(service_rollups.service_category_search_text, '') like '%' || normalized.category_text || '%'
        or public.search_text_has_all_tokens(
          coalesce(service_rollups.service_category_search_text, ''),
          normalized.category_tokens
        )
        or extensions.word_similarity(
          normalized.category_text,
          coalesce(service_rollups.service_category_search_text, '')
        ) >= 0.82
      )
      and (
        normalized.location_text is null
        or coalesce(public.normalize_search_text(settings.city), public.normalize_search_text(salons.city), '') = normalized.location_text
        or coalesce(public.normalize_search_text(settings.postal_code), public.normalize_search_text(salons.postal_code), '') = normalized.location_text
        or public.normalize_search_text(
          concat_ws(
            ' ',
            coalesce(settings.city, salons.city),
            coalesce(settings.state, salons.state),
            coalesce(settings.postal_code, salons.postal_code),
            coalesce(settings.address_line1, salons.address_line1)
          )
        ) like '%' || normalized.location_text || '%'
        or public.search_text_has_all_tokens(
          public.normalize_search_text(
            concat_ws(
              ' ',
              coalesce(settings.city, salons.city),
              coalesce(settings.state, salons.state),
              coalesce(settings.postal_code, salons.postal_code),
              coalesce(settings.address_line1, salons.address_line1)
            )
          ),
          normalized.location_tokens
        )
      )
  ),
  scored_base as (
    select
      public_salons.*,
      case
        when normalized.latitude_value is not null
          and normalized.longitude_value is not null
          and public_salons.latitude is not null
          and public_salons.longitude is not null
          then 3958.8 * acos(least(1, greatest(-1,
            sin(radians(normalized.latitude_value)) * sin(radians(public_salons.latitude))
            + cos(radians(normalized.latitude_value)) * cos(radians(public_salons.latitude))
            * cos(radians(public_salons.longitude) - radians(normalized.longitude_value))
          )))
        else null
      end as distance_miles,
      greatest(
        case
          when normalized.query_text is not null
            and public_salons.salon_name_search = normalized.query_text
          then 140 else 0
        end,
        case
          when normalized.query_text is not null
            and public_salons.salon_name_search like normalized.query_text || '%'
          then 120 else 0
        end,
        case
          when normalized.query_text is not null
            and coalesce(public_salons.service_search_text, '') like normalized.query_text || '%'
          then 110 else 0
        end,
        case
          when normalized.query_text is not null
            and public_salons.salon_name_search like '%' || normalized.query_text || '%'
          then 100 else 0
        end,
        case
          when normalized.query_text is not null
            and coalesce(public_salons.service_search_text, '') like '%' || normalized.query_text || '%'
          then 90 else 0
        end,
        case
          when normalized.query_text is not null
            and public.search_text_has_all_tokens(
              coalesce(public_salons.search_document, ''),
              normalized.query_tokens
            )
          then 78 else 0
        end,
        case
          when normalized.query_text is not null
            and coalesce(public_salons.description_search, '') like '%' || normalized.query_text || '%'
          then 45 else 0
        end,
        case
          when normalized.query_text is not null
            and greatest(
              extensions.word_similarity(normalized.query_text, coalesce(public_salons.salon_name_search, '')),
              extensions.word_similarity(normalized.query_text, coalesce(public_salons.service_search_text, '')),
              extensions.similarity(normalized.query_text, coalesce(public_salons.salon_name_search, '')),
              extensions.similarity(normalized.query_text, coalesce(public_salons.service_search_text, ''))
            ) >= 0.42
          then 55 else 0
        end
      )::double precision as text_relevance_score,
      case
        when normalized.category_text is not null then 35
        else 0
      end::double precision as category_relevance_score,
      case
        when normalized.location_text is not null then 15
        else 0
      end::double precision as location_relevance_score,
      normalized.query_text is not null or normalized.category_text is not null as has_best_match_filter,
      normalized.location_text is not null as has_location_filter,
      normalized.page_value,
      normalized.page_size_value
    from public_salons
    cross join normalized
  ),
  scored as (
    select
      scored_base.*,
      (
        (select query_text from normalized) is null
        or scored_base.text_relevance_score > 0
      ) as query_matches
    from scored_base
  ),
  grouped as (
    select
      scored.*,
      case
        when scored.has_best_match_filter and scored.query_matches then 'best_match'
        when scored.distance_miles is not null or scored.has_location_filter then 'nearby'
        else 'recommended'
      end as result_group,
      case
        when scored.has_best_match_filter and scored.query_matches then 'search'
        when scored.distance_miles is not null then 'distance'
        when scored.has_location_filter then 'area'
        else 'recommended'
      end as match_type,
      case
        when scored.has_best_match_filter and scored.query_matches then 1
        when scored.distance_miles is not null or scored.has_location_filter then 2
        else 3
      end as match_tier,
      (
        scored.text_relevance_score
        + scored.category_relevance_score
        + scored.location_relevance_score
        + scored.profile_completeness::double precision
        + case when scored.is_new then 8 else 0 end
        - coalesce(scored.distance_miles, 0) / 12
      ) as relevance_score
    from scored
  ),
  counted as (
    select
      grouped.*,
      count(*) over () as total_count,
      count(*) filter (where grouped.result_group = 'best_match') over () as best_match_count,
      count(*) filter (where grouped.result_group = 'nearby') over () as nearby_count,
      count(*) filter (where grouped.result_group = 'recommended') over () as recommended_count,
      count(*) over (partition by grouped.result_group) as group_total_count
    from grouped
  )
  select
    salon_id,
    salon_name,
    phone,
    address_line1,
    address_line2,
    city,
    state,
    postal_code,
    country,
    latitude,
    longitude,
    description,
    active_service_count,
    service_categories,
    service_names,
    cover_image_path,
    latest_media_created_at,
    featured_service_category,
    featured_service_name,
    starting_price,
    profile_completeness,
    has_public_profile,
    is_new,
    distance_miles,
    match_type,
    match_tier,
    relevance_score,
    result_group,
    total_count,
    group_total_count,
    best_match_count,
    nearby_count,
    recommended_count
  from counted
  order by
    match_tier,
    case when match_tier = 1 then relevance_score end desc,
    distance_miles nulls last,
    relevance_score desc,
    updated_at desc,
    salon_id
  limit (select page_size_value from normalized)
  offset (select (page_value - 1) * page_size_value from normalized)
$$;

grant execute on function public.search_public_explore_salons(
  text,
  text,
  text,
  double precision,
  double precision,
  integer,
  integer
) to anon, authenticated;

create or replace function public.search_pos_portable_customers(
  p_key_id uuid,
  p_session_signature text,
  p_search text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  target_salon_id uuid;
  search_query text := btrim(coalesce(p_search, ''));
  customers_json jsonb;
begin
  target_salon_id := public.pos_portable_access_salon_id(p_key_id, p_session_signature);

  if target_salon_id is null then
    return null;
  end if;

  if search_query = '' then
    return '[]'::jsonb;
  end if;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', matched.id,
        'name', matched.name,
        'phone', matched.phone,
        'email', matched.email
      )
      order by matched.search_rank desc, matched.created_at desc, matched.id desc
    ),
    '[]'::jsonb
  )
  into customers_json
  from public.search_salon_customers(
    target_salon_id,
    search_query,
    10,
    0,
    'active'
  ) matched;

  return customers_json;
end;
$$;

grant execute on function public.search_pos_portable_customers(uuid, text, text)
to anon, authenticated;

create or replace function public.search_pos_live_draft_customers_by_phone(
  p_token text,
  p_phone text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  draft_row public.pos_live_drafts%rowtype;
  normalized_phone_digits text;
  result_json jsonb;
begin
  normalized_phone_digits := nullif(regexp_replace(coalesce(p_phone, ''), '\D', '', 'g'), '');

  if normalized_phone_digits is null or length(normalized_phone_digits) < 4 then
    return '[]'::jsonb;
  end if;

  select *
  into draft_row
  from public.pos_live_drafts
  where token = btrim(coalesce(p_token, ''))
    and status = 'draft'
  limit 1;

  if draft_row.id is null then
    return '[]'::jsonb;
  end if;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', matched.id,
        'name', matched.name,
        'phone', matched.phone
      )
      order by
        case
          when public.normalize_customer_claim_phone(matched.phone)
            = public.normalize_customer_claim_phone(p_phone)
          then 0
          else 1
        end,
        matched.created_at desc,
        matched.id desc
    ),
    '[]'::jsonb
  )
  into result_json
  from (
    select id, name, phone, created_at
    from public.customers
    where location_id = draft_row.salon_id
      and status = 'active'
      and regexp_replace(coalesce(phone, ''), '\D', '', 'g')
        like '%' || normalized_phone_digits || '%'
    order by created_at desc
    limit 3
  ) matched;

  return result_json;
end;
$$;

grant execute on function public.search_pos_live_draft_customers_by_phone(text, text)
to anon, authenticated;

create or replace function public.search_public_staff_application_salons(
  p_query text default null,
  p_city text default null,
  p_state text default null,
  p_limit integer default 12
)
returns table (
  salon_id uuid,
  salon_name text,
  address_line1 text,
  address_line2 text,
  city text,
  state text,
  postal_code text,
  country text
)
language sql
stable
security definer
set search_path = public, extensions
as $$
  with normalized as (
    select
      public.normalize_search_text(p_query) as query_text,
      case
        when public.normalize_search_text(p_query) is null then '{}'::text[]
        else regexp_split_to_array(public.normalize_search_text(p_query), '\s+')
      end as query_tokens,
      public.normalize_search_text(p_city) as city_text,
      public.normalize_search_text(p_state) as state_text,
      least(greatest(coalesce(p_limit, 12), 1), 25) as clean_limit
  ),
  candidates as (
    select
      salons.id,
      coalesce(settings.business_name, salons.name) as salon_name,
      coalesce(settings.address_line1, salons.address_line1) as address_line1,
      coalesce(settings.address_line2, salons.address_line2) as address_line2,
      coalesce(settings.city, salons.city) as city,
      coalesce(settings.state, salons.state) as state,
      coalesce(settings.postal_code, salons.postal_code) as postal_code,
      coalesce(settings.country, salons.country) as country,
      public.normalize_search_text(
        concat_ws(' ', settings.business_name, salons.name)
      ) as name_search
    from public.locations salons
    join public.salon_settings settings on settings.salon_id = salons.id
    cross join normalized
    where salons.status = 'active'
      and settings.allow_staff_applications = true
      and (
        normalized.city_text is null
        or public.normalize_search_text(coalesce(settings.city, salons.city)) = normalized.city_text
      )
      and (
        normalized.state_text is null
        or public.normalize_search_text(coalesce(settings.state, salons.state)) = normalized.state_text
      )
  ),
  scored as (
    select
      candidates.*,
      greatest(
        case
          when normalized.query_text is not null
            and candidates.name_search = normalized.query_text
          then 100 else 0
        end,
        case
          when normalized.query_text is not null
            and candidates.name_search like normalized.query_text || '%'
          then 85 else 0
        end,
        case
          when normalized.query_text is not null
            and candidates.name_search like '%' || normalized.query_text || '%'
          then 70 else 0
        end,
        case
          when normalized.query_text is not null
            and public.search_text_has_all_tokens(candidates.name_search, normalized.query_tokens)
          then 62 else 0
        end,
        case
          when normalized.query_text is not null
            and extensions.word_similarity(normalized.query_text, candidates.name_search) >= 0.45
          then 45 else 0
        end
      ) as search_rank
    from candidates
    cross join normalized
  )
  select
    scored.id,
    scored.salon_name,
    scored.address_line1,
    scored.address_line2,
    scored.city,
    scored.state,
    scored.postal_code,
    scored.country
  from scored
  cross join normalized
  where normalized.query_text is null
    or scored.search_rank > 0
  order by
    scored.search_rank desc,
    scored.salon_name asc
  limit (select clean_limit from normalized)
$$;

grant execute on function public.search_public_staff_application_salons(
  text,
  text,
  text,
  integer
) to anon, authenticated;

create or replace function public.search_beauty_attribution_salons(
  p_query text default '',
  p_limit integer default 8
)
returns jsonb
language sql
stable
security definer
set search_path = public, extensions
as $$
  with normalized as (
    select
      public.normalize_search_text(p_query) as query_text,
      case
        when public.normalize_search_text(p_query) is null then '{}'::text[]
        else regexp_split_to_array(public.normalize_search_text(p_query), '\s+')
      end as query_tokens,
      greatest(1, least(coalesce(p_limit, 8), 12)) as clean_limit
  ),
  salon_rows as (
    select
      salons.id,
      coalesce(nullif(btrim(settings.business_name), ''), salons.name) as name,
      coalesce(settings.city, salons.city) as city,
      coalesce(settings.state, salons.state) as state,
      greatest(
        case
          when normalized.query_text is not null
            and public.normalize_search_text(coalesce(settings.business_name, salons.name)) = normalized.query_text
          then 100 else 0
        end,
        case
          when normalized.query_text is not null
            and public.normalize_search_text(coalesce(settings.business_name, salons.name)) like normalized.query_text || '%'
          then 85 else 0
        end,
        case
          when normalized.query_text is not null
            and public.normalize_search_text(
              concat_ws(' ', settings.business_name, salons.name, settings.city, salons.city)
            ) like '%' || normalized.query_text || '%'
          then 70 else 0
        end,
        case
          when normalized.query_text is not null
            and public.search_text_has_all_tokens(
              public.normalize_search_text(
                concat_ws(' ', settings.business_name, salons.name, settings.city, salons.city)
              ),
              normalized.query_tokens
            )
          then 62 else 0
        end,
        case
          when normalized.query_text is not null
            and extensions.word_similarity(
              normalized.query_text,
              public.normalize_search_text(concat_ws(' ', settings.business_name, salons.name))
            ) >= 0.45
          then 45 else 0
        end
      ) as search_rank
    from normalized
    join public.locations salons on salons.status = 'active'
    left join public.salon_settings settings on settings.salon_id = salons.id
    where public.salon_profile_public_salon_exists(salons.id)
  ),
  filtered as (
    select salon_rows.*
    from salon_rows
    cross join normalized
    where normalized.query_text is null
      or salon_rows.search_rank > 0
    order by salon_rows.search_rank desc, salon_rows.name
    limit (select clean_limit from normalized)
  )
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'salonId', filtered.id,
        'salonName', filtered.name,
        'city', filtered.city,
        'state', filtered.state,
        'staff', coalesce((
          select jsonb_agg(
            jsonb_build_object(
              'staffId', staff.id,
              'staffName', staff.display_name
            )
            order by staff.profile_display_order, staff.display_name
          )
          from public.staff staff
          where staff.salon_id = filtered.id
            and staff.is_active = true
            and (
              staff.public_profile_visible = true
              or public.user_can_manage_salon(filtered.id)
            )
        ), '[]'::jsonb)
      )
      order by filtered.search_rank desc, filtered.name
    ),
    '[]'::jsonb
  )
  from filtered
$$;

grant execute on function public.search_beauty_attribution_salons(text, integer)
to authenticated;
