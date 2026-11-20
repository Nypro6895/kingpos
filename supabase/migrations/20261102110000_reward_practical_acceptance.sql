begin;
-- Forward migration. Financial earning/settlement and existing redemption rights
-- are unchanged; discovery only offers attainable paths to new customers.
create function public.reward_public_offers(p_salon uuid,p_rules jsonb,p_offers jsonb) returns jsonb
language sql stable set search_path=public as $$
 select jsonb_agg(o order by ordinal)
 from jsonb_array_elements(coalesce(reward_discovery_offers(p_salon,p_offers),'[]'::jsonb)) with ordinality as a(o,ordinal)
 where coalesce((p_rules->>'spendPoints')::integer,0)>0 or coalesce((p_rules->>'visitPoints')::integer,0)>0
  or coalesce((p_rules->>'conversionPoints')::integer,0)>0
  or (o->>'points')::integer <= coalesce((p_rules->>'welcomePoints')::integer,0)+coalesce((p_rules->>'firstBookingPoints')::integer,0)
$$;
revoke all on function public.reward_public_offers(uuid,jsonb,jsonb) from public,anon,authenticated;

create function public.reward_program_readiness(p_salon uuid,p_program jsonb) returns jsonb
language plpgsql stable set search_path=public as $$
declare l locations; offers jsonb; catalog jsonb; reasons jsonb:='[]'; earning boolean;
begin
 select * into l from locations where id=p_salon;
 offers:=reward_discovery_offers(p_salon,p_program->'offers');
 catalog:=reward_public_offers(p_salon,p_program,p_program->'offers');
 earning:=coalesce((p_program->>'spendPoints')::integer,0)>0 or coalesce((p_program->>'welcomePoints')::integer,0)>0
  or coalesce((p_program->>'firstBookingPoints')::integer,0)>0 or coalesce((p_program->>'visitPoints')::integer,0)>0 or coalesce((p_program->>'conversionPoints')::integer,0)>0;
 if l.status is distinct from 'active' then reasons:=reasons||jsonb_build_array('The salon must be active.'); end if;
 if not coalesce(salon_profile_public_salon_exists(p_salon),false) then reasons:=reasons||jsonb_build_array('Publish your salon profile before advertising public rewards.'); end if;
 if not coalesce((p_program->>'enabled')::boolean,false) then reasons:=reasons||jsonb_build_array('New earning is paused.'); end if;
 if not coalesce((p_program->>'nearby')::boolean,false) then reasons:=reasons||jsonb_build_array('Local discovery is hidden.'); end if;
 if offers is null then reasons:=reasons||jsonb_build_array('Add a reward with an active eligible service.');
 elsif catalog is null then reasons:=reasons||jsonb_build_array('New customers cannot earn enough points for any reward. Existing members keep their points and redemption rights.'); end if;
 if not earning then reasons:=reasons||jsonb_build_array('Add at least one earning rule.'); end if;
 if not(coalesce(l.latitude between -90 and 90 and l.longitude between -180 and 180,false)
  or (nullif(trim(l.city),'') is not null and nullif(trim(l.state),'') is not null and nullif(trim(l.country),'') is not null)) then
  reasons:=reasons||jsonb_build_array('Add an accurate salon city/state or map location.'); end if;
 return jsonb_build_object('discoverable',jsonb_array_length(reasons)=0,'reasons',reasons,'earning',earning,
  'usableOffers',coalesce(jsonb_array_length(offers),0),'newCustomerOffers',coalesce(jsonb_array_length(catalog),0),
  'located',coalesce(l.latitude between -90 and 90 and l.longitude between -180 and 180,false),'offers',coalesce(catalog,'[]'::jsonb));
end $$;
revoke all on function public.reward_program_readiness(uuid,jsonb) from public,anon,authenticated;

