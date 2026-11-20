begin;
create table public.tax_company_subscriptions (
 salon_id uuid primary key references public.locations(id) on delete cascade,
 paid_until timestamptz, payment_owner uuid references public.users(id),
 stripe_subscription text unique, stripe_customer text, stripe_checkout text,
 checkout_reference uuid not null default gen_random_uuid(), updated_at timestamptz not null default now()
);
alter table public.tax_company_subscriptions enable row level security;
revoke all on public.tax_company_subscriptions from public,anon,authenticated;
grant all on public.tax_company_subscriptions to service_role;
grant select on public.tax_company_subscriptions to authenticated;
create policy tax_subscription_owner on public.tax_company_subscriptions for select to authenticated
 using(public.lifecycle_user_is_salon_owner(salon_id,public.current_public_user_id(),false));
create table public.tax_company_credentials (
 salon_id uuid primary key references public.locations(id) on delete cascade,
 login_id text not null unique default ('TAX-' || upper(replace(gen_random_uuid()::text,'-',''))),
 password_hash text not null, generation bigint not null default 1, enabled boolean not null default true
);
create table public.tax_company_connections (
 salon_id uuid not null references public.locations(id) on delete cascade,
 user_id uuid not null references public.users(id) on delete cascade,
 generation bigint not null, connected_at timestamptz not null default now(), primary key(salon_id,user_id)
);
create table public.tax_company_login_attempts (
 user_id uuid primary key references public.users(id) on delete cascade,
 window_start timestamptz not null default now(), attempts integer not null default 0
);
alter table public.tax_company_credentials enable row level security;
alter table public.tax_company_connections enable row level security;
alter table public.tax_company_login_attempts enable row level security;
revoke all on public.tax_company_credentials,public.tax_company_connections,public.tax_company_login_attempts from public,anon,authenticated;
grant select,delete on public.tax_company_connections to authenticated;
create policy tax_connection_self on public.tax_company_connections for select to authenticated using(user_id=public.current_public_user_id());
create policy tax_connection_logout on public.tax_company_connections for delete to authenticated using(user_id=public.current_public_user_id());
create function public.tax_company_has_access(p_salon uuid) returns boolean
language sql stable security definer set search_path=public as $$
 select exists(select 1 from tax_company_connections c join tax_company_credentials k using(salon_id)
 join tax_company_subscriptions s using(salon_id) join locations l on l.id=c.salon_id
 join users u on u.id=c.user_id where c.salon_id=p_salon and c.user_id=current_public_user_id()
 and u.status='active' and l.status='active' and k.enabled and c.generation=k.generation and s.paid_until>now());
$$;
create function public.tax_company_settings(p_salon uuid, p_password text default null, p_disconnect boolean default false)
returns jsonb language plpgsql security definer set search_path=public,extensions as $$
declare k tax_company_credentials; active boolean;
begin
 if not coalesce(lifecycle_user_is_salon_owner(p_salon,current_public_user_id(),false),false)
 or not exists(select 1 from locations where id=p_salon and status='active') then raise exception 'Salon owner access required.'; end if;
 select paid_until>now() into active from tax_company_subscriptions where salon_id=p_salon;
 if p_password is not null then
 if not coalesce(active,false) then raise exception 'Activate Tax Company ($7.90/month) first.'; end if;
 if octet_length(p_password)<12 or octet_length(p_password)>72 then raise exception 'Use a password between 12 and 72 bytes.'; end if;
 insert into tax_company_credentials(salon_id,password_hash) values(p_salon,crypt(p_password,gen_salt('bf',12)))
 on conflict(salon_id) do update set password_hash=excluded.password_hash,generation=tax_company_credentials.generation+1,enabled=true;
 delete from tax_company_connections where salon_id=p_salon;
 elsif p_disconnect then
 update tax_company_credentials set generation=generation+1,enabled=false where salon_id=p_salon;
 delete from tax_company_connections where salon_id=p_salon;
 end if;
 select * into k from tax_company_credentials where salon_id=p_salon;
 return jsonb_build_object('active',coalesce(active,false),'login_id',k.login_id,'enabled',coalesce(k.enabled,false),
 'connections',coalesce((select jsonb_agg(jsonb_build_object('user_id',c.user_id,'connected_at',c.connected_at)) from tax_company_connections c where c.salon_id=p_salon),'[]'::jsonb));
