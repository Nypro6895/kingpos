begin;

-- New metadata is explicit. Earlier immutable facts are classified at read time.
alter table public.financial_input_events add column event_action text check(event_action in ('draft','created','updated'));
alter table public.financial_input_event_staff add column event_action text check(event_action in ('draft','created','updated'));
create index financial_input_ticket_lifecycle on public.financial_input_events(salon_id,source_id,created_at,id) where kind='ticket';

create function public.classify_financial_input_event(p_salon uuid,p_kind text,p_source uuid,p_before jsonb,p_after jsonb,p_created_at timestamptz,p_event_id uuid default null) returns text
language plpgsql stable security definer set search_path=pg_catalog,public as $$
declare initial_draft boolean;
begin
 if p_kind<>'ticket' then return case when p_kind in ('payroll_settings','daily_report') and p_before='{}'::jsonb then 'created' else 'updated' end;end if;
 if p_before->>'status'='closed' or (p_source is not null and exists(
  select 1 from public.financial_input_events prior where prior.salon_id=p_salon and prior.kind='ticket' and prior.source_id=p_source
   and prior.created_at<p_created_at and prior.id is distinct from p_event_id
   and (prior.before_values->>'status'='closed' or prior.after_values->>'status'='closed')
 )) then return 'updated';end if;
 initial_draft:=(p_before='{}'::jsonb and p_after->>'status'='open') or (p_source is not null and exists(
  select 1 from public.financial_input_events prior where prior.salon_id=p_salon and prior.kind='ticket' and prior.source_id=p_source
   and prior.created_at<p_created_at and prior.id is distinct from p_event_id and prior.before_values='{}'::jsonb and prior.after_values->>'status'='open'
 ));
 if p_after->>'status'='closed' then return case when p_before='{}'::jsonb or initial_draft then 'created' else 'updated' end;end if;
 if initial_draft and p_after->>'status' in ('open','cancelled') then return 'draft';end if;
 if p_before='{}'::jsonb then return 'created';end if;
 -- No captured initial or completed state: retain a real legacy edit rather
 -- than inferring that an old reopened ticket was never submitted.
 return 'updated';
end;$$;

create function public.financial_notice_text(p_value text,p_fallback text default '') returns text
language sql immutable set search_path=pg_catalog as $$
 select case when nullif(btrim(p_value),'') is null or btrim(p_value) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  then p_fallback else left(regexp_replace(btrim(p_value),'[[:cntrl:]]',' ','g'),300) end;