create or replace function public.reward_owner(p_salon uuid,p_op text,p_args jsonb default '{}') returns jsonb
language plpgsql security definer set search_path=public as $$
declare v jsonb; r jsonb; owner_offers jsonb; k text; n integer; p reward_programs; readiness jsonb;
begin
 if not coalesce(lifecycle_user_is_salon_owner(p_salon,current_public_user_id(),false),false) then raise exception 'Owner access required'; end if;
 if p_op not in ('load','preview','save') or p_op is null then raise exception 'Unknown reward action'; end if;
 -- Serializes saves for existing and new programs; stale clients must reload.
 if p_op='save' then perform pg_advisory_xact_lock(hashtextextended('reward-program:'||p_salon::text,0)); end if;
 select * into p from reward_programs where salon_id=p_salon;
 if p_op in ('save','preview') then
  v:=p_args->'program';r:=v-array['enabled','nearby','offers','version'];owner_offers:=v->'offers';
  if jsonb_typeof(v->'enabled') is distinct from 'boolean' or jsonb_typeof(v->'nearby') is distinct from 'boolean' then raise exception 'Choose an explicit activation status.'; end if;
  foreach k in array array['spendCents','spendPoints','welcomePoints','firstBookingPoints','visitPoints','conversionPoints'] loop
   if jsonb_typeof(r->k) is distinct from 'number' or not coalesce((r->>k)~'^\d+$',false) then raise exception 'Use whole nonnegative points and a valid spend threshold.'; end if;
   n:=(r->>k)::integer;if n<0 or n>100000 or (k='spendCents' and n<1) then raise exception 'Earning rule outside limits'; end if;
  end loop;
  if jsonb_typeof(owner_offers) is distinct from 'array' or jsonb_array_length(owner_offers)>20 then raise exception 'Invalid rewards'; end if;
  for v in select value from jsonb_array_elements(owner_offers) loop
   if coalesce(length(v->>'id'),0) not between 1 and 80 or coalesce(length(trim(v->>'title')),0) not between 1 and 100
    or not coalesce((v->>'points')~'^[1-9]\d*$',false) or not coalesce((v->>'valueCents')~'^[1-9]\d*$',false) or not coalesce((v->>'minimumCents')~'^\d+$',false)
    or (v->>'points')::integer>100000 or (v->>'valueCents')::integer>100000 or (v->>'minimumCents')::integer>10000000 then raise exception 'Invalid reward offer'; end if;
   if nullif(v->>'serviceId','') is not null and not exists(select 1 from services where id::text=v->>'serviceId' and salon_id=p_salon) then raise exception 'Service belongs to another salon'; end if;
  end loop;
  if (select count(*)<>count(distinct value->>'id') from jsonb_array_elements(owner_offers)) then raise exception 'Duplicate reward'; end if;
  v:=r||jsonb_build_object('enabled',(p_args->'program'->>'enabled')::boolean,'nearby',(p_args->'program'->>'nearby')::boolean,'offers',owner_offers);
  readiness:=reward_program_readiness(p_salon,v);
  if p_op='save' then
   if jsonb_typeof(p_args->'expectedVersion') is distinct from 'number' or not coalesce((p_args->>'expectedVersion')~'^\d+$',false)
    or (p_args->>'expectedVersion')::bigint<>coalesce(p.version,0) then raise exception 'Reward settings changed in another session. Reload the latest settings before saving.' using errcode='40001'; end if;
   -- Drafts/pauses remain saveable; public activation requires a real usable path.
   if (v->>'enabled')::boolean and (v->>'nearby')::boolean and not(readiness->>'discoverable')::boolean then
    raise exception '%',readiness->'reasons'->>0; end if;
   insert into reward_programs(salon_id,rules,offers,enabled,nearby,version)
    values(p_salon,r,owner_offers,(v->>'enabled')::boolean,(v->>'nearby')::boolean,1)
   on conflict(salon_id) do update set rules=excluded.rules,offers=excluded.offers,enabled=excluded.enabled,nearby=excluded.nearby,version=reward_programs.version+1,updated_at=now()
   returning * into p;
  else return jsonb_build_object('readiness',readiness); end if;
 end if;
 if p.salon_id is null then
  v:=jsonb_build_object('enabled',false,'nearby',false,'spendCents',2000,'spendPoints',20,'welcomePoints',10,'firstBookingPoints',20,'visitPoints',0,'conversionPoints',30,
   'offers',jsonb_build_array(jsonb_build_object('id','five-off','title','$5 off','points',100,'valueCents',500,'minimumCents',4000)));
 else v:=p.rules||jsonb_build_object('enabled',p.enabled,'nearby',p.nearby,'offers',p.offers); end if;
 return jsonb_build_object('program',v,'version',coalesce(p.version,0),'readiness',reward_program_readiness(p_salon,v),
  'members',(select count(*) from reward_members where salon_id=p_salon),
  'pendingConversions',(select count(*) from reward_conversions where salon_id=p_salon and status='pending'),
  'earnedConversions',(select count(*) from reward_conversions where salon_id=p_salon and status='earned'),
  'services',coalesce((select jsonb_agg(jsonb_build_object('id',id,'name',name,'price',base_price,'active',is_active)) from services where salon_id=p_salon),'[]'));
