begin;
-- Invoker retains customer RLS; the canonical creator retains all scheduling
-- triggers and manager authorization. An exception rolls back every write.
create function public.create_owner_booking_atomic(
 p_booking jsonb, p_customer jsonb,
 p_source_reference_type text default null, p_source_reference_id text default null
) returns jsonb language plpgsql security invoker set search_path=public,pg_temp as $$
declare salon uuid := (p_booking->>'p_salon_id')::uuid;
 actor uuid := current_public_user_id();
 customer_id uuid := nullif(p_customer->>'id','')::uuid;
 customer_user uuid := nullif(p_customer->>'user_id','')::uuid;
 selected customers%rowtype; identity_result jsonb; booking_id uuid;
begin
 if actor is null or not user_has_salon_permission(salon,array['booking.manage']::text[]) then
  raise exception 'Missing required permission: booking.manage' using errcode='42501';
 end if;
 perform pg_advisory_xact_lock(hashtextextended('customer-identity:'||salon::text,0));
 if customer_id is null then
  identity_result := create_booking_customer_identity(salon,p_customer->>'name',p_customer->>'phone',
   p_customer->>'email',customer_user,actor,
   case when customer_user is not null then 'account_link' when p_booking->>'p_source'='pos' then 'pos' else 'owner_booking' end);
  customer_id := (identity_result->'customer'->>'id')::uuid;
 end if;
 select * into selected from customers where id=customer_id and location_id=salon for update;
 if selected.id is null then raise exception 'Customer must belong to this salon.' using errcode='P0001'; end if;
 if customer_user is not null then
  if selected.customer_user_id is not null and selected.customer_user_id<>customer_user then
   raise exception 'Matched customer is already linked to another account.' using errcode='P0001';
  end if;
  if not exists(select 1 from users where id=customer_user and status<>'deleted') then
   raise exception 'Customer account was not found.' using errcode='P0001';
  end if;
  update customers set customer_user_id=customer_user,updated_by_user_id=actor
   where id=customer_id and customer_user_id is null;
 end if;
 booking_id := create_canonical_booking(
  p_actor_source=>'manager',p_confirmation_mode=>p_booking->>'p_confirmation_mode',
  p_confirmation_status=>p_booking->>'p_confirmation_status',p_customer_id=>customer_id,
  p_customer_user_id=>customer_user,p_end_at=>(p_booking->>'p_end_at')::timestamptz,
  p_idempotency_key=>p_booking->>'p_idempotency_key',p_internal_notes=>p_booking->>'p_internal_notes',
  p_lines=>p_booking->'p_lines',p_overbooking_override_reason=>p_booking->>'p_overbooking_override_reason',
  p_public_notes=>p_booking->>'p_public_notes',p_salon_id=>salon,p_source=>p_booking->>'p_source',
  p_start_at=>(p_booking->>'p_start_at')::timestamptz,p_status=>p_booking->>'p_status');
 if p_source_reference_type is not null or p_source_reference_id is not null then
  update bookings set source_reference_type=p_source_reference_type,source_reference_id=p_source_reference_id,
   updated_by_user_id=actor where id=booking_id and salon_id=salon;
 end if;
 return jsonb_build_object('booking_id',booking_id,'customer_id',customer_id);
end $$;
revoke all on function public.create_owner_booking_atomic(jsonb,jsonb,text,text) from public,anon;
grant execute on function public.create_owner_booking_atomic(jsonb,jsonb,text,text) to authenticated;
commit;
