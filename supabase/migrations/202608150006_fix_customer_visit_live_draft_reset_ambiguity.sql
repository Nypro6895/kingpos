create or replace function public.get_pos_live_draft_by_token(p_token text)
returns table (
  id uuid,
  salon_id uuid,
  token text,
  customer jsonb,
  staff_lines jsonb,
  selected_staff_id text,
  tip numeric,
  subtotal numeric,
  discount numeric,
  tax numeric,
  total_before_tip numeric,
  total numeric,
  status text,
  version integer,
  customer_version integer,
  receipt_version integer,
  completed_at timestamptz,
  reset_at timestamptz,
  last_customer_action_id text,
  last_tip_action_id text,
  updated_at timestamptz,
  server_now timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  draft_row public.pos_live_drafts%rowtype;
begin
  select *
  into draft_row
  from public.pos_live_drafts
  where pos_live_drafts.token = btrim(coalesce(p_token, ''))
  limit 1;

  if draft_row.id is null then
    return;
  end if;

  if draft_row.status = 'closed'
    and draft_row.reset_at is not null
    and draft_row.reset_at <= now()
  then
    update public.pos_live_drafts as drafts
    set completed_at = null,
        customer = null,
        customer_handoff_started_at = null,
        discount = 0,
        last_customer_action_id = null,
        last_tip_action_id = null,
        receipt = '{}'::jsonb,
        reset_at = null,
        selected_staff_id = null,
        staff_lines = '[]'::jsonb,
        status = 'draft',
        subtotal = 0,
        tax = 0,
        tip = 0,
        total = 0,
        total_before_tip = 0,
        version = drafts.version + 1
    where drafts.id = draft_row.id
    returning drafts.* into draft_row;
  end if;

  return query
  select
    drafts.id,
    drafts.salon_id,
    drafts.token,
    drafts.customer,
    drafts.staff_lines,
    drafts.selected_staff_id,
    drafts.tip,
    drafts.subtotal,
    drafts.discount,
    drafts.tax,
    drafts.total_before_tip,
    drafts.total,
    drafts.status,
    drafts.version,
    drafts.customer_version,
    drafts.receipt_version,
    drafts.completed_at,
    drafts.reset_at,
    drafts.last_customer_action_id,
    drafts.last_tip_action_id,
    drafts.updated_at,
    now() as server_now
  from public.pos_live_drafts drafts
  where drafts.id = draft_row.id
  limit 1;
end;
$$;

grant execute on function public.get_pos_live_draft_by_token(text) to anon, authenticated;
