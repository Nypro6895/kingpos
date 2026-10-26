begin;
create function public.resolve_display_customer_identity(p_salon uuid,p_name text,p_phone text,p_choice uuid default null,p_new boolean default false)
returns jsonb language plpgsql security definer set search_path=public as $$
declare matches jsonb; selected uuid; linked_count integer;
begin
 perform pg_advisory_xact_lock(hashtextextended('customer-identity:'||p_salon::text,0));
 if normalize_customer_claim_phone(p_phone) is null then return jsonb_build_object('ok',false,'code','invalid_phone','message','Enter a full phone number.'); end if;
 if length(customer_name_key(p_name))<2 then return jsonb_build_object('ok',false,'code','profile_required','message','Enter your name so we can find your profile.'); end if;
 if p_choice is not null then
  select customer_id into selected from customer_identity_candidates(p_salon,p_name,p_phone) where customer_id=p_choice;
  if selected is null then return jsonb_build_object('ok',false,'code','identity_choice_expired','message','The selection changed. Search again.'); end if;
 elsif not p_new then
  -- A tie between genuinely different names/accounts needs customer confirmation.
  select count(distinct c.customer_user_id) into linked_count
   from customer_identity_candidates(p_salon,p_name,p_phone) m join customers c on c.id=m.customer_id where m.automatic;
  if linked_count<=1 and (select count(*) from customer_identity_candidates(p_salon,p_name,p_phone))<8 then
   select m.customer_id into selected from customer_identity_candidates(p_salon,p_name,p_phone) m
   join customers c on c.id=m.customer_id where m.automatic order by m.name_score desc,c.created_at,c.id limit 1;
  end if;
  if selected is null then
   select jsonb_agg(jsonb_build_object('id',c.id,'label',customer_visit_first_name(c.name),
    'phoneHint','••• '||right(regexp_replace(c.phone,'\D','','g'),4),'reason',m.reason)) into matches
   from customer_identity_candidates(p_salon,p_name,p_phone) m join customers c on c.id=m.customer_id;
   if matches is not null then return jsonb_build_object('ok',false,'code','identity_choice_required',
    'message','Is one of these your profile? Choose yours or continue as a new customer.','candidates',matches); end if;
  end if;
 end if;
 return jsonb_build_object('ok',true,'customerId',selected);
end $$;
revoke all on function public.resolve_display_customer_identity(uuid,text,text,uuid,boolean) from public,anon,authenticated;

create table public.customer_identity_checkin_requests (
 display_token text not null,request_id text not null,input jsonb not null,result jsonb not null,
 created_at timestamptz not null default now(),primary key(display_token,request_id)
);
alter table public.customer_identity_checkin_requests enable row level security;
create index customer_identity_checkin_requests_created_idx on public.customer_identity_checkin_requests(created_at);

-- Keep the tested visit/checkout/request-id logic, replacing only identity resolution.
-- Fail the migration if the baseline function shape differs, rather than silently patching nothing.
do $migration$
declare fn text; definition text; patched text;
 old_block text := $old$  select *
  into customer_row
  from public.customers
  where location_id = draft_row.salon_id
    and status = 'active'
    and public.normalize_customer_claim_phone(phone) = normalized_phone
  order by created_at desc
  limit 1;$old$;
begin
 foreach fn in array array['resolve_customer_display_submission','resolve_customer_display_check_in'] loop
  definition:=pg_get_functiondef(to_regprocedure('public.'||fn||'(text,text,text,text)'));
