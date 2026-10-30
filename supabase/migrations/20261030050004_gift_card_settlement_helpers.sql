-- Shared settlement authority for trusted POS and Staff/Holding adapters.
begin;
create function public.gift_card_validate_session(p_session uuid,p_revision integer,p_receipt jsonb)
returns public.gift_card_sessions language plpgsql security definer set search_path=public as $$
declare s gift_card_sessions;c gift_cards;begin
 select * into s from gift_card_sessions where id=p_session for update;
 if not found or s.status<>'open' or s.expires_at<=now() or p_revision is null or s.revision<>p_revision
 or p_receipt is null or s.receipt_key is distinct from gift_card_hash(p_receipt::text)
 then raise exception 'Gift session changed or expired';end if;
 if s.purchase<>0 then raise exception 'Gift sale settlement contract is pending';end if;
 if s.amount<=0 or s.amount>s.total or s.card_id is null or not s.approved or s.approval_expires is null or s.approval_expires<=now() then raise exception 'Gift card needs revalidation';end if;
 select * into c from gift_cards where id=s.card_id for update;
 if not found or c.salon_id<>s.salon_id or c.status<>'active' or c.balance<s.amount or c.generation is distinct from s.card_generation then raise exception 'Gift card needs revalidation';end if;
 return s;end $$;
revoke all on function public.gift_card_validate_session(uuid,integer,jsonb) from public,anon,authenticated,service_role;

create function public.gift_card_finalize_session(p_session uuid,p_revision integer,p_ticket uuid,p_receipt jsonb)
returns jsonb language plpgsql security definer set search_path=public as $$
declare s gift_card_sessions;t pos_tickets;paid numeric;v_result jsonb;begin
 if nullif(current_setting('reylumi.gift_session',true),'') is distinct from p_session::text then raise exception 'Gift settlement context required';end if;
 select * into s from gift_card_sessions where id=p_session for update;
 if not found then raise exception 'Gift session unavailable';end if;
 if s.status='completed' then
  if (s.result->>'ticketId')::uuid is distinct from p_ticket or p_receipt is null or s.receipt_key is distinct from gift_card_hash(p_receipt::text) or s.revision is distinct from p_revision+1 then raise exception 'Gift settlement replay mismatch';end if;
  return s.result||jsonb_build_object('session',gift_card_session_view(s,true));
 end if;
 s:=gift_card_validate_session(p_session,p_revision,p_receipt);
 select * into t from pos_tickets where id=p_ticket for update;
 if not found or t.salon_id<>s.salon_id or t.status<>'closed' or (s.customer_id is not null and t.customer_id is distinct from s.customer_id) then raise exception 'Gift ticket identity mismatch';end if;
 if not exists(select 1 from pos_tickets where id=t.id and xmin::text::bigint=txid_current()%4294967296) then raise exception 'Gift ticket must be finalized in the current transaction';end if;
 if exists(select 1 from gift_card_ledger where ticket_id=t.id and kind='redeem') then raise exception 'Gift already settled on this ticket';end if;
 select coalesce(sum(amount),0) into paid from pos_payments where ticket_id=t.id and salon_id=s.salon_id;
 if round(paid*100)<>s.total then raise exception 'Gift ticket amount changed';end if;
 update gift_cards set balance=balance-s.amount where id=s.card_id;
 insert into gift_card_ledger(card_id,salon_id,kind,delta,request_id,actor_id,ticket_id) values(s.card_id,s.salon_id,'redeem',-s.amount,s.id,current_public_user_id(),t.id);
 v_result:=jsonb_build_object('ticketId',t.id,'ticketNumber',t.ticket_number,'giftSource','gift_card','giftAmountCents',s.amount);
 update gift_card_sessions set status='completed',completed_at=now(),result=v_result,payment_method=null,collected_by=current_public_user_id(),qr_visible=false,revision=revision+1 where id=s.id returning * into s;
 return v_result||jsonb_build_object('session',gift_card_session_view(s,true));end $$;
revoke all on function public.gift_card_finalize_session(uuid,integer,uuid,jsonb) from public,anon,authenticated,service_role;
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

 if s.amount>0 then s:=gift_card_validate_session(s.id,s.revision,s.receipt);end if;
 if p_op='submit' then
 if s.receipt is null or s.total<=0 then raise exception 'Add services before Submit'; end if;
 if nullif(s.receipt->>'sourceBookingId','') is not null and p_key is null then raise exception 'Use Portable POS for appointment-linked gift card checkout'; end if;
 update gift_card_sessions set payment_method=null where id=s.id;
 perform set_config('reylumi.gift_session',s.id::text,true);
 if p_key is not null then v_result:=submit_pos_portable_receipt(p_key,p_signature,s.receipt,get_salon_business_date(p_salon));
 else v_result:=submit_owner_workspace_receipt_core(p_salon,null,s.receipt,get_salon_business_date(p_salon)); end if;
 if s.amount>0 then
 v_result:=gift_card_finalize_session(s.id,s.revision,(v_result->>'ticketId')::uuid,s.receipt);
 perform set_config('reylumi.gift_session','',true);return v_result;end if;
 perform set_config('reylumi.gift_session','',true);
 ticket:=(v_result->>'ticketId')::uuid; if ticket is null then raise exception 'Ticket could not be saved'; end if;
 select coalesce(sum(amount),0) into paid from pos_payments where ticket_id=ticket and salon_id=p_salon;
 if round(paid*100)<>s.total then raise exception 'Ticket amount changed. Review payment'; end if;
 -- Gift redemption has already returned through the shared finalize helper.
 else if s.total<>0 or s.purchase<=0 then raise exception 'Use Submit to complete the service ticket'; end if; v_result:='{}'; end if;
 if s.purchase>0 then
 if not coalesce((select installed from gift_card_settings where salon_id=p_salon),false) then raise exception 'Sales are disabled'; end if;
 select customer_user_id into buyer from customers where id=s.customer_id and location_id=p_salon;
 -- Guest delivery stays bearer-based; a known verified customer receives it in their wallet.
 s.delivery_card:=gift_card_issue(p_salon,s.purchase,buyer,s.id,ticket);
 end if;
 update gift_card_sessions set status='completed',completed_at=now(),delivery_card=s.delivery_card,collected=buyer is not null,result=v_result,payment_method=null,collected_by=current_public_user_id(),qr_visible=false,revision=revision+1 where id=s.id returning * into s;
 return v_result||jsonb_build_object('session',gift_card_session_view(s,true)); end $$;



commit;

