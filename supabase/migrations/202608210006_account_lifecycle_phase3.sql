alter table public.users
  add column if not exists deletion_finalization_started_at timestamptz,
  add column if not exists deletion_finalized_at timestamptz,
  add column if not exists deletion_finalization_attempts integer not null default 0,
  add column if not exists deletion_finalization_failed_at timestamptz,
  add column if not exists deletion_finalization_error text;

alter table public.salon_lifecycle_events
  add column if not exists event_type text;

create table if not exists public.deleted_auth_identities (
  auth_user_id uuid primary key,
  user_id uuid not null references public.users(id) on delete cascade,
  deleted_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb
);

alter table public.deleted_auth_identities enable row level security;

create table if not exists public.lifecycle_support_admins (
  user_id uuid primary key references public.users(id) on delete cascade,
  granted_by_user_id uuid references public.users(id) on delete set null,
  status text not null default 'active',
  reason text,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint lifecycle_support_admins_status_check
    check (status in ('active', 'revoked'))
);

drop trigger if exists set_lifecycle_support_admins_updated_at on public.lifecycle_support_admins;
create trigger set_lifecycle_support_admins_updated_at
before update on public.lifecycle_support_admins
for each row execute function public.set_updated_at();

alter table public.lifecycle_support_admins enable row level security;

