begin;

-- Read/display contract only. Keep the current candidate pipeline, including
-- Gift/reward adjustments, event keys, closing fingerprints and Ignore state.
create or replace function public.owner_financial_attention(p_salon uuid,p_item text default null,p_page integer default 0)
returns jsonb language plpgsql stable security definer set search_path=pg_catalog,public as $$
declare result jsonb; uid uuid:=public.current_public_user_id();
begin
 if not coalesce(public.lifecycle_user_is_salon_owner(p_salon,uid,false),false) then raise exception 'Owner access required' using errcode='42501';end if;
 if p_page<0 or p_page>100000 then raise exception 'Invalid page';end if;
 with visible as (
  select a.*,exists(select 1 from public.owner_attention_ignored i where i.salon_id=p_salon and i.user_id=uid and i.item_key=a.item_key) as ignored
  from public.owner_attention_candidates(p_salon) a
 ), selected as materialized (
  select * from visible where (p_item is null and not ignored) or item_key=p_item
  order by case kind when 'closing' then 0 when 'checkin' then 1 else 2 end,occurred_at desc,item_key
  limit 50 offset case when p_item is null then p_page*50 else 0 end
 ), presented as (
  select s.kind,s.occurred_at,s.item_key,
   case when p_item is null and s.kind not in ('ticket_change','discount') then
    (to_jsonb(s)-'facts') || case when s.kind='closing' then jsonb_build_object(
      'difference',s.facts->'serviceDifference','collected',s.facts->'actualService','expected',s.facts->'expectedService'
    ) else '{}'::jsonb end
   else to_jsonb(s) || jsonb_build_object('facts',
    case when e.id is null then s.facts else
     -- Use only this exact captured event's context/action. Do not replace the
     -- before/after values already adjusted by the Gift/reward candidate wrapper.
     s.facts || public.owner_attention_event_context(e.id) || jsonb_build_object(
      'eventAction',coalesce(e.event_action,public.classify_financial_input_event(
        e.salon_id,e.kind,e.source_id,e.before_values,e.after_values,e.created_at,e.id))
     )
    end
   ) end as item
  from selected s
  left join public.financial_input_events e on e.id=case
   when s.kind in ('ticket_change','discount') and
    s.facts->>'eventId' ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
   then (s.facts->>'eventId')::uuid end
   and e.salon_id=p_salon and e.kind='ticket' and e.source_id::text=s.facts->>'ticketId'
 ) select jsonb_build_object(
  'salonId',p_salon,'today',public.get_salon_business_date(p_salon),'timezone',public.get_salon_business_timezone(p_salon),
  'total',(select count(*) from visible where not ignored),
  'items',coalesce((select jsonb_agg(item order by case kind when 'closing' then 0 when 'checkin' then 1 else 2 end,occurred_at desc,item_key) from presented),'[]'::jsonb)
 ) into result;
 return result;
end;$$;
revoke all on function public.owner_financial_attention(uuid,text,integer) from public,anon;
grant execute on function public.owner_financial_attention(uuid,text,integer) to authenticated;

notify pgrst,'reload schema';
commit;
