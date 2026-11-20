begin;
-- Preserve immutable v1 migration/source. Apply explicit server authority fixes.
create or replace function public.reward_request_command(p_visit uuid,p_op text,p_args jsonb,p_customer boolean) returns jsonb language plpgsql security definer set search_path=public as $$
declare v customer_visits; u uuid; p reward_programs; r reward_requests; o jsonb; begin
 select * into v from customer_visits where id=p_visit for update;
 select customer_user_id into u from customers where id=v.customer_id and location_id=v.salon_id;
 if v.id is null or u is null then raise exception 'Link a personal account to this check-in to use rewards'; end if;
 if v.status in ('completed','cancelled') then return jsonb_build_object('view',reward_view(v.salon_id,u,v.id)); end if;
 perform reward_join(v.salon_id,u); perform reward_lock(v.salon_id,u);
 select * into p from reward_programs where salon_id=v.salon_id;
 select * into r from reward_requests where visit_id=v.id for update;
 if p_op in ('request','suggest') then
  if p.salon_id is null then raise exception 'Reward program unavailable'; end if;
  select value into o from jsonb_array_elements(p.offers) where value->>'id'=p_args->>'offerId';
  if o is null then raise exception 'Reward unavailable'; end if;
  if reward_available(v.salon_id,u,r.id)<(o->>'points')::integer then raise exception 'Not enough available points'; end if;
  insert into reward_requests(visit_id,salon_id,user_id,offer,status) values(v.id,v.salon_id,u,o,case when p_customer then 'requested' else 'suggested' end)
   on conflict(visit_id) do update set offer=excluded.offer,status=excluded.status,quote=null,draft_token=null,customer_consented=false,expires_at=now()+interval '12 hours',revision=reward_requests.revision+1;
  if p_customer and coalesce((p_args->>'consent')::boolean,false) then update reward_requests set customer_consented=true where visit_id=v.id; end if;
 elsif p_op='cancel' then
  if r.status<>'redeemed' then update reward_requests set status='cancelled',revision=revision+1 where id=r.id; end if;
 elsif p_op='confirm' then
  if not p_customer then raise exception 'Customer confirmation required'; end if;
  if r.id is null or r.status not in ('requested','suggested') or r.expires_at<=now() or r.quote is null
   or (p_args->>'revision')::integer is distinct from r.revision or p_args->>'quote' is distinct from r.quote then raise exception 'Ticket changed. Review the current reward.'; end if;
  if reward_available(v.salon_id,u,r.id)<(r.offer->>'points')::integer then raise exception 'Points already reserved on another visit'; end if;
  update reward_requests set status='confirmed',customer_consented=true,revision=revision+1 where id=r.id;
 elsif p_op<>'load' then raise exception 'Unknown reward action'; end if;
 return jsonb_build_object('view',reward_view(v.salon_id,u,v.id));
