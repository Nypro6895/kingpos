-- Keep the installed receipt implementation (turns, earnings, visits and payment)
-- intact, and link an appointment in the same transaction as submitting its ticket.
do $patch$
declare definition text;
begin
 definition:=pg_get_functiondef('public.submit_pos_portable_receipt(uuid,text,jsonb,date)'::regprocedure);
 definition:=replace(definition,'public.submit_pos_portable_receipt(', 'public.submit_pos_portable_receipt_without_booking(');
 execute definition;
end; $patch$;
revoke all on function public.submit_pos_portable_receipt_without_booking(uuid,text,jsonb,date) from public,anon,authenticated;

create or replace function public.submit_pos_portable_receipt(p_key_id uuid,p_session_signature text,p_receipt jsonb,p_work_date date default current_date)
returns jsonb language plpgsql security definer set search_path=public as $$
declare salon uuid; booking bookings%rowtype; result jsonb; target_booking_id uuid; ticket uuid;
begin
 target_booking_id:=nullif(p_receipt->>'sourceBookingId','')::uuid;
 if target_booking_id is null then return submit_pos_portable_receipt_without_booking(p_key_id,p_session_signature,p_receipt,p_work_date); end if;
 salon:=pos_portable_access_salon_id(p_key_id,p_session_signature);
 if salon is null or not pos_portable_access_has_capability(p_key_id,p_session_signature,'portable.pos.use')
   or not pos_portable_access_has_capability(p_key_id,p_session_signature,'portable.book.view') then raise exception 'Not authorized'; end if;
 perform pg_advisory_xact_lock(hashtextextended('booking-schedule:'||salon::text,0));
 select * into booking from bookings where id=target_booking_id and salon_id=salon for update;
 if not found then raise exception 'Appointment not found in this salon'; end if;
 if booking.pos_ticket_id is not null then raise exception 'This appointment already has a ticket. No duplicate ticket was created.'; end if;
 if booking.status not in ('confirmed','scheduled','checked_in','in_service') then raise exception 'This appointment is not ready for a ticket. Check its latest status.'; end if;
 if nullif(p_receipt->>'sourceBookingUpdatedAt','') is not null and (p_receipt->>'sourceBookingUpdatedAt')::timestamptz<>booking.updated_at then raise exception 'This appointment changed. Reopen it in Booking before submitting the ticket.'; end if;
 if nullif(p_receipt->>'customerId','')::uuid is distinct from booking.customer_id then raise exception 'The ticket customer must match the appointment.'; end if;
 result:=submit_pos_portable_receipt_without_booking(p_key_id,p_session_signature,p_receipt,p_work_date);
 ticket:=(result->>'ticketId')::uuid;
 if ticket is null then raise exception 'Ticket could not be created'; end if;
 update pos_tickets set source_booking_id=target_booking_id where id=ticket and salon_id=salon;
 update pos_ticket_items i set source_booking_id=target_booking_id,source_kind='booking',
   source_booking_line_id=(select l.id from booking_lines l where l.booking_id=target_booking_id and l.line_status<>'cancelled' and l.service_id=i.service_id order by l.display_order limit 1)
 where i.pos_ticket_id=ticket and i.salon_id=salon;
 update bookings set pos_ticket_id=ticket where id=target_booking_id;
 insert into booking_status_events(salon_id,booking_id,event_type,old_status,new_status,actor_source,metadata)
 values(salon,target_booking_id,'portable_ticket_created',booking.status,booking.status,'pos',jsonb_build_object('ticketId',ticket,'keyId',p_key_id));
 return result;
end; $$;
revoke all on function public.submit_pos_portable_receipt(uuid,text,jsonb,date) from public;
grant execute on function public.submit_pos_portable_receipt(uuid,text,jsonb,date) to anon,authenticated;
notify pgrst,'reload schema';
