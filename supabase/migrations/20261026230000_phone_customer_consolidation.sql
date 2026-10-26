begin;

alter table public.customer_account_claims drop constraint customer_account_claims_proof_type_check;
alter table public.customer_account_claims add constraint customer_account_claims_proof_type_check
 check(proof_type in ('customer_claim_token','verified_phone_ownership','salon_phone_match'));

-- Reuse the audited dependency mover. Only the private phone resolver may bypass
-- the interactive caller check, and only for one exact phone / one account.
do $$declare d text; old_guard text := $guard$if actor is null or (not user_has_salon_permission(p_salon,array['customers.manage']) and
 exists(select 1 from customers where id=any(ids) and customer_user_id is distinct from actor))
 then raise exception 'Customer merge access required' using errcode='42501'; end if;$guard$;
begin
 d:=replace(pg_get_functiondef('public.merge_customer_records(uuid,uuid,uuid[],text)'::regprocedure),chr(13),'');
 if position(old_guard in d)=0 then raise exception 'Review customer merge authorization before upgrade'; end if;
 d:=replace(d,'public.merge_customer_records(','public.merge_customer_records_phone_internal(');
 d:=replace(d,old_guard,$guard$
 if p_reason<>'phone_automatic' or exists(select 1 from customers where id=any(ids) and normalize_customer_claim_phone(phone) is null)
 or (select count(distinct normalize_customer_claim_phone(phone)) from customers where id=any(ids))<>1
 then raise exception 'Exact phone required for automatic merge'; end if;
 $guard$);
 execute d;
end $$;
revoke all on function public.merge_customer_records_phone_internal(uuid,uuid,uuid[],text) from public,anon,authenticated;

create function public.canonical_customer_for_phone(p_salon uuid,p_phone text,p_owner uuid default null)
returns uuid language plpgsql security definer set search_path=public,pg_temp as $$
declare phone_value text:=normalize_customer_claim_phone(p_phone); target uuid; owner_id uuid;
 owners uuid[]; phone_owners uuid[]; sources uuid[]; candidate record; active_target boolean;
