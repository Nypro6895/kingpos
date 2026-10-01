alter table public.pos_settings
add column if not exists staff_check_in_enabled boolean not null default false;

alter table public.staff
add column if not exists passcode_salt text,
add column if not exists passcode_digest text,
add column if not exists passcode_is_default boolean not null default true;

update public.staff
set passcode_salt = coalesce(passcode_salt, encode(extensions.gen_random_bytes(16), 'hex'))
where passcode_salt is null;

update public.staff
set passcode_digest = encode(
      extensions.digest(
        salon_id::text || ':' || id::text || ':1234:' || passcode_salt,
        'sha256'
      ),
      'hex'
    ),
    passcode_is_default = true
where passcode_digest is null;

alter table public.staff
alter column passcode_salt set not null,
alter column passcode_digest set not null,
alter column passcode_is_default set default true;

alter table public.staff
drop constraint if exists staff_passcode_salt_not_blank;

alter table public.staff
add constraint staff_passcode_salt_not_blank
check (length(btrim(passcode_salt)) > 0);

alter table public.staff
drop constraint if exists staff_passcode_digest_not_blank;

alter table public.staff
add constraint staff_passcode_digest_not_blank
check (length(btrim(passcode_digest)) > 0);

create or replace function public.set_default_staff_passcode()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.id is null then
    new.id := extensions.gen_random_uuid();
  end if;

  if new.passcode_salt is null or btrim(new.passcode_salt) = '' then
    new.passcode_salt := encode(extensions.gen_random_bytes(16), 'hex');
  end if;

  if new.passcode_digest is null or btrim(new.passcode_digest) = '' then
    new.passcode_digest := encode(
      extensions.digest(
        new.salon_id::text || ':' || new.id::text || ':1234:' || new.passcode_salt,
        'sha256'
      ),
      'hex'
    );
    new.passcode_is_default := true;
  end if;

  return new;
end;
$$;

drop trigger if exists set_staff_default_passcode
on public.staff;

create trigger set_staff_default_passcode
before insert on public.staff
for each row execute function public.set_default_staff_passcode();

alter table public.staff_workdays
add column if not exists queue_turn_count integer not null default 0,
add column if not exists check_in_sequence integer,
add column if not exists last_leave_at timestamptz,
add column if not exists leave_cohort_staff_ids uuid[] not null default '{}'::uuid[],
add column if not exists leave_baseline_turn_count integer,
add column if not exists auto_checked_out_at timestamptz;

alter table public.staff_workdays
drop constraint if exists staff_workdays_queue_turn_nonnegative;

alter table public.staff_workdays
add constraint staff_workdays_queue_turn_nonnegative
check (queue_turn_count >= 0);

alter table public.staff_workdays
drop constraint if exists staff_workdays_check_in_sequence_positive;

alter table public.staff_workdays
add constraint staff_workdays_check_in_sequence_positive
check (check_in_sequence is null or check_in_sequence > 0);

create unique index if not exists staff_workdays_daily_sequence_uidx
on public.staff_workdays(salon_id, work_date, check_in_sequence)
where check_in_sequence is not null;

create table if not exists public.staff_passcode_attempts (
  salon_id uuid not null references public.locations(id) on delete cascade,
  staff_id uuid not null references public.staff(id) on delete cascade,
  scope text not null,
  failed_count integer not null default 0,
  first_failed_at timestamptz not null default now(),
  locked_until timestamptz,
  updated_at timestamptz not null default now(),
  primary key (salon_id, staff_id, scope),
  constraint staff_passcode_attempts_failed_count_nonnegative check (failed_count >= 0)
);

drop trigger if exists set_staff_passcode_attempts_updated_at
on public.staff_passcode_attempts;

create trigger set_staff_passcode_attempts_updated_at
before update on public.staff_passcode_attempts
for each row execute function public.set_updated_at();

alter table public.staff_passcode_attempts enable row level security;

drop policy if exists "staff_passcode_attempts_no_direct_access"
on public.staff_passcode_attempts;

create policy "staff_passcode_attempts_no_direct_access"
on public.staff_passcode_attempts
for all to authenticated
using (false)
with check (false);

create table if not exists public.staff_attendance_events (
  id uuid primary key default gen_random_uuid(),
  salon_id uuid not null references public.locations(id) on delete cascade,
  staff_id uuid not null references public.staff(id) on delete cascade,
  operator_staff_id uuid references public.staff(id) on delete set null,
  portable_access_key_id uuid references public.pos_portable_access_keys(id) on delete set null,
  work_date date not null,
  event_type text not null,
  old_status text,
  new_status text,
  old_turn_count integer,
  delta integer,
  new_turn_count integer,
  reason text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint staff_attendance_events_event_type_check check (
    event_type in (
      'CHECK_IN',
      'LEAVE_OUT',
      'RETURN_TO_WORK',
      'CHECK_OUT',
      'AUTO_CHECK_OUT',
      'AUTOMATIC_TURN_CATCH_UP',
      'MANUAL_TURN_ADJUSTMENT'
    )
  )
);

create index if not exists staff_attendance_events_salon_day_idx
on public.staff_attendance_events(salon_id, work_date, created_at desc);

create index if not exists staff_attendance_events_staff_day_idx
on public.staff_attendance_events(staff_id, work_date, created_at desc);

alter table public.staff_attendance_events enable row level security;

drop policy if exists "salon_member_read_staff_attendance_events"
on public.staff_attendance_events;

create policy "salon_member_read_staff_attendance_events"
on public.staff_attendance_events
for select to authenticated
using (public.user_has_salon_permission(salon_id, array['staff.view', 'staff.manage', 'tickets.view', 'tickets.manage']));

drop policy if exists "staff_manager_insert_staff_attendance_events"
on public.staff_attendance_events;

create policy "staff_manager_insert_staff_attendance_events"
on public.staff_attendance_events
for insert to authenticated
with check (public.user_has_salon_permission(salon_id, array['staff.manage', 'tickets.manage']));

