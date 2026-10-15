-- A retry key is not proof of ownership of an account-linked booking.
-- Retain guest retry behavior, scheduling locks, and the installed receipt/
-- deposit/notification logic. Only the original customer may recover a linked
-- booking's management capability through create-booking idempotency.
begin;
do $patch$
declare
  target regprocedure;
  definition text;
  anchor text := '    if existing_booking.id is not null then';
begin
  target := to_regprocedure('public.create_public_booking_without_deposit(uuid,text,text,text,text,timestamptz,timestamptz,jsonb,text,text,text,uuid,text)');
  if target is null then
    raise exception 'Expected booking deposit wrapper before access guards.';
  end if;
  definition := pg_get_functiondef(target);
  if position('-- booking-idempotency-account-ownership' in definition) > 0 then return; end if;
  if position(anchor in definition) = 0
    or (length(definition) - length(replace(definition, anchor, ''))) / length(anchor) <> 1
    or position('actor_user_id uuid := public.current_public_user_id()' in definition) = 0 then
    raise exception 'Booking idempotency lookup changed; review access guard migration.';
  end if;
  definition := replace(definition, anchor,
    anchor || chr(10) ||
    '      -- booking-idempotency-account-ownership' || chr(10) ||
    '      if existing_booking.customer_user_id is not null' || chr(10) ||
    '        and existing_booking.customer_user_id is distinct from actor_user_id then' || chr(10) ||
    '        return jsonb_build_object(''ok'', false, ''code'', ''booking_not_available'');' || chr(10) ||
    '      end if;');
  execute definition;
end;
$patch$;
notify pgrst, 'reload schema';
commit;
