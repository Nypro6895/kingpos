-- Preserve the established attendance rules; expose their leave context to
-- the authorized local client so return-to-work can apply the same formula.
do $$ begin
  if to_regprocedure('public.get_pos_portable_check_in_data_without_leave_context(uuid,text)') is null then
    alter function public.get_pos_portable_check_in_data(uuid,text) rename to get_pos_portable_check_in_data_without_leave_context;
  end if;
end $$;
create or replace function public.get_pos_portable_check_in_data(p_key_id uuid,p_session_signature text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare result jsonb; salon uuid; rows jsonb;
begin
  result:=public.get_pos_portable_check_in_data_without_leave_context(p_key_id,p_session_signature);
  salon:=public.pos_portable_access_salon_id(p_key_id,p_session_signature);
  if salon is null then raise exception 'Not authorized'; end if;
  select coalesce(jsonb_agg(item || jsonb_build_object(
    'leaveCohortStaffIds',coalesce(w.leave_cohort_staff_ids,'{}'::uuid[]),
    'leaveBaselineTurnCount',w.leave_baseline_turn_count) order by ordinal),'[]'::jsonb)
  into rows from jsonb_array_elements(result->'staff') with ordinality as s(item,ordinal)
  left join public.staff_workdays w on w.salon_id=salon and w.staff_id=(item->>'id')::uuid and w.work_date=(result->>'today')::date;
  return jsonb_set(result,'{staff}',rows);
end $$;
revoke all on function public.get_pos_portable_check_in_data_without_leave_context(uuid,text) from public,anon,authenticated;
revoke all on function public.get_pos_portable_check_in_data(uuid,text) from public;
grant execute on function public.get_pos_portable_check_in_data(uuid,text) to anon,authenticated;