definition:=replace(definition,chr(13),'');
  if position(old_block in definition)=0 then raise exception 'Review % identity resolver before migration',fn; end if;
  patched:=replace(definition,old_block,'');
  if position('  select visits.*' in patched)=0 then raise exception 'Review % waiting lookup',fn; end if;
  patched:=replace(patched,'  select visits.*',$new$
  customer_payload := public.resolve_display_customer_identity(draft_row.salon_id,clean_name,normalized_phone,p_identity_choice,p_new_customer);
  if not (customer_payload->>'ok')::boolean then return customer_payload; end if;
  select * into customer_row from public.customers where id=nullif(customer_payload->>'customerId','')::uuid and location_id=draft_row.salon_id;
  select visits.*
  $new$);
  patched:=replace(patched,'and public.normalize_customer_claim_phone(customers.phone) = normalized_phone',
   'and visits.customer_id = customer_row.id');
  patched:=replace(patched,'  for update;'||chr(10)||chr(10)||'  if draft_row.id is null then',
   ';'||chr(10)||'  if draft_row.id is not null then
    perform pg_advisory_xact_lock(hashtextextended(''customer-identity:''||draft_row.salon_id::text,0));
    select * into draft_row from public.pos_live_drafts where id=draft_row.id for update;
  end if;
  if draft_row.id is null then');
  patched:=replace(patched,'if draft_row.id is null then','if draft_row.id is null or draft_row.status <> ''draft'' then');
  patched:=replace(patched,'public.'||fn||'(','public.'||fn||'_identity(');
  patched:=replace(patched,'p_request_id text DEFAULT NULL::text)',
    'p_request_id text DEFAULT NULL::text, p_identity_choice uuid DEFAULT NULL::uuid, p_new_customer boolean DEFAULT false)');
  if position('p_identity_choice uuid' in patched)=0 then raise exception 'Review % arguments before migration',fn; end if;
  execute patched;
  execute format('revoke all on function public.%I(text,text,text,text,uuid,boolean) from public',fn||'_identity');
  execute format('grant execute on function public.%I(text,text,text,text,uuid,boolean) to anon,authenticated',fn||'_identity');
  -- Existing installed clients get a safe prompt instead of guessing a different customer.
  execute format($wrapper$create or replace function public.%I(p_token text,p_phone text,p_customer_name text default null,p_request_id text default null)
  returns jsonb language sql security definer set search_path=public as 'select public.%I(p_token,p_phone,p_customer_name,p_request_id,null,false)'$wrapper$,fn,fn||'_identity');
 end loop;
end $migration$;

-- Replay successful retries, including an explicit 'new customer' selection.
do $$declare fn text;
begin
 foreach fn in array array['resolve_customer_display_submission','resolve_customer_display_check_in'] loop
  execute format('alter function public.%I(text,text,text,text,uuid,boolean) rename to %I',fn||'_identity',fn||'_identity_core');
  execute format('revoke all on function public.%I(text,text,text,text,uuid,boolean) from public,anon,authenticated',fn||'_identity_core');
  execute format($wrapper$
   create function public.%I(p_token text,p_phone text,p_customer_name text default null,p_request_id text default null,p_identity_choice uuid default null,p_new_customer boolean default false)
   returns jsonb language plpgsql security definer set search_path=public as $body$
   declare previous customer_identity_checkin_requests%%rowtype; result jsonb;
   payload jsonb:=jsonb_build_array(p_phone,p_customer_name,p_identity_choice,p_new_customer);
   begin
    if not exists(select 1 from pos_live_drafts where token=btrim(p_token) and status='draft') then
     return jsonb_build_object('ok',false,'code','not_ready','message','Customer screen is not ready.');
    end if;
    if p_request_id is null or btrim(p_request_id)='' then return public.%I(p_token,p_phone,p_customer_name,p_request_id,p_identity_choice,p_new_customer); end if;
    if length(p_request_id)>200 then raise exception 'Invalid request'; end if;
    perform pg_advisory_xact_lock(hashtextextended('checkin-request:'||p_token||':'||p_request_id,0));
    delete from customer_identity_checkin_requests where created_at<now()-interval '1 day';
    select * into previous from customer_identity_checkin_requests where display_token=p_token and request_id=p_request_id;
    if found then
     if previous.input<>payload then return jsonb_build_object('ok',false,'code','request_changed','message','Start a new check-in after changing your details.'); end if;
     return previous.result;
    end if;
    result:=public.%I(p_token,p_phone,p_customer_name,p_request_id,p_identity_choice,p_new_customer);
    if (result->>'ok')::boolean then
     insert into customer_identity_checkin_requests(display_token,request_id,input,result) values(p_token,p_request_id,payload,result);
    end if;
    return result;
   end $body$
  $wrapper$,fn||'_identity',fn||'_identity_core',fn||'_identity_core');
  execute format('revoke all on function public.%I(text,text,text,text,uuid,boolean) from public',fn||'_identity');
  execute format('grant execute on function public.%I(text,text,text,text,uuid,boolean) to anon,authenticated',fn||'_identity');
 end loop;
end $$;

-- A shared phone is not one waiting-list visit: never reuse a different person's visit.
do $$declare definition text; start_at integer; end_at integer;
begin
 definition:=pg_get_functiondef('public.create_or_reuse_customer_visit(uuid,uuid,text,uuid,jsonb)'::regprocedure);
definition:=replace(definition,chr(13),'');
 start_at:=position('  if normalized_phone is not null then' in definition);
 end_at:=position('  select *'||chr(10)||'  into visit_row' in substring(definition from start_at));
 if start_at=0 or end_at=0 then raise exception 'Review visit reuse before migration'; end if;
 definition:=substring(definition for start_at-1)||substring(definition from start_at+end_at-1);
 execute definition;
end $$;

do $$declare definition text;
begin
 definition:=pg_get_functiondef('public.service_relay_phone_checkin(uuid,text,text,uuid[],text)'::regprocedure);
definition:=replace(definition,chr(13),'');
 definition:=replace(definition,'public.service_relay_phone_checkin(','public.service_relay_phone_checkin_identity(');
 definition:=replace(definition,'p_request text)','p_request text, p_identity_choice uuid DEFAULT NULL::uuid, p_new_customer boolean DEFAULT false)');
 if position('p_identity_choice uuid' in definition)=0 then raise exception 'Review phone check-in arguments'; end if;
 definition:=replace(definition,'resolve_customer_display_check_in(entry_token,p_phone,p_name,p_request)',
 'resolve_customer_display_check_in_identity(entry_token,p_phone,p_name,p_request,p_identity_choice,p_new_customer)');
 execute definition;
end $$;
revoke all on function public.service_relay_phone_checkin_identity(uuid,text,text,uuid[],text,uuid,boolean) from public;
grant execute on function public.service_relay_phone_checkin_identity(uuid,text,text,uuid[],text,uuid,boolean) to anon,authenticated;
commit;
