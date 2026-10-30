begin;
-- Activity previously needed only a next-appointment preview (hard cap10).
-- The shared Bookings list must honor the same bounded caller limit instead.
do $$declare original text; updated text;begin
 original:=pg_get_functiondef('public.get_customer_activity_before_history(integer)'::regprocedure);
 updated:=regexp_replace(original,'(limit[[:space:]]+)10([[:space:]]*\)[[:space:]]*upcoming_bookings)','\1clean_limit\2','i');
 if updated=original then raise exception 'Upcoming read definition changed; review journey migration'; end if;
 execute updated;
end;$$;
-- Add display metadata to the existing authorized read. Preserve its exact
-- receipt, payment, estimate, evidence and ordering payloads.
alter function public.get_customer_activity(integer) rename to get_customer_activity_before_journey;
revoke all on function public.get_customer_activity_before_journey(integer) from public, anon, authenticated, service_role;

create function public.get_customer_activity(p_limit integer default 40) returns jsonb
language plpgsql stable security definer set search_path=public as $$
declare actor uuid:=current_public_user_id(); result jsonb;
begin
 result:=get_customer_activity_before_journey(p_limit);
 if actor is null or result->>'ok' is distinct from 'true' then return result; end if;
 return jsonb_set(result,'{purchases}',coalesce((
   select jsonb_agg(p.item||jsonb_build_object('visitType',case
     when t.source_booking_id is not null
       or exists(select 1 from bookings b where b.salon_id=t.salon_id and b.pos_ticket_id=t.id)
       or exists(select 1 from customer_visits v where v.salon_id=t.salon_id and v.ticket_id=t.id and v.appointment_id is not null)
       or exists(select 1 from customer_history_links h where h.salon_id=t.salon_id and
         (h.ticket_id=t.id or h.visit_id in(select v.id from customer_visits v where v.salon_id=t.salon_id and v.ticket_id=t.id)))
       then 'appointment'
     when exists(select 1 from customer_visits v where v.salon_id=t.salon_id and v.ticket_id=t.id
       and v.source in ('walk_in','customer_screen') and v.appointment_id is null) then 'walk_in'
     else 'unknown' end) order by p.ordinality)
   from jsonb_array_elements(result->'purchases') with ordinality p(item,ordinality)
   left join pos_tickets t on t.id=(p.item->>'ticketId')::uuid
     and exists(select 1 from customers c where c.id=t.customer_id and c.location_id=t.salon_id and c.customer_user_id=actor)
 ),'[]'::jsonb));
end;$$;
revoke all on function public.get_customer_activity(integer) from public, anon;
grant execute on function public.get_customer_activity(integer) to authenticated;
-- Retain compatibility when the original function and the installer have
-- different trusted owners. The private implementation is never a public RPC.
do $$declare owner_name text;begin
 select pg_get_userbyid(proowner) into owner_name from pg_proc where oid='public.get_customer_activity(integer)'::regprocedure;
 execute format('grant execute on function public.get_customer_activity_before_journey(integer) to %I',owner_name);
end;$$;
notify pgrst,'reload schema';
commit;
