create extension if not exists pg_trgm;

alter table public.locations
add column if not exists latitude double precision;

alter table public.locations
add column if not exists longitude double precision;

alter table public.salon_settings
add column if not exists public_discovery_enabled boolean not null default false;

comment on column public.salon_settings.public_discovery_enabled is
  'Allows this salon to appear in customer Explore discovery. This is separate from staff applications.';

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'locations_latitude_range_check'
  ) then
    alter table public.locations
    add constraint locations_latitude_range_check
    check (latitude is null or (latitude >= -90 and latitude <= 90));
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'locations_longitude_range_check'
  ) then
    alter table public.locations
    add constraint locations_longitude_range_check
    check (longitude is null or (longitude >= -180 and longitude <= 180));
  end if;
end;
$$;

create index if not exists locations_public_explore_location_idx
on public.locations (
  status,
  lower(coalesce(city, '')),
  lower(coalesce(state, '')),
  postal_code
)
where status = 'active';

create index if not exists locations_public_explore_coordinates_idx
on public.locations (latitude, longitude)
where status = 'active'
  and latitude is not null
  and longitude is not null;

create index if not exists salon_settings_public_discovery_idx
on public.salon_settings (public_discovery_enabled, salon_id)
where public_discovery_enabled = true;

create index if not exists salon_settings_public_business_name_trgm_idx
on public.salon_settings using gin (lower(business_name) gin_trgm_ops)
where public_discovery_enabled = true;

create index if not exists services_public_explore_active_idx
on public.services (salon_id, category)
where is_active = true;

create index if not exists services_public_name_trgm_idx
on public.services using gin (lower(name) gin_trgm_ops)
where is_active = true;

