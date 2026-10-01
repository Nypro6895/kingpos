alter table public.staff
  add column if not exists pos_enabled boolean not null default true;
