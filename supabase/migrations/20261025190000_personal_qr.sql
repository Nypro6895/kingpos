begin;

-- Opaque identity handles. Scanning identifies an account, never grants access.
create table public.personal_qr_codes (
 user_id uuid primary key references public.users(id) on delete cascade,
 token uuid not null unique default gen_random_uuid(),
 expires_at timestamptz not null default now()+interval '15 minutes'
);
alter table public.personal_qr_codes enable row level security;
revoke all on public.personal_qr_codes from public,anon,authenticated;

create table public.personal_qr_checkins (
 user_id uuid not null references public.users(id), request_id uuid not null,
 payload jsonb not null, visit_id uuid not null references public.customer_visits(id),
 created_at timestamptz not null default now(), primary key(user_id,request_id)
);
alter table public.personal_qr_checkins enable row level security;
revoke all on public.personal_qr_checkins from public,anon,authenticated;

create table public.personal_qr_ready (
 visit_id uuid primary key references public.customer_visits(id),
 salon_id uuid not null references public.locations(id),
 staff_id uuid references public.staff(id), chair text,
 request_id uuid not null, notified_at timestamptz not null default now()
);
alter table public.personal_qr_ready enable row level security;
revoke all on public.personal_qr_ready from public,anon,authenticated;

create function public.personal_qr_issue() returns jsonb
language plpgsql security definer set search_path=public as $$
declare actor uuid:=current_public_user_id(); qr personal_qr_codes;
begin
 if actor is null or not exists(select 1 from users where id=actor and status='active') then raise exception 'Sign in required'; end if;
 select * into qr from personal_qr_codes where user_id=actor;
 if qr.user_id is not null and qr.expires_at>now()+interval '2 minutes' then
  return jsonb_build_object('code','reylumi:personal:'||qr.token::text,'expiresAt',qr.expires_at);
 end if;
 insert into personal_qr_codes(user_id) values(actor) on conflict(user_id) do update
 set token=case when personal_qr_codes.expires_at<=now()+interval '2 minutes' then gen_random_uuid() else personal_qr_codes.token end,
 expires_at=case when personal_qr_codes.expires_at<=now()+interval '2 minutes' then now()+interval '15 minutes' else personal_qr_codes.expires_at end
 returning * into qr;
 return jsonb_build_object('code','reylumi:personal:'||qr.token::text,'expiresAt',qr.expires_at);
end $$;

-- Existing screen-pairing rules now also support Check-in Receipt without Phone Checkin.
create or replace function public.service_relay_entry(p_token text) returns uuid
language plpgsql security definer set search_path=public as $$
declare entry uuid;
begin
 if not exists(select 1 from pos_live_drafts d where d.token=p_token and d.status='draft' and staff_scan_available(d.salon_id)) then return null; end if;
 insert into service_relay_entries(display_token) values(p_token) on conflict(display_token)
 do update set expires_at=now()+interval '8 hours' returning id into entry;
 return entry;
end $$;
create or replace function public.service_relay_entry_catalog(p_entry uuid) returns jsonb
language sql stable security definer set search_path=public as $$
 select jsonb_build_object('salonId',d.salon_id,'salonName',s.name,'personalOnly',not exists(select 1 from salon_market_plugins p where p.salon_id=d.salon_id and p.plugin_id='service-relay'),
 'services',coalesce((select jsonb_agg(to_jsonb(catalog)) from get_customer_display_service_catalog(e.display_token) catalog),'[]'::jsonb))
 from service_relay_entries e join pos_live_drafts d on d.token=e.display_token join locations s on s.id=d.salon_id
 where e.id=p_entry and e.expires_at>now() and d.status='draft' and s.status='active' and staff_scan_available(d.salon_id)
$$;

create function public.personal_qr_checkin(p_entry uuid,p_services uuid[],p_request uuid) returns uuid
language plpgsql security definer set search_path=public as $$
declare actor uuid:=current_public_user_id(); u users; target_salon uuid; display text;
 customer customers; visit customer_visits; previous personal_qr_checkins;
 candidates uuid[]; requested uuid[]; verified_phone text; result jsonb; appointment_candidate uuid; appointment_count integer;
