-- One receipt for work and Gift purchases. Work rows remain the wage/turn base.
begin;

alter table public.gift_card_counter_sales drop constraint gift_card_counter_sales_payment_method_check;
alter table public.gift_card_counter_sales add constraint gift_card_counter_sales_payment_method_check
 check(payment_method in ('cash','credit_card','debit_card','other'));
create index if not exists gift_card_counter_sales_ticket on public.gift_card_counter_sales(service_ticket_id);

create function public.gift_card_ensure_sale_ticket(p_sale uuid) returns uuid
language plpgsql security definer set search_path=pg_catalog,public as $$
declare sale public.gift_card_counter_sales; session public.gift_card_sessions; ticket public.pos_tickets; next_sequence integer;
begin
 select * into sale from public.gift_card_counter_sales where id=p_sale for update;
 if not found then raise exception 'Gift sale unavailable'; end if;
 if sale.service_ticket_id is not null then return sale.service_ticket_id; end if;
 select * into session from public.gift_card_sessions where id=sale.session_id;
 -- Same numbering/day lock used by the ordinary POS writer. No customer, visit,
 -- service, turn, earning or provider payment is fabricated for an anonymous sale.
 perform pg_advisory_xact_lock(hashtextextended('staff-day-input:'||sale.salon_id||':'||public.get_salon_business_date(sale.salon_id),0));
 select coalesce(max(ticket_sequence),0)+1 into next_sequence from public.pos_tickets where salon_id=sale.salon_id;
 insert into public.pos_tickets(salon_id,customer_id,opened_at,closed_at,status,notes,ticket_sequence,ticket_number,created_at,updated_at)
 values(sale.salon_id,session.customer_id,sale.created_at,sale.created_at,
  case when sale.status='voided' then 'voided' else 'closed' end,'Gift card sale',next_sequence,'T'||lpad(next_sequence::text,5,'0'),sale.created_at,sale.created_at) returning * into ticket;
 update public.gift_card_counter_sales set service_ticket_id=ticket.id where id=sale.id;
 update public.gift_card_sessions set result=coalesce(result,'{}')||jsonb_build_object('ticketId',ticket.id,'ticketNumber',ticket.ticket_number) where id=sale.session_id;
 return ticket.id;
end $$;
revoke all on function public.gift_card_ensure_sale_ticket(uuid) from public,anon,authenticated,service_role;

alter function public.gift_card_session_view(public.gift_card_sessions,boolean) rename to gift_card_session_view_before_ticket;
revoke all on function public.gift_card_session_view_before_ticket(public.gift_card_sessions,boolean) from public,anon,authenticated,service_role;
create function public.gift_card_session_view(s public.gift_card_sessions,p_delivery boolean default false) returns jsonb
language sql stable security definer set search_path=pg_catalog,public as $$
 select public.gift_card_session_view_before_ticket(s,p_delivery)||case when s.status='completed' then jsonb_build_object('ticketNumber',s.result->>'ticketNumber','ticketId',s.result->>'ticketId','completedDraftId',s.result->'completedDraftId','completedReceiptVersion',s.result->'completedReceiptVersion','completedCustomerVersion',s.result->'completedCustomerVersion') else '{}'::jsonb end
$$;
revoke all on function public.gift_card_session_view(public.gift_card_sessions,boolean) from public,anon,authenticated,service_role;

