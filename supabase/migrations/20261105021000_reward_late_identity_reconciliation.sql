begin;
-- Ticket/payment/visit changes already reconcile rewards, but linking the
-- personal identity after checkout never fired any of those triggers.
-- Replay the existing authority; do not invent historical rules or points.
create function public.reward_customer_identity_linked() returns trigger
language plpgsql security definer set search_path=public as $$
declare ticket uuid;
begin
 if new.customer_user_id is null then return null; end if;
 if tg_op='UPDATE' and old.customer_user_id is not null then return null; end if;
 for ticket in select id from pos_tickets where customer_id=new.id and salon_id=new.location_id and status='closed' and not exists(select 1 from reward_ledger r where r.ticket_id=pos_tickets.id and r.user_id is distinct from new.customer_user_id and r.reason in ('Paid visit','First paid booking','First booking adjustment')) order by created_at,id loop
  perform reward_reconcile_ticket(ticket);
 end loop;
 return null;
end $$;
revoke all on function public.reward_customer_identity_linked() from public,anon,authenticated;
create constraint trigger reward_customer_identity_settled after insert or update on public.customers
 deferrable initially deferred for each row execute function public.reward_customer_identity_linked();
-- Repair existing late links with the same idempotent ledger-delta calculation.
do $$ declare ticket uuid; begin
 for ticket in select t.id from pos_tickets t join customers c on c.id=t.customer_id and c.location_id=t.salon_id
  where c.customer_user_id is not null and t.status='closed' and not exists(select 1 from reward_ledger r where r.ticket_id=t.id and r.reason in ('Paid visit','First paid booking','First booking adjustment')) order by t.salon_id,t.created_at,t.id loop
  perform reward_reconcile_ticket(ticket);
 end loop;
end $$;
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
  ),'[]'), 'uncreditedVisits', coalesce((
    select jsonb_agg(jsonb_build_object('salonId',q.salon_id,'salonName',q.name,'visits',q.visits,'reason',
      case when q.completed=0 then 'Your visit is not marked completed by the salon yet.'
       when q.recorded=0 then 'No reward terms were recorded for these receipts. Ask the salon to check when rewards started.'
       else 'Points require a completed visit and a fully paid eligible service receipt. Ask the salon to review these receipts.' end))
    from (select cv.salon_id,l.name,count(*)::int visits,count(*) filter(where cv.status='completed')::int completed,
      count(tr.ticket_id)::int recorded
      from customer_visits cv join customers c on c.id=cv.customer_id and c.location_id=cv.salon_id and c.customer_user_id=u
      join locations l on l.id=cv.salon_id join reward_programs p on p.salon_id=cv.salon_id and p.enabled
      left join reward_ticket_rules tr on tr.ticket_id=cv.ticket_id
      where not exists(select 1 from reward_members m where m.salon_id=cv.salon_id and m.user_id=u)
      group by cv.salon_id,l.name) q
  ),'[]'));
 end if;
 select cv.* into v from customer_visits cv join customers c on c.id=cv.customer_id and c.customer_user_id=u where cv.id=(p_args->>'visitId')::uuid;
 if v.id is null then raise exception 'This visit does not belong to you'; end if;
 return reward_request_command(v.id,p_op,p_args,true);
end $$;

commit;