begin
 select * into u from users where id=actor and status='active';
 if u.id is null or p_request is null then raise exception 'Sign in required'; end if;
 select array_agg(distinct x order by x) into requested from unnest(p_services) x where x is not null;
 if coalesce(cardinality(requested),0) not between 1 and 30 then raise exception 'Choose your services'; end if;
 perform pg_advisory_xact_lock(hashtextextended('personal-checkin:'||actor::text||':'||p_request::text,0));
 select * into previous from personal_qr_checkins where user_id=actor and request_id=p_request;
 if previous.visit_id is not null then
  if previous.payload<>jsonb_build_array(p_entry,requested) then raise exception 'This request changed. Start a new check-in.'; end if;
  return previous.visit_id;
 end if;
 select d.salon_id,e.display_token into target_salon,display from service_relay_entries e
 join pos_live_drafts d on d.token=e.display_token join locations l on l.id=d.salon_id
 where e.id=p_entry and e.expires_at>now() and d.status='draft' and l.status='active' and staff_scan_available(d.salon_id);
 if target_salon is null then raise exception 'Check-in QR expired. Scan the salon screen again.'; end if;
 if exists(select 1 from unnest(requested) x where not exists(select 1 from get_customer_display_service_catalog(display) s where s.id=x)) then raise exception 'A service is no longer available'; end if;
 perform pg_advisory_xact_lock(hashtextextended('service-relay:'||target_salon::text,0));
 perform pg_advisory_xact_lock(hashtextextended('customer-identity:'||target_salon::text,0));
 select array_agg(c.id) into candidates from customers c where c.location_id=target_salon and c.customer_user_id=actor and c.status='active';
 if cardinality(candidates)>1 then raise exception 'Several linked customer profiles exist. Ask the front desk to resolve them.'; end if;
 if cardinality(candidates)=1 then select * into customer from customers where id=candidates[1]; end if;
 if customer.id is null then
  select v.normalized_phone into verified_phone from customer_verified_phones v
  where v.user_id=actor and v.normalized_phone=normalize_customer_claim_phone(u.phone) limit 1;
  if verified_phone is not null then
   select array_agg(c.id) into candidates from customers c where c.location_id=target_salon and c.status='active'
   and c.customer_user_id is null and normalize_customer_claim_phone(c.phone)=verified_phone
   and customer_name_key(c.name)=customer_name_key(u.display_name);
   if cardinality(candidates)>1 then raise exception 'Several customer profiles match. Ask the front desk to link your history.'; end if;
   if cardinality(candidates)=1 then
    update customers set customer_user_id=actor,source='account_link',updated_by_user_id=actor
    where id=candidates[1] and customer_user_id is null returning * into customer;
   end if;
  elsif normalize_customer_claim_phone(u.phone) is not null and exists(select 1 from customers c where c.location_id=target_salon
   and c.status='active' and c.customer_user_id is null and normalize_customer_claim_phone(c.phone)=normalize_customer_claim_phone(u.phone)
   and customer_name_key(c.name)=customer_name_key(u.display_name)) then
   raise exception 'Verify your phone in Account to connect your existing salon history.';
  end if;
 end if;
 if customer.id is null then
  insert into customers(location_id,customer_user_id,name,phone,email,source,status,created_by_user_id,updated_by_user_id)
  values(target_salon,actor,coalesce(nullif(btrim(u.display_name),''),'Customer'),u.phone,u.email,'account_link','active',actor,actor)
  returning * into customer;
 end if;
 -- Repair an already-finalized visit before asking the installed visit-reuse core.
 update customer_visits v set status='completed' where v.salon_id=target_salon and v.customer_id=customer.id
 and v.status in ('waiting','in_service','checkout') and exists(select 1 from pos_tickets t where t.id=v.ticket_id and t.salon_id=target_salon and t.status='closed');
 if not exists(select 1 from customer_visits where salon_id=target_salon and customer_id=customer.id and status in ('waiting','in_service','checkout')) then
  select m.appointment_id,m.match_count into appointment_candidate,appointment_count from find_customer_visit_arrival_appointment(target_salon,customer.id) m;
  if coalesce(appointment_count,0)>1 then raise exception 'Several appointments match today. Ask the front desk to check you in.'; end if;
 end if;
 visit:=create_or_reuse_customer_visit(target_salon,customer.id,case when appointment_candidate is null then 'customer_screen' else 'appointment' end,appointment_candidate,jsonb_build_object('token',display,'personalQr',true));
 if visit.id is null then raise exception 'Could not save check-in'; end if;
 -- Re-scanning an active visit never changes services already in progress.
 if visit.status='waiting' and visit.ticket_id is null then
  result:=update_customer_visit_requested_services(display,visit.id,requested);
  if not coalesce((result->>'ok')::boolean,false) then raise exception 'Could not save requested services'; end if;
 end if;
 insert into service_relay_tickets(visit_id,salon_id,scan_mode) values(visit.id,target_salon,true) on conflict(visit_id) do nothing;
 insert into personal_qr_checkins(user_id,request_id,payload,visit_id) values(actor,p_request,jsonb_build_array(p_entry,requested),visit.id);
 return visit.id;