-- Retain every existing receipt, revision, consent, expiry, reversal and replay
-- guard. Only classify the new money when the operator supplies its source.
alter function public.gift_card_pos(uuid,text,jsonb,uuid,text) rename to gift_card_pos_before_unified_ticket;
revoke all on function public.gift_card_pos_before_unified_ticket(uuid,text,jsonb,uuid,text) from public,anon,authenticated,service_role;
create function public.gift_card_pos(p_salon uuid,p_op text,p_args jsonb default '{}',p_key uuid default null,p_signature text default null) returns jsonb
language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_result jsonb; ticket uuid; sale uuid; method text; was_completed boolean;
begin
 if not public.gift_card_pos_allowed(p_salon,p_key,p_signature) then raise exception 'POS access required'; end if;
 if p_op in ('submit','collect') then
  select status='completed' into was_completed from public.gift_card_sessions where id=(p_args->>'sessionId')::uuid and salon_id=p_salon for update;
  method:=p_args->>'paymentMethod';
  if not coalesce(was_completed,false) and method is not null and method not in ('cash','credit_card','debit_card','other') then raise exception 'Choose Cash, Card or Other'; end if;
 end if;
 v_result:=public.gift_card_pos_before_unified_ticket(p_salon,p_op,p_args,p_key,p_signature);
 if p_op in ('submit','collect') and v_result->>'giftSaleId' is not null then
  sale:=(v_result->>'giftSaleId')::uuid;
  ticket:=public.gift_card_ensure_sale_ticket(sale);
  if not coalesce(was_completed,false) and method is not null then
   update public.gift_card_counter_sales set payment_method=method where id=sale and salon_id=p_salon;
   -- A mixed purchase cannot redeem Gift at the same time. The original POS
   -- payment is service-only and is still a record, never a processor charge.
   update public.pos_payments set payment_method=method where ticket_id=ticket and salon_id=p_salon and payment_method='other';
  end if;
  v_result:=v_result||jsonb_build_object('ticketId',ticket,'ticketNumber',(select ticket_number from public.pos_tickets where id=ticket));
  update public.gift_card_sessions set result=v_result-'session' where id=(p_args->>'sessionId')::uuid;
  v_result:=v_result||jsonb_build_object('session',(select public.gift_card_session_view(s,true) from public.gift_card_sessions s where id=(p_args->>'sessionId')::uuid));
 end if;
 if p_op in ('submit','collect') and not coalesce(was_completed,false) and v_result->>'ticketId' is not null then
  -- Bind the completed summary to an exact closed draft revision. Resetting or
  -- moving to another customer cannot attach an earlier Gift to the next sale.
  select v_result||jsonb_build_object('completedDraftId',d.id,'completedReceiptVersion',d.receipt_version,'completedCustomerVersion',d.customer_version) into v_result
   from public.gift_card_sessions s join public.pos_live_drafts d on d.token=s.draft_token and d.salon_id=s.salon_id
   where s.id=(p_args->>'sessionId')::uuid and d.status='closed';
  if v_result is null then
   select s.result||jsonb_build_object('session',public.gift_card_session_view(s,true)) into v_result from public.gift_card_sessions s where s.id=(p_args->>'sessionId')::uuid;
  else
   update public.gift_card_sessions set result=v_result-'session' where id=(p_args->>'sessionId')::uuid;
   v_result:=v_result||jsonb_build_object('session',(select public.gift_card_session_view(s,true) from public.gift_card_sessions s where s.id=(p_args->>'sessionId')::uuid));
  end if;
 end if;
 return v_result;
end $$;
revoke all on function public.gift_card_pos(uuid,text,jsonb,uuid,text) from public;
grant execute on function public.gift_card_pos(uuid,text,jsonb,uuid,text) to anon,authenticated;

-- A retail-only receipt must not implicitly enroll its buyer or grant welcome
-- points through the existing deferred receipt trigger. Receipts with any work
-- history, visit or Reward entry still use the full reconciliation/reversal.
alter function public.reward_reconcile_ticket(uuid) rename to reward_reconcile_ticket_before_retail;
revoke all on function public.reward_reconcile_ticket_before_retail(uuid) from public,anon,authenticated,service_role;
create function public.reward_reconcile_ticket(p_ticket uuid) returns void
language plpgsql security definer set search_path=pg_catalog,public as $$
begin
 if exists(select 1 from public.gift_card_counter_sales where service_ticket_id=p_ticket)
  and not exists(select 1 from public.pos_ticket_items where pos_ticket_id=p_ticket)
  and not exists(select 1 from public.customer_visits where ticket_id=p_ticket)
  and not exists(select 1 from public.reward_ledger where ticket_id=p_ticket) then return; end if;
 perform public.reward_reconcile_ticket_before_retail(p_ticket);
end $$;
revoke all on function public.reward_reconcile_ticket(uuid) from public,anon,authenticated,service_role;

-- Metadata-only linking for earlier Gift-only receipts. Existing issuance,
-- payment evidence, business dates and locked closing/payroll snapshots survive.
do $$ declare sale uuid; begin
 for sale in select id from public.gift_card_counter_sales where service_ticket_id is null order by created_at,id loop
  perform public.gift_card_ensure_sale_ticket(sale);
 end loop;
