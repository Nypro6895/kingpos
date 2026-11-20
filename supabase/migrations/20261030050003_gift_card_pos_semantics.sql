-- Gift is a separately typed reduction. Never rewrite canonical POS payment/staff facts.
begin;
drop trigger if exists gift_card_route_payment on public.pos_payments;
drop trigger if exists gift_card_route_remainder on public.pos_payments;
create or replace function public.gift_card_pos(p_salon uuid,p_op text,p_args jsonb default '{}',p_key uuid default null,p_signature text default null) returns jsonb language plpgsql security definer set search_path=public as $$
declare s gift_card_sessions; d pos_live_drafts; c gift_cards; r jsonb; v_total numeric; subtotal numeric; disc numeric; v_result jsonb; ticket uuid; paid numeric; credentials jsonb; buyer uuid;
begin
 if not gift_card_pos_allowed(p_salon,p_key,p_signature) then raise exception 'POS access required'; end if;
 if p_op='sync' then
 select * into d from pos_live_drafts where token=p_args->>'token' and salon_id=p_salon and status='draft';
 if not found then
 if p_args->>'token' ~ '^owner:[0-9a-f-]{36}$' then d.token:=p_args->>'token';d.salon_id:=p_salon;
 else raise exception 'Open a customer display session first'; end if; end if;
 perform pg_advisory_xact_lock(hashtextextended('gift-session:'||d.token,0));
 r:=p_args->'receipt'; if jsonb_typeof(r)<>'object' then raise exception 'Receipt required'; end if;
 select coalesce(sum((v->>'total')::numeric),0) into subtotal from jsonb_array_elements(r->'lines') v;
 disc:=greatest(coalesce((r->>'discountValue')::numeric,0),0); if r->>'discountType'='percentage' then disc:=round(subtotal*least(disc,100)/100,2); end if;
 v_total:=round((subtotal-least(subtotal,disc)+greatest(coalesce((r->>'tipAmount')::numeric,0),0))*100);
 if v_total<0 or v_total>10000000 then raise exception 'Invalid ticket total'; end if;
 update gift_card_sessions set status='cancelled' where draft_token=d.token and status='open' and expires_at<=now();
 select * into s from gift_card_sessions where draft_token=d.token and status='open' for update;
 if not found then
 select * into s from gift_card_sessions where draft_token=d.token and status='completed' and receipt_key=gift_card_hash(r::text) order by created_at desc limit 1;
 if found then return jsonb_build_object('installed',coalesce((select installed from gift_card_settings where salon_id=p_salon),false),'session',gift_card_session_view(s,true)); end if;
 end if;
 if not found and v_total=0 then
 select * into s from gift_card_sessions where draft_token=d.token and status='completed' and delivery_card is not null and not collected and expires_at>now() order by created_at desc limit 1;
 if found then return jsonb_build_object('installed',coalesce((select installed from gift_card_settings where salon_id=p_salon),false),'session',gift_card_session_view(s,true)); end if;
 end if;
 if not found then insert into gift_card_sessions(salon_id,draft_token,receipt,receipt_key,total,customer_id) values(p_salon,d.token,r,gift_card_hash(r::text),v_total,nullif(r->>'customerId','')::uuid) returning * into s;
 elsif s.receipt_key is distinct from gift_card_hash(r::text) then
 update gift_card_sessions set receipt=r,receipt_key=gift_card_hash(r::text),total=v_total::integer,customer_id=nullif(r->>'customerId','')::uuid,card_id=null,amount=0,approved=false,qr_visible=false,revision=revision+1 where id=s.id returning * into s;
 end if;
 return jsonb_build_object('installed',coalesce((select installed from gift_card_settings where salon_id=p_salon),false),'session',gift_card_session_view(s,true));
 end if;
 select * into s from gift_card_sessions where id=(p_args->>'sessionId')::uuid and salon_id=p_salon for update; if not found then raise exception 'Session unavailable'; end if;
 if p_op='wallet' then return jsonb_build_object('cards',coalesce((select jsonb_agg(gift_card_view(x)) from gift_cards x where salon_id=p_salon and status='active' and balance>0 and owner_id=(select customer_user_id from customers where id=s.customer_id and location_id=p_salon)),'[]')); end if;
 if p_op not in ('submit','collect') then return gift_card_session_command(s.id,p_op,p_args,true); end if;
 if s.status='completed' then return s.result||jsonb_build_object('session',gift_card_session_view(s,true)); end if;
 if s.status<>'open' or s.expires_at<=now() or s.revision is distinct from (p_args->>'revision')::integer then raise exception 'Session changed or expired'; end if;

 if s.amount>0 then
 select * into c from gift_cards where id=s.card_id for update;
 if c.salon_id<>p_salon or c.status<>'active' or c.balance<s.amount or c.generation<>s.card_generation or not s.approved or s.approval_expires<=now() then raise exception 'Gift card needs revalidation'; end if;
 end if;
 if p_op='submit' then
 if s.receipt is null or s.total<=0 then raise exception 'Add services before Submit'; end if;
 if nullif(s.receipt->>'sourceBookingId','') is not null and p_key is null then raise exception 'Use Portable POS for appointment-linked gift card checkout'; end if;
 update gift_card_sessions set payment_method=null where id=s.id;
 perform set_config('reylumi.gift_session',s.id::text,true);
 if p_key is not null then v_result:=submit_pos_portable_receipt(p_key,p_signature,s.receipt,get_salon_business_date(p_salon));
 else v_result:=submit_owner_workspace_receipt_core(p_salon,null,s.receipt,get_salon_business_date(p_salon)); end if;
 perform set_config('reylumi.gift_session','',true);
 ticket:=(v_result->>'ticketId')::uuid; if ticket is null then raise exception 'Ticket could not be saved'; end if;
 select coalesce(sum(amount),0) into paid from pos_payments where ticket_id=ticket and salon_id=p_salon;
 if round(paid*100)<>s.total then raise exception 'Ticket amount changed. Review payment'; end if;
 -- POS payment rows are record-only canonical facts, never reclassified by Gift.
 if s.amount>0 then

 update gift_cards set balance=balance-s.amount where id=c.id;
 insert into gift_card_ledger(card_id,salon_id,kind,delta,request_id,actor_id,ticket_id) values(c.id,p_salon,'redeem',-s.amount,s.id,current_public_user_id(),ticket);
 end if;
 else if s.total<>0 or s.purchase<=0 then raise exception 'Use Submit to complete the service ticket'; end if; v_result:='{}'; end if;
 if s.purchase>0 then
 if not coalesce((select installed from gift_card_settings where salon_id=p_salon),false) then raise exception 'Sales are disabled'; end if;
 select customer_user_id into buyer from customers where id=s.customer_id and location_id=p_salon;
 -- Guest delivery stays bearer-based; a known verified customer receives it in their wallet.
 s.delivery_card:=gift_card_issue(p_salon,s.purchase,buyer,s.id,ticket);
 end if;
 update gift_card_sessions set status='completed',completed_at=now(),delivery_card=s.delivery_card,collected=buyer is not null,result=v_result,payment_method=null,collected_by=current_public_user_id(),qr_visible=false,revision=revision+1 where id=s.id returning * into s;
 return v_result||jsonb_build_object('session',gift_card_session_view(s,true)); end $$;