end $$;

create function public.personal_qr_visit(p_visit uuid) returns jsonb
language plpgsql stable security definer set search_path=public as $$
declare actor uuid:=current_public_user_id(); v customer_visits; receipt jsonb;
begin
 select cv.* into v from customer_visits cv join customers c on c.id=cv.customer_id and c.location_id=cv.salon_id
 where cv.id=p_visit and c.customer_user_id=actor;
 if actor is null or v.id is null then raise exception 'This visit does not belong to your account'; end if;
 if v.ticket_id is not null then receipt:=get_customer_activity_receipt(v.ticket_id); end if;
 return (select jsonb_build_object('visitId',v.id,'salonId',v.salon_id,'salonName',l.name,'checkedInAt',v.checked_in_at,
 'status',case when coalesce((receipt->>'ok')::boolean,false) then 'paid' else v.status end,
 'queueNumber',coalesce(r.queue_number,t.queue_number),'ticketId',v.ticket_id,'receipt',case when (receipt->>'ok')::boolean then receipt->'ticket' else null end,
 'requestedServices',customer_visit_requested_services_json(v.id),
 'ready',case when v.status='waiting' and v.ticket_id is null then (select jsonb_build_object('at',n.notified_at,'staffName',s.display_name,'chair',n.chair)
  from personal_qr_ready n left join staff s on s.id=n.staff_id where n.visit_id=v.id) else null end,
 'lines',coalesce((select jsonb_agg(jsonb_build_object('id',ln.id,'serviceName',sv.name,'staffName',s.display_name,'amount',ln.amount) order by o.created_at,ln.id)
  from service_relay_lines ln join service_relay_offers o on o.id=ln.offer_id join services sv on sv.id=ln.service_id
  join staff s on s.id=o.staff_id where o.visit_id=v.id and o.status in ('working','done')),'[]'::jsonb),
 'workingStaff',coalesce((select jsonb_agg(s.display_name) from service_relay_offers o join staff s on s.id=o.staff_id
  where o.visit_id=v.id and o.status='working'),'[]'::jsonb))
 from locations l left join service_relay_tickets t on t.visit_id=v.id left join checkin_receipts r on r.visit_id=v.id where l.id=v.salon_id);
end $$;

create function public.personal_qr_workspace() returns jsonb
language plpgsql security definer set search_path=public as $$
declare actor uuid:=current_public_user_id(); identity jsonb; visits jsonb;
begin
 identity:=personal_qr_issue();
 select coalesce(jsonb_agg(personal_qr_visit(x.id) order by x.active desc,x.checked_in_at desc),'[]'::jsonb) into visits from (
  select v.id,v.checked_in_at,(v.status in ('waiting','in_service','checkout') and v.ticket_id is null) as active
  from customer_visits v join customers c on c.id=v.customer_id and c.location_id=v.salon_id where c.customer_user_id=actor
  order by active desc,v.checked_in_at desc limit 30) x;
 return identity||jsonb_build_object('userId',actor,'visits',visits,'updatedAt',now());
end $$;

-- Resolve only inside a permitted owner/manager Staff workspace.
create function public.personal_qr_staff_preview(p_salon uuid,p_token uuid) returns jsonb
language plpgsql stable security definer set search_path=public as $$
declare target users; connected uuid; pending uuid;
begin
 if not coalesce(user_has_salon_permission(p_salon,array['staff.manage']),false) then raise exception 'Not authorized to add staff'; end if;
 select u.* into target from personal_qr_codes q join users u on u.id=q.user_id where q.token=p_token and q.expires_at>now() and u.status='active';
 if target.id is null then raise exception 'Personal QR expired. Ask them to reopen My QR.'; end if;
 select s.id into connected from staff s where s.salon_id=p_salon and
 (s.account_user_id=target.id or (s.account_user_id is null and s.user_id=target.auth_user_id)) limit 1;
 select r.id into pending from staff_salon_connection_requests r where r.salon_id=p_salon and r.account_user_id=target.id
 and r.status='pending' and (r.expires_at is null or r.expires_at>now()) limit 1;
 return jsonb_build_object('userId',target.id,'name',coalesce(target.display_name,'Account'),
 'phoneHint',case when target.phone is null then null else '••• '||right(regexp_replace(target.phone,'\D','','g'),4) end,
 'emailHint',case when target.email is null then null else left(target.email,1)||'•••@'||split_part(target.email,'@',2) end,
 'status',case when connected is not null then 'connected' when pending is not null then 'pending' else 'available' end);
