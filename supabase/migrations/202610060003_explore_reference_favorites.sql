begin;
create table if not exists public.explore_reference_favorites (
 user_id uuid not null references public.users(id) on delete cascade,
 item_key text not null check(length(item_key)<=180),
 created_at timestamptz not null default now(), primary key(user_id,item_key)
);
alter table public.explore_reference_favorites enable row level security;
revoke all on public.explore_reference_favorites from public,anon,authenticated;
grant all on public.explore_reference_favorites to service_role;
commit;
