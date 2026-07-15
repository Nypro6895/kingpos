create or replace function public.get_public_explore_salon_card_media(
  target_salon_id uuid
)
returns table (
  media_path text,
  media_created_at timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  with candidates as (
    select
      nullif(btrim(updates.media_path), '') as media_path,
      coalesce(updates.published_at, updates.created_at) as media_created_at,
      1 as source_priority
    from public.salon_profile_updates updates
    where updates.salon_id = target_salon_id
      and updates.status = 'published'
      and nullif(btrim(updates.media_path), '') is not null
      and public.salon_profile_public_salon_exists(target_salon_id)

    union all

    select
      nullif(btrim(looks.media_path), '') as media_path,
      coalesce(looks.published_at, looks.created_at) as media_created_at,
      1 as source_priority
    from public.salon_profile_looks looks
    where looks.salon_id = target_salon_id
      and looks.status = 'published'
      and nullif(btrim(looks.media_path), '') is not null
      and public.salon_profile_public_salon_exists(target_salon_id)

    union all

    select
      nullif(btrim(settings.public_profile_cover_path), '') as media_path,
      null::timestamptz as media_created_at,
      2 as source_priority
    from public.salon_settings settings
    where settings.salon_id = target_salon_id
      and nullif(btrim(settings.public_profile_cover_path), '') is not null
      and public.salon_profile_public_salon_exists(target_salon_id)

    union all

    select
      nullif(btrim(settings.public_profile_logo_path), '') as media_path,
      null::timestamptz as media_created_at,
      3 as source_priority
    from public.salon_settings settings
    where settings.salon_id = target_salon_id
      and nullif(btrim(settings.public_profile_logo_path), '') is not null
      and public.salon_profile_public_salon_exists(target_salon_id)
  )
  select
    candidates.media_path,
    candidates.media_created_at
  from candidates
  where candidates.media_path is not null
  order by
    candidates.source_priority asc,
    candidates.media_created_at desc nulls last,
    candidates.media_path asc
  limit 1;
$$;

revoke all on function public.get_public_explore_salon_card_media(uuid)
from public;

grant execute on function public.get_public_explore_salon_card_media(uuid)
to anon, authenticated;

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
      public.explore_normalize_text(p_category) as category_text
  )
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
  ) price on true;
$$;

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

drop function if exists public.get_public_explore_home_salons(integer, integer);

create function public.get_public_explore_home_salons(
  p_recommended_limit integer default 6,
  p_new_limit integer default 6
)
returns table (
  section text,
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
  public_discovery_published_at timestamptz,
  created_at timestamptz,
  updated_at timestamptz,
  is_new boolean,
  home_rank integer
)
language sql
stable
security definer
set search_path = public
as $$
  select
    results.section,
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
    results.public_discovery_published_at,
    results.created_at,
    results.updated_at,
    results.is_new,
    results.home_rank
  from public.get_public_explore_home_salons_v2(
    p_recommended_limit,
    p_new_limit
  ) as results
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
      nullif(services.base_price, 0::numeric) asc nulls last,
      services.name asc
    limit 1
  ) featured on true
  left join lateral (
    select min(nullif(services.base_price, 0::numeric)) as starting_price
    from public.services services
    where services.salon_id = results.salon_id
      and services.is_active = true
  ) price on true;
$$;

revoke all on function public.get_public_explore_home_salons(integer, integer)
from public;

grant execute on function public.get_public_explore_home_salons(integer, integer)
to anon, authenticated;
