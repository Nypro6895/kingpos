-- Replaceable draft operations, not a payment/offline settlement queue.
alter table public.pos_live_drafts
  add column if not exists last_pos_operation_id uuid,
  add column if not exists last_pos_operation_hash text;

create or replace function public.sync_pos_portable_draft(
  p_key_id uuid, p_session_signature text, p_token text,
  p_operation_id uuid, p_expected_version integer, p_payload jsonb
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  target_salon_id uuid;
  draft_row public.pos_live_drafts%rowtype;
  payload_hash text;
  snapshot jsonb;
begin
  target_salon_id := public.pos_portable_access_salon_id(p_key_id, p_session_signature);
  if target_salon_id is null or not public.pos_portable_access_has_capability(
    p_key_id, p_session_signature, 'portable.pos.use'
  ) then raise exception 'Portable POS authorization required'; end if;
  if p_operation_id is null or p_expected_version is null or
    p_payload is null or jsonb_typeof(p_payload) <> 'object' then
    raise exception 'Invalid draft operation';
  end if;
  select * into draft_row from public.pos_live_drafts
    where token = p_token and salon_id = target_salon_id for update;
  if draft_row.id is null then raise exception 'Live draft was not found'; end if;
  payload_hash := md5(p_expected_version::text || ':' || p_payload::text);
  if draft_row.last_pos_operation_id = p_operation_id then
    if draft_row.last_pos_operation_hash <> payload_hash then
      raise exception 'Operation identity reused with different data';
    end if;
    -- A later tip, reset or submit may have changed the row. Returning a
    -- conflict prevents the remaining old cart from replaying over that work.
    if draft_row.version <> p_expected_version + 1 then
      return jsonb_build_object('conflict', true);
    end if;
  else
    if draft_row.version <> p_expected_version then
      return jsonb_build_object('conflict', true);
    end if;
    snapshot := public.update_pos_portable_live_draft(
      p_key_id, p_session_signature, p_token,
      p_payload->>'selectedStaffId', p_payload->'staffLines',
      (p_payload->>'subtotal')::numeric, (p_payload->>'tip')::numeric,
      (p_payload->>'total')::numeric, (p_payload->>'discount')::numeric,
      (p_payload->>'tax')::numeric, (p_payload->>'totalBeforeTip')::numeric
    );
    update public.pos_live_drafts set
      customer = nullif(p_payload->'customer', 'null'::jsonb),
      customer_version = customer_version + case
        when customer is distinct from nullif(p_payload->'customer', 'null'::jsonb) then 1 else 0 end,
      last_customer_action_id = case
        when customer is distinct from nullif(p_payload->'customer', 'null'::jsonb) then null else last_customer_action_id end,
      last_pos_operation_id = p_operation_id,
      last_pos_operation_hash = payload_hash where id = draft_row.id;
  end if;
  select to_jsonb(s) into snapshot from public.get_pos_live_draft_by_token(p_token) s limit 1;
  return jsonb_build_object('snapshot', snapshot);
end;
$$;
revoke all on function public.sync_pos_portable_draft(uuid,text,text,uuid,integer,jsonb) from public;
grant execute on function public.sync_pos_portable_draft(uuid,text,text,uuid,integer,jsonb) to anon, authenticated;
notify pgrst, 'reload schema';
