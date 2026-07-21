-- Phase 5 customer CRM metrics and booking-origin customer source tagging.
-- Additive repair after the booking-to-ticket foundation.

create or replace function public.link_customer_user_from_booking()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.customers
  set customer_user_id = case
        when new.customer_user_id is not null
          and (customer_user_id is null or customer_user_id = new.customer_user_id)
        then new.customer_user_id
        else customer_user_id
      end,
      source = case
        when source <> 'manual' then source
        when new.customer_user_id is not null then 'account_link'
        when new.source in ('public_profile', 'explore') then 'public_booking'
        when new.source = 'pos' then 'pos'
        else 'owner_booking'
      end,
      updated_by_user_id = coalesce(new.updated_by_user_id, new.created_by_user_id, updated_by_user_id),
      updated_at = now()
  where id = new.customer_id
    and location_id = new.salon_id
    and (
      new.customer_user_id is null
      or customer_user_id is null
      or customer_user_id = new.customer_user_id
    );

  return new;
end;
$$;

create or replace function public.get_customer_crm_metrics(
  p_salon_id uuid,
  p_customer_ids uuid[]
)
returns table (
  customer_id uuid,
  appointment_count integer,
  upcoming_booking_id uuid,
  upcoming_start_at timestamptz,
  last_visit_at timestamptz,
  completed_count integer,
  cancelled_count integer,
  no_show_count integer,
  active_pos_ticket_count integer,
  finalized_pos_ticket_count integer,
  finalized_spend numeric
)
language sql
stable
security definer
set search_path = public
as $$
  with salon_scope as (
    select locations.id as salon_id, locations.organization_id
    from public.locations
    where locations.id = p_salon_id
      and public.user_has_organization_permission(
        locations.organization_id,
        array['customers.view']::text[]
      )
  ),
  target_customers as (
    select distinct unnest(coalesce(p_customer_ids, array[]::uuid[])) as customer_id
  ),
  booking_stats as (
    select
      bookings.customer_id,
      count(*)::integer as appointment_count,
      max(bookings.start_at) filter (
        where public.normalize_booking_status(bookings.status) = 'completed'
           or (
            bookings.start_at < now()
            and public.normalize_booking_status(bookings.status) not in ('cancelled', 'no_show')
          )
      ) as last_visit_at,
      count(*) filter (
        where public.normalize_booking_status(bookings.status) = 'completed'
      )::integer as completed_count,
      count(*) filter (
        where public.normalize_booking_status(bookings.status) = 'cancelled'
      )::integer as cancelled_count,
      count(*) filter (
        where public.normalize_booking_status(bookings.status) = 'no_show'
      )::integer as no_show_count
    from public.bookings
    join salon_scope
      on salon_scope.salon_id = bookings.salon_id
    join target_customers
      on target_customers.customer_id = bookings.customer_id
    group by bookings.customer_id
  ),
  upcoming as (
    select distinct on (bookings.customer_id)
      bookings.customer_id,
      bookings.id as upcoming_booking_id,
      bookings.start_at as upcoming_start_at
    from public.bookings
    join salon_scope
      on salon_scope.salon_id = bookings.salon_id
    join target_customers
      on target_customers.customer_id = bookings.customer_id
    where bookings.start_at >= now()
      and public.normalize_booking_status(bookings.status) not in ('completed', 'cancelled', 'no_show')
    order by bookings.customer_id, bookings.start_at asc, bookings.id
  ),
  item_totals as (
    select
      pos_ticket_items.pos_ticket_id,
      sum(coalesce(pos_ticket_items.line_total, pos_ticket_items.unit_price * pos_ticket_items.quantity, 0)) as subtotal
    from public.pos_ticket_items
    join public.pos_tickets
      on pos_tickets.id = pos_ticket_items.pos_ticket_id
    join salon_scope
      on salon_scope.salon_id = pos_ticket_items.salon_id
    join target_customers
      on target_customers.customer_id = pos_tickets.customer_id
    where coalesce(pos_ticket_items.is_removed, false) = false
    group by pos_ticket_items.pos_ticket_id
  ),
  ticket_totals as (
    select
      pos_tickets.customer_id,
      pos_tickets.status,
      coalesce(item_totals.subtotal, 0) as subtotal,
      least(
        coalesce(item_totals.subtotal, 0),
        case
          when pos_tickets.discount_type = 'percentage'
          then round((coalesce(item_totals.subtotal, 0) * pos_tickets.discount_value) / 100, 2)
          else pos_tickets.discount_value
        end
      ) as discount_amount,
      pos_tickets.tax_rate,
      pos_tickets.tip_type,
      pos_tickets.tip_value
    from public.pos_tickets
    join salon_scope
      on salon_scope.salon_id = pos_tickets.salon_id
    join target_customers
      on target_customers.customer_id = pos_tickets.customer_id
    left join item_totals
      on item_totals.pos_ticket_id = pos_tickets.id
    where pos_tickets.status <> 'voided'
  ),
  ticket_rollup as (
    select
      ticket_totals.customer_id,
      count(*) filter (
        where ticket_totals.status in ('open', 'cancelled')
      )::integer as active_pos_ticket_count,
      count(*) filter (
        where ticket_totals.status = 'closed'
      )::integer as finalized_pos_ticket_count,
      coalesce(sum(
        case
          when ticket_totals.status <> 'closed' then 0
          else
            (
              with calculated as (
                select
                  greatest(ticket_totals.subtotal - ticket_totals.discount_amount, 0) as taxable_amount
              )
              select
                round(
                  calculated.taxable_amount
                  + case
                      when ticket_totals.tax_rate > 0
                      then round((calculated.taxable_amount * ticket_totals.tax_rate) / 100, 2)
                      else 0
                    end
                  + case
                      when ticket_totals.tip_type = 'percentage'
                      then round(
                        (
                          calculated.taxable_amount
                          + case
                              when ticket_totals.tax_rate > 0
                              then round((calculated.taxable_amount * ticket_totals.tax_rate) / 100, 2)
                              else 0
                            end
                        ) * ticket_totals.tip_value / 100,
                        2
                      )
                      else ticket_totals.tip_value
                    end,
                  2
                )
              from calculated
            )
        end
      ), 0) as finalized_spend
    from ticket_totals
    group by ticket_totals.customer_id
  )
  select
    target_customers.customer_id,
    coalesce(booking_stats.appointment_count, 0) as appointment_count,
    upcoming.upcoming_booking_id,
    upcoming.upcoming_start_at,
    booking_stats.last_visit_at,
    coalesce(booking_stats.completed_count, 0) as completed_count,
    coalesce(booking_stats.cancelled_count, 0) as cancelled_count,
    coalesce(booking_stats.no_show_count, 0) as no_show_count,
    coalesce(ticket_rollup.active_pos_ticket_count, 0) as active_pos_ticket_count,
    coalesce(ticket_rollup.finalized_pos_ticket_count, 0) as finalized_pos_ticket_count,
    coalesce(ticket_rollup.finalized_spend, 0) as finalized_spend
  from target_customers
  left join booking_stats
    on booking_stats.customer_id = target_customers.customer_id
  left join upcoming
    on upcoming.customer_id = target_customers.customer_id
  left join ticket_rollup
    on ticket_rollup.customer_id = target_customers.customer_id
$$;

revoke all on function public.get_customer_crm_metrics(uuid, uuid[]) from public, anon;
grant execute on function public.get_customer_crm_metrics(uuid, uuid[]) to authenticated;
