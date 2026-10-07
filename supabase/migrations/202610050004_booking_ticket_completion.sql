begin;

-- A closed, reciprocally linked ticket completes only the booking lines it covers.
create or replace function public.sync_booking_completion_from_ticket(p_ticket uuid)
returns void language plpgsql security definer set search_path=public as $$
declare t pos_tickets%rowtype; b bookings%rowtype; changed integer; next_status text;
begin
 select * into t from pos_tickets where id=p_ticket;
 if not found or t.status<>'closed' or t.closed_at is null or t.source_booking_id is null then return; end if;
 perform pg_advisory_xact_lock(hashtextextended('booking-schedule:'||t.salon_id::text,0));
 select * into b from bookings where id=t.source_booking_id and salon_id=t.salon_id for update;
 if not found or b.pos_ticket_id is distinct from t.id or b.customer_id is distinct from t.customer_id
   or b.status not in ('confirmed','scheduled','checked_in','in_service') then return; end if;
 update booking_lines l set line_status='completed',started_at=coalesce(l.started_at,t.opened_at),
   completed_at=t.closed_at,line_status_updated_at=now()
 where l.booking_id=b.id and l.salon_id=b.salon_id
   and l.line_status in ('scheduled','in_service','in_progress')
   and exists(select 1 from pos_ticket_items i where i.pos_ticket_id=t.id and i.salon_id=b.salon_id
     and i.source_booking_id=b.id and i.source_booking_line_id=l.id
     and i.service_id=l.service_id and not coalesce(i.is_removed,false));
 get diagnostics changed=row_count;
 if changed=0 then return; end if;
 next_status:=case when not exists(select 1 from booking_lines l where l.booking_id=b.id and l.salon_id=b.salon_id
   and l.line_status not in ('completed','cancelled','skipped')) then 'completed' else 'in_service' end;
 update bookings set status=next_status,confirmation_status='confirmed' where id=b.id;
 insert into booking_status_events(salon_id,booking_id,event_type,old_status,new_status,actor_source,metadata)
 values(b.salon_id,b.id,'ticket_services_completed',b.status,next_status,'pos',
   jsonb_build_object('ticketId',t.id,'completedLineCount',changed));
end; $$;
revoke all on function public.sync_booking_completion_from_ticket(uuid) from public,anon,authenticated;

create or replace function public.sync_linked_booking_ticket_completion()
returns trigger language plpgsql security definer set search_path=public as $$
begin
 if TG_TABLE_NAME='bookings' then
   if new.pos_ticket_id is not null then perform sync_booking_completion_from_ticket(new.pos_ticket_id); end if;
 else perform sync_booking_completion_from_ticket(new.id);
 end if;
 return new;
end; $$;
revoke all on function public.sync_linked_booking_ticket_completion() from public,anon,authenticated;
create trigger sync_booking_completion_on_ticket_link after update of pos_ticket_id on public.bookings
for each row when (old.pos_ticket_id is distinct from new.pos_ticket_id)
execute function public.sync_linked_booking_ticket_completion();
create trigger sync_booking_completion_on_ticket_close after update of status on public.pos_tickets
for each row when (old.status is distinct from new.status and new.status='closed')
execute function public.sync_linked_booking_ticket_completion();

-- Existing records are eligible only when their original links and line mapping match.
do $$ declare t record; begin
 for t in select id from pos_tickets where status='closed' and source_booking_id is not null loop
   perform sync_booking_completion_from_ticket(t.id);
 end loop;
end; $$;
notify pgrst,'reload schema';
commit;
