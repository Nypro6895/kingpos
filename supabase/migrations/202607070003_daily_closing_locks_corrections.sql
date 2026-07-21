alter table public.pos_daily_closings
add column if not exists locked_at timestamptz,
add column if not exists locked_by uuid references public.users(id) on delete restrict,
add column if not exists lock_type text,
add column if not exists lock_reason text,
add column if not exists note_snapshot text,
add column if not exists staff_earned_snapshot numeric(12,2),
add column if not exists tip_snapshot numeric(12,2),
add column if not exists discount_snapshot numeric(12,2),
add column if not exists gift_card_snapshot numeric(12,2),
add column if not exists expected_total_snapshot numeric(12,2),
add column if not exists actual_total_snapshot numeric(12,2),
add column if not exists difference_snapshot numeric(12,2),
add column if not exists cash_amount_snapshot numeric(12,2),
add column if not exists credit_card_amount_snapshot numeric(12,2),
add column if not exists other_amount_snapshot numeric(12,2),
add column if not exists ticket_count_snapshot integer,
add column if not exists finalized_ticket_count_snapshot integer,
add column if not exists snapshot_created_at timestamptz;

alter table public.pos_daily_closings
drop constraint if exists pos_daily_closings_status_check;

alter table public.pos_daily_closings
add constraint pos_daily_closings_status_check check (
  status in (
    'draft',
    'closed',
    'auto_locked',
    'locked',
    'reopened',
    'needs_review',
    'approved',
    'payroll_locked'
  )
);

create index if not exists pos_daily_closings_locked_at_idx
on public.pos_daily_closings(locked_at)
where locked_at is not null;

create or replace function public.protect_pos_daily_closing_lock_integrity()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  current_user_can_manage_payroll boolean;
begin
  current_user_can_manage_payroll :=
    public.user_has_organization_permission(
      new.organization_id,
      array['payroll.manage']::text[]
    );

  if tg_op = 'INSERT' and not current_user_can_manage_payroll then
    if new.status <> 'auto_locked'
      or new.locked_at is null
      or new.lock_type not in ('auto', 'system')
      or new.snapshot_created_at is null
    then
      raise exception 'Only payroll managers can create editable daily closings.';
    end if;
  end if;

  if tg_op = 'UPDATE' then
    if not current_user_can_manage_payroll then
      if old.locked_at is not null then
        raise exception 'Only payroll managers can update locked daily closing metadata.';
      end if;

      if new.status <> 'auto_locked'
        or new.locked_at is null
        or new.lock_type not in ('auto', 'system')
        or new.snapshot_created_at is null
        or new.cash_amount is distinct from old.cash_amount
        or new.credit_card_amount is distinct from old.credit_card_amount
        or new.other_amount is distinct from old.other_amount
        or new.note is distinct from old.note
        or new.closed_at is distinct from old.closed_at
        or new.closed_by is distinct from old.closed_by
        or new.approved_at is distinct from old.approved_at
        or new.approved_by is distinct from old.approved_by
      then
        raise exception 'Report viewers can only create an automatic daily closing lock.';
      end if;
    end if;

    if old.locked_at is not null
      and (
        new.cash_amount is distinct from old.cash_amount
        or new.credit_card_amount is distinct from old.credit_card_amount
        or new.other_amount is distinct from old.other_amount
        or new.note is distinct from old.note
      )
    then
      raise exception 'Locked daily closing inputs cannot be changed directly.';
    end if;

    if old.locked_at is not null
      and (
        new.locked_at is distinct from old.locked_at
        or new.locked_by is distinct from old.locked_by
        or new.lock_type is distinct from old.lock_type
        or new.lock_reason is distinct from old.lock_reason
      )
    then
      raise exception 'Daily closing lock metadata cannot be changed after locking.';
    end if;

    if old.snapshot_created_at is not null
      and (
        new.note_snapshot is distinct from old.note_snapshot
        or new.staff_earned_snapshot is distinct from old.staff_earned_snapshot
        or new.tip_snapshot is distinct from old.tip_snapshot
        or new.discount_snapshot is distinct from old.discount_snapshot
        or new.gift_card_snapshot is distinct from old.gift_card_snapshot
        or new.expected_total_snapshot is distinct from old.expected_total_snapshot
        or new.actual_total_snapshot is distinct from old.actual_total_snapshot
        or new.difference_snapshot is distinct from old.difference_snapshot
        or new.cash_amount_snapshot is distinct from old.cash_amount_snapshot
        or new.credit_card_amount_snapshot is distinct from old.credit_card_amount_snapshot
        or new.other_amount_snapshot is distinct from old.other_amount_snapshot
        or new.ticket_count_snapshot is distinct from old.ticket_count_snapshot
        or new.finalized_ticket_count_snapshot is distinct from old.finalized_ticket_count_snapshot
        or new.snapshot_created_at is distinct from old.snapshot_created_at
      )
    then
      raise exception 'Daily closing snapshots are immutable after creation.';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists protect_pos_daily_closing_lock_integrity
