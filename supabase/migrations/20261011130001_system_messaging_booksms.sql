begin;
create table public.booksms_subscriptions (
 salon_id uuid primary key references public.locations(id) on delete cascade,
 paid_until timestamptz, stripe_subscription text unique, stripe_checkout text,
 checkout_reference uuid not null default gen_random_uuid(), stripe_customer text,
 payment_owner uuid references public.users(id), updated_at timestamptz not null default now(),
 installed boolean not null default false, encrypted_config text,
 public_config jsonb not null default '{}', monthly_limit integer not null default 0 check(monthly_limit>=0)
);
alter table public.booksms_subscriptions enable row level security;
revoke all on public.booksms_subscriptions from public,anon,authenticated;
grant all on public.booksms_subscriptions to service_role;
create function public.booksms_has_access(p_salon uuid) returns boolean
language sql stable security definer set search_path=public as $$
 select exists(select 1 from booksms_subscriptions s join locations l on l.id=s.salon_id
 where s.salon_id=p_salon and l.status='active' and s.installed and s.paid_until>now()
 and s.encrypted_config is not null and s.monthly_limit>0 and (s.public_config->>'enabled')::boolean is true);
$$;
revoke all on function public.booksms_has_access(uuid) from public,anon;
grant execute on function public.booksms_has_access(uuid) to authenticated,service_role;
create function public.booksms_allows(p_salon uuid,p_reminder boolean) returns boolean
language sql stable security definer set search_path=public as $$
 select booksms_has_access(p_salon) and exists(select 1 from booksms_subscriptions where salon_id=p_salon
 and (public_config->>case when p_reminder then 'reminders' else 'confirmation' end)::boolean is true);
$$;
revoke all on function public.booksms_allows(uuid,boolean) from public,anon,authenticated;
grant execute on function public.booksms_allows(uuid,boolean) to service_role;
create function public.booksms_owner_state(p_salon uuid) returns jsonb
language plpgsql security definer set search_path=public as $$
declare s booksms_subscriptions;
begin
 if not coalesce(lifecycle_user_is_salon_owner(p_salon,current_public_user_id(),false),false) then raise exception 'Salon owner access required.'; end if;
 select * into s from booksms_subscriptions where salon_id=p_salon;
 return coalesce(s.public_config,'{}')||jsonb_build_object('active',coalesce(s.paid_until>now(),false),'installed',coalesce(s.installed,false),'paidUntil',s.paid_until,'monthlyLimit',coalesce(s.monthly_limit,0));
end $$;
revoke all on function public.booksms_owner_state(uuid) from public,anon;
grant execute on function public.booksms_owner_state(uuid) to authenticated;
create function public.booksms_save(p_actor uuid,p_salon uuid,p_installed boolean,p_encrypted text,p_public jsonb) returns void
language plpgsql security definer set search_path=public as $$
begin
 if not coalesce(lifecycle_user_is_salon_owner(p_salon,p_actor,false),false) or not exists(select 1 from locations where id=p_salon and status='active') then raise exception 'Active salon owner access required.'; end if;
 perform 1 from booksms_subscriptions where salon_id=p_salon and paid_until>now() for update;
 if not found then raise exception 'Activate paid BookSMS access before configuring SMS.'; end if;
 update booksms_subscriptions set installed=p_installed,encrypted_config=p_encrypted,public_config=p_public,updated_at=now() where salon_id=p_salon;
end $$;
revoke all on function public.booksms_save(uuid,uuid,boolean,text,jsonb) from public,anon,authenticated;
grant execute on function public.booksms_save(uuid,uuid,boolean,text,jsonb) to service_role;

create table public.booksms_usage (
 salon_id uuid not null references public.locations(id) on delete cascade,
 period date not null, sends integer not null default 0, primary key(salon_id,period)
);
alter table public.booksms_usage enable row level security;
revoke all on public.booksms_usage from public,anon,authenticated;
create function public.booksms_reserve_send(p_salon uuid,p_reminder boolean) returns boolean
language plpgsql security definer set search_path=public as $$
declare allowance integer; used integer; month date:=date_trunc('month',now() at time zone 'UTC')::date;
begin
 select monthly_limit into allowance from booksms_subscriptions where salon_id=p_salon for update;
 if not booksms_allows(p_salon,p_reminder) then return false; end if;
 insert into booksms_usage(salon_id,period) values(p_salon,month) on conflict do nothing;
 update booksms_usage set sends=sends+1 where salon_id=p_salon and period=month and sends<allowance returning sends into used;
 return found;
end $$;
revoke all on function public.booksms_reserve_send(uuid,boolean) from public,anon,authenticated;
grant execute on function public.booksms_reserve_send(uuid,boolean) to service_role;

