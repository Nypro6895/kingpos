create or replace function public.accept_salon_owner_transfer_invite(
  p_token_hash text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  actor_user_id uuid := public.current_public_user_id();
  actor_user_row public.users%rowtype;
  invite_row public.salon_owner_transfer_invites%rowtype;
  owner_role_id uuid;
  salon_row public.locations%rowtype;
begin
  if actor_user_id is null then
    raise exception 'You must be logged in to accept this owner invitation.';
  end if;

  select *
  into actor_user_row
  from public.users
  where id = actor_user_id
    and status = 'active';

  if actor_user_row.id is null then
    raise exception 'Your account is not active.';
  end if;

  if p_token_hash is null or btrim(p_token_hash) = '' then
    raise exception 'Invitation link is missing.';
  end if;

  select *
  into invite_row
  from public.salon_owner_transfer_invites
  where token_hash = p_token_hash
  for update;

  if invite_row.id is null then
    raise exception 'Owner invitation was not found.';
  end if;

  if invite_row.status <> 'pending' then
    raise exception 'Owner invitation is no longer pending.';
  end if;

  if invite_row.expires_at <= now() then
    update public.salon_owner_transfer_invites
    set status = 'expired',
        token_hash = null,
        updated_at = now()
    where id = invite_row.id;
    raise exception 'Owner invitation has expired.';
  end if;

  if invite_row.recipient_user_id is not null
    and invite_row.recipient_user_id <> actor_user_id
  then
    raise exception 'Owner invitation belongs to a different account.';
  end if;

  if invite_row.recipient_user_id is null
    and (
      invite_row.target_email_normalized is null
      or public.normalize_lifecycle_email(actor_user_row.email) <>
        invite_row.target_email_normalized
    )
  then
    raise exception 'Owner invitation requires the invited email account.';
  end if;

  select *
  into salon_row
  from public.locations
  where id = invite_row.salon_id
  for update;

  if salon_row.id is null then
    raise exception 'Salon was not found.';
  end if;

  if public.normalize_salon_lifecycle_status(salon_row.status) = 'permanently_closed' then
    raise exception 'Permanently closed salons require privileged recovery before ownership changes.';
  end if;

  if invite_row.inviter_user_id is not null
    and not public.lifecycle_user_is_salon_owner(
      invite_row.salon_id,
      invite_row.inviter_user_id,
      true
    )
  then
    raise exception 'The inviting Owner no longer has authority for this salon.';
  end if;

  select id
  into owner_role_id
  from public.roles
  where account_id = invite_row.account_id
    and upper(code) = 'OWNER'
  limit 1;

  if owner_role_id is null then
    raise exception 'Owner role was not found for this salon account.';
  end if;

  insert into public.account_memberships (
    account_id,
    user_id,
    role_id,
    status,
    joined_at
  )
  values (
    invite_row.account_id,
    actor_user_id,
    owner_role_id,
    'active',
    now()
  )
  on conflict (account_id, user_id) do update
  set role_id = excluded.role_id,
      status = 'active',
      joined_at = coalesce(public.account_memberships.joined_at, excluded.joined_at),
      updated_at = now();

  insert into public.salon_memberships (
    account_id,
    salon_id,
    user_id,
    role_id,
    status,
    joined_at
  )
  values (
    invite_row.account_id,
    invite_row.salon_id,
    actor_user_id,
    owner_role_id,
    'active',
    now()
  )
  on conflict (salon_id, user_id) do update
  set role_id = excluded.role_id,
      status = 'active',
      joined_at = coalesce(public.salon_memberships.joined_at, excluded.joined_at),
      updated_at = now();

  update public.salon_owner_transfer_invites
  set accepted_at = now(),
      accepted_by_user_id = actor_user_id,
      recipient_user_id = coalesce(recipient_user_id, actor_user_id),
      status = 'accepted',
      token_hash = null,
      updated_at = now()
  where id = invite_row.id
  returning * into invite_row;

  insert into public.salon_lifecycle_events (
    salon_id,
    actor_user_id,
    event_type,
    old_status,
    new_status,
    reason,
    metadata
  )
  values (
    invite_row.salon_id,
    actor_user_id,
    'OWNER_ACCEPTED',
    public.normalize_salon_lifecycle_status(salon_row.status),
    public.normalize_salon_lifecycle_status(salon_row.status),
    null,
    jsonb_build_object(
      'invite_id', invite_row.id,
      'mode', invite_row.mode,
      'recipient_user_id', actor_user_id,
      'inviter_user_id', invite_row.inviter_user_id
    )
  );

  if invite_row.mode = 'transfer_ownership'
    and invite_row.relinquish_inviter_on_accept
    and invite_row.inviter_user_id is not null
  then
    perform public.lifecycle_remove_owner_access_from_salon(
      invite_row.salon_id,
      invite_row.inviter_user_id,
      actor_user_id,
      'Relinquished after accepted owner transfer invitation.'
    );

    insert into public.salon_lifecycle_events (
      salon_id,
      actor_user_id,
      event_type,
      old_status,
      new_status,
      reason,
      metadata
    )
    values (
      invite_row.salon_id,
      actor_user_id,
      'OWNERSHIP_TRANSFER_COMPLETED',
      public.normalize_salon_lifecycle_status(salon_row.status),
      public.normalize_salon_lifecycle_status(salon_row.status),
      null,
      jsonb_build_object(
        'invite_id', invite_row.id,
        'from_user_id', invite_row.inviter_user_id,
        'to_user_id', actor_user_id
      )
    );
  end if;

  if invite_row.inviter_user_id is not null then
    insert into public.app_notifications (
      account_id,
      salon_id,
      recipient_user_id,
      recipient_kind,
      notification_type,
      title,
      body,
      href,
      event_key
    )
    select
      invite_row.account_id,
      invite_row.salon_id,
      invite_row.inviter_user_id,
      'owner_manager',
      'owner_transfer_accepted',
      'Owner invitation accepted',
      coalesce(actor_user_row.display_name, actor_user_row.email, 'A user') ||
        ' accepted ownership of ' || salon_row.name || '.',
      '/account#delete-account',
      'owner-transfer-accepted:' || invite_row.id::text
    where not exists (
      select 1
      from public.app_notifications existing_notifications
      where existing_notifications.event_key =
        'owner-transfer-accepted:' || invite_row.id::text
    );
  end if;

  return jsonb_build_object(
    'id', invite_row.id,
    'account_id', invite_row.account_id,
    'salon_id', invite_row.salon_id,
    'mode', invite_row.mode,
    'status', invite_row.status,
    'accepted_by_user_id', actor_user_id,
    'relinquished_inviter', invite_row.mode = 'transfer_ownership'
      and invite_row.relinquish_inviter_on_accept
  );
end;
$$;

grant execute on function public.accept_salon_owner_transfer_invite(text) to authenticated;

create or replace function public.get_account_deletion_owner_counts(
  p_salon_ids uuid[]
)
returns table (
  salon_id uuid,
  active_owner_count integer
)
language sql
stable
security definer
set search_path = public
as $$
  select
    salons.id,
    public.lifecycle_active_owner_count(salons.id, null) as active_owner_count
  from public.locations salons
  where p_salon_ids is not null
    and salons.id = any(p_salon_ids)
    and public.current_public_user_id() is not null
    and public.lifecycle_user_is_salon_owner(
      salons.id,
      public.current_public_user_id(),
      true
    );
$$;

revoke all on function public.get_account_deletion_owner_counts(uuid[]) from public, anon, authenticated;
grant execute on function public.get_account_deletion_owner_counts(uuid[]) to authenticated;

insert into public.account_memberships (
  account_id,
  user_id,
  role_id,
  status,
  joined_at
)
select
  invites.account_id,
  invites.accepted_by_user_id,
  roles.id,
  'active',
  coalesce(invites.accepted_at, now())
from public.salon_owner_transfer_invites invites
join public.roles roles
  on roles.account_id = invites.account_id
 and upper(roles.code) = 'OWNER'
where invites.status = 'accepted'
  and invites.accepted_by_user_id is not null
  and exists (
    select 1
    from public.salon_memberships memberships
    where memberships.account_id = invites.account_id
      and memberships.salon_id = invites.salon_id
      and memberships.user_id = invites.accepted_by_user_id
      and memberships.status = 'active'
      and memberships.role_id = roles.id
  )
on conflict (account_id, user_id) do update
set role_id = excluded.role_id,
    status = 'active',
    joined_at = coalesce(public.account_memberships.joined_at, excluded.joined_at),
    updated_at = now();

notify pgrst, 'reload schema';
