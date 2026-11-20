begin;
-- No direct customer/display access to balances, secrets, or ledger tables.
create table public.gift_card_settings (salon_id uuid primary key references public.locations(id), installed boolean not null default false, design jsonb not null default '{}', stripe_account text, updated_at timestamptz not null default now());
create table public.gift_cards (
 id uuid primary key default gen_random_uuid(), salon_id uuid not null references public.locations(id),
 owner_id uuid, controller_id uuid, seed text not null default replace(gen_random_uuid()::text||gen_random_uuid()::text,'-',''),
 generation integer not null default 1 check(generation>0), balance integer not null check(balance>=0), issued integer not null check(issued>0 and issued<=100000),
 status text not null default 'active' check(status in ('active','locked','refunded')), request_id uuid not null, design jsonb not null,
 credential_hash text not null default '', manual_hash text not null default '', last4 text not null default '', created_at timestamptz not null default now(), unique(salon_id,request_id)
);
create index gift_cards_owner on public.gift_cards(owner_id,salon_id);
create unique index gift_cards_credential on public.gift_cards(credential_hash) where credential_hash<>'';
create unique index gift_cards_manual on public.gift_cards(manual_hash) where manual_hash<>'';
create table public.gift_card_transfers(request_id uuid primary key,card_id uuid not null references public.gift_cards(id),previous_hash text not null,generation integer not null,created_at timestamptz not null default now());
alter table public.gift_card_transfers enable row level security;
revoke all on public.gift_card_transfers from public,anon,authenticated;
create table public.gift_card_presentations(id uuid primary key default gen_random_uuid(),card_id uuid not null references public.gift_cards(id),owner_id uuid not null,generation integer not null,secret_hash text not null unique,manual_hash text not null unique,session_id uuid,expires_at timestamptz not null default now()+interval '2 minutes');
alter table public.gift_card_presentations enable row level security;
revoke all on public.gift_card_presentations from public,anon,authenticated;
create table public.gift_card_ledger (
 id uuid primary key default gen_random_uuid(), card_id uuid not null references public.gift_cards(id), salon_id uuid not null references public.locations(id),
 kind text not null check(kind in ('issue','redeem','transfer','claim','lock','unlock','reverse')), delta integer not null, request_id uuid not null,
 actor_id uuid, ticket_id uuid references public.pos_tickets(id), reversal_of uuid unique references public.gift_card_ledger(id), created_at timestamptz not null default now(), unique(card_id,request_id)
);
create table public.gift_card_sessions (
 id uuid primary key default gen_random_uuid(), salon_id uuid not null references public.locations(id), draft_token text not null,
 receipt jsonb, receipt_key text, customer_id uuid, revision integer not null default 0, prompt integer not null default 0, mode text not null default 'use' check(mode in ('use','buy')),
 entry text not null default 'code' check(entry in ('code','scan','wallet')), status text not null default 'open' check(status in ('open','completed','cancelled')),
 amount integer not null default 0 check(amount>=0), total integer not null default 0 check(total>=0), purchase integer not null default 0 check(purchase between 0 and 100000),
 card_id uuid references public.gift_cards(id), card_generation integer, approved boolean not null default false, approval_expires timestamptz, qr_visible boolean not null default false,
 mobile text not null default replace(gen_random_uuid()::text||gen_random_uuid()::text,'-','') unique, attempts integer not null default 0,
 delivery_card uuid references public.gift_cards(id), collected boolean not null default false, result jsonb, payment_method text, collected_by uuid,
 expires_at timestamptz not null default now()+interval '10 minutes', created_at timestamptz not null default now(), completed_at timestamptz
);
create unique index gift_card_session_active on public.gift_card_sessions(draft_token) where status='open';
create table public.gift_card_online_orders (
 id uuid primary key default gen_random_uuid(), salon_id uuid not null references public.locations(id), actor_id uuid, request_id uuid not null,
 amount integer not null check(amount between 100 and 100000), stripe_account text not null, stripe_session text unique, payment_intent text unique,
 status text not null default 'pending' check(status in ('pending','paid','review')), card_id uuid references public.gift_cards(id),
 token text not null default replace(gen_random_uuid()::text||gen_random_uuid()::text,'-','') unique, created_at timestamptz not null default now(), unique(salon_id,request_id)
);
do $$declare t text;begin foreach t in array array['gift_card_settings','gift_cards','gift_card_ledger','gift_card_sessions','gift_card_online_orders'] loop execute format('alter table public.%I enable row level security',t); execute format('revoke all on public.%I from anon, authenticated',t); end loop; end $$;