begin
 if phone_value is null then return null; end if;
 perform pg_advisory_xact_lock(hashtextextended('customer-identity:'||p_salon::text,0));
 -- Account identity is stable even after its contact phone changes.
 select array_agg(distinct u.id) into phone_owners from users u
 where u.status='active' and nullif(btrim(u.email),'') is not null and normalize_customer_claim_phone(u.phone)=phone_value;
 with ownership as (
  select c.customer_user_id owner_id from customers c where c.location_id=p_salon and normalize_customer_claim_phone(c.phone)=phone_value
  union select b.customer_user_id from bookings b join customers c on c.id=b.customer_id
    where c.location_id=p_salon and normalize_customer_claim_phone(c.phone)=phone_value
  union select a.customer_user_id from customer_account_claims a join customers c on c.id=a.customer_id
    where c.location_id=p_salon and normalize_customer_claim_phone(c.phone)=phone_value
  union select unnest(phone_owners)
 ) select array_agg(distinct o.owner_id) filter(where o.owner_id is not null) into owners from ownership o;
 if p_owner is not null then owner_id:=p_owner;
 elsif cardinality(owners)=1 then owner_id:=owners[1];
 elsif cardinality(owners)>1 then return null; end if;
 -- Multiple established accounts never acquire each other's unclaimed history.
 select c.id into target from customers c
 where c.location_id=p_salon and (normalize_customer_claim_phone(c.phone)=phone_value or
   (owner_id is not null and c.customer_user_id=owner_id and exists(select 1 from users u where u.id=owner_id and normalize_customer_claim_phone(u.phone)=phone_value)))
 and (c.customer_user_id=owner_id or (c.customer_user_id is null and coalesce(cardinality(owners),0)<=1))
 and not exists(select 1 from bookings b where b.customer_id=c.id and b.customer_user_id is not null and b.customer_user_id is distinct from owner_id)
 and not exists(select 1 from customer_account_claims a where a.customer_id=c.id and a.customer_user_id is not null and a.customer_user_id is distinct from owner_id)
 order by (c.customer_user_id is not null) desc,
   exists(select 1 from customer_visits v where v.customer_id=c.id and v.status in ('waiting','in_service','checkout')) desc,
   c.created_at,c.id limit 1;
 if target is null and owner_id is not null and coalesce(cardinality(owners),0)<=1 then
  insert into customers(location_id,customer_user_id,name,phone,email,source,status)
  select p_salon,u.id,coalesce(nullif(btrim(u.display_name),''),'Customer'),phone_value,u.email,'account_link','active'
  from users u where u.id=owner_id and u.status='active' returning id into target;
 end if;
 if target is null then return null; end if;
 -- Only this account's existing profiles follow its new phone. Old ownership
 -- remains on the same customer ID; another owner is never reassigned.
 if owner_id is not null and exists(select 1 from users u where u.id=owner_id and normalize_customer_claim_phone(u.phone)=phone_value) then
  update customers set phone=phone_value where location_id=p_salon and customer_user_id=owner_id
    and normalize_customer_claim_phone(phone) is distinct from phone_value;
 end if;
 select exists(select 1 from customer_visits where customer_id=target and status in ('waiting','in_service','checkout')) into active_target;
 for candidate in select c.id from customers c where c.location_id=p_salon and c.id<>target
  and normalize_customer_claim_phone(c.phone)=phone_value
  and (c.customer_user_id=owner_id or (c.customer_user_id is null and coalesce(cardinality(owners),0)<=1))
  and not exists(select 1 from bookings b where b.customer_id=c.id and b.customer_user_id is not null and b.customer_user_id is distinct from owner_id)
  and not exists(select 1 from customer_account_claims a where a.customer_id=c.id and a.customer_user_id is not null and a.customer_user_id is distinct from owner_id)
  order by c.created_at,c.id loop
  -- The unique active-visit invariant stays intact. Lifecycle trigger below
  -- retries automatically; no active visit is cancelled or marked completed.
  if active_target and exists(select 1 from customer_visits where customer_id=candidate.id and status in ('waiting','in_service','checkout')) then continue; end if;
  if exists(select 1 from customer_visits where customer_id=candidate.id and status in ('waiting','in_service','checkout')) then active_target:=true; end if;
  sources:=array_append(sources,candidate.id);
  if cardinality(sources)=100 then
   perform merge_customer_records_phone_internal(p_salon,target,sources,'phone_automatic'); sources:=null;
  end if;
 end loop;
 if cardinality(sources)>0 then perform merge_customer_records_phone_internal(p_salon,target,sources,'phone_automatic'); end if;
 if owner_id is not null and coalesce(cardinality(owners),0)<=1 then
  update customers set customer_user_id=owner_id,
   name=coalesce((select nullif(btrim(display_name),'') from users where id=owner_id),name),
   customer_account_claimed_at=coalesce(customer_account_claimed_at,now()),
   customer_account_claim_method=coalesce(customer_account_claim_method,'auto_verified_phone'),
   customer_account_claim_metadata=coalesce(customer_account_claim_metadata,'{}')||jsonb_build_object('source','salon_phone_identity'),
   updated_at=now() where id=target;
  insert into customer_account_claims(salon_id,customer_id,customer_user_id,claim_method,proof_type,claim_status,metadata)
  values(p_salon,target,owner_id,'auto_link','salon_phone_match','linked',jsonb_build_object('normalized_phone',phone_value))
  on conflict(customer_id,customer_user_id,claim_method) do nothing;
  update bookings set customer_user_id=owner_id where salon_id=p_salon and customer_id=target and customer_user_id is null;
 end if;
 return target;
end $$;

create function public.booking_phone_customer(p_salon uuid,p_phone text,p_owner uuid) returns uuid
language plpgsql security definer set search_path=public,pg_temp as $$
begin
 if coalesce(auth.role(),'')<>'service_role' and not user_has_salon_permission(p_salon,array['customers.manage','booking.manage']) then
  raise exception 'Customer access required' using errcode='42501'; end if;
 return canonical_customer_for_phone(p_salon,p_phone,p_owner);
end $$;
revoke all on function public.booking_phone_customer(uuid,text,uuid) from public,anon;
grant execute on function public.booking_phone_customer(uuid,text,uuid) to authenticated,service_role;

