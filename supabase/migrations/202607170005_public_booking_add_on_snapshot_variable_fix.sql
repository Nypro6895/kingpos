do $$
declare
  function_definition text;
begin
  select pg_get_functiondef(
    'public.create_public_booking(uuid,timestamptz,timestamptz,text,text,text,text,text,text,text,text,uuid,jsonb)'::regprocedure
  )
  into function_definition;

  if function_definition like '%''parent_service_id'', parent_service_id%' then
    function_definition := replace(
      function_definition,
      '''parent_service_id'', parent_service_id',
      '''parent_service_id'', line_parent_service_id'
    );
    execute function_definition;
  elsif function_definition not like
    '%''parent_service_id'', line_parent_service_id%'
  then
    raise exception 'Expected public booking add-on snapshot expression is missing.';
  end if;
end;
$$;
