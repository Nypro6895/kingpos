do $$
declare
  function_definition text;
begin
  select pg_get_functiondef(
    'public.create_public_booking(uuid,timestamptz,timestamptz,text,text,text,text,text,text,text,text,uuid,jsonb)'::regprocedure
  )
  into function_definition;

  if function_definition like '%parent_line.booking_id = booking_id%'
    and function_definition not like '%#variable_conflict use_variable%'
  then
    function_definition := replace(
      function_definition,
      'parent_line.booking_id = booking_id',
      'parent_line.booking_id = create_public_booking.booking_id'
    );
    execute function_definition;
  elsif function_definition not like '%parent_line.booking_id = booking_id%'
    and function_definition not like
      '%parent_line.booking_id = create_public_booking.booking_id%'
  then
    raise exception 'Expected public booking parent lookup is missing.';
  end if;
end;
$$;
