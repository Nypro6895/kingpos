do $$
declare
  function_definition text;
  validation_after text := $replacement$  if nullif(btrim(coalesce(p_source_reference_type, '')), '') is not null then
    if p_source_reference_id is null then
      raise exception 'Booking source context is not available.';
    end if;

    if p_source_reference_type = 'salon_profile_look' then
      if not exists (
        select 1
        from public.salon_profile_looks
        where salon_profile_looks.id = p_source_reference_id
          and salon_profile_looks.salon_id = p_salon_id
          and salon_profile_looks.organization_id = location_organization_id
          and salon_profile_looks.status = 'published'
      )
      then
        raise exception 'Booking source context is not available.';
      end if;
    elsif p_source_reference_type = 'salon_profile_update' then
      if not exists (
        select 1
        from public.get_public_content_booking_options(array[p_salon_id]::uuid[]) options
        where options.source_type = 'salon_profile_update'
          and options.content_id = p_source_reference_id
          and options.salon_id = p_salon_id
          and options.organization_id = location_organization_id
          and options.booking_cta_enabled is true
          and options.booking_enabled is true
          and options.booking_href is not null
          and options.readiness_state <> 'invalid'
      )
      then
        raise exception 'Booking source context is not available.';
      end if;
    else
      raise exception 'Booking source context is not available.';
    end if;
  end if;
$replacement$;
  validation_before text := $needle$  if nullif(btrim(coalesce(p_source_reference_type, '')), '') is not null then
    if p_source_reference_type <> 'salon_profile_look'
      or p_source_reference_id is null
      or not exists (
        select 1
        from public.salon_profile_looks
        where salon_profile_looks.id = p_source_reference_id
          and salon_profile_looks.salon_id = p_salon_id
          and salon_profile_looks.organization_id = location_organization_id
          and salon_profile_looks.status = 'published'
      )
    then
      raise exception 'Booking source context is not available.';
    end if;
  end if;
$needle$;
begin
  select pg_get_functiondef(
    'public.create_public_booking(uuid,timestamptz,timestamptz,text,text,text,text,text,text,text,text,uuid,jsonb)'::regprocedure
  )
  into function_definition;

  if function_definition is null then
    raise exception 'create_public_booking function is missing.';
  end if;

  if position(validation_after in function_definition) = 0 then
    if position(validation_before in function_definition) = 0 then
      raise exception 'create_public_booking source validation block was not found.';
    end if;

    function_definition := replace(function_definition, validation_before, validation_after);
  end if;

  if position(validation_after in function_definition) = 0 then
    raise exception 'create_public_booking profile update source validation patch failed.';
  end if;

  if function_definition not like '%#variable_conflict use_variable%'
    or function_definition not like '%public.capture_booking_inspiration_snapshot%'
  then
    raise exception 'create_public_booking canonical behavior checks failed.';
  end if;

  execute function_definition;
end;
$$;

revoke all on function public.create_public_booking(
  uuid,
  timestamp with time zone,
  timestamp with time zone,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  uuid,
  jsonb
) from public;

grant execute on function public.create_public_booking(
  uuid,
  timestamp with time zone,
  timestamp with time zone,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  uuid,
  jsonb
) to anon, authenticated;

notify pgrst, 'reload schema';
