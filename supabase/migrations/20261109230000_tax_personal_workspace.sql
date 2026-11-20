begin;

-- Personal identity opens the tool; salon credentials grant access to data.
create table public.tax_profiles (
 user_id uuid primary key references public.users(id),
 display_name text not null check(char_length(btrim(display_name)) between 1 and 120),
 contact_email text not null check(char_length(contact_email) between 3 and 254),
 phone text not null default '' check(char_length(phone)<=40),
 company_name text not null default '' check(char_length(company_name)<=160),
 created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
alter table public.tax_profiles enable row level security;
grant select on public.tax_profiles to authenticated;
create policy tax_profile_self on public.tax_profiles for select to authenticated using(user_id=public.current_public_user_id());

create function public.tax_actor() returns uuid language plpgsql stable security definer set search_path=public as $$
declare actor uuid:=current_public_user_id(); begin
 if actor is null or not exists(select 1 from users where id=actor and status='active') then raise exception 'Sign in to an active Reylumi account.'; end if;
 return actor;
end $$;
create function public.tax_is_owner(p_salon uuid) returns boolean language sql stable security definer set search_path=public as $$
 select coalesce(lifecycle_user_is_salon_owner(p_salon,current_public_user_id(),false),false)
 and exists(select 1 from users where id=current_public_user_id() and status='active');
$$;
create function public.tax_can_work(p_salon uuid) returns boolean language sql stable security definer set search_path=public as $$
 select tax_is_owner(p_salon) or tax_company_has_access(p_salon);
$$;
create function public.tax_save_profile(p_name text,p_email text,p_phone text default '',p_company text default '') returns jsonb
language plpgsql security definer set search_path=public as $$
declare item tax_profiles; begin
 if p_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then raise exception 'Enter a valid contact email.'; end if;
 insert into tax_profiles(user_id,display_name,contact_email,phone,company_name)
 values(tax_actor(),btrim(p_name),lower(btrim(p_email)),btrim(p_phone),btrim(p_company))
 on conflict(user_id) do update set display_name=excluded.display_name,contact_email=excluded.contact_email,
 phone=excluded.phone,company_name=excluded.company_name,updated_at=now() returning * into item;
 return to_jsonb(item);
end $$;

create table public.tax_documents (
 id uuid primary key default gen_random_uuid(), salon_id uuid not null references public.locations(id),
 staff_id uuid references public.staff(id), recipient_user_id uuid references public.users(id), staff_delivery boolean not null default false,
 payroll_run_id uuid references public.payroll_runs(id),
 kind text not null check(kind in ('paystub','employee','business','tax','receipt')),
 salon_name text not null default '', staff_name text, period_start date, period_end date,
 title text not null check(char_length(title) between 1 and 240),
 file_name text not null, bucket text not null default 'payroll-paystubs', path text not null,
 mime_type text not null, size_bytes bigint not null check(size_bytes between 1 and 10485760),
 version integer not null default 1, supersedes_id uuid references public.tax_documents(id),
 uploaded_by uuid references public.users(id), uploaded_role text not null check(uploaded_role in ('owner','tax','legacy')),
 created_at timestamptz not null default now(), archived_at timestamptz, owner_deleted_at timestamptz,
 unique(bucket,path), check(kind<>'paystub' or (staff_id is not null and payroll_run_id is not null))
);
create index tax_documents_salon on public.tax_documents(salon_id,created_at desc);
create index tax_documents_recipient on public.tax_documents(recipient_user_id,created_at desc);
create function public.tax_stamp_document() returns trigger language plpgsql security definer set search_path=public as $$ begin
 select name into new.salon_name from locations where id=new.salon_id;
 if new.staff_id is not null then select display_name into new.staff_name from staff where id=new.staff_id; end if;
 if new.payroll_run_id is not null then select period_start,period_end into new.period_start,new.period_end from payroll_runs where id=new.payroll_run_id; end if;
 return new;
end $$;
create trigger tax_stamp_document before insert on public.tax_documents for each row execute function public.tax_stamp_document();
create table public.tax_work_items (
 salon_id uuid not null references public.locations(id), payroll_run_id uuid not null references public.payroll_runs(id),
 staff_id uuid not null references public.staff(id),
 status text not null check(status in ('pending','reviewed','needs_information','complete')),
 version integer not null default 1, updated_by uuid references public.users(id), updated_at timestamptz not null default now(),
 primary key(payroll_run_id,staff_id)
);
create table public.tax_messages (
 id uuid primary key default gen_random_uuid(), salon_id uuid not null references public.locations(id),
 staff_id uuid references public.staff(id), payroll_run_id uuid references public.payroll_runs(id),
 author_id uuid references public.users(id), author_name text not null,
 body text not null check(char_length(btrim(body)) between 1 and 4000),
 document_id uuid references public.tax_documents(id), created_at timestamptz not null default now()
);
create index tax_messages_salon on public.tax_messages(salon_id,created_at);
create table public.tax_receipts (
 id uuid primary key default gen_random_uuid(), salon_id uuid not null references public.locations(id),
 category text not null check(category in ('service_fee','tax_receipt','business_expense')),
 description text not null check(char_length(btrim(description)) between 1 and 500),
 amount_cents bigint not null check(amount_cents between 0 and 99999999999), currency text not null default 'USD' check(currency='USD'),
 receipt_date date not null, status text not null check(status in ('needs_review','received','paid')),
 document_id uuid references public.tax_documents(id), created_by uuid references public.users(id),
 request_id uuid not null default gen_random_uuid(),
 created_at timestamptz not null default now(), archived_at timestamptz, unique(salon_id,created_by,request_id)
);
create table public.tax_events (
 id uuid primary key default gen_random_uuid(), salon_id uuid not null references public.locations(id),
 actor_id uuid references public.users(id), actor_name text not null, action text not null,
 subject_id uuid, detail jsonb not null default '{}'::jsonb, created_at timestamptz not null default now()
);
create table public.tax_uploads (
 id uuid primary key default gen_random_uuid(), salon_id uuid not null references public.locations(id),
 actor_id uuid not null references public.users(id), path text not null unique,
 kind text not null, staff_id uuid, payroll_run_id uuid, recipient_user_id uuid, staff_delivery boolean not null default false,
 file_name text not null, mime_type text not null, size_bytes bigint not null,
 supersedes_id uuid, created_at timestamptz not null default now(), completed_at timestamptz
);

create function public.tax_actor_name() returns text language sql stable security definer set search_path=public as $$
 select coalesce((select display_name from tax_profiles where user_id=current_public_user_id()),
 (select coalesce(nullif(display_name,''),email,'Reylumi user') from users where id=current_public_user_id()),'Reylumi user');
$$;
create function public.tax_event(p_salon uuid,p_action text,p_subject uuid default null,p_detail jsonb default '{}'::jsonb) returns void
language sql security definer set search_path=public as $$
 insert into tax_events(salon_id,actor_id,actor_name,action,subject_id,detail) values(p_salon,current_public_user_id(),tax_actor_name(),p_action,p_subject,p_detail);
$$;
create function public.tax_audit_connection() returns trigger language plpgsql security definer set search_path=public as $$ begin
 if tg_table_name='tax_company_credentials' then
 perform tax_event(new.salon_id,case when not new.enabled then 'access_revoked' when tg_op='INSERT' then 'connection_credentials_created' else 'connection_password_changed' end);
 elsif tg_op='DELETE' then perform tax_event(old.salon_id,'professional_disconnected',old.user_id);
 else perform tax_event(new.salon_id,'professional_connected',new.user_id); end if;
 return null;
end $$;
create trigger tax_audit_credentials after insert or update on public.tax_company_credentials for each row execute function public.tax_audit_connection();
create trigger tax_audit_connections after insert or delete on public.tax_company_connections for each row execute function public.tax_audit_connection();

-- A recipient is frozen on delivery, independent of employment, current links,
-- plugin expiration or a later owner-side deletion. Owner deletion is a tombstone
-- when a delivered personal document must remain available to its recipient.
create function public.tax_document_access(p_id uuid) returns boolean language sql stable security definer set search_path=public as $$
 select exists(select 1 from tax_documents d join users u on u.id=current_public_user_id() where d.id=p_id and u.status='active'
 and (d.recipient_user_id=u.id or (d.owner_deleted_at is null and tax_can_work(d.salon_id))));
$$;
do $$ declare name text; begin
 foreach name in array array['tax_documents','tax_work_items','tax_messages','tax_receipts','tax_events','tax_uploads'] loop
 execute format('alter table public.%I enable row level security',name);
 execute format('revoke all on public.%I from public,anon,authenticated',name);
 end loop;
end $$;
grant select on public.tax_documents,public.tax_work_items,public.tax_messages,public.tax_receipts,public.tax_events to authenticated;
create policy tax_documents_read on public.tax_documents for select to authenticated using(public.tax_document_access(id));
create policy tax_work_read on public.tax_work_items for select to authenticated using(public.tax_can_work(salon_id));
create policy tax_messages_read on public.tax_messages for select to authenticated using(public.tax_can_work(salon_id));
create policy tax_receipts_read on public.tax_receipts for select to authenticated using(public.tax_can_work(salon_id));
create policy tax_events_read on public.tax_events for select to authenticated using(public.tax_can_work(salon_id));

-- Connected professionals cannot query full payroll rows/settings/account data.
drop policy if exists tax_connected_lines on public.payroll_staff_lines;
drop policy if exists tax_connected_runs on public.payroll_runs;
drop policy if exists tax_connected_paystubs_read on public.payroll_paystubs;
drop policy if exists tax_connected_paystubs_insert on public.payroll_paystubs;
drop policy if exists tax_connected_paystubs_update on public.payroll_paystubs;
create or replace function public.tax_company_scope(p_salon uuid) returns jsonb
language plpgsql stable security definer set search_path=public as $$ begin
 if not tax_company_has_access(p_salon) then raise exception 'This salon connection is inactive.'; end if;
 return (select jsonb_build_object('salon',jsonb_build_object('id',l.id,'account_id',l.account_id,'name',l.name,'phone',l.phone,
 'address_line1',l.address_line1,'address_line2',l.address_line2,'city',l.city,'state',l.state,'postal_code',l.postal_code,'country',l.country),
 'account',jsonb_build_object('id',l.account_id),'payroll_setting',(select jsonb_build_object('cycle_type',s.cycle_type,'biweekly_anchor_date',s.biweekly_anchor_date) from salon_payroll_settings s where salon_id=p_salon)) from locations l where l.id=p_salon);
end $$;

create function public.tax_workspace_data(p_salon uuid) returns jsonb language plpgsql stable security definer set search_path=public as $$
begin
 perform tax_actor();
 if not tax_can_work(p_salon) then raise exception 'This salon connection is inactive.'; end if;
 return jsonb_build_object(
 'salon',(select jsonb_build_object('id',id,'name',name,'phone',phone,'city',city,'state',state,'address_line1',address_line1) from locations where id=p_salon),
 'runs',coalesce((select jsonb_agg(jsonb_build_object('id',r.id,'period_start',r.period_start,'period_end',r.period_end,'version',r.version,'status',r.status,'cycle_type',r.cycle_type) order by r.period_start desc,r.version desc) from payroll_runs r where r.salon_id=p_salon and r.status in ('printed','paid')),'[]'::jsonb),
 'lines',coalesce((select jsonb_agg(jsonb_build_object('id',l.id,'run_id',l.payroll_run_id,'staff_id',l.staff_id,'name',l.staff_display_name_snapshot,'legal_name',l.staff_legal_name_snapshot,
 'reported_gross',l.tax_company_taxable_gross,'tax',l.tax_withheld,'actual_check',l.final_check_amount,'wage_check_net',l.base_check_amount,
 'cash_reported',case when l.cash_to_tax_company_snapshot or (l.tax_tips_snapshot and l.tip_payout_method_snapshot='cash') or (l.tax_bonus_snapshot and l.bonus_payout_method_snapshot='cash') then l.tax_company_cash_amount else null end,
 'tip',case when l.tax_tips_snapshot then l.tip_amount else null end,'tip_method',case when l.tax_tips_snapshot then l.tip_payout_method_snapshot else null end,
 'bonus',case when l.tax_bonus_snapshot then l.bonus_amount else null end,'bonus_method',case when l.tax_bonus_snapshot then l.bonus_payout_method_snapshot else null end,'tax_rate',l.tax_rate_used,
 'work_status',coalesce(w.status,'pending'),'work_version',coalesce(w.version,0))) from payroll_staff_lines l
 join payroll_runs r on r.id=l.payroll_run_id and r.salon_id=l.salon_id
 left join tax_work_items w on w.payroll_run_id=l.payroll_run_id and w.staff_id=l.staff_id
 where l.salon_id=p_salon and r.status in ('printed','paid') and (l.tax_company_enabled_snapshot or l.final_check_amount<>0 or l.tax_company_taxable_gross>0 or l.tax_withheld>0)),'[]'::jsonb),
 'documents',coalesce((select jsonb_agg(to_jsonb(d)-'path'-'bucket' order by d.created_at desc) from tax_documents d where d.salon_id=p_salon and d.owner_deleted_at is null),'[]'::jsonb),
 'messages',coalesce((select jsonb_agg(to_jsonb(m) order by m.created_at) from tax_messages m where m.salon_id=p_salon),'[]'::jsonb),
 'receipts',coalesce((select jsonb_agg(to_jsonb(c) order by c.receipt_date desc) from tax_receipts c where c.salon_id=p_salon),'[]'::jsonb),
 'events',coalesce((select jsonb_agg(to_jsonb(e) order by e.created_at desc) from (select * from tax_events where salon_id=p_salon order by created_at desc limit 200) e),'[]'::jsonb));
end $$;

create function public.tax_businesses() returns jsonb language sql stable security definer set search_path=public as $$
 with connected as (select l.id,l.name,l.city,l.state from tax_company_connections c join locations l on l.id=c.salon_id where c.user_id=current_public_user_id() and tax_company_has_access(l.id)),
 latest as (select distinct on (r.salon_id,r.period_start,r.period_end) r.* from payroll_runs r join connected c on c.id=r.salon_id where r.status in ('printed','paid') order by r.salon_id,r.period_start,r.period_end,r.version desc),
 actionable as (select l.salon_id,l.staff_id,l.payroll_run_id,coalesce(w.status,'pending') status from payroll_staff_lines l join latest r on r.id=l.payroll_run_id left join tax_work_items w on w.payroll_run_id=l.payroll_run_id and w.staff_id=l.staff_id
 where l.tax_company_enabled_snapshot or l.final_check_amount<>0 or l.tax_company_taxable_gross>0 or l.tax_withheld>0)
 select coalesce(jsonb_agg(jsonb_build_object('id',c.id,'name',c.name,'city',c.city,'state',c.state,'active',true,
 'pending_count',(select count(*) from actionable a where a.salon_id=c.id and a.status<>'complete'),
 'missing_paystubs',(select count(*) from actionable a where a.salon_id=c.id and not exists(select 1 from tax_documents d where d.salon_id=a.salon_id and d.staff_id=a.staff_id and d.payroll_run_id=a.payroll_run_id and d.kind='paystub' and d.archived_at is null and d.owner_deleted_at is null))) order by c.name),'[]'::jsonb) from connected c;
$$;

create function public.tax_require_current_run(p_salon uuid,p_run uuid) returns void language plpgsql stable security definer set search_path=public as $$
declare statement payroll_runs; begin
 select * into statement from payroll_runs where id=p_run and salon_id=p_salon and status in ('printed','paid');
 if statement.id is null then raise exception 'Published payroll required.'; end if;
 if exists(select 1 from payroll_runs where salon_id=p_salon and period_start=statement.period_start and period_end=statement.period_end and version>statement.version and status in ('printed','paid')) then raise exception 'Payroll changed to a newer version. Refresh and review it before saving or sending paystubs.'; end if;
end $$;

create function public.tax_set_work(p_salon uuid,p_run uuid,p_staff uuid,p_status text,p_expected integer) returns jsonb
language plpgsql security definer set search_path=public as $$
declare w tax_work_items; begin
 perform tax_actor(); if not tax_can_work(p_salon) then raise exception 'This salon connection is inactive.'; end if;
 if p_status not in ('pending','reviewed','needs_information','complete') then raise exception 'Choose a valid status.'; end if;
 perform tax_require_current_run(p_salon,p_run);
 if not exists(select 1 from payroll_staff_lines l join payroll_runs r on r.id=l.payroll_run_id where l.payroll_run_id=p_run and l.staff_id=p_staff and l.salon_id=p_salon and r.salon_id=p_salon and r.status in ('printed','paid')) then raise exception 'Published payroll line required.'; end if;
 perform pg_advisory_xact_lock(hashtextextended('tax.work:'||p_run::text||':'||p_staff::text,0));
 select * into w from tax_work_items where payroll_run_id=p_run and staff_id=p_staff for update;
 if p_expected is distinct from coalesce(w.version,0) then raise exception 'Status changed on another device. Refresh before saving.'; end if;
 insert into tax_work_items(salon_id,payroll_run_id,staff_id,status,updated_by) values(p_salon,p_run,p_staff,p_status,tax_actor())
 on conflict(payroll_run_id,staff_id) do update set status=excluded.status,version=tax_work_items.version+1,updated_by=excluded.updated_by,updated_at=now() returning * into w;
 perform tax_event(p_salon,'status_updated',p_staff,jsonb_build_object('run_id',p_run,'status',p_status)); return to_jsonb(w);
end $$;

create function public.tax_send_message(p_salon uuid,p_body text,p_staff uuid default null,p_run uuid default null,p_document uuid default null) returns jsonb
language plpgsql security definer set search_path=public as $$ declare m tax_messages; begin
 perform tax_actor(); if not tax_can_work(p_salon) then raise exception 'This salon connection is inactive.'; end if;
 if p_staff is not null and not exists(select 1 from staff where id=p_staff and salon_id=p_salon) then raise exception 'Employee belongs to another business.'; end if;
 if p_run is not null and not exists(select 1 from payroll_runs where id=p_run and salon_id=p_salon and status in ('printed','paid')) then raise exception 'Published payroll required.'; end if;
 if p_document is not null and not exists(select 1 from tax_documents where id=p_document and salon_id=p_salon and owner_deleted_at is null) then raise exception 'Document unavailable.'; end if;
 insert into tax_messages(salon_id,staff_id,payroll_run_id,author_id,author_name,body,document_id) values(p_salon,p_staff,p_run,tax_actor(),tax_actor_name(),btrim(p_body),p_document) returning * into m;
 perform tax_event(p_salon,'message_sent',m.id); return to_jsonb(m);
end $$;

create function public.tax_begin_upload(p_salon uuid,p_kind text,p_staff uuid,p_run uuid,p_name text,p_mime text,p_size bigint,p_supersedes uuid default null,p_share_staff boolean default false) returns jsonb
language plpgsql security definer set search_path=public as $$
declare upload tax_uploads; recipient uuid; doc tax_documents; begin
 perform tax_actor(); if not tax_can_work(p_salon) then raise exception 'This salon connection is inactive.'; end if;
 if p_kind not in ('paystub','employee','business','tax','receipt') or p_mime not in ('application/pdf','image/png','image/jpeg','image/webp') or p_size not between 1 and 10485760 or char_length(p_name) not between 1 and 240 then raise exception 'Use a PDF, PNG, JPEG or WebP file up to 10 MB.'; end if;
 if p_staff is not null and not exists(select 1 from staff where id=p_staff and salon_id=p_salon) then raise exception 'Employee belongs to another business.'; end if;
 if p_kind='paystub' and (p_staff is null or p_run is null or not exists(select 1 from payroll_staff_lines l join payroll_runs r on r.id=l.payroll_run_id where l.salon_id=p_salon and r.salon_id=p_salon and l.staff_id=p_staff and r.id=p_run and r.status in ('printed','paid'))) then raise exception 'Choose an employee and published payroll period.'; end if;
 if p_run is not null and not exists(select 1 from payroll_runs where id=p_run and salon_id=p_salon and status in ('printed','paid')) then raise exception 'Published payroll required.'; end if;
 if p_kind='paystub' then perform tax_require_current_run(p_salon,p_run); end if;
 if p_supersedes is not null then
 select * into doc from tax_documents where id=p_supersedes and salon_id=p_salon and owner_deleted_at is null and archived_at is null;
 if doc.id is null or doc.staff_id is distinct from p_staff or doc.kind<>p_kind or doc.payroll_run_id is distinct from p_run then raise exception 'Refresh the current document before replacing it.'; end if;
 if doc.uploaded_role='owner' and not tax_is_owner(p_salon) then raise exception 'Only the owner can replace an owner-uploaded source file. Upload a separate result document.'; end if;
 end if;
 if p_kind='paystub' or p_share_staff then
 if p_staff is null then raise exception 'Choose a staff recipient.'; end if;
 select coalesce(s.account_user_id,u.id) into recipient from staff s left join users u on u.auth_user_id=s.user_id where s.id=p_staff and s.salon_id=p_salon;
 recipient:=coalesce(recipient,doc.recipient_user_id,(select d.recipient_user_id from tax_documents d where d.salon_id=p_salon and d.staff_id=p_staff and d.recipient_user_id is not null order by d.created_at desc limit 1));
 end if;
 upload.id:=gen_random_uuid();
 insert into tax_uploads(id,salon_id,actor_id,path,kind,staff_id,payroll_run_id,recipient_user_id,staff_delivery,file_name,mime_type,size_bytes,supersedes_id)
 values(upload.id,p_salon,tax_actor(),(select account_id::text from locations where id=p_salon)||'/'||p_salon::text||'/'||coalesce(p_run::text,'documents')||'/'||coalesce(p_staff::text,'business')||'/'||upload.id::text,p_kind,p_staff,p_run,recipient,p_kind='paystub' or p_share_staff,p_name,p_mime,p_size,p_supersedes) returning * into upload;
 return jsonb_build_object('id',upload.id,'path',upload.path);
end $$;

create function public.tax_finish_upload(p_upload uuid) returns jsonb language plpgsql security definer set search_path=public as $$
declare up tax_uploads; old tax_documents; doc tax_documents; begin
 perform tax_actor(); select * into up from tax_uploads where id=p_upload and actor_id=tax_actor() for update;
 if up.id is null or not tax_can_work(up.salon_id) then raise exception 'Upload or salon connection unavailable.'; end if;
 if up.completed_at is not null then select * into doc from tax_documents where bucket='payroll-paystubs' and path=up.path; return to_jsonb(doc)-'path'-'bucket'; end if;
 if up.created_at<now()-interval '30 minutes' then raise exception 'Upload expired. Choose the file again.'; end if;
 if up.kind='paystub' then perform tax_require_current_run(up.salon_id,up.payroll_run_id); end if;
 if not exists(select 1 from storage.objects where bucket_id='payroll-paystubs' and name=up.path) then raise exception 'File upload has not completed.'; end if;
 perform pg_advisory_xact_lock(hashtextextended('tax.doc:'||up.salon_id::text||':'||coalesce(up.staff_id::text,'business')||':'||coalesce(up.payroll_run_id::text,'none')||':'||up.kind,0));
 if up.supersedes_id is not null then
 select * into old from tax_documents where id=up.supersedes_id and salon_id=up.salon_id for update;
 if old.id is null or old.archived_at is not null or old.owner_deleted_at is not null then raise exception 'Another upload replaced this document. Refresh before retrying.'; end if;
 if old.uploaded_role='owner' and not tax_is_owner(up.salon_id) then raise exception 'Only the owner can replace an owner-uploaded source file.'; end if;
 update tax_documents set archived_at=now() where id=old.id;
 elsif up.kind='paystub' and exists(select 1 from tax_documents where salon_id=up.salon_id and staff_id=up.staff_id and payroll_run_id=up.payroll_run_id and kind='paystub' and archived_at is null and owner_deleted_at is null) then
 raise exception 'A paystub was uploaded on another device. Refresh and replace its current version.';
 end if;
 insert into tax_documents(salon_id,staff_id,recipient_user_id,staff_delivery,payroll_run_id,kind,title,file_name,path,mime_type,size_bytes,version,supersedes_id,uploaded_by,uploaded_role)
 values(up.salon_id,up.staff_id,up.recipient_user_id,up.staff_delivery,up.payroll_run_id,up.kind,up.file_name,up.file_name,up.path,up.mime_type,up.size_bytes,coalesce(old.version,0)+1,old.id,tax_actor(),case when tax_is_owner(up.salon_id) then 'owner' else 'tax' end) returning * into doc;
 if up.kind='paystub' then
 update tax_documents d set archived_at=coalesce(d.archived_at,now()) where d.salon_id=up.salon_id and d.staff_id=up.staff_id and d.kind='paystub' and d.payroll_run_id in
 (select older.id from payroll_runs older join payroll_runs current on current.id=up.payroll_run_id where older.salon_id=up.salon_id and older.period_start=current.period_start and older.period_end=current.period_end and older.version<current.version);
 end if;
 -- Keep the established Payroll/My Pay surfaces on the same current paystub.
 if up.kind='paystub' then
 update payroll_paystubs set file_name=up.file_name,file_url_or_path=up.path,mime_type=up.mime_type,size_bytes=up.size_bytes,uploaded_by=tax_actor(),updated_at=now()
 where salon_id=up.salon_id and payroll_run_id=up.payroll_run_id and staff_id=up.staff_id;
 if not found then insert into payroll_paystubs(salon_id,payroll_run_id,staff_id,file_name,file_url_or_path,mime_type,size_bytes,uploaded_by)
 values(up.salon_id,up.payroll_run_id,up.staff_id,up.file_name,up.path,up.mime_type,up.size_bytes,tax_actor()); end if;
 end if;
 update tax_uploads set completed_at=now() where id=up.id;
 perform tax_event(up.salon_id,'document_uploaded',doc.id,jsonb_build_object('title',doc.title,'version',doc.version,'staff_id',doc.staff_id));
 return to_jsonb(doc)-'path'-'bucket';
end $$;

create function public.tax_archive_document(p_document uuid,p_restore boolean default false) returns void language plpgsql security definer set search_path=public as $$
declare doc tax_documents; begin
 perform tax_actor(); select * into doc from tax_documents where id=p_document for update;
 if doc.id is null or doc.owner_deleted_at is not null or not tax_can_work(doc.salon_id) then raise exception 'Document unavailable.'; end if;
 if not tax_is_owner(doc.salon_id) and (doc.uploaded_role='owner' or p_restore) then raise exception 'Only the owner can archive owner files or restore a file.'; end if;
 if p_restore and doc.kind='paystub' and exists(select 1 from tax_documents where salon_id=doc.salon_id and staff_id=doc.staff_id and payroll_run_id=doc.payroll_run_id and kind='paystub' and archived_at is null and owner_deleted_at is null and id<>doc.id) then raise exception 'Archive the current paystub before restoring an older version.'; end if;
 update tax_documents set archived_at=case when p_restore then null else now() end where id=doc.id;
 perform tax_event(doc.salon_id,case when p_restore then 'document_restored' else 'document_archived' end,doc.id,jsonb_build_object('title',doc.title));
end $$;
create function public.tax_owner_delete_document(p_document uuid) returns void language plpgsql security definer set search_path=public as $$
declare doc tax_documents; begin
 perform tax_actor(); select * into doc from tax_documents where id=p_document for update;
 if doc.id is null or not tax_is_owner(doc.salon_id) then raise exception 'Salon owner access required.'; end if;
 update tax_documents set owner_deleted_at=now(),archived_at=coalesce(archived_at,now()) where id=doc.id;
 perform tax_event(doc.salon_id,'document_removed_by_owner',doc.id,jsonb_build_object('staff_copy_retained',doc.recipient_user_id is not null));
end $$;

create function public.tax_save_receipt(p_salon uuid,p_category text,p_description text,p_cents bigint,p_date date,p_status text,p_document uuid default null,p_request uuid default null) returns jsonb
language plpgsql security definer set search_path=public as $$ declare item tax_receipts; begin
 perform tax_actor(); if not tax_can_work(p_salon) then raise exception 'This salon connection is inactive.'; end if;
 if p_document is not null and not exists(select 1 from tax_documents where id=p_document and salon_id=p_salon and owner_deleted_at is null) then raise exception 'Document unavailable.'; end if;
 insert into tax_receipts(salon_id,category,description,amount_cents,receipt_date,status,document_id,created_by,request_id)
 values(p_salon,p_category,btrim(p_description),p_cents,p_date,p_status,p_document,tax_actor(),coalesce(p_request,gen_random_uuid()))
 on conflict(salon_id,created_by,request_id) do nothing returning * into item;
 if item.id is null then select * into item from tax_receipts where salon_id=p_salon and created_by=tax_actor() and request_id=p_request; return to_jsonb(item); end if;
 perform tax_event(p_salon,'receipt_added',item.id,to_jsonb(item)); return to_jsonb(item);
end $$;
create function public.tax_archive_receipt(p_id uuid) returns void language plpgsql security definer set search_path=public as $$
declare item tax_receipts; begin
 perform tax_actor(); select * into item from tax_receipts where id=p_id for update;
 if item.id is null or not tax_can_work(item.salon_id) then raise exception 'Receipt unavailable.'; end if;
 update tax_receipts set archived_at=now() where id=p_id;
 perform tax_event(item.salon_id,'receipt_archived',item.id,to_jsonb(item));
end $$;

-- Historical personal notes become part of the owner-owned handover record.
insert into tax_messages(salon_id,author_id,author_name,body,created_at)
 select n.salon_id,n.user_id,coalesce(u.display_name,u.email,'Previous tax professional'),n.content,n.updated_at
 from tax_company_notes n join users u on u.id=n.user_id where btrim(n.content)<>'';
drop policy if exists tax_notes_private_read on public.tax_company_notes;
create policy tax_notes_owner_record on public.tax_company_notes for select to authenticated using(public.tax_can_work(salon_id));
create or replace function public.tax_company_save_note(p_salon uuid,p_content text,p_version integer) returns jsonb language plpgsql security definer set search_path=public as $$ begin
 raise exception 'Use shared salon messages. Private salon notes are no longer supported.';
end $$;

-- Preserve existing delivered paystubs before any future replacement cleanup.
insert into tax_documents(salon_id,staff_id,recipient_user_id,payroll_run_id,kind,title,file_name,bucket,path,mime_type,size_bytes,uploaded_by,uploaded_role,created_at)
 select p.salon_id,p.staff_id,coalesce(s.account_user_id,u.id),p.payroll_run_id,'paystub',coalesce(p.file_name,'Paystub'),coalesce(p.file_name,'Paystub'),
 'payroll-paystubs',p.file_url_or_path,coalesce(p.mime_type,'application/pdf'),greatest(1,least(coalesce(p.size_bytes,1),10485760)),p.uploaded_by,'legacy',p.created_at
 from payroll_paystubs p join staff s on s.id=p.staff_id left join users u on u.auth_user_id=s.user_id where p.file_url_or_path is not null on conflict(bucket,path) do nothing;

create function public.tax_capture_legacy_paystub() returns trigger language plpgsql security definer set search_path=public as $$
declare recipient uuid; begin
 if new.file_url_or_path is null then return new; end if;
 if tg_op='UPDATE' and old.file_url_or_path is distinct from new.file_url_or_path then update tax_documents set archived_at=coalesce(archived_at,now()) where bucket='payroll-paystubs' and path=old.file_url_or_path; end if;
 select coalesce(s.account_user_id,u.id) into recipient from staff s left join users u on u.auth_user_id=s.user_id where s.id=new.staff_id;
 insert into tax_documents(salon_id,staff_id,recipient_user_id,payroll_run_id,kind,title,file_name,bucket,path,mime_type,size_bytes,uploaded_by,uploaded_role)
 values(new.salon_id,new.staff_id,recipient,new.payroll_run_id,'paystub',coalesce(new.file_name,'Paystub'),coalesce(new.file_name,'Paystub'),'payroll-paystubs',new.file_url_or_path,coalesce(new.mime_type,'application/pdf'),greatest(1,least(coalesce(new.size_bytes,1),10485760)),new.uploaded_by,'legacy') on conflict(bucket,path) do nothing;
 return new;
end $$;
create trigger tax_capture_legacy_paystub after insert or update on public.payroll_paystubs for each row execute function public.tax_capture_legacy_paystub();
update public.tax_documents set staff_delivery=true where kind='paystub';

-- Documents delivered before signup bind once to the verified staff account.
-- Subsequent unlinking/reassignment never transfers a former recipient's files.
create function public.tax_bind_staff_recipient() returns trigger language plpgsql security definer set search_path=public as $$
declare recipient uuid; begin
 select coalesce(new.account_user_id,u.id) into recipient from (select 1) x left join users u on u.auth_user_id=new.user_id;
 if recipient is not null then update tax_documents set recipient_user_id=recipient where staff_id=new.id and recipient_user_id is null and (staff_delivery or kind='paystub'); end if;
 return new;
end $$;
create trigger tax_bind_staff_recipient after update of account_user_id,user_id on public.staff for each row execute function public.tax_bind_staff_recipient();

create function public.tax_storage_insert(p_path text) returns boolean language sql stable security definer set search_path=public as $$
 select exists(select 1 from tax_uploads where path=p_path and actor_id=current_public_user_id() and completed_at is null and created_at>now()-interval '30 minutes' and tax_can_work(salon_id));
$$;
create function public.tax_storage_read(p_bucket text,p_path text) returns boolean language sql stable security definer set search_path=public as $$
 select exists(select 1 from tax_documents where bucket=p_bucket and path=p_path and tax_document_access(id));
$$;
create policy tax_document_storage_insert on storage.objects for insert to authenticated with check(bucket_id='payroll-paystubs' and public.tax_storage_insert(name));
create policy tax_document_storage_read on storage.objects for select to authenticated using(public.tax_storage_read(bucket_id,name));
-- RESTRICTIVE policy also applies to legacy permissive cleanup policies.
create function public.tax_file_retained(p_bucket text,p_path text) returns boolean language sql stable security definer set search_path=public as $$
 select exists(select 1 from tax_documents where bucket=p_bucket and path=p_path);
$$;
create policy tax_preserve_delivered_files on storage.objects as restrictive for delete to authenticated using(not public.tax_file_retained(bucket_id,name));
create policy tax_document_visibility on storage.objects as restrictive for select to authenticated using(not public.tax_file_retained(bucket_id,name) or public.tax_storage_read(bucket_id,name));

do $$ declare item record; begin
 for item in select oid::regprocedure as signature,proname from pg_proc where pronamespace='public'::regnamespace and proname=any(array[
 'tax_actor','tax_is_owner','tax_can_work','tax_save_profile','tax_actor_name','tax_event','tax_document_access','tax_workspace_data','tax_businesses','tax_require_current_run','tax_set_work',
 'tax_send_message','tax_begin_upload','tax_finish_upload','tax_archive_document','tax_owner_delete_document','tax_save_receipt','tax_archive_receipt',
 'tax_storage_insert','tax_storage_read','tax_file_retained','tax_capture_legacy_paystub','tax_bind_staff_recipient','tax_stamp_document','tax_audit_connection']) loop
 execute format('revoke all on function %s from public,anon,authenticated',item.signature);
 if item.proname not in ('tax_event','tax_capture_legacy_paystub','tax_bind_staff_recipient','tax_stamp_document','tax_require_current_run','tax_audit_connection') then execute format('grant execute on function %s to authenticated',item.signature); end if;
 end loop;
end $$;
notify pgrst,'reload schema';
commit;