create or replace function public.staff_passcode_digest(
  p_salon_id uuid,
  p_staff_id uuid,
  p_passcode text,
  p_salt text
)
returns text
language sql
immutable
security definer
set search_path = public
as $$
  select encode(
    extensions.digest(
      p_salon_id::text || ':' || p_staff_id::text || ':' || coalesce(p_passcode, '') || ':' || p_salt,
      'sha256'
    ),
    'hex'
  )
$$;

create or replace function public.get_salon_business_timezone(p_salon_id uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (
      select booking_settings.timezone_iana
      from public.booking_settings
      where booking_settings.salon_id = p_salon_id
      limit 1
    ),
    'America/Chicago'
  )
$$;

create or replace function public.get_salon_business_date(p_salon_id uuid)
returns date
language sql
stable
security definer
set search_path = public
as $$
  select (now() at time zone public.get_salon_business_timezone(p_salon_id))::date
$$;

create or replace function public.pos_staff_operator_has_permission(
  p_salon_id uuid,
  p_staff_id uuid,
  p_permission_codes text[]
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  with operator_staff as (
    select
      staff.account_user_id,
      staff.user_id,
      locations.account_id
    from public.staff
    join public.locations on locations.id = staff.salon_id
    where staff.id = p_staff_id
      and staff.salon_id = p_salon_id
      and staff.is_active = true
    limit 1
  ),
  operator_users as (
    select account_user_id as user_id, account_id
    from operator_staff
    where account_user_id is not null
    union
    select users.id, operator_staff.account_id
    from operator_staff
    join public.users on users.auth_user_id = operator_staff.user_id
    where operator_staff.user_id is not null
  )
  select exists (
    select 1
    from operator_users
    join public.account_memberships memberships
      on memberships.account_id = operator_users.account_id
     and memberships.user_id = operator_users.user_id
    join public.roles roles on roles.id = memberships.role_id
    left join public.role_permissions role_permissions on role_permissions.role_id = roles.id
    left join public.permissions permissions on permissions.id = role_permissions.permission_id
    where memberships.status = 'active'
      and (
        roles.code = 'OWNER'
        or permissions.code = any(p_permission_codes)
      )
  )
$$;

create or replace function public.record_staff_attendance_event(
  p_salon_id uuid,
  p_staff_id uuid,
  p_operator_staff_id uuid,
  p_portable_access_key_id uuid,
  p_work_date date,
  p_event_type text,
  p_old_status text,
  p_new_status text,
  p_old_turn_count integer,
  p_delta integer,
  p_new_turn_count integer,
  p_reason text default null,
  p_metadata jsonb default '{}'::jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.staff_attendance_events (
    delta,
    event_type,
    metadata,
    new_status,
    new_turn_count,
    old_status,
    old_turn_count,
    operator_staff_id,
    portable_access_key_id,
    reason,
    salon_id,
    staff_id,
    work_date
  )
  values (
    p_delta,
    p_event_type,
    coalesce(p_metadata, '{}'::jsonb),
    p_new_status,
    p_new_turn_count,
    p_old_status,
    p_old_turn_count,
    p_operator_staff_id,
    p_portable_access_key_id,
    p_reason,
    p_salon_id,
    p_staff_id,
    p_work_date
  );
end;
$$;

create or replace function public.validate_staff_passcode_or_raise(
  p_salon_id uuid,
  p_staff_id uuid,
  p_passcode text,
  p_scope text
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  attempt_row public.staff_passcode_attempts%rowtype;
  next_failed_count integer;
  staff_row record;
begin
  if length(coalesce(p_passcode, '')) < 4 or length(coalesce(p_passcode, '')) > 32 then
    raise exception 'Staff passcode is required.';
  end if;

  select *
  into staff_row
  from public.staff
  where staff.id = p_staff_id
    and staff.salon_id = p_salon_id
    and staff.is_active = true
  limit 1;

  if staff_row.id is null then
    raise exception 'Staff profile was not found.';
  end if;

  select *
  into attempt_row
  from public.staff_passcode_attempts
  where salon_id = p_salon_id
    and staff_id = p_staff_id
    and scope = p_scope
  for update;

  if attempt_row.locked_until is not null and attempt_row.locked_until > now() then
    raise exception 'Too many incorrect passcode attempts. Try again shortly.';
  end if;

  if public.staff_passcode_digest(
    p_salon_id,
    p_staff_id,
    p_passcode,
    staff_row.passcode_salt
  ) = staff_row.passcode_digest then
    delete from public.staff_passcode_attempts
    where salon_id = p_salon_id
      and staff_id = p_staff_id
      and scope = p_scope;
    return staff_row.passcode_is_default;
  end if;

  if attempt_row.salon_id is null or attempt_row.first_failed_at < now() - interval '10 minutes' then
    next_failed_count := 1;
  else
    next_failed_count := attempt_row.failed_count + 1;
  end if;

  insert into public.staff_passcode_attempts (
    failed_count,
    first_failed_at,
    locked_until,
    salon_id,
    scope,
    staff_id
  )
  values (
    next_failed_count,
    now(),
    case when next_failed_count >= 5 then now() + interval '5 minutes' else null end,
    p_salon_id,
    p_scope,
    p_staff_id
  )
  on conflict (salon_id, staff_id, scope) do update
  set failed_count = excluded.failed_count,
      first_failed_at = case
        when public.staff_passcode_attempts.first_failed_at < now() - interval '10 minutes'
          then now()
        else public.staff_passcode_attempts.first_failed_at
      end,
      locked_until = excluded.locked_until,
      updated_at = now();

  raise exception 'Staff passcode is incorrect.';
end;
$$;

create or replace function public.ensure_staff_workday_for_queue(
  p_salon_id uuid,
  p_staff_id uuid,
  p_work_date date
)
returns public.staff_workdays
language plpgsql
security definer
set search_path = public
as $$
declare
  large_turn_count integer;
  workday_row public.staff_workdays%rowtype;
begin
  select count(*)::integer
  into large_turn_count
  from public.pos_ticket_item_turn_parts turns
  where turns.salon_id = p_salon_id
    and turns.staff_id = p_staff_id
    and turns.work_date = p_work_date
    and turns.turn_type = 'large';

  insert into public.staff_workdays (
    queue_turn_count,
    salon_id,
    staff_id,
    status,
    work_date
  )
  values (
    coalesce(large_turn_count, 0),
    p_salon_id,
    p_staff_id,
    'not_checked_in',
    p_work_date
  )
  on conflict (salon_id, staff_id, work_date) do update
  set queue_turn_count = greatest(public.staff_workdays.queue_turn_count, excluded.queue_turn_count)
  returning * into workday_row;

  return workday_row;
end;
$$;

create or replace function public.ensure_staff_workdays_for_queue(
  p_salon_id uuid,
  p_work_date date
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  staff_row record;
begin
  for staff_row in
    select staff.id
    from public.staff
    where staff.salon_id = p_salon_id
      and staff.is_active = true
      and coalesce(staff.pos_enabled, true) = true
  loop
    perform public.ensure_staff_workday_for_queue(p_salon_id, staff_row.id, p_work_date);
  end loop;
end;
$$;

create or replace function public.auto_close_stale_staff_workdays(
  p_salon_id uuid,
  p_today date
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  with stale_candidates as (
    select
      id,
      queue_turn_count as previous_turn_count,
      status as previous_status
    from public.staff_workdays
    where salon_id = p_salon_id
      and work_date < p_today
      and status in ('working', 'break', 'checked_in')
  ),
  stale as (
    update public.staff_workdays
    set status = 'auto_checked_out',
        check_out_at = coalesce(check_out_at, now()),
        auto_checked_out_at = now()
    from stale_candidates
    where staff_workdays.id = stale_candidates.id
    returning
      staff_workdays.*,
      stale_candidates.previous_status,
      stale_candidates.previous_turn_count
  )
  insert into public.staff_attendance_events (
    event_type,
    new_status,
    new_turn_count,
    old_status,
    old_turn_count,
    reason,
    salon_id,
    staff_id,
    work_date
  )
  select
    'AUTO_CHECK_OUT',
    'auto_checked_out',
    queue_turn_count,
    previous_status,
    previous_turn_count,
    'Salon business date changed.',
    salon_id,
    staff_id,
    work_date
  from stale;
end;
$$;

update public.staff_workdays
set queue_turn_count = greatest(queue_turn_count, coalesce(turns.large_turns, 0))
from (
  select
    salon_id,
    staff_id,
    work_date,
    count(*) filter (where turn_type = 'large')::integer as large_turns
  from public.pos_ticket_item_turn_parts
  group by salon_id, staff_id, work_date
) turns
where staff_workdays.salon_id = turns.salon_id
  and staff_workdays.staff_id = turns.staff_id
  and staff_workdays.work_date = turns.work_date;

create or replace function public.increment_staff_queue_turns(
  p_salon_id uuid,
  p_staff_id uuid,
  p_work_date date,
  p_delta integer
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  next_turn_count integer;
begin
  if coalesce(p_delta, 0) <= 0 then
    perform public.ensure_staff_workday_for_queue(p_salon_id, p_staff_id, p_work_date);
    select queue_turn_count
    into next_turn_count
    from public.staff_workdays
    where salon_id = p_salon_id
      and staff_id = p_staff_id
      and work_date = p_work_date;
    return coalesce(next_turn_count, 0);
  end if;

  perform pg_advisory_xact_lock(hashtext(p_salon_id::text || ':' || p_work_date::text || ':' || p_staff_id::text));
  perform public.ensure_staff_workday_for_queue(p_salon_id, p_staff_id, p_work_date);

  update public.staff_workdays
  set queue_turn_count = queue_turn_count + p_delta
  where salon_id = p_salon_id
    and staff_id = p_staff_id
    and work_date = p_work_date
  returning queue_turn_count into next_turn_count;

  return coalesce(next_turn_count, 0);
end;
$$;

create or replace function public.get_pos_portable_check_in_data(
  p_key_id uuid,
  p_session_signature text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  check_in_enabled boolean;
  staff_json jsonb;
  target_salon_id uuid;
  target_today date;
  target_timezone text;
begin
  target_salon_id := public.pos_portable_access_salon_id(p_key_id, p_session_signature);

  if target_salon_id is null
    or not public.pos_portable_access_has_capability(p_key_id, p_session_signature, 'portable.checkin.use')
  then
    return null;
  end if;

  target_timezone := public.get_salon_business_timezone(target_salon_id);
  target_today := public.get_salon_business_date(target_salon_id);

  select coalesce(pos_settings.staff_check_in_enabled, false)
  into check_in_enabled
  from public.pos_settings
  where pos_settings.salon_id = target_salon_id;

  if not coalesce(check_in_enabled, false) then
    return jsonb_build_object(
      'checkInEnabled', false,
      'salonName', (select name from public.locations where id = target_salon_id),
      'staff', '[]'::jsonb,
      'today', target_today,
      'timezone', target_timezone
    );
  end if;

  perform public.auto_close_stale_staff_workdays(target_salon_id, target_today);
  perform public.ensure_staff_workdays_for_queue(target_salon_id, target_today);

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'checkInAt', staff_workdays.check_in_at,
        'checkInSequence', staff_workdays.check_in_sequence,
        'displayName', staff.display_name,
        'id', staff.id,
        'isPasscodeDefault', staff.passcode_is_default,
        'jobTitle', staff.job_title,
        'queueTurnCount', coalesce(staff_workdays.queue_turn_count, 0),
        'status', coalesce(staff_workdays.status, 'not_checked_in')
      )
      order by
        case
          when staff_workdays.status = 'working' then 1
          when staff_workdays.status = 'break' then 2
          when staff_workdays.status = 'not_checked_in' then 3
          when staff_workdays.status = 'checked_out' then 4
          when staff_workdays.status = 'auto_checked_out' then 5
          else 6
        end,
        case when staff_workdays.status in ('working', 'break') then staff_workdays.check_in_sequence end nulls last,
        staff.display_name
    ),
    '[]'::jsonb
  )
  into staff_json
  from public.staff
  left join public.staff_workdays
    on staff_workdays.staff_id = staff.id
    and staff_workdays.salon_id = staff.salon_id
    and staff_workdays.work_date = target_today
  where staff.salon_id = target_salon_id
    and staff.is_active = true
    and staff.pos_enabled = true;

  return jsonb_build_object(
    'checkInEnabled', true,
    'salonName', (select name from public.locations where id = target_salon_id),
    'staff', staff_json,
    'today', target_today,
    'timezone', target_timezone
  );
end;
$$;

create or replace function public.submit_pos_portable_attendance_event(
  p_key_id uuid,
  p_session_signature text,
  p_staff_id uuid,
  p_passcode text,
  p_event_type text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  all_same boolean;
  catch_up_turn integer;
  check_in_enabled boolean;
  cohort uuid[];
  current_max_turn integer;
  current_min_turn integer;
  default_passcode boolean;
  late_start_turn integer;
  old_status text;
  old_turn integer;
  target_salon_id uuid;
  target_today date;
  next_sequence integer;
  workday_row public.staff_workdays%rowtype;
  working_count integer;
begin
  target_salon_id := public.pos_portable_access_salon_id(p_key_id, p_session_signature);

  if target_salon_id is null
    or not public.pos_portable_access_has_capability(p_key_id, p_session_signature, 'portable.checkin.use')
  then
    return null;
  end if;

  select coalesce(pos_settings.staff_check_in_enabled, false)
  into check_in_enabled
  from public.pos_settings
  where pos_settings.salon_id = target_salon_id;

  if not coalesce(check_in_enabled, false) then
    raise exception 'Staff check-in is disabled.';
  end if;

  if not exists (
    select 1
    from public.staff
    where staff.id = p_staff_id
      and staff.salon_id = target_salon_id
      and staff.is_active = true
      and staff.pos_enabled = true
  ) then
    raise exception 'Staff profile was not found.';
  end if;

  default_passcode := public.validate_staff_passcode_or_raise(
    target_salon_id,
    p_staff_id,
    p_passcode,
    'portable_check_in'
  );

  target_today := public.get_salon_business_date(target_salon_id);
  perform public.auto_close_stale_staff_workdays(target_salon_id, target_today);
  perform pg_advisory_xact_lock(hashtext(target_salon_id::text || ':' || target_today::text || ':attendance'));
  workday_row := public.ensure_staff_workday_for_queue(target_salon_id, p_staff_id, target_today);

  old_status := coalesce(workday_row.status, 'not_checked_in');
  old_turn := coalesce(workday_row.queue_turn_count, 0);

  if p_event_type = 'CHECK_IN' then
    if old_status in ('working', 'break', 'checked_in') then
      raise exception 'Staff is already checked in.';
    end if;

    select
      count(*)::integer,
      coalesce(min(queue_turn_count), 0)::integer,
      coalesce(max(queue_turn_count), 0)::integer
    into working_count, current_min_turn, current_max_turn
    from public.staff_workdays
    where salon_id = target_salon_id
      and work_date = target_today
      and status = 'working';

    all_same := working_count > 0 and current_min_turn = current_max_turn;
    late_start_turn := case
      when working_count = 0 then 0
      when all_same then greatest(current_min_turn - 1, 0)
      else current_min_turn
    end;

    select coalesce(max(check_in_sequence), 0) + 1
    into next_sequence
    from public.staff_workdays
    where salon_id = target_salon_id
      and work_date = target_today;

    update public.staff_workdays
    set check_in_at = coalesce(check_in_at, now()),
        check_in_sequence = next_sequence,
        check_out_at = null,
        last_leave_at = null,
        leave_baseline_turn_count = null,
        leave_cohort_staff_ids = '{}'::uuid[],
        queue_turn_count = greatest(queue_turn_count, late_start_turn),
        status = 'working'
    where id = workday_row.id
    returning * into workday_row;

    perform public.record_staff_attendance_event(
      target_salon_id,
      p_staff_id,
      p_staff_id,
      p_key_id,
      target_today,
      'CHECK_IN',
      old_status,
      workday_row.status,
      old_turn,
      workday_row.queue_turn_count - old_turn,
      workday_row.queue_turn_count,
      case when old_status in ('checked_out', 'auto_checked_out') then 'Same-day late re-check-in.' else null end,
      jsonb_build_object(
        'computedLateStartTurn', late_start_turn,
        'operatorPasscodeIsDefault', default_passcode
      )
    );
  elsif p_event_type = 'LEAVE_OUT' then
    if old_status <> 'working' then
      raise exception 'Only working staff can leave out.';
    end if;

    select coalesce(array_agg(staff_id order by check_in_sequence), '{}'::uuid[])
    into cohort
    from public.staff_workdays
    where salon_id = target_salon_id
      and work_date = target_today
      and status = 'working'
      and staff_id <> p_staff_id;

    select min(queue_turn_count)::integer
    into current_min_turn
    from public.staff_workdays
    where salon_id = target_salon_id
      and work_date = target_today
      and status = 'working'
      and staff_id <> p_staff_id;

    update public.staff_workdays
    set last_leave_at = now(),
        leave_baseline_turn_count = current_min_turn,
        leave_cohort_staff_ids = coalesce(cohort, '{}'::uuid[]),
        status = 'break'
    where id = workday_row.id
    returning * into workday_row;

    perform public.record_staff_attendance_event(
      target_salon_id,
      p_staff_id,
      p_staff_id,
      p_key_id,
      target_today,
      'LEAVE_OUT',
      old_status,
      workday_row.status,
      old_turn,
      0,
      workday_row.queue_turn_count,
      null,
      jsonb_build_object('leaveCohortStaffIds', coalesce(cohort, '{}'::uuid[]))
    );
  elsif p_event_type = 'RETURN_TO_WORK' then
    if old_status <> 'break' then
      raise exception 'Only staff on break can return to work.';
    end if;

    select min(queue_turn_count)::integer
    into current_min_turn
    from public.staff_workdays
    where salon_id = target_salon_id
      and work_date = target_today
      and status = 'working'
      and staff_id = any(coalesce(workday_row.leave_cohort_staff_ids, '{}'::uuid[]));

    catch_up_turn := greatest(
      old_turn,
      coalesce(current_min_turn, workday_row.leave_baseline_turn_count, old_turn)
    );

    if catch_up_turn > old_turn then
      perform public.record_staff_attendance_event(
        target_salon_id,
        p_staff_id,
        p_staff_id,
        p_key_id,
        target_today,
        'AUTOMATIC_TURN_CATCH_UP',
        old_status,
        old_status,
        old_turn,
        catch_up_turn - old_turn,
        catch_up_turn,
        'Returned from leave out after cohort completed full turns.',
        jsonb_build_object(
          'leaveCohortStaffIds', coalesce(workday_row.leave_cohort_staff_ids, '{}'::uuid[]),
          'cohortBaselineTurn', current_min_turn
        )
      );
    end if;

    update public.staff_workdays
    set last_leave_at = null,
        leave_baseline_turn_count = null,
        leave_cohort_staff_ids = '{}'::uuid[],
        queue_turn_count = catch_up_turn,
        status = 'working'
    where id = workday_row.id
    returning * into workday_row;

    perform public.record_staff_attendance_event(
      target_salon_id,
      p_staff_id,
      p_staff_id,
      p_key_id,
      target_today,
      'RETURN_TO_WORK',
      old_status,
      workday_row.status,
      old_turn,
      workday_row.queue_turn_count - old_turn,
      workday_row.queue_turn_count,
      null,
      jsonb_build_object('operatorPasscodeIsDefault', default_passcode)
    );
  elsif p_event_type = 'CHECK_OUT' then
    if old_status not in ('working', 'break', 'checked_in') then
      raise exception 'Only checked-in staff can check out.';
    end if;

    update public.staff_workdays
    set check_out_at = now(),
        last_leave_at = null,
        leave_baseline_turn_count = null,
        leave_cohort_staff_ids = '{}'::uuid[],
        status = 'checked_out'
    where id = workday_row.id
    returning * into workday_row;

    perform public.record_staff_attendance_event(
      target_salon_id,
      p_staff_id,
      p_staff_id,
      p_key_id,
      target_today,
      'CHECK_OUT',
      old_status,
      workday_row.status,
      old_turn,
      0,
      workday_row.queue_turn_count,
      null,
      jsonb_build_object('operatorPasscodeIsDefault', default_passcode)
    );
  else
    raise exception 'Choose a valid attendance action.';
  end if;

  return jsonb_build_object(
    'checkInSequence', workday_row.check_in_sequence,
    'isPasscodeDefault', default_passcode,
    'queueTurnCount', workday_row.queue_turn_count,
    'staffId', p_staff_id,
    'status', workday_row.status,
    'today', target_today
  );
end;
$$;

create or replace function public.adjust_pos_portable_staff_turn(
  p_key_id uuid,
  p_session_signature text,
  p_target_staff_id uuid,
  p_operator_staff_id uuid,
  p_operator_passcode text,
  p_delta integer,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  default_passcode boolean;
  new_turn integer;
  old_status text;
  old_turn integer;
  target_salon_id uuid;
  target_today date;
  workday_row public.staff_workdays%rowtype;
begin
  target_salon_id := public.pos_portable_access_salon_id(p_key_id, p_session_signature);

  if target_salon_id is null
    or not public.pos_portable_access_has_capability(p_key_id, p_session_signature, 'portable.turn.adjust')
  then
    return null;
  end if;

  if coalesce(p_delta, 0) = 0 or abs(p_delta) > 24 then
    raise exception 'Turn adjustment must be a small non-zero integer delta.';
  end if;

  if nullif(btrim(coalesce(p_reason, '')), '') is null then
    raise exception 'Reason is required.';
  end if;

  if p_target_staff_id = p_operator_staff_id then
    raise exception 'Choose a manager/operator separately from the target staff.';
  end if;

  if not exists (
    select 1 from public.staff
    where staff.id = p_target_staff_id
      and staff.salon_id = target_salon_id
      and staff.is_active = true
      and staff.pos_enabled = true
  ) then
    raise exception 'Target staff profile was not found.';
  end if;

  if not public.pos_staff_operator_has_permission(
    target_salon_id,
    p_operator_staff_id,
    array['tickets.manage', 'staff.manage', 'salon_settings.manage']
  ) then
    raise exception 'Manager authorization is required.';
  end if;

  default_passcode := public.validate_staff_passcode_or_raise(
    target_salon_id,
    p_operator_staff_id,
    p_operator_passcode,
    'portable_turn_adjust'
  );

  target_today := public.get_salon_business_date(target_salon_id);
  perform public.auto_close_stale_staff_workdays(target_salon_id, target_today);
  perform pg_advisory_xact_lock(hashtext(target_salon_id::text || ':' || target_today::text || ':' || p_target_staff_id::text));

  workday_row := public.ensure_staff_workday_for_queue(target_salon_id, p_target_staff_id, target_today);
  old_status := workday_row.status;
  old_turn := workday_row.queue_turn_count;
  new_turn := greatest(0, old_turn + p_delta);

  update public.staff_workdays
  set queue_turn_count = new_turn
  where id = workday_row.id
  returning * into workday_row;

  perform public.record_staff_attendance_event(
    target_salon_id,
    p_target_staff_id,
    p_operator_staff_id,
    p_key_id,
    target_today,
    'MANUAL_TURN_ADJUSTMENT',
    old_status,
    workday_row.status,
    old_turn,
    new_turn - old_turn,
    new_turn,
    btrim(p_reason),
    jsonb_build_object(
      'operatorPasscodeIsDefault', default_passcode
    )
  );

  return jsonb_build_object(
    'delta', new_turn - old_turn,
    'isOperatorPasscodeDefault', default_passcode,
    'newTurn', new_turn,
    'oldTurn', old_turn,
    'operatorStaffId', p_operator_staff_id,
    'targetStaffId', p_target_staff_id,
    'today', target_today
  );
end;
$$;

alter table public.pos_portable_access_keys
drop constraint if exists pos_portable_access_keys_capabilities_valid;

alter table public.pos_portable_access_keys
add constraint pos_portable_access_keys_capabilities_valid
check (
  coalesce(capabilities, '{}'::text[]) <@ array[
    'portable.pos.use',
    'portable.today.view',
    'portable.checkin.use',
    'portable.turn.adjust',
    'portable.book.view',
    'portable.book.create',
    'portable.book.cancel',
    'portable.report.view'
  ]::text[]
);

alter table public.pos_portable_access_keys
alter column capabilities set default array[
  'portable.pos.use',
  'portable.today.view',
  'portable.checkin.use',
  'portable.book.view',
  'portable.book.create',
  'portable.book.cancel',
  'portable.report.view'
]::text[];

update public.pos_portable_access_keys
set capabilities = array(
  select distinct capability
  from unnest(
    coalesce(capabilities, '{}'::text[]) || array['portable.checkin.use']::text[]
  ) as capability
  where capability is not null
  order by capability
)
where not ('portable.checkin.use' = any(coalesce(capabilities, '{}'::text[])));

create or replace function public.get_pos_portable_desk_data(
  p_key_id uuid,
  p_session_signature text,
  p_work_date date default current_date
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  check_in_enabled boolean;
  draft_row public.pos_live_drafts%rowtype;
  draft_snapshot jsonb;
  salon_name text;
  services_json jsonb;
  staff_json jsonb;
  target_salon_id uuid;
begin
  target_salon_id := public.pos_portable_access_salon_id(p_key_id, p_session_signature);

  if target_salon_id is null
    or not public.pos_portable_access_has_capability(p_key_id, p_session_signature, 'portable.pos.use')
  then
    return null;
  end if;

  select locations.name
  into salon_name
  from public.locations
  where locations.id = target_salon_id
  limit 1;

  select coalesce(pos_settings.staff_check_in_enabled, false)
  into check_in_enabled
  from public.pos_settings
  where pos_settings.salon_id = target_salon_id;

  perform public.auto_close_stale_staff_workdays(target_salon_id, p_work_date);
  perform public.ensure_staff_workdays_for_queue(target_salon_id, p_work_date);

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', services.id,
        'name', services.name,
        'category', services.category,
        'base_price', services.base_price
      )
      order by services.name
    ),
    '[]'::jsonb
  )
  into services_json
  from public.services
  where services.salon_id = target_salon_id
    and services.is_active = true;

  with receipt_turn_counts as (
    select
      turns.staff_id,
      count(*) filter (where turns.turn_type = 'large')::integer as large_turns,
      count(*) filter (where turns.turn_type = 'small')::integer as small_turns,
      count(*)::integer as total_turns
    from public.pos_ticket_item_turn_parts turns
    where turns.salon_id = target_salon_id
      and turns.work_date = p_work_date
    group by turns.staff_id
  )
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', staff.id,
        'display_name', staff.display_name,
        'job_title', staff.job_title,
        'is_active', staff.is_active,
        'today_status', coalesce(staff_workdays.status, 'not_checked_in'),
        'check_in_sequence', staff_workdays.check_in_sequence,
        'check_in_at', staff_workdays.check_in_at,
        'turns', jsonb_build_object(
          'largeTurns', coalesce(staff_workdays.queue_turn_count, receipt_turn_counts.large_turns, 0),
          'smallTurns', coalesce(receipt_turn_counts.small_turns, 0),
          'totalTurns', coalesce(staff_workdays.queue_turn_count, receipt_turn_counts.large_turns, 0),
          'queueTurns', coalesce(staff_workdays.queue_turn_count, receipt_turn_counts.large_turns, 0),
          'receiptLargeTurns', coalesce(receipt_turn_counts.large_turns, 0)
        )
      )
      order by
        coalesce(staff_workdays.queue_turn_count, receipt_turn_counts.large_turns, 0),
        case when check_in_enabled then staff_workdays.check_in_sequence end nulls last,
        staff.display_name
    ),
    '[]'::jsonb
  )
  into staff_json
  from public.staff
  left join public.staff_workdays
    on staff_workdays.staff_id = staff.id
    and staff_workdays.salon_id = staff.salon_id
    and staff_workdays.work_date = p_work_date
  left join receipt_turn_counts on receipt_turn_counts.staff_id = staff.id
  where staff.salon_id = target_salon_id
    and staff.is_active = true
    and staff.pos_enabled = true
    and (
      not coalesce(check_in_enabled, false)
      or staff_workdays.status = 'working'
    );

  select *
  into draft_row
  from public.pos_live_drafts
  where salon_id = target_salon_id
  order by updated_at desc
  limit 1;

  if draft_row.id is null then
    insert into public.pos_live_drafts (
      receipt,
      salon_id,
      staff_lines,
      subtotal,
      tip,
      token,
      total,
      total_before_tip
    )
    values (
      '{}'::jsonb,
      target_salon_id,
      '[]'::jsonb,
      0,
      0,
      replace(gen_random_uuid()::text, '-', ''),
      0,
      0
    )
    returning * into draft_row;
  end if;

  select to_jsonb(snapshot)
  into draft_snapshot
  from public.get_pos_live_draft_by_token(draft_row.token) snapshot
  limit 1;

  return jsonb_build_object(
    'salonName', salon_name,
    'settings', public.get_pos_setting_payload(target_salon_id),
    'services', services_json,
    'staff', staff_json,
    'liveDraft', draft_snapshot
  );
end;
$$;

create or replace function public.submit_pos_portable_receipt(
  p_key_id uuid,
  p_session_signature text,
  p_receipt jsonb,
  p_work_date date default current_date
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  access_label text;
  check_in_enabled boolean;
  customer_id_text text;
  customer_lookup text;
  customer_name text;
  customer_row public.customers%rowtype;
  discount_amount numeric := 0;
  discount_type text;
  discount_value numeric;
  large_part_delta integer;
  large_turn_threshold numeric := 25;
  line_item jsonb;
  line_total numeric;
  lines_json jsonb;
  next_sequence integer;
  part_amount numeric;
  part_index integer;
  part_value jsonb;
  payment_total numeric;
  service_id_text text;
  service_uuid uuid;
  staff_uuid uuid;
  subtotal numeric := 0;
  target_salon_id uuid;
  ticket_item_id uuid;
  ticket_row public.pos_tickets%rowtype;
  tip_amount numeric;
begin
  target_salon_id := public.pos_portable_access_salon_id(p_key_id, p_session_signature);

  if target_salon_id is null
    or not public.pos_portable_access_has_capability(p_key_id, p_session_signature, 'portable.pos.use')
  then
    return null;
  end if;

  select access_id
  into access_label
  from public.pos_portable_access_keys
  where id = p_key_id;

  select
    coalesce(pos_settings.large_turn_threshold, 25),
    coalesce(pos_settings.staff_check_in_enabled, false)
  into large_turn_threshold, check_in_enabled
  from public.pos_settings
  where pos_settings.salon_id = target_salon_id;

  lines_json := p_receipt -> 'lines';

  if jsonb_typeof(coalesce(lines_json, '[]'::jsonb)) <> 'array'
    or jsonb_array_length(coalesce(lines_json, '[]'::jsonb)) = 0
  then
    raise exception 'Add at least one receipt line before submit.';
  end if;

  for line_item in select value from jsonb_array_elements(lines_json)
  loop
    line_total := round(coalesce((line_item ->> 'total')::numeric, 0), 2);

    if line_total <= 0 then
      raise exception 'Every receipt line needs a positive amount.';
    end if;

    subtotal := subtotal + line_total;
  end loop;

  customer_id_text := nullif(btrim(coalesce(p_receipt ->> 'customerId', '')), '');
  customer_lookup := nullif(btrim(coalesce(p_receipt ->> 'customerLookup', '')), '');
  customer_name := nullif(btrim(coalesce(p_receipt ->> 'customerName', '')), '');

  if customer_id_text is not null then
    select *
    into customer_row
    from public.customers
    where customers.id = customer_id_text::uuid
      and customers.location_id = target_salon_id
    limit 1;

    if customer_row.id is null then
      raise exception 'Selected customer must belong to the current salon.';
    end if;
  end if;

  if customer_row.id is null and customer_lookup is not null then
    select *
    into customer_row
    from public.customers
    where customers.location_id = target_salon_id
      and customers.status = 'active'
      and (
        customers.phone = customer_lookup
        or lower(customers.email) = lower(customer_lookup)
        or lower(btrim(customers.name)) = lower(customer_lookup)
      )
    order by customers.created_at desc
    limit 1;
  end if;

  if customer_row.id is null then
    insert into public.customers (
      email,
      location_id,
      name,
      notes,
      phone,
      status
    )
    values (
      case when customer_lookup like '%@%' then customer_lookup else null end,
      target_salon_id,
      coalesce(customer_name, customer_lookup, 'Walk-in Customer'),
      'Created from Portable POS.',
      case
        when customer_lookup is not null and customer_lookup not like '%@%' then customer_lookup
        else null
      end,
      'active'
    )
    returning * into customer_row;
  end if;

  discount_type := case
    when p_receipt ->> 'discountType' = 'percentage' then 'percentage'
    else 'fixed_amount'
  end;
  discount_value := round(greatest(coalesce((p_receipt ->> 'discountValue')::numeric, 0), 0), 2);
  tip_amount := round(greatest(coalesce((p_receipt ->> 'tipAmount')::numeric, 0), 0), 2);

  discount_amount := case
    when subtotal <= 0 or discount_value <= 0 then 0
    when discount_type = 'percentage' then least(subtotal, round((subtotal * discount_value) / 100, 2))
    else least(subtotal, discount_value)
  end;
  payment_total := round(subtotal - discount_amount + tip_amount, 2);

  if payment_total <= 0 then
    raise exception 'Receipt total must be greater than 0.';
  end if;

  select coalesce(max(ticket_sequence), 0) + 1
  into next_sequence
  from public.pos_tickets
  where salon_id = target_salon_id;

  insert into public.pos_tickets (
    customer_id,
    closed_at,
    discount_type,
    discount_value,
    notes,
    opened_at,
    salon_id,
    status,
    tax_rate,
    ticket_number,
    ticket_sequence,
    tip_type,
    tip_value
  )
  values (
    customer_row.id,
    now(),
    discount_type,
    discount_value,
    nullif(btrim(coalesce(p_receipt ->> 'note', '')), ''),
    now(),
    target_salon_id,
    'closed',
    0,
    'T' || lpad(next_sequence::text, 5, '0'),
    next_sequence,
    'fixed_amount',
    tip_amount
  )
  returning * into ticket_row;

  for line_item in select value from jsonb_array_elements(lines_json)
  loop
    line_total := round(coalesce((line_item ->> 'total')::numeric, 0), 2);
    staff_uuid := (line_item ->> 'staffId')::uuid;
    service_id_text := nullif(btrim(coalesce(line_item ->> 'serviceId', '')), '');
    service_uuid := case when service_id_text is null then null else service_id_text::uuid end;

    if not exists (
      select 1
      from public.staff
      where staff.id = staff_uuid
        and staff.salon_id = target_salon_id
        and staff.is_active = true
        and staff.pos_enabled = true
    ) then
      raise exception 'Assigned staff must be active and enabled for POS.';
    end if;

    if coalesce(check_in_enabled, false) and not exists (
      select 1
      from public.staff_workdays
      where staff_workdays.salon_id = target_salon_id
        and staff_workdays.staff_id = staff_uuid
        and staff_workdays.work_date = p_work_date
        and staff_workdays.status = 'working'
    ) then
      raise exception 'Assigned staff must be checked in and working.';
    end if;

    if service_uuid is not null and not exists (
      select 1
      from public.services
      where services.id = service_uuid
        and services.salon_id = target_salon_id
        and services.is_active = true
    ) then
      raise exception 'Selected services must be active in the current salon.';
    end if;

    insert into public.pos_ticket_items (
      assigned_staff_id,
      line_total,
      notes,
      pos_ticket_id,
      quantity,
      salon_id,
      service_id,
      unit_price
    )
    values (
      staff_uuid,
      line_total,
      coalesce(nullif(btrim(line_item ->> 'serviceLabel'), ''), 'Service')
        || ' | Parts: '
        || coalesce(line_item ->> 'amountInput', ''),
      ticket_row.id,
      1,
      target_salon_id,
      service_uuid,
      line_total
    )
    returning id into ticket_item_id;

    if jsonb_typeof(coalesce(line_item -> 'amountParts', '[]'::jsonb)) <> 'array'
      or jsonb_array_length(coalesce(line_item -> 'amountParts', '[]'::jsonb)) = 0
    then
      raise exception 'Every receipt line needs amount parts.';
    end if;

    part_index := 0;
    large_part_delta := 0;
    for part_value in select value from jsonb_array_elements(line_item -> 'amountParts')
    loop
      part_index := part_index + 1;
      part_amount := round((part_value #>> '{}')::numeric, 2);

      if part_amount >= large_turn_threshold then
        large_part_delta := large_part_delta + 1;
      end if;

      insert into public.pos_ticket_item_turn_parts (
        amount,
        salon_id,
        staff_id,
        ticket_id,
        ticket_item_id,
        turn_index,
        turn_type,
        work_date
      )
      values (
        part_amount,
        target_salon_id,
        staff_uuid,
        ticket_row.id,
        ticket_item_id,
        part_index,
        case when part_amount >= large_turn_threshold then 'large' else 'small' end,
        p_work_date
      );
    end loop;

    perform public.increment_staff_queue_turns(
      target_salon_id,
      staff_uuid,
      p_work_date,
      large_part_delta
    );
  end loop;

  insert into public.pos_payments (
    amount,
    note,
    payment_method,
    salon_id,
    ticket_id
  )
  values (
    payment_total,
    'Record-only Portable POS payment.',
    'other',
    target_salon_id,
    ticket_row.id
  );

  insert into public.pos_ticket_audit_logs (
    action,
    note,
    salon_id,
    ticket_id
  )
  values (
    'ticket_checked_out',
    'Ticket checked out from Portable POS: ' || coalesce(access_label, p_key_id::text) || '.',
    target_salon_id,
    ticket_row.id
  );

  return jsonb_build_object(
    'ok', true,
    'salonId', target_salon_id,
    'ticketId', ticket_row.id,
    'ticketNumber', ticket_row.ticket_number,
    'workDate', p_work_date
  );
end;
$$;

create or replace function public.get_pos_setting_payload(target_salon_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  setting_row public.pos_settings%rowtype;
  salon_logo_path text;
  salon_name text;
begin
  if target_salon_id is null then
    return null;
  end if;

  select *
  into setting_row
  from public.pos_settings
  where salon_id = target_salon_id;

  select locations.name
  into salon_name
  from public.locations
  where locations.id = target_salon_id
  limit 1;

  select settings.public_profile_logo_path
  into salon_logo_path
  from public.salon_settings settings
  where settings.salon_id = target_salon_id
  limit 1;

  return jsonb_build_object(
    'appDownloadUrl', coalesce(setting_row.app_download_url, 'https://reylumi.com'),
    'customerBackgroundImagePath', setting_row.customer_background_image_path,
    'customerLeftAdImagePath', setting_row.customer_left_ad_image_path,
    'customerLeftAdText', coalesce(setting_row.customer_left_ad_text, 'Stay connected with our beauty community'),
    'customerPromoBody', coalesce(setting_row.customer_promo_body, 'Thank you for choosing us today!'),
    'customerPromoTitle', coalesce(setting_row.customer_promo_title, 'Welcome back,'),
    'customerRightAdImagePath', setting_row.customer_right_ad_image_path,
    'customerRightAdText', coalesce(setting_row.customer_right_ad_text, 'Earn points & rewards. Exclusive member offers. Easy booking & reminders. Track your favorite services.'),
    'customerShowBarcode', coalesce(setting_row.customer_show_barcode, true),
    'customerShowCustomerName', coalesce(setting_row.customer_show_customer_name, true),
    'customerShowReceiptStatus', coalesce(setting_row.customer_show_receipt_status, true),
    'customerShowSalonName', coalesce(setting_row.customer_show_salon_name, true),
    'customerShowServiceName', coalesce(setting_row.customer_show_service_name, true),
    'customerShowStaffName', coalesce(setting_row.customer_show_staff_name, true),
    'largeTurnThreshold', coalesce(setting_row.large_turn_threshold, 25),
    'salonLogoPath', salon_logo_path,
    'salonName', coalesce(nullif(salon_name, ''), 'Your salon'),
    'staffCheckInEnabled', coalesce(setting_row.staff_check_in_enabled, false),
    'tipSuggestions', coalesce(setting_row.tip_suggestions, array[5, 10, 15, 20]::numeric(12,2)[])
  );
end;
$$;

grant select, insert, update, delete on table public.staff_passcode_attempts to authenticated;
grant select, insert on table public.staff_attendance_events to authenticated;
grant execute on function public.staff_passcode_digest(uuid, uuid, text, text) to anon, authenticated;
grant execute on function public.get_salon_business_timezone(uuid) to anon, authenticated;
grant execute on function public.get_salon_business_date(uuid) to anon, authenticated;
grant execute on function public.pos_staff_operator_has_permission(uuid, uuid, text[]) to anon, authenticated;
grant execute on function public.record_staff_attendance_event(uuid, uuid, uuid, uuid, date, text, text, text, integer, integer, integer, text, jsonb) to anon, authenticated;
grant execute on function public.validate_staff_passcode_or_raise(uuid, uuid, text, text) to anon, authenticated;
grant execute on function public.ensure_staff_workday_for_queue(uuid, uuid, date) to anon, authenticated;
grant execute on function public.ensure_staff_workdays_for_queue(uuid, date) to anon, authenticated;
grant execute on function public.auto_close_stale_staff_workdays(uuid, date) to anon, authenticated;
grant execute on function public.increment_staff_queue_turns(uuid, uuid, date, integer) to anon, authenticated;
grant execute on function public.get_pos_portable_check_in_data(uuid, text) to anon, authenticated;
grant execute on function public.submit_pos_portable_attendance_event(uuid, text, uuid, text, text) to anon, authenticated;
grant execute on function public.adjust_pos_portable_staff_turn(uuid, text, uuid, uuid, text, integer, text) to anon, authenticated;
grant execute on function public.get_pos_portable_desk_data(uuid, text, date) to anon, authenticated;
grant execute on function public.submit_pos_portable_receipt(uuid, text, jsonb, date) to anon, authenticated;
