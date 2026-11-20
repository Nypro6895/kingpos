begin;
-- Attention metadata only. Canonical reconciliation and all financial writes stay unchanged.
create or replace function public.owner_attention_candidates(p_salon uuid)
returns table(item_key text,kind text,business_date date,occurred_at timestamptz,label text,detail text,target_href text,facts jsonb)
language sql stable security definer set search_path=pg_catalog,public as $$
 with clock as (select public.get_salon_business_date(p_salon) as today,public.get_salon_business_timezone(p_salon) as zone),
 days as (
  -- Only entered, completed business days can have a Short/Over comparison.
  select r.report_date as d from public.pos_daily_closings r cross join clock c
  where r.salon_id=p_salon and r.report_date<c.today and r.live_report_entered_at is not null
 ), reconciliation as (
  select d,public.daily_input_reconciliation_values(p_salon,d) as result from days
 ), day_facts as (
  -- Reuse Reports' authority, including its discounts/reward/gift adjustments.
  -- Do not derive earnings from receipt payments or Shop Money.
  select d,jsonb_build_object('expectedService',result->'expectedService',
   'actualService',result->'actualService','serviceDifference',result->'serviceDifference') as f
  from reconciliation where (result->>'serviceDifference')::numeric<>0
 ), events as (
  select e.*,coalesce(e.event_action,public.classify_financial_input_event(e.salon_id,e.kind,e.source_id,e.before_values,e.after_values,e.created_at,e.id)) as action
  from public.financial_input_events e where e.salon_id=p_salon and e.kind='ticket'
 ), edits as (
  select 'event:'||e.id::text as k,'ticket_change'::text as category,e.business_date as d,e.created_at as at,
   'Ticket '||coalesce(nullif(e.after_values->>'ticket_number',''),nullif(e.before_values->>'ticket_number',''),'updated')||' changed' as title,
   'Recorded by '||coalesce(nullif(e.actor_name,''),'Unknown operator')||'. Review the saved before and after values.' as description,
   '/pos-tickets/'||e.source_id::text as href,
   jsonb_build_object('eventId',e.id,'ticketId',e.source_id,'before',e.before_values,'after',e.after_values,'actor',e.actor_name,'note',e.note) as f
  from events e where e.action='updated' and e.before_values is distinct from e.after_values
 ), discounts(k,category,d,at,title,description,href,f) as (
  -- Event identity preserves a discount even if it is subsequently removed.
  select 'discount:'||e.id::text,'discount'::text,e.business_date,e.created_at,
   'Ticket '||coalesce(e.after_values->>'ticket_number',e.before_values->>'ticket_number','')||' discount',
   'Customer discount: '||public.financial_notice_money(e.before_values->'discount_amount')||' → '||public.financial_notice_money(e.after_values->'discount_amount'),
   '/pos-tickets/'||e.source_id::text,
   jsonb_build_object('eventId',e.id,'ticketId',e.source_id,'before',e.before_values,'after',e.after_values,'actor',e.actor_name,'note',e.note)
  from events e where e.action<>'draft' and (
    (e.action='created' and coalesce((e.after_values->>'discount_amount')::numeric,0)>0)
    or (e.action='updated' and (e.before_values->'discount_amount' is distinct from e.after_values->'discount_amount'
      or e.before_values->'discount_type' is distinct from e.after_values->'discount_type'
      or e.before_values->'discount_value' is distinct from e.after_values->'discount_value')
      and greatest(coalesce((e.before_values->>'discount_amount')::numeric,0),coalesce((e.after_values->>'discount_amount')::numeric,0))>0)
  )
  union all
  -- Existing receipts without a captured creation still get a current-state check.
  select 'discount-current:'||t.id||':'||md5(jsonb_build_array(s.f->'discount_type',s.f->'discount_value',s.f->'discount_amount')::text),'discount',(t.opened_at at time zone c.zone)::date,t.updated_at,
   'Ticket '||t.ticket_number||' discount','Customer discount: '||public.financial_notice_money(s.f->'discount_amount'),'/pos-tickets/'||t.id,
   jsonb_build_object('ticketId',t.id,'before','{}'::jsonb,'after',s.f,'actor','Earlier operator not recorded','note','Current receipt; earlier discount history is unavailable.')
  from public.pos_tickets t cross join clock c cross join lateral(select public.pos_ticket_input_snapshot(p_salon,t.id) f) s
  where t.salon_id=p_salon and t.status='closed' and coalesce((s.f->>'discount_amount')::numeric,0)>0
   and not exists(select 1 from events e where e.source_id=t.id and e.action<>'draft' and coalesce((e.after_values->>'discount_amount')::numeric,0)>0)
 ), closing(k,category,d,at,title,description,href,f) as (
  select 'closing:'||d||':'||md5(f::text),'closing'::text,d,(d::timestamp at time zone c.zone),
   'Daily Report '||d||case when (f->>'serviceDifference')::numeric<0 then ' · Short ' else ' · Over ' end||
    public.financial_notice_money(to_jsonb(abs((f->>'serviceDifference')::numeric))),
   'Compare the service total with the Daily Report.',
   '/reports?date='||d||'#daily-closing',f||jsonb_build_object('fingerprint',md5(f::text))
  from day_facts cross join clock c
 ), visits as (
  select v.*,c.zone,c.today,t.status as ticket_status,t.ticket_number,t.id as linked_id,
   case when t.id is not null then public.pos_ticket_input_snapshot(p_salon,t.id) end as ticket_facts,
   coalesce(cu.name,'Customer') as customer_name
  from public.customer_visits v cross join clock c
  left join public.pos_tickets t on t.id=v.ticket_id and t.salon_id=v.salon_id
  left join public.customers cu on cu.id=v.customer_id and cu.location_id=v.salon_id
  where v.salon_id=p_salon and v.status<>'cancelled'
 ), unmatched(k,category,d,at,title,description,href,f) as (
  select 'visit:'||v.id||':'||md5(jsonb_build_object('ticket',v.linked_id,'facts',v.ticket_facts)::text),'checkin'::text,
   (v.checked_in_at at time zone v.zone)::date,v.checked_in_at,
   v.customer_name||' · check-in/payment needs matching',
   case when v.linked_id is null then 'No ticket is linked to this visit. Check receipts before concluding payment is missing.'
    when v.ticket_status in ('voided','cancelled') then 'The linked ticket was voided or cancelled. Verify the visit outcome.'
    else 'The linked ticket is not settled and closed. Review the recorded payments and remaining amount.' end,
   case when v.linked_id is not null then '/pos-tickets/'||v.linked_id else '/pos-tickets?date='||(v.checked_in_at at time zone v.zone)::date end,
   jsonb_build_object('visitId',v.id,'customerId',v.customer_id,'customerName',v.customer_name,'checkedInAt',v.checked_in_at,'visitStatus',v.status,'ticketId',v.linked_id,'ticketNumber',v.ticket_number,'ticket',v.ticket_facts,
    'possibleTickets',coalesce((select jsonb_agg(jsonb_build_object('id',t.id,'number',t.ticket_number,'status',t.status,'facts',public.pos_ticket_input_snapshot(p_salon,t.id)) order by t.opened_at) from public.pos_tickets t where t.salon_id=p_salon and t.customer_id=v.customer_id and (t.opened_at at time zone v.zone)::date=(v.checked_in_at at time zone v.zone)::date),'[]'::jsonb))
  from visits v where ((v.checked_in_at at time zone v.zone)::date<v.today or v.status='completed' or (v.status='checkout' and v.checkout_started_at<now()-interval '15 minutes'))
   and (v.linked_id is null or v.ticket_status<>'closed' or coalesce((v.ticket_facts->>'recorded_payment_total')::numeric,0)<
      round((coalesce((v.ticket_facts->>'service_total')::numeric,0)-coalesce((v.ticket_facts->>'discount_amount')::numeric,0))*(1+coalesce((v.ticket_facts->>'tax_rate')::numeric,0)/100)+coalesce((v.ticket_facts->>'tip_amount')::numeric,0),2))
 )
 select * from closing union all select * from edits where not exists(select 1 from discounts d where d.k=replace(edits.k,'event:','discount:'))
 union all select * from discounts union all select * from unmatched;
