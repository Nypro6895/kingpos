do $$
declare
  function_definition text;
begin
  select pg_get_functiondef(
    'public.get_public_booking_context(uuid,timestamptz,timestamptz)'::regprocedure
  )
  into function_definition;

  if function_definition is null then
    raise exception 'get_public_booking_context function is missing.';
  end if;

  function_definition := replace(
    function_definition,
    $needle$      left join public.services services
        on services.id = looks.service_id
        and services.salon_id = looks.salon_id
        and services.organization_id = looks.organization_id
        and services.is_active = true
        and services.online_booking_enabled = true
      left join public.staff recommended_staff$needle$,
    $replacement$      left join public.services services
        on services.id = looks.service_id
        and services.salon_id = looks.salon_id
        and services.organization_id = looks.organization_id
      left join public.staff recommended_staff$replacement$
  );

  if position(
    $needle$      left join public.services services
        on services.id = looks.service_id
        and services.salon_id = looks.salon_id
        and services.organization_id = looks.organization_id
        and services.is_active = true
        and services.online_booking_enabled = true
      left join public.staff recommended_staff$needle$
    in function_definition
  ) > 0 then
    raise exception 'get_public_booking_context look metadata service join patch failed.';
  end if;

  execute function_definition;
end;
$$;

do $$
declare
  function_definition text;
begin
  select pg_get_functiondef(
    'public.get_public_booking_by_manage_token(text)'::regprocedure
  )
  into function_definition;

  if function_definition is null then
    raise exception 'get_public_booking_by_manage_token function is missing.';
  end if;

  if function_definition not like '%''organization_id'', inspirations.organization_id%' then
    function_definition := replace(
      function_definition,
      $needle$          'id', inspirations.id,
          'booking_id', inspirations.booking_id,$needle$,
      $replacement$          'id', inspirations.id,
          'organization_id', inspirations.organization_id,
          'salon_id', inspirations.salon_id,
          'booking_id', inspirations.booking_id,$replacement$
    );
  end if;

  if function_definition not like '%''organization_id'', inspirations.organization_id%'
    or function_definition not like '%''salon_id'', inspirations.salon_id%'
  then
    raise exception 'get_public_booking_by_manage_token inspiration metadata patch failed.';
  end if;

  execute function_definition;
end;
$$;