end $$;

create function public.ticket_reward_value(p_ticket uuid) returns numeric
language sql stable security definer set search_path=pg_catalog,public as $$
 select coalesce(sum(case when points.net>0 then (r.offer->>'valueCents')::numeric/100 else 0 end),0)
 from public.reward_requests r cross join lateral(
  select -coalesce(sum(l.delta),0) net from public.reward_ledger l where l.ticket_id=r.ticket_id and l.salon_id=r.salon_id and l.user_id=r.user_id
  and (l.event_key='redeem:'||r.id or l.event_key='redeem-return:'||r.id or l.event_key like 'redeem-adjust:'||r.id||':%')
 ) points where r.ticket_id=p_ticket
$$;
revoke all on function public.ticket_reward_value(uuid) from public,anon,authenticated,service_role;

-- Narrow source reader: no card secret/PIN, owner wallet, receipt credentials or
-- cross-salon data. Personal customers may only read their own linked receipts.
create function public.ticket_financial_sources(p_salon uuid,p_tickets uuid[],p_key uuid default null,p_signature text default null) returns jsonb
language plpgsql stable security definer set search_path=pg_catalog,public as $$
declare allowed boolean; result jsonb;
begin
 if p_salon is null or p_tickets is null or cardinality(p_tickets)>2000 then raise exception 'Invalid receipt scope'; end if;
 allowed:=coalesce(public.user_has_salon_permission(p_salon,array['tickets.view','tickets.manage']),false)
  or coalesce(public.pos_portable_access_salon_id(p_key,p_signature)=p_salon and
   (public.pos_portable_access_has_capability(p_key,p_signature,'portable.today.view') or public.pos_portable_access_has_capability(p_key,p_signature,'portable.pos.use')),false);
 if exists(select 1 from unnest(p_tickets) requested(ticket_id) left join public.pos_tickets t on t.id=requested.ticket_id and t.salon_id=p_salon
  left join public.customers c on c.id=t.customer_id and c.location_id=p_salon
  where t.id is null or (not allowed and c.customer_user_id is distinct from public.current_public_user_id()) or (not allowed and public.current_public_user_id() is null)) then
  raise exception 'Receipt access required';
 end if;
 select coalesce(jsonb_object_agg(t.id,jsonb_build_object(
  'giftSales',coalesce((select jsonb_agg(jsonb_build_object('id',s.id,'amountCents',s.amount_cents,'last4',c.last4,'paymentMethod',s.payment_method,'status',s.status,'actorName',coalesce(u.display_name,'Operator'),'createdAt',s.created_at) order by s.created_at,s.id)
   from public.gift_card_counter_sales s join public.gift_cards c on c.id=s.card_id left join public.users u on u.id=s.actor_id where s.salon_id=p_salon and s.service_ticket_id=t.id),'[]'),
  'giftRedeemedCents',coalesce((select sum(-l.delta) from public.gift_card_ledger l where l.salon_id=p_salon and l.ticket_id=t.id and l.kind='redeem'),0),
  'recordedPayments',coalesce((select jsonb_agg(jsonb_build_object('amount',p.amount,'paymentMethod',p.payment_method,'createdAt',p.created_at) order by p.created_at,p.id) from public.pos_payments p where p.ticket_id=t.id and p.salon_id=p_salon),'[]'),
  'rewardDiscount',public.ticket_reward_value(t.id)
 )),'{}') into result from public.pos_tickets t where t.salon_id=p_salon and t.id=any(p_tickets);
 return result;
end $$;
revoke all on function public.ticket_financial_sources(uuid,uuid[],uuid,text) from public;
grant execute on function public.ticket_financial_sources(uuid,uuid[],uuid,text) to anon,authenticated;