end $$;

create function public.reward_public_program(p_salon uuid) returns jsonb language plpgsql stable security definer set search_path=public as $$
declare p reward_programs; l locations; ready jsonb; u uuid; member boolean;
begin
 select * into p from reward_programs where salon_id=p_salon;
 if not found then return jsonb_build_object('salon',null); end if;
 ready:=reward_program_readiness(p_salon,p.rules||jsonb_build_object('enabled',p.enabled,'nearby',p.nearby,'offers',p.offers));
 if not(ready->>'discoverable')::boolean then return jsonb_build_object('salon',null); end if;
 select * into l from locations where id=p_salon;
 u:=current_public_user_id(); member:=u is not null and exists(select 1 from reward_members where salon_id=p_salon and user_id=u);
 return jsonb_build_object('salon',p.rules||jsonb_build_object('id',l.id,'name',l.name,'city',l.city,'state',l.state,'distanceMiles',null,'version',p.version,'offers',ready->'offers'),
  'joined',member,'available',case when member then greatest(0,reward_available(p_salon,u)) else null end);
end $$;
revoke all on function public.reward_public_program(uuid) from public;
grant execute on function public.reward_public_program(uuid) to anon,authenticated;

create or replace function public.reward_owner_discovery(p_salon uuid) returns jsonb language plpgsql stable security definer set search_path=public as $$
declare p reward_programs; ready jsonb; day date; since_at timestamptz; until_at timestamptz; zone text; cost bigint; uses bigint;
begin
 if not coalesce(lifecycle_user_is_salon_owner(p_salon,current_public_user_id(),false),false) then raise exception 'Owner access required'; end if;
 select * into p from reward_programs where salon_id=p_salon;
 ready:=reward_program_readiness(p_salon,coalesce(p.rules,'{}')||jsonb_build_object('enabled',coalesce(p.enabled,false),'nearby',coalesce(p.nearby,false),'offers',coalesce(p.offers,'[]')));
 zone:=get_salon_business_timezone(p_salon);day:=get_salon_business_date(p_salon);since_at:=timezone(zone,(day-29)::timestamp);until_at:=timezone(zone,(day+1)::timestamp);
 -- Same net-redemption ledger basis as reward_owner_report; not a second charge.
 select count(*) filter(where net_points>0),coalesce(sum(case when net_points>0 then cents else 0 end),0) into uses,cost from (
  select (r.offer->>'valueCents')::integer cents,greatest(0,-coalesce(sum(l.delta),0)) net_points
  from reward_requests r join pos_tickets t on t.id=r.ticket_id and t.salon_id=r.salon_id
  left join reward_ledger l on l.ticket_id=t.id and l.user_id=r.user_id and l.salon_id=r.salon_id
   and (l.event_key='redeem:'||r.id::text or l.event_key like 'redeem-adjust:'||r.id::text||':%')
  where r.salon_id=p_salon and t.opened_at>=since_at and t.opened_at<until_at group by r.id
 )x;
 return ready||jsonb_build_object('salonId',p_salon,'enabled',coalesce(p.enabled,false),'nearby',coalesce(p.nearby,false),
  'periodStart',day-29,'periodEnd',day,'timezone',zone,'discountCents',cost,'rewardUses',uses,
  'members',(select count(*) from reward_members where salon_id=p_salon and joined_at>=since_at and joined_at<until_at),
  'paidConversions',(select count(*) from reward_conversions c join pos_tickets t on t.id=c.ticket_id where c.salon_id=p_salon and c.status='earned' and t.opened_at>=since_at and t.opened_at<until_at));
