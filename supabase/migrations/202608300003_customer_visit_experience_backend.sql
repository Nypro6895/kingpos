create table if not exists public.customer_visit_experiences (
  id uuid primary key default gen_random_uuid(),
  salon_id uuid not null references public.locations(id) on delete cascade,
  ticket_id uuid not null references public.pos_tickets(id) on delete cascade,
  customer_id uuid references public.customers(id) on delete set null,
  author_user_id uuid not null references public.users(id) on delete cascade,
  feedback_state text not null,
  body text,
  issue_status text not null default 'open',
  counts_toward_reputation boolean not null default false,
  source text not null default 'verified_visit',
  edited_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint customer_visit_experiences_feedback_state_check check (
    feedback_state in ('good', 'issue')
  ),
  constraint customer_visit_experiences_issue_status_check check (
    issue_status in ('open', 'acknowledged', 'resolved')
  ),
  constraint customer_visit_experiences_source_check check (
    source in ('verified_visit')
  )
);

create unique index if not exists customer_visit_experiences_ticket_author_uidx
on public.customer_visit_experiences(ticket_id, author_user_id);

create index if not exists customer_visit_experiences_salon_created_idx
on public.customer_visit_experiences(salon_id, created_at desc, id desc);

create index if not exists customer_visit_experiences_author_created_idx
on public.customer_visit_experiences(author_user_id, created_at desc, id desc);

drop trigger if exists set_customer_visit_experiences_updated_at
on public.customer_visit_experiences;

create trigger set_customer_visit_experiences_updated_at
before update on public.customer_visit_experiences
for each row execute function public.set_updated_at();

alter table public.customer_visit_experiences enable row level security;

drop policy if exists "customers_manage_own_visit_experiences"
on public.customer_visit_experiences;

create policy "customers_manage_own_visit_experiences"
on public.customer_visit_experiences
for all to authenticated
using (author_user_id = public.current_public_user_id())
with check (author_user_id = public.current_public_user_id());

drop policy if exists "salon_members_read_visit_experiences"
on public.customer_visit_experiences;

create policy "salon_members_read_visit_experiences"
on public.customer_visit_experiences
for select to authenticated
using (
  public.user_has_salon_permission(
    salon_id,
    array['salon_profile.view', 'salon_profile.manage', 'tickets.view', 'tickets.manage']::text[]
  )
);

create or replace function public.customer_visit_reputation_window_days()
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select 10
$$;

