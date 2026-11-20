-- Keep customer reads under the caller's table RLS, including direct RPC calls.
-- The earlier search was SECURITY DEFINER and could bypass the private-row policy.
alter function public.search_salon_customers(uuid,text,integer,integer,text) security invoker;
revoke all on function public.search_salon_customers(uuid,text,integer,integer,text) from public, anon;
grant execute on function public.search_salon_customers(uuid,text,integer,integer,text) to authenticated;

-- POS quick-add needs an exact match, not a user-assembled PostgREST filter.
create or replace function public.find_pos_desk_customer_exact(p_salon_id uuid, p_lookup text)
returns table (id uuid, name text, phone text, email text)
language sql stable security invoker set search_path = public
as $$
  select c.id, c.name, c.phone, c.email
  from public.customers c
  where c.location_id = p_salon_id
    and c.status = 'active'
    and nullif(btrim(p_lookup), '') is not null
    and (c.phone = btrim(p_lookup) or c.email = btrim(p_lookup)
      or lower(c.name) = lower(btrim(p_lookup)))
  order by c.id
  limit 1
$$;
revoke all on function public.find_pos_desk_customer_exact(uuid,text) from public, anon;
grant execute on function public.find_pos_desk_customer_exact(uuid,text) to authenticated;
