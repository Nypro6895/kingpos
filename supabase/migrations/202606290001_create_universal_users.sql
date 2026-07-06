create extension if not exists "pgcrypto";

create table if not exists public.users (
  id uuid primary key default gen_random_uuid(),
  auth_user_id uuid unique references auth.users(id) on delete set null,
  email text,
  phone text,
  first_name text,
  last_name text,
  display_name text,
  avatar_url text,
  status text not null default 'active',
  language text not null default 'en',
  timezone text not null default 'America/Chicago',
  last_login_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint users_status_check check (
    status in ('active', 'inactive', 'suspended', 'deleted')
  )
);

create or replace function public.update_updated_at_column()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists update_users_updated_at on public.users;

create trigger update_users_updated_at
before update on public.users
for each row
execute function public.update_updated_at_column();

create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  metadata jsonb;
  metadata_display_name text;
begin
  metadata := coalesce(new.raw_user_meta_data, '{}'::jsonb);
  metadata_display_name := nullif(
    coalesce(
      metadata ->> 'display_name',
      metadata ->> 'full_name',
      metadata ->> 'name'
    ),
    ''
  );

  insert into public.users (
    auth_user_id,
    email,
    phone,
    first_name,
    last_name,
    display_name,
    avatar_url,
    status
  )
  values (
    new.id,
    new.email,
    new.phone,
    nullif(metadata ->> 'first_name', ''),
    nullif(metadata ->> 'last_name', ''),
    coalesce(metadata_display_name, new.email),
    nullif(coalesce(metadata ->> 'avatar_url', metadata ->> 'picture'), ''),
    'active'
  )
  on conflict (auth_user_id) do nothing;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;

create trigger on_auth_user_created
after insert on auth.users
for each row
execute function public.handle_new_auth_user();
