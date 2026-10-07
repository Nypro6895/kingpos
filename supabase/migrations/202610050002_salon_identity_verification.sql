begin;
create table public.salon_verification_requests (
 id uuid primary key default gen_random_uuid(),
 salon_id uuid not null references public.locations(id) on delete cascade,
 applicant_user_id uuid not null references public.users(id),
 attempt integer not null check (attempt > 0),
 salon_name text not null check (length(btrim(salon_name)) between 2 and 160),
 address text not null check (length(btrim(address)) between 5 and 500),
 phone text not null check (phone ~ '^\+[1-9][0-9]{7,14}$'),
 status text not null default 'otp_pending' check (status in ('otp_pending','waiting','approved','rejected','blocked','expired')),
 attachments jsonb not null default '[]'::jsonb check (jsonb_typeof(attachments) = 'array'),
 otp_hash text, otp_expires_at timestamptz, otp_attempts integer not null default 0,
 last_sent_at timestamptz not null default now(),
 created_at timestamptz not null default now(), submitted_at timestamptz,
 reviewed_at timestamptz, reviewed_by uuid references public.users(id), review_reason text,
 unique(salon_id, attempt)
);
create unique index salon_verification_one_open on public.salon_verification_requests(salon_id) where status in ('otp_pending','waiting');
alter table public.salon_verification_requests enable row level security;
revoke all on public.salon_verification_requests from anon, authenticated;
grant all on public.salon_verification_requests to service_role;
create table public.salon_verification_decisions (
 id uuid primary key default gen_random_uuid(),request_id uuid not null references public.salon_verification_requests(id) on delete cascade,
 decision text not null, reason text,reviewer_id uuid not null references public.users(id),created_at timestamptz not null default now()
);
alter table public.salon_verification_decisions enable row level security;
revoke all on public.salon_verification_decisions from public,anon,authenticated;
create table public.salon_verification_sends(salon_id uuid not null references public.locations(id) on delete cascade, sent_at timestamptz not null default now());
alter table public.salon_verification_sends enable row level security;
revoke all on public.salon_verification_sends from public,anon,authenticated;

create function public.salon_verification_is_owner(p_salon uuid, p_user uuid)
returns boolean language sql stable security definer set search_path=public as $$
 select exists(select 1 from public.locations l join public.account_memberships m on m.account_id=l.account_id join public.roles r on r.id=m.role_id where l.id=p_salon and m.user_id=p_user and m.status='active' and upper(r.code)='OWNER')
 or exists(select 1 from public.salon_memberships m join public.roles r on r.id=m.role_id where m.salon_id=p_salon and m.user_id=p_user and m.status='active' and upper(r.code)='OWNER');
$$;
revoke all on function public.salon_verification_is_owner(uuid,uuid) from public,anon,authenticated;

-- Only the server may create a challenge: browser callers cannot choose a known hash.
create function public.begin_salon_verification(p_salon uuid,p_user uuid,p_name text,p_address text,p_phone text,p_hash text,p_attachments jsonb default '[]')
returns uuid language plpgsql security definer set search_path=public as $$
declare previous public.salon_verification_requests; request_id uuid;
begin
 if not public.salon_verification_is_owner(p_salon,p_user) then raise exception 'Owner access required.'; end if;
 perform 1 from public.locations where id=p_salon for update;
 select * into previous from public.salon_verification_requests where salon_id=p_salon order by attempt desc limit 1;
 if previous.status in ('blocked','approved','waiting') then raise exception 'Verification is already approved, waiting or blocked.'; end if;
 if previous.last_sent_at > now()-interval '60 seconds' then raise exception 'Please wait 60 seconds before requesting another code.'; end if;
 if (select count(*) from public.salon_verification_sends where salon_id=p_salon and sent_at>now()-interval '1 hour') >= 5 then raise exception 'Too many requests. Try again in an hour.'; end if;
 if jsonb_array_length(p_attachments)>3 or (coalesce(previous.attempt,0)=0 and jsonb_array_length(p_attachments)>0) then raise exception 'Invalid attachments.'; end if;
 if previous.status='otp_pending' then
  -- Resending an unsubmitted application keeps the application number.
  update public.salon_verification_requests set applicant_user_id=p_user,salon_name=btrim(p_name),address=btrim(p_address),phone=p_phone,otp_hash=p_hash,otp_expires_at=now()+interval '10 minutes',otp_attempts=0,last_sent_at=now(),attachments=p_attachments where id=previous.id returning id into request_id;
 else
  insert into public.salon_verification_requests(salon_id,applicant_user_id,attempt,salon_name,address,phone,otp_hash,otp_expires_at,attachments)
  values(p_salon,p_user,coalesce(previous.attempt,0)+1,btrim(p_name),btrim(p_address),p_phone,p_hash,now()+interval '10 minutes',p_attachments) returning id into request_id;
 end if;
 insert into public.salon_verification_sends(salon_id) values(p_salon);
 return request_id;
end;
$$;
revoke all on function public.begin_salon_verification(uuid,uuid,text,text,text,text,jsonb) from public,anon,authenticated;
grant execute on function public.begin_salon_verification(uuid,uuid,text,text,text,text,jsonb) to service_role;