end $$;
create or replace function public.reward_discover(
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
 elsif (nullif(trim(p_state),'') is null and nullif(trim(p_postal),'') is null) or (nullif(trim(p_city),'') is null and nullif(trim(p_postal),'') is null)
   or nullif(trim(p_country),'') is null then
  return jsonb_build_object('salons','[]'::jsonb,'hasMore',false,'needsArea',true);
 end if;
 with eligible as (
  select l.id,l.name,l.city,l.state,p.rules,p.version,offers.items,
   case when gps then 3958.7613*2*asin(least(1,sqrt(
    power(sin(radians(l.latitude-p_lat)/2),2)+cos(radians(p_lat))*cos(radians(l.latitude))*power(sin(radians(l.longitude-p_lon)/2),2)
   ))) end as miles
  from reward_programs p join locations l on l.id=p.salon_id
  cross join lateral (select reward_public_offers(l.id,p.rules,p.offers) as items) offers
  where p.enabled and p.nearby and offers.items is not null and l.status='active' and salon_profile_public_salon_exists(l.id)
   and (coalesce((p.rules->>'spendPoints')::integer,0)>0 or coalesce((p.rules->>'welcomePoints')::integer,0)>0
    or coalesce((p.rules->>'firstBookingPoints')::integer,0)>0 or coalesce((p.rules->>'visitPoints')::integer,0)>0 or coalesce((p.rules->>'conversionPoints')::integer,0)>0)
   and (p_kind='all' or (p_kind='spend' and (p.rules->>'spendPoints')::integer>0)
    or (p_kind='welcome' and (p.rules->>'welcomePoints')::integer>0) or (p_kind='before_after' and (p.rules->>'conversionPoints')::integer>0))
   and (nullif(trim(p_category),'') is null or lower(trim(p_category))='all' or exists(
    select 1 from services c where c.salon_id=l.id and c.is_active and lower(trim(c.category))=lower(trim(p_category))))
   and case when gps then l.latitude between -90 and 90 and l.longitude between -180 and 180
      and abs(l.latitude-p_lat)<=p_radius_miles/69.0+0.01
    else (nullif(trim(p_state),'') is null or lower(trim(l.state))=lower(trim(p_state)))
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

-- Older bundled clients keep their response shape but share current public
-- eligibility. This closes the private-profile/unreachable-program bypass.
create or replace function public.reward_nearby(p_lat double precision,p_lon double precision) returns jsonb
language plpgsql stable security definer set search_path=public as $$
declare discovery jsonb;
begin
 if p_lat is null or p_lon is null or not(p_lat between -90 and 90) or not(p_lon between -180 and 180) then return '[]'::jsonb; end if;
 discovery:=reward_discover(p_lat=>p_lat,p_lon=>p_lon,p_radius_miles=>15);
 return coalesce((select jsonb_agg(jsonb_build_object('id',item->>'id','name',item->>'name','city',item->>'city','state',item->>'state',
  'spendCents',item->>'spendCents','spendPoints',item->>'spendPoints','offers',item->'offers',
  'distanceKm',round((6371*2*asin(least(1,sqrt(power(sin(radians(l.latitude-p_lat)/2),2)+cos(radians(p_lat))*cos(radians(l.latitude))*power(sin(radians(l.longitude-p_lon)/2),2)))))::numeric,1)) order by ordinal)
  from jsonb_array_elements(discovery->'salons') with ordinality as a(item,ordinal) join locations l on l.id::text=item->>'id' where ordinal<=8),'[]'::jsonb);
end $$;
commit;
