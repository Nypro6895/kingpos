-- Durable business commands are independent of the replaceable display draft.
create table if not exists public.pos_portable_operations (
  key_id uuid not null references public.pos_portable_access_keys(id) on delete cascade,
  operation_id uuid not null, kind text not null, payload_hash text not null,
  occurred_at timestamptz not null, result jsonb not null,
  created_at timestamptz not null default now(), primary key(key_id, operation_id)
);
alter table public.pos_portable_operations enable row level security;
revoke all on public.pos_portable_operations from anon, authenticated;

-- Reuse the installed attendance rules (including fixes in later migrations),
-- preserving the event's business date instead of the reconnect date.
do $migration$
declare definition text;
begin
  definition := pg_get_functiondef('public.submit_pos_portable_attendance_event(uuid,text,uuid,text,text)'::regprocedure);
  if position('target_today := public.get_salon_business_date(target_salon_id);' in definition) = 0 then
    raise exception 'Attendance implementation needs review before offline replay';
  end if;
  definition := replace(definition, 'submit_pos_portable_attendance_event(', 'replay_pos_portable_attendance_event(');
  definition := replace(definition, 'p_event_type text)', 'p_event_type text, p_occurred_at timestamptz)');
  definition := replace(definition, 'target_today := public.get_salon_business_date(target_salon_id);',
    'target_today := (p_occurred_at at time zone public.get_salon_business_timezone(target_salon_id))::date;');
  definition := replace(definition, 'now()', 'p_occurred_at');
  -- Replaying an old day must not auto-close current staff workdays.
  definition := replace(definition, 'perform public.auto_close_stale_staff_workdays(target_salon_id, target_today);', '');
  execute definition;
end;
$migration$;
revoke all on function public.replay_pos_portable_attendance_event(uuid,text,uuid,text,text,timestamptz) from public, anon, authenticated;

create or replace function public.get_pos_portable_offline_staff(p_key_id uuid,p_session_signature text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare salon uuid;
begin
  salon := public.pos_portable_access_salon_id(p_key_id,p_session_signature);
  if salon is null or not public.pos_portable_access_has_capability(p_key_id,p_session_signature,'portable.checkin.use') then
    raise exception 'Not authorized';
  end if;
  return (select coalesce(jsonb_agg(jsonb_build_object('id',id,'salt',passcode_salt,'digest',passcode_digest)), '[]')
    from public.staff where salon_id=salon and is_active=true and pos_enabled=true);
end; $$;
revoke all on function public.get_pos_portable_offline_staff(uuid,text) from public;
grant execute on function public.get_pos_portable_offline_staff(uuid,text) to anon,authenticated;

create or replace function public.replay_pos_portable_operation(
  p_key_id uuid,p_session_signature text,p_operation_id uuid,p_kind text,p_occurred_at timestamptz,p_payload jsonb
) returns jsonb language plpgsql security definer set search_path=public as $$
declare salon uuid; previous public.pos_portable_operations%rowtype; fingerprint text; result jsonb; work_date date; customer jsonb; receipt jsonb;
begin
  salon := public.pos_portable_access_salon_id(p_key_id,p_session_signature);
  if salon is null then raise exception 'Not authorized'; end if;
  if p_operation_id is null or p_occurred_at is null or p_occurred_at > now()+interval '5 minutes'
    or p_occurred_at < now()-interval '30 days' then raise exception 'Invalid operation time'; end if;
  fingerprint := md5(p_kind || ':' || p_occurred_at::text || ':' || p_payload::text);
  perform pg_advisory_xact_lock(hashtextextended(p_key_id::text || p_operation_id::text,0));
  select * into previous from public.pos_portable_operations where key_id=p_key_id and operation_id=p_operation_id;
  if found then
    if previous.payload_hash <> fingerprint then raise exception 'Operation identity mismatch'; end if;
    return previous.result;
  end if;
  work_date := (p_occurred_at at time zone public.get_salon_business_timezone(salon))::date;
  if p_kind='receipt' then
    receipt := p_payload-'liveDraftToken';
    if jsonb_typeof(p_payload->'newCustomer')='object' then
      customer := public.create_pos_portable_customer(p_key_id,p_session_signature,
        p_payload->'newCustomer'->>'name',p_payload->'newCustomer'->>'phone',p_payload->'newCustomer'->>'email');
      if customer is null then raise exception 'Unable to create customer'; end if;
      receipt := receipt || jsonb_build_object('customerId',customer->>'id');
    end if;
    result := public.submit_pos_portable_receipt(p_key_id,p_session_signature,receipt,work_date);
    -- Reporting follows when the sale happened, not when connectivity returned.
    update public.pos_tickets set opened_at=p_occurred_at, closed_at=p_occurred_at
      where id=(result->>'ticketId')::uuid and salon_id=salon;
    update public.pos_payments set created_at=p_occurred_at
      where ticket_id=(result->>'ticketId')::uuid and salon_id=salon;

  elsif p_kind='attendance' then
    result := public.replay_pos_portable_attendance_event(p_key_id,p_session_signature,
      (p_payload->>'staffId')::uuid,p_payload->>'passcode',p_payload->>'eventType',p_occurred_at);
  elsif p_kind='booking' then
    result := public.create_pos_portable_appointment(p_key_id,p_session_signature,
      p_payload->>'customerName',p_payload->>'customerPhone',p_payload->>'customerEmail',
      (p_payload->>'serviceId')::uuid,nullif(p_payload->>'staffId','')::uuid,(p_payload->>'startAt')::timestamptz);
  else raise exception 'Unsupported operation'; end if;
  if result is null then raise exception 'Operation not authorized'; end if;
  insert into public.pos_portable_operations(key_id,operation_id,kind,payload_hash,occurred_at,result)
    values(p_key_id,p_operation_id,p_kind,fingerprint,p_occurred_at,result);
  return result;
end; $$;
revoke all on function public.replay_pos_portable_operation(uuid,text,uuid,text,timestamptz,jsonb) from public;
grant execute on function public.replay_pos_portable_operation(uuid,text,uuid,text,timestamptz,jsonb) to anon,authenticated;
notify pgrst,'reload schema';

-- Include duration in the already-authorized reference payload for local Book.
do $reference$
declare definition text;
begin
  definition := pg_get_functiondef('public.get_pos_portable_reference_data(uuid,text)'::regprocedure);
  if position('duration_minutes' in definition)=0 then
    if position('''base_price'', services.base_price' in definition)=0 then raise exception 'Reference data needs review'; end if;
    definition := replace(definition, '''base_price'', services.base_price', '''base_price'', services.base_price, ''duration_minutes'', services.duration_minutes');
    execute definition;
  end if;
end;
$reference$;
