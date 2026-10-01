-- Enables POS Portable closed-ticket edit mode.
create or replace function public.get_pos_portable_ticket_data(
  p_key_id uuid,
  p_session_signature text,
  p_date date default current_date
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  closing_locked_at timestamptz := null;
  closing_status text := 'draft';
  current_business_date date;
  is_locked boolean := false;
  large_turn_threshold numeric;
  target_salon_id uuid;
  target_salon_name text;
  target_timezone text;
  range_start timestamptz;
  range_end timestamptz;
  tickets_json jsonb;
begin
  target_salon_id := public.pos_portable_access_salon_id(p_key_id, p_session_signature);

  if target_salon_id is null
    or not public.pos_portable_access_has_capability(
      p_key_id,
      p_session_signature,
      'portable.today.view'
    )
  then
    return null;
  end if;

  select locations.name
  into target_salon_name
  from public.locations
  where locations.id = target_salon_id
  limit 1;

  target_timezone := public.get_salon_business_timezone(target_salon_id);

  select coalesce(pos_settings.large_turn_threshold, 25)
  into large_turn_threshold
  from public.pos_settings
  where pos_settings.salon_id = target_salon_id
  limit 1;

  target_timezone := coalesce(target_timezone, 'America/Chicago');
  large_turn_threshold := coalesce(large_turn_threshold, 25);
  current_business_date := (now() at time zone target_timezone)::date;
  range_start := p_date::timestamp at time zone target_timezone;
  range_end := (p_date + 1)::timestamp at time zone target_timezone;

  select
    pos_daily_closings.status,
    pos_daily_closings.locked_at
  into closing_status, closing_locked_at
  from public.pos_daily_closings
  where pos_daily_closings.salon_id = target_salon_id
    and pos_daily_closings.report_date = p_date
  limit 1;

  closing_status := coalesce(closing_status, 'draft');
  is_locked :=
    p_date < current_business_date
    or closing_locked_at is not null
    or closing_status in ('auto_locked', 'locked', 'approved', 'payroll_locked');

  with ticket_scope as (
    select
      pos_tickets.*,
      customers.name as customer_name,
      customers.phone as customer_phone,
      customers.email as customer_email
    from public.pos_tickets
    left join public.customers on customers.id = pos_tickets.customer_id
    where pos_tickets.salon_id = target_salon_id
      and pos_tickets.opened_at >= range_start
      and pos_tickets.opened_at < range_end
    order by pos_tickets.opened_at desc
    limit 200
  ),
  item_scope as (
    select
      pos_ticket_items.id,
      pos_ticket_items.pos_ticket_id,
      pos_ticket_items.service_id,
      pos_ticket_items.assigned_staff_id,
      pos_ticket_items.line_total,
      pos_ticket_items.service_name_snapshot,
      pos_ticket_items.created_at,
      services.name as service_name,
      staff.display_name as staff_name,
      ticket_scope.opened_at as ticket_opened_at,
      ticket_scope.created_at as ticket_created_at,
      ticket_scope.ticket_sequence
    from public.pos_ticket_items
    join ticket_scope on ticket_scope.id = pos_ticket_items.pos_ticket_id
    left join public.services on services.id = pos_ticket_items.service_id
    left join public.staff on staff.id = pos_ticket_items.assigned_staff_id
    where pos_ticket_items.salon_id = target_salon_id
      and coalesce(pos_ticket_items.is_removed, false) = false
  ),
  payment_totals as (
    select
      pos_payments.ticket_id,
      coalesce(sum(pos_payments.amount), 0)::numeric as paid
    from public.pos_payments
    join ticket_scope on ticket_scope.id = pos_payments.ticket_id
    where pos_payments.salon_id = target_salon_id
    group by pos_payments.ticket_id
  ),
  item_part_rows as (
    select
      parts.id,
      item_scope.pos_ticket_id as ticket_id,
      item_scope.id as ticket_item_id,
      coalesce(parts.staff_id, item_scope.assigned_staff_id) as staff_id,
      parts.amount::numeric as amount,
      parts.turn_index::integer as turn_index,
      parts.turn_type::text as turn_type,
      parts.work_date,
      parts.created_at
    from item_scope
    join public.pos_ticket_item_turn_parts parts
      on parts.ticket_item_id = item_scope.id
     and parts.salon_id = target_salon_id

    union all

    select
      null::uuid as id,
      item_scope.pos_ticket_id as ticket_id,
      item_scope.id as ticket_item_id,
      item_scope.assigned_staff_id as staff_id,
      coalesce(item_scope.line_total, 0)::numeric as amount,
      1::integer as turn_index,
      case
        when coalesce(item_scope.line_total, 0) >= large_turn_threshold
          then 'large'
        else 'small'
      end as turn_type,
      p_date as work_date,
      item_scope.created_at
    from item_scope
    where not exists (
      select 1
      from public.pos_ticket_item_turn_parts parts
      where parts.ticket_item_id = item_scope.id
        and parts.salon_id = target_salon_id
    )
  ),
  item_part_summary as (
    select
      item_part_rows.ticket_item_id,
      max(item_part_rows.staff_id::text)::uuid as staff_id,
      min(item_part_rows.work_date) as work_date,
      coalesce(sum(item_part_rows.amount), 0)::numeric as part_total,
      coalesce(
        sum(
          case
            when item_part_rows.turn_type = 'large'
              or item_part_rows.amount >= large_turn_threshold
              then 1
            else 0
          end
        ),
        0
      )::integer as large_count,
      coalesce(
        sum(
          case
            when item_part_rows.turn_type = 'large'
              or item_part_rows.amount >= large_turn_threshold
              then 0
            else 1
          end
        ),
        0
      )::integer as small_count,
      coalesce(
        jsonb_agg(
          jsonb_build_object(
            'amount', item_part_rows.amount,
            'createdAt', item_part_rows.created_at,
            'id',
              coalesce(
                item_part_rows.id::text,
                item_part_rows.ticket_item_id::text || ':part:' || item_part_rows.turn_index::text
              ),
            'staffId', item_part_rows.staff_id,
            'ticketId', item_part_rows.ticket_id,
            'ticketItemId', item_part_rows.ticket_item_id,
            'turnIndex', item_part_rows.turn_index,
            'turnType',
              case
                when item_part_rows.turn_type = 'large'
                  or item_part_rows.amount >= large_turn_threshold
                  then 'large'
                else 'small'
              end,
            'workDate', item_part_rows.work_date
          )
          order by
            item_part_rows.turn_index,
            item_part_rows.created_at,
            item_part_rows.ticket_item_id
        ),
        '[]'::jsonb
      ) as turn_parts
    from item_part_rows
    group by item_part_rows.ticket_item_id
  ),
  item_totals as (
    select
      item_scope.pos_ticket_id,
      count(item_scope.id)::integer as service_count,
      coalesce(
        sum(coalesce(item_part_summary.part_total, item_scope.line_total, 0)),
        0
      )::numeric as subtotal
    from item_scope
    left join item_part_summary
      on item_part_summary.ticket_item_id = item_scope.id
    group by item_scope.pos_ticket_id
  ),
  item_running_turns as (
    select
      item_scope.id as ticket_item_id,
      case
        when item_part_summary.staff_id is null then null
        else nullif(
          sum(item_part_summary.large_count) over (
            partition by item_part_summary.work_date, item_part_summary.staff_id
            order by
              item_scope.ticket_opened_at,
              item_scope.ticket_created_at,
              item_scope.ticket_sequence,
              item_scope.pos_ticket_id,
              item_scope.created_at,
              item_scope.id
            rows between unbounded preceding and current row
          ),
          0
        )
      end as running_turn_big,
      case
        when item_part_summary.staff_id is null then null
        else nullif(
          sum(item_part_summary.small_count) over (
            partition by item_part_summary.work_date, item_part_summary.staff_id
            order by
              item_scope.ticket_opened_at,
              item_scope.ticket_created_at,
              item_scope.ticket_sequence,
              item_scope.pos_ticket_id,
              item_scope.created_at,
              item_scope.id
            rows between unbounded preceding and current row
          ),
          0
        )
      end as running_turn_small
    from item_scope
    left join item_part_summary
      on item_part_summary.ticket_item_id = item_scope.id
  ),
  item_lines as (
    select
      item_scope.pos_ticket_id,
      jsonb_agg(
        jsonb_build_object(
          'createdAt', item_scope.created_at,
          'id', item_scope.id,
          'lineTotal', coalesce(item_part_summary.part_total, item_scope.line_total, 0),
          'posTicketId', item_scope.pos_ticket_id,
          'runningTurnBig', item_running_turns.running_turn_big,
          'runningTurnSmall', item_running_turns.running_turn_small,
          'serviceId', item_scope.service_id,
          'serviceName',
            coalesce(
              nullif(item_scope.service_name, ''),
              nullif(item_scope.service_name_snapshot, ''),
              'Service'
            ),
          'staffId', item_scope.assigned_staff_id,
          'staffName', nullif(item_scope.staff_name, ''),
          'turnParts', coalesce(item_part_summary.turn_parts, '[]'::jsonb)
        )
        order by item_scope.created_at, item_scope.id
      ) as items
    from item_scope
    left join item_part_summary
      on item_part_summary.ticket_item_id = item_scope.id
    left join item_running_turns
      on item_running_turns.ticket_item_id = item_scope.id
    group by item_scope.pos_ticket_id
  ),
  staff_earnings as (
    select
      pos_ticket_staff_earnings.ticket_id,
      jsonb_agg(
        jsonb_build_object(
          'manualTipAmount', pos_ticket_staff_earnings.manual_tip_amount,
          'staffId', pos_ticket_staff_earnings.staff_id,
          'tipAmount', pos_ticket_staff_earnings.tip_amount,
          'tipIsManual', pos_ticket_staff_earnings.tip_is_manual
        )
        order by pos_ticket_staff_earnings.staff_id
      ) as staff_earnings
    from public.pos_ticket_staff_earnings
    join ticket_scope on ticket_scope.id = pos_ticket_staff_earnings.ticket_id
    where pos_ticket_staff_earnings.salon_id = target_salon_id
    group by pos_ticket_staff_earnings.ticket_id
  ),
  adjustment_lines as (
    select
      pos_ticket_adjustments.ticket_id,
      jsonb_agg(
        jsonb_build_object(
          'action', pos_ticket_adjustments.action,
          'afterSnapshot', pos_ticket_adjustments.after_snapshot,
          'beforeSnapshot', pos_ticket_adjustments.before_snapshot,
          'createdAt', pos_ticket_adjustments.created_at,
          'createdBy', pos_ticket_adjustments.created_by,
          'createdByUser',
            case
              when users.id is null then null::jsonb
              else jsonb_build_object(
                'displayName', users.display_name,
                'email', users.email,
                'id', users.id
              )
            end,
          'id', pos_ticket_adjustments.id,
          'reason', pos_ticket_adjustments.reason,
          'ticketId', pos_ticket_adjustments.ticket_id
        )
        order by pos_ticket_adjustments.created_at desc
      ) as adjustments
    from public.pos_ticket_adjustments
    join ticket_scope on ticket_scope.id = pos_ticket_adjustments.ticket_id
    left join public.users on users.id = pos_ticket_adjustments.created_by
    where pos_ticket_adjustments.salon_id = target_salon_id
    group by pos_ticket_adjustments.ticket_id
  ),
  ticket_base as (
    select
      ticket_scope.*,
      coalesce(item_totals.service_count, 0)::integer as service_count,
      coalesce(item_totals.subtotal, 0)::numeric as subtotal,
      coalesce(payment_totals.paid, 0)::numeric as paid,
      coalesce(item_lines.items, '[]'::jsonb) as items,
      coalesce(staff_earnings.staff_earnings, '[]'::jsonb) as staff_earnings,
      coalesce(adjustment_lines.adjustments, '[]'::jsonb) as adjustments
    from ticket_scope
    left join item_totals on item_totals.pos_ticket_id = ticket_scope.id
    left join payment_totals on payment_totals.ticket_id = ticket_scope.id
    left join item_lines on item_lines.pos_ticket_id = ticket_scope.id
    left join staff_earnings on staff_earnings.ticket_id = ticket_scope.id
    left join adjustment_lines on adjustment_lines.ticket_id = ticket_scope.id
  ),
  ticket_discount as (
    select
      ticket_base.*,
      case
        when ticket_base.subtotal <= 0 or ticket_base.discount_value <= 0 then 0::numeric
        when ticket_base.discount_type = 'percentage'
          then least(ticket_base.subtotal, round(ticket_base.subtotal * ticket_base.discount_value / 100, 2))
        else least(ticket_base.subtotal, round(ticket_base.discount_value, 2))
      end as discount_amount
    from ticket_base
  ),
  ticket_tax as (
    select
      ticket_discount.*,
      round(ticket_discount.subtotal - ticket_discount.discount_amount, 2) as taxable_amount,
      case
        when ticket_discount.subtotal - ticket_discount.discount_amount <= 0
          or ticket_discount.tax_rate <= 0 then 0::numeric
        else round((ticket_discount.subtotal - ticket_discount.discount_amount) * ticket_discount.tax_rate / 100, 2)
      end as tax_amount
    from ticket_discount
  ),
  ticket_tip as (
    select
      ticket_tax.*,
      round(ticket_tax.taxable_amount + ticket_tax.tax_amount, 2) as after_tax_amount,
      case
        when ticket_tax.taxable_amount + ticket_tax.tax_amount <= 0
          or ticket_tax.tip_value <= 0 then 0::numeric
        when ticket_tax.tip_type = 'percentage'
          then round((ticket_tax.taxable_amount + ticket_tax.tax_amount) * ticket_tax.tip_value / 100, 2)
        else round(ticket_tax.tip_value, 2)
      end as tip_amount
    from ticket_tax
  ),
  ticket_calculations as (
    select
      ticket_tip.*,
      round(ticket_tip.after_tax_amount + ticket_tip.tip_amount, 2) as total_amount
    from ticket_tip
  )
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'adjustments', ticket_calculations.adjustments,
        'closedAt', ticket_calculations.closed_at,
        'createdAt', ticket_calculations.created_at,
        'customerEmail', ticket_calculations.customer_email,
        'customerId', ticket_calculations.customer_id,
        'customerName', ticket_calculations.customer_name,
        'customerPhone', ticket_calculations.customer_phone,
        'discountAmount', ticket_calculations.discount_amount,
        'discountType', ticket_calculations.discount_type,
        'discountValue', ticket_calculations.discount_value,
        'id', ticket_calculations.id,
        'items', ticket_calculations.items,
        'openedAt', ticket_calculations.opened_at,
        'paid', ticket_calculations.paid,
        'remaining', round(ticket_calculations.total_amount - ticket_calculations.paid, 2),
        'serviceCount', ticket_calculations.service_count,
        'sourceBookingId', ticket_calculations.source_booking_id,
        'staffEarnings', ticket_calculations.staff_earnings,
        'status', ticket_calculations.status,
        'subtotal', ticket_calculations.subtotal,
        'taxAmount', ticket_calculations.tax_amount,
        'taxRate', ticket_calculations.tax_rate,
        'ticketNumber', ticket_calculations.ticket_number,
        'ticketSequence', ticket_calculations.ticket_sequence,
        'tipAmount', ticket_calculations.tip_amount,
        'tipType', ticket_calculations.tip_type,
        'tipValue', ticket_calculations.tip_value,
        'total', ticket_calculations.total_amount,
        'workDate', p_date
      )
      order by ticket_calculations.opened_at desc
    ),
    '[]'::jsonb
  )
  into tickets_json
  from ticket_calculations;

  return jsonb_build_object(
    'canEdit',
      public.pos_portable_access_has_capability(
        p_key_id,
        p_session_signature,
        'portable.pos.use'
      )
      and not is_locked,
    'isBusinessDateLocked', is_locked,
    'salonName', target_salon_name,
    'tickets', tickets_json,
    'timezone', target_timezone
  );