create function public.gift_card_hash(p_text text) returns text language sql immutable strict set search_path=public as $$ select encode(sha256(convert_to(p_text,'UTF8')),'hex') $$;
create function public.gift_card_secret(c public.gift_cards) returns text language sql immutable strict set search_path=public as $$ select gift_card_hash(c.seed||':'||c.generation::text) $$;
create function public.gift_card_credentials(p_id uuid) returns jsonb language plpgsql security definer set search_path=public as $$
declare c gift_cards; secret text; code text; pin text;
begin select * into strict c from gift_cards where id=p_id; secret:=gift_card_secret(c); code:=upper(substr(secret,1,16)); pin:=upper(substr(secret,17,8));
 update gift_cards set credential_hash=gift_card_hash(secret),manual_hash=gift_card_hash(code||':'||pin),last4=right(code,4) where id=c.id;
 return jsonb_build_object('token',secret,'code',code,'pin',pin); end $$;
create function public.gift_card_view(c public.gift_cards) returns jsonb language sql stable security definer set search_path=public as $$
 select jsonb_build_object('id',c.id,'salonId',c.salon_id,'salonName',(select name from locations where id=c.salon_id),'balance',c.balance,'last4',c.last4,'status',c.status,'design',c.design,'generation',c.generation,'pendingTransfer',c.owner_id is null and c.controller_id is not null) $$;
create function public.gift_card_session_view(s public.gift_card_sessions, p_delivery boolean default false) returns jsonb language plpgsql security definer set search_path=public as $$
declare v jsonb; creds jsonb;
begin v:=jsonb_build_object('id',s.id,'revision',s.revision,'prompt',s.prompt,'mode',s.mode,'entry',s.entry,'status',case when s.status='open' and s.expires_at<=now() then 'expired' else s.status end,'amount',s.amount,'total',s.total,'purchase',s.purchase,'approved',s.approved,'qrVisible',s.qr_visible and s.expires_at>now() and s.status='open','mobile',s.mobile,'collected',s.collected,'expires',s.expires_at,
 'card',(select gift_card_view(c) from gift_cards c where c.id=s.card_id));
 if p_delivery and s.delivery_card is not null and not s.collected and s.expires_at>now() and exists(select 1 from gift_cards where id=s.delivery_card and owner_id is null and generation=1) then
  select jsonb_build_object('token',gift_card_secret(c),'code',upper(substr(gift_card_secret(c),1,16)),'pin',upper(substr(gift_card_secret(c),17,8))) into creds from gift_cards c where c.id=s.delivery_card;
  v:=v||jsonb_build_object('delivery',creds->>'token','deliveryCode',creds->>'code','deliveryPin',creds->>'pin'); end if; return v; end $$;
create function public.gift_card_issue(p_salon uuid,p_amount integer,p_owner uuid,p_request uuid,p_ticket uuid default null) returns uuid language plpgsql security definer set search_path=public as $$
declare c gift_cards; begin
 if p_amount is null or p_amount<100 or p_amount>100000 then raise exception 'Choose $1–$1,000'; end if;
 perform pg_advisory_xact_lock(hashtextextended('gift-issue:'||p_salon::text||p_request::text,0));
 select * into c from gift_cards where salon_id=p_salon and request_id=p_request;
 if found then if c.issued<>p_amount or c.owner_id is distinct from p_owner then raise exception 'Purchase changed'; end if; return c.id; end if;
 insert into gift_cards(salon_id,balance,issued,owner_id,request_id,design) values(p_salon,p_amount,p_amount,p_owner,p_request,coalesce((select design from gift_card_settings where salon_id=p_salon),'{}')) returning * into c;
 perform gift_card_credentials(c.id);
 insert into gift_card_ledger(card_id,salon_id,kind,delta,request_id,actor_id,ticket_id) values(c.id,p_salon,'issue',p_amount,p_request,p_owner,p_ticket); return c.id; end $$;

