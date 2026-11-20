-- Data-preserving staff consent hardening and bounded offline read authority.
-- Preserve existing rows and SECURITY DEFINER invitation/application RPCs.
-- Existing links are deliberately NOT backfilled as trusted attestations.
begin;

drop policy if exists staff_connection_request_participant_write on public.staff_salon_connection_requests;
create policy staff_connection_request_manager_write on public.staff_salon_connection_requests
for all to authenticated
using (public.user_can_manage_salon(salon_id) and exists(select 1 from public.users u where u.id=public.current_public_user_id() and u.status='active'))
with check (public.user_can_manage_salon(salon_id) and exists(select 1 from public.users u where u.id=public.current_public_user_id() and u.status='active'));

create table public.staff_offline_bindings (
  staff_id uuid primary key references public.staff(id) on delete cascade,
  salon_id uuid not null references public.locations(id) on delete cascade,
  viewer_user_id uuid not null references public.users(id) on delete cascade,
  approved_by_user_id uuid not null references public.users(id),
  revision uuid not null default gen_random_uuid(),
  approved_at timestamptz not null default now(),
  revoked_at timestamptz
);
alter table public.staff_offline_bindings enable row level security;
revoke all on public.staff_offline_bindings from public, anon, authenticated;
grant select on public.staff_offline_bindings to authenticated;
create policy staff_offline_binding_read on public.staff_offline_bindings
for select to authenticated using (
  viewer_user_id = public.current_public_user_id()
  or public.user_has_salon_permission(salon_id, array['staff.manage']::text[])
);

