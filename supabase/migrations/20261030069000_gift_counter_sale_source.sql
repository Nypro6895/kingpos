-- Counter Gift purchases buy future value. Keep their money and source separate
-- from current services, discount/tip bases, staff inputs and Reward spend.
begin;
create table public.gift_card_counter_sales (
 id uuid primary key default gen_random_uuid(),
 session_id uuid not null unique references public.gift_card_sessions(id),
 salon_id uuid not null references public.locations(id),
 card_id uuid not null unique references public.gift_cards(id),
 service_ticket_id uuid references public.pos_tickets(id),
 amount_cents integer not null check(amount_cents between 1 and 100000),
 source_kind text not null default 'gift_card_sale' check(source_kind='gift_card_sale'),
 payment_method text not null default 'other' check(payment_method='other'),
 payment_evidence text not null default 'record_only' check(payment_evidence='record_only'),
 status text not null default 'completed' check(status in ('completed','voided')),
 actor_id uuid, created_at timestamptz not null default now()
);
alter table public.gift_card_counter_sales enable row level security;
revoke all on public.gift_card_counter_sales from public,anon,authenticated;

-- Patch the tested adapter with exact anchors; any incompatible installed
-- definition aborts the entire migration instead of silently losing guards.
do $$ declare definition text; anchor text; replacement text; begin
 definition:=pg_get_functiondef('public.gift_card_pos(uuid,text,jsonb,uuid,text)'::regprocedure);
 anchor:='greatest(coalesce((r->>''tipAmount'')::numeric,0),0)';
 if position(anchor in definition)=0 then raise exception 'Review Gift-only tip boundary'; end if;
 definition:=replace(definition,anchor,'case when subtotal>0 then greatest(coalesce((r->>''tipAmount'')::numeric,0),0) else 0 end');
 anchor:='if s.receipt is null or s.total<=0 then raise exception ''Add services before Submit''; end if;';
 if position(anchor in definition)=0 then raise exception 'Review Gift submit eligibility'; end if;
 replacement:='if s.receipt is null or (s.total<=0 and s.purchase<=0) then raise exception ''Add services or a gift card before Submit''; end if;'||chr(10)||'if s.total>0 then';
 definition:=replace(definition,anchor,replacement);
 anchor:='if round(paid*100)<>s.total then raise exception ''Ticket amount changed. Review payment''; end if;';
 if position(anchor in definition)=0 then raise exception 'Review Gift service payment boundary'; end if;
 definition:=replace(definition,anchor,anchor||chr(10)||'else v_result:=''{}''::jsonb; end if;');
 anchor:='s.delivery_card:=gift_card_issue(p_salon,s.purchase,buyer,s.id,ticket);';
 if position(anchor in definition)=0 then raise exception 'Review Gift issuance boundary'; end if;
 replacement:=anchor||chr(10)||
 'insert into gift_card_counter_sales(session_id,salon_id,card_id,service_ticket_id,amount_cents,actor_id) values(s.id,p_salon,s.delivery_card,ticket,s.purchase,current_public_user_id());'||chr(10)||
 'v_result:=v_result||jsonb_build_object(''giftSaleId'',(select id from gift_card_counter_sales where session_id=s.id),''giftSource'',''gift_card_sale'',''giftPurchaseCents'',s.purchase,''amountDueCents'',s.total+s.purchase,''paymentEvidence'',''record_only'');';
 definition:=replace(definition,anchor,replacement);
 -- The ordinary Submit action handles both Gift-only and mixed purchases.
 -- The old collect action remains compatible with earlier web clients.
 execute definition;
end $$;

-- Reverse only wholly unspent issued value, with a retained audit trail. A spent
-- card needs reconciliation instead of silently creating a negative liability.
create function public.gift_card_reverse_counter_sale(p_sale uuid) returns void language plpgsql security definer set search_path=public as $$
declare sale gift_card_counter_sales; card gift_cards; issue gift_card_ledger;
begin
 select * into sale from gift_card_counter_sales where id=p_sale for update;
 if not found then raise exception 'Gift sale unavailable'; end if;
 if sale.status='voided' then return; end if;
 select * into card from gift_cards where id=sale.card_id for update;
 if card.balance<>card.issued or card.issued<>sale.amount_cents or exists(select 1 from gift_card_ledger where card_id=card.id and kind='redeem') then raise exception 'This gift card has been used. Reconcile its balance before voiding the sale.'; end if;
 select * into issue from gift_card_ledger where card_id=card.id and kind='issue';
 if not found then raise exception 'Gift issue source unavailable'; end if;
 update gift_cards set balance=0,status='refunded',generation=generation+1 where id=card.id;
 insert into gift_card_ledger(card_id,salon_id,kind,delta,request_id,actor_id,ticket_id,reversal_of) values(card.id,sale.salon_id,'reverse',-sale.amount_cents,sale.id,current_public_user_id(),sale.service_ticket_id,issue.id);
 update gift_card_counter_sales set status='voided' where id=sale.id;
