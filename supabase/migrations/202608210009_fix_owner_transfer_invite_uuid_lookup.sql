-- Fix owner transfer invite recipient lookup on PostgreSQL versions without min(uuid).

create or replace function public.create_salon_owner_transfer_invite(
  p_salon_id uuid,
  p_recipient_email text,
  p_mode text,
  p_token_hash text,
  p_expires_at timestamptz,
  p_message text default null,
  p_relinquish_on_accept boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  actor_user_id uuid := public.current_public_user_id();
  duplicate_invite_id uuid;
  invite_row public.salon_owner_transfer_invites%rowtype;
  owner_role_id uuid;
  recipient_email text := public.normalize_lifecycle_email(p_recipient_email);
  resolved_recipient_user_id uuid;
  recipient_user_count integer := 0;
  salon_row public.locations%rowtype;
begin
  if actor_user_id is null then
    raise exception 'Authenticated public user is required.';
  end if;

  select *
  into salon_row
  from public.locations
  where id = p_salon_id
  for update;

  if salon_row.id is null then
    raise exception 'Salon was not found.';
  end if;

  if public.normalize_salon_lifecycle_status(salon_row.status) = 'permanently_closed' then
    raise exception 'Permanently closed salons require privileged recovery before ownership changes.';
  end if;

  if not public.lifecycle_user_is_salon_owner(p_salon_id, actor_user_id, true) then
    raise exception 'Only a salon Owner can invite another Owner.';
  end if;

  if p_mode not in ('add_co_owner', 'transfer_ownership') then
    raise exception 'Owner invite mode must be add_co_owner or transfer_ownership.';
  end if;

  if p_token_hash is null or length(btrim(p_token_hash)) < 32 then
    raise exception 'A secure invite token hash is required.';
  end if;

  if p_expires_at is null or p_expires_at <= now() then
    raise exception 'Owner invitation expiration must be in the future.';
  end if;

  if recipient_email is null or recipient_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'A valid recipient email is required.';
  end if;

  select count(*)::integer
  into recipient_user_count
  from public.users
  where lower(email) = recipient_email
    and status = 'active';

  if recipient_user_count > 1 then
    raise exception 'More than one active account matches that email.';
  end if;

  if recipient_user_count = 1 then
    select id
    into resolved_recipient_user_id
    from public.users
    where lower(email) = recipient_email
      and status = 'active'
    order by id
    limit 1;
  end if;

  if resolved_recipient_user_id = actor_user_id then
    raise exception 'Choose a different account for ownership transfer.';
  end if;

  select id
  into owner_role_id
  from public.roles
  where account_id = salon_row.account_id
    and upper(code) = 'OWNER'
  limit 1;

  if owner_role_id is null then
    raise exception 'Owner role was not found for this salon account.';
  end if;

  select id
  into duplicate_invite_id
  from public.salon_owner_transfer_invites
  where salon_id = p_salon_id
    and status = 'pending'
    and expires_at > now()
    and (
      (resolved_recipient_user_id is not null and recipient_user_id = resolved_recipient_user_id)
      or target_email_normalized = recipient_email
    )
  limit 1;

  if duplicate_invite_id is not null then
    raise exception 'A pending owner invitation already exists for this recipient.';
  end if;

  insert into public.salon_owner_transfer_invites (
    account_id,
    salon_id,
    inviter_user_id,
    recipient_user_id,
    target_email_normalized,
    token_hash,
    mode,
    relinquish_inviter_on_accept,
    status,
    message,
    expires_at
  )
  values (
    salon_row.account_id,
    salon_row.id,
    actor_user_id,
    resolved_recipient_user_id,
    recipient_email,
    p_token_hash,
    p_mode,
    coalesce(p_relinquish_on_accept, false),
    'pending',
    nullif(btrim(coalesce(p_message, '')), ''),
    p_expires_at
  )
  returning * into invite_row;

  if resolved_recipient_user_id is not null then
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
      resolved_recipient_user_id,
      'owner_manager',
      'owner_transfer_invite',
      'Owner invitation',
      'You were invited to become an Owner of ' || salon_row.name || '.',
      '/ownership/invite/' || invite_row.id::text,
      'owner-transfer-invite:' || invite_row.id::text
    where not exists (
      select 1
      from public.app_notifications existing_notifications
      where existing_notifications.event_key =
        'owner-transfer-invite:' || invite_row.id::text
    );
  end if;

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
    'OWNER_INVITED',
    public.normalize_salon_lifecycle_status(salon_row.status),
    public.normalize_salon_lifecycle_status(salon_row.status),
    nullif(btrim(coalesce(p_message, '')), ''),
    jsonb_build_object(
      'invite_id', invite_row.id,
      'mode', invite_row.mode,
      'recipient_user_id', invite_row.recipient_user_id,
      'target_email_normalized', invite_row.target_email_normalized,
      'expires_at', invite_row.expires_at
    )
  );

  return jsonb_build_object(
    'id', invite_row.id,
    'account_id', invite_row.account_id,
    'salon_id', invite_row.salon_id,
    'recipient_user_id', invite_row.recipient_user_id,
    'target_email_normalized', invite_row.target_email_normalized,
    'mode', invite_row.mode,
    'status', invite_row.status,
    'expires_at', invite_row.expires_at
  );
end;
$$;

grant execute on function public.create_salon_owner_transfer_invite(
  uuid,
  text,
  text,
  text,
  timestamptz,
  text,
  boolean
) to authenticated;