create table if not exists public.lifecycle_exports (
  id uuid primary key default gen_random_uuid(),
  export_type text not null,
  account_id uuid references public.accounts(id) on delete set null,
  salon_id uuid references public.locations(id) on delete set null,
  subject_user_id uuid references public.users(id) on delete set null,
  requested_by_user_id uuid references public.users(id) on delete set null,
  status text not null default 'created',
  storage_bucket text not null default 'lifecycle-exports',
  storage_path text not null,
  content_type text not null default 'application/json',
  manifest jsonb not null default '{}'::jsonb,
  expires_at timestamptz not null default (now() + interval '7 days'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint lifecycle_exports_type_check
    check (export_type in ('account_deletion', 'account_data', 'salon_lifecycle')),
  constraint lifecycle_exports_status_check
    check (status in ('created', 'stored', 'failed', 'expired'))
);

create index if not exists lifecycle_exports_requester_created_idx
on public.lifecycle_exports(requested_by_user_id, created_at desc);

create index if not exists lifecycle_exports_salon_created_idx
on public.lifecycle_exports(salon_id, created_at desc)
where salon_id is not null;

drop trigger if exists set_lifecycle_exports_updated_at on public.lifecycle_exports;
create trigger set_lifecycle_exports_updated_at
before update on public.lifecycle_exports
for each row execute function public.set_updated_at();

alter table public.lifecycle_exports enable row level security;

create or replace function public.record_lifecycle_export_created()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.salon_id is not null then
    insert into public.salon_lifecycle_events (
      salon_id,
      actor_user_id,
      event_type,
      old_status,
      new_status,
      reason,
      metadata
    )
    select
      new.salon_id,
      new.requested_by_user_id,
      'EXPORT_CREATED',
      public.normalize_salon_lifecycle_status(salons.status),
      public.normalize_salon_lifecycle_status(salons.status),
      null,
      jsonb_build_object(
        'export_id', new.id,
        'export_type', new.export_type,
        'expires_at', new.expires_at
      )
    from public.locations salons
    where salons.id = new.salon_id;
  end if;

  if new.subject_user_id is not null then
    insert into public.account_lifecycle_events (
      user_id,
      actor_user_id,
      event_type,
      metadata
    )
    values (
      new.subject_user_id,
      new.requested_by_user_id,
      'export_created',
      jsonb_build_object(
        'export_id', new.id,
        'export_type', new.export_type,
        'expires_at', new.expires_at
      )
    );
  end if;

  return new;
end;
$$;

drop trigger if exists record_lifecycle_export_created on public.lifecycle_exports;
create trigger record_lifecycle_export_created
after insert on public.lifecycle_exports
for each row execute function public.record_lifecycle_export_created();

drop policy if exists "lifecycle_export_requester_read" on public.lifecycle_exports;
create policy "lifecycle_export_requester_read" on public.lifecycle_exports
for select to authenticated
using (requested_by_user_id = public.current_public_user_id());

drop policy if exists "lifecycle_export_requester_insert" on public.lifecycle_exports;
create policy "lifecycle_export_requester_insert" on public.lifecycle_exports
for insert to authenticated
with check (requested_by_user_id = public.current_public_user_id());

drop policy if exists "lifecycle_export_requester_update" on public.lifecycle_exports;
create policy "lifecycle_export_requester_update" on public.lifecycle_exports
for update to authenticated
using (requested_by_user_id = public.current_public_user_id())
with check (requested_by_user_id = public.current_public_user_id());

insert into storage.buckets (
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types
)
values (
  'lifecycle-exports',
  'lifecycle-exports',
  false,
  52428800,
  array['application/json']
)
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "lifecycle_export_requesters_read_objects" on storage.objects;
create policy "lifecycle_export_requesters_read_objects" on storage.objects
for select to authenticated
using (
  bucket_id = 'lifecycle-exports'
  and split_part(storage.objects.name, '/', 1) = public.current_public_user_id()::text
);

drop policy if exists "lifecycle_export_requesters_insert_objects" on storage.objects;
create policy "lifecycle_export_requesters_insert_objects" on storage.objects
for insert to authenticated
with check (
  bucket_id = 'lifecycle-exports'
  and split_part(storage.objects.name, '/', 1) = public.current_public_user_id()::text
);

drop policy if exists "lifecycle_export_requesters_update_objects" on storage.objects;
create policy "lifecycle_export_requesters_update_objects" on storage.objects
for update to authenticated
using (
  bucket_id = 'lifecycle-exports'
  and split_part(storage.objects.name, '/', 1) = public.current_public_user_id()::text
)
with check (
  bucket_id = 'lifecycle-exports'
  and split_part(storage.objects.name, '/', 1) = public.current_public_user_id()::text
);

create table if not exists public.salon_owner_transfer_invites (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete cascade,
  salon_id uuid not null references public.locations(id) on delete cascade,
  inviter_user_id uuid references public.users(id) on delete set null,
  recipient_user_id uuid references public.users(id) on delete set null,
  accepted_by_user_id uuid references public.users(id) on delete set null,
  target_email_normalized text,
  token_hash text,
  mode text not null default 'add_co_owner',
  relinquish_inviter_on_accept boolean not null default false,
  status text not null default 'pending',
  message text,
  accepted_at timestamptz,
  revoked_at timestamptz,
  expires_at timestamptz not null default (now() + interval '14 days'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint salon_owner_transfer_invites_mode_check
    check (mode in ('add_co_owner', 'transfer_ownership')),
  constraint salon_owner_transfer_invites_status_check
    check (status in ('pending', 'accepted', 'revoked', 'expired')),
  constraint salon_owner_transfer_invites_recipient_check
    check (recipient_user_id is not null or target_email_normalized is not null)
);

create unique index if not exists salon_owner_transfer_invites_token_hash_idx
on public.salon_owner_transfer_invites(token_hash)
where token_hash is not null;

create index if not exists salon_owner_transfer_invites_salon_status_idx
on public.salon_owner_transfer_invites(salon_id, status, created_at desc);

drop trigger if exists set_salon_owner_transfer_invites_updated_at on public.salon_owner_transfer_invites;
create trigger set_salon_owner_transfer_invites_updated_at
before update on public.salon_owner_transfer_invites
for each row execute function public.set_updated_at();

alter table public.salon_owner_transfer_invites enable row level security;

drop policy if exists "owner_transfer_inviter_or_recipient_read" on public.salon_owner_transfer_invites;
create policy "owner_transfer_inviter_or_recipient_read" on public.salon_owner_transfer_invites
for select to authenticated
using (
  inviter_user_id = public.current_public_user_id()
  or recipient_user_id = public.current_public_user_id()
  or (
    recipient_user_id is null
    and target_email_normalized is not null
    and exists (
      select 1
      from public.users
      where users.id = public.current_public_user_id()
        and lower(users.email) = salon_owner_transfer_invites.target_email_normalized
    )
  )
);

create or replace function public.auth_identity_is_deleted(p_auth_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select p_auth_user_id is not null
    and p_auth_user_id = auth.uid()
    and exists (
      select 1
      from public.deleted_auth_identities deleted_identities
      where deleted_identities.auth_user_id = p_auth_user_id
    )
$$;

create or replace function public.lifecycle_current_user_is_support_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.lifecycle_support_admins admins
    join public.users users on users.id = admins.user_id
    where admins.user_id = public.current_public_user_id()
      and admins.status = 'active'
      and admins.revoked_at is null
      and users.status = 'active'
  )
$$;

create or replace function public.lifecycle_user_is_salon_owner(
  p_salon_id uuid,
  p_user_id uuid,
  p_count_pending_deletion boolean default true
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.locations salons
    join public.account_memberships memberships
      on memberships.account_id = salons.account_id
    join public.roles roles
      on roles.id = memberships.role_id
    join public.users owner_users
      on owner_users.id = memberships.user_id
    where salons.id = p_salon_id
      and memberships.user_id = p_user_id
      and memberships.status = 'active'
      and upper(roles.code) = 'OWNER'
      and (
        owner_users.status = 'active'
        or (p_count_pending_deletion and owner_users.status = 'pending_deletion')
      )
  )
  or exists (
    select 1
    from public.salon_memberships memberships
    join public.roles roles
      on roles.id = memberships.role_id
    join public.users owner_users
      on owner_users.id = memberships.user_id
    where memberships.salon_id = p_salon_id
      and memberships.user_id = p_user_id
      and memberships.status = 'active'
      and upper(roles.code) = 'OWNER'
      and (
        owner_users.status = 'active'
        or (p_count_pending_deletion and owner_users.status = 'pending_deletion')
      )
  )
$$;

create or replace function public.lifecycle_active_owner_count(
  p_salon_id uuid,
  p_excluding_user_id uuid default null
)
returns integer
language sql
stable
security definer
set search_path = public
as $$
  with owner_users as (
    select distinct memberships.user_id
    from public.locations salons
    join public.account_memberships memberships
      on memberships.account_id = salons.account_id
    join public.roles roles
      on roles.id = memberships.role_id
    join public.users users
      on users.id = memberships.user_id
    where salons.id = p_salon_id
      and memberships.status = 'active'
      and users.status = 'active'
      and upper(roles.code) = 'OWNER'
      and (p_excluding_user_id is null or memberships.user_id <> p_excluding_user_id)
    union
    select distinct memberships.user_id
    from public.salon_memberships memberships
    join public.roles roles
      on roles.id = memberships.role_id
    join public.users users
      on users.id = memberships.user_id
    where memberships.salon_id = p_salon_id
      and memberships.status = 'active'
      and users.status = 'active'
      and upper(roles.code) = 'OWNER'
      and (p_excluding_user_id is null or memberships.user_id <> p_excluding_user_id)
  )
  select count(*)::integer from owner_users
$$;

create or replace function public.user_can_manage_salon(target_salon_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.locations salons
    join public.account_memberships memberships
      on memberships.account_id = salons.account_id
    left join public.roles roles
      on roles.id = memberships.role_id
    where salons.id = target_salon_id
      and memberships.user_id = public.current_public_user_id()
      and memberships.status = 'active'
      and (upper(roles.code) = 'OWNER' or upper(roles.code) = 'MANAGER')
  )
  or exists (
    select 1
    from public.salon_memberships memberships
    left join public.roles roles
      on roles.id = memberships.role_id
    where memberships.salon_id = target_salon_id
      and memberships.user_id = public.current_public_user_id()
      and memberships.status = 'active'
      and (upper(roles.code) = 'OWNER' or upper(roles.code) = 'MANAGER')
  )
$$;

create or replace function public.user_has_salon_permission(
  target_salon_id uuid,
  permission_codes text[]
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.locations salons
    where salons.id = target_salon_id
      and public.user_has_account_permission(salons.account_id, permission_codes)
  )
  or exists (
    select 1
    from public.salon_memberships memberships
    join public.roles roles on roles.id = memberships.role_id
    left join public.role_permissions role_permissions on role_permissions.role_id = roles.id
    left join public.permissions permissions on permissions.id = role_permissions.permission_id
    where memberships.salon_id = target_salon_id
      and memberships.user_id = public.current_public_user_id()
      and memberships.status = 'active'
      and (
        upper(roles.code) = 'OWNER'
        or permissions.code = any(permission_codes)
      )
  )
$$;

drop policy if exists "salon_member_read_accounts" on public.accounts;
create policy "salon_member_read_accounts" on public.accounts
for select to authenticated
using (
  exists (
    select 1
    from public.salon_memberships memberships
    where memberships.account_id = accounts.id
      and memberships.user_id = public.current_public_user_id()
      and memberships.status = 'active'
  )
);

drop policy if exists "salon_member_read_locations_by_membership" on public.locations;
create policy "salon_member_read_locations_by_membership" on public.locations
for select to authenticated
using (
  exists (
    select 1
    from public.salon_memberships memberships
    where memberships.salon_id = locations.id
      and memberships.user_id = public.current_public_user_id()
      and memberships.status = 'active'
  )
);

drop policy if exists "salon_member_read_roles" on public.roles;
create policy "salon_member_read_roles" on public.roles
for select to authenticated
using (
  exists (
    select 1
    from public.salon_memberships memberships
    where memberships.account_id = roles.account_id
      and memberships.user_id = public.current_public_user_id()
      and memberships.status = 'active'
  )
);

drop policy if exists "salon_member_read_own_role_permissions" on public.role_permissions;
create policy "salon_member_read_own_role_permissions" on public.role_permissions
for select to authenticated
using (
  exists (
    select 1
    from public.salon_memberships memberships
    where memberships.role_id = role_permissions.role_id
      and memberships.user_id = public.current_public_user_id()
      and memberships.status = 'active'
  )
);

drop policy if exists "salon_member_read_account_memberships_for_salon_account" on public.account_memberships;
create policy "salon_member_read_account_memberships_for_salon_account" on public.account_memberships
for select to authenticated
using (
  exists (
    select 1
    from public.salon_memberships memberships
    where memberships.account_id = account_memberships.account_id
      and memberships.user_id = public.current_public_user_id()
      and memberships.status = 'active'
  )
);

drop policy if exists "salon_member_read_lifecycle_events" on public.salon_lifecycle_events;
create policy "salon_member_read_lifecycle_events" on public.salon_lifecycle_events
for select to authenticated
using (
  exists (
    select 1
    from public.locations salons
    where salons.id = salon_lifecycle_events.salon_id
      and (
        public.user_belongs_to_account(salons.account_id)
        or exists (
          select 1
          from public.salon_memberships memberships
          where memberships.salon_id = salons.id
            and memberships.user_id = public.current_public_user_id()
            and memberships.status = 'active'
        )
      )
  )
);

create or replace function public.normalize_lifecycle_email(p_email text)
returns text
language sql
immutable
as $$
  select nullif(lower(btrim(coalesce(p_email, ''))), '')
$$;

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

  select count(*), min(id)
  into recipient_user_count, resolved_recipient_user_id
  from public.users
  where lower(email) = recipient_email
    and status = 'active';

  if recipient_user_count > 1 then
    raise exception 'More than one active account matches that email.';
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

create or replace function public.lifecycle_remove_owner_access_from_salon(
  p_salon_id uuid,
  p_owner_user_id uuid,
  p_actor_user_id uuid,
  p_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  account_owner_role_id uuid;
  account_owner_removed boolean := false;
  direct_owner_removed boolean := false;
  owner_role_id uuid;
  other_salon public.locations%rowtype;
  salon_row public.locations%rowtype;
begin
  select *
  into salon_row
  from public.locations
  where id = p_salon_id
  for update;

  if salon_row.id is null then
    raise exception 'Salon was not found.';
  end if;

  if not public.lifecycle_user_is_salon_owner(p_salon_id, p_owner_user_id, true) then
    return jsonb_build_object(
      'ok', true,
      'changed', false,
      'salon_id', p_salon_id,
      'owner_user_id', p_owner_user_id
    );
  end if;

  if public.normalize_salon_lifecycle_status(salon_row.status) = 'active'
    and public.lifecycle_active_owner_count(p_salon_id, p_owner_user_id) = 0
  then
    raise exception 'An active salon must retain another active Owner.';
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

  update public.salon_memberships
  set status = 'removed',
      updated_at = now()
  where salon_id = p_salon_id
    and user_id = p_owner_user_id
    and status = 'active'
    and role_id in (
      select id from public.roles where account_id = salon_row.account_id and upper(code) = 'OWNER'
    );

  direct_owner_removed := found;

  select memberships.role_id
  into account_owner_role_id
  from public.account_memberships memberships
  join public.roles roles on roles.id = memberships.role_id
  where memberships.account_id = salon_row.account_id
    and memberships.user_id = p_owner_user_id
    and memberships.status = 'active'
    and upper(roles.code) = 'OWNER'
  limit 1;

  if account_owner_role_id is not null then
    for other_salon in
      select *
      from public.locations
      where account_id = salon_row.account_id
        and id <> p_salon_id
    loop
      insert into public.salon_memberships (
        account_id,
        salon_id,
        user_id,
        role_id,
        status,
        joined_at
      )
      values (
        other_salon.account_id,
        other_salon.id,
        p_owner_user_id,
        owner_role_id,
        'active',
        now()
      )
      on conflict (salon_id, user_id) do update
      set role_id = excluded.role_id,
          status = 'active',
          joined_at = coalesce(public.salon_memberships.joined_at, excluded.joined_at),
          updated_at = now();
    end loop;

    update public.account_memberships
    set status = 'removed',
        updated_at = now()
    where account_id = salon_row.account_id
      and user_id = p_owner_user_id
      and status = 'active'
      and role_id = account_owner_role_id;

    account_owner_removed := found;
  end if;

  if direct_owner_removed or account_owner_removed then
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
      p_salon_id,
      p_actor_user_id,
      'OWNER_REMOVED',
      public.normalize_salon_lifecycle_status(salon_row.status),
      public.normalize_salon_lifecycle_status(salon_row.status),
      nullif(btrim(coalesce(p_reason, '')), ''),
      jsonb_build_object(
        'removed_user_id', p_owner_user_id,
        'direct_owner_removed', direct_owner_removed,
        'account_owner_removed', account_owner_removed
      )
    );
  end if;

  return jsonb_build_object(
    'ok', true,
    'changed', direct_owner_removed or account_owner_removed,
    'salon_id', p_salon_id,
    'owner_user_id', p_owner_user_id,
    'direct_owner_removed', direct_owner_removed,
    'account_owner_removed', account_owner_removed
  );
end;
$$;

create or replace function public.relinquish_current_salon_ownership(
  p_salon_id uuid,
  p_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  actor_user_id uuid := public.current_public_user_id();
begin
  if actor_user_id is null then
    raise exception 'Authenticated public user is required.';
  end if;

  if not public.lifecycle_user_is_salon_owner(p_salon_id, actor_user_id, true) then
    raise exception 'Only a current Owner can relinquish ownership.';
  end if;

  return public.lifecycle_remove_owner_access_from_salon(
    p_salon_id,
    actor_user_id,
    actor_user_id,
    p_reason
  );
end;
$$;

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

create or replace function public.accept_salon_owner_transfer_invite_by_id(
  p_invite_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  invite_token_hash text;
begin
  select token_hash
  into invite_token_hash
  from public.salon_owner_transfer_invites
  where id = p_invite_id;

  if invite_token_hash is null then
    raise exception 'Owner invitation was not found or is no longer pending.';
  end if;

  return public.accept_salon_owner_transfer_invite(invite_token_hash);
end;
$$;

create or replace function public.revoke_salon_owner_transfer_invite(
  p_invite_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  actor_user_id uuid := public.current_public_user_id();
  invite_row public.salon_owner_transfer_invites%rowtype;
begin
  if actor_user_id is null then
    raise exception 'Authenticated public user is required.';
  end if;

  select *
  into invite_row
  from public.salon_owner_transfer_invites
  where id = p_invite_id
  for update;

  if invite_row.id is null then
    raise exception 'Owner invitation was not found.';
  end if;

  if invite_row.inviter_user_id <> actor_user_id
    and not public.lifecycle_user_is_salon_owner(invite_row.salon_id, actor_user_id, true)
  then
    raise exception 'Only the inviting Owner or a current Owner can revoke this invitation.';
  end if;

  if invite_row.status <> 'pending' then
    return jsonb_build_object(
      'id', invite_row.id,
      'status', invite_row.status,
      'changed', false
    );
  end if;

  update public.salon_owner_transfer_invites
  set revoked_at = now(),
      status = 'revoked',
      token_hash = null,
      updated_at = now()
  where id = invite_row.id
  returning * into invite_row;

  return jsonb_build_object(
    'id', invite_row.id,
    'status', invite_row.status,
    'changed', true
  );
end;
$$;

create or replace function public.account_deletion_unresolved_owned_salon_count(
  p_user_id uuid
)
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select count(distinct salons.id)::integer
  from public.locations salons
  where public.normalize_salon_lifecycle_status(salons.status) <> 'permanently_closed'
    and (
      exists (
        select 1
        from public.account_memberships memberships
        join public.roles roles on roles.id = memberships.role_id
        where memberships.account_id = salons.account_id
          and memberships.user_id = p_user_id
          and memberships.status = 'active'
          and upper(roles.code) = 'OWNER'
      )
      or exists (
        select 1
        from public.salon_memberships memberships
        join public.roles roles on roles.id = memberships.role_id
        where memberships.salon_id = salons.id
          and memberships.user_id = p_user_id
          and memberships.status = 'active'
          and upper(roles.code) = 'OWNER'
      )
    )
    and not public.account_deletion_other_active_owner_exists(salons.id, p_user_id)
$$;

create or replace function public.finalize_account_deletion(p_user_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  existing_started_event boolean;
  finalization_time timestamptz := now();
  unresolved_salon_count integer := 0;
  user_row public.users%rowtype;
begin
  if p_user_id is null then
    raise exception 'User id is required.';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('account-finalize:' || p_user_id::text, 0));

  select *
  into user_row
  from public.users
  where id = p_user_id
  for update;

  if user_row.id is null then
    return jsonb_build_object(
      'ok', false,
      'changed', false,
      'reason', 'not_found',
      'user_id', p_user_id
    );
  end if;

  if user_row.status = 'deleted' and user_row.anonymized_at is not null then
    return jsonb_build_object(
      'ok', true,
      'changed', false,
      'status', user_row.status,
      'user_id', user_row.id
    );
  end if;

  if user_row.status <> 'pending_deletion' then
    return jsonb_build_object(
      'ok', true,
      'changed', false,
      'reason', 'not_pending_deletion',
      'status', user_row.status,
      'user_id', user_row.id
    );
  end if;

  if user_row.deletion_scheduled_for is null
    or user_row.deletion_scheduled_for > finalization_time
  then
    return jsonb_build_object(
      'ok', true,
      'changed', false,
      'reason', 'not_due',
      'scheduled_for', user_row.deletion_scheduled_for,
      'user_id', user_row.id
    );
  end if;

  unresolved_salon_count :=
    public.account_deletion_unresolved_owned_salon_count(user_row.id);

  if unresolved_salon_count > 0 then
    update public.users
    set deletion_finalization_attempts = deletion_finalization_attempts + 1,
        deletion_finalization_failed_at = finalization_time,
        deletion_finalization_error =
          'Ownership constraints unresolved for ' || unresolved_salon_count::text || ' salon(s).',
        updated_at = now()
    where id = user_row.id;

    insert into public.account_lifecycle_events (
      user_id,
      actor_user_id,
      event_type,
      metadata
    )
    values (
      user_row.id,
      null,
      'account_deletion_failed',
      jsonb_build_object(
        'failed_at', finalization_time,
        'reason', 'ownership_unresolved',
        'unresolved_salon_count', unresolved_salon_count
      )
    );

    return jsonb_build_object(
      'ok', false,
      'changed', false,
      'reason', 'ownership_unresolved',
      'unresolved_salon_count', unresolved_salon_count,
      'user_id', user_row.id
    );
  end if;

  select exists (
    select 1
    from public.account_lifecycle_events events
    where events.user_id = user_row.id
      and events.event_type = 'account_deletion_finalization_started'
  )
  into existing_started_event;

  update public.users
  set deletion_finalization_started_at = coalesce(
        deletion_finalization_started_at,
        finalization_time
      ),
      deletion_finalization_attempts = deletion_finalization_attempts + 1,
      deletion_finalization_failed_at = null,
      deletion_finalization_error = null,
      updated_at = now()
  where id = user_row.id;

  if not existing_started_event then
    insert into public.account_lifecycle_events (
      user_id,
      actor_user_id,
      event_type,
      metadata
    )
    values (
      user_row.id,
      null,
      'account_deletion_finalization_started',
      jsonb_build_object(
        'started_at', finalization_time,
        'scheduled_for', user_row.deletion_scheduled_for
      )
    );
  end if;

  if user_row.auth_user_id is not null then
    insert into public.deleted_auth_identities (
      auth_user_id,
      user_id,
      deleted_at,
      metadata
    )
    values (
      user_row.auth_user_id,
      user_row.id,
      finalization_time,
      jsonb_build_object('source', 'account_deletion_finalizer')
    )
    on conflict (auth_user_id) do update
    set user_id = excluded.user_id,
        deleted_at = coalesce(public.deleted_auth_identities.deleted_at, excluded.deleted_at),
        metadata = public.deleted_auth_identities.metadata || excluded.metadata;
  end if;

  update public.account_memberships
  set status = 'removed',
      updated_at = now()
  where user_id = user_row.id
    and status = 'active';

  update public.salon_memberships
  set status = 'removed',
      updated_at = now()
  where user_id = user_row.id
    and status = 'active';

  update public.staff
  set account_user_id = null,
      user_id = null,
      public_bio = null,
      public_profile_photo_path = null,
      public_profile_visible = false,
      owner_public_enabled = false,
      salon_profile_content_posting_enabled = false,
      staff_public_consent_status = 'not_requested',
      updated_at = now()
  where account_user_id = user_row.id
     or user_id = user_row.auth_user_id;

  delete from public.salon_profile_look_saves
  where user_id = user_row.id;

  delete from public.salon_profile_follows
  where user_id = user_row.id;

  delete from public.account_favorite_customers
  where user_id = user_row.id;

  update public.beauty_profiles
  set bio = null,
      cover_media_path = null,
      visibility = 'self',
      updated_at = now()
  where user_id = user_row.id;

  update public.beauty_posts
  set visibility = 'self',
      updated_at = now()
  where author_user_id = user_row.id;

  delete from public.beauty_profile_follows
  where user_id = user_row.id
     or profile_id in (
       select id
       from public.beauty_profiles
       where user_id = user_row.id
     );

  delete from public.account_post_saves
  where user_id = user_row.id;

  delete from public.app_notifications
  where recipient_user_id = user_row.id;

  update public.salon_profile_comments
  set author_display_name = case
        when author_user_id = user_row.id then 'Deleted user'
        else author_display_name
      end,
      updated_at = now()
  where author_user_id = user_row.id;

  update public.users
  set auth_user_id = null,
      email = null,
      phone = null,
      first_name = null,
      last_name = null,
      display_name = 'Deleted user',
      avatar_url = null,
      status = 'deleted',
      deleted_at = coalesce(deleted_at, finalization_time),
      anonymized_at = coalesce(anonymized_at, finalization_time),
      deletion_finalized_at = coalesce(deletion_finalized_at, finalization_time),
      deletion_finalization_failed_at = null,
      deletion_finalization_error = null,
      last_login_at = null,
      updated_at = now()
  where id = user_row.id
  returning * into user_row;

  insert into public.account_lifecycle_events (
    user_id,
    actor_user_id,
    event_type,
    metadata
  )
  select
    user_row.id,
    null,
    'account_anonymized',
    jsonb_build_object(
      'anonymized_at', user_row.anonymized_at,
      'auth_identity_disconnected', true
    )
  where not exists (
    select 1
    from public.account_lifecycle_events events
    where events.user_id = user_row.id
      and events.event_type = 'account_anonymized'
  );

  insert into public.account_lifecycle_events (
    user_id,
    actor_user_id,
    event_type,
    metadata
  )
  select
    user_row.id,
    null,
    'account_deletion_finalized',
    jsonb_build_object(
      'finalized_at', user_row.deletion_finalized_at,
      'deleted_at', user_row.deleted_at
    )
  where not exists (
    select 1
    from public.account_lifecycle_events events
    where events.user_id = user_row.id
      and events.event_type = 'account_deletion_finalized'
  );

  return jsonb_build_object(
    'ok', true,
    'changed', true,
    'status', user_row.status,
    'deleted_at', user_row.deleted_at,
    'anonymized_at', user_row.anonymized_at,
    'user_id', user_row.id
  );
exception
  when others then
    update public.users
    set deletion_finalization_attempts = deletion_finalization_attempts + 1,
        deletion_finalization_failed_at = now(),
        deletion_finalization_error = sqlerrm,
        updated_at = now()
    where id = p_user_id;

    insert into public.account_lifecycle_events (
      user_id,
      actor_user_id,
      event_type,
      metadata
    )
    values (
      p_user_id,
      null,
      'account_deletion_failed',
      jsonb_build_object(
        'failed_at', now(),
        'reason', sqlerrm,
        'sqlstate', sqlstate
      )
    );

    return jsonb_build_object(
      'ok', false,
      'changed', false,
      'reason', sqlerrm,
      'sqlstate', sqlstate,
      'user_id', p_user_id
    );
end;
$$;

create or replace function public.finalize_due_account_deletions(
  p_limit integer default 25
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  finalized_count integer := 0;
  result_row jsonb;
  results jsonb := '[]'::jsonb;
  skipped_count integer := 0;
  target_user record;
begin
  for target_user in
    select id
    from public.users
    where status = 'pending_deletion'
      and deletion_scheduled_for is not null
      and deletion_scheduled_for <= now()
    order by deletion_scheduled_for asc, id asc
    limit greatest(1, least(coalesce(p_limit, 25), 100))
  loop
    result_row := public.finalize_account_deletion(target_user.id);
    results := results || jsonb_build_array(result_row);

    if coalesce((result_row ->> 'ok')::boolean, false)
      and coalesce((result_row ->> 'changed')::boolean, false)
    then
      finalized_count := finalized_count + 1;
    else
      skipped_count := skipped_count + 1;
    end if;
  end loop;

  return jsonb_build_object(
    'ok', true,
    'finalized_count', finalized_count,
    'skipped_count', skipped_count,
    'results', results
  );
end;
$$;

create or replace function public.recover_permanently_closed_salon(
  p_salon_id uuid,
  p_claimant_user_id uuid,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  actor_user_id uuid := public.current_public_user_id();
  claimant_has_history boolean := false;
  reason text := nullif(btrim(coalesce(p_reason, '')), '');
  salon_row public.locations%rowtype;
begin
  if actor_user_id is null then
    raise exception 'Authenticated support user is required.';
  end if;

  if not public.lifecycle_current_user_is_support_admin() then
    raise exception 'Privileged lifecycle recovery permission is required.';
  end if;

  if p_claimant_user_id is null then
    raise exception 'A verified claimant user is required.';
  end if;

  if reason is null then
    raise exception 'Recovery reason is required.';
  end if;

  select *
  into salon_row
  from public.locations
  where id = p_salon_id
  for update;

  if salon_row.id is null then
    raise exception 'Salon was not found.';
  end if;

  if public.normalize_salon_lifecycle_status(salon_row.status) <> 'permanently_closed' then
    raise exception 'Only permanently closed salons can use privileged recovery.';
  end if;

  select exists (
    select 1
    from public.account_memberships memberships
    join public.roles roles on roles.id = memberships.role_id
    where memberships.account_id = salon_row.account_id
      and memberships.user_id = p_claimant_user_id
      and upper(roles.code) = 'OWNER'
  )
  or exists (
    select 1
    from public.salon_memberships memberships
    join public.roles roles on roles.id = memberships.role_id
    where memberships.salon_id = salon_row.id
      and memberships.user_id = p_claimant_user_id
      and upper(roles.code) = 'OWNER'
  )
  into claimant_has_history;

  if not claimant_has_history then
    raise exception 'Claimant does not have retained historical ownership for this salon.';
  end if;

  update public.locations
  set status = 'disabled',
      disabled_at = now(),
      disabled_by = actor_user_id,
      disabled_reason = 'Privileged recovery from permanently closed: ' || reason,
      reactivated_at = null,
      reactivated_by = null,
      reactivation_reason = null,
      updated_at = now()
  where id = salon_row.id;

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
    salon_row.id,
    actor_user_id,
    'SALON_RECOVERY_APPROVED',
    'permanently_closed',
    'disabled',
    reason,
    jsonb_build_object(
      'claimant_user_id', p_claimant_user_id,
      'previous_closed_at', salon_row.closed_at,
      'recovered_at', now()
    )
  );

  return jsonb_build_object(
    'ok', true,
    'changed', true,
    'salon_id', salon_row.id,
    'status', 'disabled',
    'claimant_user_id', p_claimant_user_id
  );
end;
$$;

do $$
begin
  if to_regprocedure('cron.schedule(text,text,text)') is not null then
    begin
      execute $cron$
        select cron.schedule(
          'finalize-due-account-deletions',
          '17 * * * *',
          'select public.finalize_due_account_deletions(25);'
        )
      $cron$;
    exception
      when duplicate_object or invalid_schema_name or undefined_function or insufficient_privilege then
        null;
    end;
  end if;
end;
$$;

grant select on table public.deleted_auth_identities to service_role;
grant all on table public.lifecycle_support_admins to service_role;
grant select, insert, update on table public.lifecycle_exports to authenticated;
grant all on table public.lifecycle_exports to service_role;
grant select on table public.salon_owner_transfer_invites to authenticated;
grant all on table public.salon_owner_transfer_invites to service_role;

grant execute on function public.auth_identity_is_deleted(uuid) to authenticated;
grant execute on function public.lifecycle_current_user_is_support_admin() to authenticated;
grant execute on function public.lifecycle_user_is_salon_owner(uuid, uuid, boolean) to authenticated;
grant execute on function public.lifecycle_active_owner_count(uuid, uuid) to authenticated;
grant execute on function public.normalize_lifecycle_email(text) to authenticated;
grant execute on function public.create_salon_owner_transfer_invite(uuid, text, text, text, timestamptz, text, boolean) to authenticated;
grant execute on function public.accept_salon_owner_transfer_invite(text) to authenticated;
grant execute on function public.accept_salon_owner_transfer_invite_by_id(uuid) to authenticated;
grant execute on function public.revoke_salon_owner_transfer_invite(uuid) to authenticated;
grant execute on function public.relinquish_current_salon_ownership(uuid, text) to authenticated;
grant execute on function public.recover_permanently_closed_salon(uuid, uuid, text) to authenticated;
grant execute on function public.account_deletion_unresolved_owned_salon_count(uuid) to authenticated;
grant execute on function public.finalize_account_deletion(uuid) to service_role;
grant execute on function public.finalize_due_account_deletions(integer) to service_role;
