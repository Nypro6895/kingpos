begin;
create or replace function public.save_pos_workspace_booking(p_booking uuid,p_expected timestamptz,p_changes jsonb)
returns uuid language plpgsql security definer set search_path=public as $$
declare b bookings%rowtype; assignment jsonb; target uuid; actor uuid:=current_public_user_id(); next_status text; old_status text; reason text; override_reason text;
begin
 select * into b from bookings where id=p_booking for update;
 if b.id is null or actor is null or not user_has_salon_permission(b.salon_id,array['booking.manage']::text[]) then raise exception 'Not authorized';end if;
 if p_expected is null or b.updated_at is distinct from p_expected then raise exception 'This appointment changed on another screen. Review the latest appointment before saving.';end if;
 if not salon_is_operational(b.salon_id) then raise exception 'This salon is not active.';end if;
 override_reason:=nullif(btrim(p_changes->>'override_reason'),'');
 if p_changes ? 'start_at' then
   perform reschedule_canonical_booking(b.id,(p_changes->>'start_at')::timestamptz,(p_changes->>'end_at')::timestamptz,override_reason);
 end if;
 if p_changes ? 'lines' then
   perform replace_booking_services(b.id,p_changes->'lines',(p_changes->>'end_at')::timestamptz,override_reason);
 elsif p_changes ? 'assignments' then
   if b.status in ('completed','cancelled','no_show') then raise exception 'This appointment can no longer be reassigned.';end if;
   if jsonb_typeof(p_changes->'assignments')<>'array' or jsonb_array_length(p_changes->'assignments')=0 then raise exception 'Choose a professional for each service.';end if;
   for assignment in select value from jsonb_array_elements(p_changes->'assignments') loop
     target:=nullif(assignment->>'staffId','')::uuid;
     if target is not null and not exists(select 1 from staff where id=target and salon_id=b.salon_id and is_active) then raise exception 'Choose a current salon professional.';end if;
     update booking_lines set assigned_staff_id=target,
       overbooking_override_reason=coalesce(override_reason,overbooking_override_reason),
       overbooking_override_by_user_id=case when override_reason is null then overbooking_override_by_user_id else actor end,
       overbooking_override_at=case when override_reason is null then overbooking_override_at else now() end
     where id=(assignment->>'bookingLineId')::uuid and booking_id=b.id and salon_id=b.salon_id;
     if not found then raise exception 'Appointment services changed. Review this appointment.';end if;
   end loop;
   select assigned_staff_id into target from booking_lines where booking_id=b.id and assigned_staff_id is not null order by display_order limit 1;
   update bookings set staff_id=target,updated_by_user_id=actor where id=b.id;
 end if;
 if p_changes ? 'command' then
   old_status:=case when b.status='scheduled' then 'confirmed' else b.status end;
   next_status:=case p_changes->>'command' when 'confirm' then 'confirmed' when 'check_in' then 'checked_in' when 'start_service' then 'in_service' when 'complete' then 'completed' when 'cancel' then 'cancelled' when 'mark_no_show' then 'no_show' end;
   if next_status is null or (next_status<>old_status and not (
      (old_status='pending' and next_status in ('confirmed','cancelled')) or
      (old_status='confirmed' and next_status in ('checked_in','cancelled','no_show')) or
      (old_status='checked_in' and next_status in ('in_service','cancelled')) or
      (old_status='in_service' and next_status='completed'))) then raise exception 'This appointment status cannot be changed that way.';end if;
   reason:=nullif(btrim(p_changes->>'reason'),'');
   update bookings set status=next_status,confirmation_status=case when next_status in ('cancelled','no_show') then 'cancelled' else 'confirmed' end,
     cancellation_reason=case when next_status='cancelled' then coalesce(reason,'Cancelled by owner.') else cancellation_reason end,
     cancelled_at=case when next_status='cancelled' then now() else cancelled_at end,
     cancelled_by_user_id=case when next_status='cancelled' then actor else cancelled_by_user_id end,
     no_show_at=case when next_status='no_show' then now() else no_show_at end,
     no_show_by_user_id=case when next_status='no_show' then actor else no_show_by_user_id end,
     no_show_reason=case when next_status='no_show' then reason else no_show_reason end,
     updated_by_user_id=actor where id=b.id;
 end if;
 insert into booking_status_events(salon_id,booking_id,event_type,old_status,new_status,actor_user_id,actor_source,metadata)
 values(b.salon_id,b.id,'workspace_updated',b.status,coalesce(next_status,b.status),actor,'manage',jsonb_build_object('changes',p_changes));
 return b.id;
end;$$;
revoke all on function public.save_pos_workspace_booking(uuid,timestamptz,jsonb) from public,anon;
grant execute on function public.save_pos_workspace_booking(uuid,timestamptz,jsonb) to authenticated;
create or replace function public.get_pos_workspace_catalog(p_key uuid,p_signature text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare salon uuid;begin
 salon:=pos_portable_access_salon_id(p_key,p_signature);
 if salon is null or not pos_portable_access_has_capability(p_key,p_signature,'portable.pos.use') then raise exception 'Not authorized';end if;
 return (select coalesce(jsonb_agg(jsonb_build_object('id',id,'name',name,'category',category,'base_price',base_price,'duration_minutes',duration_minutes) order by name),'[]'::jsonb) from services where salon_id=salon and is_active);
end;$$;
revoke all on function public.get_pos_workspace_catalog(uuid,text) from public;
grant execute on function public.get_pos_workspace_catalog(uuid,text) to anon,authenticated;
drop trigger if exists pos_workspace_changed on public.services;
create trigger pos_workspace_changed after insert or update or delete on public.services for each row execute function public.notify_pos_workspace_change('catalog','id');
commit;
