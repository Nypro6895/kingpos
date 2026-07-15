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
  ) as results;
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

do $$
begin
  if to_regprocedure('public.get_public_explore_home_salons_v2(integer, integer)') is null
    and to_regprocedure('public.get_public_explore_home_salons(integer, integer)') is not null
  then
    alter function public.get_public_explore_home_salons(integer, integer)
    rename to get_public_explore_home_salons_v2;
  end if;
end;
$$;

revoke all on function public.get_public_explore_home_salons_v2(integer, integer)
from public, anon, authenticated;

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
    results.public_discovery_published_at,
    results.created_at,
    results.updated_at,
    results.is_new,
    results.home_rank
  from public.get_public_explore_home_salons_v2(
    p_recommended_limit,
    p_new_limit
  ) as results;
$$;

revoke all on function public.get_public_explore_home_salons(integer, integer)
from public;

grant execute on function public.get_public_explore_home_salons(integer, integer)
to anon, authenticated;
