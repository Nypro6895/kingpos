create table if not exists public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  legal_name text,
  owner_user_id uuid not null references public.users(id) on delete restrict,
  status text not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint organizations_status_check check (
    status in ('active', 'inactive', 'suspended', 'archived')
  ),
  constraint organizations_name_not_blank check (length(btrim(name)) > 0)
);

create index if not exists organizations_owner_user_id_idx
on public.organizations(owner_user_id);

drop trigger if exists update_organizations_updated_at on public.organizations;

create trigger update_organizations_updated_at
before update on public.organizations
for each row
execute function public.update_updated_at_column();

alter table public.organizations enable row level security;

drop policy if exists "Users can view their organizations" on public.organizations;
create policy "Users can view their organizations"
on public.organizations
for select
to authenticated
using (
  owner_user_id in (
    select users.id
    from public.users
    where users.auth_user_id = auth.uid()
  )
);

drop policy if exists "Users can create their organizations" on public.organizations;
create policy "Users can create their organizations"
on public.organizations
for insert
to authenticated
with check (
  owner_user_id in (
    select users.id
    from public.users
    where users.auth_user_id = auth.uid()
  )
);
