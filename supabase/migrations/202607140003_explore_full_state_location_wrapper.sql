alter function public.search_public_explore_salons(
  text,
  text,
  text,
  double precision,
  double precision,
  integer,
  integer
) rename to search_public_explore_salons_v2;

create or replace function public.explore_abbreviate_location_state(p_location text)
returns text
language sql
immutable
parallel safe
set search_path = public
as $$
  with states(state_name, state_code) as (
    values
      ('alabama', 'AL'), ('alaska', 'AK'), ('arizona', 'AZ'), ('arkansas', 'AR'),
      ('california', 'CA'), ('colorado', 'CO'), ('connecticut', 'CT'),
      ('delaware', 'DE'), ('district of columbia', 'DC'), ('florida', 'FL'),
      ('georgia', 'GA'), ('hawaii', 'HI'), ('idaho', 'ID'), ('illinois', 'IL'),
      ('indiana', 'IN'), ('iowa', 'IA'), ('kansas', 'KS'), ('kentucky', 'KY'),
      ('louisiana', 'LA'), ('maine', 'ME'), ('maryland', 'MD'),
      ('massachusetts', 'MA'), ('michigan', 'MI'), ('minnesota', 'MN'),
      ('mississippi', 'MS'), ('missouri', 'MO'), ('montana', 'MT'),
      ('nebraska', 'NE'), ('nevada', 'NV'), ('new hampshire', 'NH'),
      ('new jersey', 'NJ'), ('new mexico', 'NM'), ('new york', 'NY'),
      ('north carolina', 'NC'), ('north dakota', 'ND'), ('ohio', 'OH'),
      ('oklahoma', 'OK'), ('oregon', 'OR'), ('pennsylvania', 'PA'),
      ('rhode island', 'RI'), ('south carolina', 'SC'), ('south dakota', 'SD'),
      ('tennessee', 'TN'), ('texas', 'TX'), ('utah', 'UT'), ('vermont', 'VT'),
      ('virginia', 'VA'), ('washington', 'WA'), ('west virginia', 'WV'),
      ('wisconsin', 'WI'), ('wyoming', 'WY')
  )
  select
    case
      when p_location is null then null
      else coalesce(
        (
          select regexp_replace(
            btrim(p_location),
            '(?i)(^|[,\s]+)' || states.state_name || '\s*$',
            '\1' || states.state_code
          )
          from states
          where public.explore_normalize_text(p_location) = states.state_name
            or public.explore_normalize_text(p_location) like '% ' || states.state_name
          order by length(states.state_name) desc
          limit 1
        ),
        p_location
      )
    end;
$$;

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
  select *
  from public.search_public_explore_salons_v2(
    p_query,
    public.explore_abbreviate_location_state(p_location),
    p_category,
    p_latitude,
    p_longitude,
    p_page,
    p_page_size
  );
$$;

revoke all on function public.search_public_explore_salons_v2(
  text,
  text,
  text,
  double precision,
  double precision,
  integer,
  integer
) from public, anon, authenticated;

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
