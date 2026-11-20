begin;

-- Tax registrations and filing obligations are managed by the processor/account owner.
-- This layer stores the exact processor-verified invoice facts and their refund allocations.
create table public.platform_market_tax_settings (
 id boolean primary key default true check(id), enabled boolean not null default false,
 price_behavior text not null default 'exclusive' check(price_behavior in ('exclusive','inclusive')),
 default_tax_code text check(default_tax_code ~ '^txcd_[0-9]{8}$'),
 version integer not null default 1 check(version>0), updated_at timestamptz not null default now()
);
insert into public.platform_market_tax_settings(id) values(true);
create table public.platform_market_tax_provider (
 id boolean primary key default true check(id),
 state jsonb not null default '{"connected":false,"account_id":null,"mode":null,"status":"unavailable","head_office":null,"registrations":[],"checked_at":null,"error":null}' check(jsonb_typeof(state)='object')
);
insert into public.platform_market_tax_provider(id) values(true);
create table public.platform_market_tax_products (
 plugin_id text primary key references public.market_billing_catalog(plugin_id),
 tax_code text check(tax_code ~ '^txcd_[0-9]{8}$'),
 version integer not null default 1 check(version>0), updated_at timestamptz not null default now()
);
create table public.market_tax_invoices (
 invoice_id text primary key check(invoice_id ~ '^in_[A-Za-z0-9_]+$'),
 purchase_id uuid not null references public.market_card_purchases(id),
 account_id text not null check(account_id ~ '^acct_[A-Za-z0-9_]+$'),
 amount_cents integer not null check(amount_cents between 1 and 200000000),
 subtotal_cents integer not null check(subtotal_cents>=0), tax_cents integer not null check(tax_cents>=0),
 refunded_cents integer not null default 0 check(refunded_cents between 0 and amount_cents),
 refunded_tax_cents integer not null default 0 check(refunded_tax_cents between 0 and tax_cents),
 refunded_tax_breakdown jsonb not null default '[]' check(jsonb_typeof(refunded_tax_breakdown)='array'),
 refunds_reconciled_cents integer not null default 0 check(refunds_reconciled_cents between 0 and refunded_cents),
 reconciliation_required boolean not null default false, refund_occurred_at timestamptz,
 currency text not null check(currency='usd'), automatic_tax boolean not null check(automatic_tax),
 country text not null check(country ~ '^[A-Z]{2}$'), state text check(length(state)<=80),
 tax_breakdown jsonb not null check(jsonb_typeof(tax_breakdown)='array'),
 occurred_at timestamptz not null, created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 check(subtotal_cents+tax_cents=amount_cents)
);
create table public.market_tax_ledger (
 id uuid primary key default gen_random_uuid(), invoice_id text not null references public.market_tax_invoices(invoice_id),
 purchase_id uuid not null references public.market_card_purchases(id),
 entry_key text not null, kind text not null check(kind in ('sale','refund')),
 country text not null check(country ~ '^[A-Z]{2}$'), state text check(length(state)<=80),
 jurisdiction text not null check(length(btrim(jurisdiction)) between 1 and 160),
 tax_cents integer not null, occurred_at timestamptz not null,
 metadata jsonb not null default '{}' check(jsonb_typeof(metadata)='object'),
 created_at timestamptz not null default now(), unique(invoice_id,entry_key),
 check((kind='sale' and tax_cents>=0) or (kind='refund' and tax_cents<=0))
);
create table public.market_tax_credit_notes (
 id text primary key check(id ~ '^cn_[A-Za-z0-9_]+$'),
 invoice_id text not null references public.market_tax_invoices(invoice_id),
 purchase_id uuid not null references public.market_card_purchases(id),
 amount_cents integer not null check(amount_cents between 1 and 200000000),
 tax_breakdown jsonb not null check(jsonb_typeof(tax_breakdown)='array'),
 occurred_at timestamptz not null, created_at timestamptz not null default now()
);
create index market_tax_credit_notes_invoice on public.market_tax_credit_notes(invoice_id);
create index market_tax_ledger_jurisdiction on public.market_tax_ledger(country,state,jurisdiction,occurred_at);
create index market_tax_ledger_occurred on public.market_tax_ledger(occurred_at,id);
alter table public.platform_market_tax_settings enable row level security;
alter table public.platform_market_tax_provider enable row level security;
alter table public.platform_market_tax_products enable row level security;
alter table public.market_tax_invoices enable row level security;
alter table public.market_tax_ledger enable row level security;
alter table public.market_tax_credit_notes enable row level security;
revoke all on public.platform_market_tax_settings,public.platform_market_tax_provider,public.platform_market_tax_products,public.market_tax_invoices,public.market_tax_ledger,public.market_tax_credit_notes from public,anon,authenticated;
grant select on public.platform_market_tax_settings,public.platform_market_tax_provider,public.platform_market_tax_products,public.market_tax_invoices,public.market_tax_ledger,public.market_tax_credit_notes to service_role;
create policy market_tax_service_read on public.platform_market_tax_settings for select to service_role using(true);
create policy market_tax_service_read on public.platform_market_tax_provider for select to service_role using(true);
create policy market_tax_service_read on public.platform_market_tax_products for select to service_role using(true);
create policy market_tax_service_read on public.market_tax_invoices for select to service_role using(true);
create policy market_tax_service_read on public.market_tax_ledger for select to service_role using(true);
create policy market_tax_service_read on public.market_tax_credit_notes for select to service_role using(true);
create function public.market_tax_ledger_immutable() returns trigger language plpgsql set search_path=public as $$
begin raise exception 'Tax ledger entries are append-only.'; end $$;
create trigger market_tax_ledger_immutable before update or delete on public.market_tax_ledger for each row execute function public.market_tax_ledger_immutable();
create trigger market_tax_credit_notes_immutable before update or delete on public.market_tax_credit_notes for each row execute function public.market_tax_ledger_immutable();

create function public.market_tax_local_ready(p_default text) returns boolean language sql stable security definer set search_path=public as $$
 select not exists(select 1 from public.market_billing_catalog c left join public.platform_market_tax_products t on t.plugin_id=c.plugin_id
 where c.published and c.fulfillment_ready and coalesce(t.tax_code,p_default) is null)
