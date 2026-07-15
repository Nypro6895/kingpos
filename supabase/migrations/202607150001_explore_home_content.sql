alter table public.salon_settings
add column if not exists public_discovery_published_at timestamptz;

comment on column public.salon_settings.public_discovery_published_at is
  'First time this salon setting became publicly discoverable on Explore. Existing published salons are backfilled from updated_at.';

update public.salon_settings
set public_discovery_published_at = coalesce(updated_at, created_at, now())
where public_discovery_enabled = true
  and public_discovery_published_at is null;

create or replace function public.set_public_discovery_published_at()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  if new.public_discovery_enabled is true
    and new.public_discovery_published_at is null
  then
    new.public_discovery_published_at :=
      case
        when tg_op = 'UPDATE' then coalesce(old.public_discovery_published_at, now())
        else now()
      end;
  end if;

  return new;
end;
$$;

drop trigger if exists set_salon_settings_public_discovery_published_at
on public.salon_settings;

create trigger set_salon_settings_public_discovery_published_at
before insert or update of public_discovery_enabled, public_discovery_published_at
on public.salon_settings
for each row
execute function public.set_public_discovery_published_at();

create index if not exists salon_settings_public_discovery_published_idx
on public.salon_settings (public_discovery_published_at desc, salon_id)
where public_discovery_enabled = true
  and public_discovery_published_at is not null;

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
  with limits as (
    select
      least(6, greatest(0, coalesce(p_recommended_limit, 6))) as recommended_limit,
      least(6, greatest(0, coalesce(p_new_limit, 6))) as new_limit
  ),
  eligible_base as (
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
      ss.public_discovery_published_at,
      l.created_at,
      greatest(
        coalesce(ss.updated_at, 'epoch'::timestamptz),
        coalesce(l.updated_at, 'epoch'::timestamptz)
      ) as updated_at
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
      l.updated_at,
      ss.business_name,
      ss.phone,
      ss.address_line1,
      ss.address_line2,
      ss.city,
      ss.state,
      ss.postal_code,
      ss.country,
      ss.business_description,
      ss.public_discovery_published_at,
      ss.updated_at
    having count(distinct s.id) > 0
  ),
  eligible as (
    select
      eligible_base.*,
      (
        (
          case when length(btrim(coalesce(salon_name, ''))) > 0 then 1 else 0 end +
          case when length(btrim(coalesce(phone, ''))) > 0 then 1 else 0 end +
          case when length(btrim(coalesce(address_line1, ''))) > 0 then 1 else 0 end +
          case when length(btrim(coalesce(city, ''))) > 0 then 1 else 0 end +
          case when length(btrim(coalesce(state, ''))) > 0 then 1 else 0 end +
          case when length(btrim(coalesce(postal_code, ''))) > 0 then 1 else 0 end +
          case when length(btrim(coalesce(description, ''))) > 0 then 1 else 0 end +
          case when active_service_count > 0 then 1 else 0 end
        ) * 100 / 8
      )::integer as computed_profile_completeness,
      coalesce(public_discovery_published_at, created_at) >= now() - interval '60 days'
        as computed_is_new
    from eligible_base
  ),
  recommended_ranked as (
    select
      eligible.*,
      row_number() over (
        order by
          computed_profile_completeness desc,
          active_service_count desc,
          coalesce(public_discovery_published_at, updated_at, created_at) desc,
          created_at desc,
          salon_name asc,
          salon_id asc
      )::integer as home_rank
    from eligible
  ),
  recommended_page as (
    select *
    from recommended_ranked
    where home_rank <= (select recommended_limit from limits)
  ),
  new_ranked as (
    select
      eligible.*,
      row_number() over (
        order by
          coalesce(public_discovery_published_at, created_at) desc,
          created_at desc,
          salon_name asc,
          salon_id asc
      )::integer as home_rank
    from eligible
    where not exists (
      select 1
      from recommended_page
      where recommended_page.salon_id = eligible.salon_id
    )
  ),
  new_page as (
    select *
    from new_ranked
    where home_rank <= (select new_limit from limits)
  ),
  combined as (
    select 'recommended'::text as section, recommended_page.*
    from recommended_page
    union all
    select 'new'::text as section, new_page.*
    from new_page
  )
  select
    combined.section,
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
    combined.public_discovery_published_at,
    combined.created_at,
    combined.updated_at,
    combined.computed_is_new as is_new,
    combined.home_rank
  from combined
  order by
    case combined.section
      when 'recommended' then 1
      else 2
    end,
    combined.home_rank;
$$;

drop function if exists public.get_public_explore_popular_services(integer);

create function public.get_public_explore_popular_services(
  p_limit integer default 8
)
returns table (
  category text,
  salon_count bigint,
  active_service_count bigint
)
language sql
stable
security definer
set search_path = public
as $$
  with limits as (
    select least(12, greatest(0, coalesce(p_limit, 8))) as category_limit
  ),
  eligible_salons as (
    select l.id as salon_id
    from public.locations l
    join public.salon_settings ss
      on ss.salon_id = l.id
      and ss.organization_id = l.organization_id
    where l.status = 'active'
      and ss.public_discovery_enabled = true
      and length(btrim(coalesce(ss.business_name, l.name, ''))) > 0
      and length(btrim(coalesce(ss.phone, l.phone, ''))) > 0
      and length(btrim(coalesce(ss.address_line1, l.address_line1, ''))) > 0
      and length(btrim(coalesce(ss.city, l.city, ''))) > 0
      and length(btrim(coalesce(ss.state, l.state, ''))) > 0
      and length(btrim(coalesce(ss.postal_code, l.postal_code, ''))) > 0
      and length(btrim(coalesce(ss.business_description, ''))) > 0
      and exists (
        select 1
        from public.services active_services
        where active_services.salon_id = l.id
          and active_services.organization_id = l.organization_id
          and active_services.is_active = true
      )
  ),
  category_counts as (
    select
      initcap(public.explore_normalize_text(s.category)) as category,
      count(distinct s.salon_id)::bigint as salon_count,
      count(*)::bigint as active_service_count
    from public.services s
    join eligible_salons
      on eligible_salons.salon_id = s.salon_id
    where s.is_active = true
      and public.explore_normalize_text(s.category) <> ''
    group by public.explore_normalize_text(s.category)
  )
  select
    category_counts.category,
    category_counts.salon_count,
    category_counts.active_service_count
  from category_counts
  order by
    category_counts.salon_count desc,
    category_counts.active_service_count desc,
    category_counts.category asc
  limit (select category_limit from limits);
$$;

revoke all on function public.get_public_explore_home_salons(integer, integer)
from public;

grant execute on function public.get_public_explore_home_salons(integer, integer)
to anon, authenticated;

revoke all on function public.get_public_explore_popular_services(integer)
from public;

grant execute on function public.get_public_explore_popular_services(integer)
to anon, authenticated;