-- Owner settings and history; removing hides sales but preserves service of outstanding cards.
create function public.gift_card_owner(p_salon uuid,p_op text,p_args jsonb default '{}') returns jsonb language plpgsql security definer set search_path=public as $$
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
 'stats',(select jsonb_build_object('issued',coalesce(sum(issued),0),'redeemed',coalesce(sum(issued-balance),0),'outstanding',coalesce(sum(balance),0)) from gift_cards where salon_id=p_salon)); end $$;

create function public.gift_card_pos_allowed(p_salon uuid,p_key uuid,p_signature text) returns boolean language sql stable security definer set search_path=public as $$
 select coalesce(user_has_salon_permission(p_salon,array['tickets.manage']),false) or coalesce(pos_portable_access_salon_id(p_key,p_signature)=p_salon and pos_portable_access_has_capability(p_key,p_signature,'portable.pos.use'),false) $$;

-- Customer/display may suggest an amount or enter a credential; only staff settle money.
create function public.gift_card_session_command(p_id uuid,p_op text,p_args jsonb,p_staff boolean) returns jsonb language plpgsql security definer set search_path=public as $$
declare s gift_card_sessions; c gift_cards; secret text; v_amount integer; presentation gift_card_presentations; begin
 select * into s from gift_card_sessions where id=p_id for update;
 if not found then raise exception 'Session unavailable'; end if;
 if p_op='read' then return jsonb_build_object('session',gift_card_session_view(s,true)); end if;
 if s.status<>'open' or s.expires_at<=now() then raise exception 'Session expired or completed'; end if;
 if p_op='scan' and not s.qr_visible then return jsonb_build_object('session',gift_card_session_view(s,false)); end if;
 if (p_args->>'revision')::integer is distinct from s.revision then raise exception 'Session changed. Review the latest screen'; end if;
 if p_op='open' then
 update gift_card_sessions set mode=case when p_args->>'mode'='buy' then 'buy' else 'use' end,entry=case when p_args->>'entry' in ('scan','wallet') then p_args->>'entry' else 'code' end,qr_visible=p_args->>'entry'='scan',prompt=prompt+1,revision=revision+1 where id=s.id;
 elsif p_op='scan' then update gift_card_sessions set qr_visible=false,revision=revision+1 where id=s.id;
 elsif p_op='cancel' then update gift_card_sessions set card_id=null,amount=0,purchase=0,approved=false,qr_visible=false,revision=revision+1 where id=s.id;
 elsif p_op='amount' then
 v_amount:=(p_args->>'amount')::integer;
 if not s.approved or s.card_id is null or v_amount is null or v_amount<=0 or v_amount>least(s.total,(select balance from gift_cards where id=s.card_id)) then raise exception 'Choose an amount within this ticket and available balance'; end if;
 update gift_card_sessions set amount=v_amount,revision=revision+1 where id=s.id;
 elsif p_op='buy' then
 if not coalesce((select installed from gift_card_settings where salon_id=s.salon_id),false) then raise exception 'Sales are not enabled'; end if;
 v_amount:=(p_args->>'amount')::integer; if v_amount is null or v_amount<100 or v_amount>100000 then raise exception 'Choose $1–$1,000'; end if;
 update gift_card_sessions set mode='buy',purchase=v_amount,card_id=null,amount=0,approved=false,qr_visible=false,revision=revision+1 where id=s.id;
 elsif p_op='code' then
 if s.attempts>=10 then return jsonb_build_object('message','Too many attempts. Ask staff to restart after this session expires.','session',gift_card_session_view(s)); end if;
 secret:=lower(p_args->>'token');
 select * into presentation from gift_card_presentations where expires_at>now() and (session_id is null or session_id=s.id) and
 ((secret is not null and secret_hash=gift_card_hash(secret)) or manual_hash=gift_card_hash(upper(regexp_replace(p_args->>'code','[^0-9A-Fa-f]','','g'))||':'||upper(p_args->>'pin'))) for update;
 if found then select * into c from gift_cards where id=presentation.card_id and owner_id=presentation.owner_id and generation=presentation.generation and salon_id=s.salon_id and status='active'; end if;
 if c.id is null then
 select * into c from gift_cards where salon_id=s.salon_id and status='active' and owner_id is null and
 ((secret is not null and credential_hash=gift_card_hash(secret)) or manual_hash=gift_card_hash(upper(regexp_replace(p_args->>'code','[^0-9A-Fa-f]','','g'))||':'||upper(p_args->>'pin')));
 end if;
 if c.id is null or c.balance<=0 then update gift_card_sessions set attempts=attempts+1,revision=revision+1 where id=s.id returning * into s; return jsonb_build_object('message','Card unavailable. Check the code, PIN and salon.','session',gift_card_session_view(s)); end if;
 v_amount:=least(c.balance,s.total); if p_args ? 'amount' then v_amount:=least(c.balance,s.total,(p_args->>'amount')::integer); end if;
 if v_amount<=0 then raise exception 'Add services to the ticket before applying a card'; end if;
 if presentation.id is not null then update gift_card_presentations set session_id=s.id where id=presentation.id; end if;
 update gift_card_sessions set card_id=c.id,card_generation=c.generation,approved=true,approval_expires=least(s.expires_at,coalesce(presentation.expires_at,s.expires_at)),amount=v_amount,purchase=0,mode='use',qr_visible=false,revision=revision+1 where id=s.id;
 elsif p_op='wallet_request' and p_staff then
 select * into c from gift_cards where id=(p_args->>'cardId')::uuid and salon_id=s.salon_id and owner_id=(select customer_user_id from customers where id=s.customer_id and location_id=s.salon_id) and status='active';
 if not found then raise exception 'Wallet card unavailable'; end if;
 update gift_card_sessions set card_id=c.id,card_generation=c.generation,amount=least(c.balance,s.total),approved=false,entry='scan',qr_visible=true,revision=revision+1 where id=s.id;
 else raise exception 'Action not allowed'; end if;
 select * into s from gift_card_sessions where id=s.id; return jsonb_build_object('session',gift_card_session_view(s,true)); end $$;

