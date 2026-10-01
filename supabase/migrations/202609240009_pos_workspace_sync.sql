-- Receipt writes share a transaction, a salon sequence lock and durable identity.
begin;
alter table public.pos_settings add column if not exists workspace_preferences jsonb not null default '{}';

create or replace function public.get_pos_workspace_settings(p_key uuid,p_signature text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare salon uuid;begin
 salon:=pos_portable_access_salon_id(p_key,p_signature);if salon is null then raise exception 'Not authorized';end if;
 return (select to_jsonb(s) from pos_settings s where salon_id=salon);
end;$$;
revoke all on function public.get_pos_workspace_settings(uuid,text) from public;
grant execute on function public.get_pos_workspace_settings(uuid,text) to anon,authenticated;

create or replace function public.save_pos_workspace_settings(p_salon uuid,p_expected jsonb,p_values jsonb)
returns jsonb language plpgsql security definer set search_path=public as $$
declare current_row jsonb; assignments text; result jsonb; k text; inserted int;
begin
 if auth.uid() is null or not user_has_salon_permission(p_salon,array['tickets.manage']::text[]) then raise exception 'Not authorized'; end if;
 insert into pos_settings(salon_id) values(p_salon) on conflict(salon_id) do nothing;
 get diagnostics inserted = row_count;
 select to_jsonb(s) into current_row from pos_settings s where salon_id=p_salon for update;
 if inserted=1 and p_expected='{}'::jsonb then p_expected:=current_row;end if;
 if jsonb_typeof(p_values)<>'object' or p_values='{}'::jsonb then raise exception 'Choose settings to save.'; end if;
 for k in select jsonb_object_keys(p_values) loop
   if k<>all(array['large_turn_threshold','staff_check_in_enabled','tip_suggestions','touch_keyboard_enabled','workspace_preferences','app_download_url','customer_background_image_path','customer_left_ad_image_path','customer_right_ad_image_path','customer_left_ad_text','customer_right_ad_text','customer_promo_title','customer_promo_body','customer_show_salon_name','customer_show_customer_name','customer_show_receipt_status','customer_show_service_name','customer_show_staff_name','customer_show_barcode']) then raise exception 'Invalid setting'; end if;
   if not(p_expected ? k) or (current_row->k) is distinct from (p_expected->k) then raise exception 'These settings changed on another screen. Reload this group and review your changes.'; end if;
 end loop;
 if p_values ? 'large_turn_threshold' and (p_values->>'large_turn_threshold')::numeric<=0 then raise exception 'Large turn amount must be greater than zero.'; end if;
 select string_agg(format('%I=(jsonb_populate_record(NULL::public.pos_settings,$1)).%I',key,key),',') into assignments from jsonb_object_keys(p_values) key;
 execute format('update public.pos_settings set %s where salon_id=$2 returning to_jsonb(pos_settings)',assignments) into result using p_values,p_salon;
 return result;
end; $$;
revoke all on function public.save_pos_workspace_settings(uuid,jsonb,jsonb) from public,anon;
grant execute on function public.save_pos_workspace_settings(uuid,jsonb,jsonb) to authenticated;

create table if not exists public.pos_owner_operations (
  salon_id uuid not null references public.locations(id), user_id uuid not null references auth.users(id),
  operation_id uuid not null, payload_hash text not null, occurred_at timestamptz not null,
  result jsonb not null, created_at timestamptz not null default now(), primary key(salon_id,user_id,operation_id)
);
alter table public.pos_owner_operations enable row level security;
revoke all on public.pos_owner_operations from anon,authenticated;

create or replace function public.validate_pos_workspace_receipt(p_salon uuid,p_receipt jsonb)
returns void language plpgsql security definer set search_path=public as $$
declare line jsonb; visit uuid; existing uuid; total numeric;
begin
 perform pg_advisory_xact_lock(hashtextextended('pos-receipt:'||p_salon::text,0));
 if jsonb_typeof(p_receipt->'lines') is distinct from 'array' or jsonb_array_length(p_receipt->'lines') not between 1 and 200 then raise exception 'Add between 1 and 200 ticket lines.'; end if;
 for line in select value from jsonb_array_elements(p_receipt->'lines') loop
   if jsonb_typeof(line->'amountParts') is distinct from 'array' then raise exception 'Check the amounts on this ticket.'; end if;
   if exists(select 1 from jsonb_array_elements_text(line->'amountParts') p where p::numeric<=0 or p::numeric='NaN'::numeric) then raise exception 'Ticket amounts must be positive.'; end if;
   select sum(round(p::numeric,2)) into total from jsonb_array_elements_text(line->'amountParts') p;
   if total is null or total is distinct from round((line->>'total')::numeric,2) then raise exception 'The ticket amounts do not match. Review this ticket.'; end if;
 end loop;
 visit:=nullif(p_receipt->>'customerVisitId','')::uuid;
 if visit is not null then
   select ticket_id into existing from customer_visits where id=visit and salon_id=p_salon for update;
   if not found then raise exception 'This customer visit is no longer available. Review this ticket.'; end if;
   if existing is not null then raise exception 'This customer visit already has a ticket. Review the existing ticket before continuing.'; end if;
 end if;
end; $$;
revoke all on function public.validate_pos_workspace_receipt(uuid,jsonb) from public,anon,authenticated;

-- Patch the installed core, preserving custom services, payroll and all existing
-- payment behaviour. Fail closed if the expected implementation has changed.
do $patch$
declare definition text; owner_definition text; start_at int; end_at int;
begin
 definition:=pg_get_functiondef('public.submit_pos_portable_receipt_without_booking(uuid,text,jsonb,date)'::regprocedure);
 if position('validate_pos_workspace_receipt' in definition)=0 then
   if position('  select access_id' in definition)=0 then raise exception 'Receipt core needs review'; end if;
   definition:=replace(definition,'  select access_id','  perform public.validate_pos_workspace_receipt(target_salon_id,p_receipt);'||chr(10)||'  select access_id');
   execute definition;
 end if;
 owner_definition:=replace(definition,'public.submit_pos_portable_receipt_without_booking(', 'public.submit_owner_workspace_receipt_core(');
 start_at:=position('  target_salon_id :=' in owner_definition);
 end_at:=position('  select'||chr(10)||'    coalesce(pos_settings.large_turn_threshold' in owner_definition);
 if start_at=0 or end_at=0 then raise exception 'Owner receipt core needs review'; end if;
 owner_definition:=overlay(owner_definition placing '  target_salon_id := p_key_id; access_label := ''Owner POS''; perform public.validate_pos_workspace_receipt(target_salon_id,p_receipt);'||chr(10) from start_at for end_at-start_at);
 owner_definition:=replace(owner_definition,'    if not exists (','    if staff_uuid is not null and not exists (');
 -- An unattributed sale has no staff turn or commission; check-in-required
 -- salons still reject an absent staff assignment through the existing check.
 owner_definition:=replace(owner_definition,'    part_index := 0;', '    if staff_uuid is not null then'||chr(10)||'    part_index := 0;');
 owner_definition:=replace(owner_definition,'      large_part_delta'||chr(10)||'    );','      large_part_delta'||chr(10)||'    );'||chr(10)||'    end if;');
 execute owner_definition;
end; $patch$;
revoke all on function public.submit_owner_workspace_receipt_core(uuid,text,jsonb,date) from public,anon,authenticated;

create or replace function public.replay_pos_owner_operation(p_salon uuid,p_operation_id uuid,p_occurred_at timestamptz,p_payload jsonb)
returns jsonb language plpgsql security definer set search_path=public as $$
declare previous pos_owner_operations%rowtype; fingerprint text; result jsonb; work_date date;
begin
 if auth.uid() is null or not public.user_has_salon_permission(p_salon,array['tickets.create','tickets.manage']::text[]) or not public.salon_is_operational(p_salon) then raise exception 'Not authorized'; end if;
 if p_operation_id is null or p_occurred_at is null or p_occurred_at>now()+interval '5 minutes' or p_occurred_at<now()-interval '30 days' then raise exception 'Invalid operation time'; end if;
 fingerprint:=md5(p_occurred_at::text||':'||p_payload::text);
 perform pg_advisory_xact_lock(hashtextextended('pos-owner:'||p_salon::text||auth.uid()::text||p_operation_id::text,0));
 select * into previous from pos_owner_operations where salon_id=p_salon and user_id=auth.uid() and operation_id=p_operation_id;
 if found then
   if previous.payload_hash<>fingerprint then raise exception 'Operation identity mismatch'; end if;
   return previous.result;
 end if;
 if nullif(p_payload->>'sourceBookingId','') is not null then raise exception 'Open this appointment in Portable to create its ticket.'; end if;
 work_date:=(p_occurred_at at time zone get_salon_business_timezone(p_salon))::date;
 result:=submit_owner_workspace_receipt_core(p_salon,null,p_payload-'liveDraftToken',work_date);
 update pos_tickets set opened_at=p_occurred_at,closed_at=p_occurred_at where id=(result->>'ticketId')::uuid and salon_id=p_salon;
 update pos_payments set created_at=p_occurred_at where ticket_id=(result->>'ticketId')::uuid and salon_id=p_salon;
 insert into pos_owner_operations values(p_salon,auth.uid(),p_operation_id,fingerprint,p_occurred_at,result,now());
 return result;
end; $$;
revoke all on function public.replay_pos_owner_operation(uuid,uuid,timestamptz,jsonb) from public,anon;
grant execute on function public.replay_pos_owner_operation(uuid,uuid,timestamptz,jsonb) to authenticated;

-- Only record IDs are broadcast. Reads still require normal Owner/Portable
create or replace function public.save_pos_workspace_report_closing(p_key_id uuid,p_session_signature text,p_report_date date,p_cash_amount numeric,p_credit_card_amount numeric,p_other_amount numeric,p_note text,p_expected jsonb)
returns jsonb language plpgsql security definer set search_path=public as $$
declare salon uuid; snapshot jsonb;begin
 salon:=pos_portable_access_salon_id(p_key_id,p_session_signature);
 if salon is null or not pos_portable_access_has_capability(p_key_id,p_session_signature,'portable.report.view') then raise exception 'Not authorized';end if;
 perform pg_advisory_xact_lock(hashtextextended('pos-closing:'||salon::text||p_report_date::text,0));
 perform 1 from pos_daily_closings where salon_id=salon and report_date=p_report_date for update;
 snapshot:=get_pos_portable_report_data(p_key_id,p_session_signature,p_report_date)->'closingInputs';
 if p_expected is null or snapshot is distinct from p_expected then raise exception 'Closing amounts changed on another screen. Review the latest amounts before saving.';end if;
 return save_pos_portable_report_closing(p_key_id,p_session_signature,p_report_date,p_cash_amount,p_credit_card_amount,p_other_amount,p_note);
end;$$;
revoke all on function public.save_pos_workspace_report_closing(uuid,text,date,numeric,numeric,numeric,text,jsonb) from public;
grant execute on function public.save_pos_workspace_report_closing(uuid,text,date,numeric,numeric,numeric,text,jsonb) to anon,authenticated;

-- A late offline attendance event cannot overwrite a later staff decision.
do $$begin
 if to_regprocedure('public.replay_pos_attendance_without_order_guard(uuid,text,uuid,text,text,timestamptz)') is null then
 alter function public.replay_pos_portable_attendance_event(uuid,text,uuid,text,text,timestamptz) rename to replay_pos_attendance_without_order_guard;
 end if;
end;$$;
create or replace function public.replay_pos_portable_attendance_event(p_key_id uuid,p_session_signature text,p_staff_id uuid,p_passcode text,p_event_type text,p_occurred_at timestamptz)
returns jsonb language plpgsql security definer set search_path=public as $$
declare salon uuid;day date;begin
 salon:=pos_portable_access_salon_id(p_key_id,p_session_signature);
 if salon is null then raise exception 'Not authorized';end if;
 day:=(p_occurred_at at time zone get_salon_business_timezone(salon))::date;
 perform pg_advisory_xact_lock(hashtextextended('pos-attendance:'||salon::text||p_staff_id::text||day::text,0));
 if exists(select 1 from staff_attendance_events where salon_id=salon and staff_id=p_staff_id and work_date=day and created_at>p_occurred_at and event_type in ('CHECK_IN','CHECK_OUT','LEAVE_OUT','RETURN_TO_WORK')) then
   raise exception 'This staff member changed on another device. Review their current check-in status.';
 end if;
 return replay_pos_attendance_without_order_guard(p_key_id,p_session_signature,p_staff_id,p_passcode,p_event_type,p_occurred_at);
end;$$;
revoke all on function public.replay_pos_attendance_without_order_guard(uuid,text,uuid,text,text,timestamptz) from public,anon,authenticated;
revoke all on function public.replay_pos_portable_attendance_event(uuid,text,uuid,text,text,timestamptz) from public,anon,authenticated;

-- Only record IDs are broadcast. Reads still require normal Owner/Portable
-- authorization. Events are published after the database transaction commits.
create or replace function public.notify_pos_workspace_change()
returns trigger language plpgsql security definer set search_path=public as $$
declare row_data jsonb; salon uuid; resource text; target text;
begin
 row_data:=case when TG_OP='DELETE' then to_jsonb(old) else to_jsonb(new) end;
 salon:=nullif(row_data->>'salon_id','')::uuid;
 if salon is null then return null; end if;
 resource:=TG_ARGV[0]; target:=coalesce(row_data->>TG_ARGV[1],row_data->>'id');
 begin
 perform realtime.send(jsonb_build_object('salonId',salon,'resource',resource,'ids',jsonb_build_array(target)), 'workspace_changed','pos-staff:'||salon::text,false);
 exception when others then null; -- Polling repairs a transport outage; writes must still commit.
 end;
 return null;
end; $$;
revoke all on function public.notify_pos_workspace_change() from public,anon,authenticated;
do $triggers$
declare row record;
begin
 for row in select * from (values
 ('staff_workdays','staff','staff_id'),('staff','staff','id'),('pos_tickets','tickets','id'),
 ('pos_payments','report','ticket_id'),('bookings','booking','id'),('customer_visits','waiting','id'),
 ('pos_settings','settings','salon_id'),('pos_daily_closings','report','id')) as v(tbl,resource,col) loop
 execute format('drop trigger if exists pos_workspace_changed on public.%I',row.tbl);
 execute format('create trigger pos_workspace_changed after insert or update or delete on public.%I for each row execute function public.notify_pos_workspace_change(%L,%L)',row.tbl,row.resource,row.col);
 end loop;
end; $triggers$;
-- Read staff and acknowledged commands from the same MVCC snapshot. A lost
-- HTTP reply must not cause an already-committed turn to be applied twice.
create or replace function public.pos_workspace_staff_snapshot(p_salon uuid,p_key uuid,p_ids uuid[])
returns jsonb language sql stable security definer set search_path=public as $$
 with day as (select get_salon_business_date(p_salon) d),
 turns as (select staff_id,count(*) filter(where turn_type='large') large,count(*) filter(where turn_type='small') small
 from pos_ticket_item_turn_parts,day where salon_id=p_salon and work_date=day.d group by staff_id),
 members as (select jsonb_build_object('id',s.id,'display_name',s.display_name,'job_title',s.job_title,'is_active',s.is_active,
 'staffProfilePhotoPath',s.public_profile_photo_path,'accountAvatarUrl',coalesce(u.avatar_url,legacy.avatar_url),
 'today_status',coalesce(w.status,'not_checked_in'),'check_in_at',w.check_in_at,'check_in_sequence',w.check_in_sequence,
 'turns',jsonb_build_object('queueTurns',coalesce(w.queue_turn_count,0),'largeTurns',coalesce(w.queue_turn_count,0),
 'smallTurns',coalesce(t.small,0),'totalTurns',coalesce(w.queue_turn_count,0),'receiptLargeTurns',coalesce(t.large,0))) item
 from staff s cross join day left join staff_workdays w on w.salon_id=s.salon_id and w.staff_id=s.id and w.work_date=day.d
 left join turns t on t.staff_id=s.id left join users u on u.id=s.account_user_id left join users legacy on legacy.auth_user_id=s.user_id
 where s.salon_id=p_salon and s.is_active and s.pos_enabled and (p_ids is null or s.id=any(p_ids)))
 select jsonb_build_object('today',day.d,'staff',coalesce((select jsonb_agg(item) from members),'[]'::jsonb),
 'acknowledgedOperationIds',coalesce((select jsonb_agg(operation_id) from pos_portable_operations
 where key_id=p_key and (occurred_at at time zone get_salon_business_timezone(p_salon))::date=day.d),'[]'::jsonb)) from day;
$$;
revoke all on function public.pos_workspace_staff_snapshot(uuid,uuid,uuid[]) from public,anon,authenticated;
create or replace function public.get_pos_workspace_staff(p_key uuid,p_signature text,p_ids uuid[] default null)
returns jsonb language plpgsql security definer set search_path=public as $$
declare salon uuid;begin
 salon:=pos_portable_access_salon_id(p_key,p_signature);
 if salon is null or not (pos_portable_access_has_capability(p_key,p_signature,'portable.pos.use') or pos_portable_access_has_capability(p_key,p_signature,'portable.checkin.use')) then raise exception 'Not authorized';end if;
 return pos_workspace_staff_snapshot(salon,p_key,p_ids);
end;$$;
revoke all on function public.get_pos_workspace_staff(uuid,text,uuid[]) from public;
grant execute on function public.get_pos_workspace_staff(uuid,text,uuid[]) to anon,authenticated;
create or replace function public.get_owner_workspace_staff(p_salon uuid,p_ids uuid[] default null)
returns jsonb language plpgsql security definer set search_path=public as $$begin
 if auth.uid() is null or not user_has_salon_permission(p_salon,array['tickets.manage']) then raise exception 'Not authorized';end if;
 return pos_workspace_staff_snapshot(p_salon,null,p_ids);
end;$$;
revoke all on function public.get_owner_workspace_staff(uuid,uuid[]) from public,anon;
grant execute on function public.get_owner_workspace_staff(uuid,uuid[]) to authenticated;

-- A browser profile and the Windows app each own a display draft. The first
-- binding adopts the old draft, retaining the existing paired customer screen.
create table if not exists public.pos_workspace_drafts(
 key_id uuid not null references pos_portable_access_keys(id),device_id uuid not null,
 draft_id uuid not null unique references pos_live_drafts(id),primary key(key_id,device_id));
alter table public.pos_workspace_drafts enable row level security;
revoke all on public.pos_workspace_drafts from anon,authenticated;
create or replace function public.get_pos_workspace_draft(p_key uuid,p_signature text,p_device uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare salon uuid;draft pos_live_drafts%rowtype;result jsonb;begin
 salon:=pos_portable_access_salon_id(p_key,p_signature);
 if salon is null or p_device is null or not pos_portable_access_has_capability(p_key,p_signature,'portable.pos.use') then raise exception 'Not authorized';end if;
 perform pg_advisory_xact_lock(hashtextextended('pos-display-binding:'||salon::text,0));
 select d.* into draft from pos_workspace_drafts b join pos_live_drafts d on d.id=b.draft_id where b.key_id=p_key and b.device_id=p_device;
 if draft.id is null then
   if not exists(select 1 from pos_workspace_drafts b join pos_live_drafts d on d.id=b.draft_id where d.salon_id=salon) then
     select * into draft from pos_live_drafts where salon_id=salon order by updated_at desc limit 1;
   end if;
   if draft.id is null then
     insert into pos_live_drafts(salon_id,token) values(salon,replace(gen_random_uuid()::text,'-','')) returning * into draft;
   end if;
   insert into pos_workspace_drafts values(p_key,p_device,draft.id);
 end if;
 select to_jsonb(s) into result from get_pos_live_draft_by_token(draft.token) s limit 1;
 return result;
end;$$;
revoke all on function public.get_pos_workspace_draft(uuid,text,uuid) from public;
grant execute on function public.get_pos_workspace_draft(uuid,text,uuid) to anon,authenticated;

notify pgrst,'reload schema';
commit;
