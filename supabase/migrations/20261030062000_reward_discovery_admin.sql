begin;
create function public.reward_nearby(p_lat double precision,p_lon double precision) returns jsonb language plpgsql stable security definer set search_path=public as $$
begin
 if p_lat is null or p_lon is null or p_lat not between -90 and 90 or p_lon not between -180 and 180 then return '[]'; end if;
 return coalesce((select jsonb_agg(x) from (
  select l.id,l.name,l.city,l.state,p.rules->>'spendCents' as "spendCents",p.rules->>'spendPoints' as "spendPoints",p.offers,
   round((6371*2*asin(least(1,sqrt(power(sin(radians(l.latitude-p_lat)/2),2)+cos(radians(p_lat))*cos(radians(l.latitude))*power(sin(radians(l.longitude-p_lon)/2),2)))))::numeric,1) as "distanceKm"
  from reward_programs p join locations l on l.id=p.salon_id
  where p.enabled and p.nearby and jsonb_array_length(p.offers)>0 and l.status='active' and l.latitude is not null and l.longitude is not null
   and abs(l.latitude-p_lat)<0.3 and abs(l.longitude-p_lon)<0.6
   and 6371*2*asin(least(1,sqrt(power(sin(radians(l.latitude-p_lat)/2),2)+cos(radians(p_lat))*cos(radians(l.latitude))*power(sin(radians(l.longitude-p_lon)/2),2))))<=25
  order by md5(l.id::text||date_trunc('hour',now())::text) limit 8
 )x),'[]');
end $$;
revoke all on function public.reward_nearby(double precision,double precision) from public;
grant execute on function public.reward_nearby(double precision,double precision) to anon,authenticated;

create function public.reward_admin(p_op text,p_args jsonb default '{}') returns jsonb language plpgsql security definer set search_path=public as $$
declare id uuid; begin
 if not coalesce(platform_admin_has_permission('admin.advertising.manage'),false) then raise exception 'Platform admin required'; end if;
 if p_op='save' then
  if coalesce(length(p_args->>'name'),0) not between 1 and 120 or (p_args->>'endsAt')::timestamptz<=(p_args->>'startsAt')::timestamptz or jsonb_typeof(p_args->'template')<>'object' then raise exception 'Invalid promotion'; end if;
  insert into reward_internal_promotions(id,name,starts_at,ends_at,template,status)
   values(coalesce(nullif(p_args->>'id','')::uuid,gen_random_uuid()),p_args->>'name',(p_args->>'startsAt')::timestamptz,(p_args->>'endsAt')::timestamptz,p_args->'template',p_args->>'status')
   on conflict on constraint reward_internal_promotions_pkey do update set name=excluded.name,starts_at=excluded.starts_at,ends_at=excluded.ends_at,template=excluded.template,status=excluded.status;
 elsif p_op<>'load' then raise exception 'Unknown internal promotion action'; end if;
 return jsonb_build_object('promotions',coalesce((select jsonb_agg(to_jsonb(p)||jsonb_build_object('salons',(select count(*) from reward_promotion_participants where promotion_id=p.id))) from reward_internal_promotions p),'[]'),
 'activeSalons',(select count(*) from reward_programs where enabled),'members',(select count(*) from reward_members),'paidConversions',(select count(*) from reward_conversions where status='earned'));
end $$;
revoke all on function public.reward_admin(text,jsonb) from public,anon;
grant execute on function public.reward_admin(text,jsonb) to authenticated;
create function public.reward_owner_invitations(p_salon uuid,p_accept uuid default null) returns jsonb language plpgsql security definer set search_path=public as $$
begin
 if not coalesce(lifecycle_user_is_salon_owner(p_salon,current_public_user_id(),false),false) then raise exception 'Owner access required'; end if;
 if p_accept is not null then
  if not exists(select 1 from reward_internal_promotions where id=p_accept and status='active' and now()>=starts_at and now()<ends_at) then raise exception 'Offer no longer available'; end if;
  insert into reward_promotion_participants(promotion_id,salon_id) values(p_accept,p_salon) on conflict do nothing;
 end if;
 -- Internal promotion names stay internal. Templates are suggestions, never auto-enable rewards.
 return coalesce((select jsonb_agg(jsonb_build_object('id',p.id,'template',p.template,'endsAt',p.ends_at,'accepted',exists(select 1 from reward_promotion_participants where promotion_id=p.id and salon_id=p_salon))) from reward_internal_promotions p where p.status='active' and now()>=p.starts_at and now()<p.ends_at),'[]');
end $$;
revoke all on function public.reward_owner_invitations(uuid,uuid) from public,anon;
grant execute on function public.reward_owner_invitations(uuid,uuid) to authenticated;
commit;
