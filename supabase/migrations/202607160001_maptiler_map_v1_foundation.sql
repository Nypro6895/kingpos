alter table public.locations
drop constraint if exists locations_geocoding_status_check;

alter table public.locations
add constraint locations_geocoding_status_check
check (
  geocoding_status is null
  or geocoding_status in (
    'mapped',
    'pending',
    'failed',
    'stale',
    'address_required',
    'provider_unavailable'
  )
);

create index if not exists locations_mapped_coordinates_idx
on public.locations (latitude, longitude)
where geocoding_status = 'mapped'
  and latitude is not null
  and longitude is not null;

create index if not exists locations_geocoding_stale_idx
on public.locations (updated_at desc)
where geocoding_status in ('pending', 'failed', 'stale', 'provider_unavailable');

create or replace function public.get_public_explore_home_salons(
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
    case when location_state.geocoding_status = 'mapped' then results.latitude else null end as latitude,
    case when location_state.geocoding_status = 'mapped' then results.longitude else null end as longitude,
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
  left join public.locations location_state
    on location_state.id = results.salon_id
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

create or replace function public.search_public_explore_salons(
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
      case when location_state.geocoding_status = 'mapped' then results.latitude else null end as latitude,
      case when location_state.geocoding_status = 'mapped' then results.longitude else null end as longitude,
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
      case when location_state.geocoding_status = 'mapped' then results.distance_miles else null end as distance_miles,
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
    left join public.locations location_state
      on location_state.id = results.salon_id
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
      case when l.geocoding_status = 'mapped' then l.latitude else null end as latitude,
      case when l.geocoding_status = 'mapped' then l.longitude else null end as longitude,
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
