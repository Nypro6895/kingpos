begin;
create table public.vietnamese_plugin_subscriptions (
 salon_id uuid primary key references public.locations(id) on delete cascade,
 installed boolean not null default true,
 staff_enabled boolean not null default false,
 portable_enabled boolean not null default false,
 trial_ends_at timestamptz not null default (now() + interval '5 days'),
 paid_until timestamptz,
 stripe_subscription text unique,
 stripe_customer text,
 payment_owner uuid references public.users(id),
 checkout_reference uuid,
 checkout_owner uuid references public.users(id),
 checkout_session text,
 updated_at timestamptz not null default now()
);
alter table public.vietnamese_plugin_subscriptions enable row level security;
revoke all on public.vietnamese_plugin_subscriptions from public, anon, authenticated;
grant all on public.vietnamese_plugin_subscriptions to service_role;

create table public.market_payment_settings (
 id boolean primary key default true check(id),
 enabled boolean not null default false,
 vietnamese_published boolean not null default true,
 updated_at timestamptz not null default now()
);
insert into public.market_payment_settings(id) values(true);
alter table public.market_payment_settings enable row level security;
revoke all on public.market_payment_settings from public, anon, authenticated;
grant all on public.market_payment_settings to service_role;
grant select on public.market_payment_settings to authenticated;
create policy market_payment_settings_admin on public.market_payment_settings for select to authenticated
 using(public.platform_admin_has_permission('admin.access'));

create function public.vietnamese_plugin_state(p_salon uuid) returns jsonb
language plpgsql stable security definer set search_path=public as $$
declare row public.vietnamese_plugin_subscriptions; actor uuid := public.current_public_user_id();
begin
 if actor is null or not (coalesce(public.lifecycle_user_is_salon_owner(p_salon,actor,false),false)
   or exists(select 1 from public.staff where salon_id=p_salon and account_user_id=actor and is_active)) then
   raise exception 'Salon access required.';
 end if;
 select * into row from public.vietnamese_plugin_subscriptions where salon_id=p_salon;
 if not found then return null; end if;
 return jsonb_build_object('installed',row.installed,'active',row.installed and greatest(row.trial_ends_at,coalesce(row.paid_until,row.trial_ends_at))>now(),
 'staff_enabled',row.staff_enabled,'portable_enabled',row.portable_enabled,'trial_ends_at',row.trial_ends_at,
 'paid_until',row.paid_until,'has_subscription',row.stripe_subscription is not null);
end $$;

create function public.vietnamese_plugin_set(p_salon uuid,p_install boolean,p_staff boolean default false,p_portable boolean default false) returns jsonb
language plpgsql security definer set search_path=public as $$
begin
 if not coalesce(public.lifecycle_user_is_salon_owner(p_salon,public.current_public_user_id(),false),false)
 or not exists(select 1 from public.locations where id=p_salon and status='active') then raise exception 'Active salon owner access required.'; end if;
 if p_install and not exists(select 1 from public.market_payment_settings where id and vietnamese_published) then raise exception 'This plugin is not available.'; end if;
 insert into public.vietnamese_plugin_subscriptions(salon_id,installed,staff_enabled,portable_enabled)
 values(p_salon,p_install,p_staff,p_portable)
 on conflict(salon_id) do update set installed=p_install,staff_enabled=p_staff,portable_enabled=p_portable,updated_at=now();
 -- The original trial deadline survives removal, reinstallation and option changes.
 return public.vietnamese_plugin_state(p_salon);
end $$;
revoke all on function public.vietnamese_plugin_state(uuid), public.vietnamese_plugin_set(uuid,boolean,boolean,boolean) from public,anon;
grant execute on function public.vietnamese_plugin_state(uuid), public.vietnamese_plugin_set(uuid,boolean,boolean,boolean) to authenticated;

create function public.vietnamese_checkout_claim(p_salon uuid,p_owner uuid) returns uuid
language plpgsql security definer set search_path=public as $$
declare row public.vietnamese_plugin_subscriptions;
begin
 if not coalesce(public.lifecycle_user_is_salon_owner(p_salon,p_owner,false),false) then raise exception 'Owner access required.'; end if;
 select * into row from public.vietnamese_plugin_subscriptions where salon_id=p_salon for update;
 if not found or not row.installed or row.trial_ends_at>now() or row.stripe_subscription is not null then raise exception 'Plugin is not ready for checkout.'; end if;
 if row.checkout_reference is not null then
   if row.checkout_owner<>p_owner then raise exception 'Another owner has a checkout in progress.'; end if;
   return row.checkout_reference;
 end if;
 update public.vietnamese_plugin_subscriptions set checkout_reference=gen_random_uuid(),checkout_owner=p_owner where salon_id=p_salon returning checkout_reference into row.checkout_reference;
 return row.checkout_reference;
end $$;
revoke all on function public.vietnamese_checkout_claim(uuid,uuid) from public,anon,authenticated;
grant execute on function public.vietnamese_checkout_claim(uuid,uuid) to service_role;
commit;