$$;
create function public.market_tax_admin_state(p_from timestamptz default null,p_to timestamptz default null) returns jsonb language plpgsql stable security definer set search_path=public as $$
declare s public.platform_market_tax_settings; total_rows bigint;
begin
 perform public.market_billing_require_admin();
 if p_from is not null and p_to is not null and p_from>=p_to then raise exception using errcode='22023',message='Choose an end date after the start date.'; end if;
 select * into s from platform_market_tax_settings where id;
 select count(*) into total_rows from market_tax_ledger where (p_from is null or occurred_at>=p_from) and (p_to is null or occurred_at<p_to);
 return jsonb_build_object('settings',to_jsonb(s),
 'provider',(select state from platform_market_tax_provider where id),
 'product_codes',coalesce((select jsonb_agg(to_jsonb(t) order by t.plugin_id) from platform_market_tax_products t),'[]'::jsonb),
 'readiness_local',public.market_tax_local_ready(s.default_tax_code),
 'ledger',coalesce((select jsonb_agg(to_jsonb(l) order by l.occurred_at desc,l.id) from (select * from market_tax_ledger where (p_from is null or occurred_at>=p_from) and (p_to is null or occurred_at<p_to) order by occurred_at desc,id limit 200) l),'[]'::jsonb),
 'row_count',total_rows,'truncated',total_rows>200,
 'summary',jsonb_build_object(
 'sale_tax_cents',coalesce((select sum(tax_cents) from market_tax_ledger where kind='sale' and (p_from is null or occurred_at>=p_from) and (p_to is null or occurred_at<p_to)),0),
 'refunded_tax_cents',coalesce((select -sum(tax_cents) from market_tax_ledger where kind='refund' and (p_from is null or occurred_at>=p_from) and (p_to is null or occurred_at<p_to)),0),
 'net_tax_cents',coalesce((select sum(tax_cents) from market_tax_ledger where (p_from is null or occurred_at>=p_from) and (p_to is null or occurred_at<p_to)),0),
 'invoice_count',(select count(*) from market_tax_invoices where (p_from is null or occurred_at>=p_from) and (p_to is null or occurred_at<p_to)),
 'reconciliation_required_count',(select count(*) from market_tax_invoices where reconciliation_required and (p_from is null or occurred_at>=p_from) and (p_to is null or occurred_at<p_to)),
 'by_jurisdiction',coalesce((select jsonb_agg(to_jsonb(j) order by j.country,j.state,j.jurisdiction) from (
 select country,state,jurisdiction,coalesce(sum(tax_cents) filter(where kind='sale'),0) as sale_tax_cents,
 coalesce(-sum(tax_cents) filter(where kind='refund'),0) as refunded_tax_cents,sum(tax_cents) as net_tax_cents
 from market_tax_ledger where (p_from is null or occurred_at>=p_from) and (p_to is null or occurred_at<p_to) group by country,state,jurisdiction) j),'[]'::jsonb)));
end $$;
create function public.market_tax_export_ledger(p_from timestamptz default null,p_to timestamptz default null) returns jsonb language plpgsql stable security definer set search_path=public as $$
declare total_rows bigint;
begin
 perform market_billing_require_admin();
 if p_from is not null and p_to is not null and p_from>=p_to then raise exception using errcode='22023',message='Choose an end date after the start date.'; end if;
 select count(*) into total_rows from market_tax_ledger where (p_from is null or occurred_at>=p_from) and (p_to is null or occurred_at<p_to);
 if total_rows>25000 then raise exception using errcode='22023',message='Choose a narrower date range to export all tax entries (maximum 25,000).'; end if;
 return jsonb_build_object('row_count',total_rows,'ledger',coalesce((select jsonb_agg(to_jsonb(l) order by occurred_at,id) from market_tax_ledger l where (p_from is null or occurred_at>=p_from) and (p_to is null or occurred_at<p_to)),'[]'::jsonb));
