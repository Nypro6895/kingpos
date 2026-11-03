begin;
create table public.check_writer_subscriptions (
 salon_id uuid primary key references public.locations(id) on delete cascade,
 paid_until timestamptz, stripe_subscription text unique, stripe_checkout text,
 checkout_reference uuid not null default gen_random_uuid(), stripe_customer text,
 payment_owner uuid references public.users(id), updated_at timestamptz not null default now()
);
create table public.check_writer_settings (
 salon_id uuid primary key references public.locations(id),
 bank_encrypted text not null, public_config jsonb not null,
 next_number bigint not null check(next_number between 1 and 10000000000),
 version integer not null default 1, updated_at timestamptz not null default now()
);
create table public.check_writer_batches (
 id uuid primary key, salon_id uuid not null references public.locations(id),
 actor_id uuid not null references public.users(id), request_hash text not null,
 created_at timestamptz not null default now()
);
create table public.check_writer_checks (
 id uuid primary key default gen_random_uuid(), salon_id uuid not null references public.locations(id),
 batch_id uuid not null references public.check_writer_batches(id),
 number bigint not null, snapshot jsonb not null,
 payroll_line_id uuid, payroll_staff_id uuid, period_start date, period_end date,
 status text not null default 'issued' check(status in ('issued','void')),
 created_by uuid not null references public.users(id), created_at timestamptz not null default now(),
 void_reason text, voided_by uuid references public.users(id), voided_at timestamptz,
 delivery_count integer not null default 0,
 unique(salon_id,number)
);
-- Also prevents paying the same staff/period again after regenerating payroll.
create unique index check_writer_one_active_payroll on public.check_writer_checks(salon_id,payroll_staff_id,period_start,period_end) where status='issued' and payroll_staff_id is not null;
create index check_writer_history on public.check_writer_checks(salon_id,created_at desc,id);
create table public.check_writer_events (
 id bigint generated always as identity primary key,
 salon_id uuid not null references public.locations(id), check_id uuid references public.check_writer_checks(id),
 actor_id uuid not null references public.users(id), action text not null,
 reason text, created_at timestamptz not null default now()
);
create table public.check_writer_unlock_limits(actor_id uuid primary key, window_start timestamptz not null default now(), attempts integer not null default 0);
do $$ declare t text; begin
 foreach t in array array['check_writer_subscriptions','check_writer_settings','check_writer_batches','check_writer_checks','check_writer_events','check_writer_unlock_limits'] loop
 execute format('alter table public.%I enable row level security',t);
 execute format('revoke all on public.%I from public,anon,authenticated',t);
 execute format('grant all on public.%I to service_role',t);
 end loop;
end $$;
grant usage,select on sequence public.check_writer_events_id_seq to service_role;

create function public.check_writer_assert(p_salon uuid,p_actor uuid,p_paid boolean default true) returns void
language plpgsql security definer set search_path=pg_catalog,public as $$ begin
 if not coalesce(public.lifecycle_user_is_salon_owner(p_salon,p_actor,false),false)
 or not exists(select 1 from public.locations where id=p_salon and status='active') then raise exception 'Check Writer requires the active salon Owner.'; end if;
 if p_paid and not exists(select 1 from public.check_writer_subscriptions where salon_id=p_salon and paid_until>now() and payment_owner=p_actor) then raise exception 'Activate Check Writer for this salon in Market.'; end if;
end $$;

create function public.check_writer_unlock_attempt(p_actor uuid) returns boolean
language plpgsql security definer set search_path=pg_catalog,public as $$ declare n integer; begin
 insert into public.check_writer_unlock_limits(actor_id,attempts) values(p_actor,1)
 on conflict(actor_id) do update set attempts=case when check_writer_unlock_limits.window_start<now()-interval '15 minutes' then 1 else check_writer_unlock_limits.attempts+1 end,
 window_start=case when check_writer_unlock_limits.window_start<now()-interval '15 minutes' then now() else check_writer_unlock_limits.window_start end returning attempts into n;
 return n<=5;