create or replace function public.gift_card_day_cashflow(p_salon uuid,p_date date,p_before timestamptz default null,p_key uuid default null,p_signature text default null) returns jsonb language plpgsql security definer set search_path=public as $$
declare timezone text;funding bigint;redeemed bigint;sold_count bigint;used_count bigint;begin
 if not coalesce(user_has_salon_permission(p_salon,array['reports.view']),false) and not coalesce(pos_portable_access_salon_id(p_key,p_signature)=p_salon and pos_portable_access_has_capability(p_key,p_signature,'portable.report.view'),false) then raise exception 'Report access required'; end if;
 timezone:=get_salon_business_timezone(p_salon);
 select coalesce(sum(purchase),0),count(*) filter(where purchase>0) into funding,sold_count from gift_card_sessions where salon_id=p_salon and status='completed' and (completed_at at time zone timezone)::date=p_date and (p_before is null or completed_at<=p_before);
 select coalesce(sum(-l.delta),0),count(*) into redeemed,used_count from gift_card_ledger l join pos_tickets t on t.id=l.ticket_id and t.salon_id=l.salon_id where l.salon_id=p_salon and l.kind='redeem' and t.status='closed' and (t.opened_at at time zone timezone)::date=p_date and (p_before is null or t.closed_at<=p_before);
 return jsonb_build_object('counterSales',funding,'redeemed',redeemed,'adjustment',funding-redeemed,'counterSalesCount',sold_count,'redeemedCount',used_count,'source','gift_card');end $$;
