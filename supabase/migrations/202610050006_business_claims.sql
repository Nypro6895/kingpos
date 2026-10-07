begin;

create function public.business_claim_phone(p_value text) returns text
language sql immutable set search_path=public as $$
 select case when length(d)=10 then '+1'||d when length(d) between 11 and 15 then '+'||d else null end
 from (select regexp_replace(coalesce(p_value,''),'[^0-9]','','g') d) x;
$$;
create function public.business_claim_text(p_value text) returns text
language plpgsql immutable set search_path=public as $$
declare value text:=lower(coalesce(p_value,'')); pair text[];
begin
 foreach pair slice 1 in array array[['street','st'],['avenue','ave'],['road','rd'],['drive','dr'],['boulevard','blvd'],['lane','ln'],['court','ct'],['suite','ste']] loop
 value:=regexp_replace(value,'\m'||pair[1]||'\M',pair[2],'g');
 end loop;
 return regexp_replace(value,'[^a-z0-9]','','g');
end $$;

create table public.business_claim_requests (
 id uuid primary key default gen_random_uuid(),
 salon_id uuid not null references public.locations(id) on delete cascade,
 applicant_user_id uuid not null references public.users(id),
 status text not null check(status in ('otp_pending','waiting','approved','rejected','expired')),
 channel text not null check(channel in ('sms','call','support')),
 phone text, provider_sid text, expires_at timestamptz,
 attempts integer not null default 0, last_sent_at timestamptz,
 phone_verified_at timestamptz, support_reason text,
 attachments jsonb not null default '[]'::jsonb check(jsonb_typeof(attachments)='array' and jsonb_array_length(attachments)<=3),
 created_at timestamptz not null default now(), reviewed_at timestamptz,
 reviewed_by uuid references public.users(id), review_reason text
);
create unique index business_claim_one_open_per_user on public.business_claim_requests(salon_id,applicant_user_id) where status in ('otp_pending','waiting');
create index business_claim_requests_queue on public.business_claim_requests(status,created_at);
create table public.business_claim_sends (
 request_id uuid not null references public.business_claim_requests(id) on delete cascade,
 salon_id uuid not null, applicant_user_id uuid not null, phone text not null, sent_at timestamptz not null default now()
);
create table public.business_claim_events (
 id uuid primary key default gen_random_uuid(), request_id uuid not null references public.business_claim_requests(id) on delete cascade,
 actor_user_id uuid references public.users(id), event text not null, reason text, created_at timestamptz not null default now()
);
alter table public.business_claim_requests enable row level security;
alter table public.business_claim_sends enable row level security;
alter table public.business_claim_events enable row level security;
revoke all on public.business_claim_requests,public.business_claim_sends,public.business_claim_events from public,anon,authenticated;
grant all on public.business_claim_requests,public.business_claim_sends,public.business_claim_events to service_role;

create function public.find_business_claim_matches(p_name text default '',p_phone text default '',p_address text default '',p_unit text default '',p_city text default '',p_state text default '')
returns jsonb language sql stable security definer set search_path=public as $$
 with input as (select public.business_claim_phone(left(p_phone,40)) phone,
 public.business_claim_text(left(p_name,160)) name,public.business_claim_text(left(p_address,250)) address,
 public.business_claim_text(left(p_unit,100)) unit,public.business_claim_text(left(p_city,100)) city,public.business_claim_text(left(p_state,100)) state),
 candidates as (select l.id salon_id,l.name,l.phone,concat_ws(', ',l.address_line1,l.address_line2,l.city,l.state,l.postal_code) address,
 coalesce(d.claim_state='unclaimed',false) unclaimed,
 (i.phone is not null and i.phone=public.business_claim_phone(l.phone)) phone_match,
 (length(i.address)>=5 and i.address=public.business_claim_text(l.address_line1)
 and (i.city<>'' or i.state<>'')
 and (i.city='' or i.city=public.business_claim_text(l.city))
 and (i.state='' or i.state=public.business_claim_text(l.state))
 and i.unit=public.business_claim_text(l.address_line2)) address_match,
 (length(i.name)>=3 and length(public.business_claim_text(l.name))>=3 and (public.business_claim_text(l.name) like '%'||i.name||'%' or i.name like '%'||public.business_claim_text(l.name)||'%')) name_match,
 (i.city<>'' and i.city=public.business_claim_text(l.city)) city_match
 from public.locations l left join public.salon_directory_listings d on d.salon_id=l.id cross join input i
 where public.salon_profile_public_salon_exists(l.id)),
 ranked as (select *,case when phone_match and address_match then 100 when phone_match then 85 when address_match and name_match then 75 when address_match then 50 else 25 end score
 from candidates where phone_match or address_match or (name_match and city_match))
 select coalesce(jsonb_agg(to_jsonb(r) order by score desc,name),'[]'::jsonb) from (select * from ranked order by score desc,name limit 5) r;
