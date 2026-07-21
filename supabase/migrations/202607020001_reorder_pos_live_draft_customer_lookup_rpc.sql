create or replace function public.find_pos_live_draft_customer_by_phone(
  p_phone text,
  p_token text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  draft_row public.pos_live_drafts%rowtype;
  normalized_phone text;
  matched_customer public.customers%rowtype;
begin
  normalized_phone := nullif(regexp_replace(coalesce(p_phone, ''), '\s+', '', 'g'), '');

  if normalized_phone is null then
    raise exception 'Phone is required.';
  end if;

  select *
  into draft_row
  from public.pos_live_drafts
  where token = p_token
  limit 1;

  if draft_row.id is null then
    raise exception 'Live draft was not found.';
  end if;

  select *
  into matched_customer
  from public.customers
  where location_id = draft_row.salon_id
    and phone = normalized_phone
    and status = 'active'
  order by created_at desc
  limit 1;

  if matched_customer.id is null then
    return null;
  end if;

  return jsonb_build_object(
    'id', matched_customer.id,
    'name', matched_customer.name,
    'phone', matched_customer.phone
  );
end;
$$;

grant execute on function public.find_pos_live_draft_customer_by_phone(text, text) to anon, authenticated;
