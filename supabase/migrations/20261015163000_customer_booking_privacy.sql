-- Customer data uses an explicit projection. RLS on the private base rows must
-- not expose internal notes or capabilities to a customer who owns a booking.
-- Employee policies and mutation RPC authorization remain unchanged.
create or replace function public.current_user_owns_booking(p_booking_id uuid, p_salon_id uuid)
returns boolean language sql stable security definer set search_path = public
as $$
  select exists(select 1 from public.bookings b where b.id=p_booking_id
    and b.salon_id=p_salon_id and b.customer_user_id=public.current_public_user_id())
$$;
revoke all on function public.current_user_owns_booking(uuid,uuid) from public,anon;
grant execute on function public.current_user_owns_booking(uuid,uuid) to authenticated;

create or replace function public.get_customer_booking_rows(
  p_booking_id uuid default null, p_scope text default 'upcoming',
  p_cursor_start_at timestamptz default null, p_limit integer default 20
)
returns setof jsonb language plpgsql stable security definer set search_path = public
as $$
declare actor_id uuid := public.current_public_user_id();
begin
  if actor_id is null then raise exception 'Sign in required' using errcode='42501'; end if;
  if p_scope is null or p_scope not in ('upcoming','past','cancelled') then
    raise exception 'Invalid booking scope' using errcode='22023';
  end if;
  return query
  select to_jsonb(safe_booking) || jsonb_build_object(
    'deposit_policy_snapshot', jsonb_build_object('test',b.deposit_policy_snapshot->'test','amount_cents',b.deposit_policy_snapshot->'amount_cents','currency',b.deposit_policy_snapshot->'currency','total_cents',b.deposit_policy_snapshot->'total_cents','mode',b.deposit_policy_snapshot->'mode'),
    'customer', (select to_jsonb(contact) from (select c.id,c.name,c.phone,c.email
      from public.customers c where c.id=b.customer_id and c.location_id=b.salon_id) contact),
    'salon', (select to_jsonb(salon) from (select l.id, l.name, l.phone, l.address_line1, l.address_line2, l.city, l.state, l.postal_code, l.country, l.latitude, l.longitude
      from public.locations l where l.id=b.salon_id) salon),
    'lines', (select coalesce(jsonb_agg(to_jsonb(line) order by line.display_order,line.created_at,line.id),'[]'::jsonb)
      from (select bl.id, bl.salon_id, bl.booking_id, bl.parent_booking_line_id, bl.line_type, bl.service_id, bl.service_name_snapshot, bl.service_category_snapshot, bl.service_description_snapshot, bl.unit_price, bl.quantity, bl.line_total, bl.duration_minutes, bl.cleanup_buffer_minutes, bl.display_order, bl.assigned_staff_id, bl.scheduled_start_at, bl.scheduled_end_at, bl.line_status, bl.started_at, bl.completed_at, bl.service_note, bl.created_at, bl.updated_at
        from public.booking_lines bl where bl.booking_id=b.id and bl.salon_id=b.salon_id) line)
  )
  from public.bookings b
  cross join lateral (select b.id, b.salon_id, b.customer_id, b.staff_id, b.start_at, b.end_at, b.public_notes, b.status, b.source, b.confirmation_mode, b.confirmation_status, b.salon_timezone_snapshot, b.cancellation_reason, b.cancelled_at, b.no_show_at, b.no_show_reason, b.no_show_kind, b.payment_status, b.deposit_paid_cents, b.deposit_refunded_cents, b.deposit_receipt_url, b.created_at, b.updated_at) safe_booking
  where b.customer_user_id=actor_id
    and (p_booking_id is null or b.id=p_booking_id)
    and (p_booking_id is not null
      or (p_scope='cancelled' and b.status='cancelled')
      or (p_scope='upcoming' and b.start_at>=coalesce(p_cursor_start_at,now()) and b.status not in ('cancelled','no_show','completed'))
      or (p_scope='past' and b.start_at<coalesce(p_cursor_start_at,now()) and b.status<>'cancelled'))
  order by
    case when p_scope='upcoming' then b.start_at end asc,
    case when p_scope<>'upcoming' then b.start_at end desc,
    case when p_scope='upcoming' then b.id end asc,
    case when p_scope<>'upcoming' then b.id end desc
  limit least(greatest(coalesce(p_limit,20),1),50);
end;
$$;
revoke all on function public.get_customer_booking_rows(uuid,text,timestamptz,integer) from public,anon;
grant execute on function public.get_customer_booking_rows(uuid,text,timestamptz,integer) to authenticated;

-- The Beauty page previously counted its own confirmed bookings from the base
-- table. Preserve that count without returning any private booking fields.
create or replace function public.get_customer_verified_booking_counts(p_salon_ids uuid[])
returns table(salon_id uuid, booking_count bigint)
language sql stable security definer set search_path = public
as $$
  select b.salon_id,count(*) from public.bookings b
  where b.customer_user_id=public.current_public_user_id()
    and b.salon_id=any(p_salon_ids) and b.confirmation_status='confirmed'
    and b.status in ('confirmed','checked_in','in_service','completed')
  group by b.salon_id
$$;
revoke all on function public.get_customer_verified_booking_counts(uuid[]) from public,anon;
grant execute on function public.get_customer_verified_booking_counts(uuid[]) to authenticated;

drop policy if exists salon_member_read_bookings on public.bookings;
create policy salon_member_read_bookings on public.bookings for select to authenticated
using (public.user_can_manage_salon(salon_id) or public.current_user_has_booking_assignment(id,salon_id));

drop policy if exists booking_participant_read_booking_lines on public.booking_lines;
create policy booking_participant_read_booking_lines on public.booking_lines for select to authenticated
using (public.user_can_manage_salon(salon_id)
  or (assigned_staff_id is not null and assigned_staff_id=public.current_user_staff_id_for_salon(salon_id)));

drop policy if exists salon_member_read_customers on public.customers;
create policy salon_member_read_customers on public.customers for select to authenticated
using (public.user_can_manage_salon(location_id));

-- These existing customer reads depended on the old base-table SELECT policy.
-- The ownership helper preserves the same access without exposing private rows.
drop policy if exists booking_inspiration_customer_or_manager_read on public.booking_inspirations;
create policy booking_inspiration_customer_or_manager_read on public.booking_inspirations for select to authenticated
using (public.user_has_salon_permission(salon_id,array['booking.view','booking.manage'])
  or public.current_user_owns_booking(booking_id,salon_id));

drop policy if exists history_links_read on public.customer_history_links;
create policy history_links_read on public.customer_history_links for select to authenticated
using (public.current_user_owns_booking(booking_id,salon_id)
  or exists(select 1 from public.bookings b where b.id=booking_id and b.salon_id=customer_history_links.salon_id
    and public.user_has_salon_permission(b.salon_id,array['booking.view'])));