end;
$$;

revoke all on function public.get_pos_portable_ticket_data(uuid, text, date) from public;
grant execute on function public.get_pos_portable_ticket_data(uuid, text, date) to anon, authenticated;

create or replace function public.pos_ticket_correction_parts_array(
  p_parts jsonb,
  p_label text
)
returns numeric[]
language plpgsql
security definer
set search_path = public
as $$
declare
  part_amount numeric;
  part_text text;
  part_value jsonb;
  result numeric[] := array[]::numeric[];
begin
  if jsonb_typeof(coalesce(p_parts, '[]'::jsonb)) <> 'array' then
    raise exception '% parts must be an array.', coalesce(nullif(p_label, ''), 'Line');
  end if;

  for part_value in select value from jsonb_array_elements(coalesce(p_parts, '[]'::jsonb))
  loop
    part_text := nullif(
      btrim(coalesce(part_value ->> 'amount', part_value #>> '{}')),
      ''
    );

    if part_text is null then
      raise exception '% parts must include an amount.', coalesce(nullif(p_label, ''), 'Line');
    end if;

    part_amount := round(part_text::numeric, 2);

    if part_amount <= 0 then
      raise exception '% parts must be greater than 0.', coalesce(nullif(p_label, ''), 'Line');
    end if;

    result := array_append(result, part_amount);
  end loop;

  return result;
end;
$$;

revoke all on function public.pos_ticket_correction_parts_array(jsonb, text) from public;
revoke all on function public.pos_ticket_correction_parts_array(jsonb, text) from anon;
revoke all on function public.pos_ticket_correction_parts_array(jsonb, text) from authenticated;

create or replace function public.pos_ticket_correction_snapshot(
  p_salon_id uuid,
  p_ticket_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  earnings_json jsonb := '[]'::jsonb;
  ticket_json jsonb := null;
begin
  select jsonb_build_object(
    'id', tickets.id,
    'salon_id', tickets.salon_id,
    'ticket_number', tickets.ticket_number,
    'ticket_sequence', tickets.ticket_sequence,
    'customer_id', tickets.customer_id,
    'opened_at', tickets.opened_at,
    'closed_at', tickets.closed_at,
    'status', tickets.status,
    'discount_type', tickets.discount_type,
    'discount_value', tickets.discount_value,
    'tax_rate', tickets.tax_rate,
    'tip_type', tickets.tip_type,
    'tip_value', tickets.tip_value,
    'notes', tickets.notes,
    'created_at', tickets.created_at,
    'updated_at', tickets.updated_at,
    'ticket_items',
      coalesce(
        (
          select jsonb_agg(
            jsonb_build_object(
              'id', items.id,
              'salon_id', items.salon_id,
              'pos_ticket_id', items.pos_ticket_id,
              'service_id', items.service_id,
              'assigned_staff_id', items.assigned_staff_id,
              'quantity', items.quantity,
              'unit_price', items.unit_price,
              'line_total', items.line_total,
              'notes', items.notes,
              'is_removed', items.is_removed,
              'removed_at', items.removed_at,
              'removed_by', items.removed_by,
              'removal_reason', items.removal_reason,
              'created_at', items.created_at,
              'updated_at', items.updated_at,
              'service',
                case
                  when services.id is null then null::jsonb
                  else jsonb_build_object(
                    'base_price', services.base_price,
                    'category', services.category,
                    'duration_minutes', services.duration_minutes,
                    'id', services.id,
                    'name', services.name
                  )
                end,
              'assigned_staff',
                case
                  when staff.id is null then null::jsonb
                  else jsonb_build_object(
                    'display_name', staff.display_name,
                    'id', staff.id,
                    'job_title', staff.job_title
                  )
                end,
              'turn_parts',
                coalesce(
                  (
                    select jsonb_agg(
                      jsonb_build_object(
                        'amount', parts.amount,
                        'created_at', parts.created_at,
                        'id', parts.id,
                        'staff_id', parts.staff_id,
                        'ticket_id', parts.ticket_id,
                        'ticket_item_id', parts.ticket_item_id,
                        'turn_index', parts.turn_index,
                        'turn_type', parts.turn_type,
                        'work_date', parts.work_date
                      )
                      order by parts.turn_index, parts.created_at, parts.id
                    )
                    from public.pos_ticket_item_turn_parts parts
                    where parts.salon_id = p_salon_id
                      and parts.ticket_item_id = items.id
                  ),
                  '[]'::jsonb
                )
            )
            order by items.created_at, items.id
          )
          from public.pos_ticket_items items
          left join public.services on services.id = items.service_id
          left join public.staff on staff.id = items.assigned_staff_id
          where items.salon_id = p_salon_id
            and items.pos_ticket_id = tickets.id
        ),
        '[]'::jsonb
      )
  )
  into ticket_json
  from public.pos_tickets tickets
  where tickets.salon_id = p_salon_id
    and tickets.id = p_ticket_id
  limit 1;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'big_turn_count', earnings.big_turn_count,
        'first_big_turn_sequence', earnings.first_big_turn_sequence,
        'first_small_turn_sequence', earnings.first_small_turn_sequence,
        'id', earnings.id,
        'last_big_turn_sequence', earnings.last_big_turn_sequence,
        'last_small_turn_sequence', earnings.last_small_turn_sequence,
        'locked_at', earnings.locked_at,
        'manual_tip_amount', earnings.manual_tip_amount,
        'payroll_batch_id', earnings.payroll_batch_id,
        'service_total', earnings.service_total,
        'small_turn_count', earnings.small_turn_count,
        'staff_id', earnings.staff_id,
        'ticket_id', earnings.ticket_id,
        'tip_amount', earnings.tip_amount,
        'tip_is_manual', earnings.tip_is_manual,
        'total_earning', earnings.total_earning,
        'work_date', earnings.work_date
      )
      order by earnings.staff_id
    ),
    '[]'::jsonb
  )
  into earnings_json
  from public.pos_ticket_staff_earnings earnings
  where earnings.salon_id = p_salon_id
    and earnings.ticket_id = p_ticket_id;

  return jsonb_build_object(
    'earnings', coalesce(earnings_json, '[]'::jsonb),
    'ticket', ticket_json
  );
