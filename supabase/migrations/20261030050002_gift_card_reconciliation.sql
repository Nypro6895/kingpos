begin;
create function public.gift_card_day_cashflow(p_salon uuid,p_date date,p_before timestamptz default null,p_key uuid default null,p_signature text default null) returns jsonb language plpgsql security definer set search_path=public as $$
declare timezone text;funding bigint;redeemed bigint;begin
 if not coalesce(user_has_salon_permission(p_salon,array['reports.view']),false) and not coalesce(pos_portable_access_salon_id(p_key,p_signature)=p_salon and pos_portable_access_has_capability(p_key,p_signature,'portable.report.view'),false) then raise exception 'Report access required'; end if;
 timezone:=get_salon_business_timezone(p_salon);
 select coalesce(sum(purchase),0) into funding from gift_card_sessions where salon_id=p_salon and status='completed' and (completed_at at time zone timezone)::date=p_date and (p_before is null or completed_at<=p_before);
 select coalesce(sum(-l.delta),0) into redeemed from gift_card_ledger l join pos_tickets t on t.id=l.ticket_id and t.salon_id=l.salon_id where l.salon_id=p_salon and l.kind='redeem' and t.status='closed' and (t.opened_at at time zone timezone)::date=p_date and (p_before is null or t.closed_at<=p_before);
 return jsonb_build_object('counterSales',funding,'redeemed',redeemed,'adjustment',funding-redeemed);end $$;
revoke all on function public.gift_card_day_cashflow(uuid,date,timestamptz,uuid,text) from public;
grant execute on function public.gift_card_day_cashflow(uuid,date,timestamptz,uuid,text) to anon,authenticated;

-- Preserve the complete current Portable report implementation, including locks.
do $$begin if to_regprocedure('public.get_pos_portable_report_data(uuid,text,date)') is not null then alter function public.get_pos_portable_report_data(uuid,text,date) rename to gift_card_report_before_gifts;end if;end $$;
create function public.get_pos_portable_report_data(p_key_id uuid,p_session_signature text,p_report_date date default current_date) returns jsonb language plpgsql security definer set search_path=public as $$
declare result jsonb;flow jsonb;salon uuid;expected numeric;difference numeric;begin
 salon:=pos_portable_access_salon_id(p_key_id,p_session_signature);
 if salon is null or not coalesce(pos_portable_access_has_capability(p_key_id,p_session_signature,'portable.report.view'),false) then return null;end if;
 result:=gift_card_report_before_gifts(p_key_id,p_session_signature,p_report_date);if result is null then return null;end if;
 flow:=gift_card_day_cashflow(salon,p_report_date,null,p_key_id,p_session_signature);
 expected:=(result->'totals'->>'expectedTotal')::numeric+(flow->>'adjustment')::numeric/100;
 difference:=(result->'totals'->>'actualTotal')::numeric-expected;
 return jsonb_set(result,'{totals}',(result->'totals')||jsonb_build_object('expectedTotal',expected,'difference',difference,'giftCardSales',(flow->>'counterSales')::numeric/100,'giftCardRedeemed',(flow->>'redeemed')::numeric/100,'reconciliationStatus',case when abs(difference)<0.01 then 'balanced' when difference<0 then 'short' else 'over' end));end $$;
revoke all on function public.get_pos_portable_report_data(uuid,text,date) from public;
grant execute on function public.get_pos_portable_report_data(uuid,text,date) to anon,authenticated;
do $$begin if to_regprocedure('public.gift_card_report_before_gifts(uuid,text,date)') is not null then revoke all on function public.gift_card_report_before_gifts(uuid,text,date) from public,anon,authenticated;end if;end $$;

-- Restitution follows an authorized void; do not edit protected posted payment rows.
create function public.gift_card_void_ticket() returns trigger language plpgsql security definer set search_path=public as $$
declare l gift_card_ledger;restored integer;credit integer;begin
 if new.status=old.status or not exists(select 1 from gift_card_ledger where ticket_id=new.id and kind='redeem') then return new;end if;
 if old.status='closed' and new.status in ('voided','cancelled') then
 for l in select * from gift_card_ledger where ticket_id=new.id and salon_id=new.salon_id and kind='redeem' order by card_id loop
 perform 1 from gift_cards where id=l.card_id for update;
 select coalesce(sum(delta),0) into restored from gift_card_ledger where reversal_of=l.id;
 credit:=-l.delta-restored;
 if credit>0 then update gift_cards set balance=balance+credit where id=l.card_id;insert into gift_card_ledger(card_id,salon_id,kind,delta,request_id,actor_id,ticket_id,reversal_of) values(l.card_id,l.salon_id,'reverse',credit,new.id,current_public_user_id(),new.id,l.id);end if;
 end loop;
 else raise exception 'Gift card ticket cannot be reopened. Create a new ticket.';end if;return new;end $$;
revoke all on function public.gift_card_void_ticket() from public,anon,authenticated;
create trigger gift_card_void_ticket after update of status on public.pos_tickets for each row execute function public.gift_card_void_ticket();
commit;