$$;
create function public.financial_notice_money(p_value jsonb) returns text
language plpgsql immutable set search_path=pg_catalog as $$
begin
 if p_value is null or p_value='null'::jsonb then return '—';end if;
 return '$'||to_char((p_value#>>'{}')::numeric,'FM999999999990.00');
exception when invalid_text_representation or numeric_value_out_of_range then return 'Recorded';end;$$;

create function public.financial_input_staff_recipient(p_salon uuid,p_staff uuid) returns uuid
language plpgsql stable security definer set search_path=pg_catalog,public as $$
declare s public.staff%rowtype; recipient uuid; matches integer;
begin
 select * into s from public.staff where id=p_staff and salon_id=p_salon and is_active;if not found then return null;end if;
 if s.account_user_id is not null then
  select u.id into recipient from public.users u where u.id=s.account_user_id and u.status='active';
  select count(*) into matches from public.staff own where own.salon_id=p_salon and own.is_active and own.account_user_id=recipient;
  return case when matches=1 then recipient end;
 end if;
 select count(*),min(u.id::text)::uuid into matches,recipient from public.users u where u.auth_user_id=s.user_id and u.status='active';
 if matches<>1 or exists(select 1 from public.staff own where own.salon_id=p_salon and own.is_active and own.account_user_id=recipient) then return null;end if;
 select count(*) into matches from public.staff own where own.salon_id=p_salon and own.is_active and own.account_user_id is null and own.user_id=s.user_id;
 return case when matches=1 then recipient end;
end;
$$;
create function public.financial_input_ticket_owners(p_salon uuid) returns table(user_id uuid)
language sql stable security definer set search_path=pg_catalog,public as $$
 select distinct member.user_id from (
  select m.user_id from public.locations l join public.account_memberships m on m.account_id=l.account_id join public.roles r on r.id=m.role_id
   where l.id=p_salon and m.status='active' and r.code='OWNER'
  union select m.user_id from public.salon_memberships m join public.roles r on r.id=m.role_id
   where m.salon_id=p_salon and m.status='active' and r.code='OWNER'
 ) member join public.users u on u.id=member.user_id and u.status='active';
$$;

create function public.financial_ticket_staff_values(p_values jsonb,p_staff uuid) returns jsonb
language sql immutable set search_path=pg_catalog,public as $$
 select case when p_values='{}'::jsonb or jsonb_typeof(p_values->'staff_totals')='object'
  then coalesce(p_values->'staff_totals'->p_staff::text,jsonb_build_object('service_total',0,'tip_amount',0)) else '{}'::jsonb end ||
 case when p_values?'ticket_number' then jsonb_build_object('ticket_number',p_values->'ticket_number') else '{}'::jsonb end ||
 case when p_values?'status' then jsonb_build_object('status',p_values->'status') else '{}'::jsonb end ||
 case when p_values='{}'::jsonb or jsonb_typeof(p_values->'lines')='array' then jsonb_build_object('lines',coalesce((
  select jsonb_agg(jsonb_build_object('line_id',line->'id','service_name',line->'service_name','staff_name',line->'staff_name',
   'service_total',line->'service_total','unit_price',line->'unit_price','quantity',line->'quantity','parts',line->'parts','notes',line->'notes') order by line->>'id')
  from jsonb_array_elements(coalesce(p_values->'lines','[]'::jsonb)) line where line->>'staff_id'=p_staff::text),'[]'::jsonb)) else '{}'::jsonb end;
$$;

create function public.financial_ticket_staff_context(p_before jsonb,p_after jsonb,p_staff uuid) returns jsonb
language plpgsql immutable set search_path=pg_catalog,public as $$
declare b jsonb:=public.financial_ticket_staff_values(p_before,p_staff);a jsonb:=public.financial_ticket_staff_values(p_after,p_staff);
 flags text[]:=array[]::text[]; old_line jsonb; new_line jsonb; relevant boolean;
begin
 if b->'service_total' is distinct from a->'service_total' then flags:=array_append(flags,'service_price');end if;
 if b->'tip_amount' is distinct from a->'tip_amount' then flags:=array_append(flags,'tip');end if;
 if b->'status' is distinct from a->'status' then flags:=array_append(flags,'status');end if;
 for old_line in select value from jsonb_array_elements(b->'lines') loop
  select value into new_line from jsonb_array_elements(a->'lines') where value->>'line_id'=old_line->>'line_id';
  if new_line is null then
   flags:=array_append(flags,'service_removed');
   if exists(select 1 from jsonb_array_elements(coalesce(p_after->'lines','[]'::jsonb)) line where line->>'id'=old_line->>'line_id' and line->>'staff_id' is distinct from p_staff::text) then flags:=array_append(flags,'staff_assignment');end if;
  else
   if old_line->'service_name' is distinct from new_line->'service_name' then flags:=array_append(flags,'service_name');end if;
   if old_line->'service_total' is distinct from new_line->'service_total' or old_line->'unit_price' is distinct from new_line->'unit_price' or old_line->'quantity' is distinct from new_line->'quantity' then flags:=array_append(flags,'service_price');end if;
   if old_line->'parts' is distinct from new_line->'parts' then flags:=array_append(flags,'service_split');end if;
   if old_line->'notes' is distinct from new_line->'notes' then flags:=array_append(flags,'service_note');end if;
  end if;
 end loop;
 for new_line in select value from jsonb_array_elements(a->'lines') loop
  if not exists(select 1 from jsonb_array_elements(b->'lines') line where line->>'line_id'=new_line->>'line_id') then
   flags:=array_append(flags,'service_added');
   if exists(select 1 from jsonb_array_elements(coalesce(p_before->'lines','[]'::jsonb)) line where line->>'id'=new_line->>'line_id' and line->>'staff_id' is distinct from p_staff::text) then flags:=array_append(flags,'staff_assignment');end if;
  end if;
 end loop;
 if p_before->'discount_amount' is distinct from p_after->'discount_amount' or p_before->'discount_type' is distinct from p_after->'discount_type' or p_before->'discount_value' is distinct from p_after->'discount_value' then flags:=array_append(flags,'discount');end if;
 if p_before->'tax_rate' is distinct from p_after->'tax_rate' then flags:=array_append(flags,'tax');end if;
 if p_before->'notes' is distinct from p_after->'notes' then flags:=array_append(flags,'note');end if;
 if p_before->'payments' is distinct from p_after->'payments' then flags:=array_append(flags,'payment');end if;
 select coalesce(array_agg(distinct flag order by flag),array[]::text[]) into flags from unnest(flags) flag;
 relevant:=b-'ticket_number' is distinct from a-'ticket_number' or cardinality(flags)>0;
 return jsonb_build_object('before_values',b,'after_values',a||jsonb_build_object('ticket_changes',to_jsonb(flags)),'relevant',relevant);
end;$$;

create or replace function public.pos_ticket_input_staff_changes(p_before jsonb,p_after jsonb) returns jsonb
language sql immutable set search_path=pg_catalog,public,pg_temp as $$
 select coalesce(jsonb_agg(jsonb_build_object('staff_id',s.id,'before_values',context.values->'before_values','after_values',context.values->'after_values') order by s.id),'[]'::jsonb)
 from (select jsonb_object_keys(coalesce(p_before->'staff_totals','{}'::jsonb)) as id
  union select jsonb_object_keys(coalesce(p_after->'staff_totals','{}'::jsonb))) s
 cross join lateral (select public.financial_ticket_staff_context(p_before,p_after,s.id::uuid) as values) context
 where (context.values->>'relevant')::boolean;
$$;

-- Safe context comes only from captured before/after snapshots, never today's
-- catalog/pay settings. Staff cannot use this RPC to read a parent or coworker.
create function public.get_financial_input_event_metadata(p_event_ids uuid[])
returns table(event_id uuid,event_action text,ticket_number text,before_context jsonb,after_context jsonb)
language plpgsql stable security definer set search_path=pg_catalog,public as $$
begin
 if public.current_public_user_id() is null then raise exception 'Sign in required' using errcode='42501';end if;
 if coalesce(cardinality(p_event_ids),0)>500 then raise exception 'Choose up to 500 events' using errcode='22023';end if;
 return query select e.id,coalesce(e.event_action,public.classify_financial_input_event(e.salon_id,e.kind,e.source_id,e.before_values,e.after_values,e.created_at,e.id)),
  public.financial_notice_text(coalesce(e.after_values->>'ticket_number',e.before_values->>'ticket_number'),''),
  case when e.kind='ticket' and own.staff_id is not null then context.values->'before_values' end,
  case when e.kind='ticket' and own.staff_id is not null then context.values->'after_values' end
 from public.financial_input_events e
 cross join lateral (select public.payroll_live_is_owner(e.salon_id) or public.financial_input_manager_can_read(e.salon_id,e.kind) as all_rows) access
 left join public.financial_input_event_staff own on own.event_id=e.id and own.staff_id=public.current_user_staff_id_for_salon(e.salon_id)
 cross join lateral (select case when own.staff_id is not null then public.financial_ticket_staff_context(e.before_values,e.after_values,own.staff_id) end as values) context
 where e.id=any(coalesce(p_event_ids,array[]::uuid[])) and (access.all_rows or own.staff_id is not null);
end;$$;
revoke all on function public.get_financial_input_event_metadata(uuid[]) from public,anon;
grant execute on function public.get_financial_input_event_metadata(uuid[]) to authenticated;

-- Raw correction cards predate the logical event history. Keep their captured
-- facts, but classify the same operation consistently in every reader. New
-- writes carry an exact link; never reconstruct a link from nearby timestamps.
alter table public.pos_ticket_adjustments add column financial_input_event_id uuid references public.financial_input_events(id);
create index pos_ticket_adjustments_financial_event on public.pos_ticket_adjustments(financial_input_event_id) where financial_input_event_id is not null;

create function public.classify_pos_ticket_adjustment(p_adjustment public.pos_ticket_adjustments) returns text
language plpgsql stable security definer set search_path=pg_catalog,public as $$
declare result text; before_status text:=p_adjustment.before_snapshot#>>'{ticket,status}';
 after_status text:=p_adjustment.after_snapshot#>>'{ticket,status}'; prior_version timestamptz; evidence_before timestamptz:=p_adjustment.created_at;
begin
 if p_adjustment.financial_input_event_id is not null then
  select coalesce(e.event_action,public.classify_financial_input_event(e.salon_id,e.kind,e.source_id,e.before_values,e.after_values,e.created_at,e.id)) into result
  from public.financial_input_events e where e.id=p_adjustment.financial_input_event_id and e.salon_id=p_adjustment.salon_id and e.kind='ticket' and e.source_id=p_adjustment.ticket_id;
  return coalesce(result,'updated');
 end if;
 if before_status='closed' then return 'updated';end if;
 if before_status is null or after_status is null then return 'updated';end if;
 -- A transaction can start before waiting for another ticket writer. The
 -- version captured BEFORE this operation is also safe causal evidence of a
 -- previous completed save; the operation's own after-snapshot is never used.
 begin prior_version:=(p_adjustment.before_snapshot#>>'{ticket,updated_at}')::timestamptz;
 exception when invalid_datetime_format or datetime_field_overflow then prior_version:=null;end;
 evidence_before:=greatest(evidence_before,prior_version);
 if exists(select 1 from public.financial_input_events e where e.salon_id=p_adjustment.salon_id and e.kind='ticket' and e.source_id=p_adjustment.ticket_id
  and e.created_at<evidence_before and (e.before_values->>'status'='closed' or e.after_values->>'status'='closed')) then return 'updated';end if;
 if exists(select 1 from public.financial_input_events e where e.salon_id=p_adjustment.salon_id and e.kind='ticket' and e.source_id=p_adjustment.ticket_id
  and e.created_at<p_adjustment.created_at and e.before_values='{}'::jsonb and e.after_values->>'status'='open') then
  if after_status='closed' then return 'created';end if;
  if after_status in ('open','cancelled') then return 'draft';end if;
 end if;
 -- Missing lifecycle evidence can include an old reopened receipt. Preserve
 -- that correction rather than silently hiding an uncertain historical edit.
 return 'updated';
end;$$;
revoke all on function public.classify_pos_ticket_adjustment(public.pos_ticket_adjustments) from public,anon,authenticated,service_role;

create function public.get_pos_ticket_adjustment_metadata(p_adjustment_ids uuid[])
returns table(adjustment_id uuid,event_action text)
language plpgsql stable security definer set search_path=pg_catalog,public as $$
begin
 if public.current_public_user_id() is null then raise exception 'Sign in required' using errcode='42501';end if;
 if coalesce(cardinality(p_adjustment_ids),0)>500 then raise exception 'Choose up to 500 adjustments' using errcode='22023';end if;
 return query select a.id,public.classify_pos_ticket_adjustment(a) from public.pos_ticket_adjustments a
 where a.id=any(coalesce(p_adjustment_ids,array[]::uuid[]))
  and (public.payroll_live_is_owner(a.salon_id) or public.financial_input_manager_can_read(a.salon_id,'ticket'));
end;$$;
revoke all on function public.get_pos_ticket_adjustment_metadata(uuid[]) from public,anon;
grant execute on function public.get_pos_ticket_adjustment_metadata(uuid[]) to authenticated;

do $patch$declare d text; signature text; insertion text;begin
 foreach signature in array array[
  'public.save_pos_ticket_inputs(uuid,text,uuid,uuid,bigint,jsonb,jsonb,jsonb,jsonb,numeric,text,text,numeric,uuid)',
  'public.mutate_owner_ticket_inputs(uuid,uuid,bigint,uuid,text,jsonb,text)'
 ] loop
  d:=replace(pg_get_functiondef(signature::regprocedure),E'\r\n',E'\n');
  if position('event uuid;' in d)=0 or position('old_snapshot,after_snapshot,public.current_public_user_id());' in d)=0 and position('old_snapshot,public.pos_ticket_correction_snapshot(p_salon,p_ticket),public.current_public_user_id());' in d)=0 then raise exception 'Review exact ticket adjustment event boundary: %',signature;end if;
  d:=replace(d,'event uuid;','event uuid; raw_adjustment uuid;');
  d:=replace(d,'old_snapshot,after_snapshot,public.current_public_user_id());','old_snapshot,after_snapshot,public.current_public_user_id()) returning id into raw_adjustment;');
  d:=replace(d,'old_snapshot,public.pos_ticket_correction_snapshot(p_salon,p_ticket),public.current_public_user_id());','old_snapshot,public.pos_ticket_correction_snapshot(p_salon,p_ticket),public.current_public_user_id()) returning id into raw_adjustment;');
  insertion:=case when signature like 'public.save_%' then E'  perform public.reconcile_daily_inputs(salon,work_date);' else E'  if p_operation in (''checkout'',''void'',''reopen'') then perform public.reconcile_daily_inputs(p_salon,day);end if;' end;
  if position(insertion in d)=0 then raise exception 'Review final ticket event linking boundary: %',signature;end if;
  d:=replace(d,insertion,E'  update public.pos_ticket_adjustments set financial_input_event_id=event where id=raw_adjustment;\n'||insertion);execute d;
 end loop;
 d:=pg_get_functiondef('public.get_pos_portable_ticket_data(uuid,text,date)'::regprocedure);
 if position('''action'', pos_ticket_adjustments.action,' in d)=0 then raise exception 'Review signed Portable correction metadata';end if;
 d:=replace(d,'''action'', pos_ticket_adjustments.action,','''action'', pos_ticket_adjustments.action, ''eventAction'', public.classify_pos_ticket_adjustment(pos_ticket_adjustments),');execute d;
end;$patch$;

create function public.financial_input_notice_summary(p_kind text,p_before jsonb,p_after jsonb,p_own boolean default false,p_action text default 'updated') returns text
language plpgsql immutable set search_path=pg_catalog,public as $$
declare result text[]:=array[]::text[]; field text; title text; old_line jsonb; new_line jsonb; old_names text; new_names text; old_parts text; new_parts text; flag text;
begin
 if p_action='created' and p_kind='ticket' then
  select string_agg(distinct public.financial_notice_text(line->>'service_name','Service'),', ') into new_names from jsonb_array_elements(coalesce(p_after->'lines','[]'::jsonb)) line;
  return concat_ws('; ',nullif(new_names,''),'Service sales '||public.financial_notice_money(p_after->'service_total'),'tips '||public.financial_notice_money(p_after->'tip_amount'));
 end if;
 for field,title in select * from (values('service_total','Service sales'),('tip_amount','Tips'),('bonus_amount','Bonus'),('commission_rate','Commission'),('fixed_pay_amount','Fixed pay'),('check_rate','Check split'),('tax_rate','Tax'),('tip_payout_method','Tip payout'),('bonus_payout_method','Bonus payout'),('cash_amount','Cash'),('credit_card_amount','Card'),('other_amount','Other'),('tip_input','Entered tips'),('status','Ticket status')) labels(key,label) loop
  if p_before->field is not distinct from p_after->field then continue;end if;
  if field in ('service_total','tip_amount','bonus_amount','fixed_pay_amount','cash_amount','credit_card_amount','other_amount','tip_input') then
   result:=array_append(result,title||': '||public.financial_notice_money(p_before->field)||' → '||public.financial_notice_money(p_after->field));
  else
   result:=array_append(result,title||': '||coalesce(nullif(public.financial_notice_text(p_before->>field),''),'—')||case when field in ('commission_rate','check_rate','tax_rate') and p_before->>field is not null then '%' else '' end||' → '||coalesce(nullif(public.financial_notice_text(p_after->>field),''),'—')||case when field in ('commission_rate','check_rate','tax_rate') and p_after->>field is not null then '%' else '' end);
  end if;
 end loop;
 if p_kind='ticket' then
  select string_agg(public.financial_notice_text(line->>'service_name','Service'),', ' order by ordinal) into old_names from jsonb_array_elements(coalesce(p_before->'lines','[]'::jsonb)) with ordinality lines(line,ordinal);
  select string_agg(public.financial_notice_text(line->>'service_name','Service'),', ' order by ordinal) into new_names from jsonb_array_elements(coalesce(p_after->'lines','[]'::jsonb)) with ordinality lines(line,ordinal);
  if old_names is distinct from new_names then result:=array_append(result,'Services: '||coalesce(old_names,'—')||' → '||coalesce(new_names,'—'));end if;
  for old_line in select value from jsonb_array_elements(coalesce(p_before->'lines','[]'::jsonb)) loop
   select value into new_line from jsonb_array_elements(coalesce(p_after->'lines','[]'::jsonb)) where coalesce(value->>'line_id',value->>'id')=coalesce(old_line->>'line_id',old_line->>'id');
   if new_line is null then
    result:=array_append(result,public.financial_notice_text(old_line->>'service_name','Service')||case when p_own then ' removed from your work' else ' removed' end||': '||public.financial_notice_money(old_line->'service_total'));continue;
   end if;
   title:=public.financial_notice_text(new_line->>'service_name','Service');
   if old_line->'service_total' is distinct from new_line->'service_total' then result:=array_append(result,title||': '||public.financial_notice_money(old_line->'service_total')||' → '||public.financial_notice_money(new_line->'service_total'));end if;
   if old_line->'unit_price' is distinct from new_line->'unit_price' then result:=array_append(result,title||' unit price: '||public.financial_notice_money(old_line->'unit_price')||' → '||public.financial_notice_money(new_line->'unit_price'));end if;
   if old_line->'quantity' is distinct from new_line->'quantity' then result:=array_append(result,title||' quantity: '||coalesce(old_line->>'quantity','—')||' → '||coalesce(new_line->>'quantity','—'));end if;
   if old_line->'notes' is distinct from new_line->'notes' then result:=array_append(result,title||' note updated');end if;
   if not p_own and old_line->'staff_name' is distinct from new_line->'staff_name' then result:=array_append(result,title||' Staff: '||public.financial_notice_text(old_line->>'staff_name','Unassigned')||' → '||public.financial_notice_text(new_line->>'staff_name','Unassigned'));end if;
   if old_line->'parts' is distinct from new_line->'parts' then
    select string_agg(public.financial_notice_money(value),' + ') into old_parts from jsonb_array_elements(coalesce(old_line->'parts','[]'::jsonb));
    select string_agg(public.financial_notice_money(value),' + ') into new_parts from jsonb_array_elements(coalesce(new_line->'parts','[]'::jsonb));
    result:=array_append(result,title||' split: '||coalesce(old_parts,'—')||' → '||coalesce(new_parts,'—'));
   end if;
  end loop;
  for new_line in select value from jsonb_array_elements(coalesce(p_after->'lines','[]'::jsonb)) loop
   if not exists(select 1 from jsonb_array_elements(coalesce(p_before->'lines','[]'::jsonb)) line where coalesce(line->>'line_id',line->>'id')=coalesce(new_line->>'line_id',new_line->>'id')) then
    result:=array_append(result,public.financial_notice_text(new_line->>'service_name','Service')||case when p_own then ' added to your work' else ' added' end||': '||public.financial_notice_money(new_line->'service_total'));
   end if;
  end loop;
  if not p_own and (p_before->'discount_amount' is distinct from p_after->'discount_amount' or p_before->'discount_type' is distinct from p_after->'discount_type') then result:=array_append(result,'Customer discount: '||public.financial_notice_money(p_before->'discount_amount')||' → '||public.financial_notice_money(p_after->'discount_amount'));end if;
  if not p_own and p_before->'recorded_payment_total' is distinct from p_after->'recorded_payment_total' then result:=array_append(result,'Ticket payments: '||public.financial_notice_money(p_before->'recorded_payment_total')||' → '||public.financial_notice_money(p_after->'recorded_payment_total'));end if;
  if p_before->'notes' is distinct from p_after->'notes' then result:=array_append(result,'Ticket note updated');end if;
  if p_own then
   for flag in select jsonb_array_elements_text(coalesce(p_after->'ticket_changes','[]'::jsonb)) loop
    if flag in ('discount','tax','note','payment','staff_assignment') then result:=array_append(result,case flag when 'discount' then 'Ticket discount changed' when 'tax' then 'Ticket tax changed' when 'note' then 'Ticket note updated' when 'payment' then 'Ticket payment changed' else 'Your Staff assignment changed' end);end if;
   end loop;
  end if;
 end if;
 if p_kind='payroll_settings' then
  for field in select jsonb_object_keys(p_after||p_before) loop
   if field in ('pay_type','effective_from','effective_to','tax_tips','tax_bonus','apply_tax_to_fixed_pay','cash_to_tax_company','tax_company_enabled','legal_name') and p_before->field is distinct from p_after->field then
    title:=initcap(replace(field,'_',' '));result:=array_append(result,title||': '||coalesce(nullif(public.financial_notice_text(p_before->>field),''),'—')||' → '||coalesce(nullif(public.financial_notice_text(p_after->>field),''),'—'));
   end if;
  end loop;
 end if;
 return left(array_to_string(result,'; '),1500);
end;$$;

create or replace function public.record_financial_input_event(
 p_salon uuid,p_kind text,p_business_date date,p_source_id uuid,p_before jsonb,p_after jsonb,p_note text,
 p_staff_changes jsonb default '[]',p_request uuid default null,p_notify_staff boolean default true
) returns uuid language plpgsql security definer set search_path=pg_catalog,public as $$
declare ev public.financial_input_events%rowtype; actor uuid:=public.current_public_user_id(); actor_label text;
 action text; item jsonb; staff_key uuid; staff_label text; recipient uuid; owners uuid[]:=array[]::uuid[]; number text; title text; body text; link text; summary text;
begin
 if p_kind not in ('ticket','staff_day','daily_report','payroll_settings') or p_business_date is null or p_salon is null
  or jsonb_typeof(p_before)<>'object' or jsonb_typeof(p_after)<>'object' or jsonb_typeof(p_staff_changes)<>'array' then raise exception 'Invalid financial event';end if;
 if p_request is not null then
  perform pg_advisory_xact_lock(hashtextextended(p_salon::text||':'||p_kind||':'||p_request::text,0));
  select * into ev from public.financial_input_events where salon_id=p_salon and kind=p_kind and request_id=p_request;
  if found then
   if ev.source_id is distinct from p_source_id or ev.after_values<>p_after or ev.note<>btrim(coalesce(p_note,'')) then raise exception 'This request belongs to a different financial event';end if;
   return ev.id;
  end if;
 end if;
 if p_before=p_after then return null;end if;
 action:=public.classify_financial_input_event(p_salon,p_kind,p_source_id,p_before,p_after,clock_timestamp(),null);
 select coalesce(nullif(btrim(u.display_name),''),'Owner') into actor_label from public.users u where u.id=actor;
 actor_label:=coalesce(actor_label,case when p_kind='ticket' then 'POS' when p_kind='daily_report' and current_setting('reylumi.signed_closing_salon',true)=p_salon::text then 'Portable POS' else 'System' end);
 insert into public.financial_input_events(salon_id,kind,business_date,source_id,request_id,before_values,after_values,note,actor_id,actor_name,event_action)
  values(p_salon,p_kind,p_business_date,p_source_id,p_request,p_before,p_after,btrim(coalesce(p_note,'')),actor,actor_label,action) returning * into ev;
 number:=public.financial_notice_text(coalesce(p_after->>'ticket_number',p_before->>'ticket_number'),'');
 if p_kind='ticket' and action<>'draft' then
  select coalesce(array_agg(o.user_id),array[]::uuid[]) into owners from public.financial_input_ticket_owners(p_salon) o;
  title:=concat_ws(' ','Ticket',nullif(number,''),case when action='created' then 'recorded' else 'updated' end);
  summary:=public.financial_input_notice_summary(p_kind,p_before,p_after,false,action);
  body:='Business date '||p_business_date::text||'. '||coalesce(nullif(summary,''),'Recorded ticket details updated.');
  link:='/staff/today?inputEvent='||ev.id::text||'&eventDate='||p_business_date::text||case when action='created' then '#ticket-record' else '#input-history' end;
  insert into public.app_notifications(account_id,salon_id,recipient_user_id,recipient_kind,notification_type,title,body,href,event_key)
   select l.account_id,p_salon,owner_id,'owner_manager',case when action='created' then 'ticket_recorded' else 'financial_input_updated' end,title,body,link,'financial-input-owner:'||ev.id::text||':'||owner_id::text
   from public.locations l cross join unnest(owners) owner_id where l.id=p_salon on conflict do nothing;
 end if;
 for item in select value from jsonb_array_elements(p_staff_changes) loop
  staff_key:=(item->>'staff_id')::uuid;
  select coalesce(nullif(s.display_name,''),'Staff') into staff_label from public.staff s where s.id=staff_key and s.salon_id=p_salon;
  if not found then raise exception 'Financial event Staff is outside the salon';end if;
  if jsonb_typeof(item->'before_values')<>'object' or jsonb_typeof(item->'after_values')<>'object' then raise exception 'Invalid Staff event values';end if;
  if p_kind='ticket' and action='updated' and item->'before_values'=item->'after_values' then continue;end if;
  insert into public.financial_input_event_staff(event_id,salon_id,staff_id,staff_name,kind,business_date,before_values,after_values,note,actor_name,created_at,event_action)
   values(ev.id,p_salon,staff_key,staff_label,p_kind,p_business_date,item->'before_values',item->'after_values',ev.note,ev.actor_name,ev.created_at,action) on conflict(event_id,staff_id) do nothing;
  recipient:=public.financial_input_staff_recipient(p_salon,staff_key);
  if action='draft' or not p_notify_staff or recipient is null or p_kind='daily_report' or (p_kind='ticket' and recipient=any(owners)) then continue;end if;
  summary:=public.financial_input_notice_summary(p_kind,item->'before_values',item->'after_values',true,action);
  if summary='' then continue;end if;
  title:=case p_kind when 'ticket' then concat_ws(' ','Ticket',nullif(number,''),case when action='created' then 'recorded' else 'updated' end)
   when 'staff_day' then 'Daily service / tips updated' else case when action='created' then 'Pay settings configured' else 'Pay settings updated' end end;
  body:='Business date '||p_business_date::text||'. '||summary;
  link:=case when p_kind='ticket' then '/staff/my-work?inputEvent='||ev.id::text||'&eventDate='||p_business_date::text||case when action='created' then '#ticket-record' else '#input-history' end
   else '/staff/my-work?tab=payroll&inputEvent='||ev.id::text||'&payPeriodStart='||p_business_date::text||'#input-history' end;
  insert into public.app_notifications(account_id,salon_id,recipient_user_id,recipient_kind,notification_type,title,body,href,event_key)
   select l.account_id,p_salon,recipient,'staff',case when p_kind='ticket' and action='created' then 'ticket_recorded' when p_kind='payroll_settings' and action='created' then 'payroll_settings_configured' else 'financial_input_updated' end,
    title,body,link,'financial-input:'||ev.id::text||':'||staff_key::text from public.locations l where l.id=p_salon on conflict do nothing;
 end loop;
 return ev.id;
end;$$;

-- Existing period input audits stay immutable. Initializing a row with bonus=0
-- is not a bonus change; a real bonus edit names its actual before/after amount.
do $patch$declare d text;begin
 d:=replace(pg_get_functiondef('public.audit_payroll_live_change()'::regprocedure),E'\r\n',E'\n');
 if position('tg_table_name=''payroll_period_staff_inputs'' and b->''bonus_amount'' is distinct from a->''bonus_amount''' in d)=0
  or position('Your period inputs changed. View the recorded values and note.' in d)=0 then raise exception 'Review period bonus notification boundary';end if;
 d:=replace(d,'tg_table_name=''payroll_period_staff_inputs'' and b->''bonus_amount'' is distinct from a->''bonus_amount''',
  'tg_table_name=''payroll_period_staff_inputs'' and coalesce((b->>''bonus_amount'')::numeric,0) is distinct from coalesce((a->>''bonus_amount'')::numeric,0)');
 d:=replace(d,'''Payroll inputs updated''','''Bonus updated''');
 d:=replace(d,'''Your period inputs changed. View the recorded values and note.''',
  '''Period ''||starts::text||'' – ''||ends::text||''. Bonus: ''||public.financial_notice_money(coalesce(b->''bonus_amount'',''0''::jsonb))||'' → ''||public.financial_notice_money(coalesce(a->''bonus_amount'',''0''::jsonb))');
 d:=replace(d,'''/staff/my-work?tab=payroll&payPeriodStart=''||starts::text||''#input-history''',
  '''/staff/my-work?tab=payroll&inputEvent=''||audit_id::text||''&payPeriodStart=''||starts::text||''#input-history''');
 d:=replace(d,'sid,s.account_user_id,''staff''','sid,public.financial_input_staff_recipient(sid,recipient_staff),''staff''');
 d:=replace(d,'s.id=recipient_staff and s.account_user_id is not null','s.id=recipient_staff and public.financial_input_staff_recipient(sid,recipient_staff) is not null');execute d;
end;$patch$;

-- Hide only duplicate delivery of the very same financial event, and provable
-- old bonus-zero initialization notices. Feed, unread count and mark-all share
-- this predicate; notification rows and their read state remain untouched.
create function public.financial_notice_suppressed(n public.app_notifications) returns boolean
language plpgsql stable security definer set search_path=pg_catalog,public as $$
begin
 if n.event_key ~* '^financial-input(-owner)?:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
 if exists(
  select 1 from public.financial_input_events e where e.id=split_part(n.event_key,':',2)::uuid and e.salon_id=n.salon_id and e.kind='ticket'
   and coalesce(e.event_action,public.classify_financial_input_event(e.salon_id,e.kind,e.source_id,e.before_values,e.after_values,e.created_at,e.id))='draft'
   and (n.event_key='financial-input-owner:'||e.id::text||':'||n.recipient_user_id::text or exists(
    select 1 from public.financial_input_event_staff own where own.event_id=e.id and n.event_key='financial-input:'||e.id::text||':'||own.staff_id::text))
 ) then return true;end if;end if;
 if n.recipient_kind='staff' and n.event_key ~* '^financial-input:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
 return exists(
  select 1 from public.financial_input_event_staff s join public.app_notifications owner_notice
   on owner_notice.recipient_user_id=n.recipient_user_id and owner_notice.salon_id=n.salon_id
    and owner_notice.recipient_kind='owner_manager'
    and owner_notice.event_key='financial-input-owner:'||s.event_id::text||':'||n.recipient_user_id::text
  where s.event_id=split_part(n.event_key,':',2)::uuid and s.staff_id=split_part(n.event_key,':',3)::uuid
   and s.kind='ticket' and s.salon_id=n.salon_id and n.event_key='financial-input:'||s.event_id::text||':'||s.staff_id::text
 );end if;
 if n.event_key ~* '^period-input:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
 return exists(
  select 1 from public.payroll_live_change_history h where h.id=split_part(n.event_key,':',2)::uuid and n.event_key='period-input:'||h.id::text and h.salon_id=n.salon_id
   and h.source_table='payroll_period_staff_inputs'
   and coalesce((h.before_values->>'bonus_amount')::numeric,0)=0 and coalesce((h.after_values->>'bonus_amount')::numeric,0)=0
 );end if;
 return false;
end;
$$;
revoke all on function public.financial_notice_suppressed(public.app_notifications) from public,anon,authenticated,service_role;
do $patch$declare d text;begin
 d:=pg_get_functiondef('public.notification_visible_to_actor(public.app_notifications)'::regprocedure);
 if position('select n.recipient_user_id=current_public_user_id() and (' in d)=0 then raise exception 'Review shared notification feed visibility';end if;
 d:=replace(d,'select n.recipient_user_id=current_public_user_id() and (',
  'select not public.financial_notice_suppressed(n) and n.recipient_user_id=current_public_user_id() and (');execute d;
end;$patch$;

-- Re-label only deterministically identified old creation notices. Do not alter
-- immutable events, notification IDs, event keys, read_at or creation timestamps.
update public.app_notifications n set notification_type='ticket_recorded',
 title=concat_ws(' ','Ticket',nullif(public.financial_notice_text(e.after_values->>'ticket_number'),''),'recorded'),
 body='Business date '||e.business_date::text||'. '||public.financial_input_notice_summary('ticket','{}'::jsonb,e.after_values,false,'created'),
 href='/staff/today?inputEvent='||e.id::text||'&eventDate='||e.business_date::text||'#ticket-record'
from public.financial_input_events e where e.kind='ticket' and public.classify_financial_input_event(e.salon_id,e.kind,e.source_id,e.before_values,e.after_values,e.created_at,e.id)='created' and n.salon_id=e.salon_id
 and n.event_key='financial-input-owner:'||e.id::text||':'||n.recipient_user_id::text;
update public.app_notifications n set notification_type='ticket_recorded',
 title=concat_ws(' ','Ticket',nullif(public.financial_notice_text(e.after_values->>'ticket_number'),''),'recorded'),
 body='Business date '||e.business_date::text||'. '||public.financial_input_notice_summary('ticket','{}'::jsonb,public.financial_ticket_staff_values(e.after_values,s.staff_id),true,'created'),
 href='/staff/my-work?inputEvent='||e.id::text||'&eventDate='||e.business_date::text||'#ticket-record'
from public.financial_input_events e join public.financial_input_event_staff s on s.event_id=e.id
where e.kind='ticket' and public.classify_financial_input_event(e.salon_id,e.kind,e.source_id,e.before_values,e.after_values,e.created_at,e.id)='created' and n.salon_id=e.salon_id
 and n.event_key='financial-input:'||e.id::text||':'||s.staff_id::text;

revoke all on function public.financial_notice_text(text,text),public.financial_notice_money(jsonb),public.financial_input_staff_recipient(uuid,uuid),
 public.financial_input_ticket_owners(uuid),public.financial_ticket_staff_values(jsonb,uuid),public.financial_ticket_staff_context(jsonb,jsonb,uuid),
 public.financial_input_notice_summary(text,jsonb,jsonb,boolean,text) from public,anon,authenticated,service_role;
revoke all on function public.classify_financial_input_event(uuid,text,uuid,jsonb,jsonb,timestamptz,uuid) from public,anon,authenticated,service_role;
revoke all on function public.record_financial_input_event(uuid,text,date,uuid,jsonb,jsonb,text,jsonb,uuid,boolean) from public,anon,authenticated,service_role;
notify pgrst,'reload schema';
commit;
