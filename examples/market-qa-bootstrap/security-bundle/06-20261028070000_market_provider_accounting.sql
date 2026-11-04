-- Immutable provider facts, separate from unapproved commercial liability rules.
create table market_platform.balance_observations(
 account_id text not null,transaction_id text not null,order_id uuid not null references market_platform.orders(id),
 source_id text not null,amount_cents bigint not null,fee_cents bigint not null,net_cents bigint not null,
 currency text not null check(currency='usd'),created_at timestamptz not null,
 primary key(account_id,transaction_id),check(amount_cents-fee_cents=net_cents)
);
alter table market_platform.balance_observations enable row level security;
revoke all on market_platform.balance_observations from public,anon,authenticated,service_role;
create trigger market_balance_immutable before update or delete on market_platform.balance_observations for each row execute function market_platform.immutable();
create function public.market_platform_balance_apply(p_order uuid,p_account text,p_transaction text,p_source text,p_amount bigint,p_fee bigint,p_net bigint,p_currency text,p_created timestamptz) returns boolean language plpgsql security definer set search_path=pg_catalog,market_platform as $$
declare old balance_observations;
begin
 if not exists(select 1 from settings where id and enabled and commerce_test_enabled) then raise exception using errcode='42501',message='Test commerce disabled.';end if;
 if not exists(select 1 from orders where id=p_order and charge_id is not null) or p_account is null or p_account !~ '^acct_[A-Za-z0-9]+$'
 or p_transaction is null or p_transaction !~ '^txn_[A-Za-z0-9]+$' or p_source is null or p_source !~ '^(ch|re|tr|trr|fee|fr|dp)_[A-Za-z0-9]+$'
 or p_amount is null or p_fee is null or p_net is null or abs(p_amount)>1000000000000 or abs(p_fee)>1000000000000 or abs(p_net)>1000000000000
 or p_amount-p_fee<>p_net or p_currency is distinct from 'usd' or p_created is null then raise exception using errcode='22023',message='Invalid provider balance observation.';end if;
 select * into old from balance_observations where account_id=p_account and transaction_id=p_transaction;
 if old.transaction_id is not null then
 if old.order_id<>p_order or old.source_id<>p_source or old.amount_cents<>p_amount or old.fee_cents<>p_fee or old.net_cents<>p_net or old.currency<>p_currency or old.created_at<>p_created then raise exception using errcode='PT409',message='Immutable provider transaction mismatch.';end if;return true;end if;
 insert into balance_observations values(p_account,p_transaction,p_order,p_source,p_amount,p_fee,p_net,p_currency,p_created);
 return true;
end $$;
create function public.market_platform_accounting_workspace() returns jsonb language plpgsql security definer set search_path=pg_catalog,market_platform as $$
declare actor uuid:=market_platform.actor(); org uuid;
begin
 select id into org from organizations where owner_id=actor;
 return jsonb_build_object('transactions',coalesce((select jsonb_agg(to_jsonb(b)) from balance_observations b join orders o on o.id=b.order_id join versions v on v.id=o.version_id join apps a on a.id=v.app_id where a.organization_id=org),'[]'::jsonb));
end $$;
revoke all on function public.market_platform_balance_apply(uuid,text,text,text,bigint,bigint,bigint,text,timestamptz),public.market_platform_accounting_workspace() from public,anon,authenticated,service_role;
grant execute on function public.market_platform_balance_apply(uuid,text,text,text,bigint,bigint,bigint,text,timestamptz) to service_role;
grant execute on function public.market_platform_accounting_workspace() to authenticated;
