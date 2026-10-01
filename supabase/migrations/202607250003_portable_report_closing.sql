create or replace function public.get_pos_portable_report_data(
  p_key_id uuid,
  p_session_signature text,
  p_report_date date default current_date
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
  closing_cash numeric := 0;
  closing_credit_card numeric := 0;
  closing_other numeric := 0;
  closing_note text := null;
  closing_status text := 'draft';
  closing_locked_at timestamptz := null;
  current_business_date date;
  is_locked boolean := false;
  totals_row record;
  actual_total numeric := 0;
  difference_total numeric := 0;
  reconciliation_status text := 'balanced';
begin
  target_salon_id := public.pos_portable_access_salon_id(p_key_id, p_session_signature);

  if target_salon_id is null
    or not public.pos_portable_access_has_capability(
      p_key_id,
      p_session_signature,
      'portable.report.view'
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
  current_business_date := (now() at time zone target_timezone)::date;
  range_start := p_report_date::timestamp at time zone target_timezone;
  range_end := (p_report_date + 1)::timestamp at time zone target_timezone;

  select
    pos_daily_closings.cash_amount,
    pos_daily_closings.credit_card_amount,
    pos_daily_closings.other_amount,
    pos_daily_closings.note,
    pos_daily_closings.status,
    pos_daily_closings.locked_at
  into
    closing_cash,
    closing_credit_card,
    closing_other,
    closing_note,
    closing_status,
    closing_locked_at
  from public.pos_daily_closings
  where pos_daily_closings.salon_id = target_salon_id
    and pos_daily_closings.report_date = p_report_date
  limit 1;

  closing_cash := coalesce(closing_cash, 0);
  closing_credit_card := coalesce(closing_credit_card, 0);
  closing_other := coalesce(closing_other, 0);
  closing_status := coalesce(closing_status, 'draft');
  is_locked :=
    p_report_date < current_business_date
    or closing_locked_at is not null
    or closing_status in ('auto_locked', 'locked', 'approved', 'payroll_locked');

  with ticket_scope as (
    select *
    from public.pos_tickets
    where pos_tickets.salon_id = target_salon_id
      and pos_tickets.opened_at >= range_start
      and pos_tickets.opened_at < range_end
  ),
  finalized_ticket_scope as (
    select *
    from ticket_scope
    where ticket_scope.status = 'closed'
  ),
  active_items as (
    select
      pos_ticket_items.id,
      pos_ticket_items.pos_ticket_id,
      pos_ticket_items.line_total,
      coalesce(
        (
          select sum(pos_ticket_item_turn_parts.amount)
          from public.pos_ticket_item_turn_parts
          where pos_ticket_item_turn_parts.salon_id = target_salon_id
            and pos_ticket_item_turn_parts.ticket_item_id = pos_ticket_items.id
        ),
        pos_ticket_items.line_total
      ) as service_amount
    from public.pos_ticket_items
    join finalized_ticket_scope
      on finalized_ticket_scope.id = pos_ticket_items.pos_ticket_id
    where pos_ticket_items.salon_id = target_salon_id
      and coalesce(pos_ticket_items.is_removed, false) = false
  ),
  item_totals as (
    select
      active_items.pos_ticket_id,
      count(active_items.id)::integer as service_count,
      coalesce(sum(active_items.service_amount), 0)::numeric as subtotal
    from active_items
    group by active_items.pos_ticket_id
  ),
  ticket_base as (
    select
      finalized_ticket_scope.id,
      finalized_ticket_scope.discount_type,
      finalized_ticket_scope.discount_value,
      finalized_ticket_scope.tax_rate,
      finalized_ticket_scope.tip_type,
      finalized_ticket_scope.tip_value,
      coalesce(item_totals.service_count, 0)::integer as service_count,
      coalesce(item_totals.subtotal, 0)::numeric as subtotal
    from finalized_ticket_scope
    left join item_totals on item_totals.pos_ticket_id = finalized_ticket_scope.id
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
  earnings_summary as (
    select
      count(pos_ticket_staff_earnings.id)::integer as earning_count,
      coalesce(sum(pos_ticket_staff_earnings.service_total), 0)::numeric as service_total
    from public.pos_ticket_staff_earnings
    join finalized_ticket_scope
      on finalized_ticket_scope.id = pos_ticket_staff_earnings.ticket_id
    where pos_ticket_staff_earnings.salon_id = target_salon_id
      and pos_ticket_staff_earnings.work_date = p_report_date
  ),
  fallback_staff_summary as (
    select coalesce(sum(active_items.service_amount), 0)::numeric as service_total
    from active_items
  ),
  summary as (
    select
      (select count(*)::integer from ticket_scope) as ticket_count,
      (select count(*)::integer from finalized_ticket_scope) as finalized_ticket_count,
      coalesce(sum(ticket_tip.service_count), 0)::integer as service_count,
      coalesce(sum(ticket_tip.discount_amount), 0)::numeric as discounts,
      coalesce(sum(ticket_tip.tax_amount), 0)::numeric as taxes,
      coalesce(sum(ticket_tip.tip_amount), 0)::numeric as tips,
      case
        when earnings_summary.earning_count > 0 then earnings_summary.service_total
        else fallback_staff_summary.service_total
      end as staff_earned
    from ticket_tip, earnings_summary, fallback_staff_summary
  )
  select
    summary.ticket_count,
    summary.finalized_ticket_count,
    summary.service_count,
    summary.discounts,
    summary.taxes,
    summary.tips,
    summary.staff_earned,
    round(summary.staff_earned + summary.tips - summary.discounts, 2) as expected_total
  into totals_row
  from summary;

  actual_total := round(closing_cash + closing_credit_card + closing_other, 2);
  difference_total := round(actual_total - coalesce(totals_row.expected_total, 0), 2);
  reconciliation_status :=
    case
      when abs(difference_total) < 0.01 then 'balanced'
      when difference_total < 0 then 'short'
      else 'over'
    end;

  return jsonb_build_object(
    'closingInputs', jsonb_build_object(
      'cashAmount', closing_cash,
      'creditCardAmount', closing_credit_card,
      'note', closing_note,
      'otherAmount', closing_other,
      'status', closing_status
    ),
    'lock', jsonb_build_object(
      'isLocked', is_locked,
      'status', closing_status
    ),
    'salonName', target_salon_name,
    'timezone', target_timezone,
    'totals', jsonb_build_object(
      'actualTotal', actual_total,
      'discounts', coalesce(totals_row.discounts, 0),
      'difference', difference_total,
      'expectedTotal', coalesce(totals_row.expected_total, 0),
      'finalizedTicketCount', coalesce(totals_row.finalized_ticket_count, 0),
      'reconciliationStatus', reconciliation_status,
      'serviceCount', coalesce(totals_row.service_count, 0),
      'taxes', coalesce(totals_row.taxes, 0),
      'ticketCount', coalesce(totals_row.ticket_count, 0),
      'tips', coalesce(totals_row.tips, 0)
    )
  );
end;
$$;

create or replace function public.save_pos_portable_report_closing(
  p_key_id uuid,
  p_session_signature text,
  p_report_date date,
  p_cash_amount numeric,
  p_credit_card_amount numeric,
  p_other_amount numeric,
  p_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  target_salon_id uuid;
  target_timezone text;
  current_business_date date;
  existing_id uuid;
  existing_status text := 'draft';
  existing_locked_at timestamptz := null;
  saved_id uuid;
begin
  target_salon_id := public.pos_portable_access_salon_id(p_key_id, p_session_signature);

  if target_salon_id is null
    or not public.pos_portable_access_has_capability(
      p_key_id,
      p_session_signature,
      'portable.report.view'
    )
  then
    return null;
  end if;

  if p_report_date is null then
    raise exception 'Report date is required.';
  end if;

  if coalesce(p_cash_amount, 0) < 0
    or coalesce(p_credit_card_amount, 0) < 0
    or coalesce(p_other_amount, 0) < 0
  then
    raise exception 'Amounts must be valid non-negative currency values.';
  end if;

  select coalesce(booking_settings.timezone_iana, 'America/Chicago')
  into target_timezone
  from public.booking_settings
  where booking_settings.salon_id = target_salon_id
  limit 1;

  target_timezone := coalesce(target_timezone, 'America/Chicago');
  current_business_date := (now() at time zone target_timezone)::date;

  select
    pos_daily_closings.id,
    pos_daily_closings.status,
    pos_daily_closings.locked_at
  into existing_id, existing_status, existing_locked_at
  from public.pos_daily_closings
  where pos_daily_closings.salon_id = target_salon_id
    and pos_daily_closings.report_date = p_report_date
  limit 1;

  existing_status := coalesce(existing_status, 'draft');

  if p_report_date < current_business_date
    or existing_locked_at is not null
    or existing_status in ('auto_locked', 'locked', 'approved', 'payroll_locked')
  then
    raise exception 'This business date is locked.';
  end if;

  insert into public.pos_daily_closings (
    cash_amount,
    credit_card_amount,
    note,
    other_amount,
    report_date,
    salon_id,
    status
  )
  values (
    round(coalesce(p_cash_amount, 0), 2),
    round(coalesce(p_credit_card_amount, 0), 2),
    nullif(btrim(coalesce(p_note, '')), ''),
    round(coalesce(p_other_amount, 0), 2),
    p_report_date,
    target_salon_id,
    'draft'
  )
  on conflict (salon_id, report_date)
  do update set
    cash_amount = excluded.cash_amount,
    credit_card_amount = excluded.credit_card_amount,
    note = excluded.note,
    other_amount = excluded.other_amount,
    updated_by = null
  where public.pos_daily_closings.locked_at is null
    and public.pos_daily_closings.status not in ('auto_locked', 'locked', 'approved', 'payroll_locked')
  returning id into saved_id;

  if saved_id is null then
    raise exception 'This business date is locked.';
  end if;

  return public.get_pos_portable_report_data(
    p_key_id,
    p_session_signature,
    p_report_date
  );
end;
$$;

grant execute on function public.get_pos_portable_report_data(uuid, text, date) to anon, authenticated;
grant execute on function public.save_pos_portable_report_closing(uuid, text, date, numeric, numeric, numeric, text) to anon, authenticated;