create or replace function public.create_booking_customer_identity(p_salon uuid,p_name text,p_phone text,p_email text,p_user uuid,p_actor uuid,p_source text)
returns jsonb language plpgsql security invoker set search_path=public,pg_temp as $$
declare selected customers; selected_id uuid; actor uuid:=current_public_user_id();
begin
 -- Existing authorized SECURITY DEFINER booking entrypoints keep their caller
 -- permissions. Direct REST callers still pass the salon check and table RLS.
 if current_user in ('anon','authenticated','service_role') then
  selected_id:=booking_phone_customer(p_salon,p_phone,p_user);
 else selected_id:=canonical_customer_for_phone(p_salon,p_phone,p_user); end if;
 if selected_id is not null then
  update customers set status='active' where id=selected_id returning * into selected;
  return jsonb_build_object('customer',to_jsonb(selected),'created',false);
 end if;
 if p_user is null and exists(select 1 from customers where location_id=p_salon
  and normalize_customer_claim_phone(phone)=normalize_customer_claim_phone(p_phone)) then
  raise exception 'Choose the existing account for this phone number'; end if;
 insert into customers(location_id,name,phone,email,customer_user_id,source,status,created_by_user_id,updated_by_user_id)
 values(p_salon,p_name,normalize_customer_claim_phone(p_phone),nullif(lower(btrim(p_email)),''),p_user,p_source,'active',p_actor,p_actor)
 returning * into selected;
 return jsonb_build_object('customer',to_jsonb(selected),'created',true);
end $$;
revoke all on function public.canonical_customer_for_phone(uuid,text,uuid) from public,anon,authenticated;

create or replace function public.resolve_display_customer_identity(p_salon uuid,p_name text,p_phone text,p_choice uuid default null,p_new boolean default false)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare target uuid; preferred_owner uuid; choices jsonb;
begin
 if normalize_customer_claim_phone(p_phone) is null then return jsonb_build_object('ok',false,'code','invalid_phone','message','Enter a full phone number.'); end if;
 if p_choice is not null then
  select customer_user_id into preferred_owner from customers where id=p_choice and location_id=p_salon
   and normalize_customer_claim_phone(phone)=normalize_customer_claim_phone(p_phone);
  if not found then return jsonb_build_object('ok',false,'code','identity_choice_expired','message','Please enter your phone again.'); end if;
 end if;
 target:=canonical_customer_for_phone(p_salon,p_phone,preferred_owner);
 if target is null then
  select jsonb_agg(jsonb_build_object('id',c.id,'label',customer_visit_first_name(c.name),
   'phoneHint','••• '||right(regexp_replace(c.phone,'\D','','g'),4),'reason','Separate account')) into choices
  from customers c where c.location_id=p_salon and c.status='active'
   and normalize_customer_claim_phone(c.phone)=normalize_customer_claim_phone(p_phone);
  if choices is not null then return jsonb_build_object('ok',false,'code','identity_choice_required','message','Choose your account.','candidates',choices); end if;
  if length(customer_name_key(p_name))<2 then return jsonb_build_object('ok',false,'code','profile_required','message','What is your name?'); end if;
 else update customers set status='active' where id=target and status<>'active'; end if;
 return jsonb_build_object('ok',true,'customerId',target);
end $$;

-- A number change changes contact information, never historical ownership.
create function public.sync_customer_account_phone() returns trigger
language plpgsql security definer set search_path=public,pg_temp as $$
declare salon uuid; phone_value text:=normalize_customer_claim_phone(new.phone);
begin
 if phone_value is not distinct from normalize_customer_claim_phone(old.phone) then return new; end if;
 delete from customer_verified_phones where user_id=new.id and normalized_phone=normalize_customer_claim_phone(old.phone)
  and normalized_phone is distinct from phone_value;
 for salon in select distinct location_id from customers where customer_user_id=new.id order by location_id loop
  perform pg_advisory_xact_lock(hashtextextended('customer-identity:'||salon::text,0));
  update customers set phone=phone_value where location_id=salon and customer_user_id=new.id;
  if phone_value is not null then perform canonical_customer_for_phone(salon,phone_value,new.id); end if;
 end loop;
 return new;
end $$;
create trigger sync_customer_account_phone after update of phone on public.users
for each row execute function public.sync_customer_account_phone();
revoke all on function public.sync_customer_account_phone() from public,anon,authenticated;

create function public.link_booking_to_salon_customer() returns trigger
language plpgsql security definer set search_path=public,pg_temp as $$
begin
 if new.customer_user_id is null then
  select c.customer_user_id into new.customer_user_id from customers c join users u on u.id=c.customer_user_id
  where c.id=new.customer_id and c.location_id=new.salon_id and u.status='active';
 end if;
 return new;
end $$;
create trigger link_booking_to_salon_customer before insert on public.bookings
for each row execute function public.link_booking_to_salon_customer();
revoke all on function public.link_booking_to_salon_customer() from public,anon,authenticated;