end $$;
create function public.market_tax_registration_timestamp(p_value jsonb) returns timestamptz language plpgsql immutable set search_path=public as $$
declare parsed timestamptz;
begin
 if p_value is null or p_value='null'::jsonb then return null; end if;
 if jsonb_typeof(p_value)='number' then
 if (p_value#>>'{}') !~ '^[0-9]+$' or (p_value#>>'{}')::numeric not between 1 and 253402300799 then raise exception 'Invalid tax registration effective date'; end if;
 parsed:=to_timestamp((p_value#>>'{}')::double precision);
 elsif jsonb_typeof(p_value)='string' then
 if (p_value#>>'{}') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9:.]+(Z|[+-][0-9]{2}:[0-9]{2})$' then raise exception 'Invalid tax registration effective date'; end if;
 parsed:=(p_value#>>'{}')::timestamptz;
 else raise exception 'Invalid tax registration effective date'; end if;
 if parsed<=timestamptz '1970-01-01T00:00:00Z' then raise exception 'Invalid tax registration effective date'; end if;
 return parsed;
end $$;
create function public.market_tax_sync_provider(p_provider jsonb) returns jsonb language plpgsql security definer set search_path=public as $$
declare previous jsonb; sanitized jsonb; checked timestamptz; connected boolean; registration jsonb; registrations jsonb:='[]'; active_from timestamptz; expires_at timestamptz; office jsonb;
begin
 if p_provider is null or jsonb_typeof(p_provider)<>'object' or jsonb_typeof(p_provider->'connected') is distinct from 'boolean' or jsonb_typeof(p_provider->'registrations') is distinct from 'array'
 then raise exception using errcode='22023',message='A verified tax provider state is required.'; end if;
 connected:=(p_provider->>'connected')::boolean; checked:=(p_provider->>'checked_at')::timestamptz;
 if checked is null or checked>now()+interval '5 minutes' or (connected and coalesce(p_provider->>'account_id','') !~ '^acct_[A-Za-z0-9_]+$')
 or coalesce(p_provider->>'mode','') not in ('','live','test') or length(coalesce(p_provider->>'status',''))>80 or length(coalesce(p_provider->>'error',''))>600
 or (p_provider->'head_office' is not null and p_provider->'head_office'<>'null'::jsonb and jsonb_typeof(p_provider->'head_office')<>'object') or jsonb_array_length(p_provider->'registrations')>2000
 then raise exception using errcode='22023',message='Invalid tax provider state.'; end if;
 if jsonb_typeof(p_provider->'head_office')='object' then
 office:=jsonb_build_object('country',p_provider->'head_office'->>'country','state',p_provider->'head_office'->>'state','city',p_provider->'head_office'->>'city','postal_code',p_provider->'head_office'->>'postal_code','line1',p_provider->'head_office'->>'line1');
 if coalesce(office->>'country','') !~ '^[A-Z]{2}$' or length(office::text)>2000 then raise exception using errcode='22023',message='Invalid tax provider head office.'; end if;
 end if;
 for registration in select value from jsonb_array_elements(p_provider->'registrations') loop
 if jsonb_typeof(registration)<>'object' or length(coalesce(registration->>'id','')) not between 1 and 160 or coalesce(registration->>'country','') !~ '^[A-Z]{2}$'
 or coalesce(registration->>'status','') not in ('active','scheduled','expired') or length(coalesce(registration->>'state',''))>80
 then raise exception using errcode='22023',message='Invalid verified tax registration.'; end if;
 active_from:=market_tax_registration_timestamp(registration->'active_from'); expires_at:=market_tax_registration_timestamp(registration->'expires_at');
 if active_from is null or (expires_at is not null and expires_at<=active_from) then raise exception using errcode='22023',message='Tax registrations need valid effective dates.'; end if;
 registrations:=registrations||jsonb_build_array(jsonb_build_object('id',registration->>'id','country',registration->>'country','state',registration->>'state','status',registration->>'status','active_from',registration->'active_from','expires_at',registration->'expires_at'));
 end loop;
 sanitized:=jsonb_build_object('connected',connected,'account_id',p_provider->>'account_id','mode',p_provider->>'mode','status',coalesce(p_provider->>'status','unknown'),
 'head_office',office,'registrations',registrations,'checked_at',checked,'error',p_provider->>'error');
 select state into previous from platform_market_tax_provider where id for update;
 if previous->>'checked_at' is not null and checked<=(previous->>'checked_at')::timestamptz then return previous; end if;
 update platform_market_tax_provider set state=sanitized where id;
 return sanitized;
end $$;
create function public.market_tax_save_settings(p_version integer,p_values jsonb) returns jsonb language plpgsql security definer set search_path=public as $$
declare actor uuid:=market_billing_require_admin(); s platform_market_tax_settings; next_code text; next_enabled boolean; provider jsonb; account text;
begin
 if p_values is null or jsonb_typeof(p_values)<>'object' then raise exception using errcode='22023',message='Enter automatic tax settings.'; end if;
 select * into s from platform_market_tax_settings where id for update;
 if p_version is distinct from s.version then raise exception using errcode='40001',message='Automatic tax settings changed. Refresh and try again.'; end if;
 next_code:=case when p_values ? 'default_tax_code' then nullif(btrim(p_values->>'default_tax_code'),'') else s.default_tax_code end;
 if next_code is not null and next_code !~ '^txcd_[0-9]{8}$' then raise exception using errcode='22023',message='Select a valid Stripe product tax code.'; end if;
 next_enabled:=coalesce((p_values->>'enabled')::boolean,s.enabled);
 if next_enabled and not market_tax_local_ready(next_code) then raise exception using errcode='22023',message='Choose a default tax code or a tax code for every available plugin before enabling automatic tax.'; end if;
 if next_enabled then
 select state into provider from platform_market_tax_provider where id for share;
 select public_config->>'accountId' into account from platform_payment_settings where id for share;
 if provider->'connected' is distinct from 'true'::jsonb or provider->>'status' is distinct from 'active' or provider->>'mode' is distinct from 'live'
 or provider->'head_office' is null or provider->'head_office'='null'::jsonb or provider->>'account_id' is distinct from account or account is null
 or provider->>'checked_at' is null or (provider->>'checked_at')::timestamptz<now()-interval '24 hours'
 then raise exception using errcode='22023',message='Refresh the live tax provider and complete its head-office setup before enabling automatic tax.'; end if;
 if not exists(select 1 from jsonb_array_elements(provider->'registrations') r where r.value->>'status'='active'
 and market_tax_registration_timestamp(r.value->'active_from')<=now() and (market_tax_registration_timestamp(r.value->'expires_at') is null or market_tax_registration_timestamp(r.value->'expires_at')>now()))
 then raise exception using errcode='22023',message='Review taxable products and required active registrations before enabling tax collection.'; end if;
 end if;
 update platform_market_tax_settings set enabled=next_enabled,default_tax_code=next_code,
 price_behavior=coalesce(p_values->>'price_behavior',s.price_behavior),version=version+1,updated_at=now() where id returning * into s;
 perform market_billing_audit(actor,'market.tax.settings.save',null,jsonb_build_object('enabled',s.enabled,'price_behavior',s.price_behavior,'default_tax_code',s.default_tax_code,'version',s.version));
 return to_jsonb(s);
end $$;
create function public.market_tax_save_product(p_plugin text,p_tax_code text,p_version integer) returns jsonb language plpgsql security definer set search_path=public as $$
declare actor uuid:=market_billing_require_admin(); s platform_market_tax_settings; t platform_market_tax_products; next_code text:=nullif(btrim(p_tax_code),'');
begin
 if p_plugin is null or not exists(select 1 from market_billing_catalog where plugin_id=p_plugin) then raise exception using errcode='22023',message='Choose a plugin from the billing catalog.'; end if;
 if next_code is not null and next_code !~ '^txcd_[0-9]{8}$' then raise exception using errcode='22023',message='Select a valid Stripe product tax code.'; end if;
 select * into s from platform_market_tax_settings where id for update;
 select * into t from platform_market_tax_products where plugin_id=p_plugin for update;
 if found then
 if p_version is distinct from t.version then raise exception using errcode='40001',message='This plugin tax code changed. Refresh and try again.'; end if;
 update platform_market_tax_products set tax_code=next_code,version=version+1,updated_at=now() where plugin_id=p_plugin returning * into t;
 else
 if p_version is not null then raise exception using errcode='40001',message='This plugin tax code changed. Refresh and try again.'; end if;
 insert into platform_market_tax_products(plugin_id,tax_code) values(p_plugin,next_code) returning * into t;
 end if;
 if s.enabled and not market_tax_local_ready(s.default_tax_code) then raise exception using errcode='22023',message='This change removes a required tax code. Choose a default code or pause automatic tax first.'; end if;
 perform market_billing_audit(actor,'market.tax.product.save',null,jsonb_build_object('plugin_id',p_plugin,'tax_code',t.tax_code,'version',t.version));
 return to_jsonb(t);
end $$;

-- Processor-confirmed credit-note tax amounts are independent from gross card refunds.
create function public.market_tax_record_invoice(p_invoice jsonb) returns jsonb language plpgsql security definer set search_path=public as $$
declare p market_card_purchases; previous market_tax_invoices; recorded market_tax_invoices; source jsonb; item jsonb; note jsonb; note_item jsonb; proof market_tax_credit_notes;
 v_invoice text; v_purchase uuid; v_account text; amount integer; subtotal integer; tax integer; refunded integer; input_refunded integer; input_reconciled integer;
 country text; state text; occurred timestamptz; refund_time timestamptz; breakdown jsonb:='[]'; credits jsonb:='[]'; next_credits jsonb:='[]';
 rate text; old_credit integer; next_credit integer; credit_total integer:=0; reconciled integer:=0; supplied_credits boolean; any_delta boolean:=false; new_invoice boolean:=false;
 notes_supplied boolean; note_id text; note_time timestamptz; note_amount integer; note_credits jsonb; notes jsonb:='[]'; notes_gross bigint:=0; notes_tax integer; notes_tax_by_rate jsonb:='[]';
begin
 if p_invoice is null or jsonb_typeof(p_invoice)<>'object' then raise exception using errcode='22023',message='A verified tax invoice is required.'; end if;
 v_invoice:=p_invoice->>'invoice_id'; v_purchase:=(p_invoice->>'purchase_id')::uuid; v_account:=p_invoice->>'account_id';
 if v_invoice is null or v_invoice !~ '^in_[A-Za-z0-9_]+$' or v_account is null or v_account !~ '^acct_[A-Za-z0-9_]+$'
 or p_invoice->>'currency' is distinct from 'usd' or p_invoice->'automatic_tax' is distinct from 'true'::jsonb
 or jsonb_typeof(p_invoice->'amount_cents') is distinct from 'number' or jsonb_typeof(p_invoice->'subtotal_cents') is distinct from 'number'
 or jsonb_typeof(p_invoice->'tax_cents') is distinct from 'number' or jsonb_typeof(p_invoice->'refunded_cents') is distinct from 'number'
 or jsonb_typeof(p_invoice->'tax_breakdown') is distinct from 'array' then raise exception using errcode='22023',message='Invalid verified automatic tax invoice.'; end if;
 if (p_invoice->>'amount_cents') !~ '^[0-9]+$' or (p_invoice->>'subtotal_cents') !~ '^[0-9]+$' or (p_invoice->>'tax_cents') !~ '^[0-9]+$' or (p_invoice->>'refunded_cents') !~ '^[0-9]+$'
 then raise exception using errcode='22023',message='Invoice amounts must be whole cents.'; end if;
 amount:=(p_invoice->>'amount_cents')::integer; subtotal:=(p_invoice->>'subtotal_cents')::integer; tax:=(p_invoice->>'tax_cents')::integer; input_refunded:=(p_invoice->>'refunded_cents')::integer; refunded:=input_refunded;
 country:=upper(btrim(p_invoice->>'country')); state:=nullif(upper(btrim(p_invoice->>'state')),''); occurred:=(p_invoice->>'occurred_at')::timestamptz;
 if amount not between 1 and 200000000 or subtotal<0 or tax<0 or refunded not between 0 and amount or subtotal::bigint+tax<>amount
 or country is null or country !~ '^[A-Z]{2}$' or length(coalesce(state,''))>80 or occurred is null or occurred>now()+interval '5 minutes'
 or jsonb_array_length(p_invoice->'tax_breakdown')>100 then raise exception using errcode='22023',message='Invoice tax amounts or location are invalid.'; end if;
 select * into p from market_card_purchases where id=v_purchase;
 if p.id is null then raise exception using errcode='22023',message='Tax invoice purchase not found.'; end if;
 perform pg_advisory_xact_lock(hashtextextended('market.order:'||p.salon_id::text||':'||p.plugin_id,0));
 select * into p from market_card_purchases where id=v_purchase for update;
 if p.snapshot->>'account_id' is distinct from v_account or coalesce((p.snapshot->'automatic_tax'->>'enabled')::boolean,false) is not true
 then raise exception using errcode='22023',message='Invoice does not match the frozen automatic tax purchase.'; end if;
 if p.snapshot->'automatic_tax'->>'price_behavior'='exclusive' then
 if subtotal<>p.amount_cents then raise exception using errcode='22023',message='Invoice subtotal does not match the quoted price.'; end if;
 elsif p.snapshot->'automatic_tax'->>'price_behavior'='inclusive' then
 if amount<>p.amount_cents then raise exception using errcode='22023',message='Tax-inclusive invoice total does not match the quoted price.'; end if;
 else raise exception using errcode='22023',message='The purchase tax behavior is invalid.'; end if;
 for source in select value from jsonb_array_elements(p_invoice->'tax_breakdown') loop
 if jsonb_typeof(source)<>'object' or jsonb_typeof(source->'tax_cents') is distinct from 'number' or (source->>'tax_cents') !~ '^[0-9]+$'
 or length(btrim(coalesce(source->>'jurisdiction',''))) not between 1 and 160
 then raise exception using errcode='22023',message='Every tax allocation needs a verified jurisdiction and whole-cent amount.'; end if;
 if (source->>'tax_cents')::integer=0 then continue; end if;
 if coalesce(source->>'tax_rate_id','') !~ '^txr_[A-Za-z0-9_]+$' then raise exception using errcode='22023',message='Every positive tax allocation needs its processor tax rate ID.'; end if;
 item:=jsonb_build_object('jurisdiction',btrim(source->>'jurisdiction'),'country',upper(coalesce(nullif(btrim(source->>'country'),''),country)),
 'state',nullif(upper(coalesce(nullif(btrim(source->>'state'),''),state)),''),'tax_cents',(source->>'tax_cents')::integer,
 'tax_type',source->>'tax_type','rate_bps',source->'rate_bps','tax_rate_id',source->>'tax_rate_id','tax_code',source->>'tax_code');
 if item->>'country' !~ '^[A-Z]{2}$' or length(coalesce(item->>'state',''))>80 then raise exception using errcode='22023',message='Tax jurisdiction location is invalid.'; end if;
 breakdown:=breakdown||jsonb_build_array(item);
 end loop;
 -- A rate may repeat only for identical jurisdiction facts (for example multiple invoice lines).
 select coalesce(jsonb_agg(x.facts||jsonb_build_object('tax_cents',x.cents) order by x.facts->>'tax_rate_id'),'[]') into breakdown
 from (select q.value-'tax_cents' as facts,sum((q.value->>'tax_cents')::integer) as cents from jsonb_array_elements(breakdown) q group by q.value-'tax_cents') x;
 if (select count(*)<>count(distinct q.value->>'tax_rate_id') from jsonb_array_elements(breakdown) q) then raise exception using errcode='22023',message='A tax rate cannot represent conflicting jurisdictions.'; end if;
 if (select coalesce(sum((q.value->>'tax_cents')::integer),0) from jsonb_array_elements(breakdown) q)<>tax then raise exception using errcode='22023',message='Tax jurisdiction allocations do not equal the invoice tax.'; end if;
 supplied_credits:=p_invoice ? 'refund_tax_breakdown';
 if supplied_credits then
 input_reconciled:=0;
 if p_invoice ? 'refunds_reconciled_cents' then
 if jsonb_typeof(p_invoice->'refunds_reconciled_cents') is distinct from 'number' or (p_invoice->>'refunds_reconciled_cents') !~ '^[0-9]+$'
 then raise exception using errcode='22023',message='Verified credit-note coverage must be whole cents.'; end if;
 input_reconciled:=(p_invoice->>'refunds_reconciled_cents')::integer;
 if input_reconciled>input_refunded then raise exception using errcode='22023',message='Credit-note coverage cannot exceed the confirmed gross refund.'; end if;
 end if;
 if jsonb_typeof(p_invoice->'refund_tax_breakdown') is distinct from 'array' or jsonb_array_length(p_invoice->'refund_tax_breakdown')>100 then raise exception using errcode='22023',message='Verified credit-note tax allocations must be an array.'; end if;
 for source in select value from jsonb_array_elements(p_invoice->'refund_tax_breakdown') loop
 rate:=source->>'tax_rate_id';
 if jsonb_typeof(source)<>'object' or coalesce(rate,'') !~ '^txr_[A-Za-z0-9_]+$' or jsonb_typeof(source->'tax_cents') is distinct from 'number' or (source->>'tax_cents') !~ '^[0-9]+$'
 or not exists(select 1 from jsonb_array_elements(breakdown) q where q.value->>'tax_rate_id'=rate)
 then raise exception using errcode='22023',message='Credit-note tax allocations must match the original invoice tax rates.'; end if;
 if exists(select 1 from jsonb_array_elements(credits) q where q.value->>'tax_rate_id'=rate) then raise exception using errcode='22023',message='Credit-note tax rate IDs must be unique.'; end if;
 credits:=credits||jsonb_build_array(jsonb_build_object('tax_rate_id',rate,'tax_cents',(source->>'tax_cents')::integer));
 end loop;
 end if;
 notes_supplied:=p_invoice ? 'credit_notes';
 if notes_supplied then
 if jsonb_typeof(p_invoice->'credit_notes') is distinct from 'array' or jsonb_array_length(p_invoice->'credit_notes')>10000 then raise exception using errcode='22023',message='Verified credit notes must be a complete array.'; end if;
 for note in select value from jsonb_array_elements(p_invoice->'credit_notes') loop
 note_id:=note->>'id'; note_time:=(note->>'occurred_at')::timestamptz;
 if jsonb_typeof(note)<>'object' or coalesce(note_id,'') !~ '^cn_[A-Za-z0-9_]+$' or jsonb_typeof(note->'amount_cents') is distinct from 'number' or (note->>'amount_cents') !~ '^[0-9]+$'
 or jsonb_typeof(note->'tax_breakdown') is distinct from 'array' or jsonb_array_length(note->'tax_breakdown')>100 or note_time is null or note_time<=timestamptz '1970-01-01T00:00:00Z' or note_time>now()+interval '5 minutes'
 then raise exception using errcode='22023',message='Every verified credit note needs its ID, effective date, whole-cent total and tax allocations.'; end if;
 note_amount:=(note->>'amount_cents')::integer;
 if note_amount not between 1 and amount then raise exception using errcode='22023',message='Credit-note amount cannot exceed the original invoice.'; end if;
 if exists(select 1 from jsonb_array_elements(notes) n where n.value->>'id'=note_id) then raise exception using errcode='22023',message='Credit-note IDs must be unique.'; end if;
 note_credits:='[]'; notes_tax:=0;
 for source in select value from jsonb_array_elements(note->'tax_breakdown') loop
 rate:=source->>'tax_rate_id';
 if jsonb_typeof(source)<>'object' or coalesce(rate,'') !~ '^txr_[A-Za-z0-9_]+$' or jsonb_typeof(source->'tax_cents') is distinct from 'number' or (source->>'tax_cents') !~ '^[0-9]+$'
 or not exists(select 1 from jsonb_array_elements(breakdown) q where q.value->>'tax_rate_id'=rate)
 then raise exception using errcode='22023',message='Credit-note tax allocations must match the original invoice tax rates.'; end if;
 if exists(select 1 from jsonb_array_elements(note_credits) q where q.value->>'tax_rate_id'=rate) then raise exception using errcode='22023',message='Each credit note must have unique tax rate IDs.'; end if;
 if (source->>'tax_cents')::integer=0 then continue; end if;
 note_credits:=note_credits||jsonb_build_array(jsonb_build_object('tax_rate_id',rate,'tax_cents',(source->>'tax_cents')::integer));
 notes_tax:=notes_tax+(source->>'tax_cents')::integer;
 end loop;
 if notes_tax>note_amount then raise exception using errcode='22023',message='Credit-note tax cannot exceed its gross amount.'; end if;
 select coalesce(jsonb_agg(q.value order by q.value->>'tax_rate_id'),'[]') into note_credits from jsonb_array_elements(note_credits) q;
 notes:=notes||jsonb_build_array(jsonb_build_object('id',note_id,'occurred_at',note_time,'amount_cents',note_amount,'tax_breakdown',note_credits));
 notes_gross:=notes_gross+note_amount;
 end loop;
 if notes_gross<>coalesce(input_reconciled,0) then raise exception using errcode='22023',message='Verified credit-note totals do not equal their covered gross refunds.'; end if;
 select coalesce(jsonb_agg(jsonb_build_object('tax_rate_id',n.rate,'tax_cents',n.cents) order by n.rate),'[]') into notes_tax_by_rate from (
 select q.value->>'tax_rate_id' as rate,sum((q.value->>'tax_cents')::integer) as cents from jsonb_array_elements(notes) n cross join lateral jsonb_array_elements(n.value->'tax_breakdown') q group by q.value->>'tax_rate_id') n;
 if exists(select 1 from jsonb_array_elements(credits) c full join jsonb_array_elements(notes_tax_by_rate) n on c.value->>'tax_rate_id'=n.value->>'tax_rate_id'
 where coalesce((c.value->>'tax_cents')::integer,0)<>coalesce((n.value->>'tax_cents')::integer,0)) then raise exception using errcode='22023',message='Credit-note tax totals do not equal the cumulative verified tax credits.'; end if;
 end if;
 perform pg_advisory_xact_lock(hashtextextended('market.tax.invoice:'||v_invoice,0));
 select * into previous from market_tax_invoices where invoice_id=v_invoice for update;
 if found then
 if previous.purchase_id<>v_purchase or previous.account_id<>v_account or previous.amount_cents<>amount or previous.subtotal_cents<>subtotal or previous.tax_cents<>tax
 or previous.currency<>'usd' or previous.country<>country or previous.state is distinct from state or previous.tax_breakdown<>breakdown or previous.occurred_at<>occurred
 then raise exception using errcode='22023',message='Original invoice tax facts cannot be changed.'; end if;
 refunded:=greatest(refunded,previous.refunded_cents); reconciled:=previous.refunds_reconciled_cents;
 else
 insert into market_tax_invoices(invoice_id,purchase_id,account_id,amount_cents,subtotal_cents,tax_cents,currency,automatic_tax,country,state,tax_breakdown,occurred_at)
 values(v_invoice,v_purchase,v_account,amount,subtotal,tax,'usd',true,country,state,breakdown,occurred) returning * into previous;
 new_invoice:=true;
 for item in select value from jsonb_array_elements(breakdown) loop
 insert into market_tax_ledger(invoice_id,purchase_id,entry_key,kind,country,state,jurisdiction,tax_cents,occurred_at,metadata)
 values(v_invoice,v_purchase,'sale:'||(item->>'tax_rate_id'),'sale',item->>'country',item->>'state',item->>'jurisdiction',(item->>'tax_cents')::integer,occurred,
 (item-'country'-'state'-'jurisdiction'-'tax_cents')||jsonb_build_object('account_id',v_account,'price_behavior',p.snapshot->'automatic_tax'->>'price_behavior'));
 end loop;
 end if;
 if supplied_credits then reconciled:=greatest(reconciled,input_reconciled); end if;
 if tax=0 then reconciled:=refunded; end if;
 refund_time:=(p_invoice->>'refund_occurred_at')::timestamptz;
 if notes_supplied then
 if jsonb_array_length(notes)>0 and exists(select 1 from market_tax_ledger where invoice_id=v_invoice and kind='refund' and entry_key like 'refund:%') then raise exception using errcode='22023',message='Legacy cumulative tax credits need accounting review before adding credit-note proofs.'; end if;
 for note in select value from jsonb_array_elements(notes) loop
 note_id:=note->>'id'; note_time:=(note->>'occurred_at')::timestamptz; note_amount:=(note->>'amount_cents')::integer;
 select * into proof from market_tax_credit_notes where id=note_id for update;
 if found then
 if proof.invoice_id<>v_invoice or proof.purchase_id<>v_purchase or proof.amount_cents<>note_amount or proof.occurred_at<>note_time or proof.tax_breakdown<>note->'tax_breakdown'
 then raise exception using errcode='22023',message='Original credit-note facts cannot be changed.'; end if;
 continue;
 end if;
 insert into market_tax_credit_notes(id,invoice_id,purchase_id,amount_cents,tax_breakdown,occurred_at) values(note_id,v_invoice,v_purchase,note_amount,note->'tax_breakdown',note_time);
 for note_item in select value from jsonb_array_elements(note->'tax_breakdown') loop
 select q.value into item from jsonb_array_elements(breakdown) q where q.value->>'tax_rate_id'=note_item->>'tax_rate_id';
 insert into market_tax_ledger(invoice_id,purchase_id,entry_key,kind,country,state,jurisdiction,tax_cents,occurred_at,metadata)
 values(v_invoice,v_purchase,'credit:'||note_id||':'||(note_item->>'tax_rate_id'),'refund',item->>'country',item->>'state',item->>'jurisdiction',-(note_item->>'tax_cents')::integer,note_time,
 (item-'country'-'state'-'jurisdiction'-'tax_cents')||jsonb_build_object('account_id',v_account,'credit_note_id',note_id,'invoice_refunded_cents',refunded,'allocation_method','processor_credit_note'));
 any_delta:=true;
 end loop;
 refund_time:=greatest(refund_time,note_time);
 end loop;
 end if;
 for item in select value from jsonb_array_elements(breakdown) loop
 rate:=item->>'tax_rate_id';
 select coalesce(max((q.value->>'tax_cents')::integer),0) into old_credit from jsonb_array_elements(previous.refunded_tax_breakdown) q where q.value->>'tax_rate_id'=rate;
 select greatest(old_credit,coalesce(max((q.value->>'tax_cents')::integer),0)) into next_credit from jsonb_array_elements(credits) q where q.value->>'tax_rate_id'=rate;
 if next_credit>(item->>'tax_cents')::integer then raise exception using errcode='22023',message='Credited tax cannot exceed the original jurisdiction tax.'; end if;
 if next_credit>old_credit and not notes_supplied then
 if exists(select 1 from market_tax_credit_notes where invoice_id=v_invoice) then raise exception using errcode='22023',message='Provide the original credit notes to reconcile additional tax credits.'; end if;
 if refund_time is null or refund_time<occurred or refund_time>now()+interval '5 minutes' then raise exception using errcode='22023',message='A verified credit-note timestamp is required for tax reversals.'; end if;
 insert into market_tax_ledger(invoice_id,purchase_id,entry_key,kind,country,state,jurisdiction,tax_cents,occurred_at,metadata)
 values(v_invoice,v_purchase,'refund:'||rate||':'||next_credit,'refund',item->>'country',item->>'state',item->>'jurisdiction',old_credit-next_credit,refund_time,
 (item-'country'-'state'-'jurisdiction'-'tax_cents')||jsonb_build_object('account_id',v_account,'invoice_refunded_cents',refunded,'allocation_method','processor_credit_note','cumulative_refunded_tax_cents',next_credit));
 any_delta:=true;
 end if;
 if next_credit>0 then next_credits:=next_credits||jsonb_build_array(jsonb_build_object('tax_rate_id',rate,'tax_cents',next_credit)); end if;
 credit_total:=credit_total+next_credit;
 end loop;
 if notes_supplied and exists(select 1 from jsonb_array_elements(next_credits) c full join (
 select q.value->>'tax_rate_id' as rate,sum((q.value->>'tax_cents')::integer)::integer as cents from market_tax_credit_notes n cross join lateral jsonb_array_elements(n.tax_breakdown) q where n.invoice_id=v_invoice group by q.value->>'tax_rate_id') n
 on c.value->>'tax_rate_id'=n.rate where coalesce((c.value->>'tax_cents')::integer,0)<>coalesce(n.cents,0)) then raise exception using errcode='22023',message='Recorded credit notes do not match the cumulative tax credit facts.'; end if;
 if notes_supplied and (select coalesce(sum(amount_cents),0) from market_tax_credit_notes where invoice_id=v_invoice)>refunded then raise exception using errcode='22023',message='Recorded credit notes cannot exceed confirmed cumulative gross refunds.'; end if;
 if credit_total>refunded or credit_total>reconciled then raise exception using errcode='22023',message='Credited tax cannot exceed the confirmed gross refund or its verified credit-note coverage.'; end if;
 update market_tax_invoices set refunded_cents=refunded,refunded_tax_cents=credit_total,refunded_tax_breakdown=next_credits,refunds_reconciled_cents=reconciled,
 reconciliation_required=tax>0 and (refunded>reconciled or (refunded=amount and credit_total<tax)),
 refund_occurred_at=case when any_delta then greatest(previous.refund_occurred_at,refund_time) else previous.refund_occurred_at end,updated_at=now()
 where invoice_id=v_invoice returning * into recorded;
 if new_invoice then
 insert into market_system_audit(action,details) values('market.tax.invoice.record',jsonb_build_object('invoice_id',v_invoice,'purchase_id',v_purchase,'amount_cents',amount,'tax_cents',tax));
 end if;
 if refunded>previous.refunded_cents or any_delta or reconciled>previous.refunds_reconciled_cents then
 insert into market_system_audit(action,details) values('market.tax.refund.reconcile',jsonb_build_object('invoice_id',v_invoice,'purchase_id',v_purchase,'refunded_cents',refunded,'refunded_tax_cents',credit_total,'refunds_reconciled_cents',reconciled,'reconciliation_required',recorded.reconciliation_required));
 end if;
 return to_jsonb(recorded);
end $$;

create or replace function public.market_card_reserve(p_salon uuid,p_plugin text) returns jsonb language plpgsql security definer set search_path=public as $$
declare actor uuid; c market_billing_catalog; s market_billing_settings; p market_card_purchases; cfg jsonb; ts platform_market_tax_settings;
 sub text; until_time timestamptz; checkout text; amount integer; saved_customer text; actor_email text; tax_code text; product_version integer; tax_snapshot jsonb;
begin
 perform market_billing_require_owner(p_salon); actor:=current_public_user_id();
 perform pg_advisory_xact_lock(hashtextextended('market.order:'||p_salon::text||':'||p_plugin,0));
 select public_config into cfg from platform_payment_settings where id;
 if not coalesce((cfg->>'enabled')::boolean,false) or cfg->>'mode'<>'live' then raise exception 'Card payments are not connected.'; end if;
 select * into c from market_billing_catalog where plugin_id=p_plugin and published and fulfillment_ready for share;
 if c.plugin_id is null or p_plugin not in ('vietnamese-language','booking-policy','booking-deposit','checkin-receipt') then raise exception 'This plugin is not ready for card payments.'; end if;
 select * into p from market_card_purchases where salon_id=p_salon and plugin_id=p_plugin and status not in ('expired','canceled','refunded') for update;
 if found then
 if p.payer_id<>actor then raise exception 'Another owner is managing this subscription.'; end if;
 return to_jsonb(p); end if;
 if p_plugin='vietnamese-language' then select stripe_subscription,paid_until,checkout_session into sub,until_time,checkout from vietnamese_plugin_subscriptions where salon_id=p_salon for update;
 elsif p_plugin='booking-policy' then select stripe_subscription,paid_until,stripe_checkout into sub,until_time,checkout from booking_policy_subscriptions where salon_id=p_salon for update;
 elsif p_plugin='booking-deposit' then select stripe_subscription,paid_until,stripe_checkout into sub,until_time,checkout from booking_deposit_subscriptions where salon_id=p_salon for update;
 else select stripe_subscription,paid_until,stripe_checkout into sub,until_time,checkout from checkin_receipt_subscriptions where salon_id=p_salon for update; end if;
 if sub is not null or checkout is not null or until_time>now() then raise exception 'Existing billing or paid access must finish before a new subscription starts.'; end if;
 if exists(select 1 from market_bank_orders where salon_id=p_salon and plugin_id=p_plugin and (status in ('awaiting_payment','partially_paid','refund_pending') or unapplied_cents>0)) then raise exception 'An earlier bank order needs to be resolved before paying by card.'; end if;
 select * into s from market_billing_settings where id for share;
 select * into ts from platform_market_tax_settings where id for share;
 select t.tax_code,t.version into tax_code,product_version from platform_market_tax_products t where plugin_id=p_plugin for share;
 tax_code:=coalesce(tax_code,ts.default_tax_code);
 if ts.enabled then
 if tax_code is null then raise exception 'Configure a product tax code before opening automatic tax checkout.'; end if;
 amount:=c.price_cents+round(c.price_cents::numeric*s.fee_bps/10000)::integer+s.fixed_fee_cents;
 else
 amount:=c.price_cents+round(c.price_cents::numeric*s.tax_bps/10000)::integer;
 amount:=amount+round(amount::numeric*s.fee_bps/10000)::integer+s.fixed_fee_cents;
 end if;
 tax_snapshot:=jsonb_build_object('enabled',ts.enabled,'price_behavior',ts.price_behavior,'tax_code',tax_code,'settings_version',ts.version,'product_version',product_version);
 select customer_id into saved_customer from market_card_purchases where salon_id=p_salon and payer_id=actor and customer_id is not null and snapshot->>'account_id'=cfg->>'accountId' order by created_at desc limit 1;
 select email into actor_email from users where id=actor;
 insert into market_card_purchases(salon_id,payer_id,plugin_id,amount_cents,snapshot)
 values(p_salon,actor,p_plugin,amount,jsonb_build_object('name',c.name,'publisher',c.publisher,'commission_bps',c.commission_bps,'price_cents',c.price_cents,'catalog_version',c.version,'settings_version',s.version,
 'tax_bps',case when ts.enabled then 0 else s.tax_bps end,'fee_bps',s.fee_bps,'fixed_fee_cents',s.fixed_fee_cents,'currency','usd','interval','month','account_id',cfg->>'accountId',
 'customer_id',saved_customer,'customer_email',actor_email,'automatic_tax',tax_snapshot)) returning * into p;
 return to_jsonb(p);
end $$;

-- Keep the existing card lifecycle and signature, adding a verified tax-invoice amount guard.
create or replace function public.market_card_apply(p_id uuid,p_subscription text,p_customer text,p_status text,p_invoice text,p_amount integer,p_refunded integer,p_intent text,p_until timestamptz,p_observed timestamptz) returns void language plpgsql security definer set search_path=public as $$
declare p market_card_purchases; grant_until timestamptz; linked text; target text; ti market_tax_invoices; expected_amount integer;
begin
 select * into p from market_card_purchases where id=p_id;
 if p.id is null then raise exception 'Unknown purchase'; end if;
 perform pg_advisory_xact_lock(hashtextextended('market.order:'||p.salon_id::text||':'||p.plugin_id,0));
 select * into p from market_card_purchases where id=p_id for update;
 if p.synced_at is not null and p_observed<=p.synced_at then return; end if;
 if p.subscription_id is not null and p.subscription_id<>p_subscription then raise exception 'Subscription mismatch'; end if;
 expected_amount:=p.amount_cents;
 if p_amount is not null and coalesce((p.snapshot->'automatic_tax'->>'enabled')::boolean,false) then
 select * into ti from market_tax_invoices where invoice_id=p_invoice and purchase_id=p.id;
 if ti.invoice_id is null or ti.account_id is distinct from p.snapshot->>'account_id' then raise exception 'A verified automatic tax invoice is required before activating this purchase'; end if;
 expected_amount:=ti.amount_cents;
 p_refunded:=greatest(p_refunded,ti.refunded_cents);
 end if;
 if p_amount is not null and p_amount<>expected_amount then raise exception 'Invoice amount mismatch'; end if;
 p_refunded:=greatest(p_refunded,coalesce((select refunded_cents from market_card_invoices where id=p_invoice),0));
 if p_refunded<0 or p_refunded>coalesce(p_amount,0) then raise exception 'Invalid refund'; end if;
 grant_until:=case when p_amount=expected_amount and p_refunded<p_amount then p_until else null end;
 if grant_until is not null and (not exists(select 1 from locations where id=p.salon_id and status='active') or not coalesce(lifecycle_user_is_salon_owner(p.salon_id,p.payer_id,false),false)) then raise exception 'Payment owner is no longer authorized; billing review required'; end if;
 target:=case p.plugin_id when 'vietnamese-language' then 'vietnamese_plugin_subscriptions' when 'booking-policy' then 'booking_policy_subscriptions' when 'booking-deposit' then 'booking_deposit_subscriptions' when 'checkin-receipt' then 'checkin_receipt_subscriptions' end;
 if target is null then raise exception 'Unsupported plugin'; end if;
 execute format('select stripe_subscription from public.%I where salon_id=$1 for update',target) into linked using p.salon_id;
 if linked is not null and linked<>p_subscription then
 if p.status='canceled' then return; end if;
 raise exception 'Newer subscription exists'; end if;
 if p.plugin_id='vietnamese-language' then
 insert into vietnamese_plugin_subscriptions(salon_id,installed,paid_until,payment_owner,trial_ends_at,stripe_subscription,stripe_customer)
 values(p.salon_id,true,grant_until,p.payer_id,now(),p_subscription,p_customer)
 on conflict(salon_id) do update set installed=case when p.subscription_id is null then true else vietnamese_plugin_subscriptions.installed end,paid_until=excluded.paid_until,payment_owner=excluded.payment_owner,stripe_subscription=excluded.stripe_subscription,stripe_customer=excluded.stripe_customer,checkout_reference=null,checkout_owner=null,checkout_session=null,updated_at=now();
 else
 execute format('insert into public.%I(salon_id,paid_until,payment_owner,stripe_subscription,stripe_customer) values($1,$2,$3,$4,$5) on conflict(salon_id) do update set paid_until=excluded.paid_until,payment_owner=excluded.payment_owner,stripe_subscription=excluded.stripe_subscription,stripe_customer=excluded.stripe_customer,stripe_checkout=null,updated_at=now()',target) using p.salon_id,grant_until,p.payer_id,p_subscription,p_customer;
 if p.plugin_id='booking-deposit' and p.subscription_id is null then update booking_deposit_subscriptions set installed=true where salon_id=p.salon_id; end if;
 end if;
 if p_status='canceled' then execute format('update public.%I set stripe_subscription=null where salon_id=$1 and stripe_subscription=$2',target) using p.salon_id,p_subscription; end if;
 update market_card_purchases set subscription_id=p_subscription,customer_id=p_customer,status=p_status,paid_until=grant_until,synced_at=p_observed,last_error=null,updated_at=now() where id=p.id;
 if p_invoice is not null then insert into market_card_invoices(id,purchase_id,amount_cents,refunded_cents,payment_intent,status,period_end)
 values(p_invoice,p.id,coalesce(p_amount,0),p_refunded,p_intent,case when p_amount is null then 'unpaid' when p_refunded=p_amount then 'refunded' when p_refunded>0 then 'partially_refunded' else 'paid' end,p_until)
 on conflict(id) do update set amount_cents=excluded.amount_cents,refunded_cents=excluded.refunded_cents,payment_intent=excluded.payment_intent,status=excluded.status,period_end=excluded.period_end,updated_at=now(); end if;
end $$;

revoke all on function public.market_tax_ledger_immutable(),public.market_tax_local_ready(text),public.market_tax_registration_timestamp(jsonb),public.market_tax_sync_provider(jsonb) from public,anon,authenticated;
revoke all on function public.market_tax_admin_state(timestamptz,timestamptz),public.market_tax_export_ledger(timestamptz,timestamptz),public.market_tax_save_settings(integer,jsonb),public.market_tax_save_product(text,text,integer),public.market_tax_record_invoice(jsonb) from public,anon,authenticated;
grant execute on function public.market_tax_admin_state(timestamptz,timestamptz),public.market_tax_export_ledger(timestamptz,timestamptz),public.market_tax_save_settings(integer,jsonb),public.market_tax_save_product(text,text,integer) to authenticated;
grant execute on function public.market_tax_record_invoice(jsonb),public.market_tax_sync_provider(jsonb) to service_role;
revoke all on function public.market_card_apply(uuid,text,text,text,text,integer,integer,text,timestamptz,timestamptz) from public,anon,authenticated;
grant execute on function public.market_card_apply(uuid,text,text,text,text,integer,integer,text,timestamptz,timestamptz) to service_role;
notify pgrst,'reload schema';
commit;
