begin;
create function public.gift_card_catalog(p_salon uuid) returns jsonb language sql stable security definer set search_path=public as $$select jsonb_build_object('installed',coalesce(s.installed,false),'design',s.design,'salonName',l.name) from locations l left join gift_card_settings s on s.salon_id=l.id where l.id=p_salon$$;
revoke all on function public.gift_card_catalog(uuid) from public;
grant execute on function public.gift_card_catalog(uuid) to anon,authenticated;
create function public.gift_card_online_fulfill(p_order uuid,p_intent text,p_refunded integer default 0) returns jsonb language plpgsql security definer set search_path=public as $$
declare o gift_card_online_orders; card uuid; begin
 select * into o from gift_card_online_orders where id=p_order for update; if not found then raise exception 'Order missing'; end if;
 if o.payment_intent is not null and o.payment_intent<>p_intent then raise exception 'Payment mismatch'; end if;
 if p_refunded>0 then
 update gift_card_online_orders set status='review',payment_intent=p_intent where id=o.id;
 update gift_cards set status='locked' where id=o.card_id;
 return jsonb_build_object('message','Refund received. Owner reconciliation required.'); end if;
 if o.status='review' then return jsonb_build_object('message','Payment requires review.'); end if;
 if o.card_id is null then card:=gift_card_issue(o.salon_id,o.amount,o.actor_id,o.id); update gift_card_online_orders set card_id=card,status='paid',payment_intent=p_intent where id=o.id; end if;
 return jsonb_build_object('ok',true); end $$;
create function public.gift_card_online_receipt(p_token text) returns jsonb language plpgsql security definer set search_path=public as $$
declare o gift_card_online_orders; c gift_cards; begin
 select * into o from gift_card_online_orders where token=p_token; if not found then raise exception 'Purchase missing'; end if;
 if o.status<>'paid' then return jsonb_build_object('message',case when o.status='review' then 'Payment requires salon review.' else 'Waiting for confirmed payment. No card has been activated.' end); end if;
 select * into c from gift_cards where id=o.card_id;
 -- A paid receipt never resurrects an older bearer link after transfer or claim.
 if c.generation<>1 or c.owner_id is not null then return jsonb_build_object('message','Gift card is in its current owner’s wallet or has been transferred. Open your wallet.'); end if;
 return jsonb_build_object('card',gift_card_view(c),'token',gift_card_secret(c),'code',upper(substr(gift_card_secret(c),1,16)),'pin',upper(substr(gift_card_secret(c),17,8))); end $$;
revoke all on function public.gift_card_online_fulfill(uuid,text,integer),public.gift_card_online_receipt(text) from public,anon,authenticated;
grant execute on function public.gift_card_online_fulfill(uuid,text,integer),public.gift_card_online_receipt(text),public.gift_card_issue(uuid,integer,uuid,uuid,uuid) to service_role;
commit;