end $$;

create function public.personal_qr_staff_send(p_salon uuid,p_token uuid) returns jsonb
language plpgsql security definer set search_path=public as $$
declare preview jsonb; target users; candidate_ids uuid[]; selected uuid; request staff_salon_connection_requests;
begin
 preview:=personal_qr_staff_preview(p_salon,p_token);
 select * into target from users where id=(preview->>'userId')::uuid;
 perform pg_advisory_xact_lock(hashtextextended('personal-staff:'||p_salon::text,0));
 preview:=personal_qr_staff_preview(p_salon,p_token);
 if preview->>'status'='connected' then return jsonb_build_object('status','connected'); end if;
 select * into request from staff_salon_connection_requests r where r.salon_id=p_salon and r.account_user_id=target.id
 and r.status='pending' and (r.expires_at is null or r.expires_at>now()) order by r.created_at limit 1;
 if request.id is not null then return jsonb_build_object('status','pending','requestId',request.id); end if;
 -- Safely reuse a single unlinked exact verified-contact match; never merge by name.
 select array_agg(s.id) into candidate_ids from staff s where s.salon_id=p_salon and s.account_user_id is null and s.user_id is null and s.is_active
 and ((normalize_customer_claim_phone(s.phone)=normalize_customer_claim_phone(target.phone) and exists(select 1 from customer_verified_phones v
  where v.user_id=target.id and v.normalized_phone=normalize_customer_claim_phone(target.phone)))
 or (nullif(lower(btrim(target.email)),'')=lower(btrim(s.email)) and exists(select 1 from auth.users a where a.id=target.auth_user_id and a.email_confirmed_at is not null and lower(btrim(a.email))=lower(btrim(target.email)))));
 if cardinality(candidate_ids)>1 then raise exception 'Several matching staff profiles exist. Resolve duplicates in Staff before sending.'; end if;
 if cardinality(candidate_ids)=1 then selected:=candidate_ids[1]; else
  -- Refuse an unsafe contact collision instead of silently making a duplicate profile.
  if exists(select 1 from staff s where s.salon_id=p_salon and s.account_user_id is null and s.user_id is null and s.is_active
   and ((normalize_customer_claim_phone(s.phone)=normalize_customer_claim_phone(target.phone) and normalize_customer_claim_phone(target.phone) is not null)
   or (nullif(lower(btrim(target.email)),'')=lower(btrim(s.email))))) then raise exception 'Verify the account contact before connecting the existing staff history.'; end if;
  insert into staff(salon_id,display_name,first_name,last_name,email,phone,is_active)
  values(p_salon,coalesce(nullif(btrim(target.display_name),''),'Staff'),target.first_name,target.last_name,target.email,target.phone,true) returning id into selected;
 end if;
 if exists(select 1 from staff_salon_connection_requests r where r.salon_id=p_salon and r.staff_id=selected and r.status='pending' and (r.expires_at is null or r.expires_at>now())) then raise exception 'This staff profile already has a pending invitation'; end if;
 -- Use the existing request, notification and acceptance machinery. No email/SMS dispatch here.
 insert into staff_salon_connection_requests(salon_id,staff_id,account_user_id,direction,status,initiated_by_user_id,token_hash,expires_at)
 values(p_salon,selected,target.id,'salon_invite','pending',current_public_user_id(),replace(gen_random_uuid()::text,'-','')||replace(gen_random_uuid()::text,'-',''),now()+interval '7 days') returning * into request;
 -- The existing staff-request feed already supplies Accept/Decline in Notifications.
 -- Do not also insert a generic notification for the same invitation.
 return jsonb_build_object('status','pending','requestId',request.id);
end $$;