create function public.gift_card_pos(p_salon uuid,p_op text,p_args jsonb default '{}',p_key uuid default null,p_signature text default null) returns jsonb language plpgsql security definer set search_path=public as $$
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
 if p_args->>'paymentMethod' not in ('cash','credit_card','other') then raise exception 'Confirm the collected payment method'; end if;
 if s.amount>0 then
 select * into c from gift_cards where id=s.card_id for update;
 if c.salon_id<>p_salon or c.status<>'active' or c.balance<s.amount or c.generation<>s.card_generation or not s.approved or s.approval_expires<=now() then raise exception 'Gift card needs revalidation'; end if;
 end if;
 if p_op='submit' then
 if s.receipt is null or s.total<=0 then raise exception 'Add services before Submit'; end if;
 if nullif(s.receipt->>'sourceBookingId','') is not null and p_key is null then raise exception 'Use Portable POS for appointment-linked gift card checkout'; end if;
 update gift_card_sessions set payment_method=p_args->>'paymentMethod' where id=s.id;
 perform set_config('reylumi.gift_session',s.id::text,true);
 if p_key is not null then v_result:=submit_pos_portable_receipt(p_key,p_signature,s.receipt,get_salon_business_date(p_salon));
 else v_result:=submit_owner_workspace_receipt_core(p_salon,null,s.receipt,get_salon_business_date(p_salon)); end if;
 perform set_config('reylumi.gift_session','',true);
 ticket:=(v_result->>'ticketId')::uuid; if ticket is null then raise exception 'Ticket could not be saved'; end if;
 select coalesce(sum(amount),0) into paid from pos_payments where ticket_id=ticket and salon_id=p_salon;
 if round(paid*100)<>s.total then raise exception 'Ticket amount changed. Review payment'; end if;
 -- Payment routing happened during INSERT, before the existing posted-row guards.
 if s.amount>0 then
 if (select coalesce(sum(amount),0)*100 from pos_payments where ticket_id=ticket and payment_method='gift_card')<>s.amount then raise exception 'Gift payment routing failed'; end if;
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
 update gift_card_sessions set status='completed',completed_at=now(),delivery_card=s.delivery_card,collected=buyer is not null,result=v_result,payment_method=p_args->>'paymentMethod',collected_by=current_public_user_id(),qr_visible=false,revision=revision+1 where id=s.id returning * into s;
 return v_result||jsonb_build_object('session',gift_card_session_view(s,true)); end $$;

