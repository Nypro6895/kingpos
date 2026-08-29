do $$
declare
  function_signature text;
  target_function regprocedure;
begin
  foreach function_signature in array array[
    'public.get_public_salon_profile_staff(uuid)',
    'public.get_public_salon_profile_looks(uuid)',
    'public.get_public_salon_profile_updates(uuid)'
  ]
  loop
    target_function := to_regprocedure(function_signature);

    if target_function is null then
      raise notice 'Skipping missing public salon profile function %', function_signature;
      continue;
    end if;

    execute format('alter function %s security definer', target_function);
    execute format('alter function %s set search_path = public', target_function);
    execute format('revoke all on function %s from public', target_function);
    execute format('grant execute on function %s to anon, authenticated', target_function);
  end loop;
end $$;
