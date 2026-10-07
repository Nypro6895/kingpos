alter table public.salon_profile_preferences
  add column if not exists layout text not null default 'balanced'
  check (layout in ('booking', 'portfolio', 'balanced'));
