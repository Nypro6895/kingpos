alter table public.salon_profile_preferences
  add column if not exists show_featured boolean not null default true;