create function public.consolidate_phone_after_visit() returns trigger
language plpgsql security definer set search_path=public,pg_temp as $$
declare phone_value text;
begin
 if old.status in ('waiting','in_service','checkout') and new.status not in ('waiting','in_service','checkout') then
  select phone into phone_value from customers where id=new.customer_id;
  perform canonical_customer_for_phone(new.salon_id,phone_value);
 end if;
 return new;
end $$;
create trigger consolidate_phone_after_visit after update of status on public.customer_visits
for each row execute function public.consolidate_phone_after_visit();
revoke all on function public.consolidate_phone_after_visit() from public,anon,authenticated;

-- Same-phone reuse also applies to owner/staff creation and booking, not just kiosk.
do $$declare d text; fn text;
begin
 foreach fn in array array['create_salon_customer_identity(uuid,jsonb)','create_staff_appointment(uuid,jsonb)'] loop
  d:=pg_get_functiondef(('public.'||fn)::regprocedure);
  d:=regexp_replace(d,E'\\mbegin\\M',E'begin\n perform public.canonical_customer_for_phone(p_salon,p_input->>''phone'');','i');
  execute d;
 end loop;
 d:=pg_get_functiondef('public.customer_identity_candidates(uuid,text,text,text)'::regprocedure);
 if position('coalesce(p=cp,false) and length(n)>=3 and ns>=0.75' in d)=0 then raise exception 'Review phone match scorer'; end if;
 d:=replace(d,'coalesce(p=cp,false) and length(n)>=3 and ns>=0.75','coalesce(p=cp,false)');
 execute replace(d,'Same phone, matching name','Same phone');
end $$;

-- A scoped owner action remains available, but kiosk and lifecycle already run
-- consolidation automatically. Cleanup below uses the same implementation.
create or replace function public.create_salon_customer_identity(p_salon uuid,p_input jsonb)
returns uuid language plpgsql security definer set search_path=public,pg_temp as $$
declare target uuid; phone_value text:=normalize_customer_claim_phone(p_input->>'phone');
begin
 if not user_has_salon_permission(p_salon,array['customers.manage']) then raise exception 'Customer management access required' using errcode='42501'; end if;
 if nullif(btrim(p_input->>'name'),'') is null then raise exception 'Customer name is required'; end if;
 if nullif(btrim(p_input->>'phone'),'') is not null and phone_value is null then raise exception 'Enter a full phone number or leave phone blank'; end if;
 perform pg_advisory_xact_lock(hashtextextended('customer-identity:'||p_salon::text,0));
 target:=nullif(p_input->>'existing_customer_id','')::uuid;
 if target is not null then
  target:=coalesce((select target_id from customer_merged_ids where source_id=target and salon_id=p_salon),target);
  if not exists(select 1 from customers where id=target and location_id=p_salon) then raise exception 'Customer selection changed'; end if;
 else target:=canonical_customer_for_phone(p_salon,phone_value); end if;
 if target is not null then
  update customers set status='active',notes=concat_ws(E'\n\n',notes,nullif(p_input->>'notes','')),
   staff_notes=concat_ws(E'\n\n',staff_notes,nullif(p_input->>'staff_notes','')),
   internal_notes=concat_ws(E'\n\n',internal_notes,nullif(p_input->>'internal_notes','')),
   updated_by_user_id=current_public_user_id() where id=target;
  return target;
 end if;
 if phone_value is not null and exists(select 1 from customers where location_id=p_salon and normalize_customer_claim_phone(phone)=phone_value) then
  raise exception 'Choose the existing account for this phone number'; end if;
 insert into customers(location_id,name,phone,email,notes,staff_notes,internal_notes,source,status,created_by_user_id,updated_by_user_id)
 values(p_salon,btrim(p_input->>'name'),phone_value,nullif(lower(btrim(p_input->>'email')),''),nullif(p_input->>'notes',''),
  nullif(p_input->>'staff_notes',''),nullif(p_input->>'internal_notes',''),'manual','active',current_public_user_id(),current_public_user_id()) returning id into target;
 return target;
end $$;

