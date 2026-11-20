begin;
-- Capture the server's confirmed reward in Gift Card's quote. Keep the original
-- receipt so the canonical receipt wrapper applies the discount exactly once.
create function public.reward_gift_receipt_quote(p_salon uuid,p_receipt jsonb,p_token text) returns jsonb language plpgsql security definer set search_path=public as $$
declare quoted jsonb; value integer:=0; request jsonb; begin
 quoted:=reward_quote(p_salon,p_receipt,p_token); request:=quoted->'view'->'request';
 if request->>'status'='confirmed' then value:=(request->>'valueCents')::integer; end if;
 -- UI refresh counters and client-supplied internal fields are not financial
 -- receipt facts. Keeping them in Gift's hash could revoke a valid approval.
 return (p_receipt-'rewardQuote'-'_rewardRevision'-'rewardRequestId'-'_rewardValueCents'-'_rewardQuote')||jsonb_build_object('_rewardValueCents',value,'_rewardQuote',case when value>0 then request->>'quote' else null end);
end $$;
revoke all on function public.reward_gift_receipt_quote(uuid,jsonb,text) from public,anon,authenticated;
-- Patch only the frozen first-party gift-card adapter, with fail-closed anchors.
do $$ declare definition text; before text; after text; begin
 if to_regprocedure('public.gift_card_pos(uuid,text,jsonb,uuid,text)') is null then raise exception 'Digital Gift Card dependency must be integrated first'; end if;
 if to_regprocedure('public.gift_card_finalize_session(uuid,integer,uuid,jsonb)') is null then raise exception 'Tested Gift settlement helper dependency required'; end if;
 definition:=pg_get_functiondef('public.gift_card_pos(uuid,text,jsonb,uuid,text)'::regprocedure);
 before:='r:=p_args->''receipt''; if jsonb_typeof(r)<>''object'' then raise exception ''Receipt required''; end if;';
 after:=before||chr(10)||'r:=reward_gift_receipt_quote(p_salon,r,d.token);';
 if position(before in definition)=0 then raise exception 'Gift Card sync adapter changed; review reward integration'; end if;
 definition:=replace(definition,before,after);
 before:='v_total:=round((subtotal-least(subtotal,disc)+greatest(coalesce((r->>''tipAmount'')::numeric,0),0))*100);';
 after:='v_total:=round((subtotal-least(subtotal,disc)+greatest(coalesce((r->>''tipAmount'')::numeric,0),0))*100)-coalesce((r->>''_rewardValueCents'')::integer,0);';
 if position(before in definition)=0 then raise exception 'Gift Card total adapter changed; review reward integration'; end if;
 definition:=replace(definition,before,after);
 -- Gift remains a typed ledger reduction. Keep every canonical payment fact.
 if position('gift_card_finalize_session' in definition)=0 then raise exception 'Review tested Gift finalization adapter'; end if;
 execute definition;
end $$;
-- Personal check-in already proves identity. Reuse that visit to choose an owned
-- gift card, without scanning a second QR or exposing other customers' wallets.
create function public.reward_visit_gifts(p_visit uuid,p_card uuid default null) returns jsonb language plpgsql security definer set search_path=public as $$
declare v customer_visits; actor uuid:=current_public_user_id(); s gift_card_sessions; begin
 if actor is null then raise exception 'Sign in required'; end if;
 select cv.* into v from customer_visits cv join customers c on c.id=cv.customer_id and c.customer_user_id=actor where cv.id=p_visit and cv.status in ('waiting','in_service','checkout');
 if v.id is null then raise exception 'This active visit does not belong to you'; end if;
 select * into s from gift_card_sessions where salon_id=v.salon_id and customer_id=v.customer_id and status='open' and expires_at>now() order by created_at desc limit 1;
 if p_card is not null then
  if s.id is null or s.total<=0 then raise exception 'Wait for your services total before using a gift card'; end if;
  perform gift_card_wallet('approve',jsonb_build_object('mobile',s.mobile,'cardId',p_card));
  select * into s from gift_card_sessions where id=s.id;
 end if;
 return jsonb_build_object('session',case when s.id is null then null else gift_card_session_view(s,false) end,
 'cards',coalesce((select jsonb_agg(gift_card_view(c)) from gift_cards c where c.owner_id=actor and c.salon_id=v.salon_id and c.status='active' and c.balance>0),'[]'));
end $$;
revoke all on function public.reward_visit_gifts(uuid,uuid) from public,anon;
grant execute on function public.reward_visit_gifts(uuid,uuid) to authenticated;
commit;