create function public.gift_card_display(p_token text,p_op text,p_args jsonb default '{}') returns jsonb language plpgsql security definer set search_path=public as $$
declare s gift_card_sessions; salon uuid; d pos_live_drafts; begin
 select salon_id into salon from pos_live_drafts where token=p_token; if salon is null then raise exception 'Display unavailable'; end if;
 select * into s from gift_card_sessions where draft_token=p_token order by created_at desc limit 1;
 if s.id is null and coalesce((select installed from gift_card_settings where salon_id=salon),false) then
 perform pg_advisory_xact_lock(hashtextextended('gift-session:'||p_token,0));
 select * into s from gift_card_sessions where draft_token=p_token and status='open';
 if not found then select * into d from pos_live_drafts where token=p_token; insert into gift_card_sessions(salon_id,draft_token,total) values(salon,p_token,greatest(0,round(coalesce(d.total,0)*100))) returning * into s; end if;
 end if;
 if s.id is null then return jsonb_build_object('installed',false); end if;
 if p_op='read' then return jsonb_build_object('installed',coalesce((select installed from gift_card_settings where salon_id=salon),false),'session',gift_card_session_view(s,true)); end if;
 return gift_card_session_command(s.id,p_op,p_args,false); end $$;

create function public.gift_card_wallet(p_op text,p_args jsonb default '{}') returns jsonb language plpgsql security definer set search_path=public as $$
declare actor uuid:=current_public_user_id(); c gift_cards; creds jsonb; s gift_card_sessions; secret text; begin
 if actor is null then raise exception 'Sign in to your Reylumi account'; end if;
 if p_op='list' then return jsonb_build_object('cards',coalesce((select jsonb_agg(gift_card_view(x) order by created_at desc) from gift_cards x where owner_id=actor or controller_id=actor),'[]')); end if;
 if p_op='approve' then
 select * into s from gift_card_sessions where mobile=p_args->>'mobile' and status='open' and expires_at>now() for update;
 if not found then raise exception 'Checkout expired'; end if;
 select * into c from gift_cards where id=(p_args->>'cardId')::uuid and owner_id=actor and salon_id=s.salon_id and status='active' for update;
 if not found or c.balance<=0 or s.total<=0 then raise exception 'Card unavailable for this ticket'; end if;
 update gift_card_sessions set card_id=c.id,card_generation=c.generation,amount=least(c.balance,s.total),approved=true,approval_expires=least(s.expires_at,now()+interval '2 minutes'),qr_visible=false,revision=revision+1 where id=s.id returning * into s; return jsonb_build_object('session',gift_card_session_view(s));
 end if;
 if p_op='claim' then
 select * into c from gift_cards where credential_hash=gift_card_hash(p_args->>'token') and owner_id is null and status='active' for update;
 if not found then raise exception 'Gift already claimed, transferred or unavailable'; end if;
 update gift_cards set owner_id=actor,controller_id=null,generation=generation+1 where id=c.id returning * into c; perform gift_card_credentials(c.id);
 insert into gift_card_ledger(card_id,salon_id,kind,delta,request_id,actor_id) values(c.id,c.salon_id,'claim',0,gen_random_uuid(),actor);
 return jsonb_build_object('card',gift_card_view(c)); end if;
 select * into c from gift_cards where id=(p_args->>'cardId')::uuid and (owner_id=actor or controller_id=actor) for update;
 if not found or c.status<>'active' then raise exception 'Card unavailable'; end if;
 if p_op='present' and c.owner_id=actor then
 secret:=gift_card_hash(gen_random_uuid()::text||gen_random_uuid()::text);
 insert into gift_card_presentations(card_id,owner_id,generation,secret_hash,manual_hash) values(c.id,actor,c.generation,gift_card_hash(secret),gift_card_hash(upper(substr(secret,1,16))||':'||upper(substr(secret,17,8))));
 return jsonb_build_object('card',gift_card_view(c),'token',secret,'code',upper(substr(secret,1,16)),'pin',upper(substr(secret,17,8)),'message','One checkout only. Code expires in 2 minutes.'); end if;
 if p_op='transfer' then
 if not exists(select 1 from gift_card_ledger where card_id=c.id and request_id=(p_args->>'requestId')::uuid) then
 update gift_cards set owner_id=null,controller_id=actor,generation=generation+1 where id=c.id returning * into c;
 insert into gift_card_ledger(card_id,salon_id,kind,delta,request_id,actor_id) values(c.id,c.salon_id,'transfer',0,(p_args->>'requestId')::uuid,actor); end if;
 creds:=gift_card_credentials(c.id); return creds||jsonb_build_object('card',gift_card_view(c));
 elsif p_op='history' then return jsonb_build_object('card',gift_card_view(c),'ledger',coalesce((select jsonb_agg(jsonb_build_object('id',id,'kind',kind,'delta',delta,'at',created_at)) from gift_card_ledger where card_id=c.id),'[]'));
 end if; raise exception 'Unknown wallet action'; end $$;

