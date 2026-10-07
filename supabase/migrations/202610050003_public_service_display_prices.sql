begin;
create function public.get_public_salon_service_prices(target_service_ids uuid[])
returns table(service_id uuid,salon_id uuid,service_name text,base_price numeric)
language sql stable security definer set search_path=public as $$
 select s.id,s.salon_id,s.name,s.base_price from public.services s
 where s.id=any(target_service_ids) and s.is_active and public.salon_profile_public_salon_exists(s.salon_id);
$$;
revoke all on function public.get_public_salon_service_prices(uuid[]) from public;
grant execute on function public.get_public_salon_service_prices(uuid[]) to anon,authenticated,service_role;
notify pgrst,'reload schema';
commit;
