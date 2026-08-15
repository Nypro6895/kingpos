do $$
declare
  target_function regprocedure;
begin
  target_function := to_regprocedure('public.get_public_salon_profile_reviews(uuid)');

  if target_function is null then
    raise notice 'Skipping missing public salon profile function get_public_salon_profile_reviews(uuid)';
    return;
  end if;

  execute format('alter function %s security definer', target_function);
  execute format('alter function %s set search_path = public', target_function);
  execute format('revoke all on function %s from public', target_function);
  execute format('grant execute on function %s to anon, authenticated', target_function);
end $$;
