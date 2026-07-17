create or replace function public.get_public_explore_decision_signals(
  target_salon_ids uuid[]
)
returns table (
  salon_id uuid,
  average_rating numeric,
  review_count bigint,
  booking_enabled boolean,
  bookable_service_id uuid,
  bookable_service_name text,
  next_available_at timestamptz,
  next_availability_label text,
  booking_href text
)
language sql
stable
security definer
set search_path = public
as $$
  with requested_salons as (
    select distinct requested_ids.salon_id
    from unnest(coalesce(target_salon_ids, array[]::uuid[])) as requested_ids(salon_id)
    where requested_ids.salon_id is not null
  )
  select
    requested_salons.salon_id,
    reviews.average_rating,
    coalesce(reviews.review_count, 0)::bigint as review_count,
    false::boolean as booking_enabled,
    null::uuid as bookable_service_id,
    null::text as bookable_service_name,
    null::timestamptz as next_available_at,
    null::text as next_availability_label,
    null::text as booking_href
  from requested_salons
  left join lateral public.get_public_salon_profile_review_summary(
    requested_salons.salon_id
  ) reviews
    on true
  where public.salon_profile_public_salon_exists(requested_salons.salon_id);
$$;

comment on function public.get_public_explore_decision_signals(uuid[])
is 'Public Explore card decision signals. Booking remains disabled until real public booking settings, staff schedules, time off, and service assignment data exist.';

revoke all on function public.get_public_explore_decision_signals(uuid[])
from public;

grant execute on function public.get_public_explore_decision_signals(uuid[])
to anon, authenticated;