$$;
revoke all on function public.owner_attention_candidates(uuid) from public,anon,authenticated;


create or replace function public.owner_financial_attention(p_salon uuid,p_item text default null,p_page integer default 0)
returns jsonb language plpgsql stable security definer set search_path=pg_catalog,public as $$
declare result jsonb; uid uuid:=public.current_public_user_id();
begin
 if not coalesce(public.lifecycle_user_is_salon_owner(p_salon,uid,false),false) then raise exception 'Owner access required' using errcode='42501';end if;
 if p_page<0 or p_page>100000 then raise exception 'Invalid page';end if;
 with visible as (
  select a.*,exists(select 1 from public.owner_attention_ignored i where i.salon_id=p_salon and i.user_id=uid and i.item_key=a.item_key) as ignored
  from public.owner_attention_candidates(p_salon) a
 ), selected as (
  select * from visible where (p_item is null and not ignored) or item_key=p_item
  order by case kind when 'closing' then 0 when 'checkin' then 1 else 2 end,occurred_at desc,item_key
  limit 50 offset case when p_item is null then p_page*50 else 0 end
 ) select jsonb_build_object('salonId',p_salon,'today',public.get_salon_business_date(p_salon),'timezone',public.get_salon_business_timezone(p_salon),
  'total',(select count(*) from visible where not ignored),'items',coalesce((select jsonb_agg(case when p_item is null then (to_jsonb(s)-'facts') || case when s.kind='closing' then jsonb_build_object('difference',s.facts->'serviceDifference','collected',s.facts->'actualService','expected',s.facts->'expectedService') else '{}'::jsonb end else to_jsonb(s) end) from selected s),'[]'::jsonb)) into result;
 return result;
end;$$;
revoke all on function public.owner_financial_attention(uuid,text,integer) from public,anon;
grant execute on function public.owner_financial_attention(uuid,text,integer) to authenticated;


-- Ignore is the only closing dismissal. Old clients must not mark an imbalance resolved.
create or replace function public.owner_financial_attention_action(p_salon uuid,p_item text,p_action text) returns void
language plpgsql security definer set search_path=pg_catalog,public as $$
declare uid uuid:=public.current_public_user_id(); row record;
begin
 if not coalesce(public.lifecycle_user_is_salon_owner(p_salon,uid,false),false) then raise exception 'Owner access required' using errcode='42501';end if;
 select * into row from public.owner_attention_candidates(p_salon) where item_key=p_item;
 if not found then raise exception 'This item changed or was resolved. Refresh before continuing.' using errcode='40001';end if;
 if p_action='ignore' then
  insert into public.owner_attention_ignored(salon_id,user_id,item_key) values(p_salon,uid,p_item) on conflict do nothing;
 else raise exception 'Invalid attention action' using errcode='22023';end if;
end;$$;
revoke all on function public.owner_financial_attention_action(uuid,text,text) from public,anon;
grant execute on function public.owner_financial_attention_action(uuid,text,text) to authenticated;
notify pgrst,'reload schema';
commit;