end $$;

create function public.check_writer_save_settings(p_salon uuid,p_actor uuid,p_bank text,p_config jsonb,p_next bigint,p_version integer) returns void
language plpgsql security definer set search_path=pg_catalog,public as $$ declare s public.check_writer_settings; begin
 perform public.check_writer_assert(p_salon,p_actor);
 perform pg_advisory_xact_lock(hashtextextended('check-writer:'||p_salon,0));
 select * into s from public.check_writer_settings where salon_id=p_salon for update;
 if coalesce(s.version,0)<>p_version then raise exception 'Settings changed. Reload before saving.'; end if;
 if p_next<=coalesce((select max(number) from public.check_writer_checks where salon_id=p_salon),0) then raise exception 'Check numbers cannot be reused, including void checks.'; end if;
 if s.salon_id is not null and p_next<s.next_number then raise exception 'Next check number cannot move backwards.'; end if;
 insert into public.check_writer_settings(salon_id,bank_encrypted,public_config,next_number) values(p_salon,p_bank,p_config,p_next)
 on conflict(salon_id) do update set bank_encrypted=excluded.bank_encrypted,public_config=excluded.public_config,next_number=excluded.next_number,version=check_writer_settings.version+1,updated_at=now();
 insert into public.check_writer_events(salon_id,actor_id,action) values(p_salon,p_actor,'settings_saved');
end $$;

create function public.check_writer_issue(p_salon uuid,p_actor uuid,p_batch uuid,p_hash text,p_version integer,p_items jsonb) returns jsonb
language plpgsql security definer set search_path=pg_catalog,public as $$
declare s public.check_writer_settings; b public.check_writer_batches; item jsonb; src jsonb; snap jsonb;
 line public.payroll_staff_lines; run public.payroll_runs; n bigint; result jsonb;
