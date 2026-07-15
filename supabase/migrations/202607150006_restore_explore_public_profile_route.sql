create or replace function public.salon_profile_public_salon_exists(
  target_salon_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.locations l
    join public.salon_settings ss
      on ss.salon_id = l.id
      and ss.organization_id = l.organization_id
    where l.id = target_salon_id
      and l.status = 'active'
      and ss.public_discovery_enabled = true
      and length(btrim(coalesce(ss.business_name, l.name, ''))) > 0
      and length(btrim(coalesce(ss.phone, l.phone, ''))) > 0
      and length(btrim(coalesce(ss.address_line1, l.address_line1, ''))) > 0
      and length(btrim(coalesce(ss.city, l.city, ''))) > 0
      and length(btrim(coalesce(ss.state, l.state, ''))) > 0
      and length(btrim(coalesce(ss.postal_code, l.postal_code, ''))) > 0
      and length(btrim(coalesce(ss.business_description, ''))) > 0
      and exists (
        select 1
        from public.services s
        where s.salon_id = l.id
          and s.organization_id = l.organization_id
          and s.is_active = true
      )
  )
$$;

grant execute on function public.salon_profile_public_salon_exists(uuid)
to anon, authenticated;
