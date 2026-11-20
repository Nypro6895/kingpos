-- Serialize only matching salon/retry keys before reading idempotency.
-- Do not take the scheduling lock ahead of customer/ranking triggers.
-- Lock the booking row before calculating the reschedule delta.
-- Existing RPC bodies, owner, grants, search_path and data remain.
begin;
do $patch$
declare
  target regprocedure;
  definition text;
  anchor text;
  customer_block text;
  customer_start integer;
  customer_end integer;
  lookup_start integer;
  lookup_end integer;
  customer_lookup text;
begin
  target := to_regprocedure('public.create_public_booking_without_deposit(uuid,text,text,text,text,timestamptz,timestamptz,jsonb,text,text,text,uuid,text)');
  if target is null then
    raise exception 'Expected booking deposit wrapper migration before concurrency guards.';
  end if;
  definition := pg_get_functiondef(target);
  anchor := '  if p_idempotency_key is not null then';
  if position('-- booking-create-idempotency-lock' in definition) = 0 then
    if position(anchor in definition) = 0 then
      raise exception 'Create booking idempotency guard changed; review this migration.';
    end if;
    definition := replace(definition, anchor,
      anchor || chr(10) ||
      '    -- booking-create-idempotency-lock' || chr(10) ||
      '    perform pg_advisory_xact_lock(hashtextextended(''booking-idempotency:'' || p_salon_id::text || '':'' || p_idempotency_key, 0));');
    execute definition;
  end if;

  target := to_regprocedure('public.reschedule_public_booking_by_manage_token(text,timestamptz)');
  if target is null then
    raise exception 'Expected guest reschedule function before concurrency guards.';
  end if;
  definition := pg_get_functiondef(target);
  anchor := 'where customer_cancellation_token_hash = raw_token' || chr(10) || '  limit 1;';
  if position('-- booking-reschedule-row-lock' in definition) = 0 then
    if position(anchor in definition) = 0 then
      raise exception 'Guest reschedule lookup changed; review this migration.';
    end if;
    definition := replace(definition, anchor,
      'where customer_cancellation_token_hash = raw_token' || chr(10) ||
      '  limit 1 for update; -- booking-reschedule-row-lock');
    execute definition;
  end if;
  -- The existing portable flow took the salon lock before inserting a customer.
  -- Customer inserts enqueue Explore ranking under a different advisory lock.
  -- Resolve/create the customer first so both booking paths use rank -> schedule.
  -- Validation failures still roll back the entire RPC, including that customer.
  target := to_regprocedure('public.create_pos_portable_appointment_v2(uuid,text,text,text,text,uuid,uuid,timestamptz,uuid)');
  if target is null then
    raise exception 'Expected portable POS booking function before concurrency guards.';
  end if;
  definition := pg_get_functiondef(target);
  if position('-- booking-pos-customer-before-schedule-lock' in definition) = 0 then
    anchor := ' perform pg_advisory_xact_lock(hashtextextended(''booking-schedule:''||salon::text,0));';
    customer_start := position(' if p_customer_id is not null then' in definition);
    customer_end := position(' booking_status := case' in definition);
    if position(anchor in definition) = 0 or customer_start <= position(anchor in definition) or customer_end <= customer_start then
      raise exception 'Portable POS customer/schedule ordering changed; review this migration.';
    end if;
    customer_block := substring(definition from customer_start for customer_end - customer_start);
    if position('insert into customers(location_id,name,phone,email,source)' in customer_block) = 0 then
      raise exception 'Portable POS customer creation changed; review this migration.';
    end if;
    -- The removed salon lock used to serialize customer lookup too. Acquire the
    -- same rank lock the insert trigger needs, then repeat contact lookup before
    -- inserting. This preserves contact reuse without schedule -> rank inversion.
    if to_regprocedure('public.explore_rank_enqueue(uuid[])') is null or
       position('pg_advisory_xact_lock(126031,1)' in pg_get_functiondef('public.explore_rank_enqueue(uuid[])'::regprocedure)) = 0 then
      raise exception 'Explore ranking lock changed; review portable POS lock ordering.';
    end if;
    lookup_start := position('   select id into customer from customers where location_id=salon and status=''active'' and (' in customer_block);
    anchor := 'order by updated_at desc limit 1;';
    lookup_end := position(anchor in customer_block) + length(anchor);
    if lookup_start = 0 or lookup_end <= lookup_start then
      raise exception 'Portable POS contact lookup changed; review this migration.';
    end if;
    customer_lookup := substring(customer_block from lookup_start for lookup_end - lookup_start);
    anchor := ' if customer is null then' || chr(10) || '   insert into customers';
    if position(anchor in customer_block) = 0 then
      raise exception 'Portable POS customer insert changed; review this migration.';
    end if;
    customer_block := replace(customer_block, anchor,
      ' if customer is null then' || chr(10) ||
      '   perform pg_advisory_xact_lock(126031,1);' || chr(10) ||
      customer_lookup || chr(10) || ' end if;' || chr(10) || anchor);
    anchor := ' perform pg_advisory_xact_lock(hashtextextended(''booking-schedule:''||salon::text,0));';
    definition := overlay(definition placing '' from customer_start for customer_end - customer_start);
    definition := replace(definition, anchor,
      ' -- booking-pos-customer-before-schedule-lock' || chr(10) || customer_block || anchor);
    execute definition;
  end if;

end;
$patch$;
notify pgrst, 'reload schema';
commit;
