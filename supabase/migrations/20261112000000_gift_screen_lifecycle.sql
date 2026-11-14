-- Closing a paired screen is presentation state, separate from gift selection,
-- collection, settlement and the immutable result used by Submit retries.
begin;
alter table public.gift_card_sessions
  add column if not exists dismissed_screen text not null default '';

do $migration$
declare body text; anchor text; replacement text;
begin
  body := pg_get_functiondef('public.gift_card_session_view(public.gift_card_sessions,boolean)'::regprocedure);
  anchor := '''collected'',s.collected,''expires'',s.expires_at,';
  replacement := anchor || E'\n ''completedAt'',s.completed_at,''dismissed'',s.dismissed_screen=(s.status||'':''||s.prompt::text) or (s.status=''completed'' and s.completed_at<=now()-interval ''60 seconds''),\n ''deliveryCard'',case when p_delivery then (select gift_card_view(c) from gift_cards c where c.id=s.delivery_card) end,';
  if strpos(body,anchor)=0 then raise exception 'Gift session view lifecycle anchor changed'; end if;
  execute replace(body,anchor,replacement);

  body := pg_get_functiondef('public.gift_card_session_command(uuid,text,jsonb,boolean)'::regprocedure);
  anchor := 'if s.status<>''open'' or s.expires_at<=now() then raise exception ''Session expired or completed''; end if;';
  replacement := $patch$
 if p_op='dismiss' then
   -- A delayed close must never close a new prompt, completion or customer.
   if p_args->>'sessionId' is distinct from s.id::text
      or p_args->>'status' is distinct from (gift_card_session_view(s)->>'status')
      or (p_args->>'prompt')::integer is distinct from s.prompt then
     return jsonb_build_object('session',gift_card_session_view(s,true));
   end if;
   update gift_card_sessions set dismissed_screen=status||':'||prompt::text,
     qr_visible=false,revision=revision+1 where id=s.id
     and dismissed_screen is distinct from status||':'||prompt::text returning * into s;
   if not found then select * into s from gift_card_sessions where id=p_id; end if;
   return jsonb_build_object('session',gift_card_session_view(s,true));
 end if;
 if p_args ? 'sessionId' and p_args->>'sessionId' is distinct from s.id::text then
   raise exception 'Session changed. Review the latest screen';
 end if;
 $patch$ || anchor;
  if strpos(body,anchor)=0 then raise exception 'Gift session command lifecycle anchor changed'; end if;
  execute replace(body,anchor,replacement);

  body := pg_get_functiondef('public.gift_card_pos(uuid,text,jsonb,uuid,text)'::regprocedure);
  anchor := 'select * into s from gift_card_sessions where draft_token=d.token and status=''open'' for update;';
  replacement := $patch$
 -- An unsubmitted gift selection belongs to its customer/visit/cart. Preserve
 -- it for amount/tip edits, but never carry it into another customer's ticket.
 update gift_card_sessions set status='cancelled',qr_visible=false,revision=revision+1
 where draft_token=d.token and status='open' and receipt is not null and (
   nullif(receipt->>'customerId','') is distinct from nullif(r->>'customerId','')
   or nullif(receipt->>'customerVisitId','') is distinct from nullif(r->>'customerVisitId','')
   or (receipt ? 'requestId' and r ? 'requestId' and receipt->>'requestId' is distinct from r->>'requestId')
 );
 $patch$ || anchor;
  if strpos(body,anchor)=0 then raise exception 'Gift POS customer lifecycle anchor changed'; end if;
  body := replace(body,anchor,replacement);
  -- Keep the completed receipt-key lookup unchanged: a lost Submit response
  -- must still replay its original result after Done or the screen deadline.
  anchor := 'status=''completed'' and delivery_card is not null and not collected and expires_at>now()';
  replacement := anchor || ' and dismissed_screen<>status||'':''||prompt::text and completed_at>now()-interval ''60 seconds''';
  if strpos(body,anchor)=0 then raise exception 'Gift POS delivery lifecycle anchor changed'; end if;
  body := replace(body,anchor,replacement);
  anchor := 'select * into s from gift_card_sessions where id=(p_args->>''sessionId'')::uuid and salon_id=p_salon for update; if not found then raise exception ''Session unavailable''; end if;';
  replacement := $patch$
 if p_op='open' then
   select draft_token into d.token from gift_card_sessions where id=(p_args->>'sessionId')::uuid and salon_id=p_salon;
   if not found then raise exception 'Session unavailable'; end if;
   -- Same lock order as sync/display, including expired open sessions.
   perform pg_advisory_xact_lock(hashtextextended('gift-session:'||d.token,0));
 end if;
 $patch$ || anchor || $patch$
 if p_op='open' and (s.status<>'open' or s.expires_at<=now()) then
   update gift_card_sessions set status='cancelled',qr_visible=false,revision=revision+1
     where draft_token=s.draft_token and status='open' and expires_at<=now();
   select * into s from gift_card_sessions where draft_token=d.token and status='open' for update;
   if not found then
     insert into gift_card_sessions(salon_id,draft_token,receipt,receipt_key,total,customer_id)
       select salon_id,draft_token,receipt,receipt_key,total,customer_id from gift_card_sessions
       where id=(p_args->>'sessionId')::uuid and salon_id=p_salon returning * into s;
   end if;
   p_args:=p_args||jsonb_build_object('sessionId',s.id,'revision',s.revision);
 end if;
 $patch$;
  if strpos(body,anchor)=0 then raise exception 'Gift POS explicit open lifecycle anchor changed'; end if;
  execute replace(body,anchor,replacement);

  body := pg_get_functiondef('public.gift_card_display(text,text,jsonb)'::regprocedure);
  anchor := 'if s.id is null and coalesce((select installed from gift_card_settings where salon_id=salon),false) then';
  replacement := 'if (s.id is null and coalesce((select installed from gift_card_settings where salon_id=salon),false)) or (p_op=''open'' and (s.status<>''open'' or s.expires_at<=now())) then';
  if strpos(body,anchor)=0 then raise exception 'Gift display creation lifecycle anchor changed'; end if;
  body := replace(body,anchor,replacement);
  anchor := 'select * into s from gift_card_sessions where draft_token=p_token and status=''open'';';
  replacement := $patch$
 update gift_card_sessions set status='cancelled' where draft_token=p_token and status='open' and expires_at<=now();
 select * into s from gift_card_sessions where draft_token=p_token and status='open' for update;
 $patch$;
  if strpos(body,anchor)=0 then raise exception 'Gift display lock lifecycle anchor changed'; end if;
  body := replace(body,anchor,replacement);
  anchor := 'select * into d from pos_live_drafts where token=p_token; insert into gift_card_sessions';
  replacement := 'select * into d from pos_live_drafts where token=p_token and status=''draft''; if not found then raise exception ''Reconnect the customer display to the POS''; end if; insert into gift_card_sessions';
  if strpos(body,anchor)=0 then raise exception 'Gift display draft lifecycle anchor changed'; end if;
  body := replace(body,anchor,replacement);
  anchor := 'returning * into s; end if;';
  replacement := 'returning * into s; p_args:=p_args||jsonb_build_object(''revision'',s.revision,''sessionId'',s.id); end if;';
  if strpos(body,anchor)=0 then raise exception 'Gift display revision lifecycle anchor changed'; end if;
  execute replace(body,anchor,replacement);
end $migration$;

-- Existing authorized POS/display RPCs remain the only access paths.
notify pgrst, 'reload schema';
commit;
