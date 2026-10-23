begin;
-- Staged configuration: existing Stripe contracts remain effective until a
-- versioned order/settlement implementation is released.
create table public.market_commerce_configuration (
 id boolean primary key default true check (id),
 bank_name text not null default '',
 bank_beneficiary text not null default '',
 bank_account text not null default '',
 bank_routing text not null default '',
 bank_instructions text not null default '',
 currency text not null default 'USD' check (currency = 'USD'),
 tax_bps integer not null default 0 check (tax_bps between 0 and 10000),
 fee_bps integer not null default 0 check (fee_bps between 0 and 10000),
 fixed_fee_cents integer not null default 0 check (fixed_fee_cents between 0 and 100000000),
 plugin_prices jsonb not null default '{"vietnamese-language":399,"booking-policy":99,"booking-deposit":590,"checkin-receipt":470}',
 version integer not null default 1,
 updated_at timestamptz not null default now()
);
insert into public.market_commerce_configuration(id) values(true);
alter table public.market_commerce_configuration enable row level security;
revoke all on public.market_commerce_configuration from public, anon, authenticated;
grant all on public.market_commerce_configuration to service_role;
-- Sensitive bank details are only read by an authenticated platform owner on
-- the server. Customer instructions will require an owner-scoped order.
commit;
