do $$
declare
  function_definition text;
begin
  select pg_get_functiondef(
    'public.create_public_booking(uuid,timestamptz,timestamptz,text,text,text,text,text,text,text,text,uuid,jsonb)'::regprocedure
  )
  into function_definition;

  if function_definition like
    '%parent_line.booking_id = create_public_booking.booking_id%'
  then
    function_definition := replace(
      function_definition,
      'parent_line.booking_id = create_public_booking.booking_id',
      'parent_line.booking_id = booking_id'
    );
  elsif function_definition not like '%parent_line.booking_id = booking_id%' then
    raise exception 'Expected scoped public booking parent lookup is missing.';
  end if;

  if function_definition not like '%#variable_conflict use_variable%' then
    function_definition := replace(
      function_definition,
      E'AS $function$\ndeclare',
      E'AS $function$\n#variable_conflict use_variable\ndeclare'
    );
  end if;

  if function_definition not like '%#variable_conflict use_variable%' then
    raise exception 'Public booking variable conflict policy patch failed.';
  end if;

  execute function_definition;
end;
$$;
