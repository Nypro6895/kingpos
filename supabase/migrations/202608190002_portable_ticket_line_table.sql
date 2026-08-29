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

  select coalesce(booking_settings.timezone_iana, 'America/Chicago')
  into target_timezone
  from public.booking_settings
  where booking_settings.salon_id = target_salon_id
  limit 1;

  select coalesce(pos_settings.large_turn_threshold, 25)
  into large_turn_threshold
  from public.pos_settings
  where pos_settings.salon_id = target_salon_id
  limit 1;

  target_timezone := coalesce(target_timezone, 'America/Chicago');
  large_turn_threshold := coalesce(large_turn_threshold, 25);
  range_start := p_date::timestamp at time zone target_timezone;
  range_end := (p_date + 1)::timestamp at time zone target_timezone;

  with ticket_scope as (
    select
      pos_tickets.*,
      customers.name as customer_name,
      customers.phone as customer_phone
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
  item_totals as (
    select
      item_scope.pos_ticket_id,
      count(item_scope.id)::integer as service_count,
      coalesce(sum(item_scope.line_total), 0)::numeric as subtotal
    from item_scope
    group by item_scope.pos_ticket_id
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
            'turnIndex', item_part_rows.turn_index,
            'turnType',
              case
                when item_part_rows.turn_type = 'large'
                  or item_part_rows.amount >= large_turn_threshold
                  then 'large'
                else 'small'
              end
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
          'id', item_scope.id,
          'lineTotal', coalesce(item_part_summary.part_total, item_scope.line_total, 0),
          'runningTurnBig', item_running_turns.running_turn_big,
          'runningTurnSmall', item_running_turns.running_turn_small,
          'serviceName',
            coalesce(
              nullif(item_scope.service_name, ''),
              nullif(item_scope.service_name_snapshot, ''),
              'Service'
            ),
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
  ticket_base as (
    select
      ticket_scope.*,
      coalesce(item_totals.service_count, 0)::integer as service_count,
      coalesce(item_totals.subtotal, 0)::numeric as subtotal,
      coalesce(payment_totals.paid, 0)::numeric as paid,
      coalesce(item_lines.items, '[]'::jsonb) as items
    from ticket_scope
    left join item_totals on item_totals.pos_ticket_id = ticket_scope.id
    left join payment_totals on payment_totals.ticket_id = ticket_scope.id
    left join item_lines on item_lines.pos_ticket_id = ticket_scope.id
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
        'closedAt', ticket_calculations.closed_at,
        'customerName', ticket_calculations.customer_name,
        'customerPhone', ticket_calculations.customer_phone,
        'discountAmount', ticket_calculations.discount_amount,
        'id', ticket_calculations.id,
        'items', ticket_calculations.items,
        'openedAt', ticket_calculations.opened_at,
        'paid', ticket_calculations.paid,
        'remaining', round(ticket_calculations.total_amount - ticket_calculations.paid, 2),
        'serviceCount', ticket_calculations.service_count,
        'status', ticket_calculations.status,
        'subtotal', ticket_calculations.subtotal,
        'taxAmount', ticket_calculations.tax_amount,
        'ticketNumber', ticket_calculations.ticket_number,
        'ticketSequence', ticket_calculations.ticket_sequence,
        'tipAmount', ticket_calculations.tip_amount,
        'total', ticket_calculations.total_amount
      )
      order by ticket_calculations.opened_at desc
    ),
    '[]'::jsonb
  )
  into tickets_json
  from ticket_calculations;

  return jsonb_build_object(
    'salonName', target_salon_name,
    'tickets', tickets_json,
    'timezone', target_timezone
  );
end;
$$;

revoke all on function public.get_pos_portable_ticket_data(uuid, text, date) from public;
grant execute on function public.get_pos_portable_ticket_data(uuid, text, date) to anon, authenticated;