alter table market_billing_catalog add column monthly_sms_limit integer not null default 0 check(monthly_sms_limit>=0);
alter table market_billing_catalog drop constraint market_billing_catalog_price_cents_check;
alter table market_billing_catalog add constraint market_billing_catalog_price_cents_check check(price_cents between 1 and 100000000 or (plugin_id='booksms' and price_cents=0 and not fulfillment_ready));
alter table market_billing_catalog add constraint booksms_plan_ready check(plugin_id<>'booksms' or not fulfillment_ready or (price_cents>0 and monthly_sms_limit>0));
-- Extend audited Market payment fulfillment/refund using the existing paid plugin lifecycle.
do $$ declare c record; definition text; branch text; lines text[]; i integer; assembled text; begin
 for c in select oid from pg_proc where pronamespace='public'::regnamespace and proname like 'market_billing_%' loop
 definition:=pg_get_functiondef(c.oid);
 if definition like '%booking-policy%' then
 lines:=string_to_array(definition,E'\n'); i:=1; assembled:='';
 while i<=array_length(lines,1) loop
 if lines[i] ~ '^[[:space:]]*elsif (p_plugin|o.plugin_id)=''booking-policy'' then'
 then branch:=lines[i]||E'\n'; i:=i+1;
 while i<=array_length(lines,1) and lines[i] !~ '^[[:space:]]*(elsif|end if;)' loop branch:=branch||lines[i]||E'\n'; i:=i+1; end loop;
 assembled:=assembled||replace(replace(branch,'booking-policy','booksms'),'booking_policy_subscriptions','booksms_subscriptions')||branch;
 else assembled:=assembled||lines[i]||E'\n'; i:=i+1; end if;
 end loop;
 definition:=replace(assembled,'''vietnamese-language'',''booking-policy'',''booking-deposit'',''checkin-receipt'',''tax-company''','''vietnamese-language'',''booking-policy'',''booking-deposit'',''checkin-receipt'',''tax-company'',''booksms''');
 definition:=replace(definition,'price_cents=coalesce((p_values->>''price_cents'')::integer,c.price_cents)', 'monthly_sms_limit=case when p_plugin=''booksms'' then coalesce((p_values->>''monthly_sms_limit'')::integer,c.monthly_sms_limit) else c.monthly_sms_limit end,price_cents=coalesce((p_values->>''price_cents'')::integer,c.price_cents)');
 definition:=replace(definition,'jsonb_build_object(''price_cents'',c.price_cents', 'jsonb_build_object(''monthly_sms_limit'',c.monthly_sms_limit,''price_cents'',c.price_cents');
 definition:=replace(definition,'insert into booksms_subscriptions(salon_id,paid_until,payment_owner) values(o.salon_id,o.service_end,o.payer_id)', 'insert into booksms_subscriptions(salon_id,paid_until,payment_owner,monthly_limit) values(o.salon_id,o.service_end,o.payer_id,coalesce((o.snapshot->>''monthly_sms_limit'')::integer,0))');
 -- Update the BookSMS allowance after settlement, preserving provider configuration.
 if c.oid='public.market_billing_record_receipt(uuid,text,integer,timestamptz,text)'::regprocedure then
 definition:=replace(definition,'return market_billing_order_json(o);', 'if o.plugin_id=''booksms'' and o.status=''paid'' then update booksms_subscriptions set monthly_limit=coalesce((o.snapshot->>''monthly_sms_limit'')::integer,0) where salon_id=o.salon_id; end if; return market_billing_order_json(o);');
 end if;
 execute definition;
 end if;
 end loop;
end $$;
alter table market_billing_catalog drop constraint market_catalog_fulfillment_check;
alter table market_billing_catalog add constraint market_catalog_fulfillment_check check(not fulfillment_ready or plugin_id in ('vietnamese-language','booking-policy','booking-deposit','checkin-receipt','tax-company','booksms'));
-- Price and allowance are pending the owner's decision. Never open free checkout by default.
insert into market_billing_catalog(plugin_id,name,publisher,price_cents,published,fulfillment_ready)
values('booksms','BookSMS','Reylumi',0,true,false);

-- Old platform booking SMS was queued without BookSMS consent. Never inherit that queue.
update public.booking_message_outbox set state='skipped',detail='BookSMS activation required for new booking SMS.',updated_at=now() where channel='sms' and state in ('pending','unconfigured');
-- Gate enqueue and claim in the database, including already queued SMS.
do $$ declare definition text; begin
 definition:=pg_get_functiondef('public.enqueue_booking_message()'::regprocedure);
 definition:=replace(definition,'if channel=''sms'' and not coalesce(settings.confirmation_sms_enabled,true) then continue; end if;',
 'if channel=''sms'' and not public.booksms_allows(new.salon_id,false) then continue; end if;');
 execute definition;
 definition:=pg_get_functiondef('public.claim_booking_messages(integer,boolean,boolean)'::regprocedure);
 definition:=replace(definition,' -- One reminder per appointment time', ' update public.booking_message_outbox set state=''skipped'',detail=''BookSMS delivery is disabled.'',updated_at=now() where channel=''sms'' and state in (''pending'',''unconfigured'') and not public.booksms_allows(salon_id,event_key like ''reminder:%'');
 -- One reminder per appointment time');
 definition:=replace(definition,'and coalesce(settings.reminder_enabled,true)','and (c.channel=''sms'' or coalesce(settings.reminder_enabled,true))');
 definition:=replace(definition,'else coalesce(settings.confirmation_sms_enabled,true) end','else public.booksms_allows(b.salon_id,true) end');
 definition:=replace(definition,'else coalesce((select confirmation_sms_enabled from booking_settings where salon_id=q.salon_id),true) end',
 'else public.booksms_allows(q.salon_id,q.event_key like ''reminder:%'') end');
 definition:=replace(definition,'and coalesce((select reminder_enabled from booking_settings where salon_id=q.salon_id),true)',
 'and (q.channel=''sms'' or coalesce((select reminder_enabled from booking_settings where salon_id=q.salon_id),true))');
 execute definition;
end $$;

create table public.auth_sms_hook_deliveries (
 id text primary key, state text not null default 'sending' check(state in ('sending','accepted','unknown')),
 created_at timestamptz not null default now()
);
alter table public.auth_sms_hook_deliveries enable row level security;
revoke all on public.auth_sms_hook_deliveries from public,anon,authenticated;
grant select,insert,update,delete on public.auth_sms_hook_deliveries to service_role;
notify pgrst,'reload schema';
commit;