end $$;
create function public.tax_company_connect(p_login text,p_password text) returns jsonb
language plpgsql security definer set search_path=public,extensions as $$
declare actor uuid:=current_public_user_id(); k tax_company_credentials; n integer;
begin
 if actor is null or not exists(select 1 from users where id=actor and status='active') then raise exception 'Sign in to your personal account first.'; end if;
 insert into tax_company_login_attempts(user_id,attempts) values(actor,1)
 on conflict(user_id) do update set attempts=case when tax_company_login_attempts.window_start<now()-interval '15 minutes' then 1 else tax_company_login_attempts.attempts+1 end,
 window_start=case when tax_company_login_attempts.window_start<now()-interval '15 minutes' then now() else tax_company_login_attempts.window_start end returning attempts into n;
 -- Return failures instead of raising so the attempt counter commits.
 if n>10 then return jsonb_build_object('error','Too many attempts. Try again in 15 minutes.'); end if;
 select * into k from tax_company_credentials where login_id=upper(btrim(p_login)) for update;
 if k.salon_id is null or not k.enabled or octet_length(p_password)>72 or crypt(p_password,k.password_hash) is distinct from k.password_hash
 or not exists(select 1 from tax_company_subscriptions s join locations l on l.id=s.salon_id where s.salon_id=k.salon_id and s.paid_until>now() and l.status='active') then
 return jsonb_build_object('error','Invalid salon ID or password, or salon access is inactive.'); end if;
 insert into tax_company_connections(salon_id,user_id,generation) values(k.salon_id,actor,k.generation)
 on conflict(salon_id,user_id) do update set generation=excluded.generation,connected_at=now();
 return jsonb_build_object('salon_id',k.salon_id);
end $$;
create function public.tax_company_scope(p_salon uuid) returns jsonb
language plpgsql stable security definer set search_path=public as $$
begin
 if not tax_company_has_access(p_salon) then raise exception 'Salon connection expired. Connect again with the current password.'; end if;
 return (select jsonb_build_object('salon',to_jsonb(l),'account',to_jsonb(a)) from locations l join accounts a on a.id=l.account_id where l.id=p_salon);
end $$;
create function public.tax_company_salons() returns jsonb
language sql stable security definer set search_path=public as $$
 select coalesce(jsonb_agg(jsonb_build_object('id',l.id,'name',l.name,'connected_at',c.connected_at,'active',tax_company_has_access(l.id)) order by l.name),'[]'::jsonb)
 from tax_company_connections c join locations l on l.id=c.salon_id where c.user_id=current_public_user_id();
$$;
create policy tax_connected_runs on public.payroll_runs for select to authenticated using(status in ('printed','paid') and public.tax_company_has_access(salon_id));
create policy tax_connected_lines on public.payroll_staff_lines for select to authenticated using(public.tax_company_has_access(salon_id)
 and exists(select 1 from public.payroll_runs r where r.id=payroll_staff_lines.payroll_run_id and r.salon_id=payroll_staff_lines.salon_id and r.status in ('printed','paid')));
create policy tax_connected_paystubs_read on public.payroll_paystubs for select to authenticated using(public.tax_company_has_access(salon_id));
create policy tax_connected_paystubs_insert on public.payroll_paystubs for insert to authenticated with check(uploaded_by=public.current_public_user_id() and public.tax_company_has_access(salon_id)
 and exists(select 1 from public.payroll_runs r join public.payroll_staff_lines l on l.payroll_run_id=r.id where r.id=payroll_paystubs.payroll_run_id and r.salon_id=payroll_paystubs.salon_id and l.staff_id=payroll_paystubs.staff_id and r.status in ('printed','paid')));
create policy tax_connected_paystubs_update on public.payroll_paystubs for update to authenticated using(public.tax_company_has_access(salon_id)) with check(uploaded_by=public.current_public_user_id() and public.tax_company_has_access(salon_id)
 and exists(select 1 from public.payroll_runs r join public.payroll_staff_lines l on l.payroll_run_id=r.id where r.id=payroll_paystubs.payroll_run_id and r.salon_id=payroll_paystubs.salon_id and l.staff_id=payroll_paystubs.staff_id and r.status in ('printed','paid')));
