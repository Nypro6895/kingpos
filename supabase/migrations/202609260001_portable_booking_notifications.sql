-- Pending appointments across all dates, scoped to the authenticated device salon.
create or replace function public.get_pos_portable_booking_notifications(p_key_id uuid, p_session_signature text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare salon uuid;
begin
  salon := pos_portable_access_salon_id(p_key_id, p_session_signature);
  if salon is null or not pos_portable_access_has_capability(p_key_id, p_session_signature, 'portable.book.view') then
    raise exception 'Not authorized';
  end if;
  return coalesce((select jsonb_agg(portable_booking_json(salon, b.id) order by b.created_at desc, b.id)
    from bookings b where b.salon_id = salon and b.pos_ticket_id is null
    and (b.status = 'pending' or (b.status = 'scheduled' and b.confirmation_status is distinct from 'confirmed'))), '[]'::jsonb);
end;
$$;
revoke all on function public.get_pos_portable_booking_notifications(uuid,text) from public;
grant execute on function public.get_pos_portable_booking_notifications(uuid,text) to anon,authenticated;
notify pgrst, 'reload schema';
