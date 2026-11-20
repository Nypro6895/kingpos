-- Read-only proof for fresh Staff presentation without an offline attestation.
-- Existing offline approval/revocation, RLS and historical links are unchanged.
begin;

create function public.get_my_staff_online_access(p_staff_id uuid, p_salon_id uuid, p_account_id uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  actor uuid := public.current_public_user_id();
  viewer public.users%rowtype;
  target public.staff%rowtype;
  binding public.staff_offline_bindings%rowtype;
  result jsonb;
begin
  select * into viewer from public.users where id = actor and status = 'active';
  if viewer.id is null then return jsonb_build_object('version', 1, 'state', 'denied'); end if;
  select s.* into target from public.staff s
    join public.locations l on l.id = s.salon_id and l.status = 'active'
    join public.accounts a on a.id = l.account_id and a.status = 'active'
    where s.id = p_staff_id and s.salon_id = p_salon_id and a.id = p_account_id
      and s.is_active is true
      and (s.account_user_id = viewer.id or (s.account_user_id is null and s.user_id = viewer.auth_user_id));
  if target.id is null or 1 <> (select count(*) from public.staff s
      where s.salon_id = target.salon_id and s.is_active is true
        and (s.account_user_id = viewer.id or (s.account_user_id is null and s.user_id = viewer.auth_user_id))) then
    return jsonb_build_object('version', 1, 'state', 'denied');
  end if;
  result := jsonb_build_object('version', 1, 'staffId', target.id, 'viewerId', viewer.id,
    'salonId', target.salon_id, 'accountId', p_account_id);
  -- Definer visibility matters: a binding for another viewer must never appear
  -- to be absent just because the caller cannot SELECT it through table RLS.
  select * into binding from public.staff_offline_bindings where staff_id = target.id;
  if not found then return result || jsonb_build_object('state', 'missing'); end if;
  if binding.revoked_at is not null then return result || jsonb_build_object('state', 'revoked'); end if;
  if binding.viewer_user_id is distinct from viewer.id or binding.salon_id is distinct from target.salon_id
    or binding.revision is null or binding.approved_at is null or not isfinite(binding.approved_at)
    or binding.approved_at > now() + interval '1 minute' then
    return result || jsonb_build_object('state', 'denied');
  end if;
  return result || jsonb_build_object('state', 'binding-present');
end;
$$;
revoke all on function public.get_my_staff_online_access(uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.get_my_staff_online_access(uuid, uuid, uuid) to authenticated;

commit;