create or replace function public.customer_visit_verified_visit_payload(
  p_ticket public.pos_tickets,
  p_customer public.customers
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  existing_experience public.customer_visit_experiences%rowtype;
  occurrence_at timestamptz := coalesce(p_ticket.closed_at, p_ticket.opened_at);
  reputation_window_days integer := public.customer_visit_reputation_window_days();
  would_count boolean := false;
begin
  if p_ticket.id is null
    or p_ticket.status <> 'closed'
    or p_customer.customer_user_id is null
  then
    return null;
  end if;

  select *
  into existing_experience
  from public.customer_visit_experiences experiences
  where experiences.ticket_id = p_ticket.id
    and experiences.author_user_id = p_customer.customer_user_id
  limit 1;

  select not exists (
    select 1
    from public.customer_visit_experiences prior_experiences
    join public.pos_tickets prior_tickets
      on prior_tickets.id = prior_experiences.ticket_id
    where prior_experiences.salon_id = p_ticket.salon_id
      and prior_experiences.author_user_id = p_customer.customer_user_id
      and prior_experiences.counts_toward_reputation = true
      and prior_experiences.ticket_id <> p_ticket.id
      and coalesce(prior_tickets.closed_at, prior_tickets.opened_at)
        >= occurrence_at - make_interval(days => reputation_window_days)
      and coalesce(prior_tickets.closed_at, prior_tickets.opened_at)
        <= occurrence_at + make_interval(days => reputation_window_days)
  )
  into would_count;

  return jsonb_build_object(
    'status', 'verified',
    'windowDays', reputation_window_days,
    'countsTowardReputation', coalesce(existing_experience.counts_toward_reputation, would_count),
    'experienceState', existing_experience.feedback_state,
    'experienceBody', existing_experience.body,
    'experienceCreatedAt', existing_experience.created_at
  );
end;
$$;

create or replace function public.record_customer_visit_experience(
  p_ticket_id uuid,
  p_feedback_state text,
  p_body text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  actor_user_id uuid := public.current_public_user_id();
  clean_body text := nullif(btrim(coalesce(p_body, '')), '');
  clean_feedback_state text := case when p_feedback_state = 'issue' then 'issue' else 'good' end;
  counts_toward boolean := false;
  experience_row public.customer_visit_experiences%rowtype;
  occurrence_at timestamptz;
  reputation_window_days integer := public.customer_visit_reputation_window_days();
  ticket_row record;
begin
  if actor_user_id is null then
    return jsonb_build_object('ok', false, 'code', 'sign_in_required', 'message', 'Sign in to share this experience.');
  end if;

  if p_ticket_id is null then
    return jsonb_build_object('ok', false, 'code', 'not_found', 'message', 'Verified visit was not found.');
  end if;

  if clean_body is not null and length(clean_body) > 1000 then
    return jsonb_build_object('ok', false, 'code', 'too_long', 'message', 'Keep experience details under 1000 characters.');
  end if;

  select
    tickets.id,
    tickets.salon_id,
    tickets.customer_id,
    coalesce(tickets.closed_at, tickets.opened_at) as occurred_at,
    customers.customer_user_id
  into ticket_row
  from public.pos_tickets tickets
  join public.customers customers on customers.id = tickets.customer_id
  where tickets.id = p_ticket_id
    and tickets.status = 'closed'
    and customers.customer_user_id = actor_user_id
    and customers.location_id = tickets.salon_id
  limit 1;

  if ticket_row.id is null then
    return jsonb_build_object('ok', false, 'code', 'not_found', 'message', 'Verified visit was not found.');
  end if;

  occurrence_at := ticket_row.occurred_at;

  select not exists (
    select 1
    from public.customer_visit_experiences prior_experiences
    join public.pos_tickets prior_tickets
      on prior_tickets.id = prior_experiences.ticket_id
    where prior_experiences.salon_id = ticket_row.salon_id
      and prior_experiences.author_user_id = actor_user_id
      and prior_experiences.counts_toward_reputation = true
      and prior_experiences.ticket_id <> p_ticket_id
      and coalesce(prior_tickets.closed_at, prior_tickets.opened_at)
        >= occurrence_at - make_interval(days => reputation_window_days)
      and coalesce(prior_tickets.closed_at, prior_tickets.opened_at)
        <= occurrence_at + make_interval(days => reputation_window_days)
  )
  into counts_toward;

  insert into public.customer_visit_experiences (
    salon_id,
    ticket_id,
    customer_id,
    author_user_id,
    feedback_state,
    body,
    issue_status,
    counts_toward_reputation
  )
  values (
    ticket_row.salon_id,
    ticket_row.id,
    ticket_row.customer_id,
    actor_user_id,
    clean_feedback_state,
    clean_body,
    case when clean_feedback_state = 'good' then 'resolved' else 'open' end,
    counts_toward
  )
  on conflict (ticket_id, author_user_id) do update
  set
    feedback_state = excluded.feedback_state,
    body = excluded.body,
    issue_status = case
      when excluded.feedback_state = 'good' then 'resolved'
      when public.customer_visit_experiences.feedback_state is distinct from excluded.feedback_state then 'open'
      else public.customer_visit_experiences.issue_status
    end,
    counts_toward_reputation =
      public.customer_visit_experiences.counts_toward_reputation
      or excluded.counts_toward_reputation,
    edited_at = case
      when public.customer_visit_experiences.feedback_state is distinct from excluded.feedback_state
        or public.customer_visit_experiences.body is distinct from excluded.body
      then now()
      else public.customer_visit_experiences.edited_at
    end,
    updated_at = now()
  returning *
  into experience_row;

  return jsonb_build_object(
    'ok', true,
    'salonId', experience_row.salon_id,
    'ticketId', experience_row.ticket_id,
    'feedbackState', experience_row.feedback_state,
    'countsTowardReputation', experience_row.counts_toward_reputation,
    'windowDays', reputation_window_days
  );
end;
$$;

create or replace function public.get_public_salon_profile_reputation_summary(target_salon_id uuid)
returns table (
  average_rating numeric,
  experience_count bigint,
  issue_count bigint,
  legacy_review_count bigint,
  no_issue_count bigint,
  no_issue_rate numeric,
  rating_1_count bigint,
  rating_2_count bigint,
  rating_3_count bigint,
  rating_4_count bigint,
  rating_5_count bigint,
  review_count bigint,
  unique_customer_count bigint,
  verified_count bigint,
  verified_visit_count bigint
)
language sql
stable
security definer
set search_path = public
as $$
  with legacy_reviews as (
    select reviews.*
    from public.salon_profile_reviews reviews
    where reviews.salon_id = target_salon_id
      and reviews.moderation_status = 'visible'
      and public.salon_profile_public_salon_exists(target_salon_id)
  ),
  visit_experiences as (
    select experiences.*
    from public.customer_visit_experiences experiences
    where experiences.salon_id = target_salon_id
      and public.salon_profile_public_salon_exists(target_salon_id)
  ),
  verified_visits as (
    select tickets.id, tickets.customer_id
    from public.pos_tickets tickets
    where tickets.salon_id = target_salon_id
      and tickets.status = 'closed'
      and tickets.customer_id is not null
      and public.salon_profile_public_salon_exists(target_salon_id)
  )
  select
    (select avg(legacy_reviews.rating)::numeric from legacy_reviews) as average_rating,
    (
      (select count(*)::bigint from visit_experiences)
      + (select count(*)::bigint from legacy_reviews)
    ) as experience_count,
    (select count(*)::bigint from visit_experiences where feedback_state = 'issue') as issue_count,
    (select count(*)::bigint from legacy_reviews) as legacy_review_count,
    (
      (select count(*)::bigint from visit_experiences where feedback_state = 'good')
      + (select count(*)::bigint from legacy_reviews)
    ) as no_issue_count,
    case
      when (
        (select count(*) from visit_experiences)
        + (select count(*) from legacy_reviews)
      ) = 0 then null::numeric
      else (
        (
          (select count(*)::numeric from visit_experiences where feedback_state = 'good')
          + (select count(*)::numeric from legacy_reviews)
        )
        /
        (
          (select count(*)::numeric from visit_experiences)
          + (select count(*)::numeric from legacy_reviews)
        )
      )
    end as no_issue_rate,
    (select count(*)::bigint from legacy_reviews where rating = 1) as rating_1_count,
    (select count(*)::bigint from legacy_reviews where rating = 2) as rating_2_count,
    (select count(*)::bigint from legacy_reviews where rating = 3) as rating_3_count,
    (select count(*)::bigint from legacy_reviews where rating = 4) as rating_4_count,
    (select count(*)::bigint from legacy_reviews where rating = 5) as rating_5_count,
    (select count(*)::bigint from legacy_reviews) as review_count,
    (
      select count(distinct coalesce(visit_experiences.customer_id::text, visit_experiences.author_user_id::text))::bigint
      from visit_experiences
    ) as unique_customer_count,
    (select count(*)::bigint from legacy_reviews where verification_status = 'verified') as verified_count,
    (select count(*)::bigint from verified_visits) as verified_visit_count
  where public.salon_profile_public_salon_exists(target_salon_id)
$$;

create or replace function public.get_public_salon_profile_experiences(target_salon_id uuid)
returns table (
  id uuid,
  salon_id uuid,
  author_user_id uuid,
  author_display_name text,
  rating numeric,
  title text,
  body text,
  feedback_state text,
  issue_status text,
  verification_status text,
  verified_booking_id uuid,
  ticket_id uuid,
  reply_id uuid,
  reply_body text,
  reply_created_at timestamptz,
  edited_at timestamptz,
  created_at timestamptz,
  updated_at timestamptz,
  source text
)
language sql
stable
security definer
set search_path = public
as $$
  select *
  from (
    select
      experiences.id,
      experiences.salon_id,
      experiences.author_user_id,
      coalesce(
        nullif(btrim(users.display_name), ''),
        nullif(btrim(concat_ws(' ', users.first_name, users.last_name)), ''),
        'Reylumi customer'
      ) as author_display_name,
      null::numeric as rating,
      null::text as title,
      experiences.body,
      experiences.feedback_state,
      case when experiences.feedback_state = 'issue' then experiences.issue_status else null end as issue_status,
      'verified'::text as verification_status,
      null::uuid as verified_booking_id,
      experiences.ticket_id,
      null::uuid as reply_id,
      null::text as reply_body,
      null::timestamptz as reply_created_at,
      experiences.edited_at,
      experiences.created_at,
      experiences.updated_at,
      'experience'::text as source
    from public.customer_visit_experiences experiences
    left join public.users users on users.id = experiences.author_user_id
    where experiences.salon_id = target_salon_id
      and public.salon_profile_public_salon_exists(target_salon_id)

    union all

    select
      reviews.id,
      reviews.salon_id,
      reviews.author_user_id,
      coalesce(
        nullif(btrim(users.display_name), ''),
        nullif(btrim(concat_ws(' ', users.first_name, users.last_name)), ''),
        'Reylumi customer'
      ) as author_display_name,
      reviews.rating::numeric as rating,
      reviews.title,
      reviews.body,
      null::text as feedback_state,
      null::text as issue_status,
      reviews.verification_status,
      reviews.verified_booking_id,
      null::uuid as ticket_id,
      replies.id as reply_id,
      replies.body as reply_body,
      replies.created_at as reply_created_at,
      reviews.edited_at,
      reviews.created_at,
      reviews.updated_at,
      'legacy_review'::text as source
    from public.salon_profile_reviews reviews
    left join public.users users on users.id = reviews.author_user_id
    left join lateral (
      select review_replies.id, review_replies.body, review_replies.created_at
      from public.salon_profile_review_replies review_replies
      where review_replies.review_id = reviews.id
        and review_replies.moderation_status = 'visible'
      order by review_replies.created_at asc, review_replies.id asc
      limit 1
    ) replies on true
    where reviews.salon_id = target_salon_id
      and reviews.moderation_status = 'visible'
      and public.salon_profile_public_salon_exists(target_salon_id)
  ) public_experiences
  order by public_experiences.created_at desc, public_experiences.id desc
  limit 40
$$;

create or replace function public.get_customer_activity(p_limit integer default 40)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  actor_user_id uuid := public.current_public_user_id();
  clean_limit integer := greatest(1, least(coalesce(p_limit, 40), 100));
  booking_payload jsonb;
  purchase_payload jsonb;
begin
  if actor_user_id is null then
    return jsonb_build_object('ok', false, 'code', 'sign_in_required');
  end if;

  select coalesce(jsonb_agg(entry order by sort_at desc), '[]'::jsonb)
  into purchase_payload
  from (
    select
      coalesce(tickets.closed_at, tickets.opened_at) as sort_at,
      jsonb_build_object(
        'id', tickets.id,
        'ticketId', tickets.id,
        'ticketNumber', tickets.ticket_number,
        'openedAt', tickets.opened_at,
        'closedAt', tickets.closed_at,
        'status', tickets.status,
        'discountType', tickets.discount_type,
        'discountValue', tickets.discount_value,
        'taxRate', tickets.tax_rate,
        'tipType', tickets.tip_type,
        'tipValue', tickets.tip_value,
        'currency', 'USD',
        'salon', jsonb_build_object(
          'id', salons.id,
          'name', coalesce(nullif(btrim(settings.business_name), ''), salons.name),
          'logoPath', settings.public_profile_logo_path,
          'coverPath', settings.public_profile_cover_path
        ),
        'services', coalesce((
          select jsonb_agg(
            jsonb_build_object(
              'id', items.id,
              'serviceId', items.service_id,
              'name', coalesce(
                nullif(btrim(items.service_name_snapshot), ''),
                nullif(btrim(services.name), ''),
                nullif(btrim(split_part(coalesce(items.notes, ''), ' | ', 1)), ''),
                'Service'
              ),
              'staffName', nullif(
                btrim(coalesce(performed_staff.display_name, assigned_staff.display_name, '')),
                ''
              ),
              'quantity', items.quantity,
              'unitPrice', items.unit_price,
              'lineTotal', items.line_total
            )
            order by items.created_at, items.id
          )
          from public.pos_ticket_items items
          left join public.services services on services.id = items.service_id
          left join public.staff assigned_staff on assigned_staff.id = items.assigned_staff_id
          left join public.staff performed_staff on performed_staff.id = items.performed_by_staff_id
          where items.pos_ticket_id = tickets.id
            and items.salon_id = tickets.salon_id
            and coalesce(items.is_removed, false) = false
        ), '[]'::jsonb),
        'payments', coalesce((
          select jsonb_agg(
            jsonb_build_object(
              'id', payments.id,
              'method', payments.payment_method,
              'amount', payments.amount,
              'createdAt', payments.created_at
            )
            order by payments.created_at, payments.id
          )
          from public.pos_payments payments
          where payments.ticket_id = tickets.id
            and payments.salon_id = tickets.salon_id
        ), '[]'::jsonb),
        'verifiedVisit', public.customer_visit_verified_visit_payload(tickets, customers)
      ) as entry
    from public.pos_tickets tickets
    join public.customers customers on customers.id = tickets.customer_id
    join public.locations salons on salons.id = tickets.salon_id
    left join public.salon_settings settings on settings.salon_id = tickets.salon_id
    where customers.customer_user_id = actor_user_id
      and customers.location_id = tickets.salon_id
      and tickets.status = 'closed'
    order by coalesce(tickets.closed_at, tickets.opened_at) desc, tickets.id desc
    limit clean_limit
  ) purchase_rows;

  select coalesce(jsonb_agg(entry order by sort_bucket asc, sort_at asc, id asc), '[]'::jsonb)
  into booking_payload
  from (
    select
      bookings.id,
      case
        when bookings.start_at >= now()
          and bookings.status not in ('completed', 'cancelled', 'no_show')
        then 0
        else 1
      end as sort_bucket,
      case
        when bookings.start_at >= now()
          and bookings.status not in ('completed', 'cancelled', 'no_show')
        then bookings.start_at
        else ('9999-12-31'::timestamptz - (bookings.start_at - '1970-01-01'::timestamptz))
      end as sort_at,
      jsonb_build_object(
        'id', bookings.id,
        'bookingId', bookings.id,
        'startAt', bookings.start_at,
        'endAt', bookings.end_at,
        'status', bookings.status,
        'confirmationStatus', bookings.confirmation_status,
        'paymentStatus', bookings.payment_status,
        'timezone', bookings.salon_timezone_snapshot,
        'currency', 'USD',
        'salon', jsonb_build_object(
          'id', salons.id,
          'name', coalesce(nullif(btrim(settings.business_name), ''), salons.name),
          'logoPath', settings.public_profile_logo_path,
          'coverPath', settings.public_profile_cover_path
        ),
        'staffName', nullif(btrim(coalesce(booking_staff.display_name, '')), ''),
        'services', coalesce((
          select jsonb_agg(
            jsonb_build_object(
              'id', lines.id,
              'serviceId', lines.service_id,
              'name', coalesce(nullif(btrim(lines.service_name_snapshot), ''), 'Service'),
              'staffName', nullif(btrim(coalesce(line_staff.display_name, '')), ''),
              'lineType', lines.line_type,
              'lineStatus', lines.line_status,
              'scheduledStartAt', lines.scheduled_start_at,
              'scheduledEndAt', lines.scheduled_end_at,
              'lineTotal', lines.line_total
            )
            order by lines.display_order, lines.created_at, lines.id
          )
          from public.booking_lines lines
          left join public.staff line_staff on line_staff.id = lines.assigned_staff_id
          where lines.booking_id = bookings.id
            and lines.salon_id = bookings.salon_id
        ), '[]'::jsonb)
      ) as entry
    from (
      select *
      from (
        select *
        from public.bookings
        where customer_user_id = actor_user_id
          and start_at >= now()
          and status not in ('completed', 'cancelled', 'no_show')
        order by start_at asc, id asc
        limit 10
      ) upcoming_bookings
      union all
      select *
      from (
        select *
        from public.bookings
        where customer_user_id = actor_user_id
          and (
            start_at < now()
            or status in ('completed', 'cancelled', 'no_show')
          )
        order by start_at desc, id desc
        limit clean_limit
      ) history_bookings
    ) bookings
    join public.locations salons on salons.id = bookings.salon_id
    left join public.salon_settings settings on settings.salon_id = bookings.salon_id
    left join public.staff booking_staff on booking_staff.id = bookings.staff_id
  ) booking_rows;

  return jsonb_build_object(
    'ok', true,
    'serverNow', now(),
    'purchases', purchase_payload,
    'bookings', booking_payload
  );
end;
$$;

create or replace function public.get_customer_activity_receipt(p_ticket_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  actor_user_id uuid := public.current_public_user_id();
  receipt_payload jsonb;
begin
  if actor_user_id is null then
    return jsonb_build_object('ok', false, 'code', 'sign_in_required');
  end if;

  if p_ticket_id is null then
    return jsonb_build_object('ok', false, 'code', 'not_found');
  end if;

  select jsonb_build_object(
    'id', tickets.id,
    'ticketId', tickets.id,
    'ticketNumber', tickets.ticket_number,
    'openedAt', tickets.opened_at,
    'closedAt', tickets.closed_at,
    'status', tickets.status,
    'discountType', tickets.discount_type,
    'discountValue', tickets.discount_value,
    'taxRate', tickets.tax_rate,
    'tipType', tickets.tip_type,
    'tipValue', tickets.tip_value,
    'currency', 'USD',
    'customer', jsonb_build_object(
      'name', customers.name
    ),
    'salon', jsonb_build_object(
      'id', salons.id,
      'name', coalesce(nullif(btrim(settings.business_name), ''), salons.name),
      'phone', coalesce(settings.phone, salons.phone),
      'addressLine1', coalesce(settings.address_line1, salons.address_line1),
      'addressLine2', coalesce(settings.address_line2, salons.address_line2),
      'city', coalesce(settings.city, salons.city),
      'state', coalesce(settings.state, salons.state),
      'postalCode', coalesce(settings.postal_code, salons.postal_code),
      'country', coalesce(settings.country, salons.country),
      'logoPath', settings.public_profile_logo_path,
      'coverPath', settings.public_profile_cover_path
    ),
    'services', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', items.id,
          'serviceId', items.service_id,
          'name', coalesce(
            nullif(btrim(items.service_name_snapshot), ''),
            nullif(btrim(services.name), ''),
            nullif(btrim(split_part(coalesce(items.notes, ''), ' | ', 1)), ''),
            'Service'
          ),
          'staffName', nullif(
            btrim(coalesce(performed_staff.display_name, assigned_staff.display_name, '')),
            ''
          ),
          'quantity', items.quantity,
          'unitPrice', items.unit_price,
          'lineTotal', items.line_total
        )
        order by items.created_at, items.id
      )
      from public.pos_ticket_items items
      left join public.services services on services.id = items.service_id
      left join public.staff assigned_staff on assigned_staff.id = items.assigned_staff_id
      left join public.staff performed_staff on performed_staff.id = items.performed_by_staff_id
      where items.pos_ticket_id = tickets.id
        and items.salon_id = tickets.salon_id
        and coalesce(items.is_removed, false) = false
    ), '[]'::jsonb),
    'payments', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', payments.id,
          'method', payments.payment_method,
          'amount', payments.amount,
          'createdAt', payments.created_at
        )
        order by payments.created_at, payments.id
      )
      from public.pos_payments payments
      where payments.ticket_id = tickets.id
        and payments.salon_id = tickets.salon_id
    ), '[]'::jsonb),
    'verifiedVisit', public.customer_visit_verified_visit_payload(tickets, customers)
  )
  into receipt_payload
  from public.pos_tickets tickets
  join public.customers customers on customers.id = tickets.customer_id
  join public.locations salons on salons.id = tickets.salon_id
  left join public.salon_settings settings on settings.salon_id = tickets.salon_id
  where tickets.id = p_ticket_id
    and tickets.status = 'closed'
    and customers.customer_user_id = actor_user_id
    and customers.location_id = tickets.salon_id
  limit 1;

  if receipt_payload is null then
    return jsonb_build_object('ok', false, 'code', 'not_found');
  end if;

  return jsonb_build_object(
    'ok', true,
    'ticket', receipt_payload
  );
end;
$$;

revoke all on table public.customer_visit_experiences from anon;
grant select, insert, update on table public.customer_visit_experiences to authenticated;

revoke all on function public.customer_visit_reputation_window_days() from public;
revoke all on function public.customer_visit_verified_visit_payload(public.pos_tickets, public.customers) from public;
revoke all on function public.record_customer_visit_experience(uuid, text, text) from public;
revoke all on function public.get_public_salon_profile_reputation_summary(uuid) from public;
revoke all on function public.get_public_salon_profile_experiences(uuid) from public;
revoke all on function public.get_customer_activity(integer) from public;
revoke all on function public.get_customer_activity_receipt(uuid) from public;

grant execute on function public.record_customer_visit_experience(uuid, text, text) to authenticated;
grant execute on function public.get_public_salon_profile_reputation_summary(uuid) to anon, authenticated;
grant execute on function public.get_public_salon_profile_experiences(uuid) to anon, authenticated;
grant execute on function public.get_customer_activity(integer) to authenticated;
grant execute on function public.get_customer_activity_receipt(uuid) to authenticated;
