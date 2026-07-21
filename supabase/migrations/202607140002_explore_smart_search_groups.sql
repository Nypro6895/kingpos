create extension if not exists pg_trgm;

create or replace function public.explore_normalize_text(p_value text)
returns text
language sql
immutable
parallel safe
set search_path = public
as $$
  select btrim(
    regexp_replace(
      regexp_replace(lower(coalesce(p_value, '')), '[^[:alnum:]]+', ' ', 'g'),
      '\s+',
      ' ',
      'g'
    )
  );
$$;

create index if not exists salon_settings_public_business_name_norm_trgm_idx
on public.salon_settings using gin (public.explore_normalize_text(business_name) gin_trgm_ops)
where public_discovery_enabled = true;

create index if not exists locations_public_name_norm_trgm_idx
on public.locations using gin (public.explore_normalize_text(name) gin_trgm_ops)
where status = 'active';

create index if not exists locations_public_city_state_zip_idx
on public.locations (
  public.explore_normalize_text(city),
  public.explore_normalize_text(state),
  postal_code
)
where status = 'active';

create index if not exists services_public_name_norm_trgm_idx
on public.services using gin (public.explore_normalize_text(name) gin_trgm_ops)
where is_active = true;

create index if not exists services_public_category_norm_trgm_idx
on public.services using gin (public.explore_normalize_text(category) gin_trgm_ops)
where is_active = true
  and category is not null;

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
  with state_codes(code) as (
    values
      ('al'), ('ak'), ('az'), ('ar'), ('ca'), ('co'), ('ct'), ('de'), ('dc'),
      ('fl'), ('ga'), ('hi'), ('id'), ('il'), ('in'), ('ia'), ('ks'), ('ky'),
      ('la'), ('me'), ('md'), ('ma'), ('mi'), ('mn'), ('ms'), ('mo'), ('mt'),
      ('ne'), ('nv'), ('nh'), ('nj'), ('nm'), ('ny'), ('nc'), ('nd'), ('oh'),
      ('ok'), ('or'), ('pa'), ('ri'), ('sc'), ('sd'), ('tn'), ('tx'), ('ut'),
      ('vt'), ('va'), ('wa'), ('wv'), ('wi'), ('wy')
  ),
  params_base as (
    select
      public.explore_normalize_text(p_query) as query_text,
      public.explore_normalize_text(p_location) as location_text,
      public.explore_normalize_text(p_category) as category_text,
      nullif(substring(coalesce(p_query, '') from '([0-9]{5})(?:-[0-9]{4})?'), '') as query_zip,
      nullif(substring(coalesce(p_location, '') from '([0-9]{5})(?:-[0-9]{4})?'), '') as location_zip,
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
      least(12, greatest(1, coalesce(p_page_size, 12))) as best_limit,
      8 as nearby_limit,
      8 as recommended_limit
  ),
  parsed_params as (
    select
      params_base.*,
      case
        when params_base.location_text ~ ' [a-z]{2}$'
          and exists (
            select 1
            from state_codes
            where state_codes.code = right(params_base.location_text, 2)
          )
        then right(params_base.location_text, 2)
        when params_base.location_text ~ '^[a-z]{2}$'
          and exists (
            select 1
            from state_codes
            where state_codes.code = params_base.location_text
          )
        then params_base.location_text
        else null
      end as location_state_text,
      case
        when params_base.location_text ~ ' [a-z]{2}$'
          and exists (
            select 1
            from state_codes
            where state_codes.code = right(params_base.location_text, 2)
          )
        then btrim(left(params_base.location_text, length(params_base.location_text) - 3))
        when params_base.location_text ~ '^[a-z]{2}$'
          and exists (
            select 1
            from state_codes
            where state_codes.code = params_base.location_text
          )
        then ''
        else params_base.location_text
      end as location_city_text
    from params_base
  ),
  params as (
    select
      parsed_params.*,
      parsed_params.query_text <> '' as has_query,
      parsed_params.location_text <> '' as has_manual_location,
      parsed_params.category_text <> '' as has_category,
      parsed_params.user_latitude is not null
        and parsed_params.user_longitude is not null as has_user_coordinates
    from parsed_params
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
      ) as service_names,
      coalesce(
        array_agg(distinct public.explore_normalize_text(s.category))
          filter (where public.explore_normalize_text(s.category) <> ''),
        '{}'::text[]
      ) as normalized_service_categories,
      coalesce(
        array_agg(distinct public.explore_normalize_text(s.name))
          filter (where public.explore_normalize_text(s.name) <> ''),
        '{}'::text[]
      ) as normalized_service_names,
      public.explore_normalize_text(coalesce(nullif(btrim(ss.business_name), ''), l.name)) as normalized_salon_name,
      public.explore_normalize_text(coalesce(nullif(btrim(ss.city), ''), l.city)) as normalized_city,
      public.explore_normalize_text(coalesce(nullif(btrim(ss.state), ''), l.state)) as normalized_state,
      public.explore_normalize_text(coalesce(nullif(btrim(ss.postal_code), ''), l.postal_code)) as normalized_postal_code,
      public.explore_normalize_text(
        btrim(
          concat_ws(
            ' ',
            coalesce(nullif(btrim(ss.address_line1), ''), l.address_line1),
            coalesce(nullif(btrim(ss.city), ''), l.city),
            coalesce(nullif(btrim(ss.state), ''), l.state),
            coalesce(nullif(btrim(ss.postal_code), ''), l.postal_code)
          )
        )
      ) as normalized_location_text
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
      p.query_text,
      p.location_text,
      p.location_city_text,
      p.location_state_text,
      p.category_text,
      p.query_zip,
      p.location_zip,
      p.page_number,
      p.best_limit,
      p.nearby_limit,
      p.recommended_limit,
      p.has_query,
      p.has_manual_location,
      p.has_category,
      p.has_user_coordinates,
      p.has_query
        and e.normalized_salon_name = p.query_text as exact_salon_name_match,
      p.has_query
        and e.normalized_salon_name like p.query_text || '%' as prefix_salon_name_match,
      p.has_query
        and length(p.query_text) >= 3
        and e.normalized_salon_name like '%' || p.query_text || '%' as partial_salon_name_match,
      p.has_query
        and length(p.query_text) >= 4
        and similarity(e.normalized_salon_name, p.query_text) >= 0.45 as fuzzy_salon_name_match,
      p.has_query
        and exists (
          select 1
          from unnest(e.normalized_service_names) as service_name
          where service_name = p.query_text
        ) as exact_service_name_match,
      (
        p.has_query
        and exists (
          select 1
          from unnest(e.normalized_service_categories) as service_category
          where service_category = p.query_text
        )
      )
        or (
          p.has_category
          and exists (
            select 1
            from unnest(e.normalized_service_categories) as service_category
            where service_category = p.category_text
          )
        ) as exact_category_match,
      (
        p.has_query
        and length(p.query_text) >= 3
        and (
          exists (
            select 1
            from unnest(e.normalized_service_names) as service_name
            where service_name like '%' || p.query_text || '%'
              or similarity(service_name, p.query_text) >= 0.38
          )
          or exists (
            select 1
            from unnest(e.normalized_service_categories) as service_category
            where service_category like '%' || p.query_text || '%'
              or similarity(service_category, p.query_text) >= 0.38
          )
        )
      )
        or (
          p.has_category
          and length(p.category_text) >= 3
          and exists (
            select 1
            from unnest(e.normalized_service_categories) as service_category
            where service_category like '%' || p.category_text || '%'
              or similarity(service_category, p.category_text) >= 0.38
          )
        ) as partial_service_or_category_match,
      p.has_query
        and p.query_zip is not null
        and left(coalesce(e.postal_code, ''), 5) = p.query_zip as query_exact_zip_match,
      p.has_query
        and (
          e.normalized_city = p.query_text
          or e.normalized_state = p.query_text
          or btrim(concat_ws(' ', e.normalized_city, e.normalized_state)) = p.query_text
        ) as query_exact_city_state_match,
      p.has_manual_location
        and p.location_zip is not null
        and left(coalesce(e.postal_code, ''), 5) = p.location_zip as location_exact_zip_match,
      p.has_manual_location
        and (
          (
            p.location_city_text <> ''
            and e.normalized_city = p.location_city_text
            and (
              p.location_state_text is null
              or p.location_state_text = ''
              or e.normalized_state = p.location_state_text
            )
          )
          or (
            p.location_state_text is not null
            and p.location_city_text = ''
            and e.normalized_state = p.location_state_text
          )
          or btrim(concat_ws(' ', e.normalized_city, e.normalized_state)) = p.location_text
        ) as location_exact_city_state_match,
      p.has_manual_location
        and e.normalized_location_text like '%' || p.location_text || '%' as location_text_match
    from eligible e
    cross join params p
  ),
  scored_with_flags as (
    select
      scored.*,
      (
        scored.location_exact_zip_match
        or scored.location_exact_city_state_match
        or scored.location_text_match
        or scored.computed_distance_miles is not null
      ) as has_location_relevance,
      (
        scored.exact_salon_name_match
        or scored.prefix_salon_name_match
        or scored.partial_salon_name_match
        or scored.fuzzy_salon_name_match
        or scored.exact_service_name_match
        or scored.exact_category_match
        or scored.partial_service_or_category_match
        or scored.query_exact_zip_match
        or scored.query_exact_city_state_match
      ) as has_direct_relevance
    from scored
  ),
  best_candidates as (
    select
      scored_with_flags.*,
      'best_match'::text as result_group,
      case
        when exact_salon_name_match then 'exact_salon_name'
        when prefix_salon_name_match then 'salon_name_prefix'
        when partial_salon_name_match then 'partial_salon_name'
        when fuzzy_salon_name_match then 'fuzzy_salon_name'
        when exact_service_name_match then 'exact_service_name'
        when exact_category_match then 'exact_category'
        when partial_service_or_category_match then 'partial_service_category'
        when query_exact_zip_match then 'exact_zip'
        when query_exact_city_state_match then 'exact_city_state'
        else 'direct_match'
      end as match_type,
      case
        when exact_salon_name_match then 1
        when prefix_salon_name_match then 2
        when partial_salon_name_match or fuzzy_salon_name_match then 3
        when exact_service_name_match then 4
        when exact_category_match then 5
        when partial_service_or_category_match then 6
        when query_exact_zip_match then 7
        when query_exact_city_state_match then 8
        else 9
      end as computed_match_tier,
      case
        when exact_salon_name_match then 10000
        when prefix_salon_name_match then 9000
        when partial_salon_name_match then 8300
        when fuzzy_salon_name_match then 8000 + (similarity(normalized_salon_name, query_text) * 1000)::integer
        when exact_service_name_match then 7000
        when exact_category_match then 6500
        when partial_service_or_category_match then 5600
        when query_exact_zip_match then 5000
        when query_exact_city_state_match then 4500
        else 4000
      end
        + case when location_exact_zip_match then 500 else 0 end
        + case when location_exact_city_state_match then 250 else 0 end
        + least(250, computed_profile_completeness * 2)
        + least(100, active_service_count * 10) as relevance_score
    from scored_with_flags
    where (has_query or has_category)
      and has_direct_relevance
  ),
  best_ranked as (
    select
      best_candidates.*,
      count(*) over ()::bigint as group_total_count,
      row_number() over (
        order by
          computed_match_tier asc,
          relevance_score desc,
          case when has_manual_location then location_exact_zip_match else false end desc,
          case when has_manual_location then location_exact_city_state_match else false end desc,
          computed_distance_miles asc nulls last,
          computed_profile_completeness desc,
          active_service_count desc,
          created_at desc,
          salon_name asc
      ) as group_row_number
    from best_candidates
  ),
  best_page as (
    select *
    from best_ranked
    where group_row_number > ((page_number - 1) * best_limit)
      and group_row_number <= (page_number * best_limit)
  ),
  nearby_candidates as (
    select
      scored_with_flags.*,
      'nearby'::text as result_group,
      'location_match'::text as match_type,
      9 as computed_match_tier,
      3000
        + case when location_exact_zip_match then 700 else 0 end
        + case when location_exact_city_state_match then 450 else 0 end
        + case
            when computed_distance_miles is not null
            then greatest(0, 300 - least(300, round(computed_distance_miles)::integer))
            else 0
          end
        + least(150, computed_profile_completeness)
        + least(100, active_service_count * 10) as relevance_score
    from scored_with_flags
    where (has_manual_location or has_user_coordinates)
      and has_location_relevance
      and not exists (
        select 1
        from best_candidates
        where best_candidates.salon_id = scored_with_flags.salon_id
      )
  ),
  nearby_ranked as (
    select
      nearby_candidates.*,
      count(*) over ()::bigint as group_total_count,
      row_number() over (
        order by
          location_exact_zip_match desc,
          location_exact_city_state_match desc,
          computed_distance_miles asc nulls last,
          computed_profile_completeness desc,
          active_service_count desc,
          created_at desc,
          salon_name asc
      ) as group_row_number
    from nearby_candidates
  ),
  nearby_page as (
    select *
    from nearby_ranked
    where group_row_number <= nearby_limit
  ),
  totals_before_recommended as (
    select
      (select count(*) from best_candidates)::bigint as best_total_count,
      (select count(*) from nearby_candidates)::bigint as nearby_total_count,
      (select count(*) from eligible)::bigint as eligible_total_count,
      (select coalesce(bool_or(has_query), false) from params) as has_query,
      (select coalesce(bool_or(has_category), false) from params) as has_category,
      (select coalesce(bool_or(has_manual_location or has_user_coordinates), false) from params) as has_location
  ),
  recommended_candidates as (
    select
      scored_with_flags.*,
      'recommended'::text as result_group,
      'recommended'::text as match_type,
      10 as computed_match_tier,
      1000
        + least(300, computed_profile_completeness * 3)
        + least(200, active_service_count * 20)
        + case when computed_is_new then 20 else 0 end as relevance_score
    from scored_with_flags
    cross join totals_before_recommended totals
    where not exists (
        select 1
        from best_candidates
        where best_candidates.salon_id = scored_with_flags.salon_id
      )
      and not exists (
        select 1
        from nearby_candidates
        where nearby_candidates.salon_id = scored_with_flags.salon_id
      )
      and (
        not totals.has_query
        or totals.best_total_count = 0
        or totals.nearby_total_count < 4
        or (totals.best_total_count + totals.nearby_total_count) < 8
        or not totals.has_location
      )
  ),
  recommended_ranked as (
    select
      recommended_candidates.*,
      count(*) over ()::bigint as group_total_count,
      row_number() over (
        order by
          computed_profile_completeness desc,
          active_service_count desc,
          computed_is_new desc,
          created_at desc,
          salon_name asc
      ) as group_row_number
    from recommended_candidates
  ),
  recommended_page as (
    select *
    from recommended_ranked
    where group_row_number <= recommended_limit
  ),
  totals as (
    select
      (select count(*) from best_candidates)::bigint as best_total_count,
      (select count(*) from nearby_candidates)::bigint as nearby_total_count,
      (select count(*) from recommended_candidates)::bigint as recommended_total_count
  ),
  combined as (
    select * from best_page
    union all
    select * from nearby_page
    union all
    select * from recommended_page
  )
  select
    combined.salon_id,
    combined.salon_name,
    combined.phone,
    combined.address_line1,
    combined.address_line2,
    combined.city,
    combined.state,
    combined.postal_code,
    combined.country,
    combined.description,
    combined.latitude,
    combined.longitude,
    combined.active_service_count,
    combined.service_categories,
    combined.service_names,
    combined.computed_profile_completeness as profile_completeness,
    combined.result_group,
    combined.match_type,
    combined.relevance_score,
    combined.computed_match_tier as match_tier,
    combined.computed_distance_miles as distance_miles,
    combined.computed_is_new as is_new,
    combined.group_total_count,
    totals.best_total_count as best_match_count,
    totals.nearby_total_count as nearby_count,
    totals.recommended_total_count as recommended_count,
    (
      totals.best_total_count +
      totals.nearby_total_count +
      totals.recommended_total_count
    )::bigint as total_count
  from combined
  cross join totals
  order by
    case combined.result_group
      when 'best_match' then 1
      when 'nearby' then 2
      else 3
    end,
    combined.group_row_number;
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
