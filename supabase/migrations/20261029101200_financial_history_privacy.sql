begin;

-- Match the Staff portal's exact account-link resolution. An ambiguous primary
-- link must never fall through to legacy rows or pick an arbitrary employee.
create or replace function public.current_user_staff_id_for_salon(target_salon_id uuid) returns uuid
language plpgsql stable security definer set search_path=pg_catalog as $$
declare actor uuid:=public.current_public_user_id(); own_staff uuid; matches integer;
begin
 if actor is null or auth.uid() is null then return null; end if;
 select count(*),min(s.id::text)::uuid into matches,own_staff from public.staff s
  where s.salon_id=target_salon_id and s.is_active and s.account_user_id=actor;
 if matches>0 then return case when matches=1 then own_staff end; end if;
 select count(*),min(s.id::text)::uuid into matches,own_staff from public.staff s
  where s.salon_id=target_salon_id and s.is_active and s.account_user_id is null and s.user_id=auth.uid();
 return case when matches=1 then own_staff end;
end;$$;
revoke all on function public.current_user_staff_id_for_salon(uuid) from public,anon;
grant execute on function public.current_user_staff_id_for_salon(uuid) to authenticated;

-- Existing permission policies remain authoritative for Owner, Manager and
-- other non-Staff roles. Restrictive SELECT policies also constrain FOR ALL
-- policies, so adding a permission to STAFF cannot reveal coworkers' money.
create function public.financial_raw_non_staff_member(p_salon uuid) returns boolean
language sql stable security definer set search_path=pg_catalog as $$
 select exists(select 1 from public.locations l join public.account_memberships m on m.account_id=l.account_id join public.roles r on r.id=m.role_id
   where l.id=p_salon and m.user_id=public.current_public_user_id() and m.status='active' and r.code<>'STAFF')
 or exists(select 1 from public.salon_memberships m join public.roles r on r.id=m.role_id
   where m.salon_id=p_salon and m.user_id=public.current_public_user_id() and m.status='active' and r.code<>'STAFF');
$$;
revoke all on function public.financial_raw_non_staff_member(uuid) from public,anon;
grant execute on function public.financial_raw_non_staff_member(uuid) to authenticated;

do $$declare target text;begin
 foreach target in array array[
  'pos_ticket_staff_earnings','pos_daily_closing_staff_snapshots','pos_financial_adjustments',
  'staff_payroll_settings','payroll_period_staff_inputs','payroll_period_staff_input_history',
  'payroll_staff_daily_totals','payroll_live_change_history'
 ] loop
  execute format('create policy financial_staff_own_read_limit on public.%I as restrictive for select to authenticated using(public.financial_raw_non_staff_member(salon_id) or staff_id=public.current_user_staff_id_for_salon(salon_id))',target);
 end loop;
 foreach target in array array['payroll_staff_lines','payroll_paystubs'] loop
  -- Preserve the separately issued Tax Company connection. Its existing
  -- policies still limit runs/lines to the permitted publication states.
  execute format('create policy financial_staff_own_read_limit on public.%I as restrictive for select to authenticated using(public.financial_raw_non_staff_member(salon_id) or (public.tax_company_has_access(salon_id) and public.current_user_staff_id_for_salon(salon_id) is null) or staff_id=public.current_user_staff_id_for_salon(salon_id))',target);
 end loop;
 foreach target in array array[
  'pos_daily_closings','pos_ticket_adjustments','pos_financial_correction_requests',
  'pos_tickets','pos_payments','pos_ticket_audit_logs','pos_desk_sessions',
  'pos_desk_session_lines','pos_display_channels','pos_live_drafts'
 ] loop
  -- Full receipts, shared drafts and salon closings contain other Staff's
  -- financial data. Staff Daily uses get_my_staff_daily_snapshot instead.
  execute format('create policy financial_shared_read_limit on public.%I as restrictive for select to authenticated using(public.financial_raw_non_staff_member(salon_id))',target);
 end loop;
end;$$;
create policy financial_staff_item_read_limit on public.pos_ticket_items as restrictive for select to authenticated
 using(public.financial_raw_non_staff_member(salon_id) or assigned_staff_id=public.current_user_staff_id_for_salon(salon_id));
create policy financial_staff_part_read_limit on public.pos_ticket_item_turn_parts as restrictive for select to authenticated
 using(public.financial_raw_non_staff_member(salon_id) or staff_id=public.current_user_staff_id_for_salon(salon_id));
create policy financial_shared_run_read_limit on public.payroll_runs as restrictive for select to authenticated
 using(public.financial_raw_non_staff_member(salon_id) or (public.tax_company_has_access(salon_id) and public.current_user_staff_id_for_salon(salon_id) is null));

-- File listing/signing also has legacy cleanup/tax policies. Limit those paths
-- explicitly; filtering payroll_paystubs rows alone does not cover unused files.
create function public.financial_paystub_object_in_scope(p_name text) returns boolean
language sql stable security definer set search_path=pg_catalog as $$
 select exists(select 1 from public.payroll_paystubs p where p.file_url_or_path=p_name and (
   public.financial_raw_non_staff_member(p.salon_id) or p.staff_id=public.current_user_staff_id_for_salon(p.salon_id)
   or (public.tax_company_has_access(p.salon_id) and public.current_user_staff_id_for_salon(p.salon_id) is null)))
 or case when split_part(p_name,'/',2) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
   not exists(select 1 from public.payroll_paystubs p where p.file_url_or_path=p_name) and (
    public.financial_raw_non_staff_member(split_part(p_name,'/',2)::uuid)
    or (public.tax_company_has_access(split_part(p_name,'/',2)::uuid) and public.current_user_staff_id_for_salon(split_part(p_name,'/',2)::uuid) is null))
 else false end;
$$;
revoke all on function public.financial_paystub_object_in_scope(text) from public,anon;
grant execute on function public.financial_paystub_object_in_scope(text) to authenticated;
create policy financial_paystub_object_read_limit on storage.objects as restrictive for select to authenticated
 using(bucket_id<>'payroll-paystubs' or public.financial_paystub_object_in_scope(name));

notify pgrst,'reload schema';
commit;