$$;
revoke all on function public.find_business_claim_matches(text,text,text,text,text,text) from public,anon;
grant execute on function public.find_business_claim_matches(text,text,text,text,text,text) to authenticated;

-- All grant paths lock account -> salon -> request. No client can invoke this helper.
create function public.complete_business_claim(p_request uuid,p_actor uuid,p_reason text)
returns void language plpgsql security definer set search_path=public as $$
declare r public.business_claim_requests; l public.locations; role_id uuid; account_id_value uuid;
begin
 select salon_id into l.id from public.business_claim_requests where id=p_request;
 select account_id into account_id_value from public.locations where id=l.id;
 perform 1 from public.accounts where id=account_id_value and status='active' for update;
 if not found then raise exception 'Business account is unavailable.'; end if;
 select * into l from public.locations where id=l.id for update;
 select * into r from public.business_claim_requests where id=p_request for update;
 perform 1 from public.salon_directory_listings where salon_id=l.id and claim_state='unclaimed' for update;
 if not found or r.status not in ('otp_pending','waiting') or public.normalize_salon_lifecycle_status(l.status)='permanently_closed'
 or not exists(select 1 from public.users where id=r.applicant_user_id and status='active') then raise exception 'This salon cannot be claimed.'; end if;
 -- An ownerless imported account must contain exactly this salon and no memberships.
 if (select count(*) from public.locations where account_id=l.account_id)<>1
 or exists(select 1 from public.account_memberships where account_id=l.account_id and status<>'removed')
 or exists(select 1 from public.salon_memberships where account_id=l.account_id and status<>'removed') then raise exception 'This salon already has management access. Use an owner invitation or support recovery.'; end if;
 perform public.seed_default_roles_for_account(l.account_id);
 select id into role_id from public.roles where account_id=l.account_id and code='OWNER';
 insert into public.account_memberships(account_id,user_id,role_id,status,joined_at) values(l.account_id,r.applicant_user_id,role_id,'active',now())
 on conflict(account_id,user_id) do update set role_id=excluded.role_id,status='active',joined_at=now();
 insert into public.salon_memberships(account_id,salon_id,user_id,role_id,status,joined_at) values(l.account_id,l.id,r.applicant_user_id,role_id,'active',now())
 on conflict(salon_id,user_id) do update set role_id=excluded.role_id,status='active',joined_at=now();
 insert into public.salon_payroll_settings(salon_id) values(l.id) on conflict(salon_id) do nothing;
 update public.salon_directory_listings set claim_state='claimed',claimed_by_user_id=r.applicant_user_id,claimed_at=now() where salon_id=l.id;
 update public.business_claim_requests set status='approved',reviewed_at=now(),reviewed_by=p_actor,review_reason=p_reason,provider_sid=null,expires_at=null where id=r.id;
 update public.business_claim_requests set status='expired',provider_sid=null,expires_at=null where salon_id=l.id and id<>r.id and status in ('otp_pending','waiting');
 insert into public.business_claim_events(request_id,actor_user_id,event,reason) values(r.id,p_actor,'approved',p_reason);
 -- Booking settings and identity verification are deliberately untouched.
end $$;
revoke all on function public.complete_business_claim(uuid,uuid,text) from public,anon,authenticated;

