create or replace function public.get_public_salon_profile(target_salon_id uuid)
returns table (
  account_id uuid,
  salon_id uuid,
  salon_name text,
  phone text,
  email text,
  website text,
  address_line1 text,
  address_line2 text,
  city text,
  state text,
  postal_code text,
  country text,
  description text,
  tagline text,
  story text,
  logo_path text,
  cover_path text,
  public_discovery_published_at timestamptz,
  active_service_count bigint,
  follower_count bigint,
  is_following boolean,
  service_categories text[],
  service_names text[]
)
language sql
stable
security definer
set search_path = public
as $$
  select
    salons.account_id,
    settings.salon_id,
    salons.name,
    settings.phone,
    settings.email,
    settings.website,
    settings.address_line1,
    settings.address_line2,
    settings.city,
    settings.state,
    settings.postal_code,
    settings.country,
    settings.business_description,
    settings.public_profile_tagline,
    settings.public_profile_story,
    settings.public_profile_logo_path,
    settings.public_profile_cover_path,
    settings.public_discovery_published_at,
    (select count(*) from public.services where services.salon_id = settings.salon_id and services.is_active = true),
    (select count(*) from public.salon_profile_follows follows where follows.salon_id = settings.salon_id),
    false,
    coalesce(array(select distinct category from public.services where salon_id = settings.salon_id and category is not null), '{}'),
    coalesce(array(select name from public.services where salon_id = settings.salon_id and is_active = true order by name), '{}')
  from public.salon_settings settings
  join public.locations salons on salons.id = settings.salon_id
  where settings.salon_id = target_salon_id
    and public.salon_profile_public_salon_exists(target_salon_id)
$$;
