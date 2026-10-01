create or replace function public.finalize_pos_portable_live_draft(
  p_key_id uuid,
  p_session_signature text,
  p_token text,
  p_reset_seconds integer default 180
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  target_salon_id uuid;
  draft_row public.pos_live_drafts%rowtype;
  reset_seconds integer := greatest(30, least(coalesce(p_reset_seconds, 180), 600));
begin
  target_salon_id := public.pos_portable_access_salon_id(p_key_id, p_session_signature);

  if target_salon_id is null then
    return null;
  end if;

  update public.pos_live_drafts
  set completed_at = now(),
      reset_at = now() + make_interval(secs => reset_seconds),
      status = 'closed',
      version = version + 1
  where token = btrim(coalesce(p_token, ''))
    and salon_id = target_salon_id
  returning * into draft_row;

  if draft_row.id is null then
    return null;
  end if;

  return (
    select to_jsonb(snapshot)
    from public.get_pos_live_draft_by_token(p_token) snapshot
    limit 1
  );
end;
$$;

create or replace function public.touch_pos_live_draft_activity(
  p_token text,
  p_reset_seconds integer default 180
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  draft_row public.pos_live_drafts%rowtype;
  reset_seconds integer := greatest(30, least(coalesce(p_reset_seconds, 180), 600));
begin
  select *
  into draft_row
  from public.pos_live_drafts
  where token = btrim(coalesce(p_token, ''))
  limit 1;

  if draft_row.id is null then
    return null;
  end if;

  if draft_row.status = 'closed'
    and draft_row.reset_at is not null
    and draft_row.reset_at > now()
  then
    update public.pos_live_drafts
    set reset_at = now() + make_interval(secs => reset_seconds),
        version = version + 1
    where id = draft_row.id
    returning * into draft_row;
  end if;

  return (
    select to_jsonb(snapshot)
    from public.get_pos_live_draft_by_token(p_token) snapshot
    limit 1
  );
end;
$$;

grant execute on function public.finalize_pos_portable_live_draft(uuid, text, text, integer) to anon, authenticated;
grant execute on function public.touch_pos_live_draft_activity(text, integer) to anon, authenticated;