create or replace function public.consolidate_customer_identities(p_salon uuid) returns integer
language plpgsql security definer set search_path=public,pg_temp as $$
declare p record; before_count integer; after_count integer;
begin
 if not user_has_salon_permission(p_salon,array['customers.manage']) then raise exception 'Customer management access required' using errcode='42501'; end if;
 select count(*) into before_count from customers where location_id=p_salon;
 for p in select distinct normalize_customer_claim_phone(phone) phone from customers where location_id=p_salon
  and normalize_customer_claim_phone(phone) is not null loop perform canonical_customer_for_phone(p_salon,p.phone); end loop;
 select count(*) into after_count from customers where location_id=p_salon;
 return before_count-after_count;
end $$;

-- Eliminate name-based onboarding choices for history. Preserve already owned
-- history when the same number is also present on a different account.
create or replace function public.claim_customers_for_verified_phone_internal(p_user_id uuid,p_normalized_phone text,p_claim_method text)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare salon uuid; phone_value text:=normalize_customer_claim_phone(p_normalized_phone); before_count integer; after_count integer;
begin
 if not exists(select 1 from customer_verified_phones v join users u on u.id=v.user_id where v.user_id=p_user_id
  and v.normalized_phone=phone_value and u.status='active') then return jsonb_build_object('ok',false,'code','unverified_phone'); end if;
 select count(*) into before_count from customers where normalize_customer_claim_phone(phone)=phone_value and customer_user_id is null;
 for salon in select distinct location_id from customers where normalize_customer_claim_phone(phone)=phone_value order by location_id loop
  perform canonical_customer_for_phone(salon,phone_value,p_user_id);
 end loop;
 -- Resolve only the caller's remaining unclaimed single-account groups.
 select count(*) into after_count from customers where normalize_customer_claim_phone(phone)=phone_value and customer_user_id is null;
 return jsonb_build_object('ok',true,'linkedCount',greatest(0,before_count-after_count),'selectionRequired',false);
end $$;

-- Account QR and phone kiosk converge on the same salon customer before either
-- flow creates a visit. All existing QR/session/catalog permissions stay intact.
do $$declare d text; anchor text:='if target_salon is null then raise exception ''Check-in QR expired. Scan the salon screen again.''; end if;';
 selection text:='select array_agg(c.id) into candidates from customers c where c.location_id=target_salon and c.customer_user_id=actor and c.status=''active'';';
begin
 d:=pg_get_functiondef('public.personal_qr_checkin(uuid,uuid[],uuid)'::regprocedure);
 if position(anchor in d)=0 or position(selection in d)=0 then raise exception 'Review personal QR resolver before upgrade'; end if;
 d:=regexp_replace(d,E'\\mdeclare\\M','declare phone_customer uuid;','i');
 d:=replace(d,anchor,anchor||E'\n phone_customer:=public.canonical_customer_for_phone(target_salon,u.phone,actor);');
 execute replace(d,selection,replace(selection,';',' and (phone_customer is null or c.id=phone_customer);'));
end $$;

-- New rows may only auto-link a verified number still used by that account;
-- old verified numbers do not follow a person after they change their contact.
create or replace function public.auto_link_customer_to_verified_phone() returns trigger
language plpgsql security definer set search_path=public,pg_temp as $$
declare owner_id uuid;
begin
 if new.customer_user_id is not null then return new; end if;
 select v.user_id into owner_id from customer_verified_phones v join users u on u.id=v.user_id
 where v.normalized_phone=normalize_customer_claim_phone(new.phone) and u.status='active'
 and normalize_customer_claim_phone(u.phone)=v.normalized_phone;
 if owner_id is not null then new.customer_user_id:=owner_id;
  new.customer_account_claimed_at:=coalesce(new.customer_account_claimed_at,now());
  new.customer_account_claim_method:='auto_verified_phone';
 end if;
 return new;
end $$;

-- Transactional backfill of duplicates. All original record snapshots and ID
-- aliases are retained by the existing audited merger. No ticket amounts move.
do $$declare group_row record;
begin
 for group_row in select location_id,normalize_customer_claim_phone(phone) phone from customers
 where normalize_customer_claim_phone(phone) is not null group by location_id,normalize_customer_claim_phone(phone)
 having count(*)>1 order by location_id,normalize_customer_claim_phone(phone) loop
  perform canonical_customer_for_phone(group_row.location_id,group_row.phone);
 end loop;
end $$;
update public.bookings b set customer_user_id=c.customer_user_id from public.customers c join public.users u on u.id=c.customer_user_id
where b.customer_id=c.id and b.salon_id=c.location_id and b.customer_user_id is null and u.status='active';
commit;