end;
$$;

revoke all on function public.pos_ticket_correction_snapshot(uuid, uuid) from public;
revoke all on function public.pos_ticket_correction_snapshot(uuid, uuid) from anon;
revoke all on function public.pos_ticket_correction_snapshot(uuid, uuid) from authenticated;

create or replace function public.rebuild_pos_ticket_item_turn_parts_for_correction(
  p_salon_id uuid,
  p_ticket_id uuid,
  p_item_id uuid,
  p_staff_id uuid,
  p_work_date date,
  p_parts numeric[]
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  large_turn_threshold numeric := 25;
  part_amount numeric;
  part_index integer := 0;
begin
  delete from public.pos_ticket_item_turn_parts
  where salon_id = p_salon_id
    and ticket_item_id = p_item_id;

  if p_staff_id is null or cardinality(coalesce(p_parts, array[]::numeric[])) = 0 then
    return;
  end if;

  select coalesce(pos_settings.large_turn_threshold, 25)
  into large_turn_threshold
  from public.pos_settings
  where pos_settings.salon_id = p_salon_id
  limit 1;

  large_turn_threshold := coalesce(large_turn_threshold, 25);

  foreach part_amount in array coalesce(p_parts, array[]::numeric[])
  loop
    part_amount := round(coalesce(part_amount, 0), 2);

    if part_amount <= 0 then
      raise exception 'Ticket line parts must be greater than 0.';
    end if;

    part_index := part_index + 1;

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
      p_salon_id,
      p_staff_id,
      p_ticket_id,
      p_item_id,
      part_index,
      case when part_amount >= large_turn_threshold then 'large' else 'small' end,
      p_work_date
    );
  end loop;
end;
$$;

revoke all on function public.rebuild_pos_ticket_item_turn_parts_for_correction(uuid, uuid, uuid, uuid, date, numeric[]) from public;
revoke all on function public.rebuild_pos_ticket_item_turn_parts_for_correction(uuid, uuid, uuid, uuid, date, numeric[]) from anon;
revoke all on function public.rebuild_pos_ticket_item_turn_parts_for_correction(uuid, uuid, uuid, uuid, date, numeric[]) from authenticated;

