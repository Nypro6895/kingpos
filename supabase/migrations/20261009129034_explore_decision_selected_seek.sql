-- Keep the owner-only NULL (all active/discoverable salons) contract separate
-- from selected-ID requests. The positive ANY predicate can seek locations_pkey
-- even when the array is a cached PL/pgSQL parameter rather than a SQL literal.
-- The public bounded/publication wrapper, OIDs, privileges and booking/review
-- semantics remain unchanged. No catalog-wide timeout or execution policy change.
BEGIN;
CREATE OR REPLACE FUNCTION public._explore_core_get_public_explore_decision_signals(target_salon_ids uuid[] DEFAULT NULL::uuid[])
RETURNS TABLE(salon_id uuid, average_rating numeric, review_count bigint,
 bookable_service_id uuid, bookable_service_name text, booking_enabled boolean,
 booking_href text, next_available_at timestamp with time zone, next_availability_label text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public','extensions'
AS $function$
BEGIN
 IF target_salon_ids IS NULL THEN
  RETURN QUERY
  SELECT
    salons.id,
    review_summary.average_rating,
    coalesce(review_summary.review_count, 0),
    bookable_service.id,
    bookable_service.name,
    coalesce(booking_settings.booking_enabled, false)
      AND coalesce(booking_settings.online_booking_visible, false)
      AND coalesce(booking_settings.guest_booking_enabled, true)
      AND bookable_service.id IS NOT NULL,
    CASE
      WHEN coalesce(booking_settings.booking_enabled, false)
        AND coalesce(booking_settings.online_booking_visible, false)
        AND coalesce(booking_settings.guest_booking_enabled, true)
        AND bookable_service.id IS NOT NULL
        THEN '/book/' || salons.id::text
      ELSE NULL
    END,
    NULL::timestamptz,
    CASE
      WHEN coalesce(booking_settings.booking_enabled, false)
        AND coalesce(booking_settings.online_booking_visible, false)
        AND coalesce(booking_settings.guest_booking_enabled, true)
        AND bookable_service.id IS NOT NULL
        THEN 'Request a time'
      ELSE NULL
    END
  FROM public.locations salons
  JOIN public.salon_settings settings ON settings.salon_id = salons.id
  LEFT JOIN public.booking_settings ON booking_settings.salon_id = salons.id
  LEFT JOIN LATERAL (
    SELECT services.id, services.name
    FROM public.services
    WHERE services.salon_id = salons.id
      AND services.is_active = true AND services.online_booking_enabled = true
    ORDER BY services.name LIMIT 1
  ) bookable_service ON true
  LEFT JOIN LATERAL (
    SELECT avg(reviews.rating)::numeric AS average_rating, count(*) AS review_count
    FROM public.salon_profile_reviews reviews
    WHERE reviews.salon_id = salons.id AND reviews.moderation_status = 'visible'
  ) review_summary ON true
  WHERE salons.status = 'active' AND settings.public_discovery_enabled = true;
 ELSE
  RETURN QUERY
  SELECT
    salons.id,
    review_summary.average_rating,
    coalesce(review_summary.review_count, 0),
    bookable_service.id,
    bookable_service.name,
    coalesce(booking_settings.booking_enabled, false)
      AND coalesce(booking_settings.online_booking_visible, false)
      AND coalesce(booking_settings.guest_booking_enabled, true)
      AND bookable_service.id IS NOT NULL,
    CASE
      WHEN coalesce(booking_settings.booking_enabled, false)
        AND coalesce(booking_settings.online_booking_visible, false)
        AND coalesce(booking_settings.guest_booking_enabled, true)
        AND bookable_service.id IS NOT NULL
        THEN '/book/' || salons.id::text
      ELSE NULL
    END,
    NULL::timestamptz,
    CASE
      WHEN coalesce(booking_settings.booking_enabled, false)
        AND coalesce(booking_settings.online_booking_visible, false)
        AND coalesce(booking_settings.guest_booking_enabled, true)
        AND bookable_service.id IS NOT NULL
        THEN 'Request a time'
      ELSE NULL
    END
  FROM public.locations salons
  JOIN public.salon_settings settings ON settings.salon_id = salons.id
  LEFT JOIN public.booking_settings ON booking_settings.salon_id = salons.id
  LEFT JOIN LATERAL (
    SELECT services.id, services.name
    FROM public.services
    WHERE services.salon_id = salons.id
      AND services.is_active = true AND services.online_booking_enabled = true
    ORDER BY services.name LIMIT 1
  ) bookable_service ON true
  LEFT JOIN LATERAL (
    SELECT avg(reviews.rating)::numeric AS average_rating, count(*) AS review_count
    FROM public.salon_profile_reviews reviews
    WHERE reviews.salon_id = salons.id AND reviews.moderation_status = 'visible'
  ) review_summary ON true
  WHERE salons.id = ANY(target_salon_ids)
    AND salons.status = 'active' AND settings.public_discovery_enabled = true;
 END IF;
END
$function$;
COMMIT;