create function public.tax_company_storage_access(p_path text) returns boolean
language plpgsql stable security definer set search_path=public as $$
declare parts text[]:=string_to_array(p_path,'/');
begin
 if array_length(parts,1)<>5 then return false; end if;
 return exists(select 1 from locations l join payroll_runs r on r.salon_id=l.id join payroll_staff_lines s on s.payroll_run_id=r.id and s.salon_id=l.id
 where l.account_id=parts[1]::uuid and l.id=parts[2]::uuid and r.id=parts[3]::uuid and s.staff_id=parts[4]::uuid
 and r.status in ('printed','paid') and tax_company_has_access(l.id));
exception when invalid_text_representation then return false;
end $$;
create policy tax_connected_storage_read on storage.objects for select to authenticated using(bucket_id='payroll-paystubs' and public.tax_company_storage_access(name));
create policy tax_connected_storage_insert on storage.objects for insert to authenticated with check(bucket_id='payroll-paystubs' and public.tax_company_storage_access(name));
create policy tax_connected_storage_cleanup on storage.objects for delete to authenticated using(bucket_id='payroll-paystubs' and public.tax_company_storage_access(name) and not exists(select 1 from public.payroll_paystubs p where p.file_url_or_path=name));
revoke all on function public.tax_company_has_access(uuid),public.tax_company_settings(uuid,text,boolean),public.tax_company_connect(text,text),public.tax_company_scope(uuid),public.tax_company_salons(),public.tax_company_storage_access(text) from public,anon;
grant execute on function public.tax_company_has_access(uuid),public.tax_company_settings(uuid,text,boolean),public.tax_company_connect(text,text),public.tax_company_scope(uuid),public.tax_company_salons(),public.tax_company_storage_access(text) to authenticated;
-- Extend the existing audited bank checkout, settlement and refund workflows.
do $$ declare c record; definition text; branch text; lines text[]; i integer; assembled text; begin
 for c in select oid from pg_proc where pronamespace='public'::regnamespace and proname like 'market_billing_%' loop
 definition:=pg_get_functiondef(c.oid);
 if definition like '%booking-policy%' then
 lines:=string_to_array(definition,E'\n'); i:=1; assembled:='';
 while i<=array_length(lines,1) loop
 if lines[i] ~ '^[[:space:]]*elsif (p_plugin|o.plugin_id)=''booking-policy'' then' then
 branch:=lines[i]||E'\n'; i:=i+1;
 while i<=array_length(lines,1) and lines[i] !~ '^[[:space:]]*(elsif|end if;)' loop
 branch:=branch||lines[i]||E'\n'; i:=i+1;
 end loop;
 assembled:=assembled||replace(replace(branch,'booking-policy','tax-company'),'booking_policy_subscriptions','tax_company_subscriptions')||branch;
 else assembled:=assembled||lines[i]||E'\n'; i:=i+1;
 end if;
 end loop;
 definition:=assembled;
 definition:=replace(definition,'''vietnamese-language'',''booking-policy'',''booking-deposit'',''checkin-receipt''','''vietnamese-language'',''booking-policy'',''booking-deposit'',''checkin-receipt'',''tax-company''');
 execute definition;
 end if;
 end loop;
 for c in select conname from pg_constraint where conrelid='public.market_billing_catalog'::regclass and pg_get_constraintdef(oid) like '%fulfillment_ready%' loop
 execute format('alter table public.market_billing_catalog drop constraint %I',c.conname);
 end loop;
end $$;
alter table public.market_billing_catalog add constraint market_catalog_fulfillment_check check(not fulfillment_ready or plugin_id in ('vietnamese-language','booking-policy','booking-deposit','checkin-receipt','tax-company'));
insert into public.market_billing_catalog(plugin_id,name,publisher,price_cents,published,fulfillment_ready)
values('tax-company','Tax Company','Reylumi',790,true,true) on conflict(plugin_id) do update set name=excluded.name,publisher=excluded.publisher,price_cents=790,published=true,fulfillment_ready=true,version=market_billing_catalog.version+1;
commit;
