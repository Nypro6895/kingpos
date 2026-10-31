begin;

-- A signed Report terminal can explain only its salon's current closing inputs.
-- This read never exposes Staff projections, tickets, settings or nightly cases.
create function public.get_pos_portable_daily_input_history(p_key_id uuid,p_session_signature text,p_report_date date)
returns table(id uuid,salon_id uuid,business_date date,source_id uuid,before_values jsonb,after_values jsonb,note text,actor_name text,created_at timestamptz,event_action text,business_timezone text)
language plpgsql stable security definer set search_path=pg_catalog as $$
declare salon uuid;zone text;
begin
 salon:=public.pos_portable_access_salon_id(p_key_id,p_session_signature);
 if salon is null or not coalesce(public.pos_portable_access_has_capability(p_key_id,p_session_signature,'portable.report.view'),false) then
  raise exception 'Report access is unavailable' using errcode='42501';
 end if;
 zone:=public.get_salon_business_timezone(salon);
 if p_report_date is distinct from (now() at time zone zone)::date then
  raise exception 'Portable Report is available for today only' using errcode='42501';
 end if;
 return query select e.id,e.salon_id,e.business_date,e.source_id,
  (select coalesce(jsonb_object_agg(k,v),'{}'::jsonb) from jsonb_each(e.before_values) as facts(k,v) where k=any(array['cash_amount','credit_card_amount','other_amount','tip_input','entered','note'])),
  (select coalesce(jsonb_object_agg(k,v),'{}'::jsonb) from jsonb_each(e.after_values) as facts(k,v) where k=any(array['cash_amount','credit_card_amount','other_amount','tip_input','entered','note'])),
  e.note,e.actor_name,e.created_at,
  coalesce(e.event_action,public.classify_financial_input_event(e.salon_id,e.kind,e.source_id,e.before_values,e.after_values,e.created_at,e.id)),zone
 from public.financial_input_events e
 where e.salon_id=salon and e.kind='daily_report' and e.business_date=p_report_date
 order by e.created_at desc,e.id;
end;$$;
revoke all on function public.get_pos_portable_daily_input_history(uuid,text,date) from public,anon,authenticated;
grant execute on function public.get_pos_portable_daily_input_history(uuid,text,date) to anon,authenticated;
notify pgrst,'reload schema';
commit;
