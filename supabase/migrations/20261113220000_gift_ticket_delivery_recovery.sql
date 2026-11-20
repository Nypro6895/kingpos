-- A confirmed purchase closes its paired editor; receipt recovery is a separate
-- privileged read of the same issued card, independent of checkout expiry.
begin;

do $$ declare definition text; anchor text; begin
 definition:=pg_get_functiondef('public.gift_card_session_command(uuid,text,jsonb,boolean)'::regprocedure);
 anchor:='set mode=''buy'',purchase=v_amount,card_id=null,amount=0,approved=false,qr_visible=false,revision=revision+1';
 if strpos(definition,anchor)=0 then raise exception 'Review Gift purchase close anchor'; end if;
 execute replace(definition,anchor,'set mode=''buy'',purchase=v_amount,card_id=null,amount=0,approved=false,qr_visible=false,dismissed_screen=status||'':''||prompt::text,revision=revision+1');
end $$;

create function public.gift_card_ticket_delivery(p_salon uuid,p_ticket uuid,p_sale uuid,p_key uuid default null,p_signature text default null)
returns jsonb language plpgsql stable security definer set search_path=pg_catalog,public as $$
declare sale public.gift_card_counter_sales; ticket public.pos_tickets; card public.gift_cards; session public.gift_card_sessions; state text;
begin
 if not public.gift_card_pos_allowed(p_salon,p_key,p_signature) then raise exception 'POS access required'; end if;
 select * into ticket from public.pos_tickets where id=p_ticket and salon_id=p_salon;
 if not found then raise exception 'Gift receipt unavailable'; end if;
 select * into sale from public.gift_card_counter_sales where id=p_sale and service_ticket_id=ticket.id and salon_id=p_salon;
 if not found then raise exception 'Gift receipt unavailable'; end if;
 select * into card from public.gift_cards where id=sale.card_id and salon_id=p_salon;
 select * into session from public.gift_card_sessions where id=sale.session_id and salon_id=p_salon and delivery_card=sale.card_id;
 state:=case
  when ticket.status<>'closed' or sale.status<>'completed' or card.status='refunded' then 'voided'
  when session.id is null or session.status<>'completed' or card.id is null or card.status<>'active' then 'unavailable'
  when card.controller_id is not null or card.generation<>1 and card.owner_id is null then 'transferred'
  when session.collected or card.owner_id is not null then 'collected'
  when card.generation<>1 or card.balance<=0 then 'unavailable'
  else 'ready' end;
 -- No credentials in list/source readers. Do not issue, rotate, extend a
 -- checkout, change ownership, or reopen an old prompt on a customer's screen.
 return jsonb_build_object('deliveryStatus',state,'ticketNumber',ticket.ticket_number,'giftSaleId',sale.id,
   'purchase',sale.amount_cents,'card',public.gift_card_view(card))
   ||case when state='ready' then jsonb_build_object('token',public.gift_card_secret(card)) else '{}'::jsonb end;
end $$;
revoke all on function public.gift_card_ticket_delivery(uuid,uuid,uuid,uuid,text) from public;
grant execute on function public.gift_card_ticket_delivery(uuid,uuid,uuid,uuid,text) to anon,authenticated;
notify pgrst,'reload schema';
commit;
