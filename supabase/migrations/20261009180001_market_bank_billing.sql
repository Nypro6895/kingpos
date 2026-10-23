begin;

-- Bank checkout is deliberately independent of Stripe's subscription contract.
-- All money is integer USD cents; orders preserve the exact terms shown to the buyer.
create table public.market_bank_accounts (
 id uuid primary key default gen_random_uuid(),
 label text not null check (length(btrim(label)) between 1 and 120),
 bank_name text not null check (length(btrim(bank_name)) between 1 and 160),
 beneficiary text not null check (length(btrim(beneficiary)) between 1 and 160),
 account_number text not null check (length(btrim(account_number)) between 3 and 100),
 routing text not null default '' check (length(routing)<=100),
 instructions text not null default '' check (length(instructions)<=2000),
 active boolean not null default true,
 version integer not null default 1 check (version>0),
 created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table public.market_billing_settings (
 id boolean primary key default true check(id),
 enabled boolean not null default false,
 default_bank_account_id uuid references public.market_bank_accounts(id),
 order_expiry_hours integer not null default 48 check (order_expiry_hours between 1 and 720),
 tax_bps integer not null default 0 check (tax_bps between 0 and 10000),
 fee_bps integer not null default 0 check (fee_bps between 0 and 10000),
 fixed_fee_cents integer not null default 0 check (fixed_fee_cents between 0 and 100000000),
 tax_label text not null default 'Tax' check(length(btrim(tax_label)) between 1 and 80),
 currency text not null default 'USD' check(currency='USD'),
 version integer not null default 1 check(version>0), updated_at timestamptz not null default now()
);
create table public.market_billing_catalog (
 plugin_id text primary key check(plugin_id ~ '^[a-z][a-z0-9-]{1,79}$'),
 name text not null check(length(btrim(name)) between 1 and 160),
 publisher text not null default 'Reylumi' check(length(btrim(publisher)) between 1 and 160),
 price_cents integer not null check(price_cents between 1 and 100000000),
 interval text not null default 'month' check(interval='month'),
 published boolean not null default true,
 fulfillment_ready boolean not null default false,
 commission_bps integer not null default 0 check(commission_bps between 0 and 10000),
 version integer not null default 1 check(version>0), updated_at timestamptz not null default now(),
 check(not fulfillment_ready or plugin_id in ('vietnamese-language','booking-policy','booking-deposit','checkin-receipt'))
);
insert into public.market_billing_settings(id,tax_bps,fee_bps,fixed_fee_cents)
 select true,tax_bps,fee_bps,fixed_fee_cents from public.market_commerce_configuration where id;
insert into public.market_billing_settings(id) values(true) on conflict do nothing;
insert into public.market_billing_catalog(plugin_id,name,price_cents,fulfillment_ready) values
 ('vietnamese-language','Tiếng Việt',399,true),('booking-policy','Booking Policy',99,true),
 ('booking-deposit','Booking Deposit',590,true),('checkin-receipt','Check-in Receipt',470,true);
update public.market_billing_catalog set published=(select vietnamese_published from public.market_payment_settings where id)
 where plugin_id='vietnamese-language';
update public.market_billing_catalog c set price_cents=(d.plugin_prices->>c.plugin_id)::integer
 from public.market_commerce_configuration d where d.id and d.plugin_prices->>c.plugin_id ~ '^[0-9]{1,8}$'
 and (d.plugin_prices->>c.plugin_id)::bigint between 1 and 100000000;
-- Import usable draft banking instructions without activating checkout.
insert into public.market_bank_accounts(label,bank_name,beneficiary,account_number,routing,instructions)
 select 'Primary receiving account',btrim(bank_name),btrim(bank_beneficiary),btrim(bank_account),bank_routing,bank_instructions
 from public.market_commerce_configuration where id and length(btrim(bank_name))>0
 and length(btrim(bank_beneficiary))>0 and length(btrim(bank_account))>=3;
update public.market_billing_settings set default_bank_account_id=(select id from public.market_bank_accounts order by created_at,id limit 1);

create table public.market_bank_orders (
 id uuid primary key default gen_random_uuid(), reference text not null unique,
 salon_id uuid not null references public.locations(id), payer_id uuid not null references public.users(id),
 plugin_id text not null references public.market_billing_catalog(plugin_id),
 plugin_name text not null, publisher text not null, bank_account_id uuid not null references public.market_bank_accounts(id),
 snapshot jsonb not null check(jsonb_typeof(snapshot)='object'),
 base_cents integer not null check(base_cents>0), tax_cents integer not null check(tax_cents>=0),
 fee_cents integer not null check(fee_cents>=0), total_cents integer not null check(total_cents=base_cents+tax_cents+fee_cents),
 currency text not null default 'USD' check(currency='USD'),
 status text not null default 'awaiting_payment' check(status in ('awaiting_payment','partially_paid','paid','cancelled','expired','refund_pending','partially_refunded','refunded')),
 expiry_reason text check(expiry_reason in ('timeout','subscription_conflict')),
 received_cents integer not null default 0 check(received_cents between 0 and total_cents),
 unapplied_cents bigint not null default 0 check(unapplied_cents>=0),
 refunded_cents bigint not null default 0 check(refunded_cents>=0),
 refunded_applied_cents integer not null default 0 check(refunded_applied_cents between 0 and received_cents),
 request_key uuid not null, created_at timestamptz not null default now(), expires_at timestamptz not null,
 paid_at timestamptz, service_start timestamptz, service_end timestamptz,
 entitlement_previous_until timestamptz, unique(salon_id,payer_id,request_key),
 check(expires_at>created_at), check((service_start is null and service_end is null) or service_end>service_start)
);
create index market_bank_orders_salon_created on public.market_bank_orders(salon_id,created_at desc);
create index market_bank_orders_open on public.market_bank_orders(salon_id,plugin_id) where status in ('awaiting_payment','partially_paid');
create table public.market_bank_receipts (
 id uuid primary key default gen_random_uuid(), bank_account_id uuid not null references public.market_bank_accounts(id),
 bank_reference text not null check(length(btrim(bank_reference)) between 1 and 160),
 amount_cents integer not null check(amount_cents between 1 and 100000000),
 applied_cents integer not null check(applied_cents between 0 and amount_cents),
 unapplied_cents integer not null check(unapplied_cents=amount_cents-applied_cents),
 received_at timestamptz not null, note text not null default '' check(length(note)<=2000),
 order_id uuid not null references public.market_bank_orders(id), actor_id uuid not null references public.users(id),
 created_at timestamptz not null default now(), unique(bank_account_id,bank_reference)
);
create table public.market_bank_refunds (
 id uuid primary key default gen_random_uuid(), order_id uuid not null references public.market_bank_orders(id),
 bank_account_id uuid not null references public.market_bank_accounts(id), amount_cents integer not null check(amount_cents>0),
 applied_cents integer not null check(applied_cents between 0 and amount_cents),
 unapplied_cents integer not null check(unapplied_cents=amount_cents-applied_cents),
 reason text not null check(length(btrim(reason)) between 3 and 2000),
 status text not null default 'pending' check(status in ('pending','completed','cancelled')),
 order_status_before text not null,
 bank_reference text check(bank_reference is null or length(btrim(bank_reference)) between 1 and 160),
 note text not null default '' check(length(note)<=2000), actor_id uuid not null references public.users(id),
 completed_by uuid references public.users(id), created_at timestamptz not null default now(), completed_at timestamptz,
 cancelled_at timestamptz, cancelled_by uuid references public.users(id),
 unique(bank_account_id,bank_reference), check((status='pending' and completed_at is null and bank_reference is null and cancelled_at is null)
 or (status='completed' and completed_at is not null and bank_reference is not null and cancelled_at is null)
 or (status='cancelled' and completed_at is null and bank_reference is null and cancelled_at is not null))
);
create unique index market_bank_inbound_reference_unique on public.market_bank_receipts(bank_account_id,lower(btrim(bank_reference)));
create table public.market_bank_ledger (
 id uuid primary key default gen_random_uuid(), order_id uuid references public.market_bank_orders(id),
 receipt_id uuid unique references public.market_bank_receipts(id), refund_id uuid unique references public.market_bank_refunds(id),
 bank_account_id uuid not null references public.market_bank_accounts(id), bank_reference text not null,
 kind text not null check(kind in ('cash_in','cash_out','expense')),
 amount_cents integer not null check(amount_cents>0), revenue_cents integer not null default 0,
 tax_cents integer not null default 0, fee_cents integer not null default 0,
 commission_cents integer not null default 0, publisher_payable_cents integer not null default 0,
 unapplied_cents integer not null default 0, expense_cents integer not null default 0,
 currency text not null default 'USD' check(currency='USD'), note text not null default '' check(length(note)<=2000),
 actor_id uuid not null references public.users(id), occurred_at timestamptz not null, created_at timestamptz not null default now(),
 check((kind='cash_in' and receipt_id is not null and refund_id is null and order_id is not null)
 or (kind='cash_out' and refund_id is not null and receipt_id is null and order_id is not null)
 or (kind='expense' and receipt_id is null and refund_id is null and order_id is null and expense_cents=amount_cents))
);
create unique index market_bank_outbound_reference_unique on public.market_bank_ledger(bank_account_id,lower(btrim(bank_reference))) where kind in ('cash_out','expense');
create index market_bank_ledger_created on public.market_bank_ledger(created_at desc,id);

create function public.market_billing_is_admin() returns boolean language sql stable security definer set search_path=public as $$
 select coalesce(public.platform_admin_has_permission('admin.team.manage'),false) and exists(
 select 1 from public.platform_admin_current_actor() a join public.users u on u.id=a.actor_user_id
 where a.actor_role_slug='platform_owner' and u.status='active')
$$;
create function public.market_billing_require_admin() returns uuid language plpgsql stable security definer set search_path=public as $$
declare actor uuid;
begin
 perform public.platform_admin_require_permission('admin.team.manage');
 if not public.market_billing_is_admin() then raise exception using errcode='42501',message='Active platform owner access required.'; end if;
 actor:=public.current_public_user_id(); return actor;
end $$;
create function public.market_billing_require_owner(p_salon uuid) returns uuid language plpgsql stable security definer set search_path=public as $$
declare actor uuid:=public.current_public_user_id();
begin
 if actor is null or not coalesce(public.lifecycle_user_is_salon_owner(p_salon,actor,false),false)
 or not exists(select 1 from public.users where id=actor and status='active')
 or not exists(select 1 from public.locations where id=p_salon and status='active') then
 raise exception using errcode='42501',message='Active salon owner access required.'; end if;
 return actor;
end $$;
create function public.market_billing_can_read_salon(p_salon uuid) returns boolean language sql stable security definer set search_path=public as $$
 select exists(select 1 from public.users where id=public.current_public_user_id() and status='active')
 and coalesce(public.lifecycle_user_is_salon_owner(p_salon,public.current_public_user_id(),false),false)
$$;
create function public.market_billing_audit(p_actor uuid,p_action text,p_target uuid,p_metadata jsonb) returns void
language plpgsql security definer set search_path=public as $$
begin
 insert into public.platform_admin_audit_logs(actor_user_id,action,target_type,target_id,metadata)
 values(p_actor,p_action,'market_billing',p_target,p_metadata);
end $$;
create function public.market_bank_immutable() returns trigger language plpgsql set search_path=public as $$
begin raise exception 'Bank receipts and the cash ledger are append-only.'; end $$;
create trigger market_bank_receipts_immutable before update or delete on public.market_bank_receipts for each row execute function public.market_bank_immutable();
create trigger market_bank_ledger_immutable before update or delete on public.market_bank_ledger for each row execute function public.market_bank_immutable();

alter table public.market_billing_settings enable row level security;
alter table public.market_bank_accounts enable row level security;
alter table public.market_billing_catalog enable row level security;
alter table public.market_bank_orders enable row level security;
alter table public.market_bank_receipts enable row level security;
alter table public.market_bank_refunds enable row level security;
alter table public.market_bank_ledger enable row level security;
revoke all on public.market_billing_settings,public.market_bank_accounts,public.market_billing_catalog,
 public.market_bank_orders,public.market_bank_receipts,public.market_bank_refunds,public.market_bank_ledger from public,anon,authenticated;
grant select on public.market_billing_settings,public.market_bank_accounts,public.market_billing_catalog,
 public.market_bank_orders,public.market_bank_receipts,public.market_bank_refunds,public.market_bank_ledger to service_role;
grant select on public.market_bank_orders,public.market_bank_receipts,public.market_bank_refunds to authenticated;
create policy market_bank_orders_read on public.market_bank_orders for select to authenticated using(
 public.market_billing_is_admin() or public.market_billing_can_read_salon(salon_id));
create policy market_bank_receipts_read on public.market_bank_receipts for select to authenticated using(
 public.market_billing_is_admin() or exists(select 1 from public.market_bank_orders o where o.id=order_id and public.market_billing_can_read_salon(o.salon_id)));
create policy market_bank_refunds_read on public.market_bank_refunds for select to authenticated using(
 public.market_billing_is_admin() or exists(select 1 from public.market_bank_orders o where o.id=order_id and public.market_billing_can_read_salon(o.salon_id)));

-- Month-end arithmetic is performed in UTC, independent of the database session timezone.
create function public.market_billing_month_end(p_start timestamptz) returns timestamptz language sql immutable set search_path=public as $$
 select ((p_start at time zone 'UTC')+interval '1 month') at time zone 'UTC'
$$;
create function public.market_billing_order_json(p_order public.market_bank_orders) returns jsonb language sql stable set search_path=public as $$
 select (to_jsonb(p_order)-'entitlement_previous_until')||jsonb_build_object('status',case
 when p_order.status in ('awaiting_payment','partially_paid') and p_order.expires_at<=now() then 'expired' else p_order.status end)
$$;
create function public.market_billing_public_catalog() returns jsonb language sql stable security definer set search_path=public as $$
 select jsonb_build_object('settings',jsonb_build_object('enabled',s.enabled,'ready',s.enabled and exists(select 1 from market_bank_accounts b where b.id=s.default_bank_account_id and b.active),
 'currency',s.currency,'order_expiry_hours',s.order_expiry_hours,'tax_bps',s.tax_bps,'fee_bps',s.fee_bps,'fixed_fee_cents',s.fixed_fee_cents,'tax_label',s.tax_label,'version',s.version),
 'catalog',coalesce((select jsonb_agg(to_jsonb(c)-'commission_bps' order by c.plugin_id) from market_billing_catalog c where c.published),'[]'::jsonb),
 'hidden_plugin_ids',coalesce((select jsonb_agg(c.plugin_id order by c.plugin_id) from market_billing_catalog c where not c.published),'[]'::jsonb)) from market_billing_settings s where s.id
$$;
create function public.market_billing_owner_state(p_salon uuid) returns jsonb language plpgsql stable security definer set search_path=public as $$
declare result jsonb;
begin
 perform public.market_billing_require_owner(p_salon);
 result:=public.market_billing_public_catalog();
 return result||jsonb_build_object('orders',coalesce((select jsonb_agg(public.market_billing_order_json(o) order by o.created_at desc,o.id) from market_bank_orders o where o.salon_id=p_salon),'[]'::jsonb));
end $$;
create function public.market_billing_admin_state() returns jsonb language plpgsql stable security definer set search_path=public as $$
begin
 perform public.market_billing_require_admin();
 return jsonb_build_object('settings',(select to_jsonb(s) from market_billing_settings s where s.id),
 'bank_accounts',coalesce((select jsonb_agg(to_jsonb(b) order by b.created_at,b.id) from market_bank_accounts b),'[]'::jsonb),
 'catalog',coalesce((select jsonb_agg(to_jsonb(c) order by c.plugin_id) from market_billing_catalog c),'[]'::jsonb),
 'orders',coalesce((select jsonb_agg(public.market_billing_order_json(o)||jsonb_build_object('salon_name',l.name,
 'payer_name',coalesce(nullif(btrim(u.display_name),''),nullif(btrim(concat_ws(' ',u.first_name,u.last_name)),''),'Customer'))
 order by o.created_at desc,o.id) from market_bank_orders o join locations l on l.id=o.salon_id join users u on u.id=o.payer_id),'[]'::jsonb),
 'receipts',coalesce((select jsonb_agg(to_jsonb(r) order by r.created_at desc,r.id) from market_bank_receipts r),'[]'::jsonb),
 'refunds',coalesce((select jsonb_agg(to_jsonb(r) order by r.created_at desc,r.id) from market_bank_refunds r),'[]'::jsonb),
 'ledger',coalesce((select jsonb_agg(to_jsonb(l) order by l.created_at desc,l.id) from market_bank_ledger l),'[]'::jsonb),
 'summary',jsonb_build_object(
 'cash_in_cents',coalesce((select sum(amount_cents) from market_bank_ledger where kind='cash_in'),0),
 'cash_out_cents',coalesce((select sum(amount_cents) from market_bank_ledger where kind='cash_out'),0),
 'expense_cents',coalesce((select sum(amount_cents) from market_bank_ledger where kind='expense'),0),
 'net_cash_cents',coalesce((select sum(case when kind='cash_in' then amount_cents::bigint else -amount_cents::bigint end) from market_bank_ledger),0),
 'revenue_cents',coalesce((select sum(revenue_cents) from market_bank_ledger),0),
 'tax_cents',coalesce((select sum(tax_cents) from market_bank_ledger),0),
 'fee_cents',coalesce((select sum(fee_cents) from market_bank_ledger),0),
 'commission_cents',coalesce((select sum(commission_cents) from market_bank_ledger),0),
 'publisher_payable_cents',coalesce((select sum(publisher_payable_cents) from market_bank_ledger),0),
 'unapplied_cents',coalesce((select sum(unapplied_cents) from market_bank_orders),0),
 'customer_deposit_cents',coalesce((select sum(received_cents-refunded_applied_cents) from market_bank_orders where paid_at is null),0),
 'total_liability_cents',coalesce((select sum(unapplied_cents+case when paid_at is null then received_cents-refunded_applied_cents else 0 end) from market_bank_orders),0),
 'pending_refund_cents',coalesce((select sum(amount_cents) from market_bank_refunds where status='pending'),0),
 'awaiting_payment_count',(select count(*) from market_bank_orders where status in ('awaiting_payment','partially_paid') and expires_at>now()),
 'paid_order_count',(select count(*) from market_bank_orders where paid_at is not null)));
end $$;
create function public.market_billing_export_ledger(p_from timestamptz default null,p_to timestamptz default null) returns jsonb language plpgsql stable security definer set search_path=public as $$
begin
 perform public.market_billing_require_admin();
 if p_from is not null and p_to is not null and p_to<=p_from then raise exception using errcode='22023',message='The export end time must be after its start time.'; end if;
 -- No silent truncation: exports cover every ledger entry in the requested period.
 return jsonb_build_object('from',p_from,'to',p_to,
 'row_count',(select count(*) from market_bank_ledger l where (p_from is null or l.occurred_at>=p_from) and (p_to is null or l.occurred_at<p_to)),
 'ledger',coalesce((select jsonb_agg(to_jsonb(l)||jsonb_build_object('order_reference',o.reference,'plugin_id',o.plugin_id,'plugin_name',o.plugin_name,'publisher',o.publisher,'salon_id',o.salon_id,'salon_name',s.name) order by l.occurred_at,l.id)
 from market_bank_ledger l left join market_bank_orders o on o.id=l.order_id left join locations s on s.id=o.salon_id where (p_from is null or l.occurred_at>=p_from) and (p_to is null or l.occurred_at<p_to)),'[]'::jsonb));
end $$;

create function public.market_billing_save_settings(p_version integer,p_settings jsonb) returns jsonb language plpgsql security definer set search_path=public as $$
declare actor uuid:=public.market_billing_require_admin(); s public.market_billing_settings; next_bank uuid; next_enabled boolean;
begin
 if p_settings is null or jsonb_typeof(p_settings)<>'object' then raise exception using errcode='22023',message='Enter billing settings.'; end if;
 select * into s from market_billing_settings where id for update;
 if p_version is distinct from s.version then raise exception using errcode='40001',message='Billing settings changed. Refresh and try again.'; end if;
 next_bank:=case when p_settings ? 'default_bank_account_id' then nullif(p_settings->>'default_bank_account_id','')::uuid else s.default_bank_account_id end;
 next_enabled:=coalesce((p_settings->>'enabled')::boolean,s.enabled);
 if next_enabled and not exists(select 1 from market_bank_accounts where id=next_bank and active) then raise exception using errcode='22023',message='Choose an active receiving bank account before enabling payments.'; end if;
 update market_billing_settings set enabled=next_enabled,default_bank_account_id=next_bank,
 order_expiry_hours=coalesce((p_settings->>'order_expiry_hours')::integer,s.order_expiry_hours),
 tax_bps=coalesce((p_settings->>'tax_bps')::integer,s.tax_bps),fee_bps=coalesce((p_settings->>'fee_bps')::integer,s.fee_bps),
 fixed_fee_cents=coalesce((p_settings->>'fixed_fee_cents')::integer,s.fixed_fee_cents),tax_label=coalesce(btrim(p_settings->>'tax_label'),s.tax_label),version=version+1,updated_at=now() where id returning * into s;
 perform market_billing_audit(actor,'market.billing.settings.update',null,jsonb_build_object('version',s.version,'enabled',s.enabled,'bank_id',s.default_bank_account_id,'tax_bps',s.tax_bps,'fee_bps',s.fee_bps,'fixed_fee_cents',s.fixed_fee_cents));
 return to_jsonb(s);
end $$;
create function public.market_billing_save_bank(p_bank jsonb,p_version integer default null) returns jsonb language plpgsql security definer set search_path=public as $$
declare actor uuid:=public.market_billing_require_admin(); b public.market_bank_accounts; bank_id uuid;
begin
 if p_bank is null or jsonb_typeof(p_bank)<>'object' then raise exception using errcode='22023',message='Enter receiving bank details.'; end if;
 bank_id:=nullif(p_bank->>'id','')::uuid;
 -- Settings first is also the lock order used by checkout: no bank may be disabled during activation.
 perform 1 from market_billing_settings where id for update;
 if bank_id is null then
 if p_version is not null then raise exception using errcode='40001',message='Create a bank account without a previous version.'; end if;
 insert into market_bank_accounts(label,bank_name,beneficiary,account_number,routing,instructions,active)
 values(btrim(p_bank->>'label'),btrim(p_bank->>'bank_name'),btrim(p_bank->>'beneficiary'),btrim(p_bank->>'account_number'),coalesce(btrim(p_bank->>'routing'),''),coalesce(btrim(p_bank->>'instructions'),''),coalesce((p_bank->>'active')::boolean,true)) returning * into b;
 else
 select * into b from market_bank_accounts where id=bank_id for update;
 if not found then raise exception using errcode='22023',message='Receiving bank account not found.'; end if;
 if p_version is distinct from b.version then raise exception using errcode='40001',message='Bank account changed. Refresh and try again.'; end if;
 if p_bank->>'active'='false' and exists(select 1 from market_billing_settings where id and enabled and default_bank_account_id=bank_id) then raise exception using errcode='22023',message='Select another receiving account or pause bank checkout before disabling this account.'; end if;
 update market_bank_accounts set label=coalesce(btrim(p_bank->>'label'),b.label),bank_name=coalesce(btrim(p_bank->>'bank_name'),b.bank_name),
 beneficiary=coalesce(btrim(p_bank->>'beneficiary'),b.beneficiary),account_number=coalesce(btrim(p_bank->>'account_number'),b.account_number),routing=coalesce(btrim(p_bank->>'routing'),b.routing),
 instructions=coalesce(btrim(p_bank->>'instructions'),b.instructions),active=coalesce((p_bank->>'active')::boolean,b.active),version=version+1,updated_at=now() where id=bank_id returning * into b;
 end if;
 perform market_billing_audit(actor,'market.billing.bank.save',b.id,jsonb_build_object('bank_id',b.id,'active',b.active,'version',b.version));
 return to_jsonb(b);
end $$;
create function public.market_billing_save_catalog(p_plugin text,p_version integer,p_values jsonb) returns jsonb language plpgsql security definer set search_path=public as $$
declare actor uuid:=public.market_billing_require_admin(); c public.market_billing_catalog;
begin
 if p_plugin is null or p_plugin !~ '^[a-z][a-z0-9-]{1,79}$' or p_values is null or jsonb_typeof(p_values)<>'object' then raise exception using errcode='22023',message='Enter a valid plugin and pricing configuration.'; end if;
 if p_plugin in ('payroll-data-download','campaigns','service-relay') then raise exception using errcode='22023',message='This native plugin uses free access or separate billing and cannot be added to the monthly billing catalog.'; end if;
 perform pg_advisory_xact_lock(hashtextextended('market.catalog:'||p_plugin,0));
 select * into c from market_billing_catalog where plugin_id=p_plugin for update;
 if not found then
 if p_version is not null then raise exception using errcode='40001',message='Plugin pricing changed. Refresh and try again.'; end if;
 insert into market_billing_catalog(plugin_id,name,publisher,price_cents,published,fulfillment_ready,commission_bps)
 values(p_plugin,btrim(p_values->>'name'),coalesce(btrim(p_values->>'publisher'),'Reylumi'),(p_values->>'price_cents')::integer,coalesce((p_values->>'published')::boolean,true),false,coalesce((p_values->>'commission_bps')::integer,0)) returning * into c;
 else
 if p_version is distinct from c.version then raise exception using errcode='40001',message='Plugin pricing changed. Refresh and try again.'; end if;
 update market_billing_catalog set name=coalesce(btrim(p_values->>'name'),c.name),publisher=coalesce(btrim(p_values->>'publisher'),c.publisher),
 price_cents=coalesce((p_values->>'price_cents')::integer,c.price_cents),published=coalesce((p_values->>'published')::boolean,c.published),
 fulfillment_ready=case when p_plugin in ('vietnamese-language','booking-policy','booking-deposit','checkin-receipt') then coalesce((p_values->>'fulfillment_ready')::boolean,c.fulfillment_ready) else false end,
 commission_bps=coalesce((p_values->>'commission_bps')::integer,c.commission_bps),version=version+1,updated_at=now() where plugin_id=p_plugin returning * into c;
 end if;
 perform market_billing_audit(actor,'market.billing.catalog.save',null,jsonb_build_object('plugin_id',c.plugin_id,'version',c.version,'price_cents',c.price_cents,'published',c.published,'fulfillment_ready',c.fulfillment_ready,'commission_bps',c.commission_bps));
 return to_jsonb(c);
end $$;

create function public.market_billing_create_order(p_salon uuid,p_plugin text,p_request uuid) returns jsonb language plpgsql security definer set search_path=public as $$
declare actor uuid:=public.market_billing_require_owner(p_salon); s public.market_billing_settings; b public.market_bank_accounts; c public.market_billing_catalog;
 o public.market_bank_orders; sub_paid timestamptz; stripe_sub text; current_checkout text; tax integer; fee integer; new_id uuid;
begin
 if p_request is null or p_plugin is null then raise exception using errcode='22023',message='Choose a plugin and a checkout reference.'; end if;
 perform pg_advisory_xact_lock(hashtextextended('market.order:'||p_salon::text||':'||p_plugin,0));
 select * into o from market_bank_orders where salon_id=p_salon and payer_id=actor and request_key=p_request;
 if found then
 if o.plugin_id<>p_plugin then raise exception using errcode='22023',message='This checkout reference belongs to another plugin.'; end if;
 return market_billing_order_json(o); end if;
 select * into s from market_billing_settings where id for share;
 select * into b from market_bank_accounts where id=s.default_bank_account_id and active for share;
 if not s.enabled or b.id is null then raise exception using errcode='22023',message='Bank payment checkout is not available. Please contact support.'; end if;
 select * into c from market_billing_catalog where plugin_id=p_plugin and published and fulfillment_ready for share;
 if c.plugin_id is null then raise exception using errcode='22023',message='This plugin is not available for bank checkout yet.'; end if;
 if p_plugin='vietnamese-language' then
 select paid_until,stripe_subscription,checkout_session into sub_paid,stripe_sub,current_checkout from vietnamese_plugin_subscriptions where salon_id=p_salon for update;
 if not found or not exists(select 1 from vietnamese_plugin_subscriptions where salon_id=p_salon and installed and trial_ends_at<=now()) then raise exception using errcode='22023',message='Install Tiếng Việt and finish its free trial before buying.'; end if;
 elsif p_plugin='booking-policy' then
 select paid_until,stripe_subscription,stripe_checkout into sub_paid,stripe_sub,current_checkout from booking_policy_subscriptions where salon_id=p_salon for update;
 elsif p_plugin='booking-deposit' then
 select paid_until,stripe_subscription,stripe_checkout into sub_paid,stripe_sub,current_checkout from booking_deposit_subscriptions where salon_id=p_salon for update;
 elsif p_plugin='checkin-receipt' then
 select paid_until,stripe_subscription,stripe_checkout into sub_paid,stripe_sub,current_checkout from checkin_receipt_subscriptions where salon_id=p_salon for update;
 end if;
 if stripe_sub is not null or current_checkout is not null then raise exception using errcode='22023',message='An existing card subscription or checkout must be resolved before bank checkout.'; end if;
 if sub_paid>now() then raise exception using errcode='22023',message='This plugin already has a paid service period. Renew after it expires.'; end if;
 for o in select * from market_bank_orders where salon_id=p_salon and plugin_id=p_plugin and status in ('awaiting_payment','partially_paid') for update loop
 if o.expires_at>now() then return market_billing_order_json(o); end if;
 update market_bank_orders set status='expired',expiry_reason='timeout' where id=o.id;
 perform market_billing_audit(actor,'market.billing.order.expire',o.id,jsonb_build_object('received_cents',o.received_cents));
 end loop;
 tax:=round(c.price_cents::numeric*s.tax_bps/10000)::integer;
 -- Transaction rate applies to plugin price plus tax; fixed fee is added once per order.
 fee:=(round((c.price_cents::numeric+tax)*s.fee_bps/10000)+s.fixed_fee_cents)::integer;
 new_id:=gen_random_uuid();
 insert into market_bank_orders(id,reference,salon_id,payer_id,plugin_id,plugin_name,publisher,bank_account_id,snapshot,base_cents,tax_cents,fee_cents,total_cents,request_key,expires_at)
 values(new_id,'RYL-'||upper(replace(new_id::text,'-','')),p_salon,actor,c.plugin_id,c.name,c.publisher,b.id,
 jsonb_build_object('price_cents',c.price_cents,'tax_bps',s.tax_bps,'fee_bps',s.fee_bps,'fixed_fee_cents',s.fixed_fee_cents,'tax_label',s.tax_label,
 'currency','USD','interval',c.interval,'commission_bps',c.commission_bps,'settings_version',s.version,'catalog_version',c.version,
 'bank',to_jsonb(b)-'active'-'created_at'-'updated_at'),c.price_cents,tax,fee,c.price_cents+tax+fee,p_request,now()+make_interval(hours=>s.order_expiry_hours)) returning * into o;
 perform market_billing_audit(actor,'market.billing.order.create',o.id,jsonb_build_object('plugin_id',o.plugin_id,'salon_id',o.salon_id,'total_cents',o.total_cents,'settings_version',s.version,'catalog_version',c.version,'bank_id',b.id));
 return market_billing_order_json(o);
end $$;
create function public.market_billing_cancel_order(p_order uuid) returns jsonb language plpgsql security definer set search_path=public as $$
declare o public.market_bank_orders; actor uuid:=public.current_public_user_id();
begin
 select * into o from market_bank_orders where id=p_order;
 if o.id is null then raise exception using errcode='22023',message='Order not found.'; end if;
 if not market_billing_is_admin() then perform market_billing_require_owner(o.salon_id); else actor:=market_billing_require_admin(); end if;
 perform pg_advisory_xact_lock(hashtextextended('market.order:'||o.salon_id::text||':'||o.plugin_id,0));
 select * into o from market_bank_orders where id=p_order for update;
 if o.status in ('cancelled','expired') then return market_billing_order_json(o); end if;
 if o.status not in ('awaiting_payment','partially_paid') then raise exception using errcode='22023',message='A paid order requires the refund workflow.'; end if;
 if o.received_cents>0 or o.unapplied_cents>0 then raise exception using errcode='22023',message='This order has received money. Ask an administrator to refund it before cancellation.'; end if;
 update market_bank_orders set status=case when expires_at<=now() then 'expired' else 'cancelled' end,
 expiry_reason=case when expires_at<=now() then 'timeout' else null end where id=o.id returning * into o;
 perform market_billing_audit(actor,'market.billing.order.cancel',o.id,jsonb_build_object('status',o.status));
 return market_billing_order_json(o);
end $$;

create function public.market_billing_record_receipt(p_order uuid,p_bank_reference text,p_amount_cents integer,p_received_at timestamptz,p_note text) returns jsonb language plpgsql security definer set search_path=public as $$
declare actor uuid:=market_billing_require_admin(); o public.market_bank_orders; old_receipt public.market_bank_receipts; r public.market_bank_receipts;
 applied integer:=0; excess integer; settled boolean:=false; previous_until timestamptz; stripe_sub text; current_checkout text; commission integer:=0; can_grant boolean:=true; stale public.market_bank_orders;
begin
 if p_amount_cents is null or p_amount_cents not between 1 and 100000000 or p_received_at is null or p_received_at>now()+interval '5 minutes'
 or p_bank_reference is null or length(btrim(p_bank_reference)) not between 1 and 160 or length(coalesce(p_note,''))>2000 then raise exception using errcode='22023',message='Enter a valid bank reference, received time and positive amount.'; end if;
 select * into o from market_bank_orders where id=p_order;
 if o.id is null then raise exception using errcode='22023',message='Order not found.'; end if;
 perform pg_advisory_xact_lock(hashtextextended('market.order:'||o.salon_id::text||':'||o.plugin_id,0));
 select * into o from market_bank_orders where id=p_order for update;
 perform pg_advisory_xact_lock(hashtextextended('market.bank.receipt:'||o.bank_account_id::text||':'||lower(btrim(p_bank_reference)),0));
 select * into old_receipt from market_bank_receipts where bank_account_id=o.bank_account_id and lower(btrim(bank_reference))=lower(btrim(p_bank_reference));
 if found then
 if old_receipt.order_id<>o.id or old_receipt.amount_cents<>p_amount_cents or old_receipt.received_at<>p_received_at then raise exception using errcode='22023',message='This bank reference is already recorded with different payment details.'; end if;
 return market_billing_order_json(o); end if;
 -- A payment predating an order cannot be attached to it. Late payments are retained as customer credit.
 if p_received_at<o.created_at then raise exception using errcode='22023',message='The received time cannot precede this order.'; end if;
 if o.status in ('awaiting_payment','partially_paid') and o.expires_at<=now() then update market_bank_orders set status='expired',expiry_reason='timeout' where id=o.id returning * into o; end if;
 -- The bank's settled timestamp governs the quote deadline, not the administrator's reconciliation time.
 -- A cancelled order or one with a real refund must never be revived by later reconciliation.
 if (o.status in ('awaiting_payment','partially_paid') or (o.status='expired' and o.expires_at<=now() and coalesce(o.expiry_reason,'timeout')='timeout'))
 and p_received_at<=o.expires_at and not exists(select 1 from market_bank_refunds where order_id=o.id and status<>'cancelled') then
 if o.plugin_id='vietnamese-language' then select paid_until,stripe_subscription,checkout_session into previous_until,stripe_sub,current_checkout from vietnamese_plugin_subscriptions where salon_id=o.salon_id for update;
 elsif o.plugin_id='booking-policy' then select paid_until,stripe_subscription,stripe_checkout into previous_until,stripe_sub,current_checkout from booking_policy_subscriptions where salon_id=o.salon_id for update;
 elsif o.plugin_id='booking-deposit' then select paid_until,stripe_subscription,stripe_checkout into previous_until,stripe_sub,current_checkout from booking_deposit_subscriptions where salon_id=o.salon_id for update;
 elsif o.plugin_id='checkin-receipt' then select paid_until,stripe_subscription,stripe_checkout into previous_until,stripe_sub,current_checkout from checkin_receipt_subscriptions where salon_id=o.salon_id for update;
 else can_grant:=false; end if;
 can_grant:=can_grant and stripe_sub is null and current_checkout is null and (previous_until is null or previous_until<=now())
 and exists(select 1 from locations where id=o.salon_id and status='active')
 and exists(select 1 from users where id=o.payer_id and status='active')
 and coalesce(public.lifecycle_user_is_salon_owner(o.salon_id,o.payer_id,false),false);
 if can_grant then applied:=least(p_amount_cents,o.total_cents-o.received_cents); else update market_bank_orders set status='expired',expiry_reason='subscription_conflict' where id=o.id returning * into o; end if;
 end if;
 excess:=p_amount_cents-applied;
 settled:=applied>0 and o.received_cents+applied=o.total_cents;
 insert into market_bank_receipts(bank_account_id,bank_reference,amount_cents,applied_cents,unapplied_cents,received_at,note,order_id,actor_id)
 values(o.bank_account_id,btrim(p_bank_reference),p_amount_cents,applied,excess,p_received_at,coalesce(btrim(p_note),''),o.id,actor) returning * into r;
 update market_bank_orders set received_cents=received_cents+applied,unapplied_cents=unapplied_cents+excess,
 status=case when settled then 'paid' when applied>0 then 'partially_paid' else status end,
 expiry_reason=case when applied>0 then null else expiry_reason end,
 paid_at=case when settled then now() else paid_at end,service_start=case when settled then now() else service_start end,
 service_end=case when settled then market_billing_month_end(now()) else service_end end,
 entitlement_previous_until=case when settled then previous_until else entitlement_previous_until end where id=o.id returning * into o;
 if settled then
 commission:=round(o.base_cents::numeric*coalesce((o.snapshot->>'commission_bps')::integer,0)/10000)::integer;
 if o.plugin_id='vietnamese-language' then
 insert into vietnamese_plugin_subscriptions(salon_id,installed,paid_until,payment_owner,trial_ends_at) values(o.salon_id,true,o.service_end,o.payer_id,now())
 on conflict(salon_id) do update set installed=true,paid_until=excluded.paid_until,payment_owner=excluded.payment_owner,checkout_reference=null,checkout_owner=null,checkout_session=null,updated_at=now();
 elsif o.plugin_id='booking-policy' then
 insert into booking_policy_subscriptions(salon_id,paid_until,payment_owner) values(o.salon_id,o.service_end,o.payer_id)
 on conflict(salon_id) do update set paid_until=excluded.paid_until,payment_owner=excluded.payment_owner,stripe_checkout=null,updated_at=now();
 elsif o.plugin_id='booking-deposit' then
 insert into booking_deposit_subscriptions(salon_id,installed,paid_until,payment_owner) values(o.salon_id,true,o.service_end,o.payer_id)
 on conflict(salon_id) do update set installed=true,paid_until=excluded.paid_until,payment_owner=excluded.payment_owner,stripe_checkout=null,updated_at=now();
 elsif o.plugin_id='checkin-receipt' then
 insert into checkin_receipt_subscriptions(salon_id,paid_until,payment_owner) values(o.salon_id,o.service_end,o.payer_id)
 on conflict(salon_id) do update set paid_until=excluded.paid_until,payment_owner=excluded.payment_owner,stripe_checkout=null,updated_at=now();
 end if;
 for stale in select * from market_bank_orders where salon_id=o.salon_id and plugin_id=o.plugin_id and id<>o.id and status in ('awaiting_payment','partially_paid') for update loop
 update market_bank_orders set status='expired',expiry_reason='subscription_conflict' where id=stale.id;
 perform market_billing_audit(actor,'market.billing.order.expire',stale.id,jsonb_build_object('received_cents',stale.received_cents,'reason','subscription_conflict'));
 end loop;
 end if;
 insert into market_bank_ledger(order_id,receipt_id,bank_account_id,bank_reference,kind,amount_cents,revenue_cents,tax_cents,fee_cents,commission_cents,publisher_payable_cents,unapplied_cents,note,actor_id,occurred_at)
 values(o.id,r.id,o.bank_account_id,r.bank_reference,'cash_in',p_amount_cents,case when settled then o.base_cents else 0 end,case when settled then o.tax_cents else 0 end,case when settled then o.fee_cents else 0 end,
 commission,case when settled and lower(btrim(o.publisher))<>'reylumi' then o.base_cents-commission else 0 end,excess,coalesce(btrim(p_note),''),actor,p_received_at);
 perform market_billing_audit(actor,'market.billing.receipt.record',o.id,jsonb_build_object('receipt_id',r.id,'amount_cents',p_amount_cents,'applied_cents',applied,'unapplied_cents',excess,'status',o.status,'entitlement_granted',settled));
 return market_billing_order_json(o);
end $$;

create function public.market_billing_request_refund(p_order uuid,p_amount_cents integer,p_reason text) returns jsonb language plpgsql security definer set search_path=public as $$
declare actor uuid:=market_billing_require_admin(); o public.market_bank_orders; r public.market_bank_refunds; pending bigint; pending_excess bigint; available_excess bigint;
begin
 if p_amount_cents is null or p_amount_cents not between 1 and 100000000 or p_reason is null or length(btrim(p_reason)) not between 3 and 2000 then raise exception using errcode='22023',message='Enter a positive refund amount and a reason (3–2000 characters).'; end if;
 select * into o from market_bank_orders where id=p_order for update;
 if o.id is null then raise exception using errcode='22023',message='Order not found.'; end if;
 select coalesce(sum(amount_cents),0),coalesce(sum(unapplied_cents),0) into pending,pending_excess from market_bank_refunds where order_id=o.id and status='pending';
 if pending>0 then raise exception using errcode='22023',message='Complete the pending refund before requesting another one.'; end if;
 if p_amount_cents>o.received_cents-o.refunded_applied_cents+o.unapplied_cents-pending then raise exception using errcode='22023',message='Refund exceeds the money available for this order.'; end if;
 available_excess:=greatest(0,o.unapplied_cents-pending_excess);
 insert into market_bank_refunds(order_id,bank_account_id,amount_cents,applied_cents,unapplied_cents,reason,actor_id,order_status_before)
 values(o.id,o.bank_account_id,p_amount_cents,p_amount_cents-least(p_amount_cents,available_excess)::integer,least(p_amount_cents,available_excess)::integer,btrim(p_reason),actor,o.status) returning * into r;
 update market_bank_orders set status='refund_pending' where id=o.id returning * into o;
 perform market_billing_audit(actor,'market.billing.refund.request',o.id,jsonb_build_object('refund_id',r.id,'amount_cents',r.amount_cents,'applied_cents',r.applied_cents,'unapplied_cents',r.unapplied_cents));
 return market_billing_order_json(o);
end $$;
create function public.market_billing_cancel_refund(p_refund uuid,p_reason text) returns jsonb language plpgsql security definer set search_path=public as $$
declare actor uuid:=market_billing_require_admin(); r public.market_bank_refunds; o public.market_bank_orders;
begin
 if p_reason is null or length(btrim(p_reason)) not between 3 and 2000 then raise exception using errcode='22023',message='Enter a reason for cancelling the refund request (3–2000 characters).'; end if;
 select * into r from market_bank_refunds where id=p_refund;
 if r.id is null then raise exception using errcode='22023',message='Refund request not found.'; end if;
 select * into o from market_bank_orders where id=r.order_id for update;
 select * into r from market_bank_refunds where id=p_refund for update;
 if r.status='cancelled' then return market_billing_order_json(o); end if;
 if r.status='completed' then raise exception using errcode='22023',message='A confirmed bank refund cannot be cancelled.'; end if;
 update market_bank_refunds set status='cancelled',cancelled_at=now(),cancelled_by=actor,note=btrim(p_reason) where id=r.id;
 update market_bank_orders set status=case when r.order_status_before in ('awaiting_payment','partially_paid') and expires_at<=now() then 'expired' else r.order_status_before end where id=o.id returning * into o;
 perform market_billing_audit(actor,'market.billing.refund.cancel',o.id,jsonb_build_object('refund_id',r.id,'amount_cents',r.amount_cents,'status',o.status));
 return market_billing_order_json(o);
end $$;
create function public.market_billing_complete_refund(p_refund uuid,p_bank_reference text,p_note text) returns jsonb language plpgsql security definer set search_path=public as $$
declare actor uuid:=market_billing_require_admin(); r public.market_bank_refunds; o public.market_bank_orders; current_paid timestamptz; stripe_sub text;
 reverse_base integer:=0; reverse_tax integer:=0; reverse_fee integer:=0; reverse_commission integer:=0; original_commission integer:=0; next_applied integer; revoked boolean:=false;
begin
 if p_bank_reference is null or length(btrim(p_bank_reference)) not between 1 and 160 or length(coalesce(p_note,''))>2000 then raise exception using errcode='22023',message='Enter the confirmed outbound bank transfer reference.'; end if;
 select * into r from market_bank_refunds where id=p_refund;
 if r.id is null then raise exception using errcode='22023',message='Refund request not found.'; end if;
 select * into o from market_bank_orders where id=r.order_id;
 perform pg_advisory_xact_lock(hashtextextended('market.order:'||o.salon_id::text||':'||o.plugin_id,0));
 select * into o from market_bank_orders where id=r.order_id for update;
 select * into r from market_bank_refunds where id=p_refund for update;
 if r.status='completed' then
 if lower(btrim(r.bank_reference))<>lower(btrim(p_bank_reference)) then raise exception using errcode='22023',message='This refund is already completed with another bank reference.'; end if;
 return market_billing_order_json(o); end if;
 if r.status<>'pending' then raise exception using errcode='22023',message='This refund request was cancelled. Create a new request before sending money.'; end if;
 if r.applied_cents>o.received_cents-o.refunded_applied_cents or r.unapplied_cents>o.unapplied_cents then raise exception using errcode='22023',message='Refund funds are no longer available.'; end if;
 perform pg_advisory_xact_lock(hashtextextended('market.bank.outbound:'||r.bank_account_id::text||':'||lower(btrim(p_bank_reference)),0));
 if exists(select 1 from market_bank_ledger where bank_account_id=r.bank_account_id and lower(btrim(bank_reference))=lower(btrim(p_bank_reference)) and kind in ('cash_out','expense')) then
 raise exception using errcode='22023',message='This outgoing bank reference is already recorded for another refund or expense.'; end if;
 next_applied:=o.refunded_applied_cents+r.applied_cents;
 if o.paid_at is not null and r.applied_cents>0 then
 -- Cumulative rounding guarantees all recognition is reversed exactly on a full refund.
 reverse_base:=round(o.base_cents::numeric*next_applied/o.total_cents)::integer-round(o.base_cents::numeric*o.refunded_applied_cents/o.total_cents)::integer;
 if o.tax_cents+o.fee_cents>0 then
 reverse_tax:=round((next_applied-round(o.base_cents::numeric*next_applied/o.total_cents))::numeric*o.tax_cents/(o.tax_cents+o.fee_cents))::integer
 -round((o.refunded_applied_cents-round(o.base_cents::numeric*o.refunded_applied_cents/o.total_cents))::numeric*o.tax_cents/(o.tax_cents+o.fee_cents))::integer;
 end if;
 reverse_fee:=r.applied_cents-reverse_base-reverse_tax;
 original_commission:=round(o.base_cents::numeric*coalesce((o.snapshot->>'commission_bps')::integer,0)/10000)::integer;
 reverse_commission:=round(original_commission::numeric*round(o.base_cents::numeric*next_applied/o.total_cents)/o.base_cents)::integer
 -round(original_commission::numeric*round(o.base_cents::numeric*o.refunded_applied_cents/o.total_cents)/o.base_cents)::integer;
 end if;
 update market_bank_refunds set status='completed',bank_reference=btrim(p_bank_reference),note=coalesce(btrim(p_note),''),completed_at=now(),completed_by=actor where id=r.id returning * into r;
 insert into market_bank_ledger(order_id,refund_id,bank_account_id,bank_reference,kind,amount_cents,revenue_cents,tax_cents,fee_cents,commission_cents,publisher_payable_cents,unapplied_cents,note,actor_id,occurred_at)
 values(o.id,r.id,r.bank_account_id,r.bank_reference,'cash_out',r.amount_cents,-reverse_base,-reverse_tax,-reverse_fee,-reverse_commission,case when lower(btrim(o.publisher))<>'reylumi' then -(reverse_base-reverse_commission) else 0 end,-r.unapplied_cents,r.note,actor,now());
 update market_bank_orders set refunded_cents=refunded_cents+r.amount_cents,refunded_applied_cents=next_applied,unapplied_cents=unapplied_cents-r.unapplied_cents,
 status=case when received_cents=next_applied and unapplied_cents=r.unapplied_cents then 'refunded'
 when paid_at is not null and next_applied=0 then 'paid' else 'partially_refunded' end where id=o.id returning * into o;
 if o.paid_at is not null and next_applied=o.total_cents then
 if o.plugin_id='vietnamese-language' then select paid_until,stripe_subscription into current_paid,stripe_sub from vietnamese_plugin_subscriptions where salon_id=o.salon_id for update;
 elsif o.plugin_id='booking-policy' then select paid_until,stripe_subscription into current_paid,stripe_sub from booking_policy_subscriptions where salon_id=o.salon_id for update;
 elsif o.plugin_id='booking-deposit' then select paid_until,stripe_subscription into current_paid,stripe_sub from booking_deposit_subscriptions where salon_id=o.salon_id for update;
 elsif o.plugin_id='checkin-receipt' then select paid_until,stripe_subscription into current_paid,stripe_sub from checkin_receipt_subscriptions where salon_id=o.salon_id for update;
 end if;
 if current_paid=o.service_end and stripe_sub is null and not exists(select 1 from market_bank_orders newer where newer.salon_id=o.salon_id and newer.plugin_id=o.plugin_id and newer.id<>o.id
 and newer.paid_at is not null and newer.service_end>now() and newer.refunded_applied_cents<newer.total_cents) then
 if o.plugin_id='vietnamese-language' then update vietnamese_plugin_subscriptions set paid_until=o.entitlement_previous_until,checkout_reference=null,checkout_owner=null,checkout_session=null,updated_at=now() where salon_id=o.salon_id;
 elsif o.plugin_id='booking-policy' then update booking_policy_subscriptions set paid_until=o.entitlement_previous_until,stripe_checkout=null,checkout_reference=gen_random_uuid(),updated_at=now() where salon_id=o.salon_id;
 elsif o.plugin_id='booking-deposit' then update booking_deposit_subscriptions set paid_until=o.entitlement_previous_until,stripe_checkout=null,checkout_reference=gen_random_uuid(),updated_at=now() where salon_id=o.salon_id;
 elsif o.plugin_id='checkin-receipt' then update checkin_receipt_subscriptions set paid_until=o.entitlement_previous_until,stripe_checkout=null,updated_at=now() where salon_id=o.salon_id;
 end if;
 revoked:=true;
 end if;
 end if;
 perform market_billing_audit(actor,'market.billing.refund.complete',o.id,jsonb_build_object('refund_id',r.id,'amount_cents',r.amount_cents,'applied_cents',r.applied_cents,'unapplied_cents',r.unapplied_cents,'entitlement_revoked',revoked));
 return market_billing_order_json(o);
end $$;
create function public.market_billing_record_expense(p_bank uuid,p_bank_reference text,p_amount_cents integer,p_received_at timestamptz,p_note text) returns jsonb language plpgsql security definer set search_path=public as $$
declare actor uuid:=market_billing_require_admin(); l public.market_bank_ledger;
begin
 if p_amount_cents is null or p_amount_cents not between 1 and 100000000 or p_received_at is null or p_received_at>now()+interval '5 minutes'
 or p_bank_reference is null or length(btrim(p_bank_reference)) not between 1 and 160 or length(btrim(coalesce(p_note,''))) not between 3 and 2000
 or not exists(select 1 from market_bank_accounts where id=p_bank) then raise exception using errcode='22023',message='Enter the bank account, confirmed transfer reference, amount, time and expense description.'; end if;
 perform pg_advisory_xact_lock(hashtextextended('market.bank.outbound:'||p_bank::text||':'||lower(btrim(p_bank_reference)),0));
 select * into l from market_bank_ledger where bank_account_id=p_bank and lower(btrim(bank_reference))=lower(btrim(p_bank_reference)) and kind in ('cash_out','expense');
 if found then
 if l.kind<>'expense' or l.amount_cents<>p_amount_cents or l.occurred_at<>p_received_at then raise exception using errcode='22023',message='This outgoing bank reference is already recorded with different details.'; end if;
 return to_jsonb(l); end if;
 insert into market_bank_ledger(bank_account_id,bank_reference,kind,amount_cents,expense_cents,note,actor_id,occurred_at)
 values(p_bank,btrim(p_bank_reference),'expense',p_amount_cents,p_amount_cents,btrim(p_note),actor,p_received_at) returning * into l;
 perform market_billing_audit(actor,'market.billing.expense.record',l.id,jsonb_build_object('bank_id',p_bank,'amount_cents',p_amount_cents));
 return to_jsonb(l);
end $$;

-- Definer internals cannot be called by customers or anonymous callers.
revoke all on function public.market_billing_is_admin(),public.market_billing_require_admin(),public.market_billing_require_owner(uuid),
 public.market_billing_can_read_salon(uuid),public.market_billing_audit(uuid,text,uuid,jsonb),public.market_bank_immutable(),public.market_billing_order_json(public.market_bank_orders),public.market_billing_month_end(timestamptz) from public,anon,authenticated;
grant execute on function public.market_billing_is_admin(),public.market_billing_can_read_salon(uuid) to authenticated;
revoke all on function public.market_billing_public_catalog(),public.market_billing_owner_state(uuid),public.market_billing_admin_state(),
 public.market_billing_export_ledger(timestamptz,timestamptz),
 public.market_billing_save_settings(integer,jsonb),public.market_billing_save_bank(jsonb,integer),public.market_billing_save_catalog(text,integer,jsonb),
 public.market_billing_create_order(uuid,text,uuid),public.market_billing_cancel_order(uuid),public.market_billing_record_receipt(uuid,text,integer,timestamptz,text),
 public.market_billing_request_refund(uuid,integer,text),public.market_billing_cancel_refund(uuid,text),public.market_billing_complete_refund(uuid,text,text),public.market_billing_record_expense(uuid,text,integer,timestamptz,text) from public,anon,authenticated;
grant execute on function public.market_billing_public_catalog() to anon,authenticated,service_role;
grant execute on function public.market_billing_owner_state(uuid),public.market_billing_admin_state(),
 public.market_billing_export_ledger(timestamptz,timestamptz),
 public.market_billing_save_settings(integer,jsonb),public.market_billing_save_bank(jsonb,integer),public.market_billing_save_catalog(text,integer,jsonb),
 public.market_billing_create_order(uuid,text,uuid),public.market_billing_cancel_order(uuid),public.market_billing_record_receipt(uuid,text,integer,timestamptz,text),
 public.market_billing_request_refund(uuid,integer,text),public.market_billing_cancel_refund(uuid,text),public.market_billing_complete_refund(uuid,text,text),public.market_billing_record_expense(uuid,text,integer,timestamptz,text) to authenticated;
notify pgrst,'reload schema';
commit;
