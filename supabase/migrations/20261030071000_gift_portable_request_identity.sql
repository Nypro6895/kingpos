-- The Gift session is already server-owned, locked and replay protected.
-- Give direct Portable settlement its stable canonical operation identity even
-- when a supported older POS receipt did not include a client requestId.
begin;
do $$ declare definition text; anchor text; begin
 definition:=pg_get_functiondef('public.gift_card_pos(uuid,text,jsonb,uuid,text)'::regprocedure);
 anchor:='submit_pos_portable_receipt(p_key,p_signature,s.receipt,get_salon_business_date(p_salon))';
 if position(anchor in definition)=0 then raise exception 'Review Gift Portable settlement identity'; end if;
 definition:=replace(definition,anchor,'submit_pos_portable_receipt(p_key,p_signature,s.receipt||jsonb_build_object(''requestId'',s.id),get_salon_business_date(p_salon))');
 execute definition;
end $$;
commit;
