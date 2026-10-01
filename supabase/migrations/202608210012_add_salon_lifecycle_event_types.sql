-- Name salon lifecycle status-change audit events for verification and reporting.

create or replace function public.record_salon_lifecycle_status_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  normalized_old_status text := public.normalize_salon_lifecycle_status(old.status);
  normalized_new_status text := public.normalize_salon_lifecycle_status(new.status);
  transition_event_type text;
  transition_reason text;
begin
  if normalized_old_status = normalized_new_status then
    return new;
  end if;

  transition_event_type := case normalized_new_status
    when 'disabled' then 'SALON_DISABLED'
    when 'active' then 'SALON_REACTIVATED'
    when 'permanently_closed' then 'SALON_PERMANENTLY_CLOSED'
    else 'SALON_STATUS_CHANGED'
  end;

  transition_reason := case normalized_new_status
    when 'disabled' then new.disabled_reason
    when 'active' then new.reactivation_reason
    when 'permanently_closed' then new.closure_reason
    else null
  end;

  insert into public.salon_lifecycle_events (
    salon_id,
    actor_user_id,
    event_type,
    old_status,
    new_status,
    reason,
    metadata
  )
  values (
    new.id,
    public.current_public_user_id(),
    transition_event_type,
    normalized_old_status,
    normalized_new_status,
    nullif(btrim(coalesce(transition_reason, '')), ''),
    jsonb_build_object(
      'raw_old_status', old.status,
      'raw_new_status', new.status
    )
  );

  return new;
end;
$$;