on public.pos_daily_closings;

create trigger protect_pos_daily_closing_lock_integrity
before insert or update on public.pos_daily_closings
for each row
execute function public.protect_pos_daily_closing_lock_integrity();

drop policy if exists "Report viewers can create auto locked salon daily closings"
on public.pos_daily_closings;
create policy "Report viewers can create auto locked salon daily closings"
on public.pos_daily_closings
for insert
to authenticated
with check (
  public.user_has_organization_permission(
    organization_id,
    array['reports.view']::text[]
  )
  and status = 'auto_locked'
  and locked_at is not null
  and lock_type in ('auto', 'system')
  and snapshot_created_at is not null
  and created_by = public.current_public_user_id()
  and (
    updated_by is null
    or updated_by = public.current_public_user_id()
  )
  and exists (
    select 1
    from public.locations
    where locations.id = pos_daily_closings.salon_id
      and locations.organization_id = pos_daily_closings.organization_id
  )
);

drop policy if exists "Report viewers can lock salon daily closings"
on public.pos_daily_closings;
create policy "Report viewers can lock salon daily closings"
on public.pos_daily_closings
for update
to authenticated
using (
  public.user_has_organization_permission(
    organization_id,
    array['reports.view']::text[]
  )
  and exists (
    select 1
    from public.locations
    where locations.id = pos_daily_closings.salon_id
      and locations.organization_id = pos_daily_closings.organization_id
  )
)
with check (
  public.user_has_organization_permission(
    organization_id,
    array['reports.view']::text[]
  )
  and (
    updated_by is null
    or updated_by = public.current_public_user_id()
  )
  and exists (
    select 1
    from public.locations
    where locations.id = pos_daily_closings.salon_id
      and locations.organization_id = pos_daily_closings.organization_id
  )
);

create table if not exists public.pos_daily_closing_staff_snapshots (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  salon_id uuid not null references public.locations(id) on delete cascade,
  closing_id uuid not null references public.pos_daily_closings(id) on delete cascade,
  report_date date not null,
  staff_id uuid references public.staff(id) on delete set null,
  staff_name_snapshot text not null,
  total_earned_snapshot numeric(12,2) not null default 0,
  tip_snapshot numeric(12,2) not null default 0,
  big_turn_count_snapshot numeric(12,2) not null default 0,
  small_turn_count_snapshot numeric(12,2) not null default 0,
  total_turns_snapshot numeric(12,2) not null default 0,
  created_at timestamptz not null default now(),
  constraint pos_daily_closing_staff_snapshots_name_not_blank check (
    length(btrim(staff_name_snapshot)) > 0
  ),
  constraint pos_daily_closing_staff_snapshots_closing_staff_unique unique (
    closing_id,
    staff_id
  )
);

create index if not exists pos_daily_closing_staff_snapshots_org_salon_date_idx
on public.pos_daily_closing_staff_snapshots(
  organization_id,
  salon_id,
  report_date
);

create index if not exists pos_daily_closing_staff_snapshots_closing_id_idx
on public.pos_daily_closing_staff_snapshots(closing_id);

create or replace function public.validate_pos_daily_closing_staff_snapshot_scope()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if not exists (
    select 1
    from public.pos_daily_closings
    where pos_daily_closings.id = new.closing_id
      and pos_daily_closings.organization_id = new.organization_id
      and pos_daily_closings.salon_id = new.salon_id
      and pos_daily_closings.report_date = new.report_date
  ) then
    raise exception 'Staff snapshot must belong to its daily closing.';
  end if;

  if new.staff_id is not null and not exists (
    select 1
    from public.staff
    where staff.id = new.staff_id
      and staff.organization_id = new.organization_id
      and staff.salon_id = new.salon_id
  ) then
    raise exception 'Staff snapshot staff must belong to the snapshot salon.';
  end if;

  return new;
