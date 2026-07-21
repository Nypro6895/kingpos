alter table public.locations
add column if not exists geocoded_at timestamptz;

alter table public.locations
add column if not exists geocoding_status text;

alter table public.locations
add column if not exists geocoding_provider text;

alter table public.locations
add column if not exists geocoding_place_id text;

alter table public.locations
add column if not exists geocoding_error_code text;

alter table public.locations
add column if not exists geocoding_address_fingerprint text;

comment on column public.locations.geocoded_at is
  'When this public salon location was last geocoded by a configured server-side provider.';

comment on column public.locations.geocoding_status is
  'Provider-neutral map location lifecycle status. Coordinates remain nullable and are never faked.';

comment on column public.locations.geocoding_provider is
  'Provider identifier used for the last successful geocoding result, without storing provider secrets.';

comment on column public.locations.geocoding_place_id is
  'Provider-neutral place id from the last accepted geocoding result, if the provider supplies one.';

comment on column public.locations.geocoding_error_code is
  'Customer-safe geocoding error code from the last controlled geocoding attempt.';

comment on column public.locations.geocoding_address_fingerprint is
  'Normalized public salon address fingerprint used to detect stale coordinates when address fields change.';

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'locations_geocoding_status_check'
  ) then
    alter table public.locations
    add constraint locations_geocoding_status_check
    check (
      geocoding_status is null
      or geocoding_status in ('mapped', 'pending', 'failed', 'stale', 'address_required')
    );
  end if;
end;
$$;

create index if not exists locations_geocoding_status_idx
on public.locations (geocoding_status, updated_at desc)
where geocoding_status is not null;

create index if not exists locations_geocoding_address_fingerprint_idx
on public.locations (geocoding_address_fingerprint)
where geocoding_address_fingerprint is not null;
