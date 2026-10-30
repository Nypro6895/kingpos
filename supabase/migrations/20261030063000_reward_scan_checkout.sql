begin;
create table public.reward_visit_channels(visit_id uuid primary key references public.customer_visits(id),token text not null unique default gen_random_uuid()::text);
alter table public.reward_visit_channels enable row level security;
revoke all on table public.reward_visit_channels from anon,authenticated;
-- Staff scan/Holding tickets keep their existing submit core, turns and earnings.
-- This gateway prepares the shared quote and finalizes the typed Gift ledger reduction.
create function public.reward_relay_gateway(p_salon uuid,p_visit uuid,p_expected integer,p_op text,p_args jsonb default '{}',p_tip numeric default 0,p_discount numeric default 0,p_key uuid default null,p_signature text default null) returns jsonb language plpgsql security definer set search_path=public as $$
declare v customer_visits; t service_relay_tickets; receipt jsonb; v_token text; s gift_card_sessions; relay_result jsonb; tid uuid;
begin
 if not coalesce(user_has_salon_permission(p_salon,array['tickets.manage']),false) and not coalesce(pos_portable_access_salon_id(p_key,p_signature)=p_salon and pos_portable_access_has_capability(p_key,p_signature,'portable.pos.use'),false) then raise exception 'POS access required'; end if;
 perform pg_advisory_xact_lock(hashtextextended('service-relay:'||p_salon::text,0));
 select * into v from customer_visits where id=p_visit and salon_id=p_salon for update;
 select * into t from service_relay_tickets where visit_id=p_visit and salon_id=p_salon for update;
 if v.id is null or t.visit_id is null then raise exception 'Check-in unavailable'; end if;
 if p_op='submit' and v.ticket_id is not null and v.status='completed' then
  select x.* into s from gift_card_sessions x join reward_visit_channels ch on ch.token=x.draft_token and ch.visit_id=v.id
   where x.id=(p_args->>'sessionId')::uuid and x.salon_id=p_salon and x.customer_id=v.customer_id and x.status='completed' and x.result->>'ticketId'=v.ticket_id::text;
  if s.id is null or s.revision is distinct from (p_args->>'revision')::integer+1 or t.revision is distinct from p_expected+1
   or (s.receipt->>'tipAmount')::numeric is distinct from p_tip or (s.receipt->>'discountValue')::numeric is distinct from p_discount
  then raise exception 'Gift checkout replay changed'; end if;
  return s.result||jsonb_build_object('session',gift_card_session_view(s,true));
 end if;
 if t.revision is distinct from p_expected then raise exception 'Service ticket changed. Refresh before checkout'; end if;
 insert into reward_visit_channels(visit_id) values(p_visit) on conflict do nothing;
 select ch.token into v_token from reward_visit_channels ch where ch.visit_id=p_visit;
 select jsonb_build_object('customerId',v.customer_id,'customerVisitId',v.id,'customerName',cu.name,'tipAmount',p_tip,'discountType','fixed_amount','discountValue',p_discount,
  'lines',(select coalesce(jsonb_agg(jsonb_build_object('id',l.id,'staffId',o.staff_id,'serviceId',l.service_id,'serviceLabel',sv.name,'total',l.amount,'amountInput',l.amount::text,'amountParts',jsonb_build_array(l.amount)) order by o.created_at,l.id),'[]') from service_relay_lines l join service_relay_offers o on o.id=l.offer_id join services sv on sv.id=l.service_id where o.visit_id=p_visit and o.status in ('working','done')))
 into receipt from customers cu where cu.id=v.customer_id;
 insert into pos_live_drafts(salon_id,token,customer) values(p_salon,v_token,jsonb_build_object('id',v.customer_id,'name',(select name from customers where id=v.customer_id))) on conflict(token) do nothing;
 if p_op='quote' then return reward_quote(p_salon,receipt,v_token)||jsonb_build_object('token',v_token,'receipt',receipt); end if;
 if p_op='sync' then return gift_card_pos(p_salon,'sync',jsonb_build_object('token',v_token,'receipt',receipt),p_key,p_signature); end if;
 select * into s from gift_card_sessions where id=(p_args->>'sessionId')::uuid and salon_id=p_salon and customer_id=v.customer_id and draft_token=v_token for update;
 if s.id is null then raise exception 'Gift card session belongs to another visit'; end if;
 if p_op in ('buy','collect') then raise exception 'Gift sale settlement contract is pending'; end if;
 if p_op<>'submit' then return gift_card_pos(p_salon,p_op,p_args,p_key,p_signature); end if;
 if s.status<>'open' or s.expires_at<=now() or s.revision is distinct from (p_args->>'revision')::integer then raise exception 'Gift selection changed. Review checkout'; end if;
 -- Re-sync against actual Staff lines; changing services invalidates approval.
 relay_result:=gift_card_pos(p_salon,'sync',jsonb_build_object('token',v_token,'receipt',receipt),p_key,p_signature);
 select * into s from gift_card_sessions where id=s.id;
 if s.revision is distinct from (p_args->>'revision')::integer then raise exception 'Services or rewards changed. Review gift card again'; end if;
 -- Shared private helper owns approval, card lock, ledger and exactly-once state.
 s:=gift_card_validate_session(s.id,s.revision,s.receipt);
 perform set_config('reylumi.gift_session',s.id::text,true);
 perform set_config('reylumi.reward_quote',coalesce(s.receipt->>'_rewardQuote',''),true);
 relay_result:=service_relay_submit(p_salon,p_visit,p_expected,p_tip,p_discount,p_key,p_signature);tid:=(relay_result->>'ticketId')::uuid;
 relay_result:=gift_card_finalize_session(s.id,s.revision,tid,s.receipt);
 perform set_config('reylumi.reward_quote','',true);
 perform set_config('reylumi.gift_session','',true);
 return relay_result;
end $$;
revoke all on function public.reward_relay_gateway(uuid,uuid,integer,text,jsonb,numeric,numeric,uuid,text) from public;
grant execute on function public.reward_relay_gateway(uuid,uuid,integer,text,jsonb,numeric,numeric,uuid,text) to anon,authenticated;
create function public.reward_service_relay_submit(p_salon uuid,p_visit uuid,p_expected integer,p_tip numeric,p_discount numeric,p_quote text default null) returns jsonb language plpgsql security definer set search_path=public as $$
declare output jsonb; begin
 perform set_config('reylumi.reward_quote',coalesce(p_quote,''),true);
 output:=service_relay_submit(p_salon,p_visit,p_expected,p_tip,p_discount);
 perform set_config('reylumi.reward_quote','',true);return output;
end $$;
revoke all on function public.reward_service_relay_submit(uuid,uuid,integer,numeric,numeric,text) from public,anon;
grant execute on function public.reward_service_relay_submit(uuid,uuid,integer,numeric,numeric,text) to authenticated;
commit;