end $$;
create or replace function public.reward_prepare_receipt(p_salon uuid,p_receipt jsonb) returns jsonb language plpgsql security definer set search_path=public as $$
declare r reward_requests; v customer_visits; view jsonb; sub numeric; disc numeric; token text; begin
 if jsonb_typeof(p_receipt) is distinct from 'object' then raise exception 'Receipt required'; end if;
 -- Only this function may author the internal pointer consumed by finish.
 p_receipt:=p_receipt-'rewardRequestId'-'_rewardValueCents';
 select * into v from customer_visits where salon_id=p_salon and customer_id=nullif(p_receipt->>'customerId','')::uuid and status in ('waiting','in_service','checkout')
  and (nullif(p_receipt->>'customerVisitId','') is null or id=(p_receipt->>'customerVisitId')::uuid) order by checked_in_at desc limit 1 for update;
 if v.id is null then
  if coalesce(p_receipt->>'rewardQuote',p_receipt->>'_rewardQuote') is not null then raise exception 'Reward visit changed. Refresh before payment'; end if;
  return p_receipt;
 end if;
 select * into r from reward_requests where visit_id=v.id;
 if r.status<>'confirmed' or r.id is null then
  if coalesce(p_receipt->>'rewardQuote',p_receipt->>'_rewardQuote',nullif(current_setting('reylumi.reward_quote',true),'')) is not null then raise exception 'Reward changed. Refresh before payment'; end if;
  return p_receipt;
 end if;
 if coalesce(p_receipt->>'rewardQuote',p_receipt->>'_rewardQuote',nullif(current_setting('reylumi.reward_quote',true),'')) is distinct from r.quote then raise exception 'Reward changed. Refresh the total before collecting payment'; end if;
 token:=coalesce(p_receipt->>'liveDraftToken',r.draft_token);
 perform reward_quote(p_salon,p_receipt,token);
 select * into r from reward_requests where visit_id=v.id for update;
 if r.status<>'confirmed' or r.expires_at<=now() or r.quote is null then raise exception 'Reward needs customer confirmation again'; end if;
 if reward_available(p_salon,r.user_id,r.id)<(r.offer->>'points')::integer then raise exception 'Not enough points'; end if;
 select coalesce(sum((x->>'total')::numeric),0) into sub from jsonb_array_elements(p_receipt->'lines')x;
 disc:=greatest(0,coalesce((p_receipt->>'discountValue')::numeric,0));
 if p_receipt->>'discountType'='percentage' then disc:=round(sub*least(disc,100)/100,2); end if;
 return p_receipt||jsonb_build_object('customerVisitId',v.id,'discountType','fixed_amount','discountValue',disc+(r.offer->>'valueCents')::numeric/100,'rewardRequestId',r.id);
end $$;
create or replace function public.reward_finish_receipt(p_salon uuid,p_receipt jsonb,p_result jsonb) returns void language plpgsql security definer set search_path=public as $$
declare r reward_requests; ticket pos_tickets; visit customer_visits; tid uuid:=nullif(p_result->>'ticketId','')::uuid; begin
 if tid is null then return; end if;
 select * into ticket from pos_tickets where id=tid and salon_id=p_salon;
 if ticket.id is null then raise exception 'Reward ticket belongs to another salon'; end if;
 insert into reward_ticket_rules(ticket_id,rules) select tid,rules from reward_programs where salon_id=p_salon and enabled on conflict do nothing;
 if p_receipt->>'rewardRequestId' is null then return; end if;
 select * into r from reward_requests where id=(p_receipt->>'rewardRequestId')::uuid and salon_id=p_salon for update;
 if r.status='redeemed' and r.ticket_id=tid then return; end if;
 if r.id is null or r.status<>'confirmed' or not r.customer_consented or r.expires_at<=now() or r.quote is null then raise exception 'Reward is not confirmed'; end if;
 select * into visit from customer_visits where id=r.visit_id and salon_id=p_salon;
 if ticket.customer_id is distinct from nullif(p_receipt->>'customerId','')::uuid
  or visit.id is distinct from nullif(p_receipt->>'customerVisitId','')::uuid
  or visit.customer_id is distinct from ticket.customer_id or visit.ticket_id is distinct from tid
  or r.user_id is distinct from (select customer_user_id from customers where id=ticket.customer_id and location_id=p_salon)
  or r.quote is distinct from coalesce(p_receipt->>'rewardQuote',p_receipt->>'_rewardQuote',nullif(current_setting('reylumi.reward_quote',true),''))
 then raise exception 'Reward identity or receipt binding changed'; end if;
 perform reward_lock(p_salon,r.user_id);
 if reward_available(p_salon,r.user_id,r.id)<(r.offer->>'points')::integer then raise exception 'Not enough points'; end if;
 insert into reward_ledger(salon_id,user_id,delta,reason,event_key,ticket_id) values(p_salon,r.user_id,-(r.offer->>'points')::integer,'Reward used','redeem:'||r.id,tid);
 update reward_requests set status='redeemed',ticket_id=tid,revision=revision+1 where id=r.id;
end $$;
-- Legacy pending confirmations without an explicit consent flag need review;
-- never infer consent merely to keep a stale checkout moving.
update public.reward_requests set status='requested',quote=null,revision=revision+1
 where status='confirmed' and not customer_consented;
revoke all on function public.reward_request_command(uuid,text,jsonb,boolean),public.reward_prepare_receipt(uuid,jsonb),public.reward_finish_receipt(uuid,jsonb,jsonb) from public,anon,authenticated;
commit;
