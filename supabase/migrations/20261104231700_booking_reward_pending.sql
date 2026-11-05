begin;

-- Read-only estimates, never ledger credits or enrollment. Recomputed from saved
-- appointments, so cancellation, repricing and checkout cannot leave stale holds.
create function public.reward_booking_pending(p_salon uuid,p_user uuid)
returns table("bookingId" uuid,points integer,"firstBookingPoints" integer,"visitPoints" integer,"spendPoints" integer,"at" timestamptz)
language sql stable security definer set search_path=public as $$
 with candidates as (
  select b.id,b.start_at,b.created_at,
   coalesce(tr.rules,case when p.enabled and (t.id is null or t.created_at>=p.updated_at) then p.rules end) as rules,
   coalesce((select sum(greatest(0,l.line_total)) from booking_lines l where l.booking_id=b.id and l.line_status<>'cancelled'),0) as amount
  from bookings b
  join reward_programs p on p.salon_id=b.salon_id
  left join customers c on c.id=b.customer_id and c.location_id=b.salon_id
  left join lateral (select pt.* from pos_tickets pt where pt.salon_id=b.salon_id and
   (pt.source_booking_id=b.id or exists(select 1 from customer_visits v where v.appointment_id=b.id and v.ticket_id=pt.id))
   order by pt.created_at desc,pt.id limit 1) t on true
  left join reward_ticket_rules tr on tr.ticket_id=t.id
  where b.salon_id=p_salon and p_user is not null
   and coalesce(b.customer_user_id,c.customer_user_id)=p_user
   and b.status in ('pending','scheduled','confirmed','checked_in','in_service','completed')
   and (t.id is null or t.status not in ('closed','cancelled','voided'))
   and (b.end_at>=now() or exists(select 1 from customer_visits v where v.appointment_id=b.id and v.status in ('checked_in','in_service','checkout','completed')))
 ), eligible as (
  select *,row_number() over(order by start_at,created_at,id) as ordinal
  from candidates where rules is not null and amount>0
 ), estimates as (
  select id,start_at,
   case when ordinal=1 and not exists(select 1 from reward_ledger where salon_id=p_salon and user_id=p_user and reason='First paid booking')
    then coalesce((rules->>'firstBookingPoints')::integer,0) else 0 end as first_points,
   coalesce((rules->>'visitPoints')::integer,0) as visit_points,
   least(2147483647,floor(amount*100/nullif((rules->>'spendCents')::integer,0))*coalesce((rules->>'spendPoints')::integer,0))::integer as spend_points
  from eligible
 ) select id,least(2147483647,first_points::bigint+visit_points+coalesce(spend_points,0))::integer,first_points,visit_points,coalesce(spend_points,0),start_at
 from estimates where first_points::bigint+visit_points+coalesce(spend_points,0)>0
 order by start_at,id;
$$;
revoke all on function public.reward_booking_pending(uuid,uuid) from public,anon,authenticated;

-- Preserve the existing private view and its redemption/available balance logic.
alter function public.reward_view(uuid,uuid,uuid) rename to reward_view_without_booking_pending;
revoke all on function public.reward_view_without_booking_pending(uuid,uuid,uuid) from public,anon,authenticated;
create function public.reward_view(p_salon uuid,p_user uuid,p_visit uuid default null) returns jsonb
language sql stable security definer set search_path=public as $$
 select v || jsonb_build_object('pending',least(2147483647,(v->>'pending')::bigint+coalesce((select sum(points) from reward_booking_pending(p_salon,p_user)),0)),
  'pendingBookings',coalesce((select jsonb_agg(to_jsonb(b)) from reward_booking_pending(p_salon,p_user) b),'[]'::jsonb))
 from (select reward_view_without_booking_pending(p_salon,p_user,p_visit) v) x;
$$;
revoke all on function public.reward_view(uuid,uuid,uuid) from public,anon,authenticated;

create or replace function public.reward_personal(p_op text,p_args jsonb default '{}') returns jsonb language plpgsql security definer set search_path=public as $$
declare u uuid:=current_public_user_id(); v customer_visits; begin
 if u is null then raise exception 'Sign in required'; end if;
 if p_op='wallet' then
  return jsonb_build_object('cards',coalesce((
   select jsonb_agg(reward_view(s.salon_id,u)||jsonb_build_object('joinedAt',m.joined_at) order by m.joined_at desc nulls last,s.salon_id)
   from (
    select salon_id from reward_members where user_id=u
    union
    select distinct b.salon_id from bookings b left join customers c on c.id=b.customer_id and c.location_id=b.salon_id
     where coalesce(b.customer_user_id,c.customer_user_id)=u
      and exists(select 1 from reward_booking_pending(b.salon_id,u))
   ) s left join reward_members m on m.salon_id=s.salon_id and m.user_id=u
  ),'[]'));
 end if;
 select cv.* into v from customer_visits cv join customers c on c.id=cv.customer_id and c.customer_user_id=u where cv.id=(p_args->>'visitId')::uuid;
 if v.id is null then raise exception 'This visit does not belong to you'; end if;
 return reward_request_command(v.id,p_op,p_args,true);
end $$;
commit;