begin
 perform public.check_writer_assert(p_salon,p_actor);
 perform pg_advisory_xact_lock(hashtextextended('check-writer:'||p_salon,0));
 select * into b from public.check_writer_batches where id=p_batch;
 if b.id is not null then
 if b.salon_id<>p_salon or b.actor_id<>p_actor or b.request_hash<>p_hash then raise exception 'Request already used with different contents.'; end if;
 select jsonb_agg(id order by number) into result from public.check_writer_checks where batch_id=p_batch; return result;
 end if;
 if jsonb_typeof(p_items)<>'array' or jsonb_array_length(p_items) not between 1 and 100 then raise exception 'Select between 1 and 100 checks.'; end if;
 select * into s from public.check_writer_settings where salon_id=p_salon for update;
 if s.salon_id is null or s.version<>p_version then raise exception 'Check settings changed. Review again.'; end if;
 if s.next_number+jsonb_array_length(p_items)-1>9999999999 then raise exception 'Check number limit reached.'; end if;
 insert into public.check_writer_batches(id,salon_id,actor_id,request_hash) values(p_batch,p_salon,p_actor,p_hash);
 n:=s.next_number;
 for item in select value from jsonb_array_elements(p_items) loop
 snap:=item; src:=item->'source';
 if src is not null then
 if src->>'kind'='live' then
 -- Live values come only from the authenticated server's existing Payroll
 -- calculator; retain the reviewed snapshot in this plugin, never Payroll.
 if (src->>'calculatedAt')::timestamptz<now()-interval '2 minutes' or (src->>'calculatedAt')::timestamptz>now()+interval '10 seconds'
 or length(coalesce(src->>'updatedAt',''))<>64 or coalesce(src->>'staffId','')='' or (src->>'periodStart')::date>(src->>'periodEnd')::date
 or (snap->'payroll'->>'check')::bigint is distinct from (snap->>'amountCents')::bigint then raise exception 'Live payroll snapshot is invalid or expired.'; end if;
 if coalesce(src->>'existingCheckNumber','')<>'' and src->>'existingCheckNumber'<>n::text and src->>'existingCheckNumber'<>lpad(n::text,6,'0') then raise exception 'Existing payroll check number conflicts. Review the next number.'; end if;
 else
 select * into run from public.payroll_runs where id=(src->>'runId')::uuid and salon_id=p_salon for share;
 select * into line from public.payroll_staff_lines where id=(src->>'lineId')::uuid and salon_id=p_salon and payroll_run_id=run.id for share;
 if run.id is null or line.id is null or run.status not in ('locked','printed','paid') or run.version is distinct from (src->>'version')::integer or line.updated_at is distinct from (src->>'updatedAt')::timestamptz then raise exception 'Payroll changed. Review the latest locked payroll.'; end if;
 if round(line.final_check_amount*100)::bigint<>(item->>'amountCents')::bigint or line.final_check_amount<=0 then raise exception 'Payroll amount mismatch.'; end if;
 if coalesce(line.check_number,'')<>'' and line.check_number<>n::text and line.check_number<>lpad(n::text,6,'0') then raise exception 'Existing payroll check number conflicts. Review the next number.'; end if;
 snap:=jsonb_set(snap,'{source}',jsonb_build_object('lineId',line.id,'runId',run.id,'staffId',line.staff_id,'version',run.version,'updatedAt',line.updated_at,'periodStart',run.period_start,'periodEnd',run.period_end));
 snap:=jsonb_set(snap,'{payroll}',jsonb_build_object('check',round(line.final_check_amount*100),'cash',round(line.final_cash_amount*100),'tip',round(line.tip_amount*100),'bonus',round(line.bonus_amount*100),'gross',round(line.gross_sales*100),'period',run.period_start||' – '||run.period_end));
 end if;
 else snap:=snap-'payroll'; end if;
 if coalesce(length(trim(snap->>'payee')),0) not between 1 and 160 or coalesce(length(snap->>'memo'),251)>250 or coalesce((snap->>'amountCents')::bigint,0) not between 1 and 9999999999 then raise exception 'Invalid check contents.'; end if;
 snap:=jsonb_set(snap,'{bankEncrypted}',to_jsonb(s.bank_encrypted));
 snap:=jsonb_set(snap,'{stock}',s.public_config->'stock');
 if src is not null and exists(select 1 from public.check_writer_checks c where c.salon_id=p_salon and c.status='issued'
 and c.payroll_staff_id=(snap->'source'->>'staffId')::uuid
 and daterange(c.period_start,c.period_end,'[]') && daterange((snap->'source'->>'periodStart')::date,(snap->'source'->>'periodEnd')::date,'[]')) then raise exception 'An active check already covers this employee and payroll period. Void it before replacement.'; end if;
 insert into public.check_writer_checks(salon_id,batch_id,number,snapshot,payroll_line_id,payroll_staff_id,period_start,period_end,created_by)
 values(p_salon,p_batch,n,snap,case when snap->'source'->>'kind'='live' then null else (snap->'source'->>'lineId')::uuid end,(snap->'source'->>'staffId')::uuid,(snap->'source'->>'periodStart')::date,(snap->'source'->>'periodEnd')::date,p_actor);
 n:=n+1;
 end loop;
 update public.check_writer_settings set next_number=n,version=version+1,updated_at=now() where salon_id=p_salon;
 insert into public.check_writer_events(salon_id,actor_id,action) values(p_salon,p_actor,'batch_issued');
 select jsonb_agg(id order by number) into result from public.check_writer_checks where batch_id=p_batch; return result;
end $$;

