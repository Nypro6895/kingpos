-- Preserve closure metadata on edits; terminal transitions require their dedicated audited actions.
create or replace function public.update_platform_admin_report(
  p_report_id uuid,
  p_priority text,
  p_status text,
  p_summary text,
  p_description text,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  actor record;
  before_row public.platform_reports%rowtype;
  after_row public.platform_reports%rowtype;
  clean_priority text := nullif(btrim(coalesce(p_priority, '')), '');
  clean_status text := nullif(btrim(coalesce(p_status, '')), '');
  clean_summary text := nullif(btrim(coalesce(p_summary, '')), '');
  clean_reason text;
begin
  select *
  into actor
  from public.platform_admin_require_permission('admin.reports.update');
  clean_reason := public.platform_admin_normalize_reason(p_reason);

  select *
  into before_row
  from public.platform_reports
  where id = p_report_id
  for update;

  if before_row.id is null then
    raise exception 'Report not found.';
  end if;

  if clean_priority is null then
    clean_priority := before_row.priority;
  end if;

  if clean_status is null then
    clean_status := before_row.status;
  end if;

  if clean_summary is null then
    clean_summary := before_row.summary;
  end if;

  if clean_priority not in ('low', 'normal', 'high', 'urgent') then
    raise exception 'Invalid report priority.';
  end if;

  if clean_status not in ('new', 'under_review', 'action_required', 'resolved', 'closed') then
    raise exception 'Invalid report status.';
  end if;

  if clean_status <> before_row.status and clean_status in ('resolved', 'closed')
    and not public.platform_admin_has_permission('admin.reports.resolve')
  then
    raise exception 'Report resolve permission denied.';
  end if;

  if clean_status <> before_row.status and clean_status in ('resolved', 'closed') then
    raise exception 'Invalid report update. Use Resolve report to record a resolution, then Close report to finish.';
  end if;

  if not public.platform_report_transition_allowed(
    before_row.status,
    clean_status,
    actor.actor_role_slug
  ) then
    raise exception 'Invalid report status transition from % to %. Refresh the report and follow New -> Under review -> Resolved -> Closed.', before_row.status, clean_status;
  end if;

  if length(clean_summary) < 3 or length(clean_summary) > 200 then
    raise exception 'Report summary must be between 3 and 200 characters.';
  end if;

  if p_description is not null and length(btrim(p_description)) > 5000 then
    raise exception 'Report description must be 5000 characters or fewer.';
  end if;

  update public.platform_reports
  set
    priority = clean_priority,
    status = clean_status,
    summary = clean_summary,
    description = nullif(btrim(coalesce(p_description, '')), ''),
    resolution = case when clean_status = 'under_review' and before_row.status in ('resolved', 'closed') then null else resolution end,
    resolved_by_user_id = case when clean_status = 'under_review' and before_row.status in ('resolved', 'closed') then null else resolved_by_user_id end,
    resolved_at = case when clean_status = 'under_review' and before_row.status in ('resolved', 'closed') then null else resolved_at end,
    closed_by_user_id = case when clean_status = 'under_review' and before_row.status in ('resolved', 'closed') then null else closed_by_user_id end,
    closed_at = case when clean_status = 'under_review' and before_row.status in ('resolved', 'closed') then null else closed_at end
  where id = p_report_id
  returning * into after_row;

  insert into public.platform_admin_audit_logs (
    actor_user_id,
    action,
    target_type,
    target_id,
    reason,
    before_data,
    after_data
  )
  values (
    actor.actor_user_id,
    'platform_admin.report_updated',
    'platform_admin_report',
    p_report_id,
    clean_reason,
    jsonb_build_object(
      'priority', before_row.priority,
      'status', before_row.status,
      'summary', before_row.summary,
      'description', before_row.description,
      'resolution', before_row.resolution,
      'resolved_at', before_row.resolved_at,
      'resolved_by_user_id', before_row.resolved_by_user_id,
      'closed_at', before_row.closed_at,
      'closed_by_user_id', before_row.closed_by_user_id
    ),
    jsonb_build_object(
      'priority', after_row.priority,
      'status', after_row.status,
      'summary', after_row.summary,
      'description', after_row.description,
      'resolution', after_row.resolution,
      'resolved_at', after_row.resolved_at,
      'resolved_by_user_id', after_row.resolved_by_user_id,
      'closed_at', after_row.closed_at,
      'closed_by_user_id', after_row.closed_by_user_id
    )
  );

  return jsonb_build_object(
    'report_id', after_row.id,
    'status', after_row.status,
    'priority', after_row.priority
  );
end;
$$;