alter function public.daily_input_reconciliation_values(uuid,date) rename to daily_input_reconciliation_before_gift_sales;
revoke all on function public.daily_input_reconciliation_before_gift_sales(uuid,date) from public,anon,authenticated,service_role;
create function public.daily_input_reconciliation_values(p_salon uuid,p_date date) returns jsonb
language plpgsql stable security definer set search_path=pg_catalog,public as $$
declare f jsonb; funding numeric; redeemed numeric; service_paid numeric; tip_paid numeric; earned_tip numeric; expected numeric; collected_tip numeric; reward numeric;
begin
 f:=public.daily_input_reconciliation_before_gift_sales(p_salon,p_date);
 select coalesce(sum(amount_cents),0)/100.0 into funding from public.gift_card_counter_sales where salon_id=p_salon and status='completed' and (created_at at time zone public.get_salon_business_timezone(p_salon))::date=p_date;
 select coalesce(sum(-l.delta),0)/100.0 into redeemed from public.gift_card_ledger l join public.pos_tickets t on t.id=l.ticket_id and t.salon_id=l.salon_id
 where l.salon_id=p_salon and l.kind='redeem' and t.status='closed' and (t.opened_at at time zone public.get_salon_business_timezone(p_salon))::date=p_date;
 service_paid:=coalesce((f->>'giftServiceDiscount')::numeric,0);
 tip_paid:=greatest(0,redeemed-service_paid);
 earned_tip:=(f->>'expectedTip')::numeric;
 expected:=round((f->>'expectedService')::numeric+funding,2);
 collected_tip:=round(greatest(0,earned_tip-tip_paid),2);
 select coalesce(sum(public.ticket_reward_value(t.id)),0) into reward from public.pos_tickets t where t.salon_id=p_salon and t.status='closed' and (t.opened_at at time zone public.get_salon_business_timezone(p_salon))::date=p_date;
 return f||jsonb_build_object('giftSales',funding,'giftServicePaid',service_paid,'giftTipPaid',tip_paid,'earnedTip',earned_tip,'rewardDiscount',reward,'ordinaryDiscount',greatest(0,(f->>'discount')::numeric-reward),
  'expectedService',expected,'expectedTip',collected_tip,
  'serviceDifference',case when f->>'actualService' is null then null else round((f->>'actualService')::numeric-expected,2) end,
  'tipDifference',case when f->>'actualTip' is null then null else round((f->>'actualTip')::numeric-collected_tip,2) end);
end $$;
revoke all on function public.daily_input_reconciliation_values(uuid,date) from public,anon,authenticated,service_role;

alter function public.get_pos_portable_report_data(uuid,text,date) rename to portable_report_before_gift_items;
revoke all on function public.portable_report_before_gift_items(uuid,text,date) from public,anon,authenticated,service_role;
create function public.get_pos_portable_report_data(p_key_id uuid,p_session_signature text,p_report_date date default current_date) returns jsonb
language plpgsql security definer set search_path=pg_catalog,public as $$
declare original jsonb; f jsonb; salon uuid;
begin
 original:=public.portable_report_before_gift_items(p_key_id,p_session_signature,p_report_date);
 salon:=public.pos_portable_access_salon_id(p_key_id,p_session_signature);
 f:=public.get_daily_input_reconciliation(salon,p_report_date,p_key_id,p_session_signature);
 return original||jsonb_build_object('totals',coalesce(original->'totals','{}')||jsonb_build_object(
  'giftSales',f->'giftSales','giftServicePaid',f->'giftServicePaid','giftTipPaid',f->'giftTipPaid',
  'earnedTip',f->'earnedTip','rewardDiscount',f->'rewardDiscount','ordinaryDiscount',f->'ordinaryDiscount','grossService',f->'grossService',
  'expectedTotal',f->'expectedService','expectedTip',f->'expectedTip','tips',f->'earnedTip',
  'serviceDifference',f->'serviceDifference','tipDifference',f->'tipDifference','difference',f->'serviceDifference'));
end $$;
revoke all on function public.get_pos_portable_report_data(uuid,text,date) from public;
grant execute on function public.get_pos_portable_report_data(uuid,text,date) to anon,authenticated;