create index if not exists services_public_category_trgm_idx
on public.services using gin (lower(category) gin_trgm_ops)
where is_active = true
  and category is not null;

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
  match_tier integer,
  distance_miles double precision,
  is_new boolean,
  total_count bigint
)
language sql
stable
security definer
set search_path = public
as $$
  with params as (
    select
      lower(btrim(coalesce(p_query, ''))) as query_text,
      lower(btrim(coalesce(p_location, ''))) as location_text,
      lower(btrim(coalesce(p_category, ''))) as category_text,
      substring(lower(btrim(coalesce(p_query, ''))) from '^\d{5}') as query_zip,
      substring(lower(btrim(coalesce(p_location, ''))) from '^\d{5}') as location_zip,
      case
        when p_latitude between -90 and 90
          and p_longitude between -180 and 180
        then p_latitude
        else null
      end as user_latitude,
      case
        when p_latitude between -90 and 90
          and p_longitude between -180 and 180
        then p_longitude
        else null
      end as user_longitude,
      greatest(1, coalesce(p_page, 1)) as page_number,
      least(24, greatest(1, coalesce(p_page_size, 12))) as page_size
  ),
  eligible as (
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
      l.created_at,
      count(distinct s.id)::integer as active_service_count,
      coalesce(
        array_agg(distinct nullif(btrim(s.category), ''))
          filter (where nullif(btrim(s.category), '') is not null),
        '{}'::text[]
      ) as service_categories,
      coalesce(
        array_agg(distinct nullif(btrim(s.name), ''))
          filter (where nullif(btrim(s.name), '') is not null),
        '{}'::text[]
      ) as service_names
    from public.locations l
    join public.salon_settings ss
      on ss.salon_id = l.id
      and ss.organization_id = l.organization_id
    join public.services s
      on s.salon_id = l.id
      and s.organization_id = l.organization_id
      and s.is_active = true
    where l.status = 'active'
      and ss.public_discovery_enabled = true
      and length(btrim(coalesce(ss.business_name, l.name, ''))) > 0
      and length(btrim(coalesce(ss.phone, l.phone, ''))) > 0
      and length(btrim(coalesce(ss.address_line1, l.address_line1, ''))) > 0
      and length(btrim(coalesce(ss.city, l.city, ''))) > 0
      and length(btrim(coalesce(ss.state, l.state, ''))) > 0
      and length(btrim(coalesce(ss.postal_code, l.postal_code, ''))) > 0
      and length(btrim(coalesce(ss.business_description, ''))) > 0
    group by
      l.id,
      l.name,
      l.phone,
      l.address_line1,
      l.address_line2,
      l.city,
      l.state,
      l.postal_code,
      l.country,
      l.latitude,
      l.longitude,
      l.created_at,
      ss.business_name,
      ss.phone,
      ss.address_line1,
      ss.address_line2,
      ss.city,
      ss.state,
      ss.postal_code,
      ss.country,
      ss.business_description
    having count(distinct s.id) > 0
  ),
  scored as (
    select
      e.*,
      (
        (
          case when length(btrim(coalesce(e.salon_name, ''))) > 0 then 1 else 0 end +
          case when length(btrim(coalesce(e.phone, ''))) > 0 then 1 else 0 end +
          case when length(btrim(coalesce(e.address_line1, ''))) > 0 then 1 else 0 end +
          case when length(btrim(coalesce(e.city, ''))) > 0 then 1 else 0 end +
          case when length(btrim(coalesce(e.state, ''))) > 0 then 1 else 0 end +
          case when length(btrim(coalesce(e.postal_code, ''))) > 0 then 1 else 0 end +
          case when length(btrim(coalesce(e.description, ''))) > 0 then 1 else 0 end +
          case when e.active_service_count > 0 then 1 else 0 end
        ) * 100 / 8
      )::integer as computed_profile_completeness,
      (e.created_at >= now() - interval '60 days') as computed_is_new,
      case
        when p.user_latitude is not null
          and p.user_longitude is not null
          and e.latitude is not null
          and e.longitude is not null
        then 3958.7613 * acos(
          least(
            1,
            greatest(
              -1,
              sin(radians(p.user_latitude)) * sin(radians(e.latitude)) +
              cos(radians(p.user_latitude)) * cos(radians(e.latitude)) *
              cos(radians(e.longitude) - radians(p.user_longitude))
            )
          )
        )
        else null
      end as computed_distance_miles,
      lower(e.salon_name) = p.query_text
        and p.query_text <> '' as exact_salon_name_match,
      lower(e.salon_name) like p.query_text || '%'
        and p.query_text <> '' as prefix_salon_name_match,
      exists (
        select 1
        from unnest(e.service_names) as service_name
        where lower(service_name) = p.query_text
      )
        or exists (
          select 1
          from unnest(e.service_categories) as service_category
          where lower(service_category) = p.query_text
        ) as exact_service_or_category_match,
      lower(e.salon_name) like '%' || p.query_text || '%'
        or coalesce(lower(e.city), '') like '%' || p.query_text || '%'
        or coalesce(lower(e.state), '') like '%' || p.query_text || '%'
        or coalesce(lower(e.postal_code), '') like '%' || p.query_text || '%'
        or exists (
          select 1
          from unnest(e.service_names) as service_name
          where lower(service_name) like '%' || p.query_text || '%'
        )
        or exists (
          select 1
          from unnest(e.service_categories) as service_category
          where lower(service_category) like '%' || p.query_text || '%'
        ) as partial_text_match,
      p.category_text = ''
        or exists (
          select 1
          from unnest(e.service_categories) as service_category
          where lower(service_category) = p.category_text
        ) as category_filter_match,
      p.location_text = ''
        or coalesce(lower(e.city), '') = p.location_text
        or coalesce(lower(e.state), '') = p.location_text
        or coalesce(lower(e.postal_code), '') = p.location_text
        or (p.location_zip is not null and left(coalesce(e.postal_code, ''), 5) = p.location_zip)
        or lower(
          btrim(concat_ws(' ', e.address_line1, e.city, e.state, e.postal_code))
        ) like '%' || p.location_text || '%'
        or lower(
          btrim(concat_ws(', ', e.city, e.state))
        ) = p.location_text
        or lower(
          btrim(concat_ws(' ', e.city, e.state))
        ) = p.location_text as location_filter_match,
      (
        coalesce(nullif(p.location_zip, ''), nullif(p.query_zip, '')) is not null
        and left(coalesce(e.postal_code, ''), 5) =
          coalesce(nullif(p.location_zip, ''), nullif(p.query_zip, ''))
      ) as exact_zip_match,
      (
        p.location_text <> ''
        and (
          coalesce(lower(e.city), '') = p.location_text
          or lower(btrim(concat_ws(', ', e.city, e.state))) = p.location_text
          or lower(btrim(concat_ws(' ', e.city, e.state))) = p.location_text
        )
      ) as exact_city_state_match,
      p.query_text,
      p.location_text,
      p.category_text,
      p.page_number,
      p.page_size,
      p.user_latitude is not null
        and p.user_longitude is not null as has_user_coordinates
    from eligible e
    cross join params p
  ),
  filtered as (
    select
      s.*,
      case
        when s.query_text <> '' and s.exact_salon_name_match then 1
        when s.query_text <> '' and s.prefix_salon_name_match then 2
        when s.query_text <> '' and s.exact_service_or_category_match then 3
        when s.query_text = '' and s.category_text <> '' then 3
        when s.query_text <> '' and s.partial_text_match then 4
        when s.location_text <> '' or s.has_user_coordinates then 5
        else 6
      end as computed_match_tier
    from scored s
    where
      (s.query_text = ''
        or s.exact_salon_name_match
        or s.prefix_salon_name_match
        or s.exact_service_or_category_match
        or s.partial_text_match)
      and s.category_filter_match
      and s.location_filter_match
  )
  select
    filtered.salon_id,
    filtered.salon_name,
    filtered.phone,
    filtered.address_line1,
    filtered.address_line2,
    filtered.city,
    filtered.state,
    filtered.postal_code,
    filtered.country,
    filtered.description,
    filtered.latitude,
    filtered.longitude,
    filtered.active_service_count,
    filtered.service_categories,
    filtered.service_names,
    filtered.computed_profile_completeness as profile_completeness,
    filtered.computed_match_tier as match_tier,
    filtered.computed_distance_miles as distance_miles,
    filtered.computed_is_new as is_new,
    count(*) over ()::bigint as total_count
  from filtered
  order by
    filtered.computed_match_tier asc,
    filtered.computed_distance_miles asc nulls last,
    filtered.exact_zip_match desc,
    filtered.exact_city_state_match desc,
    filtered.computed_profile_completeness desc,
    filtered.computed_is_new desc,
    filtered.created_at desc,
    filtered.salon_name asc
  limit (select page_size from params)
  offset (
    ((select page_number from params) - 1) *
    (select page_size from params)
  );
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