create function public.gift_card_public(p_token text,p_op text,p_args jsonb default '{}') returns jsonb language plpgsql security definer set search_path=public as $$
declare c gift_cards; s gift_card_sessions; creds jsonb; previous_hash text; transfer gift_card_transfers; begin
 if p_op in ('mobile','scan','code','open','buy') then
 select * into s from gift_card_sessions where mobile=p_token; if not found or s.expires_at<=now() then raise exception 'Checkout expired'; end if;
 if p_op='mobile' then return jsonb_build_object('session',gift_card_session_view(s,false)); end if;
 return gift_card_session_command(s.id,p_op,p_args,false); end if;
 if p_op='transfer' then
 if nullif(p_args->>'requestId','') is null then raise exception 'Transfer request identity required'; end if;
 perform pg_advisory_xact_lock(hashtextextended('gift-transfer:'||(p_args->>'requestId'),0));
 select * into transfer from gift_card_transfers where request_id=(p_args->>'requestId')::uuid;
 if found then
 if transfer.previous_hash<>gift_card_hash(p_token) then raise exception 'Transfer identity mismatch'; end if;
 select * into c from gift_cards where id=transfer.card_id and generation=transfer.generation and owner_id is null and status='active' for update;
 if not found then raise exception 'This transfer was already claimed or replaced'; end if;
 return gift_card_credentials(c.id)||jsonb_build_object('card',gift_card_view(c)); end if;
 end if;
 select * into c from gift_cards where credential_hash=gift_card_hash(p_token) for update;
 if not found or c.status<>'active' then raise exception 'Card link expired, transferred or unavailable'; end if;
 if p_op='read' then return jsonb_build_object('card',gift_card_view(c));
 elsif p_op='receive' then update gift_card_sessions set collected=true where delivery_card=c.id; return jsonb_build_object('card',gift_card_view(c),'token',p_token,'code',upper(substr(p_token,1,16)),'pin',upper(substr(p_token,17,8)));
 elsif p_op='transfer' and c.owner_id is null then
 previous_hash:=c.credential_hash;
 update gift_cards set generation=generation+1,controller_id=null where id=c.id returning * into c; creds:=gift_card_credentials(c.id);
 insert into gift_card_transfers(request_id,card_id,previous_hash,generation) values((p_args->>'requestId')::uuid,c.id,previous_hash,c.generation);
 insert into gift_card_ledger(card_id,salon_id,kind,delta,request_id) values(c.id,c.salon_id,'transfer',0,(p_args->>'requestId')::uuid);
 return creds||jsonb_build_object('card',gift_card_view(c)); end if; raise exception 'Open this card in your wallet'; end $$;

