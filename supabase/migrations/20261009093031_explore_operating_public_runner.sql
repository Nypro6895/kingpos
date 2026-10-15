-- The selected feed runner uses service_role. Its public data gate remains here.
BEGIN;
CREATE OR REPLACE FUNCTION public.get_public_salon_operating_status_inputs(target_salon_ids uuid[])
RETURNS TABLE(salon_id uuid,lifecycle_status text,timezone_iana text,weekly_hours jsonb,special_hours jsonb)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public SET jit=off AS $$
 SELECT salons.id,public.normalize_salon_lifecycle_status(salons.status),
  coalesce(nullif(btrim(settings.operating_timezone_iana),''),'America/Chicago'),
  coalesce((SELECT jsonb_agg(jsonb_build_object('id',hours.id,'dayOfWeek',hours.day_of_week,
    'opensAt',to_char(hours.opens_at_local,'HH24:MI'),'closesAt',to_char(hours.closes_at_local,'HH24:MI'),'sortOrder',hours.sort_order)
    ORDER BY hours.day_of_week,hours.sort_order,hours.opens_at_local)
   FROM public.salon_operating_hours hours WHERE hours.salon_id=salons.id AND hours.is_active),'[]'::jsonb),
  coalesce((SELECT jsonb_agg(jsonb_build_object('id',special.id,'localDate',special.local_date::text,'status',special.status,
    'opensAt',CASE WHEN special.opens_at_local IS NULL THEN NULL ELSE to_char(special.opens_at_local,'HH24:MI') END,
    'closesAt',CASE WHEN special.closes_at_local IS NULL THEN NULL ELSE to_char(special.closes_at_local,'HH24:MI') END,'reason',special.reason)
    ORDER BY special.local_date)
   FROM public.salon_special_hours special WHERE special.salon_id=salons.id AND special.is_active
    AND special.local_date BETWEEN (now() AT TIME ZONE coalesce(nullif(btrim(settings.operating_timezone_iana),''),'America/Chicago'))::date-1
     AND (now() AT TIME ZONE coalesce(nullif(btrim(settings.operating_timezone_iana),''),'America/Chicago'))::date+30),'[]'::jsonb)
 FROM public.locations salons JOIN public.salon_settings settings ON settings.salon_id=salons.id
 WHERE target_salon_ids IS NOT NULL AND cardinality(target_salon_ids) BETWEEN 1 AND 50
  AND salons.id=ANY(target_salon_ids) AND salons.created_at<=now()
  AND settings.public_discovery_enabled
  AND (settings.public_discovery_published_at IS NULL OR settings.public_discovery_published_at<=now())
  AND public.normalize_salon_lifecycle_status(salons.status) IN ('active','permanently_closed');
$$;
REVOKE ALL ON FUNCTION public.get_public_salon_operating_status_inputs(uuid[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_public_salon_operating_status_inputs(uuid[]) TO anon,authenticated,service_role;
COMMENT ON FUNCTION public.get_public_salon_operating_status_inputs(uuid[]) IS
 'Selected public salons only (maximum50), with publication cutoff and active/closed lifecycle. Shared feed runner supports request cancellation.';
NOTIFY pgrst,'reload schema';
COMMIT;