create function public.check_writer_event(p_salon uuid,p_actor uuid,p_check uuid,p_action text,p_reason text) returns void
language plpgsql security definer set search_path=pg_catalog,public as $$ declare c public.check_writer_checks; begin
 perform public.check_writer_assert(p_salon,p_actor,p_action<>'void');
 perform pg_advisory_xact_lock(hashtextextended('check-writer:'||p_salon,0));
 select * into c from public.check_writer_checks where id=p_check and salon_id=p_salon for update;
 if c.id is null then raise exception 'Check not found.'; end if;
 if p_action not in ('void','pdf_prepared','print_confirmed','print_failed') then raise exception 'Invalid check event.'; end if;
 if p_action='void' then
 if length(trim(p_reason)) not between 1 and 500 then raise exception 'Enter a void reason.'; end if;
 if c.status='void' then return; end if;
 update public.check_writer_checks set status='void',void_reason=p_reason,voided_by=p_actor,voided_at=now() where id=c.id;
 elsif c.status='void' then raise exception 'Void checks cannot be printed.';
 elsif p_action='pdf_prepared' then
 if c.delivery_count>0 and length(trim(coalesce(p_reason,'')))=0 then raise exception 'Enter a reason to print again.'; end if;
 update public.check_writer_checks set delivery_count=delivery_count+1 where id=c.id;
 end if;
 insert into public.check_writer_events(salon_id,check_id,actor_id,action,reason) values(p_salon,c.id,p_actor,p_action,p_reason);
end $$;
do $$ declare f record; begin
 for f in select oid::regprocedure signature from pg_proc where pronamespace='public'::regnamespace and proname like 'check_writer_%' loop
 execute format('revoke all on function %s from public,anon,authenticated',f.signature);
 execute format('grant execute on function %s to service_role',f.signature);
 end loop;
end $$;

-- Extend existing audited billing branches; retain invoice/tax/refund guards.
do $$ declare f record; original text; updated text; branch text; lines text[]; i integer; assembled text; begin
 for f in select oid,proname from pg_proc where pronamespace='public'::regnamespace and (proname like 'market_billing_%' or proname in ('market_card_reserve','market_card_apply')) loop
 original:=pg_get_functiondef(f.oid); updated:=original;
 if original like '%booking-policy%' then
 lines:=string_to_array(original,E'\n'); i:=1; assembled:='';
 while i<=array_length(lines,1) loop
 if lines[i] ~ '^[[:space:]]*elsif (p_plugin|o.plugin_id)=''booking-policy'' then' then
 branch:=lines[i]||E'\n'; i:=i+1;
 while i<=array_length(lines,1) and lines[i] !~ '^[[:space:]]*(elsif|end if;)' loop branch:=branch||lines[i]||E'\n'; i:=i+1; end loop;
 assembled:=assembled||replace(replace(branch,'booking-policy','print-check'),'booking_policy_subscriptions','check_writer_subscriptions')||branch;
 else assembled:=assembled||lines[i]||E'\n'; i:=i+1; end if;
 end loop;
 updated:=replace(assembled,'''booking-policy'',''booking-deposit''','''print-check'',''booking-policy'',''booking-deposit''');
 updated:=replace(updated,'when ''booking-policy'' then ''booking_policy_subscriptions''','when ''print-check'' then ''check_writer_subscriptions'' when ''booking-policy'' then ''booking_policy_subscriptions''');
 execute updated;
 end if;
 end loop;
end $$;
alter table public.market_billing_catalog drop constraint market_catalog_fulfillment_check;
alter table public.market_billing_catalog add constraint market_catalog_fulfillment_check check(not fulfillment_ready or plugin_id in ('vietnamese-language','booking-policy','booking-deposit','checkin-receipt','tax-company','booksms','print-check'));
alter table public.market_billing_catalog drop constraint market_billing_catalog_price_cents_check;
alter table public.market_billing_catalog add constraint market_billing_catalog_price_cents_check check(price_cents between 1 and 100000000 or (plugin_id in ('booksms','print-check') and price_cents=0 and not fulfillment_ready));
-- Deliberately closed until owner approves price and print acceptance passes.
insert into public.market_billing_catalog(plugin_id,name,publisher,price_cents,published,fulfillment_ready)
values('print-check','Check Writer','Reylumi',0,true,false)
on conflict(plugin_id) do update set name=excluded.name,publisher=excluded.publisher,fulfillment_ready=false;
commit;
