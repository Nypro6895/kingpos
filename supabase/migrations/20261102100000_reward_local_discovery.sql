begin;
-- Additive read model only. Earning, quotes, consent, settlement and reversals
-- remain owned by Rewardlumi's existing authority functions.
create index if not exists reward_programs_discovery_active
 on public.reward_programs(salon_id) where enabled and nearby;

-- Same usable catalog predicate for customer discovery and owner guidance.
create function public.reward_discovery_offers(p_salon uuid,p_offers jsonb) returns jsonb
language sql stable set search_path=public as $$
 select jsonb_agg(jsonb_build_object('id',o->>'id','title',o->>'title','points',(o->>'points')::integer,
  'valueCents',(o->>'valueCents')::integer,'minimumCents',(o->>'minimumCents')::integer,'serviceName',s.name) order by ordinal)
 from jsonb_array_elements(case when jsonb_typeof(p_offers)='array' then p_offers else '[]'::jsonb end) with ordinality as a(o,ordinal)
 left join services s on s.id::text=o->>'serviceId' and s.salon_id=p_salon and s.is_active
 where coalesce(o->>'points','')~'^[1-9][0-9]{0,5}$' and coalesce(o->>'valueCents','')~'^[1-9][0-9]{0,5}$'
  and coalesce(o->>'minimumCents','')~'^[0-9]{1,8}$' and nullif(trim(o->>'title'),'') is not null
  and (nullif(o->>'serviceId','') is null or s.id is not null)
$$;
revoke all on function public.reward_discovery_offers(uuid,jsonb) from public,anon,authenticated;

create function public.reward_discover(
 p_lat double precision default null, p_lon double precision default null,
 p_city text default null, p_state text default null, p_postal text default null,
 p_country text default 'US', p_category text default null,
 p_kind text default 'all', p_radius_miles integer default 15
) returns jsonb language plpgsql stable security definer set search_path=public as $$
declare gps boolean := p_lat is not null or p_lon is not null; result jsonb;
begin
 if p_kind not in ('all','spend','welcome','before_after') or p_kind is null
   or p_radius_miles is null or p_radius_miles not in (5,10,15) then raise exception 'Invalid reward filter'; end if;
 if gps then
  if p_lat is null or p_lon is null or not(p_lat between -90 and 90) or not(p_lon between -180 and 180) then raise exception 'Invalid reward coordinates'; end if;
 elsif nullif(trim(p_state),'') is null or (nullif(trim(p_city),'') is null and nullif(trim(p_postal),'') is null)
   or nullif(trim(p_country),'') is null then
  return jsonb_build_object('salons','[]'::jsonb,'hasMore',false,'needsArea',true);
 end if;
 with eligible as (
  select l.id,l.name,l.city,l.state,p.rules,p.version,offers.items,
   case when gps then 3958.7613*2*asin(least(1,sqrt(
    power(sin(radians(l.latitude-p_lat)/2),2)+cos(radians(p_lat))*cos(radians(l.latitude))*power(sin(radians(l.longitude-p_lon)/2),2)
   ))) end as miles
  from reward_programs p join locations l on l.id=p.salon_id
  cross join lateral (select reward_discovery_offers(l.id,p.offers) as items) offers
  where p.enabled and p.nearby and offers.items is not null and l.status='active'
   and (coalesce((p.rules->>'spendPoints')::integer,0)>0 or coalesce((p.rules->>'welcomePoints')::integer,0)>0
    or coalesce((p.rules->>'firstBookingPoints')::integer,0)>0 or coalesce((p.rules->>'visitPoints')::integer,0)>0 or coalesce((p.rules->>'conversionPoints')::integer,0)>0)
   and (p_kind='all' or (p_kind='spend' and (p.rules->>'spendPoints')::integer>0)
    or (p_kind='welcome' and (p.rules->>'welcomePoints')::integer>0) or (p_kind='before_after' and (p.rules->>'conversionPoints')::integer>0))
   and (nullif(trim(p_category),'') is null or lower(trim(p_category))='all' or exists(
    select 1 from services c where c.salon_id=l.id and c.is_active and lower(trim(c.category))=lower(trim(p_category))))
   and case when gps then l.latitude between -90 and 90 and l.longitude between -180 and 180
      and abs(l.latitude-p_lat)<=p_radius_miles/69.0+0.01
    else lower(trim(l.state))=lower(trim(p_state))
     and (lower(trim(l.country))=lower(trim(p_country)) or (upper(trim(p_country))='US' and lower(trim(l.country)) in ('usa','united states','united states of america')))
     and (nullif(trim(p_postal),'') is null or lower(trim(l.postal_code))=lower(trim(p_postal)))
     and (nullif(trim(p_city),'') is null or lower(trim(l.city))=lower(trim(p_city))) end
 ), bounded as (
  select * from eligible where not gps or miles<=p_radius_miles order by miles nulls last,lower(name),id limit 25
 ), page as (
  select * from bounded order by miles nulls last,lower(name),id limit 24
 )
 select jsonb_build_object('salons',coalesce((select jsonb_agg(jsonb_build_object(
   'id',id,'name',name,'city',city,'state',state,'distanceMiles',case when gps then round(miles::numeric,1) else null end,
   'spendCents',coalesce((rules->>'spendCents')::integer,0),'spendPoints',coalesce((rules->>'spendPoints')::integer,0),
   'welcomePoints',coalesce((rules->>'welcomePoints')::integer,0),'firstBookingPoints',coalesce((rules->>'firstBookingPoints')::integer,0),
   'visitPoints',coalesce((rules->>'visitPoints')::integer,0),'conversionPoints',coalesce((rules->>'conversionPoints')::integer,0),
   'version',version,'offers',items) order by miles nulls last,lower(name),id) from page),'[]'::jsonb),
   'hasMore',(select count(*)>24 from bounded)) into result;
 return result;