end;
$$;

drop trigger if exists validate_pos_daily_closing_staff_snapshot_scope
on public.pos_daily_closing_staff_snapshots;

create trigger validate_pos_daily_closing_staff_snapshot_scope
before insert or update on public.pos_daily_closing_staff_snapshots
for each row
execute function public.validate_pos_daily_closing_staff_snapshot_scope();

alter table public.pos_daily_closing_staff_snapshots enable row level security;

drop policy if exists "Report viewers can view salon daily closing staff snapshots"
on public.pos_daily_closing_staff_snapshots;
create policy "Report viewers can view salon daily closing staff snapshots"
on public.pos_daily_closing_staff_snapshots
for select
to authenticated
using (
  public.user_has_organization_permission(
    organization_id,
    array['reports.view']::text[]
  )
  and exists (
    select 1
    from public.locations
    where locations.id = pos_daily_closing_staff_snapshots.salon_id
      and locations.organization_id =
        pos_daily_closing_staff_snapshots.organization_id
  )
);

drop policy if exists "Report viewers can create salon daily closing staff snapshots"
on public.pos_daily_closing_staff_snapshots;
create policy "Report viewers can create salon daily closing staff snapshots"
on public.pos_daily_closing_staff_snapshots
for insert
to authenticated
with check (
  public.user_has_organization_permission(
    organization_id,
    array['reports.view']::text[]
  )
  and exists (
    select 1
    from public.locations
    where locations.id = pos_daily_closing_staff_snapshots.salon_id
      and locations.organization_id =
        pos_daily_closing_staff_snapshots.organization_id
  )
);

create table if not exists public.pos_financial_correction_requests (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  salon_id uuid not null references public.locations(id) on delete cascade,
  business_date date not null,
  target_type text not null,
  target_id uuid,
  correction_type text not null,
  old_value_json jsonb,
  requested_value_json jsonb not null,
  money_delta numeric(12,2) not null default 0,
  reason text not null,
  status text not null default 'pending',
  requested_by uuid not null references public.users(id) on delete restrict,
  requested_at timestamptz not null default now(),
  approved_by uuid references public.users(id) on delete restrict,
  approved_at timestamptz,
  rejected_by uuid references public.users(id) on delete restrict,
  rejected_at timestamptz,
  applied_at timestamptz,
  admin_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint pos_financial_correction_requests_reason_not_blank check (
    length(btrim(reason)) > 0
  ),
  constraint pos_financial_correction_requests_target_type_check check (
    target_type in (
      'daily_closing',
      'pos_ticket',
      'staff_earning',
      'payroll',
      'other'
    )
  ),
  constraint pos_financial_correction_requests_correction_type_check check (
    correction_type in (
    'cash_amount',
    'credit_card_amount',
    'other_amount',
    'note',
    'service_amount',
    'ticket_amount',
    'tip',
    'discount',
    'turn_count',
    'staff_assignment',
    'void_ticket',
    'other'
    )
  ),
  constraint pos_financial_correction_requests_status_check check (
    status in ('pending', 'approved', 'rejected', 'applied')
  )
);

create index if not exists pos_financial_correction_requests_org_salon_date_idx
on public.pos_financial_correction_requests(
  organization_id,
  salon_id,
  business_date
);

create index if not exists pos_financial_correction_requests_status_idx
on public.pos_financial_correction_requests(status);

create index if not exists pos_financial_correction_requests_requested_by_idx
on public.pos_financial_correction_requests(requested_by);

drop trigger if exists update_pos_financial_correction_requests_updated_at
on public.pos_financial_correction_requests;

create trigger update_pos_financial_correction_requests_updated_at
before update on public.pos_financial_correction_requests
for each row
execute function public.update_updated_at_column();

