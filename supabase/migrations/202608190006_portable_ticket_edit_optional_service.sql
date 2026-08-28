do $$
declare
  function_sql text;
  patched_sql text;
begin
  select pg_get_functiondef(
    'public.correct_pos_portable_closed_ticket(uuid,text,uuid,jsonb,jsonb,jsonb,jsonb,numeric,text)'::regprocedure
  )
  into function_sql;

  if function_sql is null then
    raise exception 'correct_pos_portable_closed_ticket(uuid,text,uuid,jsonb,jsonb,jsonb,jsonb,numeric,text) was not found.';
  end if;

  patched_sql := replace(
    function_sql,
    '  create temporary table portable_ticket_added_items (
    row_index integer primary key,
    service_id uuid not null,
    staff_id uuid not null,',
    '  create temporary table portable_ticket_added_items (
    row_index integer primary key,
    service_id uuid,
    staff_id uuid not null,'
  );

  if patched_sql = function_sql then
    raise exception 'Unable to relax added-item service_id nullability.';
  end if;

  function_sql := patched_sql;
  patched_sql := replace(
    function_sql,
    '    if service_text is null or staff_text is null then
      raise exception ''Added lines require staff and service.'';
    end if;

    service_uuid := service_text::uuid;
    staff_uuid := staff_text::uuid;',
    '    if staff_text is null then
      raise exception ''Added lines require staff.'';
    end if;

    service_uuid := case when service_text is null then null else service_text::uuid end;
    staff_uuid := staff_text::uuid;'
  );

  if patched_sql = function_sql then
    raise exception 'Unable to relax added-item service validation.';
  end if;

  function_sql := patched_sql;
  patched_sql := replace(
    function_sql,
    '    where final_items.service_id is null
      or final_items.staff_id is null
      or cardinality(final_items.parts) = 0
      or final_items.line_total <= 0',
    '    where final_items.staff_id is null
      or cardinality(final_items.parts) = 0
      or final_items.line_total <= 0'
  );

  if patched_sql = function_sql then
    raise exception 'Unable to relax final-item service validation.';
  end if;

  function_sql := patched_sql;
  patched_sql := replace(
    function_sql,
    '    raise exception ''Active lines require staff, service, and positive parts.'';',
    '    raise exception ''Active lines require staff and positive parts.'';'
  );

  if patched_sql = function_sql then
    raise exception 'Unable to update active-line validation message.';
  end if;

  function_sql := patched_sql;
  patched_sql := replace(
    function_sql,
    '    where changed_services.service_id is null
      or not exists (',
    '    where changed_services.service_id is not null
      and not exists ('
  );

  if patched_sql = function_sql then
    raise exception 'Unable to preserve active-service validation for non-null services.';
  end if;

  execute patched_sql;
end $$;
