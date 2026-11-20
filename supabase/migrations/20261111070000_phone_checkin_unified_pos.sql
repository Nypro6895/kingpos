begin;

-- Save or submit from the normal POS editor with one transaction/revision.
-- No intermediate save can race a staff edit before final settlement.
create function public.phone_checkin_update_pos_ticket(p_salon uuid,p_visit uuid,p_expected integer,p_lines jsonb,p_tip numeric default 0,p_discount numeric default 0,p_finalize boolean default false,p_key uuid default null,p_signature text default null) returns jsonb
language plpgsql security definer set search_path=public as $$
declare t service_relay_tickets; result jsonb;
begin
 if not coalesce(user_has_salon_permission(p_salon,array['tickets.manage']),false)
 and not coalesce(pos_portable_access_salon_id(p_key,p_signature)=p_salon and pos_portable_access_has_capability(p_key,p_signature,'portable.pos.use'),false) then raise exception 'Not authorized'; end if;
 perform staff_scan_reconcile(p_salon);
 select * into t from service_relay_tickets where salon_id=p_salon and visit_id=p_visit for update;
 if t.visit_id is null or t.status='cancelled' then raise exception 'This check-in is no longer available'; end if;
 if t.status='completed' then
  if p_finalize is true then return jsonb_build_object('ticketId',t.pos_ticket_id); end if;
  raise exception 'POS has saved or closed this ticket. Open Your tickets.';
 end if;
 if p_finalize is null or p_tip is null or p_discount is null or p_tip<0 or p_discount<0 then raise exception 'Invalid adjustment'; end if;
 perform staff_scan_desk_save(p_salon,p_visit,p_expected,p_lines,p_key,p_signature);
 update service_relay_tickets set draft_tip=p_tip,draft_discount=p_discount where visit_id=p_visit returning * into t;
 if p_finalize then
  result:=service_relay_submit(p_salon,p_visit,t.revision,p_tip,p_discount,p_key,p_signature);
  return result;
 end if;
 return jsonb_build_object('ticket',service_relay_payload(p_visit));
end $$;
revoke all on function public.phone_checkin_update_pos_ticket(uuid,uuid,integer,jsonb,numeric,numeric,boolean,uuid,text) from public,anon,authenticated;
grant execute on function public.phone_checkin_update_pos_ticket(uuid,uuid,integer,jsonb,numeric,numeric,boolean,uuid,text) to anon,authenticated;

do $$declare definition text;begin
 definition:=pg_get_functiondef('public.service_relay_payload(uuid)'::regprocedure);
 if position('''customerName'',c.name' in definition)=0 then raise exception 'Review relay payload before unified POS'; end if;
 definition:=replace(definition,'''customerName'',c.name','''customerId'',v.customer_id,''customerName'',c.name');
 execute definition;
end $$;
notify pgrst,'reload schema';
commit;
