-- Only published run headers containing the caller's own staff line.
-- Shop-wide settings/corrections and other employees are never exposed.
create or replace function public.get_my_staff_payroll_runs(p_salon_id uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare own_staff_id uuid; matches integer;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  select count(*), min(s.id::text)::uuid into matches, own_staff_id
  from public.staff s where s.salon_id = p_salon_id and s.is_active
    and s.account_user_id = public.current_public_user_id();
  if matches = 0 then
    select count(*), min(s.id::text)::uuid into matches, own_staff_id
    from public.staff s where s.salon_id = p_salon_id and s.is_active
      and s.account_user_id is null and s.user_id = auth.uid();
  end if;
  if matches <> 1 then raise exception 'A unique active staff account link is required'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object(
    'id',r.id,'salon_id',r.salon_id,'period_start',r.period_start,'period_end',r.period_end,
    'cycle_type',r.cycle_type,'status',r.status,'version',r.version,
    'generated_at',r.generated_at,'printed_at',r.printed_at,'locked_at',r.locked_at,
    'paid_at',r.paid_at,'created_at',r.created_at,'updated_at',r.updated_at,
    'printed_by',null,'locked_by',null,'paid_by',null,
    'settings_snapshot','{}'::jsonb,'correction_snapshot','[]'::jsonb
  ) order by r.period_start desc,r.version desc,r.printed_at desc)
  from public.payroll_runs r where r.salon_id=p_salon_id and r.status in ('printed','paid')
    and exists(select 1 from public.payroll_staff_lines l
      where l.payroll_run_id=r.id and l.salon_id=p_salon_id and l.staff_id=own_staff_id)), '[]'::jsonb);
end $$;
revoke all on function public.get_my_staff_payroll_runs(uuid) from public,anon;
grant execute on function public.get_my_staff_payroll_runs(uuid) to authenticated;

-- Storage DELETE also needs SELECT. Only unreferenced files in a salon
-- managed by the tax-company operator may be cleaned up.
create or replace function public.can_cleanup_paystub_object(object_name text)
returns boolean language sql stable security definer set search_path=public as $$
  select case when split_part(object_name,'/',2) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    then public.user_has_salon_permission(split_part(object_name,'/',2)::uuid,array['payroll.tax_company']::text[])
      and not exists(select 1 from public.payroll_paystubs p where p.file_url_or_path=object_name)
    else false end;
$$;
revoke all on function public.can_cleanup_paystub_object(text) from public,anon;
grant execute on function public.can_cleanup_paystub_object(text) to authenticated;
create policy payroll_tax_company_read_unused_paystub_objects on storage.objects
for select to authenticated using(bucket_id='payroll-paystubs' and public.can_cleanup_paystub_object(name));
create policy payroll_tax_company_delete_unused_paystub_objects on storage.objects
for delete to authenticated using(bucket_id='payroll-paystubs' and public.can_cleanup_paystub_object(name));
notify pgrst,'reload schema';
