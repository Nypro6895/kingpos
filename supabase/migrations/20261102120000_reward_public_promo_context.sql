begin;
-- Read-only promotion context. Earning and settlement functions are unchanged.
-- One-time eligibility follows the canonical enrollment and first-booking keys;
-- a refunded/zero original first-booking row is still consumed by settlement.
create or replace function public.reward_public_program(p_salon uuid) returns jsonb
language plpgsql stable security definer set search_path=public as $$
declare p reward_programs; l locations; ready jsonb; u uuid; member boolean; first_booking_claimed boolean;
begin
 select * into p from reward_programs where salon_id=p_salon;
 if not found then return jsonb_build_object('salon',null); end if;
 ready:=reward_program_readiness(p_salon,p.rules||jsonb_build_object('enabled',p.enabled,'nearby',p.nearby,'offers',p.offers));
 if not(ready->>'discoverable')::boolean then return jsonb_build_object('salon',null); end if;
 select * into l from locations where id=p_salon;
 u:=current_public_user_id();
 member:=u is not null and exists(select 1 from reward_members where salon_id=p_salon and user_id=u);
 first_booking_claimed:=u is not null and exists(select 1 from reward_ledger where salon_id=p_salon and user_id=u and reason='First paid booking');
 return jsonb_build_object(
  'salon',p.rules||jsonb_build_object('id',l.id,'name',l.name,'city',l.city,'state',l.state,'distanceMiles',null,'version',p.version,'offers',ready->'offers'),
  'joined',member,'available',case when member then greatest(0,reward_available(p_salon,u)) else null end,
  'earningEligibility',jsonb_build_object(
   'welcome',u is not null and not member and coalesce((p.rules->>'welcomePoints')::integer,0)>0,
   'firstBooking',u is not null and not first_booking_claimed and coalesce((p.rules->>'firstBookingPoints')::integer,0)>0,
   'spend',coalesce((p.rules->>'spendPoints')::integer,0)>0,
   'visit',coalesce((p.rules->>'visitPoints')::integer,0)>0,
   'beforeAfter',coalesce((p.rules->>'conversionPoints')::integer,0)>0));
end $$;
revoke all on function public.reward_public_program(uuid) from public;
grant execute on function public.reward_public_program(uuid) to anon,authenticated;
commit;