-- Keep the original attention/Ignore keys. Source events go straight to Ticket.
alter function public.owner_attention_candidates(uuid) rename to owner_attention_candidates_before_gift;
revoke all on function public.owner_attention_candidates_before_gift(uuid) from public,anon,authenticated,service_role;
create function public.owner_attention_candidates(p_salon uuid)
returns table(item_key text,kind text,business_date date,occurred_at timestamptz,label text,detail text,target_href text,facts jsonb)
language sql stable security definer set search_path=pg_catalog,public as $$
 with original as (select * from public.owner_attention_candidates_before_gift(p_salon)), ordinary as (
  select o.*,case when o.kind='discount' then greatest(0,coalesce((o.facts->'after'->>'discount_amount')::numeric,0)-coalesce((r.offer->>'valueCents')::numeric/100,0)) end after_discount,
   case when o.kind='discount' then greatest(0,coalesce((o.facts->'before'->>'discount_amount')::numeric,0)-coalesce((r.offer->>'valueCents')::numeric/100,0)) end before_discount
  from original o left join public.reward_requests r on r.ticket_id=nullif(o.facts->>'ticketId','')::uuid and r.salon_id=p_salon and r.status='redeemed'
 ), sales as (
  select 'gift-sale:'||s.id||':'||s.status as k,'gift_sale'::text as category,(s.created_at at time zone public.get_salon_business_timezone(p_salon))::date as d,s.created_at as at,
   'Gift sold · Ticket '||t.ticket_number as title,
   public.financial_notice_money(to_jsonb(s.amount_cents/100.0))||' · Card •••• '||c.last4||case when s.status='voided' then ' · Voided' else '' end as description,
   '/pos-tickets/'||t.id as href,jsonb_build_object('ticketId',t.id,'giftSaleId',s.id,'status',s.status,'actor',coalesce(u.display_name,'Operator'),'amount',s.amount_cents/100.0) as f
  from public.gift_card_counter_sales s join public.pos_tickets t on t.id=s.service_ticket_id and t.salon_id=s.salon_id join public.gift_cards c on c.id=s.card_id left join public.users u on u.id=s.actor_id where s.salon_id=p_salon
 ), uses as (
  select 'gift-use:'||l.id||':'||t.status,'gift_use'::text,(t.opened_at at time zone public.get_salon_business_timezone(p_salon))::date,l.created_at,
   'Gift used · Ticket '||t.ticket_number,public.financial_notice_money(to_jsonb(-l.delta/100.0))||' · Card •••• '||c.last4||case when t.status<>'closed' then ' · Reversed' else '' end,
   '/pos-tickets/'||t.id,jsonb_build_object('ticketId',t.id,'actor',coalesce(u.display_name,'Operator'),'amount',-l.delta/100.0,'status',t.status)
  from public.gift_card_ledger l join public.pos_tickets t on t.id=l.ticket_id and t.salon_id=l.salon_id join public.gift_cards c on c.id=l.card_id left join public.users u on u.id=l.actor_id where l.salon_id=p_salon and l.kind='redeem'
 ), rewards as (
  select 'reward-use:'||r.id||':'||md5(coalesce((select sum(delta)::text from public.reward_ledger where ticket_id=t.id and reason in ('Reward used','Reward returned','Reward adjustment')),'0')),'reward'::text,
   (t.opened_at at time zone public.get_salon_business_timezone(p_salon))::date,t.updated_at,
   'Reward used · Ticket '||t.ticket_number,public.financial_notice_money(to_jsonb(public.ticket_reward_value(t.id)))||case when public.ticket_reward_value(t.id)=0 then ' · Returned' else ' · Service discount' end,
   '/pos-tickets/'||t.id,jsonb_build_object('ticketId',t.id,'amount',public.ticket_reward_value(t.id),'points',(r.offer->>'points')::integer)
  from public.reward_requests r join public.pos_tickets t on t.id=r.ticket_id and t.salon_id=r.salon_id where r.salon_id=p_salon and r.status='redeemed'
 )
 select item_key,kind,business_date,occurred_at,label,detail,target_href,
  case when kind='discount' then jsonb_set(jsonb_set(facts,'{after,discount_amount}',to_jsonb(after_discount)),'{before,discount_amount}',to_jsonb(before_discount)) else facts end
 from ordinary where kind<>'discount' or greatest(after_discount,before_discount)>0
 union all select * from sales union all select * from uses union all select * from rewards
$$;
revoke all on function public.owner_attention_candidates(uuid) from public,anon,authenticated,service_role;
notify pgrst,'reload schema';
commit;
