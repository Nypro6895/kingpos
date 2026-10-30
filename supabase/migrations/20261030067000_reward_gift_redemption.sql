begin;
-- Redemption integration against tested Gift50004. No Gift sale acceptance implied.
create or replace function public.reward_reconcile_ticket(p_ticket uuid) returns void language plpgsql security definer set search_path=public as $$
declare t pos_tickets; settle_rules jsonb; u uuid; sub numeric; service_sub numeric; gift_cents bigint; eligible_net numeric; disc numeric; net numeric; paid numeric; target integer; old integer; c reward_conversions; completed boolean; reason_key text; first_tid uuid; redemption reward_requests;
begin
 select * into t from pos_tickets where id=p_ticket; if t.id is null then return; end if;
 select customer_user_id into u from customers where id=t.customer_id and location_id=t.salon_id;
 select tr.rules into settle_rules from reward_ticket_rules tr where ticket_id=t.id;
 if settle_rules is null then
  select p.rules into settle_rules from reward_programs p where p.salon_id=t.salon_id and p.enabled and t.created_at>=p.updated_at;
  if settle_rules is not null then insert into reward_ticket_rules(ticket_id,rules) values(t.id,settle_rules) on conflict do nothing; end if;
 end if;
 select coalesce(sum(line_total),0) into sub from pos_ticket_items where pos_ticket_id=t.id and not is_removed;
 disc:=case when t.discount_type='percentage' then round(sub*least(t.discount_value,100)/100,2) else least(sub,t.discount_value) end;
 net:=greatest(0,sub-disc);
 select coalesce(sum(line_total),0) into service_sub from pos_ticket_items where pos_ticket_id=t.id and not is_removed and source_kind is distinct from 'gift_card_sale';
 select greatest(0,-coalesce(sum(delta),0)) into gift_cents from gift_card_ledger where ticket_id=t.id and salon_id=t.salon_id and kind in ('redeem','reverse');
 -- Gift may cover tip, but service spend is reduced only up to service net.
 eligible_net:=greatest(0,service_sub-disc-least(greatest(0,service_sub-disc),gift_cents/100.0));
 select coalesce(sum(amount),0) into paid from pos_payments where ticket_id=t.id;
 completed:=t.status='closed' and exists(select 1 from customer_visits where ticket_id=t.id and status='completed') and paid>=round(net+round(net*t.tax_rate/100,2)+case when t.tip_type='percentage' then round((net+round(net*t.tax_rate/100,2))*t.tip_value/100,2) else t.tip_value end,2);
 if u is not null and settle_rules is not null then
  perform reward_join(t.salon_id,u); perform reward_lock(t.salon_id,u);
  target:=case when completed and service_sub>0 then floor(eligible_net*100/(settle_rules->>'spendCents')::integer)::integer*(settle_rules->>'spendPoints')::integer+(settle_rules->>'visitPoints')::integer else 0 end;
  -- First booking bonus is selected once, then maintained on that same ticket.
  select ticket_id into first_tid from reward_ledger where salon_id=t.salon_id and user_id=u and reason='First paid booking' order by created_at,id limit 1;
  if completed and service_sub>0 and t.source_booking_id is not null and (first_tid is null or first_tid=t.id) then
   insert into reward_ledger(salon_id,user_id,delta,reason,event_key,ticket_id) values(t.salon_id,u,(settle_rules->>'firstBookingPoints')::integer,'First paid booking','first-booking:'||t.salon_id||':'||u,t.id) on conflict do nothing;
   first_tid:=t.id;
  end if;
  select coalesce(sum(delta),0)::integer into old from reward_ledger where ticket_id=t.id and user_id=u and reason='Paid visit';
  if old<>target then insert into reward_ledger(salon_id,user_id,delta,reason,event_key,ticket_id) values(t.salon_id,u,target-old,'Paid visit','ticket:'||t.id||':'||gen_random_uuid(),t.id); end if;
  if first_tid=t.id then
   select coalesce(sum(delta),0)::integer into old from reward_ledger where ticket_id=t.id and user_id=u and reason in ('First paid booking','First booking adjustment');
   target:=case when completed then (settle_rules->>'firstBookingPoints')::integer else 0 end;
   if old<>target then insert into reward_ledger(salon_id,user_id,delta,reason,event_key,ticket_id) values(t.salon_id,u,target-old,'First booking adjustment','first-adjust:'||gen_random_uuid(),t.id); end if;
  end if;
 end if;
 for c in select rc.* from reward_conversions rc join customer_visits v on v.appointment_id=rc.booking_id where v.ticket_id=t.id loop
  perform reward_lock(c.salon_id,c.author_id);
  target:=case when completed and service_sub>0 and c.author_id is distinct from u then c.points else 0 end;
  select coalesce(sum(delta),0)::integer into old from reward_ledger where event_key like 'conversion:'||c.booking_id||':%';
  if old<>target then insert into reward_ledger(salon_id,user_id,delta,reason,event_key,ticket_id) values(c.salon_id,c.author_id,target-old,'Before & After booking','conversion:'||c.booking_id||':'||gen_random_uuid(),t.id); end if;
  update reward_conversions set status=case when target>0 then 'earned' when t.status in ('voided','cancelled') then 'cancelled' else 'pending' end,ticket_id=t.id where booking_id=c.booking_id;
 end loop;
 for redemption in select * from reward_requests where ticket_id=t.id and status='redeemed' loop
  perform reward_lock(redemption.salon_id,redemption.user_id);
  target:=case when t.status in ('voided','cancelled') or paid<=0 then 0 else -(redemption.offer->>'points')::integer end;
  select coalesce(sum(delta),0)::integer into old from reward_ledger where event_key='redeem:'||redemption.id or event_key='redeem-return:'||redemption.id or event_key like 'redeem-adjust:'||redemption.id||':%';
  if old<>target then insert into reward_ledger(salon_id,user_id,delta,reason,event_key,ticket_id) values(redemption.salon_id,redemption.user_id,target-old,case when target=0 then 'Reward returned' else 'Reward adjustment' end,'redeem-adjust:'||redemption.id||':'||gen_random_uuid(),t.id); end if;
 end loop;
end $$;
revoke all on function public.reward_reconcile_ticket(uuid) from public,anon,authenticated;
create constraint trigger reward_gift_ledger_settled after insert or update or delete on public.gift_card_ledger deferrable initially deferred for each row execute function reward_ticket_changed();
commit;
