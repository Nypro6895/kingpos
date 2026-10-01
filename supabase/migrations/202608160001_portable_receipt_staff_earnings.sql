-- Populate payroll staff-earning source rows for Portable POS receipts.

create or replace function public.insert_missing_pos_ticket_staff_earnings_for_ticket(
  p_ticket_id uuid
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  inserted_count integer := 0;
begin
  if p_ticket_id is null then
    return 0;
  end if;

  with ticket_scope as (
    select tickets.*
    from public.pos_tickets as tickets
    where tickets.id = p_ticket_id
      and tickets.status = 'closed'
  ),
  active_items as (
    select
      tickets.id as ticket_id,
      tickets.salon_id,
      tickets.opened_at,
      items.id as ticket_item_id,
      items.assigned_staff_id,
      coalesce(items.quantity, 1) as quantity,
      items.unit_price,
      items.line_total
    from ticket_scope as tickets
    join public.pos_ticket_items as items
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
    from public.pos_ticket_item_turn_parts as turn_parts
    join active_items as items
      on items.ticket_item_id = turn_parts.ticket_item_id
     and items.salon_id = turn_parts.salon_id
    group by turn_parts.ticket_item_id, turn_parts.salon_id
  ),
  item_service as (
    select
      items.ticket_id,
      items.salon_id,
      items.opened_at,
      items.ticket_item_id,
      items.assigned_staff_id,
      coalesce(turn_totals.work_date, items.opened_at::date) as work_date,
      case
        when turn_totals.ticket_item_id is not null
          then round(coalesce(turn_totals.service_amount, 0), 2)
        else round(coalesce(items.line_total, 0), 2)
      end as service_amount
    from active_items as items
    left join turn_part_totals as turn_totals
      on turn_totals.ticket_item_id = items.ticket_item_id
     and turn_totals.salon_id = items.salon_id
  ),
  turn_rows as (
    select
      items.ticket_id,
      items.salon_id,
      items.assigned_staff_id as staff_id,
      coalesce(turn_parts.turn_type, case when turn_parts.amount >= 25 then 'large' else 'small' end) as turn_type,
      coalesce(turn_parts.work_date, items.opened_at::date) as work_date
    from active_items as items
    join public.pos_ticket_item_turn_parts as turn_parts
      on turn_parts.ticket_item_id = items.ticket_item_id
     and turn_parts.salon_id = items.salon_id
    where items.assigned_staff_id is not null

    union all

    select
      items.ticket_id,
      items.salon_id,
      items.assigned_staff_id as staff_id,
      case
        when (
          case
            when coalesce(items.unit_price, 0) > 0 then items.unit_price
            else coalesce(items.line_total, 0)
                 / greatest(1, round(coalesce(items.quantity, 1))::integer)
          end
        ) >= 25 then 'large'
        else 'small'
      end as turn_type,
      items.opened_at::date as work_date
    from active_items as items
    left join turn_part_totals as turn_totals
      on turn_totals.ticket_item_id = items.ticket_item_id
     and turn_totals.salon_id = items.salon_id
    cross join lateral generate_series(
      1,
      greatest(1, round(coalesce(items.quantity, 1))::integer)
    ) as generated_turns(turn_number)
    where items.assigned_staff_id is not null
      and turn_totals.ticket_item_id is null
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
    from ticket_scope as tickets
    left join ticket_subtotals as subtotals
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
      min(item_service.work_date) as work_date,
      coalesce(sum(round(item_service.service_amount * 100)::integer), 0) as service_cents
    from item_service
    where item_service.assigned_staff_id is not null
    group by item_service.ticket_id, item_service.salon_id, item_service.assigned_staff_id
    having coalesce(sum(round(item_service.service_amount * 100)::integer), 0) > 0
  ),
  staff_turn_counts as (
    select
      turn_rows.ticket_id,
      turn_rows.salon_id,
      turn_rows.staff_id,
      count(*) filter (where turn_rows.turn_type = 'large')::integer as big_turn_count,
      count(*) filter (where turn_rows.turn_type = 'small')::integer as small_turn_count
    from turn_rows
    group by turn_rows.ticket_id, turn_rows.salon_id, turn_rows.staff_id
  ),
  staff_rows as (
    select
      staff_service.*,
      coalesce(staff_turn_counts.big_turn_count, 0) as big_turn_count,
      coalesce(staff_turn_counts.small_turn_count, 0) as small_turn_count,
      coalesce(ticket_tips.tip_cents, 0) as tip_cents,
      sum(staff_service.service_cents) over (partition by staff_service.ticket_id) as total_service_cents,
      row_number() over (
        partition by staff_service.ticket_id
        order by staff_service.service_cents desc, staff_service.staff_id
      ) as remainder_rank
    from staff_service
    left join staff_turn_counts
      on staff_turn_counts.ticket_id = staff_service.ticket_id
     and staff_turn_counts.salon_id = staff_service.salon_id
     and staff_turn_counts.staff_id = staff_service.staff_id
    left join ticket_tips
      on ticket_tips.ticket_id = staff_service.ticket_id
  ),
  allocated_rows as (
    select
      staff_rows.*,
      case
        when staff_rows.total_service_cents <= 0 or staff_rows.tip_cents <= 0 then 0
        else round(
          (staff_rows.tip_cents::numeric * staff_rows.service_cents::numeric)
          / staff_rows.total_service_cents::numeric
        )::integer
      end as allocated_tip_cents
    from staff_rows
  ),
  final_rows as (
    select
      allocated_rows.*,
      allocated_rows.allocated_tip_cents
        + case
            when allocated_rows.remainder_rank = 1 then
              allocated_rows.tip_cents
              - sum(allocated_rows.allocated_tip_cents)
                over (partition by allocated_rows.ticket_id)
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
      round(final_rows.final_tip_cents::numeric / 100, 2),
      false,
      null,
      final_rows.big_turn_count,
      final_rows.small_turn_count,
      case when final_rows.big_turn_count > 0 then 1 else null end,
      case when final_rows.big_turn_count > 0 then final_rows.big_turn_count else null end,
      case when final_rows.small_turn_count > 0 then 1 else null end,
      case when final_rows.small_turn_count > 0 then final_rows.small_turn_count else null end,
      0,
      0,
      0,
      round((final_rows.service_cents + final_rows.final_tip_cents)::numeric / 100, 2),
      1
    from final_rows
    on conflict (ticket_id, staff_id) do nothing
    returning 1
  )
  select count(*)::integer
  into inserted_count
  from inserted;

  return inserted_count;
end;
$$;

revoke all on function public.insert_missing_pos_ticket_staff_earnings_for_ticket(uuid) from public;
revoke all on function public.insert_missing_pos_ticket_staff_earnings_for_ticket(uuid) from anon;
revoke all on function public.insert_missing_pos_ticket_staff_earnings_for_ticket(uuid) from authenticated;

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
  preferred_visit_id_text text;
  service_id_text text;
  service_uuid uuid;
  staff_uuid uuid;
  subtotal numeric := 0;
  target_salon_id uuid;
  ticket_item_id uuid;
  ticket_row public.pos_tickets%rowtype;
  tip_amount numeric;
  visit_result jsonb;
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
  preferred_visit_id_text := nullif(btrim(coalesce(p_receipt ->> 'customerVisitId', '')), '');

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
        public.normalize_customer_claim_phone(customers.phone) = public.normalize_customer_claim_phone(customer_lookup)
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
        when customer_lookup is not null and customer_lookup not like '%@%' then public.normalize_customer_claim_phone(customer_lookup)
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

  perform public.insert_missing_pos_ticket_staff_earnings_for_ticket(ticket_row.id);

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

  visit_result := public.complete_customer_visit_for_ticket_core(
    target_salon_id,
    customer_row.id,
    ticket_row.id,
    case when preferred_visit_id_text is null then null else preferred_visit_id_text::uuid end
  );

  if coalesce((visit_result ->> 'ok')::boolean, false) is false then
    raise exception 'Unable to complete customer visit.';
  end if;

  return jsonb_build_object(
    'ok', true,
    'salonId', target_salon_id,
    'ticketId', ticket_row.id,
    'ticketNumber', ticket_row.ticket_number,
    'workDate', p_work_date
  );
end;
$$;

grant execute on function public.submit_pos_portable_receipt(uuid, text, jsonb, date) to anon, authenticated;

do $$
declare
  backfilled_rows integer := 0;
begin
  with candidates as (
    select tickets.id
    from public.pos_tickets as tickets
    where tickets.status = 'closed'
      and exists (
        select 1
        from public.pos_payments as payments
        where payments.ticket_id = tickets.id
          and payments.salon_id = tickets.salon_id
          and payments.amount > 0
      )
      and exists (
        select 1
        from public.pos_ticket_items as items
        where items.pos_ticket_id = tickets.id
          and items.salon_id = tickets.salon_id
          and items.assigned_staff_id is not null
          and coalesce(items.is_removed, false) = false
      )
      and not exists (
        select 1
        from public.pos_ticket_staff_earnings as earnings
        where earnings.ticket_id = tickets.id
      )
  )
  select coalesce(sum(public.insert_missing_pos_ticket_staff_earnings_for_ticket(candidates.id)), 0)
  into backfilled_rows
  from candidates;

  raise notice 'Backfilled % missing POS ticket staff earning rows.', backfilled_rows;
end;
$$;
