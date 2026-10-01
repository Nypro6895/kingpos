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

  target_timezone := coalesce(target_timezone, 'America/Chicago');
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
  item_totals as (
    select
      pos_ticket_items.pos_ticket_id,
      count(pos_ticket_items.id)::integer as service_count,
      coalesce(sum(pos_ticket_items.line_total), 0)::numeric as subtotal
    from public.pos_ticket_items
    join ticket_scope on ticket_scope.id = pos_ticket_items.pos_ticket_id
    where pos_ticket_items.salon_id = target_salon_id
      and coalesce(pos_ticket_items.is_removed, false) = false
    group by pos_ticket_items.pos_ticket_id
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
  ticket_base as (
    select
      ticket_scope.*,
      coalesce(item_totals.service_count, 0)::integer as service_count,
      coalesce(item_totals.subtotal, 0)::numeric as subtotal,
      coalesce(payment_totals.paid, 0)::numeric as paid
    from ticket_scope
    left join item_totals on item_totals.pos_ticket_id = ticket_scope.id
    left join payment_totals on payment_totals.ticket_id = ticket_scope.id
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

grant execute on function public.get_pos_portable_ticket_data(uuid, text, date) to anon, authenticated;