create or replace function public.validate_pos_financial_correction_request_scope()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_op = 'UPDATE' then
    if old.status in ('applied', 'rejected') then
      raise exception 'Finalized financial correction requests cannot be changed.';
    end if;

    if new.organization_id is distinct from old.organization_id
      or new.salon_id is distinct from old.salon_id
      or new.business_date is distinct from old.business_date
      or new.target_type is distinct from old.target_type
      or new.target_id is distinct from old.target_id
      or new.correction_type is distinct from old.correction_type
      or new.old_value_json is distinct from old.old_value_json
      or new.requested_value_json is distinct from old.requested_value_json
      or new.requested_by is distinct from old.requested_by
      or new.requested_at is distinct from old.requested_at
      or new.created_at is distinct from old.created_at
    then
      raise exception 'Financial correction request scope cannot be changed.';
    end if;
  end if;

  if not exists (
    select 1
    from public.locations
    where locations.id = new.salon_id
      and locations.organization_id = new.organization_id
  ) then
    raise exception 'Financial correction request salon must belong to its organization.';
  end if;

  return new;
end;
$$;

drop trigger if exists validate_pos_financial_correction_request_scope
on public.pos_financial_correction_requests;

create trigger validate_pos_financial_correction_request_scope
before insert or update on public.pos_financial_correction_requests
for each row
execute function public.validate_pos_financial_correction_request_scope();

alter table public.pos_financial_correction_requests enable row level security;

drop policy if exists "Report viewers can view salon financial correction requests"
on public.pos_financial_correction_requests;
create policy "Report viewers can view salon financial correction requests"
on public.pos_financial_correction_requests
for select
to authenticated
using (
  public.user_has_organization_permission(
    organization_id,
    array['reports.view']::text[]
  )
  and exists (
    select 1
    from public.locations
    where locations.id = pos_financial_correction_requests.salon_id
      and locations.organization_id =
        pos_financial_correction_requests.organization_id
  )
);

drop policy if exists "Report viewers can create salon financial correction requests"
on public.pos_financial_correction_requests;
create policy "Report viewers can create salon financial correction requests"
on public.pos_financial_correction_requests
for insert
to authenticated
with check (
  public.user_has_organization_permission(
    organization_id,
    array[
      'reports.view',
      'tickets.manage',
      'tickets.void',
      'payroll.manage',
      'financial_corrections.request',
      'financial_corrections.apply'
    ]::text[]
  )
  and requested_by = public.current_public_user_id()
  and status = 'pending'
  and exists (
    select 1
    from public.locations
    where locations.id = pos_financial_correction_requests.salon_id
      and locations.organization_id =
        pos_financial_correction_requests.organization_id
  )
);

drop policy if exists "Payroll managers can review salon financial correction requests"
on public.pos_financial_correction_requests;
create policy "Payroll managers can review salon financial correction requests"
on public.pos_financial_correction_requests
for update
to authenticated
using (
  public.user_has_organization_permission(
    organization_id,
    array['payroll.manage', 'financial_corrections.apply']::text[]
  )
  and exists (
    select 1
    from public.locations
    where locations.id = pos_financial_correction_requests.salon_id
      and locations.organization_id =
        pos_financial_correction_requests.organization_id
  )
)
with check (
  public.user_has_organization_permission(
    organization_id,
    array['payroll.manage', 'financial_corrections.apply']::text[]
  )
  and exists (
    select 1
    from public.locations
    where locations.id = pos_financial_correction_requests.salon_id
      and locations.organization_id =
        pos_financial_correction_requests.organization_id
  )
);

create table if not exists public.pos_financial_adjustments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  salon_id uuid not null references public.locations(id) on delete cascade,
  business_date date not null,
  correction_request_id uuid references public.pos_financial_correction_requests(id),
  target_type text not null,
  target_id uuid,
  staff_id uuid references public.staff(id) on delete set null,
  ticket_id uuid references public.pos_tickets(id) on delete set null,
  cash_delta numeric(12,2) not null default 0,
  credit_card_delta numeric(12,2) not null default 0,
  other_delta numeric(12,2) not null default 0,
  service_delta numeric(12,2) not null default 0,
  tip_delta numeric(12,2) not null default 0,
  discount_delta numeric(12,2) not null default 0,
  gift_card_delta numeric(12,2) not null default 0,
  expected_total_delta numeric(12,2) not null default 0,
  actual_total_delta numeric(12,2) not null default 0,
  turn_delta numeric(12,2) not null default 0,
  note text,
  created_by uuid not null references public.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  constraint pos_financial_adjustments_target_type_check check (
    target_type in (
      'daily_closing',
      'pos_ticket',
      'staff_earning',
      'payroll',
      'other'
    )
  )
);

create index if not exists pos_financial_adjustments_org_salon_date_idx
on public.pos_financial_adjustments(
  organization_id,
  salon_id,
  business_date
);

