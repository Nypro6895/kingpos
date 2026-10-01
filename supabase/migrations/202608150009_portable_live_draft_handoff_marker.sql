create or replace function public.update_pos_portable_live_draft(
  p_key_id uuid,
  p_session_signature text,
  p_token text,
  p_selected_staff_id text,
  p_staff_lines jsonb,
  p_subtotal numeric,
  p_tip numeric,
  p_total numeric,
  p_discount numeric default 0,
  p_tax numeric default 0,
  p_total_before_tip numeric default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  target_salon_id uuid;
  draft_row public.pos_live_drafts%rowtype;
  next_handoff_started_at timestamptz;
  next_subtotal numeric;
  next_total numeric;
  next_total_before_tip numeric;
begin
  target_salon_id := public.pos_portable_access_salon_id(p_key_id, p_session_signature);

  if target_salon_id is null then
    return null;
  end if;

  if jsonb_typeof(coalesce(p_staff_lines, '[]'::jsonb)) <> 'array' then
    raise exception 'Staff lines must be an array.';
  end if;

  select *
  into draft_row
  from public.pos_live_drafts
  where token = p_token
    and salon_id = target_salon_id
  limit 1;

  if draft_row.id is null then
    raise exception 'Live draft was not found.';
  end if;

  next_subtotal := round(coalesce(p_subtotal, 0), 2);
  next_total := round(coalesce(p_total, 0), 2);
  next_total_before_tip := round(
    coalesce(p_total_before_tip, greatest(0, next_total - coalesce(p_tip, 0))),
    2
  );
  next_handoff_started_at := case
    when next_subtotal > 0
      or next_total_before_tip > 0
      or exists (
        select 1
        from jsonb_array_elements(coalesce(p_staff_lines, '[]'::jsonb)) as line(value)
        where case
          when coalesce(line.value->>'amount', '') ~ '^-?[0-9]+(\.[0-9]+)?$'
          then (line.value->>'amount')::numeric
          else 0
        end > 0
      )
    then coalesce(draft_row.customer_handoff_started_at, now())
    else null
  end;

  update public.pos_live_drafts
  set completed_at = null,
      customer = case when status = 'draft' then customer else null end,
      customer_handoff_started_at = next_handoff_started_at,
      discount = round(coalesce(p_discount, 0), 2),
      last_customer_action_id = case when status = 'draft' then last_customer_action_id else null end,
      last_tip_action_id = case when status = 'draft' then last_tip_action_id else null end,
      receipt_version = receipt_version + 1,
      reset_at = null,
      selected_staff_id = nullif(btrim(coalesce(p_selected_staff_id, '')), ''),
      staff_lines = coalesce(p_staff_lines, '[]'::jsonb),
      status = 'draft',
      subtotal = next_subtotal,
      tax = round(coalesce(p_tax, 0), 2),
      tip = round(coalesce(p_tip, 0), 2),
      total = next_total,
      total_before_tip = next_total_before_tip,
      version = version + 1
  where id = draft_row.id;

  return (
    select to_jsonb(snapshot)
    from public.get_pos_live_draft_by_token(p_token) snapshot
    limit 1
  );
end;
$$;

grant execute on function public.update_pos_portable_live_draft(
  uuid,
  text,
  text,
  text,
  jsonb,
  numeric,
  numeric,
  numeric,
  numeric,
  numeric,
  numeric
) to anon, authenticated;

notify pgrst, 'reload schema';