revoke all on function public.gift_card_day_cashflow(uuid,date,timestamptz,uuid,text) from public;
grant execute on function public.gift_card_day_cashflow(uuid,date,timestamptz,uuid,text) to anon,authenticated;


create or replace function public.gift_card_owner(p_salon uuid,p_op text,p_args jsonb default '{}') returns jsonb language plpgsql security definer set search_path=public as $$
declare c gift_cards; l gift_card_ledger; begin
 if not coalesce(lifecycle_user_is_salon_owner(p_salon,current_public_user_id(),false),false) then raise exception 'Owner access required'; end if;
 if p_op='install' then insert into gift_card_settings(salon_id,installed,design) values(p_salon,(p_args->>'installed')::boolean,coalesce(p_args->'design','{}')) on conflict(salon_id) do update set installed=excluded.installed,design=case when gift_card_settings.design='{}' then excluded.design else gift_card_settings.design end;
 elsif p_op='design' then if octet_length(p_args::text)>2200000 or jsonb_typeof(p_args->'design')<>'object' then raise exception 'Invalid design'; end if;
 insert into gift_card_settings(salon_id,design) values(p_salon,p_args->'design') on conflict(salon_id) do update set design=excluded.design,updated_at=now();
 elsif p_op in ('lock','unlock') then
 select * into c from gift_cards where id=(p_args->>'cardId')::uuid and salon_id=p_salon for update; if not found then raise exception 'Card not found'; end if;
 if c.status='refunded' then raise exception 'Refunded card cannot be unlocked'; end if;
 update gift_cards set status=case when p_op='lock' then 'locked' else 'active' end where id=c.id;
 insert into gift_card_ledger(card_id,salon_id,kind,delta,request_id,actor_id) values(c.id,p_salon,p_op,0,(p_args->>'requestId')::uuid,current_public_user_id()) on conflict do nothing;
 elsif p_op<>'read' then raise exception 'Unknown owner action'; end if;
 return jsonb_build_object('installed',coalesce((select installed from gift_card_settings where salon_id=p_salon),false),'design',(select design from gift_card_settings where salon_id=p_salon),
 'stripeConnected',exists(select 1 from gift_card_settings where salon_id=p_salon and stripe_account is not null) or exists(select 1 from booking_deposit_subscriptions where salon_id=p_salon and stripe_account is not null),
 'cards',coalesce((select jsonb_agg(gift_card_view(x) order by x.created_at desc) from (select * from gift_cards where salon_id=p_salon order by created_at desc limit 200) x),'[]'),
 'ledger',coalesce((select jsonb_agg(jsonb_build_object('id',id,'kind',kind,'delta',delta,'at',created_at,'ticketId',ticket_id) order by created_at desc) from (select * from gift_card_ledger where salon_id=p_salon order by created_at desc limit 200) x),'[]'),
 'stats',(select jsonb_build_object('issued',coalesce(sum(issued),0),'redeemed',coalesce(sum(issued-balance),0),'outstanding',coalesce(sum(balance),0),'soldCount',count(*),'usedCount',(select count(*) from gift_card_ledger counted_ledger join pos_tickets t on t.id=counted_ledger.ticket_id and t.salon_id=counted_ledger.salon_id where counted_ledger.salon_id=p_salon and counted_ledger.kind='redeem' and t.status='closed')) from gift_cards where salon_id=p_salon)); end $$;


commit;

