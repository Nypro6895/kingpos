begin;
alter table public.service_relay_tickets add column draft_note text not null default '' check(length(draft_note)<=2000);
do $$declare definition text;begin
 definition:=pg_get_functiondef('public.staff_scan_desk_save(uuid,uuid,integer,jsonb,uuid,text)'::regprocedure);
 definition:=replace(definition,'update service_relay_offers set status=''done'' where visit_id=p_visit and status=''working'';','-- Saving never finishes a staff member.');
 definition:=replace(definition,'and status=''done'' order by created_at limit 1;','and status in (''working'',''done'') order by (status=''working'') desc,created_at limit 1;');
 definition:=replace(definition,'status=''checkout'',revision=revision+1','status=case when exists(select 1 from service_relay_offers where visit_id=p_visit and status=''working'') then ''in_service'' else ''checkout'' end,revision=revision+1');
 definition:=replace(definition,'update customer_visits set status=''checkout'' where id=p_visit;','update customer_visits set status=(select status from service_relay_tickets where visit_id=p_visit) where id=p_visit;');
 execute definition;
 definition:=pg_get_functiondef('public.service_relay_payload(uuid)'::regprocedure);
 definition:=replace(definition,'''draftTip'',t.draft_tip,','''draftNote'',t.draft_note,''draftTip'',t.draft_tip,');execute definition;
 definition:=pg_get_functiondef('public.service_relay_submit(uuid,uuid,integer,numeric,numeric,uuid,text)'::regprocedure);
 definition:=replace(definition,'''customerName'',c.name,''tipAmount''','''customerName'',c.name,''note'',t.draft_note,''tipAmount''');execute definition;
end $$;
-- Keep the existing signature for older clients. New clients explicitly pass a note.
create function public.phone_checkin_update_pos_ticket(p_salon uuid,p_visit uuid,p_expected integer,p_lines jsonb,p_tip numeric,p_discount numeric,p_finalize boolean,p_note text,p_key uuid default null,p_signature text default null) returns jsonb
language plpgsql security definer set search_path=public as $$
declare t service_relay_tickets; result jsonb;
begin
 if not coalesce(user_has_salon_permission(p_salon,array['tickets.manage']),false)
 and not coalesce(pos_portable_access_salon_id(p_key,p_signature)=p_salon and pos_portable_access_has_capability(p_key,p_signature,'portable.pos.use'),false) then raise exception 'Not authorized'; end if;
 perform staff_scan_reconcile(p_salon);
 select * into t from service_relay_tickets where salon_id=p_salon and visit_id=p_visit for update;
 if t.visit_id is null or t.status='cancelled' then raise exception 'This check-in is no longer available'; end if;
 if t.status='completed' then
  if p_finalize is true then return jsonb_build_object('ticketId',t.pos_ticket_id,'alreadyClosed',true); end if;
  raise exception 'This ticket is already closed.';
 end if;
 if p_note is null or length(p_note)>2000 then raise exception 'Note must be at most 2000 characters'; end if;
 update service_relay_tickets set draft_note=p_note where visit_id=p_visit;
 result:=phone_checkin_update_pos_ticket(p_salon,p_visit,p_expected,p_lines,p_tip,p_discount,p_finalize,p_key,p_signature);
 return result;
end $$;
revoke all on function public.phone_checkin_update_pos_ticket(uuid,uuid,integer,jsonb,numeric,numeric,boolean,text,uuid,text) from public,anon,authenticated;
grant execute on function public.phone_checkin_update_pos_ticket(uuid,uuid,integer,jsonb,numeric,numeric,boolean,text,uuid,text) to anon,authenticated;
-- Creation retains idempotent request fingerprints, including the note.
do $$declare definition text;begin
 definition:=pg_get_functiondef('public.phone_checkin_hold_pos_draft(uuid,uuid,uuid,jsonb,uuid,numeric,numeric,uuid,text)'::regprocedure);
 definition:=replace(definition,'p_signature text DEFAULT NULL::text)','p_signature text DEFAULT NULL::text, p_note text DEFAULT ''''::text)');
 definition:=replace(definition,'draft_payload:=','if p_note is null or length(p_note)>2000 then raise exception ''Note must be at most 2000 characters''; end if; draft_payload:=');
 definition:=replace(definition,'''lines'',p_lines','''note'',p_note,''lines'',p_lines');
 definition:=replace(definition,'set draft_tip=p_tip,draft_discount=p_discount','set draft_note=p_note,draft_tip=p_tip,draft_discount=p_discount');
 -- Creation uses a separate overload with all arguments required to avoid default ambiguity.
 definition:=replace(definition,' DEFAULT NULL::uuid','');definition:=replace(definition,' DEFAULT 0','');definition:=replace(definition,' DEFAULT NULL::text','');definition:=replace(definition,' DEFAULT ''''::text','');
 execute definition;
end $$;
revoke all on function public.phone_checkin_hold_pos_draft(uuid,uuid,uuid,jsonb,uuid,numeric,numeric,uuid,text,text) from public,anon,authenticated;
grant execute on function public.phone_checkin_hold_pos_draft(uuid,uuid,uuid,jsonb,uuid,numeric,numeric,uuid,text,text) to anon,authenticated;
notify pgrst,'reload schema';
commit;
