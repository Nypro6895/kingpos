create table if not exists public.today_quick_access_preferences (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  salon_id uuid not null references public.locations(id) on delete cascade,
  shortcut_ids text[] not null default '{}'::text[],
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint today_quick_access_preferences_unique unique (user_id, salon_id),
  constraint today_quick_access_preferences_max_shortcuts
    check (
      array_length(shortcut_ids, 1) is null
      or array_length(shortcut_ids, 1) <= 8
    )
);

create index if not exists today_quick_access_preferences_salon_idx
on public.today_quick_access_preferences(salon_id);

drop trigger if exists set_today_quick_access_preferences_updated_at
on public.today_quick_access_preferences;

create trigger set_today_quick_access_preferences_updated_at
before update on public.today_quick_access_preferences
for each row execute function public.set_updated_at();

alter table public.today_quick_access_preferences enable row level security;

drop policy if exists "today_quick_access_owner_read"
on public.today_quick_access_preferences;

create policy "today_quick_access_owner_read"
on public.today_quick_access_preferences
for select to authenticated
using (
  user_id = public.current_public_user_id()
  and public.user_has_salon_permission(salon_id, array['staff.view'])
);

drop policy if exists "today_quick_access_owner_insert"
on public.today_quick_access_preferences;

create policy "today_quick_access_owner_insert"
on public.today_quick_access_preferences
for insert to authenticated
with check (
  user_id = public.current_public_user_id()
  and public.user_has_salon_permission(salon_id, array['staff.view'])
);

drop policy if exists "today_quick_access_owner_update"
on public.today_quick_access_preferences;

create policy "today_quick_access_owner_update"
on public.today_quick_access_preferences
for update to authenticated
using (
  user_id = public.current_public_user_id()
  and public.user_has_salon_permission(salon_id, array['staff.view'])
)
with check (
  user_id = public.current_public_user_id()
  and public.user_has_salon_permission(salon_id, array['staff.view'])
);

drop policy if exists "today_quick_access_owner_delete"
on public.today_quick_access_preferences;

create policy "today_quick_access_owner_delete"
on public.today_quick_access_preferences
for delete to authenticated
using (
  user_id = public.current_public_user_id()
  and public.user_has_salon_permission(salon_id, array['staff.view'])
);
