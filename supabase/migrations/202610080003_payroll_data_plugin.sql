begin;
create table public.salon_market_plugins (
 salon_id uuid not null references public.locations(id) on delete cascade,
 plugin_id text not null check (plugin_id = 'payroll-data-download'),
 installed_at timestamptz not null default now(),
 primary key (salon_id, plugin_id)
);
alter table public.salon_market_plugins enable row level security;
grant select, insert, delete on public.salon_market_plugins to authenticated;
create policy salon_market_plugins_owner on public.salon_market_plugins
 for all to authenticated
 using (public.lifecycle_user_is_salon_owner(salon_id, public.current_public_user_id(), false))
 with check (public.lifecycle_user_is_salon_owner(salon_id, public.current_public_user_id(), false));
commit;
