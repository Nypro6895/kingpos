begin;

-- Only legal-name fields are shared with an authorized salon reader. Personal
-- profile rows and write permissions remain private to their owners.
create function public.get_staff_legal_names(p_salon uuid, p_staff uuid[])
returns table(staff_id uuid, first_name text, last_name text)
language plpgsql stable security definer set search_path=pg_catalog as $$
declare actor uuid := public.current_public_user_id(); can_read_salon boolean;
begin
  if actor is null then raise exception 'Sign in required.'; end if;
  if p_salon is null or coalesce(cardinality(p_staff),0)>500 then raise exception 'Invalid staff scope.'; end if;
  can_read_salon := public.user_has_salon_permission(p_salon,array['staff.view','staff.manage','payroll.view','payroll.manage','payroll.tax_company']::text[])
    or public.tax_company_has_access(p_salon);
  return query
  select s.id,
    case when s.account_user_id is not null or s.user_id is not null then u.first_name else s.first_name end,
    case when s.account_user_id is not null or s.user_id is not null then u.last_name else s.last_name end
  from public.staff s
  left join public.users u on (s.account_user_id is not null and u.id=s.account_user_id)
    or (s.account_user_id is null and s.user_id is not null and u.auth_user_id=s.user_id)
  where s.salon_id=p_salon and s.id=any(p_staff)
    and (can_read_salon or (s.is_active and (s.account_user_id=actor
      or (s.account_user_id is null and s.user_id=auth.uid()))));
end $$;
revoke all on function public.get_staff_legal_names(uuid,uuid[]) from public,anon;
grant execute on function public.get_staff_legal_names(uuid,uuid[]) to authenticated;
notify pgrst, 'reload schema';
commit;