create function public.attest_staff_offline_binding(p_staff_id uuid, p_expected_viewer_id uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  target public.staff%rowtype;
  viewer uuid;
  actor uuid := public.current_public_user_id();
  matches integer;
  issued uuid;
begin
  if actor is null then raise exception 'Authentication required'; end if;
  if not exists(select 1 from public.users u where u.id=actor and u.status='active') then raise exception 'An active owner account is required'; end if;
  select * into target from public.staff where id = p_staff_id for update;
  if target.id is null or target.is_active is not true then raise exception 'Active staff profile required'; end if;
  if not public.user_has_salon_permission(target.salon_id, array['staff.manage']::text[]) then
    raise exception 'Owner or staff manager approval required';
  end if;
  select u.id into viewer from public.users u where u.status = 'active' and (
    u.id = target.account_user_id or (target.account_user_id is null and u.auth_user_id = target.user_id)
  );
  if viewer is null then raise exception 'An active account link is required'; end if;
  if viewer is distinct from p_expected_viewer_id then raise exception 'The connected account changed. Review it again.'; end if;
  select count(*) into matches from public.staff s join public.users u on u.id = viewer
  where s.salon_id = target.salon_id and s.is_active and (
    s.account_user_id = u.id or (s.account_user_id is null and s.user_id = u.auth_user_id)
  );
  if matches <> 1 then raise exception 'A unique staff account link is required'; end if;
  insert into public.staff_offline_bindings(staff_id, salon_id, viewer_user_id, approved_by_user_id)
  values(target.id, target.salon_id, viewer, actor)
  on conflict (staff_id) do update set
    salon_id = excluded.salon_id, viewer_user_id = excluded.viewer_user_id,
    approved_by_user_id = excluded.approved_by_user_id, revision = gen_random_uuid(),
    approved_at = now(), revoked_at = null
  returning revision into issued;
  return issued;
end;
$$;
revoke all on function public.attest_staff_offline_binding(uuid, uuid) from public, anon, authenticated;
grant execute on function public.attest_staff_offline_binding(uuid, uuid) to authenticated;

create function public.get_my_staff_offline_binding(p_staff_id uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object('version', 1, 'revision', b.revision, 'staffId', b.staff_id,
    'salonId', b.salon_id, 'viewerId', b.viewer_user_id, 'approvedAt', b.approved_at, 'revoked', b.revoked_at is not null)
  from public.staff_offline_bindings b
  join public.staff s on s.id = b.staff_id and s.salon_id = b.salon_id
  join public.users u on u.id = b.viewer_user_id and u.id = public.current_public_user_id()
  where b.staff_id = p_staff_id and s.is_active and u.status = 'active'
    and (s.account_user_id = u.id or (s.account_user_id is null and s.user_id = u.auth_user_id))
    and 1 = (select count(*) from public.staff own where own.salon_id = b.salon_id and own.is_active
      and (own.account_user_id = u.id or (own.account_user_id is null and own.user_id = u.auth_user_id)));
$$;
revoke all on function public.get_my_staff_offline_binding(uuid) from public, anon, authenticated;
grant execute on function public.get_my_staff_offline_binding(uuid) to authenticated;

create function public.revoke_changed_staff_offline_binding()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if old.salon_id is distinct from new.salon_id or old.account_user_id is distinct from new.account_user_id
    or old.user_id is distinct from new.user_id or old.is_active is distinct from new.is_active then
    update public.staff_offline_bindings set revoked_at = coalesce(revoked_at, now()) where staff_id = old.id;
  end if;
  return new;
end;
$$;
revoke all on function public.revoke_changed_staff_offline_binding() from public, anon, authenticated;
create trigger revoke_changed_staff_offline_binding
after update of salon_id, account_user_id, user_id, is_active on public.staff
for each row execute function public.revoke_changed_staff_offline_binding();

create function public.revoke_staff_offline_binding(p_staff_id uuid, p_expected_revision uuid)
returns void language plpgsql security definer set search_path = public as $$
declare target public.staff_offline_bindings%rowtype; actor uuid := public.current_public_user_id();
begin
  if actor is null or not exists(select 1 from public.users u where u.id=actor and u.status='active') then raise exception 'An active owner account is required'; end if;
  select * into target from public.staff_offline_bindings where staff_id = p_staff_id for update;
  if target.staff_id is null then raise exception 'Approval was not found'; end if;
  if not public.user_has_salon_permission(target.salon_id, array['staff.manage']::text[]) then
    raise exception 'Owner or staff manager approval required';
  end if;
  if target.revision is distinct from p_expected_revision then raise exception 'Approval changed. Review it again.'; end if;
  update public.staff_offline_bindings set revoked_at = coalesce(revoked_at, now()) where staff_id = p_staff_id;
end;
$$;
revoke all on function public.revoke_staff_offline_binding(uuid, uuid) from public, anon, authenticated;
grant execute on function public.revoke_staff_offline_binding(uuid, uuid) to authenticated;

-- Request participant fields were historically writable, including apparent
-- initiator/reviewer identity. No historical request is blessed by a backfill.
create table public.staff_invite_owner_authorizations (
  request_id uuid primary key references public.staff_salon_connection_requests(id) on delete cascade,
  salon_id uuid not null,
  staff_id uuid not null,
  target_account_user_id uuid,
  target_email_normalized text,
  target_phone_e164 text,
  token_hash text,
  expires_at timestamptz,
  authorized_by_user_id uuid not null references public.users(id),
  authorized_at timestamptz not null default now()
);
alter table public.staff_invite_owner_authorizations enable row level security;
revoke all on public.staff_invite_owner_authorizations from public, anon, authenticated;

create function public.authorize_owner_staff_invite()
returns trigger language plpgsql security definer set search_path = public as $$
declare actor uuid := public.current_public_user_id();
begin
  if new.direction = 'salon_invite' and new.status = 'pending' and actor is not null
    and public.user_has_salon_permission(new.salon_id, array['staff.manage']::text[]) then
    if not exists(select 1 from public.users u where u.id=actor and u.status='active') then raise exception 'An active owner account is required'; end if;
  end if;
  if new.direction = 'salon_invite' and new.status = 'pending' and actor is not null
    and exists(select 1 from public.users u where u.id=actor and u.status='active')
    and public.user_has_salon_permission(new.salon_id, array['staff.manage']::text[])
    and exists(select 1 from public.staff s where s.id = new.staff_id and s.salon_id = new.salon_id and s.is_active) then
    insert into public.staff_invite_owner_authorizations(request_id,salon_id,staff_id,target_account_user_id,
      target_email_normalized,target_phone_e164,token_hash,expires_at,authorized_by_user_id)
    values(new.id,new.salon_id,new.staff_id,new.account_user_id,new.target_email_normalized,
      new.target_phone_e164,new.token_hash,new.expires_at,actor)
    on conflict(request_id) do update set salon_id=excluded.salon_id,staff_id=excluded.staff_id,
      target_account_user_id=excluded.target_account_user_id,target_email_normalized=excluded.target_email_normalized,
      target_phone_e164=excluded.target_phone_e164,token_hash=excluded.token_hash,expires_at=excluded.expires_at,
      authorized_by_user_id=excluded.authorized_by_user_id,authorized_at=now();
  end if;
  return new;
end;
$$;
revoke all on function public.authorize_owner_staff_invite() from public, anon, authenticated;
create trigger authorize_owner_staff_invite after insert or update
on public.staff_salon_connection_requests for each row execute function public.authorize_owner_staff_invite();

create function public.require_owner_authorized_staff_invite()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if old.direction='salon_invite' and old.status='pending' and new.status='accepted' and not exists(
    select 1 from public.staff_invite_owner_authorizations a where a.request_id=old.id
      and a.salon_id=old.salon_id and a.staff_id=old.staff_id
      and a.target_account_user_id is not distinct from old.account_user_id
      and a.target_email_normalized is not distinct from old.target_email_normalized
      and a.target_phone_e164 is not distinct from old.target_phone_e164
      and a.token_hash is not distinct from old.token_hash
      and a.expires_at is not distinct from old.expires_at
  ) then raise exception 'Ask the salon to resend this invitation before accepting it.'; end if;
  return new;
end;
$$;
revoke all on function public.require_owner_authorized_staff_invite() from public, anon, authenticated;
create trigger require_owner_authorized_staff_invite before update
on public.staff_salon_connection_requests for each row execute function public.require_owner_authorized_staff_invite();

commit;