end $$;
revoke all on function public.reward_discover(double precision,double precision,text,text,text,text,text,text,integer) from public;
grant execute on function public.reward_discover(double precision,double precision,text,text,text,text,text,text,integer) to anon,authenticated;

create function public.reward_owner_discovery(p_salon uuid) returns jsonb
language plpgsql stable security definer set search_path=public as $$
declare p reward_programs; l locations;
begin
 if not coalesce(lifecycle_user_is_salon_owner(p_salon,current_public_user_id(),false),false) then raise exception 'Owner access required'; end if;
 select * into p from reward_programs where salon_id=p_salon;
 select * into l from locations where id=p_salon;
 return jsonb_build_object('salonId',p_salon,'enabled',coalesce(p.enabled,false),'nearby',coalesce(p.nearby,false),
  'usableOffers',coalesce(jsonb_array_length(reward_discovery_offers(p_salon,p.offers)),0),
  'earning',coalesce((p.rules->>'spendPoints')::integer,0)>0 or coalesce((p.rules->>'welcomePoints')::integer,0)>0
    or coalesce((p.rules->>'firstBookingPoints')::integer,0)>0 or coalesce((p.rules->>'visitPoints')::integer,0)>0 or coalesce((p.rules->>'conversionPoints')::integer,0)>0,
  'located',l.latitude between -90 and 90 and l.longitude between -180 and 180,
  'members',(select count(*) from reward_members where salon_id=p_salon),
  'paidConversions',(select count(*) from reward_conversions where salon_id=p_salon and status='earned'),
  'rewardUses',(select count(*) from reward_requests r join pos_tickets t on t.id=r.ticket_id where r.salon_id=p_salon and r.status='redeemed' and t.status='closed'));
end $$;
revoke all on function public.reward_owner_discovery(uuid) from public,anon;
grant execute on function public.reward_owner_discovery(uuid) to authenticated;
commit;