create or replace function public.recalculate_pos_ticket_staff_earnings_for_date(
  p_salon_id uuid,
  p_work_date date
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  inserted_count integer := 0;
  large_turn_threshold numeric := 25;
  range_end timestamptz;
  range_start timestamptz;
  target_timezone text;
begin
  if p_salon_id is null or p_work_date is null then
    raise exception 'Salon and work date are required.';
  end if;

  if exists (
    select 1
    from public.pos_ticket_staff_earnings earnings
    where earnings.salon_id = p_salon_id
      and earnings.work_date = p_work_date
      and (earnings.locked_at is not null or earnings.payroll_batch_id is not null)
  ) then
    raise exception 'This work date has locked payroll earnings and cannot be corrected.';
  end if;

  target_timezone := coalesce(public.get_salon_business_timezone(p_salon_id), 'America/Chicago');
  range_start := p_work_date::timestamp at time zone target_timezone;
  range_end := (p_work_date + 1)::timestamp at time zone target_timezone;

  select coalesce(pos_settings.large_turn_threshold, 25)
  into large_turn_threshold
  from public.pos_settings
  where pos_settings.salon_id = p_salon_id
  limit 1;

  large_turn_threshold := coalesce(large_turn_threshold, 25);

  drop table if exists pg_temp.portable_ticket_manual_tips;
  create temporary table portable_ticket_manual_tips on commit drop as
  select
    earnings.ticket_id,
    earnings.staff_id,
    round(
      greatest(coalesce(earnings.manual_tip_amount, earnings.tip_amount, 0), 0),
      2
    ) as manual_tip_amount
  from public.pos_ticket_staff_earnings earnings
  where earnings.salon_id = p_salon_id
    and earnings.work_date = p_work_date
    and earnings.tip_is_manual = true;

  delete from public.pos_ticket_staff_earnings earnings
  where earnings.salon_id = p_salon_id
    and earnings.work_date = p_work_date;

  with ticket_scope as (
    select tickets.*
    from public.pos_tickets tickets
    where tickets.salon_id = p_salon_id
      and tickets.status = 'closed'
      and tickets.opened_at >= range_start
      and tickets.opened_at < range_end
  ),
  active_items as (
    select
      tickets.id as ticket_id,
      tickets.salon_id,
      tickets.opened_at,
      tickets.ticket_sequence,
      items.id as ticket_item_id,
      items.assigned_staff_id,
      coalesce(items.quantity, 1) as quantity,
      items.unit_price,
      items.line_total,
      items.created_at
    from ticket_scope tickets
    join public.pos_ticket_items items
      on items.pos_ticket_id = tickets.id
     and items.salon_id = tickets.salon_id
    where coalesce(items.is_removed, false) = false
  ),
  turn_part_totals as (
    select
      turn_parts.ticket_item_id,
      turn_parts.salon_id,
      round(coalesce(sum(turn_parts.amount), 0), 2) as service_amount,
      min(turn_parts.work_date) as work_date
    from public.pos_ticket_item_turn_parts turn_parts
    join active_items items
      on items.ticket_item_id = turn_parts.ticket_item_id
     and items.salon_id = turn_parts.salon_id
    group by turn_parts.ticket_item_id, turn_parts.salon_id
  ),
  item_service as (
    select
      items.ticket_id,
      items.salon_id,
      items.ticket_item_id,
      items.assigned_staff_id,
      coalesce(turn_totals.work_date, p_work_date) as work_date,
      case
        when turn_totals.ticket_item_id is not null
          then round(coalesce(turn_totals.service_amount, 0), 2)
        else round(coalesce(items.line_total, 0), 2)
      end as service_amount
    from active_items items
    left join turn_part_totals turn_totals
      on turn_totals.ticket_item_id = items.ticket_item_id
     and turn_totals.salon_id = items.salon_id
  ),
  turn_rows as (
    select
      items.ticket_id,
      items.salon_id,
      items.opened_at,
      items.ticket_sequence,
      items.ticket_item_id,
      items.created_at,
      turn_parts.staff_id,
      turn_parts.turn_index,
      coalesce(
        turn_parts.turn_type,
        case when turn_parts.amount >= large_turn_threshold then 'large' else 'small' end
      ) as turn_type,
      coalesce(turn_parts.work_date, p_work_date) as work_date
    from active_items items
    join public.pos_ticket_item_turn_parts turn_parts
      on turn_parts.ticket_item_id = items.ticket_item_id
     and turn_parts.salon_id = items.salon_id
    where turn_parts.staff_id is not null

    union all

    select
      items.ticket_id,
      items.salon_id,
      items.opened_at,
      items.ticket_sequence,
      items.ticket_item_id,
      items.created_at,
      items.assigned_staff_id as staff_id,
      generated_turns.turn_number as turn_index,
      case
        when (
          case
            when coalesce(items.unit_price, 0) > 0 then items.unit_price
            else coalesce(items.line_total, 0)
                 / greatest(1, round(coalesce(items.quantity, 1))::integer)
          end
        ) >= large_turn_threshold then 'large'
        else 'small'
      end as turn_type,
      p_work_date as work_date
    from active_items items
    left join turn_part_totals turn_totals
      on turn_totals.ticket_item_id = items.ticket_item_id
     and turn_totals.salon_id = items.salon_id
    cross join lateral generate_series(
      1,
      greatest(1, round(coalesce(items.quantity, 1))::integer)
    ) as generated_turns(turn_number)
    where items.assigned_staff_id is not null
      and turn_totals.ticket_item_id is null
  ),
  sequenced_turns as (
    select
      turn_rows.*,
      row_number() over (
        partition by turn_rows.work_date, turn_rows.staff_id, turn_rows.turn_type
        order by
          turn_rows.opened_at,
          turn_rows.ticket_sequence,
          turn_rows.ticket_id,
          turn_rows.created_at,
          turn_rows.ticket_item_id,
          turn_rows.turn_index
      )::integer as turn_sequence
    from turn_rows
  ),
  staff_turn_counts as (
    select
      sequenced_turns.ticket_id,
      sequenced_turns.salon_id,
      sequenced_turns.staff_id,
      count(*) filter (where sequenced_turns.turn_type = 'large')::integer as big_turn_count,
      count(*) filter (where sequenced_turns.turn_type = 'small')::integer as small_turn_count,
      min(sequenced_turns.turn_sequence) filter (where sequenced_turns.turn_type = 'large')::integer as first_big_turn_sequence,
      max(sequenced_turns.turn_sequence) filter (where sequenced_turns.turn_type = 'large')::integer as last_big_turn_sequence,
      min(sequenced_turns.turn_sequence) filter (where sequenced_turns.turn_type = 'small')::integer as first_small_turn_sequence,
      max(sequenced_turns.turn_sequence) filter (where sequenced_turns.turn_type = 'small')::integer as last_small_turn_sequence
    from sequenced_turns
    group by sequenced_turns.ticket_id, sequenced_turns.salon_id, sequenced_turns.staff_id
  ),
  ticket_subtotals as (
    select
      item_service.ticket_id,
      round(coalesce(sum(item_service.service_amount), 0), 2) as subtotal
    from item_service
    group by item_service.ticket_id
  ),
  ticket_discount as (
    select
      tickets.id as ticket_id,
      coalesce(subtotals.subtotal, 0) as subtotal,
      tickets.discount_type,
      tickets.discount_value,
      tickets.tax_rate,
      tickets.tip_type,
      tickets.tip_value,
      case
        when coalesce(subtotals.subtotal, 0) <= 0
          or coalesce(tickets.discount_value, 0) <= 0 then 0::numeric
        when tickets.discount_type = 'percentage'
          then least(
            coalesce(subtotals.subtotal, 0),
            round((coalesce(subtotals.subtotal, 0) * tickets.discount_value) / 100, 2)
          )
        else least(coalesce(subtotals.subtotal, 0), round(coalesce(tickets.discount_value, 0), 2))
      end as discount_amount
    from ticket_scope tickets
    left join ticket_subtotals subtotals
      on subtotals.ticket_id = tickets.id
  ),
  ticket_tax as (
    select
      ticket_discount.*,
      round(ticket_discount.subtotal - ticket_discount.discount_amount, 2) as taxable_amount,
      case
        when round(ticket_discount.subtotal - ticket_discount.discount_amount, 2) <= 0
          or coalesce(ticket_discount.tax_rate, 0) <= 0 then 0::numeric
        else round(
          (round(ticket_discount.subtotal - ticket_discount.discount_amount, 2)
            * ticket_discount.tax_rate) / 100,
          2
        )
      end as tax_amount
    from ticket_discount
  ),
  ticket_tips as (
    select
      ticket_tax.ticket_id,
      case
        when round(ticket_tax.taxable_amount + ticket_tax.tax_amount, 2) <= 0
          or coalesce(ticket_tax.tip_value, 0) <= 0 then 0
        when ticket_tax.tip_type = 'percentage'
          then round(
            round((ticket_tax.taxable_amount + ticket_tax.tax_amount) * ticket_tax.tip_value / 100, 2)
            * 100
          )::integer
        else round(round(coalesce(ticket_tax.tip_value, 0), 2) * 100)::integer
      end as tip_cents
    from ticket_tax
  ),
  staff_service as (
    select
      item_service.ticket_id,
      item_service.salon_id,
      item_service.assigned_staff_id as staff_id,
      p_work_date as work_date,
      coalesce(sum(round(item_service.service_amount * 100)::integer), 0) as service_cents
    from item_service
    where item_service.assigned_staff_id is not null
    group by item_service.ticket_id, item_service.salon_id, item_service.assigned_staff_id
    having coalesce(sum(round(item_service.service_amount * 100)::integer), 0) > 0
  ),
  staff_rows as (
    select
      staff_service.*,
      coalesce(staff_turn_counts.big_turn_count, 0) as big_turn_count,
      coalesce(staff_turn_counts.small_turn_count, 0) as small_turn_count,
      staff_turn_counts.first_big_turn_sequence,
      staff_turn_counts.last_big_turn_sequence,
      staff_turn_counts.first_small_turn_sequence,
      staff_turn_counts.last_small_turn_sequence,
      coalesce(ticket_tips.tip_cents, 0) as tip_cents,
      round(manual_tips.manual_tip_amount * 100)::integer as manual_tip_cents,
      coalesce(
        sum(round(manual_tips.manual_tip_amount * 100)::integer)
          over (partition by staff_service.ticket_id),
        0
      ) as manual_total_cents,
      coalesce(
        sum(staff_service.service_cents)
          filter (where manual_tips.staff_id is null)
          over (partition by staff_service.ticket_id),
        0
      ) as non_manual_service_cents,
      case
        when manual_tips.staff_id is null then
          row_number() over (
            partition by staff_service.ticket_id, (manual_tips.staff_id is null)
            order by staff_service.service_cents desc, staff_service.staff_id
          )
        else null
      end as non_manual_rank
    from staff_service
    left join staff_turn_counts
      on staff_turn_counts.ticket_id = staff_service.ticket_id
     and staff_turn_counts.salon_id = staff_service.salon_id
     and staff_turn_counts.staff_id = staff_service.staff_id
    left join ticket_tips
      on ticket_tips.ticket_id = staff_service.ticket_id
    left join pg_temp.portable_ticket_manual_tips manual_tips
      on manual_tips.ticket_id = staff_service.ticket_id
     and manual_tips.staff_id = staff_service.staff_id
  ),
  allocated_rows as (
    select
      staff_rows.*,
      case
        when staff_rows.manual_tip_cents is not null then 0
        when staff_rows.non_manual_service_cents <= 0 then 0
        when staff_rows.tip_cents - staff_rows.manual_total_cents <= 0 then 0
        else round(
          ((staff_rows.tip_cents - staff_rows.manual_total_cents)::numeric
            * staff_rows.service_cents::numeric)
          / staff_rows.non_manual_service_cents::numeric
        )::integer
      end as non_manual_tip_cents
    from staff_rows
  ),
  final_rows as (
    select
      allocated_rows.*,
      coalesce(allocated_rows.manual_tip_cents, 0)
        + allocated_rows.non_manual_tip_cents
        + case
            when allocated_rows.manual_tip_cents is null
              and allocated_rows.non_manual_rank = 1
            then
              allocated_rows.tip_cents
              - allocated_rows.manual_total_cents
              - coalesce(
                  sum(allocated_rows.non_manual_tip_cents)
                    filter (where allocated_rows.manual_tip_cents is null)
                    over (partition by allocated_rows.ticket_id),
                  0
                )
            else 0
          end as final_tip_cents
    from allocated_rows
  ),
  inserted as (
    insert into public.pos_ticket_staff_earnings (
      salon_id,
      ticket_id,
      staff_id,
      work_date,
      service_total,
      tip_amount,
      tip_is_manual,
      manual_tip_amount,
      big_turn_count,
      small_turn_count,
      first_big_turn_sequence,
      last_big_turn_sequence,
      first_small_turn_sequence,
      last_small_turn_sequence,
      commission_amount,
      bonus_amount,
      deduction_amount,
      total_earning,
      calculation_version
    )
    select
      final_rows.salon_id,
      final_rows.ticket_id,
      final_rows.staff_id,
      final_rows.work_date,
      round(final_rows.service_cents::numeric / 100, 2),
      round(greatest(final_rows.final_tip_cents, 0)::numeric / 100, 2),
      final_rows.manual_tip_cents is not null,
      case
        when final_rows.manual_tip_cents is null then null
        else round(greatest(final_rows.manual_tip_cents, 0)::numeric / 100, 2)
      end,
      final_rows.big_turn_count,
      final_rows.small_turn_count,
      final_rows.first_big_turn_sequence,
      final_rows.last_big_turn_sequence,
      final_rows.first_small_turn_sequence,
      final_rows.last_small_turn_sequence,
      0,
      0,
      0,
      round(
        (final_rows.service_cents + greatest(final_rows.final_tip_cents, 0))::numeric / 100,
        2
      ),
      1
    from final_rows
    returning 1
  )
  select count(*)::integer
  into inserted_count
  from inserted;

  return inserted_count;
end;
$$;

revoke all on function public.recalculate_pos_ticket_staff_earnings_for_date(uuid, date) from public;
revoke all on function public.recalculate_pos_ticket_staff_earnings_for_date(uuid, date) from anon;
revoke all on function public.recalculate_pos_ticket_staff_earnings_for_date(uuid, date) from authenticated;

create or replace function public.correct_pos_portable_closed_ticket(
  p_key_id uuid,
  p_session_signature text,
  p_ticket_id uuid,
  p_item_updates jsonb default '[]'::jsonb,
  p_item_parts jsonb default '[]'::jsonb,
  p_added_items jsonb default '[]'::jsonb,
  p_staff_tip_overrides jsonb default '[]'::jsonb,
  p_tip_total numeric default 0,
  p_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  added_payload record;
  added_row record;
  after_snapshot jsonb;
  before_snapshot jsonb;
  closing_locked_at timestamptz := null;
  closing_status text := 'draft';
  current_discount numeric := 0;
  current_subtotal numeric := 0;
  current_tax numeric := 0;
  current_taxable numeric := 0;
  current_tip numeric := 0;
  current_business_date date;
  current_row record;
  effective_manual_tip_count integer := 0;
  effective_manual_tip_total numeric := 0;
  final_staff_count integer := 0;
  final_staff_distinct_count integer := 0;
  has_manual_tip_change boolean := false;
  has_tip_change boolean := false;
  inserted_item_id uuid;
  is_locked boolean := false;
  manual_override_count integer := 0;
  manual_tip_total numeric := 0;
  now_value timestamptz := now();
  part_amount numeric;
  parts_array numeric[];
  payload jsonb;
  replacement_item_ids uuid[] := array[]::uuid[];
  service_text text;
  service_uuid uuid;
  should_refresh_unchanged_parts boolean := false;
  should_update_ticket_tip boolean := false;
  staff_text text;
  staff_uuid uuid;
  target_salon_id uuid;
  target_timezone text;
  ticket_row public.pos_tickets%rowtype;
  update_row record;
begin
  target_salon_id := public.pos_portable_access_salon_id(p_key_id, p_session_signature);

  if target_salon_id is null
    or not public.pos_portable_access_has_capability(
      p_key_id,
      p_session_signature,
      'portable.today.view'
    )
    or not public.pos_portable_access_has_capability(
      p_key_id,
      p_session_signature,
      'portable.pos.use'
    )
  then
    return null;
  end if;

  if p_ticket_id is null then
    raise exception 'Ticket id is required.';
  end if;

  if nullif(btrim(coalesce(p_reason, '')), '') is null then
    raise exception 'Correction reason is required.';
  end if;

  if p_tip_total is null or p_tip_total < 0 then
    raise exception 'Total tip must be zero or greater.';
  end if;

  if jsonb_typeof(coalesce(p_item_updates, '[]'::jsonb)) <> 'array'
    or jsonb_typeof(coalesce(p_item_parts, '[]'::jsonb)) <> 'array'
    or jsonb_typeof(coalesce(p_added_items, '[]'::jsonb)) <> 'array'
    or jsonb_typeof(coalesce(p_staff_tip_overrides, '[]'::jsonb)) <> 'array'
  then
    raise exception 'Correction payloads must be arrays.';
  end if;

  select *
  into ticket_row
  from public.pos_tickets
  where pos_tickets.id = p_ticket_id
    and pos_tickets.salon_id = target_salon_id
  limit 1;

  if ticket_row.id is null then
    raise exception 'POS Ticket is required.';
  end if;

  if ticket_row.status <> 'closed' then
    raise exception 'Only closed tickets can be corrected with this action.';
  end if;

  target_timezone := coalesce(public.get_salon_business_timezone(target_salon_id), 'America/Chicago');
  current_business_date := (now() at time zone target_timezone)::date;

  select
    pos_daily_closings.status,
    pos_daily_closings.locked_at
  into closing_status, closing_locked_at
  from public.pos_daily_closings
  where pos_daily_closings.salon_id = target_salon_id
    and pos_daily_closings.report_date = (ticket_row.opened_at at time zone target_timezone)::date
  limit 1;

  closing_status := coalesce(closing_status, 'draft');
  is_locked :=
    (ticket_row.opened_at at time zone target_timezone)::date < current_business_date
    or closing_locked_at is not null
    or closing_status in ('auto_locked', 'locked', 'approved', 'payroll_locked');

  if is_locked then
    raise exception 'This business date is locked.';
  end if;

  if exists (
    select 1
    from public.pos_ticket_staff_earnings earnings
    where earnings.salon_id = target_salon_id
      and earnings.work_date = (ticket_row.opened_at at time zone target_timezone)::date
      and (earnings.locked_at is not null or earnings.payroll_batch_id is not null)
  ) then
    raise exception 'This work date has locked payroll earnings and cannot be corrected.';
  end if;

  drop table if exists pg_temp.portable_ticket_current_items;
  create temporary table portable_ticket_current_items on commit drop as
  select
    items.id,
    items.service_id,
    items.assigned_staff_id,
    items.notes,
    items.line_total,
    items.created_at,
    coalesce(
      array_agg(parts.amount order by parts.turn_index, parts.created_at, parts.id)
        filter (where parts.id is not null),
      array[]::numeric[]
    ) as current_parts,
    case
      when count(parts.id) > 0 then
        round(coalesce(sum(parts.amount), 0), 2)
      else
        round(coalesce(items.line_total, 0), 2)
    end as current_line_total
  from public.pos_ticket_items items
  left join public.pos_ticket_item_turn_parts parts
    on parts.ticket_item_id = items.id
   and parts.salon_id = items.salon_id
  where items.salon_id = target_salon_id
    and items.pos_ticket_id = p_ticket_id
    and coalesce(items.is_removed, false) = false
  group by
    items.id,
    items.service_id,
    items.assigned_staff_id,
    items.notes,
    items.line_total,
    items.created_at;

  drop table if exists pg_temp.portable_ticket_item_parts;
  create temporary table portable_ticket_item_parts (
    item_id uuid primary key,
    parts numeric[] not null,
    line_total numeric not null
  ) on commit drop;

  for payload in select value from jsonb_array_elements(coalesce(p_item_parts, '[]'::jsonb))
  loop
    if nullif(btrim(coalesce(payload ->> 'item_id', '')), '') is null then
      raise exception 'Each active line must include one unique parts payload.';
    end if;

    parts_array := public.pos_ticket_correction_parts_array(payload -> 'parts', 'Active line');

    if cardinality(parts_array) = 0 then
      raise exception 'Active line parts must be greater than 0.';
    end if;

    select coalesce(sum(part_values.value), 0)
    into part_amount
    from unnest(parts_array) as part_values(value);

    insert into pg_temp.portable_ticket_item_parts (item_id, parts, line_total)
    values (
      (payload ->> 'item_id')::uuid,
      parts_array,
      round(part_amount, 2)
    );
  end loop;

  if exists (
    select 1
    from pg_temp.portable_ticket_item_parts submitted
    where not exists (
      select 1
      from pg_temp.portable_ticket_current_items current_items
      where current_items.id = submitted.item_id
    )
  ) then
    raise exception 'Submitted line parts must belong to the selected ticket.';
  end if;

  drop table if exists pg_temp.portable_ticket_item_updates;
  create temporary table portable_ticket_item_updates (
    item_id uuid primary key,
    service_id uuid,
    staff_id uuid,
    remove boolean not null,
    parts numeric[] not null,
    line_total numeric not null,
    has_parts boolean not null
  ) on commit drop;

  for payload in select value from jsonb_array_elements(coalesce(p_item_updates, '[]'::jsonb))
  loop
    if nullif(btrim(coalesce(payload ->> 'item_id', '')), '') is null then
      raise exception 'Each correction line must reference a unique item.';
    end if;

    service_text := nullif(btrim(coalesce(payload ->> 'service_id', '')), '');
    staff_text := nullif(btrim(coalesce(payload ->> 'staff_id', '')), '');
    service_uuid := case when service_text is null then null else service_text::uuid end;
    staff_uuid := case when staff_text is null then null else staff_text::uuid end;
    parts_array := public.pos_ticket_correction_parts_array(payload -> 'parts', 'Corrected line');

    if cardinality(parts_array) = 0 and coalesce((payload ->> 'remove')::boolean, false) = false then
      select parts
      into parts_array
      from pg_temp.portable_ticket_item_parts
      where item_id = (payload ->> 'item_id')::uuid;
    end if;

    if cardinality(coalesce(parts_array, array[]::numeric[])) = 0
      and coalesce((payload ->> 'remove')::boolean, false) = false
    then
      raise exception 'Corrected line parts must be greater than 0.';
    end if;

    select coalesce(sum(part_values.value), 0)
    into part_amount
    from unnest(coalesce(parts_array, array[]::numeric[])) as part_values(value);

    insert into pg_temp.portable_ticket_item_updates (
      item_id,
      service_id,
      staff_id,
      remove,
      parts,
      line_total,
      has_parts
    )
    values (
      (payload ->> 'item_id')::uuid,
      service_uuid,
      staff_uuid,
      coalesce((payload ->> 'remove')::boolean, false),
      coalesce(parts_array, array[]::numeric[]),
      round(part_amount, 2),
      cardinality(coalesce(parts_array, array[]::numeric[])) > 0
    );
  end loop;

  if exists (
    select 1
    from pg_temp.portable_ticket_item_updates updates
    where not exists (
      select 1
      from pg_temp.portable_ticket_current_items current_items
      where current_items.id = updates.item_id
    )
  ) then
    raise exception 'Corrected item must belong to the selected ticket.';
  end if;

  drop table if exists pg_temp.portable_ticket_added_items;
  create temporary table portable_ticket_added_items (
    row_index integer primary key,
    service_id uuid not null,
    staff_id uuid not null,
    parts numeric[] not null,
    line_total numeric not null
  ) on commit drop;

  for added_payload in
    select value, ordinality
    from jsonb_array_elements(coalesce(p_added_items, '[]'::jsonb)) with ordinality
  loop
    service_text := nullif(btrim(coalesce(added_payload.value ->> 'service_id', '')), '');
    staff_text := nullif(btrim(coalesce(added_payload.value ->> 'staff_id', '')), '');

    if service_text is null or staff_text is null then
      raise exception 'Added lines require staff and service.';
    end if;

    service_uuid := service_text::uuid;
    staff_uuid := staff_text::uuid;
    parts_array := public.pos_ticket_correction_parts_array(added_payload.value -> 'parts', 'Added line');

    if cardinality(parts_array) = 0 then
      raise exception 'Added line parts must be greater than 0.';
    end if;

    select coalesce(sum(part_values.value), 0)
    into part_amount
    from unnest(parts_array) as part_values(value);

    insert into pg_temp.portable_ticket_added_items (
      row_index,
      service_id,
      staff_id,
      parts,
      line_total
    )
    values (
      added_payload.ordinality::integer,
      service_uuid,
      staff_uuid,
      parts_array,
      round(part_amount, 2)
    );
  end loop;

  drop table if exists pg_temp.portable_ticket_staff_tip_overrides;
  create temporary table portable_ticket_staff_tip_overrides (
    staff_id uuid primary key,
    tip_amount numeric not null,
    is_manual boolean not null
  ) on commit drop;

  for payload in select value from jsonb_array_elements(coalesce(p_staff_tip_overrides, '[]'::jsonb))
  loop
    staff_text := nullif(btrim(coalesce(payload ->> 'staff_id', '')), '');

    if staff_text is null then
      raise exception 'Each staff tip override must reference one unique staff member.';
    end if;

    part_amount := round(coalesce((payload ->> 'tip_amount')::numeric, 0), 2);

    if part_amount < 0 then
      raise exception 'Staff tip amounts must be zero or greater.';
    end if;

    insert into pg_temp.portable_ticket_staff_tip_overrides (
      staff_id,
      tip_amount,
      is_manual
    )
    values (
      staff_text::uuid,
      part_amount,
      coalesce((payload ->> 'is_manual')::boolean, false)
    );
  end loop;

  drop table if exists pg_temp.portable_ticket_final_items;
  create temporary table portable_ticket_final_items (
    line_key text primary key,
    item_id uuid,
    service_id uuid,
    staff_id uuid,
    parts numeric[] not null,
    line_total numeric not null,
    is_added boolean not null default false
  ) on commit drop;

  insert into pg_temp.portable_ticket_final_items (
    line_key,
    item_id,
    service_id,
    staff_id,
    parts,
    line_total
  )
  select
    current_items.id::text,
    current_items.id,
    current_items.service_id,
    current_items.assigned_staff_id,
    coalesce(
      submitted.parts,
      nullif(current_items.current_parts, array[]::numeric[]),
      array[round(coalesce(current_items.line_total, 0), 2)]
    ),
    coalesce(submitted.line_total, current_items.current_line_total)
  from pg_temp.portable_ticket_current_items current_items
  left join pg_temp.portable_ticket_item_parts submitted
    on submitted.item_id = current_items.id;

  for update_row in
    select *
    from pg_temp.portable_ticket_item_updates
  loop
    if update_row.remove then
      delete from pg_temp.portable_ticket_final_items
      where item_id = update_row.item_id;
    else
      update pg_temp.portable_ticket_final_items
      set
        service_id = update_row.service_id,
        staff_id = update_row.staff_id,
        parts = update_row.parts,
        line_total = update_row.line_total
      where item_id = update_row.item_id;
    end if;
  end loop;

  insert into pg_temp.portable_ticket_final_items (
    line_key,
    item_id,
    service_id,
    staff_id,
    parts,
    line_total,
    is_added
  )
  select
    'added-' || added_items.row_index::text,
    null,
    added_items.service_id,
    added_items.staff_id,
    added_items.parts,
    added_items.line_total,
    true
  from pg_temp.portable_ticket_added_items added_items;

  if exists (
    select 1
    from pg_temp.portable_ticket_final_items final_items
    where final_items.service_id is null
      or final_items.staff_id is null
      or cardinality(final_items.parts) = 0
      or final_items.line_total <= 0
  ) then
    raise exception 'Active lines require staff, service, and positive parts.';
  end if;

  select
    count(final_items.staff_id),
    count(distinct final_items.staff_id)
  into final_staff_count, final_staff_distinct_count
  from pg_temp.portable_ticket_final_items final_items
  where final_items.staff_id is not null;

  if final_staff_count <> final_staff_distinct_count then
    raise exception 'Each staff member can appear only once on a ticket.';
  end if;

  if exists (
    select 1
    from (
      select updates.service_id
      from pg_temp.portable_ticket_item_updates updates
      join pg_temp.portable_ticket_current_items current_items
        on current_items.id = updates.item_id
      where updates.remove = false
        and updates.service_id is distinct from current_items.service_id

      union

      select added_items.service_id
      from pg_temp.portable_ticket_added_items added_items
    ) changed_services
    where changed_services.service_id is null
      or not exists (
        select 1
        from public.services
        where services.id = changed_services.service_id
          and services.salon_id = target_salon_id
          and services.is_active = true
      )
  ) then
    raise exception 'New or changed correction services must be active in the current salon.';
  end if;

  if exists (
    select 1
    from (
      select updates.staff_id
      from pg_temp.portable_ticket_item_updates updates
      where updates.remove = false

      union

      select added_items.staff_id
      from pg_temp.portable_ticket_added_items added_items

      union

      select overrides.staff_id
      from pg_temp.portable_ticket_staff_tip_overrides overrides
    ) changed_staff
    where changed_staff.staff_id is null
      or not exists (
        select 1
        from public.staff
        where staff.id = changed_staff.staff_id
          and staff.salon_id = target_salon_id
      )
  ) then
    raise exception 'All corrected staff must belong to the current salon.';
  end if;

  if exists (
    select 1
    from pg_temp.portable_ticket_staff_tip_overrides overrides
    where not exists (
      select 1
      from pg_temp.portable_ticket_final_items final_items
      where final_items.staff_id = overrides.staff_id
    )
  ) then
    raise exception 'Staff tip overrides must belong to staff with active ticket services.';
  end if;

  select
    coalesce(sum(overrides.tip_amount), 0),
    count(*)
  into manual_tip_total, manual_override_count
  from pg_temp.portable_ticket_staff_tip_overrides overrides
  where overrides.is_manual = true;

  if round(manual_tip_total * 100)::integer > round(p_tip_total * 100)::integer then
    raise exception 'Manual staff tips cannot exceed total tip.';
  end if;

  if final_staff_count > 0
    and manual_override_count = final_staff_count
    and round(manual_tip_total * 100)::integer <> round(p_tip_total * 100)::integer
  then
    raise exception 'Manual staff tips must equal total tip when all staff tips are manual.';
  end if;

  select coalesce(
    sum(coalesce(submitted.line_total, current_items.current_line_total)),
    0
  )
  into current_subtotal
  from pg_temp.portable_ticket_current_items current_items
  left join pg_temp.portable_ticket_item_parts submitted
    on submitted.item_id = current_items.id;

  current_discount := case
    when current_subtotal <= 0 or coalesce(ticket_row.discount_value, 0) <= 0 then 0
    when ticket_row.discount_type = 'percentage'
      then least(
        current_subtotal,
        round(current_subtotal * ticket_row.discount_value / 100, 2)
      )
    else least(current_subtotal, round(coalesce(ticket_row.discount_value, 0), 2))
  end;
  current_taxable := round(current_subtotal - current_discount, 2);
  current_tax := case
    when current_taxable <= 0 or coalesce(ticket_row.tax_rate, 0) <= 0 then 0
    else round(current_taxable * ticket_row.tax_rate / 100, 2)
  end;
  current_tip := case
    when current_taxable + current_tax <= 0 or coalesce(ticket_row.tip_value, 0) <= 0 then 0
    when ticket_row.tip_type = 'percentage'
      then round((current_taxable + current_tax) * ticket_row.tip_value / 100, 2)
    else round(coalesce(ticket_row.tip_value, 0), 2)
  end;

  has_tip_change :=
    round(current_tip * 100)::integer <> round(p_tip_total * 100)::integer;
  has_manual_tip_change :=
    exists (select 1 from pg_temp.portable_ticket_staff_tip_overrides);
  should_update_ticket_tip :=
    ticket_row.tip_type <> 'fixed_amount'
    or round(coalesce(ticket_row.tip_value, 0) * 100)::integer <> round(p_tip_total * 100)::integer;
  should_refresh_unchanged_parts := has_tip_change or has_manual_tip_change;

  select
    coalesce(
      sum(
        case
          when overrides.is_manual = true then overrides.tip_amount
          when overrides.staff_id is not null then 0
          when not has_tip_change and coalesce(earnings.tip_is_manual, false) = true
            then greatest(coalesce(earnings.manual_tip_amount, earnings.tip_amount, 0), 0)
          else 0
        end
      ),
      0
    ),
    count(*) filter (
      where overrides.is_manual = true
        or (
          overrides.staff_id is null
          and not has_tip_change
          and coalesce(earnings.tip_is_manual, false) = true
        )
    )
  into effective_manual_tip_total, effective_manual_tip_count
  from pg_temp.portable_ticket_final_items final_items
  left join public.pos_ticket_staff_earnings earnings
    on earnings.salon_id = target_salon_id
   and earnings.ticket_id = p_ticket_id
   and earnings.staff_id = final_items.staff_id
  left join pg_temp.portable_ticket_staff_tip_overrides overrides
    on overrides.staff_id = final_items.staff_id;

  if round(effective_manual_tip_total * 100)::integer > round(p_tip_total * 100)::integer then
    raise exception 'Manual staff tips cannot exceed total tip.';
  end if;

  if final_staff_count > 0
    and effective_manual_tip_count = final_staff_count
    and round(effective_manual_tip_total * 100)::integer <> round(p_tip_total * 100)::integer
  then
    raise exception 'Manual staff tips must equal total tip when all staff tips are manual.';
  end if;

  if not exists (select 1 from pg_temp.portable_ticket_item_updates)
    and not exists (select 1 from pg_temp.portable_ticket_added_items)
    and not has_tip_change
    and not has_manual_tip_change
  then
    raise exception 'Make at least one correction before saving.';
  end if;

  before_snapshot := public.pos_ticket_correction_snapshot(target_salon_id, p_ticket_id);

  for update_row in
    select updates.*, current_items.service_id as current_service_id
    from pg_temp.portable_ticket_item_updates updates
    join pg_temp.portable_ticket_current_items current_items
      on current_items.id = updates.item_id
  loop
    select *
    into current_row
    from pg_temp.portable_ticket_current_items
    where id = update_row.item_id;

    if update_row.remove then
      update public.pos_ticket_items
      set
        is_removed = true,
        removal_reason = nullif(btrim(coalesce(p_reason, '')), ''),
        removed_at = now_value,
        removed_by = null
      where id = update_row.item_id
        and salon_id = target_salon_id;

      perform public.rebuild_pos_ticket_item_turn_parts_for_correction(
        target_salon_id,
        p_ticket_id,
        update_row.item_id,
        null,
        (ticket_row.opened_at at time zone target_timezone)::date,
        array[]::numeric[]
      );
    elsif update_row.service_id is distinct from update_row.current_service_id then
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
        update_row.staff_id,
        update_row.line_total,
        current_row.notes,
        p_ticket_id,
        1,
        target_salon_id,
        update_row.service_id,
        update_row.line_total
      )
      returning id into inserted_item_id;

      perform public.rebuild_pos_ticket_item_turn_parts_for_correction(
        target_salon_id,
        p_ticket_id,
        inserted_item_id,
        update_row.staff_id,
        (ticket_row.opened_at at time zone target_timezone)::date,
        update_row.parts
      );

      update public.pos_ticket_items
      set
        is_removed = true,
        removal_reason = nullif(btrim(coalesce(p_reason, '')), ''),
        removed_at = now_value,
        removed_by = null
      where id = update_row.item_id
        and salon_id = target_salon_id;

      perform public.rebuild_pos_ticket_item_turn_parts_for_correction(
        target_salon_id,
        p_ticket_id,
        update_row.item_id,
        null,
        (ticket_row.opened_at at time zone target_timezone)::date,
        array[]::numeric[]
      );

      replacement_item_ids := array_append(replacement_item_ids, inserted_item_id);
    else
      update public.pos_ticket_items
      set
        assigned_staff_id = update_row.staff_id,
        line_total = update_row.line_total,
        quantity = 1,
        unit_price = update_row.line_total
      where id = update_row.item_id
        and salon_id = target_salon_id;

      perform public.rebuild_pos_ticket_item_turn_parts_for_correction(
        target_salon_id,
        p_ticket_id,
        update_row.item_id,
        update_row.staff_id,
        (ticket_row.opened_at at time zone target_timezone)::date,
        update_row.parts
      );
    end if;
  end loop;

  if should_refresh_unchanged_parts then
    for current_row in
      select
        current_items.id,
        current_items.assigned_staff_id,
        submitted.parts,
        submitted.line_total
      from pg_temp.portable_ticket_current_items current_items
      join pg_temp.portable_ticket_item_parts submitted
        on submitted.item_id = current_items.id
      where not exists (
        select 1
        from pg_temp.portable_ticket_item_updates updates
        where updates.item_id = current_items.id
      )
    loop
      update public.pos_ticket_items
      set
        line_total = current_row.line_total,
        quantity = 1,
        unit_price = current_row.line_total
      where id = current_row.id
        and salon_id = target_salon_id;

      perform public.rebuild_pos_ticket_item_turn_parts_for_correction(
        target_salon_id,
        p_ticket_id,
        current_row.id,
        current_row.assigned_staff_id,
        (ticket_row.opened_at at time zone target_timezone)::date,
        current_row.parts
      );
    end loop;
  end if;

  for added_row in
    select *
    from pg_temp.portable_ticket_added_items
    order by row_index
  loop
    insert into public.pos_ticket_items (
      assigned_staff_id,
      line_total,
      pos_ticket_id,
      quantity,
      salon_id,
      service_id,
      unit_price
    )
    values (
      added_row.staff_id,
      added_row.line_total,
      p_ticket_id,
      1,
      target_salon_id,
      added_row.service_id,
      added_row.line_total
    )
    returning id into inserted_item_id;

    replacement_item_ids := array_append(replacement_item_ids, inserted_item_id);

    perform public.rebuild_pos_ticket_item_turn_parts_for_correction(
      target_salon_id,
      p_ticket_id,
      inserted_item_id,
      added_row.staff_id,
      (ticket_row.opened_at at time zone target_timezone)::date,
      added_row.parts
    );
  end loop;

  if should_update_ticket_tip then
    update public.pos_tickets
    set
      tip_type = 'fixed_amount',
      tip_value = round(p_tip_total, 2),
      updated_at = now_value
    where id = p_ticket_id
      and salon_id = target_salon_id;
  end if;

  if has_tip_change then
    update public.pos_ticket_staff_earnings earnings
    set
      manual_tip_amount = null,
      tip_is_manual = false
    where earnings.salon_id = target_salon_id
      and earnings.ticket_id = p_ticket_id
      and exists (
        select 1
        from pg_temp.portable_ticket_final_items final_items
        where final_items.staff_id = earnings.staff_id
      )
      and not exists (
        select 1
        from pg_temp.portable_ticket_staff_tip_overrides overrides
        where overrides.staff_id = earnings.staff_id
          and overrides.is_manual = true
      );
  end if;

  for update_row in
    select *
    from pg_temp.portable_ticket_staff_tip_overrides
  loop
    if update_row.is_manual then
      insert into public.pos_ticket_staff_earnings (
        big_turn_count,
        bonus_amount,
        calculation_version,
        commission_amount,
        deduction_amount,
        first_big_turn_sequence,
        first_small_turn_sequence,
        last_big_turn_sequence,
        last_small_turn_sequence,
        manual_tip_amount,
        salon_id,
        service_total,
        small_turn_count,
        staff_id,
        ticket_id,
        tip_amount,
        tip_is_manual,
        total_earning,
        work_date
      )
      values (
        0,
        0,
        1,
        0,
        0,
        null,
        null,
        null,
        null,
        update_row.tip_amount,
        target_salon_id,
        0,
        0,
        update_row.staff_id,
        p_ticket_id,
        update_row.tip_amount,
        true,
        update_row.tip_amount,
        (ticket_row.opened_at at time zone target_timezone)::date
      )
      on conflict (ticket_id, staff_id) do update
      set
        manual_tip_amount = excluded.manual_tip_amount,
        tip_amount = excluded.tip_amount,
        tip_is_manual = true;
    else
      update public.pos_ticket_staff_earnings earnings
      set
        manual_tip_amount = null,
        tip_is_manual = false
      where earnings.salon_id = target_salon_id
        and earnings.ticket_id = p_ticket_id
        and earnings.staff_id = update_row.staff_id;
    end if;
  end loop;

  perform public.recalculate_pos_ticket_staff_earnings_for_date(
    target_salon_id,
    (ticket_row.opened_at at time zone target_timezone)::date
  );

  after_snapshot := public.pos_ticket_correction_snapshot(target_salon_id, p_ticket_id);

  insert into public.pos_ticket_adjustments (
    action,
    after_snapshot,
    before_snapshot,
    created_by,
    reason,
    replacement_ticket_item_id,
    salon_id,
    ticket_id
  )
  values (
    'item_corrected',
    after_snapshot,
    before_snapshot,
    null,
    nullif(btrim(coalesce(p_reason, '')), ''),
    replacement_item_ids[1],
    target_salon_id,
    p_ticket_id
  );

  return jsonb_build_object(
    'ok', true,
    'ticketId', p_ticket_id,
    'workDate', (ticket_row.opened_at at time zone target_timezone)::date
  );
end;
$$;

revoke all on function public.correct_pos_portable_closed_ticket(
  uuid,
  text,
  uuid,
  jsonb,
  jsonb,
  jsonb,
  jsonb,
  numeric,
  text
) from public;
grant execute on function public.correct_pos_portable_closed_ticket(
  uuid,
  text,
  uuid,
  jsonb,
  jsonb,
  jsonb,
  jsonb,
  numeric,
  text
) to anon, authenticated;
