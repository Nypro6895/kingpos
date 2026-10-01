-- Visit edits/removals use the same atomic operation ledger as tickets.
create or replace function public.apply_pos_portable_visit_operation(p_key_id uuid,p_session_signature text,p_payload jsonb)
returns jsonb language plpgsql security definer set search_path=public as $$
declare salon uuid; visit public.customer_visits%rowtype; customer_name text; customer_phone text;
begin
  salon := public.pos_portable_access_salon_id(p_key_id,p_session_signature);
  if salon is null or not public.pos_portable_access_has_capability(p_key_id,p_session_signature,'portable.pos.use') then raise exception 'Not authorized'; end if;
  select * into visit from public.customer_visits where id=(p_payload->>'visitId')::uuid and salon_id=salon for update;
  if visit.id is null then raise exception 'Customer visit not found'; end if;
  if p_payload->>'action' in ('remove','left') then
    return public.cancel_customer_visit_core(visit.id,case when p_payload->>'action'='left' then 'Customer left before service.' else 'Removed from Portable POS waiting list.' end);
  elsif p_payload->>'action'='edit' then
    customer_name := trim(coalesce(p_payload->>'name',''));
    customer_phone := regexp_replace(coalesce(p_payload->>'phone',''),'[^0-9]','','g');
    if length(customer_name) not between 1 and 120 or length(customer_phone) not between 10 and 15 then raise exception 'Enter a name and valid phone number'; end if;
    update public.customers set name=customer_name,phone=customer_phone where id=visit.customer_id and location_id=salon;
    return jsonb_build_object('ok',true,'visitId',visit.id);
  else raise exception 'Unsupported visit action'; end if;
end; $$;
revoke all on function public.apply_pos_portable_visit_operation(uuid,text,jsonb) from public,anon,authenticated;
do $migration$
declare definition text;
begin
  definition := pg_get_functiondef('public.replay_pos_portable_operation(uuid,text,uuid,text,timestamptz,jsonb)'::regprocedure);
  if position('elsif p_kind=''booking'' then' in definition)=0 then raise exception 'Operation implementation changed'; end if;
  definition := replace(definition,'elsif p_kind=''booking'' then',
    'elsif p_kind=''visit'' then result := public.apply_pos_portable_visit_operation(p_key_id,p_session_signature,p_payload); elsif p_kind=''booking'' then');
  execute definition;
end;
$migration$;
notify pgrst,'reload schema';