create function public.confirm_salon_verification(p_request uuid,p_code text)
returns jsonb language plpgsql security definer set search_path=public,extensions as $$
declare request public.salon_verification_requests;
begin
 select * into request from public.salon_verification_requests where id=p_request for update;
 if request.id is null or not public.salon_verification_is_owner(request.salon_id,public.current_public_user_id()) or request.applicant_user_id<>public.current_public_user_id() then raise exception 'Owner access required.'; end if;
 if request.status<>'otp_pending' or request.otp_hash is null or request.otp_expires_at is null or request.otp_expires_at<=now() or request.otp_attempts>=5 then return jsonb_build_object('ok',false,'message','Code expired or attempts exhausted. Request another code.'); end if;
 if p_code is null or p_code !~ '^[0-9]{6}$' or encode(digest(request.phone || ':' || p_code,'sha256'),'hex')<>request.otp_hash then
  update public.salon_verification_requests set otp_attempts=otp_attempts+1 where id=p_request;
  return jsonb_build_object('ok',false,'message','Invalid code.');
 end if;
 update public.salon_verification_requests set status='waiting',submitted_at=now(),otp_hash=null,otp_expires_at=null where id=p_request;
 return jsonb_build_object('ok',true);
end;
$$;
revoke all on function public.confirm_salon_verification(uuid,text) from public,anon;
grant execute on function public.confirm_salon_verification(uuid,text) to authenticated;

create function public.get_salon_verification_requests(p_salon uuid default null)
returns jsonb language plpgsql stable security definer set search_path=public as $$
begin
 if p_salon is null then
  if not public.platform_admin_has_permission('admin.locations.read') then raise exception 'Admin access required.'; end if;
 elsif not public.salon_verification_is_owner(p_salon,public.current_public_user_id()) then raise exception 'Owner access required.';
 end if;
 return coalesce((select jsonb_agg((to_jsonb(r)-'otp_hash'-'otp_expires_at'-'otp_attempts') || jsonb_build_object('decisions',coalesce((select jsonb_agg(to_jsonb(d) order by d.created_at) from public.salon_verification_decisions d where d.request_id=r.id),'[]'::jsonb)) order by r.attempt desc,r.created_at desc) from public.salon_verification_requests r where (p_salon is null and r.status<>'otp_pending' or r.salon_id=p_salon)), '[]'::jsonb);
end;
$$;
revoke all on function public.get_salon_verification_requests(uuid) from public,anon;
grant execute on function public.get_salon_verification_requests(uuid) to authenticated;

create function public.review_salon_verification(p_request uuid,p_decision text,p_reason text default null)
returns void language plpgsql security definer set search_path=public as $$
declare request public.salon_verification_requests;
begin
 if not public.platform_admin_has_permission('admin.locations.update_status') then raise exception 'Admin access required.'; end if;
 select * into request from public.salon_verification_requests where id=p_request for update;
 perform 1 from public.locations where id=request.salon_id for update;
 if request.id is null or request.attempt<>(select max(attempt) from public.salon_verification_requests where salon_id=request.salon_id) then raise exception 'Only the latest application can be reviewed.'; end if;
 if p_decision in ('approved','rejected') and request.status<>'waiting' then raise exception 'Application is not waiting for review.'; end if;
 if p_decision='blocked' and request.status not in ('waiting','rejected') then raise exception 'Application cannot be blocked.'; end if;
 if p_decision='unblock' and request.status<>'blocked' then raise exception 'Application is not blocked.'; end if;
 if p_decision not in ('approved','rejected','blocked','unblock') then raise exception 'Invalid decision.'; end if;
 if p_decision in ('rejected','blocked') and length(btrim(coalesce(p_reason,'')))<3 then raise exception 'A reason is required.'; end if;
 update public.salon_verification_requests set status=case when p_decision='unblock' then 'rejected' else p_decision end, reviewed_at=now(),reviewed_by=public.current_public_user_id(),review_reason=left(btrim(p_reason),1000) where id=p_request;
 insert into public.salon_verification_decisions(request_id,decision,reason,reviewer_id) values(p_request,p_decision,left(btrim(p_reason),1000),public.current_public_user_id());
end;
$$;
revoke all on function public.review_salon_verification(uuid,text,text) from public,anon;
grant execute on function public.review_salon_verification(uuid,text,text) to authenticated;

create function public.get_public_salon_identity(target_salon_ids uuid[])
returns table(salon_id uuid,identity_verified boolean,service_name text,minimum_price numeric,maximum_price numeric,completed_booking_count bigint)
language sql stable security definer set search_path=public as $$
 with visible as (select id from public.locations where id=any(target_salon_ids) and public.salon_profile_public_salon_exists(id)),
 groups as (
 select s.salon_id,coalesce(nullif(btrim(s.category),''),s.name) group_name,min(s.base_price) minimum_price,max(s.base_price) maximum_price,
 count(distinct b.id) completed_booking_count
 from public.services s join visible v on v.id=s.salon_id
 left join public.booking_lines bl on bl.service_id=s.id and bl.salon_id=s.salon_id and bl.line_type='service' and bl.line_status<>'cancelled'
 left join public.bookings b on b.id=bl.booking_id and b.salon_id=s.salon_id and b.status='completed'
 where s.is_active group by s.salon_id,coalesce(nullif(btrim(s.category),''),s.name)
 ), ranked as (select *,row_number() over(partition by salon_id order by completed_booking_count desc,group_name) rank from groups)
 select v.id,coalesce((select r.status='approved' from public.salon_verification_requests r where r.salon_id=v.id order by r.attempt desc limit 1),false),
 g.group_name,g.minimum_price,g.maximum_price,g.completed_booking_count
 from visible v left join ranked g on g.salon_id=v.id and g.rank=1 and g.completed_booking_count>0;
$$;
revoke all on function public.get_public_salon_identity(uuid[]) from public;
grant execute on function public.get_public_salon_identity(uuid[]) to anon,authenticated,service_role;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values('salon-verification','salon-verification',false,5242880,array['image/jpeg','image/png','application/pdf']) on conflict(id) do nothing;
notify pgrst,'reload schema';
commit;
