begin;
-- Traditional POS carts must not accidentally settle a second copy of work
-- already owned by a shared customer ticket. Other customers are unaffected.
create function public.guard_pos_service_relay_ticket() returns trigger
language plpgsql security definer set search_path=public as $$
declare active_visit uuid;
begin
 select r.visit_id into active_visit from service_relay_tickets r join customer_visits v on v.id=r.visit_id
 where r.salon_id=new.salon_id and v.customer_id=new.customer_id and r.status in ('in_service','checkout')
 and v.status in ('in_service','checkout') limit 1;
 if active_visit is not null and coalesce(current_setting('reylumi.service_relay_visit',true),'')<>active_visit::text then
  raise exception 'This customer has an active Service Relay ticket. Open Service tickets in POS to Submit.';
 end if;
 return new;
end $$;
create trigger guard_pos_service_relay_ticket before insert on pos_tickets for each row execute function guard_pos_service_relay_ticket();
revoke all on function public.guard_pos_service_relay_ticket() from public,anon,authenticated;
commit;