create function public.begin_business_claim(p_salon uuid,p_user uuid,p_channel text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare r public.business_claim_requests; l public.locations; phone_value text;
begin
 if p_channel is null or p_channel not in ('sms','call') or not exists(select 1 from public.users where id=p_user and status='active') then raise exception 'Sign in with an active account.'; end if;
 perform pg_advisory_xact_lock(hashtextextended('claim-user:'||p_user::text,0));
 perform 1 from public.accounts where id=(select account_id from public.locations where id=p_salon) and status='active' for update;
 if not found then raise exception 'Business is unavailable.'; end if;
 select * into l from public.locations where id=p_salon for update;
 if not exists(select 1 from public.salon_directory_listings where salon_id=p_salon and claim_state='unclaimed')
 or not public.salon_profile_public_salon_exists(p_salon) or public.normalize_salon_lifecycle_status(l.status)='permanently_closed' then raise exception 'This salon already has a manager or is unavailable. Request access from the owner.'; end if;
 if exists(select 1 from public.account_memberships where account_id=l.account_id and status<>'removed')
 or exists(select 1 from public.salon_memberships where account_id=l.account_id and status<>'removed') then raise exception 'This salon already has management access.'; end if;
 phone_value:=public.business_claim_phone(l.phone);
 if phone_value is null then raise exception 'The salon phone needs support verification.'; end if;
 perform pg_advisory_xact_lock(hashtextextended('claim-phone:'||phone_value,0));
 if exists(select 1 from public.business_claim_sends where (phone=phone_value or applicant_user_id=p_user) and sent_at>now()-interval '60 seconds') then raise exception 'Please wait 60 seconds before requesting another code.'; end if;
 if (select count(*) from public.business_claim_sends where phone=phone_value and sent_at>now()-interval '1 hour')>=5
 or (select count(*) from public.business_claim_sends where applicant_user_id=p_user and sent_at>now()-interval '1 hour')>=10 then raise exception 'Too many requests. Try again in an hour.'; end if;
 select * into r from public.business_claim_requests where salon_id=p_salon and applicant_user_id=p_user and status in ('otp_pending','waiting') for update;
 if r.status='waiting' then raise exception 'Your request is already waiting for review.'; end if;
 if r.id is null then
 insert into public.business_claim_requests(salon_id,applicant_user_id,status,channel,phone,expires_at,last_sent_at) values(p_salon,p_user,'otp_pending',p_channel,phone_value,now()+interval '10 minutes',now()) returning * into r;
 else
 update public.business_claim_requests set channel=p_channel,phone=phone_value,provider_sid=null,expires_at=now()+interval '10 minutes',last_sent_at=now(),attempts=0 where id=r.id returning * into r;
 end if;
 insert into public.business_claim_sends(request_id,salon_id,applicant_user_id,phone) values(r.id,p_salon,p_user,phone_value);
 insert into public.business_claim_events(request_id,actor_user_id,event) values(r.id,p_user,'challenge_reserved');
 return jsonb_build_object('id',r.id,'phone',r.phone,'last_sent_at',r.last_sent_at);
end $$;
revoke all on function public.begin_business_claim(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.begin_business_claim(uuid,uuid,text) to service_role;

-- Persist provider SID only for the reservation that initiated that send.
create function public.attach_business_claim_challenge(p_request uuid,p_user uuid,p_sent_at timestamptz,p_sid text)
returns boolean language plpgsql security definer set search_path=public as $$
begin
 update public.business_claim_requests set provider_sid=p_sid where id=p_request and applicant_user_id=p_user and status='otp_pending' and last_sent_at=p_sent_at and provider_sid is null;
 return found;
end $$;
revoke all on function public.attach_business_claim_challenge(uuid,uuid,timestamptz,text) from public,anon,authenticated;
grant execute on function public.attach_business_claim_challenge(uuid,uuid,timestamptz,text) to service_role;

create function public.reserve_business_claim_check(p_request uuid,p_user uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare r public.business_claim_requests;
begin
 select * into r from public.business_claim_requests where id=p_request and applicant_user_id=p_user for update;
 if r.id is null or not exists(select 1 from public.users where id=p_user and status='active') or r.status<>'otp_pending' or r.provider_sid is null or r.expires_at<=now() or r.attempts>=5 then raise exception 'Code expired or attempts exhausted. Request another code.'; end if;
 update public.business_claim_requests set attempts=attempts+1 where id=r.id;
 return jsonb_build_object('phone',r.phone,'provider_sid',r.provider_sid,'salon_id',r.salon_id);
end $$;
revoke all on function public.reserve_business_claim_check(uuid,uuid) from public,anon,authenticated;
grant execute on function public.reserve_business_claim_check(uuid,uuid) to service_role;

create function public.confirm_business_claim(p_request uuid,p_user uuid,p_sid text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare r public.business_claim_requests; l public.locations; automatic boolean;
begin
 perform 1 from public.accounts where id=(select loc.account_id from public.locations loc join public.business_claim_requests req on req.salon_id=loc.id where req.id=p_request) for update;
 select loc.* into l from public.locations loc join public.business_claim_requests req on req.salon_id=loc.id where req.id=p_request for update of loc;
 select * into r from public.business_claim_requests where id=p_request and applicant_user_id=p_user for update;
 if r.id is null or r.status<>'otp_pending' or r.expires_at<=now() or p_sid is null or r.provider_sid is distinct from p_sid
 or r.phone is distinct from public.business_claim_phone(l.phone) then raise exception 'Challenge is no longer valid. Request another code.'; end if;
 update public.business_claim_requests set phone_verified_at=now() where id=r.id;
 select exists(select 1 from public.salon_directory_listings d where d.salon_id=l.id and d.claim_state='unclaimed' and d.source_type='business_website' and d.collected_on>=current_date-90)
 and (select count(*) from public.locations where public.business_claim_phone(phone)=r.phone)=1
 and not exists(select 1 from public.business_claim_requests where salon_id=l.id and id<>r.id and (status='waiting' or status='otp_pending' and expires_at>now())) into automatic;
 if automatic then
 perform public.complete_business_claim(r.id,p_user,'Verified business website phone; no competing claim.');
 else
 update public.business_claim_requests set status='waiting',provider_sid=null,expires_at=null where id=r.id;
 insert into public.business_claim_events(request_id,actor_user_id,event,reason) values(r.id,p_user,'phone_verified','Phone confirmed; ownership review required.');
 end if;
 return jsonb_build_object('status',case when automatic then 'approved' else 'waiting' end,'salon_id',l.id);
end $$;
revoke all on function public.confirm_business_claim(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.confirm_business_claim(uuid,uuid,text) to service_role;

create function public.request_business_claim_support(p_salon uuid,p_reason text,p_attachments jsonb default '[]')
returns uuid language plpgsql security definer set search_path=public as $$
declare actor uuid:=public.current_public_user_id(); r public.business_claim_requests; request_id uuid;
begin
 if actor is null or not exists(select 1 from public.users where id=actor and status='active') then raise exception 'Sign in with an active account.'; end if;
 if length(btrim(coalesce(p_reason,''))) not between 10 and 2000 then raise exception 'Explain your connection to the salon and the phone issue (10–2000 characters).'; end if;
 -- Files are attached only by trusted server code; browser cannot supply storage paths.
 if p_attachments is distinct from '[]'::jsonb then raise exception 'Use the secure attachment upload.'; end if;
 perform pg_advisory_xact_lock(hashtextextended('claim-user:'||actor::text,0));
 perform 1 from public.accounts where id=(select account_id from public.locations where id=p_salon) and status='active' for update;
 if not found then raise exception 'Business is unavailable.'; end if;
 perform 1 from public.locations where id=p_salon for update;
 if not public.salon_profile_public_salon_exists(p_salon) then raise exception 'Salon is unavailable.'; end if;
 if (select count(*) from public.business_claim_requests where applicant_user_id=actor and created_at>now()-interval '1 day')>=5 then raise exception 'Too many requests. Try again tomorrow.'; end if;
 select * into r from public.business_claim_requests where salon_id=p_salon and applicant_user_id=actor and status in ('otp_pending','waiting') for update;
 if (select count(*) from public.business_claim_events e join public.business_claim_requests req on req.id=e.request_id where req.applicant_user_id=actor and e.event='support_requested' and e.created_at>now()-interval '1 day')>=5 then raise exception 'Too many support requests. Try again tomorrow.'; end if;
 if r.status='waiting' then
 update public.business_claim_requests set support_reason=btrim(p_reason) where id=r.id;
 insert into public.business_claim_events(request_id,actor_user_id,event) values(r.id,actor,'support_requested');
 return r.id;
 end if;
 if r.id is null then
 insert into public.business_claim_requests(salon_id,applicant_user_id,status,channel,support_reason) values(p_salon,actor,'waiting','support',btrim(p_reason)) returning id into request_id;
 else
 update public.business_claim_requests set status='waiting',channel='support',support_reason=btrim(p_reason),provider_sid=null,expires_at=null where id=r.id returning id into request_id;
 end if;
 insert into public.business_claim_events(request_id,actor_user_id,event) values(request_id,actor,'support_requested');
 return request_id;
end $$;
revoke all on function public.request_business_claim_support(uuid,text,jsonb) from public,anon;
grant execute on function public.request_business_claim_support(uuid,text,jsonb) to authenticated;

create function public.attach_business_claim_documents(p_request uuid,p_user uuid,p_documents jsonb)
returns void language plpgsql security definer set search_path=public as $$
declare r public.business_claim_requests;
begin
 perform 1 from public.accounts where id=(select loc.account_id from public.locations loc join public.business_claim_requests req on req.salon_id=loc.id where req.id=p_request) for update;
 perform 1 from public.locations where id=(select salon_id from public.business_claim_requests where id=p_request) for update;
 select * into r from public.business_claim_requests where id=p_request and applicant_user_id=p_user for update;
 if r.id is null or r.status<>'waiting' or jsonb_typeof(p_documents)<>'array' or jsonb_array_length(r.attachments)+jsonb_array_length(p_documents)>3 then raise exception 'Request changed or already has three documents.'; end if;
 update public.business_claim_requests set attachments=attachments||p_documents where id=r.id;
 insert into public.business_claim_events(request_id,actor_user_id,event) values(r.id,p_user,'documents_attached');
end $$;
revoke all on function public.attach_business_claim_documents(uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.attach_business_claim_documents(uuid,uuid,jsonb) to service_role;

create function public.get_business_claim_requests(p_salon uuid default null)
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare actor uuid:=public.current_public_user_id(); admin boolean:=public.platform_admin_has_permission('admin.locations.read');
begin
 if actor is null then raise exception 'Sign in first.'; end if;
 return coalesce((select jsonb_agg((to_jsonb(r)-'provider_sid'-'expires_at'-'attempts')||jsonb_build_object('salon_name',l.name,'address',concat_ws(', ',l.address_line1,l.address_line2,l.city,l.state,l.postal_code),'applicant_name',u.display_name,'applicant_email',u.email,'events',coalesce((select jsonb_agg(to_jsonb(e) order by e.created_at) from public.business_claim_events e where e.request_id=r.id),'[]'::jsonb)) order by r.created_at desc)
 from public.business_claim_requests r join public.locations l on l.id=r.salon_id join public.users u on u.id=r.applicant_user_id
 where (r.applicant_user_id=actor or admin) and (p_salon is null or r.salon_id=p_salon)), '[]'::jsonb);
end $$;
revoke all on function public.get_business_claim_requests(uuid) from public,anon;
grant execute on function public.get_business_claim_requests(uuid) to authenticated;

create function public.review_business_claim(p_request uuid,p_decision text,p_reason text)
returns void language plpgsql security definer set search_path=public as $$
declare r public.business_claim_requests; actor uuid:=public.current_public_user_id();
begin
 if not public.platform_admin_has_permission('admin.locations.update_status') then raise exception 'Admin access required.'; end if;
 if p_decision is null or p_decision not in ('approved','rejected') or length(btrim(coalesce(p_reason,'')))<3 then raise exception 'Choose a decision and provide a reason.'; end if;
 perform 1 from public.accounts where id=(select loc.account_id from public.locations loc join public.business_claim_requests req on req.salon_id=loc.id where req.id=p_request) for update;
 perform 1 from public.locations where id=(select salon_id from public.business_claim_requests where id=p_request) for update;
 select * into r from public.business_claim_requests where id=p_request for update;
 if r.id is null or r.status<>'waiting' then raise exception 'Request is no longer waiting.'; end if;
 if p_decision='approved' then perform public.complete_business_claim(r.id,actor,left(btrim(p_reason),1000));
 else
 update public.business_claim_requests set status='rejected',reviewed_at=now(),reviewed_by=actor,review_reason=left(btrim(p_reason),1000) where id=r.id;
 insert into public.business_claim_events(request_id,actor_user_id,event,reason) values(r.id,actor,'rejected',left(btrim(p_reason),1000));
 end if;
end $$;
revoke all on function public.review_business_claim(uuid,text,text) from public,anon;
grant execute on function public.review_business_claim(uuid,text,text) to authenticated;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values('business-claims','business-claims',false,5242880,array['image/jpeg','image/png','application/pdf']) on conflict(id) do nothing;
notify pgrst,'reload schema';
commit;
