-- Use the installed Portable attendance rules with authenticated salon permissions.
-- Keep locking, staff PIN validation, queue fairness and attendance history identical.
do $migration$
declare definition text; start_at integer; end_at integer;
begin
 definition:=pg_get_functiondef('public.submit_pos_portable_attendance_event(uuid,text,uuid,text,text)'::regprocedure);
 definition:=replace(definition,'public.submit_pos_portable_attendance_event(', 'public.submit_owner_pos_attendance_event(');
 start_at:=position('  target_salon_id :=' in definition);
 end_at:=position('  select coalesce(pos_settings.staff_check_in_enabled' in definition);
 if start_at=0 or end_at<=start_at then raise exception 'Attendance implementation needs review';end if;
 definition:=overlay(definition placing '  target_salon_id := p_key_id;
  if auth.uid() is null or not public.user_has_salon_permission(target_salon_id,array[''tickets.manage'']) or not public.salon_is_operational(target_salon_id) then raise exception ''Not authorized'';end if;
' from start_at for end_at-start_at);
 -- The salon UUID is not a Portable device key; do not write it to the device FK.
 definition:=replace(definition,'      p_key_id,','      null,');
 execute definition;
end;$migration$;
revoke all on function public.submit_owner_pos_attendance_event(uuid,text,uuid,text,text) from public,anon;
grant execute on function public.submit_owner_pos_attendance_event(uuid,text,uuid,text,text) to authenticated;