create function public.personal_qr_notify_ready(p_salon uuid,p_visit uuid,p_staff uuid,p_chair text,p_request uuid,p_key uuid default null,p_signature text default null) returns void
language plpgsql security definer set search_path=public as $$
declare v customer_visits; customer_account uuid; prior personal_qr_ready; label text;
begin
 if not coalesce(user_has_salon_permission(p_salon,array['tickets.manage']),false)
 and not coalesce(pos_portable_access_salon_id(p_key,p_signature)=p_salon and pos_portable_access_has_capability(p_key,p_signature,'portable.pos.use'),false) then raise exception 'Not authorized'; end if;
 if p_request is null or length(coalesce(p_chair,''))>40 then raise exception 'Invalid Ready request'; end if;
 perform pg_advisory_xact_lock(hashtextextended('service-relay:'||p_salon::text,0));
 select * into v from customer_visits where id=p_visit and salon_id=p_salon for update;
 if v.id is null or v.status<>'waiting' or v.ticket_id is not null then raise exception 'This customer is no longer waiting'; end if;
 if p_staff is not null and not exists(select 1 from staff where id=p_staff and salon_id=p_salon and is_active and pos_enabled) then raise exception 'Staff is not available'; end if;
 select customer_user_id into customer_account from customers where id=v.customer_id and location_id=p_salon;
 if customer_account is null then raise exception 'This check-in is not linked to a Personal account'; end if;
 select * into prior from personal_qr_ready where visit_id=v.id;
 if prior.request_id=p_request or (prior.notified_at>now()-interval '1 minute' and prior.staff_id is not distinct from p_staff and coalesce(prior.chair,'')=coalesce(btrim(p_chair),'')) then return; end if;
 insert into personal_qr_ready(visit_id,salon_id,staff_id,chair,request_id) values(v.id,p_salon,p_staff,nullif(btrim(p_chair),''),p_request)
 on conflict(visit_id) do update set staff_id=excluded.staff_id,chair=excluded.chair,request_id=excluded.request_id,notified_at=now();
 select coalesce((select display_name from staff where id=p_staff),'Your staff')||' is ready'||case when nullif(btrim(p_chair),'') is null then '' else ' · Chair '||btrim(p_chair) end into label;
 insert into app_notifications(salon_id,recipient_user_id,recipient_kind,notification_type,title,body,href,event_key)
 values(p_salon,customer_account,'customer','service_ready','Your staff is ready',label,'/qr?visit='||v.id::text,'personal-ready:'||p_request::text);
end $$;

create function public.personal_qr_connect_customer(p_salon uuid,p_token uuid) returns jsonb
language plpgsql security definer set search_path=public as $$
declare visits uuid[];
begin
 if service_relay_staff(p_salon) is null then raise exception 'Open your Staff workspace first'; end if;
 select array_agg(v.id) into visits from personal_qr_codes q join users u on u.id=q.user_id and u.status='active' join customers c on c.customer_user_id=q.user_id and c.location_id=p_salon
 join customer_visits v on v.customer_id=c.id and v.salon_id=p_salon
 where q.token=p_token and q.expires_at>now() and v.ticket_id is null and v.status in ('waiting','in_service','checkout');
 if coalesce(cardinality(visits),0)<>1 then raise exception 'No unique active check-in for this account in this salon. Ask the customer to check in first.'; end if;
 return staff_scan_connect(p_salon,visits[1]);
end $$;

-- Include caller eligibility in the existing desk projection; do not expose contacts.
do $$declare definition text;begin
 definition:=pg_get_functiondef('public.service_relay_payload(uuid)'::regprocedure);
 if position('''scanMode'',t.scan_mode,' in definition)=0 then raise exception 'Install Staff Scan before Personal QR'; end if;
 definition:=replace(definition,'''scanMode'',t.scan_mode,','''scanMode'',t.scan_mode,''canNotifyReady'',(v.status=''waiting'' and v.ticket_id is null and c.customer_user_id is not null),');
 execute definition;
end $$;

revoke all on function public.personal_qr_issue(),public.personal_qr_checkin(uuid,uuid[],uuid),public.personal_qr_visit(uuid),public.personal_qr_workspace(),public.personal_qr_staff_preview(uuid,uuid),public.personal_qr_staff_send(uuid,uuid) from public,anon;
grant execute on function public.personal_qr_issue(),public.personal_qr_checkin(uuid,uuid[],uuid),public.personal_qr_visit(uuid),public.personal_qr_workspace(),public.personal_qr_staff_preview(uuid,uuid),public.personal_qr_staff_send(uuid,uuid) to authenticated;
revoke all on function public.personal_qr_connect_customer(uuid,uuid) from public,anon;
grant execute on function public.personal_qr_connect_customer(uuid,uuid) to authenticated;
revoke all on function public.personal_qr_notify_ready(uuid,uuid,uuid,text,uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.personal_qr_notify_ready(uuid,uuid,uuid,text,uuid,uuid,text) to anon,authenticated;
notify pgrst,'reload schema';
commit;