end $$;
revoke all on function public.gift_card_reverse_counter_sale(uuid) from public,anon,authenticated,service_role;

create function public.gift_card_sale_ticket_guard() returns trigger language plpgsql security definer set search_path=public as $$
declare sale gift_card_counter_sales;
begin
 if new.status is not distinct from old.status then return new; end if;
 for sale in select * from gift_card_counter_sales where service_ticket_id=new.id order by id loop
  if old.status='closed' and new.status in ('voided','cancelled') then
   perform gift_card_reverse_counter_sale(sale.id);
  elsif new.status='open' or sale.status='voided' then
   raise exception 'Gift sale tickets cannot be reopened. Create a new receipt.';
  end if;
 end loop;
 return new;
end $$;
revoke all on function public.gift_card_sale_ticket_guard() from public,anon,authenticated,service_role;
create trigger gift_card_sale_ticket_guard before update of status on public.pos_tickets for each row execute function public.gift_card_sale_ticket_guard();

create or replace function public.gift_card_day_cashflow(p_salon uuid,p_date date,p_before timestamptz default null,p_key uuid default null,p_signature text default null)
returns jsonb language plpgsql security definer set search_path=public as $$
declare timezone text;funding bigint;redeemed bigint;sold_count bigint;used_count bigint;
begin
 if not coalesce(user_has_salon_permission(p_salon,array['reports.view']),false) and not coalesce(pos_portable_access_salon_id(p_key,p_signature)=p_salon and pos_portable_access_has_capability(p_key,p_signature,'portable.report.view'),false) then raise exception 'Report access required'; end if;
 timezone:=get_salon_business_timezone(p_salon);
 select coalesce(sum(amount_cents),0),count(*) into funding,sold_count from gift_card_counter_sales where salon_id=p_salon and status='completed' and (created_at at time zone timezone)::date=p_date and (p_before is null or created_at<=p_before);
 select coalesce(sum(-l.delta),0),count(*) into redeemed,used_count from gift_card_ledger l join pos_tickets t on t.id=l.ticket_id and t.salon_id=l.salon_id where l.salon_id=p_salon and l.kind='redeem' and t.status='closed' and (t.opened_at at time zone timezone)::date=p_date and (p_before is null or t.closed_at<=p_before);
 return jsonb_build_object('counterSales',funding,'redeemed',redeemed,'adjustment',funding-redeemed,'counterSalesCount',sold_count,'redeemedCount',used_count,'source','gift_card');
end $$;
revoke all on function public.gift_card_day_cashflow(uuid,date,timestamptz,uuid,text) from public;
grant execute on function public.gift_card_day_cashflow(uuid,date,timestamptz,uuid,text) to anon,authenticated;

create function public.gift_card_void_counter_sale(p_salon uuid,p_sale uuid) returns jsonb language plpgsql security definer set search_path=public as $$
declare sale gift_card_counter_sales;
begin
 if not coalesce(lifecycle_user_is_salon_owner(p_salon,current_public_user_id(),false),false) then raise exception 'Owner access required'; end if;
 select * into sale from gift_card_counter_sales where id=p_sale and salon_id=p_salon for update;
 if not found then raise exception 'Gift sale unavailable'; end if;
 if sale.service_ticket_id is not null then raise exception 'Void the linked receipt to reverse this mixed sale'; end if;
 perform gift_card_reverse_counter_sale(sale.id);
 return jsonb_build_object('giftSaleId',sale.id,'status','voided','paymentEvidence','record_only');
end $$;
revoke all on function public.gift_card_void_counter_sale(uuid,uuid) from public,anon;
grant execute on function public.gift_card_void_counter_sale(uuid,uuid) to authenticated;

do $$ declare definition text; anchor text; begin
 definition:=pg_get_functiondef('public.gift_card_owner(uuid,text,jsonb)'::regprocedure);
 anchor:='return jsonb_build_object(''installed'',';
 if position(anchor in definition)=0 then raise exception 'Review Gift owner source report'; end if;
 definition:=replace(definition,anchor,'return jsonb_build_object(''counterSales'',coalesce((select jsonb_agg(jsonb_build_object(''id'',x.id,''amountCents'',x.amount_cents,''status'',x.status,''ticketId'',x.service_ticket_id,''at'',x.created_at) order by x.created_at desc) from (select * from gift_card_counter_sales where salon_id=p_salon order by created_at desc limit 200) x),''[]''),''installed'',');
 execute definition;
end $$;
commit;
