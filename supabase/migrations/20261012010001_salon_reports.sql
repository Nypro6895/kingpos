begin;

create function public.submit_salon_report(p_request_id uuid, p_salon_id uuid, p_reason text, p_details text default '')
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  actor uuid := public.current_public_user_id();
  context jsonb;
  guest_key text;
  salon_name text;
  reason_label text;
  report_id uuid;
  message text;
begin
  reason_label := case p_reason
    when 'incorrect_information' then 'Incorrect salon information'
    when 'closed' then 'Salon is closed or does not exist'
    when 'duplicate' then 'Duplicate salon profile'
    when 'scam' then 'Scam, fraud or impersonation'
    when 'inappropriate' then 'Inappropriate or harmful content'
    when 'other' then 'Other problem'
  end;
  if p_request_id is null or p_salon_id is null or reason_label is null or length(btrim(coalesce(p_details, ''))) > 2000 then
    raise exception 'Please check your report and choose a reason.';
  end if;
  select name into salon_name from public.locations where id = p_salon_id and status = 'active';
  if not found then raise exception 'This salon is no longer available.'; end if;
  context := public.abuse_guard_actor('report');
  if actor is null then
    guest_key := nullif(context->>'device', '');
    if guest_key is null then raise exception 'Please use Reylumi to send your report.'; end if;
  else
    perform public.support_active_user();
  end if;
  perform pg_advisory_xact_lock(hashtextextended('salon-report:' || coalesce(actor::text, guest_key), 0));
  select id into report_id from public.platform_reports
    where support_request_id = p_request_id and category = 'salon_report' and subject_location_id = p_salon_id
      and (reporter_user_id = actor or (actor is null and reporter_user_id is null and support_context->>'guest_key' = guest_key));
  if found then return jsonb_build_object('id', report_id, 'supportHref', case when actor is not null then '/support/' || report_id::text end); end if;
  if exists (select 1 from public.platform_reports where support_request_id = p_request_id) then
    raise exception 'Please close this report and try again.';
  end if;
  message := reason_label || case when nullif(btrim(p_details), '') is not null then E'\n\n' || btrim(p_details) else '' end;
  insert into public.platform_reports(category, summary, description, source, reporter_user_id, created_by_user_id, subject_location_id, support_request_id, support_context)
  values ('salon_report', left('Salon report: ' || salon_name, 200), message,
    case when actor is null then 'guest_salon_report' else 'user_support' end, actor, actor, p_salon_id, p_request_id,
    jsonb_strip_nulls(jsonb_build_object('path', '/explore/salons/' || p_salon_id::text, 'salon_id', p_salon_id,
      'salon_name', salon_name, 'reason', p_reason, 'guest_key', guest_key))) returning id into report_id;
  if actor is not null then
    insert into public.support_case_messages(report_id, actor_user_id, sender, body) values (report_id, actor, 'user', message);
  end if;
  return jsonb_build_object('id', report_id, 'supportHref', case when actor is not null then '/support/' || report_id::text end);
end;
$$;
revoke all on function public.submit_salon_report(uuid, uuid, text, text) from public;
grant execute on function public.submit_salon_report(uuid, uuid, text, text) to anon, authenticated;

commit;