create index if not exists pos_financial_adjustments_correction_request_id_idx
on public.pos_financial_adjustments(correction_request_id);

create index if not exists pos_financial_adjustments_created_by_idx
on public.pos_financial_adjustments(created_by);

insert into public.permissions (code, name, description, category, is_system)
values
  (
    'financial_corrections.request',
    'Request financial corrections',
    'Request locked-date financial corrections.',
    'Financial Corrections',
    true
  ),
  (
    'financial_corrections.apply',
    'Apply financial corrections',
    'Approve and apply locked-date financial corrections.',
    'Financial Corrections',
    true
  )
on conflict (code) do update
set
  name = excluded.name,
  description = excluded.description,
  category = excluded.category,
  is_system = excluded.is_system,
  updated_at = now();

insert into public.role_permissions (role_id, permission_id)
select roles.id, permissions.id
from public.roles
join public.permissions
  on permissions.code = any(
    case roles.code
      when 'OWNER' then array[
        'financial_corrections.request',
        'financial_corrections.apply'
      ]
      when 'MANAGER' then array[
        'financial_corrections.request'
      ]
      when 'FRONT_DESK' then array[
        'financial_corrections.request'
      ]
      when 'TECHNICIAN' then array[
        'financial_corrections.request'
      ]
      when 'ACCOUNTANT' then array[
        'financial_corrections.request',
        'financial_corrections.apply'
      ]
      else array[]::text[]
    end
  )
on conflict do nothing;

create or replace function public.validate_pos_financial_adjustment_scope()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_op <> 'INSERT' then
    raise exception 'Financial adjustments are append-only.';
  end if;

  if not exists (
    select 1
    from public.locations
    where locations.id = new.salon_id
      and locations.organization_id = new.organization_id
  ) then
    raise exception 'Financial adjustment salon must belong to its organization.';
  end if;

  if new.correction_request_id is not null and not exists (
    select 1
    from public.pos_financial_correction_requests
    where pos_financial_correction_requests.id = new.correction_request_id
      and pos_financial_correction_requests.organization_id = new.organization_id
      and pos_financial_correction_requests.salon_id = new.salon_id
      and pos_financial_correction_requests.business_date = new.business_date
  ) then
    raise exception 'Financial adjustment must reference an in-scope correction request.';
  end if;

  if new.staff_id is not null and not exists (
    select 1
    from public.staff
    where staff.id = new.staff_id
      and staff.organization_id = new.organization_id
      and staff.salon_id = new.salon_id
  ) then
    raise exception 'Financial adjustment staff must belong to its salon.';
  end if;

  if new.ticket_id is not null and not exists (
    select 1
    from public.pos_tickets
    where pos_tickets.id = new.ticket_id
      and pos_tickets.organization_id = new.organization_id
      and pos_tickets.salon_id = new.salon_id
  ) then
    raise exception 'Financial adjustment ticket must belong to its salon.';
  end if;

  return new;
end;
$$;

drop trigger if exists validate_pos_financial_adjustment_scope
on public.pos_financial_adjustments;

create trigger validate_pos_financial_adjustment_scope
before insert or update or delete on public.pos_financial_adjustments
for each row
execute function public.validate_pos_financial_adjustment_scope();

alter table public.pos_financial_adjustments enable row level security;

drop policy if exists "Report viewers can view salon financial adjustments"
on public.pos_financial_adjustments;
create policy "Report viewers can view salon financial adjustments"
on public.pos_financial_adjustments
for select
to authenticated
using (
  public.user_has_organization_permission(
    organization_id,
    array['reports.view']::text[]
  )
  and exists (
    select 1
    from public.locations
    where locations.id = pos_financial_adjustments.salon_id
      and locations.organization_id =
        pos_financial_adjustments.organization_id
  )
);

drop policy if exists "Payroll managers can create salon financial adjustments"
on public.pos_financial_adjustments;
create policy "Payroll managers can create salon financial adjustments"
on public.pos_financial_adjustments
for insert
to authenticated
with check (
  public.user_has_organization_permission(
    organization_id,
    array['payroll.manage', 'financial_corrections.apply']::text[]
  )
  and created_by = public.current_public_user_id()
  and correction_request_id is not null
  and exists (
    select 1
    from public.locations
    where locations.id = pos_financial_adjustments.salon_id
      and locations.organization_id =
        pos_financial_adjustments.organization_id
  )
);