-- Internal helpers and financial tables never callable by anonymous/authenticated directly.
revoke all on function public.gift_card_credentials(uuid),public.gift_card_secret(public.gift_cards),public.gift_card_view(public.gift_cards),public.gift_card_session_view(public.gift_card_sessions,boolean),public.gift_card_issue(uuid,integer,uuid,uuid,uuid),public.gift_card_session_command(uuid,text,jsonb,boolean) from public,anon,authenticated;
revoke all on function public.gift_card_owner(uuid,text,jsonb),public.gift_card_pos(uuid,text,jsonb,uuid,text),public.gift_card_display(text,text,jsonb),public.gift_card_wallet(text,jsonb),public.gift_card_public(text,text,jsonb) from public;
grant execute on function public.gift_card_owner(uuid,text,jsonb),public.gift_card_wallet(text,jsonb) to authenticated;
grant execute on function public.gift_card_pos(uuid,text,jsonb,uuid,text),public.gift_card_display(text,text,jsonb),public.gift_card_public(text,text,jsonb) to anon,authenticated;
grant all on public.gift_card_settings,public.gift_cards,public.gift_card_ledger,public.gift_card_sessions,public.gift_card_online_orders to service_role;
create function public.gift_card_route_payment() returns trigger language plpgsql security definer set search_path=public as $$
declare sid uuid:=nullif(current_setting('reylumi.gift_session',true),'')::uuid;s gift_card_sessions;
begin
 if sid is null or new.note like 'Gift card split payment%' then return new; end if;
 select * into s from gift_card_sessions where id=sid and status='open' for update;
 if not found or s.salon_id<>new.salon_id or round(new.amount*100)<>s.total then raise exception 'Gift payment identity mismatch'; end if;
 if s.amount>0 then
 if not s.approved then raise exception 'Gift card approval required'; end if;
 new.payment_method:='gift_card';new.amount:=s.amount/100.0;new.note:='Gift card session '||s.id::text;
 else new.payment_method:=s.payment_method; end if;
 return new;end $$;
create function public.gift_card_route_remainder() returns trigger language plpgsql security definer set search_path=public as $$
declare sid uuid:=nullif(current_setting('reylumi.gift_session',true),'')::uuid;s gift_card_sessions;
begin
 if sid is null or new.note is distinct from 'Gift card session '||sid::text then return new; end if;
 select * into s from gift_card_sessions where id=sid;
 if s.total>s.amount then insert into pos_payments(salon_id,ticket_id,payment_method,amount,note) values(s.salon_id,new.ticket_id,s.payment_method,(s.total-s.amount)/100.0,'Gift card split payment '||s.id::text); end if;
 return new;end $$;
revoke all on function public.gift_card_route_payment(),public.gift_card_route_remainder() from public,anon,authenticated;
create trigger gift_card_route_payment before insert on public.pos_payments for each row execute function public.gift_card_route_payment();
create trigger gift_card_route_remainder after insert on public.pos_payments for each row execute function public.gift_card_route_remainder();
commit;
