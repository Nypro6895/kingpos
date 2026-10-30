begin;
-- A source projection, not another revenue/discount journal. Canonical ticket,
-- staff earnings, service/tip/payment rows and business dates are untouched.
create function public.reward_owner_report(p_salon uuid,p_day date default null) returns jsonb
language plpgsql stable security definer set search_path=public as $$
declare result jsonb; zone text; day date; begin
 if not coalesce(lifecycle_user_is_salon_owner(p_salon,current_public_user_id(),false),false) then raise exception 'Owner access required'; end if;
 zone:=get_salon_business_timezone(p_salon);day:=coalesce(p_day,get_salon_business_date(p_salon));
 with usage as (
  select r.id,t.id as ticket_id,t.ticket_number,t.opened_at,t.status,r.offer,
   greatest(0,-coalesce(sum(l.delta),0))::integer as net_points
  from reward_requests r join pos_tickets t on t.id=r.ticket_id and t.salon_id=r.salon_id
  left join reward_ledger l on l.ticket_id=t.id and l.user_id=r.user_id and l.salon_id=r.salon_id
   and (l.event_key='redeem:'||r.id::text or l.event_key like 'redeem-adjust:'||r.id::text||':%')
  where r.salon_id=p_salon and t.opened_at>=timezone(zone,day::timestamp) and t.opened_at<timezone(zone,(day+1)::timestamp)
  group by r.id,t.id
 ), facts as (
  select *, (offer->>'points')::integer as gross_points,(offer->>'valueCents')::integer as gross_cents,
   case when net_points>0 then (offer->>'valueCents')::integer else 0 end as net_cents from usage
 ) select jsonb_build_object('day',day,'timezone',zone,'source','reward','includedInTicketDiscount',true,
  'summary',jsonb_build_object('grossUses',count(*),'activeUses',count(*) filter(where net_points>0),'reversedUses',count(*) filter(where net_points=0),
   'grossValueCents',coalesce(sum(gross_cents),0),'netValueCents',coalesce(sum(net_cents),0),'reversedValueCents',coalesce(sum(gross_cents-net_cents),0),
   'pointsSpent',coalesce(sum(net_points),0),'pointsReturned',coalesce(sum(gross_points-net_points),0)),
  'entries',coalesce((select jsonb_agg(x order by x."openedAt" desc,x."requestId") from (
   select id as "requestId",ticket_id as "ticketId",ticket_number as "ticketNumber",opened_at as "openedAt",status as "ticketStatus",offer->>'title' as title,
    gross_points as "grossPoints",net_points as "netPoints",gross_cents as "grossValueCents",net_cents as "netValueCents",'reward' as source
   from facts order by opened_at desc,id limit 100)x),'[]'),
  'hasMore',count(*)>100) into result from facts;
 return result;
end $$;
revoke all on function public.reward_owner_report(uuid,date) from public,anon;
grant execute on function public.reward_owner_report(uuid,date) to authenticated;
commit;
