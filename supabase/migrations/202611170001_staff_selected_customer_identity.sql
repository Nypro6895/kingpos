begin;

-- A selected customer is validated before the existing phone resolver can
-- refresh its profile name or merge its ID. Keep all scheduling/identity policy
-- in the installed command; do not rewrite customer data during this upgrade.
do $migration$
declare
  definition text;
  anchor text;
begin
  definition := replace(pg_get_functiondef('public.create_staff_appointment(uuid,jsonb)'::regprocedure), chr(13), '');
  if position('-- staff-selected-customer-identity-v1' in definition) > 0 then return; end if;

  anchor := $old$note text:=nullif(btrim(p_input->>'note'),''); key text:=p_input->>'key'; mode text; state text;$old$;
  if length(definition)-length(replace(definition,anchor,'')) <> length(anchor) then
    raise exception 'Review Staff appointment declarations before selected-customer identity upgrade';
  end if;
  definition := replace(definition, anchor, anchor || E'\n  selected_customer_snapshot customers%rowtype; canonical_customer_id uuid;');

  anchor := $old$perform public.canonical_customer_for_phone(p_salon,p_input->>'phone');$old$;
  if length(definition)-length(replace(definition,anchor,'')) <> length(anchor) then
    raise exception 'Review Staff appointment phone identity lock before upgrade';
  end if;
  definition := replace(definition, anchor, $new$-- staff-selected-customer-identity-v1
  -- Same key/order as canonical_customer_for_phone and every identity writer.
  perform pg_advisory_xact_lock(hashtextextended('customer-identity:'||p_salon::text,0));$new$);

  anchor := $old$if booking is not null then return jsonb_build_object('ok',true,'bookingId',booking,'assignedToSelf',target=own_staff); end if;$old$;
  if length(definition)-length(replace(definition,anchor,'')) <> length(anchor) then
    raise exception 'Review Staff appointment replay guard before identity upgrade';
  end if;
  definition := replace(definition, anchor, anchor || $new$
  -- Authorization, creation permission, input checks and replay remain ahead of
  -- this read. Lock the explicit selection while its submitted label is valid.
  if nullif(p_input->>'customerId','') is not null then
    select c.* into selected_customer_snapshot from customers c
    where c.id=(p_input->>'customerId')::uuid
      and c.location_id=p_salon and c.status='active'
      and lower(btrim(c.name))=lower(customer_name)
      and (c.phone is null or (case when staff_customer_contacts_enabled(p_salon)
        then regexp_replace(c.phone,'[^0-9]','','g')=regexp_replace(customer_phone,'[^0-9]','','g')
        else staff_customer_phone_key(c.phone)=staff_customer_phone_key(customer_phone) end))
    for update;
    if selected_customer_snapshot.id is null then
      raise exception 'Selected customer is no longer available. Search again';
    end if;
  end if;
  canonical_customer_id := public.canonical_customer_for_phone(p_salon,customer_phone);
$new$);

  anchor := $old$select c.id into customer from customers c where c.id=(p_input->>'customerId')::uuid
          and c.location_id=p_salon and c.status='active'
          and lower(btrim(c.name))=lower(customer_name)
          and (c.phone is null or (case when staff_customer_contacts_enabled(p_salon) then regexp_replace(c.phone,'[^0-9]','','g')=regexp_replace(customer_phone,'[^0-9]','','g') else staff_customer_phone_key(c.phone)=staff_customer_phone_key(customer_phone) end));$old$;
  if length(definition)-length(replace(definition,anchor,'')) <> length(anchor) then
    raise exception 'Review Staff selected-customer contact guard before upgrade';
  end if;
  definition := replace(definition, anchor, $new$-- Prefer the explicit record if consolidation retained it (for example,
        -- two active visits). If it was merged, follow only the resolver's ID.
        select c.id into customer from customers c
        where c.id=coalesce((select retained.id from customers retained where retained.id=selected_customer_snapshot.id),canonical_customer_id)
          and c.location_id=p_salon and c.status='active'
          and (selected_customer_snapshot.customer_user_id is null
            or c.customer_user_id=selected_customer_snapshot.customer_user_id)
          and (c.phone is null or (case when staff_customer_contacts_enabled(p_salon)
            then regexp_replace(c.phone,'[^0-9]','','g')=regexp_replace(customer_phone,'[^0-9]','','g')
            else staff_customer_phone_key(c.phone)=staff_customer_phone_key(customer_phone) end)
            -- The locked original contact already passed the privacy-sensitive
            -- check. Canonicalization may format that same complete number.
            or (selected_customer_snapshot.phone is not null
              and normalize_customer_claim_phone(c.phone)=normalize_customer_claim_phone(selected_customer_snapshot.phone)))
        for update;$new$);

  execute definition;
end $migration$;

commit;
