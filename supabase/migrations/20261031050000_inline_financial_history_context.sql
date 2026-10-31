begin;

-- Preserve the existing recipient boundary. The stable ticket key lets a Staff
-- projection attach to its original receipt without matching a name or time.
drop function public.get_financial_input_event_metadata(uuid[]);
create function public.get_financial_input_event_metadata(p_event_ids uuid[])
returns table(event_id uuid,event_action text,ticket_number text,before_context jsonb,after_context jsonb,ticket_id uuid)
language plpgsql stable security definer set search_path=pg_catalog,public as $$
begin
 if public.current_public_user_id() is null then raise exception 'Sign in required' using errcode='42501';end if;
 if coalesce(cardinality(p_event_ids),0)>500 then raise exception 'Choose up to 500 events' using errcode='22023';end if;
 return query select e.id,coalesce(e.event_action,public.classify_financial_input_event(e.salon_id,e.kind,e.source_id,e.before_values,e.after_values,e.created_at,e.id)),
  public.financial_notice_text(coalesce(e.after_values->>'ticket_number',e.before_values->>'ticket_number'),''),
  case when e.kind='ticket' and own.staff_id is not null then context.values->'before_values' end,
  case when e.kind='ticket' and own.staff_id is not null then context.values->'after_values' end,
  case when e.kind='ticket' then e.source_id end
 from public.financial_input_events e
 cross join lateral (select public.payroll_live_is_owner(e.salon_id) or public.financial_input_manager_can_read(e.salon_id,e.kind) as all_rows) access
 left join public.financial_input_event_staff own on own.event_id=e.id and own.staff_id=public.current_user_staff_id_for_salon(e.salon_id)
 cross join lateral (select case when own.staff_id is not null then public.financial_ticket_staff_context(e.before_values,e.after_values,own.staff_id) end as values) context
 where e.id=any(coalesce(p_event_ids,array[]::uuid[])) and (access.all_rows or own.staff_id is not null);
end;$$;
revoke all on function public.get_financial_input_event_metadata(uuid[]) from public,anon;
grant execute on function public.get_financial_input_event_metadata(uuid[]) to authenticated;

-- Signed Portable already authorizes this whole ticket. Return the exact linked
-- saved facts so collection edits can be explained even when the old raw ticket
-- correction snapshot did not capture payments. Unlinked legacy data stays null.
do $patch$
declare definition text; boundary text;
begin
 definition:=pg_get_functiondef('public.get_pos_portable_ticket_data(uuid,text,date)'::regprocedure);
 boundary:='''eventAction'', public.classify_pos_ticket_adjustment(pos_ticket_adjustments),';
 if position(boundary in definition)=0 then raise exception 'Review signed Portable inline audit boundary';end if;
 if position('''financialInputEventId''' in definition)>0 then raise exception 'Portable inline audit context already present';end if;
 definition:=replace(definition,boundary,boundary||E'\n'
  ||'''financialInputEventId'', pos_ticket_adjustments.financial_input_event_id,'||E'\n'
  ||'''financialInputBeforeValues'', (select event.before_values from public.financial_input_events event where event.id=pos_ticket_adjustments.financial_input_event_id and event.salon_id=pos_ticket_adjustments.salon_id and event.kind=''ticket'' and event.source_id=pos_ticket_adjustments.ticket_id),'||E'\n'
  ||'''financialInputAfterValues'', (select event.after_values from public.financial_input_events event where event.id=pos_ticket_adjustments.financial_input_event_id and event.salon_id=pos_ticket_adjustments.salon_id and event.kind=''ticket'' and event.source_id=pos_ticket_adjustments.ticket_id),');
 execute definition;
end;$patch$;

notify pgrst,'reload schema';
commit;
