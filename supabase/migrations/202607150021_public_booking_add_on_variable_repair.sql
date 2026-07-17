do $$
declare
  function_definition text;
begin
  select pg_get_functiondef(
    'public.create_public_booking(uuid,timestamptz,timestamptz,text,text,text,text,text,text,text,text,uuid,jsonb)'::regprocedure
  )
  into function_definition;

  if function_definition is null then
    raise exception 'create_public_booking function is missing.';
  end if;

  function_definition := replace(
    function_definition,
    '  parent_service_id uuid;',
    '  line_parent_service_id uuid;'
  );
  function_definition := replace(
    function_definition,
    '    parent_service_id := nullif(line_row ->> ''parent_service_id'', '''')::uuid;',
    '    line_parent_service_id := nullif(line_row ->> ''parent_service_id'', '''')::uuid;'
  );
  function_definition := replace(
    function_definition,
    '      if parent_service_id is null or not exists (',
    '      if line_parent_service_id is null or not exists ('
  );
  function_definition := replace(
    function_definition,
    '          and service_add_on_links.parent_service_id = parent_service_id',
    '          and service_add_on_links.parent_service_id = line_parent_service_id'
  );

  if function_definition not like '%line_parent_service_id%' then
    raise exception 'create_public_booking repair did not modify the function definition.';
  end if;

  execute function_definition;
end $$;
